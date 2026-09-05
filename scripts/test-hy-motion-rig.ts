import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { analyzeHyMotionCompatibility } from "../src/main/prompt3d/hyMotionCompatibility";
import {
  bindHyMotionToGlb,
  HY_MOTION_MODEL_REVISION,
  HY_MOTION_SOURCE_REVISION,
  hyMotionRigCompatibility,
  type HyMotionCompatibilityDecision,
} from "../src/main/prompt3d/hyMotionRig";
import { inspectWorkflowGlb, validateFinishedAsset } from "../src/main/prompt3d/workflow";
import { MIXAMO_25_CORE } from "../src/shared/mixamo25";
import { PROMPT3D_SPEC_VERSION, type AssetSpecV1, type Prompt3DSelectedExecutionProfile } from "../src/shared/prompt3d";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=",
  "base64",
);

const parents = [-1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19];
const appRestJoints = [
  [0, 1, 0], [-0.14, 0.92, 0], [0.14, 0.92, 0], [0, 1.18, 0],
  [-0.14, 0.52, 0.01], [0.14, 0.52, 0.01], [0, 1.38, 0],
  [-0.14, 0.1, -0.02], [0.14, 0.1, -0.02], [0, 1.58, 0],
  [-0.14, 0.02, 0.14], [0.14, 0.02, 0.14], [0, 1.77, 0],
  [-0.2, 1.64, 0], [0.2, 1.64, 0], [0, 1.96, 0],
  [-0.46, 1.62, 0], [0.46, 1.62, 0], [-0.7, 1.57, 0], [0.7, 1.57, 0],
  [-0.9, 1.52, 0], [0.9, 1.52, 0],
];
const cpuExecution: Prompt3DSelectedExecutionProfile = {
  id: "hy-motion-cpu-basic-v1", label: "CPU · basic quality fallback", device: "cpu",
  minimumTotalVramBytes: 0, minimumFreeVramBytes: 0,
  minimumSystemRamBytes: 32 * 1024 ** 3, minimumFreeSystemRamBytes: 24 * 1024 ** 3,
  validationSteps: 12, tradeoff: "fixture",
};
const cudaExecution: Prompt3DSelectedExecutionProfile = {
  id: "hy-motion-cuda-standard-v1", label: "GPU · standard quality", device: "cuda",
  minimumTotalVramBytes: 24 * 1024 ** 3, minimumFreeVramBytes: 20 * 1024 ** 3,
  minimumSystemRamBytes: 32 * 1024 ** 3, minimumFreeSystemRamBytes: 8 * 1024 ** 3,
  tradeoff: "fixture",
  gpu: { index: 1, uuid: "GPU-12345678-abcd-4321-abcd-123456789abc", model: "Fixture GPU", totalVramBytes: 24 * 1024 ** 3, freeVramBytes: 22 * 1024 ** 3 },
};

const spec: AssetSpecV1 = {
  version: PROMPT3D_SPEC_VERSION,
  prompt: "One complete original humanoid game character, standing upright in a neutral pose",
  category: "character",
  style: "stylized",
  route: "concept-image-to-3d",
  targetFormat: "glb",
  dimensions: { width: 1.2, height: 2, depth: 0.5, unit: "m" },
  scaleMode: "exact",
  budgets: { maxTriangles: 10_000, maxTextureResolution: 2048, maxTextureBytes: 32 * 1024 ** 2 },
  seed: 71,
  variants: 1,
  providerId: "hunyuan3d-2",
  generateTextures: true,
  generateCollision: false,
  generateLods: false,
  coordinateContract: { upAxis: "+Y", forwardAxis: "+Z", origin: "ground-center", stableRootName: "GrudgeAssetRoot" },
};

function io(): NodeIO {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS);
}

