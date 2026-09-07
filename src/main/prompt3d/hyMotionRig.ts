import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AssetSpecV1, Prompt3DSelectedExecutionProfile } from "../../shared/prompt3d";
import { MIXAMO_25_CORE } from "../../shared/mixamo25";

const JOINT_COUNT = 22;
export const HY_MOTION_SOURCE_REVISION = "4e426f5a1021cbcf7f375458c37b840ee7225229";
export const HY_MOTION_MODEL_REVISION = "620dd559f8d964aac2f82f1204fe6a35ad8ad14d";
const SOURCE_TO_MIXAMO25 = [
  "Hips", "LeftUpLeg", "RightUpLeg", "Spine", "LeftLeg", "RightLeg", "Spine1",
  "LeftFoot", "RightFoot", "Spine2", "LeftToeBase", "RightToeBase", "Neck",
  "LeftShoulder", "RightShoulder", "Head", "LeftArm", "RightArm", "LeftForeArm",
  "RightForeArm", "LeftHand", "RightHand",
] as const;

export interface HyMotionCompatibilityDecision {
  version: 1;
  classification: "humanoid";
  rootTranslation: "directional" | "stationary";
  rationale: string;
  provider: "ollama" | "offline-test-fixture";
  model: string;
}

export interface HyMotionData {
  version: 1;
  providerId: "hy-motion-1";
  providerModel: "hy-motion-1.0-lite";
  sourceRevision: string;
  modelRevision: string;
  createdAt: string;
  prompt: string;
  promptSha256: string;
  seed: number;
  duration: number;
  fps: 30;
  frames: number;
  cfgScale: number;
  executionProfile: {
    id: "hy-motion-cuda-standard-v1" | "hy-motion-cpu-basic-v1";
    device: "cuda" | "cpu";
    validationSteps: number | null;
    gpuUuid: string | null;
  };
  coordinateSystem: { upAxis: "+Y"; forwardAxis: "+Z"; handedness: "right" };
  jointNames: string[];
  parents: number[];
  restJoints: number[][];
  localRotationMatrices: number[][][][];
  rootTranslations: number[][];
  compatibility: HyMotionCompatibilityDecision;
  upstreamPreviewGeometryRetained: false;
}

