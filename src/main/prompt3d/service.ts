import { inspectRegionEditor, writeRegionEditorPreview } from "./deformationRegionEditor";
import type { DeformationEdit } from "../../shared/deformationRegions";
import { validateRegionDefinitions } from "../../shared/deformationRegionModel";
import { prompt3DSettingsError } from "../../shared/prompt3dInputValidation";
import { promptedMotionCapabilityError } from "../../shared/promptedMotionIntent";
import { EventEmitter } from "node:events";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { constants, existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  AssetSpecV1,
  LocalPrompt3DProviderId,
  Prompt3DApproveConceptRequest,
  Prompt3DConceptAttempt,
  Prompt3DConceptInspectionRecord,
  Prompt3DGeometryRejection,
  Prompt3DInstallRequest,
  Prompt3DJobStatus,
  Prompt3DHistory,
  Prompt3DOverview,
  Prompt3DPlanRequest,
  Prompt3DPlanResult,
  Prompt3DProviderVerification,
  Prompt3DRejectConceptRequest,
  Prompt3DReferenceImageSelection,
  Prompt3DSelectedExecutionProfile,
  Prompt3DStartRequest,
} from "../../shared/prompt3d";
import type {
  Prompt3DAssetSource,
  Prompt3DApproveVisualRequest,
  Prompt3DAnimationOverrides,
  Prompt3DBatchAcceptanceBaselineEvidence,
  Prompt3DBatchAcceptanceEvidence,
  Prompt3DBatchAcceptanceFinishEvidence,
  Prompt3DBatchAcceptanceGenerationEvidence,
  Prompt3DBatchExportResult,
  Prompt3DBatchItemStatus,
  Prompt3DBatchRequest,
  Prompt3DBatchRuntimeItem,
  Prompt3DBatchStatus,
  Prompt3DExistingGeometryDecision,
  Prompt3DFinishHistory,
  Prompt3DFinishJobStatus,
  Prompt3DFinishRequest,
  Prompt3DFinishVisualRejection,
  Prompt3DRejectFinishVisualRequest,
  Prompt3DVisualApproval,
  Prompt3DWorkflowArtifactVerification,
  Prompt3DWorkflowLineage,
  Prompt3DWorkflowRootLineage,
  Prompt3DWorkflowRevisionLineage,
  Prompt3DWorkflowSaveResult,
} from "../../shared/prompt3dWorkflow";
import { assertPrompt3DVisualInspectionEvidence } from "../../shared/prompt3dVisualInspection";
import {
  PROMPT3D_MIN_BATCH_FINISH_PROMPTS,
  PROMPT3D_MIN_WORKFLOW_ANIMATION_REVISIONS,
  PROMPT3D_MIN_WORKFLOW_TEXTURE_REVISIONS,
  PROMPT3D_STRICT_BATCH_ITEM_COUNT,
} from "../../shared/prompt3dWorkflow";
import { isPrompt3DTextureResolutionSupported, PROMPT3D_SPEC_VERSION } from "../../shared/prompt3d";
import { PROMPT3D_PROVIDERS, localProvider } from "./providers";
import { assertPrompt3DOutputSpace, evaluatePrompt3DCompliance, measurePrompt3DHardware, prompt3DGenerationOutputStage, requirePrompt3DOutputSpace } from "./hardware";
import { hunyuanExecutionSettings } from "./hunyuanProfiles";
import { Prompt3DInstaller } from "./installer";
import { postprocessPrompt3DGlb } from "./postprocess";
import { mergeHunyuanPaintResult } from "./hunyuanPaintMerge";
import { planPrompt3DAsset } from "./planner";
import { validatePrompt3DGlb } from "./validation";
import { readPrompt3DJobs, savePrompt3DJob } from "./history";
import { assertObjectRulesCompatibleWithPrompt, compilePrompt3DPrompt, validateObjectRules, withObjectRules } from "../../shared/prompt3dRules";
import { conceptReferenceImageBindings, conceptSpecCanonical, sanitizeAssetSpec, stableJson, supportsConceptWorkflow } from "../../shared/conceptWorkflow";
import {
  approvalProvenanceFields,
  assertConceptAttemptBinding,
  assertGeometryApproval,
  assertShapeRefinementConceptChain,
  createConceptApproval,
  createConceptBinding,
  inheritConceptHistory,
  nextConceptRetrySpec,
  sha256Hex,
} from "./conceptApproval";
import { assertConceptInspectionRecord, createConceptInspectionEvidence, hasStructuredConceptProtocol } from "./conceptInspection";
import { readConceptTechnicalReport, readContainedFile } from "./conceptReview";
import {
  compileTextureReferencePrompt,
  normalizeTextureInstruction,
  containedWorkflowPath,
  createPrompt3DExistingGeometryDecision,
  createPrompt3DFinishVisualRejection,
  createPrompt3DVisualApproval,
  assertFinishVisualRejectionMatches,
  assertPrompt3DWorkflowLineageSeal,
  assertVisualApprovalMatches,
  inspectWorkflowGlb,
  prompt3DWorkflowUsesExistingGeneratedModel,
  readWorkflowJobs,
  recordWorkflowJob,
  saveWorkflowAsset,
  validateFinishedAsset,
  sealPrompt3DWorkflowLineage,
  stableWorkflowSha256,
  workflowPromptSha256,
  workflowSpecFingerprint,
  workflowDirectory,
  workflowFilename,
  workflowLibrary as readWorkflowLibrary,
} from "./workflow";
import { bindHyMotionToGlb } from "./hyMotionRig";
import { analyzeHyMotionCompatibility } from "./hyMotionCompatibility";
import {
  classifyDeterministicRig,
  DeterministicRigReviewRequiredError,
  inspectDeterministicRig,
  prepareDeterministicRig,
} from "./deterministicRig";
import { applyLocalAnimationLibrary, authorDeterministicSkeletalAnimation } from "./deterministicSkeletalAnimation";
import { authorPromptedAnimation, scaledPromptedAnimationOverrides } from "./promptedAnimation";
import { listLocalAnimLibraries } from "../ingestion/retargetLibrary";
import {
  assertFreshPrompt3DBatchFinal,
  assertFreshPrompt3DBatchGeneration,
  createPrompt3DBatchAcceptanceReceipt,
  prompt3DBatchWorkflowIntentSha256,
  reserveFreshPrompt3DBatchSeed,
} from "./batchAcceptance";
import { recordWorkflowExport, verifyWorkflowArtifact } from "./artifactVerification";
import {
  assertPrompt3DReferenceImageSpec,
  assertPrompt3DReferenceImageSet,
  prompt3DReferenceImageMatches,
  prompt3DReferenceImageSetMatches,
  retainPrompt3DReferenceImage,
  retainPrompt3DReferenceImages,
  verifyPrompt3DRetainedReferenceImage,
  verifyPrompt3DRetainedReferenceImages,
} from "./referenceImage";

const MAX_JOBS = 1;
const MAX_PROMPT = 2_000;
const MAX_VARIANTS = 4;
const JOB_TIMEOUT_MS = 90 * 60_000;
const MAX_PROVIDER_OUTPUT_BYTES = 1 * 1024 ** 3;
const MAX_VARIANT_TREE_BYTES = 2 * 1024 ** 3;
const MAX_VARIANT_FILES = 100;
const BATCH_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SAFE_CHILD_ENV = new Set([
  "APPDATA", "COMSPEC", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "NUMBER_OF_PROCESSORS", "OS",
  "PATH", "PATHEXT", "PROCESSOR_ARCHITECTURE", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
  "PROGRAMW6432", "PUBLIC", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "WINDIR",
]);

function hyMotionIntentPlan(instruction: string, animation: Prompt3DAnimationOverrides | undefined, seed: number, executionProfile?: Prompt3DSelectedExecutionProfile) {
  return {
    version: 1,
    provider: "hy-motion-1.0-lite",
    instruction: instruction.trim().replace(/\s+/g, " "),
    seed,
    duration: animation?.duration ?? 4,
    cfgScale: 5,
    mode: animation?.mode ?? "replace",
    rig: "grudge-mixamo25-v2",
    ...(executionProfile ? { executionProfile: {
      id: executionProfile.id,
      label: executionProfile.label,
      device: executionProfile.device,
      validationSteps: executionProfile.validationSteps ?? null,
      gpuUuid: executionProfile.gpu?.uuid ?? null,
    } } : {}),
  };
}

function childEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (SAFE_CHILD_ENV.has(key.toUpperCase()) && value !== undefined) safe[key] = value;
  return { ...safe, ...extra };
}

function contained(root: string, target: string): string {
  const a = resolve(root), b = resolve(target), rel = relative(a, b);
  if (rel === "" || (!isAbsolute(rel) && !rel.startsWith(`..${sep}`) && rel !== "..")) return b;
  throw new Error("Path escapes Prompt-to-3D task root.");
}

async function measureTaskTree(root: string): Promise<{ files: number; bytes: number }> {
  const pending = [root];
  let files = 0, bytes = 0;
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Provider output may not contain symbolic links or junctions.");
      if (entry.isDirectory()) pending.push(child);
      else if (entry.isFile()) {
        files += 1;
        if (files > MAX_VARIANT_FILES) throw new Error(`Provider output exceeded the ${MAX_VARIANT_FILES}-file task limit.`);
        bytes += (await stat(child)).size;
        if (bytes > MAX_VARIANT_TREE_BYTES) throw new Error("Provider output exceeded the 2 GiB task limit.");
      }
    }
  }
  return { files, bytes };
}

function assertSpec(value: AssetSpecV1): AssetSpecV1 {
  if (!value || value.version !== PROMPT3D_SPEC_VERSION) throw new Error(`AssetSpec ${PROMPT3D_SPEC_VERSION} is required.`);
  const settingsError = prompt3DSettingsError(value);
  if (settingsError) throw new Error(settingsError);
  if (typeof value.prompt !== "string" || !value.prompt.trim() || value.prompt.length > MAX_PROMPT) throw new Error("Prompt must contain 1–2,000 characters.");
  if (!Number.isInteger(value.variants) || value.variants < 1 || value.variants > MAX_VARIANTS) throw new Error("Variants must be between 1 and 4.");
  if (!Number.isSafeInteger(value.seed) || value.seed < 0 || value.seed > 0x7fffffff) throw new Error("Seed must be an integer from 0 to 2,147,483,647.");
  if (value.scaleMode !== undefined && !["preserve", "exact"].includes(value.scaleMode)) throw new Error("Unknown scale mode.");
  if (value.orchestration !== undefined) {
    const orchestration = value.orchestration;
    if (orchestration.version !== 1 || !orchestration.automaticRecommendation || !orchestration.selectedRoute
      || !Array.isArray(orchestration.enabledStageIds) || orchestration.enabledStageIds.some((id) => typeof id !== "string" || !id)
      || orchestration.planner?.policy !== "grudge-local-schema-planning" || orchestration.planner.preferredModel !== "grudge-dev"
      || orchestration.planner.endpoint !== "loopback-ollama" || orchestration.planner.routeCompiler !== "deterministic-typed-compiler"
      || orchestration.planner.contacted !== false || orchestration.planner.fallback !== "none"
      || orchestration.externalProviderContact !== false) throw new Error("Prompt-to-3D orchestration metadata is invalid.");
  }
  if (!["prop", "building", "road-furniture", "environment", "character", "vehicle"].includes(value.category)) throw new Error("Unknown asset category.");
  if (!["realistic", "stylized", "low-poly", "hand-painted", "industrial", "custom"].includes(value.style)) throw new Error("Unknown asset style.");
  if (value.style === "custom" && (typeof value.customStyle !== "string" || !value.customStyle.trim() || value.customStyle.length > 200)) throw new Error("Custom style must contain 1–200 characters.");
  if (![value.dimensions.width, value.dimensions.height, value.dimensions.depth].every((n) => Number.isFinite(n) && n > 0 && n <= 10_000)) throw new Error("Dimensions are outside the allowed range.");
  if (!["m", "cm"].includes(value.dimensions.unit)) throw new Error("Dimensions must use metres or centimetres.");
  if (!Number.isInteger(value.budgets.maxTriangles) || value.budgets.maxTriangles < 100 || value.budgets.maxTriangles > 2_000_000) throw new Error("Triangle budget must be 100–2,000,000.");
  if (![512, 1024, 2048, 4096].includes(value.budgets.maxTextureResolution) || !Number.isSafeInteger(value.budgets.maxTextureBytes) || value.budgets.maxTextureBytes < 1 || value.budgets.maxTextureBytes > 512 * 1024 ** 2) throw new Error("Texture budget is outside the allowed range.");
  if (value.targetFormat !== "glb" || value.coordinateContract.upAxis !== "+Y" || value.coordinateContract.forwardAxis !== "+Z") throw new Error("Only the declared GLB +Y-up/+Z-forward contract is allowed.");
  validateObjectRules(value.objectRules);
  if (!["ground-center", "attachment-point"].includes(value.coordinateContract.origin) || (value.coordinateContract.origin === "attachment-point" && !value.objectRules) || value.coordinateContract.stableRootName !== "GrudgeAssetRoot") throw new Error("Use the canonical root and a typed ground or attachment origin.");
  const provider = PROMPT3D_PROVIDERS.find((candidate) => candidate.id === value.providerId);
  if (!provider || provider.role !== "geometry" || !provider.enabledRoutes.includes(value.route)) throw new Error("The selected provider route is not enabled by this build.");
  if (!isPrompt3DTextureResolutionSupported(value.providerId, value.budgets.maxTextureResolution)) {
    throw new Error(value.providerId === "hunyuan3d-2"
      ? "Hunyuan Paint texture resolution must be 1024 or 2048."
      : "Texture resolution is unsupported by the selected provider.");
  }
  if (value.category === "vehicle") throw new Error("Neural vehicle generation remains disabled until the owning wheel, topology and facing contracts are supplied.");
  if (value.category === "character" && value.providerId !== "hunyuan3d-2") throw new Error("Neural creature generation is currently enabled only for the explicit Hunyuan concept route and still requires prompted motion validation.");
  if (value.referenceImage !== undefined) {
    assertPrompt3DReferenceImageSpec(value.referenceImage);
    if (value.providerId !== "hunyuan3d-2" || value.route !== "concept-image-to-3d") {
      throw new Error("Local reference-image conditioning is available only through the Hunyuan concept workflow.");
    }
  }
  if (value.referenceImages !== undefined) {
    assertPrompt3DReferenceImageSet(value.referenceImages, value.referenceImage);
  }
  const references = specReferenceImages(value);
  if (references.length > 0) {
    const capability = provider.referenceImages;
    const views = references.map((reference, index) => reference.view ?? (index === 0 ? "front" : undefined));
    if (!capability || value.route !== capability.route) {
      throw new Error(`${provider.name} cannot consume every supplied reference image on the selected route. No image was discarded and no provider was substituted.`);
    }
    if (references.length < capability.minCount || references.length > capability.maxCount
      || views.some((view) => !view || !capability.supportedViews.includes(view))
      || capability.requiredViews.some((view) => !views.includes(view))) {
      throw new Error(`${provider.name} requires ${capability.minCount}-${capability.maxCount} distinct labelled ${capability.supportedViews.join("/")} references including ${capability.requiredViews.join("/")}.`);
    }
    const selectedModelId = references.length >= capability.multiViewMinCount
      ? capability.multiViewModelId
      : capability.singleViewModelId;
    if (!provider.modelSources.some((model) => model.id === selectedModelId)
      || capability.selectionPolicy !== "automatic-by-image-count"
      || capability.unsupportedPolicy !== "fail-closed") {
      throw new Error(`${provider.name} has no verified model declaration that can consume all ${references.length} supplied images.`);
    }
  }
  return value;
}

function specReferenceImages(spec: AssetSpecV1) {
  return spec.referenceImages ?? (spec.referenceImage ? [spec.referenceImage] : []);
}

function jobReferenceImages(job: Prompt3DJobStatus) {
  return job.referenceImages ?? (job.referenceImage ? [job.referenceImage] : []);
}

export interface Prompt3DServiceOptions {
  root: string;
  appRoot: string;
  offlineLocalTest: boolean;
  onWorkflowLibraryRoot?: (localAssetsRoot: string) => void | Promise<void>;
}

export class Prompt3DService extends EventEmitter {
  private root: string;
  private installer: Prompt3DInstaller;
  private grants = new Set<string>();
  private jobs = new Map<string, Prompt3DJobStatus>();
  private historyLoad: Promise<void> | null = null;
  private finishJobs = new Map<string, Prompt3DFinishJobStatus>();
  private finishHistoryLoad: Promise<void> | null = null;
  private batches = new Map<string, Prompt3DBatchStatus>();
  private batchRequests = new Map<string, Prompt3DBatchRequest>();
  private batchRuntime = new Map<string, Map<string, Prompt3DBatchRuntimeItem>>();
  private batchTokens = new Map<string, string>();
  private batchJobLinks = new Map<string, string>();
  private batchesAdvancing = new Set<string>();
  private batchesAdvancePending = new Set<string>();
  private batchPublishQueues = new Map<string, Promise<void>>();
  private batchExportPromises = new Map<string, Promise<Prompt3DBatchExportResult>>();
  private workflowSavePromises = new Map<string, Promise<Prompt3DWorkflowSaveResult>>();
  private jobCancellations = new Map<string, { message: string; updatedAt: string }>();
  private finishCancellations = new Map<string, { message: string; updatedAt: string }>();
  private activeSidecarJobs = new Map<string, string>();
  private sidecar: { process: ChildProcess; port: number; token: string } | null = null;
  private readonly serviceRunId = randomUUID();
  private starting = false;
  private batchStarting = false;

  constructor(private readonly options: Prompt3DServiceOptions) {
    super();
    this.root = resolve(options.root);
    this.installer = this.makeInstaller();
  }

  private makeInstaller() {
    return new Prompt3DInstaller({
      root: this.root, appRoot: this.options.appRoot, integrityKeyDirectory: contained(this.root, join(this.root, ".integrity")),
      onUpdate: (status) => this.emit("install-progress", status),
      onLog: (provider, line) => this.emit("log", { provider, line }),
    });
  }

  grant(): string { const token = randomBytes(32).toString("hex"); this.grants.add(token); return token; }
  revoke(token: string) { this.grants.delete(token); }
  revokeAll() { this.grants.clear(); }
  private requireGrant(token: string) { if (!token || !this.grants.has(token)) throw new Error("Prompt-to-3D capability grant is missing or expired."); }
  assertCapability(token: string) { this.requireGrant(token); }
  authorizeResultPath(token: string, path: string) { this.requireGrant(token); return contained(this.root, path); }
  getRoot() { return this.root; }

  private activeBatch(): Prompt3DBatchStatus | undefined {
    return [...this.batches.values()].find((batch) => batch.state === "running" || batch.state === "awaiting-approval");
  }

  private assertBatchDispatch(token: string, internalBatchId?: string): void {
    if (this.batchStarting) {
      throw new Error("A serial Prompt-to-3D batch is being admitted; wait for it to finish preflight.");
    }
    const active = this.activeBatch();
    if (!active) {
      if (internalBatchId) throw new Error("Internal batch dispatch no longer matches an active batch.");
      return;
    }
    if (internalBatchId !== active.id || this.batchTokens.get(active.id) !== token) {
      throw new Error("A serial Prompt-to-3D batch is active; only its current approval or prompted batch step may continue.");
    }
  }

  private loadHistory(): Promise<void> {
    if (!this.historyLoad) {
      this.historyLoad = readPrompt3DJobs(this.root).then((saved) => {
        for (const job of saved) {
          try { assertSpec(job.spec); if (!this.jobs.has(job.id)) this.jobs.set(job.id, job); } catch { /* invalid saved spec */ }
        }
      }).catch((error) => { this.historyLoad = null; throw error; });
    }
    return this.historyLoad;
  }

