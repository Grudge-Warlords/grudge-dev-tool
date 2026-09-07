import type { Prompt3DJobStatus, Prompt3DStartRequest } from "../../shared/prompt3d";
import type {
  Prompt3DAssetSource,
  Prompt3DBatchStatus,
  Prompt3DFinishJobStatus,
  Prompt3DFinishOperation,
  Prompt3DFinishVisualRejection,
  Prompt3DVisualApproval,
} from "../../shared/prompt3dWorkflow";
import { assertPrompt3DVisualInspectionEvidence } from "../../shared/prompt3dVisualInspection";

export interface Prompt3DVisualIdentity {
  assetId: string;
  jobId: string;
  stage: Prompt3DVisualApproval["stage"];
  assetPath?: string;
  assetSha256?: string;
  geometryHash?: string;
}

export function exactPrompt3DVisualApproval(
  approval: Prompt3DVisualApproval | undefined,
  identity: Prompt3DVisualIdentity,
): boolean {
  const exactIdentity = Boolean(
    approval
    && identity.assetPath
    && identity.assetSha256
    && identity.geometryHash
    && approval.source === "explicit-user-action"
    && approval.assetId === identity.assetId
    && approval.jobId === identity.jobId
    && approval.stage === identity.stage
    && approval.assetPath === identity.assetPath
    && approval.assetSha256 === identity.assetSha256
    && approval.geometryHash === identity.geometryHash,
  );
  if (!exactIdentity || !approval || !identity.assetPath || !identity.assetSha256) return false;
  try {
    assertPrompt3DVisualInspectionEvidence(approval.inspection, {
      assetPath: identity.assetPath,
      assetSha256: identity.assetSha256,
      stage: identity.stage,
      ...(identity.stage === "animation"
        ? { animations: approval.inspection.clips.map((clip) => ({ name: clip.name, duration: clip.duration })) }
        : {}),
    });
    return true;
  } catch {
    return false;
  }
}

function hasAnyVisualApprovalEvidence(value: {
  visualApproval?: Prompt3DVisualApproval;
  visualApprovalPath?: string;
  visualApprovalSha256?: string;
}): boolean {
  return Boolean(value.visualApproval || value.visualApprovalPath || value.visualApprovalSha256);
}

export function exactPrompt3DFinishVisualRejection(
  rejection: Prompt3DFinishVisualRejection | undefined,
  identity: Prompt3DVisualIdentity,
): boolean {
  return Boolean(
    rejection
    && rejection.version === 1
    && rejection.source === "explicit-user-action"
    && rejection.stage === identity.stage
    && rejection.assetId === identity.assetId
    && rejection.jobId === identity.jobId
    && rejection.assetPath === identity.assetPath
    && rejection.assetSha256 === identity.assetSha256
    && rejection.geometryHash === identity.geometryHash
    && /^[a-f0-9]{64}$/iu.test(rejection.bindingSha256)
    && rejection.rejectionId === rejection.bindingSha256,
  );
}

export type Prompt3DGeometryCorrectionDecision =
  | { mode: "approved-successor" }
  | { mode: "reject-refinement" }
  | { mode: "fresh-root" }
  | { mode: "blocked"; reason: string };

/**
 * Select the only safe renderer transition after visually reviewing Hunyuan geometry.
 * A first unapproved mesh has no approved geometry ancestor, so its correction must be
 * a new root generation. A rejected refinement may use the backend's audited rejection
 * transition, while an approved mesh may create an ordinary successor.
 */
export function prompt3dGeometryCorrectionDecision(
  job: Prompt3DJobStatus,
  variantIndex: number,
): Prompt3DGeometryCorrectionDecision {
  const variant = job.variants.find((candidate) => candidate.index === variantIndex);
  if (job.providerId !== "hunyuan3d-2" || job.state !== "complete" || !job.conceptApproval
    || !variant?.report.gameReady || !variant.glbPath || !variant.sha256 || !variant.geometryHash) {
    return { mode: "blocked", reason: "Only completed, technically valid Hunyuan geometry can be corrected." };
  }
  const exactApproval = exactPrompt3DVisualApproval(variant.visualApproval, {
    assetId: job.assetId ?? job.id,
    jobId: job.id,
    stage: "geometry",
    assetPath: variant.glbPath,
    assetSha256: variant.sha256,
    geometryHash: variant.geometryHash,
  });
  if (exactApproval) return { mode: "approved-successor" };
  if (hasAnyVisualApprovalEvidence(variant)) {
    return { mode: "blocked", reason: "This geometry has incomplete or mismatched approval evidence and cannot be relabelled as rejected." };
  }
  if (job.geometryRejection || job.geometryRejectionPath || job.geometryRejectionSha256) {
    return { mode: "blocked", reason: "This rejected geometry already has a retained corrective successor." };
  }
  const shapeRefinement = Boolean(
    job.shapeRefinement
    || job.spec.prompt.includes("\n\nShape refinement: ")
    || job.spec.prompt.includes(". Refinement request: "),
  );
  if (shapeRefinement) {
    return job.parentJobId
      ? { mode: "reject-refinement" }
      : { mode: "blocked", reason: "The refinement has no retained parent from which the backend can verify an approved ancestor." };
  }
  return { mode: "fresh-root" };
}

