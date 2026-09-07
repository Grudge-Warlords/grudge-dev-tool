import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { NodeIO, type Document, type Node as GltfNode } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import type { AssetSpecV1 } from "../../shared/prompt3d";
import {
  MIXAMO_25_CORE,
  MIXAMO_25_PARENT,
  MIXAMO_25_VERSION,
  autoMapBonesFromNames,
  type BonePlacement,
  type Mixamo25Bone,
} from "../../shared/mixamo25";
import { compilePrompt3DPrompt } from "../../shared/prompt3dRules";
import { hasAffirmativePromptMatch } from "../../shared/promptedMotionIntent";
import { classifyPrompt3DAnimationSubject } from "../../shared/prompt3dAnimationSubject";

export const DETERMINISTIC_RIG_PROFILE = "grudge-mixamo25-cpu-fit-v1" as const;
export const DETERMINISTIC_RIG_WEIGHTS = "nearest-bone-segment-four-weight-v1" as const;
const MAX_SOURCE_BYTES = 1024 * 1024 * 1024;
const MIN_SPAN = 1e-5;
const MATRIX_EPSILON = 1e-9;

type Vec3 = [number, number, number];

export type DeterministicRigClassification = "humanoid" | "non-humanoid" | "rigid-object" | "ambiguous";

export interface DeterministicRigClassificationDecision {
  version: 1;
  classification: DeterministicRigClassification;
  source: "asset-spec-and-presentation-contract";
  rationale: string;
  context: {
    category: AssetSpecV1["category"];
    objectType: string;
    coordinateContract: AssetSpecV1["coordinateContract"];
    promptSha256: string;
    presentationContractSha256: string;
  };
}

export interface DeterministicRigCheck {
  id: string;
  status: "pass" | "review";
  detail: string;
}

export interface DeterministicRigInspection {
  version: 1;
  compatible: boolean;
  profile: typeof DETERMINISTIC_RIG_PROFILE;
  joints: number;
  skins: number;
  skinnedMeshNodes: number;
  primitives: number;
  vertices: number;
  normalizedFourWeightVertices: number;
  finiteInverseBindMatrices: boolean;
  canonicalBoneNames: string[];
  boundsMeters: { min: Vec3; max: Vec3; width: number; height: number; depth: number };
  checks: DeterministicRigCheck[];
}

export interface DeterministicRigPreparation {
  version: 1;
  route: "existing-rig" | "deterministic-cpu-rig";
  profile: typeof DETERMINISTIC_RIG_PROFILE;
  mixamo25Version: typeof MIXAMO_25_VERSION;
  sourcePath: string;
  sourceSha256: string;
  outputPath: string;
  outputSha256: string;
  parentRevisionSha256: string;
  classification: DeterministicRigClassificationDecision;
  placements: BonePlacement[];
  placementMethod: "retained-canonical-joints" | "canonical-proportion-fit" | "skeleton-studio-correction";
  weightsMethod: "retained-compatible-skin" | typeof DETERMINISTIC_RIG_WEIGHTS;
  inspection: DeterministicRigInspection;
  sourceGeometryHash?: string;
  outputGeometryHash?: string;
  sourceTextureFingerprint?: string;
  outputTextureFingerprint?: string;
}

export class DeterministicRigReviewRequiredError extends Error {
  readonly code = "SKELETON_STUDIO_REVIEW_REQUIRED";
  constructor(
    message: string,
    readonly classification: DeterministicRigClassificationDecision,
    readonly checks: DeterministicRigCheck[],
    readonly suggestedPlacements: BonePlacement[] = [],
  ) {
    super(`skeleton-studio-review-required: ${message}`);
    this.name = "DeterministicRigReviewRequiredError";
  }
}

const SAFE_STANCE = /\b(?:t[- ]?pose|a[- ]?pose|upright|standing|stand(?:s|ing)?|feet\s+(?:apart|separated)|arms?\s+(?:out|apart|spread|extended)|motion[- ]ready)\b/i;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function io(): NodeIO {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS);
}

