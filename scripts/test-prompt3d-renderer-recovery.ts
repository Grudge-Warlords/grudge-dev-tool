import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Prompt3DRulesPanel from "../src/renderer/components/Prompt3DRulesPanel";
import {
  prompt3dFreshRootBatchBinding,
  prompt3dGeometryCorrectionDecision,
  prompt3dGeometryCorrectionLineageFields,
  resolvePrompt3DFinishRecoverySource,
} from "../src/renderer/lib/prompt3dVisualRecovery";
import { PROMPT3D_SPEC_VERSION, type AssetSpecV1, type Prompt3DJobStatus } from "../src/shared/prompt3d";
import type {
  Prompt3DAssetSource,
  Prompt3DBatchStatus,
  Prompt3DFinishJobStatus,
  Prompt3DFinishOperation,
  Prompt3DFinishVisualRejection,
  Prompt3DVisualApproval,
  Prompt3DWorkflowLineage,
} from "../src/shared/prompt3dWorkflow";

const assetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const generationId = "11111111-1111-4111-8111-111111111111";
const generationPath = "E:\\prompt3d\\generation.glb";
const geometryHash = "g".repeat(64);
const generationSha = "b".repeat(64);

const spec: AssetSpecV1 = {
  version: PROMPT3D_SPEC_VERSION,
  prompt: "A completely custom stone creature",
  category: "character",
  style: "realistic",
  route: "concept-image-to-3d",
  targetFormat: "glb",
  dimensions: { width: 1, height: 1, depth: 1, unit: "m" },
  budgets: { maxTriangles: 50_000, maxTextureResolution: 1024, maxTextureBytes: 32 * 1024 ** 2 },
  seed: 42,
  variants: 1,
  providerId: "hunyuan3d-2",
  generateTextures: false,
  generateCollision: false,
  generateLods: false,
  coordinateContract: { upAxis: "+Y", forwardAxis: "+Z", origin: "ground-center", stableRootName: "GrudgeAssetRoot" },
};

function approval(
  stage: Prompt3DVisualApproval["stage"],
  jobId: string,
  assetPath: string,
  assetSha256: string,
): Prompt3DVisualApproval {
  const at = "2026-09-02T00:00:00.000Z";
  return {
    version: 1,
    approvalId: "1".repeat(64),
    bindingSha256: "1".repeat(64),
    source: "explicit-user-action",
    approvedAt: at,
    stage,
    assetId,
    jobId,
    assetPath,
    assetSha256,
    geometryHash,
    promptSha256: "2".repeat(64),
    specFingerprint: "3".repeat(64),
    inspection: {
      version: 1,
      assetPath,
      assetSha256,
      stage,
      viewpoints: ["front", "right", "back", "left"].map((preset) => ({ preset: preset as "front" | "right" | "back" | "left", inspectedAt: at })),
      attestations: {
        geometryIdentityAndCompleteness: { accepted: true, at },
        ...(stage === "texture" ? { materialCoverageAndAppearance: { accepted: true as const, at } } : {}),
        ...(stage === "animation" ? { animationMotionMatchesPrompt: { accepted: true as const, at } } : {}),
      },
      clips: stage === "animation" ? [{ index: 0, name: "Motion", duration: 1, playedSeconds: 1, completedAt: at }] : [],
      updatedAt: at,
      completedAt: at,
    },
  };
}

function generation(approved: boolean): Prompt3DJobStatus {
  return {
    id: generationId,
    assetId,
    state: "complete",
    stage: "complete",
    progress: 100,
    providerId: "hunyuan3d-2",
    spec,
    message: "complete",
    outputDirectory: "E:\\prompt3d",
    variants: [{
      index: 0,
      glbPath: generationPath,
      report: { gameReady: true, deterministicId: "generation-validation", checks: [] },
      provenancePath: "E:\\prompt3d\\provenance.json",
      sha256: generationSha,
      geometryHash,
      byteSize: 100,
      validationReportSha256: "4".repeat(64),
      provenanceSha256: "5".repeat(64),
      ...(approved ? {
        visualApproval: approval("geometry", generationId, generationPath, generationSha),
        visualApprovalPath: "E:\\prompt3d\\visual-approval.json",
        visualApprovalSha256: "6".repeat(64),
      } : {}),
    }],
    conceptApproval: {} as Prompt3DJobStatus["conceptApproval"],
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  };
}

