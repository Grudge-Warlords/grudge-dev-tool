import assert from "node:assert/strict";
import { compilePrompt3DUnifiedPlan, prompt3DGuidedCreationSpec, prompt3DOrchestrationRecord, type Prompt3DUnifiedContext } from "../src/shared/prompt3dOrchestrator";
import type { AssetSpecV1 } from "../src/shared/prompt3d";

const context = (overrides: Partial<Prompt3DUnifiedContext> = {}): Prompt3DUnifiedContext => ({
  mode: "new", category: "prop", localControlsEnabled: true, localAnimationLibraries: 1,
  providers: [
    { id: "hunyuan3d-2", ready: true, reason: "installed and verified" },
    { id: "trellis", ready: true, reason: "installed and verified" },
    { id: "hy-motion-1", ready: false, reason: "optional provider lacks resources" },
  ],
  ...overrides,
});

const quality = compilePrompt3DUnifiedPlan({ prompt: "Create a detailed hand-painted fantasy chest", context: context() });
assert.equal(quality.selectedRoute, "hunyuan3d-2", "automatic creation must prefer the highest-capability eligible route");
assert.equal(quality.planner.preferredModel, "grudge-dev");
assert.equal(quality.planner.contacted, false);
assert.equal(quality.externalProviderContact, false);
assert.deepEqual(quality.stages.map((stage) => stage.executor), ["prompt3d.start", "prompt3d.finishStart", "prompt3d.workflowValidateAndSave"]);

const fullChain = compilePrompt3DUnifiedPlan({ prompt: "Create a hand-painted humanoid, texture it, rig it, animate a walk in place, then complete the scene", context: context({ category: "character" }) });
assert.deepEqual(fullChain.stages.map((stage) => stage.executor), [
  "prompt3d.start", "prompt3d.finishStart", "prompt3d.finishStart", "sceneCompletion.existing", "prompt3d.workflowValidateAndSave",
]);
assert.equal(fullChain.stages[1].readiness, "unknown", "downstream stages wait for the preceding approved exact revision");

const blockedLeader = compilePrompt3DUnifiedPlan({
  prompt: "Create a detailed fantasy chest", context: context({ providers: [
    { id: "hunyuan3d-2", ready: false, reason: "not installed" },
    { id: "trellis", ready: true, reason: "installed and verified" },
    { id: "hy-motion-1", ready: false, reason: "optional" },
  ] }),
});
assert.equal(blockedLeader.strongestCapability, "hunyuan3d-2");
assert.equal(blockedLeader.selectedRoute, "trellis");
assert.match(blockedLeader.strongestCapabilityBlockedReason ?? "", /not installed/);
assert.equal(blockedLeader.nextBestEligible, "trellis");
assert.deepEqual(blockedLeader.stages.map((stage) => stage.executor), ["prompt3d.start", "prompt3d.retainedGeneration"]);

const explicitTrellisChain = compilePrompt3DUnifiedPlan({
  prompt: "Create a textured stone golem, animate it walking, then complete the scene",
  context: context(),
  override: "trellis",
});
assert.deepEqual(explicitTrellisChain.stages.map((stage) => stage.route), [
  "trellis", "forge-local", "cpu-rig-animation", "scene-completion", "retain-reopen",
]);
assert.equal(explicitTrellisChain.stages.some((stage) => stage.route === "hunyuan-paint-refine"), false, "TRELLIS must not silently cross-route to Hunyuan Paint");

const override = compilePrompt3DUnifiedPlan({ prompt: "Create a basic sword", context: context(), override: "original-procedural" });
assert.equal(override.overrideApplied, true);
assert.equal(override.automaticRecommendation, "hunyuan3d-2");
assert.equal(override.selectedRoute, "original-procedural");
const retained = prompt3DOrchestrationRecord(override, override.stages.map((stage) => stage.id));
assert.equal(retained.overrideApplied, true);
assert.equal(retained.selectedRoute, "original-procedural");
assert.equal(retained.externalProviderContact, false);

