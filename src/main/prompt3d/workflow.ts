import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream, existsSync } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AssetSpecV1, Prompt3DConceptAttempt, Prompt3DRetainedReferenceImage } from "../../shared/prompt3d";
import { retainedConceptWorkflowInput, stableJson } from "../../shared/conceptWorkflow";
import type {
  Prompt3DExistingGeometryDecision,
  Prompt3DFinishJobStatus,
  Prompt3DFinishVisualRejection,
  Prompt3DFinishValidation,
  Prompt3DVisualApproval,
  Prompt3DVisualApprovalStage,
  Prompt3DWorkflowEvidenceBundleEntry,
  Prompt3DWorkflowEvidenceBundleManifest,
  Prompt3DWorkflowEvidenceKind,
  Prompt3DWorkflowLineage,
  Prompt3DWorkflowLibraryAsset,
  Prompt3DWorkflowRootLineage,
  Prompt3DWorkflowRevisionLineage,
  Prompt3DWorkflowSaveResult,
} from "../../shared/prompt3dWorkflow";
import {
  PROMPT3D_MIN_WORKFLOW_ANIMATION_REVISIONS,
  PROMPT3D_MIN_WORKFLOW_TEXTURE_REVISIONS,
} from "../../shared/prompt3dWorkflow";
import { assertPrompt3DVisualInspectionEvidence } from "../../shared/prompt3dVisualInspection";
import { fitHunyuanClipBudget } from "../../shared/prompt3dRules";
import { assertConceptAttemptBinding, assertGeometryApproval, assertShapeRefinementConceptChain } from "./conceptApproval";
import { assertConceptInspectionRecord, hasStructuredConceptProtocol } from "./conceptInspection";
import { assertPrompt3DReferenceImageSpec, prompt3DReferenceImageMatches } from "./referenceImage";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_EVIDENCE_BYTES = 2 * 1024 ** 2;
const MAX_EVIDENCE_BUNDLE_FILES = 4_096;
const MAX_EVIDENCE_BUNDLE_BYTES = 16 * 1024 ** 3;
const MAX_EVIDENCE_BUNDLE_FILE_BYTES = 1024 ** 3;
const MAX_EVIDENCE_BUNDLE_MANIFEST_BYTES = 4 * 1024 ** 2;
const MAX_GEOMETRY_REJECTION_CHAIN = 128;

export function stableWorkflowSha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function workflowPromptSha256(prompt: string): string {
  return createHash("sha256").update(prompt.trim().replace(/\s+/g, " ")).digest("hex");
}

export function workflowSpecFingerprint(spec: AssetSpecV1): string {
  return stableWorkflowSha256(spec);
}

type VisualApprovalBinding = Omit<Prompt3DVisualApproval, "approvalId" | "bindingSha256" | "approvedAt" | "source">;

function visualApprovalBinding(approval: VisualApprovalBinding | Prompt3DVisualApproval): VisualApprovalBinding {
  const {
    approvalId: _approvalId,
    bindingSha256: _bindingSha256,
    approvedAt: _approvedAt,
    source: _source,
    ...binding
  } = approval as Prompt3DVisualApproval;
  return binding;
}

export function visualApprovalBindingSha256(approval: VisualApprovalBinding | Prompt3DVisualApproval): string {
  return stableWorkflowSha256(visualApprovalBinding(approval));
}

export function createPrompt3DVisualApproval(
  binding: VisualApprovalBinding,
  approvedAt = new Date().toISOString(),
): Prompt3DVisualApproval {
  const bindingSha256 = visualApprovalBindingSha256(binding);
  return {
    ...binding,
    approvalId: bindingSha256,
    bindingSha256,
    approvedAt,
    source: "explicit-user-action",
  };
}

export function assertVisualApprovalMatches(
  approval: Prompt3DVisualApproval | undefined,
  expected: Partial<VisualApprovalBinding> = {},
): asserts approval is Prompt3DVisualApproval {
  if (!approval || approval.version !== 1 || approval.source !== "explicit-user-action") throw new Error("Exact persisted visual approval is required.");
  if (!(["geometry", "texture", "animation"] as const).includes(approval.stage)) throw new Error("Visual approval stage is invalid.");
  requireUuid("Visual approval asset ID", approval.assetId);
  requireUuid("Visual approval job ID", approval.jobId);
  if (!approval.assetPath) throw new Error("Visual approval asset path is missing.");
  if (!SHA256.test(approval.bindingSha256) || approval.approvalId !== approval.bindingSha256 || visualApprovalBindingSha256(approval) !== approval.bindingSha256) {
    throw new Error("Visual approval binding hash is invalid.");
  }
  if (!Number.isFinite(Date.parse(approval.approvedAt))) throw new Error("Visual approval time is invalid.");
  for (const key of ["assetSha256", "geometryHash", "promptSha256", "specFingerprint"] as const) {
    if (!SHA256.test(approval[key])) throw new Error(`Visual approval ${key} is invalid.`);
  }
  if (approval.stage === "texture" && !SHA256.test(approval.textureFingerprint ?? "")) throw new Error("Texture approval is not bound to the inspected material result.");
  if (approval.stage === "animation" && !SHA256.test(approval.animationFingerprint ?? "")) throw new Error("Animation approval is not bound to the inspected motion result.");
  if (approval.stage === "geometry" && (approval.textureFingerprint !== undefined || approval.animationFingerprint !== undefined)) throw new Error("Geometry approval contains unrelated finishing evidence.");
  if (approval.stage === "texture" && approval.animationFingerprint !== undefined) throw new Error("Texture approval contains unrelated animation evidence.");
  if (approval.stage === "animation" && approval.textureFingerprint !== undefined) throw new Error("Animation approval contains unrelated texture evidence.");
  assertPrompt3DVisualInspectionEvidence(approval.inspection, {
    assetPath: approval.assetPath,
    assetSha256: approval.assetSha256,
    stage: approval.stage,
    ...(approval.stage === "animation"
      ? { animations: approval.inspection.clips.map((clip) => ({ name: clip.name, duration: clip.duration })) }
      : {}),
  });
  for (const [key, value] of Object.entries(expected)) {
    if (value !== undefined && stableJson((approval as any)[key]) !== stableJson(value)) throw new Error(`Visual approval does not match ${key}.`);
  }
}

type FinishVisualRejectionBinding = Omit<Prompt3DFinishVisualRejection, "rejectionId" | "bindingSha256" | "rejectedAt" | "source">;

function finishVisualRejectionBinding(
  rejection: FinishVisualRejectionBinding | Prompt3DFinishVisualRejection,
): FinishVisualRejectionBinding {
  const {
    rejectionId: _rejectionId,
    bindingSha256: _bindingSha256,
    rejectedAt: _rejectedAt,
    source: _source,
    ...binding
  } = rejection as Prompt3DFinishVisualRejection;
  return binding;
}

export function finishVisualRejectionBindingSha256(
  rejection: FinishVisualRejectionBinding | Prompt3DFinishVisualRejection,
): string {
  return stableWorkflowSha256(finishVisualRejectionBinding(rejection));
}

export function createPrompt3DFinishVisualRejection(
  binding: FinishVisualRejectionBinding,
  rejectedAt = new Date().toISOString(),
): Prompt3DFinishVisualRejection {
  const bindingSha256 = finishVisualRejectionBindingSha256(binding);
  return {
    ...binding,
    rejectionId: bindingSha256,
    bindingSha256,
    rejectedAt,
    source: "explicit-user-action",
  };
}

export function assertFinishVisualRejectionMatches(
  rejection: Prompt3DFinishVisualRejection | undefined,
  expected: Partial<FinishVisualRejectionBinding> = {},
): asserts rejection is Prompt3DFinishVisualRejection {
  if (!rejection || rejection.version !== 1 || rejection.source !== "explicit-user-action") {
    throw new Error("Exact persisted finishing rejection is required.");
  }
  if (rejection.stage !== "texture" && rejection.stage !== "animation") throw new Error("Finishing rejection stage is invalid.");
  requireUuid("Finishing rejection asset ID", rejection.assetId);
  requireUuid("Finishing rejection job ID", rejection.jobId);
  if (!rejection.assetPath) throw new Error("Finishing rejection asset path is missing.");
  if (!SHA256.test(rejection.bindingSha256)
    || rejection.rejectionId !== rejection.bindingSha256
    || finishVisualRejectionBindingSha256(rejection) !== rejection.bindingSha256) {
    throw new Error("Finishing rejection binding hash is invalid.");
  }
  if (!Number.isFinite(Date.parse(rejection.rejectedAt))) throw new Error("Finishing rejection time is invalid.");
  for (const key of ["assetSha256", "geometryHash", "promptSha256", "specFingerprint"] as const) {
    if (!SHA256.test(rejection[key])) throw new Error(`Finishing rejection ${key} is invalid.`);
  }
  if (![
    "appearance-mismatch", "motion-mismatch", "placement-path-mismatch", "deformation-artifact",
    "prompt-negation-misunderstanding", "playback-problem", "other",
  ].includes(rejection.classification)) throw new Error("Finishing rejection classification is invalid.");
  if (typeof rejection.note !== "string" || rejection.note.length > 500 || (rejection.classification === "other" && !rejection.note)) {
    throw new Error("Finishing rejection note is invalid.");
  }
  if (rejection.stage === "texture") {
    if (!SHA256.test(rejection.textureFingerprint ?? "") || rejection.animationFingerprint !== undefined || rejection.animationPlanSha256 !== undefined) {
      throw new Error("Texture rejection is not bound to the inspected material result.");
    }
  } else if (!SHA256.test(rejection.animationFingerprint ?? "") || !SHA256.test(rejection.animationPlanSha256 ?? "") || rejection.textureFingerprint !== undefined) {
    throw new Error("Animation rejection is not bound to the inspected motion result and plan.");
  }
  for (const [key, value] of Object.entries(expected)) {
    if (value !== undefined && stableJson((rejection as any)[key]) !== stableJson(value)) throw new Error(`Finishing rejection does not match ${key}.`);
  }
}

type ExistingGeometryDecisionBinding = Omit<Prompt3DExistingGeometryDecision, "decisionId" | "bindingSha256" | "decidedAt" | "source">;

function existingGeometryDecisionBinding(
  decision: ExistingGeometryDecisionBinding | Prompt3DExistingGeometryDecision,
): ExistingGeometryDecisionBinding {
  const {
    decisionId: _decisionId,
    bindingSha256: _bindingSha256,
    decidedAt: _decidedAt,
    source: _source,
    ...binding
  } = decision as Prompt3DExistingGeometryDecision;
  return binding;
}

export function createPrompt3DExistingGeometryDecision(
  binding: ExistingGeometryDecisionBinding,
  decidedAt = new Date().toISOString(),
): Prompt3DExistingGeometryDecision {
  const bindingSha256 = stableWorkflowSha256(existingGeometryDecisionBinding(binding));
  return {
    ...binding,
    decisionId: bindingSha256,
    bindingSha256,
    decidedAt,
    source: "explicit-user-action",
  };
}

export function assertPrompt3DExistingGeometryDecision(
  decision: Prompt3DExistingGeometryDecision | undefined,
  expected: Partial<ExistingGeometryDecisionBinding> = {},
): asserts decision is Prompt3DExistingGeometryDecision {
  if (!decision || decision.version !== 1 || decision.mode !== "use-existing-generated-model" || decision.source !== "explicit-user-action") {
    throw new Error("Complete workflow lineage requires an approved base Hunyuan generation followed by at least one prompted refined Hunyuan generation, unless an exact explicit use-existing-generated-model decision is retained for the approved base.");
  }
  requireUuid("Existing-geometry decision asset ID", decision.assetId);
  requireUuid("Existing-geometry decision generation job ID", decision.generationJobId);
  if (decision.variantIndex !== 0) throw new Error("Existing-geometry decision must bind the exact approved first variant.");
  if (!Number.isFinite(Date.parse(decision.decidedAt))) throw new Error("Existing-geometry decision time is invalid.");
  for (const [label, value] of [
    ["Existing-geometry decision binding hash", decision.bindingSha256],
    ["Existing-geometry decision asset hash", decision.assetSha256],
    ["Existing-geometry decision geometry hash", decision.geometryHash],
    ["Existing-geometry decision visual approval hash", decision.visualApprovalSha256],
  ] as const) requireSha256(label, value);
  if (decision.decisionId !== decision.bindingSha256
    || stableWorkflowSha256(existingGeometryDecisionBinding(decision)) !== decision.bindingSha256) {
    throw new Error("Existing-geometry decision binding hash is invalid.");
  }
  for (const [key, value] of Object.entries(expected)) {
    if (value !== undefined && stableJson((decision as any)[key]) !== stableJson(value)) {
      throw new Error(`Existing-geometry decision does not match ${key}.`);
    }
  }
}

export function prompt3DWorkflowUsesExistingGeneratedModel(lineage: Prompt3DWorkflowLineage): boolean {
  if (!Array.isArray(lineage.generationChain) || lineage.generationChain.length < 1) {
    throw new Error("Workflow generation lineage is empty.");
  }
  if (lineage.generationChain.length > 1) {
    if (lineage.existingGeometryDecision !== undefined) {
      throw new Error("A refined Hunyuan generation chain cannot contain a forged use-existing-model decision.");
    }
    return false;
  }
  const root = lineage.generationChain[0];
  assertPrompt3DExistingGeometryDecision(lineage.existingGeometryDecision, {
    version: 1,
    mode: "use-existing-generated-model",
    assetId: lineage.assetId,
    generationJobId: root.jobId,
    variantIndex: 0,
    assetSha256: root.outputSha256,
    geometryHash: root.geometryHash,
    visualApprovalSha256: root.visualApprovalSha256,
  });
  return true;
}

export function sealPrompt3DWorkflowLineage(lineage: Omit<Prompt3DWorkflowLineage, "chainSha256">): Prompt3DWorkflowLineage {
  const chainSha256 = stableWorkflowSha256(lineage);
  return { ...lineage, chainSha256 };
}

export function assertPrompt3DWorkflowLineageSeal(lineage: Prompt3DWorkflowLineage): void {
  const { chainSha256, ...unsealed } = lineage;
  if (!SHA256.test(chainSha256) || stableWorkflowSha256(unsealed) !== chainSha256) throw new Error("Workflow lineage seal is invalid.");
}

export function containedWorkflowPath(root: string, target: string): string {
  const a = resolve(root), b = resolve(target), rel = relative(a, b);
  if (rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))) return b;
  throw new Error("Path escapes the Prompt-to-3D workflow root.");
}

export function workflowDirectory(root: string, id: string): string {
  if (!UUID.test(id)) throw new Error("Invalid Prompt-to-3D finishing job ID.");
  return containedWorkflowPath(root, join(root, "workflow-history", id));
}

export type Prompt3DWorkflowEvidencePathResolver = (sourcePath: string) => string;

export interface Prompt3DWorkflowEvidenceBundleHandle {
  manifest: Prompt3DWorkflowEvidenceBundleManifest;
  manifestPath: string;
  manifestSha256: string;
  lineage: Prompt3DWorkflowLineage;
  lineagePath: string;
  resolveSourcePath: Prompt3DWorkflowEvidencePathResolver;
}

type EvidenceSource = { sourcePath: string; kind: Prompt3DWorkflowEvidenceKind };
type EvidenceBundleExpected = {
  bundleId?: string;
  assetId?: string;
  sourceJobId?: string;
  lineageSha256?: string;
};

const pathIdentity = (value: string) => process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value);
const evidenceBundlesRoot = (root: string) => containedWorkflowPath(root, join(root, "saved-assets", "evidence-bundles"));
const evidenceBundleDirectory = (root: string, id: string) => {
  requireUuid("Evidence-bundle ID", id);
  return containedWorkflowPath(root, join(evidenceBundlesRoot(root), id));
};

function evidenceFileLimit(path: string): number {
  const extension = extname(path).toLowerCase();
  return extension === ".json" || extension === ".jsonl" || extension === ".log" || extension === ".txt"
    ? 64 * 1024 ** 2
    : MAX_EVIDENCE_BUNDLE_FILE_BYTES;
}

function evidenceKind(path: string): Prompt3DWorkflowEvidenceKind {
  const name = basename(path).toLowerCase();
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  if (name === "lineage.json") return "lineage";
  if (name === "concept.png" || name === "concept.jpg" || name === "concept.jpeg" || name === "concept.webp") return "concept-image";
  if (name === "concept-source.png") return "concept-source";
  if (name === "concept-review.json") return "concept-review";
  if (name === "concept-attempt.json") return "concept-attempt";
  if (name === "concept-inspection.json") return "concept-inspection";
  if (name === "concept-approval.json") return "concept-approval";
  if (name.startsWith("reference-source.")) return "reference-image";
  if (name === "visual-rejection.json") return "geometry-rejection";
  if (name === "visual-approval.json") return "visual-approval";
  if (name.startsWith("texture-reference.")) return "texture-reference";
  if (name === "asset-spec.json") return "spec";
  if (name === "provenance.json") return "provenance";
  if (name === "job.json") return "job-record";
  if (normalized.includes("/events/") && name.endsWith(".json")) return "event";
  if (name.includes("plan") && name.endsWith(".json")) return "plan";
  if (name.includes("validation") && name.endsWith(".json")) return "validation";
  if (name.endsWith(".jsonl") || name.endsWith(".log") || name.endsWith(".txt")) return "log";
  if (name.endsWith(".glb")) return normalized.includes("/jobs/") ? "generation-output" : "finish-output";
  return "other";
}

