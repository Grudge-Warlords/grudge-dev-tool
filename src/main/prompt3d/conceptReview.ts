import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

export interface RetainedConceptTechnicalReport {
  version: 1;
  method: string;
  technicalStatus: "pass" | "needs-regeneration";
  semanticResemblanceChecked: false;
  visualReviewRequired: true;
  failureCode?: "background-isolation" | "foreground-missing" | "edge-clearance";
  providerSourcePath?: "concept-source.png";
  providerSourceSha256?: string;
  normalization?: {
    mode: "isolated-provider-pixels-centered";
    sourceForegroundBounds: [number, number, number, number];
    sourceMarginPixels: number;
    maximumCanvasFraction: 0.5;
    scale: number;
    offset: [number, number];
  };
  conditioningIsolation?: {
    method: "hunyuan-upstream-rembg-u2net";
    modelPath: "models/rembg/u2net.onnx";
    modelSha256: "8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491";
    providerSourceRevision: "82920d643c0dc2f7bfd7255f45f62d386edfe60c";
  };
  message?: string;
}


/** Check every ancestor as well as the file, so a junction cannot redirect reads. */
export async function readContainedFile(root: string, path: string, maxBytes: number): Promise<Buffer> {
  const rel = relative(resolve(root), resolve(path));
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Artifact is outside the creation root.");
  let current = resolve(root);
  for (const part of ["", ...rel.split(sep)]) {
    current = resolve(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error("Creation artifacts may not use links or junctions.");
  }
  const info = await lstat(path);
  if (!info.isFile() || info.size < 1 || info.size > maxBytes) throw new Error("Invalid creation artifact size.");
  const bytes = await readFile(path);
  if (bytes.length > maxBytes) throw new Error("Creation artifact exceeded its size limit.");
  return bytes;
}

/** Parse and hash the provider's bounded technical report without inferring semantic acceptance. */
export async function readConceptTechnicalReport(
  root: string,
  path: string,
  expectedStatus?: RetainedConceptTechnicalReport["technicalStatus"],
): Promise<{ report: RetainedConceptTechnicalReport; sha256: string }> {
  const bytes = await readContainedFile(root, path, 128 * 1024);
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("The deterministic concept review report is not valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The deterministic concept review report is invalid.");
  const report = value as Record<string, unknown>;
  const status = report.technicalStatus;
  if (report.version !== 1
    || typeof report.method !== "string" || !report.method.trim() || report.method.length > 100
    || (status !== "pass" && status !== "needs-regeneration")
    || report.semanticResemblanceChecked !== false
    || report.visualReviewRequired !== true
    || (expectedStatus && status !== expectedStatus)) {
    throw new Error("The deterministic concept review report is missing its fail-closed technical contract.");
  }
  const failureCode = report.failureCode;
  if (status === "needs-regeneration"
    && !["background-isolation", "foreground-missing", "edge-clearance"].includes(String(failureCode))) {
    throw new Error("A failed deterministic concept review must retain a technical failure code.");
  }
  if (status === "pass" && failureCode !== undefined) throw new Error("A passing deterministic concept review cannot retain a failure code.");
  if (report.message !== undefined && (typeof report.message !== "string" || report.message.length > 1_000)) {
    throw new Error("The deterministic concept review message is invalid.");
  }
  const providerSourceSha256 = report.providerSourceSha256;
  if ((report.providerSourcePath !== undefined || providerSourceSha256 !== undefined)
    && (report.providerSourcePath !== "concept-source.png"
      || typeof providerSourceSha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(providerSourceSha256))) {
    throw new Error("The deterministic concept review has invalid provider-source provenance.");
  }
  if (report.method === "border-connected-white-normalized" || report.method === "hunyuan-upstream-rembg-u2net-normalized") {
    const normalization = report.normalization as Record<string, unknown> | undefined;
    const bounds = normalization?.sourceForegroundBounds;
    const offset = normalization?.offset;
    if (report.providerSourcePath !== "concept-source.png"
      || typeof providerSourceSha256 !== "string"
      || !normalization
      || normalization.mode !== "isolated-provider-pixels-centered"
      || !Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isSafeInteger)
      || !Number.isSafeInteger(normalization.sourceMarginPixels) || Number(normalization.sourceMarginPixels) < 0
      || normalization.maximumCanvasFraction !== 0.5
      || typeof normalization.scale !== "number" || !Number.isFinite(normalization.scale) || normalization.scale <= 0 || normalization.scale > 1
      || !Array.isArray(offset) || offset.length !== 2 || !offset.every(Number.isSafeInteger)) {
      throw new Error("The normalized concept review is missing its deterministic conditioning record.");
    }
  }
  if (report.method === "hunyuan-upstream-rembg-u2net" || report.method === "hunyuan-upstream-rembg-u2net-normalized") {
    const isolation = report.conditioningIsolation as Record<string, unknown> | undefined;
    if (!isolation
      || isolation.method !== "hunyuan-upstream-rembg-u2net"
      || isolation.modelPath !== "models/rembg/u2net.onnx"
      || isolation.modelSha256 !== "8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491"
      || isolation.providerSourceRevision !== "82920d643c0dc2f7bfd7255f45f62d386edfe60c") {
      throw new Error("The Hunyuan-isolated concept review is missing its pinned upstream implementation and model identity.");
    }
  }
  return {
    report: report as unknown as RetainedConceptTechnicalReport,
    sha256: sha256(bytes),
  };
}
