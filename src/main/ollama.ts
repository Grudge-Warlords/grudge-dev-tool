/**
 * Grudgechain Ollama + agentic local AI runtime.
 *
 * Priority:
 *  1. Already-healthy endpoint at OLLAMA_HOST / http://localhost:11434
 *  2. Docker container **GRUDACHAIN** (ollama/ollama) with host port 11434
 *  3. Native `ollama serve` (Windows Local Programs path)
 *
 * Auto-ensure runs on app open and again when signing in as grudachain/admin.
 */

import { spawn, execFile, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { shell } from "electron";
import log from "./logger";
import { isCanonicalAdmin } from "../shared/adminAllowlist";

const execFileAsync = promisify(execFile);

const DEFAULT_HOST = "http://127.0.0.1:11434";
const CONTAINER_NAME = process.env.GRUDACHAIN_OLLAMA_CONTAINER ?? "GRUDACHAIN";
const CONTAINER_IMAGE = process.env.GRUDACHAIN_OLLAMA_IMAGE ?? "ollama/ollama:latest";
const CONTAINER_VOLUME = process.env.GRUDACHAIN_OLLAMA_VOLUME ?? "grudachain-ollama";
const HOST_PORT = Number(process.env.OLLAMA_PORT ?? 11434);
const DEFAULT_MODEL = process.env.OLLAMA_DEFAULT_MODEL ?? "grudge-dev";
/** Installed order for local AI: Grudge Modelfile first, then llama3.2 weights only. */
const PREFERRED_LOCAL_MODELS = ["grudge-dev", "llama3.2"];

/**
 * Normalize Ollama base URL for client fetch().
 * Docker/native often set OLLAMA_HOST=0.0.0.0:11434 (bind address) which is NOT
 * a valid fetch origin — rewrite to http://127.0.0.1:port.
 */
export function normalizeOllamaBaseUrl(raw: string | null | undefined): string {
  let h = (raw ?? DEFAULT_HOST).trim();
  if (!h) h = DEFAULT_HOST;
  // Strip trailing slash
  h = h.replace(/\/+$/, "");
  // Bare host:port or host without scheme
  if (!/^https?:\/\//i.test(h)) {
    h = `http://${h}`;
  }
  try {
    const u = new URL(h);
    // 0.0.0.0 / :: bind addresses are not routable as clients
    if (u.hostname === "0.0.0.0" || u.hostname === "::" || u.hostname === "[::]") {
      u.hostname = "127.0.0.1";
    }
    if (u.hostname === "localhost") {
      u.hostname = "127.0.0.1";
    }
    // Default port if missing
    if (!u.port && (u.protocol === "http:" || u.protocol === "https:")) {
      // keep implicit 80/443 only if user meant that; Ollama always uses 11434 by default
      if (u.protocol === "http:" && !h.match(/:\d+/)) {
        u.port = String(HOST_PORT);
      }
    }
    return u.origin; // scheme + host + port, no path
  } catch {
    return DEFAULT_HOST;
  }
}

type AiPref = "auto" | "ollama" | "cloudflare";

export type OllamaBackend = "none" | "external" | "docker-grudachain" | "native";

export interface OllamaRuntimeStatus {
  ok: boolean;
  host: string;
  version?: string;
  latencyMs: number;
  backend: OllamaBackend;
  container: {
    name: string;
    exists: boolean;
    running: boolean;
    portsPublished: boolean;
    image?: string;
  };
  nativePath: string | null;
  nativeRunning: boolean;
  models: string[];
  preferredModel: string;
  aiPref: AiPref;
  agenticReady: boolean;
  steps: string[];
  error?: string;
}

interface OllamaStore {
  get<T>(key: string, defaultValue?: T): T;
  set<T>(key: string, value: T): void;
}

let store: OllamaStore | null = null;
let nativeChild: ChildProcess | null = null;
let ensureInFlight: Promise<OllamaRuntimeStatus> | null = null;
let lastStatus: OllamaRuntimeStatus | null = null;

async function getStore(): Promise<OllamaStore> {
  if (store) return store;
  const mod: any = await import("electron-store");
  const StoreCtor = mod.default ?? mod;
  store = new StoreCtor({ name: "grudge-ollama" });
  return store!;
}

function hostUrl(): string {
  return normalizeOllamaBaseUrl(process.env.OLLAMA_HOST ?? DEFAULT_HOST);
}

export async function getOllamaHost(): Promise<string> {
  const s = await getStore();
  const stored = s.get("host", hostUrl()) as string;
  const fixed = normalizeOllamaBaseUrl(stored);
  // Heal bad persisted values (0.0.0.0 / missing scheme) so next reads work
  if (fixed !== stored) {
    s.set("host", fixed);
    log.info(`[ollama] normalized host ${stored} → ${fixed}`);
  }
  return fixed;
}

export function setOllamaHost(host: string): void {
  const fixed = normalizeOllamaBaseUrl(host);
  void getStore().then((s) => s.set("host", fixed));
}

export async function getPreferredModel(): Promise<string> {
  const s = await getStore();
  return s.get("model", DEFAULT_MODEL) as string;
}

export function setPreferredModel(model: string): void {
  void getStore().then((s) => s.set("model", model));
}

export async function getAiPreference(): Promise<AiPref> {
  const s = await getStore();
  const v = s.get("aiPref", "auto") as AiPref;
  return v === "ollama" || v === "cloudflare" ? v : "auto";
}

export function setAiPreference(pref: AiPref): void {
  void getStore().then((s) => s.set("aiPref", pref));
}

function findNativeOllama(): string | null {
  const candidates = [
    process.env.OLLAMA_BIN,
    join(process.env.LOCALAPPDATA ?? "", "Programs", "Ollama", "ollama.exe"),
    join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Ollama", "ollama.exe"),
    "ollama",
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (p === "ollama") continue;
    if (existsSync(p)) return p;
  }
  return null;
}

async function runDocker(
  args: string[],
  timeoutMs = 60_000,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("docker", args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { ok: true, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? err.message ?? "docker failed"),
    };
  }
}

