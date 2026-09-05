import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { validatePrompt3DGlb } from "../src/main/prompt3d/validation";
import {
  authorPromptedAnimation,
  compilePromptedAnimation,
  scaledPromptedAnimationOverrides,
} from "../src/main/prompt3d/promptedAnimation";
import { analyzePromptedMotionIntent } from "../src/shared/promptedMotionIntent";
import { analyzeMotionPromptLocally } from "../src/main/prompt3d/motionSemanticPlanner";
import { PROMPT3D_SPEC_VERSION, type AssetSpecV1 } from "../src/shared/prompt3d";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=",
  "base64",
);

function testIO(): NodeIO {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS);
}

async function createTexturedSource(path: string): Promise<void> {
  const document = new Document();
  const buffer = document.createBuffer("Source buffer");
  const positions = new Float32Array([
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, -0.5, -0.5, 1, -0.5,
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0.5, -0.5, 1, 0.5,
    0, 0.5, 0, 0, 0.25, 0,
  ]);
  const normals = new Float32Array([
    -0.577, -0.577, -0.577, 0.577, -0.577, -0.577, 0.577, 0.577, -0.577, -0.577, 0.577, -0.577,
    -0.577, -0.577, 0.577, 0.577, -0.577, 0.577, 0.577, 0.577, 0.577, -0.577, 0.577, 0.577,
    0, 1, 0, 0, 1, 0,
  ]);
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5, 0.5, 0.25]);
  const indices = new Uint16Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2,
    0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
  ]);
  const texture = document.createTexture("Source texture").setImage(PNG_1X1).setMimeType("image/png");
  const material = document.createMaterial("Source material").setBaseColorTexture(texture).setRoughnessFactor(0.6);
  const primitive = document.createPrimitive()
    .setAttribute("POSITION", document.createAccessor("Source positions").setType("VEC3").setArray(positions).setBuffer(buffer))
    .setAttribute("NORMAL", document.createAccessor("Source normals").setType("VEC3").setArray(normals).setBuffer(buffer))
    .setAttribute("TEXCOORD_0", document.createAccessor("Source UV").setType("VEC2").setArray(uv).setBuffer(buffer))
    .setIndices(document.createAccessor("Source indices").setType("SCALAR").setArray(indices).setBuffer(buffer))
    .setMaterial(material);
  const mesh = document.createMesh("Source generated mesh").addPrimitive(primitive);
  const meshNode = document.createNode("SourceMeshNode").setMesh(mesh);
  const stableRoot = document.createNode("GrudgeAssetRoot").addChild(meshNode);
  const scene = document.createScene("Source scene").addChild(stableRoot);
  document.getRoot().setDefaultScene(scene);

  const prior = document.createAnimation("Existing clip");
  const priorTimes = document.createAccessor("Existing times").setType("SCALAR").setArray(new Float32Array([0, 1])).setBuffer(buffer);
  const priorValues = document.createAccessor("Existing values").setType("VEC3").setArray(new Float32Array([0, 0, 0, 0, 0.1, 0])).setBuffer(buffer);
  const priorSampler = document.createAnimationSampler("Existing sampler").setInput(priorTimes).setOutput(priorValues).setInterpolation("LINEAR");
  const priorChannel = document.createAnimationChannel("Existing channel").setSampler(priorSampler).setTargetNode(stableRoot).setTargetPath("translation");
  prior.addSampler(priorSampler).addChannel(priorChannel);
  const asset = document.getRoot().getAsset();
  asset.generator = "Focused generated test source";
  asset.extras = { grudgePrompt3D: { provider: "hunyuan3d-2.1", sourceGeometry: true, upAxis: "+Y", forwardAxis: "+Z", origin: "ground-center" } };
  await writeFile(path, await testIO().writeBinary(document));
}

const validationSpec: AssetSpecV1 = {
  version: PROMPT3D_SPEC_VERSION,
  prompt: "One complete isolated generated test object",
  category: "prop",
  style: "stylized",
  route: "concept-image-to-3d",
  targetFormat: "glb",
  dimensions: { width: 1, height: 1, depth: 1, unit: "m" },
  scaleMode: "exact",
  budgets: { maxTriangles: 10_000, maxTextureResolution: 2048, maxTextureBytes: 32 * 1024 ** 2 },
  seed: 7,
  variants: 1,
  providerId: "hunyuan3d-2",
  generateTextures: true,
  generateCollision: false,
  generateLods: false,
  coordinateContract: { upAxis: "+Y", forwardAxis: "+Z", origin: "ground-center", stableRootName: "GrudgeAssetRoot" },
};

function parseGlbJson(bytes: Buffer): Record<string, any> {
  assert.equal(bytes.toString("ascii", 0, 4), "glTF");
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength).trim());
}

