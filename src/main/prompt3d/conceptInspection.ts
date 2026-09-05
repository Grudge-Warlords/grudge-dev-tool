import { createHash, randomUUID } from "node:crypto";
import type {
  AssetSpecV1,
  Prompt3DConceptAttempt,
  Prompt3DConceptInspectionChecks,
  Prompt3DConceptInspectionEvidence,
  Prompt3DConceptInspectionRecord,
  Prompt3DConceptRejectionClassification,
} from "../../shared/prompt3d";
import { stableJson } from "../../shared/conceptWorkflow";

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_REJECTION_NOTE = 500;

const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

export function hasStructuredConceptProtocol(attempt: Prompt3DConceptAttempt | undefined): boolean {
  return Boolean(attempt?.promptPlan?.presentationContract?.version === 1);
}

function assertChecks(checks: Prompt3DConceptInspectionChecks): void {
  if (!checks || ![checks.identityAndRequiredParts, checks.subjectPresentation, checks.framingBackgroundAndSupport]
    .every((value) => value === "pass" || value === "fail")) {
    throw new Error("Concept inspection requires an explicit pass or fail for all three review checks.");
  }
}

function normalizeRejection(
  checks: Prompt3DConceptInspectionChecks,
  classification: Prompt3DConceptRejectionClassification | undefined,
  note: string | undefined,
): Prompt3DConceptInspectionEvidence["rejection"] {
  if (!classification || !["presentation", "semantic-anatomy-parts", "prompt-negation-misunderstanding", "other"].includes(classification)) {
    throw new Error("Concept rejection requires an explicit classification.");
  }
  if (![checks.identityAndRequiredParts, checks.subjectPresentation, checks.framingBackgroundAndSupport].includes("fail")) {
    throw new Error("A rejected concept must fail at least one explicit inspection check.");
  }
  if (classification === "presentation"
    && checks.subjectPresentation !== "fail" && checks.framingBackgroundAndSupport !== "fail") {
    throw new Error("Presentation rejection must identify a failed presentation or framing check.");
  }
  if (classification === "semantic-anatomy-parts" && checks.identityAndRequiredParts !== "fail") {
    throw new Error("Semantic anatomy or parts rejection must identify a failed identity check.");
  }
  const normalizedNote = note?.trim();
  if (normalizedNote && (normalizedNote.length > MAX_REJECTION_NOTE || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(normalizedNote))) {
    throw new Error(`Concept rejection notes must be plain text no longer than ${MAX_REJECTION_NOTE} characters.`);
  }
  if (classification === "other" && !normalizedNote) throw new Error("Other concept rejection requires a short explanation.");
  return { classification, ...(normalizedNote ? { note: normalizedNote } : {}) };
}

export function createConceptInspectionEvidence(
  spec: AssetSpecV1,
  attempt: Prompt3DConceptAttempt,
  decision: "approved" | "rejected",
  checks: Prompt3DConceptInspectionChecks,
  options: {
    classification?: Prompt3DConceptRejectionClassification;
    note?: string;
    inspectionId?: string;
    inspectedAt?: string;
  } = {},
): Prompt3DConceptInspectionEvidence {
  assertChecks(checks);
  if (!hasStructuredConceptProtocol(attempt)) throw new Error("This retained concept predates structured inspection; generate a fresh concept before approval.");
  const reportSha256 = attempt.technicalReview.reportSha256;
  const presentationContractSha256 = attempt.technicalReview.presentationContractSha256;
  if (!SHA256.test(reportSha256 ?? "") || !SHA256.test(presentationContractSha256 ?? "")) {
    throw new Error("Concept technical-review evidence is incomplete; generate a fresh concept.");
  }
  const expectedPresentationSha256 = hash(stableJson(attempt.promptPlan.presentationContract));
  if (presentationContractSha256 !== expectedPresentationSha256) throw new Error("Concept technical review does not match the effective presentation contract.");
  if (decision === "approved" && Object.values(checks).some((value) => value !== "pass")) {
    throw new Error("Approval requires an explicit pass for all three concept inspection checks.");
  }
  const rejection = decision === "rejected"
    ? normalizeRejection(checks, options.classification, options.note)
    : undefined;
  if (decision === "approved" && (options.classification || options.note?.trim())) throw new Error("Approved concept inspection cannot include rejection details.");
  const inspectedAt = options.inspectedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(inspectedAt))) throw new Error("Concept inspection time is invalid.");
  const unsigned = {
    version: 1 as const,
    inspectionId: options.inspectionId ?? randomUUID(),
    source: "explicit-user-action" as const,
    decision,
    jobId: attempt.binding.jobId,
    attemptId: attempt.binding.attemptId,
    conceptSha256: attempt.binding.conceptSha256,
    promptSha256: hash(attempt.binding.prompt),
    promptPlanSha256: hash(stableJson(attempt.promptPlan)),
    presentationContractSha256,
    technicalReviewSha256: reportSha256!,
    seed: attempt.binding.seed,
    providerId: attempt.binding.providerId,
    specFingerprint: attempt.binding.specFingerprint,
    checks: { ...checks },
    ...(rejection ? { rejection } : {}),
    inspectedAt,
  };
  return { ...unsigned, bindingSha256: hash(stableJson(unsigned)) };
}

export function assertConceptInspectionRecord(
  spec: AssetSpecV1,
  attempt: Prompt3DConceptAttempt,
  record: Prompt3DConceptInspectionRecord | undefined,
  decision?: "approved" | "rejected",
): asserts record is Prompt3DConceptInspectionRecord {
  if (!record || typeof record.path !== "string" || !SHA256.test(record.sha256)) throw new Error("Hash-bound concept inspection evidence is missing.");
  const evidence = record.evidence;
  if (!evidence || (decision && evidence.decision !== decision) || evidence.source !== "explicit-user-action") {
    throw new Error("Concept inspection decision or source is invalid.");
  }
  const expected = createConceptInspectionEvidence(spec, attempt, evidence.decision, evidence.checks, {
    classification: evidence.rejection?.classification,
    note: evidence.rejection?.note,
    inspectionId: evidence.inspectionId,
    inspectedAt: evidence.inspectedAt,
  });
  if (stableJson(expected) !== stableJson(evidence)
    || record.sha256 !== hash(stableJson(evidence))
    || evidence.jobId !== attempt.binding.jobId
    || evidence.attemptId !== attempt.binding.attemptId
    || evidence.conceptSha256 !== attempt.binding.conceptSha256
    || evidence.seed !== spec.seed
    || evidence.providerId !== spec.providerId) {
    throw new Error("Concept inspection evidence does not match the exact retained attempt.");
  }
}