export interface HyMotionRigResult {
  provider: "hy-motion-1.0-lite";
  clipId: string;
  clipName: string;
  frames: number;
  duration: number;
  skins: number;
  joints: number;
  skinnedMeshNodes: number;
  boneRotationChannels: number;
  rootTranslationChannels: number;
  pathDisplacementMeters: number;
  sourceRig: "grudge-mixamo25-v2";
  bindingMethod: "nearest-bone-segment-four-weight-v1" | "retained-grudge-mixamo25-v2";
  horizontalRootMotion: "generated-directional" | "removed-stationary";
  motionDataSha256: string;
  executionProfile: HyMotionData["executionProfile"];
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateMotionData(value: unknown, prompt: string, seed: number): HyMotionData {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("HY-Motion output is not an object.");
  const data = value as HyMotionData;
  const promptSha256 = createHash("sha256").update(prompt.trim()).digest("hex");
  if (data.version !== 1 || data.providerId !== "hy-motion-1" || data.providerModel !== "hy-motion-1.0-lite"
    || data.sourceRevision !== HY_MOTION_SOURCE_REVISION || data.modelRevision !== HY_MOTION_MODEL_REVISION
    || data.prompt !== prompt.trim() || data.promptSha256 !== promptSha256 || data.seed !== seed
    || data.upstreamPreviewGeometryRetained !== false || data.coordinateSystem?.upAxis !== "+Y"
    || data.coordinateSystem?.forwardAxis !== "+Z" || data.coordinateSystem?.handedness !== "right") {
    throw new Error("HY-Motion output identity does not match the exact retained prompt and seed.");
  }
  if (!Number.isFinite(Date.parse(data.createdAt)) || !finite(data.cfgScale) || data.cfgScale < 1 || data.cfgScale > 10
    || !Number.isInteger(data.frames) || data.frames < 2 || data.frames > 180
    || data.fps !== 30 || !finite(data.duration) || data.duration < 0.5 || data.duration > 5
    || !Array.isArray(data.parents) || data.parents.length !== JOINT_COUNT
    || !Array.isArray(data.jointNames) || data.jointNames.length !== JOINT_COUNT
    || !Array.isArray(data.restJoints) || data.restJoints.length !== JOINT_COUNT
    || !Array.isArray(data.localRotationMatrices) || data.localRotationMatrices.length !== data.frames
    || !Array.isArray(data.rootTranslations) || data.rootTranslations.length !== data.frames) {
    throw new Error("HY-Motion output dimensions are invalid or exceed the bounded clip contract.");
  }
  const execution = data.executionProfile;
  const executionValid = execution?.id === "hy-motion-cuda-standard-v1"
    ? execution.device === "cuda" && execution.validationSteps === null && typeof execution.gpuUuid === "string" && /^GPU-[A-Za-z0-9-]{8,64}$/.test(execution.gpuUuid)
    : execution?.id === "hy-motion-cpu-basic-v1"
      && execution.device === "cpu" && execution.validationSteps === 12 && execution.gpuUuid === null;
  if (!executionValid) throw new Error("HY-Motion output is missing a valid provider-native execution profile.");
  if (new Set(data.jointNames).size !== JOINT_COUNT || data.jointNames.some((name) => typeof name !== "string" || !name.trim())) {
    throw new Error("HY-Motion output does not contain 22 unique named joints.");
  }
  if (data.compatibility?.classification !== "humanoid"
    || !["directional", "stationary"].includes(data.compatibility.rootTranslation)) {
    throw new Error("HY-Motion output is missing its humanoid and root-motion decisions.");
  }
  for (let joint = 0; joint < JOINT_COUNT; joint += 1) {
    if (!Array.isArray(data.restJoints[joint]) || data.restJoints[joint].length !== 3 || !data.restJoints[joint].every(finite)) throw new Error("HY-Motion rest rig is invalid.");
    if (!Number.isInteger(data.parents[joint]) || (joint === 0 ? ![-1, 0].includes(data.parents[joint]) : data.parents[joint] < 0 || data.parents[joint] >= joint)) throw new Error("HY-Motion hierarchy is invalid.");
  }
  for (let frame = 0; frame < data.frames; frame += 1) {
    if (!Array.isArray(data.rootTranslations[frame]) || data.rootTranslations[frame].length !== 3 || !data.rootTranslations[frame].every(finite)) throw new Error("HY-Motion root trajectory is invalid.");
    if (!Array.isArray(data.localRotationMatrices[frame]) || data.localRotationMatrices[frame].length !== JOINT_COUNT) throw new Error("HY-Motion joint frame is invalid.");
    for (const matrix of data.localRotationMatrices[frame]) {
      if (!Array.isArray(matrix) || matrix.length !== 3 || matrix.some((row) => !Array.isArray(row) || row.length !== 3 || !row.every(finite))) throw new Error("HY-Motion rotation matrix is invalid.");
    }
  }
  return data;
}

function transformSourceVector([x, y, z]: number[]): [number, number, number] {
  // HY-Motion's pinned MotionGeneration decoder grounds its wooden reference
  // mesh with vertices[..., 1], matching the app's right-handed +Y-up/+Z-forward
  // contract. Retain that native frame instead of applying an assumed SMPL turn.
  return [x, y, z];
}

function transformSourceRotation(rotation: number[][]): number[][] {
  return rotation;
}

function matrix3Quaternion(matrix: number[][]): [number, number, number, number] {
  const m00 = matrix[0][0], m01 = matrix[0][1], m02 = matrix[0][2];
  const m10 = matrix[1][0], m11 = matrix[1][1], m12 = matrix[1][2];
  const m20 = matrix[2][0], m21 = matrix[2][1], m22 = matrix[2][2];
  const trace = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  const length = Math.hypot(x, y, z, w);
  if (!Number.isFinite(length) || length < 1e-8) throw new Error("HY-Motion produced a degenerate joint rotation.");
  return [x / length, y / length, z / length, w / length];
}

function transformPoint(matrix: ArrayLike<number>, point: number[]): [number, number, number] {
  const [x, y, z] = point;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function multiply4(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const output = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) for (let row = 0; row < 4; row += 1) {
    for (let index = 0; index < 4; index += 1) output[column * 4 + row] += Number(a[index * 4 + row]) * Number(b[column * 4 + index]);
  }
  return output;
}

function inverse4(matrix: ArrayLike<number>): number[] {
  const augmented = Array.from({ length: 4 }, (_, row) => [
    ...Array.from({ length: 4 }, (_, column) => Number(matrix[column * 4 + row])),
    ...Array.from({ length: 4 }, (_, column) => row === column ? 1 : 0),
  ]);
  for (let column = 0; column < 4; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 4; row += 1) if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    if (Math.abs(augmented[pivot][column]) < 1e-10) throw new Error("Cannot bind a skeleton to a singular mesh transform.");
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const scale = augmented[column][column];
    for (let index = 0; index < 8; index += 1) augmented[column][index] /= scale;
    for (let row = 0; row < 4; row += 1) if (row !== column) {
      const factor = augmented[row][column];
      for (let index = 0; index < 8; index += 1) augmented[row][index] -= factor * augmented[column][index];
    }
  }
  const output = new Array<number>(16);
  for (let row = 0; row < 4; row += 1) for (let column = 0; column < 4; column += 1) output[column * 4 + row] = augmented[row][column + 4];
  return output;
}