function rootLineage(): Prompt3DWorkflowLineage {
  return {
    version: 1,
    assetId,
    root: { jobId: generationId, variantIndex: 0 } as Prompt3DWorkflowLineage["root"],
    revisions: [],
    finalJobId: generationId,
    finalSha256: generationSha,
    finalGeometryHash: geometryHash,
    chainSha256: "7".repeat(64),
  };
}

function finish(options: {
  id: string;
  operation: Prompt3DFinishOperation;
  source: Prompt3DAssetSource;
  sourcePath: string;
  sourceSha: string;
  outputSha: string;
  lineage: Prompt3DWorkflowLineage;
  approved?: boolean;
}): Prompt3DFinishJobStatus {
  const assetPath = `E:\\prompt3d\\${options.id}.glb`;
  return {
    version: 1,
    id: options.id,
    assetId,
    source: options.source,
    sourceAssetPath: options.sourcePath,
    sourceSha256: options.sourceSha,
    sourceGeometryHash: geometryHash,
    operation: options.operation,
    instruction: `custom ${options.operation}`,
    seed: 43,
    state: "complete",
    stage: "complete",
    progress: 100,
    message: "complete",
    outputDirectory: "E:\\prompt3d",
    assetPath,
    sha256: options.outputSha,
    geometryHash,
    provenancePath: `E:\\prompt3d\\${options.id}-provenance.json`,
    validation: {
      selfContained: true,
      sourceGeometryPreserved: true,
      sourceGeometryHash: geometryHash,
      outputGeometryHash: geometryHash,
      embeddedTextures: 1,
      sourceTextureFingerprint: "8".repeat(64),
      outputTextureFingerprint: "9".repeat(64),
      textureChanged: options.operation === "texture",
      outputAnimationFingerprint: options.operation === "animation" ? "a".repeat(64) : "",
      animations: options.operation === "animation" ? [{ name: "motion", duration: 1, channels: 1 }] : [],
      checks: [],
    },
    technicalValidation: { gameReady: true, deterministicId: `${options.id}-validation`, checks: [] },
    ...(options.approved ? {
      visualApproval: approval(options.operation, options.id, assetPath, options.outputSha),
      visualApprovalPath: `E:\\prompt3d\\${options.id}-visual-approval.json`,
      visualApprovalSha256: "c".repeat(64),
    } : {}),
    lineage: options.lineage,
    provider: options.operation === "texture" ? "hunyuan3d-paint-2.1" : "grudge-motion-graph-1",
    baseSpec: spec,
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  };
}

function explicitlyRejected(job: Prompt3DFinishJobStatus): Prompt3DFinishJobStatus {
  const rejection: Prompt3DFinishVisualRejection = {
    version: 1,
    rejectionId: "f".repeat(64),
    bindingSha256: "f".repeat(64),
    source: "explicit-user-action",
    rejectedAt: "2026-09-02T00:00:01.000Z",
    stage: job.operation,
    assetId: job.assetId,
    jobId: job.id,
    assetPath: job.assetPath!,
    assetSha256: job.sha256!,
    geometryHash: job.geometryHash!,
    promptSha256: "2".repeat(64),
    specFingerprint: "3".repeat(64),
    ...(job.operation === "texture"
      ? { textureFingerprint: job.validation!.outputTextureFingerprint }
      : { animationFingerprint: job.validation!.outputAnimationFingerprint, animationPlanSha256: "4".repeat(64) }),
    classification: job.operation === "texture" ? "appearance-mismatch" : "motion-mismatch",
    note: "Visible result does not match the requested outcome.",
  };
  return {
    ...job,
    visualRejection: rejection,
    visualRejectionPath: `E:\\prompt3d\\${job.id}-visual-rejection.json`,
    visualRejectionSha256: "e".repeat(64),
  };
}

