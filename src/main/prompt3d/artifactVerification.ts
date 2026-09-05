import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, opendir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import type {
  Prompt3DFinishJobStatus,
  Prompt3DWorkflowArtifactRequest,
  Prompt3DWorkflowArtifactVerification,
  Prompt3DWorkflowExportReceipt,
  Prompt3DWorkflowExportResult,
  Prompt3DWorkflowLibraryAsset,
  Prompt3DWorkflowLineage,
  Prompt3DWorkflowPortableExportRecord,
} from "../../shared/prompt3dWorkflow";
import {
  assertPrompt3DWorkflowLineageSeal,
  containedWorkflowPath,
  inspectWorkflowGlb,
  retainPrompt3DWorkflowEvidenceBundle,
  stableWorkflowSha256,
  type Prompt3DWorkflowEvidencePathResolver,
  validatePrompt3DWorkflowLineage,
  verifyPrompt3DWorkflowEvidenceBundle,
} from "./workflow";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_GLB_BYTES = 1024 ** 3;
const MAX_LINEAGE_BYTES = 2 * 1024 ** 2;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_RECORDS = 512;
const MAX_RECORD_SCAN = 2_048;
const MAX_ANIMATIONS = 128;

type Inspection = Awaited<ReturnType<typeof inspectWorkflowGlb>>;
type UnsignedExportRecord = Omit<Prompt3DWorkflowPortableExportRecord, "recordSha256">;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireUuid(label: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`${label} is invalid.`);
}

function requireSha256(label: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} is invalid.`);
}

function requireDate(label: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid.`);
}