  async history(): Promise<Prompt3DHistory> {
    await Promise.all([this.loadHistory(), this.loadFinishHistory()]);
    const jobs = [...this.jobs.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return {
      latestJob: jobs[0] ?? null,
      previousResult: jobs.find(job => job.state === "complete" && job.variants.some(v => v.report.gameReady))
        ?? jobs.find(job => job.variants.length > 0) ?? null,
    };
  }

  private loadFinishHistory(): Promise<void> {
    if (!this.finishHistoryLoad) {
      this.finishHistoryLoad = readWorkflowJobs(this.root).then((saved) => {
        for (const job of saved) if (!this.finishJobs.has(job.id)) this.finishJobs.set(job.id, job);
      }).catch((error) => { this.finishHistoryLoad = null; throw error; });
    }
    return this.finishHistoryLoad;
  }

  async finishHistory(): Promise<Prompt3DFinishHistory> {
    await this.loadFinishHistory();
    const jobs = [...this.finishJobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { jobs, latest: jobs.find((job) => job.state === "complete") ?? jobs[0] ?? null };
  }

  finishStatus(token: string, id: string, internal = false): Prompt3DFinishJobStatus {
    if (!internal) this.requireGrant(token);
    const job = this.finishJobs.get(id);
    if (!job) throw new Error("Prompt-to-3D finishing job not found.");
    return job;
  }

  private regionPreviewFiles: string[] = [];
  private async regionEditorSource(token:string,edit:Pick<DeformationEdit,"jobId"|"sha256">){
    this.requireGrant(token);await this.loadFinishHistory();
    const job=this.finishJobs.get(edit.jobId);
    if(!job||job.state!=="complete"||job.operation!=="animation"||!job.assetPath||job.sha256!==edit.sha256||!Array.isArray(job.animationPlan?.deformations))throw new Error("Choose an exact retained deformation animation.");
    const previous=job.animationPlan?.deformationEdit as {baselineJobId?:string;baselineSha256?:string}|undefined;
    const baseline=previous?.baselineJobId?this.finishJobs.get(previous.baselineJobId):job;
    if(!baseline?.assetPath||!baseline.sha256||baseline.assetId!==job.assetId||stableJson(baseline.source)!==stableJson(job.source)||(previous&&baseline.sha256!==previous.baselineSha256))throw new Error("The original deformation baseline is missing or belongs to another asset.");
    await inspectRegionEditor(contained(this.root,job.assetPath),job.sha256!,job.animationPlan);
    return {job,baseline};
  }
  async inspectDeformation(token:string,id:string){
    await this.loadFinishHistory();const job=this.finishStatus(token,id);
    const {baseline}=await this.regionEditorSource(token,{jobId:id,sha256:job.sha256!});
    const current=await inspectRegionEditor(contained(this.root,job.assetPath!),job.sha256!,job.animationPlan);
    const original=await inspectRegionEditor(contained(this.root,baseline.assetPath!),baseline.sha256!,baseline.animationPlan);
    return {...current,regions:original.regions};
  }
  async previewDeformation(token:string,edit:DeformationEdit){
    const {baseline}=await this.regionEditorSource(token,edit);
    const directory=join(this.root,"deformation-previews");await mkdir(directory,{recursive:true});
    const output=contained(this.root,join(directory,`${randomUUID()}.glb`));
    const result=await writeRegionEditorPreview(contained(this.root,baseline.assetPath!),baseline.sha256!,output,edit.regions,baseline.animationPlan);
    this.regionPreviewFiles.push(output);
    while(this.regionPreviewFiles.length>24)await unlink(this.regionPreviewFiles.shift()!).catch(()=>undefined);
    return result;
  }

  private jobCancelled(job: Prompt3DJobStatus): boolean {
    return this.jobCancellations.has(job.id) || job.state === "cancelled";
  }

  private finishCancelled(job: Prompt3DFinishJobStatus): boolean {
    return this.finishCancellations.has(job.id) || job.state === "cancelled";
  }

  private async publishFinishJob(job: Prompt3DFinishJobStatus): Promise<void> {
    const cancellation = this.finishCancellations.get(job.id);
    if (cancellation) Object.assign(job, { state: "cancelled", stage: "cancelled", ...cancellation });
    try { await recordWorkflowJob(this.root, job); }
    finally {
      this.emit("finish-progress", job);
      this.queueBatchAdvanceForJob(job.id);
    }
  }

  private publishJob(job: Prompt3DJobStatus) {
    const cancellation = this.jobCancellations.get(job.id);
    if (cancellation) Object.assign(job, { state: "cancelled", stage: "cancelled", ...cancellation });
    try { savePrompt3DJob(this.root, job); delete job.autosaveError; }
    catch (error) { job.autosaveError = error instanceof Error ? error.message : String(error); }
    this.emit("job-progress", job);
    this.queueBatchAdvanceForJob(job.id);
  }

  private beginTiming(job: Prompt3DJobStatus, stage: string, message: string) {
    const startedAt = new Date().toISOString();
    job.timings = [...(job.timings ?? []), { stage, status: "running", startedAt, message }];
    job.message = message;
    job.updatedAt = startedAt;
    this.publishJob(job);
    return { startedAt, startedMs: Date.now() };
  }

  private finishTiming(job: Prompt3DJobStatus, stage: string, startedAt: string, startedMs: number, message: string, status: "complete" | "failed" = "complete") {
    const completedAt = new Date().toISOString();
    const elapsedMs = Math.max(0, Date.now() - startedMs);
    const timings = [...(job.timings ?? [])];
    let index = -1;
    for (let candidate = timings.length - 1; candidate >= 0; candidate -= 1) {
      if (timings[candidate].stage === stage && timings[candidate].startedAt === startedAt) { index = candidate; break; }
    }
    const completed = { stage, status, startedAt, completedAt, elapsedMs, message } as const;
    if (index >= 0) timings[index] = completed;
    else timings.push(completed);
    job.timings = timings;
    job.message = message;
    job.updatedAt = completedAt;
    this.publishJob(job);
  }

  private mergeProviderTimings(job: Prompt3DJobStatus, values: unknown) {
    if (!Array.isArray(values)) return;
    const timings = [...(job.timings ?? [])];
    for (const value of values) {
      if (!value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      if (typeof item.stage !== "string" || typeof item.message !== "string" || !Number.isFinite(item.elapsedMs)) continue;
      const elapsedMs = Math.max(0, Number(item.elapsedMs));
      const completedAt = typeof item.completedAt === "string" ? item.completedAt : new Date().toISOString();
      const startedAt = typeof item.startedAt === "string" ? item.startedAt : new Date(Date.parse(completedAt) - elapsedMs).toISOString();
      if (!timings.some((timing) => timing.stage === item.stage && timing.startedAt === startedAt)) {
        timings.push({ stage: item.stage, status: "complete", startedAt, completedAt, elapsedMs, message: item.message });
      }
    }
    job.timings = timings;
  }

  private async writeJsonAtomic(path: string, value: unknown) {
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private recordedSpec(job: Prompt3DJobStatus, seed = job.spec.seed) {
    return {
      ...sanitizeAssetSpec({ ...job.spec, seed }),
      promptPlan: job.promptPlan ?? compilePrompt3DPrompt(job.spec),
      conceptOnly: job.conceptOnly === true,
      approvedConcept: job.approvedConcept === true,
      ...(job.conceptAttempt ? { conceptAttempt: job.conceptAttempt } : {}),
      ...(job.conceptInspection ? { conceptInspection: job.conceptInspection } : {}),
      ...(job.conceptApproval ? { conceptApproval: job.conceptApproval } : {}),
      ...(job.referenceImage ? { referenceImageEvidence: job.referenceImage } : {}),
      ...(job.referenceImages ? { referenceImagesEvidence: job.referenceImages } : {}),
      ...(job.executionProfile ? { executionProfile: job.executionProfile } : {}),
    };
  }

  private async writeRecordedSpecs(job: Prompt3DJobStatus, variantDirectory?: string, seed = job.spec.seed) {
    const value = this.recordedSpec(job, seed);
    await this.writeJsonAtomic(join(job.outputDirectory, "asset-spec.json"), value);
    if (variantDirectory) await this.writeJsonAtomic(join(variantDirectory, "asset-spec.json"), value);
  }

  private async retainedConceptHash(job: Prompt3DJobStatus): Promise<string> {
    if (!job.conceptImagePath) throw new Error("No retained concept image is available for approval.");
    const path = contained(job.outputDirectory, job.conceptImagePath);
    const link = await lstat(path);
    const info = await stat(path);
    if (link.isSymbolicLink() || !info.isFile() || info.size < 1 || info.size > 16 * 1024 ** 2) throw new Error("Unsafe retained concept image.");
    return sha256Hex(await readFile(path));
  }

  private async verifyRetainedReferenceImage(job: Prompt3DJobStatus): Promise<void> {
    if (job.spec.referenceImages || job.referenceImages) {
      if (!job.spec.referenceImages || !job.referenceImages) {
        throw new Error("Job multiview reference-image evidence does not match its exact AssetSpec.");
      }
      await verifyPrompt3DRetainedReferenceImages(job.outputDirectory, job.referenceImages, job.spec.referenceImages);
      if (!job.referenceImage || !prompt3DReferenceImageMatches(job.referenceImage, job.referenceImages.find((image) => image.view === "front"))) {
        throw new Error("Job primary reference image does not match its retained front view.");
      }
      const attemptReferences = job.conceptAttempt?.referenceImages;
      if (attemptReferences && stableJson(attemptReferences) !== stableJson(job.referenceImages)) {
        throw new Error("Concept attempt multiview reference evidence differs from the retained job bytes.");
      }
      return;
    }
    const expected = job.spec.referenceImage;
    const retained = job.referenceImage;
    if (!expected && !retained) return;
    if (!expected || !retained) throw new Error("Job reference-image evidence does not match its exact AssetSpec.");
    await verifyPrompt3DRetainedReferenceImage(job.outputDirectory, retained, expected);
    if (job.conceptAttempt?.referenceImage
      && stableJson(job.conceptAttempt.referenceImage) !== stableJson(retained)) {
      throw new Error("Concept attempt reference-image evidence differs from the retained job bytes.");
    }
  }

  private async retainConceptAttempt(
    job: Prompt3DJobStatus,
    variantDirectory: string,
    status: "pass" | "needs-regeneration",
    detail?: string,
  ): Promise<Prompt3DConceptAttempt> {
    const conceptImagePath = contained(job.outputDirectory, join(variantDirectory, "concept.png"));
    job.conceptImagePath = conceptImagePath;
    await this.verifyRetainedReferenceImage(job);
    const conceptSha256 = await this.retainedConceptHash(job);
    const reportPath = contained(job.outputDirectory, join(variantDirectory, "concept-review.json"));
    const retainedReport = await readConceptTechnicalReport(this.root, reportPath, status);
    if (retainedReport.report.providerSourcePath !== "concept-source.png"
      || typeof retainedReport.report.providerSourceSha256 !== "string") {
      throw new Error("The provider concept source is missing from the retained technical report.");
    }
    const providerSourcePath = contained(job.outputDirectory, join(variantDirectory, retainedReport.report.providerSourcePath));
    const providerSourceBytes = await readContainedFile(this.root, providerSourcePath, 32 * 1024 ** 2);
    if (sha256Hex(providerSourceBytes) !== retainedReport.report.providerSourceSha256) {
      throw new Error("The untouched provider concept source does not match its retained hash.");
    }
    const plan = job.promptPlan ?? compilePrompt3DPrompt(job.spec);
    const presentationContractSha256 = sha256Hex(stableJson(plan.presentationContract));
    const existing = [...(job.conceptAttempts ?? [])];
    const attemptNumber = existing.reduce((maximum, item) => Math.max(maximum, item.attemptNumber), 0) + 1;
    const binding = createConceptBinding(job.id, attemptNumber, job.spec, conceptSha256);
    const checkedAt = new Date().toISOString();
    const message = status === "pass"
      ? "Background isolation, foreground bounds and edge clearance passed. Semantic resemblance, required parts and artistic quality were not checked."
      : `Deterministic framing checks require regeneration. ${detail ?? "Inspect the retained concept."}`;
    const attempt: Prompt3DConceptAttempt = {
      attemptNumber,
      binding,
      conceptImagePath,
      promptPlan: plan,
      technicalReview: {
        status,
        method: retainedReport.report.method,
        message,
        reportPath,
        reportSha256: retainedReport.sha256,
        presentationContractSha256,
        reportVersion: 1,
        semanticResemblanceChecked: false,
        visualReviewRequired: true,
        ...(retainedReport.report.failureCode ? { failureCode: retainedReport.report.failureCode } : {}),
        checkedAt,
      },
      providerConceptSource: {
        path: providerSourcePath,
        sha256: retainedReport.report.providerSourceSha256,
        role: "untouched-provider-render",
      },
      ...(retainedReport.report.normalization ? { normalization: retainedReport.report.normalization } : {}),
      ...(retainedReport.report.conditioningIsolation ? { conditioningIsolation: retainedReport.report.conditioningIsolation } : {}),
      ...(job.referenceImage ? { referenceImage: job.referenceImage } : {}),
      ...(job.referenceImages ? { referenceImages: job.referenceImages } : {}),
      createdAt: checkedAt,
    };
    job.conceptAttempt = attempt;
    job.conceptAttempts = [...existing, attempt];
    await this.writeJsonAtomic(join(variantDirectory, "concept-attempt.json"), attempt);
    await this.writeRecordedSpecs(job, variantDirectory);
    return attempt;
  }

  private async verifyConceptTechnicalReview(job: Prompt3DJobStatus): Promise<void> {
    const attempt = job.conceptAttempt;
    if (!attempt) throw new Error("The retained concept attempt is unavailable.");
    const retained = await readConceptTechnicalReport(this.root, attempt.technicalReview.reportPath, attempt.technicalReview.status);
    const providerSource = attempt.providerConceptSource;
    if ((retained.report.providerSourcePath === "concept-source.png") !== Boolean(providerSource)) {
      throw new Error("The retained concept technical review has inconsistent provider-source provenance.");
    }
    if (providerSource) {
      const expectedPath = contained(job.outputDirectory, join(dirname(attempt.technicalReview.reportPath), "concept-source.png"));
      const sourceBytes = await readContainedFile(this.root, providerSource.path, 32 * 1024 ** 2);
      if (providerSource.path !== expectedPath
        || providerSource.role !== "untouched-provider-render"
        || providerSource.sha256 !== sha256Hex(sourceBytes)
        || providerSource.sha256 !== retained.report.providerSourceSha256
        || stableJson(attempt.normalization) !== stableJson(retained.report.normalization)
        || stableJson(attempt.conditioningIsolation) !== stableJson(retained.report.conditioningIsolation)) {
        throw new Error("The retained provider concept source or normalization record changed.");
      }
    }
    if (attempt.technicalReview.reportSha256 !== retained.sha256
      || attempt.technicalReview.reportVersion !== 1
      || attempt.technicalReview.semanticResemblanceChecked !== false
      || attempt.technicalReview.visualReviewRequired !== true
      || attempt.technicalReview.method !== retained.report.method
      || attempt.technicalReview.failureCode !== retained.report.failureCode
      || attempt.technicalReview.presentationContractSha256 !== sha256Hex(stableJson(attempt.promptPlan.presentationContract))) {
      throw new Error("The retained concept technical review or presentation binding changed.");
    }
  }

  private async persistConceptInspection(
    job: Prompt3DJobStatus,
    decision: "approved" | "rejected",
    request: Prompt3DApproveConceptRequest["inspection"] | Prompt3DRejectConceptRequest["inspection"],
  ): Promise<Prompt3DConceptInspectionRecord> {
    const attempt = job.conceptAttempt;
    if (!attempt || !job.conceptImagePath) throw new Error("The retained concept attempt is unavailable.");
    if (job.conceptInspection) throw new Error("This retained concept already has an explicit inspection decision.");
    const actualConceptSha256 = await this.retainedConceptHash(job);
    assertConceptAttemptBinding(job.id, job.spec, attempt, actualConceptSha256);
    await this.verifyConceptTechnicalReview(job);
    const rejection = "classification" in request
      ? { classification: request.classification, note: request.note }
      : {};
    const evidence = createConceptInspectionEvidence(job.spec, attempt, decision, request.checks, rejection);
    const path = contained(job.outputDirectory, join(dirname(job.conceptImagePath), "concept-inspection.json"));
    await this.writeJsonAtomic(path, evidence);
    const retained = JSON.parse((await readContainedFile(this.root, path, 256 * 1024)).toString("utf8"));
    if (stableJson(retained) !== stableJson(evidence)) throw new Error("The retained concept inspection could not be verified.");
    const record: Prompt3DConceptInspectionRecord = { evidence, path, sha256: sha256Hex(stableJson(evidence)) };
    assertConceptInspectionRecord(job.spec, attempt, record, decision);
    job.conceptInspection = record;
    job.conceptInspections = [...(job.conceptInspections ?? []), record];
    return record;
  }

  private async verifyConceptInspection(job: Prompt3DJobStatus, decision?: "approved" | "rejected"): Promise<Prompt3DConceptInspectionRecord> {
    const attempt = job.conceptAttempt;
    if (!attempt) throw new Error("The retained concept attempt is unavailable.");
    await this.verifyConceptTechnicalReview(job);
    const record = job.conceptInspection;
    assertConceptInspectionRecord(job.spec, attempt, record, decision);
    const retained = JSON.parse((await readContainedFile(this.root, record.path, 256 * 1024)).toString("utf8"));
    if (stableJson(retained) !== stableJson(record.evidence)) throw new Error("The retained concept inspection record changed.");
    return record;
  }

  /** Restore a previously user-selected root before renderer IPC becomes available. */
  async restoreRoot(path: string) {
    const nextRoot = resolve(path);
    if (nextRoot !== this.root) {
      if ([...this.jobs.values()].some((job) => job.state === "queued" || job.state === "running" || job.state === "awaiting-concept-approval")
        || [...this.finishJobs.values()].some((job) => job.state === "queued" || job.state === "running")
        || [...this.batches.values()].some((batch) => batch.state !== "complete" && batch.state !== "failed" && batch.state !== "cancelled")
        || [...(["hunyuan3d-2", "trellis"] as const)].some((provider) => this.installer.getStatus(provider).state === "installing")) {
        throw new Error("Cannot change the installation root while work or concept approval is active.");
      }
      this.jobs.clear(); this.historyLoad = null;
      this.finishJobs.clear(); this.finishHistoryLoad = null;
      this.batches.clear(); this.batchRequests.clear(); this.batchRuntime.clear(); this.batchTokens.clear();
      this.batchJobLinks.clear(); this.batchesAdvancing.clear(); this.batchesAdvancePending.clear(); this.batchPublishQueues.clear();
      this.workflowSavePromises.clear();
      this.jobCancellations.clear(); this.finishCancellations.clear();
    }
    this.root = nextRoot;
    await mkdir(this.root, { recursive: true });
    this.installer = this.makeInstaller();
  }

  async setRoot(token: string, path: string) {
    this.requireGrant(token);
    await Promise.all([this.loadHistory(), this.loadFinishHistory()]);
    this.batchStatus(token);
    await this.restoreRoot(path);
    return this.overview();
  }

  async overview(spec?: AssetSpecV1): Promise<Prompt3DOverview> {
    await mkdir(this.root, { recursive: true });
    const hardware = await measurePrompt3DHardware(this.root);
    const providers = await Promise.all(PROMPT3D_PROVIDERS.map(async (manifest) => {
      const compliance = evaluatePrompt3DCompliance(manifest, hardware, this.root, "display", spec);
      const install = manifest.kind === "local" ? this.installer.getStatus(manifest.id as LocalPrompt3DProviderId) : null;
      if (manifest.kind === "local" && compliance.installed) {
        const integrity = await this.installer.verify(manifest.id as LocalPrompt3DProviderId);
        compliance.reasons.push(integrity.reason);
        if (!integrity.ok) { compliance.installed = false; compliance.modelInstalled = false; compliance.softwarePass = false; compliance.canRun = false; compliance.state = "setup-required"; }
      }
      return { manifest, compliance, install, cloudConfigured: false };
    }));
    const localUnsupported = providers.filter((p) => p.manifest.kind === "local").every((p) => p.compliance.state === "unsupported");
    for (const provider of providers.filter((p) => p.manifest.kind === "cloud")) {
      provider.compliance.state = localUnsupported ? "cloud-only" : "setup-required";
      provider.compliance.reasons = [localUnsupported ? "Both local providers are physically/platform unsupported. Configure this cloud provider to continue." : "Local hardware is capable; cloud remains an explicitly configured optional choice."];
    }
    return { runtime: { offlineLocalTest: this.options.offlineLocalTest, cloudDisabled: true, root: this.root }, hardware, providers };
  }

  async plan(token: string, request: Prompt3DPlanRequest): Promise<Prompt3DPlanResult> {
    this.requireGrant(token);
    const current = assertSpec(request.currentSpec);
    assertObjectRulesCompatibleWithPrompt(current);
    const result = await planPrompt3DAsset(current);
    result.spec = assertSpec(result.spec);
    assertObjectRulesCompatibleWithPrompt(result.spec);
    return result;
  }

  async install(token: string, request: Prompt3DInstallRequest) {
    this.requireGrant(token);
    const provider = localProvider(request.providerId);
    const expectedRoot = contained(this.root, join(this.root, request.providerId));
    if (resolve(request.destination) !== expectedRoot || request.confirmation.destination !== request.destination || request.confirmation.providerId !== request.providerId) throw new Error("Installation destination confirmation does not match the path-contained provider root.");
    if (request.action === "remove") return this.installer.remove(request.providerId);
    if (!request.confirmation.acceptedForThisInstall || request.confirmation.providerId !== request.providerId || request.confirmation.downloadBytes !== provider.downloadBytes || request.confirmation.licenseUrl !== provider.licenseUrl) throw new Error("Source, download size and license must be deliberately confirmed for this provider.");
    const hardware = await measurePrompt3DHardware(this.root, true);
    const compliance = evaluatePrompt3DCompliance(provider, hardware, this.root, "pre-download");
    if (!compliance.canInstall) throw new Error(compliance.reasons.join(" "));
    return this.installer.start(request.providerId, request.action);
  }

  cancelInstall(token: string, providerId: LocalPrompt3DProviderId) { this.requireGrant(token); return this.installer.cancel(providerId); }

  private pythonFor(provider: LocalPrompt3DProviderId): string {
    if (provider === "hunyuan3d-2") return contained(this.root, join(this.root, provider, "environment", "Scripts", "python.exe"));
    return contained(this.root, join(this.root, provider, "environment", "Scripts", "python.exe"));
  }

  private async captureProviderVerification(
    providerId: LocalPrompt3DProviderId,
    reason: string,
  ): Promise<Prompt3DProviderVerification> {
    const provider = localProvider(providerId);
    const manifestPath = contained(this.root, join(this.root, providerId, "install-manifest.json"));
    const manifestBytes = await readFile(manifestPath);
    const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
      providerId?: string;
      sourceRevision?: string;
      models?: Array<{ id?: string; revision?: string; treeSha256?: string }>;
      runtimeLocks?: { pipFreezeSha256?: string; condaExplicitSha256?: string; nativeArtifactsSha256?: string };
    };
    const workerPath = contained(this.options.appRoot, join(
      this.options.appRoot,
      "tools",
      "prompt3d",
      providerId === "hy-motion-1" ? "hy_motion_worker.py" : "provider_worker.py",
    ));
    const modelSnapshots = (manifest.models ?? []).map((model) => ({
      id: String(model.id ?? ""),
      revision: String(model.revision ?? ""),
      treeSha256: String(model.treeSha256 ?? ""),
    }));
    const locks = manifest.runtimeLocks ?? {};
    if (manifest.providerId !== providerId
      || manifest.sourceRevision !== provider.sourceRevision
      || modelSnapshots.length !== provider.modelSources.length
      || modelSnapshots.some((model) => !model.id || !/^[a-f0-9]{64}$/.test(model.treeSha256))
      || !/^[a-f0-9]{64}$/.test(String(locks.pipFreezeSha256 ?? ""))
      || !/^[a-f0-9]{64}$/.test(String(locks.condaExplicitSha256 ?? ""))
      || !/^[a-f0-9]{64}$/.test(String(locks.nativeArtifactsSha256 ?? ""))) {
      throw new Error("Deep provider verification evidence is incomplete.");
    }
    return {
      version: 1,
      providerId,
      sourceRevision: provider.sourceRevision,
      verificationMode: "deep",
      verifiedAt: new Date().toISOString(),
      reason,
      installManifestSha256: sha256Hex(manifestBytes),
      workerSha256: sha256Hex(await readFile(workerPath)),
      modelSnapshots,
      runtimeLocks: {
        pipFreezeSha256: String(locks.pipFreezeSha256),
        condaExplicitSha256: String(locks.condaExplicitSha256),
        nativeArtifactsSha256: String(locks.nativeArtifactsSha256),
      },
    };
  }

  private async ensureSidecar(): Promise<{ port: number; token: string }> {
    if (this.sidecar && !this.sidecar.process.killed) return this.sidecar;
    const python = contained(this.root, join(this.root, ".python", "cpython-3.10-windows-x86_64-none", "python.exe"));
    if (!existsSync(python)) throw new Error("The isolated Prompt-to-3D Python runtime is not installed.");
    const token = randomBytes(32).toString("base64url");
    const script = contained(this.options.appRoot, join(this.options.appRoot, "tools", "prompt3d", "sidecar.py"));
    const worker = contained(this.options.appRoot, join(this.options.appRoot, "tools", "prompt3d", "provider_worker.py"));
    const child = spawn(python, [script, "--port", "0", "--root", this.root, "--worker", worker], { windowsHide: true, shell: false, env: childEnvironment({ GRUDGE_PROMPT3D_SIDECAR_TOKEN: token, PYTHONUNBUFFERED: "1" }), stdio: ["ignore", "pipe", "pipe"] });
    const port = await new Promise<number>((resolvePromise, reject) => {
      let buffer = "";
      const timer = setTimeout(() => { child.kill(); reject(new Error("Prompt-to-3D sidecar startup timed out.")); }, 10_000);
      child.stdout.on("data", (data) => {
        buffer += String(data);
        const line = buffer.split(/\r?\n/)[0];
        try { const info = JSON.parse(line); if (info.host !== "127.0.0.1") throw new Error("Sidecar did not bind loopback."); clearTimeout(timer); resolvePromise(Number(info.port)); } catch { /* await full line */ }
      });
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("exit", (code) => { if (!this.sidecar) { clearTimeout(timer); reject(new Error(`Sidecar exited ${code}`)); } });
    });
    this.sidecar = { process: child, port, token };
    child.on("exit", () => { this.sidecar = null; });
    return { port, token };
  }

  private async sidecarRequest(path: string, init?: RequestInit) {
    const sidecar = await this.ensureSidecar();
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`http://127.0.0.1:${sidecar.port}${path}`, { ...init, signal: controller.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${sidecar.token}`, ...(init?.headers ?? {}) } });
      const body = await response.json(); if (!response.ok) throw new Error(String((body as any).error ?? `Sidecar HTTP ${response.status}`)); return body;
    } finally { clearTimeout(timer); }
  }

  async start(token: string, request: Prompt3DStartRequest, internalBatchId?: string): Promise<Prompt3DJobStatus> {
    this.requireGrant(token);
    const batchLinkSourceId = request.rejectedGeometryJobId ?? request.parentConceptJobId;
    const linkedBatchId = batchLinkSourceId ? this.batchJobLinks.get(batchLinkSourceId) : undefined;
    if ((request.batchId === undefined) !== (request.batchItemId === undefined)) {
      throw new Error("Corrective batch generation requires both batch and item IDs.");
    }
    if (request.batchId) {
      const boundBatch = this.batches.get(request.batchId);
      const boundItem = boundBatch?.items.find((item) => item.state !== "complete");
      const boundRuntime = boundItem ? this.batchRuntime.get(request.batchId)?.get(boundItem.id) : undefined;
      if (!boundBatch || boundBatch.state !== "awaiting-approval" || boundItem?.id !== request.batchItemId
        || (boundRuntime?.currentKind !== "base" && boundRuntime?.currentKind !== "shape")
        || !batchLinkSourceId || boundRuntime.currentJobId !== batchLinkSourceId) {
        throw new Error("Corrective generation does not match the exact current batch geometry revision.");
      }
      if (linkedBatchId && linkedBatchId !== request.batchId) throw new Error("Corrective generation batch ancestry is inconsistent.");
    }
    const batchDispatchId = internalBatchId ?? request.batchId ?? linkedBatchId;
    this.assertBatchDispatch(token, batchDispatchId);
    if (this.starting) throw new Error("A generation is already passing preflight checks.");
    this.starting = true;
    try {
      const successor = await this.startChecked(token, request);
      const replacedJobId = request.rejectedGeometryJobId ?? request.parentConceptJobId;
      const batchId = replacedJobId ? this.batchJobLinks.get(replacedJobId) : undefined;
      if (batchId && replacedJobId) {
        const runtimes = this.batchRuntime.get(batchId);
        const batch = this.batches.get(batchId);
        const runtimeEntry = runtimes
          ? [...runtimes.entries()].find(([, runtime]) => runtime.currentJobId === replacedJobId)
          : undefined;
        if (!batch || !runtimeEntry) throw new Error("Batch concept successor lost its retained runtime link.");
        const [itemId, runtime] = runtimeEntry;
        runtime.currentJobId = successor.id;
        this.batchJobLinks.delete(replacedJobId);
        this.batchJobLinks.set(successor.id, batchId);
        const itemStatus = batch.items.find((item) => item.id === itemId);
        if (!itemStatus) throw new Error("Batch concept successor item is unavailable.");
        await this.updateBatchItem(batch, itemStatus, {
          state: "concept",
          currentJobId: successor.id,
          message: "Generating a new retained concept attempt after an explicit prompt or seed refinement.",
        });
        this.queueBatchAdvance(batchId);
      }
      return successor;
    } finally { this.starting = false; }
  }

  private async startChecked(token: string, request: Prompt3DStartRequest): Promise<Prompt3DJobStatus> {
    this.requireGrant(token);
    await Promise.all([this.loadHistory(), this.loadFinishHistory()]);
    let spec = withObjectRules(assertSpec({
      ...sanitizeAssetSpec(request.spec),
      objectRules: request.spec.objectRules,
      coordinateContract: { ...request.spec.coordinateContract, origin: "ground-center" },
    }));
    const conceptWorkflow = supportsConceptWorkflow(spec);
    if (conceptWorkflow && spec.variants !== 1) spec = { ...spec, variants: 1 };
    if (request.approvedConceptJobId) throw new Error("Legacy concept reuse cannot authorize geometry. Use the exact retained approval action.");
    if (request.conceptOnly && !conceptWorkflow) throw new Error("Concept-only generation is available only for the Hunyuan concept route.");
    if (!request.consent?.confirmed || request.consent.providerId !== spec.providerId) throw new Error("The selected provider boundary must be confirmed for this run.");
    if (PROMPT3D_PROVIDERS.find((p) => p.id === spec.providerId)?.kind === "cloud") throw new Error("Cloud providers are not configured; no prompt or reference data was sent.");
    if ([...this.jobs.values()].some((j) => j.state === "queued" || j.state === "running")
      || [...this.finishJobs.values()].some((j) => j.state === "queued" || j.state === "running")) throw new Error(`Prompt-to-3D concurrency is bounded to ${MAX_JOBS}.`);
    let parent: Prompt3DJobStatus | undefined;
    let approvedGeometryParent: Prompt3DJobStatus | undefined;
    let effectiveParentJobId = request.parentConceptJobId;
    let rejectedCandidate: {
      job: Prompt3DJobStatus;
      variant: Prompt3DJobStatus["variants"][number];
      path: string;
      geometryHash: string;
      sha256: string;
      ancestor: Prompt3DJobStatus;
      retainedAncestry: Prompt3DGeometryRejection["retainedAncestry"];
    } | undefined;
    let rejectedGeometry: {
      job: Prompt3DJobStatus;
      variant: Prompt3DJobStatus["variants"][number];
      path: string;
      geometryHash: string;
      sha256: string;
      correctivePrompt: string;
      retainedAncestry: Prompt3DGeometryRejection["retainedAncestry"];
      replacementKind: Prompt3DGeometryRejection["replacementKind"];
      approvedAncestorJobId?: string;
    } | undefined;
    if (request.freshRootCorrection && !request.rejectedGeometryJobId) {
      throw new Error("A fresh-root correction must identify the exact rejected geometry.");
    }
    if (request.rejectedGeometryJobId && request.freshRootCorrection !== true
      && (request.shapeRefinement !== true || request.conceptChangeReason !== "edited")) {
      throw new Error("Rejected geometry can only be replaced by an explicit prompted shape refinement or bound fresh-root correction.");
    }
    if (request.freshRootCorrection === true
      && (!request.batchId || !request.batchItemId || request.shapeRefinement === true || request.conceptChangeReason !== "edited")) {
      throw new Error("Fresh-root correction requires an exact active batch binding and explicit edited-prompt action.");
    }
    if (request.rejectedGeometryJobId) {
      const rejected = this.jobs.get(request.rejectedGeometryJobId);
      if (!rejected || rejected.state !== "complete" || rejected.providerId !== "hunyuan3d-2" || !rejected.conceptApproval) {
        throw new Error("A corrective refinement must identify completed Hunyuan geometry with retained concept approval.");
      }
      if (rejected.geometryRejection || rejected.geometryRejectionPath || rejected.geometryRejectionSha256) {
        throw new Error("This rejected geometry already has a retained corrective successor.");
      }
      const verifiedRejected = await this.verifyGenerationVariant(rejected, 0);
      const rejectedVariant = verifiedRejected.variant;
      const approvalRecordPath = contained(rejected.outputDirectory, join(rejected.outputDirectory, "variant-1", "visual-approval.json"));
      if (rejectedVariant.visualApproval || rejectedVariant.visualApprovalPath || rejectedVariant.visualApprovalSha256 || existsSync(approvalRecordPath)) {
        throw new Error("Approved geometry cannot be relabelled as a rejected refinement.");
      }
      if (request.freshRootCorrection === true) {
        const retainedAncestry = await this.resolveFreshRootCorrectionAncestry(rejected);
        if (rejected.spec.seed >= 0x7fffffff || spec.prompt.trim() === rejected.spec.prompt.trim()) {
          throw new Error("Fresh-root correction needs an edited prompt and an available successor seed.");
        }
        const expected = withObjectRules(assertSpec({
          ...sanitizeAssetSpec(rejected.spec),
          prompt: spec.prompt.trim(),
          seed: rejected.spec.seed + 1,
          variants: 1,
          generateTextures: false,
          objectRules: undefined,
          coordinateContract: { ...rejected.spec.coordinateContract, origin: "ground-center" },
        }));
        if (stableJson(expected) !== stableJson(spec)) {
          throw new Error("Fresh-root correction may change only the prompt-derived rules and next seed of the rejected base brief.");
        }
        rejectedGeometry = {
          job: rejected,
          variant: rejectedVariant,
          path: verifiedRejected.path,
          geometryHash: verifiedRejected.inspection.geometryHash,
          sha256: verifiedRejected.inspection.sha256,
          correctivePrompt: spec.prompt.trim(),
          retainedAncestry,
          replacementKind: "fresh-root-regeneration",
        };
      } else {
        const resolved = await this.resolveNearestApprovedGeometryAncestor(rejected);
        if (effectiveParentJobId && effectiveParentJobId !== resolved.ancestor.id) {
          throw new Error("The supplied correction parent is not the nearest verified approved Hunyuan ancestor.");
        }
        effectiveParentJobId = resolved.ancestor.id;
        rejectedCandidate = {
          job: rejected,
          variant: rejectedVariant,
          path: verifiedRejected.path,
          geometryHash: verifiedRejected.inspection.geometryHash,
          sha256: verifiedRejected.inspection.sha256,
          ancestor: resolved.ancestor,
          retainedAncestry: resolved.retainedAncestry,
        };
      }
    }
    if (!rejectedGeometry || rejectedGeometry.replacementKind !== "fresh-root-regeneration") {
      if (effectiveParentJobId || request.conceptChangeReason) {
      if (!effectiveParentJobId || !request.conceptChangeReason) throw new Error("Concept ancestry requires the exact retained parent and explicit change action.");
      parent = this.jobs.get(effectiveParentJobId);
      if (!parent?.conceptAttempt || !supportsConceptWorkflow(parent.spec)) throw new Error("The retained parent concept is unavailable.");
      const permittedParent = parent.state === "awaiting-concept-approval" || parent.state === "failed"
        || (request.shapeRefinement === true && request.conceptChangeReason === "edited" && parent.state === "complete");
      if (!permittedParent) throw new Error("A successor concept requires a pending/rejected concept, or an explicit shape refinement of a completed Hunyuan mesh.");
      if (request.shapeRefinement === true) {
        if (request.conceptChangeReason === "edited" && parent.state === "complete") {
          approvedGeometryParent = parent;
        } else {
          if (parent.shapeRefinement !== true || !parent.parentJobId) {
            throw new Error("A replacement refinement concept is missing its approved geometry parent.");
          }
          approvedGeometryParent = this.jobs.get(parent.parentJobId);
          if (!approvedGeometryParent || approvedGeometryParent.state !== "complete"
            || (approvedGeometryParent.assetId ?? approvedGeometryParent.id) !== (parent.assetId ?? parent.id)) {
            throw new Error("A replacement refinement concept does not retain its exact approved geometry parent.");
          }
        }
      }
      if (rejectedCandidate) {
        if (parent.id !== rejectedCandidate.ancestor.id) throw new Error("Resolved correction ancestry changed before the successor was retained.");
        const promptPrefix = `${rejectedCandidate.job.spec.prompt.trim()}\n\nShape refinement: `;
        if (!spec.prompt.startsWith(promptPrefix)) {
          throw new Error("Corrective refinement must retain the rejected brief and append the new shape instruction.");
        }
        const correctivePrompt = spec.prompt.slice(promptPrefix.length).trim();
        if (!correctivePrompt || rejectedCandidate.job.spec.seed >= 0x7fffffff) {
          throw new Error("Corrective refinement needs a non-empty prompt and an available successor seed.");
        }
        const expectedCorrectionSpec = withObjectRules(assertSpec({
          ...sanitizeAssetSpec(rejectedCandidate.job.spec),
          prompt: `${rejectedCandidate.job.spec.prompt.trim()}\n\nShape refinement: ${correctivePrompt}`,
          seed: rejectedCandidate.job.spec.seed + 1,
          variants: 1,
          generateTextures: false,
          objectRules: undefined,
          coordinateContract: { ...rejectedCandidate.job.spec.coordinateContract, origin: "ground-center" },
        }));
        if (stableJson(expectedCorrectionSpec) !== stableJson(spec)) {
          throw new Error("Corrective refinement may change only the prompt and next seed of the rejected geometry brief.");
        }
        rejectedGeometry = {
          job: rejectedCandidate.job,
          variant: rejectedCandidate.variant,
          path: rejectedCandidate.path,
          geometryHash: rejectedCandidate.geometryHash,
          sha256: rejectedCandidate.sha256,
          correctivePrompt,
          retainedAncestry: rejectedCandidate.retainedAncestry,
          replacementKind: "approved-ancestor-refinement",
          approvedAncestorJobId: parent.id,
        };
      }
      if (request.shapeRefinement === true) {
        const geometryParent = approvedGeometryParent!;
        const verifiedParent = await this.verifyGenerationVariant(geometryParent, 0);
        const parentVariant = verifiedParent.variant;
        await this.verifyRetainedVisualApproval(
          parentVariant.visualApproval,
          parentVariant.visualApprovalPath,
          parentVariant.visualApprovalSha256,
          {
            version: 1,
            stage: "geometry",
            assetId: geometryParent.assetId ?? geometryParent.id,
            jobId: geometryParent.id,
            assetPath: verifiedParent.path,
            assetSha256: verifiedParent.inspection.sha256,
            geometryHash: verifiedParent.inspection.geometryHash,
            promptSha256: workflowPromptSha256(geometryParent.spec.prompt),
            specFingerprint: workflowSpecFingerprint(sanitizeAssetSpec(geometryParent.spec)),
          },
        );
      }
      if (request.conceptChangeReason === "regenerated") {
        const expected = withObjectRules(assertSpec({
          ...nextConceptRetrySpec(parent.spec),
          coordinateContract: { ...parent.spec.coordinateContract, origin: "ground-center" },
        }));
        if (stableJson(expected) !== stableJson(spec)) throw new Error("Concept regeneration must preserve the brief and increment the seed exactly once.");
      } else {
        const editedAttemptParent = rejectedCandidate?.job ?? parent;
        if (spec.prompt === editedAttemptParent.spec.prompt) {
          throw new Error("Edit the saved brief before starting a replacement concept.");
        }
        if (editedAttemptParent.spec.seed >= 0x7fffffff || spec.seed !== editedAttemptParent.spec.seed + 1) {
          throw new Error("An edited concept must increment the retained seed exactly once.");
        }
      }
      }
    }
    const inheritedReferenceJob = (parent && jobReferenceImages(parent).length > 0)
      ? parent
      : (approvedGeometryParent && jobReferenceImages(approvedGeometryParent).length > 0)
        ? approvedGeometryParent
        : (rejectedGeometry && jobReferenceImages(rejectedGeometry.job).length > 0)
          ? rejectedGeometry.job
          : undefined;
    if (inheritedReferenceJob) await this.verifyRetainedReferenceImage(inheritedReferenceJob);
    const expectedReferences = specReferenceImages(spec);
    const requestedReferences = request.referenceImages ?? (request.referenceImage ? [request.referenceImage] : undefined);
    if (requestedReferences && expectedReferences.length === 0) {
      throw new Error("Selected reference images must be retained in the exact AssetSpec.");
    }
    if (request.referenceImages) assertPrompt3DReferenceImageSet(request.referenceImages, request.referenceImage);
    if (requestedReferences && !prompt3DReferenceImageSetMatches(requestedReferences, expectedReferences)) {
      throw new Error("Reference-image selection is stale for the exact AssetSpec.");
    }
    const inheritedReferences = inheritedReferenceJob ? jobReferenceImages(inheritedReferenceJob) : [];
    const referenceSelections: Prompt3DReferenceImageSelection[] | undefined = requestedReferences
      ?? (expectedReferences.length > 0 && inheritedReferences.length > 0
        ? inheritedReferences.map((image) => ({ ...image, sourcePath: image.path }))
        : undefined);
    if (expectedReferences.length > 0 && !referenceSelections) {
      throw new Error("Reselect the exact local reference images before starting this root generation.");
    }
    if (expectedReferences.length === 0 && inheritedReferences.length > 0) {
      throw new Error("Concept ancestry cannot silently remove its hash-bound reference images.");
    }
    // Compile the final, ancestry-checked spec before creating retained job
    // storage. A recoverable CLIP-budget error must not leave an empty job
    // directory that looks like accepted generation evidence.
    const promptPlan = compilePrompt3DPrompt(spec);
    await requirePrompt3DOutputSpace(this.root, prompt3DGenerationOutputStage(conceptWorkflow, false));
    const id = randomUUID(), outputDirectory = contained(this.root, join(this.root, "jobs", id));
    await mkdir(outputDirectory, { recursive: true });
    const now = new Date().toISOString();
    const lineageParent = request.shapeRefinement === true ? approvedGeometryParent : parent;
    const job: Prompt3DJobStatus = {
      id,
      assetId: lineageParent?.assetId ?? parent?.assetId ?? lineageParent?.id ?? parent?.id ?? id,
      ...(lineageParent ? { parentJobId: lineageParent.id } : {}),
      ...(parent && lineageParent && parent.id !== lineageParent.id ? { conceptParentJobId: parent.id } : {}),
      ...(request.shapeRefinement === true ? { shapeRefinement: true } : {}),
      ...(rejectedGeometry ? { rejectedGeometryJobId: rejectedGeometry.job.id } : {}),
      state: "running", stage: "compliance", progress: 1, providerId: spec.providerId, spec,
      message: "Job accepted · measuring GPU, WSL and current headroom.", outputDirectory, variants: [], createdAt: now, updatedAt: now,
      timings: [{ stage: "job-acceptance", status: "complete", startedAt: now, completedAt: now, elapsedMs: 0, message: "Job accepted and retained before preflight began." }],
    };
    job.conceptOnly = conceptWorkflow;
    job.approvedConcept = conceptWorkflow ? false : undefined;
    job.promptPlan = promptPlan;
    if (referenceSelections) {
      if (spec.referenceImages) {
        job.referenceImages = await retainPrompt3DReferenceImages(referenceSelections, outputDirectory);
        job.referenceImage = job.referenceImages.find((image) => image.view === "front");
      } else {
        job.referenceImage = await retainPrompt3DReferenceImage(referenceSelections[0], outputDirectory);
      }
    }
    if (parent && request.conceptChangeReason) {
      const history = inheritConceptHistory(parent, id, request.conceptChangeReason, now, spec);
      job.conceptAttempts = history.attempts;
      job.conceptDecisions = history.decisions;
      job.conceptInspections = history.inspections;
    }
    if (rejectedGeometry) {
      const rejection: Prompt3DGeometryRejection = {
        version: 1,
        source: "explicit-user-action",
        replacementKind: rejectedGeometry.replacementKind,
        rejectedAt: now,
        jobId: rejectedGeometry.job.id,
        assetId: rejectedGeometry.job.assetId ?? rejectedGeometry.job.id,
        variantIndex: rejectedGeometry.variant.index,
        assetPath: rejectedGeometry.path,
        assetSha256: rejectedGeometry.sha256,
        geometryHash: rejectedGeometry.geometryHash,
        ...(rejectedGeometry.approvedAncestorJobId ? { approvedAncestorJobId: rejectedGeometry.approvedAncestorJobId } : {}),
        successorJobId: id,
        correctivePrompt: rejectedGeometry.correctivePrompt,
        correctivePromptSha256: workflowPromptSha256(rejectedGeometry.correctivePrompt),
        successorSpecFingerprint: workflowSpecFingerprint(sanitizeAssetSpec(spec)),
        retainedAncestry: rejectedGeometry.retainedAncestry,
      };
      const rejectionPath = contained(rejectedGeometry.job.outputDirectory, join(rejectedGeometry.job.outputDirectory, "variant-1", "visual-rejection.json"));
      const rejectionBytes = Buffer.from(`${JSON.stringify(rejection, null, 2)}\n`, "utf8");
      await writeFile(rejectionPath, rejectionBytes, { flag: "wx", mode: 0o600 });
      Object.assign(rejectedGeometry.job, {
        geometryRejection: rejection,
        geometryRejectionPath: rejectionPath,
        geometryRejectionSha256: sha256Hex(rejectionBytes),
      });
      this.publishJob(rejectedGeometry.job);
    }
    this.jobs.set(id, job);
    await this.writeRecordedSpecs(job);
    this.publishJob(job);
    try {
      await this.preflightAndDispatch(job);
    } catch (error) {
      this.failJob(job, error);
      throw error;
    }
    return job;
  }

  private async preflightAndDispatch(job: Prompt3DJobStatus) {
    await this.verifyRetainedReferenceImage(job);
    const provider = localProvider(job.providerId);
    const readiness = this.beginTiming(job, "hardware-readiness", "Measuring GPU headroom and starting/probing the configured WSL runtime.");
    const hardware = await measurePrompt3DHardware(this.root, true);
    if (this.jobCancelled(job)) return;
    this.finishTiming(job, "hardware-readiness", readiness.startedAt, readiness.startedMs, "GPU, platform and WSL readiness measured.");
    assertPrompt3DOutputSpace(
      this.root,
      hardware.disk.freeBytes,
      prompt3DGenerationOutputStage(supportsConceptWorkflow(job.spec), Boolean(job.conceptApproval)),
    );
    if (hardware.wsl.runtimeProbe) {
      const completedAt = hardware.wsl.runtimeProbe.measuredAt;
      const elapsedMs = hardware.wsl.runtimeProbe.elapsedMs;
      job.timings = [...(job.timings ?? []), {
        stage: "wsl-start-runtime", status: "complete",
        startedAt: new Date(Date.parse(completedAt) - elapsedMs).toISOString(), completedAt, elapsedMs,
        message: `${hardware.wsl.runtimeProbe.distribution} started/probed as a normal CUDA-capable user.`,
      }];
      this.publishJob(job);
    }
    const verification = this.beginTiming(job, "signed-provider-verification", "Checking the signed manifest, pinned revisions, model inventory and environment locks.");
    // Acceptance runs bind their output to a fresh deep provider verification.
    // This measures the installed model/runtime bytes instead of trusting only
    // the signed inventory metadata retained during installation.
    const integrity = await this.installer.verify(provider.id as LocalPrompt3DProviderId, true);
    if (this.jobCancelled(job)) return;
    this.finishTiming(job, "signed-provider-verification", verification.startedAt, verification.startedMs, integrity.reason, integrity.ok ? "complete" : "failed");
    const compliance = evaluatePrompt3DCompliance(provider, hardware, this.root, "pre-run", job.spec);
    if (!integrity.ok) throw new Error(`setup-required: ${integrity.reason}`);
    job.providerVerification = await this.captureProviderVerification(provider.id as LocalPrompt3DProviderId, integrity.reason);
    if (this.jobCancelled(job)) return;
    if (!compliance.canRun) throw new Error(`${compliance.state}: ${compliance.reasons.join(" ")}`);
    if (job.providerId === "hunyuan3d-2") {
      if (!compliance.executionProfile) throw new Error("Hunyuan compliance did not select a runnable geometry profile.");
      hunyuanExecutionSettings(compliance.executionProfile, "geometry");
      job.executionProfile = compliance.executionProfile;
      await this.writeRecordedSpecs(job);
    }
    job.stage = "queued";
    job.progress = job.conceptApproval ? 36 : 5;
    const profileLabel = job.executionProfile ? ` using ${job.executionProfile.label}` : "";
    job.message = job.conceptApproval
      ? `Approval verified · starting the loopback-only geometry sidecar${profileLabel}.`
      : `Preflight passed · starting the loopback-only sidecar${profileLabel}.`;
    this.publishJob(job);
    void this.runJob(job, hardware.wsl.usableLinuxDistribution ?? undefined).catch((error) => this.failJob(job, error));
  }

  private async runJob(job: Prompt3DJobStatus, wslDistro?: string) {
    const deadline = Date.now() + JOB_TIMEOUT_MS;
    const variants: Prompt3DJobStatus["variants"] = [];
    for (let index = 0; index < job.spec.variants; index += 1) {
      if (this.jobCancelled(job)) return;
      const variantDirectory = join(job.outputDirectory, `variant-${index + 1}`);
      await mkdir(variantDirectory, { recursive: true });
      if (this.jobCancelled(job)) return;
      await this.verifyRetainedReferenceImage(job);
      if (supportsConceptWorkflow(job.spec) && job.conceptApproval) {
        const conceptSha256 = await this.retainedConceptHash(job);
        if (this.jobCancelled(job)) return;
        if (hasStructuredConceptProtocol(job.conceptAttempt)) await this.verifyConceptInspection(job, "approved");
        assertGeometryApproval(job.id, job.spec, job.conceptAttempt, job.conceptApproval, conceptSha256, job.conceptInspection);
      }
      const variantSpec = this.recordedSpec(job, job.spec.seed + index);
      const variantSpecPath = join(variantDirectory, "asset-spec.json");
      await this.writeJsonAtomic(variantSpecPath, variantSpec);
      if (this.jobCancelled(job)) return;
      const raw = join(variantDirectory, "provider-output.glb"), sidecarId = `${job.id}-${index + 1}`;
      this.activeSidecarJobs.set(job.id, sidecarId);
      job.message = `Starting variant ${index + 1} of ${job.spec.variants}.`; this.publishJob(job);
      let runtime: Record<string, string>;
      if (job.providerId === "trellis" || job.providerId === "hunyuan3d-2") {
        if (!wslDistro) throw new Error(`${localProvider(job.providerId).name} requires its configured normal WSL Linux distribution.`);
        runtime = { wslDistro, providerRootName: `${job.providerId}-${localProvider(job.providerId).sourceRevision.slice(0, 12)}` };
      } else runtime = { python: this.pythonFor("hunyuan3d-2") };
      const sidecarTiming = this.beginTiming(job, "sidecar-health", "Starting or reusing the loopback sidecar and checking its health.");
      const sidecarHealth = await this.sidecarRequest("/health") as { ok?: boolean; binding?: string };
      if (this.jobCancelled(job)) return;
      if (!sidecarHealth.ok || sidecarHealth.binding !== "127.0.0.1") throw new Error("Prompt-to-3D sidecar health contract failed.");
      this.finishTiming(job, "sidecar-health", sidecarTiming.startedAt, sidecarTiming.startedMs, "Loopback sidecar is healthy and ready.");
      await this.sidecarRequest("/jobs", { method: "POST", body: JSON.stringify({ jobId: sidecarId, providerId: job.providerId, specPath: variantSpecPath, output: raw, ...runtime }) });
      if (this.jobCancelled(job)) {
        await this.sidecarRequest(`/jobs/${sidecarId}/cancel`, { method: "POST", body: "{}" }).catch(() => undefined);
        return;
      }
      for (;;) {
        if (this.jobCancelled(job)) return;
        if (Date.now() > deadline) { await this.cancel("internal", job.id, true); throw new Error("Generation exceeded the 90-minute timeout."); }
        await new Promise((r) => setTimeout(r, 1_000));
        if (this.jobCancelled(job)) return;
        const state: any = await this.sidecarRequest(`/jobs/${sidecarId}`);
        if (this.jobCancelled(job)) return;
        this.mergeProviderTimings(job, state.timings);
        const providerProgress = Math.min(90, state.progress ?? 0);
        const retainedApprovalFloor = job.conceptApproval ? 36 : 0;
        const remainingProviderRange = 90 - retainedApprovalFloor;
        const overall = Math.round(retainedApprovalFloor
          + ((index + providerProgress / 100) / job.spec.variants) * remainingProviderRange);
        if (existsSync(join(variantDirectory, "concept.png"))) job.conceptImagePath = join(variantDirectory, "concept.png");
        Object.assign(job, { stage: state.stage ?? job.stage, progress: overall, message: `Variant ${index + 1}/${job.spec.variants}: ${state.message ?? job.message}`, updatedAt: new Date().toISOString() }); this.publishJob(job);
        if (state.state === "failed") {
          if (String(state.error ?? "").startsWith("CONCEPT_REVIEW_REQUIRED:") && job.conceptImagePath) {
            await this.retainConceptAttempt(job, variantDirectory, "needs-regeneration", String(state.reviewMessage ?? state.error));
          }
          throw new Error(state.error || "Provider generation failed.");
        }
        if (state.state === "cancelled") { this.activeSidecarJobs.delete(job.id); job.state = "cancelled"; job.stage = "cancelled"; this.publishJob(job); return; }
        if (state.state === "complete") break;
      }
      if (supportsConceptWorkflow(job.spec) && !job.conceptApproval) {
        if (!job.conceptImagePath) throw new Error("No concept image was produced.");
        await this.retainConceptAttempt(job, variantDirectory, "pass");
        if (this.jobCancelled(job)) return;
        this.activeSidecarJobs.delete(job.id);
        Object.assign(job, {
          state: "awaiting-concept-approval",
          stage: "awaiting-concept-approval",
          progress: 35,
          approvedConcept: false,
          message: "Concept retained · awaiting explicit visual approval. Geometry has not started and semantic resemblance is unverified.",
          updatedAt: new Date().toISOString(),
        });
        await this.writeRecordedSpecs(job, variantDirectory);
        if (this.jobCancelled(job)) return;
        this.publishJob(job); return;
      }
      if (supportsConceptWorkflow(job.spec)) {
        const conceptSha256 = await this.retainedConceptHash(job);
        if (this.jobCancelled(job)) return;
        if (hasStructuredConceptProtocol(job.conceptAttempt)) await this.verifyConceptInspection(job, "approved");
        assertGeometryApproval(job.id, job.spec, job.conceptAttempt, job.conceptApproval, conceptSha256, job.conceptInspection);
      }
      const rawLinkInfo = await lstat(raw);
      const rawInfo = await stat(raw);
      if (this.jobCancelled(job)) return;
      if (rawLinkInfo.isSymbolicLink() || !rawInfo.isFile() || rawInfo.size <= 0 || rawInfo.size > MAX_PROVIDER_OUTPUT_BYTES) throw new Error("Provider GLB is a link, empty or exceeds the 1 GiB output limit.");
      await measureTaskTree(variantDirectory);
      if (this.jobCancelled(job)) return;
      job.stage = "postprocess"; job.message = `Applying the canonical contract to variant ${index + 1}.`; this.publishJob(job);
      const postprocessTiming = this.beginTiming(job, "post-process", `Applying the canonical contract to variant ${index + 1}.`);
      const finalPath = join(variantDirectory, "asset.glb"); await postprocessPrompt3DGlb(raw, finalPath, variantSpec);
      if (this.jobCancelled(job)) return;
      this.finishTiming(job, "post-process", postprocessTiming.startedAt, postprocessTiming.startedMs, "Canonical post-processing complete.");
      // Keep the original mesh beside the finished version for visual comparison
      // and lossless reprocessing. New generations always use new job folders.
      await rm(join(variantDirectory, "trellis-runtime-model"), { recursive: true, force: true });
      if (this.jobCancelled(job)) return;
      job.stage = "validation"; this.publishJob(job);
      const validationTiming = this.beginTiming(job, "validation", "Running deterministic structure, geometry, scale and budget validation.");
      const report = await validatePrompt3DGlb(finalPath, variantSpec, join(this.root, "quarantine"));
      if (this.jobCancelled(job)) return;
      this.finishTiming(job, "validation", validationTiming.startedAt, validationTiming.startedMs, `Validation ${report.gameReady ? "passed" : "quarantined the asset"} · ${report.deterministicId.slice(0, 12)}.`);
      const retainedPath = report.quarantinedPath ?? finalPath;
      const retainedInspection = await inspectWorkflowGlb(retainedPath);
      const retainedInfo = await stat(retainedPath);
      const validationReportSha256 = sha256Hex(stableJson(report));
      const conceptSha256 = supportsConceptWorkflow(job.spec) ? await this.retainedConceptHash(job) : "";
      if (this.jobCancelled(job)) return;
      const approvalFields = approvalProvenanceFields(job.id, job.spec, job.conceptAttempt, job.conceptApproval, conceptSha256, job.conceptInspection);
      let parentGeneration: {
        jobId: string;
        promptSha256: string;
        outputSha256: string;
        geometryHash: string;
        provenanceSha256: string;
        visualApprovalSha256: string;
      } | undefined;
      if (job.shapeRefinement === true) {
        if (!job.parentJobId) throw new Error("Prompted Hunyuan shape refinement is missing its approved base-generation parent.");
        const parentJob = this.jobs.get(job.parentJobId);
        if (!parentJob) throw new Error("Prompted Hunyuan shape-refinement parent is unavailable.");
        const parentVerified = await this.verifyGenerationVariant(parentJob, 0);
        await this.verifyRetainedVisualApproval(
          parentVerified.variant.visualApproval,
          parentVerified.variant.visualApprovalPath,
          parentVerified.variant.visualApprovalSha256,
          {
            version: 1,
            stage: "geometry",
            assetId: parentJob.assetId ?? parentJob.id,
            jobId: parentJob.id,
            assetPath: parentVerified.path,
            assetSha256: parentVerified.inspection.sha256,
            geometryHash: parentVerified.inspection.geometryHash,
            promptSha256: workflowPromptSha256(parentJob.spec.prompt),
            specFingerprint: workflowSpecFingerprint(sanitizeAssetSpec(parentJob.spec)),
          },
        );
        parentGeneration = {
          jobId: parentJob.id,
          promptSha256: workflowPromptSha256(parentJob.spec.prompt),
          outputSha256: parentVerified.inspection.sha256,
          geometryHash: parentVerified.inspection.geometryHash,
          provenanceSha256: parentVerified.provenanceSha256,
          visualApprovalSha256: parentVerified.variant.visualApprovalSha256!,
        };
      }
      const provenance = {
        createdAt: new Date().toISOString(),
        specVersion: variantSpec.version,
        provider: localProvider(job.providerId),
        prompt: variantSpec.prompt,
        promptPlan: variantSpec.promptPlan,
        objectRules: variantSpec.objectRules,
        seed: variantSpec.seed,
        offline: true,
        validationId: report.deterministicId,
        validationReportSha256,
        specFingerprint: workflowSpecFingerprint(sanitizeAssetSpec(variantSpec)),
        ...approvalFields,
        conceptAttempts: job.conceptAttempts ?? [],
        conceptDecisions: job.conceptDecisions ?? [],
        conceptInspections: job.conceptInspections ?? [],
        assetId: job.assetId ?? job.id,
        parentJobId: job.parentJobId,
        conceptParentJobId: job.conceptParentJobId,
        shapeRefinement: job.shapeRefinement === true,
        ...(parentGeneration ? { parentGeneration } : {}),
        method: job.providerId === "hunyuan3d-2" ? "hunyuan3d-neural-generation" : `${job.providerId}-neural-generation`,
        providerVerification: job.providerVerification,
        executionProfile: job.executionProfile,
        ...(job.referenceImage ? { referenceImage: job.referenceImage } : {}),
        ...(job.referenceImages ? { referenceImages: job.referenceImages } : {}),
        output: {
          path: retainedPath,
          sha256: retainedInspection.sha256,
          geometryHash: retainedInspection.geometryHash,
          byteSize: retainedInfo.size,
          technicalValidationId: report.deterministicId,
        },
        sourceAssets: [],
      };
      const provenancePath = join(variantDirectory, "provenance.json");
      const provenanceBytes = `${JSON.stringify(provenance, null, 2)}\n`;
      await writeFile(provenancePath, provenanceBytes);
      if (this.jobCancelled(job)) return;
      variants.push({
        index,
        glbPath: retainedPath,
        report,
        provenancePath,
        sha256: retainedInspection.sha256,
        geometryHash: retainedInspection.geometryHash,
        byteSize: retainedInfo.size,
        validationReportSha256,
        provenanceSha256: sha256Hex(provenanceBytes),
      });
      job.variants = [...variants]; this.publishJob(job);
    }
    if (this.jobCancelled(job)) return;
    this.activeSidecarJobs.delete(job.id);
    const allReady = variants.length === job.spec.variants && variants.every((variant) => variant.report.gameReady);
    job.state = allReady ? "complete" : "failed"; job.stage = allReady ? "complete" : "quarantine"; job.progress = 100;
    job.message = allReady ? `${variants.length} variant${variants.length === 1 ? "" : "s"} passed technical checks. Visual review is required.` : "One or more variants failed validation; failed assets were quarantined and nothing was published or uploaded.";
    if (!allReady) job.error = { code: "VALIDATION_FAILED", message: job.message, retryable: true };
    job.updatedAt = new Date().toISOString(); this.publishJob(job);
  }

  private async verifyGenerationVariant(job: Prompt3DJobStatus, variantIndex = 0) {
    if (job.state !== "complete" || job.providerId !== "hunyuan3d-2" || !job.conceptApproval) {
      throw new Error("Finishing requires a completed, explicitly concept-approved Hunyuan generation.");
    }
    await this.verifyRetainedReferenceImage(job);
    if (hasStructuredConceptProtocol(job.conceptAttempt)) {
      const conceptInspection = await this.verifyConceptInspection(job, "approved");
      const conceptSha256 = await this.retainedConceptHash(job);
      assertGeometryApproval(job.id, job.spec, job.conceptAttempt, job.conceptApproval, conceptSha256, conceptInspection);
    }
    const variant = job.variants.find((candidate) => candidate.index === variantIndex);
    if (!variant?.report.gameReady
      || !variant.sha256
      || !variant.geometryHash
      || !Number.isSafeInteger(variant.byteSize)
      || variant.byteSize < 1
      || !variant.validationReportSha256
      || !variant.provenanceSha256) {
      throw new Error("The selected Hunyuan variant lacks retained output-integrity evidence.");
    }
    if (variant.validationReportSha256 !== sha256Hex(stableJson(variant.report))) {
      throw new Error("The selected Hunyuan validation report no longer matches its retained hash.");
    }
    const path = containedWorkflowPath(this.root, variant.glbPath);
    const link = await lstat(path);
    const info = await stat(path);
    if (link.isSymbolicLink() || !info.isFile() || info.size !== variant.byteSize || info.size > MAX_PROVIDER_OUTPUT_BYTES) {
      throw new Error("Unsafe or changed retained Hunyuan source asset.");
    }
    const inspection = await inspectWorkflowGlb(path);
    if (inspection.sha256 !== variant.sha256 || inspection.geometryHash !== variant.geometryHash) {
      throw new Error("The selected Hunyuan GLB no longer matches its retained byte and geometry identity.");
    }
    const provenancePath = containedWorkflowPath(this.root, variant.provenancePath);
    const provenanceLink = await lstat(provenancePath);
    const provenanceInfo = await stat(provenancePath);
    if (provenanceLink.isSymbolicLink() || !provenanceInfo.isFile() || provenanceInfo.size < 1 || provenanceInfo.size > 2 * 1024 ** 2) {
      throw new Error("Unsafe Hunyuan generation provenance.");
    }
    const provenanceBytes = await readFile(provenancePath);
    if (sha256Hex(provenanceBytes) !== variant.provenanceSha256) {
      throw new Error("Hunyuan generation provenance no longer matches its retained hash.");
    }
    const provenance = JSON.parse(provenanceBytes.toString("utf8")) as Record<string, any>;
    const expectedMethod = "hunyuan3d-neural-generation";
    if (provenance.method !== expectedMethod
      || provenance.provider?.id !== "hunyuan3d-2"
      || provenance.approvedConcept !== true
      || provenance.conceptApproval?.source !== "explicit-user-action"
      || provenance.conceptApproval?.conceptSha256 !== job.conceptApproval.conceptSha256
      || provenance.specFingerprint !== workflowSpecFingerprint(sanitizeAssetSpec(job.spec))
      || provenance.validationReportSha256 !== variant.validationReportSha256
      || provenance.output?.path !== path
      || provenance.output?.sha256 !== inspection.sha256
      || provenance.output?.geometryHash !== inspection.geometryHash
      || provenance.output?.byteSize !== info.size
      || provenance.output?.technicalValidationId !== variant.report.deterministicId
      || provenance.providerVerification?.verificationMode !== "deep"
      || provenance.providerVerification?.providerId !== "hunyuan3d-2"
      || !job.providerVerification
      || stableJson(provenance.providerVerification) !== stableJson(job.providerVerification)
      || !job.executionProfile
      || stableJson(provenance.executionProfile) !== stableJson(job.executionProfile)
      || (hasStructuredConceptProtocol(job.conceptAttempt)
        && (stableJson(provenance.conceptInspection) !== stableJson(job.conceptInspection)
          || stableJson(provenance.conceptInspections) !== stableJson(job.conceptInspections)))) {
      throw new Error("The selected source does not retain complete hash-bound Hunyuan generation provenance.");
    }
    return { variant, path, inspection, provenancePath, provenanceSha256: variant.provenanceSha256, provenance };
  }

  private async verifyRetainedVisualApproval(
    approval: Prompt3DVisualApproval | undefined,
    approvalPath: string | undefined,
    approvalSha256: string | undefined,
    expected: Partial<Prompt3DVisualApproval>,
  ): Promise<Prompt3DVisualApproval> {
    assertVisualApprovalMatches(approval, expected);
    if (!approvalPath || !approvalSha256) throw new Error("Persisted visual-approval evidence is missing.");
    const path = containedWorkflowPath(this.root, approvalPath);
    const link = await lstat(path);
    const info = await stat(path);
    if (link.isSymbolicLink() || !info.isFile() || info.size < 1 || info.size > 256 * 1024) {
      throw new Error("Persisted visual-approval evidence is unsafe.");
    }
    const bytes = await readFile(path);
    if (sha256Hex(bytes) !== approvalSha256) throw new Error("Persisted visual-approval evidence failed SHA-256 verification.");
    const retained = JSON.parse(bytes.toString("utf8")) as Prompt3DVisualApproval;
    assertVisualApprovalMatches(retained, expected);
    if (stableJson(retained) !== stableJson(approval)) throw new Error("Visual approval history and retained evidence disagree.");
    return retained;
  }

  private async conceptAncestryEvidence(job: Prompt3DJobStatus): Promise<Prompt3DGeometryRejection["retainedAncestry"][number]> {
    if (!job.conceptAttempt || !supportsConceptWorkflow(job.spec)) {
      throw new Error("Hunyuan refinement ancestry is missing a retained concept attempt.");
    }
    const conceptSha256 = await this.retainedConceptHash(job);
    assertConceptAttemptBinding(job.id, job.spec, job.conceptAttempt, conceptSha256);
    const conceptParentJobId = job.conceptParentJobId ?? job.parentJobId;
    return {
      jobId: job.id,
      ...(conceptParentJobId ? { parentJobId: conceptParentJobId } : {}),
      state: job.state,
      attemptId: job.conceptAttempt.binding.attemptId,
      conceptSha256,
      specFingerprint: job.conceptAttempt.binding.specFingerprint,
    };
  }

  private assertConceptAncestryLink(child: Prompt3DJobStatus, parent: Prompt3DJobStatus): void {
    if ((child.conceptParentJobId ?? child.parentJobId) !== parent.id
      || (child.assetId ?? child.id) !== (parent.assetId ?? parent.id)) {
      throw new Error("Hunyuan refinement ancestry crosses an asset boundary or has a forged parent link.");
    }
    if (!parent.conceptAttempt || !child.conceptAttempts?.some((attempt) => stableJson(attempt) === stableJson(parent.conceptAttempt))) {
      throw new Error("Hunyuan refinement ancestry does not retain its exact parent concept attempt.");
    }
    const decisions = (child.conceptDecisions ?? []).filter((decision) => decision.jobId === parent.id && decision.nextJobId === child.id);
    if (decisions.length !== 1
      || decisions[0].attemptId !== parent.conceptAttempt.binding.attemptId
      || decisions[0].source !== "explicit-user-action"
      || !["edited", "regenerated"].includes(decisions[0].kind)
      || !Number.isFinite(Date.parse(decisions[0].at))) {
      throw new Error("Hunyuan refinement ancestry lacks one exact explicit parent-to-successor decision.");
    }
    if (hasStructuredConceptProtocol(parent.conceptAttempt)) {
      const decision = decisions[0];
      const evidence = parent.conceptAttempt.technicalReview.status === "needs-regeneration"
        ? { sha256: parent.conceptAttempt.technicalReview.reportSha256, path: parent.conceptAttempt.technicalReview.reportPath }
        : parent.conceptInspection;
      if (!evidence
        || decision.inspectionSha256 !== evidence.sha256
        || decision.inspectionPath !== evidence.path
        || decision.nextPrompt !== child.spec.prompt
        || decision.nextPromptSha256 !== sha256Hex(child.spec.prompt)
        || decision.nextPromptPlanSha256 !== sha256Hex(stableJson(child.promptPlan ?? compilePrompt3DPrompt(child.spec)))
        || decision.nextPresentationContractSha256 !== sha256Hex(stableJson((child.promptPlan ?? compilePrompt3DPrompt(child.spec)).presentationContract))
        || decision.nextSeed !== child.spec.seed
        || decision.nextSpecFingerprint !== sha256Hex(conceptSpecCanonical(child.spec))) {
        throw new Error("Hunyuan refinement ancestry decision does not bind the exact successor prompt, plan, seed and review evidence.");
      }
    }
  }

  private async resolveFreshRootCorrectionAncestry(
    rejected: Prompt3DJobStatus,
  ): Promise<Prompt3DGeometryRejection["retainedAncestry"]> {
    const retainedAncestry: Prompt3DGeometryRejection["retainedAncestry"] = [await this.conceptAncestryEvidence(rejected)];
    const visited = new Set<string>([rejected.id]);
    let child = rejected;
    for (;;) {
      const parentJobId = child.conceptParentJobId ?? child.parentJobId;
      if (!parentJobId) break;
      if (visited.has(parentJobId)) throw new Error("Hunyuan fresh-root ancestry contains a cycle.");
      visited.add(parentJobId);
      if (visited.size > 128) throw new Error("Hunyuan fresh-root ancestry exceeds the retained audit limit.");
      const parent = this.jobs.get(parentJobId);
      if (!parent || parent.providerId !== "hunyuan3d-2" || !supportsConceptWorkflow(parent.spec)) {
        throw new Error("Hunyuan fresh-root ancestry contains a missing or non-Hunyuan parent.");
      }
      this.assertConceptAncestryLink(child, parent);
      retainedAncestry.push(await this.conceptAncestryEvidence(parent));
      const hasAnyVisualApproval = parent.variants.some((variant) => Boolean(
        variant.visualApproval || variant.visualApprovalPath || variant.visualApprovalSha256,
      ));
      if (hasAnyVisualApproval) {
        throw new Error("Fresh-root correction cannot replace geometry descended from an explicitly approved geometry revision.");
      }
      if (parent.variants.length > 0 || parent.state === "complete") {
        throw new Error("Fresh-root correction cannot skip an earlier completed or retained geometry revision.");
      }
      if (parent.state !== "failed" && parent.state !== "awaiting-concept-approval") {
        throw new Error("Only retained failed or awaiting concept attempts may precede fresh base geometry.");
      }
      child = parent;
    }
    return retainedAncestry;
  }

  private async resolveNearestApprovedGeometryAncestor(rejected: Prompt3DJobStatus): Promise<{
    ancestor: Prompt3DJobStatus;
    retainedAncestry: Prompt3DGeometryRejection["retainedAncestry"];
  }> {
    const retainedAncestry: Prompt3DGeometryRejection["retainedAncestry"] = [await this.conceptAncestryEvidence(rejected)];
    const visited = new Set<string>([rejected.id]);
    let child = rejected;
    for (;;) {
      const parentJobId = child.conceptParentJobId ?? child.parentJobId;
      if (!parentJobId) break;
      if (visited.has(parentJobId)) throw new Error("Hunyuan refinement ancestry contains a cycle.");
      visited.add(parentJobId);
      if (visited.size > 128) throw new Error("Hunyuan refinement ancestry exceeds the retained audit limit.");
      const parent = this.jobs.get(parentJobId);
      if (!parent || parent.providerId !== "hunyuan3d-2" || !supportsConceptWorkflow(parent.spec)) {
        throw new Error("Hunyuan refinement ancestry contains a missing or non-Hunyuan parent.");
      }
      this.assertConceptAncestryLink(child, parent);
      retainedAncestry.push(await this.conceptAncestryEvidence(parent));
      const variant = parent.variants.find((candidate) => candidate.index === 0);
      const hasAnyVisualApproval = Boolean(variant?.visualApproval || variant?.visualApprovalPath || variant?.visualApprovalSha256);
      if (hasAnyVisualApproval) {
        if (parent.state !== "complete" || !variant?.visualApproval || !variant.visualApprovalPath || !variant.visualApprovalSha256) {
          throw new Error("Hunyuan refinement ancestry contains inconsistent visual-approval evidence.");
        }
        const verified = await this.verifyGenerationVariant(parent, 0);
        await this.verifyRetainedVisualApproval(
          verified.variant.visualApproval,
          verified.variant.visualApprovalPath,
          verified.variant.visualApprovalSha256,
          {
            version: 1,
            stage: "geometry",
            assetId: parent.assetId ?? parent.id,
            jobId: parent.id,
            assetPath: verified.path,
            assetSha256: verified.inspection.sha256,
            geometryHash: verified.inspection.geometryHash,
            promptSha256: workflowPromptSha256(parent.spec.prompt),
            specFingerprint: workflowSpecFingerprint(sanitizeAssetSpec(parent.spec)),
          },
        );
        return { ancestor: parent, retainedAncestry };
      }
      if (parent.state === "complete") {
        throw new Error("A completed unapproved geometry cannot be silently skipped while resolving correction ancestry.");
      }
      if (parent.state !== "failed" && parent.state !== "awaiting-concept-approval") {
        throw new Error("Only retained failed or concept-only attempts may sit between rejected geometry and its approved ancestor.");
      }
      child = parent;
    }
    throw new Error("No completed, explicitly approved Hunyuan geometry ancestor exists for this rejected result.");
  }

  private async persistVisualApproval(
    path: string,
    binding: Omit<Prompt3DVisualApproval, "approvalId" | "bindingSha256" | "approvedAt" | "source">,
  ): Promise<{ approval: Prompt3DVisualApproval; path: string; sha256: string }> {
    const retainedPath = containedWorkflowPath(this.root, path);
    let approval: Prompt3DVisualApproval;
    let bytes: Buffer;
    if (existsSync(retainedPath)) {
      const link = await lstat(retainedPath);
      const info = await stat(retainedPath);
      if (link.isSymbolicLink() || !info.isFile() || info.size < 1 || info.size > 256 * 1024) throw new Error("Existing visual-approval evidence is unsafe.");
      bytes = await readFile(retainedPath);
      approval = JSON.parse(bytes.toString("utf8")) as Prompt3DVisualApproval;
      assertVisualApprovalMatches(approval, binding);
    } else {
      approval = createPrompt3DVisualApproval(binding);
      bytes = Buffer.from(`${JSON.stringify(approval, null, 2)}\n`, "utf8");
      await writeFile(retainedPath, bytes, { flag: "wx", mode: 0o600 });
    }
    return { approval, path: retainedPath, sha256: sha256Hex(bytes) };
  }

  private async persistFinishVisualRejection(
    path: string,
    binding: Omit<Prompt3DFinishVisualRejection, "rejectionId" | "bindingSha256" | "rejectedAt" | "source">,
  ): Promise<{ rejection: Prompt3DFinishVisualRejection; path: string; sha256: string }> {
    const retainedPath = containedWorkflowPath(this.root, path);
    let rejection: Prompt3DFinishVisualRejection;
    let bytes: Buffer;
    if (existsSync(retainedPath)) {
      const link = await lstat(retainedPath);
      const info = await stat(retainedPath);
      if (link.isSymbolicLink() || !info.isFile() || info.size < 1 || info.size > 256 * 1024) throw new Error("Existing visual-rejection evidence is unsafe.");
      bytes = await readFile(retainedPath);
      rejection = JSON.parse(bytes.toString("utf8")) as Prompt3DFinishVisualRejection;
      assertFinishVisualRejectionMatches(rejection, binding);
    } else {
      rejection = createPrompt3DFinishVisualRejection(binding);
      bytes = Buffer.from(`${JSON.stringify(rejection, null, 2)}\n`, "utf8");
      await writeFile(retainedPath, bytes, { flag: "wx", mode: 0o600 });
    }
    return { rejection, path: retainedPath, sha256: sha256Hex(bytes) };
  }

  private async verifyRetainedFinishVisualRejection(job: Prompt3DFinishJobStatus): Promise<Prompt3DFinishVisualRejection> {
    if (!job.visualRejection || !job.visualRejectionPath || !job.visualRejectionSha256) {
      throw new Error("The finishing revision has not been explicitly rejected.");
    }
    const path = containedWorkflowPath(this.root, job.visualRejectionPath);
    const expectedPath = containedWorkflowPath(this.root, join(job.outputDirectory, "visual-rejection.json"));
    if (path !== expectedPath) throw new Error("Finishing rejection path does not match its retained job directory.");
    const link = await lstat(path);
    const info = await stat(path);
    if (link.isSymbolicLink() || !info.isFile() || info.size < 1 || info.size > 256 * 1024) throw new Error("Retained finishing rejection is unsafe.");
    const bytes = await readFile(path);
    if (sha256Hex(bytes) !== job.visualRejectionSha256) throw new Error("Retained finishing rejection hash changed.");
    const rejection = JSON.parse(bytes.toString("utf8")) as Prompt3DFinishVisualRejection;
    if (stableJson(rejection) !== stableJson(job.visualRejection)) throw new Error("Retained finishing rejection differs from job history.");
    const inspection = await inspectWorkflowGlb(containedWorkflowPath(this.root, job.assetPath!));
    assertFinishVisualRejectionMatches(rejection, {
      version: 1,
      stage: job.operation,
      assetId: job.assetId,
      jobId: job.id,
      assetPath: job.assetPath,
      assetSha256: inspection.sha256,
      geometryHash: inspection.geometryHash,
      promptSha256: workflowPromptSha256(job.instruction),
      specFingerprint: workflowSpecFingerprint(sanitizeAssetSpec(job.baseSpec)),
      ...(job.operation === "texture"
        ? { textureFingerprint: inspection.textureFingerprint }
        : {
          animationFingerprint: inspection.animationFingerprint,
          animationPlanSha256: stableWorkflowSha256(job.animationPlan ?? {}),
        }),
    });
    return rejection;
  }

  private async retainedGenerationLineageEntry(
    job: Prompt3DJobStatus,
    variantIndex: number,
    parent?: { entry: Prompt3DWorkflowRootLineage; provenance: Record<string, any> },
  ) {
    const verified = await this.verifyGenerationVariant(job, variantIndex);
    const assetId = job.assetId ?? job.id;
    const specFingerprint = workflowSpecFingerprint(sanitizeAssetSpec(job.spec));
    const promptSha256 = workflowPromptSha256(job.spec.prompt);
    const visualApproval = await this.verifyRetainedVisualApproval(
      verified.variant.visualApproval,
      verified.variant.visualApprovalPath,
      verified.variant.visualApprovalSha256,
      {
        version: 1,
        stage: "geometry",
        assetId,
        jobId: job.id,
        assetPath: verified.path,
        assetSha256: verified.inspection.sha256,
        geometryHash: verified.inspection.geometryHash,
        promptSha256,
        specFingerprint,
      },
    );
    if (!job.providerVerification || !job.conceptApproval) throw new Error("Deep Hunyuan provider or concept-approval evidence is missing.");
    if (!Array.isArray(verified.provenance.sourceAssets) || verified.provenance.sourceAssets.length !== 0) {
      throw new Error("Hunyuan generation provenance must prove that no source asset geometry was reused.");
    }
    const references = jobReferenceImages(job);
    if (references.length > 0) {
      if (stableJson(verified.provenance.referenceImage) !== stableJson(job.referenceImage)
        || (job.referenceImages && stableJson(verified.provenance.referenceImages) !== stableJson(job.referenceImages))
        || job.conceptApproval.referenceSha256 !== job.referenceImage?.sha256
        || stableJson(job.conceptApproval.referenceImageBindings ?? []) !== stableJson(conceptReferenceImageBindings(job.spec))) {
        throw new Error("Hunyuan generation provenance does not bind the exact retained reference-image conditioning bytes.");
      }
    } else if (verified.provenance.referenceImage !== undefined
      || verified.provenance.referenceImages !== undefined
      || job.conceptApproval.referenceSha256 !== null
      || (job.conceptApproval.referenceImageBindings?.length ?? 0) > 0) {
      throw new Error("Prompt-only Hunyuan provenance contains unexpected reference-image evidence.");
    }

    const refining = job.shapeRefinement === true;
    if (refining) {
      if (!parent || variantIndex !== 0 || job.parentJobId !== parent.entry.jobId || assetId !== parent.entry.assetId) {
        throw new Error("Prompted Hunyuan shape refinement does not identify its exact approved base-generation parent.");
      }
      const parentGeneration = {
        jobId: parent.entry.jobId,
        promptSha256: parent.entry.promptSha256,
        outputSha256: parent.entry.outputSha256,
        geometryHash: parent.entry.geometryHash,
        provenanceSha256: parent.entry.provenanceSha256,
        visualApprovalSha256: parent.entry.visualApprovalSha256,
      };
      const conceptChain = assertShapeRefinementConceptChain(
        verified.provenance.conceptAttempts,
        verified.provenance.conceptDecisions,
        parent.provenance.conceptApproval,
        verified.provenance.conceptApproval,
      );
      if (verified.provenance.shapeRefinement !== true
        || verified.provenance.parentJobId !== parent.entry.jobId
        || (verified.provenance.conceptParentJobId ?? verified.provenance.parentJobId) !== conceptChain.immediateConceptParentJobId
        || (job.conceptParentJobId ?? job.parentJobId) !== conceptChain.immediateConceptParentJobId
        || stableJson(verified.provenance.parentGeneration) !== stableJson(parentGeneration)
        || promptSha256 === parent.entry.promptSha256
        || verified.inspection.sha256 === parent.entry.outputSha256
        || verified.inspection.geometryHash === parent.entry.geometryHash
        || !Number.isSafeInteger(verified.provenance.seed)
        || !Number.isSafeInteger(parent.provenance.seed)
        || verified.provenance.seed !== verified.provenance.conceptApproval?.seed
        || parent.provenance.seed !== parent.provenance.conceptApproval?.seed) {
        throw new Error("Prompted Hunyuan shape-refinement provenance does not bind a fresh edited/regenerated concept chain and geometry to its approved parent.");
      }
    } else if (parent || verified.provenance.shapeRefinement === true || verified.provenance.parentGeneration !== undefined) {
      throw new Error("The approved base Hunyuan generation contains forged shape-refinement ancestry.");
    }

    const entry: Prompt3DWorkflowRootLineage = {
      version: 1,
      kind: "generation",
      assetId,
      jobId: job.id,
      variantIndex,
      method: "hunyuan3d-neural-generation",
      provider: "hunyuan3d-2",
      providerSourceRevision: job.providerVerification.sourceRevision,
      providerVerification: job.providerVerification,
      executionProfile: job.executionProfile!,
      specFingerprint,
      promptSha256,
      conceptSha256: job.conceptApproval.conceptSha256,
      conceptApprovalSha256: stableWorkflowSha256(job.conceptApproval),
      ...(job.referenceImage ? { referenceSha256: job.referenceImage.sha256 } : {}),
      ...(job.referenceImages ? {
        referenceSha256s: job.referenceImages.map((image) => image.sha256),
        referenceViews: job.referenceImages.map((image) => image.view!),
      } : {}),
      ...(job.conceptInspection ? { conceptInspectionSha256: job.conceptInspection.sha256 } : {}),
      outputPath: verified.path,
      outputSha256: verified.inspection.sha256,
      geometryHash: verified.inspection.geometryHash,
      byteSize: verified.inspection.byteSize,
      provenancePath: verified.provenancePath,
      provenanceSha256: verified.provenanceSha256,
      visualApproval,
      visualApprovalPath: verified.variant.visualApprovalPath!,
      visualApprovalSha256: verified.variant.visualApprovalSha256!,
      shapeRefinement: refining,
      ...(parent ? {
        parentJobId: parent.entry.jobId,
        parentPromptSha256: parent.entry.promptSha256,
        parentOutputSha256: parent.entry.outputSha256,
        parentGeometryHash: parent.entry.geometryHash,
        parentProvenanceSha256: parent.entry.provenanceSha256,
        parentVisualApprovalSha256: parent.entry.visualApprovalSha256,
      } : {}),
    };
    return { entry, verified };
  }

  private async resolveRetainedGenerationChain(
    job: Prompt3DJobStatus,
    variantIndex = 0,
    options: { allowApprovedBase?: boolean } = {},
  ) {
    const reverse: Prompt3DJobStatus[] = [];
    const visited = new Set<string>();
    let cursor = job;
    for (;;) {
      if (visited.has(cursor.id) || visited.size >= 32) throw new Error("Hunyuan shape-refinement generation chain is cyclic or exceeds the retained audit limit.");
      visited.add(cursor.id);
      reverse.push(cursor);
      if (cursor.shapeRefinement !== true) break;
      if (!cursor.parentJobId) throw new Error("Prompted Hunyuan shape refinement is missing its approved generation parent.");
      const parent = this.jobs.get(cursor.parentJobId);
      if (!parent) throw new Error("Prompted Hunyuan shape-refinement parent is unavailable.");
      cursor = parent;
    }
    const jobs = reverse.reverse();
    const approvedBaseOnly = jobs.length === 1
      && jobs[0].shapeRefinement !== true
      && options.allowApprovedBase === true;
    const approvedRefinementChain = jobs.length >= 2
      && jobs[0].shapeRefinement !== true
      && jobs.at(-1)?.shapeRefinement === true;
    if ((!approvedBaseOnly && !approvedRefinementChain) || variantIndex !== 0) {
      throw new Error("Complete finishing requires an approved base Hunyuan generation followed by a prompted refined Hunyuan generation.");
    }
    const generationChain: Prompt3DWorkflowRootLineage[] = [];
    let previous: { entry: Prompt3DWorkflowRootLineage; provenance: Record<string, any> } | undefined;
    let selected: Awaited<ReturnType<Prompt3DService["verifyGenerationVariant"]>> | undefined;
    for (const generationJob of jobs) {
      const retained = await this.retainedGenerationLineageEntry(generationJob, 0, previous);
      generationChain.push(retained.entry);
      previous = { entry: retained.entry, provenance: retained.verified.provenance };
      selected = retained.verified;
    }
    if (!selected) throw new Error("Hunyuan generation chain is unavailable.");
    return { generationChain, root: generationChain.at(-1)!, selected };
  }

  private async verifyFinishLineage(job: Prompt3DFinishJobStatus, requireComplete = false) {
    if (job.state !== "complete" || !job.assetPath || !job.sha256 || !job.geometryHash || !job.validation) {
      throw new Error("The selected workflow revision is incomplete or unavailable.");
    }
    const path = containedWorkflowPath(this.root, job.assetPath);
    const inspection = await inspectWorkflowGlb(path);
    if (inspection.sha256 !== job.sha256 || inspection.geometryHash !== job.geometryHash) {
      throw new Error("The retained workflow revision no longer matches its recorded identity.");
    }
    if (!job.lineagePath || !job.lineageSha256) throw new Error("The workflow revision has no persisted lineage evidence.");
    const lineagePath = containedWorkflowPath(this.root, job.lineagePath);
    const lineageLink = await lstat(lineagePath);
    const lineageInfo = await stat(lineagePath);
    if (lineageLink.isSymbolicLink() || !lineageInfo.isFile() || lineageInfo.size < 1 || lineageInfo.size > 2 * 1024 ** 2) {
      throw new Error("Workflow lineage evidence is unsafe.");
    }
    const lineageBytes = await readFile(lineagePath);
    if (sha256Hex(lineageBytes) !== job.lineageSha256) throw new Error("Workflow lineage evidence failed SHA-256 verification.");
    const lineage = JSON.parse(lineageBytes.toString("utf8")) as Prompt3DWorkflowLineage;
    if (stableJson(lineage) !== stableJson(job.lineage)) throw new Error("Workflow history and persisted lineage disagree.");
    assertPrompt3DWorkflowLineageSeal(lineage);
    if (lineage.version !== 1 || lineage.assetId !== job.assetId) throw new Error("Workflow lineage asset identity is invalid.");

    const rootJob = this.jobs.get(lineage.root.jobId);
    if (!rootJob) throw new Error("Workflow root Hunyuan generation is unavailable.");
    const usesExistingGeneratedModel = prompt3DWorkflowUsesExistingGeneratedModel(lineage);
    const retainedGeneration = await this.resolveRetainedGenerationChain(rootJob, lineage.root.variantIndex, {
      allowApprovedBase: usesExistingGeneratedModel,
    });
    const rootVerified = retainedGeneration.selected;
    if (!Array.isArray(lineage.generationChain)
      || stableJson(lineage.generationChain) !== stableJson(retainedGeneration.generationChain)
      || stableJson(lineage.root) !== stableJson(retainedGeneration.root)) {
      throw new Error("Workflow generation lineage does not prove the retained approved Hunyuan source chain and continuation decision.");
    }

    let previousJobId = lineage.root.jobId;
    let previousSha256 = lineage.root.outputSha256;
    let previousGeometryHash = lineage.root.geometryHash;
    let previousProvenanceSha256 = lineage.root.provenanceSha256;
    let previousTextureFingerprint = rootVerified.inspection.textureFingerprint;
    let animationSeen = false;
    let textureCount = 0;
    let animationCount = 0;
    for (const revision of lineage.revisions) {
      const retainedJob = this.finishJobs.get(revision.jobId);
      if (!retainedJob || retainedJob.state !== "complete" || !retainedJob.assetPath || !retainedJob.sha256
        || !retainedJob.geometryHash || !retainedJob.provenancePath || !retainedJob.validation) {
        throw new Error("A retained workflow lineage revision is unavailable or incomplete.");
      }
      const revisionPath = containedWorkflowPath(this.root, retainedJob.assetPath);
      const revisionInspection = await inspectWorkflowGlb(revisionPath);
      const expectedStage = revision.operation === "texture" ? "texture" : "animation";
      const expectedApproval: Partial<Prompt3DVisualApproval> = {
        version: 1,
        stage: expectedStage,
        assetId: lineage.assetId,
        jobId: retainedJob.id,
        assetPath: revisionPath,
        assetSha256: revisionInspection.sha256,
        geometryHash: revisionInspection.geometryHash,
        promptSha256: workflowPromptSha256(retainedJob.instruction),
        specFingerprint: workflowSpecFingerprint(sanitizeAssetSpec(retainedJob.baseSpec)),
        ...(revision.operation === "texture"
          ? { textureFingerprint: revisionInspection.textureFingerprint }
          : { animationFingerprint: revisionInspection.animationFingerprint }),
      };
      const revisionApproval = await this.verifyRetainedVisualApproval(
        retainedJob.visualApproval,
        retainedJob.visualApprovalPath,
        retainedJob.visualApprovalSha256,
        expectedApproval,
      );
      const provenancePath = containedWorkflowPath(this.root, retainedJob.provenancePath);
      const provenanceLink = await lstat(provenancePath);
      const provenanceInfo = await stat(provenancePath);
      if (provenanceLink.isSymbolicLink() || !provenanceInfo.isFile() || provenanceInfo.size < 1 || provenanceInfo.size > 2 * 1024 ** 2) {
        throw new Error("Workflow revision provenance is unsafe.");
      }
      const provenanceBytes = await readFile(provenancePath);
      const provenanceSha256 = sha256Hex(provenanceBytes);
      const provenance = JSON.parse(provenanceBytes.toString("utf8")) as Record<string, any>;
      if (revision.version !== 1
        || revision.assetId !== lineage.assetId
        || revision.jobId !== retainedJob.id
        || revision.operation !== retainedJob.operation
        || revision.provider !== retainedJob.provider
        || stableJson(revision.executionProfile) !== stableJson(retainedJob.executionProfile)
        || revision.sourceJobId !== previousJobId
        || revision.sourceSha256 !== previousSha256
        || revision.sourceGeometryHash !== previousGeometryHash
        || retainedJob.source.jobId !== previousJobId
        || retainedJob.sourceSha256 !== previousSha256
        || retainedJob.sourceGeometryHash !== previousGeometryHash
        || revision.outputPath !== revisionPath
        || revision.outputSha256 !== retainedJob.sha256
        || revision.outputSha256 !== revisionInspection.sha256
        || revision.geometryHash !== retainedJob.geometryHash
        || revision.geometryHash !== revisionInspection.geometryHash
        || revision.geometryHash !== lineage.root.geometryHash
        || revision.byteSize !== revisionInspection.byteSize
        || revision.promptSha256 !== workflowPromptSha256(retainedJob.instruction)
        || revision.specFingerprint !== workflowSpecFingerprint(sanitizeAssetSpec(retainedJob.baseSpec))
        || revision.provenancePath !== provenancePath
        || revision.provenanceSha256 !== provenanceSha256
        || revision.parentProvenanceSha256 !== previousProvenanceSha256
        || revision.sourceTextureFingerprint !== previousTextureFingerprint
        || revision.outputTextureFingerprint !== revisionInspection.textureFingerprint
        || stableJson(revision.visualApproval) !== stableJson(revisionApproval)
        || revision.visualApprovalPath !== retainedJob.visualApprovalPath
        || revision.visualApprovalSha256 !== retainedJob.visualApprovalSha256
        || provenance.assetId !== lineage.assetId
        || provenance.revisionJobId !== retainedJob.id
        || provenance.operation !== retainedJob.operation
        || provenance.specFingerprint !== revision.specFingerprint
        || provenance.source?.kind !== retainedJob.source.kind
        || provenance.source?.jobId !== previousJobId
        || provenance.source?.sha256 !== previousSha256
        || provenance.source?.geometryHash !== previousGeometryHash
        || provenance.output?.path !== revisionPath
        || provenance.output?.sha256 !== revisionInspection.sha256
        || provenance.output?.geometryHash !== revisionInspection.geometryHash
        || provenance.output?.byteSize !== revisionInspection.byteSize
        || provenance.output?.textureFingerprint !== revisionInspection.textureFingerprint
        || provenance.parentProvenanceSha256 !== previousProvenanceSha256) {
        throw new Error("A workflow lineage revision does not match its retained parent, output, provenance, or approval.");
      }
      if (revision.operation === "texture") {
        if (animationSeen) throw new Error("Workflow lineage contains a texture revision after animation.");
        if (revision.provider !== "hunyuan3d-paint-2.1"
          || !retainedJob.providerVerification
          || retainedJob.providerVerification.verificationMode !== "deep"
          || stableJson(revision.providerVerification) !== stableJson(retainedJob.providerVerification)
          || stableJson(provenance.providerVerification) !== stableJson(retainedJob.providerVerification)
          || !retainedJob.executionProfile
          || stableJson(provenance.executionProfile) !== stableJson(retainedJob.executionProfile)
          || revision.outputTextureFingerprint === revision.sourceTextureFingerprint) {
          throw new Error("Texture lineage lacks a changed, deep-verified Hunyuan Paint result.");
        }
        textureCount += 1;
      } else {
        animationSeen = true;
        const hyMotion = revision.provider === "hy-motion-1.0-lite"
          && provenance.method === "official-hy-motion-1.0-lite-plus-local-mixamo25-skin"
          && provenance.provider?.id === "hy-motion-1";
        const cpuMethods = new Set(["deterministic-cpu-skeletal-motion", "local-animation-library-retarget", "deterministic-morph-deformation", "rigid-object-motion"]);
        const cpuMotion = revision.provider === "grudge-motion-graph-1"
          && cpuMethods.has(String(provenance.method ?? ""))
          && provenance.provider?.id === "grudge-motion-graph-1";
        const strictAcceptance = Boolean(job.batchId && this.batches.get(job.batchId)?.acceptance);
        if (strictAcceptance && !hyMotion) {
          throw new Error("Strict final-run acceptance requires genuine deep-verified HY-Motion; the basic CPU route remains a separately labelled manual fallback.");
        }
        if (!hyMotion && !cpuMotion) throw new Error("Animation lineage does not identify an authoritative retained motion route.");
        if (revision.outputTextureFingerprint !== revision.sourceTextureFingerprint
          || revision.animationFingerprint !== revisionInspection.animationFingerprint
          || !revision.animationPlanSha256
          || revision.animationPlanSha256 !== stableWorkflowSha256(retainedJob.animationPlan ?? {})
          || stableJson(revision.clipIds ?? []) !== stableJson(revisionInspection.clipIds)) {
          throw new Error("Animation lineage does not bind its exact prompt plan, clips, geometry and retained texture evidence.");
        }
        if (hyMotion) {
          if (!retainedJob.providerVerification
            || retainedJob.providerVerification.providerId !== "hy-motion-1"
            || retainedJob.providerVerification.verificationMode !== "deep"
            || stableJson(revision.providerVerification) !== stableJson(retainedJob.providerVerification)
            || stableJson(provenance.providerVerification) !== stableJson(retainedJob.providerVerification)
            || revision.motionDataSha256 !== provenance.motionData?.sha256) {
            throw new Error("Animation lineage lacks exact deep-verified HY-Motion provider and skeletal-data evidence.");
          }
          const motionDataPath = containedWorkflowPath(this.root, String(provenance.motionData?.path ?? ""));
          const motionDataBytes = await readFile(motionDataPath);
          if (sha256Hex(motionDataBytes) !== revision.motionDataSha256 || provenance.motionData?.upstreamPreviewGeometryRetained !== false) {
            throw new Error("Animation lineage does not bind its exact generated HY-Motion skeletal data.");
          }
        } else {
          if (retainedJob.providerVerification || revision.providerVerification || provenance.providerVerification
            || provenance.gpuRequired !== false || revision.animationRoute !== provenance.animationRoute) {
            throw new Error("Basic CPU animation lineage has inconsistent provider, GPU or route evidence.");
          }
          const skeletalCpu = revision.animationRoute === "existing-rig"
            || revision.animationRoute === "deterministic-cpu-rig"
            || revision.animationRoute === "local-animation-library";
          if (skeletalCpu) {
            const rig = revision.rigPreparation;
            if (!rig || stableJson(provenance.rigPreparation) !== stableJson(rig)
              || rig.sourceSha256 !== revision.sourceSha256 || rig.parentRevisionSha256 !== revision.sourceSha256) {
              throw new Error("CPU skeletal lineage does not bind its exact painted parent and rig preparation.");
            }
            const rigPath = containedWorkflowPath(this.root, rig.outputPath);
            const rigInspection = await inspectWorkflowGlb(rigPath);
            if (rigInspection.sha256 !== rig.outputSha256
              || rigInspection.geometryHash !== revision.geometryHash
              || rigInspection.textureFingerprint !== revision.sourceTextureFingerprint
              || rigInspection.skins < 1 || rigInspection.joints < 22 || rigInspection.skinnedMeshNodes < 1
              || revisionInspection.skins < 1 || revisionInspection.joints < 22
              || revisionInspection.skinnedMeshNodes < 1 || revisionInspection.boneRotationChannels < 22) {
              throw new Error("CPU skeletal route no longer retains its exact complete skin, geometry, textures and bone channels.");
            }
          }
          if (revision.animationRoute === "deterministic-morph-deformation"
            && (revisionInspection.morphTargets < 1 || Number(provenance.validation?.motion?.effectiveDeformationTargets ?? 0) < 1)) {
            throw new Error("Non-humanoid basic animation lineage lacks measurable body deformation.");
          }
        }
        animationCount += 1;
      }
      previousJobId = revision.jobId;
      previousSha256 = revision.outputSha256;
      previousGeometryHash = revision.geometryHash;
      previousProvenanceSha256 = revision.provenanceSha256;
      previousTextureFingerprint = revision.outputTextureFingerprint;
    }
    if (lineage.revisions.at(-1)?.jobId !== job.id
      || lineage.finalJobId !== job.id || lineage.finalSha256 !== inspection.sha256
      || lineage.finalGeometryHash !== inspection.geometryHash) {
      throw new Error("Workflow lineage does not end at this exact retained revision.");
    }
    if (requireComplete && (textureCount < PROMPT3D_MIN_WORKFLOW_TEXTURE_REVISIONS
      || animationCount < PROMPT3D_MIN_WORKFLOW_ANIMATION_REVISIONS
      || job.operation !== "animation")) {
      throw new Error(`Saving or exporting requires at least ${PROMPT3D_MIN_WORKFLOW_TEXTURE_REVISIONS} approved prompted Hunyuan Paint revision followed by at least ${PROMPT3D_MIN_WORKFLOW_ANIMATION_REVISIONS} approved prompted animation revisions.`);
    }
    return { path, inspection, lineage };
  }

  private async resolveWorkflowSource(
    source: Prompt3DAssetSource,
    options: {
      useExistingGeneratedModel?: boolean;
      existingGeometryDecision?: Prompt3DExistingGeometryDecision;
    } = {},
  ): Promise<{
    assetId: string;
    path: string;
    sha256: string;
    geometryHash: string;
    baseSpec: AssetSpecV1;
    sourceJob: Prompt3DJobStatus | Prompt3DFinishJobStatus;
    lineage: Prompt3DWorkflowLineage;
  }> {
    await Promise.all([this.loadHistory(), this.loadFinishHistory()]);
    if (source.kind === "generation") {
      const job = this.jobs.get(source.jobId);
      if (!job) throw new Error("The selected Hunyuan generation is unavailable.");
      const requestedIndex = source.variantIndex ?? 0;
      const retained = await this.resolveRetainedGenerationChain(job, requestedIndex, {
        allowApprovedBase: options.useExistingGeneratedModel === true,
      });
      if (options.useExistingGeneratedModel === true && retained.generationChain.length !== 1) {
        throw new Error("Use the existing generated model is available only for an approved, unrefined base Hunyuan generation.");
      }
      const { path, inspection } = retained.selected;
      const assetId = job.assetId ?? job.id;
      const lineage = sealPrompt3DWorkflowLineage({
        version: 1,
        assetId,
        generationChain: retained.generationChain,
        ...(options.useExistingGeneratedModel === true ? {
          existingGeometryDecision: options.existingGeometryDecision ?? createPrompt3DExistingGeometryDecision({
              version: 1,
              mode: "use-existing-generated-model",
              assetId,
              generationJobId: retained.root.jobId,
              variantIndex: 0,
              assetSha256: retained.root.outputSha256,
              geometryHash: retained.root.geometryHash,
              visualApprovalSha256: retained.root.visualApprovalSha256,
            }),
        } : {}),
        root: retained.root,
        revisions: [],
        finalJobId: job.id,
        finalSha256: inspection.sha256,
        finalGeometryHash: inspection.geometryHash,
      });
      prompt3DWorkflowUsesExistingGeneratedModel(lineage);
      return {
        assetId,
        path,
        sha256: inspection.sha256,
        geometryHash: inspection.geometryHash,
        baseSpec: sanitizeAssetSpec(job.spec),
        sourceJob: job,
        lineage,
      };
    }

    const job = this.finishJobs.get(source.jobId);
    if (!job || job.state !== "complete" || !job.assetPath || !job.sha256 || !job.geometryHash || !job.validation) {
      throw new Error("The selected workflow revision is incomplete or unavailable.");
    }
    if (options.useExistingGeneratedModel === true) {
      throw new Error("Use the existing generated model must be chosen only when starting texture from the approved generation.");
    }
    const { path, inspection, lineage } = await this.verifyFinishLineage(job);
    return {
      assetId: job.assetId,
      path,
      sha256: inspection.sha256,
      geometryHash: inspection.geometryHash,
      baseSpec: sanitizeAssetSpec(job.baseSpec),
      sourceJob: job,
      lineage,
    };
  }

  private async updateFinish(
    job: Prompt3DFinishJobStatus,
    stage: Prompt3DFinishJobStatus["stage"],
    progress: number,
    message: string,
  ): Promise<void> {
    if (this.finishCancelled(job)) return;
    job.stage = stage;
    job.progress = Math.max(0, Math.min(100, Math.round(progress)));
    job.message = message;
    await this.publishFinishJob(job);
  }

  async finishStart(token: string, request: Prompt3DFinishRequest, internalBatchId?: string): Promise<Prompt3DFinishJobStatus> {
    this.requireGrant(token);
    const activeBatch = this.activeBatch();
    const activeItem = activeBatch?.items.find((item) => item.state !== "complete");
    const activeRuntime = activeBatch && activeItem ? this.batchRuntime.get(activeBatch.id)?.get(activeItem.id) : undefined;
    const manualBatchCorrection = !internalBatchId && activeBatch?.state === "awaiting-approval"
      && activeItem?.state === "awaiting-approval"
      && (activeRuntime?.currentKind === "texture" || activeRuntime?.currentKind === "animation")
      && activeRuntime.currentKind === request.operation
      && Boolean(activeRuntime.currentSource)
      && stableJson(activeRuntime.currentSource) === stableJson(request.source)
      ? { batch: activeBatch, item: activeItem, runtime: activeRuntime }
      : undefined;
    const batchDispatchId = internalBatchId ?? manualBatchCorrection?.batch.id;
    this.assertBatchDispatch(token, batchDispatchId);
    if (internalBatchId && (request.batchId !== internalBatchId || !request.batchItemId)) {
      throw new Error("Internal finishing dispatch is not bound to the active batch item.");
    }
    if (this.starting) throw new Error("Another Prompt-to-3D action is already passing preflight checks.");
    this.starting = true;
    try {
      await Promise.all([this.loadHistory(), this.loadFinishHistory()]);
      if ([...this.jobs.values()].some((job) => job.state === "queued" || job.state === "running")
        || [...this.finishJobs.values()].some((job) => job.state === "queued" || job.state === "running")) {
        throw new Error(`Prompt-to-3D concurrency is bounded to ${MAX_JOBS}.`);
      }
      if (!request.source || !["texture", "animation"].includes(request.operation)) throw new Error("Unknown Prompt-to-3D finishing operation.");
      if (request.useExistingGeneratedModel !== undefined && request.useExistingGeneratedModel !== true) {
        throw new Error("Use the existing generated model decision is invalid.");
      }
      const useExistingGeneratedModel = request.useExistingGeneratedModel === true;
      if (useExistingGeneratedModel && batchDispatchId) {
        throw new Error("Strict serial acceptance requires prompted Hunyuan shape refinement and cannot use the base-model continuation.");
      }
      if (useExistingGeneratedModel && (request.operation !== "texture" || request.source.kind !== "generation")) {
        throw new Error("Use the existing generated model is valid only when starting texture from an approved base Hunyuan generation.");
      }
      const instruction = request.operation === "texture"
        ? normalizeTextureInstruction(request.instruction ?? "")
        : request.instruction?.trim().replace(/\s+/g, " ");
      if (!instruction || instruction.length > MAX_PROMPT) throw new Error("A finishing instruction must contain 1–2,000 characters.");
      const source = await this.resolveWorkflowSource(request.source, { useExistingGeneratedModel });
      if (source.lineage.revisions.length >= 32) throw new Error("This workflow already contains the maximum 32 finishing revisions.");
      if (request.operation === "texture" && request.source.kind === "finish"
        && (source.sourceJob as Prompt3DFinishJobStatus).operation === "animation") {
        throw new Error("Refine textures before animation so Hunyuan Paint cannot discard authored motion. Start from the last texture revision instead.");
      }
      if (request.operation === "animation" && !source.lineage.revisions.some((revision) => revision.operation === "texture")) {
        throw new Error("Apply and explicitly approve at least one Hunyuan Paint revision before creating animation.");
      }
      let rejectedFinish: Prompt3DFinishJobStatus | undefined;
      if (request.rejectedFinishJobId !== undefined) {
        if (!BATCH_ID.test(request.rejectedFinishJobId)) throw new Error("Rejected finishing job ID is invalid.");
        rejectedFinish = this.finishJobs.get(request.rejectedFinishJobId);
        if (!rejectedFinish || rejectedFinish.operation !== request.operation || rejectedFinish.assetId !== source.assetId) {
          throw new Error("The rejected finishing revision does not match this corrective operation and asset.");
        }
        if (stableJson(rejectedFinish.source) !== stableJson(request.source)) {
          throw new Error("A corrective finishing revision must branch from the rejected output's exact approved parent.");
        }
        await this.verifyRetainedFinishVisualRejection(rejectedFinish);
      }
      let seed = request.seed ?? Math.min(0x7fffffff, source.baseSpec.seed + this.finishJobs.size + 1);
      const strictBatch = batchDispatchId ? this.batches.get(batchDispatchId) : undefined;
      const strictItemId = internalBatchId ? request.batchItemId : manualBatchCorrection?.item.id;
      if (strictBatch?.acceptance && strictItemId) {
        seed = this.nextStrictBatchFinishSeed(strictBatch, strictItemId, request.operation);
      }
      if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0x7fffffff) throw new Error("Finishing seed must be an integer from 0 to 2,147,483,647.");
      if (request.animation?.deformationEdit) {
        if(request.operation!=="animation"||request.animation.provider!=="auto-cpu")throw new Error("Region editing uses the local deformation route.");
        const {job:edited,baseline}=await this.regionEditorSource(token,request.animation.deformationEdit);
        if(edited.assetId!==source.assetId||stableJson(edited.source)!==stableJson(request.source))throw new Error("The region edit must preserve the animation's exact approved base.");
        const inventory=await inspectRegionEditor(baseline.assetPath!,baseline.sha256!,baseline.animationPlan);
        validateRegionDefinitions(request.animation.deformationEdit.regions,inventory.regions.map(r=>r.id));
        seed=edited.seed;
      }
      if (request.animation) {
        if (request.animation.mode !== undefined && request.animation.mode !== "replace" && request.animation.mode !== "append") throw new Error("Animation mode must be replace or append.");
        if (request.animation.provider !== undefined && !["auto-cpu", "local-animation-library", "hy-motion-1.0-lite"].includes(request.animation.provider)) {
          throw new Error("Animation provider must be deterministic CPU, a local animation library, or optional HY-Motion.");
        }
        if (request.animation.duration !== undefined && (!Number.isFinite(request.animation.duration) || request.animation.duration < 0.5 || request.animation.duration > 5)) {
          throw new Error("Animation duration must be from 0.5 to 5 seconds.");
        }
        if (request.animation.provider === "hy-motion-1.0-lite" && (request.animation.cycles !== undefined || request.animation.intensity !== undefined || request.animation.distance !== undefined)) {
          throw new Error("HY-Motion follows the motion prompt directly; legacy cycles, intensity and distance transforms are not accepted. State those requirements in the prompt.");
        }
        if (request.animation.libraryPackDir !== undefined && (request.animation.provider !== "local-animation-library" || typeof request.animation.libraryPackDir !== "string" || !request.animation.libraryPackDir.trim())) {
          throw new Error("A local animation library path is valid only with the local-library route.");
        }
        if (request.animation.provider === "local-animation-library" && !request.animation.libraryPackDir) throw new Error("Choose an installed local animation library.");
        if (request.animation.libraryClipName !== undefined && (typeof request.animation.libraryClipName !== "string" || !request.animation.libraryClipName.trim() || request.animation.libraryClipName.length > 240)) {
          throw new Error("Local library clip name is invalid.");
        }
        if (request.animation.rigPlacements !== undefined && (!Array.isArray(request.animation.rigPlacements) || request.animation.rigPlacements.length > 22)) {
          throw new Error("Skeleton Studio rig correction contains an invalid marker set.");
        }
        if (request.animation.rigPlacements !== undefined
          && (!/^[a-f0-9]{64}$/i.test(request.animation.rigCorrectionSourceSha256 ?? "")
            || request.animation.rigCorrectionSourceSha256 !== source.sha256)) {
          throw new Error("Skeleton Studio rig correction does not match this exact painted source revision.");
        }
      }
      if (request.operation === "animation" && !request.animation?.deformationEdit && (!request.animation?.provider || ["auto-cpu", "grudge-motion-graph-1"].includes(request.animation.provider))) {
        const capabilityError = promptedMotionCapabilityError(instruction);
        if (capabilityError) throw new Error(capabilityError);
      }
      if (request.operation === "texture") await requirePrompt3DOutputSpace(this.root, "texture");
      const id = randomUUID();
      const outputDirectory = workflowDirectory(this.root, id);
      await mkdir(outputDirectory, { recursive: true });
      const now = new Date().toISOString();
      const baseSpec = assertSpec({
        ...sanitizeAssetSpec(source.baseSpec),
        seed,
        variants: 1,
        providerId: "hunyuan3d-2",
        route: "concept-image-to-3d",
        generateTextures: request.operation === "texture" ? true : source.baseSpec.generateTextures,
      });
      const retainedRequest: Prompt3DFinishRequest = {
        source: { ...request.source },
        operation: request.operation,
        instruction,
        seed,
        ...(request.animation ? { animation: { ...request.animation } } : {}),
        ...(rejectedFinish ? { rejectedFinishJobId: rejectedFinish.id } : {}),
        ...(useExistingGeneratedModel ? { useExistingGeneratedModel: true } : {}),
        ...(internalBatchId
          ? { batchId: request.batchId, batchItemId: request.batchItemId }
          : manualBatchCorrection
            ? { batchId: manualBatchCorrection.batch.id, batchItemId: manualBatchCorrection.item.id }
            : {}),
      };
      const job: Prompt3DFinishJobStatus = {
        version: 1,
        id,
        assetId: source.assetId,
        source: request.source,
        sourceAssetPath: source.path,
        sourceSha256: source.sha256,
        sourceGeometryHash: source.geometryHash,
        operation: request.operation,
        instruction,
        seed,
        state: "queued",
        stage: "queued",
        progress: 1,
        message: request.operation === "texture"
          ? "Texture revision retained · preparing the official Hunyuan Paint route."
          : request.animation?.provider === "hy-motion-1.0-lite"
            ? "Animation revision retained · preparing optional HY-Motion skeletal generation."
            : "Animation revision retained · preparing the GPU-independent local animation route.",
        outputDirectory,
        lineage: source.lineage,
        provider: request.operation === "texture"
          ? "hunyuan3d-paint-2.1"
          : request.animation?.provider === "hy-motion-1.0-lite" ? "hy-motion-1.0-lite" : "grudge-motion-graph-1",
        baseSpec,
        ...(rejectedFinish ? { rejectedFinishJobId: rejectedFinish.id } : {}),
        ...(useExistingGeneratedModel ? { usedExistingGeneratedModel: true } : {}),
        ...(retainedRequest.batchId ? { batchId: retainedRequest.batchId } : {}),
        ...(retainedRequest.batchItemId ? { batchItemId: retainedRequest.batchItemId } : {}),
        createdAt: now,
        updatedAt: now,
      };
      this.finishJobs.set(id, job);
      if (manualBatchCorrection) {
        const previousJobId = manualBatchCorrection.runtime.currentJobId;
        manualBatchCorrection.runtime.currentKind = request.operation;
        manualBatchCorrection.runtime.currentJobId = id;
        manualBatchCorrection.runtime.retryFinish = {
          operation: request.operation,
          revisionIndex: request.operation === "texture"
            ? manualBatchCorrection.runtime.nextTexture
            : manualBatchCorrection.runtime.nextAnimation,
          request: retainedRequest,
        };
        if (previousJobId) this.batchJobLinks.delete(previousJobId);
        this.batchJobLinks.set(id, manualBatchCorrection.batch.id);
      }
      await this.publishFinishJob(job);
      if (manualBatchCorrection) {
        await this.updateBatchItem(manualBatchCorrection.batch, manualBatchCorrection.item, {
          state: request.operation,
          currentJobId: id,
          message: `Running an explicit corrective ${request.operation} revision from the exact last approved batch source.`,
        });
      }
      void this.runFinishJob(job, retainedRequest).catch((error) => this.failFinishJob(job, error));
      return job;
    } finally {
      this.starting = false;
    }
  }

  private async runFinishJob(job: Prompt3DFinishJobStatus, request: Prompt3DFinishRequest): Promise<void> {
    if (this.finishCancelled(job)) return;
    job.state = "running";
    if (job.operation === "texture") await this.runTextureFinish(job);
    else if (request.animation?.provider === "hy-motion-1.0-lite") await this.runHyMotionAnimationFinish(job, request);
    else await this.runCpuAnimationFinish(job, request);
  }

  private async runTextureFinish(job: Prompt3DFinishJobStatus): Promise<void> {
    await this.updateFinish(job, "compliance", 3, "Measuring current GPU headroom and probing the normal-user WSL runtime for Hunyuan Paint.");
    if (this.finishCancelled(job)) return;
    const hardware = await measurePrompt3DHardware(this.root, true);
    if (this.finishCancelled(job)) return;
    assertPrompt3DOutputSpace(this.root, hardware.disk.freeBytes, "texture");
    const provider = localProvider("hunyuan3d-2");
    const paintCompliance = evaluatePrompt3DCompliance(provider, hardware, this.root, "pre-run", { ...job.baseSpec, generateTextures: true });
    const integrity = await this.installer.verify("hunyuan3d-2", true);
    if (this.finishCancelled(job)) return;
    if (!integrity.ok) throw new Error(`setup-required: ${integrity.reason}`);
    job.providerVerification = await this.captureProviderVerification("hunyuan3d-2", integrity.reason);
    if (this.finishCancelled(job)) return;
    if (!paintCompliance.canRun) throw new Error(`${paintCompliance.state}: ${paintCompliance.reasons.join(" ")}`);
    const executionProfile = paintCompliance.executionProfile;
    if (!executionProfile) throw new Error("Hunyuan Paint compliance did not select a runnable texture profile.");
    const paintSettings = hunyuanExecutionSettings(executionProfile, "texture");
    job.executionProfile = executionProfile;
    const wslDistro = hardware.wsl.usableLinuxDistribution;
    if (!wslDistro) throw new Error("Hunyuan Paint requires its configured normal-user WSL2 runtime.");
    await this.updateFinish(job, "reference-image", 8, `Preflight passed · ${executionProfile.label} selected · generating a new HunyuanDiT texture reference from this exact prompt.`);
    if (this.finishCancelled(job)) return;
    const raw = containedWorkflowPath(this.root, join(job.outputDirectory, "hunyuan-paint-output.glb"));
    const specPath = containedWorkflowPath(this.root, join(job.outputDirectory, "texture-task.json"));
    const textureReferencePrompt = compileTextureReferencePrompt(job.baseSpec, job.instruction);
    const typedSpec = {
      ...sanitizeAssetSpec(job.baseSpec),
      workflowVersion: 1,
      workflowOperation: "texture",
      sourceAssetPath: job.sourceAssetPath,
      sourceSha256: job.sourceSha256,
      sourceGeometryHash: job.sourceGeometryHash,
      textureReferencePrompt,
      executionProfile,
      textureViewCount: paintSettings.textureViewCount,
      textureMemoryProfile: executionProfile.id,
      method: "hunyuan-dit-reference-plus-official-hunyuan3d-paint",
    };
    await this.writeJsonAtomic(specPath, typedSpec);
    if (this.finishCancelled(job)) return;
    const sidecarId = `${job.id}-1`;
    this.activeSidecarJobs.set(job.id, sidecarId);
    const health = await this.sidecarRequest("/health") as { ok?: boolean; binding?: string };
    if (this.finishCancelled(job)) return;
    if (!health.ok || health.binding !== "127.0.0.1") throw new Error("Prompt-to-3D sidecar health contract failed.");
    await this.sidecarRequest("/jobs", {
      method: "POST",
      body: JSON.stringify({
        jobId: sidecarId,
        providerId: "hunyuan3d-2",
        specPath,
        output: raw,
        wslDistro,
        providerRootName: `hunyuan3d-2-${provider.sourceRevision.slice(0, 12)}`,
      }),
    });
    if (this.finishCancelled(job)) {
      await this.sidecarRequest(`/jobs/${sidecarId}/cancel`, { method: "POST", body: "{}" }).catch(() => undefined);
      return;
    }
    const deadline = Date.now() + JOB_TIMEOUT_MS;
    let last = "";
    for (;;) {
      if (this.finishCancelled(job)) return;
      if (Date.now() > deadline) {
        await this.finishCancel("internal", job.id, true);
        throw new Error("Hunyuan Paint exceeded the 90-minute timeout.");
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
      if (this.finishCancelled(job)) return;
      const state: any = await this.sidecarRequest(`/jobs/${sidecarId}`);
      if (this.finishCancelled(job)) return;
      const providerProgress = Math.max(0, Math.min(90, Number(state.progress ?? 0)));
      const stage = state.stage === "texture" ? "texture" : state.stage === "reference-image" ? "reference-image" : job.stage;
      const signature = `${state.state}|${stage}|${providerProgress}|${state.message ?? ""}`;
      if (signature !== last) {
        last = signature;
        await this.updateFinish(job, stage, 8 + providerProgress * 0.82, state.message ?? "Hunyuan Paint is running.");
      }
      if (state.state === "failed") throw new Error(state.error || "Hunyuan Paint failed.");
      if (state.state === "cancelled") {
        this.activeSidecarJobs.delete(job.id);
        job.state = "cancelled";
        await this.updateFinish(job, "cancelled", job.progress, "Texture revision cancelled; partial output remains task-contained.");
        return;
      }
      if (state.state === "complete") break;
    }
    this.activeSidecarJobs.delete(job.id);
    const rawLink = await lstat(raw);
    if (this.finishCancelled(job)) return;
    const rawInfo = await stat(raw);
    if (this.finishCancelled(job)) return;
    if (rawLink.isSymbolicLink() || !rawInfo.isFile() || rawInfo.size < 1 || rawInfo.size > MAX_PROVIDER_OUTPUT_BYTES) throw new Error("Hunyuan Paint output is unsafe, empty or exceeds the 1 GiB limit.");
    await this.updateFinish(job, "validation", 91, "Proving surface identity and applying the Hunyuan Paint material to the approved geometry.");
    if (this.finishCancelled(job)) return;
    const finalPath = containedWorkflowPath(this.root, join(job.outputDirectory, "asset.glb"));
    const paintMerge = await mergeHunyuanPaintResult(job.sourceAssetPath, raw, finalPath);
    if (this.finishCancelled(job)) return;
    const technical = await validatePrompt3DGlb(finalPath, job.baseSpec, join(this.root, "quarantine"));
    if (this.finishCancelled(job)) return;
    job.technicalValidation = technical;
    const validatedPath = technical.quarantinedPath ?? finalPath;
    if (!technical.gameReady) throw new Error("Hunyuan Paint output failed the deterministic GLB contract and was quarantined.");
    const validation = await validateFinishedAsset(job.sourceAssetPath, validatedPath, "texture");
    if (this.finishCancelled(job)) return;
    if (!validation.sourceGeometryPreserved) throw new Error("Hunyuan Paint changed the retained base geometry; the revision was not accepted.");
    const inspection = await inspectWorkflowGlb(validatedPath);
    if (this.finishCancelled(job)) return;
    const referencePath = containedWorkflowPath(this.root, join(job.outputDirectory, "texture-reference.png"));
    const referenceSha256 = existsSync(referencePath)
      ? createHash("sha256").update(await readFile(referencePath)).digest("hex")
      : undefined;
    if (this.finishCancelled(job)) return;
    if (!referenceSha256) throw new Error("Hunyuan Paint did not retain its generated texture-reference image.");
    const parentProvenanceSha256 = job.lineage.revisions.at(-1)?.provenanceSha256 ?? job.lineage.root.provenanceSha256;
    const provenancePath = containedWorkflowPath(this.root, join(job.outputDirectory, "provenance.json"));
    await writeFile(provenancePath, `${JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      assetId: job.assetId,
      revisionJobId: job.id,
      operation: "texture",
      method: "hunyuan-dit-reference-plus-official-hunyuan3d-paint",
      provider: { id: "hunyuan3d-2", sourceRevision: provider.sourceRevision, paint: "hunyuan3d-paintpbr-v2-1" },
      prompt: job.instruction,
      specFingerprint: workflowSpecFingerprint(sanitizeAssetSpec(job.baseSpec)),
      compiledReferencePrompt: textureReferencePrompt,
      seed: job.seed,
      textureViewCount: paintSettings.textureViewCount,
      textureMemoryProfile: executionProfile.id,
      memoryProfileValidatedByThisRun: true,
      executionProfile,
      geometryRetention: paintMerge,
      providerVerification: job.providerVerification,
      parentProvenanceSha256,
      ...(job.rejectedFinishJobId ? { rejectedFinishJobId: job.rejectedFinishJobId } : {}),
      source: {
        kind: job.source.kind,
        jobId: job.source.jobId,
        sha256: job.sourceSha256,
        geometryHash: job.sourceGeometryHash,
        textureFingerprint: validation.sourceTextureFingerprint,
      },
      textureReference: { path: referencePath, sha256: referenceSha256 },
      output: {
        path: validatedPath,
        sha256: inspection.sha256,
        geometryHash: inspection.geometryHash,
        byteSize: inspection.byteSize,
        textureFingerprint: inspection.textureFingerprint,
      },
      validation,
      technicalValidationId: technical.deterministicId,
      externalAssets: [],
    }, null, 2)}\n`);
    if (this.finishCancelled(job)) return;
    Object.assign(job, {
      state: "complete",
      stage: "complete",
      progress: 100,
      message: "Prompted Hunyuan Paint revision passed technical checks. Visual material review remains required.",
      assetPath: validatedPath,
      sha256: inspection.sha256,
      geometryHash: inspection.geometryHash,
      provenancePath,
      validation,
    });
    await this.publishFinishJob(job);
  }

  private async runCpuAnimationFinish(job: Prompt3DFinishJobStatus, request: Prompt3DFinishRequest): Promise<void> {
    await this.updateFinish(job, "animation", 3, "Classifying the approved subject from its retained AssetSpec and presentation contract. No GPU or HY-Motion check is used.");
    const classification = classifyDeterministicRig(job.baseSpec);
    job.motionCompatibility = classification as unknown as Record<string, unknown>;
    const outputPath = containedWorkflowPath(this.root, join(job.outputDirectory, "asset.glb"));
    const sourceInspection = await inspectWorkflowGlb(job.sourceAssetPath);
    if (sourceInspection.sha256 !== job.sourceSha256 || sourceInspection.geometryHash !== job.sourceGeometryHash) {
      throw new Error("The approved painted source changed before CPU animation preparation.");
    }
    let animationRoute: NonNullable<Prompt3DFinishJobStatus["animationRoute"]>;
    let method: string;
    let provider: unknown = "grudge-motion-graph-1";
    let animationPlan: Record<string, unknown>;
    let operators: string[];
    let pathDisplacementMeters = 0;
    let effectiveDeformationTargets = 0;
    let maximumDeformationRatio = 0;
    let skeletalRequired = false;
    let rigPreparation: Awaited<ReturnType<typeof prepareDeterministicRig>> | undefined;
    const existingRig = await inspectDeterministicRig(job.sourceAssetPath).catch(() => null);
    const useHumanoidRig = existingRig?.compatible === true
      || classification.classification === "humanoid"
      || Boolean(request.animation?.rigPlacements?.length);

    if(request.animation?.deformationEdit){
      const edit=request.animation.deformationEdit,edited=this.finishJobs.get(edit.jobId)!;
      const previous=edited.animationPlan?.deformationEdit as {baselineJobId?:string}|undefined;
      const baseline=previous?.baselineJobId?this.finishJobs.get(previous.baselineJobId)!:edited;
      if(!baseline?.assetPath||!baseline.sha256)throw new Error("The exact deformation baseline is unavailable.");
      const authored=await writeRegionEditorPreview(contained(this.root,baseline.assetPath),baseline.sha256,outputPath,edit.regions,baseline.animationPlan);
      animationRoute="deterministic-morph-deformation";method="deterministic-morph-deformation";
      provider={id:"grudge-motion-graph-1",route:animationRoute,editor:"regional-deformation"};
      animationPlan={...baseline.animationPlan,route:animationRoute,deformationEdit:{baselineJobId:baseline.id,baselineSha256:baseline.sha256,editedJobId:edited.id,editedSha256:edit.sha256,regions:authored.definitions}};
      operators=[...((baseline.animationPlan?.operators as string[])??[]),"regional-deformation-edit"];
      pathDisplacementMeters=baseline.validation?.motion?.pathDisplacementMeters??0;
      effectiveDeformationTargets=authored.regions.length;
      maximumDeformationRatio=authored.maximumDeformationRatio;
    } else if (useHumanoidRig) {
      const preparedRigPath = containedWorkflowPath(this.root, join(job.outputDirectory, "prepared-rig.glb"));
      await this.updateFinish(job, "animation", 14, existingRig?.compatible
        ? "Validating and retaining the existing compatible Mixamo-25 skin."
        : "Preparing a deterministic CPU Mixamo-25 skin on the exact approved painted mesh.");
      try {
        rigPreparation = await prepareDeterministicRig({
          sourcePath: job.sourceAssetPath,
          outputPath: preparedRigPath,
          spec: job.baseSpec,
          parentRevisionSha256: job.sourceSha256,
          ...(request.animation?.rigPlacements ? { correctedPlacements: request.animation.rigPlacements } : {}),
          fingerprints: {
            sourceGeometryHash: sourceInspection.geometryHash,
            sourceTextureFingerprint: sourceInspection.textureFingerprint,
          },
        });
      } catch (error) {
        if (error instanceof DeterministicRigReviewRequiredError) {
          job.rigReview = {
            code: error.code,
            sourcePath: job.sourceAssetPath,
            sourceSha256: job.sourceSha256,
            reason: error.message.replace(/^skeleton-studio-review-required:\s*/i, ""),
            classification: error.classification as unknown as Record<string, unknown>,
            checks: error.checks,
            suggestedPlacements: error.suggestedPlacements,
          };
          await this.publishFinishJob(job);
        }
        throw error;
      }
      const preparedInspection = await inspectWorkflowGlb(preparedRigPath);
      if (preparedInspection.geometryHash !== sourceInspection.geometryHash
        || preparedInspection.textureFingerprint !== sourceInspection.textureFingerprint
        || preparedInspection.skins < 1 || preparedInspection.joints < 22 || preparedInspection.skinnedMeshNodes < 1) {
        throw new Error("Prepared CPU rig did not preserve the exact geometry/texture identity or complete skin contract.");
      }
      rigPreparation = {
        ...rigPreparation,
        outputGeometryHash: preparedInspection.geometryHash,
        outputTextureFingerprint: preparedInspection.textureFingerprint,
      };
      job.rigPreparation = rigPreparation as unknown as Prompt3DFinishJobStatus["rigPreparation"];
      await this.publishFinishJob(job);
      const mode = request.animation?.mode ?? "append";
      const duration = request.animation?.duration;
      if (request.animation?.provider === "local-animation-library") {
        const libraries = await listLocalAnimLibraries({ max: 48 });
        const selected = libraries.find((library) => resolve(library.packDir).toLowerCase() === resolve(request.animation!.libraryPackDir!).toLowerCase());
        if (!selected) throw new Error("The selected Skeleton Studio animation library is not in the current installed local inventory.");
        await this.updateFinish(job, "animation", 46, `Retargeting a compatible local clip from ${selected.name}; root travel remains governed by the prompt.`);
        const authored = await applyLocalAnimationLibrary({
          sourcePath: preparedRigPath,
          outputPath,
          instruction: job.instruction,
          seed: job.seed,
          packDir: selected.packDir,
          ...(request.animation.libraryClipName ? { clipName: request.animation.libraryClipName } : {}),
          mode,
          ...(duration !== undefined ? { duration } : {}),
        });
        animationRoute = "local-animation-library";
        method = "local-animation-library-retarget";
        provider = { id: "grudge-motion-graph-1", route: animationRoute, library: authored.library };
        animationPlan = { ...authored.plan, route: animationRoute, generatedMotion: authored, rigPreparation };
        operators = authored.operators;
        pathDisplacementMeters = authored.pathDisplacementMeters;
      } else {
        await this.updateFinish(job, "animation", 46, "Authoring a deterministic local skeletal clip on the prepared Mixamo-25 rig.");
        const authored = await authorDeterministicSkeletalAnimation({
          sourcePath: preparedRigPath,
          outputPath,
          instruction: job.instruction,
          seed: job.seed,
          mode,
          ...(duration !== undefined ? { duration } : {}),
        });
        animationRoute = rigPreparation.route;
        method = "deterministic-cpu-skeletal-motion";
        provider = { id: "grudge-motion-graph-1", route: authored.route };
        animationPlan = { ...authored.plan, route: animationRoute, generatedMotion: authored, rigPreparation };
        operators = authored.operators;
        pathDisplacementMeters = authored.pathDisplacementMeters;
      }
      skeletalRequired = true;
      effectiveDeformationTargets = 22;
    } else if (classification.classification === "non-humanoid") {
      await this.updateFinish(job, "animation", 30, "Using deterministic mesh-deformation motion for the retained non-humanoid body plan; this is not labelled as a skeleton.");
      const scaled = scaledPromptedAnimationOverrides(job.baseSpec, job.instruction, request.animation?.distance);
      const authored = await authorPromptedAnimation({
        sourcePath: job.sourceAssetPath,
        outputPath,
        instruction: job.instruction,
        seed: job.seed,
        overrides: {
          ...scaled,
          mode: request.animation?.mode ?? "append",
          ...(request.animation?.duration !== undefined ? { durationSeconds: request.animation.duration } : {}),
          ...(request.animation?.cycles !== undefined ? { cycles: request.animation.cycles } : {}),
          ...(request.animation?.intensity !== undefined ? { deformationFraction: request.animation.intensity } : {}),
          requireBodyDeformation: true,
        },
      });
      animationRoute = "deterministic-morph-deformation";
      method = "deterministic-morph-deformation";
      provider = { id: "grudge-motion-graph-1", route: animationRoute };
      animationPlan = { ...authored.plan, route: animationRoute };
      operators = authored.operators;
      pathDisplacementMeters = authored.pathDisplacementMeters;
      effectiveDeformationTargets = authored.validation.deformationTargets.filter((target) => target.effective).length;
      maximumDeformationRatio = Math.max(0, ...authored.validation.deformationTargets.map((target) => target.maxVertexDisplacementRatio));
    } else if (classification.classification === "rigid-object") {
      await this.updateFinish(job, "animation", 30, "Using truthful rigid/object-space motion. No anatomical or skeletal claim is made.");
      const scaled = scaledPromptedAnimationOverrides(job.baseSpec, job.instruction, request.animation?.distance);
      const authored = await authorPromptedAnimation({
        sourcePath: job.sourceAssetPath,
        outputPath,
        instruction: job.instruction,
        seed: job.seed,
        overrides: {
          ...scaled,
          mode: request.animation?.mode ?? "append",
          ...(request.animation?.duration !== undefined ? { durationSeconds: request.animation.duration } : {}),
          ...(request.animation?.cycles !== undefined ? { cycles: request.animation.cycles } : {}),
          ...(request.animation?.intensity !== undefined ? { deformationFraction: request.animation.intensity } : {}),
          requireBodyDeformation: false,
        },
      });
      animationRoute = "rigid-object-motion";
      method = "rigid-object-motion";
      provider = { id: "grudge-motion-graph-1", route: animationRoute };
      animationPlan = { ...authored.plan, route: animationRoute };
      operators = authored.operators;
      pathDisplacementMeters = authored.pathDisplacementMeters;
    } else {
      const review = new DeterministicRigReviewRequiredError(classification.rationale, classification, [{ id: "classification", status: "review", detail: classification.rationale }]);
      job.rigReview = {
        code: review.code,
        sourcePath: job.sourceAssetPath,
        sourceSha256: job.sourceSha256,
        reason: classification.rationale,
        classification: classification as unknown as Record<string, unknown>,
        checks: review.checks,
      };
      await this.publishFinishJob(job);
      throw review;
    }

    if (this.finishCancelled(job)) return;
    job.animationRoute = animationRoute;
    await this.updateFinish(job, "validation", 86, `Validating the ${animationRoute.replaceAll("-", " ")} output, immutable parent hashes and retained material bindings.`);
    const technical = await validatePrompt3DGlb(outputPath, job.baseSpec, join(this.root, "quarantine"));
    job.technicalValidation = technical;
    const validatedPath = technical.quarantinedPath ?? outputPath;
    if (!technical.gameReady) throw new Error("Prompted CPU animation output failed the deterministic GLB contract and was quarantined.");
    const validation = await validateFinishedAsset(job.sourceAssetPath, validatedPath, "animation", {
      operators,
      pathDisplacementMeters,
      effectiveDeformationTargets,
      maximumDeformationRatio,
      skeletalRequired,
    });
    if (!validation.sourceGeometryPreserved) throw new Error("CPU animation changed the retained base geometry; the revision was not accepted.");
    if (validation.sourceTextureFingerprint !== validation.outputTextureFingerprint) throw new Error("CPU animation changed the approved Hunyuan Paint material bindings.");
    const inspection = await inspectWorkflowGlb(validatedPath);
    if (skeletalRequired && (inspection.skins < 1 || inspection.joints < 22 || inspection.skinnedMeshNodes < 1 || inspection.boneRotationChannels < 22)) {
      throw new Error("CPU skeletal output lacks a complete skin, canonical joints or deterministic bone channels.");
    }
    if (animationRoute === "deterministic-morph-deformation" && effectiveDeformationTargets < 1) {
      throw new Error("Non-humanoid body action produced no effective morph/deformation target; whole-model travel is not an acceptable substitute.");
    }
    const parentProvenanceSha256 = job.lineage.revisions.at(-1)?.provenanceSha256 ?? job.lineage.root.provenanceSha256;
    const provenancePath = containedWorkflowPath(this.root, join(job.outputDirectory, "provenance.json"));
    await writeFile(provenancePath, `${JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      assetId: job.assetId,
      revisionJobId: job.id,
      operation: "animation",
      method,
      provider,
      prompt: job.instruction,
      specFingerprint: workflowSpecFingerprint(sanitizeAssetSpec(job.baseSpec)),
      requestedOverrides: request.animation ?? {},
      classification,
      animationRoute,
      plan: animationPlan,
      ...(rigPreparation ? { rigPreparation, rig: { system: rigPreparation.profile, route: rigPreparation.route, bindingMethod: rigPreparation.weightsMethod, joints: rigPreparation.inspection.joints, skins: rigPreparation.inspection.skins } } : {}),
      parentProvenanceSha256,
      ...(job.rejectedFinishJobId ? { rejectedFinishJobId: job.rejectedFinishJobId } : {}),
      source: {
        kind: job.source.kind,
        jobId: job.source.jobId,
        sha256: job.sourceSha256,
        geometryHash: job.sourceGeometryHash,
        textureFingerprint: validation.sourceTextureFingerprint,
      },
      output: {
        path: validatedPath,
        sha256: inspection.sha256,
        geometryHash: inspection.geometryHash,
        byteSize: inspection.byteSize,
        textureFingerprint: inspection.textureFingerprint,
        animationFingerprint: inspection.animationFingerprint,
        clipIds: inspection.clipIds,
      },
      validation,
      technicalValidationId: technical.deterministicId,
      geometryGenerationProvider: "hunyuan3d-2",
      motionGenerationProvider: animationRoute,
      gpuRequired: false,
      modelSpecificCode: false,
      sourceAssets: [],
    }, null, 2)}\n`);
    Object.assign(job, {
      state: "complete",
      stage: "complete",
      progress: 100,
      message: `${animationRoute.replaceAll("-", " ")} passed structural checks without GPU or HY-Motion. Play every clip and inspect the fitted skeleton/deformation before explicit approval.`,
      assetPath: validatedPath,
      sha256: inspection.sha256,
      geometryHash: inspection.geometryHash,
      provenancePath,
      validation,
      animationPlan,
      animationRoute,
      ...(rigPreparation ? { rigPreparation } : {}),
    });
    await this.publishFinishJob(job);
  }

  private async runHyMotionAnimationFinish(job: Prompt3DFinishJobStatus, request: Prompt3DFinishRequest): Promise<void> {
    if (this.options.offlineLocalTest) throw new Error("HY-Motion inference is not simulated in offline workflow tests; use the dedicated signed motion fixture test for rig authoring.");
    await this.updateFinish(job, "animation", 3, "Checking that the approved subject is compatible with HY-Motion's human skeleton and reading travel negations.");
    const compatibility = await analyzeHyMotionCompatibility(job.baseSpec, job.instruction);
    if (this.finishCancelled(job)) return;
    const provider = localProvider("hy-motion-1");
    await this.updateFinish(job, "compliance", 6, "Selecting a compatible local GPU or CPU profile and verifying the signed HY-Motion runtime.");
    const hardware = await measurePrompt3DHardware(this.root, true);
    if (this.finishCancelled(job)) return;
    const compliance = evaluatePrompt3DCompliance(provider, hardware, this.root, "pre-run", { ...job.baseSpec, generateTextures: false });
    const integrity = await this.installer.verify("hy-motion-1", true);
    if (this.finishCancelled(job)) return;
    if (!integrity.ok) throw new Error(`setup-required: ${integrity.reason}`);
    job.providerVerification = await this.captureProviderVerification("hy-motion-1", integrity.reason);
    if (!compliance.canRun) throw new Error(`${compliance.state}: ${compliance.reasons.join(" ")}`);
    const executionProfile = compliance.executionProfile;
    if (!executionProfile) throw new Error("HY-Motion compliance did not retain a runnable provider-native execution profile.");
    const wslDistro = hardware.wsl.usableLinuxDistribution;
    if (!wslDistro) throw new Error("HY-Motion requires its configured normal-user WSL2 runtime.");

    const intentPlan = hyMotionIntentPlan(job.instruction, request.animation, job.seed, executionProfile);
    const motionTaskPath = containedWorkflowPath(this.root, join(job.outputDirectory, "motion-task.json"));
    const motionDataPath = containedWorkflowPath(this.root, join(job.outputDirectory, "hy-motion.json"));
    await this.writeJsonAtomic(motionTaskPath, {
      version: 1,
      providerId: "hy-motion-1",
      prompt: job.instruction,
      seed: job.seed,
      duration: intentPlan.duration,
      cfgScale: intentPlan.cfgScale,
      compatibility,
      executionProfile,
    });
    await this.updateFinish(job, "animation", 10, `Starting official HY-Motion 1.0 Lite text-conditioned skeletal generation with ${executionProfile.label}.`);
    const sidecarId = `${job.id}-1`;
    this.activeSidecarJobs.set(job.id, sidecarId);
    const health = await this.sidecarRequest("/health") as { ok?: boolean; binding?: string };
    if (!health.ok || health.binding !== "127.0.0.1") throw new Error("Prompt-to-3D sidecar health contract failed.");
    await this.sidecarRequest("/jobs", {
      method: "POST",
      body: JSON.stringify({
        jobId: sidecarId,
        providerId: "hy-motion-1",
        specPath: motionTaskPath,
        output: motionDataPath,
        wslDistro,
        providerRootName: `hy-motion-1-${provider.sourceRevision.slice(0, 12)}`,
      }),
    });
    const deadline = Date.now() + JOB_TIMEOUT_MS;
    let last = "";
    for (;;) {
      if (this.finishCancelled(job)) return;
      if (Date.now() > deadline) {
        await this.finishCancel("internal", job.id, true);
        throw new Error("HY-Motion exceeded the 90-minute timeout.");
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
      const state: any = await this.sidecarRequest(`/jobs/${sidecarId}`);
      const providerProgress = Math.max(0, Math.min(90, Number(state.progress ?? 0)));
      const signature = `${state.state}|${providerProgress}|${state.message ?? ""}`;
      if (signature !== last) {
        last = signature;
        await this.updateFinish(job, "animation", 10 + providerProgress * 0.72, state.message ?? "HY-Motion is generating skeletal motion.");
      }
      if (state.state === "failed") throw new Error(state.error || "HY-Motion failed.");
      if (state.state === "cancelled") {
        this.activeSidecarJobs.delete(job.id);
        job.state = "cancelled";
        await this.updateFinish(job, "cancelled", job.progress, "HY-Motion revision cancelled; task-contained partial data was retained.");
        return;
      }
      if (state.state === "complete") break;
    }
    this.activeSidecarJobs.delete(job.id);
    const motionLink = await lstat(motionDataPath);
    const motionInfo = await stat(motionDataPath);
    if (motionLink.isSymbolicLink() || !motionInfo.isFile() || motionInfo.size < 2 || motionInfo.size > 32 * 1024 ** 2) throw new Error("HY-Motion skeletal output is unsafe, empty or exceeds 32 MiB.");
    const outputPath = containedWorkflowPath(this.root, join(job.outputDirectory, "asset.glb"));
    await this.updateFinish(job, "animation", 78, "Binding the generated 22-joint motion to the Studio's local Mixamo-25 core rig and preserving the approved surface.");
    const authored = await bindHyMotionToGlb({
      sourcePath: job.sourceAssetPath,
      outputPath,
      motionPath: motionDataPath,
      prompt: job.instruction,
      seed: job.seed,
      mode: intentPlan.mode,
      spec: job.baseSpec,
      expectedCompatibility: compatibility,
      expectedExecutionProfile: executionProfile,
    });
    if (this.finishCancelled(job)) return;
    await this.updateFinish(job, "validation", 90, "Validating the skin, inverse-bind rig, generated bone channels, source geometry and retained texture.");
    if (this.finishCancelled(job)) return;
    const technical = await validatePrompt3DGlb(outputPath, job.baseSpec, join(this.root, "quarantine"));
    if (this.finishCancelled(job)) return;
    job.technicalValidation = technical;
    const validatedPath = technical.quarantinedPath ?? outputPath;
    if (!technical.gameReady) throw new Error("Prompted animation output failed the deterministic GLB contract and was quarantined.");
    const validation = await validateFinishedAsset(job.sourceAssetPath, validatedPath, "animation", {
      operators: ["hy-motion-text-conditioned-diffusion", "grudge-mixamo25-v2-skin-binding"],
      pathDisplacementMeters: authored.pathDisplacementMeters,
      effectiveDeformationTargets: authored.joints,
      maximumDeformationRatio: 0,
      skeletalRequired: true,
    });
    if (this.finishCancelled(job)) return;
    if (!validation.sourceGeometryPreserved) throw new Error("Prompted animation changed the retained base geometry; the revision was not accepted.");
    const inspection = await inspectWorkflowGlb(validatedPath);
    if (this.finishCancelled(job)) return;
    if (inspection.skins < 1 || inspection.joints < 22 || inspection.skinnedMeshNodes < 1 || inspection.boneRotationChannels < 22) {
      throw new Error("HY-Motion output does not contain a complete playable local skin and 22 generated bone-rotation channels.");
    }
    if (validation.sourceTextureFingerprint !== validation.outputTextureFingerprint) throw new Error("HY-Motion changed the approved Hunyuan Paint material bindings.");
    const animationPlan = { ...intentPlan, compatibility, generatedMotion: authored };
    const parentProvenanceSha256 = job.lineage.revisions.at(-1)?.provenanceSha256 ?? job.lineage.root.provenanceSha256;
    const provenancePath = containedWorkflowPath(this.root, join(job.outputDirectory, "provenance.json"));
    await writeFile(provenancePath, `${JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      assetId: job.assetId,
      revisionJobId: job.id,
      operation: "animation",
      method: "official-hy-motion-1.0-lite-plus-local-mixamo25-skin",
      provider: { id: "hy-motion-1", model: "hy-motion-1.0-lite", sourceRevision: provider.sourceRevision },
      executionProfile: intentPlan.executionProfile,
      providerVerification: job.providerVerification,
      prompt: job.instruction,
      specFingerprint: workflowSpecFingerprint(sanitizeAssetSpec(job.baseSpec)),
      requestedOverrides: request.animation ?? {},
      compatibility,
      animationRoute: "hy-motion-1.0-lite",
      plan: animationPlan,
      motionData: { path: motionDataPath, sha256: authored.motionDataSha256, upstreamPreviewGeometryRetained: false },
      rig: { system: "grudge-mixamo25-v2", bindingMethod: authored.bindingMethod, joints: authored.joints, skins: authored.skins },
      parentProvenanceSha256,
      ...(job.rejectedFinishJobId ? { rejectedFinishJobId: job.rejectedFinishJobId } : {}),
      source: {
        kind: job.source.kind,
        jobId: job.source.jobId,
        sha256: job.sourceSha256,
        geometryHash: job.sourceGeometryHash,
        textureFingerprint: validation.sourceTextureFingerprint,
      },
      output: {
        path: validatedPath,
        sha256: inspection.sha256,
        geometryHash: inspection.geometryHash,
        byteSize: inspection.byteSize,
        textureFingerprint: inspection.textureFingerprint,
        animationFingerprint: inspection.animationFingerprint,
        clipIds: inspection.clipIds,
      },
      validation,
      technicalValidationId: technical.deterministicId,
      geometryGenerationProvider: "hunyuan3d-2",
      motionGenerationProvider: "hy-motion-1.0-lite",
      modelSpecificCode: false,
      sourceAssets: [],
    }, null, 2)}\n`);
    if (this.finishCancelled(job)) return;
    Object.assign(job, {
      state: "complete",
      stage: "complete",
      progress: 100,
      message: `Genuine HY-Motion skeletal generation (${executionProfile.label}) passed skin, bone-channel, geometry and texture checks. Play it and verify the prompted action before approval.`,
      assetPath: validatedPath,
      sha256: inspection.sha256,
      geometryHash: inspection.geometryHash,
      provenancePath,
      validation,
      animationPlan,
      animationRoute: "hy-motion-1.0-lite",
    });
    await this.publishFinishJob(job);
  }

  private async failFinishJob(job: Prompt3DFinishJobStatus, error: unknown): Promise<void> {
    if (this.finishCancelled(job)) return;
    this.activeSidecarJobs.delete(job.id);
    const message = error instanceof Error ? error.message : String(error);
    job.state = "failed";
    job.stage = "failed";
    job.error = { code: "FINISH_FAILED", message, retryable: true };
    job.message = message;
    await this.publishFinishJob(job);
  }

  async finishCancel(token: string, id: string, internal = false): Promise<Prompt3DFinishJobStatus> {
    if (!internal) this.requireGrant(token);
    const job = this.finishStatus(token, id, internal);
    const sidecarId = this.activeSidecarJobs.get(id);
    const wasActive = job.state === "running" || job.state === "queued";
    const cancellation = {
      message: "Cancelled; partial output remains inside the retained workflow revision.",
      updatedAt: new Date().toISOString(),
    };
    this.finishCancellations.set(id, cancellation);
    this.activeSidecarJobs.delete(id);
    Object.assign(job, { state: "cancelled", stage: "cancelled", ...cancellation });
    await this.publishFinishJob(job);
    if (wasActive && sidecarId) {
      await this.sidecarRequest(`/jobs/${sidecarId}/cancel`, { method: "POST", body: "{}" }).catch(() => undefined);
    }
    return job;
  }

  async workflowRejectFinishVisual(
    token: string,
    request: Prompt3DRejectFinishVisualRequest,
  ): Promise<Prompt3DFinishVisualRejection> {
    this.requireGrant(token);
    if (this.starting) throw new Error("A prompted generation transition is in progress; its visual decision cannot be changed concurrently.");
    await this.loadFinishHistory();
    if (!request?.source || request.source.kind !== "finish" || !BATCH_ID.test(request.source.jobId)) {
      throw new Error("A valid finishing revision is required for visual rejection.");
    }
    const job = this.finishJobs.get(request.source.jobId);
    if (!job || job.state !== "complete" || !job.assetPath || !job.sha256 || !job.geometryHash
      || !job.validation || !job.technicalValidation?.gameReady || !job.provenancePath) {
      throw new Error("Only a completed, technically valid texture or animation revision can be visually rejected.");
    }
    const approvalPath = containedWorkflowPath(this.root, join(job.outputDirectory, "visual-approval.json"));
    if (job.visualApproval || job.visualApprovalPath || job.visualApprovalSha256 || existsSync(approvalPath)) {
      throw new Error("An approved finishing revision cannot later be rejected.");
    }
    const classification = request.classification;
    const allowed = job.operation === "texture"
      ? ["appearance-mismatch", "prompt-negation-misunderstanding", "other"]
      : ["motion-mismatch", "placement-path-mismatch", "deformation-artifact", "prompt-negation-misunderstanding", "playback-problem", "other"];
    if (!allowed.includes(classification)) throw new Error(`The selected rejection reason is not valid for ${job.operation}.`);
    const note = String(request.note ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
    if (note.length > 500 || (classification === "other" && !note)) {
      throw new Error("A finishing rejection note is limited to 500 characters and is required for Other.");
    }
    const path = containedWorkflowPath(this.root, job.assetPath);
    const inspection = await inspectWorkflowGlb(path);
    if (inspection.sha256 !== job.sha256 || inspection.geometryHash !== job.geometryHash) {
      throw new Error("The finishing output no longer matches the revision being rejected.");
    }
    const retained = await this.persistFinishVisualRejection(join(job.outputDirectory, "visual-rejection.json"), {
      version: 1,
      stage: job.operation,
      assetId: job.assetId,
      jobId: job.id,
      assetPath: path,
      assetSha256: inspection.sha256,
      geometryHash: inspection.geometryHash,
      promptSha256: workflowPromptSha256(job.instruction),
      specFingerprint: workflowSpecFingerprint(sanitizeAssetSpec(job.baseSpec)),
      ...(job.operation === "texture"
        ? { textureFingerprint: inspection.textureFingerprint }
        : {
          animationFingerprint: inspection.animationFingerprint,
          animationPlanSha256: stableWorkflowSha256(job.animationPlan ?? {}),
        }),
      classification,
      note,
    });
    Object.assign(job, {
      visualRejection: retained.rejection,
      visualRejectionPath: retained.path,
      visualRejectionSha256: retained.sha256,
      message: `${job.operation === "texture" ? "Texture" : "Animation"} revision explicitly rejected. Configure a replacement from its exact approved parent.`,
    });
    await this.publishFinishJob(job);
    return retained.rejection;
  }

  async workflowApproveVisual(token: string, request: Prompt3DApproveVisualRequest): Promise<Prompt3DVisualApproval> {
    this.requireGrant(token);
    const { source, inspection: visualInspection } = request;
    if (this.starting) throw new Error("A prompted generation transition is in progress; its visual decision cannot be changed concurrently.");
    await Promise.all([this.loadHistory(), this.loadFinishHistory()]);
    if (source.kind === "generation") {
      const job = this.jobs.get(source.jobId);
      if (!job) throw new Error("Hunyuan generation job not found.");
      const variantIndex = source.variantIndex ?? 0;
      const rejectionRecordPath = contained(job.outputDirectory, join(job.outputDirectory, `variant-${variantIndex + 1}`, "visual-rejection.json"));
      if (job.geometryRejection || job.geometryRejectionPath || job.geometryRejectionSha256 || existsSync(rejectionRecordPath)) {
        throw new Error("This generated geometry was explicitly rejected and cannot later be marked as an accepted revision.");
      }
      const verified = await this.verifyGenerationVariant(job, variantIndex);
      assertPrompt3DVisualInspectionEvidence(visualInspection, {
        assetPath: verified.path,
        assetSha256: verified.inspection.sha256,
        stage: "geometry",
      });
      const assetId = job.assetId ?? job.id;
      const retained = await this.persistVisualApproval(
        join(job.outputDirectory, `variant-${variantIndex + 1}`, "visual-approval.json"),
        {
          version: 1,
          stage: "geometry",
          assetId,
          jobId: job.id,
          assetPath: verified.path,
          assetSha256: verified.inspection.sha256,
          geometryHash: verified.inspection.geometryHash,
          promptSha256: workflowPromptSha256(job.spec.prompt),
          specFingerprint: workflowSpecFingerprint(sanitizeAssetSpec(job.spec)),
          inspection: visualInspection,
        },
      );
      Object.assign(verified.variant, {
        visualApproval: retained.approval,
        visualApprovalPath: retained.path,
        visualApprovalSha256: retained.sha256,
      });
      this.publishJob(job);
      return retained.approval;
    }

    const job = this.finishJobs.get(source.jobId);
    if (!job || job.state !== "complete" || !job.assetPath || !job.sha256 || !job.geometryHash
      || !job.provenancePath || !job.validation || !job.technicalValidation?.gameReady) {
      throw new Error("Only a completed, technically valid texture or animation revision can be visually approved.");
    }
    const rejectionPath = containedWorkflowPath(this.root, join(job.outputDirectory, "visual-rejection.json"));
    if (job.visualRejection || job.visualRejectionPath || job.visualRejectionSha256 || existsSync(rejectionPath)) {
      throw new Error("This finishing revision was explicitly rejected and cannot later be approved.");
    }
    if (job.visualApproval && job.lineagePath && job.lineageSha256) {
      await this.verifyFinishLineage(job, false);
      await this.publishFinishJob(job);
      return job.visualApproval;
    }
    const parent = await this.resolveWorkflowSource(job.source, {
      useExistingGeneratedModel: job.usedExistingGeneratedModel === true,
      ...(job.usedExistingGeneratedModel === true && job.lineage.existingGeometryDecision
        ? { existingGeometryDecision: job.lineage.existingGeometryDecision }
        : {}),
    });
    if (parent.assetId !== job.assetId || parent.sha256 !== job.sourceSha256 || parent.geometryHash !== job.sourceGeometryHash) {
      throw new Error("Finishing revision no longer matches its exact approved parent.");
    }
    const path = containedWorkflowPath(this.root, job.assetPath);
    const inspection = await inspectWorkflowGlb(path);
    if (inspection.sha256 !== job.sha256 || inspection.geometryHash !== job.geometryHash
      || inspection.geometryHash !== parent.geometryHash) {
      throw new Error("Finishing output no longer matches its retained identity or parent geometry.");
    }
    const parentInspection = await inspectWorkflowGlb(parent.path);
    const provenancePath = containedWorkflowPath(this.root, job.provenancePath);
    const provenanceLink = await lstat(provenancePath);
    const provenanceInfo = await stat(provenancePath);
    if (provenanceLink.isSymbolicLink() || !provenanceInfo.isFile() || provenanceInfo.size < 1 || provenanceInfo.size > 2 * 1024 ** 2) {
      throw new Error("Finishing provenance is unsafe.");
    }
    const provenanceBytes = await readFile(provenancePath);
    const provenanceSha256 = sha256Hex(provenanceBytes);
    const provenance = JSON.parse(provenanceBytes.toString("utf8")) as Record<string, any>;
    const parentProvenanceSha256 = parent.lineage.revisions.at(-1)?.provenanceSha256 ?? parent.lineage.root.provenanceSha256;
    if (provenance.assetId !== job.assetId
      || provenance.revisionJobId !== job.id
      || provenance.operation !== job.operation
      || workflowPromptSha256(String(provenance.prompt ?? "")) !== workflowPromptSha256(job.instruction)
      || provenance.source?.kind !== job.source.kind
      || provenance.source?.jobId !== job.source.jobId
      || provenance.source?.sha256 !== job.sourceSha256
      || provenance.source?.geometryHash !== job.sourceGeometryHash
      || provenance.output?.path !== path
      || provenance.output?.sha256 !== inspection.sha256
      || provenance.output?.geometryHash !== inspection.geometryHash
      || provenance.output?.byteSize !== inspection.byteSize
      || provenance.output?.textureFingerprint !== inspection.textureFingerprint
      || provenance.parentProvenanceSha256 !== parentProvenanceSha256) {
      throw new Error("Finishing provenance does not bind the exact approved parent, prompt and output.");
    }
    if (job.operation === "texture") {
      if (job.provider !== "hunyuan3d-paint-2.1"
        || provenance.method !== "hunyuan-dit-reference-plus-official-hunyuan3d-paint"
        || provenance.provider?.id !== "hunyuan3d-2"
        || !job.providerVerification
        || job.providerVerification.verificationMode !== "deep"
        || stableJson(provenance.providerVerification) !== stableJson(job.providerVerification)
        || !job.executionProfile
        || stableJson(provenance.executionProfile) !== stableJson(job.executionProfile)
        || inspection.textures < 1
        || parentInspection.textureFingerprint === inspection.textureFingerprint) {
        throw new Error("Texture approval requires a changed, deep-verified Hunyuan Paint result.");
      }
    } else if (job.provider === "hy-motion-1.0-lite") {
      if (provenance.method !== "official-hy-motion-1.0-lite-plus-local-mixamo25-skin"
        || provenance.provider?.id !== "hy-motion-1"
        || !job.providerVerification
        || job.providerVerification.providerId !== "hy-motion-1"
        || job.providerVerification.verificationMode !== "deep"
        || stableJson(provenance.providerVerification) !== stableJson(job.providerVerification)
        || inspection.animationFingerprint !== provenance.output?.animationFingerprint
        || inspection.skins < 1 || inspection.joints < 22 || inspection.skinnedMeshNodes < 1 || inspection.boneRotationChannels < 22
        || inspection.clipIds.length < 1
        || stableWorkflowSha256(provenance.plan) !== stableWorkflowSha256(job.animationPlan ?? {})) {
        throw new Error("Animation approval requires the exact deep-verified HY-Motion data, local skin, generated bone channels and playable clips.");
      }
    } else {
      const cpuMethods = new Set(["deterministic-cpu-skeletal-motion", "local-animation-library-retarget", "deterministic-morph-deformation", "rigid-object-motion"]);
      const skeletalCpu = job.animationRoute === "existing-rig" || job.animationRoute === "deterministic-cpu-rig" || job.animationRoute === "local-animation-library";
      if (job.provider !== "grudge-motion-graph-1"
        || !cpuMethods.has(String(provenance.method ?? ""))
        || provenance.provider?.id !== "grudge-motion-graph-1"
        || provenance.gpuRequired !== false
        || provenance.animationRoute !== job.animationRoute
        || inspection.animationFingerprint !== provenance.output?.animationFingerprint
        || inspection.clipIds.length < 1
        || stableWorkflowSha256(provenance.plan) !== stableWorkflowSha256(job.animationPlan ?? {})
        || (skeletalCpu && (inspection.skins < 1 || inspection.joints < 22 || inspection.skinnedMeshNodes < 1 || inspection.boneRotationChannels < 22 || !job.rigPreparation))) {
        throw new Error("CPU animation approval requires the exact declared route, immutable rig/deformation evidence and playable clips.");
      }
      if (job.animationRoute === "deterministic-morph-deformation" && (job.validation?.motion?.effectiveDeformationTargets ?? 0) < 1) {
        throw new Error("Morph/deformation animation approval requires measurable body deformation.");
      }
    }
    assertPrompt3DVisualInspectionEvidence(visualInspection, {
      assetPath: path,
      assetSha256: inspection.sha256,
      stage: job.operation,
      ...(job.operation === "animation" ? { animations: inspection.animations } : {}),
    });
    const retained = await this.persistVisualApproval(join(job.outputDirectory, "visual-approval.json"), {
      version: 1,
      stage: job.operation,
      assetId: job.assetId,
      jobId: job.id,
      assetPath: path,
      assetSha256: inspection.sha256,
      geometryHash: inspection.geometryHash,
      promptSha256: workflowPromptSha256(job.instruction),
        specFingerprint: workflowSpecFingerprint(sanitizeAssetSpec(job.baseSpec)),
      ...(job.operation === "texture"
        ? { textureFingerprint: inspection.textureFingerprint }
        : { animationFingerprint: inspection.animationFingerprint }),
      inspection: visualInspection,
    });
    const revision: Prompt3DWorkflowRevisionLineage = {
      version: 1,
      assetId: job.assetId,
      jobId: job.id,
      operation: job.operation,
      provider: job.provider,
      ...(job.providerVerification ? { providerVerification: job.providerVerification } : {}),
      ...(job.executionProfile ? { executionProfile: job.executionProfile } : {}),
      sourceJobId: job.source.jobId,
      sourceSha256: job.sourceSha256,
      sourceGeometryHash: job.sourceGeometryHash,
      outputPath: path,
      outputSha256: inspection.sha256,
      geometryHash: inspection.geometryHash,
      byteSize: inspection.byteSize,
      promptSha256: workflowPromptSha256(job.instruction),
      specFingerprint: workflowSpecFingerprint(sanitizeAssetSpec(job.baseSpec)),
      provenancePath,
      provenanceSha256,
      parentProvenanceSha256,
      visualApproval: retained.approval,
      visualApprovalPath: retained.path,
      visualApprovalSha256: retained.sha256,
      sourceTextureFingerprint: parentInspection.textureFingerprint,
      outputTextureFingerprint: inspection.textureFingerprint,
      ...(job.operation === "texture"
        ? { textureReferenceSha256: String(provenance.textureReference?.sha256 ?? "") }
        : {
          animationFingerprint: inspection.animationFingerprint,
          animationPlanSha256: stableWorkflowSha256(job.animationPlan ?? {}),
          ...(job.provider === "hy-motion-1.0-lite" ? { motionDataSha256: String(provenance.motionData?.sha256 ?? "") } : {}),
          ...(job.animationRoute ? { animationRoute: job.animationRoute } : {}),
          ...(job.rigPreparation ? { rigPreparation: job.rigPreparation } : {}),
          clipIds: inspection.clipIds,
        }),
    };
    const lineage = sealPrompt3DWorkflowLineage({
      version: 1,
      assetId: job.assetId,
      generationChain: parent.lineage.generationChain,
      ...(parent.lineage.existingGeometryDecision
        ? { existingGeometryDecision: parent.lineage.existingGeometryDecision }
        : {}),
      root: parent.lineage.root,
      revisions: [...parent.lineage.revisions, revision],
      finalJobId: job.id,
      finalSha256: inspection.sha256,
      finalGeometryHash: inspection.geometryHash,
    });
    const lineagePath = containedWorkflowPath(this.root, join(job.outputDirectory, "lineage.json"));
    const lineageBytes = Buffer.from(`${JSON.stringify(lineage, null, 2)}\n`, "utf8");
    if (existsSync(lineagePath)) {
      const existing = await readFile(lineagePath);
      if (stableJson(JSON.parse(existing.toString("utf8"))) !== stableJson(lineage)) throw new Error("Existing workflow lineage conflicts with this immutable approval.");
    } else {
      await writeFile(lineagePath, lineageBytes, { flag: "wx", mode: 0o600 });
    }
    Object.assign(job, {
      visualApproval: retained.approval,
      visualApprovalPath: retained.path,
      visualApprovalSha256: retained.sha256,
      lineage,
      lineagePath,
      lineageSha256: sha256Hex(await readFile(lineagePath)),
      message: `${job.operation === "texture" ? "Texture" : "Animation"} revision explicitly approved and bound to its exact retained bytes.`,
    });
    await this.publishFinishJob(job);
    return retained.approval;
  }

  private async saveFinishedWorkflowAsset(job: Prompt3DFinishJobStatus): Promise<Prompt3DWorkflowSaveResult> {
    const existing = this.workflowSavePromises.get(job.id);
    if (existing) return existing;
    const pending = saveWorkflowAsset(this.root, job);
    this.workflowSavePromises.set(job.id, pending);
    try {
      return await pending;
    } finally {
      if (this.workflowSavePromises.get(job.id) === pending) this.workflowSavePromises.delete(job.id);
    }
  }

  async workflowSave(token: string, source: Prompt3DAssetSource): Promise<Prompt3DWorkflowSaveResult> {
    this.requireGrant(token);
    await this.loadFinishHistory();
    if (source.kind !== "finish") throw new Error("Complete texture and animation finishing before saving to the managed asset library.");
    const job = this.finishJobs.get(source.jobId);
    if (!job) throw new Error("Workflow revision not found.");
    await this.verifyFinishLineage(job, true);
    return this.saveFinishedWorkflowAsset(job);
  }

  async workflowLibrary(token: string) {
    this.requireGrant(token);
    return readWorkflowLibrary(this.root);
  }

  async workflowExport(token: string, source: Prompt3DAssetSource, destinationPath: string) {
    this.requireGrant(token);
    await this.loadFinishHistory();
    if (source.kind !== "finish") throw new Error("Complete and approve Hunyuan Paint plus animation before exporting.");
    const job = this.finishJobs.get(source.jobId);
    if (!job) throw new Error("Workflow revision not found.");
    const resolved = await this.verifyFinishLineage(job, true);
    const destination = resolve(destinationPath);
    if (destination.toLowerCase().slice(-4) !== ".glb") throw new Error("Workflow export destination must end in .glb.");
    if (destination !== resolved.path) await copyFile(resolved.path, destination);
    const inspection = await inspectWorkflowGlb(destination);
    if (inspection.sha256 !== resolved.inspection.sha256) throw new Error("Exported GLB failed byte-for-byte verification.");
    return { destinationPath: destination, filename: workflowFilename(destination), sha256: inspection.sha256, byteSize: (await stat(destination)).size };
  }

  private async retainBatchPortableExport(
    job: Prompt3DFinishJobStatus,
    destinationPath: string,
    inspection: { sha256: string; byteSize: number },
    exportedAt: string,
  ): Promise<{ portable: NonNullable<Prompt3DBatchItemStatus["portableExport"]>; recordPath: string }> {
    const recorded = await recordWorkflowExport(this.root, job, {
      destinationPath,
      filename: workflowFilename(destinationPath),
      sha256: inspection.sha256,
      byteSize: inspection.byteSize,
    }, exportedAt);
    const recordPath = containedWorkflowPath(this.root, join(this.root, "workflow-exports", "individual", `${recorded.record.id}.json`));
    let reopened: Prompt3DWorkflowArtifactVerification;
    try {
      reopened = await verifyWorkflowArtifact(this.root, { kind: "portable", id: recorded.record.id });
    } catch (error) {
      await unlink(recordPath).catch(() => undefined);
      throw error;
    }
    return {
      recordPath,
      portable: {
        version: 1,
        destinationPath,
        filename: workflowFilename(destinationPath),
        sha256: inspection.sha256,
        byteSize: inspection.byteSize,
        exportedAt,
        recordId: recorded.record.id,
        recordSha256: recorded.record.recordSha256,
        reopenVerification: reopened,
      },
    };
  }

  private async verifyRetainedBatchPortable(
    job: Prompt3DFinishJobStatus,
    portable: NonNullable<Prompt3DBatchItemStatus["portableExport"]>,
    directory: string,
  ): Promise<NonNullable<Prompt3DBatchItemStatus["portableExport"]> | null> {
    if (resolve(dirname(portable.destinationPath)) !== directory) return null;
    const verification = await verifyWorkflowArtifact(this.root, { kind: "portable", id: portable.recordId });
    const recordPath = containedWorkflowPath(this.root, join(this.root, "workflow-exports", "individual", `${portable.recordId}.json`));
    const recordInfo = await lstat(recordPath);
    if (!recordInfo.isFile() || recordInfo.isSymbolicLink() || recordInfo.size < 2 || recordInfo.size > 64 * 1024) {
      throw new Error("Retained batch portable export record is unsafe.");
    }
    const record = JSON.parse(await readFile(recordPath, "utf8")) as { recordSha256?: string };
    if (record.recordSha256 !== portable.recordSha256
      || verification.sourceJobId !== job.id
      || verification.path !== portable.destinationPath
      || verification.sha256 !== portable.sha256
      || verification.byteSize !== portable.byteSize
      || !verification.retainedGeometry || !verification.retainedTextures || !verification.retainedAnimations) {
      throw new Error("Retained batch portable export failed durable reopen verification.");
    }
    return portable;
  }

  async batchExport(token: string, id: string, destinationDirectory: string): Promise<Prompt3DBatchExportResult> {
    this.requireGrant(token);
    const active = this.batchExportPromises.get(id);
    if (active) return active;
    const pending = this.batchExportChecked(token, id, destinationDirectory);
    this.batchExportPromises.set(id, pending);
    try {
      return await pending;
    } finally {
      if (this.batchExportPromises.get(id) === pending) this.batchExportPromises.delete(id);
    }
  }

  private async batchExportChecked(token: string, id: string, destinationDirectory: string): Promise<Prompt3DBatchExportResult> {
    await Promise.all([this.loadHistory(), this.loadFinishHistory()]);
    const batch = this.batchStatus(token, id);
    if (!batch || batch.state !== "complete" || batch.items.some((item) => item.state !== "complete")) {
      throw new Error("Only a completed serial Prompt-to-3D batch can be exported.");
    }
    const directory = resolve(destinationDirectory);
    const [directoryLink, directoryInfo] = await Promise.all([lstat(directory), stat(directory)]);
    if (directoryLink.isSymbolicLink() || !directoryInfo.isDirectory()) throw new Error("Batch export destination must be a regular folder.");
    this.assertStrictBatchManagedOutputs(batch);

    const sources = await Promise.all(batch.items.map(async (item) => {
      if (item.finalSource?.kind !== "finish" || !item.savedAsset) {
        throw new Error(`${item.name} has no durable managed workflow output to export.`);
      }
      const job = this.finishJobs.get(item.finalSource.jobId);
      if (!job) throw new Error(`${item.name} final workflow revision is unavailable.`);
      const resolved = await this.verifyFinishLineage(job, true);
      const savedPath = containedWorkflowPath(this.root, item.savedAsset.savedPath);
      const savedInspection = await inspectWorkflowGlb(savedPath);
      if (item.savedAsset.sourceJobId !== job.id
        || item.savedAsset.sha256 !== resolved.inspection.sha256
        || savedInspection.sha256 !== item.savedAsset.sha256
        || savedInspection.geometryHash !== item.savedAsset.geometryHash
        || savedInspection.byteSize !== item.savedAsset.byteSize) {
        throw new Error(`${item.name} managed workflow output failed retained hash verification.`);
      }
      if (batch.acceptance && (job.batchId !== batch.id || job.batchItemId !== item.id)) {
        throw new Error(`${item.name} final workflow revision is not bound to this strict batch item.`);
      }
      return { item, job, sourcePath: savedPath, sourceSha256: savedInspection.sha256, sourceByteSize: savedInspection.byteSize };
    }));

    const existing = await Promise.all(sources.map(async (source) => source.item.portableExport
      ? this.verifyRetainedBatchPortable(source.job, source.item.portableExport, directory)
      : null));
    const everyExisting = existing.every((portable) => portable !== null);
    if (everyExisting && (!batch.acceptance || batch.acceptance.receiptPath || !batch.acceptance.eligible)) {
      if (batch.acceptance?.receiptPath) {
        this.restoreStrictBatchAcceptance(batch.acceptance, batch.request, batch.id, dirname(batch.manifestPath));
      }
      const items = sources.map((source, index) => ({
        itemId: source.item.id,
        name: source.item.name,
        source: source.item.finalSource!,
        export: existing[index]!,
      }));
      return {
        version: 1,
        batchId: batch.id,
        destinationDirectory: directory,
        items,
        exportedAt: items[0].export.exportedAt,
      };
    }
    if (batch.acceptance && existing.some((portable, index) => portable === null && sources[index].item.portableExport)) {
      throw new Error("A strict final-run portable set is already bound to another destination and cannot create extra copies.");
    }

    if (batch.acceptance && !batch.acceptance.receiptPath) {
      batch.acceptance.exportAttemptCount += 1;
      if (batch.acceptance.exportAttemptCount > 1) batch.acceptance.eligible = false;
      await this.publishBatch(batch);
    }

    const exportedAt = new Date().toISOString();
    const staged = new Map<string, NonNullable<Prompt3DBatchItemStatus["portableExport"]>>();
    const createdPaths: string[] = [];
    const createdRecordPaths: string[] = [];
    let createdReceiptPath: string | undefined;
    const oldItemExports = new Map(batch.items.map((item) => [item.id, item.portableExport]));
    const oldEvidenceExports = new Map(batch.acceptance?.items.map((item) => [item.itemId, item.portable]) ?? []);
    const oldSeal = batch.acceptance ? {
      receiptPath: batch.acceptance.receiptPath,
      receiptSha256: batch.acceptance.receiptSha256,
      sealedAt: batch.acceptance.sealedAt,
    } : undefined;
    try {
      for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index];
        if (existing[index]) {
          staged.set(source.item.id, existing[index]!);
          continue;
        }
        const preferred = workflowFilename(source.item.savedAsset!.name);
        const stem = preferred.replace(/\.glb$/i, "");
        let destinationPath = "";
        for (let suffix = 1; suffix <= 10_000; suffix += 1) {
          const filename = suffix === 1 ? `${stem}.glb` : `${stem}-${suffix}.glb`;
          const candidate = resolve(directory, filename);
          try {
            await copyFile(source.sourcePath, candidate, constants.COPYFILE_EXCL);
            destinationPath = candidate;
            createdPaths.push(candidate);
            break;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          }
        }
        if (!destinationPath) throw new Error(`Could not reserve a collision-safe export filename for ${source.item.name}.`);
        const inspection = await inspectWorkflowGlb(destinationPath);
        if (inspection.sha256 !== source.sourceSha256 || inspection.byteSize !== source.sourceByteSize) {
          throw new Error(`${source.item.name} portable export failed byte-for-byte verification.`);
        }
        const retained = await this.retainBatchPortableExport(source.job, destinationPath, inspection, exportedAt);
        createdRecordPaths.push(retained.recordPath);
        staged.set(source.item.id, retained.portable);
      }

      if (staged.size !== batch.items.length) throw new Error("Batch export transaction did not stage every portable output.");
      for (const item of batch.items) {
        const portable = staged.get(item.id)!;
        item.portableExport = portable;
        const evidence = batch.acceptance?.items.find((candidate) => candidate.itemId === item.id);
        if (evidence) evidence.portable = structuredClone(portable);
      }
      if (batch.acceptance?.eligible) {
        const batchDirectory = dirname(batch.manifestPath);
        const receiptPath = containedWorkflowPath(this.root, join(batchDirectory, "strict-acceptance-receipt.json"));
        const sealedAt = new Date().toISOString();
        const receipt = createPrompt3DBatchAcceptanceReceipt(batch.id, batch.acceptance, sealedAt);
        const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
        await writeFile(receiptPath, receiptBytes, { flag: "wx", mode: 0o600 });
        createdReceiptPath = receiptPath;
        batch.acceptance.receiptPath = receiptPath;
        batch.acceptance.receiptSha256 = sha256Hex(receiptBytes);
        batch.acceptance.sealedAt = sealedAt;
      }
      await this.publishBatch(batch);
    } catch (error) {
      for (const item of batch.items) {
        const old = oldItemExports.get(item.id);
        if (old) item.portableExport = old;
        else delete item.portableExport;
        const evidence = batch.acceptance?.items.find((candidate) => candidate.itemId === item.id);
        const oldEvidence = oldEvidenceExports.get(item.id);
        if (evidence) {
          if (oldEvidence) evidence.portable = oldEvidence;
          else delete evidence.portable;
        }
      }
      if (batch.acceptance && oldSeal) {
        if (oldSeal.receiptPath) batch.acceptance.receiptPath = oldSeal.receiptPath;
        else delete batch.acceptance.receiptPath;
        if (oldSeal.receiptSha256) batch.acceptance.receiptSha256 = oldSeal.receiptSha256;
        else delete batch.acceptance.receiptSha256;
        if (oldSeal.sealedAt) batch.acceptance.sealedAt = oldSeal.sealedAt;
        else delete batch.acceptance.sealedAt;
      }
      if (createdReceiptPath) await unlink(createdReceiptPath).catch(() => undefined);
      await Promise.all(createdRecordPaths.map((path) => unlink(path).catch(() => undefined)));
      await Promise.all(createdPaths.map((path) => unlink(path).catch(() => undefined)));
      throw error;
    }
    const exported = sources.map((source) => ({
      itemId: source.item.id,
      name: source.item.name,
      source: source.item.finalSource!,
      export: staged.get(source.item.id)!,
    }));
    return { version: 1, batchId: batch.id, destinationDirectory: directory, items: exported, exportedAt };
  }

  private queueBatchAdvance(batchId: string): void {
    if (this.batchesAdvancePending.has(batchId)) return;
    this.batchesAdvancePending.add(batchId);
    if (!this.batchesAdvancing.has(batchId)) setTimeout(() => void this.advanceBatch(batchId), 0);
  }

  private queueBatchAdvanceForJob(jobId: string): void {
    const batchId = this.batchJobLinks.get(jobId);
    if (batchId) this.queueBatchAdvance(batchId);
  }

  private async publishBatch(batch: Prompt3DBatchStatus): Promise<void> {
    const request = this.batchRequests.get(batch.id);
    const runtimes = this.batchRuntime.get(batch.id);
    if (request) batch.request = request;
    if (runtimes) {
      batch.runtime = Object.fromEntries([...runtimes.entries()].map(([itemId, runtime]) => [itemId, {
        ...runtime,
        ...(runtime.currentSource ? { currentSource: { ...runtime.currentSource } } : {}),
      }]));
    }
    batch.updatedAt = new Date().toISOString();
    const snapshot = JSON.parse(JSON.stringify(batch)) as Prompt3DBatchStatus;
    const previous = this.batchPublishQueues.get(batch.id);
    const pending = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(async () => {
      await this.writeJsonAtomic(snapshot.manifestPath, snapshot);
      this.emit("batch-progress", snapshot);
    });
    this.batchPublishQueues.set(batch.id, pending);
    try {
      await pending;
    } finally {
      if (this.batchPublishQueues.get(batch.id) === pending) this.batchPublishQueues.delete(batch.id);
    }
  }

  private normalizeBatchRequest(input: Prompt3DBatchRequest): Prompt3DBatchRequest {
    const name = input?.name?.trim().replace(/\s+/g, " ");
    if (!name || name.length > 120) throw new Error("Batch name must contain 1–120 characters.");
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 24) throw new Error("A batch must contain 1–24 prompted assets.");
    const acceptance = input.acceptance;
    if (acceptance !== undefined && (acceptance?.profile !== "strict-final-run-v1"
      || acceptance.expectedItemCount !== PROMPT3D_STRICT_BATCH_ITEM_COUNT)) {
      throw new Error("Unknown or malformed Prompt-to-3D batch acceptance profile.");
    }
    if (acceptance && input.items.length !== PROMPT3D_STRICT_BATCH_ITEM_COUNT) {
      throw new Error(`Strict final-run acceptance requires exactly ${PROMPT3D_STRICT_BATCH_ITEM_COUNT} prompted assets.`);
    }
    const seen = new Set<string>();
    const seenBaselines = new Set<string>();
    const items = input.items.map((candidate) => {
      const legacy = candidate as typeof candidate & { animationPrompts?: unknown };
      const id = candidate.id?.trim();
      const itemName = candidate.name?.trim().replace(/\s+/g, " ");
      if (!id || !/^[A-Za-z0-9._-]{1,80}$/.test(id) || seen.has(id)) throw new Error("Each batch item needs a unique safe ID of 1–80 characters.");
      seen.add(id);
      if (!itemName || itemName.length > 120) throw new Error("Each batch item name must contain 1–120 characters.");
      if (candidate.spec.providerId !== "hunyuan3d-2" || candidate.spec.route !== "concept-image-to-3d") {
        throw new Error("Uninterrupted workflow batches use only the explicit Hunyuan concept route.");
      }
      if (candidate.spec.referenceImage !== undefined || candidate.spec.referenceImages !== undefined) {
        throw new Error("Serial acceptance batches are prompt-only; clear the optional local reference images before queueing an item.");
      }
      const shapeRefinement = candidate.shapeRefinement?.trim().replace(/\s+/g, " ") ?? "";
      if (shapeRefinement.length > 1_000 || candidate.spec.prompt.length + shapeRefinement.length + 32 > MAX_PROMPT) throw new Error("Shape refinement is too long for the retained Hunyuan brief.");
      const texturePrompts = (candidate.texturePrompts ?? []).map((value) => value.trim().replace(/\s+/g, " "));
      const rawAnimationRevisions = Array.isArray(candidate.animationRevisions)
        ? candidate.animationRevisions
        : Array.isArray(legacy.animationPrompts)
          ? legacy.animationPrompts.map((prompt) => ({ prompt, mode: candidate.animation?.mode ?? "append" }))
          : [];
      const animationRevisions = rawAnimationRevisions.map((revision) => {
        if (!revision || typeof revision !== "object") throw new Error("Each animation revision needs a prompt and append/replace mode.");
        const prompt = typeof revision.prompt === "string" ? revision.prompt.trim().replace(/\s+/g, " ") : "";
        const mode = revision.mode;
        if (!prompt || prompt.length > MAX_PROMPT || (mode !== "append" && mode !== "replace")) {
          throw new Error("Each animation revision needs a 1–2,000 character prompt and an explicit append or replace mode.");
        }
        return { prompt, mode };
      });
      if (!shapeRefinement) throw new Error("Each complete batch item needs a shape-refinement prompt.");
      if (texturePrompts.length < PROMPT3D_MIN_BATCH_FINISH_PROMPTS) {
        throw new Error("Each complete batch item needs at least two texture prompts: an initial texture prompt and a prompted refinement.");
      }
      if (animationRevisions.length < PROMPT3D_MIN_BATCH_FINISH_PROMPTS) {
        throw new Error("Each complete batch item needs at least two animation revisions: an initial animation prompt and a prompted refinement.");
      }
      if (texturePrompts.length > 8 || animationRevisions.length > 8 || texturePrompts.some((value) => !value || value.length > MAX_PROMPT)) {
        throw new Error("Each finishing prompt must contain 1–2,000 characters, with no more than eight texture or animation revisions per item.");
      }
      let animation: Prompt3DBatchRequest["items"][number]["animation"];
      if (candidate.animation) {
        const limits: Array<[keyof NonNullable<typeof candidate.animation>, number | undefined, number, number]> = [
          ["duration", candidate.animation.duration, 0.5, 5],
          ["cycles", candidate.animation.cycles, 0.25, 12],
          ["intensity", candidate.animation.intensity, 0.005, 0.5],
          ["distance", candidate.animation.distance, 0.01, 50],
        ];
        for (const [key, value, minimum, maximum] of limits) {
          if (value !== undefined && (!Number.isFinite(value) || value < minimum || value > maximum)) {
            throw new Error(`Animation ${key} must be from ${minimum} to ${maximum}.`);
          }
        }
        animation = {
          ...(candidate.animation.duration !== undefined ? { duration: candidate.animation.duration } : {}),
          ...(candidate.animation.cycles !== undefined ? { cycles: candidate.animation.cycles } : {}),
          ...(candidate.animation.intensity !== undefined ? { intensity: candidate.animation.intensity } : {}),
          ...(candidate.animation.distance !== undefined ? { distance: candidate.animation.distance } : {}),
          ...(candidate.animation.provider !== undefined ? { provider: candidate.animation.provider } : {}),
          ...(candidate.animation.libraryPackDir !== undefined ? { libraryPackDir: candidate.animation.libraryPackDir } : {}),
          ...(candidate.animation.libraryClipName !== undefined ? { libraryClipName: candidate.animation.libraryClipName } : {}),
        };
        if (Object.keys(animation).length === 0) animation = undefined;
      }
      if (acceptance) {
        if (animation?.provider !== undefined && animation.provider !== "hy-motion-1.0-lite") {
          throw new Error("Strict final-run acceptance cannot use a deterministic or library fallback in place of genuine HY-Motion.");
        }
        animation = { ...(animation ?? {}), provider: "hy-motion-1.0-lite" };
      }
      const spec = withObjectRules(assertSpec({
        ...sanitizeAssetSpec(candidate.spec),
        variants: 1,
        generateTextures: false,
        providerId: "hunyuan3d-2",
        route: "concept-image-to-3d",
      }));
      const baselineManagedAssetId = candidate.baselineManagedAssetId?.trim();
      if (acceptance && (!baselineManagedAssetId || !/^[A-Za-z0-9._-]{1,120}$/.test(baselineManagedAssetId))) {
        throw new Error("Every strict final-run item must select a safe verified individual managed baseline ID.");
      }
      if (acceptance) {
        if (seenBaselines.has(baselineManagedAssetId!)) {
          throw new Error(`Strict final-run acceptance requires ${PROMPT3D_STRICT_BATCH_ITEM_COUNT} distinct individual managed baselines.`);
        }
        seenBaselines.add(baselineManagedAssetId!);
      }
      return {
        id,
        name: itemName,
        spec,
        shapeRefinement,
        texturePrompts,
        animationRevisions,
        ...(animation ? { animation } : {}),
        ...(acceptance ? { baselineManagedAssetId } : {}),
      };
    });
    return {
      name,
      items,
      ...(acceptance ? { acceptance: { profile: acceptance.profile, expectedItemCount: PROMPT3D_STRICT_BATCH_ITEM_COUNT } } : {}),
    };
  }

  private async prepareStrictBatchAcceptance(request: Prompt3DBatchRequest): Promise<{
    request: Prompt3DBatchRequest;
    acceptance?: Prompt3DBatchAcceptanceEvidence;
  }> {
    if (!request.acceptance) return { request };
    const library = await readWorkflowLibrary(this.root);
    const byManagedId = new Map(library.map((asset) => [asset.id, asset]));
    const unavailableSeeds = new Set<number>([
      ...[...this.jobs.values()].map((job) => job.spec.seed),
      ...[...this.finishJobs.values()].map((job) => job.seed),
    ].filter((seed) => Number.isSafeInteger(seed) && seed >= 0 && seed <= 0x7fffffff));
    const generationOffsets = Array.from({ length: 64 }, (_, index) => index);
    const seenSourceJobs = new Set<string>();
    const seenRootJobs = new Set<string>();
    const seenFinalHashes = new Set<string>();
    const admittedAt = new Date().toISOString();
    const evidenceItems: Prompt3DBatchAcceptanceEvidence["items"] = [];
    const assignedItems: Prompt3DBatchRequest["items"] = [];

    for (const item of request.items) {
      const baselineId = item.baselineManagedAssetId!;
      const asset = byManagedId.get(baselineId);
      if (!asset) throw new Error(`${item.name} must select a currently verified managed individual workflow baseline.`);
      const finalJob = this.finishJobs.get(asset.sourceJobId);
      if (!finalJob || finalJob.batchId !== undefined || finalJob.batchItemId !== undefined) {
        throw new Error(`${item.name} baseline must come from a verified individual workflow, not any batch.`);
      }
      const retained = await this.verifyFinishLineage(finalJob, true);
      if (asset.sourceJobId !== finalJob.id
        || asset.sha256 !== retained.inspection.sha256
        || asset.geometryHash !== retained.inspection.geometryHash
        || asset.rootGenerationJobId !== retained.lineage.generationChain[0]?.jobId
        || asset.lineageSha256 !== finalJob.lineageSha256
        || asset.finalVisualApprovalSha256 !== finalJob.visualApprovalSha256) {
        throw new Error(`${item.name} baseline managed record no longer matches its verified individual workflow lineage.`);
      }
      if (seenSourceJobs.has(asset.sourceJobId)
        || seenRootJobs.has(asset.rootGenerationJobId)
        || seenFinalHashes.has(asset.sha256)) {
        throw new Error("Strict final-run baselines must be six distinct individual results, not aliases or byte-identical copies.");
      }
      seenSourceJobs.add(asset.sourceJobId);
      seenRootJobs.add(asset.rootGenerationJobId);
      seenFinalHashes.add(asset.sha256);

      const generationJobs = retained.lineage.generationChain.map((entry) => {
        const generation = this.jobs.get(entry.jobId);
        if (!generation || generation.conceptApproval?.conceptSha256 !== entry.conceptSha256) {
          throw new Error(`${item.name} baseline generation history is unavailable or no longer matches its approved concept.`);
        }
        return generation;
      });
      const generationChain = retained.lineage.generationChain.map<Prompt3DBatchAcceptanceGenerationEvidence>((entry, index) => {
        const generation = generationJobs[index];
        return {
          jobId: entry.jobId,
          seed: generation.spec.seed,
          conceptSha256: entry.conceptSha256,
          outputSha256: entry.outputSha256,
          geometryHash: entry.geometryHash,
        };
      });
      const selectedGeneration = generationChain.at(-1);
      if (!selectedGeneration || generationChain.length < 2) {
        throw new Error(`${item.name} baseline must retain an approved base generation and prompted shape refinement.`);
      }
      const basePrompt = generationJobs[0].spec.prompt.trim();
      const refinedPrompt = generationJobs.at(-1)!.spec.prompt.trim();
      const shapePrefixes = [
        `${basePrompt}\n\nShape refinement: `,
        `${basePrompt}\n\nVisual geometry correction: `,
        `${basePrompt}. Refinement request: `,
      ];
      const shapePrefix = shapePrefixes.find((prefix) => refinedPrompt.startsWith(prefix));
      if (!shapePrefix || !refinedPrompt.slice(shapePrefix.length).trim()) {
        throw new Error(`${item.name} baseline does not expose a normalized prompted shape-refinement intent.`);
      }
      const baselineRevisions = retained.lineage.revisions.map((revision) => {
        const finish = this.finishJobs.get(revision.jobId);
        if (!finish) throw new Error(`${item.name} baseline finishing history is unavailable.`);
        return finish;
      });
      const baselineTextureRevisions = baselineRevisions.filter((revision) => revision.operation === "texture");
      const baselineAnimationPlans = baselineRevisions
        .filter((revision) => revision.operation === "animation")
        .map((revision) => {
          if (!revision.animationPlan) throw new Error(`${item.name} baseline animation plan is unavailable.`);
          return { ...revision.animationPlan };
        });
      if (baselineTextureRevisions.length < PROMPT3D_MIN_BATCH_FINISH_PROMPTS
        || baselineAnimationPlans.length < PROMPT3D_MIN_BATCH_FINISH_PROMPTS) {
        throw new Error(`${item.name} strict baseline must retain both the initial and refined texture and animation approvals.`);
      }
      const requestAnimationPlans = item.animationRevisions.map((revision) => ({
        ...hyMotionIntentPlan(revision.prompt, {
          ...item.animation,
          mode: revision.mode,
        }, 0),
      }));
      const baselineIntentSha256 = prompt3DBatchWorkflowIntentSha256({
        spec: generationJobs[0].spec,
        shapeRefinement: refinedPrompt.slice(shapePrefix.length),
        texturePrompts: baselineTextureRevisions.map((revision) => revision.instruction),
        animationPlans: baselineAnimationPlans,
      });
      const requestIntentSha256 = prompt3DBatchWorkflowIntentSha256({
        spec: item.spec,
        shapeRefinement: item.shapeRefinement,
        texturePrompts: item.texturePrompts,
        animationPlans: requestAnimationPlans,
      });
      if (baselineIntentSha256 !== requestIntentSha256) {
        throw new Error(`${item.name} queued workflow intent does not match its selected individual managed baseline.`);
      }
      const baseline: Prompt3DBatchAcceptanceBaselineEvidence = {
        ...selectedGeneration,
        managedAssetId: asset.id,
        sourceJobId: asset.sourceJobId,
        finalSha256: asset.sha256,
        generationChain,
      };
      const requestedSeed = item.spec.seed;
      const finishingOffsets = [
        ...Array.from({ length: 64 }, (_, index) => 100 + index),
        ...Array.from({ length: 64 }, (_, index) => 200 + index),
      ];
      const offsets = [...new Set([...generationOffsets, ...finishingOffsets])];
      const assignedSeed = reserveFreshPrompt3DBatchSeed(requestedSeed, unavailableSeeds, offsets);
      const reservedSeeds = offsets.map((offset) => assignedSeed + offset);
      assignedItems.push({ ...item, spec: { ...item.spec, seed: assignedSeed } });
      evidenceItems.push({
        itemId: item.id,
        requestedSeed,
        assignedSeed,
        reservedSeeds,
        baselineIntentSha256,
        requestIntentSha256,
        baseline,
        finishing: [],
      });
    }

    return {
      request: { ...request, items: assignedItems },
      acceptance: {
        version: 1,
        profile: "strict-final-run-v1",
        expectedItemCount: PROMPT3D_STRICT_BATCH_ITEM_COUNT,
        eligible: true,
        serviceRunId: this.serviceRunId,
        restoreCount: 0,
        retryCount: 0,
        exportAttemptCount: 0,
        admittedAt,
        items: evidenceItems,
      },
    };
  }

  private restoreStrictBatchAcceptance(
    value: unknown,
    request: Prompt3DBatchRequest,
    batchId: string,
    batchDirectory: string,
  ): Prompt3DBatchAcceptanceEvidence | undefined {
    if (!request.acceptance) {
      if (value !== undefined) throw new Error("An ordinary batch cannot retain strict final-run acceptance evidence.");
      return undefined;
    }
    if (!value || typeof value !== "object") throw new Error("Strict final-run acceptance evidence is missing.");
    const acceptance = structuredClone(value) as Prompt3DBatchAcceptanceEvidence;
    const sha = /^[a-f0-9]{64}$/i;
    const safeId = (candidate: unknown) => typeof candidate === "string" && /^[A-Za-z0-9._-]{1,120}$/.test(candidate);
    const validGeneration = (candidate: Prompt3DBatchAcceptanceGenerationEvidence | undefined) => Boolean(candidate
      && safeId(candidate.jobId)
      && Number.isSafeInteger(candidate.seed) && candidate.seed >= 0 && candidate.seed <= 0x7fffffff
      && sha.test(candidate.conceptSha256) && sha.test(candidate.outputSha256) && sha.test(candidate.geometryHash));
    if (acceptance.version !== 1 || acceptance.profile !== "strict-final-run-v1"
      || acceptance.expectedItemCount !== PROMPT3D_STRICT_BATCH_ITEM_COUNT
      || typeof acceptance.eligible !== "boolean" || !BATCH_ID.test(acceptance.serviceRunId)
      || !Number.isInteger(acceptance.restoreCount) || acceptance.restoreCount < 0
      || !Number.isInteger(acceptance.retryCount) || acceptance.retryCount < 0
      || !Number.isInteger(acceptance.exportAttemptCount) || acceptance.exportAttemptCount < 0
      || (acceptance.eligible && (acceptance.restoreCount !== 0 || acceptance.retryCount !== 0 || acceptance.exportAttemptCount > 1))
      || !Number.isFinite(Date.parse(acceptance.admittedAt))
      || !Array.isArray(acceptance.items) || acceptance.items.length !== PROMPT3D_STRICT_BATCH_ITEM_COUNT) {
      throw new Error("Retained strict final-run acceptance header is invalid.");
    }
    const requestIds = request.items.map((item) => item.id);
    const retainedIds = acceptance.items.map((item) => item.itemId);
    if (new Set(retainedIds).size !== PROMPT3D_STRICT_BATCH_ITEM_COUNT
      || requestIds.some((itemId) => !retainedIds.includes(itemId))) {
      throw new Error("Retained strict final-run item identities do not match the batch request.");
    }
    const allReservedSeeds: number[] = [];
    for (const item of acceptance.items) {
      const requestedItem = request.items.find((candidate) => candidate.id === item.itemId)!;
      if (!Number.isSafeInteger(item.requestedSeed) || item.requestedSeed < 0 || item.requestedSeed > 0x7fffffff
        || !Number.isSafeInteger(item.assignedSeed) || item.assignedSeed < 0 || item.assignedSeed > 0x7fffffff
        || requestedItem.spec.seed !== item.assignedSeed
        || !Array.isArray(item.reservedSeeds) || item.reservedSeeds[0] !== item.assignedSeed
        || item.reservedSeeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0 || seed > 0x7fffffff)
        || !sha.test(item.baselineIntentSha256) || !sha.test(item.requestIntentSha256)
        || item.baselineIntentSha256 !== item.requestIntentSha256) {
        throw new Error(`Retained strict final-run seed evidence for ${item.itemId} is invalid.`);
      }
      allReservedSeeds.push(...item.reservedSeeds);
      const baseline = item.baseline;
      if (!baseline || !safeId(baseline.managedAssetId) || !safeId(baseline.sourceJobId)
        || baseline.managedAssetId !== requestedItem.baselineManagedAssetId
        || !sha.test(baseline.finalSha256) || !validGeneration(baseline)
        || !Array.isArray(baseline.generationChain) || baseline.generationChain.length < 2
        || baseline.generationChain.some((generation) => !validGeneration(generation))
        || stableJson(baseline.generationChain.at(-1)) !== stableJson({
          jobId: baseline.jobId,
          seed: baseline.seed,
          conceptSha256: baseline.conceptSha256,
          outputSha256: baseline.outputSha256,
          geometryHash: baseline.geometryHash,
        })) {
        throw new Error(`Retained strict final-run individual baseline for ${item.itemId} is invalid.`);
      }
      if (item.base) {
        if (!validGeneration(item.base)) throw new Error(`Retained strict final-run base evidence for ${item.itemId} is invalid.`);
        assertFreshPrompt3DBatchGeneration(acceptance, item.itemId, "base", item.base);
      }
      if (item.refined) {
        if (!item.base || !validGeneration(item.refined)) throw new Error(`Retained strict final-run refinement evidence for ${item.itemId} is invalid.`);
        assertFreshPrompt3DBatchGeneration(acceptance, item.itemId, "refined", item.refined);
      }
      if (!Array.isArray(item.finishing)) throw new Error(`Retained strict final-run finishing ledger for ${item.itemId} is invalid.`);
      let animationSeen = false;
      let textureIndex = 0;
      let animationIndex = 0;
      for (const finish of item.finishing) {
        if (!safeId(finish.jobId) || (finish.operation !== "texture" && finish.operation !== "animation")
          || !Number.isSafeInteger(finish.seed) || !item.reservedSeeds.includes(finish.seed)
          || !sha.test(finish.promptSha256) || !sha.test(finish.outputSha256)) {
          throw new Error(`Retained strict final-run finishing ledger for ${item.itemId} is invalid.`);
        }
        if (finish.operation === "texture") {
          if (animationSeen || finish.revisionIndex !== textureIndex++) throw new Error(`Retained strict final-run finishing order for ${item.itemId} is invalid.`);
        } else {
          animationSeen = true;
          if (finish.revisionIndex !== animationIndex++) throw new Error(`Retained strict final-run finishing order for ${item.itemId} is invalid.`);
        }
      }
      if (item.managed) {
        const managed = item.managed;
        if (managed.version !== 1 || managed.method !== "hunyuan3d-workflow" || managed.provider !== "hunyuan3d-2"
          || !safeId(managed.id) || !safeId(managed.sourceJobId) || !safeId(managed.rootGenerationJobId)
          || !sha.test(managed.sha256) || !sha.test(managed.geometryHash) || !sha.test(managed.lineageSha256)
          || !sha.test(managed.finalVisualApprovalSha256) || !Number.isSafeInteger(managed.byteSize) || managed.byteSize < 1) {
          throw new Error(`Retained strict final-run managed evidence for ${item.itemId} is invalid.`);
        }
        containedWorkflowPath(this.root, managed.savedPath);
        containedWorkflowPath(this.root, managed.lineagePath);
        assertFreshPrompt3DBatchFinal(acceptance, item.itemId, managed.sha256);
      }
      if (item.portable) {
        const portable = item.portable;
        const reopened = portable.reopenVerification;
        if (!item.managed || portable.version !== 1 || !isAbsolute(portable.destinationPath)
          || typeof portable.filename !== "string" || !portable.filename.endsWith(".glb")
          || !sha.test(portable.sha256) || portable.sha256 !== item.managed.sha256
          || portable.byteSize !== item.managed.byteSize || !Number.isFinite(Date.parse(portable.exportedAt))
          || !BATCH_ID.test(portable.recordId) || !sha.test(portable.recordSha256)
          || !reopened || reopened.version !== 1 || reopened.kind !== "portable" || reopened.id !== portable.recordId
          || reopened.sourceJobId !== item.managed.sourceJobId || reopened.path !== portable.destinationPath
          || reopened.sha256 !== portable.sha256 || reopened.byteSize !== portable.byteSize
          || !reopened.retainedGeometry || !reopened.retainedTextures || !reopened.retainedAnimations
          || !Number.isFinite(Date.parse(reopened.verifiedAt))) {
          throw new Error(`Retained strict final-run portable evidence for ${item.itemId} is invalid.`);
        }
      }
    }
    if (new Set(allReservedSeeds).size !== allReservedSeeds.length
      || new Set(acceptance.items.map((item) => item.baseline.managedAssetId)).size !== PROMPT3D_STRICT_BATCH_ITEM_COUNT
      || new Set(acceptance.items.map((item) => item.baseline.sourceJobId)).size !== PROMPT3D_STRICT_BATCH_ITEM_COUNT
      || new Set(acceptance.items.map((item) => item.baseline.finalSha256)).size !== PROMPT3D_STRICT_BATCH_ITEM_COUNT) {
      throw new Error("Retained strict final-run baseline or seed reservations are not distinct.");
    }
    const sealFields = [acceptance.receiptPath, acceptance.receiptSha256, acceptance.sealedAt];
    const sealCount = sealFields.filter((field) => field !== undefined).length;
    if (sealCount !== 0 && sealCount !== sealFields.length) throw new Error("Retained strict final-run receipt seal is incomplete.");
    if (sealCount === sealFields.length) {
      const expectedPath = containedWorkflowPath(this.root, join(batchDirectory, "strict-acceptance-receipt.json"));
      const receiptPath = containedWorkflowPath(this.root, acceptance.receiptPath!);
      if (receiptPath !== expectedPath || !sha.test(acceptance.receiptSha256!) || !Number.isFinite(Date.parse(acceptance.sealedAt!))) {
        throw new Error("Retained strict final-run receipt seal is invalid.");
      }
      const info = lstatSync(receiptPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 4 * 1024 ** 2) {
        throw new Error("Retained strict final-run receipt file is unsafe.");
      }
      const receiptBytes = readFileSync(receiptPath);
      if (sha256Hex(receiptBytes) !== acceptance.receiptSha256) throw new Error("Retained strict final-run receipt failed SHA-256 verification.");
      const retainedReceipt = JSON.parse(receiptBytes.toString("utf8"));
      const expectedReceipt = createPrompt3DBatchAcceptanceReceipt(batchId, acceptance, acceptance.sealedAt!);
      if (stableJson(retainedReceipt) !== stableJson(expectedReceipt)) throw new Error("Retained strict final-run receipt does not match its sealed evidence.");
    }
    return acceptance;
  }

  private restoreBatchFromDisk(token: string, requestedId?: string): Prompt3DBatchStatus | null {
    const existing = requestedId
      ? this.batches.get(requestedId)
      : [...this.batches.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (existing) {
      this.batchTokens.set(existing.id, token);
      return existing;
    }
    if (requestedId && !BATCH_ID.test(requestedId)) throw new Error("Invalid Prompt-to-3D batch ID.");
    const root = containedWorkflowPath(this.root, join(this.root, "workflow-batches"));
    if (!existsSync(root)) {
      if (requestedId) throw new Error("Prompt-to-3D batch not found.");
      return null;
    }
    const candidates = requestedId
      ? [requestedId]
      : readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && BATCH_ID.test(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => {
          try { return statSync(join(root, b, "manifest.json")).mtimeMs - statSync(join(root, a, "manifest.json")).mtimeMs; }
          catch { return 0; }
        });
    let retainedError: unknown;
    for (const id of candidates) {
      try {
        const directory = containedWorkflowPath(this.root, join(root, id));
        const manifestPath = containedWorkflowPath(this.root, join(directory, "manifest.json"));
        const manifestInfo = lstatSync(manifestPath);
        if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size < 1 || manifestInfo.size > 8 * 1024 ** 2) throw new Error("Retained batch manifest is unsafe.");
        const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, any>;
        let requestValue = raw.request;
        if (!requestValue) {
          const requestPath = containedWorkflowPath(this.root, join(directory, "request.json"));
          const requestInfo = lstatSync(requestPath);
          if (!requestInfo.isFile() || requestInfo.isSymbolicLink() || requestInfo.size < 1 || requestInfo.size > 4 * 1024 ** 2) throw new Error("Retained batch request is unsafe.");
          requestValue = JSON.parse(readFileSync(requestPath, "utf8"));
        }
        const request = this.normalizeBatchRequest(requestValue as Prompt3DBatchRequest);
        if (raw.version !== 1 || raw.id !== id || raw.name !== request.name
          || !["running", "awaiting-approval", "complete", "failed", "cancelled"].includes(raw.state)
          || !Number.isFinite(Date.parse(raw.createdAt)) || !Number.isFinite(Date.parse(raw.updatedAt))
          || typeof raw.message !== "string" || !Array.isArray(raw.items) || raw.items.length !== request.items.length) {
          throw new Error("Retained batch status is invalid.");
        }
        const acceptance = this.restoreStrictBatchAcceptance(raw.acceptance, request, id, directory);
        const items = request.items.map<Prompt3DBatchItemStatus>((item) => {
          const value = raw.items.find((candidate: any) => candidate?.id === item.id);
          if (!value || value.name !== item.name
            || !["queued", "concept", "awaiting-approval", "geometry", "texture", "animation", "complete", "failed", "cancelled"].includes(value.state)
            || !Number.isFinite(value.progress) || value.progress < 0 || value.progress > 100 || typeof value.message !== "string") {
            throw new Error(`Retained status for batch item ${item.id} is invalid.`);
          }
          return { ...value } as Prompt3DBatchItemStatus;
        });
        if (acceptance) {
          for (const item of items) {
            const evidence = acceptance.items.find((candidate) => candidate.itemId === item.id)!;
            if ((item.state === "complete") !== Boolean(evidence.managed)
              || Boolean(item.savedAsset) !== Boolean(evidence.managed)
              || (item.savedAsset !== undefined && stableJson(item.savedAsset) !== stableJson(evidence.managed))
              || Boolean(item.portableExport) !== Boolean(evidence.portable)
              || (item.portableExport !== undefined && stableJson(item.portableExport) !== stableJson(evidence.portable))
              || (evidence.portable !== undefined && item.state !== "complete")) {
              throw new Error(`Retained strict final-run item output evidence for ${item.id} is inconsistent.`);
            }
          }
        }
        const runtimeValues = raw.runtime && typeof raw.runtime === "object" ? raw.runtime as Record<string, any> : {};
        const runtime = Object.fromEntries(request.items.map((item) => {
          const retained = runtimeValues[item.id];
          const status = items.find((candidate) => candidate.id === item.id)!;
          if (!retained) {
            const currentKind = status.currentJobId
              ? status.state === "texture" || (status.state === "awaiting-approval" && status.progress >= 50 && status.progress < 75)
                ? "texture"
                : status.state === "animation" || (status.state === "awaiting-approval" && status.progress >= 75)
                  ? "animation"
                  : status.progress < 25 ? "base" : "shape"
              : undefined;
            return [item.id, {
              baseComplete: currentKind === "shape" || currentKind === "texture" || currentKind === "animation" || status.state === "complete",
              shapeComplete: currentKind === "texture" || currentKind === "animation" || status.state === "complete",
              nextTexture: status.state === "complete" ? item.texturePrompts.length : 0,
              nextAnimation: status.state === "complete" ? item.animationRevisions.length : 0,
              ...(currentKind ? { currentKind, currentJobId: status.currentJobId } : {}),
              ...(status.finalSource ? { currentSource: status.finalSource } : {}),
            } satisfies Prompt3DBatchRuntimeItem];
          }
          if (typeof retained.baseComplete !== "boolean" || typeof retained.shapeComplete !== "boolean"
            || !Number.isInteger(retained.nextTexture) || retained.nextTexture < 0 || retained.nextTexture > item.texturePrompts.length
            || !Number.isInteger(retained.nextAnimation) || retained.nextAnimation < 0 || retained.nextAnimation > item.animationRevisions.length
            || (retained.currentKind !== undefined && !["base", "shape", "texture", "animation"].includes(retained.currentKind))
            || (retained.currentJobId !== undefined && (typeof retained.currentJobId !== "string" || retained.currentJobId.length > 120))
            || (retained.currentKind === undefined) !== (retained.currentJobId === undefined)) {
            throw new Error(`Retained runtime for batch item ${item.id} is invalid.`);
          }
          if (retained.currentSource && (typeof retained.currentSource.jobId !== "string"
            || !["generation", "finish"].includes(retained.currentSource.kind)
            || (retained.currentSource.kind === "generation" && retained.currentSource.variantIndex !== undefined && !Number.isInteger(retained.currentSource.variantIndex)))) {
            throw new Error(`Retained source for batch item ${item.id} is invalid.`);
          }
          const retryFinish = retained.retryFinish;
          if (retryFinish && (!retryFinish.request || !["texture", "animation"].includes(retryFinish.operation)
            || retryFinish.request.operation !== retryFinish.operation
            || !Number.isInteger(retryFinish.revisionIndex) || retryFinish.revisionIndex < 0
            || (retryFinish.operation === "texture" && retryFinish.revisionIndex >= item.texturePrompts.length)
            || (retryFinish.operation === "animation" && retryFinish.revisionIndex >= item.animationRevisions.length)
            || typeof retryFinish.request.instruction !== "string" || !retryFinish.request.instruction.trim() || retryFinish.request.instruction.length > MAX_PROMPT
            || typeof retryFinish.request.source?.jobId !== "string" || !["generation", "finish"].includes(retryFinish.request.source?.kind)
            || !Number.isSafeInteger(retryFinish.request.seed) || retryFinish.request.seed < 0 || retryFinish.request.seed > 0x7fffffff)) {
            throw new Error(`Retained corrective finishing request for batch item ${item.id} is invalid.`);
          }
          return [item.id, {
            baseComplete: retained.baseComplete,
            shapeComplete: retained.shapeComplete,
            nextTexture: retained.nextTexture,
            nextAnimation: retained.nextAnimation,
            ...(retained.currentKind ? { currentKind: retained.currentKind, currentJobId: retained.currentJobId } : {}),
            ...(retained.currentSource ? { currentSource: { ...retained.currentSource } } : {}),
            ...(retryFinish ? { retryFinish: structuredClone(retryFinish) } : {}),
          } satisfies Prompt3DBatchRuntimeItem];
        }));
        const batch: Prompt3DBatchStatus = {
          version: 1,
          id,
          name: request.name,
          state: raw.state,
          request,
          runtime,
          items,
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
          manifestPath,
          ...(typeof raw.localAssetsRoot === "string" ? { localAssetsRoot: containedWorkflowPath(this.root, raw.localAssetsRoot) } : {}),
          ...(acceptance ? { acceptance } : {}),
          message: raw.message,
        };
        // Strict continuity spans admission through all six reopened portable
        // copies and the sealed receipt, not only geometry/finishing completion.
        const interruptedStrictRun = Boolean(acceptance && !acceptance.receiptPath);
        if (interruptedStrictRun && batch.acceptance) {
          batch.acceptance.eligible = false;
          batch.acceptance.restoreCount += 1;
        }
        if (batch.state === "running") {
          const interrupted = batch.items.find((item) => item.state !== "complete");
          if (interrupted) {
            interrupted.state = "failed";
            interrupted.message = "The app closed before this batch step finished. Retained approved outputs are preserved; retry this item to continue deterministically.";
            batch.state = "failed";
            batch.message = `${interrupted.name}: ${interrupted.message}`;
          } else {
            batch.state = "complete";
            batch.message = `${batch.items.length} fresh Hunyuan workflow assets completed in one serial batch.`;
          }
        }
        const runtimeMap = new Map(Object.entries(runtime));
        this.batches.set(id, batch);
        this.batchRequests.set(id, request);
        this.batchRuntime.set(id, runtimeMap);
        this.batchTokens.set(id, token);
        for (const value of runtimeMap.values()) if (value.currentJobId) this.batchJobLinks.set(value.currentJobId, id);
        if (interruptedStrictRun) void this.publishBatch(batch).catch(() => undefined);
        if (batch.state === "awaiting-approval") {
          void Promise.all([this.loadHistory(), this.loadFinishHistory()])
            .then(() => { if (batch.state === "awaiting-approval") this.queueBatchAdvance(id); })
            .catch(() => undefined);
        }
        return batch;
      } catch (error) {
        retainedError = error;
        if (requestedId) break;
      }
    }
    if (requestedId) {
      const detail = retainedError instanceof Error ? ` ${retainedError.message}` : "";
      throw new Error(`Prompt-to-3D batch could not be restored.${detail}`);
    }
    return null;
  }

  async batchStart(token: string, input: Prompt3DBatchRequest): Promise<Prompt3DBatchStatus> {
    this.requireGrant(token);
    this.batchStatus(token);
    if (this.batchStarting) throw new Error("A serial Prompt-to-3D batch is already passing preflight checks.");
    if (this.starting) throw new Error("Wait for the current Prompt-to-3D preflight action before starting a batch.");
    if (this.activeBatch()) throw new Error("Only one uninterrupted Prompt-to-3D batch may run at a time.");
    this.batchStarting = true;
    try {
      return await this.batchStartChecked(token, input);
    } finally {
      this.batchStarting = false;
    }
  }

  private async batchStartChecked(token: string, input: Prompt3DBatchRequest): Promise<Prompt3DBatchStatus> {
    await Promise.all([this.loadHistory(), this.loadFinishHistory()]);
    if (this.starting) throw new Error("Wait for the current Prompt-to-3D preflight action before starting a batch.");
    if ([...this.batches.values()].some((batch) => batch.state === "running" || batch.state === "awaiting-approval")) {
      throw new Error("Only one uninterrupted Prompt-to-3D batch may run at a time.");
    }
    if ([...this.jobs.values()].some((job) => job.state === "running" || job.state === "queued" || job.state === "awaiting-concept-approval")
      || [...this.finishJobs.values()].some((job) => job.state === "running" || job.state === "queued")) {
      throw new Error("Finish or resolve the current Prompt-to-3D action or concept approval before starting a batch.");
    }
    const prepared = await this.prepareStrictBatchAcceptance(this.normalizeBatchRequest(input));
    const request = prepared.request;
    const { name, items } = request;
    const id = randomUUID();
    const directory = containedWorkflowPath(this.root, join(this.root, "workflow-batches", id));
    await mkdir(directory, { recursive: true });
    const now = new Date().toISOString();
    const batch: Prompt3DBatchStatus = {
      version: 1,
      id,
      name,
      state: "running",
      request,
      runtime: {},
      items: items.map<Prompt3DBatchItemStatus>((item) => ({
        id: item.id,
        name: item.name,
        state: "queued",
        progress: 0,
        message: "Queued for a fresh Hunyuan concept and geometry run.",
      })),
      createdAt: now,
      updatedAt: now,
      manifestPath: containedWorkflowPath(this.root, join(directory, "manifest.json")),
      ...(prepared.acceptance ? { acceptance: prepared.acceptance } : {}),
      message: prepared.acceptance
        ? `Strict final run admitted with ${items.length} verified individual baselines and fresh service-reserved seeds.`
        : `Uninterrupted serial batch accepted with ${items.length} prompted assets.`,
    };
    await this.writeJsonAtomic(join(directory, "request.json"), request);
    this.batches.set(id, batch);
    this.batchRequests.set(id, request);
    this.batchTokens.set(id, token);
    this.batchRuntime.set(id, new Map(items.map((item) => [item.id, {
      baseComplete: false,
      shapeComplete: false,
      nextTexture: 0,
      nextAnimation: 0,
    }])));
    await this.publishBatch(batch);
    this.queueBatchAdvance(id);
    return batch;
  }

  batchStatus(token: string, id?: string): Prompt3DBatchStatus | null {
    this.requireGrant(token);
    return this.restoreBatchFromDisk(token, id);
  }

  async batchCancel(token: string, id: string): Promise<Prompt3DBatchStatus> {
    this.requireGrant(token);
    const batch = this.batchStatus(token, id);
    if (!batch) throw new Error("Prompt-to-3D batch not found.");
    if (batch.state === "complete") throw new Error("A completed batch cannot be cancelled.");
    if (batch.state === "cancelled") return batch;
    const active = batch.items.find((item) => item.state !== "complete");
    batch.state = "cancelled";
    batch.message = active
      ? `${active.name}: Batch cancelled. Completed approved items and retained partial output were preserved.`
      : "Batch cancelled. Completed approved items were preserved.";
    if (active) {
      active.state = "cancelled";
      active.message = "Batch cancelled. Retained output was not deleted and will not advance unless this run is explicitly retried.";
    }
    this.batchesAdvancePending.delete(id);
    await this.publishBatch(batch);
    await Promise.all([this.loadHistory(), this.loadFinishHistory()]);
    const runtime = active ? this.batchRuntime.get(id)?.get(active.id) : undefined;
    if (runtime?.currentJobId) {
      const generation = this.jobs.get(runtime.currentJobId);
      const finish = this.finishJobs.get(runtime.currentJobId);
      if (generation && (generation.state === "queued" || generation.state === "running")) {
        await this.cancel(token, generation.id, true);
      } else if (finish && (finish.state === "queued" || finish.state === "running")) {
        await this.finishCancel(token, finish.id, true);
      }
    }
    return batch;
  }

  async batchRetry(token: string, id: string, itemId?: string): Promise<Prompt3DBatchStatus> {
    this.requireGrant(token);
    const batch = this.batchStatus(token, id);
    if (!batch) throw new Error("Prompt-to-3D batch not found.");
    if (batch.state !== "failed" && batch.state !== "cancelled") throw new Error("Only a failed or cancelled batch can be retried.");
    if (this.batchesAdvancing.has(id)) throw new Error("Wait for the previous batch action to settle before retrying.");
    const conflicting = this.activeBatch();
    if (conflicting && conflicting.id !== id) throw new Error("Another serial Prompt-to-3D batch is active.");
    await Promise.all([this.loadHistory(), this.loadFinishHistory()]);
    if ([...this.jobs.values()].some((job) => job.state === "queued" || job.state === "running")
      || [...this.finishJobs.values()].some((job) => job.state === "queued" || job.state === "running")) {
      throw new Error("Finish or cancel the current Prompt-to-3D provider action before retrying this batch.");
    }
    const active = batch.items.find((item) => item.state !== "complete");
    if (!active) throw new Error("This batch has no incomplete item to retry.");
    if (itemId && itemId !== active.id) throw new Error("Retry must target the current incomplete batch item.");
    const runtime = this.batchRuntime.get(id)?.get(active.id);
    if (!runtime) throw new Error("Retained batch runtime is unavailable.");
    if (runtime.currentJobId) {
      const generation = this.jobs.get(runtime.currentJobId);
      const finish = this.finishJobs.get(runtime.currentJobId);
      if (finish && !runtime.currentSource) runtime.currentSource = finish.source;
      const unavailable = !generation && !finish;
      const terminalFailure = generation?.state === "failed" || generation?.state === "cancelled"
        || finish?.state === "failed" || finish?.state === "cancelled";
      if (unavailable || terminalFailure) {
        this.batchJobLinks.delete(runtime.currentJobId);
        runtime.currentJobId = undefined;
        runtime.currentKind = undefined;
      }
    }
    this.batchTokens.set(id, token);
    if (batch.acceptance) {
      batch.acceptance.eligible = false;
      batch.acceptance.retryCount += 1;
    }
    active.state = "queued";
    active.currentJobId = runtime.currentJobId;
    active.message = runtime.currentJobId
      ? "Retrying from the exact retained batch revision and its approval state."
      : "Retrying the failed batch step with its retained request, cursor and deterministic seed.";
    batch.state = "running";
    batch.message = `${active.name}: ${active.message}`;
    await this.publishBatch(batch);
    this.queueBatchAdvance(id);
    return batch;
  }

  private async updateBatchItem(
    batch: Prompt3DBatchStatus,
    item: Prompt3DBatchItemStatus,
    values: Partial<Prompt3DBatchItemStatus>,
    batchState: Prompt3DBatchStatus["state"] = "running",
  ): Promise<void> {
    if (batch.state === "cancelled" && batchState !== "cancelled") return;
    const changed = Object.entries(values).some(([key, value]) => (item as any)[key] !== value) || batch.state !== batchState;
    if (!changed) return;
    Object.assign(item, values);
    batch.state = batchState;
    batch.message = batchState === "awaiting-approval"
      ? `${item.name}: ${item.message}`
      : `${item.name}: ${item.message}`;
    await this.publishBatch(batch);
  }

  private strictBatchGenerationEvidence(
    batch: Prompt3DBatchStatus,
    itemId: string,
    phase: "base" | "refined",
    job: Prompt3DJobStatus,
    variant: Prompt3DJobStatus["variants"][number],
  ): Prompt3DBatchAcceptanceGenerationEvidence | undefined {
    if (!batch.acceptance) return undefined;
    if (this.batchJobLinks.get(job.id) !== batch.id || !job.conceptApproval) {
      throw new Error(`Strict final-run ${phase} generation is not bound to this uninterrupted batch and approved concept.`);
    }
    const evidence: Prompt3DBatchAcceptanceGenerationEvidence = {
      jobId: job.id,
      seed: job.spec.seed,
      conceptSha256: job.conceptApproval.conceptSha256,
      outputSha256: variant.sha256,
      geometryHash: variant.geometryHash,
    };
    assertFreshPrompt3DBatchGeneration(batch.acceptance, itemId, phase, evidence);
    return evidence;
  }

  private nextStrictBatchFinishSeed(
    batch: Prompt3DBatchStatus,
    itemId: string,
    operation: "texture" | "animation",
  ): number {
    const item = batch.acceptance?.items.find((candidate) => candidate.itemId === itemId);
    if (!item) throw new Error("Strict final-run finishing dispatch does not match a retained batch item.");
    const offset = operation === "texture" ? 100 : 200;
    const minimum = item.assignedSeed + offset;
    const maximum = minimum + 63;
    const used = new Set([...this.finishJobs.values()].map((job) => job.seed));
    const seed = item.reservedSeeds.find((candidate) => candidate >= minimum && candidate <= maximum && !used.has(candidate));
    if (seed === undefined) throw new Error(`Strict final-run ${operation} seed reservation is exhausted.`);
    return seed;
  }

  private assertStrictBatchManagedOutputs(batch: Prompt3DBatchStatus): void {
    const acceptance = batch.acceptance;
    if (!acceptance) return;
    if (batch.items.length !== PROMPT3D_STRICT_BATCH_ITEM_COUNT
      || acceptance.items.length !== PROMPT3D_STRICT_BATCH_ITEM_COUNT) {
      throw new Error(`Strict final-run completion requires exactly ${PROMPT3D_STRICT_BATCH_ITEM_COUNT} managed outputs.`);
    }
    const sourceJobs: string[] = [];
    const rootJobs: string[] = [];
    const paths: string[] = [];
    const hashes: string[] = [];
    for (const status of batch.items) {
      const evidence = acceptance.items.find((candidate) => candidate.itemId === status.id);
      if (!evidence?.base || !evidence.refined || !evidence.managed || !status.savedAsset
        || status.finalSource?.kind !== "finish" || stableJson(status.savedAsset) !== stableJson(evidence.managed)) {
        throw new Error(`Strict final-run item ${status.id} lacks complete base, refinement and managed-output evidence.`);
      }
      const finalJob = this.finishJobs.get(status.finalSource.jobId);
      if (!finalJob || finalJob.batchId !== batch.id || finalJob.batchItemId !== status.id
        || evidence.managed.sourceJobId !== finalJob.id || evidence.managed.rootGenerationJobId !== evidence.base.jobId) {
        throw new Error(`Strict final-run managed output ${status.id} is not uniquely bound to this batch item.`);
      }
      const firstGeneration = finalJob.lineage.generationChain[0];
      const refinedGeneration = finalJob.lineage.generationChain.at(-1);
      const matchesGeneration = (lineage: Prompt3DWorkflowRootLineage | undefined, retained: Prompt3DBatchAcceptanceGenerationEvidence) => Boolean(lineage
        && lineage.jobId === retained.jobId
        && lineage.conceptSha256 === retained.conceptSha256
        && lineage.outputSha256 === retained.outputSha256
        && lineage.geometryHash === retained.geometryHash);
      if (!matchesGeneration(firstGeneration, evidence.base) || !matchesGeneration(refinedGeneration, evidence.refined)) {
        throw new Error(`Strict final-run managed output ${status.id} does not field-match its recorded base and refined Hunyuan generations.`);
      }
      const requested = batch.request.items.find((candidate) => candidate.id === status.id)!;
      const expectedFinishCount = requested.texturePrompts.length + requested.animationRevisions.length;
      if (evidence.finishing.length !== expectedFinishCount || finalJob.lineage.revisions.length !== expectedFinishCount) {
        throw new Error(`Strict final-run managed output ${status.id} lacks its complete ordered finishing ledger.`);
      }
      evidence.finishing.forEach((finishEvidence, index) => {
        const expectedOperation = index < requested.texturePrompts.length ? "texture" : "animation";
        const expectedRevisionIndex = expectedOperation === "texture" ? index : index - requested.texturePrompts.length;
        const lineage = finalJob.lineage.revisions[index];
        const finishJob = this.finishJobs.get(finishEvidence.jobId);
        if (finishEvidence.operation !== expectedOperation || finishEvidence.revisionIndex !== expectedRevisionIndex
          || !evidence.reservedSeeds.includes(finishEvidence.seed)
          || !finishJob || finishJob.seed !== finishEvidence.seed || finishJob.batchId !== batch.id || finishJob.batchItemId !== status.id
          || lineage?.jobId !== finishEvidence.jobId || lineage.operation !== finishEvidence.operation
          || lineage.promptSha256 !== finishEvidence.promptSha256 || lineage.outputSha256 !== finishEvidence.outputSha256) {
          throw new Error(`Strict final-run managed output ${status.id} has invalid finishing evidence at serial revision ${index + 1}.`);
        }
      });
      if (evidence.finishing.at(-1)?.outputSha256 !== evidence.managed.sha256) {
        throw new Error(`Strict final-run managed output ${status.id} does not end at its recorded final animation revision.`);
      }
      assertFreshPrompt3DBatchGeneration(acceptance, status.id, "base", evidence.base);
      assertFreshPrompt3DBatchGeneration(acceptance, status.id, "refined", evidence.refined);
      assertFreshPrompt3DBatchFinal(acceptance, status.id, evidence.managed.sha256);
      sourceJobs.push(evidence.managed.sourceJobId);
      rootJobs.push(evidence.managed.rootGenerationJobId);
      paths.push(evidence.managed.savedPath);
      hashes.push(evidence.managed.sha256);
    }
    if (new Set(sourceJobs).size !== PROMPT3D_STRICT_BATCH_ITEM_COUNT
      || new Set(rootJobs).size !== PROMPT3D_STRICT_BATCH_ITEM_COUNT
      || new Set(paths).size !== PROMPT3D_STRICT_BATCH_ITEM_COUNT
      || new Set(hashes).size !== PROMPT3D_STRICT_BATCH_ITEM_COUNT) {
      throw new Error("Strict final-run completion requires six unique batch-bound managed outputs.");
    }
  }

  private async advanceBatch(batchId: string): Promise<void> {
    if (this.batchesAdvancing.has(batchId)) return;
    this.batchesAdvancePending.delete(batchId);
    const batch = this.batches.get(batchId);
    const request = this.batchRequests.get(batchId);
    const runtimes = this.batchRuntime.get(batchId);
    const token = this.batchTokens.get(batchId);
    if (!batch || !request || !runtimes || !token || (batch.state !== "running" && batch.state !== "awaiting-approval")) return;
    this.batchesAdvancing.add(batchId);
    try {
      for (;;) {
        if (batch.state !== "running" && batch.state !== "awaiting-approval") return;
        const itemStatus = batch.items.find((item) => item.state !== "complete");
        if (!itemStatus) {
          this.assertStrictBatchManagedOutputs(batch);
          batch.state = "complete";
          batch.message = batch.acceptance
            ? batch.acceptance.eligible
              ? `${batch.items.length} fresh Hunyuan workflow assets completed in one uninterrupted strict final run; bulk export can now seal the receipt.`
              : `${batch.items.length} Hunyuan workflow assets completed, but restore/retry evidence makes this batch ineligible for strict final-run acceptance.`
            : `${batch.items.length} fresh Hunyuan workflow assets completed in one serial batch.`;
          await this.publishBatch(batch);
          return;
        }
        const item = request.items.find((candidate) => candidate.id === itemStatus.id)!;
        const runtime = runtimes.get(item.id)!;
        if (runtime.currentJobId && runtime.currentKind) {
          if (runtime.currentKind === "base" || runtime.currentKind === "shape") {
            const job = this.jobs.get(runtime.currentJobId);
            if (!job) throw new Error(`Retained ${runtime.currentKind} Hunyuan job is unavailable.`);
            if (job.state === "awaiting-concept-approval") {
              await this.updateBatchItem(batch, itemStatus, {
                state: "awaiting-approval",
                progress: runtime.currentKind === "base" ? 12 : 37,
                currentJobId: job.id,
                message: `${runtime.currentKind === "base" ? "Base" : "Refined"} concept retained; explicit hash-bound visual approval is required.`,
              }, "awaiting-approval");
              return;
            }
            if (job.state === "failed" && (job.error?.code === "CONCEPT_QUALITY_REJECTED" || job.error?.code === "CONCEPT_SEMANTIC_REJECTED")) {
              await this.updateBatchItem(batch, itemStatus, {
                state: "awaiting-approval",
                progress: runtime.currentKind === "base" ? 12 : 37,
                currentJobId: job.id,
                message: job.error.code === "CONCEPT_SEMANTIC_REJECTED"
                  ? `${runtime.currentKind === "base" ? "Base" : "Refined"} concept was explicitly rejected; edit the brief or regenerate with a fresh seed in this same batch.`
                  : `${runtime.currentKind === "base" ? "Base" : "Refined"} concept failed framing checks; inspect it and use Regenerate concept to retain a fresh seeded attempt in this same batch.`,
              }, "awaiting-approval");
              return;
            }
            if (job.state === "failed" || job.state === "cancelled") throw new Error(job.error?.message ?? `${runtime.currentKind} Hunyuan generation did not complete.`);
            if (job.state !== "complete") {
              const base = runtime.currentKind === "base" ? 0 : 25;
              await this.updateBatchItem(batch, itemStatus, {
                state: job.stage === "geometry" || job.progress > 35 ? "geometry" : "concept",
                progress: Math.min(base + 24, base + Math.round(job.progress * 0.24)),
                currentJobId: job.id,
                message: job.message,
              });
              return;
            }
            const variant = job.variants.find((candidate) => candidate.index === 0);
            const phase = runtime.currentKind === "base" ? "base" : "refined";
            let strictEvidence: Prompt3DBatchAcceptanceGenerationEvidence | undefined;
            if (batch.acceptance) {
              if (!variant) throw new Error(`Strict final-run ${phase} generation has no retained Hunyuan variant.`);
              try {
                strictEvidence = this.strictBatchGenerationEvidence(batch, item.id, phase, job, variant);
              } catch (error) {
                if (!variant.visualApproval) {
                  const message = error instanceof Error ? error.message : String(error);
                  await this.updateBatchItem(batch, itemStatus, {
                    state: "awaiting-approval",
                    progress: phase === "base" ? 24 : 49,
                    currentJobId: job.id,
                    message: `${message} Reject this geometry and generate a corrected fresh revision; do not approve it.`,
                  }, "awaiting-approval");
                  return;
                }
                throw error;
              }
            }
            if (!variant?.visualApproval) {
              await this.updateBatchItem(batch, itemStatus, {
                state: "awaiting-approval",
                progress: runtime.currentKind === "base" ? 24 : 49,
                currentJobId: job.id,
                message: `${runtime.currentKind === "base" ? "Base" : "Refined"} Hunyuan geometry passed technical checks; inspect and approve this exact 3D revision before continuing.`,
              }, "awaiting-approval");
              return;
            }
            await this.resolveWorkflowSource({ kind: "generation", jobId: job.id, variantIndex: 0 });
            if (strictEvidence && batch.acceptance) {
              const retained = batch.acceptance.items.find((candidate) => candidate.itemId === item.id)!;
              const existing = phase === "base" ? retained.base : retained.refined;
              if (existing && stableJson(existing) !== stableJson(strictEvidence)) {
                throw new Error(`Strict final-run ${phase} evidence conflicts with the retained batch manifest.`);
              }
              if (phase === "base") retained.base = strictEvidence;
              else retained.refined = strictEvidence;
            }
            runtime.currentSource = { kind: "generation", jobId: job.id, variantIndex: 0 };
            if (runtime.currentKind === "base") runtime.baseComplete = true;
            else runtime.shapeComplete = true;
            this.batchJobLinks.delete(job.id);
            runtime.currentJobId = undefined;
            runtime.currentKind = undefined;
            continue;
          }

          const finish = this.finishJobs.get(runtime.currentJobId);
          if (!finish) throw new Error(`Retained ${runtime.currentKind} workflow job is unavailable.`);
          if (finish.state === "failed" || finish.state === "cancelled") throw new Error(finish.error?.message ?? `${runtime.currentKind} revision did not complete.`);
          if (finish.state !== "complete") {
            const isTexture = runtime.currentKind === "texture";
            const base = isTexture ? 50 : 75;
            const span = isTexture ? 25 / item.texturePrompts.length : 23 / item.animationRevisions.length;
            const index = isTexture ? runtime.nextTexture : runtime.nextAnimation;
            await this.updateBatchItem(batch, itemStatus, {
              state: isTexture ? "texture" : "animation",
              progress: Math.min(98, Math.round(base + span * index + span * finish.progress / 100)),
              currentJobId: finish.id,
              message: finish.message,
            });
            return;
          }
          if (!finish.visualApproval) {
            await this.updateBatchItem(batch, itemStatus, {
              state: "awaiting-approval",
              progress: runtime.currentKind === "texture"
                ? Math.min(74, 50 + Math.round(24 * (runtime.nextTexture + 1) / item.texturePrompts.length))
                : Math.min(98, 75 + Math.round(22 * (runtime.nextAnimation + 1) / item.animationRevisions.length)),
              currentJobId: finish.id,
              message: `${runtime.currentKind === "texture" ? "Hunyuan Paint texture" : "Prompted animation"} revision passed technical checks; inspect and approve this exact result before continuing.`,
            }, "awaiting-approval");
            return;
          }
          await this.verifyFinishLineage(finish, false);
          if (batch.acceptance) {
            const retained = batch.acceptance.items.find((candidate) => candidate.itemId === item.id)!;
            const operation = runtime.currentKind;
            const revisionIndex = operation === "texture" ? runtime.nextTexture : runtime.nextAnimation;
            const expectedPosition = operation === "texture" ? revisionIndex : item.texturePrompts.length + revisionIndex;
            if (finish.batchId !== batch.id || finish.batchItemId !== item.id || finish.operation !== operation
              || !finish.sha256 || !retained.reservedSeeds.includes(finish.seed)) {
              throw new Error(`Strict final-run ${operation} revision is not bound to this batch item and its service-reserved seed.`);
            }
            const evidence: Prompt3DBatchAcceptanceFinishEvidence = {
              jobId: finish.id,
              operation,
              revisionIndex,
              seed: finish.seed,
              promptSha256: workflowPromptSha256(finish.instruction),
              outputSha256: finish.sha256,
            };
            const existing = retained.finishing[expectedPosition];
            if (existing && stableJson(existing) !== stableJson(evidence)) {
              throw new Error(`Strict final-run ${operation} evidence conflicts with its ordered revision ledger.`);
            }
            if (retained.finishing.length !== expectedPosition && !existing) {
              throw new Error(`Strict final-run ${operation} evidence is out of serial order.`);
            }
            const otherFinish = batch.acceptance.items.flatMap((candidate) => candidate.finishing)
              .filter((candidate) => candidate.jobId !== evidence.jobId);
            if (otherFinish.some((candidate) => candidate.seed === evidence.seed || candidate.outputSha256 === evidence.outputSha256)) {
              throw new Error(`Strict final-run ${operation} revision reuses an earlier batch seed or output.`);
            }
            retained.finishing[expectedPosition] = evidence;
          }
          runtime.currentSource = { kind: "finish", jobId: finish.id };
          if (runtime.currentKind === "texture") runtime.nextTexture += 1;
          else runtime.nextAnimation += 1;
          delete runtime.retryFinish;
          this.batchJobLinks.delete(finish.id);
          runtime.currentJobId = undefined;
          runtime.currentKind = undefined;
          continue;
        }

        if (!runtime.baseComplete) {
          const job = await this.start(token, {
            spec: item.spec,
            conceptOnly: true,
            consent: { providerId: "hunyuan3d-2", confirmed: true, externalData: [], estimatedCostUsd: 0 },
          }, batch.id);
          if ((batch as Prompt3DBatchStatus).state === "cancelled") {
            await this.cancel(token, job.id, true);
            return;
          }
          runtime.currentKind = "base";
          runtime.currentJobId = job.id;
          this.batchJobLinks.set(job.id, batch.id);
          await this.updateBatchItem(batch, itemStatus, { state: "concept", progress: 1, currentJobId: job.id, message: "Generating a fresh Hunyuan base concept." });
          return;
        }
        if (!runtime.shapeComplete) {
          if (!runtime.currentSource || runtime.currentSource.kind !== "generation") throw new Error("Shape refinement lost its exact Hunyuan parent.");
          const parent = this.jobs.get(runtime.currentSource.jobId);
          if (!parent) throw new Error("Shape refinement parent is unavailable.");
          const shapeSpec = assertSpec({
            ...sanitizeAssetSpec(parent.spec),
            prompt: `${parent.spec.prompt}. Refinement request: ${item.shapeRefinement}`,
            seed: Math.min(0x7fffffff, parent.spec.seed + 1),
            variants: 1,
            generateTextures: false,
          });
          const job = await this.start(token, {
            spec: shapeSpec,
            conceptOnly: true,
            parentConceptJobId: parent.id,
            conceptChangeReason: "edited",
            shapeRefinement: true,
            consent: { providerId: "hunyuan3d-2", confirmed: true, externalData: [], estimatedCostUsd: 0 },
          }, batch.id);
          if ((batch as Prompt3DBatchStatus).state === "cancelled") {
            await this.cancel(token, job.id, true);
            return;
          }
          runtime.currentKind = "shape";
          runtime.currentJobId = job.id;
          this.batchJobLinks.set(job.id, batch.id);
          await this.updateBatchItem(batch, itemStatus, { state: "concept", progress: 26, currentJobId: job.id, message: "Generating a fresh Hunyuan concept for the prompted shape refinement." });
          return;
        }
        if (!runtime.currentSource) throw new Error("Batch item has no retained Hunyuan source for finishing.");
        if (runtime.nextTexture < item.texturePrompts.length) {
          const retainedRetry = runtime.retryFinish?.operation === "texture" && runtime.retryFinish.revisionIndex === runtime.nextTexture
            ? runtime.retryFinish.request
            : undefined;
          const finish = await this.finishStart(token, {
            source: retainedRetry?.source ?? runtime.currentSource,
            operation: "texture",
            instruction: retainedRetry?.instruction ?? item.texturePrompts[runtime.nextTexture],
            seed: retainedRetry?.seed ?? Math.min(0x7fffffff, item.spec.seed + 100 + runtime.nextTexture),
            batchId: batch.id,
            batchItemId: item.id,
          }, batch.id);
          if ((batch as Prompt3DBatchStatus).state === "cancelled") {
            await this.finishCancel(token, finish.id, true);
            return;
          }
          runtime.currentKind = "texture";
          runtime.currentJobId = finish.id;
          this.batchJobLinks.set(finish.id, batch.id);
          await this.updateBatchItem(batch, itemStatus, { state: "texture", progress: 50, currentJobId: finish.id, message: `Applying prompted Hunyuan Paint revision ${runtime.nextTexture + 1}/${item.texturePrompts.length}.` });
          return;
        }
        if (runtime.nextAnimation < item.animationRevisions.length) {
          const revision = item.animationRevisions[runtime.nextAnimation];
          const retainedRetry = runtime.retryFinish?.operation === "animation" && runtime.retryFinish.revisionIndex === runtime.nextAnimation
            ? runtime.retryFinish.request
            : undefined;
          const finish = await this.finishStart(token, {
            source: retainedRetry?.source ?? runtime.currentSource,
            operation: "animation",
            instruction: retainedRetry?.instruction ?? revision.prompt,
            seed: retainedRetry?.seed ?? Math.min(0x7fffffff, item.spec.seed + 200 + runtime.nextAnimation),
            animation: retainedRetry?.animation ?? { ...item.animation, mode: revision.mode },
            batchId: batch.id,
            batchItemId: item.id,
          }, batch.id);
          if ((batch as Prompt3DBatchStatus).state === "cancelled") {
            await this.finishCancel(token, finish.id, true);
            return;
          }
          runtime.currentKind = "animation";
          runtime.currentJobId = finish.id;
          this.batchJobLinks.set(finish.id, batch.id);
          await this.updateBatchItem(batch, itemStatus, { state: "animation", progress: 75, currentJobId: finish.id, message: `Authoring prompted ${revision.mode} animation revision ${runtime.nextAnimation + 1}/${item.animationRevisions.length}.` });
          return;
        }
        if (runtime.currentSource.kind !== "finish") throw new Error("A complete batch item must finish with a validated texture and animation revision.");
        const finalJob = this.finishJobs.get(runtime.currentSource.jobId);
        if (!finalJob?.assetPath) throw new Error("Final batch workflow output is unavailable.");
        if (batch.acceptance && (finalJob.batchId !== batch.id || finalJob.batchItemId !== item.id || !finalJob.sha256)) {
          throw new Error("Strict final-run output is not bound to this exact batch item.");
        }
        if (batch.acceptance) assertFreshPrompt3DBatchFinal(batch.acceptance, item.id, finalJob.sha256!);
        const saved = await this.saveFinishedWorkflowAsset(finalJob);
        if (batch.acceptance) {
          const evidence = batch.acceptance.items.find((candidate) => candidate.itemId === item.id)!;
          if (!evidence.base || !evidence.refined || saved.asset.sourceJobId !== finalJob.id
            || saved.asset.rootGenerationJobId !== evidence.base.jobId) {
            throw new Error("Strict final-run managed output does not retain this item's complete batch-bound generation lineage.");
          }
          evidence.managed = structuredClone(saved.asset);
        }
        await this.options.onWorkflowLibraryRoot?.(saved.localAssetsRoot);
        Object.assign(itemStatus, {
          state: "complete",
          progress: 100,
          currentJobId: finalJob.id,
          finalSource: runtime.currentSource,
          finalAssetPath: finalJob.assetPath,
          savedAsset: saved.asset,
          message: "Fresh Hunyuan geometry, Hunyuan Paint texture and prompted animation completed and were saved locally.",
        });
        batch.localAssetsRoot = saved.localAssetsRoot;
        await this.publishBatch(batch);
      }
    } catch (error) {
      if ((batch as Prompt3DBatchStatus).state === "cancelled") return;
      const message = error instanceof Error ? error.message : String(error);
      const active = batch.items.find((item) => item.state !== "complete");
      if (active) {
        active.state = "failed";
        active.message = message;
      }
      batch.state = "failed";
      batch.message = message;
      await this.publishBatch(batch).catch(() => undefined);
    } finally {
      this.batchesAdvancing.delete(batchId);
      if (this.batchesAdvancePending.has(batchId)) setTimeout(() => void this.advanceBatch(batchId), 0);
    }
  }

  private failJob(job: Prompt3DJobStatus, error: unknown) {
    if (this.jobCancelled(job)) return;
    this.activeSidecarJobs.delete(job.id);
    const message = error instanceof Error ? error.message : String(error);
    const conceptRejected = message.startsWith("CONCEPT_REVIEW_REQUIRED:");
    const outputStorageFull = message.startsWith("OUTPUT_STORAGE_FULL:");
    job.state = "failed"; job.stage = conceptRejected ? "concept-review" : "failed";
    job.error = {
      code: conceptRejected ? "CONCEPT_QUALITY_REJECTED" : outputStorageFull ? "OUTPUT_STORAGE_FULL" : "PROVIDER_FAILED",
      message: conceptRejected ? `Concept-quality failure: ${message.replace(/^CONCEPT_REVIEW_REQUIRED:\s*/, "")} The concept was preserved; geometry was not loaded.` : message,
      retryable: true,
    };
    if (conceptRejected) {
      const now = new Date().toISOString();
      const timings = [...(job.timings ?? [])];
      let reviewIndex = -1;
      for (let index = timings.length - 1; index >= 0; index -= 1) {
        if (timings[index].stage === "concept-review") { reviewIndex = index; break; }
      }
      if (reviewIndex >= 0) {
        timings[reviewIndex] = { ...timings[reviewIndex], status: "failed", message: job.error.message };
      } else {
        timings.push({ stage: "concept-review", status: "failed", startedAt: now, completedAt: now, elapsedMs: 0, message: job.error.message });
      }
      job.timings = timings;
    }
    job.message = job.error.message; job.updatedAt = new Date().toISOString(); this.publishJob(job);
  }

  async approveConcept(token: string, request: Prompt3DApproveConceptRequest): Promise<Prompt3DJobStatus> {
    this.requireGrant(token);
    this.assertBatchDispatch(token, this.batchJobLinks.get(request.jobId));
    if (this.starting) throw new Error("Another generation action is already passing preflight checks.");
    this.starting = true;
    try {
      await Promise.all([this.loadHistory(), this.loadFinishHistory()]);
      const job = this.jobs.get(request.jobId);
      if (!job || job.state !== "awaiting-concept-approval" || !job.conceptAttempt || !supportsConceptWorkflow(job.spec)) throw new Error("This job is not awaiting concept approval.");
      if ([...this.jobs.values()].some((candidate) => candidate.id !== job.id && (candidate.state === "queued" || candidate.state === "running"))
        || [...this.finishJobs.values()].some((candidate) => candidate.state === "queued" || candidate.state === "running")) throw new Error(`Prompt-to-3D concurrency is bounded to ${MAX_JOBS}.`);
      await this.verifyRetainedReferenceImage(job);
      const conceptSha256 = await this.retainedConceptHash(job);
      if (this.jobCancelled(job)) return job;
      assertConceptAttemptBinding(job.id, job.spec, job.conceptAttempt, conceptSha256);
      if (stableJson(request.binding) !== stableJson(job.conceptAttempt.binding)) throw new Error("Concept approval is stale or does not match the exact retained attempt binding.");
      if (job.conceptAttempt.technicalReview.status !== "pass") throw new Error("A concept that failed technical preparation cannot be approved.");
      const inspection = await this.persistConceptInspection(job, "approved", request.inspection);
      const approval = createConceptApproval(job.conceptAttempt.binding, inspection.evidence.inspectedAt, inspection.sha256);
      const variantDirectory = contained(job.outputDirectory, join(job.outputDirectory, "variant-1"));
      const approvalPath = join(variantDirectory, "concept-approval.json");
      await this.writeJsonAtomic(approvalPath, approval);
      if (this.jobCancelled(job)) return job;
      const retained = JSON.parse(await readFile(approvalPath, "utf8"));
      if (this.jobCancelled(job)) return job;
      if (stableJson(retained) !== stableJson(approval)) throw new Error("The retained concept approval could not be verified.");
      assertGeometryApproval(job.id, job.spec, job.conceptAttempt, approval, conceptSha256, inspection);
      job.conceptApproval = approval;
      job.conceptDecisions = [...(job.conceptDecisions ?? []), {
        kind: "approved",
        source: "explicit-user-action",
        at: approval.approvedAt,
        jobId: job.id,
        attemptId: approval.attemptId,
        inspectionSha256: inspection.sha256,
        inspectionPath: inspection.path,
      }];
      job.approvedConcept = true;
      job.conceptOnly = false;
      job.state = "running";
      job.stage = "compliance";
      job.progress = 36;
      job.message = "Explicit concept approval retained · rechecking current hardware and provider integrity before geometry.";
      job.updatedAt = approval.approvedAt;
      delete job.error;
      await this.writeRecordedSpecs(job, variantDirectory);
      if (this.jobCancelled(job)) return job;
      this.publishJob(job);
      try {
        await this.preflightAndDispatch(job);
      } catch (error) {
        this.failJob(job, error);
        throw error;
      }
      return job;
    } finally {
      this.starting = false;
    }
  }

  async rejectConcept(token: string, request: Prompt3DRejectConceptRequest): Promise<Prompt3DJobStatus> {
    this.requireGrant(token);
    this.assertBatchDispatch(token, this.batchJobLinks.get(request.jobId));
    await this.loadHistory();
    const job = this.jobs.get(request.jobId);
    if (!job || job.state !== "awaiting-concept-approval" || !job.conceptAttempt || !supportsConceptWorkflow(job.spec)) {
      throw new Error("This job is not awaiting concept inspection.");
    }
    await this.verifyRetainedReferenceImage(job);
    const conceptSha256 = await this.retainedConceptHash(job);
    assertConceptAttemptBinding(job.id, job.spec, job.conceptAttempt, conceptSha256);
    if (stableJson(request.binding) !== stableJson(job.conceptAttempt.binding)) throw new Error("Concept rejection is stale or does not match the exact retained attempt binding.");
    const inspection = await this.persistConceptInspection(job, "rejected", request.inspection);
    const now = inspection.evidence.inspectedAt;
    job.conceptDecisions = [...(job.conceptDecisions ?? []), {
      kind: "rejected",
      source: "explicit-user-action",
      at: now,
      jobId: job.id,
      attemptId: job.conceptAttempt.binding.attemptId,
      inspectionSha256: inspection.sha256,
      inspectionPath: inspection.path,
      rejectionClassification: inspection.evidence.rejection!.classification,
    }];
    job.state = "failed";
    job.stage = "concept-review";
    job.progress = 35;
    job.error = {
      code: "CONCEPT_SEMANTIC_REJECTED",
      message: `Concept rejected after explicit inspection (${inspection.evidence.rejection!.classification}); retained evidence is ready for a corrected prompt or fresh seed.`,
      retryable: true,
    };
    job.message = job.error.message;
    job.updatedAt = now;
    await this.writeRecordedSpecs(job, dirname(job.conceptImagePath!));
    this.publishJob(job);
    return job;
  }

  async regenerateConcept(token: string, id: string): Promise<Prompt3DJobStatus> {
    this.requireGrant(token);
    const previous = this.status(token, id);
    const technicallyRejected = previous.state === "failed" && previous.error?.code === "CONCEPT_QUALITY_REJECTED";
    const explicitlyRejected = previous.state === "failed" && previous.error?.code === "CONCEPT_SEMANTIC_REJECTED";
    const upgradeRequired = previous.state === "failed" && previous.error?.code === "CONCEPT_INSPECTION_UPGRADE_REQUIRED";
    if (!technicallyRejected && !explicitlyRejected && !upgradeRequired) throw new Error("Inspect and classify a pending concept before regenerating it.");
    if (!previous.conceptAttempt) throw new Error("The retained concept attempt is unavailable.");
    const successor = await this.start(token, {
      spec: nextConceptRetrySpec(previous.spec),
      parentConceptJobId: previous.id,
      conceptChangeReason: "regenerated",
      conceptOnly: true,
      ...(previous.shapeRefinement === true ? { shapeRefinement: true } : {}),
      consent: { providerId: previous.providerId, confirmed: true, externalData: [], estimatedCostUsd: 0 },
    });
    const batchId = this.batchJobLinks.get(previous.id);
    if (batchId) {
      const runtimes = this.batchRuntime.get(batchId);
      const batch = this.batches.get(batchId);
      const runtimeEntry = runtimes
        ? [...runtimes.entries()].find(([, runtime]) => runtime.currentJobId === previous.id)
        : undefined;
      if (!batch || !runtimeEntry) throw new Error("Batch concept replacement lost its retained runtime link.");
      const [itemId, runtime] = runtimeEntry;
      runtime.currentJobId = successor.id;
      this.batchJobLinks.delete(previous.id);
      this.batchJobLinks.set(successor.id, batchId);
      const itemStatus = batch.items.find((item) => item.id === itemId);
      if (!itemStatus) throw new Error("Batch concept replacement item is unavailable.");
      await this.updateBatchItem(batch, itemStatus, {
        state: "concept",
        currentJobId: successor.id,
        message: "Generating a fresh retained concept attempt after explicit regeneration.",
      });
      this.queueBatchAdvance(batchId);
    }
    return successor;
  }

  status(token: string, id: string, internal = false) { if (!internal) this.requireGrant(token); const job = this.jobs.get(id); if (!job) throw new Error("Prompt-to-3D job not found."); return job; }
  async cancel(token: string, id: string, internal = false) {
    if (!internal) this.requireGrant(token);
    const job = this.status(token, id, internal);
    const sidecarId = this.activeSidecarJobs.get(id);
    const wasActive = job.state === "running" || job.state === "queued";
    const cancellation = {
      message: "Cancelled by user; partial output remains task-contained.",
      updatedAt: new Date().toISOString(),
    };
    this.jobCancellations.set(id, cancellation);
    this.activeSidecarJobs.delete(id);
    Object.assign(job, { state: "cancelled", stage: "cancelled", ...cancellation });
    this.publishJob(job);
    if (wasActive && sidecarId) {
      await this.sidecarRequest(`/jobs/${sidecarId}/cancel`, { method: "POST", body: "{}" }).catch(() => undefined);
    }
    return job;
  }
  async retry(token: string, id: string) {
    this.requireGrant(token);
    await Promise.all([this.loadHistory(), this.loadFinishHistory()]);
    const previous = this.status(token, id);
    if (["CONCEPT_QUALITY_REJECTED", "CONCEPT_SEMANTIC_REJECTED", "CONCEPT_INSPECTION_UPGRADE_REQUIRED"].includes(previous.error?.code ?? "")) return this.regenerateConcept(token, id);
    if (previous.state === "awaiting-concept-approval") throw new Error("Inspect and explicitly reject this concept before retrying it.");
    if (previous.state === "failed" && previous.error?.retryable === true
      && previous.approvedConcept === true && previous.conceptAttempt && previous.conceptApproval
      && supportsConceptWorkflow(previous.spec) && previous.variants.length === 0) {
      if (this.starting) throw new Error("Another generation action is already passing preflight checks.");
      this.starting = true;
      try {
        if ([...this.jobs.values()].some((candidate) => candidate.id !== previous.id && (candidate.state === "queued" || candidate.state === "running"))
          || [...this.finishJobs.values()].some((candidate) => candidate.state === "queued" || candidate.state === "running")) {
          throw new Error(`Prompt-to-3D concurrency is bounded to ${MAX_JOBS}.`);
        }
        await this.verifyRetainedReferenceImage(previous);
        const conceptSha256 = await this.retainedConceptHash(previous);
        if (hasStructuredConceptProtocol(previous.conceptAttempt)) await this.verifyConceptInspection(previous, "approved");
        assertGeometryApproval(previous.id, previous.spec, previous.conceptAttempt, previous.conceptApproval, conceptSha256, previous.conceptInspection);
        Object.assign(previous, {
          state: "running",
          stage: "compliance",
          progress: 36,
          message: "Retained concept approval verified · retrying geometry after the recoverable provider failure.",
          updatedAt: new Date().toISOString(),
        });
        delete previous.error;
        await this.writeRecordedSpecs(previous, contained(previous.outputDirectory, join(previous.outputDirectory, "variant-1")));
        this.publishJob(previous);
        try {
          await this.preflightAndDispatch(previous);
        } catch (error) {
          this.failJob(previous, error);
          throw error;
        }
        return previous;
      } finally {
        this.starting = false;
      }
    }
    return this.start(token, {
      spec: { ...previous.spec, seed: previous.spec.seed + 1 },
      consent: { providerId: previous.providerId, confirmed: true },
    });
  }
  shutdown() { this.sidecar?.process.kill(); this.sidecar = null; this.revokeAll(); }
}
