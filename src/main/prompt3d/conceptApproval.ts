import { createHash } from "node:crypto";
import type {
  AssetSpecV1,
  Prompt3DConceptApproval,
  Prompt3DConceptAttempt,
  Prompt3DConceptBinding,
  Prompt3DConceptDecision,
  Prompt3DConceptInspectionRecord,
  Prompt3DJobStatus,
} from "../../shared/prompt3d";
import {
  CONCEPT_WORKFLOW_VERSION,
  conceptBindingMatchesSpec,
  conceptReferenceImageBindings,
  conceptSpecCanonical,
  retainedConceptWorkflowInput,
  sanitizeAssetSpec,
  stableJson,
  supportsConceptWorkflow,
} from "../../shared/conceptWorkflow";
import { assertConceptInspectionRecord, hasStructuredConceptProtocol } from "./conceptInspection";

const SHA256 = /^[a-f0-9]{64}$/;

export function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createConceptBinding(
  jobId: string,
  attemptNumber: number,
  spec: AssetSpecV1,
  conceptSha256: string,
): Prompt3DConceptBinding {
  if (!SHA256.test(conceptSha256)) throw new Error("Concept image SHA-256 is invalid.");
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) throw new Error("Concept attempt number is invalid.");
  const canonical = conceptSpecCanonical(spec);
  return {
    version: 1,
    workflowVersion: CONCEPT_WORKFLOW_VERSION,
    jobId,
    attemptId: `${jobId}:concept:${attemptNumber}`,
    conceptSha256,
    prompt: spec.prompt,
    seed: spec.seed,
    providerId: spec.providerId,
    specVersion: spec.version,
    specCanonical: canonical,
    specFingerprint: sha256Hex(canonical),
    referenceSha256: spec.referenceImage?.sha256 ?? null,
    referenceImageBindings: conceptReferenceImageBindings(spec),
  };
}

export function createConceptApproval(
  binding: Prompt3DConceptBinding,
  approvedAt = new Date().toISOString(),
  inspectionSha256?: string,
): Prompt3DConceptApproval {
  if (!Number.isFinite(Date.parse(approvedAt))) throw new Error("Concept approval time is invalid.");
  if (inspectionSha256 !== undefined && !SHA256.test(inspectionSha256)) throw new Error("Concept inspection SHA-256 is invalid.");
  return { ...binding, approvedAt, source: "explicit-user-action", ...(inspectionSha256 ? { inspectionSha256 } : {}) };
}

function approvalBinding(approval: Prompt3DConceptApproval): Prompt3DConceptBinding {
  const { approvedAt: _approvedAt, source: _source, inspectionSha256: _inspectionSha256, ...binding } = approval;
  return binding;
}