type Prompt3DGeometryCorrectionLineageFields = Partial<Pick<
  Prompt3DStartRequest,
  "parentConceptJobId" | "rejectedGeometryJobId" | "conceptChangeReason" | "shapeRefinement"
>>;

export function prompt3dGeometryCorrectionLineageFields(
  decision: Exclude<Prompt3DGeometryCorrectionDecision, { mode: "blocked" }>,
  jobId: string,
): Prompt3DGeometryCorrectionLineageFields {
  if (decision.mode === "approved-successor") {
    return { parentConceptJobId: jobId, conceptChangeReason: "edited", shapeRefinement: true };
  }
  if (decision.mode === "reject-refinement") {
    return { rejectedGeometryJobId: jobId, conceptChangeReason: "edited", shapeRefinement: true };
  }
  // A first rejected mesh has no accepted geometry ancestor. Its replacement is
  // deliberately a separate root, with no parent or refinement authorization.
  return {};
}

type Prompt3DFreshRootBatchBinding = Required<Pick<
  Prompt3DStartRequest,
  "batchId" | "batchItemId" | "rejectedGeometryJobId" | "freshRootCorrection" | "conceptChangeReason"
>>;

/** Returns an exact binding only for the sole active batch item awaiting this base geometry decision. */
export function prompt3dFreshRootBatchBinding(
  batch: Prompt3DBatchStatus | null,
  rejectedGeometryJobId: string,
): Prompt3DFreshRootBatchBinding | null {
  if (!batch || batch.state !== "awaiting-approval") return null;
  const current = batch.items.find((item) => item.state !== "complete");
  if (!current || current.state !== "awaiting-approval" || current.currentJobId !== rejectedGeometryJobId) return null;
  if (batch.items.some((item) => item !== current && item.state === "awaiting-approval")) return null;
  return {
    batchId: batch.id,
    batchItemId: current.id,
    rejectedGeometryJobId,
    freshRootCorrection: true,
    conceptChangeReason: "edited",
  };
}

export type Prompt3DFinishRecoveryDecision =
  | {
    ok: true;
    source: Prompt3DAssetSource;
    rejectedJobId: string;
    approvedAncestorJobId: string;
    approvedAncestorStage: Prompt3DVisualApproval["stage"];
  }
  | { ok: false; reason: string };

function rootMatches(
  job: Prompt3DFinishJobStatus,
  generationJob: Prompt3DJobStatus,
  generationVariantIndex: number,
): boolean {
  return job.assetId === (generationJob.assetId ?? generationJob.id)
    && job.lineage?.assetId === job.assetId
    && job.lineage.root?.jobId === generationJob.id
    && job.lineage.root?.variantIndex === generationVariantIndex;
}

/**
 * Resolve the retained approved source for a sibling retry of an unapproved finish.
 * The returned source is only an identifier; the main process still performs byte,
 * hash, provenance, lineage and approval verification before accepting the retry.
 */