export function classifyDeterministicRig(spec: AssetSpecV1): DeterministicRigClassificationDecision {
  const plan = compilePrompt3DPrompt(spec);
  const { classification, rationale } = classifyPrompt3DAnimationSubject(spec);
  return {
    version: 1,
    classification,
    source: "asset-spec-and-presentation-contract",
    rationale,
    context: {
      category: spec.category,
      objectType: plan.objectType,
      coordinateContract: { ...spec.coordinateContract },
      promptSha256: sha256(spec.prompt.trim()),
      presentationContractSha256: sha256(stableJson(plan.presentationContract)),
    },
  };
}

function transformPoint(matrix: ArrayLike<number>, point: Vec3): Vec3 {
  const [x, y, z] = point;
  return [
    Number(matrix[0]) * x + Number(matrix[4]) * y + Number(matrix[8]) * z + Number(matrix[12]),
    Number(matrix[1]) * x + Number(matrix[5]) * y + Number(matrix[9]) * z + Number(matrix[13]),
    Number(matrix[2]) * x + Number(matrix[6]) * y + Number(matrix[10]) * z + Number(matrix[14]),
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
    if (Math.abs(augmented[pivot][column]) < MATRIX_EPSILON) throw new Error("Cannot bind a skeleton through a singular mesh transform.");
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let index = 0; index < 8; index += 1) augmented[column][index] /= divisor;
    for (let row = 0; row < 4; row += 1) if (row !== column) {
      const factor = augmented[row][column];
      for (let index = 0; index < 8; index += 1) augmented[row][index] -= factor * augmented[column][index];
    }
  }
  const output = new Array<number>(16);
  for (let row = 0; row < 4; row += 1) for (let column = 0; column < 4; column += 1) output[column * 4 + row] = augmented[row][column + 4];
  if (!output.every(Number.isFinite)) throw new Error("Inverse-bind calculation produced a non-finite matrix.");
  return output;
}

function translationMatrix(point: Vec3): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, point[0], point[1], point[2], 1];
}

function segmentDistanceSquared(point: Vec3, start: Vec3, end: Vec3): number {
  const dx = end[0] - start[0], dy = end[1] - start[1], dz = end[2] - start[2];
  const denominator = dx * dx + dy * dy + dz * dz;
  const t = denominator > 1e-12 ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy + (point[2] - start[2]) * dz) / denominator)) : 0;
  const px = start[0] + dx * t - point[0], py = start[1] + dy * t - point[1], pz = start[2] + dz * t - point[2];
  return px * px + py * py + pz * pz;
}

function canonicalParents(): number[] {
  return MIXAMO_25_CORE.map((bone, index) => {
    const parent = MIXAMO_25_PARENT[bone];
    if (parent === null || parent === undefined) return -1;
    const parentIndex = MIXAMO_25_CORE.indexOf(parent);
    if (parentIndex < 0 || parentIndex >= index) throw new Error(`Canonical Mixamo-25 hierarchy is invalid at ${bone}.`);
    return parentIndex;
  });
}

function createWeights(point: Vec3, joints: Vec3[], parents: number[]): { indices: number[]; weights: number[] } {
  const distances = joints.map((joint, index) => ({
    index,
    distance: index === 0 ? Math.hypot(point[0] - joint[0], point[1] - joint[1], point[2] - joint[2]) ** 2 : segmentDistanceSquared(point, joints[parents[index]], joint),
  })).sort((a, b) => a.distance - b.distance || a.index - b.index).slice(0, 4);
  const inverse = distances.map((entry) => 1 / Math.max(1e-8, entry.distance));
  const total = inverse.reduce((sum, value) => sum + value, 0);
  if (!finite(total) || total <= 0) throw new Error("Skin weighting produced a non-finite normalization total.");
  return { indices: distances.map((entry) => entry.index), weights: inverse.map((value) => value / total) };
}

function baseMeshNodes(document: Document): GltfNode[] {
  return document.getRoot().listNodes().filter((node) => {
    const extras = node.getExtras() as Record<string, unknown>;
    const name = `${node.getName()} ${node.getMesh()?.getName() ?? ""}`;
    return Boolean(node.getMesh()) && extras.grudgeDerivedGeometry !== true && extras.grudgeMotionTrail !== true && !/(?:collision|collider|(?:^|[_-])lod\d+)/i.test(name);
  });
}

