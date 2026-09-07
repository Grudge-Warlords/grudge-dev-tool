import { existsSync, renameSync, writeFileSync } from "node:fs";
import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AssetSpecV1, Prompt3DJobStatus, Prompt3DValidationReport } from "../../shared/prompt3d";
import { conceptBindingMatchesSpec, retainedConceptWorkflowInput, stableJson, supportsConceptWorkflow } from "../../shared/conceptWorkflow";
import { assertConceptAttemptBinding, assertGeometryApproval, sha256Hex } from "./conceptApproval";
import { assertConceptInspectionRecord, hasStructuredConceptProtocol } from "./conceptInspection";
import { readConceptTechnicalReport, readContainedFile } from "./conceptReview";
import { inspectWorkflowGlb } from "./workflow";
import { verifyPrompt3DRetainedReferenceImage, verifyPrompt3DRetainedReferenceImages } from "./referenceImage";

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
        const inspection = await inspectWorkflowGlb(glbPath);
        const provenanceBytes = await readFile(provenancePath);
        variants.push({
          index,
          glbPath,
          provenancePath,
          report,
          sha256: inspection.sha256,
          geometryHash: inspection.geometryHash,
          byteSize: inspection.byteSize,
          validationReportSha256: sha256Hex(stableJson(report)),
          provenanceSha256: sha256Hex(provenanceBytes),
        });
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
        let workflowErrorCode = "CONCEPT_APPROVAL_MISMATCH";
        let workflowRetryable = false;
        if (job.spec.referenceImages || job.referenceImages) {
          try {
            if (!job.spec.referenceImages || !job.referenceImages) throw new Error("Saved multiview reference-image evidence is incomplete.");
            await verifyPrompt3DRetainedReferenceImages(job.outputDirectory, job.referenceImages, job.spec.referenceImages);
          } catch {
            continue;
          }
        } else if (job.spec.referenceImage || job.referenceImage) {
          try {
            if (!job.spec.referenceImage || !job.referenceImage) throw new Error("Saved reference-image evidence is incomplete.");
            await verifyPrompt3DRetainedReferenceImage(job.outputDirectory, job.referenceImage, job.spec.referenceImage);
          } catch (error) {
            workflowError = error instanceof Error ? error.message : String(error);
          }
        }
        const structured = hasStructuredConceptProtocol(job.conceptAttempt);
        if (!workflowError && !structured && job.state !== "complete") {
          workflowError = "This pending concept predates structured inspection and must be regenerated with a fresh seed.";
          workflowErrorCode = "CONCEPT_INSPECTION_UPGRADE_REQUIRED";
          workflowRetryable = true;
        }
        if (job.state === "awaiting-concept-approval") {
          if (!workflowError && (!job.conceptAttempt || !job.conceptImagePath || job.approvedConcept === true || job.conceptApproval || job.conceptInspection)) workflowError = "Saved pending concept state is inconsistent.";
          if (!workflowError && job.conceptAttempt) {
            try {
              const conceptSha256 = sha256Hex(await readFile(job.conceptImagePath!));
              const report = await readConceptTechnicalReport(root, job.conceptAttempt.technicalReview.reportPath, "pass");
              if (job.conceptAttempt.technicalReview.reportSha256 !== report.sha256
                || job.conceptAttempt.technicalReview.method !== report.report.method) throw new Error("Concept technical-review evidence changed.");
              assertConceptAttemptBinding(job.id, job.spec, job.conceptAttempt, conceptSha256);
            } catch (error) {
              workflowError = error instanceof Error ? error.message : String(error);
            }
          }
        } else if (structured && job.state === "failed" && job.error?.code === "CONCEPT_SEMANTIC_REJECTED") {
          try {
            if (!job.conceptAttempt || !job.conceptImagePath || job.conceptApproval || job.approvedConcept === true) throw new Error("Saved rejected concept state is inconsistent.");
            const conceptSha256 = sha256Hex(await readFile(job.conceptImagePath));
            assertConceptAttemptBinding(job.id, job.spec, job.conceptAttempt, conceptSha256);
          } catch (error) {
            workflowError = error instanceof Error ? error.message : String(error);
          }
          if (!workflowError && job.conceptAttempt) {
            try {
              const report = await readConceptTechnicalReport(root, job.conceptAttempt.technicalReview.reportPath, "pass");
              if (job.conceptAttempt.technicalReview.reportSha256 !== report.sha256
                || job.conceptAttempt.technicalReview.method !== report.report.method) throw new Error("Concept technical-review evidence changed.");
              if (!job.conceptInspection) throw new Error("Rejected structured concept inspection is missing.");
              const retainedInspection = JSON.parse((await readContainedFile(root, job.conceptInspection.path, 256 * 1024)).toString("utf8"));
              if (stableJson(retainedInspection) !== stableJson(job.conceptInspection.evidence)) throw new Error("Rejected structured concept inspection changed.");
              assertConceptInspectionRecord(job.spec, job.conceptAttempt, job.conceptInspection, "rejected");
              const decisions = (job.conceptDecisions ?? []).filter((decision) => decision.attemptId === job.conceptAttempt!.binding.attemptId && decision.kind === "rejected");
              if (decisions.length !== 1
                || decisions[0].inspectionSha256 !== job.conceptInspection.sha256
                || decisions[0].inspectionPath !== job.conceptInspection.path
                || decisions[0].rejectionClassification !== job.conceptInspection.evidence.rejection?.classification) {
                throw new Error("Rejected concept decision does not bind its exact classified inspection.");
              }
            } catch (error) {
              workflowError = error instanceof Error ? error.message : String(error);
            }
          }
        } else if (structured && job.state === "failed" && job.error?.code === "CONCEPT_QUALITY_REJECTED") {
          try {
            if (!job.conceptAttempt || !job.conceptImagePath || job.conceptInspection || job.conceptApproval || job.approvedConcept === true) throw new Error("Saved technically rejected concept state is inconsistent.");
            const conceptSha256 = sha256Hex(await readFile(job.conceptImagePath));
            const binding = job.conceptAttempt.binding;
            const retained = retainedConceptWorkflowInput(binding);
            if (binding.jobId !== job.id || binding.attemptId !== `${job.id}:concept:${job.conceptAttempt.attemptNumber}`
              || binding.conceptSha256 !== conceptSha256
              || binding.specFingerprint !== sha256Hex(binding.specCanonical)
              || !conceptBindingMatchesSpec(binding, job.spec)
              || !retained || stableJson(retained.promptPlan) !== stableJson(job.conceptAttempt.promptPlan)) {
              throw new Error("Technically rejected concept attempt binding changed.");
            }
            const report = await readConceptTechnicalReport(root, job.conceptAttempt.technicalReview.reportPath, "needs-regeneration");
            if (job.conceptAttempt.technicalReview.reportSha256 !== report.sha256
              || job.conceptAttempt.technicalReview.method !== report.report.method
              || job.conceptAttempt.technicalReview.failureCode !== report.report.failureCode
              || job.conceptAttempt.technicalReview.presentationContractSha256 !== sha256Hex(stableJson(job.conceptAttempt.promptPlan.presentationContract))) {
              throw new Error("Rejected concept technical-review evidence changed.");
            }
          } catch (error) {
            workflowError = error instanceof Error ? error.message : String(error);
          }
        } else if (job.approvedConcept === true || job.conceptApproval || job.variants.length > 0) {
          try {
            if (!job.conceptImagePath) throw new Error("Retained concept image is missing.");
            const conceptSha256 = sha256Hex(await readFile(job.conceptImagePath));
            if (structured && job.conceptAttempt) {
              const report = await readConceptTechnicalReport(root, job.conceptAttempt.technicalReview.reportPath, "pass");
              if (job.conceptAttempt.technicalReview.reportSha256 !== report.sha256
                || job.conceptAttempt.technicalReview.method !== report.report.method) throw new Error("Concept technical-review evidence changed.");
              if (!job.conceptInspection) throw new Error("Structured concept inspection is missing.");
              const retainedInspection = JSON.parse((await readContainedFile(root, job.conceptInspection.path, 256 * 1024)).toString("utf8"));
              if (stableJson(retainedInspection) !== stableJson(job.conceptInspection.evidence)) throw new Error("Structured concept inspection changed.");
              assertConceptInspectionRecord(job.spec, job.conceptAttempt, job.conceptInspection, "approved");
            }
            assertGeometryApproval(job.id, job.spec, job.conceptAttempt, job.conceptApproval, conceptSha256, job.conceptInspection);
            if (job.approvedConcept !== true) throw new Error("Approved concept flag is inconsistent.");
          } catch (error) {
            workflowError = error instanceof Error ? error.message : String(error);
          }
        }
        if (workflowError) {
          job.state = "failed";
          job.stage = "failed";
          job.message = `Saved concept approval failed closed: ${workflowError}`;
          job.error = { code: workflowErrorCode, message: job.message, retryable: workflowRetryable };
        }
      }
      if ((job.state === "running" || job.state === "queued") && job.error?.code !== "CONCEPT_INSPECTION_UPGRADE_REQUIRED") {
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