export function resolvePrompt3DFinishRecoverySource(options: {
  rejected: Prompt3DFinishJobStatus;
  operation: Prompt3DFinishOperation;
  finishJobs: ReadonlyMap<string, Prompt3DFinishJobStatus>;
  generationJob: Prompt3DJobStatus;
  generationVariantIndex: number;
}): Prompt3DFinishRecoveryDecision {
  const { rejected, operation, finishJobs, generationJob, generationVariantIndex } = options;
  if (rejected.operation !== operation) {
    return { ok: false, reason: `The visible ${rejected.operation} revision cannot be rejected as a ${operation} retry.` };
  }
  if (rejected.state !== "complete" || !rejected.assetPath || !rejected.sha256 || !rejected.geometryHash
    || !rejected.validation || !rejected.technicalValidation?.gameReady) {
    return { ok: false, reason: "Only a completed, technically valid finishing revision can be corrected." };
  }
  if (exactPrompt3DVisualApproval(rejected.visualApproval, {
    assetId: rejected.assetId,
    jobId: rejected.id,
    stage: rejected.operation,
    assetPath: rejected.assetPath,
    assetSha256: rejected.sha256,
    geometryHash: rejected.geometryHash,
  })) {
    return { ok: false, reason: "This finishing revision is already exactly approved; refine it as an accepted successor instead." };
  }
  if (hasAnyVisualApprovalEvidence(rejected)) {
    return { ok: false, reason: "This finishing revision has incomplete or mismatched approval evidence and cannot be relabelled as rejected." };
  }
  if (!exactPrompt3DFinishVisualRejection(rejected.visualRejection, {
    assetId: rejected.assetId,
    jobId: rejected.id,
    stage: rejected.operation,
    assetPath: rejected.assetPath,
    assetSha256: rejected.sha256,
    geometryHash: rejected.geometryHash,
  }) || !rejected.visualRejectionPath || !rejected.visualRejectionSha256) {
    return { ok: false, reason: "Reject this exact finishing revision before configuring its replacement." };
  }
  if (!rootMatches(rejected, generationJob, generationVariantIndex)) {
    return { ok: false, reason: "The finishing revision does not match the visible Hunyuan asset root." };
  }
  if (rejected.lineage.finalJobId !== rejected.source.jobId
    || rejected.lineage.finalSha256 !== rejected.sourceSha256
    || rejected.lineage.finalGeometryHash !== rejected.sourceGeometryHash) {
    return { ok: false, reason: "The rejected revision's retained lineage does not end at its recorded source." };
  }

  const source = rejected.source;
  if (source.kind === "generation") {
    const variant = generationJob.variants.find((candidate) => candidate.index === (source.variantIndex ?? 0));
    if (source.jobId !== generationJob.id || (source.variantIndex ?? 0) !== generationVariantIndex
      || rejected.assetId !== (generationJob.assetId ?? generationJob.id)
      || rejected.sourceAssetPath !== variant?.glbPath
      || rejected.sourceSha256 !== variant?.sha256
      || rejected.sourceGeometryHash !== variant?.geometryHash
      || !exactPrompt3DVisualApproval(variant?.visualApproval, {
        assetId: generationJob.assetId ?? generationJob.id,
        jobId: generationJob.id,
        stage: "geometry",
        assetPath: variant?.glbPath,
        assetSha256: variant?.sha256,
        geometryHash: variant?.geometryHash,
      })) {
      return { ok: false, reason: "The rejected revision's geometry source is not the exact approved Hunyuan root." };
    }
    if (operation === "animation") {
      return { ok: false, reason: "Animation recovery requires an approved textured model ancestor." };
    }
    return {
      ok: true,
      source: { kind: "generation", jobId: generationJob.id, variantIndex: generationVariantIndex },
      rejectedJobId: rejected.id,
      approvedAncestorJobId: generationJob.id,
      approvedAncestorStage: "geometry",
    };
  }

  const parent = finishJobs.get(source.jobId);
  if (!parent || !rootMatches(parent, generationJob, generationVariantIndex)
    || parent.assetId !== rejected.assetId
    || parent.state !== "complete" || !parent.assetPath || !parent.sha256 || !parent.geometryHash
    || rejected.sourceAssetPath !== parent.assetPath
    || rejected.sourceSha256 !== parent.sha256
    || rejected.sourceGeometryHash !== parent.geometryHash) {
    return { ok: false, reason: "The rejected revision's retained finishing parent is missing or does not match its recorded identity." };
  }
  if (operation === "texture" && parent.operation === "animation") {
    return { ok: false, reason: "A texture retry cannot silently skip an animation parent; select its approved texture ancestor explicitly." };
  }
  if (!exactPrompt3DVisualApproval(parent.visualApproval, {
    assetId: parent.assetId,
    jobId: parent.id,
    stage: parent.operation,
    assetPath: parent.assetPath,
    assetSha256: parent.sha256,
    geometryHash: parent.geometryHash,
  })) {
    return { ok: false, reason: "The rejected revision's direct model ancestor is not exactly approved." };
  }
  if (operation === "animation" && !parent.lineage.revisions.some((revision) => revision.operation === "texture")) {
    return { ok: false, reason: "Animation recovery requires an approved texture revision in the retained lineage." };
  }
  return {
    ok: true,
    source: { kind: "finish", jobId: parent.id },
    rejectedJobId: rejected.id,
    approvedAncestorJobId: parent.id,
    approvedAncestorStage: parent.operation,
  };
}