function collectWorldPoints(nodes: GltfNode[]): { points: Vec3[]; min: Vec3; max: Vec3; primitives: number } {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const points: Vec3[] = [];
  let primitives = 0;
  for (const node of nodes) {
    const matrix = node.getWorldMatrix();
    for (const primitive of node.getMesh()!.listPrimitives()) {
      primitives += 1;
      const positions = primitive.getAttribute("POSITION")?.getArray();
      if (!positions || positions.length < 3 || positions.length % 3 !== 0) throw new Error("A bindable primitive has no valid POSITION data.");
      for (let index = 0; index < positions.length; index += 3) {
        const point = transformPoint(matrix, [Number(positions[index]), Number(positions[index + 1]), Number(positions[index + 2])]);
        if (!point.every(finite)) throw new Error("A bindable primitive contains non-finite transformed positions.");
        points.push(point);
        for (let axis = 0; axis < 3; axis += 1) {
          min[axis] = Math.min(min[axis], point[axis]);
          max[axis] = Math.max(max[axis], point[axis]);
        }
      }
    }
  }
  return { points, min, max, primitives };
}

const NORMALIZED_REST: Record<Mixamo25Bone, Vec3> = {
  Hips: [0, 0.50, 0], Spine: [0, 0.59, 0], Spine1: [0, 0.68, 0], Spine2: [0, 0.77, 0], Neck: [0, 0.84, 0], Head: [0, 0.94, 0],
  LeftShoulder: [0.10, 0.79, 0], LeftArm: [0.27, 0.79, 0], LeftForeArm: [0.43, 0.79, 0], LeftHand: [0.54, 0.79, 0],
  RightShoulder: [-0.10, 0.79, 0], RightArm: [-0.27, 0.79, 0], RightForeArm: [-0.43, 0.79, 0], RightHand: [-0.54, 0.79, 0],
  LeftUpLeg: [0.09, 0.48, 0], LeftLeg: [0.09, 0.27, 0], LeftFoot: [0.09, 0.055, 0.015], LeftToeBase: [0.09, 0.035, 0.13],
  RightUpLeg: [-0.09, 0.48, 0], RightLeg: [-0.09, 0.27, 0], RightFoot: [-0.09, 0.055, 0.015], RightToeBase: [-0.09, 0.035, 0.13],
  LeftEye: [0.025, 0.95, 0.04], RightEye: [-0.025, 0.95, 0.04], HeadTop_End: [0, 1, 0],
};

function fitCanonicalPlacements(min: Vec3, max: Vec3): BonePlacement[] {
  const width = max[0] - min[0], height = max[1] - min[1], depth = max[2] - min[2];
  const centerX = (min[0] + max[0]) / 2, centerZ = (min[2] + max[2]) / 2;
  const armScale = Math.min(height * 0.9, width * 0.9) / 1.08;
  return MIXAMO_25_CORE.map((bone) => {
    const normalized = NORMALIZED_REST[bone];
    return {
      bone,
      world: [
        centerX + normalized[0] * armScale,
        min[1] + normalized[1] * height,
        centerZ + normalized[2] * Math.max(depth, height * 0.08),
      ],
      confidence: 0.72,
    };
  });
}

function normalizePlacements(placements: BonePlacement[]): BonePlacement[] {
  const byBone = new Map<Mixamo25Bone, BonePlacement>();
  for (const placement of placements) {
    if (!MIXAMO_25_CORE.includes(placement.bone) || byBone.has(placement.bone) || !Array.isArray(placement.world) || placement.world.length !== 3 || !placement.world.every(finite)) {
      throw new Error("Skeleton Studio placements must contain one finite world-space marker for every canonical bone.");
    }
    byBone.set(placement.bone, { ...placement, world: [...placement.world] as Vec3 });
  }
  if (byBone.size !== MIXAMO_25_CORE.length) throw new Error(`Skeleton Studio correction requires all ${MIXAMO_25_CORE.length} core placements.`);
  return MIXAMO_25_CORE.map((bone) => byBone.get(bone)!);
}

