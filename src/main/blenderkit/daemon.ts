import { spawn, ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import keytar from "keytar";
import { detectBlenderKit } from "../ingestion/toolchain";

/**
 * BlenderKit-Client daemon wrapper.
 *
 * BlenderKit ships a localhost HTTP daemon under `<addon>/client/v1.X/`.
 * We detect or spawn it, then call its REST endpoints with our API key.
 *
 * Reference (from client_lib.py):
 *   GET  http://127.0.0.1:<port>/v1.X/report           — task polling
 *   POST http://127.0.0.1:<port>/v1.X/blender/asset_search
 *   POST http://127.0.0.1:<port>/v1.X/blender/asset_download
 *
 * The daemon picks ports from a tried list; we test them in order.
 */

// Same defaults BlenderKit uses; first one is the canonical port.
const DEFAULT_PORTS = ["62485", "65425", "55428", "49452", "35452", "25152", "5152", "1234"];

// API path prefix; client_lib.get_api_version() drops the trailing patch (1.8.x → "v1.8").
// Derived from the on-disk addon manifest so we track BlenderKit upgrades
// automatically; falls back to v1.8 when the manifest read fails.
const FALLBACK_API_PREFIX = "v1.8";
function apiPrefix(): string {
  const v = readAddonVersion();
  if (v && v !== "unknown") {
    const m = v.match(/^(\d+)\.(\d+)/);
    if (m) return `v${m[1]}.${m[2]}`;
  }
  return FALLBACK_API_PREFIX;
}

const SERVICE = "grudge-dev-tool";
const KEY_NAME = "blenderkit-api-key";

let spawnedProc: ChildProcess | null = null;
let cachedPort: string | null = null;
let cachedAddonVersion: string | null = null;

function readAddonVersion(): string {
  if (cachedAddonVersion) return cachedAddonVersion;
  const status = detectBlenderKit();
  if (status.available && status.path) {
    try {
      const manifest = readFileSync(join(status.path, "blender_manifest.toml"), "utf8");
      const m = manifest.match(/version\s*=\s*"([^"]+)"/);
      if (m) {
        cachedAddonVersion = m[1];
        return cachedAddonVersion;
      }
    } catch { /* ignore */ }
  }
  cachedAddonVersion = "unknown";
  return cachedAddonVersion;
}

export async function getApiKey(): Promise<string | null> {
  const stored = await keytar.getPassword(SERVICE, KEY_NAME);
  return stored || process.env.BLENDERKIT_API_KEY || null;
}

export async function setApiKey(key: string): Promise<void> {
  await keytar.setPassword(SERVICE, KEY_NAME, key);
}

export async function clearApiKey(): Promise<void> {
  await keytar.deletePassword(SERVICE, KEY_NAME);
}

/** Find the daemon binary that ships with the addon (Windows only for now). */
function findDaemonBinary(): string | null {
  const status = detectBlenderKit();
  if (!status.available || !status.path) return null;
  const clientDir = join(status.path, "client");
  if (!existsSync(clientDir)) return null;

  // Newest version subdir wins (e.g. "v1.8.3").
  const subs = readdirSync(clientDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("v"))
    .map((d) => d.name)
    .sort()
    .reverse();
  if (subs.length === 0) return null;
  const versionDir = join(clientDir, subs[0]);

  // Common names BlenderKit-Client builds use.
  const candidates = [
    "blenderkit-client-windows-x64.exe",
    "blenderkit-client-windows.exe",
    "blenderkit-client.exe",
  ];
  for (const c of candidates) {
    const p = join(versionDir, c);
    if (existsSync(p)) return p;
  }
  // Fallback: pick any .exe in the dir.
  const exes = readdirSync(versionDir).filter((f) => f.toLowerCase().endsWith(".exe"));
  return exes.length > 0 ? join(versionDir, exes[0]) : null;
}

