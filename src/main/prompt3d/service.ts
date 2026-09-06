import { EventEmitter } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type {
  AssetSpecV1,
  LocalPrompt3DProviderId,
  Prompt3DInstallRequest,
  Prompt3DJobStatus,
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
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..")) return b;
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
  if (!["prop", "building", "road-furniture", "environment", "character", "vehicle"].includes(value.category)) throw new Error("Unknown asset category.");
  if (!["realistic", "stylized", "low-poly", "hand-painted", "industrial", "custom"].includes(value.style)) throw new Error("Unknown asset style.");
  if (value.style === "custom" && (typeof value.customStyle !== "string" || !value.customStyle.trim() || value.customStyle.length > 200)) throw new Error("Custom style must contain 1–200 characters.");
  if (![value.dimensions.width, value.dimensions.height, value.dimensions.depth].every((n) => Number.isFinite(n) && n > 0 && n <= 10_000)) throw new Error("Dimensions are outside the allowed range.");
  if (!["m", "cm"].includes(value.dimensions.unit)) throw new Error("Dimensions must use metres or centimetres.");
  if (!Number.isInteger(value.budgets.maxTriangles) || value.budgets.maxTriangles < 100 || value.budgets.maxTriangles > 2_000_000) throw new Error("Triangle budget must be 100–2,000,000.");
  if (![512, 1024, 2048, 4096].includes(value.budgets.maxTextureResolution) || !Number.isSafeInteger(value.budgets.maxTextureBytes) || value.budgets.maxTextureBytes < 1 || value.budgets.maxTextureBytes > 512 * 1024 ** 2) throw new Error("Texture budget is outside the allowed range.");
  if (value.targetFormat !== "glb" || value.coordinateContract.upAxis !== "+Y" || value.coordinateContract.forwardAxis !== "+Z") throw new Error("Only the declared GLB +Y-up/+Z-forward contract is allowed.");
  if (value.coordinateContract.origin !== "ground-center" || value.coordinateContract.stableRootName !== "GrudgeAssetRoot") throw new Error("The canonical root and grounding contract cannot be overridden.");
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
  private activeSidecarJobs = new Map<string, string>();
  private sidecar: { process: ChildProcess; port: number; token: string } | null = null;

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

  async setRoot(token: string, path: string) {
    this.requireGrant(token);
    if ([...this.jobs.values()].some((job) => job.state === "queued" || job.state === "running") || [...(["hunyuan3d-2", "trellis"] as const)].some((p) => this.installer.getStatus(p).state === "installing")) throw new Error("Cannot change the installation root while work is active.");
    this.root = resolve(path); await mkdir(this.root, { recursive: true }); this.installer = this.makeInstaller();
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
    const spec = assertSpec(request.spec);
    if (!request.consent?.confirmed || request.consent.providerId !== spec.providerId) throw new Error("The selected provider boundary must be confirmed for this run.");
    if (PROMPT3D_PROVIDERS.find((p) => p.id === spec.providerId)?.kind === "cloud") throw new Error("Cloud providers are not configured; no prompt or reference data was sent.");
    if ([...this.jobs.values()].some((j) => j.state === "queued" || j.state === "running") || this.jobs.size >= 100) throw new Error(`Prompt-to-3D concurrency is bounded to ${MAX_JOBS}.`);
    const provider = localProvider(spec.providerId);
    const hardware = await measurePrompt3DHardware(this.root, true);
    const compliance = evaluatePrompt3DCompliance(provider, hardware, this.root, "pre-run", spec);
    const integrity = await this.installer.verify(provider.id as LocalPrompt3DProviderId, true);
    if (!integrity.ok) throw new Error(`setup-required: ${integrity.reason}`);
    if (!compliance.canRun) throw new Error(`${compliance.state}: ${compliance.reasons.join(" ")}`);
    const id = randomUUID(), outputDirectory = contained(this.root, join(this.root, "jobs", id));
    await mkdir(outputDirectory, { recursive: true });
    const specPath = join(outputDirectory, "asset-spec.json"); await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
    const now = new Date().toISOString();
    const job: Prompt3DJobStatus = { id, state: "running", stage: "queued", progress: 0, providerId: spec.providerId, spec, message: "Queued for the loopback-only provider sidecar.", outputDirectory, variants: [], createdAt: now, updatedAt: now };
    this.jobs.set(id, job); this.emit("job-progress", job);
    void this.runJob(job, specPath).catch((error) => this.failJob(job, error));
    return job;
  }

  private async runJob(job: Prompt3DJobStatus, _specPath: string) {
    const deadline = Date.now() + JOB_TIMEOUT_MS;
    const variants: Prompt3DJobStatus["variants"] = [];
    for (let index = 0; index < job.spec.variants; index += 1) {
      if (job.state === "cancelled") return;
      const variantDirectory = join(job.outputDirectory, `variant-${index + 1}`); await mkdir(variantDirectory, { recursive: true });
      const variantSpec = { ...job.spec, seed: job.spec.seed + index, variants: 1 };
      const variantSpecPath = join(variantDirectory, "asset-spec.json"); await writeFile(variantSpecPath, `${JSON.stringify(variantSpec, null, 2)}\n`);
      const raw = join(variantDirectory, "provider-output.glb"), sidecarId = `${job.id}-${index + 1}`;
      this.activeSidecarJobs.set(job.id, sidecarId);
      job.message = `Starting variant ${index + 1} of ${job.spec.variants}.`; this.emit("job-progress", job);
      let runtime: Record<string, string>;
      if (job.providerId === "trellis" || job.providerId === "hunyuan3d-2") {
        const hardware = await measurePrompt3DHardware(this.root, true);
        if (!hardware.wsl.usableLinuxDistribution) throw new Error(`${localProvider(job.providerId).name} requires its configured normal WSL Linux distribution.`);
        runtime = { wslDistro: hardware.wsl.usableLinuxDistribution, providerRootName: `${job.providerId}-${localProvider(job.providerId).sourceRevision.slice(0, 12)}` };
      } else runtime = { python: this.pythonFor("hunyuan3d-2") };
      await this.sidecarRequest("/jobs", { method: "POST", body: JSON.stringify({ jobId: sidecarId, providerId: job.providerId, specPath: variantSpecPath, output: raw, ...runtime }) });
      for (;;) {
        if (Date.now() > deadline) { await this.cancel("internal", job.id, true); throw new Error("Generation exceeded the 90-minute timeout."); }
        await new Promise((r) => setTimeout(r, 1_000));
        const state: any = await this.sidecarRequest(`/jobs/${sidecarId}`);
        const providerProgress = Math.min(90, state.progress ?? 0);
        const overall = Math.round(((index + providerProgress / 100) / job.spec.variants) * 90);
        Object.assign(job, { stage: state.stage ?? job.stage, progress: overall, message: `Variant ${index + 1}/${job.spec.variants}: ${state.message ?? job.message}`, updatedAt: new Date().toISOString() }); this.emit("job-progress", job);
        if (state.state === "failed") throw new Error(state.error || "Provider generation failed.");
        if (state.state === "cancelled") { job.state = "cancelled"; job.stage = "cancelled"; this.emit("job-progress", job); return; }
        if (state.state === "complete") break;
      }
      const rawLinkInfo = await lstat(raw);
      const rawInfo = await stat(raw);
      if (rawLinkInfo.isSymbolicLink() || !rawInfo.isFile() || rawInfo.size <= 0 || rawInfo.size > MAX_PROVIDER_OUTPUT_BYTES) throw new Error("Provider GLB is a link, empty or exceeds the 1 GiB output limit.");
      await measureTaskTree(variantDirectory);
      job.stage = "postprocess"; job.message = `Applying the canonical contract to variant ${index + 1}.`; this.emit("job-progress", job);
      const finalPath = join(variantDirectory, "asset.glb"); await postprocessPrompt3DGlb(raw, finalPath, variantSpec);
      await rm(raw, { force: true });
      await rm(join(variantDirectory, "trellis-runtime-model"), { recursive: true, force: true });
      job.stage = "validation"; this.emit("job-progress", job);
      const report = await validatePrompt3DGlb(finalPath, variantSpec, join(this.root, "quarantine"));
      const provenance = { createdAt: new Date().toISOString(), specVersion: variantSpec.version, provider: localProvider(job.providerId), prompt: variantSpec.prompt, seed: variantSpec.seed, offline: true, validationId: report.deterministicId };
      const provenancePath = join(variantDirectory, "provenance.json"); await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
      variants.push({ index, glbPath: report.quarantinedPath ?? finalPath, report, provenancePath });
      job.variants = [...variants]; this.emit("job-progress", job);
    }
    this.activeSidecarJobs.delete(job.id);
    const allReady = variants.length === job.spec.variants && variants.every((variant) => variant.report.gameReady);
    job.state = allReady ? "complete" : "failed"; job.stage = allReady ? "complete" : "quarantine"; job.progress = 100;
    job.message = allReady ? `${variants.length} validated game-ready variant${variants.length === 1 ? "" : "s"} available.` : "One or more variants failed validation; failed assets were quarantined and nothing was published or uploaded.";
    if (!allReady) job.error = { code: "VALIDATION_FAILED", message: job.message, retryable: true };
    job.updatedAt = new Date().toISOString(); this.emit("job-progress", job);
  }

  private failJob(job: Prompt3DJobStatus, error: unknown) {
    if (job.state === "cancelled") return;
    this.activeSidecarJobs.delete(job.id);
    job.state = "failed"; job.stage = "failed"; job.error = { code: "PROVIDER_FAILED", message: error instanceof Error ? error.message : String(error), retryable: true }; job.message = job.error.message; job.updatedAt = new Date().toISOString(); this.emit("job-progress", job);
  }

  status(token: string, id: string, internal = false) { if (!internal) this.requireGrant(token); const job = this.jobs.get(id); if (!job) throw new Error("Prompt-to-3D job not found."); return job; }
  async cancel(token: string, id: string, internal = false) { if (!internal) this.requireGrant(token); const job = this.status(token, id, internal); const sidecarId = this.activeSidecarJobs.get(id); if (job.state === "running" && sidecarId) await this.sidecarRequest(`/jobs/${sidecarId}/cancel`, { method: "POST", body: "{}" }).catch(() => undefined); this.activeSidecarJobs.delete(id); job.state = "cancelled"; job.stage = "cancelled"; job.message = "Cancelled by user; partial output remains task-contained."; job.updatedAt = new Date().toISOString(); this.emit("job-progress", job); return job; }
  async retry(token: string, id: string) { this.requireGrant(token); const previous = this.status(token, id); return this.start(token, { spec: { ...previous.spec, seed: previous.spec.seed + 1 }, consent: { providerId: previous.providerId, confirmed: true } }); }
  shutdown() { this.sidecar?.process.kill(); this.sidecar = null; this.revokeAll(); }
}