function main() {
  const rendererSource = readFileSync(join(__dirname, "..", "src", "renderer", "pages", "NeuralPrompt3D.tsx"), "utf8");
  for (const required of [
    "identityAndRequiredParts",
    "subjectPresentation",
    "framingBackgroundAndSupport",
    "Reject and retain reason",
    "CONCEPT_SEMANTIC_REJECTED",
    "presentationContract",
  ]) assert.ok(rendererSource.includes(required), `same-panel concept inspection is missing ${required}`);
  assert.ok(rendererSource.includes("disabled={conceptReviewLocked}"), "the retained prompt/spec must stay locked until the user explicitly chooses edit");
  assert.ok(rendererSource.includes("setSpec(editableSpec(job.spec))"), "canceling or beginning an edit must restore the authoritative retained spec rather than a stale draft");
  assert.ok(rendererSource.includes("setSpec({ ...restoredSpec, seed: restoredSpec.seed + 1 })"), "a prompt-edited concept successor must begin with a fresh retained seed");
  assert.ok(rendererSource.includes("conceptChecksAllPass"), "concept approval must be gated by three explicit passing checks");
  assert.ok(rendererSource.includes("!conceptRejectionClass"), "concept rejection must be gated by an explicit failure classification");
  assert.ok(rendererSource.includes("prompt3d-brief-compile-error"), "the main asset brief must expose a visible Hunyuan prompt-budget recovery error");
  assert.ok(rendererSource.includes("spec.prompt.trim() && !promptCompileError"), "an over-budget Hunyuan prompt must disable generation before backend dispatch");
  assert.ok(rendererSource.includes("freshSeedAllowsPreConceptRecovery"), "a fresh seed must recover a failed pre-concept job without weakening concept approval");
  assert.ok(rendererSource.includes("conceptRejected && !job?.conceptAttempt && spec.seed !== job?.spec.seed"), "pre-concept recovery must require both absent concept evidence and a changed seed");
  assert.ok(rendererSource.includes("job?.id === editedConceptParent && job.shapeRefinement === true ? { shapeRefinement: true }"), "editing a rejected refinement concept must retain its shape-refinement role");
  assert.ok(rendererSource.includes("CONCEPT_PREVIEW_MAX_RETRIES = 4"), "the exact concept preview must retry bounded transient load failures");
  assert.ok(rendererSource.includes("conceptAttempt?.binding.conceptSha256") && rendererSource.includes("&attempt=${conceptPreviewAttempt}"), "concept preview retries must be cache-busted and bound to the exact concept hash");
  assert.ok(rendererSource.includes("loadedConceptPath !== job.conceptImagePath"), "concept decisions must remain fail-closed until the exact concept image loads");
  for (const required of [
    'data-panel="install-options"',
    'data-panel="creation"',
    'data-panel="preview"',
    "installOptionsRequired",
    "Current creation stage",
    'data-testid="prompt3d-initial-image-source"',
    "Generate image",
    "Select image",
    "Standard game-asset baseline",
    "Optional Hunyuan reference images",
    "Use the existing generated model",
    "Automatically added to Local Files",
  ]) assert.ok(rendererSource.includes(required), `stage-focused renderer is missing ${required}`);
  assert.ok(rendererSource.includes('useState<InitialImageMode>("choose")'), "a new asset must begin at the image-source decision rather than exposing later settings");
  assert.ok(rendererSource.includes('["source", "prompt", "concept-review"') && rendererSource.includes("of 9"), "image source must be the first numbered creation stage");
  assert.ok(rendererSource.includes("onClick={beginGeneratedImage}") && rendererSource.includes("onClick={() => void beginSelectedImage()}"), "both initial source actions must be operational");
  assert.ok(rendererSource.includes('initialImageMode === "generate"') && rendererSource.includes('initialImageMode === "select"') && rendererSource.includes("initialImageSourceReady"), "generation must remain bound to the source method selected at stage one");
  assert.ok(rendererSource.includes('setInitialImageMode("choose");') && rendererSource.includes("Change starting image"), "starting over or changing source must return to the first stage and clear stale reference input");
  assert.ok(rendererSource.includes("front, left, back, right order") && rendererSource.includes("changeReferenceView"), "reference-image intake must expose and correct the camera role assigned to every Hunyuan view");
  assert.ok(rendererSource.includes('const resultJob = job?.state === "complete" && job.variants.length ? job : null'), "a successor run must never fall back to a previous completed preview");
  assert.ok(rendererSource.includes("const displayedAssetPath = finishBusy || activeFinish || displayedFinishRejected ? undefined"), "starting or rejecting a finish revision must hide its previous preview");
  assert.ok(rendererSource.includes("setJob(null);") && rendererSource.includes("setPreviousResult(null);"), "starting a new Hunyuan generation must clear the previous live preview immediately");
  assert.ok(rendererSource.includes("existingBaseGeometryContinuationAvailable") && rendererSource.includes("!batchActive"), "the base-model continuation must stay available only for an approved individual workflow, never a strict batch");
  assert.ok(rendererSource.includes("resultJob.shapeRefinement === true || acceptedBaseGeometryForTexture"), "Stage 4 must advance after either a prompted refinement or the explicit use-existing decision");
  assert.ok(rendererSource.includes("useExistingGeneratedModel: true as const"), "the Stage 4 decision must reach backend finishing admission rather than only changing the visible panel");
  assert.ok(rendererSource.includes("ACCEPTED_BASE_GEOMETRY_FOR_TEXTURE_KEY") && rendererSource.includes("existingGeometryDecision?.generationJobId"), "the exact accepted base-model decision must survive renderer restart and retained texture recovery");
  assert.ok(rendererSource.includes('providerId === "trellis" ? "direct-text" : "concept-image-to-3d"'), "the guided neural workspace must retain explicit Hunyuan and TRELLIS routes");
  assert.ok(rendererSource.includes("automaticSaveAttempts") && rendererSource.includes("void saveWorkflow(true)"), "approved animated revisions must automatically enter Local Files");
  assert.ok(rendererSource.includes('animationEditingAfterApprovalId === displayedFinish.id ? "animation-prompt" : "save"'), "one approved animation must advance the normal asset workflow to final save");
  assert.ok(!rendererSource.includes('approvedAnimationRevisionCount >= 2 ? "save"'), "the strict multi-animation acceptance rule must not trap an individual asset before save");
  assert.ok(rendererSource.includes("Save final model to Local Files") && rendererSource.includes("Add or refine animation"), "the final stage must expose save and optional additional-animation actions");
  assert.ok(rendererSource.includes("Keep approved animation and continue to save"), "optional animation editing must have a non-destructive route back to final save");
  assert.ok(rendererSource.includes("Use approved texture and configure animation"), "an approved Hunyuan texture must offer an explicit manual continuation to animation");
  assert.ok(rendererSource.includes("approvedTextureRevisionCount >= 2 || acceptedTextureForAnimation"), "strict texture refinement and explicit manual continuation must remain separate stage decisions");
  assert.ok(rendererSource.includes("ACCEPTED_TEXTURE_FOR_ANIMATION_KEY") && rendererSource.includes("already saved locally"), "the exact retained texture continuation must survive a renderer restart and accurately describe persistence");
  assert.ok(!rendererSource.includes("analyzePromptedMotionIntent(animationPrompt)"), "the renderer must not replace HY-Motion prompt understanding with client-side keyword animation");
  assert.ok(rendererSource.includes("typed local router reads the full prompt") && rendererSource.includes("negation never authorizes travel"), "the animation editor must disclose its backend placement and negation contract");
  assert.ok(rendererSource.includes("Automatic guided CPU route") && rendererSource.includes("Optional HY-Motion 1.0 Lite"), "the animation stage must distinguish the default CPU route from the optional HY-Motion provider");
  assert.ok(rendererSource.includes("!motionProviderReady") && rendererSource.includes("HY-Motion is not ready."), "skeletal generation must stay disabled until the signed local provider is installed and runnable");
  assert.ok(!rendererSource.includes("Travel distance (m)") && !rendererSource.includes("Body motion intensity") && !rendererSource.includes("Cycles<input"), "legacy procedural transform controls must not reach HY-Motion");
  assert.ok(rendererSource.includes("Walking, running and similar actions remain in place unless direction, path or distance is affirmative"), "activity verbs alone must be described as stationary root motion");
  assert.ok(rendererSource.includes("Reject animation and configure replacement"), "animation review must expose an explicit rejection action");
  assert.ok(rendererSource.includes("workflowRejectFinishVisual") && rendererSource.includes("rejectedFinishJobId: recovery.rejectedJobId"), "a replacement must be bound to the exact retained rejection");
  assert.ok(rendererSource.includes('operation === "animation" && recovery?.ok ? "replace" : animationMode'), "a corrected animation must replace rather than retain rejected clips");
  assert.ok(rendererSource.includes("disabled={animationRecoveryNeeded}"), "the clip mode control must stay locked while replacing a rejected animation");
  assert.ok(rendererSource.includes('Avoid “do not”, “without”'), "the visible baseline must warn against negation inversion");
  const prompt3DRouteSource = readFileSync(join(__dirname, "..", "src", "renderer", "pages", "Prompt3D.tsx"), "utf8");
  assert.ok(prompt3DRouteSource.includes('from "./CreationFlowPage"'), "Prompt-to-3D must use the unified owner surface that routes existing procedural and neural capabilities");

  const mediaProtocolSource = readFileSync(join(__dirname, "..", "src", "main", "mediaProtocol.ts"), "utf8");
  assert.ok(!mediaProtocolSource.includes("filePath = decodeURIComponent(filePath);"), "URLSearchParams query values must not be decoded a second time");

  const serviceSource = readFileSync(join(__dirname, "..", "src", "main", "prompt3d", "service.ts"), "utf8");
  const preflightCompile = serviceSource.indexOf("const promptPlan = compilePrompt3DPrompt(spec);");
  const retainedDirectoryCreate = serviceSource.indexOf("await mkdir(outputDirectory, { recursive: true });", preflightCompile);
  assert.ok(preflightCompile >= 0 && retainedDirectoryCreate > preflightCompile, "the backend must compile the final prompt before creating retained job storage");
  assert.ok(serviceSource.includes("Strict serial acceptance requires prompted Hunyuan shape refinement"), "the individual base-model continuation must not weaken strict serial acceptance");
  assert.ok(serviceSource.includes("createPrompt3DExistingGeometryDecision"), "backend texture admission must persist a hash-bound existing-geometry decision in lineage");
  const cpuDispatch = serviceSource.indexOf("private async runCpuAnimationFinish");
  assert.ok(cpuDispatch >= 0 && serviceSource.includes('request.animation?.provider === "hy-motion-1.0-lite"'), "animation admission must provide an explicit CPU default and optional HY-Motion dispatch");
  const motionGeneration = serviceSource.indexOf("private async runHyMotionAnimationFinish");
  const compatibilityGate = serviceSource.indexOf("analyzeHyMotionCompatibility(job.baseSpec, job.instruction)", motionGeneration);
  const providerLaunch = serviceSource.indexOf('providerId: "hy-motion-1"', compatibilityGate);
  assert.ok(motionGeneration >= 0 && compatibilityGate > motionGeneration && providerLaunch > compatibilityGate, "the retained animation job must pass the local humanoid/negation gate before HY-Motion inference starts");
  assert.ok(!serviceSource.slice(motionGeneration, providerLaunch).includes("compilePromptedAnimation("), "the explicitly selected HY-Motion workflow must not silently fall back to the deterministic CPU compiler");

  const overBudgetSpec: AssetSpecV1 = {
    ...spec,
    // Mandatory exclusions cannot be dropped by positive-prompt compaction.
    prompt: "One complete cube. No antennas, balconies, banners, buttons, cables, chimneys, clocks, columns, curtains, doors, drawers, engines, feathers, fins, flags, flowers, foliage, gears, handles, hinges, horns, ladders, lamps, leaves, limbs, pipes, pistons, railings, ribbons, rivets, ropes, rotors, scales, screws, seats, shelves, spikes, stairs, straps, tails, teeth, tracks, trunks, vines, wheels, windows, wings, wires.",
  };
  const overBudgetMarkup = renderToStaticMarkup(createElement(Prompt3DRulesPanel, { spec: overBudgetSpec, onChange: () => undefined }));
  assert.ok(overBudgetMarkup.includes("compiled-geometry-prompt-error"), "an over-budget Hunyuan brief must render a recoverable inline error instead of reaching the top-level error boundary");
  assert.ok(overBudgetMarkup.includes("Shorten the description"), "the inline prompt-budget error must tell the user how to recover");

  const unapprovedBase = generation(false);
  const baseDecision = prompt3dGeometryCorrectionDecision(unapprovedBase, 0);
  assert.equal(baseDecision.mode, "fresh-root");
  if (baseDecision.mode === "blocked") throw new Error(baseDecision.reason);
  assert.deepEqual(prompt3dGeometryCorrectionLineageFields(baseDecision, generationId), {}, "a rejected base mesh must not forge ancestry");
  const batch = {
    version: 1,
    id: "77777777-7777-4777-8777-777777777777",
    name: "fixture",
    state: "awaiting-approval",
    items: [{ id: "item-1", name: "fixture", state: "awaiting-approval", progress: 40, currentJobId: generationId, message: "review" }],
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    manifestPath: "E:\\prompt3d\\batch.json",
    message: "review",
  } satisfies Prompt3DBatchStatus;
  assert.deepEqual(prompt3dFreshRootBatchBinding(batch, generationId), {
    batchId: batch.id,
    batchItemId: "item-1",
    rejectedGeometryJobId: generationId,
    freshRootCorrection: true,
    conceptChangeReason: "edited",
  });
  assert.equal(prompt3dFreshRootBatchBinding(batch, "wrong-job"), null, "batch correction must bind the exact current geometry job");
  assert.equal(prompt3dFreshRootBatchBinding({ ...batch, state: "running" }, generationId), null, "a running batch cannot accept a visual correction");

  const approvedBase = generation(true);
  const approvedDecision = prompt3dGeometryCorrectionDecision(approvedBase, 0);
  assert.equal(approvedDecision.mode, "approved-successor");
  if (approvedDecision.mode === "blocked") throw new Error(approvedDecision.reason);
  assert.deepEqual(prompt3dGeometryCorrectionLineageFields(approvedDecision, generationId), {
    parentConceptJobId: generationId,
    conceptChangeReason: "edited",
    shapeRefinement: true,
  });

  const rejectedRefinement: Prompt3DJobStatus = {
    ...unapprovedBase,
    id: "22222222-2222-4222-8222-222222222222",
    parentJobId: generationId,
    shapeRefinement: true,
    variants: unapprovedBase.variants.map((variant) => ({ ...variant })),
  };
  const rejectedDecision = prompt3dGeometryCorrectionDecision(rejectedRefinement, 0);
  assert.equal(rejectedDecision.mode, "reject-refinement");
  if (rejectedDecision.mode === "blocked") throw new Error(rejectedDecision.reason);
  assert.deepEqual(prompt3dGeometryCorrectionLineageFields(rejectedDecision, rejectedRefinement.id), {
    rejectedGeometryJobId: rejectedRefinement.id,
    conceptChangeReason: "edited",
    shapeRefinement: true,
  });

  const partialGeometryApproval: Prompt3DJobStatus = {
    ...unapprovedBase,
    variants: unapprovedBase.variants.map((variant) => ({ ...variant, visualApprovalPath: "E:\\prompt3d\\partial.json" })),
  };
  assert.equal(prompt3dGeometryCorrectionDecision(partialGeometryApproval, 0).mode, "blocked");

  const textureId = "33333333-3333-4333-8333-333333333333";
  const rejectedTexture = finish({
    id: textureId,
    operation: "texture",
    source: { kind: "generation", jobId: generationId, variantIndex: 0 },
    sourcePath: generationPath,
    sourceSha: generationSha,
    outputSha: "d".repeat(64),
    lineage: rootLineage(),
  });
  assert.equal(resolvePrompt3DFinishRecoverySource({
    rejected: rejectedTexture,
    operation: "texture",
    finishJobs: new Map(),
    generationJob: approvedBase,
    generationVariantIndex: 0,
  }).ok, false, "an unapproved output must not be treated as rejected without an explicit retained decision");
  const explicitlyRejectedTexture = explicitlyRejected(rejectedTexture);
  const textureRecovery = resolvePrompt3DFinishRecoverySource({
    rejected: explicitlyRejectedTexture,
    operation: "texture",
    finishJobs: new Map(),
    generationJob: approvedBase,
    generationVariantIndex: 0,
  });
  assert.equal(textureRecovery.ok, true);
  if (!textureRecovery.ok) throw new Error(textureRecovery.reason);
  assert.deepEqual(textureRecovery.source, { kind: "generation", jobId: generationId, variantIndex: 0 });
  assert.notEqual(textureRecovery.source.jobId, rejectedTexture.id, "texture correction must be a sibling, never a child of the rejected output");

  const approvedTextureLineage: Prompt3DWorkflowLineage = {
    ...rootLineage(),
    revisions: [{ operation: "texture" } as Prompt3DWorkflowLineage["revisions"][number]],
    finalJobId: textureId,
    finalSha256: "d".repeat(64),
  };
  const approvedTexture = finish({
    id: textureId,
    operation: "texture",
    source: { kind: "generation", jobId: generationId, variantIndex: 0 },
    sourcePath: generationPath,
    sourceSha: generationSha,
    outputSha: "d".repeat(64),
    lineage: approvedTextureLineage,
    approved: true,
  });
  const animationId = "44444444-4444-4444-8444-444444444444";
  const rejectedAnimation = explicitlyRejected(finish({
    id: animationId,
    operation: "animation",
    source: { kind: "finish", jobId: textureId },
    sourcePath: approvedTexture.assetPath!,
    sourceSha: approvedTexture.sha256!,
    outputSha: "e".repeat(64),
    lineage: approvedTextureLineage,
  }));
  const animationRecovery = resolvePrompt3DFinishRecoverySource({
    rejected: rejectedAnimation,
    operation: "animation",
    finishJobs: new Map([[textureId, approvedTexture]]),
    generationJob: approvedBase,
    generationVariantIndex: 0,
  });
  assert.equal(animationRecovery.ok, true);
  if (!animationRecovery.ok) throw new Error(animationRecovery.reason);
  assert.deepEqual(animationRecovery.source, { kind: "finish", jobId: textureId });
  assert.notEqual(animationRecovery.source.jobId, rejectedAnimation.id, "animation correction must be a sibling, never a child of the rejected output");

  const approvedAnimationId = "55555555-5555-4555-8555-555555555555";
  const approvedAnimationLineage: Prompt3DWorkflowLineage = {
    ...approvedTextureLineage,
    revisions: [
      { operation: "texture" } as Prompt3DWorkflowLineage["revisions"][number],
      { operation: "animation" } as Prompt3DWorkflowLineage["revisions"][number],
    ],
    finalJobId: approvedAnimationId,
    finalSha256: "a".repeat(64),
  };
  const approvedAnimation = finish({
    id: approvedAnimationId,
    operation: "animation",
    source: { kind: "finish", jobId: textureId },
    sourcePath: approvedTexture.assetPath!,
    sourceSha: approvedTexture.sha256!,
    outputSha: "a".repeat(64),
    lineage: approvedAnimationLineage,
    approved: true,
  });
  const secondRejectedAnimation = explicitlyRejected(finish({
    id: "66666666-6666-4666-8666-666666666666",
    operation: "animation",
    source: { kind: "finish", jobId: approvedAnimationId },
    sourcePath: approvedAnimation.assetPath!,
    sourceSha: approvedAnimation.sha256!,
    outputSha: "0".repeat(64),
    lineage: approvedAnimationLineage,
  }));
  const secondAnimationRecovery = resolvePrompt3DFinishRecoverySource({
    rejected: secondRejectedAnimation,
    operation: "animation",
    finishJobs: new Map([[approvedAnimationId, approvedAnimation]]),
    generationJob: approvedBase,
    generationVariantIndex: 0,
  });
  assert.equal(secondAnimationRecovery.ok, true);
  if (!secondAnimationRecovery.ok) throw new Error(secondAnimationRecovery.reason);
  assert.deepEqual(secondAnimationRecovery.source, { kind: "finish", jobId: approvedAnimationId }, "animation correction should retain the nearest approved animation parent");

  const forgedTexture = { ...rejectedTexture, sourceSha256: "f".repeat(64) };
  assert.equal(resolvePrompt3DFinishRecoverySource({
    rejected: forgedTexture,
    operation: "texture",
    finishJobs: new Map(),
    generationJob: approvedBase,
    generationVariantIndex: 0,
  }).ok, false, "changed source hashes must fail closed");

  const partialFinishApproval = { ...rejectedAnimation, visualApprovalPath: "E:\\prompt3d\\partial-animation.json" };
  assert.equal(resolvePrompt3DFinishRecoverySource({
    rejected: partialFinishApproval,
    operation: "animation",
    finishJobs: new Map([[textureId, approvedTexture]]),
    generationJob: approvedBase,
    generationVariantIndex: 0,
  }).ok, false, "partial approval evidence must not be treated as rejection");

  const unapprovedTexture = { ...approvedTexture, visualApproval: undefined, visualApprovalPath: undefined, visualApprovalSha256: undefined };
  assert.equal(resolvePrompt3DFinishRecoverySource({
    rejected: rejectedAnimation,
    operation: "animation",
    finishJobs: new Map([[textureId, unapprovedTexture]]),
    generationJob: approvedBase,
    generationVariantIndex: 0,
  }).ok, false, "an unapproved finish cannot be silently skipped as an animation ancestor");

  console.log("Prompt-to-3D renderer visual-recovery tests passed.");
}

main();