async function createTexturedHumanoid(path: string): Promise<void> {
  const document = new Document();
  const buffer = document.createBuffer("Approved Hunyuan buffer");
  const positions = new Float32Array([
    -0.6, 0, -0.25, 0.6, 0, -0.25, 0.6, 2, -0.25, -0.6, 2, -0.25,
    -0.6, 0, 0.25, 0.6, 0, 0.25, 0.6, 2, 0.25, -0.6, 2, 0.25,
  ]);
  const normals = new Float32Array([
    -0.57, -0.57, -0.57, 0.57, -0.57, -0.57, 0.57, 0.57, -0.57, -0.57, 0.57, -0.57,
    -0.57, -0.57, 0.57, 0.57, -0.57, 0.57, 0.57, 0.57, 0.57, -0.57, 0.57, 0.57,
  ]);
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint16Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
    3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
  ]);
  const texture = document.createTexture("Approved Hunyuan Paint texture").setImage(PNG_1X1).setMimeType("image/png");
  const material = document.createMaterial("Approved Hunyuan Paint material").setBaseColorTexture(texture).setRoughnessFactor(0.55);
  const primitive = document.createPrimitive()
    .setAttribute("POSITION", document.createAccessor("positions").setType("VEC3").setArray(positions).setBuffer(buffer))
    .setAttribute("NORMAL", document.createAccessor("normals").setType("VEC3").setArray(normals).setBuffer(buffer))
    .setAttribute("TEXCOORD_0", document.createAccessor("uv").setType("VEC2").setArray(uv).setBuffer(buffer))
    .setIndices(document.createAccessor("indices").setType("SCALAR").setArray(indices).setBuffer(buffer))
    .setMaterial(material);
  const meshNode = document.createNode("ApprovedHunyuanSurface").setMesh(document.createMesh("Approved Hunyuan mesh").addPrimitive(primitive));
  const stableRoot = document.createNode("GrudgeAssetRoot").addChild(meshNode);
  document.getRoot().setDefaultScene(document.createScene("Approved scene").addChild(stableRoot));
  document.getRoot().getAsset().generator = "Signed Hunyuan fixture surface";
  await writeFile(path, await io().writeBinary(document));
}

function rotationX(angle: number): number[][] {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
}

