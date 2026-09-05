import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Prompt3DService } from "../src/main/prompt3d/service";
import { readPrompt3DJobs, savePrompt3DJob } from "../src/main/prompt3d/history";
import {
  approvalProvenanceFields,
  assertGeometryApproval,
  createConceptApproval,
  createConceptBinding,
  inheritConceptHistory,
  nextConceptRetrySpec,
  sha256Hex,
} from "../src/main/prompt3d/conceptApproval";
import { createConceptInspectionEvidence } from "../src/main/prompt3d/conceptInspection";
import { readConceptTechnicalReport } from "../src/main/prompt3d/conceptReview";
import { conceptBindingMatchesSpec, sanitizeAssetSpec, stableJson } from "../src/shared/conceptWorkflow";
import { PROMPT3D_SPEC_VERSION, type AssetSpecV1, type Prompt3DConceptAttempt, type Prompt3DConceptInspectionRecord, type Prompt3DJobStatus } from "../src/shared/prompt3d";
import { compilePrompt3DPrompt, resolveObjectRules, withObjectRules } from "../src/shared/prompt3dRules";

async function main() {
const conceptHash = "a".repeat(64);
const spec = withObjectRules({
  version: PROMPT3D_SPEC_VERSION,
  prompt: "One complete brass handbell with a top loop, handle and open bell mouth",
  category: "prop",
  style: "stylized",
  route: "concept-image-to-3d",
  targetFormat: "glb",
  dimensions: { width: 1, height: 1, depth: 1, unit: "m" },
  budgets: { maxTriangles: 10_000, maxTextureResolution: 2048, maxTextureBytes: 32 * 1024 ** 2 },
  seed: 7,
  variants: 1,
  providerId: "hunyuan3d-2",
  generateTextures: false,
  generateCollision: true,
  generateLods: false,
  coordinateContract: { upAxis: "+Y", forwardAxis: "+Z", origin: "ground-center", stableRootName: "GrudgeAssetRoot" },
} satisfies AssetSpecV1);
const unsupportedSpec = withObjectRules({
  ...spec,
  prompt: "One irregular spiky stone orb, freely suspended in all directions, every point with a separate visible base and tip, no stand or ground",
  seed: 8,
  generateCollision: false,
});
const unsupportedPlan = compilePrompt3DPrompt(unsupportedSpec);
assert.deepEqual(resolveObjectRules(unsupportedSpec).anchor, { x: 0.5, y: 0.5, z: 0.5 }, "unsupported floating props must receive a central animation pivot");
assert.match(unsupportedPlan.generationPrompt, /weightless in empty space/i, "unsupported props must not inherit an upright support-base pose");
assert.doesNotMatch(unsupportedPlan.generationPrompt, /support base at the bottom/i, "explicitly unsupported props must not acquire a pedestal composition");
assert.match(unsupportedPlan.generationPrompt, /separate visible base and tip/i, "visible structural constraints must remain in the conditioning prompt");
assert.ok(unsupportedPlan.generationPrompt.split(/\s+/).length <= 65, "conditioning boilerplate must leave headroom below Hunyuan's 77-token CLIP limit");
assert.match(unsupportedPlan.negativePrompt, /hanging cord, rope, string, fixture/i, "floating props must exclude literal suspension hardware");
assert.doesNotMatch(compilePrompt3DPrompt(spec).negativePrompt, /hanging cord, rope, string, fixture/i, "supported props must retain legitimate cords and strings");
const refinementPlan = compilePrompt3DPrompt(withObjectRules({
  ...unsupportedSpec,
  prompt: `${unsupportedSpec.prompt}. Shape refinement: Make the central mass spherical and preserve at least twenty separate countable spikes with wide bases`,
  seed: 9,
}));
assert.match(refinementPlan.generationPrompt, /irregular spiky stone orb/i, "a refinement must retain a bounded base identity");
assert.match(refinementPlan.generationPrompt, /Required refinement: Make the central mass spherical/i, "a late refinement must be prioritized instead of falling beyond the CLIP window");
assert.ok(refinementPlan.generationPrompt.split(/\s+/).length <= 65, "shape-refinement conditioning must retain CLIP headroom");
const creaturePlan = compilePrompt3DPrompt(withObjectRules({
  ...spec,
  prompt: "One complete adult rabbit in a motion-ready side pose facing right, with two long ears and four separated legs",
  category: "character",
  seed: 10,
}));
assert.match(creaturePlan.generationPrompt, /adult rabbit/i, "an orientation phrase must not discard the creature identity in the same clause");
assert.match(creaturePlan.generationPrompt, /facing right/i, "motion-ready orientation may remain as useful geometry conditioning");
assert.doesNotMatch(creaturePlan.generationPrompt, /creature, upright/i, "generic upright posing must not contradict horizontal or airborne creatures");
const jobId = "11111111-1111-4111-8111-111111111111";
const binding = createConceptBinding(jobId, 1, spec, conceptHash);
const promptPlan = compilePrompt3DPrompt(spec);
const attempt: Prompt3DConceptAttempt = {
  attemptNumber: 1,
  binding,
  conceptImagePath: "E:\\Prompt3D\\jobs\\job\\variant-1\\concept.png",
  promptPlan,
  technicalReview: {
    status: "pass",
    method: "border-connected-white",
    message: "Framing passed; semantics were not checked.",
    reportPath: "E:\\Prompt3D\\jobs\\job\\variant-1\\concept-review.json",
    reportSha256: "b".repeat(64),
    presentationContractSha256: sha256Hex(stableJson(promptPlan.presentationContract)),
    reportVersion: 1,
    semanticResemblanceChecked: false,
    visualReviewRequired: true,
    checkedAt: "2026-09-01T00:00:00.000Z",
  },
  createdAt: "2026-09-01T00:00:00.000Z",
};
const passChecks = { identityAndRequiredParts: "pass", subjectPresentation: "pass", framingBackgroundAndSupport: "pass" } as const;
const inspectionEvidence = createConceptInspectionEvidence(spec, attempt, "approved", passChecks, {
  inspectionId: "33333333-3333-4333-8333-333333333333",
  inspectedAt: "2026-09-01T00:00:30.000Z",
});
const inspection: Prompt3DConceptInspectionRecord = {
  evidence: inspectionEvidence,
  path: "E:\\Prompt3D\\jobs\\job\\variant-1\\concept-inspection.json",
  sha256: sha256Hex(stableJson(inspectionEvidence)),
};

const editableInferredRulesSpec = sanitizeAssetSpec({
  ...unsupportedSpec,
  objectRules: undefined,
  coordinateContract: { ...unsupportedSpec.coordinateContract, origin: "ground-center" },
});
const inferredRulesBinding = createConceptBinding(jobId, 1, editableInferredRulesSpec, conceptHash);
assert.equal(
  conceptBindingMatchesSpec(inferredRulesBinding, editableInferredRulesSpec),
  true,
  "an unchanged editable brief must match the normalized retained concept when object rules and its pivot are inferred",
);

assert.throws(
  () => assertGeometryApproval(jobId, spec, attempt, undefined, conceptHash),
  /Explicit concept approval is required/,
  "a crop/framing pass must not authorize geometry",
);

assert.throws(
  () => createConceptInspectionEvidence(spec, attempt, "approved", { ...passChecks, identityAndRequiredParts: "fail" }),
  /all three/i,
  "technical framing cannot auto-approve a failed semantic identity check",
);
assert.throws(
  () => createConceptInspectionEvidence(spec, attempt, "rejected", { ...passChecks, subjectPresentation: "fail" }, { classification: "semantic-anatomy-parts" }),
  /identity check/i,
  "rejection classification must agree with the explicit failed criterion",
);
const approval = createConceptApproval(binding, "2026-09-01T00:01:00.000Z", inspection.sha256);
assert.doesNotThrow(
  () => assertGeometryApproval(jobId, spec, attempt, approval, conceptHash, inspection),
  "an exact explicit approval must authorize its retained concept",
);

const priorCompilerRecord = JSON.parse(binding.specCanonical);
priorCompilerRecord.promptPlan.generationPrompt = `${priorCompilerRecord.promptPlan.generationPrompt} Retained output from an earlier prompt compiler.`;
const priorCompilerCanonical = stableJson(priorCompilerRecord);
const priorCompilerBinding = {
  ...binding,
  specCanonical: priorCompilerCanonical,
  specFingerprint: sha256Hex(priorCompilerCanonical),
};
const priorCompilerAttempt: Prompt3DConceptAttempt = {
  ...attempt,
  binding: priorCompilerBinding,
  promptPlan: priorCompilerRecord.promptPlan,
};
const priorInspectionEvidence = createConceptInspectionEvidence(spec, priorCompilerAttempt, "approved", passChecks, {
  inspectionId: "55555555-5555-4555-8555-555555555555",
  inspectedAt: "2026-09-01T00:01:20.000Z",
});
const priorInspection: Prompt3DConceptInspectionRecord = { evidence: priorInspectionEvidence, path: inspection.path, sha256: sha256Hex(stableJson(priorInspectionEvidence)) };
const priorCompilerApproval = createConceptApproval(priorCompilerBinding, "2026-09-01T00:01:30.000Z", priorInspection.sha256);
assert.equal(
  conceptBindingMatchesSpec(priorCompilerBinding, spec),
  true,
  "an unchanged editable spec must still match the exact compiler output retained with its concept",
);
assert.doesNotThrow(
  () => assertGeometryApproval(jobId, spec, priorCompilerAttempt, priorCompilerApproval, conceptHash, priorInspection),
  "compiler evolution must not invalidate an unchanged hash-bound retained concept",
);
assert.throws(
  () => assertGeometryApproval(jobId, spec, { ...priorCompilerAttempt, promptPlan: attempt.promptPlan }, priorCompilerApproval, conceptHash, priorInspection),
  /prompt plan/i,
  "the attempt must retain the exact historical compiler output bound into its canonical record",
);
assert.equal(
  conceptBindingMatchesSpec({ ...priorCompilerBinding, workflowVersion: priorCompilerBinding.workflowVersion + 1 }, spec),
  false,
  "an explicit concept-workflow version transition must remain fail-closed",
);

for (const [label, changed, actualHash] of [
  ["prompt", { ...spec, prompt: `${spec.prompt} with engraving` }, conceptHash],
  ["seed", { ...spec, seed: spec.seed + 1 }, conceptHash],
  ["provider", { ...spec, providerId: "trellis", route: "direct-text" }, conceptHash],
  ["spec", { ...spec, dimensions: { ...spec.dimensions, height: 2 } }, conceptHash],
  ["hash", spec, "b".repeat(64)],
] as const) {
  assert.throws(
    () => assertGeometryApproval(jobId, changed as AssetSpecV1, attempt, approval, actualHash, inspection),
    /approval|stale|hash|provider/i,
    `${label} changes must invalidate approval`,
  );
}

const previous: Prompt3DJobStatus = {
  id: jobId,
  state: "failed",
  stage: "concept-review",
  progress: 35,
  providerId: spec.providerId,
  spec,
  message: "awaiting",
  outputDirectory: "E:\\Prompt3D\\jobs\\job",
  variants: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  conceptAttempt: attempt,
  conceptAttempts: [attempt],
  conceptInspection: {
    evidence: createConceptInspectionEvidence(spec, attempt, "rejected", { ...passChecks, identityAndRequiredParts: "fail" }, {
      classification: "semantic-anatomy-parts",
      inspectionId: "66666666-6666-4666-8666-666666666666",
      inspectedAt: "2026-09-01T00:01:45.000Z",
    }),
    path: inspection.path,
    sha256: "",
  },
  approvedConcept: false,
  error: { code: "CONCEPT_SEMANTIC_REJECTED", message: "rejected", retryable: true },
};
previous.conceptInspection!.sha256 = sha256Hex(stableJson(previous.conceptInspection!.evidence));
previous.conceptInspections = [previous.conceptInspection!];
const retried = nextConceptRetrySpec(spec);
assert.equal(retried.seed, spec.seed + 1, "concept regeneration increments the seed exactly once");
assert.equal(retried.variants, 1, "concept regeneration remains one retained attempt");
assert.equal(retried.generateTextures, false, "concept regeneration cannot spend texture work");
const inherited = inheritConceptHistory(previous, "22222222-2222-4222-8222-222222222222", "regenerated", "2026-09-01T00:02:00.000Z", retried);
assert.deepEqual(inherited.attempts, [attempt], "regeneration preserves the immutable prior concept attempt");
assert.equal(inherited.decisions.at(-1)?.kind, "regenerated");
assert.equal(inherited.decisions.at(-1)?.nextJobId, "22222222-2222-4222-8222-222222222222");
assert.equal(inherited.decisions.at(-1)?.nextSeed, retried.seed, "successor decisions bind the exact next seed");
assert.equal(inherited.decisions.at(-1)?.inspectionSha256, previous.conceptInspection.sha256, "successor decisions bind the exact rejected inspection");

const legacy = { ...spec, originalPrompt: "a multi pointed 3d star shaped asteroid", approvedConcept: true } as AssetSpecV1;
const sanitized = sanitizeAssetSpec(legacy);
assert.ok(!("originalPrompt" in sanitized), "stale originalPrompt must never reappear in a current AssetSpec");
assert.ok(!("approvedConcept" in sanitized), "renderer/provider workflow fields must not enter a current AssetSpec");
assert.equal(sanitized.prompt, spec.prompt);

const provenance = approvalProvenanceFields(jobId, spec, attempt, approval, conceptHash, inspection);
assert.equal(provenance.approvedConcept, true);
assert.deepEqual(provenance.conceptApproval, approval, "final provenance uses the exact retained approval");
assert.throws(
  () => approvalProvenanceFields(jobId, spec, attempt, { ...approval, approvedAt: "invalid" }, conceptHash, inspection),
  /approval/i,
  "approvedConcept and provenance cannot disagree",
);

const serviceRoot = await mkdtemp(join(tmpdir(), "grudge-concept-approval-service-"));
try {
  const isolationReviewPath = join(serviceRoot, "hunyuan-isolation-review.json");
  const isolationReview = {
    version: 1,
    method: "hunyuan-upstream-rembg-u2net-normalized",
    technicalStatus: "pass",
    semanticResemblanceChecked: false,
    visualReviewRequired: true,
    providerSourcePath: "concept-source.png",
    providerSourceSha256: "a".repeat(64),
    normalization: { mode: "isolated-provider-pixels-centered", sourceForegroundBounds: [10, 10, 200, 200], sourceMarginPixels: 10, maximumCanvasFraction: 0.5, scale: 0.5, offset: [256, 256] },
    conditioningIsolation: { method: "hunyuan-upstream-rembg-u2net", modelPath: "models/rembg/u2net.onnx", modelSha256: "8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491", providerSourceRevision: "82920d643c0dc2f7bfd7255f45f62d386edfe60c" },
  };
  await writeFile(isolationReviewPath, JSON.stringify(isolationReview));
  assert.equal((await readConceptTechnicalReport(serviceRoot, isolationReviewPath, "pass")).report.conditioningIsolation?.method, "hunyuan-upstream-rembg-u2net");
  await writeFile(isolationReviewPath, JSON.stringify({ ...isolationReview, conditioningIsolation: { ...isolationReview.conditioningIsolation, modelSha256: "b".repeat(64) } }));
  await assert.rejects(readConceptTechnicalReport(serviceRoot, isolationReviewPath, "pass"), /pinned upstream/i, "a different isolation weight cannot enter retained provenance");

  const serviceJobId = "44444444-4444-4444-8444-444444444444";
  const outputDirectory = join(serviceRoot, "jobs", serviceJobId);
  const variantDirectory = join(outputDirectory, "variant-1");
  await mkdir(variantDirectory, { recursive: true });
  const conceptImagePath = join(variantDirectory, "concept.png");
  const conceptBytes = Buffer.from("retained-concept-fixture");
  await writeFile(conceptImagePath, conceptBytes);
  const serviceReviewPath = join(variantDirectory, "concept-review.json");
  const serviceReviewBytes = `${JSON.stringify({ version: 1, method: "fixture", technicalStatus: "pass", semanticResemblanceChecked: false, visualReviewRequired: true })}\n`;
  await writeFile(serviceReviewPath, serviceReviewBytes);
  const currentServiceBinding = createConceptBinding(serviceJobId, 1, spec, sha256Hex(conceptBytes));
  const retainedServiceRecord = JSON.parse(currentServiceBinding.specCanonical);
  retainedServiceRecord.promptPlan.generationPrompt = `${retainedServiceRecord.promptPlan.generationPrompt} Retained output from an earlier prompt compiler.`;
  const retainedServiceCanonical = stableJson(retainedServiceRecord);
  const serviceBinding = { ...currentServiceBinding, specCanonical: retainedServiceCanonical, specFingerprint: sha256Hex(retainedServiceCanonical) };
  const serviceAttempt: Prompt3DConceptAttempt = { ...attempt, binding: serviceBinding, promptPlan: retainedServiceRecord.promptPlan, conceptImagePath, technicalReview: { ...attempt.technicalReview, method: "fixture", reportPath: serviceReviewPath, reportSha256: sha256Hex(serviceReviewBytes), presentationContractSha256: sha256Hex(stableJson(retainedServiceRecord.promptPlan.presentationContract)) } };
  const pendingJob: Prompt3DJobStatus = {
    ...previous,
    id: serviceJobId,
    state: "awaiting-concept-approval",
    stage: "awaiting-concept-approval",
    outputDirectory,
    conceptImagePath,
    conceptAttempt: serviceAttempt,
    conceptAttempts: [serviceAttempt],
    conceptInspection: undefined,
    conceptInspections: [],
    error: undefined,
  };
  const service = new Prompt3DService({ root: serviceRoot, appRoot: join(__dirname, ".."), offlineLocalTest: true });
  (service as unknown as { jobs: Map<string, Prompt3DJobStatus> }).jobs.set(serviceJobId, pendingJob);
  let preflightCount = 0;
  (service as unknown as { preflightAndDispatch: (job: Prompt3DJobStatus) => Promise<void> }).preflightAndDispatch = async () => { preflightCount += 1; };
  const token = service.grant();
  const rejectedServiceJobId = "77777777-7777-4777-8777-777777777777";
  const rejectedDirectory = join(serviceRoot, "jobs", rejectedServiceJobId, "variant-1");
  await mkdir(rejectedDirectory, { recursive: true });
  const rejectedConceptPath = join(rejectedDirectory, "concept.png");
  const rejectedConceptBytes = Buffer.from("retained-rejected-concept-fixture");
  await writeFile(rejectedConceptPath, rejectedConceptBytes);
  const rejectedReviewPath = join(rejectedDirectory, "concept-review.json");
  await writeFile(rejectedReviewPath, serviceReviewBytes);
  const rejectedBinding = createConceptBinding(rejectedServiceJobId, 1, spec, sha256Hex(rejectedConceptBytes));
  const rejectedPlan = JSON.parse(rejectedBinding.specCanonical).promptPlan;
  const rejectedAttempt: Prompt3DConceptAttempt = {
    ...serviceAttempt,
    binding: rejectedBinding,
    promptPlan: rejectedPlan,
    conceptImagePath: rejectedConceptPath,
    technicalReview: {
      ...serviceAttempt.technicalReview,
      reportPath: rejectedReviewPath,
      presentationContractSha256: sha256Hex(stableJson(rejectedPlan.presentationContract)),
    },
  };
  const rejectedPending: Prompt3DJobStatus = {
    ...pendingJob,
    id: rejectedServiceJobId,
    outputDirectory: join(serviceRoot, "jobs", rejectedServiceJobId),
    conceptImagePath: rejectedConceptPath,
    conceptAttempt: rejectedAttempt,
    conceptAttempts: [rejectedAttempt],
  };
  (service as unknown as { jobs: Map<string, Prompt3DJobStatus> }).jobs.set(rejectedServiceJobId, rejectedPending);
  await assert.rejects(service.regenerateConcept(token, rejectedServiceJobId), /classify/i, "a pending concept cannot bypass explicit rejection classification");
  const rejectedStatus = await service.rejectConcept(token, {
    jobId: rejectedServiceJobId,
    binding: rejectedBinding,
    inspection: {
      checks: { ...passChecks, identityAndRequiredParts: "fail" },
      classification: "semantic-anatomy-parts",
      note: "The generated bell is missing the required top loop.",
    },
  });
  assert.equal(rejectedStatus.error?.code, "CONCEPT_SEMANTIC_REJECTED");
  assert.equal(rejectedStatus.conceptInspection?.evidence.rejection?.classification, "semantic-anatomy-parts");
  assert.equal(rejectedStatus.conceptDecisions?.at(-1)?.inspectionSha256, rejectedStatus.conceptInspection?.sha256);
  assert.deepEqual(JSON.parse(await readFile(join(rejectedDirectory, "concept-inspection.json"), "utf8")), rejectedStatus.conceptInspection?.evidence);
  const regenerated = await service.regenerateConcept(token, rejectedServiceJobId);
  assert.equal(regenerated.spec.seed, spec.seed + 1);
  assert.equal(regenerated.conceptDecisions?.at(-1)?.nextSeed, spec.seed + 1);
  assert.equal(regenerated.conceptDecisions?.at(-1)?.inspectionSha256, rejectedStatus.conceptInspection?.sha256);
  regenerated.state = "failed";
  regenerated.stage = "failed";
  const preflightBeforeApproval = preflightCount;
  const approved = await service.approveConcept(token, { jobId: serviceJobId, binding: serviceBinding, inspection: { checks: passChecks } });
  assert.equal(approved.state, "running", "durable approval must transition to a separately preflighted geometry resume");
  assert.equal(approved.conceptApproval?.specCanonical, retainedServiceCanonical, "approval must preserve the exact historical compiler output rather than silently rebinding it");
  assert.equal(approved.approvedConcept, true);
  assert.equal(approved.conceptApproval?.source, "explicit-user-action");
  assert.equal(preflightCount, preflightBeforeApproval + 1, "concept approval must dispatch geometry once");
  for (const path of [join(outputDirectory, "asset-spec.json"), join(variantDirectory, "asset-spec.json")]) {
    const recorded = JSON.parse(await readFile(path, "utf8"));
    assert.equal(recorded.prompt, spec.prompt, "root and variant specs must retain the exact current prompt");
    assert.equal(recorded.approvedConcept, true, "root and variant specs must agree with geometry authorization");
    assert.deepEqual(recorded.conceptApproval, approved.conceptApproval);
    assert.deepEqual(recorded.conceptInspection, approved.conceptInspection, "recorded specs retain the exact three-check inspection");
    assert.ok(!Object.hasOwn(recorded, "originalPrompt"), "stale originalPrompt must not be serialized");
  }
  const retainedApproval = JSON.parse(await readFile(join(variantDirectory, "concept-approval.json"), "utf8"));
  assert.deepEqual(retainedApproval, approved.conceptApproval, "approval must be durably retained before geometry preflight");
  const retainedInspection = JSON.parse(await readFile(join(variantDirectory, "concept-inspection.json"), "utf8"));
  assert.deepEqual(retainedInspection, approved.conceptInspection?.evidence, "inspection must be durably retained before geometry preflight");
  approved.state = "failed";
  approved.stage = "failed";
  approved.error = { code: "PROVIDER_FAILED", message: "setup-required: transient WSL probe failure", retryable: true };
  const retried = await service.retry(token, serviceJobId);
  assert.equal(retried.id, serviceJobId, "a recoverable pre-geometry failure must retry the exact approved job");
  assert.equal(retried.spec.seed, spec.seed, "retrying approved geometry must not create a fresh concept seed");
  assert.deepEqual(retried.conceptApproval, approved.conceptApproval, "retrying geometry must preserve the exact retained approval");
  assert.equal(retried.error, undefined, "a successful retry admission clears the recoverable error");
  assert.equal(preflightCount, preflightBeforeApproval + 2, "retrying the retained approval must dispatch geometry once more");
  const restored = await readPrompt3DJobs(serviceRoot);
  assert.equal(restored.find((job) => job.id === serviceJobId)?.error?.code, "INTERRUPTED", "an authentic approved resume reloads as interrupted, not as an approval mismatch");
  await writeFile(conceptImagePath, Buffer.from("tampered-concept-fixture"));
  const tampered = await readPrompt3DJobs(serviceRoot);
  assert.equal(tampered.find((job) => job.id === serviceJobId)?.error?.code, "CONCEPT_APPROVAL_MISMATCH", "changed retained concept bytes must fail closed on reload");
  assert.equal(tampered.find((job) => job.id === serviceJobId)?.error?.retryable, false, "a mismatched saved approval cannot be retried as geometry");

  const legacyPendingJobId = "88888888-8888-4888-8888-888888888888";
  const legacyPendingDirectory = join(serviceRoot, "jobs", legacyPendingJobId);
  const legacyPendingVariant = join(legacyPendingDirectory, "variant-1");
  await mkdir(legacyPendingVariant, { recursive: true });
  const legacyConceptPath = join(legacyPendingVariant, "concept.png");
  const legacyConceptBytes = Buffer.from("legacy-concept-fixture");
  await writeFile(legacyConceptPath, legacyConceptBytes);
  const currentLegacyBinding = createConceptBinding(legacyPendingJobId, 1, spec, sha256Hex(legacyConceptBytes));
  const legacyRecord = JSON.parse(currentLegacyBinding.specCanonical);
  delete legacyRecord.promptPlan.presentationContract;
  const legacyCanonical = stableJson(legacyRecord);
  const legacyBinding = {
    ...currentLegacyBinding,
    specCanonical: legacyCanonical,
    specFingerprint: sha256Hex(legacyCanonical),
  };
  const legacyAttempt: Prompt3DConceptAttempt = {
    ...attempt,
    binding: legacyBinding,
    promptPlan: legacyRecord.promptPlan,
    conceptImagePath: legacyConceptPath,
    technicalReview: {
      status: "pass",
      method: "legacy-fixture",
      message: "Legacy technical framing check.",
      reportPath: join(legacyPendingVariant, "concept-review.json"),
      checkedAt: "2026-09-01T00:00:00.000Z",
    },
  };
  const legacyPending: Prompt3DJobStatus = {
    ...pendingJob,
    id: legacyPendingJobId,
    outputDirectory: legacyPendingDirectory,
    conceptImagePath: legacyConceptPath,
    conceptAttempt: legacyAttempt,
    conceptAttempts: [legacyAttempt],
    conceptInspection: undefined,
    conceptInspections: undefined,
  };
  savePrompt3DJob(serviceRoot, legacyPending);
  const legacyPendingRestored = (await readPrompt3DJobs(serviceRoot)).find((job) => job.id === legacyPendingJobId);
  assert.equal(legacyPendingRestored?.error?.code, "CONCEPT_INSPECTION_UPGRADE_REQUIRED", "a pending legacy concept must fail closed until fresh structured generation");
  assert.equal(legacyPendingRestored?.error?.retryable, true, "a pending legacy concept remains explicitly regenerable with a new seed");

  const legacyCompleteJobId = "99999999-9999-4999-8999-999999999999";
  const legacyCompleteDirectory = join(serviceRoot, "jobs", legacyCompleteJobId);
  const legacyCompleteVariant = join(legacyCompleteDirectory, "variant-1");
  await mkdir(legacyCompleteVariant, { recursive: true });
  const legacyCompleteConceptPath = join(legacyCompleteVariant, "concept.png");
  await writeFile(legacyCompleteConceptPath, legacyConceptBytes);
  const currentCompleteBinding = createConceptBinding(legacyCompleteJobId, 1, spec, sha256Hex(legacyConceptBytes));
  const completeRecord = JSON.parse(currentCompleteBinding.specCanonical);
  delete completeRecord.promptPlan.presentationContract;
  const completeCanonical = stableJson(completeRecord);
  const completeBinding = { ...currentCompleteBinding, specCanonical: completeCanonical, specFingerprint: sha256Hex(completeCanonical) };
  const completeAttempt: Prompt3DConceptAttempt = {
    ...legacyAttempt,
    binding: completeBinding,
    promptPlan: completeRecord.promptPlan,
    conceptImagePath: legacyCompleteConceptPath,
    technicalReview: { ...legacyAttempt.technicalReview, reportPath: join(legacyCompleteVariant, "concept-review.json") },
  };
  const legacyComplete: Prompt3DJobStatus = {
    ...legacyPending,
    id: legacyCompleteJobId,
    state: "complete",
    stage: "complete",
    progress: 100,
    message: "Legacy completed asset retained.",
    outputDirectory: legacyCompleteDirectory,
    conceptImagePath: legacyCompleteConceptPath,
    conceptAttempt: completeAttempt,
    conceptAttempts: [completeAttempt],
    approvedConcept: true,
    conceptApproval: createConceptApproval(completeBinding, "2026-09-01T00:01:00.000Z"),
    error: undefined,
  };
  savePrompt3DJob(serviceRoot, legacyComplete);
  const legacyCompleteRestored = (await readPrompt3DJobs(serviceRoot)).find((job) => job.id === legacyCompleteJobId);
  assert.equal(legacyCompleteRestored?.state, "complete", "an already completed legacy asset remains reopenable without retroactive inspection evidence");
  assert.equal(legacyCompleteRestored?.error, undefined, "legacy completion is not rewritten as a pending authorization failure");
  service.shutdown();
} finally {
  await rm(serviceRoot, { recursive: true, force: true });
}

const workerSource = await readFile(join(__dirname, "..", "tools", "prompt3d", "provider_worker.py"), "utf8");
assert.ok(workerSource.includes("verify_concept_approval(spec, concept_path)"), "provider worker must independently verify the retained approval");
assert.ok(workerSource.includes('"prompt": spec["prompt"]'), "concept-prompt.json must retain the exact current user prompt, not replace it with the generated conditioning prompt");
assert.ok(workerSource.includes("approval_binding != binding"), "provider worker must independently match approval to the retained attempt binding");
assert.ok(workerSource.includes("Semantic resemblance, required parts and artistic quality remain unverified"), "technical review must not claim semantic resemblance");
assert.ok(workerSource.includes("hashlib.sha256(review_bytes).hexdigest() != review.get(\"reportSha256\")"), "provider geometry must independently hash the exact technical-review bytes");
assert.ok(workerSource.includes("evidence.get(\"presentationContractSha256\") != presentation_sha"), "provider geometry must independently bind inspection to the effective presentation contract");
assert.ok(workerSource.includes("identityAndRequiredParts\", \"subjectPresentation\", \"framingBackgroundAndSupport"), "provider geometry must independently require all three explicit inspection checks");
assert.ok(workerSource.includes("retained_evidence != evidence"), "provider geometry must fail closed when the retained inspection file changes");
assert.ok(workerSource.includes("if not approved:"), "Hunyuan must stop before geometry without explicit approval");
assert.ok(workerSource.includes("sha256_file(model) != HUNYUAN_REMBG_SHA256"), "provider concepts must fail closed unless the official isolation weight matches its pinned SHA-256");

  process.stdout.write("Prompt-to-3D concept approval and provenance state-machine checks passed.\n");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
