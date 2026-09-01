import { existsSync, renameSync, writeFileSync } from "node:fs";
import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AssetSpecV1, Prompt3DJobStatus, Prompt3DValidationReport } from "../../shared/prompt3d";
import { supportsConceptWorkflow } from "../../shared/conceptWorkflow";
import { assertGeometryApproval, sha256Hex } from "./conceptApproval";

const JOB_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function inside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}

/** Each job keeps its own atomic snapshot, alongside its existing output. */
export function savePrompt3DJob(root: string, job: Prompt3DJobStatus): void {
  if (!JOB_ID.test(job.id) || resolve(job.outputDirectory) !== resolve(root, "jobs", job.id)) throw new Error("Invalid saved job directory.");
  const target = join(job.outputDirectory, "job-status.json");
  const { autosaveError: _error, ...snapshot } = job;
  writeFileSync(`${target}.tmp`, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(`${target}.tmp`, target);
}

/** Recover results made before job snapshots were added, without regenerating. */
async function readLegacyJob(root: string, id: string): Promise<Prompt3DJobStatus> {
  const outputDirectory = join(root, "jobs", id);
  const specPath = join(outputDirectory, "asset-spec.json");
  const spec = JSON.parse(await readFile(specPath, "utf8")) as AssetSpecV1;
  if (!Number.isInteger(spec.variants) || spec.variants < 1 || spec.variants > 4) throw new Error("Invalid variant count.");
  const info = await stat(specPath);
  const variants: Prompt3DJobStatus["variants"] = [];
  for (let index = 0; index < spec.variants; index++) {
    const directory = join(outputDirectory, `variant-${index + 1}`);
    const assetPath = join(directory, "asset.glb");
    const provenancePath = join(directory, "provenance.json");
    for (const reportPath of [join(directory, "asset.validation.json"), join(root, "quarantine", "asset.validation.json")]) {
      try {
        const report = JSON.parse(await readFile(reportPath, "utf8")) as Prompt3DValidationReport;
        const glbPath = report.quarantinedPath ?? assetPath;
        if (resolve(report.assetPath) !== resolve(assetPath) || !inside(root, glbPath) || !existsSync(glbPath) || !existsSync(provenancePath)) continue;
        variants.push({ index, glbPath, provenancePath, report });
        break;
      } catch { /* Variant did not finish validation. */ }
    }
  }
  const complete = variants.length === spec.variants && variants.every(v => v.report.gameReady);
  return {
    id, outputDirectory, spec, providerId: spec.providerId, variants,
    state: complete ? "complete" : "failed", stage: complete ? "complete" : "failed", progress: complete ? 100 : 0,
    message: complete ? "Previous result restored from saved output and validation reports." : "Previous attempt was incomplete; existing output files have been retained.",
    createdAt: info.birthtime.toISOString(), updatedAt: info.mtime.toISOString(),
    ...(complete ? {} : { error: { code: "INTERRUPTED", message: "Previous attempt did not finish successfully.", retryable: true } }),
  };
}

export async function readPrompt3DJobs(root: string): Promise<Prompt3DJobStatus[]> {
  const jobsRoot = join(root, "jobs");
  if (!existsSync(jobsRoot)) return [];
  const restored: Prompt3DJobStatus[] = [];
  for (const directory of await readdir(jobsRoot, { withFileTypes: true })) {
    if (!directory.isDirectory() || directory.isSymbolicLink() || !JOB_ID.test(directory.name)) continue;
    try {
      const file = join(jobsRoot, directory.name, "job-status.json");
      let job: Prompt3DJobStatus;
      if (existsSync(file)) {
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) continue;
        job = JSON.parse(await readFile(file, "utf8")) as Prompt3DJobStatus;
      } else job = await readLegacyJob(root, directory.name);
      if (job.id !== directory.name || resolve(job.outputDirectory) !== resolve(jobsRoot, directory.name)) continue;
      if (!["queued", "running", "awaiting-concept-approval", "complete", "cancelled", "failed"].includes(job.state) || !Number.isFinite(Date.parse(job.createdAt)) || !Number.isFinite(Date.parse(job.updatedAt))) continue;
      if (!Array.isArray(job.variants) || job.variants.length > 4 || typeof job.message !== "string") continue;
      if (job.conceptImagePath && (!inside(job.outputDirectory, job.conceptImagePath) || !existsSync(job.conceptImagePath))) delete job.conceptImagePath;
      if (!job.variants.every(v => Number.isInteger(v.index) && inside(root, v.glbPath) && inside(root, v.provenancePath) && v.report && Array.isArray(v.report.checks) && typeof v.report.gameReady === "boolean" && typeof v.report.deterministicId === "string")) continue;
      job.variants = job.variants.filter(v => existsSync(v.glbPath));
      if (supportsConceptWorkflow(job.spec)) {
        let workflowError = "";
        if (job.state === "awaiting-concept-approval") {
          if (!job.conceptAttempt || !job.conceptImagePath || job.approvedConcept === true || job.conceptApproval) workflowError = "Saved pending concept state is inconsistent.";
        } else if (job.approvedConcept === true || job.conceptApproval || job.variants.length > 0) {
          try {
            if (!job.conceptImagePath) throw new Error("Retained concept image is missing.");
            const conceptSha256 = sha256Hex(await readFile(job.conceptImagePath));
            assertGeometryApproval(job.id, job.spec, job.conceptAttempt, job.conceptApproval, conceptSha256);
            if (job.approvedConcept !== true) throw new Error("Approved concept flag is inconsistent.");
          } catch (error) {
            workflowError = error instanceof Error ? error.message : String(error);
          }
        }
        if (workflowError) {
          job.state = "failed";
          job.stage = "failed";
          job.message = `Saved concept approval failed closed: ${workflowError}`;
          job.error = { code: "CONCEPT_APPROVAL_MISMATCH", message: job.message, retryable: false };
        }
      }
      if (job.state === "running" || job.state === "queued") {
        job.state = "failed";
        job.stage = "failed";
        job.message = "The app closed before this generation finished. Saved output is retained; retry only when ready.";
        job.error = { code: "INTERRUPTED", message: job.message, retryable: true };
      }
      restored.push(job);
    } catch {
      // An incomplete/corrupt snapshot must not prevent other results loading.
    }
  }
  return restored;
}