async function assertSafeExistingPath(root: string, target: string, type: "file" | "directory"): Promise<string> {
  const rootPath = resolve(root);
  const targetPath = containedWorkflowPath(rootPath, target);
  const rootInfo = await lstat(rootPath);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Prompt-to-3D workflow root must be a regular directory, not a link.");
  const rel = relative(rootPath, targetPath);
  let cursor = rootPath;
  for (const part of rel.split(/[\\/]+/).filter(Boolean)) {
    cursor = join(cursor, part);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) throw new Error("Evidence path contains a symbolic link.");
  }
  const [actualRoot, actualTarget] = await Promise.all([realpath(rootPath), realpath(targetPath)]);
  containedWorkflowPath(actualRoot, actualTarget);
  const info = await lstat(targetPath);
  if (info.isSymbolicLink() || (type === "file" ? !info.isFile() : !info.isDirectory())) {
    throw new Error(`Evidence ${type} is not a regular ${type}.`);
  }
  return targetPath;
}

async function ensureSafeDirectory(root: string, target: string): Promise<string> {
  const rootPath = resolve(root);
  const targetPath = containedWorkflowPath(rootPath, target);
  const rootInfo = await lstat(rootPath);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Prompt-to-3D workflow root must be a regular directory, not a link.");
  const rel = relative(rootPath, targetPath);
  let cursor = rootPath;
  for (const part of rel.split(/[\\/]+/).filter(Boolean)) {
    cursor = join(cursor, part);
    try {
      const info = await lstat(cursor);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Evidence-bundle directory path contains a link or non-directory.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(cursor, { mode: 0o700 });
      const created = await lstat(cursor);
      if (!created.isDirectory() || created.isSymbolicLink()) throw new Error("Evidence-bundle directory could not be created safely.");
    }
  }
  return assertSafeExistingPath(rootPath, targetPath, "directory");
}

async function hashBoundedFile(path: string, maximumBytes = evidenceFileLimit(path)): Promise<{ sha256: string; byteSize: number }> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximumBytes) throw new Error("Evidence file is unsafe or exceeds its size limit.");
  const hash = createHash("sha256");
  let byteSize = 0;
  for await (const chunk of createReadStream(path)) {
    byteSize += (chunk as Buffer).byteLength;
    if (byteSize > maximumBytes) throw new Error("Evidence file changed or exceeded its size limit while being read.");
    hash.update(chunk as Buffer);
  }
  const after = await lstat(path);
  if (!after.isFile() || after.isSymbolicLink() || byteSize !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw new Error("Evidence file changed while it was being retained.");
  }
  return { sha256: hash.digest("hex"), byteSize };
}

async function readBundleJson(path: string, maximumBytes = MAX_EVIDENCE_BUNDLE_MANIFEST_BYTES): Promise<Record<string, any>> {
  const snapshot = await hashBoundedFile(path, maximumBytes);
  if (snapshot.byteSize < 2) throw new Error("Evidence JSON is empty.");
  const value = JSON.parse(await readFile(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Evidence JSON must contain one object.");
  return value;
}

function assertBundleRelativePath(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length < 7 || value.length > 512 || value.includes("\\") || isAbsolute(value)) {
    throw new Error("Evidence-bundle entry path is invalid.");
  }
  const parts = value.split("/");
  if (parts[0] !== "files" || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Evidence-bundle entry path contains traversal or is outside files/.");
  }
}

function unsignedEvidenceManifest(manifest: Prompt3DWorkflowEvidenceBundleManifest): Omit<Prompt3DWorkflowEvidenceBundleManifest, "sealSha256"> {
  const { sealSha256: _sealSha256, ...unsigned } = manifest;
  return unsigned;
}

function assertEvidenceManifestShape(value: unknown, expected: EvidenceBundleExpected = {}): asserts value is Prompt3DWorkflowEvidenceBundleManifest {
  if (!value || typeof value !== "object") throw new Error("Evidence-bundle manifest is invalid.");
  const manifest = value as Prompt3DWorkflowEvidenceBundleManifest;
  if (manifest.version !== 1) throw new Error("Evidence-bundle manifest version is invalid.");
  requireUuid("Evidence-bundle ID", manifest.bundleId);
  requireUuid("Evidence-bundle asset ID", manifest.assetId);
  requireUuid("Evidence-bundle source job ID", manifest.sourceJobId);
  if (!Number.isFinite(Date.parse(manifest.createdAt))) throw new Error("Evidence-bundle creation time is invalid.");
  if (typeof manifest.lineageSourcePath !== "string" || !isAbsolute(manifest.lineageSourcePath)
    || resolve(manifest.lineageSourcePath) !== manifest.lineageSourcePath) throw new Error("Evidence-bundle lineage source path is invalid.");
  requireSha256("Evidence-bundle lineage hash", manifest.lineageSha256);
  requireSha256("Evidence-bundle seal", manifest.sealSha256);
  if (!Array.isArray(manifest.entries) || manifest.entries.length < 1 || manifest.entries.length > MAX_EVIDENCE_BUNDLE_FILES) {
    throw new Error("Evidence-bundle entry count is outside its safe limit.");
  }
  if (stableWorkflowSha256(unsignedEvidenceManifest(manifest)) !== manifest.sealSha256) throw new Error("Evidence-bundle manifest seal is invalid.");
  if ((expected.bundleId && manifest.bundleId !== expected.bundleId)
    || (expected.assetId && manifest.assetId !== expected.assetId)
    || (expected.sourceJobId && manifest.sourceJobId !== expected.sourceJobId)
    || (expected.lineageSha256 && manifest.lineageSha256 !== expected.lineageSha256)) {
    throw new Error("Evidence-bundle manifest does not match the requested workflow revision.");
  }
}

async function scanEvidenceDirectory(
  root: string,
  directory: string,
  add: (path: string, kind: Prompt3DWorkflowEvidenceKind) => void,
): Promise<void> {
  const start = await assertSafeExistingPath(root, directory, "directory");
  const pending = [start];
  let visited = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (++visited > MAX_EVIDENCE_BUNDLE_FILES) throw new Error("Evidence-bundle directory count exceeds its safe limit.");
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = containedWorkflowPath(root, join(current, entry.name));
      if (entry.isSymbolicLink()) throw new Error("Evidence source tree contains a symbolic link.");
      if (entry.isDirectory()) pending.push(await assertSafeExistingPath(root, path, "directory"));
      else if (entry.isFile()) add(await assertSafeExistingPath(root, path, "file"), evidenceKind(path));
      else throw new Error("Evidence source tree contains an unsupported filesystem entry.");
    }
  }
}

