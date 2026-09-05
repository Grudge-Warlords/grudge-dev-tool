import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Prompt3DService } from "../src/main/prompt3d/service";
import { createConceptApproval, createConceptBinding, inheritConceptHistory, sha256Hex } from "../src/main/prompt3d/conceptApproval";
import { stableJson } from "../src/shared/conceptWorkflow";
import { withObjectRules } from "../src/shared/prompt3dRules";
import { PROMPT3D_SPEC_VERSION, type AssetSpecV1, type Prompt3DConceptAttempt, type Prompt3DJobStatus } from "../src/shared/prompt3d";
import type { Prompt3DBatchRequest, Prompt3DBatchRuntimeItem, Prompt3DBatchStatus } from "../src/shared/prompt3dWorkflow";
import type { Prompt3DVisualInspectionEvidence } from "../src/shared/prompt3dVisualInspection";

async function main() {
const root = await mkdtemp(join(tmpdir(), "grudge-rejected-refinement-"));
try {
  const baseId = "11111111-1111-4111-8111-111111111111";
  const failedId = "33333333-3333-4333-8333-333333333333";
  const rejectedId = "22222222-2222-4222-8222-222222222222";
  const assetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const geometryInspection = (jobId: string, assetSha256: string): Prompt3DVisualInspectionEvidence => ({
    version: 1,
    assetPath: join(root, "jobs", jobId, "variant-1", "asset.glb"),
    assetSha256,
    stage: "geometry",
    viewpoints: ["front", "right", "back", "left"].map((preset) => ({
      preset: preset as "front" | "right" | "back" | "left",
      inspectedAt: "2026-09-02T00:01:00.000Z",
    })),
    attestations: { geometryIdentityAndCompleteness: { accepted: true, at: "2026-09-02T00:01:00.000Z" } },
    clips: [],
    updatedAt: "2026-09-02T00:01:00.000Z",
    completedAt: "2026-09-02T00:01:00.000Z",
  });
  const baseSpec = withObjectRules({
    version: PROMPT3D_SPEC_VERSION,
    prompt: "One complete custom stone creature with four separated legs and one long tail",
    category: "character",
    style: "realistic",
    route: "concept-image-to-3d",
    targetFormat: "glb",
    dimensions: { width: 1, height: 1, depth: 1, unit: "m" },
    budgets: { maxTriangles: 50_000, maxTextureResolution: 1024, maxTextureBytes: 32 * 1024 ** 2 },
    seed: 40,
    variants: 1,
    providerId: "hunyuan3d-2",
    generateTextures: false,
    generateCollision: false,
    generateLods: false,
    coordinateContract: { upAxis: "+Y", forwardAxis: "+Z", origin: "ground-center", stableRootName: "GrudgeAssetRoot" },
  } satisfies AssetSpecV1);
  const firstRefinement = "Make all four legs thicker and keep the tail separate from the body";
  const failedSpec: AssetSpecV1 = {
    ...baseSpec,
    prompt: `${baseSpec.prompt}\n\nShape refinement: ${firstRefinement}`,
    seed: baseSpec.seed + 1,
  };
  const rejectedSpec: AssetSpecV1 = { ...failedSpec, seed: failedSpec.seed + 1 };

  async function attempt(jobId: string, spec: AssetSpecV1, attemptNumber = 1): Promise<Prompt3DConceptAttempt> {
    const conceptImagePath = join(root, "jobs", jobId, "variant-1", "concept.png");
    await mkdir(join(root, "jobs", jobId, "variant-1"), { recursive: true });
    const conceptBytes = Buffer.from(`retained-concept-${jobId}`);
    await writeFile(conceptImagePath, conceptBytes);
    const currentBinding = createConceptBinding(jobId, attemptNumber, spec, sha256Hex(conceptBytes));
    const canonical = JSON.parse(currentBinding.specCanonical);
    // This geometry-rejection fixture also proves that completed pre-inspection
    // attempts remain readable; structured inspection behavior has its own suite.
    delete canonical.promptPlan.presentationContract;
    const legacyCanonical = stableJson(canonical);
    const binding = { ...currentBinding, specCanonical: legacyCanonical, specFingerprint: sha256Hex(legacyCanonical) };
    return {
      attemptNumber,
      binding,
      conceptImagePath,
      promptPlan: canonical.promptPlan,
      technicalReview: {
        status: "pass",
        method: "fixture",
        message: "fixture",
        reportPath: join(root, "jobs", jobId, "variant-1", "concept-review.json"),
        checkedAt: "2026-09-02T00:00:00.000Z",
      },
      createdAt: "2026-09-02T00:00:00.000Z",
    };
  }

  function variant(jobId: string, visualApproval = false): Prompt3DJobStatus["variants"][number] {
    const sha256 = jobId === baseId ? "b".repeat(64) : "c".repeat(64);
    const geometryHash = jobId === baseId ? "d".repeat(64) : "e".repeat(64);
    return {
      index: 0,
      glbPath: join(root, "jobs", jobId, "variant-1", "asset.glb"),
      report: { gameReady: true, deterministicId: `${jobId}:validation`, checks: [] } as any,
      provenancePath: join(root, "jobs", jobId, "variant-1", "provenance.json"),
      sha256,
      geometryHash,
      byteSize: 128,
      validationReportSha256: "f".repeat(64),
      provenanceSha256: "1".repeat(64),
      ...(visualApproval ? {
        visualApproval: {
          version: 1,
          approvalId: "2".repeat(64),
          bindingSha256: "2".repeat(64),
          source: "explicit-user-action",
          approvedAt: "2026-09-02T00:01:00.000Z",
          stage: "geometry",
          assetId,
          jobId,
          assetPath: join(root, "jobs", jobId, "variant-1", "asset.glb"),
          assetSha256: sha256,
          geometryHash,
          promptSha256: "3".repeat(64),
          specFingerprint: "4".repeat(64),
          inspection: geometryInspection(jobId, sha256),
        },
        visualApprovalPath: join(root, "jobs", jobId, "variant-1", "visual-approval.json"),
        visualApprovalSha256: "5".repeat(64),
      } : {}),
    };
  }

  async function completedJob(jobId: string, spec: AssetSpecV1, parentJobId?: string, approved = false): Promise<Prompt3DJobStatus> {
    const outputDirectory = join(root, "jobs", jobId);
    await mkdir(join(outputDirectory, "variant-1"), { recursive: true });
    const conceptAttempt = await attempt(jobId, spec);
    return {
      id: jobId,
      assetId,
      ...(parentJobId ? { parentJobId } : {}),
      state: "complete",
      stage: "complete",
      progress: 100,
      providerId: "hunyuan3d-2",
      spec,
      message: "Technical geometry checks passed; awaiting visual decision.",
      outputDirectory,
      variants: [variant(jobId, approved)],
      conceptImagePath: conceptAttempt.conceptImagePath,
      conceptAttempt,
      conceptAttempts: [conceptAttempt],
      conceptApproval: createConceptApproval(conceptAttempt.binding, "2026-09-02T00:00:30.000Z"),
      approvedConcept: true,
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:01:00.000Z",
    };
  }

  const base = await completedJob(baseId, baseSpec, undefined, true);
  const failed = await completedJob(failedId, failedSpec, baseId, false);
  const failedHistory = inheritConceptHistory(base, failedId, "edited", "2026-09-02T00:02:00.000Z");
  failed.conceptAttempts = [...failedHistory.attempts, failed.conceptAttempt!];
  failed.conceptDecisions = failedHistory.decisions;
  failed.state = "failed";
  failed.stage = "failed";
  failed.variants = [];
  failed.approvedConcept = false;
  delete failed.conceptApproval;
  failed.error = { code: "PROVIDER_FAILED", message: "Concept retained but geometry was not produced.", retryable: true };
  const rejected = await completedJob(rejectedId, rejectedSpec, failedId, false);
  const rejectedHistory = inheritConceptHistory(failed, rejectedId, "regenerated", "2026-09-02T00:03:00.000Z");
  rejected.conceptAttempts = [...rejectedHistory.attempts, rejected.conceptAttempt!];
  rejected.conceptDecisions = rejectedHistory.decisions;
  const service = new Prompt3DService({ root, appRoot: join(__dirname, ".."), offlineLocalTest: true });
  const internals = service as any;
  internals.jobs.set(baseId, base);
  internals.jobs.set(failedId, failed);
  internals.jobs.set(rejectedId, rejected);
  internals.verifyGenerationVariant = async (job: Prompt3DJobStatus) => {
    const retained = job.variants[0];
    return {
      variant: retained,
      path: retained.glbPath,
      inspection: { sha256: retained.sha256, geometryHash: retained.geometryHash, byteSize: retained.byteSize },
      provenancePath: retained.provenancePath,
      provenanceSha256: retained.provenanceSha256,
    };
  };
  internals.verifyRetainedVisualApproval = async (approval: unknown) => {
    if (!approval) throw new Error("Persisted visual approval is missing.");
    return approval;
  };
  internals.preflightAndDispatch = async () => undefined;
  const token = service.grant();
  const correction = "Shorten the front legs, widen all paws and keep the tail visibly detached from every leg";
  const correctionSpec: AssetSpecV1 = {
    ...rejectedSpec,
    prompt: `${rejectedSpec.prompt}\n\nShape refinement: ${correction}`,
    seed: rejectedSpec.seed + 1,
  };

  await assert.rejects(
    service.start(token, {
      spec: { ...correctionSpec, prompt: `${baseSpec.prompt}\n\nShape refinement: ${correction}` },
      rejectedGeometryJobId: rejectedId,
      conceptChangeReason: "edited",
      shapeRefinement: true,
      consent: { providerId: "hunyuan3d-2", confirmed: true },
    }),
    /retain the rejected brief/i,
    "the backend must reject a correction that drops the visually rejected attempt's accumulated brief",
  );

  await assert.rejects(
    service.start(token, {
      spec: correctionSpec,
      parentConceptJobId: failedId,
      rejectedGeometryJobId: rejectedId,
      conceptChangeReason: "edited",
      shapeRefinement: true,
      consent: { providerId: "hunyuan3d-2", confirmed: true },
    }),
    /not the nearest verified approved/i,
    "the renderer or caller cannot nominate an unapproved direct parent in place of the verified ancestor",
  );

  const successor = await service.start(token, {
    spec: correctionSpec,
    rejectedGeometryJobId: rejectedId,
    conceptChangeReason: "edited",
    shapeRefinement: true,
    consent: { providerId: "hunyuan3d-2", confirmed: true },
  });
  assert.equal(successor.parentJobId, baseId, "accepted ancestry must resume from the last approved geometry");
  assert.equal(successor.shapeRefinement, true, "the corrective job must retain its shape-refinement role across reloads");
  assert.equal(successor.rejectedGeometryJobId, rejectedId, "the corrective successor must retain an explicit rejected-job link");
  assert.ok(!successor.conceptAttempts?.some((entry) => entry.binding.jobId === rejectedId), "the rejected concept must not enter the successor's accepted concept history");
  assert.ok(!successor.conceptAttempts?.some((entry) => entry.binding.jobId === failedId), "failed intermediate attempts remain rejection audit evidence rather than accepted ancestry");
  assert.equal(rejected.variants[0].visualApproval, undefined, "creating a correction must never approve the rejected GLB");
  assert.equal(rejected.geometryRejection?.approvedAncestorJobId, baseId);
  assert.equal(rejected.geometryRejection?.successorJobId, successor.id);
  assert.equal(rejected.geometryRejection?.correctivePrompt, correction);
  assert.equal(rejected.geometryRejection?.correctivePromptSha256, sha256Hex(correction));
  assert.deepEqual(rejected.geometryRejection?.retainedAncestry.map((entry) => entry.jobId), [rejectedId, failedId, baseId], "the rejection record must retain every traversed concept/geometry attempt in order");
  assert.ok(rejected.geometryRejectionPath && rejected.geometryRejectionSha256, "rejection evidence must be retained by path and hash");
  const rejectionBytes = await readFile(rejected.geometryRejectionPath!);
  assert.equal(sha256Hex(rejectionBytes), rejected.geometryRejectionSha256, "retained rejection evidence must match its hash");
  assert.deepEqual(JSON.parse(rejectionBytes.toString("utf8")), rejected.geometryRejection);
  await assert.rejects(
    service.workflowApproveVisual(token, {
      source: { kind: "generation", jobId: rejectedId, variantIndex: 0 },
      inspection: geometryInspection(rejectedId, "c".repeat(64)),
    }),
    /explicitly rejected/i,
    "an explicitly rejected mesh must never become an accepted workflow root later",
  );

  successor.state = "failed";
  successor.stage = "failed";

  const refinementConceptId = "89898989-8989-4989-8989-898989898989";
  const refinementBatchId = "90909090-9090-4090-8090-909090909090";
  const refinementBatchItemId = "91919191-9191-4191-8191-919191919191";
  const refinementSpec: AssetSpecV1 = {
    ...baseSpec,
    prompt: `${baseSpec.prompt}\n\nShape refinement: make the approved silhouette taller while retaining all named anatomy`,
    seed: baseSpec.seed + 1,
  };
  const pendingRefinement = await completedJob(refinementConceptId, refinementSpec, baseId);
  pendingRefinement.shapeRefinement = true;
  pendingRefinement.state = "awaiting-concept-approval";
  pendingRefinement.stage = "awaiting-concept-approval";
  pendingRefinement.variants = [];
  pendingRefinement.approvedConcept = false;
  delete pendingRefinement.conceptApproval;
  pendingRefinement.conceptAttempt = await attempt(refinementConceptId, refinementSpec, 2);
  const refinementHistory = inheritConceptHistory(base, refinementConceptId, "edited", "2026-09-02T00:03:30.000Z");
  pendingRefinement.conceptAttempts = [...refinementHistory.attempts, pendingRefinement.conceptAttempt];
  pendingRefinement.conceptDecisions = refinementHistory.decisions;
  internals.jobs.set(refinementConceptId, pendingRefinement);

  const refinementBatchDirectory = join(root, "workflow-batches", refinementBatchId);
  await mkdir(refinementBatchDirectory, { recursive: true });
  const refinementBatchRequest: Prompt3DBatchRequest = {
    name: "Refined concept regeneration fixture",
    items: [{
      id: refinementBatchItemId,
      name: "Stone creature refinement",
      spec: baseSpec,
      shapeRefinement: "make the approved silhouette taller while retaining all named anatomy",
      texturePrompts: ["apply stone material", "refine stone material"],
      animationRevisions: [{ prompt: "move", mode: "replace" }, { prompt: "refine movement", mode: "append" }],
    }],
  };
  const refinementRuntime: Prompt3DBatchRuntimeItem = {
    baseComplete: true,
    shapeComplete: false,
    nextTexture: 0,
    nextAnimation: 0,
    currentKind: "shape",
    currentJobId: refinementConceptId,
    currentSource: { kind: "generation", jobId: baseId, variantIndex: 0 },
  };
  const refinementBatch: Prompt3DBatchStatus = {
    version: 1,
    id: refinementBatchId,
    name: refinementBatchRequest.name,
    state: "awaiting-approval",
    request: refinementBatchRequest,
    runtime: { [refinementBatchItemId]: refinementRuntime },
    items: [{ id: refinementBatchItemId, name: "Stone creature refinement", state: "awaiting-approval", progress: 37, currentJobId: refinementConceptId, message: "Inspect refined concept." }],
    createdAt: "2026-09-02T00:03:30.000Z",
    updatedAt: "2026-09-02T00:03:30.000Z",
    manifestPath: join(refinementBatchDirectory, "manifest.json"),
    message: "Inspect refined concept.",
  };
  internals.batches.set(refinementBatchId, refinementBatch);
  internals.batchRequests.set(refinementBatchId, refinementBatchRequest);
  internals.batchRuntime.set(refinementBatchId, new Map([[refinementBatchItemId, refinementRuntime]]));
  internals.batchTokens.set(refinementBatchId, token);
  internals.batchJobLinks.set(refinementConceptId, refinementBatchId);
  internals.queueBatchAdvance = () => undefined;

  pendingRefinement.state = "failed";
  pendingRefinement.stage = "concept-review";
  pendingRefinement.error = { code: "CONCEPT_QUALITY_REJECTED", message: "technical fixture rejection", retryable: true };
  const firstConceptRetry = await service.regenerateConcept(token, refinementConceptId);
  assert.equal(firstConceptRetry.shapeRefinement, true, "regenerating a refined concept must preserve its shape-refinement role");
  assert.equal(firstConceptRetry.parentJobId, baseId, "regeneration must retain the last approved geometry as its lineage parent");
  assert.equal(firstConceptRetry.conceptParentJobId, refinementConceptId, "regeneration must separately retain the rejected concept attempt parent");
  assert.equal(firstConceptRetry.spec.seed, refinementSpec.seed + 1, "each concept regeneration increments the preceding attempt seed exactly once");
  assert.equal(refinementRuntime.currentJobId, firstConceptRetry.id, "batch runtime must move to the regenerated refined concept");
  assert.equal(internals.batchJobLinks.get(firstConceptRetry.id), refinementBatchId, "batch linkage must follow the regenerated concept job");
  assert.equal(internals.batchJobLinks.has(refinementConceptId), false, "superseded concept jobs must release their live batch link");

  firstConceptRetry.state = "failed";
  firstConceptRetry.stage = "concept-review";
  firstConceptRetry.error = { code: "CONCEPT_QUALITY_REJECTED", message: "technical fixture rejection", retryable: true };
  const firstRetryAttempt = await attempt(firstConceptRetry.id, firstConceptRetry.spec, 3);
  firstConceptRetry.conceptAttempt = firstRetryAttempt;
  firstConceptRetry.conceptAttempts = [...(firstConceptRetry.conceptAttempts ?? []), firstRetryAttempt];
  const secondConceptRetry = await service.regenerateConcept(token, firstConceptRetry.id);
  assert.equal(secondConceptRetry.shapeRefinement, true);
  assert.equal(secondConceptRetry.parentJobId, baseId, "multiple retries must never replace the approved geometry parent with a concept-only attempt");
  assert.equal(secondConceptRetry.conceptParentJobId, firstConceptRetry.id, "multiple retries must retain their immediate concept-attempt ancestry");
  assert.equal(secondConceptRetry.spec.seed, refinementSpec.seed + 2);
  assert.deepEqual(
    secondConceptRetry.conceptDecisions?.map((decision) => [decision.kind, decision.jobId, decision.nextJobId]),
    [
      ["edited", baseId, refinementConceptId],
      ["regenerated", refinementConceptId, firstConceptRetry.id],
      ["regenerated", firstConceptRetry.id, secondConceptRetry.id],
    ],
    "the final concept must retain one edited decision followed by every regeneration edge",
  );
  assert.equal(refinementRuntime.currentJobId, secondConceptRetry.id);
  assert.equal(internals.batchJobLinks.get(secondConceptRetry.id), refinementBatchId);
  secondConceptRetry.state = "failed";
  secondConceptRetry.stage = "failed";
  internals.batches.delete(refinementBatchId);
  internals.batchRequests.delete(refinementBatchId);
  internals.batchRuntime.delete(refinementBatchId);
  internals.batchTokens.delete(refinementBatchId);
  internals.batchJobLinks.delete(secondConceptRetry.id);

  const sameSeedEditedRefinementSpec: AssetSpecV1 = {
    ...firstConceptRetry.spec,
    prompt: "One complete taller stone creature with four legs and tail. Shape refinement: widen the silhouette.",
  };
  await assert.rejects(
    service.start(token, {
      spec: sameSeedEditedRefinementSpec,
      parentConceptJobId: firstConceptRetry.id,
      conceptChangeReason: "edited",
      shapeRefinement: true,
      consent: { providerId: "hunyuan3d-2", confirmed: true },
    }),
    /increment the retained seed exactly once/i,
    "new prompt-edited concept successors must not reuse the retained seed",
  );
  const editedRefinementSpec: AssetSpecV1 = {
    ...sameSeedEditedRefinementSpec,
    seed: firstConceptRetry.spec.seed + 1,
  };
  const editedConceptRetry = await service.start(token, {
    spec: editedRefinementSpec,
    parentConceptJobId: firstConceptRetry.id,
    conceptChangeReason: "edited",
    shapeRefinement: true,
    consent: { providerId: "hunyuan3d-2", confirmed: true },
  });
  assert.equal(editedConceptRetry.shapeRefinement, true, "editing a rejected refinement concept must preserve its refinement role");
  assert.equal(editedConceptRetry.parentJobId, baseId, "an edited refinement retry must retain the last approved geometry parent");
  assert.equal(editedConceptRetry.conceptParentJobId, firstConceptRetry.id, "an edited refinement retry must retain the immediate rejected concept parent separately");
  editedConceptRetry.state = "failed";
  editedConceptRetry.stage = "failed";

  const conceptParentId = "44444444-4444-4444-8444-444444444444";
  const freshRejectedId = "55555555-5555-4555-8555-555555555555";
  const batchId = "66666666-6666-4666-8666-666666666666";
  const batchItemId = "77777777-7777-4777-8777-777777777777";
  const freshRootSpec = withObjectRules({
    ...baseSpec,
    prompt: "One complete weathered stone beast with four clearly separated legs and an unobstructed tail",
    seed: 70,
  });
  const conceptParent = await completedJob(conceptParentId, freshRootSpec);
  conceptParent.state = "awaiting-concept-approval";
  conceptParent.stage = "awaiting-concept-approval";
  conceptParent.variants = [];
  conceptParent.approvedConcept = false;
  delete conceptParent.conceptApproval;
  const freshRejectedSpec = withObjectRules({ ...freshRootSpec, seed: freshRootSpec.seed + 1 });
  const freshRejected = await completedJob(freshRejectedId, freshRejectedSpec, conceptParentId);
  const freshHistory = inheritConceptHistory(conceptParent, freshRejectedId, "regenerated", "2026-09-02T00:04:00.000Z");
  freshRejected.conceptAttempts = [...freshHistory.attempts, freshRejected.conceptAttempt!];
  freshRejected.conceptDecisions = freshHistory.decisions;
  internals.jobs.set(conceptParentId, conceptParent);
  internals.jobs.set(freshRejectedId, freshRejected);

  const batchRequest: Prompt3DBatchRequest = {
    name: "Fresh root correction fixture",
    items: [{
      id: batchItemId,
      name: "Stone beast",
      spec: freshRootSpec,
      shapeRefinement: "",
      texturePrompts: [],
      animationRevisions: [],
    }],
  };
  const runtime: Prompt3DBatchRuntimeItem = {
    baseComplete: false,
    shapeComplete: false,
    nextTexture: 0,
    nextAnimation: 0,
    currentKind: "base",
    currentJobId: freshRejectedId,
  };
  const batchDirectory = join(root, "workflow-batches", batchId);
  await mkdir(batchDirectory, { recursive: true });
  const batchStatus: Prompt3DBatchStatus = {
    version: 1,
    id: batchId,
    name: batchRequest.name,
    state: "awaiting-approval",
    request: batchRequest,
    runtime: { [batchItemId]: runtime },
    items: [{
      id: batchItemId,
      name: "Stone beast",
      state: "awaiting-approval",
      progress: 24,
      currentJobId: freshRejectedId,
      message: "Inspect the exact base geometry.",
    }],
    createdAt: "2026-09-02T00:04:00.000Z",
    updatedAt: "2026-09-02T00:04:00.000Z",
    manifestPath: join(batchDirectory, "manifest.json"),
    message: "Waiting for exact base geometry approval or correction.",
  };
  internals.batches.set(batchId, batchStatus);
  internals.batchRequests.set(batchId, batchRequest);
  internals.batchRuntime.set(batchId, new Map([[batchItemId, runtime]]));
  internals.batchTokens.set(batchId, token);
  internals.batchJobLinks.set(freshRejectedId, batchId);

  const freshCorrectionSpec = withObjectRules({
    ...freshRejectedSpec,
    prompt: `${freshRejectedSpec.prompt}; make the silhouette broader while retaining every named feature`,
    seed: freshRejectedSpec.seed + 1,
    objectRules: undefined,
  });
  const freshSuccessor = await service.start(token, {
    spec: freshCorrectionSpec,
    batchId,
    batchItemId,
    rejectedGeometryJobId: freshRejectedId,
    freshRootCorrection: true,
    conceptChangeReason: "edited",
    consent: { providerId: "hunyuan3d-2", confirmed: true },
  });
  assert.equal(freshSuccessor.parentJobId, undefined, "a base correction must begin a new root instead of inheriting concept-only ancestry as geometry");
  assert.equal(freshRejected.geometryRejection?.replacementKind, "fresh-root-regeneration");
  assert.equal(freshRejected.geometryRejection?.approvedAncestorJobId, undefined);
  assert.deepEqual(
    freshRejected.geometryRejection?.retainedAncestry.map((entry) => entry.jobId),
    [freshRejectedId, conceptParentId],
    "a safe fresh-root correction must retain and verify the full concept-only retry chain",
  );
  assert.equal(runtime.currentJobId, freshSuccessor.id, "the exact active batch item must relink to its fresh-root correction");
  assert.equal(internals.batchJobLinks.get(freshSuccessor.id), batchId);
  service.shutdown();
  process.stdout.write("Prompt-to-3D rejected-geometry and concept-only fresh-root correction lineage checks passed.\n");
} finally {
  await rm(root, { recursive: true, force: true });
}
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