function requirePositiveInteger(label: string, value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} is invalid.`);
}

function requireAnimations(value: unknown): asserts value is Prompt3DWorkflowPortableExportRecord["animations"] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ANIMATIONS) throw new Error("Portable export animation metadata is invalid.");
  for (const animation of value) {
    if (!animation || typeof animation.name !== "string" || animation.name.length < 1 || animation.name.length > 255
      || !Number.isFinite(animation.duration) || animation.duration <= 0
      || !Number.isSafeInteger(animation.channels) || animation.channels < 1) {
      throw new Error("Portable export animation metadata is invalid.");
    }
  }
}

function unsignedRecord(record: Prompt3DWorkflowPortableExportRecord): UnsignedExportRecord {
  const { recordSha256: _recordSha256, ...unsigned } = record;
  return unsigned;
}

function assertExportRecord(record: unknown, expectedId?: string): asserts record is Prompt3DWorkflowPortableExportRecord {
  if (!record || typeof record !== "object") throw new Error("Portable export record is invalid.");
  const value = record as Prompt3DWorkflowPortableExportRecord;
  if (value.version !== 1) throw new Error("Portable export record version is invalid.");
  requireUuid("Portable export record ID", value.id);
  if (expectedId && value.id !== expectedId) throw new Error("Portable export record ID does not match its retained file.");
  if (value.source?.kind !== "finish" || value.source.jobId !== value.sourceJobId) throw new Error("Portable export source binding is invalid.");
  requireUuid("Portable export source job ID", value.sourceJobId);
  requireUuid("Portable export asset ID", value.assetId);
  requireUuid("Portable export root generation job ID", value.rootGenerationJobId);
  requireDate("Portable export time", value.exportedAt);
  if (typeof value.destinationPath !== "string" || value.destinationPath.length < 1 || value.destinationPath.length > 32_767
    || !isAbsolute(value.destinationPath) || resolve(value.destinationPath) !== value.destinationPath
    || extname(value.destinationPath).toLowerCase() !== ".glb") throw new Error("Portable export destination is invalid.");
  if (typeof value.filename !== "string" || value.filename.length < 1 || value.filename.length > 255) throw new Error("Portable export filename is invalid.");
  requirePositiveInteger("Portable export byte size", value.byteSize);
  if (value.byteSize > MAX_GLB_BYTES) throw new Error("Portable export exceeds the 1 GiB verification limit.");
  requireSha256("Portable export SHA-256", value.sha256);
  requireSha256("Portable export geometry hash", value.geometryHash);
  requirePositiveInteger("Portable export texture count", value.textures);
  requireSha256("Portable export texture fingerprint", value.textureFingerprint);
  requireAnimations(value.animations);
  requireSha256("Portable export animation fingerprint", value.animationFingerprint);
  if (typeof value.lineagePath !== "string" || !isAbsolute(value.lineagePath)) throw new Error("Portable export lineage path is invalid.");
  requireSha256("Portable export lineage SHA-256", value.lineageSha256);
  if (typeof value.evidenceBundleManifestPath !== "string" || !isAbsolute(value.evidenceBundleManifestPath)) {
    throw new Error("Portable export evidence-bundle manifest path is invalid.");
  }
  requireSha256("Portable export evidence-bundle manifest SHA-256", value.evidenceBundleManifestSha256);
  requireSha256("Portable export visual-approval SHA-256", value.finalVisualApprovalSha256);
  requireSha256("Portable export record seal", value.recordSha256);
  if (stableWorkflowSha256(unsignedRecord(value)) !== value.recordSha256) throw new Error("Portable export record seal is invalid.");
}

function recordDirectory(root: string): string {
  return containedWorkflowPath(root, join(root, "workflow-exports", "individual"));
}

async function realContainedWorkflowPath(root: string, target: string): Promise<string> {
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(containedWorkflowPath(root, target))]);
  return containedWorkflowPath(realRoot, realTarget);
}

async function ensureRecordDirectory(root: string): Promise<string> {
  const directory = recordDirectory(root);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const safeDirectory = await realContainedWorkflowPath(root, directory);
  const info = await lstat(safeDirectory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Portable export metadata location is not a regular directory.");
  return safeDirectory;
}

async function inspectBoundedGlb(path: string): Promise<Inspection> {
  const resolved = resolve(path);
  if (extname(resolved).toLowerCase() !== ".glb") throw new Error("Reopened workflow artifact must be a GLB file.");
  const before = await lstat(resolved);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 20 || before.size > MAX_GLB_BYTES) {
    throw new Error("Reopened workflow artifact is not a regular GLB within the 1 GiB verification limit.");
  }
  const inspection = await inspectWorkflowGlb(resolved);
  const after = await lstat(resolved);
  if (!after.isFile() || after.isSymbolicLink() || after.size !== before.size || after.mtimeMs !== before.mtimeMs
    || inspection.byteSize !== after.size) throw new Error("Workflow artifact changed while it was being verified.");
  return inspection;
}

async function verifyLineage(
  root: string,
  lineagePath: string,
  expectedSha256: string,
  expected: { assetId: string; finalJobId: string; finalSha256: string; finalGeometryHash: string; finalVisualApprovalSha256: string },
  finalJob?: Prompt3DFinishJobStatus,
  resolveEvidencePath?: Prompt3DWorkflowEvidencePathResolver,
): Promise<string> {
  const retainedPath = containedWorkflowPath(root, lineagePath);
  const path = await realContainedWorkflowPath(root, retainedPath);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 2 || info.size > MAX_LINEAGE_BYTES) throw new Error("Retained workflow lineage is missing or outside its safe size limit.");
  const bytes = await readFile(path);
  if (sha256(bytes) !== expectedSha256) throw new Error("Retained workflow lineage failed hash verification.");
  const lineage = JSON.parse(bytes.toString("utf8")) as Prompt3DWorkflowLineage;
  assertPrompt3DWorkflowLineageSeal(lineage);
  const authoritative = await validatePrompt3DWorkflowLineage(root, lineage, finalJob, resolveEvidencePath);
  const finalRevision = lineage.revisions.at(-1);
  if (lineage.assetId !== expected.assetId || lineage.finalJobId !== expected.finalJobId
    || lineage.finalSha256 !== expected.finalSha256 || lineage.finalGeometryHash !== expected.finalGeometryHash
    || finalRevision?.jobId !== expected.finalJobId
    || finalRevision.visualApprovalSha256 !== expected.finalVisualApprovalSha256
    || authoritative.finalVisualApprovalSha256 !== expected.finalVisualApprovalSha256
    || authoritative.finalInspection.sha256 !== expected.finalSha256
    || authoritative.finalInspection.geometryHash !== expected.finalGeometryHash) {
    throw new Error("Retained workflow lineage does not match the reopened artifact.");
  }
  return retainedPath;
}

function exactAnimations(a: Inspection["animations"], b: Inspection["animations"]): boolean {
  return stableWorkflowSha256(a) === stableWorkflowSha256(b);
}

function assertFinishedJob(job: Prompt3DFinishJobStatus, inspection: Inspection, receipt: Prompt3DWorkflowExportReceipt): void {
  if (job.state !== "complete" || job.stage !== "complete" || job.operation !== "animation" || !["grudge-motion-graph-1", "hy-motion-1.0-lite"].includes(job.provider)
    || !job.assetPath || !job.sha256 || !job.geometryHash || !job.validation
    || !job.lineagePath || !job.lineageSha256 || !job.visualApprovalSha256) {
    throw new Error("Only a completed, approved workflow revision can retain portable export metadata.");
  }
  if (job.lineage.finalJobId !== job.id || job.lineage.assetId !== job.assetId
    || job.lineage.finalSha256 !== job.sha256 || job.lineage.finalGeometryHash !== job.geometryHash) {
    throw new Error("Finished workflow lineage does not match its final job.");
  }
  if (receipt.sha256 !== inspection.sha256 || receipt.byteSize !== inspection.byteSize
    || job.sha256 !== inspection.sha256 || job.geometryHash !== inspection.geometryHash
    || job.validation.outputGeometryHash !== inspection.geometryHash
    || job.validation.embeddedTextures !== inspection.textures
    || job.validation.outputTextureFingerprint !== inspection.textureFingerprint
    || job.validation.outputAnimationFingerprint !== inspection.animationFingerprint
    || !exactAnimations(job.validation.animations, inspection.animations)
    || inspection.textures < 1 || inspection.animations.length < 1) {
    throw new Error("Portable export does not retain the finished geometry, textures and animations.");
  }
  if (["existing-rig", "deterministic-cpu-rig", "local-animation-library", "hy-motion-1.0-lite"].includes(job.animationRoute ?? "")
    && (inspection.skins < 1 || inspection.joints < 22 || inspection.skinnedMeshNodes < 1 || inspection.boneRotationChannels < 22)) {
    throw new Error("Portable skeletal export does not retain its complete local skin and generated bone channels.");
  }
}

async function readExportRecord(root: string, id: string): Promise<Prompt3DWorkflowPortableExportRecord> {
  requireUuid("Portable export record ID", id);
  const directory = await realContainedWorkflowPath(root, recordDirectory(root));
  const path = join(directory, `${id}.json`);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 2 || info.size > MAX_RECORD_BYTES) throw new Error("Portable export record is missing or outside its safe size limit.");
  const record = JSON.parse(await readFile(path, "utf8")) as unknown;
  assertExportRecord(record, id);
  return record;
}

export async function recordWorkflowExport(
  root: string,
  job: Prompt3DFinishJobStatus,
  receipt: Prompt3DWorkflowExportReceipt,
  exportedAt = new Date().toISOString(),
): Promise<Prompt3DWorkflowExportResult> {
  requireDate("Portable export time", exportedAt);
  if (typeof receipt.destinationPath !== "string" || !isAbsolute(receipt.destinationPath)) throw new Error("Portable export destination is invalid.");
  const destinationPath = resolve(receipt.destinationPath);
  const inspection = await inspectBoundedGlb(destinationPath);
  assertFinishedJob(job, inspection, receipt);
  const finalVisualApprovalSha256 = job.visualApprovalSha256!;
  const bundle = await retainPrompt3DWorkflowEvidenceBundle(root, job);
  const lineagePath = await verifyLineage(root, bundle.lineagePath, job.lineageSha256!, {
    assetId: job.assetId,
    finalJobId: job.id,
    finalSha256: inspection.sha256,
    finalGeometryHash: inspection.geometryHash,
    finalVisualApprovalSha256,
  }, job, bundle.resolveSourcePath);
  const unsigned: UnsignedExportRecord = {
    version: 1,
    id: randomUUID(),
    source: { kind: "finish", jobId: job.id },
    assetId: job.assetId,
    sourceJobId: job.id,
    rootGenerationJobId: job.lineage.generationChain[0].jobId,
    destinationPath,
    filename: receipt.filename || basename(destinationPath),
    exportedAt,
    byteSize: inspection.byteSize,
    sha256: inspection.sha256,
    geometryHash: inspection.geometryHash,
    textures: inspection.textures,
    textureFingerprint: inspection.textureFingerprint,
    animations: inspection.animations,
    animationFingerprint: inspection.animationFingerprint,
    lineagePath,
    lineageSha256: job.lineageSha256!,
    evidenceBundleManifestPath: bundle.manifestPath,
    evidenceBundleManifestSha256: bundle.manifestSha256,
    finalVisualApprovalSha256,
  };
  const record: Prompt3DWorkflowPortableExportRecord = { ...unsigned, recordSha256: stableWorkflowSha256(unsigned) };
  assertExportRecord(record);
  const directory = await ensureRecordDirectory(root);
  const path = join(directory, `${record.id}.json`);
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return {
    destinationPath: record.destinationPath,
    filename: record.filename,
    sha256: record.sha256,
    byteSize: record.byteSize,
    record,
  };
}

export async function workflowExportHistory(root: string): Promise<Prompt3DWorkflowPortableExportRecord[]> {
  let directory;
  try {
    directory = await realContainedWorkflowPath(root, recordDirectory(root));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  let handle;
  try {
    handle = await opendir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records: Prompt3DWorkflowPortableExportRecord[] = [];
  let scanned = 0;
  try {
    for await (const entry of handle) {
      if (++scanned > MAX_RECORD_SCAN) break;
      if (!entry.isFile() || entry.isSymbolicLink() || extname(entry.name).toLowerCase() !== ".json") continue;
      const id = entry.name.slice(0, -5);
      if (!UUID.test(id)) continue;
      try {
        const record = await readExportRecord(root, id);
        const bundle = await verifyPrompt3DWorkflowEvidenceBundle(
          root,
          record.evidenceBundleManifestPath,
          record.evidenceBundleManifestSha256,
          { bundleId: record.sourceJobId, assetId: record.assetId, sourceJobId: record.sourceJobId, lineageSha256: record.lineageSha256 },
        );
        if (resolve(record.lineagePath) !== resolve(bundle.lineagePath)) throw new Error("Portable export lineage is outside its sealed evidence bundle.");
        const validation = await validatePrompt3DWorkflowLineage(root, bundle.lineage, undefined, bundle.resolveSourcePath);
        if (bundle.lineage.generationChain[0]?.jobId !== record.rootGenerationJobId
          || bundle.lineage.finalJobId !== record.sourceJobId
          || bundle.lineage.finalSha256 !== record.sha256
          || bundle.lineage.finalGeometryHash !== record.geometryHash
          || validation.finalVisualApprovalSha256 !== record.finalVisualApprovalSha256) {
          throw new Error("Portable export record conflicts with its sealed evidence bundle.");
        }
        records.push(record);
      } catch {
        // Retain malformed or tampered records on disk, but never expose them as usable copies.
      }
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
  return records.sort((a, b) => b.exportedAt.localeCompare(a.exportedAt)).slice(0, MAX_RECORDS);
}

export async function verifyWorkflowArtifact(
  root: string,
  request: Prompt3DWorkflowArtifactRequest,
  managedAssets: Prompt3DWorkflowLibraryAsset[] = [],
  verifiedAt = new Date().toISOString(),
): Promise<Prompt3DWorkflowArtifactVerification> {
  requireDate("Artifact verification time", verifiedAt);
  requireUuid("Workflow artifact ID", request?.id);
  if (request.kind !== "managed" && request.kind !== "portable") throw new Error("Workflow artifact kind is invalid.");

  if (request.kind === "managed") {
    const asset = managedAssets.find((candidate) => candidate.id === request.id);
    if (!asset) throw new Error("Managed workflow artifact was not found in the validated library.");
    const path = await realContainedWorkflowPath(root, asset.savedPath);
    const inspection = await inspectBoundedGlb(path);
    if (inspection.sha256 !== asset.sha256 || inspection.byteSize !== asset.byteSize
      || inspection.geometryHash !== asset.geometryHash || inspection.textures !== asset.textures
      || inspection.animations.length !== asset.animations || inspection.textures < 1 || inspection.animations.length < 1) {
      throw new Error("Managed workflow copy no longer retains its saved geometry, textures and animations.");
    }
    const bundle = await verifyPrompt3DWorkflowEvidenceBundle(
      root,
      asset.evidenceBundleManifestPath,
      asset.evidenceBundleManifestSha256,
      { bundleId: asset.id, assetId: asset.assetId, sourceJobId: asset.sourceJobId, lineageSha256: asset.lineageSha256 },
    );
    if (resolve(asset.lineagePath) !== resolve(bundle.lineagePath)) throw new Error("Managed artifact lineage is outside its sealed evidence bundle.");
    const lineagePath = await verifyLineage(root, bundle.lineagePath, asset.lineageSha256, {
      assetId: asset.assetId,
      finalJobId: asset.sourceJobId,
      finalSha256: inspection.sha256,
      finalGeometryHash: inspection.geometryHash,
      finalVisualApprovalSha256: asset.finalVisualApprovalSha256,
    }, undefined, bundle.resolveSourcePath);
    return {
      version: 1, kind: "managed", id: asset.id, sourceJobId: asset.sourceJobId, assetId: asset.assetId,
      path, filename: asset.name, sha256: inspection.sha256, byteSize: inspection.byteSize,
      geometryHash: inspection.geometryHash, textures: inspection.textures, textureFingerprint: inspection.textureFingerprint,
      animations: inspection.animations, animationFingerprint: inspection.animationFingerprint,
      lineagePath, lineageSha256: asset.lineageSha256,
      evidenceBundleManifestPath: bundle.manifestPath, evidenceBundleManifestSha256: bundle.manifestSha256,
      finalVisualApprovalSha256: asset.finalVisualApprovalSha256,
      retainedGeometry: true, retainedTextures: true, retainedAnimations: true, verifiedAt,
    };
  }

  const record = await readExportRecord(root, request.id);
  const inspection = await inspectBoundedGlb(record.destinationPath);
  if (inspection.sha256 !== record.sha256 || inspection.byteSize !== record.byteSize
    || inspection.geometryHash !== record.geometryHash || inspection.textures !== record.textures
    || inspection.textureFingerprint !== record.textureFingerprint
    || inspection.animationFingerprint !== record.animationFingerprint
    || !exactAnimations(inspection.animations, record.animations)
    || inspection.textures < 1 || inspection.animations.length < 1) {
    throw new Error("Portable workflow copy no longer retains its exported geometry, textures and animations.");
  }
  const bundle = await verifyPrompt3DWorkflowEvidenceBundle(
    root,
    record.evidenceBundleManifestPath,
    record.evidenceBundleManifestSha256,
    { bundleId: record.sourceJobId, assetId: record.assetId, sourceJobId: record.sourceJobId, lineageSha256: record.lineageSha256 },
  );
  if (resolve(record.lineagePath) !== resolve(bundle.lineagePath)) throw new Error("Portable artifact lineage is outside its sealed evidence bundle.");
  const lineagePath = await verifyLineage(root, bundle.lineagePath, record.lineageSha256, {
    assetId: record.assetId,
    finalJobId: record.sourceJobId,
    finalSha256: inspection.sha256,
    finalGeometryHash: inspection.geometryHash,
    finalVisualApprovalSha256: record.finalVisualApprovalSha256,
  }, undefined, bundle.resolveSourcePath);
  return {
    version: 1, kind: "portable", id: record.id, sourceJobId: record.sourceJobId, assetId: record.assetId,
    path: record.destinationPath, filename: record.filename, sha256: inspection.sha256, byteSize: inspection.byteSize,
    geometryHash: inspection.geometryHash, textures: inspection.textures, textureFingerprint: inspection.textureFingerprint,
    animations: inspection.animations, animationFingerprint: inspection.animationFingerprint,
    lineagePath, lineageSha256: record.lineageSha256,
    evidenceBundleManifestPath: bundle.manifestPath, evidenceBundleManifestSha256: bundle.manifestSha256,
    finalVisualApprovalSha256: record.finalVisualApprovalSha256,
    retainedGeometry: true, retainedTextures: true, retainedAnimations: true, verifiedAt,
  };
}