function placementSafetyChecks(points: Vec3[], min: Vec3, max: Vec3, spec: AssetSpecV1, corrected: boolean): DeterministicRigCheck[] {
  const width = max[0] - min[0], height = max[1] - min[1], depth = max[2] - min[2];
  const centerX = (min[0] + max[0]) / 2;
  const lower = points.filter((point) => point[1] <= min[1] + height * 0.5);
  const upper = points.filter((point) => point[1] >= min[1] + height * 0.58 && point[1] <= min[1] + height * 0.88);
  const leftLeg = lower.filter((point) => point[0] >= centerX + width * 0.025).length;
  const rightLeg = lower.filter((point) => point[0] <= centerX - width * 0.025).length;
  const leftArm = upper.filter((point) => point[0] >= centerX + width * 0.24).length;
  const rightArm = upper.filter((point) => point[0] <= centerX - width * 0.24).length;
  const checks: DeterministicRigCheck[] = [
    { id: "canonical-orientation", status: spec.coordinateContract.upAxis === "+Y" && spec.coordinateContract.forwardAxis === "+Z" ? "pass" : "review", detail: "The approved +Y-up/+Z-forward orientation contract is required." },
    { id: "finite-bounds", status: [width, height, depth].every((span) => finite(span) && span > MIN_SPAN) ? "pass" : "review", detail: `Measured bounds ${width.toFixed(4)} x ${height.toFixed(4)} x ${depth.toFixed(4)} m.` },
    { id: "humanoid-proportions", status: height / Math.max(width, MIN_SPAN) >= 0.85 && height / Math.max(depth, MIN_SPAN) >= 1.1 ? "pass" : "review", detail: "The bounds must be compatible with an upright or arm-extended humanoid." },
    { id: "leg-separability", status: leftLeg >= 3 && rightLeg >= 3 ? "pass" : "review", detail: `Lower-body samples on both sides: ${leftLeg}/${rightLeg}.` },
    { id: "arm-separability", status: leftArm >= 3 && rightArm >= 3 ? "pass" : "review", detail: `Upper-body lateral samples on both sides: ${leftArm}/${rightArm}.` },
    { id: "stance-context", status: corrected || hasAffirmativePromptMatch(`${spec.prompt}\n${spec.objectRules?.shapeNotes ?? ""}`, SAFE_STANCE) ? "pass" : "review", detail: corrected ? "Skeleton Studio supplied explicit complete placements." : "Automatic fitting requires an affirmatively upright, standing, A-pose or T-pose context." },
  ];
  return checks;
}

function canonicalNodes(document: Document): Map<Mixamo25Bone, GltfNode> {
  const nodes = document.getRoot().listNodes();
  const names = nodes.map((node) => node.getName()).filter(Boolean);
  const mapped = autoMapBonesFromNames(names).reverseMap;
  const result = new Map<Mixamo25Bone, GltfNode>();
  for (const bone of MIXAMO_25_CORE) {
    const sourceName = mapped[bone];
    const node = sourceName ? nodes.find((candidate) => candidate.getName() === sourceName) : undefined;
    if (node) result.set(bone, node);
  }
  return result;
}