async function isDaemonOn(port: string): Promise<boolean> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/${apiPrefix()}/report`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(400),
      // The daemon's /report endpoint expects a body, but it should still respond
      // 400/401/200 if the daemon is alive (vs ECONNREFUSED if not).
    });
    return resp.status < 500;
  } catch {
    return false;
  }
}

export async function discoverPort(): Promise<string | null> {
  if (cachedPort && (await isDaemonOn(cachedPort))) return cachedPort;
  for (const port of DEFAULT_PORTS) {
    if (await isDaemonOn(port)) {
      cachedPort = port;
      return port;
    }
  }
  return null;
}

export async function ensureDaemon(): Promise<{ port: string; spawned: boolean } | null> {
  const found = await discoverPort();
  if (found) return { port: found, spawned: false };

  const bin = findDaemonBinary();
  if (!bin) return null;

  // Start the daemon, attach a clean shutdown path.
  spawnedProc = spawn(bin, [], { windowsHide: true, detached: false });
  spawnedProc.on("exit", (code) => {
    console.log(`[blenderkit-daemon] exited with code ${code}`);
    spawnedProc = null;
    cachedPort = null;
  });

  // Poll for liveness up to ~5s.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const port = await discoverPort();
    if (port) return { port, spawned: true };
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

export function shutdownSpawned(): void {
  if (spawnedProc && !spawnedProc.killed) {
    spawnedProc.kill();
    spawnedProc = null;
  }
}

interface BkRequestBase {
  app_id?: number;
  api_key?: string;
  addon_version?: string;
  platform_version?: string;
}

async function postDaemon<T>(endpoint: string, payload: BkRequestBase & Record<string, any>): Promise<T> {
  const ready = await ensureDaemon();
  if (!ready) throw new Error("BlenderKit daemon not available (binary not found or failed to start).");

  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("BlenderKit API key not set. Use Settings or BLENDERKIT_API_KEY env var.");

  const body = {
    app_id: process.pid,
    api_key: apiKey,
    addon_version: readAddonVersion(),
    platform_version: process.platform,
    ...payload,
  };

  const url = `http://127.0.0.1:${ready.port}/${apiPrefix()}${endpoint}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`BlenderKit daemon ${endpoint} ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface BkSearchOptions {
  query: string;
  asset_type?: "model" | "material" | "brush" | "hdr" | "scene";
  page_size?: number;
  page?: number;
}

export interface BkSearchResult {
  task_id?: string;
  results?: Array<{
    id: string;
    name: string;
    assetType: string;
    thumbnail?: string;
    description?: string;
    [key: string]: any;
  }>;
  [key: string]: any;
}

export async function searchAssets(opts: BkSearchOptions): Promise<BkSearchResult> {
  const tokens: string[] = [opts.query];
  if (opts.asset_type) tokens.push(`asset_type:${opts.asset_type}`);
  const urlquery = tokens.join("+");
  const payload = {
    urlquery,
    asset_type: opts.asset_type ?? "model",
    page_size: opts.page_size ?? 24,
    page: opts.page ?? 1,
  };
  return postDaemon<BkSearchResult>("/blender/asset_search", payload);
}

export interface BkDownloadOptions {
  asset_id: string;
  asset_base_id?: string;
  resolution?: "blend" | "1k" | "2k" | "4k" | "8k";
  download_dir: string;
}

export async function downloadAsset(opts: BkDownloadOptions): Promise<{ task_id: string }> {
  const payload = {
    asset_id: opts.asset_id,
    asset_base_id: opts.asset_base_id,
    resolution: opts.resolution ?? "2k",
    download_dir: opts.download_dir,
  };
  return postDaemon<{ task_id: string }>("/blender/asset_download", payload);
}

export async function getReport(): Promise<any> {
  const ready = await ensureDaemon();
  if (!ready) throw new Error("daemon not available");
  const apiKey = await getApiKey();
  const resp = await fetch(`http://127.0.0.1:${ready.port}/${apiPrefix()}/report`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: process.pid, api_key: apiKey || "" }),
  });
  return resp.json();
}