function rotationZ(angle: number): number[][] {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

async function writeMotion(
  path: string,
  prompt: string,
  seed: number,
  compatibility: HyMotionCompatibilityDecision,
  executionProfile: Prompt3DSelectedExecutionProfile,
): Promise<void> {
  const frames = 31;
  const rotations = Array.from({ length: frames }, (_, frame) => {
    const phase = Math.sin(frame / (frames - 1) * Math.PI * 2);
    return Array.from({ length: 22 }, (_, joint) => {
      if (joint === 4 || joint === 5) return rotationX((joint === 4 ? 1 : -1) * phase * 0.55);
      if (joint === 16 || joint === 17) return rotationZ((joint === 16 ? 1 : -1) * phase * 0.35);
      return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    });
  });
  const rootTranslations = Array.from({ length: frames }, (_, frame) => {
    const progress = frame / (frames - 1);
    return [0.3 * progress, 0.04 * Math.sin(progress * Math.PI * 2), 0.2 * progress];
  });
  await writeFile(path, JSON.stringify({
    version: 1,
    providerId: "hy-motion-1",
    providerModel: "hy-motion-1.0-lite",
    sourceRevision: HY_MOTION_SOURCE_REVISION,
    modelRevision: HY_MOTION_MODEL_REVISION,
    createdAt: new Date().toISOString(),
    prompt,
    promptSha256: createHash("sha256").update(prompt).digest("hex"),
    seed,
    duration: 1,
    fps: 30,
    frames,
    cfgScale: 5,
    executionProfile: {
      id: executionProfile.id,
      device: executionProfile.device,
      validationSteps: executionProfile.validationSteps ?? null,
      gpuUuid: executionProfile.gpu?.uuid ?? null,
    },
    coordinateSystem: { upAxis: "+Y", forwardAxis: "+Z", handedness: "right" },
    jointNames: Array.from({ length: 22 }, (_, index) => `SMPL-${index}`),
    parents,
    restJoints: appRestJoints,
    localRotationMatrices: rotations,
    rootTranslations,
    compatibility,
    upstreamPreviewGeometryRetained: false,
  }));
}

function rootTranslationValues(document: Document, animationIndex: number): Float32Array {
  const animation = document.getRoot().listAnimations()[animationIndex];
  const channel = animation.listChannels().find((candidate) => candidate.getTargetPath() === "translation" && candidate.getTargetNode()?.getName() === "Hips");
  assert.ok(channel, "generated animation must contain the Hips root-translation channel");
  return channel.getSampler()!.getOutput()!.getArray() as Float32Array;
}

async function testSemanticGate(): Promise<void> {
  const stationary = await analyzeHyMotionCompatibility(spec, "Walk naturally in place; do not move forward", async (system, prompt) => {
    assert.match(system, /Read negation literally/);
    assert.match(prompt, /do not move forward/);
    return { model: "fixture-planner", proposal: {
      classification: "humanoid", rootTranslation: "stationary", subject: "one humanoid character",
      negations: ["do not move forward"], rationale: "The action is explicitly in place.",
    } };
  });
  assert.equal(stationary.rootTranslation, "stationary");
  assert.deepEqual(stationary.negations, ["do not move forward"]);

  await assert.rejects(() => analyzeHyMotionCompatibility(
    { ...spec, prompt: "One complete rabbit" },
    "Hop forward several times",
    async () => ({ model: "fixture-planner", proposal: {
      classification: "non-humanoid", rootTranslation: "directional", subject: "rabbit",
      negations: [], rationale: "A rabbit cannot use the supported human skeleton.",
    } }),
  ), /unsupported-motion-rig.*human\/humanoid skeletons only/i);

  await assert.rejects(() => analyzeHyMotionCompatibility(spec, "Move forward but do not move forward", async () => ({
    model: "fixture-planner", proposal: {
      classification: "humanoid", rootTranslation: "ambiguous", subject: "one humanoid character",
      negations: ["do not move forward"], rationale: "Affirmative and negative travel instructions conflict.",
    },
  })), /motion-direction-review-required/i);
}

async function main(): Promise<void> {
  await testSemanticGate();
  assert.deepEqual(hyMotionRigCompatibility().canonicalBones, MIXAMO_25_CORE);
  assert.equal(hyMotionRigCompatibility().sourceBones.length, 22);

  const workspace = await mkdtemp(join(tmpdir(), "grudge-hy-motion-rig-"));
  try {
    const sourcePath = join(workspace, "approved-textured.glb");
    const stationaryMotionPath = join(workspace, "stationary-motion.json");
    const stationaryPath = join(workspace, "stationary.glb");
    const directionalMotionPath = join(workspace, "directional-motion.json");
    const directionalPath = join(workspace, "directional.glb");
    await createTexturedHumanoid(sourcePath);
    const sourceInspection = await inspectWorkflowGlb(sourcePath);

    const stationaryPrompt = "Walk naturally in place with alternating grounded steps; do not move forward";
    const stationaryDecision: HyMotionCompatibilityDecision = {
      version: 1, classification: "humanoid", rootTranslation: "stationary",
      rationale: "The prompt explicitly requires motion in place.", provider: "offline-test-fixture", model: "signed-focused-fixture",
    };
    await writeMotion(stationaryMotionPath, stationaryPrompt, 901, stationaryDecision, cpuExecution);
    const stationary = await bindHyMotionToGlb({
      sourcePath, outputPath: stationaryPath, motionPath: stationaryMotionPath,
      prompt: stationaryPrompt, seed: 901, mode: "replace", spec, expectedCompatibility: stationaryDecision, expectedExecutionProfile: cpuExecution,
    });
    assert.equal(stationary.executionProfile.id, "hy-motion-cpu-basic-v1");
    assert.equal(stationary.executionProfile.validationSteps, 12);
    assert.equal(stationary.bindingMethod, "nearest-bone-segment-four-weight-v1");
    assert.equal(stationary.horizontalRootMotion, "removed-stationary");
    assert.equal(stationary.skins, 1);
    assert.equal(stationary.joints, 22);
    assert.equal(stationary.boneRotationChannels, 22);
    const stationaryInspection = await inspectWorkflowGlb(stationaryPath);
    assert.equal(stationaryInspection.geometryHash, sourceInspection.geometryHash, "rigging must retain approved Hunyuan geometry identity");
    assert.equal(stationaryInspection.textureFingerprint, sourceInspection.textureFingerprint, "rigging must retain approved Hunyuan Paint data");
    assert.equal(stationaryInspection.skins, 1);
    assert.equal(stationaryInspection.joints, 22);
    assert.equal(stationaryInspection.skinnedMeshNodes, 1);
    assert.equal(stationaryInspection.boneRotationChannels, 22);
    const stationaryValidation = await validateFinishedAsset(sourcePath, stationaryPath, "animation", {
      operators: ["hy-motion-text-conditioned-diffusion", "grudge-mixamo25-v2-skin-binding"],
      pathDisplacementMeters: stationary.pathDisplacementMeters,
      skeletalRequired: true,
    });
    assert.equal(stationaryValidation.sourceGeometryPreserved, true);

    const stationaryDocument = await io().read(stationaryPath);
    const stationaryRoot = rootTranslationValues(stationaryDocument, 0);
    for (let index = 0; index < stationaryRoot.length; index += 3) {
      assert.ok(Math.abs(stationaryRoot[index] - stationaryRoot[0]) < 1e-6, "stationary prompt must strip generated X travel");
      assert.ok(Math.abs(stationaryRoot[index + 2] - stationaryRoot[2]) < 1e-6, "stationary prompt must strip generated Z travel");
    }
    assert.ok(Array.from(stationaryRoot).some((value, index) => index % 3 === 1 && Math.abs(value - stationaryRoot[1]) > 1e-4), "stationary skeletal action may retain generated vertical body movement");
    for (const primitive of stationaryDocument.getRoot().listMeshes()[0].listPrimitives()) {
      const weights = primitive.getAttribute("WEIGHTS_0")?.getArray() as Float32Array;
      const jointIndices = primitive.getAttribute("JOINTS_0")?.getArray() as Uint16Array;
      assert.equal(weights.length, jointIndices.length);
      for (let vertex = 0; vertex < weights.length / 4; vertex += 1) {
        const sum = weights.slice(vertex * 4, vertex * 4 + 4).reduce((total, value) => total + value, 0);
        assert.ok(Math.abs(sum - 1) < 1e-5, "every vertex must have normalized skin weights");
        assert.ok(Math.max(...jointIndices.slice(vertex * 4, vertex * 4 + 4)) < 22);
      }
    }

    const directionalPrompt = "Walk naturally while travelling forward for one metre";
    const directionalDecision: HyMotionCompatibilityDecision = {
      ...stationaryDecision, rootTranslation: "directional", rationale: "Forward travel is affirmatively requested.",
    };
    await writeMotion(directionalMotionPath, directionalPrompt, 902, directionalDecision, cudaExecution);
    const directional = await bindHyMotionToGlb({
      sourcePath: stationaryPath, outputPath: directionalPath, motionPath: directionalMotionPath,
      prompt: directionalPrompt, seed: 902, mode: "append", spec, expectedCompatibility: directionalDecision, expectedExecutionProfile: cudaExecution,
    });
    assert.equal(directional.executionProfile.gpuUuid, cudaExecution.gpu?.uuid);
    assert.equal(directional.bindingMethod, "retained-grudge-mixamo25-v2");
    assert.equal(directional.horizontalRootMotion, "generated-directional");
    assert.ok(directional.pathDisplacementMeters > 0.2);
    const directionalInspection = await inspectWorkflowGlb(directionalPath);
    assert.equal(directionalInspection.animations.length, 2, "append must retain the approved prior clip");
    assert.equal(directionalInspection.geometryHash, sourceInspection.geometryHash);
    assert.equal(directionalInspection.textureFingerprint, sourceInspection.textureFingerprint);
    assert.equal(directionalInspection.boneRotationChannels, 44);
    const directionalDocument = await io().read(directionalPath);
    const directionalRoot = rootTranslationValues(directionalDocument, 1);
    assert.ok(Array.from(directionalRoot).some((value, index) => index % 3 !== 1 && Math.abs(value - directionalRoot[index % 3]) > 0.1), "explicit direction must retain generated horizontal root travel");

    await assert.rejects(() => bindHyMotionToGlb({
      sourcePath, outputPath: join(workspace, "mismatch.glb"), motionPath: directionalMotionPath,
      prompt: directionalPrompt, seed: 902, mode: "replace", spec, expectedCompatibility: stationaryDecision, expectedExecutionProfile: cudaExecution,
    }), /changed its retained compatibility decision/);
    await assert.rejects(() => bindHyMotionToGlb({
      sourcePath, outputPath: join(workspace, "profile-mismatch.glb"), motionPath: directionalMotionPath,
      prompt: directionalPrompt, seed: 902, mode: "replace", spec, expectedCompatibility: directionalDecision, expectedExecutionProfile: cpuExecution,
    }), /changed its measured execution profile/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
  console.log("HY-Motion local skeleton, skin binding, prompt gate and retention tests passed.");
}

void main();
