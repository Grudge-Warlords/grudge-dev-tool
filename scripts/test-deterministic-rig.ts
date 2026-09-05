import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { authorDeterministicSkeletalAnimation, applyLocalAnimationLibrary } from "../src/main/prompt3d/deterministicSkeletalAnimation";
import { classifyDeterministicRig, DeterministicRigReviewRequiredError, inspectDeterministicRig, prepareDeterministicRig } from "../src/main/prompt3d/deterministicRig";
import { inspectWorkflowGlb, validateFinishedAsset } from "../src/main/prompt3d/workflow";
import { MIXAMO_25_CORE } from "../src/shared/mixamo25";
import { PROMPT3D_SPEC_VERSION, type AssetSpecV1 } from "../src/shared/prompt3d";

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=", "base64");
const io = () => new NodeIO().registerExtensions(ALL_EXTENSIONS);
const spec = (prompt: string, category: AssetSpecV1["category"] = "character"): AssetSpecV1 => ({
  version: PROMPT3D_SPEC_VERSION, prompt, category, style: "stylized", route: "concept-image-to-3d", targetFormat: "glb",
  dimensions: { width: 1.2, height: 2, depth: 0.5, unit: "m" }, budgets: { maxTriangles: 10_000, maxTextureResolution: 2048, maxTextureBytes: 32 * 1024 ** 2 },
  seed: 99, variants: 1, providerId: "hunyuan3d-2", generateTextures: true, generateCollision: false, generateLods: false,
  coordinateContract: { upAxis: "+Y", forwardAxis: "+Z", origin: "ground-center", stableRootName: "GrudgeAssetRoot" },
});

async function createPaintedFixture(path: string): Promise<void> {
  const document = new Document();
  const buffer = document.createBuffer("Approved painted surface");
  const positions = new Float32Array([
    -0.6,0,-0.25, 0.6,0,-0.25, 0.6,2,-0.25, -0.6,2,-0.25,
    -0.6,0,0.25, 0.6,0,0.25, 0.6,2,0.25, -0.6,2,0.25,
    -0.2,0.2,0, -0.2,0.5,0, -0.2,0.8,0, 0.2,0.2,0, 0.2,0.5,0, 0.2,0.8,0,
    -0.6,1.58,0, -0.5,1.58,0, -0.4,1.58,0, 0.4,1.58,0, 0.5,1.58,0, 0.6,1.58,0,
  ]);
  const normals = new Float32Array(Array.from({length:positions.length},(_,index)=>index%3===1?1:0));
  const uv = new Float32Array(Array.from({length:positions.length/3*2},(_,index)=>index%2));
  const indices = new Uint16Array([0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5]);
  const texture = document.createTexture("Approved Hunyuan Paint texture").setImage(PNG_1X1).setMimeType("image/png");
  const material = document.createMaterial("Approved Hunyuan Paint material").setBaseColorTexture(texture);
  const primitive = document.createPrimitive()
    .setAttribute("POSITION", document.createAccessor("positions").setType("VEC3").setArray(positions).setBuffer(buffer))
    .setAttribute("NORMAL", document.createAccessor("normals").setType("VEC3").setArray(normals).setBuffer(buffer))
    .setAttribute("TEXCOORD_0", document.createAccessor("uv").setType("VEC2").setArray(uv).setBuffer(buffer))
    .setIndices(document.createAccessor("indices").setType("SCALAR").setArray(indices).setBuffer(buffer)).setMaterial(material);
  const surface = document.createNode("ApprovedPaintedSurface").setMesh(document.createMesh("ApprovedPaintedMesh").addPrimitive(primitive));
  document.getRoot().setDefaultScene(document.createScene("Approved scene").addChild(document.createNode("GrudgeAssetRoot").addChild(surface)));
  await writeFile(path, await io().writeBinary(document));
}

