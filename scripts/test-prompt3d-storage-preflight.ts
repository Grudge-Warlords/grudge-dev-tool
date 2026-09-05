import assert from "node:assert/strict";
import {
  assertPrompt3DOutputSpace,
  PROMPT3D_OUTPUT_SPACE_ESTIMATE_BYTES,
  prompt3DGenerationOutputStage,
} from "../src/main/prompt3d/hardware";

assert.equal(prompt3DGenerationOutputStage(true, false), "concept");
assert.equal(prompt3DGenerationOutputStage(true, true), "geometry");
assert.equal(prompt3DGenerationOutputStage(false, false), "geometry");

for (const stage of ["concept", "geometry", "texture"] as const) {
  assert.throws(
    () => assertPrompt3DOutputSpace("D:\\full-output", 0, stage),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^OUTPUT_STORAGE_FULL:/);
      assert.match(error.message, /D:\\full-output/);
      assert.match(error.message, /conservative estimated minimum/);
      assert.match(error.message, /actual use varies/);
      assert.match(error.message, /No provider inference was started/);
      return true;
    },
    `${stage} must fail before provider inference on a full output volume`,
  );

  assert.equal(
    assertPrompt3DOutputSpace("E:\\ready-output", PROMPT3D_OUTPUT_SPACE_ESTIMATE_BYTES[stage], stage),
    PROMPT3D_OUTPUT_SPACE_ESTIMATE_BYTES[stage],
    `${stage} must accept the documented conservative threshold`,
  );
}

assert.ok(
  PROMPT3D_OUTPUT_SPACE_ESTIMATE_BYTES.geometry > PROMPT3D_OUTPUT_SPACE_ESTIMATE_BYTES.concept,
  "geometry must reserve more output space than concept preparation",
);
assert.ok(
  PROMPT3D_OUTPUT_SPACE_ESTIMATE_BYTES.texture > PROMPT3D_OUTPUT_SPACE_ESTIMATE_BYTES.geometry,
  "texture generation must reserve space for its reference views and raw plus merged GLBs",
);

console.log("prompt3d output-storage preflight tests passed");