function translationMatrix(point: number[]): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, point[0], point[1], point[2], 1];
}

function segmentDistanceSquared(point: number[], start: number[], end: number[]): number {
  const dx = end[0] - start[0], dy = end[1] - start[1], dz = end[2] - start[2];
  const denominator = dx * dx + dy * dy + dz * dz;
  const t = denominator > 1e-12 ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy + (point[2] - start[2]) * dz) / denominator)) : 0;
  const px = start[0] + dx * t - point[0], py = start[1] + dy * t - point[1], pz = start[2] + dz * t - point[2];
  return px * px + py * py + pz * pz;
}

function createWeights(point: number[], joints: number[][], parents: number[]): { indices: number[]; weights: number[] } {
  const distances = joints.map((joint, index) => ({
    index,
    distance: index === 0 ? Math.hypot(point[0] - joint[0], point[1] - joint[1], point[2] - joint[2]) ** 2 : segmentDistanceSquared(point, joints[parents[index]], joint),
  })).sort((a, b) => a.distance - b.distance).slice(0, 4);
  const inverse = distances.map((entry) => 1 / Math.max(1e-8, entry.distance));
  const total = inverse.reduce((sum, value) => sum + value, 0);
  return { indices: distances.map((entry) => entry.index), weights: inverse.map((value) => value / total) };
}

function maximumRootDisplacement(points: number[][]): number {
  const first = points[0];
  return Math.max(...points.map((point) => Math.hypot(point[0] - first[0], point[1] - first[1], point[2] - first[2])));
}