export function assertConceptAttemptBinding(
  jobId: string,
  spec: AssetSpecV1,
  attempt: Prompt3DConceptAttempt,
  actualConceptSha256: string,
): void {
  const binding = attempt.binding;
  const retained = retainedConceptWorkflowInput(binding);
  if (!Number.isInteger(attempt.attemptNumber) || attempt.attemptNumber < 1
    || binding.jobId !== jobId || binding.attemptId !== `${jobId}:concept:${attempt.attemptNumber}`) {
    throw new Error("Concept attempt identity does not match the retained job.");
  }
  if (!conceptBindingMatchesSpec(binding, spec)) {
    throw new Error("Concept approval is stale because the prompt, seed, provider, reference or editable spec changed.");
  }
  const expectedReferences = spec.referenceImages ?? (spec.referenceImage ? [spec.referenceImage] : []);
  const attemptReferences = attempt.referenceImages ?? (attempt.referenceImage ? [attempt.referenceImage] : []);
  if (expectedReferences.length > 0) {
    if (attemptReferences.length !== expectedReferences.length) {
      throw new Error("Concept attempt does not retain every reference-image view bound by AssetSpec.");
    }
    for (let index = 0; index < expectedReferences.length; index += 1) {
      const attemptReference = attemptReferences[index];
      const expectedReference = expectedReferences[index];
      if (!attemptReference
        || attemptReference.use !== "hunyuan-shape-concept-conditioning"
        || !Number.isFinite(Date.parse(attemptReference.copiedAt))
        || stableJson({
          version: attemptReference.version,
          sha256: attemptReference.sha256,
          mediaType: attemptReference.mediaType,
          byteSize: attemptReference.byteSize,
          width: attemptReference.width,
          height: attemptReference.height,
          originalName: attemptReference.originalName,
          ...(attemptReference.view === undefined ? {} : { view: attemptReference.view }),
        }) !== stableJson(expectedReference)) {
        throw new Error("Concept attempt does not retain the exact reference-image evidence bound by AssetSpec.");
      }
    }
  } else if (attemptReferences.length > 0 || binding.referenceSha256 !== null || (binding.referenceImageBindings?.length ?? 0) > 0) {
    throw new Error("Prompt-only concept attempt contains unexpected reference-image evidence.");
  }
  /* Legacy single-reference records remain readable. */
  const attemptReference = attempt.referenceImage;
  if (spec.referenceImage && spec.referenceImages === undefined) {
    if (!attemptReference
      || attemptReference.use !== "hunyuan-shape-concept-conditioning"
      || !Number.isFinite(Date.parse(attemptReference.copiedAt))
      || stableJson({
        version: attemptReference.version,
        sha256: attemptReference.sha256,
        mediaType: attemptReference.mediaType,
        byteSize: attemptReference.byteSize,
        width: attemptReference.width,
        height: attemptReference.height,
        originalName: attemptReference.originalName,
      }) !== stableJson(spec.referenceImage)) {
      throw new Error("Concept attempt does not retain the exact reference-image evidence bound by AssetSpec.");
    }
  }
  if (binding.specFingerprint !== sha256Hex(binding.specCanonical)) throw new Error("Concept approval spec fingerprint is invalid.");
  if (!retained || stableJson(retained.promptPlan) !== stableJson(attempt.promptPlan)) {
    throw new Error("Concept attempt prompt plan does not match its immutable binding.");
  }
  if (hasStructuredConceptProtocol(attempt)) {
    if (!SHA256.test(attempt.technicalReview.reportSha256 ?? "")
      || attempt.technicalReview.status !== "pass"
      || attempt.technicalReview.reportVersion !== 1
      || attempt.technicalReview.semanticResemblanceChecked !== false
      || attempt.technicalReview.visualReviewRequired !== true
      || attempt.technicalReview.presentationContractSha256 !== sha256Hex(stableJson(attempt.promptPlan.presentationContract))) {
      throw new Error("Concept attempt technical review is incomplete or does not match its presentation contract.");
    }
  }
  if (binding.conceptSha256 !== actualConceptSha256) throw new Error("Concept approval does not match the retained image hash.");
}

export function assertGeometryApproval(
  jobId: string,
  spec: AssetSpecV1,
  attempt: Prompt3DConceptAttempt | undefined,
  approval: Prompt3DConceptApproval | undefined,
  actualConceptSha256: string,
  inspection?: Prompt3DConceptInspectionRecord,
): asserts approval is Prompt3DConceptApproval {
  if (!supportsConceptWorkflow(spec)) {
    if (attempt || approval) throw new Error("Concept approval cannot authorize a different provider or route.");
    return;
  }
  if (!attempt || !approval) throw new Error("Explicit concept approval is required before geometry can start.");
  assertConceptAttemptBinding(jobId, spec, attempt, actualConceptSha256);
  if (jobId !== approval.jobId) throw new Error("Concept approval belongs to a different job.");
  if (approval.conceptSha256 !== actualConceptSha256) throw new Error("Concept approval does not match the retained image hash.");
  if (approval.source !== "explicit-user-action" || !Number.isFinite(Date.parse(approval.approvedAt))) throw new Error("Concept approval was not recorded as an explicit user action.");
  if (stableJson(approvalBinding(approval)) !== stableJson(attempt.binding)) throw new Error("Concept approval binding does not match the retained attempt.");
  if (approval.specFingerprint !== sha256Hex(approval.specCanonical)) throw new Error("Concept approval spec fingerprint is invalid.");
  if (hasStructuredConceptProtocol(attempt)) {
    assertConceptInspectionRecord(spec, attempt, inspection, "approved");
    if (approval.inspectionSha256 !== inspection.sha256) throw new Error("Concept approval does not bind the exact structured inspection record.");
  }
}

