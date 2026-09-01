import { createHash } from "node:crypto";
import type {
  AssetSpecV1,
  Prompt3DConceptApproval,
  Prompt3DConceptAttempt,
  Prompt3DConceptBinding,
  Prompt3DConceptDecision,
  Prompt3DJobStatus,
} from "../../shared/prompt3d";
import {
  CONCEPT_WORKFLOW_VERSION,
  conceptBindingMatchesSpec,
  conceptSpecCanonical,
  sanitizeAssetSpec,
  stableJson,
  supportsConceptWorkflow,
} from "../../shared/conceptWorkflow";

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
    referenceSha256: null,
  };
}

export function createConceptApproval(
  binding: Prompt3DConceptBinding,
  approvedAt = new Date().toISOString(),
): Prompt3DConceptApproval {
  if (!Number.isFinite(Date.parse(approvedAt))) throw new Error("Concept approval time is invalid.");
  return { ...binding, approvedAt, source: "explicit-user-action" };
}

function approvalBinding(approval: Prompt3DConceptApproval): Prompt3DConceptBinding {
  const { approvedAt: _approvedAt, source: _source, ...binding } = approval;
  return binding;
}

export function assertGeometryApproval(
  jobId: string,
  spec: AssetSpecV1,
  attempt: Prompt3DConceptAttempt | undefined,
  approval: Prompt3DConceptApproval | undefined,
  actualConceptSha256: string,
): asserts approval is Prompt3DConceptApproval {
  if (!supportsConceptWorkflow(spec)) {
    if (attempt || approval) throw new Error("Concept approval cannot authorize a different provider or route.");
    return;
  }
  if (!attempt || !approval) throw new Error("Explicit concept approval is required before geometry can start.");
  if (jobId !== attempt.binding.jobId || jobId !== approval.jobId) throw new Error("Concept approval belongs to a different job.");
  if (!conceptBindingMatchesSpec(attempt.binding, spec)) throw new Error("Concept approval is stale because the prompt, seed, provider, reference or spec changed.");
  if (attempt.binding.conceptSha256 !== actualConceptSha256 || approval.conceptSha256 !== actualConceptSha256) throw new Error("Concept approval does not match the retained image hash.");
  if (approval.source !== "explicit-user-action" || !Number.isFinite(Date.parse(approval.approvedAt))) throw new Error("Concept approval was not recorded as an explicit user action.");
  if (stableJson(approvalBinding(approval)) !== stableJson(attempt.binding)) throw new Error("Concept approval binding does not match the retained attempt.");
  if (approval.specFingerprint !== sha256Hex(approval.specCanonical)) throw new Error("Concept approval spec fingerprint is invalid.");
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

function uniqueAttempts(job: Prompt3DJobStatus): Prompt3DConceptAttempt[] {
  const values = [...(job.conceptAttempts ?? []), ...(job.conceptAttempt ? [job.conceptAttempt] : [])];
  return values.filter((attempt, index) => values.findIndex((candidate) => candidate.binding.attemptId === attempt.binding.attemptId) === index);
}

export function inheritConceptHistory(
  previous: Prompt3DJobStatus,
  nextJobId: string,
  kind: Extract<Prompt3DConceptDecision["kind"], "regenerated" | "edited">,
  at = new Date().toISOString(),
): { attempts: Prompt3DConceptAttempt[]; decisions: Prompt3DConceptDecision[] } {
  if (!previous.conceptAttempt) throw new Error("The previous concept attempt is not retained.");
  return {
    attempts: uniqueAttempts(previous),
    decisions: [
      ...(previous.conceptDecisions ?? []),
      {
        kind,
        source: "explicit-user-action",
        at,
        jobId: previous.id,
        attemptId: previous.conceptAttempt.binding.attemptId,
        nextJobId,
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
) {
  assertGeometryApproval(jobId, spec, attempt, approval, actualConceptSha256);
  if (!supportsConceptWorkflow(spec)) return { approvedConcept: false as const };
  return {
    approvedConcept: true as const,
    conceptAttempt: attempt,
    conceptApproval: approval,
  };
}