export async function bindHyMotionToGlb(options: {
  sourcePath: string;
  outputPath: string;
  motionPath: string;
  prompt: string;
  seed: number;
  mode: "replace" | "append";
  spec: AssetSpecV1;
  expectedCompatibility: HyMotionCompatibilityDecision;
  expectedExecutionProfile: Prompt3DSelectedExecutionProfile;
}): Promise<HyMotionRigResult> {
  const motionBytes = await readFile(options.motionPath);
  if (motionBytes.byteLength < 2 || motionBytes.byteLength > 32 * 1024 ** 2) throw new Error("HY-Motion skeletal output is empty or exceeds 32 MiB.");
  const data = validateMotionData(JSON.parse(motionBytes.toString("utf8")), options.prompt, options.seed);
  for (const key of ["version", "classification", "rootTranslation", "rationale", "provider", "model"] as const) {
    if (data.compatibility[key] !== options.expectedCompatibility[key]) {
      throw new Error(`HY-Motion output changed its retained compatibility decision (${key}).`);
    }
  }
  if (data.executionProfile.id !== options.expectedExecutionProfile.id
    || data.executionProfile.device !== options.expectedExecutionProfile.device
    || data.executionProfile.validationSteps !== (options.expectedExecutionProfile.validationSteps ?? null)
    || data.executionProfile.gpuUuid !== (options.expectedExecutionProfile.gpu?.uuid ?? null)) {
    throw new Error("HY-Motion output changed its measured execution profile or selected GPU.");
  }
  const motionDataSha256 = createHash("sha256").update(motionBytes).digest("hex");
  const { NodeIO } = require("@gltf-transform/core");
  const { ALL_EXTENSIONS } = require("@gltf-transform/extensions");
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.read(options.sourcePath);
  const root = document.getRoot();
  const buffer = root.listBuffers()[0] ?? document.createBuffer("HY-Motion animation buffer");
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) throw new Error("Approved Hunyuan GLB contains no scene for skeletal binding.");

  const baseMeshNodes = root.listNodes().filter((node: any) => {
    const extras = node.getExtras?.() ?? {};
    const name = `${node.getName?.() ?? ""} ${node.getMesh?.()?.getName?.() ?? ""}`;
    return node.getMesh?.() && extras.grudgeDerivedGeometry !== true && extras.grudgeMotionTrail !== true && !/(?:collision|collider|(?:^|[_-])lod\d+)/i.test(name);
  });
  if (!baseMeshNodes.length) throw new Error("Approved Hunyuan GLB contains no bindable surface mesh.");
  const meshInstances = new Map<any, any[]>();
  for (const node of baseMeshNodes) meshInstances.set(node.getMesh(), [...(meshInstances.get(node.getMesh()) ?? []), node]);
  for (const nodes of meshInstances.values()) {
    const transforms = nodes.map((node) => Array.from(node.getWorldMatrix(), (value: unknown) => Math.round(Number(value) * 1e7)).join(","));
    if (new Set(transforms).size > 1) throw new Error("Automatic local skinning cannot safely bind one instanced mesh at multiple transforms; make the approved humanoid a single mesh instance.");
  }

  const boundsMin = [Infinity, Infinity, Infinity], boundsMax = [-Infinity, -Infinity, -Infinity];
  for (const node of baseMeshNodes) {
    const matrix = node.getWorldMatrix();
    for (const primitive of node.getMesh().listPrimitives()) {
      const positions = primitive.getAttribute("POSITION")?.getArray() as ArrayLike<number> | undefined;
      if (!positions) continue;
      for (let index = 0; index < positions.length; index += 3) {
        const point = transformPoint(matrix, [Number(positions[index]), Number(positions[index + 1]), Number(positions[index + 2])]);
        for (let axis = 0; axis < 3; axis += 1) { boundsMin[axis] = Math.min(boundsMin[axis], point[axis]); boundsMax[axis] = Math.max(boundsMax[axis], point[axis]); }
      }
    }
  }
  if (!boundsMin.every(finite) || boundsMax[1] - boundsMin[1] <= 1e-5) throw new Error("Approved Hunyuan humanoid has invalid world bounds for skeletal binding.");
  const sourceJoints = data.restJoints.map(transformSourceVector);
  const sourceMinY = Math.min(...sourceJoints.map((point) => point[1]));
  const sourceMaxY = Math.max(...sourceJoints.map((point) => point[1]));
  if (sourceMaxY - sourceMinY <= 1e-5) throw new Error("HY-Motion rest rig has no measurable height.");
  const meshHeight = boundsMax[1] - boundsMin[1];
  const rigScale = meshHeight / (sourceMaxY - sourceMinY);
  const sourceCenterX = (Math.min(...sourceJoints.map((point) => point[0])) + Math.max(...sourceJoints.map((point) => point[0]))) / 2;
  const sourceCenterZ = (Math.min(...sourceJoints.map((point) => point[2])) + Math.max(...sourceJoints.map((point) => point[2]))) / 2;
  const targetCenterX = (boundsMin[0] + boundsMax[0]) / 2, targetCenterZ = (boundsMin[2] + boundsMax[2]) / 2;
  const fittedJoints = sourceJoints.map((point) => [
    targetCenterX + (point[0] - sourceCenterX) * rigScale,
    boundsMin[1] + (point[1] - sourceMinY) * rigScale,
    targetCenterZ + (point[2] - sourceCenterZ) * rigScale,
  ]);

  let bindingMethod: HyMotionRigResult["bindingMethod"] = "retained-grudge-mixamo25-v2";
  const retainedJoints = new Map<number, any>();
  for (const node of root.listNodes()) {
    const index = node.getExtras?.()?.grudgeHyMotionJointIndex;
    if (Number.isInteger(index) && index >= 0 && index < JOINT_COUNT) retainedJoints.set(index, node);
  }
  let joints: any[];
  if (retainedJoints.size === JOINT_COUNT && baseMeshNodes.every((node: any) => node.getSkin?.())) {
    joints = Array.from({ length: JOINT_COUNT }, (_, index) => retainedJoints.get(index));
  } else {
    if (retainedJoints.size || baseMeshNodes.some((node: any) => node.getSkin?.())) throw new Error("The approved asset contains a partial or foreign skin. Complete it in Skeleton Studio before generating HY-Motion.");
    bindingMethod = "nearest-bone-segment-four-weight-v1";
    joints = fittedJoints.map((point, index) => document.createNode(SOURCE_TO_MIXAMO25[index]).setExtras({
      grudgeDerivedGeometry: true,
      grudgeHyMotionRig: "grudge-mixamo25-v2",
      grudgeHyMotionJointIndex: index,
      sourceJointName: data.jointNames[index],
    }).setTranslation(index === 0 ? point : [
      point[0] - fittedJoints[data.parents[index]][0],
      point[1] - fittedJoints[data.parents[index]][1],
      point[2] - fittedJoints[data.parents[index]][2],
    ]));
    for (let index = 1; index < JOINT_COUNT; index += 1) joints[data.parents[index]].addChild(joints[index]);
    scene.addChild(joints[0]);

    for (const [mesh, nodes] of meshInstances) {
      const representative = nodes[0];
      const matrix = representative.getWorldMatrix();
      for (const primitive of mesh.listPrimitives()) {
        const positions = primitive.getAttribute("POSITION")?.getArray() as ArrayLike<number> | undefined;
        if (!positions) throw new Error("A bindable Hunyuan primitive has no positions.");
        const indices = new Uint16Array((positions.length / 3) * 4);
        const weights = new Float32Array((positions.length / 3) * 4);
        for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
          const point = transformPoint(matrix, [Number(positions[vertex * 3]), Number(positions[vertex * 3 + 1]), Number(positions[vertex * 3 + 2])]);
          const influence = createWeights(point, fittedJoints, data.parents);
          for (let slot = 0; slot < 4; slot += 1) { indices[vertex * 4 + slot] = influence.indices[slot]; weights[vertex * 4 + slot] = influence.weights[slot]; }
        }
        primitive.setAttribute("JOINTS_0", document.createAccessor("HY-Motion joint indices").setType("VEC4").setArray(indices).setBuffer(buffer));
        primitive.setAttribute("WEIGHTS_0", document.createAccessor("HY-Motion skin weights").setType("VEC4").setArray(weights).setBuffer(buffer));
      }
      for (const node of nodes) {
        const inverseBindMatrices = new Float32Array(JOINT_COUNT * 16);
        for (let index = 0; index < JOINT_COUNT; index += 1) inverseBindMatrices.set(multiply4(inverse4(translationMatrix(fittedJoints[index])), node.getWorldMatrix()), index * 16);
        const skin = document.createSkin(`HY-Motion ${node.getName?.() || "surface"} skin`)
          .setSkeleton(joints[0])
          .setInverseBindMatrices(document.createAccessor("HY-Motion inverse bind matrices").setType("MAT4").setArray(inverseBindMatrices).setBuffer(buffer));
        joints.forEach((joint) => skin.addJoint(joint));
        node.setSkin(skin);
      }
    }
  }

  if (options.mode === "replace") root.listAnimations().forEach((animation: any) => animation.dispose());
  const clipId = createHash("sha256").update(`${motionDataSha256}\0${options.mode}\0${root.listAnimations().length}`).digest("hex").slice(0, 24);
  const clipName = `HY-Motion ${options.prompt.trim().replace(/\s+/g, " ").slice(0, 72)}`;
  const animation = document.createAnimation(clipName).setExtras({
    grudgePromptAnimation: {
      version: 2,
      clipId,
      provider: "hy-motion-1.0-lite",
      seed: options.seed,
      promptSha256: data.promptSha256,
      rig: "grudge-mixamo25-v2",
      mode: options.mode,
    },
  });
  const times = document.createAccessor("HY-Motion frame times").setType("SCALAR")
    .setArray(Float32Array.from({ length: data.frames }, (_, index) => index / data.fps)).setBuffer(buffer);
  let boneRotationChannels = 0;
  for (let joint = 0; joint < JOINT_COUNT; joint += 1) {
    const rotations = new Float32Array(data.frames * 4);
    let previous: number[] | null = null;
    for (let frame = 0; frame < data.frames; frame += 1) {
      const quaternion = matrix3Quaternion(transformSourceRotation(data.localRotationMatrices[frame][joint]));
      if (previous && quaternion.reduce((sum, value, index) => sum + value * previous![index], 0) < 0) for (let index = 0; index < 4; index += 1) quaternion[index] *= -1;
      rotations.set(quaternion, frame * 4);
      previous = quaternion;
    }
    const sampler = document.createAnimationSampler(`${SOURCE_TO_MIXAMO25[joint]} generated rotations`).setInput(times)
      .setOutput(document.createAccessor(`${SOURCE_TO_MIXAMO25[joint]} generated quaternion`).setType("VEC4").setArray(rotations).setBuffer(buffer)).setInterpolation("LINEAR");
    animation.addSampler(sampler).addChannel(document.createAnimationChannel(`${SOURCE_TO_MIXAMO25[joint]} generated rotation channel`)
      .setSampler(sampler).setTargetNode(joints[joint]).setTargetPath("rotation"));
    boneRotationChannels += 1;
  }
  const allowHorizontal = data.compatibility.rootTranslation === "directional";
  const transformedRoot = data.rootTranslations.map(transformSourceVector);
  const rootOrigin = transformedRoot[0];
  const rootTranslations = transformedRoot.map((point) => [
    fittedJoints[0][0] + (allowHorizontal ? point[0] - rootOrigin[0] : 0) * rigScale,
    fittedJoints[0][1] + (point[1] - rootOrigin[1]) * rigScale,
    fittedJoints[0][2] + (allowHorizontal ? point[2] - rootOrigin[2] : 0) * rigScale,
  ]);
  const rootSampler = document.createAnimationSampler("Hips generated root trajectory").setInput(times)
    .setOutput(document.createAccessor("Hips generated root translations").setType("VEC3").setArray(new Float32Array(rootTranslations.flat())).setBuffer(buffer)).setInterpolation("LINEAR");
  animation.addSampler(rootSampler).addChannel(document.createAnimationChannel("Hips generated root trajectory channel")
    .setSampler(rootSampler).setTargetNode(joints[0]).setTargetPath("translation"));

  await io.write(options.outputPath, document);
  return {
    provider: "hy-motion-1.0-lite",
    clipId,
    clipName,
    frames: data.frames,
    duration: (data.frames - 1) / data.fps,
    skins: root.listSkins().length,
    joints: JOINT_COUNT,
    skinnedMeshNodes: baseMeshNodes.filter((node: any) => node.getSkin?.()).length,
    boneRotationChannels,
    rootTranslationChannels: 1,
    pathDisplacementMeters: maximumRootDisplacement(rootTranslations),
    sourceRig: "grudge-mixamo25-v2",
    bindingMethod,
    horizontalRootMotion: allowHorizontal ? "generated-directional" : "removed-stationary",
    motionDataSha256,
    executionProfile: data.executionProfile,
  };
}

export function hyMotionRigCompatibility(): { canonicalBones: readonly string[]; sourceBones: readonly string[] } {
  return { canonicalBones: MIXAMO_25_CORE, sourceBones: SOURCE_TO_MIXAMO25 };
}