async function collectGeometryRejectionEvidence(
  root: string,
  lineage: Prompt3DWorkflowLineage,
  add: (path: string, kind: Prompt3DWorkflowEvidenceKind, expectedSha256?: string) => void,
): Promise<void> {
  const jobsRoot = containedWorkflowPath(root, join(root, "jobs"));
  if (!existsSync(jobsRoot)) return;
  const safeJobsRoot = await assertSafeExistingPath(root, jobsRoot, "directory");
  const candidates = await readdir(safeJobsRoot, { withFileTypes: true });
  if (candidates.length > MAX_EVIDENCE_BUNDLE_FILES) throw new Error("Generation history exceeds the evidence discovery limit.");
  const successors = new Set(lineage.generationChain.map((generation) => generation.jobId));
  const bySuccessor = new Map<string, Array<{
    candidateName: string;
    candidateDirectory: string;
    rejectionPath: string;
    rejection: Record<string, any>;
  }>>();
  for (const candidate of candidates) {
    if (!UUID.test(candidate.name)) continue;
    if (candidate.isSymbolicLink()) throw new Error("Generation history contains a symbolic-link job entry.");
    if (!candidate.isDirectory()) continue;
    const candidateDirectory = containedWorkflowPath(root, join(safeJobsRoot, candidate.name));
    const rejectionPath = containedWorkflowPath(root, join(candidateDirectory, "variant-1", "visual-rejection.json"));
    try {
      const rejectionInfo = await lstat(rejectionPath);
      if (rejectionInfo.isSymbolicLink()) throw new Error("Geometry-rejection evidence is a symbolic link.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    let rejection: Record<string, any>;
    try {
      rejection = await readBundleJson(await assertSafeExistingPath(root, rejectionPath, "file"), MAX_EVIDENCE_BYTES);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(`Geometry-rejection evidence is unsafe or unreadable: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof rejection.successorJobId !== "string") continue;
    const matches = bySuccessor.get(rejection.successorJobId) ?? [];
    matches.push({ candidateName: candidate.name, candidateDirectory, rejectionPath, rejection });
    bySuccessor.set(rejection.successorJobId, matches);
  }

  const reachableJobIds = new Set(successors);
  const visitedSuccessors = new Set<string>();
  const pending = [...successors].map((successorJobId) => ({ successorJobId, depth: 0 }));
  while (pending.length) {
    const current = pending.pop()!;
    if (visitedSuccessors.has(current.successorJobId)) continue;
    visitedSuccessors.add(current.successorJobId);
    const matches = bySuccessor.get(current.successorJobId) ?? [];
    if (matches.length > 1) throw new Error("Retained geometry-rejection evidence is incomplete or ambiguous.");
    const match = matches[0];
    if (!match) continue;
    const { candidateName, candidateDirectory, rejectionPath, rejection } = match;
    if (current.depth >= MAX_GEOMETRY_REJECTION_CHAIN) throw new Error("Geometry-rejection ancestry exceeds the retained audit limit.");
    if (rejection.version !== 1
      || rejection.source !== "explicit-user-action"
      || rejection.jobId !== candidateName
      || !UUID.test(rejection.jobId)
      || rejection.successorJobId !== current.successorJobId
      || typeof rejection.assetPath !== "string"
      || typeof rejection.assetSha256 !== "string" || !SHA256.test(rejection.assetSha256)
      || !Array.isArray(rejection.retainedAncestry) || rejection.retainedAncestry.length < 1 || rejection.retainedAncestry.length > 128) {
      throw new Error("Retained geometry-rejection evidence is incomplete or ambiguous.");
    }
    if (reachableJobIds.has(rejection.jobId)) throw new Error("Geometry-rejection ancestry contains a cycle or crosses an accepted generation.");
    reachableJobIds.add(rejection.jobId);
    add(rejectionPath, "geometry-rejection");
    add(rejection.assetPath, "generation-output", rejection.assetSha256);
    await scanEvidenceDirectory(root, candidateDirectory, add);
    for (const ancestor of rejection.retainedAncestry) {
      if (!ancestor || typeof ancestor.jobId !== "string" || !UUID.test(ancestor.jobId)) throw new Error("Geometry-rejection ancestry contains an invalid job ID.");
      await scanEvidenceDirectory(root, containedWorkflowPath(root, join(root, "jobs", ancestor.jobId)), add);
    }
    pending.push({ successorJobId: rejection.jobId, depth: current.depth + 1 });
  }
}

async function collectWorkflowEvidence(
  root: string,
  job: Prompt3DFinishJobStatus,
  lineage: Prompt3DWorkflowLineage,
): Promise<{ sources: EvidenceSource[]; expectedHashes: Map<string, string> }> {
  const sources = new Map<string, EvidenceSource>();
  const expectedHashes = new Map<string, string>();
  const add = (path: string, kind: Prompt3DWorkflowEvidenceKind, expectedSha256?: string) => {
    const sourcePath = containedWorkflowPath(root, path);
    const key = pathIdentity(sourcePath);
    const existing = sources.get(key);
    sources.set(key, { sourcePath, kind: existing && existing.kind !== "other" ? existing.kind : kind });
    if (expectedSha256) {
      const current = expectedHashes.get(key);
      if (current && current !== expectedSha256) throw new Error("Evidence source path is bound to conflicting hashes.");
      expectedHashes.set(key, expectedSha256);
    }
  };

  add(job.lineagePath!, "lineage", job.lineageSha256!);
  for (const generation of lineage.generationChain) {
    add(generation.outputPath, "generation-output", generation.outputSha256);
    add(generation.provenancePath, "provenance", generation.provenanceSha256);
    add(generation.visualApprovalPath, "visual-approval", generation.visualApprovalSha256);
    const jobDirectory = containedWorkflowPath(root, join(root, "jobs", generation.jobId));
    await scanEvidenceDirectory(root, jobDirectory, add);
    const variantDirectory = containedWorkflowPath(root, join(jobDirectory, `variant-${generation.variantIndex + 1}`));
    const conceptPath = containedWorkflowPath(root, join(variantDirectory, "concept.png"));
    const reviewPath = containedWorkflowPath(root, join(variantDirectory, "concept-review.json"));
    const attemptPath = containedWorkflowPath(root, join(variantDirectory, "concept-attempt.json"));
    const approvalPath = containedWorkflowPath(root, join(variantDirectory, "concept-approval.json"));
    const specPath = containedWorkflowPath(root, join(variantDirectory, "asset-spec.json"));
    add(conceptPath, "concept-image", generation.conceptSha256);
    add(reviewPath, "concept-review");
    add(attemptPath, "concept-attempt");
    add(approvalPath, "concept-approval");
    add(specPath, "spec");
    const [attempt, explicitApproval, recordedSpec, provenance] = await Promise.all([
      readBundleJson(await assertSafeExistingPath(root, attemptPath, "file"), MAX_EVIDENCE_BYTES),
      readBundleJson(await assertSafeExistingPath(root, approvalPath, "file"), MAX_EVIDENCE_BYTES),
      readBundleJson(await assertSafeExistingPath(root, specPath, "file"), MAX_EVIDENCE_BYTES),
      readEvidenceJson(root, generation.provenancePath, generation.provenanceSha256, "Hunyuan generation provenance"),
      readBundleJson(await assertSafeExistingPath(root, reviewPath, "file"), MAX_EVIDENCE_BYTES),
    ]);
    const conceptSnapshot = await hashBoundedFile(await assertSafeExistingPath(root, conceptPath, "file"), 32 * 1024 ** 2);
    if (conceptSnapshot.sha256 !== generation.conceptSha256
      || attempt.binding?.jobId !== generation.jobId
      || attempt.binding?.attemptId !== provenance.conceptApproval?.attemptId
      || attempt.binding?.conceptSha256 !== generation.conceptSha256
      || attempt.conceptImagePath !== conceptPath
      || stableWorkflowSha256(explicitApproval) !== generation.conceptApprovalSha256
      || stableJson(explicitApproval) !== stableJson(provenance.conceptApproval)
      || stableWorkflowSha256(recordedSpec.conceptApproval) !== generation.conceptApprovalSha256
      || stableJson(recordedSpec.conceptApproval) !== stableJson(provenance.conceptApproval)) {
      throw new Error("Required concept image, attempt or explicit approval evidence is missing or inconsistent.");
    }
    if (attempt.referenceImage) {
      if (stableJson(attempt.referenceImage) !== stableJson(provenance.referenceImage)
        || stableJson(recordedSpec.referenceImageEvidence) !== stableJson(attempt.referenceImage)
        || attempt.binding?.referenceSha256 !== attempt.referenceImage.sha256
        || generation.referenceSha256 !== attempt.referenceImage.sha256) {
        throw new Error("Required reference-image evidence is missing or inconsistent.");
      }
      add(attempt.referenceImage.path, "reference-image", attempt.referenceImage.sha256);
      if (attempt.referenceImages) {
        const bindings = attempt.referenceImages.map((image: Prompt3DRetainedReferenceImage) => ({ view: image.view ?? "front", sha256: image.sha256 }));
        if (stableJson(attempt.referenceImages) !== stableJson(provenance.referenceImages)
          || stableJson(recordedSpec.referenceImagesEvidence) !== stableJson(attempt.referenceImages)
          || stableJson(attempt.binding?.referenceImageBindings) !== stableJson(bindings)
          || stableJson(generation.referenceSha256s) !== stableJson(attempt.referenceImages.map((image: Prompt3DRetainedReferenceImage) => image.sha256))
          || stableJson(generation.referenceViews) !== stableJson(attempt.referenceImages.map((image: Prompt3DRetainedReferenceImage) => image.view))) {
          throw new Error("Required multiview reference-image evidence is missing or inconsistent.");
        }
        for (const reference of attempt.referenceImages) add(reference.path, "reference-image", reference.sha256);
      }
    } else if (provenance.referenceImage !== undefined
      || provenance.referenceImages !== undefined
      || recordedSpec.referenceImageEvidence !== undefined
      || recordedSpec.referenceImagesEvidence !== undefined
      || attempt.binding?.referenceSha256 !== null
      || generation.referenceSha256 !== undefined
      || generation.referenceSha256s !== undefined
      || generation.referenceViews !== undefined) {
      throw new Error("Prompt-only generation contains unexpected reference-image evidence.");
    }
    if (attempt.providerConceptSource) {
      add(attempt.providerConceptSource.path, "concept-source", attempt.providerConceptSource.sha256);
    }
    if (typeof attempt.technicalReview?.reportPath === "string") add(attempt.technicalReview.reportPath, "concept-review", attempt.technicalReview.reportSha256);
    if (typeof provenance.conceptInspection?.path === "string") add(provenance.conceptInspection.path, "concept-inspection");
    if (!Array.isArray(provenance.conceptAttempts) || provenance.conceptAttempts.length < 1 || provenance.conceptAttempts.length > 128) {
      throw new Error("Hunyuan generation provenance is missing its bounded retained concept-attempt chain.");
    }
    for (const retainedAttempt of provenance.conceptAttempts) {
      const attemptJobId = retainedAttempt?.binding?.jobId;
      if (typeof attemptJobId !== "string" || !UUID.test(attemptJobId)
        || typeof retainedAttempt.conceptImagePath !== "string"
        || typeof retainedAttempt.technicalReview?.reportPath !== "string") {
        throw new Error("Retained concept-attempt evidence is incomplete.");
      }
      const attemptDirectory = containedWorkflowPath(root, join(root, "jobs", attemptJobId));
      await scanEvidenceDirectory(root, attemptDirectory, add);
      add(retainedAttempt.conceptImagePath, "concept-image", retainedAttempt.binding.conceptSha256);
      add(retainedAttempt.technicalReview.reportPath, "concept-review", retainedAttempt.technicalReview.reportSha256);
      if (retainedAttempt.providerConceptSource) {
        add(retainedAttempt.providerConceptSource.path, "concept-source", retainedAttempt.providerConceptSource.sha256);
      }
      if (retainedAttempt.referenceImage) {
        if (retainedAttempt.binding.referenceSha256 !== retainedAttempt.referenceImage.sha256) {
          throw new Error("Retained concept-attempt reference image does not match its binding.");
        }
        add(retainedAttempt.referenceImage.path, "reference-image", retainedAttempt.referenceImage.sha256);
        if (retainedAttempt.referenceImages) {
          const bindings = retainedAttempt.referenceImages.map((image: Prompt3DRetainedReferenceImage) => ({ view: image.view ?? "front", sha256: image.sha256 }));
          if (stableJson(retainedAttempt.binding.referenceImageBindings) !== stableJson(bindings)) {
            throw new Error("Retained concept-attempt multiview images do not match their binding.");
          }
          for (const reference of retainedAttempt.referenceImages) add(reference.path, "reference-image", reference.sha256);
        }
      } else if (retainedAttempt.binding.referenceSha256 !== null) {
        throw new Error("Retained concept attempt is missing its bound reference image.");
      }
      const retainedInspection = Array.isArray(provenance.conceptInspections)
        ? provenance.conceptInspections.find((record: any) => record?.evidence?.attemptId === retainedAttempt.binding.attemptId)
        : undefined;
      if (typeof retainedInspection?.path === "string") add(retainedInspection.path, "concept-inspection");
      const retainedAttemptDirectory = dirname(containedWorkflowPath(root, retainedAttempt.conceptImagePath));
      add(join(retainedAttemptDirectory, "concept-attempt.json"), "concept-attempt");
      add(join(retainedAttemptDirectory, "asset-spec.json"), "spec");
    }
  }

  await collectGeometryRejectionEvidence(root, lineage, add);

  for (const revision of lineage.revisions) {
    add(revision.outputPath, "finish-output", revision.outputSha256);
    add(revision.provenancePath, "provenance", revision.provenanceSha256);
    add(revision.visualApprovalPath, "visual-approval", revision.visualApprovalSha256);
    await scanEvidenceDirectory(root, workflowDirectory(root, revision.jobId), add);
    if (revision.operation === "texture") {
      const provenance = await readEvidenceJson(root, revision.provenancePath, revision.provenanceSha256, "Hunyuan texture provenance");
      if (typeof provenance.textureReference?.path !== "string") throw new Error("Required Hunyuan texture-reference evidence is missing.");
      add(provenance.textureReference.path, "texture-reference", revision.textureReferenceSha256);
    } else if (revision.provider === "hy-motion-1.0-lite") {
      const provenance = await readEvidenceJson(root, revision.provenancePath, revision.provenanceSha256, "HY-Motion provenance");
      if (typeof provenance.motionData?.path !== "string") throw new Error("Required HY-Motion skeletal-data evidence is missing.");
      add(provenance.motionData.path, "other", revision.motionDataSha256);
    } else if (revision.rigPreparation) {
      add(revision.rigPreparation.outputPath, "other", revision.rigPreparation.outputSha256);
    }
  }
  if (sources.size > MAX_EVIDENCE_BUNDLE_FILES) throw new Error("Evidence-bundle file count exceeds its safe limit.");
  return { sources: [...sources.values()].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath)), expectedHashes };
}

async function verifyBundleFileInventory(
  root: string,
  bundleDirectory: string,
  manifestPath: string,
  expectedFiles: Set<string>,
): Promise<void> {
  const discovered = new Set<string>();
  const pending = [await assertSafeExistingPath(root, bundleDirectory, "directory")];
  let visited = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (++visited > MAX_EVIDENCE_BUNDLE_FILES) throw new Error("Evidence-bundle directory count exceeds its safe limit.");
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = containedWorkflowPath(root, join(current, entry.name));
      if (entry.isSymbolicLink()) throw new Error("Evidence bundle contains a symbolic link.");
      if (entry.isDirectory()) pending.push(await assertSafeExistingPath(root, path, "directory"));
      else if (entry.isFile()) discovered.add(pathIdentity(await assertSafeExistingPath(root, path, "file")));
      else throw new Error("Evidence bundle contains an unsupported filesystem entry.");
      if (discovered.size > MAX_EVIDENCE_BUNDLE_FILES + 1) throw new Error("Evidence-bundle file count exceeds its safe limit.");
    }
  }
  const required = new Set([...expectedFiles, pathIdentity(manifestPath)]);
  if (discovered.size !== required.size || [...required].some((path) => !discovered.has(path))) {
    throw new Error("Evidence bundle contains an incomplete or unsealed file mapping.");
  }
}

export async function verifyPrompt3DWorkflowEvidenceBundle(
  root: string,
  manifestPath: string,
  expectedManifestSha256: string,
  expected: EvidenceBundleExpected = {},
): Promise<Prompt3DWorkflowEvidenceBundleHandle> {
  requireSha256("Evidence-bundle manifest hash", expectedManifestSha256);
  const retainedManifestPath = await assertSafeExistingPath(root, manifestPath, "file");
  const manifestSnapshot = await hashBoundedFile(retainedManifestPath, MAX_EVIDENCE_BUNDLE_MANIFEST_BYTES);
  if (manifestSnapshot.sha256 !== expectedManifestSha256) throw new Error("Evidence-bundle manifest failed hash verification.");
  const manifest = await readBundleJson(retainedManifestPath, MAX_EVIDENCE_BUNDLE_MANIFEST_BYTES) as Prompt3DWorkflowEvidenceBundleManifest;
  assertEvidenceManifestShape(manifest, expected);
  const bundleDirectory = evidenceBundleDirectory(root, manifest.bundleId);
  if (pathIdentity(dirname(retainedManifestPath)) !== pathIdentity(bundleDirectory)
    || pathIdentity(retainedManifestPath) !== pathIdentity(join(bundleDirectory, "manifest.json"))) {
    throw new Error("Evidence-bundle manifest is not in its canonical saved-assets location.");
  }

  const sourceMap = new Map<string, string>();
  const bundleFiles = new Set<string>();
  let totalBytes = 0;
  for (const entry of manifest.entries) {
    if (!entry || typeof entry.sourcePath !== "string" || !isAbsolute(entry.sourcePath)
      || resolve(entry.sourcePath) !== entry.sourcePath) throw new Error("Evidence-bundle source path is invalid or contains traversal.");
    const sourcePath = containedWorkflowPath(root, entry.sourcePath);
    assertBundleRelativePath(entry.bundlePath);
    if (typeof entry.kind !== "string" || !(["lineage", "generation-output", "finish-output", "provenance", "concept-image", "concept-source", "concept-review", "concept-attempt", "concept-inspection", "concept-approval", "reference-image", "geometry-rejection", "visual-approval", "texture-reference", "spec", "plan", "validation", "job-record", "event", "log", "other"] as string[]).includes(entry.kind)) {
      throw new Error("Evidence-bundle entry kind is invalid.");
    }
    if (!Number.isSafeInteger(entry.byteSize) || entry.byteSize < 0 || entry.byteSize > evidenceFileLimit(entry.bundlePath)) throw new Error("Evidence-bundle entry size is invalid.");
    requireSha256("Evidence-bundle entry hash", entry.sha256);
    const sourceKey = pathIdentity(sourcePath);
    const bundlePath = containedWorkflowPath(bundleDirectory, join(bundleDirectory, ...entry.bundlePath.split("/")));
    const bundleKey = pathIdentity(bundlePath);
    if (sourceMap.has(sourceKey) || bundleFiles.has(bundleKey)) throw new Error("Evidence-bundle mapping contains duplicate source or destination paths.");
    const safeBundlePath = await assertSafeExistingPath(root, bundlePath, "file");
    const snapshot = await hashBoundedFile(safeBundlePath, evidenceFileLimit(entry.bundlePath));
    if (snapshot.byteSize !== entry.byteSize || snapshot.sha256 !== entry.sha256) throw new Error("Evidence-bundle file failed byte-size or hash verification.");
    totalBytes += snapshot.byteSize;
    if (totalBytes > MAX_EVIDENCE_BUNDLE_BYTES) throw new Error("Evidence-bundle total size exceeds its safe limit.");
    sourceMap.set(sourceKey, safeBundlePath);
    bundleFiles.add(bundleKey);
  }
  await verifyBundleFileInventory(root, bundleDirectory, retainedManifestPath, bundleFiles);
  const resolveSourcePath: Prompt3DWorkflowEvidencePathResolver = (sourcePath) => {
    const logical = containedWorkflowPath(root, sourcePath);
    const retained = sourceMap.get(pathIdentity(logical));
    if (!retained) throw new Error("Evidence bundle has no sealed mapping for a required lineage path.");
    return retained;
  };
  const lineagePath = resolveSourcePath(manifest.lineageSourcePath);
  const lineageEntry = manifest.entries.find((entry) => pathIdentity(entry.sourcePath) === pathIdentity(manifest.lineageSourcePath));
  if (!lineageEntry || lineageEntry.kind !== "lineage" || lineageEntry.sha256 !== manifest.lineageSha256) {
    throw new Error("Evidence bundle has no complete lineage-file mapping.");
  }
  const lineageBytes = await readFile(lineagePath);
  if (sha256Bytes(lineageBytes) !== manifest.lineageSha256) throw new Error("Evidence-bundle lineage failed hash verification.");
  const lineage = JSON.parse(lineageBytes.toString("utf8")) as Prompt3DWorkflowLineage;
  assertPrompt3DWorkflowLineageSeal(lineage);
  if (lineage.assetId !== manifest.assetId || lineage.finalJobId !== manifest.sourceJobId) throw new Error("Evidence-bundle lineage identity does not match its manifest.");
  for (const generation of lineage.generationChain) {
    const variantDirectory = containedWorkflowPath(root, join(root, "jobs", generation.jobId, `variant-${generation.variantIndex + 1}`));
    for (const [name, kind] of [["concept.png", "concept-image"], ["concept-review.json", "concept-review"], ["concept-attempt.json", "concept-attempt"], ["concept-approval.json", "concept-approval"], ["asset-spec.json", "spec"]] as const) {
      const sourcePath = containedWorkflowPath(root, join(variantDirectory, name));
      const entry = manifest.entries.find((candidate) => pathIdentity(candidate.sourcePath) === pathIdentity(sourcePath));
      if (!entry || entry.kind !== kind) throw new Error("Evidence bundle is missing required concept review or approval files.");
      if (kind === "concept-image" && entry.sha256 !== generation.conceptSha256) throw new Error("Evidence-bundle concept image does not match its approved hash.");
    }
    for (const requiredPath of [generation.outputPath, generation.provenancePath, generation.visualApprovalPath]) resolveSourcePath(requiredPath);
    const [attempt, explicitApproval, recordedSpec, provenance] = await Promise.all([
      readBundleJson(resolveSourcePath(join(variantDirectory, "concept-attempt.json")), MAX_EVIDENCE_BYTES),
      readBundleJson(resolveSourcePath(join(variantDirectory, "concept-approval.json")), MAX_EVIDENCE_BYTES),
      readBundleJson(resolveSourcePath(join(variantDirectory, "asset-spec.json")), MAX_EVIDENCE_BYTES),
      readEvidenceJson(root, generation.provenancePath, generation.provenanceSha256, "Bundled Hunyuan generation provenance", resolveSourcePath),
    ]);
    if (attempt.providerConceptSource) {
      const sourceEntry = manifest.entries.find((candidate) => pathIdentity(candidate.sourcePath) === pathIdentity(attempt.providerConceptSource.path));
      if (!sourceEntry || sourceEntry.kind !== "concept-source" || sourceEntry.sha256 !== attempt.providerConceptSource.sha256) {
        throw new Error("Evidence bundle is missing the untouched provider concept source.");
      }
    }
    if (stableWorkflowSha256(explicitApproval) !== generation.conceptApprovalSha256
      || stableJson(explicitApproval) !== stableJson(provenance.conceptApproval)
      || stableJson(recordedSpec.conceptApproval) !== stableJson(provenance.conceptApproval)
      || attempt.binding?.jobId !== generation.jobId
      || attempt.binding?.attemptId !== provenance.conceptApproval?.attemptId
      || attempt.binding?.conceptSha256 !== generation.conceptSha256) {
      throw new Error("Evidence bundle contains inconsistent concept attempt or explicit approval evidence.");
    }
    if (attempt.referenceImage) {
      const referenceEntry = manifest.entries.find((entry) => pathIdentity(entry.sourcePath) === pathIdentity(attempt.referenceImage.path));
      if (!referenceEntry || referenceEntry.kind !== "reference-image"
        || referenceEntry.sha256 !== attempt.referenceImage.sha256
        || stableJson(attempt.referenceImage) !== stableJson(provenance.referenceImage)
        || stableJson(attempt.referenceImage) !== stableJson(recordedSpec.referenceImageEvidence)
        || generation.referenceSha256 !== attempt.referenceImage.sha256) {
        throw new Error("Evidence bundle is missing the exact local reference-image conditioning bytes.");
      }
      resolveSourcePath(attempt.referenceImage.path);
      if (attempt.referenceImages) {
        if (stableJson(attempt.referenceImages) !== stableJson(provenance.referenceImages)
          || stableJson(attempt.referenceImages) !== stableJson(recordedSpec.referenceImagesEvidence)
          || stableJson(generation.referenceSha256s) !== stableJson(attempt.referenceImages.map((image: Prompt3DRetainedReferenceImage) => image.sha256))
          || stableJson(generation.referenceViews) !== stableJson(attempt.referenceImages.map((image: Prompt3DRetainedReferenceImage) => image.view))) {
          throw new Error("Evidence bundle is missing the exact Hunyuan multiview conditioning set.");
        }
        for (const reference of attempt.referenceImages) {
          const entry = manifest.entries.find((candidate) => pathIdentity(candidate.sourcePath) === pathIdentity(reference.path));
          if (!entry || entry.kind !== "reference-image" || entry.sha256 !== reference.sha256) {
            throw new Error("Evidence bundle is missing a Hunyuan multiview source image.");
          }
          resolveSourcePath(reference.path);
        }
      }
    } else if (provenance.referenceImage !== undefined
      || provenance.referenceImages !== undefined
      || recordedSpec.referenceImageEvidence !== undefined
      || recordedSpec.referenceImagesEvidence !== undefined
      || generation.referenceSha256 !== undefined
      || generation.referenceSha256s !== undefined
      || generation.referenceViews !== undefined) {
      throw new Error("Evidence bundle contains forged reference-image evidence for a prompt-only generation.");
    }
    if (!Array.isArray(provenance.conceptAttempts) || provenance.conceptAttempts.length < 1 || provenance.conceptAttempts.length > 128) {
      throw new Error("Evidence bundle is missing its bounded concept-attempt chain.");
    }
    for (const retainedAttempt of provenance.conceptAttempts) {
      if (typeof retainedAttempt?.binding?.jobId !== "string" || !UUID.test(retainedAttempt.binding.jobId)
        || typeof retainedAttempt.conceptImagePath !== "string"
        || typeof retainedAttempt.technicalReview?.reportPath !== "string") {
        throw new Error("Evidence bundle contains incomplete concept-attempt lineage.");
      }
      const conceptEntry = manifest.entries.find((entry) => pathIdentity(entry.sourcePath) === pathIdentity(retainedAttempt.conceptImagePath));
      if (!conceptEntry || conceptEntry.kind !== "concept-image" || conceptEntry.sha256 !== retainedAttempt.binding.conceptSha256) {
        throw new Error("Evidence bundle is missing an intermediate concept image or its approved hash.");
      }
      resolveSourcePath(retainedAttempt.technicalReview.reportPath);
      if (retainedAttempt.referenceImage) {
        const referenceEntry = manifest.entries.find((entry) => pathIdentity(entry.sourcePath) === pathIdentity(retainedAttempt.referenceImage.path));
        if (!referenceEntry || referenceEntry.kind !== "reference-image"
          || referenceEntry.sha256 !== retainedAttempt.referenceImage.sha256
          || retainedAttempt.binding.referenceSha256 !== retainedAttempt.referenceImage.sha256) {
          throw new Error("Evidence bundle is missing an intermediate reference-image binding.");
        }
        resolveSourcePath(retainedAttempt.referenceImage.path);
        if (retainedAttempt.referenceImages) {
          for (const reference of retainedAttempt.referenceImages) {
            const entry = manifest.entries.find((candidate) => pathIdentity(candidate.sourcePath) === pathIdentity(reference.path));
            if (!entry || entry.kind !== "reference-image" || entry.sha256 !== reference.sha256) {
              throw new Error("Evidence bundle is missing an intermediate Hunyuan multiview source.");
            }
            resolveSourcePath(reference.path);
          }
        }
      } else if (retainedAttempt.binding.referenceSha256 !== null) {
        throw new Error("Evidence bundle contains a reference hash without retained source bytes.");
      }
      const retainedAttemptDirectory = dirname(containedWorkflowPath(root, retainedAttempt.conceptImagePath));
      resolveSourcePath(join(retainedAttemptDirectory, "concept-attempt.json"));
      resolveSourcePath(join(retainedAttemptDirectory, "asset-spec.json"));
    }
  }
  const generationIds = new Set(lineage.generationChain.map((generation) => generation.jobId));
  const rejectionRecords: Array<{
    entry: Prompt3DWorkflowEvidenceBundleEntry;
    rejection: Record<string, any>;
  }> = [];
  for (const rejectionEntry of manifest.entries.filter((entry) => entry.kind === "geometry-rejection")) {
    const rejection = await readBundleJson(resolveSourcePath(rejectionEntry.sourcePath), MAX_EVIDENCE_BYTES);
    if (rejection.version !== 1 || rejection.source !== "explicit-user-action"
      || typeof rejection.jobId !== "string" || !UUID.test(rejection.jobId)
      || typeof rejection.successorJobId !== "string" || !UUID.test(rejection.successorJobId)
      || typeof rejection.assetPath !== "string"
      || typeof rejection.assetSha256 !== "string" || !SHA256.test(rejection.assetSha256)
      || !Array.isArray(rejection.retainedAncestry) || rejection.retainedAncestry.length < 1 || rejection.retainedAncestry.length > 128) {
      throw new Error("Evidence bundle contains invalid geometry-rejection evidence.");
    }
    const expectedRejectionPath = containedWorkflowPath(root, join(root, "jobs", rejection.jobId, "variant-1", "visual-rejection.json"));
    if (pathIdentity(rejectionEntry.sourcePath) !== pathIdentity(expectedRejectionPath)) {
      throw new Error("Evidence bundle contains a geometry-rejection record outside its retained job tree.");
    }
    const rejectedOutput = manifest.entries.find((entry) => pathIdentity(entry.sourcePath) === pathIdentity(rejection.assetPath));
    if (!rejectedOutput || rejectedOutput.kind !== "generation-output" || rejectedOutput.sha256 !== rejection.assetSha256) {
      throw new Error("Evidence bundle is missing the visually rejected geometry bytes.");
    }
    resolveSourcePath(rejection.assetPath);
    for (const ancestor of rejection.retainedAncestry) {
      if (!ancestor || typeof ancestor.jobId !== "string" || !UUID.test(ancestor.jobId)) throw new Error("Bundled geometry-rejection ancestry is invalid.");
      const ancestorDirectory = containedWorkflowPath(root, join(root, "jobs", ancestor.jobId));
      const hasAncestryFile = manifest.entries.some((entry) => {
        const rel = relative(ancestorDirectory, containedWorkflowPath(root, entry.sourcePath));
        return rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
      });
      if (!hasAncestryFile) throw new Error("Evidence bundle is missing a retained geometry-rejection ancestor.");
    }
    rejectionRecords.push({ entry: rejectionEntry, rejection });
  }
  const rejectionsBySuccessor = new Map<string, typeof rejectionRecords>();
  for (const record of rejectionRecords) {
    const matches = rejectionsBySuccessor.get(record.rejection.successorJobId) ?? [];
    matches.push(record);
    rejectionsBySuccessor.set(record.rejection.successorJobId, matches);
  }
  const reachableRejectionJobs = new Set(generationIds);
  const visitedRejectionEntries = new Set<string>();
  const pendingRejectionSuccessors = [...generationIds].map((successorJobId) => ({ successorJobId, depth: 0 }));
  while (pendingRejectionSuccessors.length) {
    const current = pendingRejectionSuccessors.pop()!;
    const matches = rejectionsBySuccessor.get(current.successorJobId) ?? [];
    if (matches.length > 1) throw new Error("Evidence bundle contains ambiguous geometry-rejection successors.");
    const match = matches[0];
    if (!match) continue;
    if (current.depth >= MAX_GEOMETRY_REJECTION_CHAIN) throw new Error("Bundled geometry-rejection ancestry exceeds its retained audit limit.");
    if (reachableRejectionJobs.has(match.rejection.jobId)) throw new Error("Bundled geometry-rejection ancestry contains a cycle or crosses an accepted generation.");
    reachableRejectionJobs.add(match.rejection.jobId);
    visitedRejectionEntries.add(pathIdentity(match.entry.sourcePath));
    pendingRejectionSuccessors.push({ successorJobId: match.rejection.jobId, depth: current.depth + 1 });
  }
  if (visitedRejectionEntries.size !== rejectionRecords.length) {
    throw new Error("Evidence bundle contains disconnected geometry-rejection evidence.");
  }
  for (const revision of lineage.revisions) {
    for (const requiredPath of [revision.outputPath, revision.provenancePath, revision.visualApprovalPath]) resolveSourcePath(requiredPath);
  }
  return { manifest, manifestPath: retainedManifestPath, manifestSha256: expectedManifestSha256, lineage, lineagePath, resolveSourcePath };
}

export async function retainPrompt3DWorkflowEvidenceBundle(
  root: string,
  job: Prompt3DFinishJobStatus,
): Promise<Prompt3DWorkflowEvidenceBundleHandle> {
  if (!job.lineage || !job.lineagePath || !job.lineageSha256) throw new Error("A retained workflow lineage is required before evidence can be bundled.");
  const bundlesRoot = await ensureSafeDirectory(root, evidenceBundlesRoot(root));
  const bundleDirectory = evidenceBundleDirectory(root, job.id);
  const manifestPath = containedWorkflowPath(root, join(bundleDirectory, "manifest.json"));
  if (existsSync(manifestPath)) {
    const manifestBytes = await readFile(await assertSafeExistingPath(root, manifestPath, "file"));
    const handle = await verifyPrompt3DWorkflowEvidenceBundle(root, manifestPath, sha256Bytes(manifestBytes), {
      bundleId: job.id, assetId: job.assetId, sourceJobId: job.id, lineageSha256: job.lineageSha256,
    });
    if (stableJson(handle.lineage) !== stableJson(job.lineage)) throw new Error("Existing evidence bundle conflicts with this immutable workflow lineage.");
    await validatePrompt3DWorkflowLineage(root, handle.lineage, job, handle.resolveSourcePath);
    return handle;
  }
  if (existsSync(bundleDirectory)) throw new Error("Existing evidence-bundle directory is incomplete and cannot be replaced.");

  const retainedLineage = await readEvidenceJson(root, job.lineagePath, job.lineageSha256, "Final workflow lineage") as unknown as Prompt3DWorkflowLineage;
  if (stableJson(retainedLineage) !== stableJson(job.lineage)) throw new Error("Final workflow lineage file differs from the retained job.");
  await validatePrompt3DWorkflowLineage(root, retainedLineage, job);
  const collected = await collectWorkflowEvidence(root, job, retainedLineage);
  const temporaryDirectory = containedWorkflowPath(root, join(bundlesRoot, `.tmp-${job.id}-${randomUUID()}`));
  await ensureSafeDirectory(root, join(temporaryDirectory, "files"));
  try {
    const entries: Prompt3DWorkflowEvidenceBundleEntry[] = [];
    let totalBytes = 0;
    for (const [index, source] of collected.sources.entries()) {
      const sourcePath = await assertSafeExistingPath(root, source.sourcePath, "file");
      const sourceSnapshot = await hashBoundedFile(sourcePath);
      const expectedHash = collected.expectedHashes.get(pathIdentity(sourcePath));
      if (expectedHash && expectedHash !== sourceSnapshot.sha256) throw new Error("Required evidence source no longer matches its retained hash.");
      totalBytes += sourceSnapshot.byteSize;
      if (totalBytes > MAX_EVIDENCE_BUNDLE_BYTES) throw new Error("Evidence-bundle total size exceeds its safe limit.");
      const cleanName = basename(sourcePath).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || "evidence.bin";
      const bundlePath = `files/${String(index).padStart(4, "0")}-${cleanName}`;
      const destination = containedWorkflowPath(root, join(temporaryDirectory, ...bundlePath.split("/")));
      await copyFile(sourcePath, destination, constants.COPYFILE_EXCL);
      const copied = await hashBoundedFile(destination);
      if (copied.byteSize !== sourceSnapshot.byteSize || copied.sha256 !== sourceSnapshot.sha256) throw new Error("Evidence-bundle copy failed hash verification.");
      entries.push({ sourcePath, bundlePath, kind: source.kind, byteSize: copied.byteSize, sha256: copied.sha256 });
    }
    const unsigned: Omit<Prompt3DWorkflowEvidenceBundleManifest, "sealSha256"> = {
      version: 1,
      bundleId: job.id,
      assetId: job.assetId,
      sourceJobId: job.id,
      createdAt: new Date().toISOString(),
      lineageSourcePath: containedWorkflowPath(root, job.lineagePath),
      lineageSha256: job.lineageSha256,
      entries,
    };
    const manifest: Prompt3DWorkflowEvidenceBundleManifest = { ...unsigned, sealSha256: stableWorkflowSha256(unsigned) };
    const temporaryManifestPath = containedWorkflowPath(root, join(temporaryDirectory, "manifest.json"));
    await writeFile(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    const manifestSnapshot = await hashBoundedFile(temporaryManifestPath, MAX_EVIDENCE_BUNDLE_MANIFEST_BYTES);
    try {
      await rename(temporaryDirectory, bundleDirectory);
    } catch (error) {
      if (!existsSync(manifestPath)) throw error;
      const existingBytes = await readFile(await assertSafeExistingPath(root, manifestPath, "file"));
      const existing = await verifyPrompt3DWorkflowEvidenceBundle(root, manifestPath, sha256Bytes(existingBytes), {
        bundleId: job.id, assetId: job.assetId, sourceJobId: job.id, lineageSha256: job.lineageSha256,
      });
      if (stableJson(existing.lineage) !== stableJson(job.lineage)) throw new Error("Concurrent evidence bundle conflicts with this immutable workflow lineage.");
      return existing;
    }
    return verifyPrompt3DWorkflowEvidenceBundle(root, manifestPath, manifestSnapshot.sha256, {
      bundleId: job.id, assetId: job.assetId, sourceJobId: job.id, lineageSha256: job.lineageSha256,
    });
  } finally {
    const checkedTemporary = containedWorkflowPath(bundlesRoot, temporaryDirectory);
    if (basename(checkedTemporary).startsWith(`.tmp-${job.id}-`)) await rm(checkedTemporary, { recursive: true, force: true });
  }
}

export async function recordWorkflowJob(root: string, job: Prompt3DFinishJobStatus): Promise<void> {
  const directory = workflowDirectory(root, job.id);
  await mkdir(join(directory, "events"), { recursive: true });
  job.updatedAt = new Date().toISOString();
  const text = `${JSON.stringify(job, null, 2)}\n`;
  await writeFile(join(directory, "events", `${Date.now()}-${randomUUID()}.json`), text, { flag: "wx" });
  const temporary = join(directory, "job.json.tmp");
  await writeFile(temporary, text);
  await rename(temporary, join(directory, "job.json"));
}

export async function readWorkflowJobs(root: string): Promise<Prompt3DFinishJobStatus[]> {
  const directory = containedWorkflowPath(root, join(root, "workflow-history"));
  if (!existsSync(directory)) return [];
  const result: Prompt3DFinishJobStatus[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !UUID.test(entry.name)) continue;
    try {
      const path = containedWorkflowPath(root, join(directory, entry.name, "job.json"));
      const info = await stat(path);
      if (!info.isFile() || info.size < 1 || info.size > 2 * 1024 ** 2) continue;
      const job = JSON.parse(await readFile(path, "utf8")) as Prompt3DFinishJobStatus;
      if (job.version !== 1 || job.id !== entry.name) continue;
      if (job.state === "running" || job.state === "queued") {
        job.state = "failed";
        job.stage = "failed";
        job.message = "Interrupted before completion. Retained files were not reused or regenerated automatically.";
        job.error = { code: "INTERRUPTED", message: job.message, retryable: true };
        await recordWorkflowJob(root, job);
      }
      result.push(job);
    } catch {
      // Invalid history remains on disk and is excluded from the usable index.
    }
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function glbJson(bytes: Buffer): any {
  if (bytes.byteLength < 20 || bytes.toString("ascii", 0, 4) !== "glTF" || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.byteLength || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error("Expected a complete binary glTF 2.0 file.");
  const jsonLength = bytes.readUInt32LE(12);
  if (jsonLength < 2 || jsonLength + 20 > bytes.byteLength) throw new Error("Invalid GLB JSON chunk.");
  return JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength).trim());
}

export async function inspectWorkflowGlb(path: string): Promise<{
  sha256: string;
  byteSize: number;
  geometryHash: string;
  textures: number;
  textureFingerprint: string;
  animations: Array<{ name: string; duration: number; channels: number }>;
  animationFingerprint: string;
  clipIds: string[];
  morphTargets: number;
  trailNodes: number;
  skins: number;
  joints: number;
  skinnedMeshNodes: number;
  boneRotationChannels: number;
  selfContained: boolean;
}> {
  const bytes = await readFile(path);
  const json = glbJson(bytes);
  const external = [...(json.buffers ?? []), ...(json.images ?? [])].some((entry: any) => typeof entry?.uri === "string" && !entry.uri.startsWith("data:"));
  if (external) throw new Error("Workflow assets must be self-contained; external buffer/image URIs are not allowed.");
  const { NodeIO } = require("@gltf-transform/core");
  const { ALL_EXTENSIONS } = require("@gltf-transform/extensions");
  const document = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path);
  const root = document.getRoot();
  const positions = new Set<string>();
  const triangles: string[] = [];
  const meshFingerprints = new Map<any, string>();
  let morphTargets = 0;
  const derivedMeshes = new Set(
    root.listNodes()
      .filter((node: any) => node.getExtras()?.grudgeMotionTrail === true || node.getExtras()?.grudgeDerivedGeometry === true)
      .map((node: any) => node.getMesh())
      .filter(Boolean),
  );
  for (const mesh of root.listMeshes()) {
    if (derivedMeshes.has(mesh) || /(?:^|[_-])LOD\d+$/i.test(mesh.getName?.() ?? "")) continue;
    const meshPositions = new Set<string>();
    const meshTriangles: string[] = [];
    for (const primitive of mesh.listPrimitives()) {
      const array = primitive.getAttribute("POSITION")?.getArray() as ArrayLike<number> | undefined;
      if (!array) continue;
      const vertex = (index: number) => `${Math.round(Number(array[index * 3]) * 1e5)},${Math.round(Number(array[index * 3 + 1]) * 1e5)},${Math.round(Number(array[index * 3 + 2]) * 1e5)}`;
      for (let index = 0; index < array.length; index += 3) {
        const position = `${Math.round(Number(array[index]) * 1e5)},${Math.round(Number(array[index + 1]) * 1e5)},${Math.round(Number(array[index + 2]) * 1e5)}`;
        positions.add(position);
        meshPositions.add(position);
      }
      if ((primitive.getMode?.() ?? 4) === 4) {
        const indices = primitive.getIndices()?.getArray() as ArrayLike<number> | undefined;
        const count = indices?.length ?? Math.floor(array.length / 3);
        for (let index = 0; index + 2 < count; index += 3) {
          const corners = [
            vertex(Number(indices ? indices[index] : index)),
            vertex(Number(indices ? indices[index + 1] : index + 1)),
            vertex(Number(indices ? indices[index + 2] : index + 2)),
          ].sort();
          const triangle = corners.join("|");
          triangles.push(triangle);
          meshTriangles.push(triangle);
        }
      }
      morphTargets += primitive.listTargets().length;
    }
    meshFingerprints.set(mesh, createHash("sha256")
      .update(`positions\n${[...meshPositions].sort().join("\n")}\ntriangles\n${meshTriangles.sort().join("\n")}`)
      .digest("hex"));
  }
  if (!positions.size) throw new Error("Workflow asset contains no measurable mesh positions.");
  const animations = root.listAnimations().map((animation: any) => {
    let duration = 0;
    for (const sampler of animation.listSamplers()) {
      const values = sampler.getInput()?.getArray() as ArrayLike<number> | undefined;
      if (values?.length) duration = Math.max(duration, Number(values[values.length - 1]));
    }
    return { name: animation.getName() || "Animation", duration, channels: animation.listChannels().length };
  });
  const baseMeshIndices = root.listMeshes()
    .map((mesh: any, index: number) => ({ mesh, index }))
    .filter(({ mesh }: any) => meshFingerprints.has(mesh));
  const rawMeshBindings = baseMeshIndices.map(({ mesh, index }: any) => ({
    meshFingerprint: meshFingerprints.get(mesh),
    materials: (json.meshes?.[index]?.primitives ?? []).map((primitive: any) => primitive.material ?? null),
  }));
  const materialIndices = [...new Set<number>(rawMeshBindings.flatMap((binding: any) => binding.materials).filter((value: unknown): value is number => Number.isInteger(value)))].sort((a, b) => a - b);
  const materialRemap = new Map(materialIndices.map((value, index) => [value, index]));
  const materials = materialIndices.map((index) => JSON.parse(JSON.stringify(json.materials?.[index] ?? {})));
  const textureIndices = new Set<number>();
  const collectTextureIndices = (value: any) => {
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value) && Number.isInteger(value.index)) textureIndices.add(value.index);
    for (const child of Object.values(value)) collectTextureIndices(child);
  };
  materials.forEach(collectTextureIndices);
  const orderedTextureIndices = [...textureIndices].sort((a, b) => a - b);
  const textureRemap = new Map(orderedTextureIndices.map((value, index) => [value, index]));
  const remapMaterialTextureIndices = (value: any) => {
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value) && Number.isInteger(value.index) && textureRemap.has(value.index)) value.index = textureRemap.get(value.index);
    for (const child of Object.values(value)) remapMaterialTextureIndices(child);
  };
  materials.forEach(remapMaterialTextureIndices);
  const imageIndices = [...new Set<number>(orderedTextureIndices.map((index) => json.textures?.[index]?.source).filter((value): value is number => Number.isInteger(value)))].sort((a, b) => a - b);
  const samplerIndices = [...new Set<number>(orderedTextureIndices.map((index) => json.textures?.[index]?.sampler).filter((value): value is number => Number.isInteger(value)))].sort((a, b) => a - b);
  const imageRemap = new Map(imageIndices.map((value, index) => [value, index]));
  const samplerRemap = new Map(samplerIndices.map((value, index) => [value, index]));
  const semanticTextures = orderedTextureIndices.map((index) => {
    const texture = JSON.parse(JSON.stringify(json.textures?.[index] ?? {}));
    if (Number.isInteger(texture.source)) texture.source = imageRemap.get(texture.source);
    if (Number.isInteger(texture.sampler)) texture.sampler = samplerRemap.get(texture.sampler);
    return texture;
  });
  const textureHash = createHash("sha256");
  textureHash.update(`textures:${imageIndices.length};`);
  const documentTextures = root.listTextures();
  for (const [canonicalIndex, imageIndex] of imageIndices.entries()) {
    const texture = documentTextures[imageIndex];
    const image = texture?.getImage?.() as Uint8Array | null;
    textureHash.update(`image:${canonicalIndex}:${texture?.getName?.() ?? ""}:${texture?.getMimeType?.() ?? ""}:${image?.byteLength ?? 0};`);
    if (image) textureHash.update(Buffer.from(image.buffer, image.byteOffset, image.byteLength));
  }
  const textureStructure = {
    // Buffer-view numbers and byte offsets may be reassigned when unrelated
    // animation accessors are added. Image bytes are hashed above, so retain
    // only semantic image metadata here. Derived-only trail/LOD materials are
    // excluded by beginning with bindings from base meshes only.
    images: imageIndices.map((index) => {
      const image = json.images?.[index] ?? {};
      return {
        name: image.name ?? "",
        mimeType: image.mimeType ?? "",
        ...(typeof image.uri === "string" && !image.uri.startsWith("data:") ? { uri: image.uri } : {}),
        extensions: image.extensions ?? {},
        extras: image.extras ?? {},
      };
    }),
    samplers: samplerIndices.map((index) => json.samplers?.[index] ?? {}),
    textures: semanticTextures,
    materials,
    meshMaterialBindings: rawMeshBindings
      .map((binding: any) => ({ meshFingerprint: binding.meshFingerprint, materials: binding.materials.map((index: number | null) => index === null ? null : materialRemap.get(index)) }))
      .sort((a: any, b: any) => stableJson(a).localeCompare(stableJson(b))),
  };
  textureHash.update(stableJson(textureStructure));
  const textureFingerprint = textureHash.digest("hex");

  const animationHash = createHash("sha256");
  const clipIds: string[] = [];
  animationHash.update(`animations:${root.listAnimations().length};`);
  for (const [animationIndex, animation] of root.listAnimations().entries()) {
    const samplers = animation.listSamplers();
    const extras = animation.getExtras?.() ?? {};
    const clipId = extras?.grudgePromptAnimation?.clipId;
    if (typeof clipId === "string" && clipId && !clipIds.includes(clipId)) clipIds.push(clipId);
    animationHash.update(stableJson({ index: animationIndex, name: animation.getName?.() ?? "", extras }));
    for (const [samplerIndex, sampler] of samplers.entries()) {
      const input = sampler.getInput?.();
      const output = sampler.getOutput?.();
      const inputArray = input?.getArray?.() as ArrayBufferView | null;
      const outputArray = output?.getArray?.() as ArrayBufferView | null;
      animationHash.update(stableJson({ samplerIndex, interpolation: sampler.getInterpolation?.(), inputType: input?.getType?.(), outputType: output?.getType?.() }));
      if (inputArray) animationHash.update(Buffer.from(inputArray.buffer, inputArray.byteOffset, inputArray.byteLength));
      if (outputArray) animationHash.update(Buffer.from(outputArray.buffer, outputArray.byteOffset, outputArray.byteLength));
    }
    for (const [channelIndex, channel] of animation.listChannels().entries()) {
      animationHash.update(stableJson({
        channelIndex,
        samplerIndex: samplers.indexOf(channel.getSampler?.()),
        targetNode: channel.getTargetNode?.()?.getName?.() ?? "",
        targetPath: channel.getTargetPath?.() ?? "",
        extras: channel.getExtras?.() ?? {},
      }));
    }
  }
  const animationFingerprint = animationHash.digest("hex");
  const nodeRecords: Array<Record<string, unknown>> = [];
  const visitedNodes = new Set<any>();
  const isDerivedNode = (node: any) => {
    const extras = node.getExtras?.() ?? {};
    const mesh = node.getMesh?.();
    return extras.grudgeMotionTrail === true
      || extras.grudgeDerivedGeometry === true
      || (mesh && (derivedMeshes.has(mesh) || /(?:^|[_-])LOD\d+$/i.test(mesh.getName?.() ?? "")));
  };
  const matrixIdentity = (matrix: ArrayLike<number>) => Array.from(matrix, (value) => Math.round(Number(value) * 1e6));
  const visitNode = (node: any, sceneIndex: number | "orphan", path: number[], parentPath: number[] | null) => {
    if (isDerivedNode(node)) return;
    visitedNodes.add(node);
    const mesh = node.getMesh?.();
    nodeRecords.push({
      sceneIndex,
      path,
      parentPath,
      localMatrix: matrixIdentity(node.getMatrix()),
      worldMatrix: matrixIdentity(node.getWorldMatrix()),
      meshFingerprint: mesh ? meshFingerprints.get(mesh) ?? null : null,
    });
    const children = node.listChildren().filter((child: any) => !isDerivedNode(child));
    children.forEach((child: any, index: number) => visitNode(child, sceneIndex, [...path, index], path));
  };
  root.listScenes().forEach((scene: any, sceneIndex: number) => {
    scene.listChildren()
      .filter((node: any) => !isDerivedNode(node))
      .forEach((node: any, index: number) => visitNode(node, sceneIndex, [index], null));
  });
  root.listNodes()
    .filter((node: any) => !visitedNodes.has(node) && !node.getParentNode?.() && !isDerivedNode(node))
    .forEach((node: any, index: number) => visitNode(node, "orphan", [index], null));
  const geometryHash = createHash("sha256")
    .update(stableJson({
      positions: [...positions].sort(),
      triangles: triangles.sort(),
      meshFingerprints: [...meshFingerprints.values()].sort(),
      nodeHierarchy: nodeRecords,
    }))
    .digest("hex");
  const trailNodes = root.listNodes().filter((node: any) => node.getExtras()?.grudgeMotionTrail === true).length;
  const skinJoints = new Set(root.listSkins().flatMap((skin: any) => skin.listJoints()));
  const skinnedMeshNodes = root.listNodes().filter((node: any) => node.getMesh?.() && node.getSkin?.()).length;
  const boneRotationChannels = root.listAnimations().reduce((count: number, animation: any) => count + animation.listChannels()
    .filter((channel: any) => channel.getTargetPath?.() === "rotation" && skinJoints.has(channel.getTargetNode?.())).length, 0);
  return {
    sha256: sha256Bytes(bytes),
    byteSize: bytes.byteLength,
    geometryHash,
    textures: imageIndices.length,
    textureFingerprint,
    animations,
    animationFingerprint,
    clipIds: clipIds.sort(),
    morphTargets,
    trailNodes,
    skins: root.listSkins().length,
    joints: skinJoints.size,
    skinnedMeshNodes,
    boneRotationChannels,
    selfContained: true,
  };
}

export async function validateFinishedAsset(
  sourcePath: string,
  outputPath: string,
  operation: "texture" | "animation",
  motion?: {
    operators: string[];
    pathDisplacementMeters: number;
    effectiveDeformationTargets?: number;
    maximumDeformationRatio?: number;
    skeletalRequired?: boolean;
  },
): Promise<Prompt3DFinishValidation> {
  const source = await inspectWorkflowGlb(sourcePath);
  const output = await inspectWorkflowGlb(outputPath);
  const geometryPreserved = source.geometryHash === output.geometryHash;
  const textureChanged = source.textureFingerprint !== output.textureFingerprint;
  const checks = [
    "Binary glTF 2.0 header and declared length are valid",
    "No external buffer, image, URL or borrowed asset dependency is present",
    "Base geometry identity is measured independently from textures and morph targets",
  ];
  if (operation === "texture") {
    if (!output.textures) throw new Error("Hunyuan Paint output contains no embedded texture.");
    if (source.textures > 0 && !textureChanged) throw new Error("Hunyuan Paint returned the same retained texture/material fingerprint; no prompted texture revision was accepted.");
    checks.push("At least one texture is embedded by the Hunyuan Paint result");
    checks.push(source.textures > 0 ? "Texture/material fingerprint differs from the retained parent revision" : "The untextured parent gained an embedded texture/material result");
  } else {
    if (!output.animations.length || output.animations.every((clip) => clip.channels < 1 || clip.duration <= 0)) throw new Error("Animation output contains no playable channel.");
    checks.push("At least one positive-duration animation clip contains a playable channel");
    if (motion?.skeletalRequired) {
      if (output.skins < 1 || output.joints < 22 || output.skinnedMeshNodes < 1 || output.boneRotationChannels < 22) {
        throw new Error("Skeletal animation output requires a skin, 22 joints, a skinned surface and 22 generated bone-rotation channels.");
      }
      checks.push("Local Mixamo-25 core skin and 22 generated skeletal rotation channels are present");
    }
  }
  return {
    selfContained: output.selfContained,
    sourceGeometryPreserved: geometryPreserved,
    sourceGeometryHash: source.geometryHash,
    outputGeometryHash: output.geometryHash,
    embeddedTextures: output.textures,
    sourceTextureFingerprint: source.textureFingerprint,
    outputTextureFingerprint: output.textureFingerprint,
    textureChanged,
    outputAnimationFingerprint: output.animationFingerprint,
    animations: output.animations,
    ...(motion ? { motion: {
      operators: motion.operators,
      pathDisplacementMeters: motion.pathDisplacementMeters,
      morphTargets: output.morphTargets,
      trailNodes: output.trailNodes,
      effectiveDeformationTargets: motion.effectiveDeformationTargets ?? 0,
      maximumDeformationRatio: motion.maximumDeformationRatio ?? 0,
      skins: output.skins,
      joints: output.joints,
      skinnedMeshNodes: output.skinnedMeshNodes,
      boneRotationChannels: output.boneRotationChannels,
    } } : {}),
    checks,
  };
}

function requireSha256(label: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a SHA-256 digest.`);
}

function requireUuid(label: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`${label} must be a UUID.`);
}

function assertDeepProviderVerification(
  value: Prompt3DWorkflowLineage["root"]["providerVerification"],
  sourceRevision?: string,
  requireNativeRuntime = false,
  expectedProviderId: "hunyuan3d-2" | "hy-motion-1" = "hunyuan3d-2",
): void {
  if (!value || value.version !== 1 || value.providerId !== expectedProviderId || value.verificationMode !== "deep") {
    throw new Error(`Workflow lineage requires fresh deep ${expectedProviderId} provider verification.`);
  }
  if (sourceRevision !== undefined && value.sourceRevision !== sourceRevision) throw new Error("Provider verification source revision does not match lineage.");
  if (!Number.isFinite(Date.parse(value.verifiedAt)) || !value.reason) throw new Error("Provider verification timestamp or result is invalid.");
  requireSha256("Provider install-manifest hash", value.installManifestSha256);
  requireSha256("Provider worker hash", value.workerSha256);
  requireSha256("Provider pip lock hash", value.runtimeLocks?.pipFreezeSha256);
  requireSha256("Provider conda lock hash", value.runtimeLocks?.condaExplicitSha256);
  // The signed native inventory contains the Hunyuan Paint UV inpaint
  // extension. Shape generations made before Paint was installed still carry
  // complete deep Hunyuan source, worker, model and Python-runtime evidence;
  // requiring a future Paint-only artifact would make those immutable records
  // unsaveable. Paint revisions themselves must always bind that inventory.
  if (requireNativeRuntime) {
    requireSha256("Provider native runtime inventory hash", value.runtimeLocks?.nativeArtifactsSha256);
  } else if (value.runtimeLocks?.nativeArtifactsSha256 !== undefined) {
    requireSha256("Provider native runtime inventory hash", value.runtimeLocks.nativeArtifactsSha256);
  }
  if (!Array.isArray(value.modelSnapshots) || value.modelSnapshots.length < 1) throw new Error("Provider verification contains no model snapshots.");
  for (const snapshot of value.modelSnapshots) {
    if (!snapshot?.id || !snapshot.revision) throw new Error("Provider verification model identity is incomplete.");
    requireSha256(`Provider model tree hash for ${snapshot.id}`, snapshot.treeSha256);
  }
}

async function readEvidenceBytes(
  root: string,
  path: string,
  expectedSha256: string,
  label: string,
  maximumBytes = MAX_EVIDENCE_BYTES,
  resolveEvidencePath?: Prompt3DWorkflowEvidencePathResolver,
): Promise<Buffer> {
  requireSha256(`${label} hash`, expectedSha256);
  const logicalPath = containedWorkflowPath(root, path);
  const containedPath = containedWorkflowPath(root, resolveEvidencePath ? resolveEvidencePath(logicalPath) : logicalPath);
  const safePath = await assertSafeExistingPath(root, containedPath, "file");
  const link = await lstat(safePath);
  const info = await stat(safePath);
  if (link.isSymbolicLink() || !info.isFile() || info.size < 1 || info.size > maximumBytes) throw new Error(`${label} is unsafe or unavailable.`);
  const bytes = await readFile(safePath);
  if (sha256Bytes(bytes) !== expectedSha256) throw new Error(`${label} no longer matches its retained hash.`);
  return bytes;
}

async function readEvidenceJson(
  root: string,
  path: string,
  expectedSha256: string,
  label: string,
  resolveEvidencePath?: Prompt3DWorkflowEvidencePathResolver,
): Promise<Record<string, any>> {
  const bytes = await readEvidenceBytes(root, path, expectedSha256, label, MAX_EVIDENCE_BYTES, resolveEvidencePath);
  const parsed = JSON.parse(bytes.toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must contain one JSON object.`);
  return parsed;
}

async function readStableEvidenceJson(
  root: string,
  path: string,
  expectedStableSha256: string,
  label: string,
  resolveEvidencePath?: Prompt3DWorkflowEvidencePathResolver,
): Promise<Record<string, any>> {
  requireSha256(`${label} hash`, expectedStableSha256);
  const logicalPath = containedWorkflowPath(root, path);
  const retainedPath = containedWorkflowPath(root, resolveEvidencePath ? resolveEvidencePath(logicalPath) : logicalPath);
  const safePath = await assertSafeExistingPath(root, retainedPath, "file");
  const info = await stat(safePath);
  if (!info.isFile() || info.size < 1 || info.size > MAX_EVIDENCE_BYTES) throw new Error(`${label} is unsafe or unavailable.`);
  const parsed = JSON.parse((await readFile(safePath)).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || stableWorkflowSha256(parsed) !== expectedStableSha256) {
    throw new Error(`${label} no longer matches its retained stable hash.`);
  }
  return parsed;
}

async function validateRetainedReferenceImageEvidence(
  root: string,
  retained: Prompt3DRetainedReferenceImage | undefined,
  expected: AssetSpecV1["referenceImage"],
  label: string,
  resolveEvidencePath?: Prompt3DWorkflowEvidencePathResolver,
): Promise<string | undefined> {
  if (!retained && !expected) return undefined;
  if (!retained || !expected) throw new Error(`${label} reference-image evidence is incomplete.`);
  assertPrompt3DReferenceImageSpec(retained);
  assertPrompt3DReferenceImageSpec(expected);
  if (!prompt3DReferenceImageMatches(retained, expected)
    || retained.use !== "hunyuan-shape-concept-conditioning"
    || !Number.isFinite(Date.parse(retained.copiedAt))
    || typeof retained.path !== "string") {
    throw new Error(`${label} reference-image identity does not match AssetSpec.`);
  }
  const bytes = await readEvidenceBytes(root, retained.path, retained.sha256, `${label} reference image`, 20 * 1024 ** 2, resolveEvidencePath);
  if (bytes.byteLength !== retained.byteSize) throw new Error(`${label} reference-image byte size changed.`);
  return retained.sha256;
}

async function validateRetainedReferenceImagesEvidence(
  root: string,
  retained: Prompt3DRetainedReferenceImage[] | undefined,
  expected: AssetSpecV1["referenceImages"],
  label: string,
  resolveEvidencePath?: Prompt3DWorkflowEvidencePathResolver,
): Promise<string[] | undefined> {
  if (!retained && !expected) return undefined;
  if (!retained || !expected || retained.length !== expected.length || retained.length < 1 || retained.length > 4) {
    throw new Error(`${label} multiview reference-image evidence is incomplete.`);
  }
  const views = new Set<string>();
  const hashes: string[] = [];
  for (let index = 0; index < retained.length; index += 1) {
    const image = retained[index];
    if (!image.view || views.has(image.view)) throw new Error(`${label} multiview reference roles are invalid.`);
    views.add(image.view);
    const sha256 = await validateRetainedReferenceImageEvidence(root, image, expected[index], `${label} ${image.view} view`, resolveEvidencePath);
    hashes.push(sha256!);
  }
  if (!views.has("front")) throw new Error(`${label} multiview reference set has no front view.`);
  return hashes;
}

async function validateStructuredConceptAttemptEvidence(
  root: string,
  attempt: Prompt3DConceptAttempt,
  label: string,
  resolveEvidencePath?: Prompt3DWorkflowEvidencePathResolver,
): Promise<void> {
  if (!hasStructuredConceptProtocol(attempt)) return;
  const retained = retainedConceptWorkflowInput(attempt.binding);
  const binding = attempt.binding;
  const review = attempt.technicalReview;
  if (!retained
    || !Number.isInteger(attempt.attemptNumber) || attempt.attemptNumber < 1
    || binding.attemptId !== `${binding.jobId}:concept:${attempt.attemptNumber}`
    || binding.specFingerprint !== createHash("sha256").update(binding.specCanonical).digest("hex")
    || retained.spec.prompt !== binding.prompt || retained.spec.seed !== binding.seed
    || retained.spec.providerId !== binding.providerId
    || stableJson(retained.promptPlan) !== stableJson(attempt.promptPlan)) {
    throw new Error(`${label} retained concept attempt binding is invalid.`);
  }
  const referenceSha256 = await validateRetainedReferenceImageEvidence(root, attempt.referenceImage, retained.spec.referenceImage, label, resolveEvidencePath);
  if ((referenceSha256 ?? null) !== binding.referenceSha256) {
    throw new Error(`${label} retained concept reference hash does not match its immutable binding.`);
  }
  const referenceSha256s = await validateRetainedReferenceImagesEvidence(root, attempt.referenceImages, retained.spec.referenceImages, label, resolveEvidencePath);
  const expectedBindings = (attempt.referenceImages ?? []).map((image) => ({ view: image.view!, sha256: image.sha256 }));
  if (stableJson(referenceSha256s ?? []) !== stableJson(expectedBindings.map((item) => item.sha256))
    || stableJson(binding.referenceImageBindings ?? (referenceSha256 ? [{ view: "front", sha256: referenceSha256 }] : [])) !== stableJson(expectedBindings.length > 0 ? expectedBindings : (referenceSha256 ? [{ view: "front", sha256: referenceSha256 }] : []))) {
    throw new Error(`${label} retained multiview concept binding is inconsistent.`);
  }
  const presentationSha256 = stableWorkflowSha256(attempt.promptPlan.presentationContract);
  const reportSha256 = review.reportSha256;
  if ((review.status !== "pass" && review.status !== "needs-regeneration")
    || review.reportVersion !== 1
    || review.semanticResemblanceChecked !== false
    || review.visualReviewRequired !== true
    || typeof reportSha256 !== "string" || !SHA256.test(reportSha256)
    || review.presentationContractSha256 !== presentationSha256) {
    throw new Error(`${label} retained concept technical review binding is incomplete.`);
  }
  const reportBytes = await readEvidenceBytes(
    root,
    review.reportPath,
    reportSha256,
    `${label} retained concept technical review`,
    128 * 1024,
    resolveEvidencePath,
  );
  let report: Record<string, any>;
  try { report = JSON.parse(reportBytes.toString("utf8")); }
  catch { throw new Error(`${label} retained concept technical review is invalid JSON.`); }
  const validFailureCode = ["background-isolation", "foreground-missing", "edge-clearance"].includes(String(report.failureCode));
  if (report.version !== 1
    || report.method !== review.method
    || report.technicalStatus !== review.status
    || report.semanticResemblanceChecked !== false
    || report.visualReviewRequired !== true
    || (review.status === "pass" ? report.failureCode !== undefined || review.failureCode !== undefined : !validFailureCode || review.failureCode !== report.failureCode)) {
    throw new Error(`${label} retained concept technical review does not match its exact non-semantic report.`);
  }
  const providerSource = attempt.providerConceptSource;
  if ((report.providerSourcePath === "concept-source.png") !== Boolean(providerSource)) {
    throw new Error(`${label} retained concept provider-source provenance is inconsistent.`);
  }
  if (providerSource) {
    if (providerSource.role !== "untouched-provider-render"
      || report.providerSourceSha256 !== providerSource.sha256
      || stableJson(report.normalization) !== stableJson(attempt.normalization)
      || stableJson(report.conditioningIsolation) !== stableJson(attempt.conditioningIsolation)) {
      throw new Error(`${label} retained provider source or deterministic normalization record changed.`);
    }
    await readEvidenceBytes(
      root,
      providerSource.path,
      providerSource.sha256,
      `${label} untouched provider concept source`,
      32 * 1024 ** 2,
      resolveEvidencePath,
    );
  }
  await readEvidenceBytes(
    root,
    attempt.conceptImagePath,
    binding.conceptSha256,
    `${label} retained concept image`,
    32 * 1024 ** 2,
    resolveEvidencePath,
  );
}

async function validateStructuredConceptEvidence(
  root: string,
  provenance: Record<string, any>,
  label: string,
  resolveEvidencePath?: Prompt3DWorkflowEvidencePathResolver,
): Promise<string | undefined> {
  const attempt = provenance.conceptAttempt;
  if (!attempt || !hasStructuredConceptProtocol(attempt)) return undefined;
  const retained = retainedConceptWorkflowInput(attempt.binding);
  if (!retained) throw new Error(`${label} concept attempt has invalid canonical input.`);
  const referenceSha256 = await validateRetainedReferenceImageEvidence(
    root,
    provenance.referenceImage,
    retained.spec.referenceImage,
    `${label} provenance`,
    resolveEvidencePath,
  );
  const referenceSha256s = await validateRetainedReferenceImagesEvidence(
    root,
    provenance.referenceImages,
    retained.spec.referenceImages,
    `${label} provenance`,
    resolveEvidencePath,
  );
  if (stableJson(provenance.referenceImage) !== stableJson(attempt.referenceImage)
    || stableJson(provenance.referenceImages) !== stableJson(attempt.referenceImages)
    || (referenceSha256 ?? null) !== attempt.binding.referenceSha256
    || (referenceSha256 ?? null) !== provenance.conceptApproval?.referenceSha256
    || stableJson(referenceSha256s ?? []) !== stableJson((attempt.referenceImages ?? []).map((image: Prompt3DRetainedReferenceImage) => image.sha256))) {
    throw new Error(`${label} provenance does not bind its exact local reference-image conditioning evidence.`);
  }
  if (!Array.isArray(provenance.conceptAttempts) || provenance.conceptAttempts.length < 1 || provenance.conceptAttempts.length > 128) {
    throw new Error(`${label} structured concept attempt history is missing or exceeds its audit limit.`);
  }
  for (const [index, retainedAttempt] of provenance.conceptAttempts.entries()) {
    await validateStructuredConceptAttemptEvidence(root, retainedAttempt, `${label} concept attempt ${index + 1}`, resolveEvidencePath);
  }
  assertConceptAttemptBinding(attempt.binding.jobId, retained.spec, attempt, attempt.binding.conceptSha256);
  if (attempt.technicalReview.status !== "pass") throw new Error(`${label} approved concept technical review is not passing.`);
  const inspection = provenance.conceptInspection;
  assertConceptInspectionRecord(retained.spec, attempt, inspection, "approved");
  const retainedInspection = await readStableEvidenceJson(root, inspection.path, inspection.sha256, `${label} concept inspection`, resolveEvidencePath);
  if (stableJson(retainedInspection) !== stableJson(inspection.evidence)) throw new Error(`${label} concept inspection record differs from provenance.`);
  assertGeometryApproval(attempt.binding.jobId, retained.spec, attempt, provenance.conceptApproval, attempt.binding.conceptSha256, inspection);
  if (!Array.isArray(provenance.conceptInspections)
    || !provenance.conceptInspections.some((record: any) => stableJson(record) === stableJson(inspection))) {
    throw new Error(`${label} provenance omits its exact concept inspection from retained history.`);
  }
  const approvalDecisions = Array.isArray(provenance.conceptDecisions)
    ? provenance.conceptDecisions.filter((decision: any) => decision?.kind === "approved" && decision.attemptId === attempt.binding.attemptId)
    : [];
  if (approvalDecisions.length !== 1
    || approvalDecisions[0].inspectionSha256 !== inspection.sha256
    || approvalDecisions[0].inspectionPath !== inspection.path) {
    throw new Error(`${label} concept approval decision does not bind its exact inspection evidence.`);
  }
  for (const record of provenance.conceptInspections) {
    const retainedAttempt = Array.isArray(provenance.conceptAttempts)
      ? provenance.conceptAttempts.find((candidate: any) => candidate?.binding?.attemptId === record?.evidence?.attemptId)
      : undefined;
    if (!retainedAttempt || !hasStructuredConceptProtocol(retainedAttempt)) throw new Error(`${label} contains an orphan concept inspection record.`);
    const retainedInput = retainedConceptWorkflowInput(retainedAttempt.binding);
    if (!retainedInput) throw new Error(`${label} retained concept inspection has invalid canonical input.`);
    assertConceptInspectionRecord(retainedInput.spec, retainedAttempt, record);
    const fileRecord = await readStableEvidenceJson(root, record.path, record.sha256, `${label} retained concept inspection`, resolveEvidencePath);
    if (stableJson(fileRecord) !== stableJson(record.evidence)) throw new Error(`${label} retained concept inspection file differs from provenance.`);
    const retainedDecisions = Array.isArray(provenance.conceptDecisions)
      ? provenance.conceptDecisions.filter((decision: any) => decision?.attemptId === record.evidence.attemptId)
      : [];
    if (record.evidence.decision === "rejected") {
      const rejection = retainedDecisions.filter((decision: any) => decision.kind === "rejected");
      if (rejection.length !== 1
        || rejection[0].inspectionSha256 !== record.sha256
        || rejection[0].inspectionPath !== record.path
        || rejection[0].rejectionClassification !== record.evidence.rejection?.classification) {
        throw new Error(`${label} rejected concept does not retain its classified inspection decision.`);
      }
    }
    for (const successor of retainedDecisions.filter((decision: any) => decision.nextJobId !== undefined)) {
      if (retainedAttempt.technicalReview.status === "pass"
        && (successor.inspectionSha256 !== record.sha256 || successor.inspectionPath !== record.path)) {
        throw new Error(`${label} concept successor does not bind the exact prior inspection record.`);
      }
    }
  }
  for (const retainedAttempt of provenance.conceptAttempts as Prompt3DConceptAttempt[]) {
    if (!hasStructuredConceptProtocol(retainedAttempt)) continue;
    const records = provenance.conceptInspections.filter((record: any) => record?.evidence?.attemptId === retainedAttempt.binding.attemptId);
    const successors = Array.isArray(provenance.conceptDecisions)
      ? provenance.conceptDecisions.filter((decision: any) => decision?.attemptId === retainedAttempt.binding.attemptId && decision.nextJobId !== undefined)
      : [];
    if (retainedAttempt.technicalReview.status === "pass") {
      if (records.length !== 1) throw new Error(`${label} passing concept attempt does not retain exactly one explicit inspection.`);
    } else if (records.length !== 0
      || successors.length !== 1
      || successors[0].inspectionSha256 !== retainedAttempt.technicalReview.reportSha256
      || successors[0].inspectionPath !== retainedAttempt.technicalReview.reportPath) {
      throw new Error(`${label} technically rejected concept successor does not bind its exact technical-review report.`);
    }
  }
  return inspection.sha256;
}

async function inspectLineageOutput(root: string, path: string, label: string, resolveEvidencePath?: Prompt3DWorkflowEvidencePathResolver) {
  const logicalPath = containedWorkflowPath(root, path);
  const containedPath = containedWorkflowPath(root, resolveEvidencePath ? resolveEvidencePath(logicalPath) : logicalPath);
  const safePath = await assertSafeExistingPath(root, containedPath, "file");
  const link = await lstat(safePath);
  const info = await stat(safePath);
  if (link.isSymbolicLink() || !info.isFile() || info.size < 20 || info.size > 1024 ** 3) throw new Error(`${label} is unsafe or unavailable.`);
  return { path: logicalPath, retainedPath: safePath, inspection: await inspectWorkflowGlb(safePath) };
}

function assertApprovalEvidence(
  approval: Prompt3DVisualApproval,
  expected: {
    stage: Prompt3DVisualApprovalStage;
    assetId: string;
    jobId: string;
    assetPath: string;
    assetSha256: string;
    geometryHash: string;
    promptSha256: string;
    specFingerprint: string;
    textureFingerprint?: string;
    animationFingerprint?: string;
    animations?: Array<{ name: string; duration: number }>;
  },
): void {
  assertPrompt3DVisualInspectionEvidence(approval.inspection, {
    assetPath: expected.assetPath,
    assetSha256: expected.assetSha256,
    stage: expected.stage,
    ...(expected.stage === "animation" ? { animations: expected.animations ?? [] } : {}),
  });
  const { animations: _animations, ...approvalExpected } = expected;
  assertVisualApprovalMatches(approval, { version: 1, ...approvalExpected });
}

export interface Prompt3DWorkflowLineageValidation {
  lineageSha256: string;
  rootInspection: Awaited<ReturnType<typeof inspectWorkflowGlb>>;
  finalInspection: Awaited<ReturnType<typeof inspectWorkflowGlb>>;
  finalVisualApprovalSha256: string;
  textureRevisions: number;
  animationRevisions: number;
}

/**
 * Replays the complete retained evidence chain. A status flag or provider label
 * alone is never sufficient to admit a workflow asset to the managed library.
 */
export async function validatePrompt3DWorkflowLineage(
  root: string,
  lineage: Prompt3DWorkflowLineage,
  finalJob?: Prompt3DFinishJobStatus,
  resolveEvidencePath?: Prompt3DWorkflowEvidencePathResolver,
): Promise<Prompt3DWorkflowLineageValidation> {
  if (!lineage || lineage.version !== 1) throw new Error("Prompt-to-3D workflow lineage is missing or unsupported.");
  assertPrompt3DWorkflowLineageSeal(lineage);
  requireUuid("Workflow asset ID", lineage.assetId);
  const rootLineage = lineage.root;
  const generationChain = lineage.generationChain;
  if (!Array.isArray(generationChain) || generationChain.length < 1 || generationChain.length > 32) {
    throw new Error("Complete workflow lineage requires at least one approved Hunyuan generation.");
  }
  prompt3DWorkflowUsesExistingGeneratedModel(lineage);
  if (!rootLineage || stableJson(generationChain.at(-1)) !== stableJson(rootLineage)) {
    throw new Error("Workflow root must be the final approved Hunyuan generation in the retained generation chain.");
  }

  let previousGeneration: {
    lineage: Prompt3DWorkflowRootLineage;
    output: Awaited<ReturnType<typeof inspectLineageOutput>>;
    provenance: Record<string, any>;
  } | undefined;
  let rootOutput: Awaited<ReturnType<typeof inspectLineageOutput>> | undefined;
  const generationIds = new Set<string>();
  for (const [index, generation] of generationChain.entries()) {
    const label = index === 0 ? "Base Hunyuan generation" : `Hunyuan shape refinement ${index}`;
    if (!generation || generation.version !== 1 || generation.kind !== "generation" || generation.assetId !== lineage.assetId) throw new Error(`${label} lineage is invalid.`);
    requireUuid(`${label} job ID`, generation.jobId);
    if (generationIds.has(generation.jobId)) throw new Error("Hunyuan generation lineage contains a duplicate or cyclic job ID.");
    generationIds.add(generation.jobId);
    if (!Number.isInteger(generation.variantIndex) || generation.variantIndex !== 0) throw new Error(`${label} must use the exact approved first variant.`);
    if (generation.method !== "hunyuan3d-neural-generation" || generation.provider !== "hunyuan3d-2") throw new Error(`${label} is not an authoritative Hunyuan neural generation.`);
    for (const [hashLabel, value] of [
      [`${label} spec fingerprint`, generation.specFingerprint],
      [`${label} prompt hash`, generation.promptSha256],
      [`${label} concept hash`, generation.conceptSha256],
      [`${label} concept approval hash`, generation.conceptApprovalSha256],
      [`${label} output hash`, generation.outputSha256],
      [`${label} geometry hash`, generation.geometryHash],
      [`${label} provenance hash`, generation.provenanceSha256],
      [`${label} visual approval hash`, generation.visualApprovalSha256],
    ] as const) requireSha256(hashLabel, value);
    if (generation.conceptInspectionSha256 !== undefined) requireSha256(`${label} concept inspection hash`, generation.conceptInspectionSha256);
    if (generation.referenceSha256 !== undefined) requireSha256(`${label} reference image hash`, generation.referenceSha256);
    for (const [index, hash] of (generation.referenceSha256s ?? []).entries()) requireSha256(`${label} reference image ${index + 1} hash`, hash);
    if ((generation.referenceSha256s === undefined) !== (generation.referenceViews === undefined)
      || (generation.referenceSha256s && (generation.referenceSha256s.length < 1 || generation.referenceSha256s.length > 4 || generation.referenceSha256s.length !== generation.referenceViews?.length))) {
      throw new Error(`${label} multiview reference lineage is incomplete.`);
    }
    assertDeepProviderVerification(generation.providerVerification, generation.providerSourceRevision);

    const output = await inspectLineageOutput(root, generation.outputPath, `${label} output`, resolveEvidencePath);
    if (output.inspection.sha256 !== generation.outputSha256
      || output.inspection.geometryHash !== generation.geometryHash
      || output.inspection.byteSize !== generation.byteSize) throw new Error(`${label} output no longer matches its retained identity.`);
    const provenance = await readEvidenceJson(root, generation.provenancePath, generation.provenanceSha256, `${label} provenance`, resolveEvidencePath);
    if (provenance.method !== generation.method
      || provenance.provider?.id !== generation.provider
      || provenance.provider?.sourceRevision !== generation.providerSourceRevision
      || provenance.approvedConcept !== true
      || provenance.conceptApproval?.source !== "explicit-user-action"
      || provenance.conceptApproval?.jobId !== generation.jobId
      || provenance.conceptApproval?.conceptSha256 !== generation.conceptSha256
      || (provenance.conceptApproval?.referenceSha256 ?? undefined) !== generation.referenceSha256
      || stableJson((provenance.referenceImages ?? []).map((image: Prompt3DRetainedReferenceImage) => image.sha256)) !== stableJson(generation.referenceSha256s ?? [])
      || stableJson((provenance.referenceImages ?? []).map((image: Prompt3DRetainedReferenceImage) => image.view)) !== stableJson(generation.referenceViews ?? [])
      || stableWorkflowSha256(provenance.conceptApproval) !== generation.conceptApprovalSha256
      || provenance.specFingerprint !== generation.specFingerprint
      || workflowPromptSha256(String(provenance.prompt ?? "")) !== generation.promptSha256
      || provenance.assetId !== lineage.assetId
      || provenance.output?.path !== output.path
      || provenance.output?.sha256 !== generation.outputSha256
      || provenance.output?.geometryHash !== generation.geometryHash
      || provenance.output?.byteSize !== generation.byteSize
      || stableJson(provenance.providerVerification) !== stableJson(generation.providerVerification)
      || !Array.isArray(provenance.sourceAssets) || provenance.sourceAssets.length !== 0) {
      throw new Error(`${label} provenance does not bind the exact provider, approval, prompt, source-asset exclusion and output.`);
    }
    const conceptInspectionSha256 = await validateStructuredConceptEvidence(root, provenance, label, resolveEvidencePath);
    if (conceptInspectionSha256 !== undefined && generation.conceptInspectionSha256 !== conceptInspectionSha256) {
      throw new Error(`${label} lineage does not bind its exact structured concept inspection.`);
    }
    if (conceptInspectionSha256 === undefined && generation.conceptInspectionSha256 !== undefined) {
      throw new Error(`${label} legacy concept contains a forged structured inspection hash.`);
    }
    const approvalRecord = await readEvidenceJson(root, generation.visualApprovalPath, generation.visualApprovalSha256, `${label} visual approval`, resolveEvidencePath);
    if (stableJson(approvalRecord) !== stableJson(generation.visualApproval)) throw new Error(`${label} visual approval record differs from lineage.`);
    assertApprovalEvidence(generation.visualApproval, {
      stage: "geometry",
      assetId: lineage.assetId,
      jobId: generation.jobId,
      assetPath: output.path,
      assetSha256: generation.outputSha256,
      geometryHash: generation.geometryHash,
      promptSha256: generation.promptSha256,
      specFingerprint: generation.specFingerprint,
    });

    if (!previousGeneration) {
      if (generation.shapeRefinement !== false
        || generation.parentJobId !== undefined
        || generation.parentPromptSha256 !== undefined
        || generation.parentOutputSha256 !== undefined
        || generation.parentGeometryHash !== undefined
        || generation.parentProvenanceSha256 !== undefined
        || generation.parentVisualApprovalSha256 !== undefined
        || provenance.shapeRefinement === true
        || provenance.parentGeneration !== undefined) {
        throw new Error("Base Hunyuan generation contains forged shape-refinement ancestry.");
      }
    } else {
      for (const [hashLabel, value] of [
        [`${label} parent prompt hash`, generation.parentPromptSha256],
        [`${label} parent output hash`, generation.parentOutputSha256],
        [`${label} parent geometry hash`, generation.parentGeometryHash],
        [`${label} parent provenance hash`, generation.parentProvenanceSha256],
        [`${label} parent visual approval hash`, generation.parentVisualApprovalSha256],
      ] as const) requireSha256(hashLabel, value);
      const expectedParent = {
        jobId: previousGeneration.lineage.jobId,
        promptSha256: previousGeneration.lineage.promptSha256,
        outputSha256: previousGeneration.lineage.outputSha256,
        geometryHash: previousGeneration.lineage.geometryHash,
        provenanceSha256: previousGeneration.lineage.provenanceSha256,
        visualApprovalSha256: previousGeneration.lineage.visualApprovalSha256,
      };
      const conceptChain = assertShapeRefinementConceptChain(
        provenance.conceptAttempts,
        provenance.conceptDecisions,
        previousGeneration.provenance.conceptApproval,
        provenance.conceptApproval,
      );
      if (generation.shapeRefinement !== true
        || generation.parentJobId !== previousGeneration.lineage.jobId
        || generation.parentPromptSha256 !== previousGeneration.lineage.promptSha256
        || generation.parentOutputSha256 !== previousGeneration.lineage.outputSha256
        || generation.parentGeometryHash !== previousGeneration.lineage.geometryHash
        || generation.parentProvenanceSha256 !== previousGeneration.lineage.provenanceSha256
        || generation.parentVisualApprovalSha256 !== previousGeneration.lineage.visualApprovalSha256
        || provenance.shapeRefinement !== true
        || provenance.parentJobId !== previousGeneration.lineage.jobId
        || (provenance.conceptParentJobId ?? provenance.parentJobId) !== conceptChain.immediateConceptParentJobId
        || stableJson(provenance.parentGeneration) !== stableJson(expectedParent)
        || generation.promptSha256 === previousGeneration.lineage.promptSha256
        || generation.outputSha256 === previousGeneration.lineage.outputSha256
        || generation.geometryHash === previousGeneration.lineage.geometryHash
        || !Number.isSafeInteger(provenance.seed)
        || !Number.isSafeInteger(previousGeneration.provenance.seed)
        || provenance.seed !== provenance.conceptApproval?.seed
        || previousGeneration.provenance.seed !== previousGeneration.provenance.conceptApproval?.seed) {
        throw new Error(`${label} does not prove a fresh prompted geometry correction from its exact approved Hunyuan parent.`);
      }
    }
    previousGeneration = { lineage: generation, output, provenance };
    rootOutput = output;
  }
  if (!rootOutput) throw new Error("Workflow Hunyuan generation chain is empty.");

  if (!Array.isArray(lineage.revisions) || lineage.revisions.length < 1 || lineage.revisions.length > 32) throw new Error("Complete workflow lineage requires bounded finishing revisions.");
  const jobIds = new Set([rootLineage.jobId]);
  let previousJobId = rootLineage.jobId;
  let previousSha256 = rootLineage.outputSha256;
  let previousProvenanceSha256 = rootLineage.provenanceSha256;
  let previousInspection = rootOutput.inspection;
  let sawTexture = false;
  let sawAnimation = false;
  let textureRevisions = 0;
  let animationRevisions = 0;

  for (const revision of lineage.revisions) {
    if (!revision || revision.version !== 1 || revision.assetId !== lineage.assetId) throw new Error("Workflow revision lineage is invalid.");
    if (revision.operation !== "texture" && revision.operation !== "animation") throw new Error("Workflow revision operation is invalid.");
    requireUuid("Workflow revision job ID", revision.jobId);
    if (jobIds.has(revision.jobId)) throw new Error("Workflow lineage contains a duplicate or cyclic job ID.");
    jobIds.add(revision.jobId);
    if (revision.sourceJobId !== previousJobId || revision.sourceSha256 !== previousSha256 || revision.sourceGeometryHash !== rootLineage.geometryHash) {
      throw new Error("Workflow revisions are reordered or do not bind the preceding output.");
    }
    for (const [label, value] of [
      ["Revision source hash", revision.sourceSha256],
      ["Revision source geometry hash", revision.sourceGeometryHash],
      ["Revision output hash", revision.outputSha256],
      ["Revision geometry hash", revision.geometryHash],
      ["Revision spec fingerprint", revision.specFingerprint],
      ["Revision prompt hash", revision.promptSha256],
      ["Revision provenance hash", revision.provenanceSha256],
      ["Revision parent provenance hash", revision.parentProvenanceSha256],
      ["Revision visual approval hash", revision.visualApprovalSha256],
      ["Revision source texture fingerprint", revision.sourceTextureFingerprint],
      ["Revision output texture fingerprint", revision.outputTextureFingerprint],
    ] as const) requireSha256(label, value);
    const output = await inspectLineageOutput(root, revision.outputPath, `${revision.operation} workflow output`, resolveEvidencePath);
    if (output.inspection.sha256 !== revision.outputSha256
      || output.inspection.geometryHash !== revision.geometryHash
      || output.inspection.byteSize !== revision.byteSize
      || revision.geometryHash !== rootLineage.geometryHash) throw new Error("Workflow revision output no longer matches its retained geometry and byte identity.");
    if (revision.sourceTextureFingerprint !== previousInspection.textureFingerprint
      || revision.outputTextureFingerprint !== output.inspection.textureFingerprint) throw new Error("Workflow texture fingerprints do not match the actual parent and output.");

    const provenance = await readEvidenceJson(root, revision.provenancePath, revision.provenanceSha256, `${revision.operation} provenance`, resolveEvidencePath);
    if (provenance.assetId !== lineage.assetId
      || provenance.revisionJobId !== revision.jobId
      || provenance.operation !== revision.operation
      || provenance.specFingerprint !== revision.specFingerprint
      || workflowPromptSha256(String(provenance.prompt ?? "")) !== revision.promptSha256
      || provenance.source?.jobId !== revision.sourceJobId
      || provenance.source?.sha256 !== revision.sourceSha256
      || provenance.source?.geometryHash !== revision.sourceGeometryHash
      || provenance.source?.textureFingerprint !== revision.sourceTextureFingerprint
      || provenance.output?.path !== output.path
      || provenance.output?.sha256 !== revision.outputSha256
      || provenance.output?.geometryHash !== revision.geometryHash
      || provenance.output?.byteSize !== revision.byteSize
      || provenance.output?.textureFingerprint !== revision.outputTextureFingerprint
      || provenance.parentProvenanceSha256 !== revision.parentProvenanceSha256
      || revision.parentProvenanceSha256 !== previousProvenanceSha256) throw new Error("Workflow revision provenance does not bind its exact source, prompt and output.");

    let approvalStage: Prompt3DVisualApprovalStage;
    if (revision.operation === "texture") {
      if (sawAnimation) throw new Error("Texture revisions cannot follow animation in a saveable workflow lineage.");
      if (revision.provider !== "hunyuan3d-paint-2.1"
        || provenance.method !== "hunyuan-dit-reference-plus-official-hunyuan3d-paint"
        || provenance.provider?.id !== "hunyuan3d-2") throw new Error("Texture revision is not authoritative Hunyuan Paint output.");
      if (!revision.providerVerification) throw new Error("Texture revision is missing deep Hunyuan provider verification.");
      assertDeepProviderVerification(revision.providerVerification, provenance.provider?.sourceRevision, true);
      if (stableJson(provenance.providerVerification) !== stableJson(revision.providerVerification)) throw new Error("Texture provider verification differs from retained provenance.");
      requireSha256("Texture reference hash", revision.textureReferenceSha256);
      if (provenance.textureReference?.sha256 !== revision.textureReferenceSha256) throw new Error("Texture reference image is not bound to the Hunyuan Paint revision.");
      await readEvidenceBytes(root, provenance.textureReference.path, revision.textureReferenceSha256, "Hunyuan texture reference", 32 * 1024 ** 2, resolveEvidencePath);
      if (output.inspection.textures < 1) throw new Error("Hunyuan Paint revision contains no embedded texture.");
      if (previousInspection.textures > 0 && previousInspection.textureFingerprint === output.inspection.textureFingerprint) throw new Error("Hunyuan Paint revision did not change the retained texture/material fingerprint.");
      sawTexture = true;
      textureRevisions += 1;
      approvalStage = "texture";
    } else {
      if (!sawTexture) throw new Error("Animation cannot precede Hunyuan Paint in a complete workflow lineage.");
      const cpuMethods = new Set([
        "generic-prompted-motion-graph",
        "deterministic-cpu-skeletal-motion",
        "local-animation-library-retarget",
        "deterministic-morph-deformation",
        "rigid-object-motion",
      ]);
      const legacyMotion = revision.provider === "grudge-motion-graph-1"
        && cpuMethods.has(String(provenance.method ?? ""))
        && (provenance.provider === "grudge-motion-graph-1" || provenance.provider?.id === "grudge-motion-graph-1");
      const hyMotion = revision.provider === "hy-motion-1.0-lite"
        && provenance.method === "official-hy-motion-1.0-lite-plus-local-mixamo25-skin"
        && provenance.provider?.id === "hy-motion-1";
      if (!legacyMotion && !hyMotion) {
        throw new Error("Animation revision is not an authoritative retained motion output.");
      }
      if (hyMotion) {
        if (!revision.providerVerification) throw new Error("HY-Motion revision is missing deep provider verification.");
        assertDeepProviderVerification(revision.providerVerification, provenance.provider?.sourceRevision, true, "hy-motion-1");
        if (stableJson(provenance.providerVerification) !== stableJson(revision.providerVerification)) throw new Error("HY-Motion provider verification differs from retained provenance.");
        requireSha256("HY-Motion skeletal-data hash", revision.motionDataSha256);
        if (revision.motionDataSha256 !== provenance.motionData?.sha256 || provenance.motionData?.upstreamPreviewGeometryRetained !== false) throw new Error("HY-Motion lineage does not bind its generated skeletal data.");
        await readEvidenceBytes(root, provenance.motionData.path, revision.motionDataSha256, "HY-Motion skeletal data", 32 * 1024 ** 2, resolveEvidencePath);
        if (output.inspection.skins < 1 || output.inspection.joints < 22 || output.inspection.skinnedMeshNodes < 1 || output.inspection.boneRotationChannels < 22) {
          throw new Error("HY-Motion revision lacks a complete local skin or generated bone channels.");
        }
      } else {
        if (provenance.gpuRequired === true) throw new Error("The deterministic CPU animation route cannot claim a GPU dependency.");
        if (revision.animationRoute !== provenance.animationRoute) throw new Error("CPU animation route differs from retained provenance.");
        const skeletalCpu = revision.animationRoute === "existing-rig"
          || revision.animationRoute === "deterministic-cpu-rig"
          || revision.animationRoute === "local-animation-library";
        if (skeletalCpu) {
          const rig = revision.rigPreparation;
          if (!rig || stableJson(provenance.rigPreparation) !== stableJson(rig)
            || rig.sourceSha256 !== revision.sourceSha256 || rig.parentRevisionSha256 !== revision.sourceSha256) {
            throw new Error("CPU skeletal lineage does not bind its exact painted parent and rig preparation.");
          }
          requireSha256("Prepared rig output hash", rig.outputSha256);
          const rigOutput = await inspectLineageOutput(root, rig.outputPath, "prepared CPU rig", resolveEvidencePath);
          if (rigOutput.inspection.sha256 !== rig.outputSha256
            || rigOutput.inspection.geometryHash !== rootLineage.geometryHash
            || rigOutput.inspection.textureFingerprint !== revision.sourceTextureFingerprint
            || rigOutput.inspection.skins < 1 || rigOutput.inspection.joints < 22 || rigOutput.inspection.skinnedMeshNodes < 1) {
            throw new Error("Prepared CPU rig no longer matches its exact geometry, textures or complete skin contract.");
          }
          if (output.inspection.skins < 1 || output.inspection.joints < 22 || output.inspection.skinnedMeshNodes < 1 || output.inspection.boneRotationChannels < 22) {
            throw new Error("CPU skeletal revision lacks a complete local skin or deterministic bone channels.");
          }
        }
        if (revision.animationRoute === "deterministic-morph-deformation"
          && (output.inspection.morphTargets < 1 || Number(provenance.validation?.motion?.effectiveDeformationTargets ?? 0) < 1)) {
          throw new Error("Non-humanoid animation lineage lacks measurable morph/deformation motion.");
        }
      }
      requireSha256("Animation fingerprint", revision.animationFingerprint);
      requireSha256("Animation plan hash", revision.animationPlanSha256);
      if (revision.animationFingerprint !== output.inspection.animationFingerprint
        || provenance.output?.animationFingerprint !== revision.animationFingerprint
        || stableWorkflowSha256(provenance.plan) !== revision.animationPlanSha256
        || !Array.isArray(revision.clipIds) || revision.clipIds.length < 1
        || stableJson([...revision.clipIds].sort()) !== stableJson(output.inspection.clipIds)
        || stableJson([...(provenance.output?.clipIds ?? [])].sort()) !== stableJson(output.inspection.clipIds)) throw new Error("Animation lineage does not bind the actual prompted plan and clips.");
      if (revision.sourceTextureFingerprint !== revision.outputTextureFingerprint) throw new Error("Animation revision changed the retained Hunyuan Paint texture bindings.");
      sawAnimation = true;
      animationRevisions += 1;
      approvalStage = "animation";
    }

    const approvalRecord = await readEvidenceJson(root, revision.visualApprovalPath, revision.visualApprovalSha256, `${revision.operation} visual approval`, resolveEvidencePath);
    if (stableJson(approvalRecord) !== stableJson(revision.visualApproval)) throw new Error("Revision visual approval record differs from lineage.");
    assertApprovalEvidence(revision.visualApproval, {
      stage: approvalStage,
      assetId: lineage.assetId,
      jobId: revision.jobId,
      assetPath: output.path,
      assetSha256: revision.outputSha256,
      geometryHash: revision.geometryHash,
      promptSha256: revision.promptSha256,
      specFingerprint: revision.specFingerprint,
      textureFingerprint: approvalStage === "texture" ? output.inspection.textureFingerprint : undefined,
      animationFingerprint: approvalStage === "animation" ? output.inspection.animationFingerprint : undefined,
      animations: approvalStage === "animation" ? output.inspection.animations : undefined,
    });
    previousJobId = revision.jobId;
    previousSha256 = revision.outputSha256;
    previousProvenanceSha256 = revision.provenanceSha256;
    previousInspection = output.inspection;
  }

  const finalRevision = lineage.revisions.at(-1)!;
  if (textureRevisions < PROMPT3D_MIN_WORKFLOW_TEXTURE_REVISIONS
    || animationRevisions < PROMPT3D_MIN_WORKFLOW_ANIMATION_REVISIONS
    || finalRevision.operation !== "animation") {
    throw new Error(`Saveable workflow lineage must contain at least ${PROMPT3D_MIN_WORKFLOW_TEXTURE_REVISIONS} approved prompted Hunyuan Paint revision followed by at least ${PROMPT3D_MIN_WORKFLOW_ANIMATION_REVISIONS} approved prompted animation revisions.`);
  }
  if (lineage.finalJobId !== finalRevision.jobId
    || lineage.finalSha256 !== finalRevision.outputSha256
    || lineage.finalGeometryHash !== rootLineage.geometryHash) throw new Error("Workflow lineage final identity is inconsistent.");

  if (finalJob) {
    if (finalJob.state !== "complete" || finalJob.operation !== "animation" || !["grudge-motion-graph-1", "hy-motion-1.0-lite"].includes(finalJob.provider)) throw new Error("Only a completed final animation revision can be saved.");
    if (finalJob.id !== finalRevision.jobId || finalJob.assetId !== lineage.assetId || finalJob.sha256 !== finalRevision.outputSha256 || finalJob.geometryHash !== finalRevision.geometryHash) {
      throw new Error("Final workflow job does not match its retained lineage.");
    }
    if (finalJob.source.kind !== "finish" || finalJob.source.jobId !== finalRevision.sourceJobId || finalJob.sourceSha256 !== finalRevision.sourceSha256 || finalJob.sourceGeometryHash !== finalRevision.sourceGeometryHash) {
      throw new Error("Final workflow job source does not match its retained lineage.");
    }
    if (!finalJob.validation || !finalJob.technicalValidation?.gameReady) throw new Error("Final workflow job lacks completed deterministic validation.");
    if (stableJson(finalJob.visualApproval) !== stableJson(finalRevision.visualApproval)
      || finalJob.visualApprovalPath !== finalRevision.visualApprovalPath
      || finalJob.visualApprovalSha256 !== finalRevision.visualApprovalSha256) throw new Error("Final workflow job lacks the exact retained visual approval.");
  }

  return {
    lineageSha256: lineage.chainSha256,
    rootInspection: rootOutput.inspection,
    finalInspection: previousInspection,
    finalVisualApprovalSha256: finalRevision.visualApprovalSha256,
    textureRevisions,
    animationRevisions,
  };
}

/**
 * Admit a user-authored texture request without judging its artistic quality or
 * whether Hunyuan Paint will reproduce it well. Only malformed input is refused
 * here; capability, integrity and output checks remain part of the actual run.
 */
export function normalizeTextureInstruction(instruction: string): string {
  const bounded = instruction.trim().replace(/\s+/g, " ");
  if (!bounded || bounded.length > 2_000) throw new Error("Enter a texture instruction of 1–2,000 characters.");
  return bounded;
}

export function compileTextureReferencePrompt(spec: AssetSpecV1, instruction: string): string {
  const bounded = normalizeTextureInstruction(instruction);
  const identity = spec.prompt.trim().replace(/\s+/g, " ").split(" ").slice(0, 28).join(" ");
  return fitHunyuanClipBudget([
    { text: `Material ${bounded}`, minimumWords: 6, trimRank: 2 },
    { text: `Subject ${identity}`, minimumWords: 3, trimRank: 4 },
    { text: `${spec.style.replaceAll("-", " ")} game material`, minimumWords: 2, trimRank: 3 },
    // Keep the positive prompt affirmative. Some image models emphasize the
    // noun in a negated phrase, so exclusions stay in the negative prompt.
    { text: "One complete isolated subject centered with full silhouette visible on a plain white background under even neutral light", minimumWords: 15 },
  ]);
}

const libraryModels = (root: string) => containedWorkflowPath(root, join(root, "saved-assets", "models"));
const libraryCatalog = (root: string) => containedWorkflowPath(root, join(root, "saved-assets", "workflow-catalog"));
const safeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 54) || "hunyuan-asset";

export async function workflowLibrary(root: string): Promise<Prompt3DWorkflowLibraryAsset[]> {
  const configuredCatalog = libraryCatalog(root);
  if (!existsSync(configuredCatalog)) return [];
  let catalog: string;
  try {
    catalog = await assertSafeExistingPath(root, configuredCatalog, "directory");
  } catch {
    return [];
  }
  const result: Prompt3DWorkflowLibraryAsset[] = [];
  for (const entry of await readdir(catalog, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) continue;
    try {
      const recordPath = await assertSafeExistingPath(root, containedWorkflowPath(root, join(catalog, entry.name)), "file");
      const record = await readBundleJson(recordPath, MAX_EVIDENCE_BYTES) as unknown as Prompt3DWorkflowLibraryAsset;
      const savedPath = await assertSafeExistingPath(root, record.savedPath, "file");
      const inspection = await inspectWorkflowGlb(savedPath);
      if (record.version !== 1 || record.method !== "hunyuan3d-workflow" || record.provider !== "hunyuan3d-2"
        || record.id !== entry.name.slice(0, -5)
        || inspection.sha256 !== record.sha256 || inspection.geometryHash !== record.geometryHash
        || inspection.byteSize !== record.byteSize || inspection.textures !== record.textures
        || inspection.animations.length !== record.animations || !inspection.textures || !inspection.animations.length) continue;
      const bundle = await verifyPrompt3DWorkflowEvidenceBundle(
        root,
        record.evidenceBundleManifestPath,
        record.evidenceBundleManifestSha256,
        { bundleId: record.id, assetId: record.assetId, sourceJobId: record.sourceJobId, lineageSha256: record.lineageSha256 },
      );
      if (pathIdentity(record.lineagePath) !== pathIdentity(bundle.lineagePath)) continue;
      const lineageRecord = bundle.lineage;
      const validation = await validatePrompt3DWorkflowLineage(root, lineageRecord, undefined, bundle.resolveSourcePath);
      if (lineageRecord.generationChain[0]?.jobId !== record.rootGenerationJobId
        || lineageRecord.finalJobId !== record.sourceJobId
        || lineageRecord.finalSha256 !== record.sha256
        || validation.finalVisualApprovalSha256 !== record.finalVisualApprovalSha256) continue;
      result.push(record);
    } catch {
      // Preserve invalid records, but never expose them as usable assets.
    }
  }
  return result.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function saveWorkflowAsset(root: string, job: Prompt3DFinishJobStatus): Promise<Prompt3DWorkflowSaveResult> {
  if (job.state !== "complete" || !job.assetPath || !job.sha256 || !job.geometryHash || !job.validation) throw new Error("Only a completed, validated workflow revision can be saved.");
  if (!job.lineage || !job.lineagePath || !job.lineageSha256) throw new Error("Only a retained, hash-bound complete workflow lineage can be saved.");
  if (!Array.isArray(job.lineage.generationChain) || job.lineage.generationChain.length < 1) {
    throw new Error("Complete workflow lineage requires at least one approved Hunyuan generation.");
  }
  prompt3DWorkflowUsesExistingGeneratedModel(job.lineage);
  const models = await ensureSafeDirectory(root, libraryModels(root));
  const catalog = await ensureSafeDirectory(root, libraryCatalog(root));
  const name = `${safeName(job.baseSpec.prompt)}-${job.assetId.slice(0, 8)}-${job.id.slice(0, 8)}.glb`;
  const savedPath = containedWorkflowPath(root, join(models, name));
  const manifestPath = containedWorkflowPath(root, join(catalog, `${job.id}.json`));
  if (existsSync(manifestPath)) {
    const existing = await readBundleJson(await assertSafeExistingPath(root, manifestPath, "file"), MAX_EVIDENCE_BYTES) as unknown as Prompt3DWorkflowLibraryAsset;
    const existingSavedPath = await assertSafeExistingPath(root, existing.savedPath, "file");
    const existingInspection = await inspectWorkflowGlb(existingSavedPath);
    const bundle = await verifyPrompt3DWorkflowEvidenceBundle(
      root,
      existing.evidenceBundleManifestPath,
      existing.evidenceBundleManifestSha256,
      { bundleId: job.id, assetId: job.assetId, sourceJobId: job.id, lineageSha256: job.lineageSha256 },
    );
    const existingLineage = bundle.lineage;
    const existingLineageValidation = await validatePrompt3DWorkflowLineage(root, existingLineage, job, bundle.resolveSourcePath);
    if (existing.version !== 1 || existing.id !== job.id || existing.assetId !== job.assetId || existing.sourceJobId !== job.id
      || existing.method !== "hunyuan3d-workflow" || existing.provider !== "hunyuan3d-2"
      || existing.sha256 !== job.sha256 || existing.geometryHash !== job.geometryHash
      || existing.byteSize !== existingInspection.byteSize || existing.textures !== existingInspection.textures
      || existing.animations !== existingInspection.animations.length || !existingInspection.textures || !existingInspection.animations.length
      || existingInspection.sha256 !== job.sha256 || existingInspection.geometryHash !== job.geometryHash
      || resolve(existing.savedPath) !== resolve(savedPath)
      || existing.lineageSha256 !== job.lineageSha256 || pathIdentity(existing.lineagePath) !== pathIdentity(bundle.lineagePath)
      || stableJson(existingLineage) !== stableJson(job.lineage)
      || existing.rootGenerationJobId !== existingLineage.generationChain[0]?.jobId
      || existing.finalVisualApprovalSha256 !== existingLineageValidation.finalVisualApprovalSha256) throw new Error("Saved workflow record conflicts with this immutable revision.");
    return { asset: existing, alreadySaved: true, localAssetsRoot: models };
  }

  const bundle = await retainPrompt3DWorkflowEvidenceBundle(root, job);
  const retainedLineage = bundle.lineage;
  const lineageValidation = await validatePrompt3DWorkflowLineage(root, retainedLineage, job, bundle.resolveSourcePath);
  const source = await assertSafeExistingPath(root, job.assetPath, "file");
  const inspection = await inspectWorkflowGlb(source);
  if (inspection.sha256 !== job.sha256 || inspection.geometryHash !== job.geometryHash
    || inspection.sha256 !== retainedLineage.finalSha256
    || inspection.geometryHash !== retainedLineage.finalGeometryHash) throw new Error("Workflow output no longer matches its retained identity and lineage.");
  if (!inspection.textures || !inspection.animations.length) throw new Error("Saved workflow output must contain embedded Hunyuan Paint textures and prompted animation.");
  if (!existsSync(savedPath)) await copyFile(source, savedPath, constants.COPYFILE_EXCL);
  const saved = await inspectWorkflowGlb(savedPath);
  if (saved.sha256 !== job.sha256) throw new Error("Managed asset-library copy failed hash verification.");
  const record: Prompt3DWorkflowLibraryAsset = {
    version: 1, id: job.id, assetId: job.assetId, sourceJobId: job.id, name, savedPath,
    savedAt: new Date().toISOString(), byteSize: (await stat(savedPath)).size, sha256: saved.sha256,
    geometryHash: saved.geometryHash, prompt: job.baseSpec.prompt, category: job.baseSpec.category,
    style: job.baseSpec.style, method: "hunyuan3d-workflow", provider: "hunyuan3d-2",
    textures: saved.textures, animations: saved.animations.length,
    rootGenerationJobId: retainedLineage.generationChain[0].jobId,
    lineagePath: bundle.lineagePath,
    lineageSha256: job.lineageSha256,
    evidenceBundleManifestPath: bundle.manifestPath,
    evidenceBundleManifestSha256: bundle.manifestSha256,
    finalVisualApprovalSha256: lineageValidation.finalVisualApprovalSha256,
  };
  await writeFile(manifestPath, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  return { asset: record, alreadySaved: false, localAssetsRoot: models };
}

export function workflowFilename(path: string): string {
  const ext = extname(path).toLowerCase();
  return `${safeName(basename(path, ext)) || "hunyuan-asset"}${ext === ".glb" ? ext : ".glb"}`;
}