export function nextConceptRetrySpec(spec: AssetSpecV1): AssetSpecV1 {
  if (spec.seed >= 0x7fffffff) throw new Error("Choose a lower seed before regenerating this concept.");
  return {
    ...sanitizeAssetSpec(spec),
    seed: spec.seed + 1,
    variants: 1,
    generateTextures: false,
  };
}

export interface Prompt3DShapeRefinementConceptChain {
  firstRefinementJobId: string;
  immediateConceptParentJobId: string;
  regenerationCount: number;
}

/**
 * Proves the prompt edit which began a shape refinement and every subsequent
 * prompt edit or concept-only regeneration without confusing those attempts
 * with the last approved geometry parent.
 */
export function assertShapeRefinementConceptChain(
  attempts: readonly Prompt3DConceptAttempt[] | undefined,
  decisions: readonly Prompt3DConceptDecision[] | undefined,
  approvedParent: Prompt3DConceptApproval | undefined,
  approvedRefinement: Prompt3DConceptApproval | undefined,
): Prompt3DShapeRefinementConceptChain {
  if (!Array.isArray(attempts) || !Array.isArray(decisions) || !approvedParent || !approvedRefinement) {
    throw new Error("Prompted Hunyuan shape refinement is missing its retained concept-decision chain.");
  }
  const attemptIds = attempts.map((attempt) => attempt?.binding?.attemptId);
  if (attemptIds.some((value) => typeof value !== "string") || new Set(attemptIds).size !== attemptIds.length) {
    throw new Error("Prompted Hunyuan shape refinement contains duplicate or invalid concept attempts.");
  }
  const byJob = new Map<string, Prompt3DConceptAttempt>();
  for (const attempt of attempts) {
    const binding = attempt.binding;
    const retained = retainedConceptWorkflowInput(binding);
    if (!Number.isInteger(attempt.attemptNumber) || attempt.attemptNumber < 1
      || binding.attemptId !== `${binding.jobId}:concept:${attempt.attemptNumber}`
      || binding.specFingerprint !== sha256Hex(binding.specCanonical)
      || !retained || retained.spec.seed !== binding.seed || retained.spec.prompt !== binding.prompt
      || retained.spec.providerId !== binding.providerId
      || stableJson(retained.promptPlan) !== stableJson(attempt.promptPlan)
      || byJob.has(binding.jobId)) {
      throw new Error("Prompted Hunyuan shape refinement contains an invalid retained concept attempt.");
    }
    byJob.set(binding.jobId, attempt);
  }
  const parentAttempt = byJob.get(approvedParent.jobId);
  const finalAttempt = byJob.get(approvedRefinement.jobId);
  if (!parentAttempt || !finalAttempt
    || stableJson(parentAttempt.binding) !== stableJson(approvalBinding(approvedParent))
    || stableJson(finalAttempt.binding) !== stableJson(approvalBinding(approvedRefinement))) {
    throw new Error("Prompted Hunyuan shape refinement approvals do not match its retained concept attempts.");
  }

  let current = parentAttempt;
  let firstRefinementJobId = "";
  let immediateConceptParentJobId = "";
  let regenerationCount = 0;
  const visited = new Set<string>([approvedParent.jobId]);
  while (current.binding.jobId !== approvedRefinement.jobId) {
    if (visited.size > 128) throw new Error("Prompted Hunyuan shape-refinement concept chain exceeds the retained audit limit.");
    const edges = decisions.filter((decision) => decision?.jobId === current.binding.jobId
      && decision.attemptId === current.binding.attemptId && decision.nextJobId !== undefined);
    if (edges.length !== 1) {
      throw new Error("Prompted Hunyuan shape refinement requires one exact decision for each concept successor.");
    }
    const edge = edges[0];
    const firstRefinementEdge = !firstRefinementJobId;
    const validSuccessorKind = edge.kind === "edited" || (!firstRefinementEdge && edge.kind === "regenerated");
    if (!validSuccessorKind || edge.source !== "explicit-user-action"
      || !edge.nextJobId || !Number.isFinite(Date.parse(edge.at)) || visited.has(edge.nextJobId)) {
      throw new Error(firstRefinementEdge
        ? "Prompted Hunyuan shape refinement must begin with an explicit edited concept decision."
        : "Prompted Hunyuan shape refinement has an invalid replacement concept decision.");
    }
    if (current.binding.jobId !== approvedParent.jobId && hasStructuredConceptProtocol(current)
      && current.technicalReview.status === "pass") {
      const rejections = decisions.filter((decision) => decision?.jobId === current.binding.jobId
        && decision.attemptId === current.binding.attemptId && decision.kind === "rejected");
      if (rejections.length !== 1
        || rejections[0].inspectionSha256 !== edge.inspectionSha256
        || rejections[0].inspectionPath !== edge.inspectionPath
        || !["presentation", "semantic-anatomy-parts", "prompt-negation-misunderstanding", "other"].includes(rejections[0].rejectionClassification ?? "")) {
        throw new Error("Prompted Hunyuan replacement concept is missing its explicit classified rejection decision.");
      }
    }
    const next = byJob.get(edge.nextJobId);
    if (!next || next.binding.providerId !== current.binding.providerId
      || next.binding.referenceSha256 !== current.binding.referenceSha256) {
      throw new Error("Prompted Hunyuan shape-refinement concept provider or reference binding is discontinuous.");
    }
    const incrementedSeed = current.binding.seed < 0x7fffffff && next.binding.seed === current.binding.seed + 1;
    // Builds before the fresh-seed prompt-edit rule retained some genuine prompt
    // edits at the same seed. Their exact prompt, compiled plan, spec, inspection,
    // provider, reference and successor hashes remain mandatory. New successors
    // are rejected at service intake unless they increment the seed exactly once.
    const retainedLegacyEditedSeed = edge.kind === "edited" && next.binding.seed === current.binding.seed;
    if (!incrementedSeed && !retainedLegacyEditedSeed) {
      throw new Error("Prompted Hunyuan shape-refinement concept seeds are discontinuous.");
    }
    if (hasStructuredConceptProtocol(current)) {
      if (edge.nextPrompt !== next.binding.prompt
        || edge.nextPromptSha256 !== sha256Hex(next.binding.prompt)
        || edge.nextPromptPlanSha256 !== sha256Hex(stableJson(next.promptPlan))
        || edge.nextPresentationContractSha256 !== sha256Hex(stableJson(next.promptPlan.presentationContract))
        || edge.nextSeed !== next.binding.seed
        || edge.nextSpecFingerprint !== next.binding.specFingerprint
        || !SHA256.test(edge.inspectionSha256 ?? "")) {
        throw new Error("Prompted Hunyuan concept successor decision does not bind its exact prompt, plan, seed and inspection.");
      }
      if (current.technicalReview.status === "needs-regeneration"
        && (edge.inspectionSha256 !== current.technicalReview.reportSha256
          || edge.inspectionPath !== current.technicalReview.reportPath)) {
        throw new Error("Prompted Hunyuan technically rejected concept successor does not bind its exact technical-review report.");
      }
    }
    const currentInput = retainedConceptWorkflowInput(current.binding)!;
    const nextInput = retainedConceptWorkflowInput(next.binding)!;
    if (edge.kind === "edited") {
      if (next.binding.prompt === current.binding.prompt) {
        throw new Error("Prompted Hunyuan shape refinement is missing its explicit edited prompt.");
      }
      if (!firstRefinementJobId) firstRefinementJobId = next.binding.jobId;
    } else {
      const expectedSpec = { ...currentInput.spec, seed: next.binding.seed, variants: 1, generateTextures: false };
      if (stableJson(nextInput.spec) !== stableJson(expectedSpec)
        || stableJson(nextInput.promptPlan) !== stableJson(currentInput.promptPlan)) {
        throw new Error("Prompted Hunyuan concept regeneration changed more than the retained seed.");
      }
      regenerationCount += 1;
    }
    immediateConceptParentJobId = current.binding.jobId;
    visited.add(next.binding.jobId);
    current = next;
  }
  if (!firstRefinementJobId || !immediateConceptParentJobId) {
    throw new Error("Prompted Hunyuan shape refinement lacks an edited base-to-refinement decision.");
  }
  return { firstRefinementJobId, immediateConceptParentJobId, regenerationCount };
}

