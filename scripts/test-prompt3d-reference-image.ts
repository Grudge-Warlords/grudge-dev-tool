import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import {
  assertPrompt3DReferenceImageSet,
  inspectPrompt3DReferenceImage,
  prompt3DReferenceImageMatches,
  prompt3DReferenceImageSetMatches,
  prompt3DReferenceImageSpec,
  retainPrompt3DReferenceImage,
  retainPrompt3DReferenceImages,
  verifyPrompt3DRetainedReferenceImage,
  verifyPrompt3DRetainedReferenceImages,
} from "../src/main/prompt3d/referenceImage";
import { assertConceptAttemptBinding, createConceptBinding, sha256Hex } from "../src/main/prompt3d/conceptApproval";
import { conceptBindingMatchesSpec, sanitizeAssetSpec, stableJson } from "../src/shared/conceptWorkflow";
import { compilePrompt3DPrompt, withObjectRules } from "../src/shared/prompt3dRules";
import { PROMPT3D_SPEC_VERSION, type AssetSpecV1, type Prompt3DConceptAttempt } from "../src/shared/prompt3d";
import { PROMPT3D_PROVIDERS } from "../src/main/prompt3d/providers";

async function main() {
const root = await mkdtemp(join(tmpdir(), "grudge-prompt3d-reference-"));
try {
  const sourceDirectory = join(root, "source");
  await mkdir(sourceDirectory);
  const cases = [
    { extension: "png", mediaType: "image/png" as const, encode: (image: sharp.Sharp) => image.png() },
    { extension: "jpg", mediaType: "image/jpeg" as const, encode: (image: sharp.Sharp) => image.jpeg({ quality: 90 }) },
    { extension: "webp", mediaType: "image/webp" as const, encode: (image: sharp.Sharp) => image.webp({ quality: 90 }) },
  ];
  for (const testCase of cases) {
    const sourcePath = resolve(sourceDirectory, `specific-stock.${testCase.extension}`);
    const bytes = await testCase.encode(sharp({
      create: { width: 96, height: 80, channels: 4, background: { r: 245, g: 245, b: 245, alpha: 1 } },
    })).toBuffer();
    await writeFile(sourcePath, bytes);
    const selected = await inspectPrompt3DReferenceImage(sourcePath);
    assert.equal(selected.mediaType, testCase.mediaType);
    assert.equal(selected.width, 96);
    assert.equal(selected.height, 80);
    assert.equal(selected.sourcePath, sourcePath);

    const jobDirectory = resolve(root, `job-${testCase.extension}`);
    await mkdir(jobDirectory);
    const retained = await retainPrompt3DReferenceImage(selected, jobDirectory);
    assert.ok(retained.path.startsWith(jobDirectory));
    assert.equal(retained.use, "hunyuan-shape-concept-conditioning");
    assert.ok(prompt3DReferenceImageMatches(selected, retained));
    assert.deepEqual(await readFile(retained.path), bytes, "the source bytes must be copied exactly before provider work");
    await assert.doesNotReject(verifyPrompt3DRetainedReferenceImage(jobDirectory, retained, prompt3DReferenceImageSpec(selected)));
  }

  const stalePath = resolve(sourceDirectory, "stale.png");
  await writeFile(stalePath, await sharp({ create: { width: 96, height: 80, channels: 3, background: "white" } }).png().toBuffer());
  const staleSelection = await inspectPrompt3DReferenceImage(stalePath);
  await writeFile(stalePath, await sharp({ create: { width: 96, height: 80, channels: 3, background: "black" } }).png().toBuffer());
  const staleJob = resolve(root, "stale-job");
  await mkdir(staleJob);
  await assert.rejects(retainPrompt3DReferenceImage(staleSelection, staleJob), /changed after selection/i);

  const tamperSource = resolve(sourceDirectory, "tamper.webp");
  await writeFile(tamperSource, await sharp({ create: { width: 100, height: 100, channels: 3, background: "white" } }).webp().toBuffer());
  const tamperSelection = await inspectPrompt3DReferenceImage(tamperSource);
  const tamperJob = resolve(root, "tamper-job");
  await mkdir(tamperJob);
  const tamperEvidence = await retainPrompt3DReferenceImage(tamperSelection, tamperJob);
  await writeFile(tamperEvidence.path, await sharp({ create: { width: 100, height: 100, channels: 3, background: "red" } }).webp().toBuffer());
  await assert.rejects(
    verifyPrompt3DRetainedReferenceImage(tamperJob, tamperEvidence, prompt3DReferenceImageSpec(tamperSelection)),
    /bytes|identity|size/i,
  );

  const smallPath = resolve(sourceDirectory, "too-small.png");
  await writeFile(smallPath, await sharp({ create: { width: 32, height: 32, channels: 3, background: "white" } }).png().toBuffer());
  await assert.rejects(inspectPrompt3DReferenceImage(smallPath), /64 to 8192/i);
  const unsupportedPath = resolve(sourceDirectory, "unsupported.gif");
  await writeFile(unsupportedPath, await sharp({ create: { width: 96, height: 96, channels: 3, background: "white" } }).gif().toBuffer());
  await assert.rejects(inspectPrompt3DReferenceImage(unsupportedPath), /PNG, JPEG or WebP/i);

  const selected = await inspectPrompt3DReferenceImage(resolve(sourceDirectory, "specific-stock.png"));
  const retained = await retainPrompt3DReferenceImage(selected, await (async () => {
    const directory = resolve(root, "binding-job");
    await mkdir(directory);
    return directory;
  })());
  const spec = withObjectRules({
    version: PROMPT3D_SPEC_VERSION,
    prompt: "One complete centered fantasy lantern with a broad empty margin",
    category: "prop",
    style: "realistic",
    route: "concept-image-to-3d",
    targetFormat: "glb",
    dimensions: { width: 1, height: 1, depth: 1, unit: "m" },
    budgets: { maxTriangles: 50_000, maxTextureResolution: 2048, maxTextureBytes: 32 * 1024 ** 2 },
    seed: 42,
    variants: 1,
    providerId: "hunyuan3d-2",
    generateTextures: false,
    generateCollision: false,
    generateLods: false,
    referenceImage: prompt3DReferenceImageSpec(selected),
    coordinateContract: { upAxis: "+Y", forwardAxis: "+Z", origin: "ground-center", stableRootName: "GrudgeAssetRoot" },
  } satisfies AssetSpecV1);
  const jobId = "11111111-1111-4111-8111-111111111111";
  const conceptSha256 = "a".repeat(64);
  const binding = createConceptBinding(jobId, 1, spec, conceptSha256);
  assert.equal(binding.referenceSha256, selected.sha256);
  assert.equal(conceptBindingMatchesSpec(binding, spec), true);
  assert.equal(conceptBindingMatchesSpec(binding, {
    ...spec,
    referenceImage: { ...spec.referenceImage!, sha256: "b".repeat(64) },
  }), false, "changing the reference hash must make a retained concept stale");
  assert.deepEqual(sanitizeAssetSpec(spec).referenceImage, spec.referenceImage, "AssetSpec sanitation must retain only the public reference identity");
  const promptPlan = compilePrompt3DPrompt(spec);
  const attempt: Prompt3DConceptAttempt = {
    attemptNumber: 1,
    binding,
    conceptImagePath: resolve(root, "concept.png"),
    promptPlan,
    technicalReview: {
      status: "pass",
      method: "fixture",
      message: "Framing passed; semantics were not checked.",
      reportPath: resolve(root, "concept-review.json"),
      reportSha256: "d".repeat(64),
      presentationContractSha256: sha256Hex(stableJson(promptPlan.presentationContract)),
      reportVersion: 1,
      semanticResemblanceChecked: false,
      visualReviewRequired: true,
      checkedAt: "2026-09-03T00:00:00.000Z",
    },
    referenceImage: retained,
    createdAt: "2026-09-03T00:00:00.000Z",
  };
  assert.doesNotThrow(() => assertConceptAttemptBinding(jobId, spec, attempt, conceptSha256));
  assert.throws(
    () => assertConceptAttemptBinding(jobId, spec, { ...attempt, referenceImage: { ...retained, sha256: "c".repeat(64) } }, conceptSha256),
    /reference-image evidence/i,
  );

  const rightPath = resolve(sourceDirectory, "specific-stock-right.png");
  await writeFile(rightPath, await sharp({ create: { width: 96, height: 80, channels: 3, background: "blue" } }).png().toBuffer());
  const multiviewSelections = await Promise.all([
    ["front", "specific-stock.png"],
    ["left", "specific-stock.jpg"],
    ["back", "specific-stock.webp"],
    ["right", "specific-stock-right.png"],
  ].map(async ([view, name]) => ({
    ...await inspectPrompt3DReferenceImage(resolve(sourceDirectory, name)),
    view: view as "front" | "left" | "back" | "right",
  })));
  const multiviewDirectory = resolve(root, "multiview-job");
  await mkdir(multiviewDirectory);
  assert.doesNotThrow(() => assertPrompt3DReferenceImageSet(multiviewSelections, multiviewSelections[0]));
  const retainedViews = await retainPrompt3DReferenceImages(multiviewSelections, multiviewDirectory);
  assert.deepEqual(retainedViews.map((image) => image.view), ["front", "left", "back", "right"]);
  assert.equal(new Set(retainedViews.map((image) => image.path)).size, 4, "every view must have a unique retained path");
  assert.equal(prompt3DReferenceImageSetMatches(multiviewSelections, retainedViews), true);
  await assert.doesNotReject(verifyPrompt3DRetainedReferenceImages(multiviewDirectory, retainedViews, multiviewSelections));
  const successorDirectory = resolve(root, "multiview-successor-job");
  await mkdir(successorDirectory);
  await assert.doesNotReject(retainPrompt3DReferenceImages(
    retainedViews.map((image) => ({ ...image, sourcePath: image.path })),
    successorDirectory,
  ), "a canonical retained copy must remain selectable for a verified successor despite its storage filename");
  assert.throws(
    () => assertPrompt3DReferenceImageSet(
      [{ ...multiviewSelections[0], view: "left" }, multiviewSelections[1]],
      multiviewSelections[0],
    ),
    /only one left|front/i,
  );
  assert.throws(
    () => assertPrompt3DReferenceImageSet(
      [multiviewSelections[0], { ...multiviewSelections[0], view: "left" }],
      multiviewSelections[0],
    ),
    /distinct image bytes/i,
  );
  const multiviewSpec: AssetSpecV1 = {
    ...spec,
    referenceImage: prompt3DReferenceImageSpec(multiviewSelections[0]),
    referenceImages: multiviewSelections.map(prompt3DReferenceImageSpec),
  };
  const multiviewBinding = createConceptBinding(jobId, 1, multiviewSpec, conceptSha256);
  assert.deepEqual(multiviewBinding.referenceImageBindings, [
    { view: "front", sha256: multiviewSelections[0].sha256 },
    { view: "left", sha256: multiviewSelections[1].sha256 },
    { view: "back", sha256: multiviewSelections[2].sha256 },
    { view: "right", sha256: multiviewSelections[3].sha256 },
  ]);
  assert.equal(conceptBindingMatchesSpec(multiviewBinding, multiviewSpec), true);
  assert.equal(conceptBindingMatchesSpec(multiviewBinding, {
    ...multiviewSpec,
    referenceImages: [...multiviewSpec.referenceImages!].reverse(),
  }), false, "changing multiview roles or order must stale the concept binding");
  const multiviewAttempt: Prompt3DConceptAttempt = {
    ...attempt,
    binding: multiviewBinding,
    referenceImage: retainedViews[0],
    referenceImages: retainedViews,
  };
  assert.doesNotThrow(() => assertConceptAttemptBinding(jobId, multiviewSpec, multiviewAttempt, conceptSha256));

  const providerWorker = await readFile(resolve("tools/prompt3d/provider_worker.py"), "utf8");
  assert.match(providerWorker, /verify_reference_image\(spec, root\)/, "the provider must re-verify retained conditioning bytes");
  assert.match(providerWorker, /verify_reference_images\(spec, root\)/, "the provider must re-verify every labelled conditioning view");
  assert.match(providerWorker, /tencent--Hunyuan3D-2mv/, "multiple images must select the official Hunyuan3D-2mv weights");
  assert.match(providerWorker, /load_hunyuan_multiview_shape/, "official multiview weights must load through the dedicated compatibility path");
  assert.match(providerWorker, /original\.replace\("hy3dgen\.shapegen", "hy3dshape"\)/, "only the official package namespace may be translated for the retained runtime config");
  assert.match(providerWorker, /pipeline_class\.from_single_file/, "the untouched official safetensors checkpoint must be loaded directly");
  assert.match(providerWorker, /shape\(image=shape_input/, "the verified single or multiview conditioning must feed the Hunyuan shape pipeline");
  assert.match(providerWorker, /HunyuanDiT text-to-image weights were not loaded/, "reference conditioning must not masquerade as a text-to-image concept inference");
  const serviceSource = await readFile(resolve("src/main/prompt3d/service.ts"), "utf8");
  assert.ok(
    serviceSource.indexOf("retainPrompt3DReferenceImage(referenceSelection, outputDirectory)") < serviceSource.indexOf("await this.preflightAndDispatch(job)"),
    "selected bytes must be retained before provider preflight starts",
  );
  assert.match(serviceSource, /Serial acceptance batches are prompt-only/, "the required serial acceptance batch must remain prompt-only");
  assert.match(serviceSource, /referenceImages: job\.referenceImages/, "generation provenance must retain every reference-image lineage record");
  const rendererSource = await readFile(resolve("src/renderer/pages/NeuralPrompt3D.tsx"), "utf8");
  assert.match(rendererSource, /chooseReferenceImage\(\)/, "each labelled view must use the single-file picker so its role cannot be ambiguous");
  assert.match(rendererSource, /chooseBoundView/, "the creation stage must bind each selected file to an explicit Hunyuan view");
  assert.match(rendererSource, /Each view must use a different image/, "duplicate view files must fail closed");
  assert.match(rendererSource, /\["front","left","right","back"\]/, "the four-view flow must expose every required labelled view in a stable order");
  assert.match(rendererSource, /clearReferenceImages/, "the labelled reference set must provide one safe reset action");
  assert.match(rendererSource, /grudge-media:\/\/local/, "the compact reference picker must show local thumbnails");
  const hunyuan = PROMPT3D_PROVIDERS.find((provider) => provider.id === "hunyuan3d-2");
  assert.deepEqual(hunyuan?.referenceImages, {
    route: "concept-image-to-3d",
    minCount: 1,
    maxCount: 4,
    supportedViews: ["front", "left", "back", "right"],
    requiredViews: ["front"],
    singleViewModelId: "tencent/Hunyuan3D-2.1",
    multiViewModelId: "tencent/Hunyuan3D-2mv",
    multiViewMinCount: 2,
    selectionPolicy: "automatic-by-image-count",
    unsupportedPolicy: "fail-closed",
  }, "provider capabilities must declare automatic single/multiview selection and fail-closed behavior");
  assert.match(serviceSource, /cannot consume every supplied reference image/, "providers without a matching native capability must fail without discarding images");
  assert.match(serviceSource, /has no verified model declaration/, "a missing single-view or multiview model declaration must fail closed");
  const canonical = JSON.parse(binding.specCanonical);
  assert.equal(canonical.referenceSha256, selected.sha256);
  assert.equal(stableJson(canonical), binding.specCanonical);

  console.log("Prompt-to-3D local reference-image intake tests passed.");
} finally {
  await rm(root, { recursive: true, force: true });
}
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