async function dockerAvailable(): Promise<boolean> {
  const r = await runDocker(["version", "--format", "{{.Server.Version}}"], 8_000);
  return r.ok && Boolean(r.stdout.trim());
}

async function inspectContainer(): Promise<{
  exists: boolean;
  running: boolean;
  portsPublished: boolean;
  image?: string;
}> {
  const r = await runDocker(
    [
      "inspect",
      CONTAINER_NAME,
      "--format",
      "{{.State.Running}}|{{json .HostConfig.PortBindings}}|{{json .NetworkSettings.Ports}}|{{.Config.Image}}",
    ],
    10_000,
  );
  if (!r.ok) {
    return { exists: false, running: false, portsPublished: false };
  }
  const line = r.stdout.trim();
  const [runningRaw, bindingsRaw, portsRaw, image] = line.split("|");
  const running = runningRaw === "true";
  const portsBlob = `${bindingsRaw ?? ""}${portsRaw ?? ""}`;
  // Published when Docker maps host port (HostPort present) — bare "11434/tcp":null is NOT published.
  const portsPublished =
    /"HostPort"\s*:\s*"\d+"/.test(portsBlob) ||
    portsBlob.includes(`${HOST_PORT}->`) ||
    portsBlob.includes(`0.0.0.0:${HOST_PORT}`);
  return {
    exists: true,
    running,
    portsPublished,
    image: image || CONTAINER_IMAGE,
  };
}

async function recreateGrudachainContainer(steps: string[]): Promise<boolean> {
  steps.push(`Recreating Docker container ${CONTAINER_NAME} with -p ${HOST_PORT}:${HOST_PORT}`);
  await runDocker(["rm", "-f", CONTAINER_NAME], 30_000);
  // Ensure named volume for model persistence
  await runDocker(["volume", "create", CONTAINER_VOLUME], 15_000);
  const r = await runDocker(
    [
      "run",
      "-d",
      "--name",
      CONTAINER_NAME,
      "--restart",
      "unless-stopped",
      "-p",
      `${HOST_PORT}:11434`,
      "-v",
      `${CONTAINER_VOLUME}:/root/.ollama`,
      "-e",
      "OLLAMA_HOST=0.0.0.0:11434",
      CONTAINER_IMAGE,
    ],
    120_000,
  );
  if (!r.ok) {
    steps.push(`docker run failed: ${r.stderr.slice(0, 200)}`);
    return false;
  }
  steps.push(`Container ${CONTAINER_NAME} started (${r.stdout.trim().slice(0, 12)}…)`);
  return true;
}