function uniqueAttempts(job: Prompt3DJobStatus): Prompt3DConceptAttempt[] {
  const values = [...(job.conceptAttempts ?? []), ...(job.conceptAttempt ? [job.conceptAttempt] : [])];
  return values.filter((attempt, index) => values.findIndex((candidate) => candidate.binding.attemptId === attempt.binding.attemptId) === index);
}

function uniqueInspections(job: Prompt3DJobStatus): Prompt3DConceptInspectionRecord[] {
  const values = [...(job.conceptInspections ?? []), ...(job.conceptInspection ? [job.conceptInspection] : [])];
  return values.filter((record, index) => values.findIndex((candidate) => candidate.evidence.inspectionId === record.evidence.inspectionId) === index);
}

export function inheritConceptHistory(
  previous: Prompt3DJobStatus,
  nextJobId: string,
  kind: Extract<Prompt3DConceptDecision["kind"], "regenerated" | "edited">,
  at = new Date().toISOString(),
  nextSpec?: AssetSpecV1,
): { attempts: Prompt3DConceptAttempt[]; decisions: Prompt3DConceptDecision[]; inspections: Prompt3DConceptInspectionRecord[] } {
  if (!previous.conceptAttempt) throw new Error("The previous concept attempt is not retained.");
  let successorFields: Partial<Prompt3DConceptDecision> = {};
  if (hasStructuredConceptProtocol(previous.conceptAttempt)) {
    if (!nextSpec) throw new Error("Structured concept successor history requires the exact next specification.");
    const technicalReplacement = previous.conceptAttempt.technicalReview.status === "needs-regeneration";
    const inspection = previous.conceptInspection;
    if (!technicalReplacement) {
      assertConceptInspectionRecord(previous.spec, previous.conceptAttempt, inspection);
      if (previous.state !== "complete" && inspection.evidence.decision !== "rejected") {
        throw new Error("A replacement concept requires an explicit classified rejection of the retained attempt.");
      }
    }
    const nextCanonical = conceptSpecCanonical(nextSpec);
    const nextPlan = retainedConceptWorkflowInput({
      ...previous.conceptAttempt.binding,
      jobId: nextJobId,
      attemptId: `${nextJobId}:concept:1`,
      prompt: nextSpec.prompt,
      seed: nextSpec.seed,
      providerId: nextSpec.providerId,
      specCanonical: nextCanonical,
      specFingerprint: sha256Hex(nextCanonical),
      referenceSha256: nextSpec.referenceImage?.sha256 ?? null,
      referenceImageBindings: conceptReferenceImageBindings(nextSpec),
    })?.promptPlan;
    if (!nextPlan) throw new Error("The successor concept prompt plan could not be retained.");
    successorFields = {
      inspectionSha256: technicalReplacement ? previous.conceptAttempt.technicalReview.reportSha256 : inspection!.sha256,
      inspectionPath: technicalReplacement ? previous.conceptAttempt.technicalReview.reportPath : inspection!.path,
      nextPrompt: nextSpec.prompt,
      nextPromptSha256: sha256Hex(nextSpec.prompt),
      nextPromptPlanSha256: sha256Hex(stableJson(nextPlan)),
      nextPresentationContractSha256: sha256Hex(stableJson(nextPlan.presentationContract)),
      nextSeed: nextSpec.seed,
      nextSpecFingerprint: sha256Hex(nextCanonical),
    };
  }
  return {
    attempts: uniqueAttempts(previous),
    inspections: uniqueInspections(previous),
    decisions: [
      ...(previous.conceptDecisions ?? []),
      {
        kind,
        source: "explicit-user-action",
        at,
        jobId: previous.id,
        attemptId: previous.conceptAttempt.binding.attemptId,
        nextJobId,
        ...successorFields,
      },
    ],
  };
}

export function approvalProvenanceFields(
  jobId: string,
  spec: AssetSpecV1,
  attempt: Prompt3DConceptAttempt | undefined,
  approval: Prompt3DConceptApproval | undefined,
  actualConceptSha256: string,
  inspection?: Prompt3DConceptInspectionRecord,
) {
  assertGeometryApproval(jobId, spec, attempt, approval, actualConceptSha256, inspection);
  if (!supportsConceptWorkflow(spec)) return { approvedConcept: false as const };
  return {
    approvedConcept: true as const,
    conceptAttempt: attempt,
    conceptInspection: inspection,
    conceptApproval: approval,
  };
}
