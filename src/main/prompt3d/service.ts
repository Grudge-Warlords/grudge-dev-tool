import { EventEmitter } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  AssetSpecV1,
  LocalPrompt3DProviderId,
  Prompt3DApproveConceptRequest,
  Prompt3DConceptAttempt,
  Prompt3DInstallRequest,
  Prompt3DJobStatus,
  Prompt3DHistory,
  Prompt3DOverview,
  Prompt3DPlanRequest,
  Prompt3DPlanResult,
  Prompt3DStartRequest,
} from "../../shared/prompt3d";
import { PROMPT3D_SPEC_VERSION } from "../../shared/prompt3d";
import { PROMPT3D_PROVIDERS, localProvider } from "./providers";
import { evaluatePrompt3DCompliance, measurePrompt3DHardware } from "./hardware";
import { Prompt3DInstaller } from "./installer";
import { postprocessPrompt3DGlb } from "./postprocess";
import { planPrompt3DAsset } from "./planner";
import { validatePrompt3DGlb } from "./validation";
import { readPrompt3DJobs, savePrompt3DJob } from "./history";
import { compilePrompt3DPrompt, validateObjectRules, withObjectRules } from "../../shared/prompt3dRules";
import { sanitizeAssetSpec, stableJson, supportsConceptWorkflow } from "../../shared/conceptWorkflow";
import {
  approvalProvenanceFields,
  assertGeometryApproval,
  createConceptApproval,
  createConceptBinding,
  inheritConceptHistory,
  nextConceptRetrySpec,
  sha256Hex,
} from "./conceptApproval";

const MAX_JOBS = 1;
const MAX_PROMPT = 2_000;
const MAX_VARIANTS = 4;
const JOB_TIMEOUT_MS = 90 * 60_000;
const MAX_PROVIDER_OUTPUT_BYTES = 1 * 1024 ** 3;
const MAX_VARIANT_TREE_BYTES = 2 * 1024 ** 3;
const MAX_VARIANT_FILES = 100;
const SAFE_CHILD_ENV = new Set([
  "APPDATA", "COMSPEC", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "NUMBER_OF_PROCESSORS", "OS",
  "PATH", "PATHEXT", "PROCESSOR_ARCHITECTURE", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
  "PROGRAMW6432", "PUBLIC", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "WINDIR",
]);

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
  if (typeof value.prompt !== "string" || !value.prompt.trim() || value.prompt.length > MAX_PROMPT) throw new Error("Prompt must contain 1–2,000 characters.");
  if (!Number.isInteger(value.variants) || value.variants < 1 || value.variants > MAX_VARIANTS) throw new Error("Variants must be between 1 and 4.");
  if (!Number.isSafeInteger(value.seed) || value.seed < 0 || value.seed > 0x7fffffff) throw new Error("Seed must be an integer from 0 to 2,147,483,647.");
  if (value.scaleMode !== undefined && !["preserve", "exact"].includes(value.scaleMode)) throw new Error("Unknown scale mode.");
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
  if (["character", "vehicle"].includes(value.category)) throw new Error("Character/vehicle generation remains disabled until the owning rig, topology and facing contracts are supplied.");
  const provider = PROMPT3D_PROVIDERS.find((candidate) => candidate.id === value.providerId);
  if (!provider || !provider.enabledRoutes.includes(value.route)) throw new Error("The selected provider route is not enabled by this build.");
  return value;
}

export interface Prompt3DServiceOptions {
  root: string;
  appRoot: string;
  offlineLocalTest: boolean;
}

export class Prompt3DService extends EventEmitter {
  private root: string;
  private installer: Prompt3DInstaller;
  private grants = new Set<string>();
  private jobs = new Map<string, Prompt3DJobStatus>();
  private historyLoad: Promise<void> | null = null;
  private activeSidecarJobs = new Map<string, string>();
  private sidecar: { process: ChildProcess; port: number; token: string } | null = null;
  private starting = false;

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
    await this.loadHistory();
    const jobs = [...this.jobs.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return {
      latestJob: jobs[0] ?? null,
      previousResult: jobs.find(job => job.state === "complete" && job.variants.some(v => v.report.gameReady))
        ?? jobs.find(job => job.variants.length > 0) ?? null,
    };
  }