function inspectDocument(document: Document, checks: DeterministicRigCheck[] = []): DeterministicRigInspection {
  const root = document.getRoot();
  const nodes = baseMeshNodes(document);
  const world = collectWorldPoints(nodes);
  const canonical = canonicalNodes(document);
  let vertices = 0;
  let normalizedFourWeightVertices = 0;
  let finiteInverseBindMatrices = true;
  const skinJoints = new Set<GltfNode>();
  for (const skin of root.listSkins()) {
    skin.listJoints().forEach((joint) => skinJoints.add(joint));
    const matrices = skin.getInverseBindMatrices()?.getArray();
    if (!matrices || matrices.length !== skin.listJoints().length * 16 || [...matrices].some((value) => !finite(Number(value)))) finiteInverseBindMatrices = false;
  }
  for (const node of nodes) for (const primitive of node.getMesh()!.listPrimitives()) {
    const positions = primitive.getAttribute("POSITION")?.getArray();
    const joints = primitive.getAttribute("JOINTS_0")?.getArray();
    const weights = primitive.getAttribute("WEIGHTS_0")?.getArray();
    const count = positions ? positions.length / 3 : 0;
    vertices += count;
    if (!node.getSkin() || !joints || !weights || joints.length !== count * 4 || weights.length !== count * 4) continue;
    const jointCount = node.getSkin()!.listJoints().length;
    for (let vertex = 0; vertex < count; vertex += 1) {
      let sum = 0;
      let valid = true;
      for (let slot = 0; slot < 4; slot += 1) {
        const index = Number(joints[vertex * 4 + slot]);
        const weight = Number(weights[vertex * 4 + slot]);
        valid = valid && Number.isInteger(index) && index >= 0 && index < jointCount && finite(weight) && weight >= 0 && weight <= 1;
        sum += weight;
      }
      if (valid && Math.abs(sum - 1) <= 1e-4) normalizedFourWeightVertices += 1;
    }
  }
  const skinnedMeshNodes = nodes.filter((node) => Boolean(node.getSkin())).length;
  const compatible = canonical.size === MIXAMO_25_CORE.length
    && root.listSkins().length >= 1
    && skinnedMeshNodes === nodes.length
    && vertices > 0
    && normalizedFourWeightVertices === vertices
    && finiteInverseBindMatrices;
  return {
    version: 1,
    compatible,
    profile: DETERMINISTIC_RIG_PROFILE,
    joints: skinJoints.size,
    skins: root.listSkins().length,
    skinnedMeshNodes,
    primitives: world.primitives,
    vertices,
    normalizedFourWeightVertices,
    finiteInverseBindMatrices,
    canonicalBoneNames: [...canonical.keys()],
    boundsMeters: {
      min: world.min, max: world.max,
      width: world.max[0] - world.min[0], height: world.max[1] - world.min[1], depth: world.max[2] - world.min[2],
    },
    checks,
  };
}

export async function inspectDeterministicRig(path: string): Promise<DeterministicRigInspection> {
  const document = await io().read(path);
  return inspectDocument(document);
}