async function ensureDockerGrudachain(steps: string[]): Promise<boolean> {
  if (!(await dockerAvailable())) {
    steps.push("Docker Engine not available");
    return false;
  }
  steps.push("Docker Engine OK");

  let info = await inspectContainer();
  if (!info.exists) {
    steps.push(`Container ${CONTAINER_NAME} missing — creating`);
    return recreateGrudachainContainer(steps);
  }

  if (info.exists && !info.portsPublished) {
    steps.push(
      `Container ${CONTAINER_NAME} exists but host port ${HOST_PORT} is not published — recreate required`,
    );
    return recreateGrudachainContainer(steps);
  }

  if (!info.running) {
    steps.push(`Starting stopped container ${CONTAINER_NAME}`);
    const start = await runDocker(["start", CONTAINER_NAME], 30_000);
    if (!start.ok) {
      steps.push(`docker start failed: ${start.stderr.slice(0, 200)}`);
      return recreateGrudachainContainer(steps);
    }
  } else {
    steps.push(`Container ${CONTAINER_NAME} already running with ports published`);
  }

  // Wait briefly for Ollama inside container
  for (let i = 0; i < 15; i++) {
    const h = await probeHealth(await getOllamaHost());
    if (h.ok) {
      steps.push(`Ollama healthy via Docker after ${i + 1} probe(s)`);
      return true;
    }
    await sleep(1000);
  }
  steps.push("Container up but Ollama not responding yet");
  return false;
}

async function ensureNativeServe(steps: string[]): Promise<boolean> {
  const bin = findNativeOllama();
  if (!bin) {
    steps.push("Native ollama.exe not found");
    return false;
  }
  steps.push(`Native Ollama found: ${bin}`);

  // If something already answers, don't spawn again
  const host = await getOllamaHost();
  const already = await probeHealth(host);
  if (already.ok) {
    steps.push("Endpoint already healthy (native or other)");
    return true;
  }

  if (nativeChild && !nativeChild.killed) {
    steps.push("Native ollama serve already spawned by Forge");
  } else {
    try {
      nativeChild = spawn(bin, ["serve"], {
        windowsHide: true,
        detached: false,
        stdio: "ignore",
        env: {
          ...process.env,
          OLLAMA_HOST: `127.0.0.1:${HOST_PORT}`,
        },
      });
      nativeChild.on("exit", (code) => {
        log.info(`[ollama] native serve exited code=${code}`);
        nativeChild = null;
      });
      nativeChild.on("error", (err) => {
        log.warn(`[ollama] native serve error: ${err.message}`);
        nativeChild = null;
      });
      steps.push("Spawned native `ollama serve`");
    } catch (e: unknown) {
      steps.push(`Failed to spawn native ollama: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  for (let i = 0; i < 20; i++) {
    const h = await probeHealth(host);
    if (h.ok) {
      steps.push(`Native Ollama healthy after ${i + 1} probe(s)`);
      return true;
    }
    await sleep(500);
  }
  steps.push("Native ollama serve started but not yet reachable");
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function probeHealth(host: string): Promise<{
  ok: boolean;
  latencyMs: number;
  version?: string;
  error?: string;
}> {
  const base = normalizeOllamaBaseUrl(host);
  const start = Date.now();
  try {
    const res = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) {
      return { ok: false, latencyMs: Date.now() - start, error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { version?: string };
    return { ok: true, latencyMs: Date.now() - start, version: body.version };
  } catch (e: unknown) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : "unreachable",
    };
  }
}

async function listModelNames(host: string): Promise<string[]> {
  const base = normalizeOllamaBaseUrl(host);
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

function matchInstalled(requested: string, installed: string[]): string | null {
  const want = requested.replace(/:latest$/i, "").toLowerCase();
  for (const have of installed) {
    const h = have.replace(/:latest$/i, "").toLowerCase();
    if (h === want || have.toLowerCase() === requested.toLowerCase()) return have;
  }
  return null;
}

async function pickDefaultModel(host: string): Promise<string> {
  const models = await listModelNames(host);
  for (const name of PREFERRED_LOCAL_MODELS) {
    const hit = matchInstalled(name, models);
    if (hit) return hit;
  }
  if (models.length) return models[0];
  return DEFAULT_MODEL;
}

/**
 * Ensure `grudge-dev` exists (Modelfile on llama3.2). Pulls llama3.2 if the store is empty.
 */
async function ensureGrudgeDevModel(
  host: string,
  steps: string[],
): Promise<void> {
  const models = await listModelNames(host);
  if (matchInstalled("grudge-dev", models)) {
    steps.push("grudge-dev already installed");
    return;
  }
  if (!matchInstalled("llama3.2", models)) {
    steps.push("No llama3.2 — pulling base weights");
    const pull = await pullModel("llama3.2");
    if (!pull.ok) {
      steps.push(`llama3.2 pull failed: ${pull.error ?? "unknown"}`);
      return;
    }
    steps.push("Pulled llama3.2");
  }
  steps.push("Creating grudge-dev from llama3.2 + Grudge system prompt");
  try {
    const res = await fetch(`${normalizeOllamaBaseUrl(host)}/api/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grudge-dev",
        from: "llama3.2",
        stream: false,
        parameters: { temperature: 0.3, num_ctx: 8192, top_p: 0.9 },
        system:
          "You are Grudge Dev, the local offline assistant for Grudge Studio. " +
          "Extend existing SSOT. Do not invent parallel systems. " +
          "Failover hop after Legion → fleet → Puter → BYOK. " +
          "SI 1m, loadRaceKit play meshes, one mixer, Railway player SSOT.",
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      steps.push(`grudge-dev create HTTP ${res.status}: ${t.slice(0, 180)}`);
      return;
    }
    steps.push("Created grudge-dev");
    setPreferredModel("grudge-dev");
  } catch (e: unknown) {
    steps.push(
      `grudge-dev create failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export async function ollamaHealth(): Promise<{
  ok: boolean;
  latencyMs: number;
  version?: string;
  error?: string;
}> {
  const host = await getOllamaHost();
  return probeHealth(host);
}

export async function ollamaModels(): Promise<Array<{ name: string; size?: number }>> {
  const host = await getOllamaHost();
  try {
    const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Ollama models: HTTP ${res.status}`);
    const data = (await res.json()) as { models?: Array<{ name: string; size?: number }> };
    return data.models ?? [];
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // Don't crash renderer IPC on bad host — return empty list
    log.warn(`[ollama] models failed host=${host}: ${msg}`);
    throw new Error(`Ollama models unavailable (${host}): ${msg}`);
  }
}

export async function ollamaChat(opts: {
  model?: string;
  messages: Array<{ role: string; content: string }>;
}): Promise<{ message: { content: string } }> {
  // Best-effort ensure when chat is requested and endpoint is down
  const pre = await ollamaHealth();
  if (!pre.ok) {
    await ensureRunning({ reason: "chat", agentic: false }).catch(() => null);
  }
  const host = await getOllamaHost();
  const model = opts.model || (await getPreferredModel()) || (await pickDefaultModel(host));
  const res = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: opts.messages, stream: false }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Ollama chat: ${res.status} — ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { message?: { content: string } };
  return { message: { content: data.message?.content ?? "" } };
}