async function maximumBoneQuaternionChange(path: string, boneName: string): Promise<number> {
  const document = await io().read(path);
  const node = document.getRoot().listNodes().find((candidate) => candidate.getName() === boneName);
  assert.ok(node, `Expected canonical bone ${boneName}`);
  const base = node.getRotation();
  const channel = document.getRoot().listAnimations().at(-1)?.listChannels()
    .find((candidate) => candidate.getTargetNode() === node && candidate.getTargetPath() === "rotation");
  const values = channel?.getSampler()?.getOutput()?.getArray();
  assert.ok(values && values.length >= 4, `Expected animated rotations for ${boneName}`);
  let maximum = 0;
  for (let index = 0; index < values.length; index += 4) {
    const direct = Math.hypot(...[0, 1, 2, 3].map((axis) => Number(values[index + axis]) - Number(base[axis])));
    const antipodal = Math.hypot(...[0, 1, 2, 3].map((axis) => Number(values[index + axis]) + Number(base[axis])));
    maximum = Math.max(maximum, Math.min(direct, antipodal));
  }
  return maximum;
}

async function main(): Promise<void> {
  assert.equal(classifyDeterministicRig(spec("One original humanoid knight standing upright in a T-pose")).classification, "humanoid");
  assert.equal(classifyDeterministicRig(spec("One complete human standing upright, not a rabbit")).classification, "humanoid", "negated anatomy must not override the affirmative subject");
  assert.equal(classifyDeterministicRig(spec("One complete rabbit standing on four legs")).classification, "non-humanoid");
  assert.equal(classifyDeterministicRig(spec("One rabbit-like humanoid standing upright")).classification, "ambiguous", "mixed body plans must fail closed");
  assert.equal(classifyDeterministicRig(spec("One complete stylized character")).classification, "ambiguous");
  assert.equal(classifyDeterministicRig(spec("One complete sword", "prop")).classification, "rigid-object");

  const workspace = await mkdtemp(join(tmpdir(), "grudge-deterministic-rig-"));
  try {
    const source = join(workspace, "approved-painted.glb");
    const rigged = join(workspace, "prepared-rig.glb");
    const animated = join(workspace, "animated.glb");
    await createPaintedFixture(source);
    const sourceInspection = await inspectWorkflowGlb(source);
    const sourceSha256 = createHash("sha256").update(await readFile(source)).digest("hex");
    const prepared = await prepareDeterministicRig({
      sourcePath: source, outputPath: rigged, parentRevisionSha256: sourceSha256,
      spec: spec("One original humanoid knight standing upright in a T-pose with arms spread and feet apart"),
      fingerprints: { sourceGeometryHash: sourceInspection.geometryHash, sourceTextureFingerprint: sourceInspection.textureFingerprint },
    });
    assert.equal(prepared.route, "deterministic-cpu-rig");
    assert.equal(prepared.placements.length, MIXAMO_25_CORE.length);
    assert.equal(prepared.inspection.normalizedFourWeightVertices, prepared.inspection.vertices);
    assert.equal(prepared.outputGeometryHash, sourceInspection.geometryHash);
    assert.equal(prepared.outputTextureFingerprint, sourceInspection.textureFingerprint);
    const rigInspection = await inspectDeterministicRig(rigged);
    assert.equal(rigInspection.compatible, true);
    assert.equal(rigInspection.canonicalBoneNames.length, 22);
    await assert.rejects(() => prepareDeterministicRig({ sourcePath: source, outputPath: rigged, spec: spec("One humanoid standing upright in a T-pose") }), /immutable/i);

    const motion = await authorDeterministicSkeletalAnimation({ sourcePath: rigged, outputPath: animated, instruction: "Walk naturally in place; do not move forward", seed: 1001, mode: "replace" });
    assert.equal(motion.boneRotationChannels, 22);
    assert.ok(motion.pathDisplacementMeters < 1e-6, "in-place and negated travel must not produce root displacement");
    const animatedInspection = await inspectWorkflowGlb(animated);
    assert.equal(animatedInspection.geometryHash, sourceInspection.geometryHash);
    assert.equal(animatedInspection.textureFingerprint, sourceInspection.textureFingerprint);
    assert.equal(animatedInspection.skins, 1);
    assert.equal(animatedInspection.boneRotationChannels, 22);
    const validation = await validateFinishedAsset(rigged, animated, "animation", { operators: motion.operators, pathDisplacementMeters: motion.pathDisplacementMeters, skeletalRequired: true });
    assert.equal(validation.sourceGeometryPreserved, true);

    const negatedMotionPath = join(workspace, "negated-motion.glb");
    const negatedMotion = await authorDeterministicSkeletalAnimation({
      sourcePath: rigged,
      outputPath: negatedMotionPath,
      instruction: "Do not walk or flap; wave one hand while remaining in place, with no attack and without dancing",
      seed: 1003,
      mode: "replace",
    });
    assert.equal(negatedMotion.plan.intent.groundedGait, false);
    assert.equal(negatedMotion.plan.intent.flapping, false);
    assert.deepEqual(negatedMotion.plan.skeletalActions, ["wave"]);
    assert.ok(negatedMotion.pathDisplacementMeters < 1e-6);
    assert.ok(await maximumBoneQuaternionChange(negatedMotionPath, "LeftUpLeg") < 0.02, "negated gait words must not create a leg cycle");

    const reviewPath = join(workspace, "review.glb");
    let review: DeterministicRigReviewRequiredError | null = null;
    try { await prepareDeterministicRig({ sourcePath: source, outputPath: reviewPath, spec: spec("One complete stylized character") }); }
    catch (error) { if (error instanceof DeterministicRigReviewRequiredError) review = error; else throw error; }
    assert.ok(review);
    assert.equal(review.suggestedPlacements.length, 0, "ambiguous metadata must stop before implying a humanoid placement");

    const unsafePath = join(workspace, "unsafe-review.glb");
    let unsafe: DeterministicRigReviewRequiredError | null = null;
    try { await prepareDeterministicRig({ sourcePath: source, outputPath: unsafePath, spec: spec("One complete humanoid knight") }); }
    catch (error) { if (error instanceof DeterministicRigReviewRequiredError) unsafe = error; else throw error; }
    assert.ok(unsafe);
    assert.equal(unsafe.suggestedPlacements.length, 22);
    await assert.rejects(
      () => prepareDeterministicRig({ sourcePath: source, outputPath: join(workspace, "negated-stance.glb"), spec: spec("One complete human character that must not be standing") }),
      (error: unknown) => error instanceof DeterministicRigReviewRequiredError
        && error.checks.some((check) => check.id === "stance-context" && check.status === "review"),
      "a negated stance must not authorize automatic bone placement",
    );
    const correctedPath = join(workspace, "corrected-rig.glb");
    const corrected = await prepareDeterministicRig({ sourcePath: source, outputPath: correctedPath, spec: spec("One complete humanoid knight"), correctedPlacements: unsafe.suggestedPlacements, parentRevisionSha256: sourceSha256 });
    assert.equal(corrected.placementMethod, "skeleton-studio-correction");

    const library = join(workspace, "library");
    await mkdir(library);
    await writeFile(join(library, "rest.glb"), await readFile(animated));
    await writeFile(join(library, "anim-library-manifest.json"), JSON.stringify({ version: 2, skeleton: "mixamo-25", restGlb: "rest.glb" }));
    const libraryOutput = join(workspace, "library-output.glb");
    const retargeted = await applyLocalAnimationLibrary({ sourcePath: correctedPath, outputPath: libraryOutput, instruction: "Walk forward one metre and return to origin", seed: 1002, packDir: library, mode: "replace" });
    assert.equal(retargeted.route, "local-animation-library");
    assert.equal(retargeted.boneRotationChannels, 22);
    assert.ok(retargeted.pathDisplacementMeters > 0.1);
    assert.equal((await inspectWorkflowGlb(libraryOutput)).geometryHash, sourceInspection.geometryHash);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
  console.log("deterministic CPU rig, correction, skeletal motion and local-library retarget tests passed");
}

void main();