async function writeImmutable(document: Document, outputPath: string): Promise<void> {
  await stat(outputPath).then(() => { throw new Error("Rig output already exists; deterministic rig revisions are immutable."); }, () => undefined);
  await mkdir(dirname(outputPath), { recursive: true });
  const temporary = resolve(dirname(outputPath), `.${randomUUID()}.deterministic-rig.glb`);
  try {
    await writeFile(temporary, await io().writeBinary(document), { flag: "wx" });
    await rename(temporary, outputPath);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function prepareDeterministicRig(options: {
  sourcePath: string;
  outputPath: string;
  spec: AssetSpecV1;
  correctedPlacements?: BonePlacement[];
  parentRevisionSha256?: string;
  fingerprints?: {
    sourceGeometryHash: string;
    outputGeometryHash?: string;
    sourceTextureFingerprint: string;
    outputTextureFingerprint?: string;
  };
}): Promise<DeterministicRigPreparation> {
  if (!isAbsolute(options.sourcePath) || !isAbsolute(options.outputPath) || extname(options.sourcePath).toLowerCase() !== ".glb" || extname(options.outputPath).toLowerCase() !== ".glb") {
    throw new Error("Deterministic rig source and output must be absolute GLB paths.");
  }
  const sourcePath = resolve(options.sourcePath), outputPath = resolve(options.outputPath);
  if (sourcePath.toLowerCase() === outputPath.toLowerCase()) throw new Error("The approved painted source cannot be overwritten by rig preparation.");
  const info = await stat(sourcePath);
  if (!info.isFile() || info.size < 20 || info.size > MAX_SOURCE_BYTES) throw new Error("Rig source GLB size is outside the supported range.");
  const sourceBytes = await readFile(sourcePath);
  const sourceSha256 = sha256(sourceBytes);
  if (options.parentRevisionSha256 && options.parentRevisionSha256 !== sourceSha256) throw new Error("Rig preparation parent hash does not match the exact approved painted source.");
  const document = await io().readBinary(sourceBytes);
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
  if (!scene) throw new Error("Approved painted GLB contains no scene for rig preparation.");
  const nodes = baseMeshNodes(document);
  if (!nodes.length) throw new Error("Approved painted GLB contains no bindable surface mesh.");
  const classification = classifyDeterministicRig(options.spec);
  const existing = inspectDocument(document);
  if (existing.compatible) {
    const placements = MIXAMO_25_CORE.map((bone) => {
      const node = canonicalNodes(document).get(bone)!;
      const world = node.getWorldMatrix();
      return { bone, world: [Number(world[12]), Number(world[13]), Number(world[14])] as Vec3, sourceBone: node.getName(), confidence: 1 };
    });
    document.getRoot().setExtras({ ...document.getRoot().getExtras(), grudgeRigPreparation: { version: 1, route: "existing-rig", profile: DETERMINISTIC_RIG_PROFILE, sourceSha256 } });
    await writeImmutable(document, outputPath);
    const outputSha256 = sha256(await readFile(outputPath));
    return {
      version: 1, route: "existing-rig", profile: DETERMINISTIC_RIG_PROFILE, mixamo25Version: MIXAMO_25_VERSION,
      sourcePath, sourceSha256, outputPath, outputSha256, parentRevisionSha256: sourceSha256, classification,
      placements, placementMethod: "retained-canonical-joints", weightsMethod: "retained-compatible-skin", inspection: inspectDocument(document),
      ...(options.fingerprints ? {
        sourceGeometryHash: options.fingerprints.sourceGeometryHash,
        outputGeometryHash: options.fingerprints.outputGeometryHash ?? options.fingerprints.sourceGeometryHash,
        sourceTextureFingerprint: options.fingerprints.sourceTextureFingerprint,
        outputTextureFingerprint: options.fingerprints.outputTextureFingerprint ?? options.fingerprints.sourceTextureFingerprint,
      } : {}),
    };
  }
  if (document.getRoot().listSkins().length > 0 || nodes.some((node) => node.getSkin())) {
    throw new DeterministicRigReviewRequiredError("The approved model contains a partial or non-canonical skin. Review and correct it in Skeleton Studio.", classification, [{ id: "existing-skin", status: "review", detail: "A partial or foreign skin cannot be replaced automatically." }]);
  }
  if (classification.classification !== "humanoid" && !options.correctedPlacements) {
    throw new DeterministicRigReviewRequiredError(classification.rationale, classification, [{ id: "classification", status: "review", detail: classification.rationale }]);
  }
  const instances = new Map<unknown, GltfNode[]>();
  for (const node of nodes) instances.set(node.getMesh(), [...(instances.get(node.getMesh()) ?? []), node]);
  for (const meshNodes of instances.values()) {
    const transforms = meshNodes.map((node) => Array.from(node.getWorldMatrix(), (value) => Math.round(Number(value) * 1e7)).join(","));
    if (new Set(transforms).size > 1) throw new DeterministicRigReviewRequiredError("One mesh is instanced at multiple transforms; automatic weights would be ambiguous.", classification, [{ id: "mesh-instances", status: "review", detail: "Make the humanoid a single transform instance before binding." }]);
  }
  const world = collectWorldPoints(nodes);
  const corrected = Boolean(options.correctedPlacements);
  const checks = placementSafetyChecks(world.points, world.min, world.max, options.spec, corrected);
  const automaticPlacements = fitCanonicalPlacements(world.min, world.max);
  if (!corrected && checks.some((check) => check.status === "review")) {
    throw new DeterministicRigReviewRequiredError("Automatic placement could not prove a safe humanoid stance and separable limbs. Correct the fitted Mixamo-25 markers in Skeleton Studio.", classification, checks, automaticPlacements);
  }
  const placements = options.correctedPlacements ? normalizePlacements(options.correctedPlacements) : automaticPlacements;
  const fitted = placements.map((placement) => placement.world as Vec3);
  const parents = canonicalParents();
  for (let index = 1; index < fitted.length; index += 1) {
    if (Math.hypot(fitted[index][0] - fitted[parents[index]][0], fitted[index][1] - fitted[parents[index]][1], fitted[index][2] - fitted[parents[index]][2]) < MIN_SPAN) {
      throw new DeterministicRigReviewRequiredError(`Placement ${placements[index].bone} collapses onto its parent.`, classification, [...checks, { id: "joint-separation", status: "review", detail: `${placements[index].bone} must be separated from ${placements[parents[index]].bone}.` }]);
    }
  }
  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer("Deterministic rig buffer");
  const joints = fitted.map((point, index) => document.createNode(MIXAMO_25_CORE[index]).setExtras({
    grudgeDerivedGeometry: true,
    grudgeCanonicalRig: DETERMINISTIC_RIG_PROFILE,
    grudgeCanonicalJointIndex: index,
  }).setTranslation(index === 0 ? point : [point[0] - fitted[parents[index]][0], point[1] - fitted[parents[index]][1], point[2] - fitted[parents[index]][2]]));
  for (let index = 1; index < joints.length; index += 1) joints[parents[index]].addChild(joints[index]);
  scene.addChild(joints[0]);

  for (const [mesh, meshNodes] of instances) {
    const representative = meshNodes[0];
    const matrix = representative.getWorldMatrix();
    for (const primitive of (mesh as ReturnType<GltfNode["getMesh"]>)!.listPrimitives()) {
      const positions = primitive.getAttribute("POSITION")!.getArray()!;
      const indices = new Uint16Array((positions.length / 3) * 4);
      const weights = new Float32Array((positions.length / 3) * 4);
      for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
        const point = transformPoint(matrix, [Number(positions[vertex * 3]), Number(positions[vertex * 3 + 1]), Number(positions[vertex * 3 + 2])]);
        const influence = createWeights(point, fitted, parents);
        for (let slot = 0; slot < 4; slot += 1) {
          indices[vertex * 4 + slot] = influence.indices[slot];
          weights[vertex * 4 + slot] = influence.weights[slot];
        }
      }
      primitive.setAttribute("JOINTS_0", document.createAccessor("Deterministic joint indices").setType("VEC4").setArray(indices).setBuffer(buffer));
      primitive.setAttribute("WEIGHTS_0", document.createAccessor("Deterministic normalized weights").setType("VEC4").setArray(weights).setBuffer(buffer));
    }
    for (const node of meshNodes) {
      const inverseBindMatrices = new Float32Array(joints.length * 16);
      for (let index = 0; index < joints.length; index += 1) inverseBindMatrices.set(multiply4(inverse4(translationMatrix(fitted[index])), node.getWorldMatrix()), index * 16);
      const skin = document.createSkin(`Grudge deterministic ${node.getName() || "surface"} skin`)
        .setSkeleton(joints[0])
        .setInverseBindMatrices(document.createAccessor("Deterministic inverse bind matrices").setType("MAT4").setArray(inverseBindMatrices).setBuffer(buffer));
      joints.forEach((joint) => skin.addJoint(joint));
      node.setSkin(skin);
    }
  }
  document.getRoot().setExtras({
    ...document.getRoot().getExtras(),
    grudgeRigPreparation: {
      version: 1,
      route: "deterministic-cpu-rig",
      profile: DETERMINISTIC_RIG_PROFILE,
      mixamo25Version: MIXAMO_25_VERSION,
      sourceSha256,
      placementMethod: corrected ? "skeleton-studio-correction" : "canonical-proportion-fit",
      weightsMethod: DETERMINISTIC_RIG_WEIGHTS,
      classification,
      placements,
      checks,
    },
  });
  const inspection = inspectDocument(document, checks);
  if (!inspection.compatible || !inspection.finiteInverseBindMatrices || inspection.normalizedFourWeightVertices !== inspection.vertices) {
    throw new Error("Deterministic rig validation failed: the output lacks complete canonical joints, finite inverse binds or normalized four-weight coverage.");
  }
  await writeImmutable(document, outputPath);
  const outputSha256 = sha256(await readFile(outputPath));
  return {
    version: 1, route: "deterministic-cpu-rig", profile: DETERMINISTIC_RIG_PROFILE, mixamo25Version: MIXAMO_25_VERSION,
    sourcePath, sourceSha256, outputPath, outputSha256, parentRevisionSha256: sourceSha256, classification,
    placements,
    placementMethod: corrected ? "skeleton-studio-correction" : "canonical-proportion-fit",
    weightsMethod: DETERMINISTIC_RIG_WEIGHTS,
    inspection,
    ...(options.fingerprints ? {
      sourceGeometryHash: options.fingerprints.sourceGeometryHash,
      outputGeometryHash: options.fingerprints.outputGeometryHash ?? options.fingerprints.sourceGeometryHash,
      sourceTextureFingerprint: options.fingerprints.sourceTextureFingerprint,
      outputTextureFingerprint: options.fingerprints.outputTextureFingerprint ?? options.fingerprints.sourceTextureFingerprint,
    } : {}),
  };
}