  private publishJob(job: Prompt3DJobStatus) {
    try { savePrompt3DJob(this.root, job); delete job.autosaveError; }
    catch (error) { job.autosaveError = error instanceof Error ? error.message : String(error); }
    this.emit("job-progress", job);
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
    const temporary = `${path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  }

  private recordedSpec(job: Prompt3DJobStatus, seed = job.spec.seed) {
    return {
      ...sanitizeAssetSpec({ ...job.spec, seed }),
      promptPlan: job.promptPlan ?? compilePrompt3DPrompt(job.spec),
      conceptOnly: job.conceptOnly === true,
      approvedConcept: job.approvedConcept === true,
      ...(job.conceptAttempt ? { conceptAttempt: job.conceptAttempt } : {}),
      ...(job.conceptApproval ? { conceptApproval: job.conceptApproval } : {}),
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

  private async retainConceptAttempt(
    job: Prompt3DJobStatus,
    variantDirectory: string,
    status: "pass" | "needs-regeneration",
    detail?: string,
  ): Promise<Prompt3DConceptAttempt> {
    const conceptImagePath = contained(job.outputDirectory, join(variantDirectory, "concept.png"));
    job.conceptImagePath = conceptImagePath;
    const conceptSha256 = await this.retainedConceptHash(job);
    const reportPath = contained(job.outputDirectory, join(variantDirectory, "concept-review.json"));
    let method = "deterministic-framing";
    try {
      const reportLink = await lstat(reportPath);
      const reportInfo = await stat(reportPath);
      if (reportLink.isSymbolicLink() || !reportInfo.isFile() || reportInfo.size > 128 * 1024) throw new Error("Unsafe concept review report.");
      const report = JSON.parse(await readFile(reportPath, "utf8")) as { method?: unknown };
      if (typeof report.method === "string" && report.method.length <= 100) method = report.method;
    } catch {
      if (status === "pass") throw new Error("The deterministic concept review report is missing or invalid.");
    }
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
      promptPlan: job.promptPlan ?? compilePrompt3DPrompt(job.spec),
      technicalReview: { status, method, message, reportPath, checkedAt },
      createdAt: checkedAt,
    };
    job.conceptAttempt = attempt;
    job.conceptAttempts = [...existing, attempt];
    await this.writeJsonAtomic(join(variantDirectory, "concept-attempt.json"), attempt);
    await this.writeRecordedSpecs(job, variantDirectory);
    return attempt;
  }

  /** Restore a previously user-selected root before renderer IPC becomes available. */
  async restoreRoot(path: string) {
    if (resolve(path) !== this.root) { this.jobs.clear(); this.historyLoad = null; }
    this.root = resolve(path);
    await mkdir(this.root, { recursive: true });
    this.installer = this.makeInstaller();
  }

  async setRoot(token: string, path: string) {
    this.requireGrant(token);
    if ([...this.jobs.values()].some((job) => job.state === "queued" || job.state === "running") || [...(["hunyuan3d-2", "trellis"] as const)].some((p) => this.installer.getStatus(p).state === "installing")) throw new Error("Cannot change the installation root while work is active.");
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
    const result = await planPrompt3DAsset(current);
    result.spec = assertSpec(result.spec);
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

  async start(token: string, request: Prompt3DStartRequest): Promise<Prompt3DJobStatus> {
    this.requireGrant(token);
    if (this.starting) throw new Error("A generation is already passing preflight checks.");
    this.starting = true;
    try { return await this.startChecked(token, request); } finally { this.starting = false; }
  }

  private async startChecked(token: string, request: Prompt3DStartRequest): Promise<Prompt3DJobStatus> {
    this.requireGrant(token);
    await this.loadHistory();
    let spec = withObjectRules(assertSpec({
      ...sanitizeAssetSpec(request.spec),
      objectRules: undefined,
      coordinateContract: { ...request.spec.coordinateContract, origin: "ground-center" },
    }));
    const conceptWorkflow = supportsConceptWorkflow(spec);
    if (conceptWorkflow && spec.variants !== 1) spec = { ...spec, variants: 1 };
    if (request.approvedConceptJobId) throw new Error("Legacy concept reuse cannot authorize geometry. Use the exact retained approval action.");
    if (request.conceptOnly && !conceptWorkflow) throw new Error("Concept-only generation is available only for the Hunyuan concept route.");
    if (!request.consent?.confirmed || request.consent.providerId !== spec.providerId) throw new Error("The selected provider boundary must be confirmed for this run.");
    if (PROMPT3D_PROVIDERS.find((p) => p.id === spec.providerId)?.kind === "cloud") throw new Error("Cloud providers are not configured; no prompt or reference data was sent.");
    if ([...this.jobs.values()].some((j) => j.state === "queued" || j.state === "running")) throw new Error(`Prompt-to-3D concurrency is bounded to ${MAX_JOBS}.`);
    let parent: Prompt3DJobStatus | undefined;
    if (request.parentConceptJobId || request.conceptChangeReason) {
      if (!request.parentConceptJobId || !request.conceptChangeReason) throw new Error("Concept ancestry requires the exact retained parent and explicit change action.");
      parent = this.jobs.get(request.parentConceptJobId);
      if (!parent?.conceptAttempt || !supportsConceptWorkflow(parent.spec)) throw new Error("The retained parent concept is unavailable.");
      if (!(["awaiting-concept-approval", "failed"] as const).includes(parent.state as "awaiting-concept-approval" | "failed")) throw new Error("Only a pending or technically rejected concept can start a successor attempt.");
      if (request.conceptChangeReason === "regenerated") {
        const expected = withObjectRules(assertSpec({
          ...nextConceptRetrySpec(parent.spec),
          objectRules: undefined,
          coordinateContract: { ...parent.spec.coordinateContract, origin: "ground-center" },
        }));
        if (stableJson(expected) !== stableJson(spec)) throw new Error("Concept regeneration must preserve the brief and increment the seed exactly once.");
      } else if (stableJson(sanitizeAssetSpec(parent.spec)) === stableJson(sanitizeAssetSpec(spec))) {
        throw new Error("Edit the saved brief before starting a replacement concept.");
      }
    }
    const id = randomUUID(), outputDirectory = contained(this.root, join(this.root, "jobs", id));
    await mkdir(outputDirectory, { recursive: true });
    const now = new Date().toISOString();
    const job: Prompt3DJobStatus = {
      id, state: "running", stage: "compliance", progress: 1, providerId: spec.providerId, spec,
      message: "Job accepted · measuring GPU, WSL and current headroom.", outputDirectory, variants: [], createdAt: now, updatedAt: now,
      timings: [{ stage: "job-acceptance", status: "complete", startedAt: now, completedAt: now, elapsedMs: 0, message: "Job accepted and retained before preflight began." }],
    };
    job.conceptOnly = conceptWorkflow;
    job.approvedConcept = conceptWorkflow ? false : undefined;
    job.promptPlan = compilePrompt3DPrompt(spec);
    if (parent && request.conceptChangeReason) {
      const history = inheritConceptHistory(parent, id, request.conceptChangeReason, now);
      job.conceptAttempts = history.attempts;
      job.conceptDecisions = history.decisions;
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
    const provider = localProvider(job.providerId);
    const readiness = this.beginTiming(job, "hardware-readiness", "Measuring GPU headroom and starting/probing the configured WSL runtime.");
    const hardware = await measurePrompt3DHardware(this.root, true);
    this.finishTiming(job, "hardware-readiness", readiness.startedAt, readiness.startedMs, "GPU, platform and WSL readiness measured.");
    if (this.jobs.get(job.id)?.state === "cancelled") return;
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
    // Full model-byte hashing is performed when installing/repairing. Repeating
    // it on every run added over a minute of blind disk I/O; pre-run still
    // verifies the signed checksum inventory, exact file set/sizes, source
    // revisions, origins and environment lock hashes.
    const integrity = await this.installer.verify(provider.id as LocalPrompt3DProviderId, false);
    this.finishTiming(job, "signed-provider-verification", verification.startedAt, verification.startedMs, integrity.reason, integrity.ok ? "complete" : "failed");
    if (this.jobs.get(job.id)?.state === "cancelled") return;
    const compliance = evaluatePrompt3DCompliance(provider, hardware, this.root, "pre-run", job.spec);
    if (!integrity.ok) throw new Error(`setup-required: ${integrity.reason}`);
    if (!compliance.canRun) throw new Error(`${compliance.state}: ${compliance.reasons.join(" ")}`);
    job.stage = "queued";
    job.progress = job.conceptApproval ? 36 : 5;
    job.message = job.conceptApproval
      ? "Approval verified · starting the loopback-only geometry sidecar."
      : "Preflight passed · starting the loopback-only sidecar.";
    this.publishJob(job);
    void this.runJob(job, hardware.wsl.usableLinuxDistribution ?? undefined).catch((error) => this.failJob(job, error));
  }

  private async runJob(job: Prompt3DJobStatus, wslDistro?: string) {
    const deadline = Date.now() + JOB_TIMEOUT_MS;
    const variants: Prompt3DJobStatus["variants"] = [];
    for (let index = 0; index < job.spec.variants; index += 1) {
      if (job.state === "cancelled") return;
      const variantDirectory = join(job.outputDirectory, `variant-${index + 1}`); await mkdir(variantDirectory, { recursive: true });
      if (supportsConceptWorkflow(job.spec) && job.conceptApproval) {
        const conceptSha256 = await this.retainedConceptHash(job);
        assertGeometryApproval(job.id, job.spec, job.conceptAttempt, job.conceptApproval, conceptSha256);
      }
      const variantSpec = this.recordedSpec(job, job.spec.seed + index);
      const variantSpecPath = join(variantDirectory, "asset-spec.json"); await this.writeJsonAtomic(variantSpecPath, variantSpec);
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
      if (!sidecarHealth.ok || sidecarHealth.binding !== "127.0.0.1") throw new Error("Prompt-to-3D sidecar health contract failed.");
      this.finishTiming(job, "sidecar-health", sidecarTiming.startedAt, sidecarTiming.startedMs, "Loopback sidecar is healthy and ready.");
      await this.sidecarRequest("/jobs", { method: "POST", body: JSON.stringify({ jobId: sidecarId, providerId: job.providerId, specPath: variantSpecPath, output: raw, ...runtime }) });
      for (;;) {
        if (Date.now() > deadline) { await this.cancel("internal", job.id, true); throw new Error("Generation exceeded the 90-minute timeout."); }
        await new Promise((r) => setTimeout(r, 1_000));
        const state: any = await this.sidecarRequest(`/jobs/${sidecarId}`);
        this.mergeProviderTimings(job, state.timings);
        const providerProgress = Math.min(90, state.progress ?? 0);
        const overall = Math.round(((index + providerProgress / 100) / job.spec.variants) * 90);
        if (existsSync(join(variantDirectory, "concept.png"))) job.conceptImagePath = join(variantDirectory, "concept.png");
        Object.assign(job, { stage: state.stage ?? job.stage, progress: overall, message: `Variant ${index + 1}/${job.spec.variants}: ${state.message ?? job.message}`, updatedAt: new Date().toISOString() }); this.publishJob(job);
        if (state.state === "failed") {
          if (String(state.error ?? "").startsWith("CONCEPT_REVIEW_REQUIRED:") && job.conceptImagePath) {
            await this.retainConceptAttempt(job, variantDirectory, "needs-regeneration", String(state.reviewMessage ?? state.error));
          }
          throw new Error(state.error || "Provider generation failed.");
        }
        if (state.state === "cancelled") { job.state = "cancelled"; job.stage = "cancelled"; this.publishJob(job); return; }
        if (state.state === "complete") break;
      }
      if (supportsConceptWorkflow(job.spec) && !job.conceptApproval) {
        if (!job.conceptImagePath) throw new Error("No concept image was produced.");
        await this.retainConceptAttempt(job, variantDirectory, "pass");
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
        this.publishJob(job); return;
      }
      if (supportsConceptWorkflow(job.spec)) {
        const conceptSha256 = await this.retainedConceptHash(job);
        assertGeometryApproval(job.id, job.spec, job.conceptAttempt, job.conceptApproval, conceptSha256);
      }
      const rawLinkInfo = await lstat(raw);
      const rawInfo = await stat(raw);
      if (rawLinkInfo.isSymbolicLink() || !rawInfo.isFile() || rawInfo.size <= 0 || rawInfo.size > MAX_PROVIDER_OUTPUT_BYTES) throw new Error("Provider GLB is a link, empty or exceeds the 1 GiB output limit.");
      await measureTaskTree(variantDirectory);
      job.stage = "postprocess"; job.message = `Applying the canonical contract to variant ${index + 1}.`; this.publishJob(job);
      const postprocessTiming = this.beginTiming(job, "post-process", `Applying the canonical contract to variant ${index + 1}.`);
      const finalPath = join(variantDirectory, "asset.glb"); await postprocessPrompt3DGlb(raw, finalPath, variantSpec);
      this.finishTiming(job, "post-process", postprocessTiming.startedAt, postprocessTiming.startedMs, "Canonical post-processing complete.");
      // Keep the original mesh beside the finished version for visual comparison
      // and lossless reprocessing. New generations always use new job folders.
      await rm(join(variantDirectory, "trellis-runtime-model"), { recursive: true, force: true });
      job.stage = "validation"; this.publishJob(job);
      const validationTiming = this.beginTiming(job, "validation", "Running deterministic structure, geometry, scale and budget validation.");
      const report = await validatePrompt3DGlb(finalPath, variantSpec, join(this.root, "quarantine"));
      this.finishTiming(job, "validation", validationTiming.startedAt, validationTiming.startedMs, `Validation ${report.gameReady ? "passed" : "quarantined the asset"} · ${report.deterministicId.slice(0, 12)}.`);
      const conceptSha256 = supportsConceptWorkflow(job.spec) ? await this.retainedConceptHash(job) : "";
      const approvalFields = approvalProvenanceFields(job.id, job.spec, job.conceptAttempt, job.conceptApproval, conceptSha256);
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
        ...approvalFields,
        conceptAttempts: job.conceptAttempts ?? [],
        conceptDecisions: job.conceptDecisions ?? [],
      };
      const provenancePath = join(variantDirectory, "provenance.json"); await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
      variants.push({ index, glbPath: report.quarantinedPath ?? finalPath, report, provenancePath });
      job.variants = [...variants]; this.publishJob(job);
    }
    this.activeSidecarJobs.delete(job.id);
    const allReady = variants.length === job.spec.variants && variants.every((variant) => variant.report.gameReady);
    job.state = allReady ? "complete" : "failed"; job.stage = allReady ? "complete" : "quarantine"; job.progress = 100;
    job.message = allReady ? `${variants.length} variant${variants.length === 1 ? "" : "s"} passed technical checks. Visual review is required.` : "One or more variants failed validation; failed assets were quarantined and nothing was published or uploaded.";
    if (!allReady) job.error = { code: "VALIDATION_FAILED", message: job.message, retryable: true };
    job.updatedAt = new Date().toISOString(); this.publishJob(job);
  }

  private failJob(job: Prompt3DJobStatus, error: unknown) {
    if (job.state === "cancelled") return;
    this.activeSidecarJobs.delete(job.id);
    const message = error instanceof Error ? error.message : String(error);
    const conceptRejected = message.startsWith("CONCEPT_REVIEW_REQUIRED:");
    job.state = "failed"; job.stage = conceptRejected ? "concept-review" : "failed";
    job.error = {
      code: conceptRejected ? "CONCEPT_QUALITY_REJECTED" : "PROVIDER_FAILED",
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
    if (this.starting) throw new Error("Another generation action is already passing preflight checks.");
    this.starting = true;
    try {
      await this.loadHistory();
      const job = this.jobs.get(request.jobId);
      if (!job || job.state !== "awaiting-concept-approval" || !job.conceptAttempt || !supportsConceptWorkflow(job.spec)) throw new Error("This job is not awaiting concept approval.");
      if ([...this.jobs.values()].some((candidate) => candidate.id !== job.id && (candidate.state === "queued" || candidate.state === "running"))) throw new Error(`Prompt-to-3D concurrency is bounded to ${MAX_JOBS}.`);
      const conceptSha256 = await this.retainedConceptHash(job);
      const expected = createConceptBinding(job.id, job.conceptAttempt.attemptNumber, job.spec, conceptSha256);
      if (stableJson(request.binding) !== stableJson(expected) || stableJson(job.conceptAttempt.binding) !== stableJson(expected)) throw new Error("Concept approval is stale or does not match the retained job, image, prompt, seed, provider and spec.");
      const approval = createConceptApproval(expected);
      const variantDirectory = contained(job.outputDirectory, join(job.outputDirectory, "variant-1"));
      const approvalPath = join(variantDirectory, "concept-approval.json");
      await this.writeJsonAtomic(approvalPath, approval);
      const retained = JSON.parse(await readFile(approvalPath, "utf8"));
      if (stableJson(retained) !== stableJson(approval)) throw new Error("The retained concept approval could not be verified.");
      assertGeometryApproval(job.id, job.spec, job.conceptAttempt, approval, conceptSha256);
      job.conceptApproval = approval;
      job.conceptDecisions = [...(job.conceptDecisions ?? []), {
        kind: "approved",
        source: "explicit-user-action",
        at: approval.approvedAt,
        jobId: job.id,
        attemptId: approval.attemptId,
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

  async regenerateConcept(token: string, id: string): Promise<Prompt3DJobStatus> {
    this.requireGrant(token);
    const previous = this.status(token, id);
    const technicallyRejected = previous.state === "failed" && previous.error?.code === "CONCEPT_QUALITY_REJECTED";
    if (previous.state !== "awaiting-concept-approval" && !technicallyRejected) throw new Error("Only a pending or technically rejected concept can be regenerated.");
    if (!previous.conceptAttempt) throw new Error("The retained concept attempt is unavailable.");
    return this.start(token, {
      spec: nextConceptRetrySpec(previous.spec),
      parentConceptJobId: previous.id,
      conceptChangeReason: "regenerated",
      conceptOnly: true,
      consent: { providerId: previous.providerId, confirmed: true, externalData: [], estimatedCostUsd: 0 },
    });
  }

  status(token: string, id: string, internal = false) { if (!internal) this.requireGrant(token); const job = this.jobs.get(id); if (!job) throw new Error("Prompt-to-3D job not found."); return job; }
  async cancel(token: string, id: string, internal = false) { if (!internal) this.requireGrant(token); const job = this.status(token, id, internal); const sidecarId = this.activeSidecarJobs.get(id); if (job.state === "running" && sidecarId) await this.sidecarRequest(`/jobs/${sidecarId}/cancel`, { method: "POST", body: "{}" }).catch(() => undefined); this.activeSidecarJobs.delete(id); job.state = "cancelled"; job.stage = "cancelled"; job.message = "Cancelled by user; partial output remains task-contained."; job.updatedAt = new Date().toISOString(); this.publishJob(job); return job; }
  async retry(token: string, id: string) {
    this.requireGrant(token);
    const previous = this.status(token, id);
    if (previous.error?.code === "CONCEPT_QUALITY_REJECTED" || previous.state === "awaiting-concept-approval") return this.regenerateConcept(token, id);
    return this.start(token, {
      spec: { ...previous.spec, seed: previous.spec.seed + 1 },
      consent: { providerId: previous.providerId, confirmed: true },
    });
  }
  shutdown() { this.sidecar?.process.kill(); this.sidecar = null; this.revokeAll(); }
}