const current = context({ mode: "revise-current", currentRevision: { id: "revision-1", sha256: "a".repeat(64), path: "E:\\asset.glb", method: "hunyuan-workflow" } });
const crystalPrompt = "Create one upright faceted crystal prop, color it violet, then make it float gently and spin slowly in place.";
const crystal = compilePrompt3DUnifiedPlan({ prompt: crystalPrompt, context: context() });
assert.deepEqual(crystal.stages.map(stage => stage.route), ["hunyuan3d-2", "hunyuan-paint-refine", "cpu-rig-animation", "validate-save"]);
for (const action of ["float gently", "spin slowly", "bob up and down", "hover", "rotate in place", "swim", "slither"]) {
  assert.equal(compilePrompt3DUnifiedPlan({ prompt: `Make it ${action}`, context: current }).selectedRoute, "cpu-rig-animation");
}
assert.equal(compilePrompt3DUnifiedPlan({ prompt: "Create a crystal. Do not spin or float it.", context: context() }).stages.some(stage => stage.route === "cpu-rig-animation"), false);
const defaults: AssetSpecV1 = {
  version: "1.0.0", prompt: "", category: "prop", style: "stylized", route: "concept-image-to-3d", targetFormat: "glb",
  dimensions: { width: 1, height: 1, depth: 1, unit: "m" }, budgets: { maxTriangles: 50000, maxTextureResolution: 2048, maxTextureBytes: 33554432 },
  seed: 42, variants: 1, providerId: "hunyuan3d-2", generateTextures: false, generateCollision: false, generateLods: false,
  coordinateContract: { upAxis: "+Y", forwardAxis: "+Z", origin: "ground-center", stableRootName: "GrudgeAssetRoot" },
};
const stale: AssetSpecV1 = { ...defaults, category: "character", style: "realistic", seed: 999, dimensions: { width: 0.1, height: 0.1, depth: 0.1, unit: "m" }, objectRules: { type: "creature", component: "whole", flipVertical: true } };
const intent = { mode: "new" as const, category: "prop" as const, style: "stylized" as const, prompt: crystalPrompt, route: "hunyuan3d-2" as const, orchestration: prompt3DOrchestrationRecord(crystal, crystal.stages.map(stage => stage.id)) };
const fresh = prompt3DGuidedCreationSpec(defaults, stale, intent);
assert.equal(fresh.category, "prop");
assert.equal(fresh.style, "stylized");
assert.equal(fresh.seed, 42);
assert.deepEqual(fresh.dimensions, defaults.dimensions);
assert.equal(fresh.objectRules, undefined);
assert.equal(stale.objectRules?.flipVertical, true, "the retained prior spec remains immutable");
const revision = prompt3DGuidedCreationSpec(defaults, stale, { ...intent, mode: "revise-current" });
assert.equal(revision.category, "character");
assert.deepEqual(revision.dimensions, stale.dimensions, "an explicit current-asset revision retains its scale");
const animation = compilePrompt3DUnifiedPlan({ prompt: "Make the humanoid walk in place and do not move forward", context: current });
assert.equal(animation.selectedRoute, "cpu-rig-animation");
assert.equal(animation.stages[0].readiness, "ready");
assert.match(animation.exactRevision, /revision-1.*SHA-256/);

const explicitHy = compilePrompt3DUnifiedPlan({ prompt: "Animate the current humanoid", context: current, override: "hy-motion-optional" });
assert.equal(explicitHy.stages[0].readiness, "blocked");
assert.match(explicitHy.stages[0].readinessReason, /optional provider lacks resources/);
assert.equal(explicitHy.automaticRecommendation, "cpu-rig-animation");

const noCurrent = compilePrompt3DUnifiedPlan({ prompt: "Retarget this skeleton", context: context(), override: "skeleton-studio" });
assert.equal(noCurrent.stages[0].readiness, "blocked");
assert.match(noCurrent.stages[0].readinessReason, /exact retained revision/);

console.log("typed Prompt-to-3D orchestrator quality, override, readiness and provenance tests passed");
