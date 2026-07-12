import { BrowserWindow, net } from "electron";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import log from "./logger";

/**
 * Forge3D file-open bridge.
 *
 * Two ways the user can open a model file with our app:
 *   1. Double-click in Explorer (cold start)  → app.argv contains the path
 *   2. Double-click while we're already running (second-instance) → we get
 *      the new argv via app.on("second-instance")
 *
 * In both cases we stash the path in `pendingPath` until the renderer asks
 * for it via `forge:consumeInitialFile`, OR if the renderer is already
 * mounted we send `forge:openFile` directly.
 */

const SUPPORTED_EXTS = new Set([".glb", ".gltf", ".obj", ".fbx", ".stl", ".ply", ".dae", ".3mf"]);
const ALLOWED_REMOTE_HOSTS = /(^|\.)(grudge-studio\.com|grudgewarlords\.com|localhost)$/i;

export interface ForgeOpenPayload {
  path: string;
  name: string;
  /** CDN/disk directory URL for resolving relative textures (trailing slash). */
  resourceBaseUrl?: string;
}

let pendingOpen: ForgeOpenPayload | null = null;

/** Return the first supported model path in argv, or null. */
export function findModelArg(argv: string[]): string | null {
  // argv[0] is the executable, argv[1+] is what the user/OS passed in.
  // In dev (electron .) argv[1] is "." — skip that.
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a || a.startsWith("--")) continue;
    if (a === ".") continue;
    const ext = extname(a).toLowerCase();
    if (SUPPORTED_EXTS.has(ext)) return a;
  }
  return null;
}

/** Called once at startup: capture initial argv. */
function resourceBaseFromUrl(url: string): string {
  const u = new URL(url);
  const dir = u.pathname.slice(0, u.pathname.lastIndexOf("/") + 1);
  return `${u.origin}${dir}`;
}

function resourceBaseFromPath(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash + 1) : "";
  if (/^[a-zA-Z]:/.test(dir)) return `file:///${dir}`;
  if (dir.startsWith("/")) return `file://${dir}`;
  return `file:///${dir}`;
}

function openPayload(path: string, resourceBaseUrl?: string): ForgeOpenPayload {
  return {
    path,
    name: basename(path),
    resourceBaseUrl: resourceBaseUrl ?? resourceBaseFromPath(path),
  };
}

export function captureInitialArgv(): void {
  const path = findModelArg(process.argv);
  if (path) {
    pendingOpen = openPayload(path);
    log.info("Forge: captured initial file from argv:", path);
  }
}

/** Called from second-instance handler. */
export function captureSecondInstanceArgv(argv: string[], mainWindow: BrowserWindow | null): void {
  const path = findModelArg(argv);
  if (!path) return;
  log.info("Forge: second-instance file:", path);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("forge:openFile", openPayload(path));
    mainWindow.webContents.send("nav", "/assets-3d");
  } else {
    pendingOpen = openPayload(path);
  }
}

/** Renderer asks once at mount whether we have a pending file from cold-start. */
export function consumeInitialFile(): ForgeOpenPayload | null {
  if (!pendingOpen) return null;
  const out = pendingOpen;
  pendingOpen = null;
  return out;
}

export interface ReadFileResult {
  name: string;
  bytes: Uint8Array;
  mime: string;
  size: number;
}

const MIME_BY_EXT: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".obj": "model/obj",
  ".fbx": "application/octet-stream",
  ".stl": "model/stl",
  ".ply": "application/octet-stream",
  ".dae": "model/vnd.collada+xml",
  ".3mf": "model/3mf",
};

/** Accept a path string or `{ path }` from older renderer builds. */
export function resolveModelPath(input: unknown): string {
  if (typeof input === "string" && input.trim()) return input.trim();
  if (input && typeof input === "object" && "path" in input) {
    const p = (input as { path?: unknown }).path;
    if (typeof p === "string" && p.trim()) return p.trim();
  }
  throw new Error("forge:readFile requires a file path string");
}

export async function readModelFile(pathOrObj: unknown): Promise<ReadFileResult> {
  const path = resolveModelPath(pathOrObj);
  const ext = extname(path).toLowerCase();
  if (!SUPPORTED_EXTS.has(ext)) throw new Error(`Unsupported extension: ${ext}`);
  const data = await readFile(path);
  return {
    name: basename(path),
    bytes: data,
    mime: MIME_BY_EXT[ext] ?? "application/octet-stream",
    size: data.byteLength,
  };
}

function validateRemoteUrl(url: string): URL {
  const u = new URL(url);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && u.hostname === "localhost")) {
    throw new Error("Only HTTPS model URLs are allowed");
  }
  if (!ALLOWED_REMOTE_HOSTS.test(u.hostname)) {
    throw new Error(`Remote host not allowed: ${u.hostname}`);
  }
  const ext = extname(u.pathname).toLowerCase();
  if (!SUPPORTED_EXTS.has(ext)) throw new Error(`Unsupported model extension: ${ext || "(none)"}`);
  return u;
}

function downloadUrl(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const req = net.request({ method: "GET", url });
    req.on("response", (res) => {
      const code = res.statusCode ?? 0;
      if (code >= 400) {
        reject(new Error(`HTTP ${code} fetching model`));
        return;
      }
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

function deliverToForge(mainWindow: BrowserWindow | null, payload: ForgeOpenPayload): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("forge:openFile", payload);
    // Assets → 3D Studio (local viewer), not Full Forge webview
    mainWindow.webContents.send("nav", "/assets-3d");
  } else {
    pendingOpen = payload;
  }
}

/** Open a local model file in Forge 3D (Asset Library, Upload pipeline, Browser). */
export function openLocalModel(path: string, mainWindow: BrowserWindow | null): ForgeOpenPayload {
  const ext = extname(path).toLowerCase();
  if (!SUPPORTED_EXTS.has(ext)) throw new Error(`Unsupported model extension: ${ext}`);
  const payload = openPayload(path);
  log.info("Forge: opening local model:", path);
  deliverToForge(mainWindow, payload);
  return payload;
}

/** Download a public CDN model and open it in Forge 3D (used by GrudgeLoader / Browser). */
export async function openRemoteModel(url: string, mainWindow: BrowserWindow | null): Promise<{ path: string; name: string }> {
  const u = validateRemoteUrl(url);
  const data = await downloadUrl(u.href);
  const dir = await mkdtemp(join(tmpdir(), "grudge-forge-"));
  const name = basename(u.pathname) || "model.glb";
  const path = join(dir, name);
  await writeFile(path, data);
  log.info("Forge: opened remote model:", u.href, "→", path);

  const payload = openPayload(path, resourceBaseFromUrl(u.href));
  deliverToForge(mainWindow, payload);
  return { path, name };
}

/** When the main window is created and the user already had a pending file, push it. */
export function flushPendingTo(mainWindow: BrowserWindow): void {
  if (!pendingOpen) return;
  const payload = pendingOpen;
  pendingOpen = null;
  // Wait for renderer to be ready, then deliver.
  mainWindow.webContents.once("did-finish-load", () => {
    mainWindow.webContents.send("forge:openFile", payload);
    mainWindow.webContents.send("nav", "/assets-3d");
  });
  // If it has already loaded by the time we get here (rare), fire immediately too.
  if (!mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send("forge:openFile", payload);
    mainWindow.webContents.send("nav", "/assets-3d");
  }
}