function glbWithExternalImage(bytes: Buffer): Buffer {
  const jsonLength = bytes.readUInt32LE(12);
  const json = parseGlbJson(bytes);
  assert.ok(Array.isArray(json.images) && json.images.length > 0);
  json.images[0] = { uri: "https://example.invalid/external.png" };
  const encoded = Buffer.from(JSON.stringify(json), "utf8");
  const paddedLength = Math.ceil(encoded.length / 4) * 4;
  const jsonChunk = Buffer.alloc(paddedLength, 0x20);
  encoded.copy(jsonChunk);
  const remainingChunks = bytes.subarray(20 + jsonLength);
  const output = Buffer.alloc(12 + 8 + jsonChunk.length + remainingChunks.length);
  output.write("glTF", 0, "ascii");
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(jsonChunk.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(output, 20);
  remainingChunks.copy(output, 20 + jsonChunk.length);
  return output;
}

function assertEmbeddedGlb(bytes: Buffer): void {
  const json = parseGlbJson(bytes);
  for (const resource of [...(json.buffers ?? []), ...(json.images ?? [])]) assert.equal(resource.uri, undefined);
}

async function main(): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), "grudge-prompt-motion-"));
  try {
    const sourcePath = join(workspace, "source.glb");
    const appendPath = join(workspace, "append.glb");
    const appendRepeatPath = join(workspace, "append-repeat.glb");
    const replacePath = join(workspace, "replace.glb");
    const shootingStarPath = join(workspace, "shooting-star.glb");
    const articulatedPath = join(workspace, "articulated.glb");
    const rabbitHopPath = join(workspace, "rabbit-hop.glb");
    const snakeSlitherPath = join(workspace, "snake-slither.glb");
    const rearWavePath = join(workspace, "rear-wave.glb");
    const birdFlightPath = join(workspace, "bird-flight.glb");
    const walkingInPlacePath = join(workspace, "walking-in-place.glb");
    const bodyPromptRegressionPath = join(workspace, "body-prompt-regression.glb");
    const synchronizedCounterbalancePath = join(workspace, "synchronized-counterbalance.glb");
    const returnPath = join(workspace, "return-path.glb");
    const externalPath = join(workspace, "external.glb");
    await createTexturedSource(sourcePath);

    const inPlaceWalk = compilePromptedAnimation("Walk naturally in place with alternating grounded steps");
    assert.equal(inPlaceWalk.rootPath, "stationary", "walking alone must not imply world-space travel");
    assert.equal(inPlaceWalk.placement, "in-place");
    assert.equal(inPlaceWalk.travelMeters, 0);
    assert.deepEqual(inPlaceWalk.deformations, ["grounded-stride"]);
    assert.equal(compilePromptedAnimation("Swim naturally with a smooth body wave").rootPath, "stationary", "swimming alone must stay in place");
    assert.equal(compilePromptedAnimation("Slither realistically with six smooth waves").rootPath, "stationary", "slithering alone must stay in place");
    assert.equal(compilePromptedAnimation("Fly while flapping both wings").rootPath, "stationary", "flying alone must stay in place");
    const verticalHop = compilePromptedAnimation("Hop twice");
    assert.equal(verticalHop.rootPath, "vertical-hop", "an undirected hop may rise and land without horizontal travel");
    assert.equal(verticalHop.placement, "vertical-in-place");
    assert.throws(() => compilePromptedAnimation("Hop twice", { orientToPath: true }), /horizontal travel/i);
    const negatedTravel = compilePromptedAnimation("Do not move forward; walk naturally in place");
    assert.equal(negatedTravel.rootPath, "stationary", "a negated direction must not be read as requested travel");
    assert.equal(analyzePromptedMotionIntent(negatedTravel.instruction).negatedDirectionalMotion, true);
    const reportedRabbitPrompt = "short walking movement forward. no significant vertical elevation. forelegs stretched forward then hind legs hopping to bring the rabbit to the new aligned forward position";
    const correctedRabbit = compilePromptedAnimation(reportedRabbitPrompt);
    assert.equal(correctedRabbit.rootPath, "linear", "walking must remain the primary travel style when a limb description later mentions hopping");
    assert.deepEqual(correctedRabbit.deformations, ["grounded-stride"], "the reported rabbit prompt must animate grounded limb regions instead of sliding a rigid mesh");
    assert.equal(analyzePromptedMotionIntent(reportedRabbitPrompt).verticalMotionSuppressed, true, "the explicit low-elevation constraint must suppress a hop arc");
    const rabbitScale = scaledPromptedAnimationOverrides({ ...validationSpec, dimensions: { width: 0.15, height: 0.25, depth: 0.4, unit: "m" } }, reportedRabbitPrompt);
    assert.ok(Math.abs((rabbitScale.travelMeters ?? 0) - 0.6) < 1e-9, "short travel must scale to the subject rather than defaulting to three metres");
    assert.ok(Math.abs((rabbitScale.hopHeightMeters ?? 0) - 0.0875) < 1e-9, "hop height must scale to the subject");
    const rightFacingCreatureSpec: AssetSpecV1 = {
      ...validationSpec,
      category: "character",
      objectRules: { type: "creature", component: "whole" },
    };
    const creatureForwardOverrides = scaledPromptedAnimationOverrides(rightFacingCreatureSpec, "Walk forward 0.6 metres with four low grounded alternating strides");
    const creatureForward = compilePromptedAnimation("Walk forward 0.6 metres with four low grounded alternating strides", creatureForwardOverrides);
    assert.equal(analyzePromptedMotionIntent(creatureForward.instruction).subjectRelativeDirection, true);
    assert.deepEqual(creatureForward.pathDirection, [1, 0, 0], "subject-relative forward travel must follow the generic right-facing creature presentation contract");
    const creatureBackward = compilePromptedAnimation("Walk backward 0.6 metres with four low grounded alternating strides", scaledPromptedAnimationOverrides(rightFacingCreatureSpec, "Walk backward 0.6 metres with four low grounded alternating strides"));
    assert.deepEqual(creatureBackward.pathDirection, [-1, 0, 0], "subject-relative backward travel must oppose the generic right-facing creature presentation contract");
    const creatureExplicitLeft = compilePromptedAnimation("Walk leftward 0.6 metres with four low grounded alternating strides", scaledPromptedAnimationOverrides(rightFacingCreatureSpec, "Walk leftward 0.6 metres with four low grounded alternating strides"));
    assert.deepEqual(creatureExplicitLeft.pathDirection, [-1, 0, 0], "explicit world-space directions must not be remapped");
    const propForward = compilePromptedAnimation("Move forward 0.6 metres", scaledPromptedAnimationOverrides(validationSpec, "Move forward 0.6 metres"));
    assert.deepEqual(propForward.pathDirection, [0, 0, 1], "non-creature assets must retain the canonical engine-forward contract");
    assert.throws(
      () => compilePromptedAnimation("Move forward 0.6 metres", scaledPromptedAnimationOverrides(rightFacingCreatureSpec, "Move forward 0.6 metres")),
      /only whole-model travel.*visible body motion/i,
      "a creature must not be accepted as an animation when the plan is only a rigid translation",
    );
    const reportedBodyPrompt = "movement animation. body should bend down, paws touch the ground then legs/feet move forward in a curve before the kangaroo returns to the original position.";
    const reportedBodyIntent = analyzePromptedMotionIntent(reportedBodyPrompt);
    assert.equal(reportedBodyIntent.directionalTravel, false, "body-local down/forward clauses must not become root travel");
    assert.equal(reportedBodyIntent.returnToOrigin, true);
    assert.equal(reportedBodyIntent.crouching, true);
    assert.equal(reportedBodyIntent.bodyRelativeDirection, 1);
    const reportedBodyPlan = compilePromptedAnimation(reportedBodyPrompt, scaledPromptedAnimationOverrides(rightFacingCreatureSpec, reportedBodyPrompt));
    assert.equal(reportedBodyPlan.rootPath, "stationary");
    assert.deepEqual(reportedBodyPlan.pathDirection, [1, 0, 0], "body-local forward must follow the retained right-facing creature pose without becoming root translation");
    assert.ok(reportedBodyPlan.deformations.includes("grounded-stride"));
    assert.ok(reportedBodyPlan.deformations.includes("body-crouch"));
    const reportedIgnoredPrompt = "walking while moving forward with feet moving together to bending to a 45 degree angle and tail used for balance.";
    const retainedKangarooSpec: AssetSpecV1 = { ...rightFacingCreatureSpec, dimensions: { width: 0.8, height: 1.8, depth: 1.6, unit: "m" } };
    const preciseIntent = analyzePromptedMotionIntent(reportedIgnoredPrompt);
    assert.equal(preciseIntent.synchronizedLimbs, true);
    assert.equal(preciseIntent.limbFlexion, true);
    assert.equal(preciseIntent.articulationAngleDegrees, 45);
    assert.equal(preciseIntent.counterbalance, true);
    const precisePlan = compilePromptedAnimation(reportedIgnoredPrompt, scaledPromptedAnimationOverrides(retainedKangarooSpec, reportedIgnoredPrompt), 9031324);
    assert.equal(precisePlan.rootPath, "linear");
    assert.equal(precisePlan.gaitSynchronization, "together");
    assert.ok(Math.abs(precisePlan.articulationRadians - Math.PI / 4) < 1e-9);
    assert.deepEqual(precisePlan.deformations, ["synchronous-bound", "rear-counterbalance"]);
    assert.ok(precisePlan.operators.includes("coordination:together"));
    assert.ok(precisePlan.operators.includes("constraint:articulation-angle:45.000"));
    assert.ok(precisePlan.requirementCoverage.some((entry) => entry.requirement === "paired lower limbs move together" && entry.representedBy === "coordination:together"));
    assert.ok(precisePlan.requirementCoverage.some((entry) => entry.requirement === "rear appendage provides counterbalance" && entry.representedBy === "deformation:rear-counterbalance"));
    assert.ok(Math.abs(precisePlan.travelMeters - 2) < 1e-9, "unspecified travel must remain close to the 1.6 m subject scale instead of silently translating it 4.8 m");
    const semanticAnalysis = await analyzeMotionPromptLocally(reportedIgnoredPrompt, precisePlan.requirementCoverage, async (_system, _prompt, format) => {
      assert.equal((format as any).properties.acknowledgedRequirements.minItems, precisePlan.requirementCoverage.length);
      return {
        model: "focused-test-model",
        proposal: {
          summary: "The subject travels forward while both lower limbs bend together through 45 degrees and the rear appendage counterbalances.",
          acknowledgedRequirements: precisePlan.requirementCoverage.map((entry) => entry.requirement).reverse(),
        },
      };
    });
    assert.deepEqual(semanticAnalysis.acknowledgedRequirements, precisePlan.requirementCoverage.map((entry) => entry.requirement), "semantic acknowledgement order must be canonical even if the model reorders JSON items");
    await assert.rejects(() => analyzeMotionPromptLocally(reportedIgnoredPrompt, precisePlan.requirementCoverage, async () => ({
      model: "focused-test-model",
      proposal: { summary: "Incomplete", acknowledgedRequirements: [precisePlan.requirementCoverage[0].requirement] },
    })), /omitted or changed/i);
    assert.throws(() => compilePromptedAnimation("Walk with both feet together while alternating the legs"), /both together and alternately/i);
    assert.throws(() => compilePromptedAnimation("Walk with both feet together and bend them to 175 degrees"), /1 to 150 degrees/i);
    const returnPlan = compilePromptedAnimation("Move forward 1 metre, then return to the original position");
    assert.equal(returnPlan.rootPath, "out-and-back");
    assert.equal(returnPlan.loopSuggested, true);
    assert.equal(compilePromptedAnimation("Hop forward several movements").rootPath, "hop-arc");
    assert.deepEqual(compilePromptedAnimation("Slither forward realistically").deformations, ["axial-wave"]);
    assert.equal(compilePromptedAnimation("Orbit while swinging").rootPath, "orbit");
    assert.deepEqual(compilePromptedAnimation("Stay stationary and spin").rotations, ["spin"]);
    const shootingStar = compilePromptedAnimation("Shoot forward like a shooting star while spinning twice and leaving an animated trail");
    assert.equal(shootingStar.rootPath, "linear");
    assert.deepEqual(shootingStar.rotations, ["spin"]);
    assert.equal(shootingStar.trail.enabled, true);
    assert.deepEqual(shootingStar.deformations, [], "a trail prompt must not implicitly deform the model");
    assert.ok(shootingStar.operators.includes("effect:trail"));
    const negatedSpin = compilePromptedAnimation("Do not spin; swing from the anchored handle to the attached end");
    assert.deepEqual(negatedSpin.rotations, ["swing"], "negated rotation wording must not become an operator");
    assert.equal(compilePromptedAnimation("Spin without a trail").trail.enabled, false, "negated trail wording must be respected");
    const battleFlail = compilePromptedAnimation("Keep the handle steady while the connected chain and distal ball swing like a battle pendulum four times while rotating twice");
    assert.equal(battleFlail.rootPath, "stationary");
    assert.deepEqual(battleFlail.rotations, ["swing", "spin"]);
    assert.equal(battleFlail.rotationScope, "distal");
    assert.ok(battleFlail.deformations.includes("segmented-swing"));
    assert.ok(battleFlail.deformations.includes("segmented-spin"));
    assert.equal(battleFlail.cycles, 4);
    const rabbitHop = compilePromptedAnimation("Hop forward several movements with gentle squash and stretch");
    assert.equal(rabbitHop.rootPath, "hop-arc");
    assert.deepEqual(rabbitHop.deformations, ["squash-stretch"]);
    assert.equal(rabbitHop.cycles, 4);
    const realisticSlither = compilePromptedAnimation("Slither forward realistically with six smooth body waves");
    assert.equal(realisticSlither.rootPath, "linear");
    assert.deepEqual(realisticSlither.deformations, ["axial-wave"]);
    assert.equal(realisticSlither.cycles, 6);
    const figureEightSwim = compilePromptedAnimation("Swim in a figure eight motion with four smooth body waves");
    assert.equal(figureEightSwim.rootPath, "figure-eight");
    assert.equal(figureEightSwim.orientToPath, true);
    assert.ok(figureEightSwim.operators.includes("orientation:path-tangent"));
    assert.deepEqual(figureEightSwim.deformations, ["rear-wave"]);
    assert.equal(figureEightSwim.cycles, 4);
    const birdFlight = compilePromptedAnimation("Fly forward while flapping both wings six times");
    assert.equal(birdFlight.rootPath, "linear");
    assert.deepEqual(birdFlight.deformations, ["bilateral-flap"]);
    assert.equal(birdFlight.cycles, 6);
    const seededMotion = compilePromptedAnimation("Fly forward while flapping both wings six times", {}, 1234);
    const differentlySeededMotion = compilePromptedAnimation("Fly forward while flapping both wings six times", {}, 5678);
    assert.equal(seededMotion.seed, 1234);
    assert.notEqual(seededMotion.timingExponent, differentlySeededMotion.timingExponent);
    assert.notEqual(seededMotion.clipId, differentlySeededMotion.clipId);
    assert.throws(() => compilePromptedAnimation("Make it look impressive"), /supported motion verb/i);
    assert.throws(() => compilePromptedAnimation("Fetch https:\/\/example.invalid\/motion"), /path, URL, script, or command/i);
    assert.throws(() => compilePromptedAnimation("Spin", { durationSeconds: 31 }), /durationSeconds/i);
    assert.throws(() => compilePromptedAnimation("Spin", { pathDirection: [0, 0, 0] }), /zero vector/i);

    const walkingInPlace = await authorPromptedAnimation({
      sourcePath,
      outputPath: walkingInPlacePath,
      instruction: "Walk naturally in place with alternating grounded steps",
      overrides: { mode: "replace", durationSeconds: 2, deformationFraction: 0.08 },
    });
    assert.equal(walkingInPlace.plan.placement, "in-place");
    assert.deepEqual(walkingInPlace.validation.pathDisplacement, { maximumMeters: 0, netMeters: 0, sampledTravelMeters: 0 });
    assert.ok(walkingInPlace.validation.deformationTargets.some((target) => target.operator === "grounded-stride" && target.targetIndices.length === 2));
    const walkingDocument = await testIO().read(walkingInPlacePath);
    const walkingClip = walkingDocument.getRoot().listAnimations()[0];
    assert.equal(walkingClip.listChannels().some((channel) => channel.getTargetPath() === "translation"), false, "in-place gait must not contain a generated root translation channel");
    assert.ok(walkingClip.listChannels().some((channel) => channel.getTargetPath() === "weights"), "in-place gait must contain visible body deformation");

    const bodyPromptRegression = await authorPromptedAnimation({
      sourcePath,
      outputPath: bodyPromptRegressionPath,
      instruction: reportedBodyPrompt,
      overrides: { ...scaledPromptedAnimationOverrides(rightFacingCreatureSpec, reportedBodyPrompt), mode: "replace", durationSeconds: 3 },
    });
    assert.equal(bodyPromptRegression.plan.rootPath, "stationary");
    assert.equal(bodyPromptRegression.validation.pathDisplacement.maximumMeters, 0);
    assert.ok(bodyPromptRegression.validation.deformationTargets.some((target) => target.operator === "body-crouch" && target.effective && target.maxVertexDisplacementRatio > 0.05));
    assert.ok(bodyPromptRegression.validation.deformationTargets.some((target) => target.operator === "grounded-stride" && target.effective));

    const synchronizedCounterbalance = await authorPromptedAnimation({
      sourcePath,
      outputPath: synchronizedCounterbalancePath,
      instruction: reportedIgnoredPrompt,
      seed: 9031324,
      overrides: { ...scaledPromptedAnimationOverrides(retainedKangarooSpec, reportedIgnoredPrompt), mode: "replace", durationSeconds: 4 },
      semanticAnalysis: {
        provider: "ollama",
        endpoint: "loopback",
        model: "focused-test-model",
        summary: "The subject travels forward while its paired lower limbs flex together through 45 degrees and its rear region counterbalances.",
        acknowledgedRequirements: precisePlan.requirementCoverage.map((entry) => entry.requirement),
      },
    });
    assert.equal(synchronizedCounterbalance.plan.semanticAnalysis?.provider, "ollama");
    assert.ok(synchronizedCounterbalance.validation.deformationTargets.some((target) => target.operator === "synchronous-bound" && target.effective));
    assert.ok(synchronizedCounterbalance.validation.deformationTargets.some((target) => target.operator === "rear-counterbalance" && target.effective));
    assert.ok(synchronizedCounterbalance.validation.pathDisplacement.maximumMeters > 1.99 && synchronizedCounterbalance.validation.pathDisplacement.maximumMeters < 2.01);

    const returnMotion = await authorPromptedAnimation({
      sourcePath,
      outputPath: returnPath,
      instruction: "Move forward 1 metre, then return to the original position",
      overrides: { mode: "replace", durationSeconds: 2 },
    });
    assert.ok(returnMotion.validation.pathDisplacement.maximumMeters > 0.99);
    assert.ok(returnMotion.validation.pathDisplacement.sampledTravelMeters > 1.98);
    assert.ok(returnMotion.validation.pathDisplacement.netMeters < 1e-5);

    const shootingStarMotion = await authorPromptedAnimation({
      sourcePath,
      outputPath: shootingStarPath,
      instruction: "Shoot forward like a shooting star while spinning twice and leaving an animated trail",
      seed: 81,
      overrides: { mode: "replace", durationSeconds: 2, travelMeters: 3 },
    });
    assert.equal(shootingStarMotion.plan.rootPath, "linear");
    assert.equal(shootingStarMotion.plan.rotationScope, "whole");
    assert.deepEqual(shootingStarMotion.plan.rotations, ["spin"]);
    assert.equal(shootingStarMotion.validation.trailPresent, true);
    assert.ok(shootingStarMotion.validation.pathDisplacement.netMeters > 2.99);
    const shootingDocument = await testIO().read(shootingStarPath);
    const shootingClip = shootingDocument.getRoot().listAnimations().find((animation) => (animation.getExtras() as any).grudgePromptAnimation?.clipId === shootingStarMotion.plan.clipId)!;
    assert.deepEqual((shootingClip.getExtras() as any).grudgePromptAnimation.plan.trail, shootingStarMotion.plan.trail, "each clip must retain its own viewport trail contract for export and reopen");
    assert.ok(shootingClip.listChannels().some((channel) => channel.getTargetPath() === "translation"));
    assert.ok(shootingClip.listChannels().some((channel) => channel.getTargetPath() === "rotation" && (channel.getExtras() as any).grudgePromptAnimation?.role === "root-rotation-1"));
    assert.equal(shootingDocument.getRoot().listMeshes().length, 1, "a trail prompt must not add a substitute mesh");
    assert.equal(shootingDocument.getRoot().listMaterials().length, 1, "a trail prompt must not add a substitute material");
    assert.equal(shootingDocument.getRoot().listNodes().some((node) => node.getExtras().grudgeDerivedGeometry === true || node.getExtras().grudgeMotionTrail === true), false);
    assert.equal(shootingClip.listChannels().some((channel) => channel.getTargetPath() === "weights"), false, "trail-only motion must leave model shape unchanged");

    const rabbitHopMotion = await authorPromptedAnimation({
      sourcePath,
      outputPath: rabbitHopPath,
      instruction: "Hop forward several movements",
      overrides: { mode: "replace", durationSeconds: 4, travelMeters: 3, hopHeightMeters: 0.75 },
    });
    assert.equal(rabbitHopMotion.plan.rootPath, "hop-arc");
    assert.equal(rabbitHopMotion.plan.cycles, 4);
    assert.ok(rabbitHopMotion.validation.pathDisplacement.netMeters > 2.99);
    const rabbitDocument = await testIO().read(rabbitHopPath);
    const rabbitClip = rabbitDocument.getRoot().listAnimations()[0];
    const rabbitPathValues = rabbitClip.listChannels().find((channel) => (channel.getExtras() as any).grudgePromptAnimation?.role === "root-path-1")!.getSampler()!.getOutput()!.getArray()!;
    const rabbitHeights = Array.from({ length: rabbitPathValues.length / 3 }, (_, index) => Number(rabbitPathValues[index * 3 + 1]));
    assert.ok(Math.max(...rabbitHeights) > 0.74, "hop arc must visibly leave the ground");
    assert.ok(rabbitHeights.filter((height) => Math.abs(height) < 1e-5).length >= 5, "several hops must contain repeated ground contacts");

    const snakeSlitherMotion = await authorPromptedAnimation({
      sourcePath,
      outputPath: snakeSlitherPath,
      instruction: "Slither forward realistically with six smooth body waves",
      overrides: { mode: "replace", durationSeconds: 4, travelMeters: 3 },
    });
    assert.equal(snakeSlitherMotion.plan.rootPath, "linear");
    assert.deepEqual(snakeSlitherMotion.plan.deformations, ["axial-wave"]);
    assert.equal(snakeSlitherMotion.plan.cycles, 6);
    assert.ok(snakeSlitherMotion.validation.pathDisplacement.netMeters > 2.99);
    assert.ok(snakeSlitherMotion.validation.deformationTargets.some((target) => target.operator === "axial-wave" && target.targetIndices.length === 2));
    const snakeDocument = await testIO().read(snakeSlitherPath);
    const snakeWeights = snakeDocument.getRoot().listAnimations()[0].listChannels().find((channel) => channel.getTargetPath() === "weights")!.getSampler()!.getOutput()!.getArray()!;
    assert.ok(Math.max(...Array.from(snakeWeights, Number)) > 0.95 && Math.min(...Array.from(snakeWeights, Number)) < -0.95, "slither weights must traverse a full travelling-wave cycle");

    const birdFlightMotion = await authorPromptedAnimation({
      sourcePath,
      outputPath: birdFlightPath,
      instruction: "Fly forward while flapping both wings six times",
      overrides: { mode: "replace", durationSeconds: 3, travelMeters: 3 },
    });
    assert.equal(birdFlightMotion.plan.rootPath, "linear");
    assert.deepEqual(birdFlightMotion.plan.deformations, ["bilateral-flap"]);
    assert.equal(birdFlightMotion.plan.cycles, 6);
    assert.ok(birdFlightMotion.validation.pathDisplacement.netMeters > 2.99);
    const birdDocument = await testIO().read(birdFlightPath);
    const birdMesh = birdDocument.getRoot().listMeshes().find((mesh) => mesh.getName() === "Source generated mesh")!;
    const birdTargetNames = (birdMesh.getExtras().targetNames as string[]) ?? [];
    const flapIndex = birdTargetNames.findIndex((name) => name.includes(":bilateral-flap:main"));
    const flapDeltas = birdMesh.listPrimitives()[0].listTargets()[flapIndex].getAttribute("POSITION")!.getArray()!;
    const wingLift = Math.abs(Number(flapDeltas[1]));
    const centerLift = Math.abs(Number(flapDeltas[8 * 3 + 1]));
    assert.ok(wingLift > 0.05 && centerLift < 1e-7, "bilateral flap must move lateral extremities while preserving the body center");
    const birdWeights = birdDocument.getRoot().listAnimations()[0].listChannels().find((channel) => channel.getTargetPath() === "weights")!.getSampler()!.getOutput()!.getArray()!;
    assert.ok(Math.max(...Array.from(birdWeights, Number)) > 0.95 && Math.min(...Array.from(birdWeights, Number)) < -0.95, "wing-flap weights must repeat through positive and negative strokes");

    const appended = await authorPromptedAnimation({
      sourcePath,
      outputPath: appendPath,
      instruction: "Travel in a figure eight while spinning, flapping several times, stretching, and leaving an animated trail",
      overrides: {
        durationSeconds: 3,
        cycles: 2,
        radiusMeters: 1.25,
        deformationFraction: 0.08,
        deformationTargetNodes: ["SourceMeshNode"],
        trail: { enabled: true, lengthMeters: 0.9, widthMeters: 0.12 },
      },
    });
    assert.equal(appended.plan.rootPath, "figure-eight");
    assert.deepEqual(appended.plan.rotations, ["spin"]);
    assert.deepEqual(appended.plan.deformations, ["bilateral-flap", "squash-stretch"]);
    assert.ok(appended.operators.includes("effect:trail"));
    assert.equal(appended.validation.clips.length, 2);
    assert.equal(appended.validation.requestedClip.name, appended.plan.clipName);
    assert.equal(appended.validation.durationSeconds, 3);
    assert.ok(appended.validation.channels >= 3);
    assert.ok(appended.pathDisplacementMeters > 1);
    assert.ok(appended.validation.pathDisplacement.sampledTravelMeters > appended.pathDisplacementMeters);
    assert.ok(appended.validation.pathDisplacement.netMeters < 1e-4);
    assert.equal(appended.validation.deformationTargets.length, 2);
    assert.equal(appended.validation.trailPresent, true);
    assert.equal(appended.validation.retainedSourceGeometry, true);
    assert.equal(appended.validation.retainedTextures, true);
    assertEmbeddedGlb(await readFile(appendPath));

    const appendDocument = await testIO().read(appendPath);
    assert.equal((appendDocument.getRoot().getAsset().extras as any).grudgePrompt3D.provider, "hunyuan3d-2.1");
    assert.deepEqual(Buffer.from(appendDocument.getRoot().listTextures()[0].getImage()!), PNG_1X1);
    assert.ok(appendDocument.getRoot().listAnimations().some((animation) => (animation.getExtras() as any).grudgePromptAnimation?.clipId === appended.plan.clipId));
    assert.equal(appendDocument.getRoot().listMeshes().length, 1, "animation refinement must retain the provider mesh count");
    assert.equal(appendDocument.getRoot().listMaterials().length, 1, "animation refinement must retain the provider material count");
    assert.equal(appendDocument.getRoot().listNodes().some((node) => node.getExtras().grudgeMotionTrail === true || node.getExtras().grudgeDerivedGeometry === true), false);
    const appendedClip = appendDocument.getRoot().listAnimations().find((animation) => (animation.getExtras() as any).grudgePromptAnimation?.clipId === appended.plan.clipId)!;
    const rootRotation = appendedClip.listChannels().find((channel) => (channel.getExtras() as any).grudgePromptAnimation?.role === "root-rotation-1");
    assert.ok(rootRotation, "whole-object spin must remain present without synthesizing a trail node");
    assert.equal(appended.validation.deformationTargets.some((target) => target.operator === "trail-pulse"), false, "trail validation must not depend on a provider-geometry morph target");
    const technical = await validatePrompt3DGlb(appendPath, validationSpec, join(workspace, "quarantine"));
    assert.equal(technical.gameReady, true, technical.checks.filter((check) => check.status === "fail").map((check) => `${check.id}: ${check.message}`).join("\n"));
    assert.deepEqual(technical.boundsMeters, { width: 1, height: 1, depth: 1, minY: 0 }, "trail animation must remain inside canonical provider-authored bounds");
    assert.equal(technical.checks.find((check) => check.id === "derived-effects"), undefined, "no derived geometry exemption may hide an oversized trail");

    const articulated = await authorPromptedAnimation({
      sourcePath,
      outputPath: articulatedPath,
      instruction: "Keep the handle and grip fixed while the attached links, connected chain and distal ball swing four times and rotate twice",
      seed: 91,
      overrides: { mode: "replace", deformationAxis: "y", durationSeconds: 2 },
    });
    assert.equal(articulated.plan.rotationScope, "distal");
    assert.ok(articulated.plan.deformations.includes("segmented-swing"));
    assert.ok(articulated.plan.deformations.includes("segmented-spin"));
    const articulatedDocument = await testIO().read(articulatedPath);
    const articulatedMesh = articulatedDocument.getRoot().listMeshes().find((mesh) => mesh.getName() === "Source generated mesh")!;
    const targetNames = (articulatedMesh.getExtras().targetNames as string[]) ?? [];
    const positiveIndex = targetNames.findIndex((name) => name.includes(":segmented-swing:positive"));
    const spinSineIndex = targetNames.findIndex((name) => name.includes(":segmented-spin:sine"));
    assert.ok(positiveIndex >= 0, "segmented swing must author a positive distal morph region");
    assert.ok(spinSineIndex >= 0, "segmented spin must author a continuous distal rotation basis");
    const segmentedDeltas = articulatedMesh.listPrimitives()[0].listTargets()[positiveIndex].getAttribute("POSITION")!.getArray()!;
    const spinDeltas = articulatedMesh.listPrimitives()[0].listTargets()[spinSineIndex].getAttribute("POSITION")!.getArray()!;
    for (const vertex of [0, 1, 4, 5]) assert.ok(Math.hypot(Number(segmentedDeltas[vertex * 3]), Number(segmentedDeltas[vertex * 3 + 1]), Number(segmentedDeltas[vertex * 3 + 2])) < 1e-7, "lower handle region must remain fixed");
    for (const vertex of [2, 3, 6, 7]) assert.ok(Math.hypot(Number(segmentedDeltas[vertex * 3]), Number(segmentedDeltas[vertex * 3 + 1]), Number(segmentedDeltas[vertex * 3 + 2])) > 0.05, "distal connected region must swing relative to the handle");
    for (const vertex of [0, 1, 4, 5]) assert.ok(Math.hypot(Number(spinDeltas[vertex * 3]), Number(spinDeltas[vertex * 3 + 1]), Number(spinDeltas[vertex * 3 + 2])) < 1e-7, "distal spin must leave the proximal handle region fixed");
    for (const vertex of [2, 3, 6, 7]) assert.ok(Math.hypot(Number(spinDeltas[vertex * 3]), Number(spinDeltas[vertex * 3 + 1]), Number(spinDeltas[vertex * 3 + 2])) > 0.05, "distal spin must rotate the connected end region");
    const articulatedClip = articulatedDocument.getRoot().listAnimations()[0];
    assert.ok(articulatedClip.listChannels().some((channel) => channel.getTargetPath() === "weights" && channel.getTargetNode()?.getName() === "SourceMeshNode"));
    assert.equal(articulatedClip.listChannels().some((channel) => channel.getTargetPath() === "rotation" && (channel.getExtras() as any).grudgePromptAnimation?.role?.startsWith("root-rotation-")), false, "anchored distal motion must not rotate the handle/root");

    const rearWave = await authorPromptedAnimation({
      sourcePath,
      outputPath: rearWavePath,
      instruction: "Swim in a figure eight with the trailing tail propelling the motion four times",
      seed: 92,
      overrides: { mode: "replace", deformationAxis: "z", durationSeconds: 2 },
    });
    assert.deepEqual(rearWave.plan.deformations, ["rear-wave"]);
    assert.equal(rearWave.plan.rootPath, "figure-eight");
    assert.ok(rearWave.validation.pathDisplacement.netMeters < 1e-4 && rearWave.validation.pathDisplacement.sampledTravelMeters > 1, "figure-eight swim must trace a closed non-trivial path");
    const rearWaveDocument = await testIO().read(rearWavePath);
    const rearClip = rearWaveDocument.getRoot().listAnimations()[0];
    const rearOrientation = rearClip.listChannels().find((channel) => (channel.getExtras() as any).grudgePromptAnimation?.role === "root-rotation-1");
    assert.ok(rearOrientation, "closed swim paths must orient the model along the path tangent");
    const rearRotations = rearOrientation!.getSampler()!.getOutput()!.getArray()!;
    assert.notDeepEqual(Array.from(rearRotations.slice(0, 4)), Array.from(rearRotations.slice(Math.floor(rearWave.plan.keyframes / 4) * 4, Math.floor(rearWave.plan.keyframes / 4) * 4 + 4)), "figure-eight heading must turn as its tangent changes");
    const rearMesh = rearWaveDocument.getRoot().listMeshes().find((mesh) => mesh.getName() === "Source generated mesh")!;
    const rearNames = (rearMesh.getExtras().targetNames as string[]) ?? [];
    const rearIndex = rearNames.findIndex((name) => name.includes(":rear-wave:cosine"));
    const rearDeltas = rearMesh.listPrimitives()[0].listTargets()[rearIndex].getAttribute("POSITION")!.getArray()!;
    const trailingMagnitude = Math.hypot(Number(rearDeltas[0]), Number(rearDeltas[1]), Number(rearDeltas[2]));
    const forwardMagnitude = Math.hypot(Number(rearDeltas[12]), Number(rearDeltas[13]), Number(rearDeltas[14]));
    assert.ok(trailingMagnitude > 0.01 && forwardMagnitude < 1e-7, "rear-wave must weight the trailing region while preserving the forward region");

    const repeated = await authorPromptedAnimation({
      sourcePath,
      outputPath: appendRepeatPath,
      instruction: "Travel in a figure eight while spinning, flapping several times, stretching, and leaving an animated trail",
      overrides: {
        durationSeconds: 3,
        cycles: 2,
        radiusMeters: 1.25,
        deformationFraction: 0.08,
        deformationTargetNodes: ["SourceMeshNode"],
        trail: { enabled: true, lengthMeters: 0.9, widthMeters: 0.12 },
      },
    });
    assert.deepEqual(repeated.plan, appended.plan);
    assert.deepEqual(repeated.validation, appended.validation);
    assert.deepEqual(await readFile(appendRepeatPath), await readFile(appendPath));

    const replaced = await authorPromptedAnimation({
      sourcePath: appendPath,
      outputPath: replacePath,
      instruction: "Hop forward three times while swinging and undulating",
      overrides: { mode: "replace", durationSeconds: 2.5, travelMeters: 2, hopHeightMeters: 0.4 },
    });
    assert.equal(replaced.plan.rootPath, "hop-arc");
    assert.deepEqual(replaced.plan.rotations, ["swing"]);
    assert.deepEqual(replaced.plan.deformations, ["axial-wave", "squash-stretch"]);
    assert.equal(replaced.validation.clips.length, 1);
    assert.equal(replaced.validation.trailPresent, false);
    assert.equal(replaced.validation.deformationTargets.length, 2);
    assert.equal(replaced.validation.deformationTargets[0].targetIndices.length, 2);
    assert.ok(replaced.validation.pathDisplacement.netMeters > 1.99);
    assert.equal(replaced.validation.retainedSourceGeometry, true);
    assert.equal(replaced.validation.retainedTextures, true);
    assertEmbeddedGlb(await readFile(replacePath));
    const replaceDocument = await testIO().read(replacePath);
    assert.equal(replaceDocument.getRoot().listNodes().some((node) => (node.getExtras() as any).grudgePromptAnimationEffect?.kind === "trail"), false);

    await assert.rejects(
      authorPromptedAnimation({ sourcePath, outputPath: sourcePath, instruction: "Spin" }),
      /cannot be overwritten/i,
    );
    const sourceBytes = await readFile(sourcePath);
    await writeFile(externalPath, glbWithExternalImage(sourceBytes));
    await assert.rejects(
      authorPromptedAnimation({ sourcePath: externalPath, outputPath: join(workspace, "blocked.glb"), instruction: "Spin" }),
      /external assets/i,
    );

    console.log("Prompted animation focused tests passed.");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
