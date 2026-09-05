import assert from "node:assert/strict";
import {
  assertPrompt3DVisualInspectionEvidence,
  createPrompt3DVisualInspection,
  finalizePrompt3DVisualInspection,
  prompt3DVisualInspectionRequirements,
  recordPrompt3DClipPlayback,
  recordPrompt3DViewpoint,
  setPrompt3DInspectionAttestation,
} from "../src/shared/prompt3dVisualInspection";

const start = "2026-09-03T00:00:00.000Z";
const assetPath = "E:\\GrudgePrompt3D\\workflow-history\\asset.glb";
const assetSha256 = "a".repeat(64);

let geometry = createPrompt3DVisualInspection(assetPath, assetSha256, "geometry", [], start);
for (const [index, preset] of (["front", "right", "back", "left"] as const).entries()) {
  geometry = recordPrompt3DViewpoint(geometry, preset, `2026-09-03T00:00:0${index + 1}.000Z`);
}
assert.equal(prompt3DVisualInspectionRequirements(geometry).complete, false, "viewpoints alone must not approve identity/completeness");
geometry = setPrompt3DInspectionAttestation(geometry, "geometryIdentityAndCompleteness", true, "2026-09-03T00:00:05.000Z");
const geometryEvidence = finalizePrompt3DVisualInspection(geometry, "2026-09-03T00:00:06.000Z");
assertPrompt3DVisualInspectionEvidence(geometryEvidence, { assetPath, assetSha256, stage: "geometry" });
assert.throws(
  () => assertPrompt3DVisualInspectionEvidence(geometryEvidence, { assetPath, assetSha256: "b".repeat(64), stage: "geometry" }),
  /exact retained asset bytes/,
  "a path-stable byte replacement must invalidate inspection evidence",
);

let texture = createPrompt3DVisualInspection(assetPath, assetSha256, "texture", [], start);
for (const preset of ["front", "right", "back", "top"] as const) texture = recordPrompt3DViewpoint(texture, preset, start);
texture = setPrompt3DInspectionAttestation(texture, "geometryIdentityAndCompleteness", true, start);
assert.equal(prompt3DVisualInspectionRequirements(texture).complete, false, "texture approval must require material coverage and appearance");
texture = setPrompt3DInspectionAttestation(texture, "materialCoverageAndAppearance", true, start);
assertPrompt3DVisualInspectionEvidence(finalizePrompt3DVisualInspection(texture, start), { assetPath, assetSha256, stage: "texture" });

const animations = [
  { name: "Primary motion", duration: 0.5 },
  { name: "Refined motion", duration: 0.75 },
];
let animation = createPrompt3DVisualInspection(assetPath, assetSha256, "animation", animations, start);
for (const preset of ["front", "right", "back", "left"] as const) animation = recordPrompt3DViewpoint(animation, preset, start);
animation = setPrompt3DInspectionAttestation(animation, "geometryIdentityAndCompleteness", true, start);
animation = setPrompt3DInspectionAttestation(animation, "animationMotionMatchesPrompt", true, start);
for (let index = 0; index < 2; index += 1) animation = recordPrompt3DClipPlayback(animation, 0, 0.25, start);
for (let index = 0; index < 2; index += 1) animation = recordPrompt3DClipPlayback(animation, 1, 0.25, start);
assert.equal(prompt3DVisualInspectionRequirements(animation).complete, false, "partial playback of any retained clip must keep approval disabled");
animation = recordPrompt3DClipPlayback(animation, 1, 0.25, start);
const animationEvidence = finalizePrompt3DVisualInspection(animation, start);
assertPrompt3DVisualInspectionEvidence(animationEvidence, { assetPath, assetSha256, stage: "animation", animations });
assert.throws(
  () => assertPrompt3DVisualInspectionEvidence(animationEvidence, { assetPath, assetSha256, stage: "animation", animations: animations.slice(0, 1) }),
  /every retained animation clip/,
  "clip-list changes must invalidate retained playback evidence",
);
assert.throws(
  () => assertPrompt3DVisualInspectionEvidence({
    ...animationEvidence,
    clips: animationEvidence.clips.map((clip, index) => index === 0 ? { ...clip, playedSeconds: Number.POSITIVE_INFINITY } : clip),
  }, { assetPath, assetSha256, stage: "animation", animations }),
  /full duration/,
  "non-finite playback counters must fail closed",
);

console.log("Prompt-to-3D visual-inspection gate tests passed.");