export async function ollamaGenerate(opts: {
  model?: string;
  system?: string;
  prompt: string;
}): Promise<{ response: string }> {
  const pre = await ollamaHealth();
  if (!pre.ok) {
    await ensureRunning({ reason: "generate", agentic: false }).catch(() => null);
  }
  const host = await getOllamaHost();
  const model = opts.model || (await getPreferredModel()) || (await pickDefaultModel(host));
  const res = await fetch(`${host}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      system: opts.system,
      prompt: opts.prompt,
      stream: false,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Ollama generate: ${res.status} — ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { response?: string };
  return { response: data.response ?? "" };
}

export async function pullModel(model: string): Promise<{ ok: boolean; error?: string }> {
  const host = await getOllamaHost();
  try {
    const res = await fetch(`${host}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model, stream: false }),
      signal: AbortSignal.timeout(600_000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function openDownloadPage(): void {
  void shell.openExternal("https://ollama.com/download");
}

export async function getStatus(): Promise<OllamaRuntimeStatus> {
  if (lastStatus && Date.now() - (lastStatus as any)._at < 2000) {
    return lastStatus;
  }
  return buildStatus([]);
}

async function buildStatus(steps: string[]): Promise<OllamaRuntimeStatus> {
  const host = await getOllamaHost();
  const health = await probeHealth(host);
  const c: {
    exists: boolean;
    running: boolean;
    portsPublished: boolean;
    image?: string;
  } = await inspectContainer().catch(() => ({
    exists: false,
    running: false,
    portsPublished: false,
    image: undefined as string | undefined,
  }));
  const nativePath = findNativeOllama();
  const models = health.ok ? await listModelNames(host) : [];
  const preferredModel = (await getPreferredModel()) || DEFAULT_MODEL;
  const aiPref = await getAiPreference();

  let backend: OllamaBackend = "none";
  if (health.ok) {
    if (c.running && c.portsPublished) backend = "docker-grudachain";
    else if (nativeChild && !nativeChild.killed) backend = "native";
    else if (nativePath) backend = "external";
    else backend = "external";
  }

  const agenticReady = health.ok && models.length > 0;

  const status: OllamaRuntimeStatus = {
    ok: health.ok,
    host,
    version: health.version,
    latencyMs: health.latencyMs,
    backend,
    container: {
      name: CONTAINER_NAME,
      exists: c.exists,
      running: c.running,
      portsPublished: c.portsPublished,
      image: c.image,
    },
    nativePath,
    nativeRunning: Boolean(nativeChild && !nativeChild.killed),
    models,
    preferredModel,
    aiPref,
    agenticReady,
    steps,
    error: health.ok ? undefined : health.error,
  };
  (status as any)._at = Date.now();
  lastStatus = status;
  return status;
}

export interface EnsureOpts {
  reason?: string;
  /** When true (admin / grudachain), prefer Ollama, pull default model if empty */
  agentic?: boolean;
  username?: string;
  email?: string;
}

/**
 * Ensure the Grudgechain Ollama agentic stack is reachable.
 * Idempotent; concurrent callers share one in-flight promise.
 */
export async function ensureRunning(opts: EnsureOpts = {}): Promise<OllamaRuntimeStatus> {
  if (ensureInFlight) return ensureInFlight;
  ensureInFlight = doEnsure(opts).finally(() => {
    ensureInFlight = null;
  });
  return ensureInFlight;
}

async function doEnsure(opts: EnsureOpts): Promise<OllamaRuntimeStatus> {
  const steps: string[] = [];
  const reason = opts.reason ?? "manual";
  steps.push(`ensureRunning reason=${reason}`);

  const admin =
    opts.agentic === true ||
    isCanonicalAdmin({ username: opts.username, email: opts.email });

  if (admin) {
    setAiPreference("ollama");
    steps.push("Admin/grudachain → AI preference = ollama");
  }

  // Always pin host to local Grudgechain endpoint unless user overrode permanently
  const host = await getOllamaHost();
  if (!host.includes("localhost") && !host.includes("127.0.0.1")) {
    steps.push(`Non-local host configured (${host}) — probing only`);
  }

  let health = await probeHealth(host);
  if (health.ok) {
    steps.push(`Already healthy (${health.latencyMs}ms, v${health.version ?? "?"})`);
  } else {
    steps.push(`Unreachable: ${health.error ?? "unknown"} — bringing stack up`);
    // Prefer Docker GRUDACHAIN (named agentic container)
    const dockerOk = await ensureDockerGrudachain(steps);
    health = await probeHealth(host);
    if (!health.ok && !dockerOk) {
      await ensureNativeServe(steps);
      health = await probeHealth(host);
    } else if (!health.ok) {
      // Docker path partially worked; still try native as fallback
      await ensureNativeServe(steps);
      health = await probeHealth(host);
    }
  }

  if (health.ok && admin) {
    await ensureGrudgeDevModel(host, steps);
    const models = await listModelNames(host);
    const pref = await getPreferredModel();
    const prefHit = pref ? matchInstalled(pref, models) : null;
    if (!prefHit) {
      const picked = await pickDefaultModel(host);
      setPreferredModel(picked);
      steps.push(`Preferred model set to ${picked}`);
    }
  }

  const status = await buildStatus(steps);
  log.info(
    `[ollama] ensure done ok=${status.ok} backend=${status.backend} agentic=${status.agenticReady} steps=${steps.length}`,
  );
  return status;
}

/**
 * Called after successful Puter login — plugs in agentic systems for grudachain admins.
 */
export async function onAdminSignedIn(user: {
  username?: string;
  email?: string;
}): Promise<OllamaRuntimeStatus | null> {
  if (!isCanonicalAdmin(user)) {
    log.info(`[ollama] sign-in ${user.username ?? "?"} is not admin — skip agentic ensure`);
    return null;
  }
  log.info(`[ollama] grudachain/admin sign-in — ensuring GRUDACHAIN Ollama agentic stack`);
  return ensureRunning({
    reason: "admin-signin",
    agentic: true,
    username: user.username,
    email: user.email,
  });
}

export function shutdown(): void {
  if (nativeChild && !nativeChild.killed) {
    try {
      nativeChild.kill();
    } catch {
      /* ignore */
    }
    nativeChild = null;
  }
  // Do not stop the Docker GRUDACHAIN container on quit — it is a shared agentic service.
  log.info("[ollama] shutdown (native child stopped; Docker GRUDACHAIN left running)");
}

export function getLastStatus(): OllamaRuntimeStatus | null {
  return lastStatus;
}
