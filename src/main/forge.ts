import { BrowserWindow, net } from "electron";
import { mkdtemp, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import log from "./logger";

/**
 * Forge3D file-open bridge (explicit in-app Forge tools only).
 *
 * OS double-click / "Open with" is owned by `openFileBridge.ts` → elite
 * Asset Viewer. Do NOT route Explorer opens here.
 *
 * Pending path is only for: session handoffs, Send to Forge from viewer,
 * and forge:consumeInitialFile when Local Files explicitly chooses Forge.
 */

const SUPPORTED_EXTS = new Set([
  ".glb",
  ".gltf",
  ".obj",
  ".fbx",
  ".stl",
  ".ply",
  ".dae",
  ".3mf",
  ".json", // .gfscene.json (scene graph — loaded when renderer supports it)
  ".gfscene",
]);
const ALLOWED_REMOTE_HOSTS = /(^|\.)(grudge-studio\.com|grudgewarlords\.com|localhost)$/i;

let pendingPath: string | null = null;

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
export function captureInitialArgv(): void {
  const path = findModelArg(process.argv);
  if (path) {
    pendingPath = path;
    log.info("Forge: captured initial file from argv:", path);
  }
}

/**
 * @deprecated OS second-instance opens use openFileBridge (elite viewer).
 * Kept for any legacy caller that still wants Forge-only model open.
 */
export function captureSecondInstanceArgv(argv: string[], mainWindow: BrowserWindow | null): void {
  log.warn("[forge] captureSecondInstanceArgv is legacy — OS opens go to openFileBridge");
  const path = findModelArg(argv);
  if (!path) return;
  // Stash only — do not auto-nav to Forge
  pendingPath = path;
  if (mainWindow && !mainWindow.isDestroyed()) {
    log.info("Forge: stashed model path (explicit Forge consume only):", path);
  }
}

/** Renderer asks once at mount whether we have a pending file from cold-start. */
export function consumeInitialFile(): { path: string; name: string } | null {
  if (!pendingPath) return null;
  const out = { path: pendingPath, name: basename(pendingPath) };
  pendingPath = null;
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

/** Write exported bytes to a temp file (for ingest / fleet deploy). */
export async function writeTempModelFile(name: string, bytes: Uint8Array): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "grudge-forge-export-"));
  const safe = basename(name) || "export.glb";
  const path = join(dir, safe);
  await writeFile(path, bytes);
  log.info("Forge: wrote temp export:", path);
  return path;
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

/** Download a public CDN model and open it in Forge 3D (used by GrudgeLoader / Browser). */
export async function openRemoteModel(url: string, mainWindow: BrowserWindow | null): Promise<{ path: string; name: string }> {
  const u = validateRemoteUrl(url);
  const data = await downloadUrl(u.href);
  const dir = await mkdtemp(join(tmpdir(), "grudge-forge-"));
  const name = basename(u.pathname) || "model.glb";
  const path = join(dir, name);
  await writeFile(path, data);
  log.info("Forge: opened remote model:", u.href, "→", path);

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("forge:openFile", { path, name });
    // Local tools page (Forge3D) — not the production Forge webview
    mainWindow.webContents.send("nav", "/forge-local");
  } else {
    pendingPath = path;
  }
  return { path, name };
}

const IMAGE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tga", ".gif", ".ktx2", ".basis",
]);
const TEXTURE_DIR_NAMES = new Set([
  // Kenney / Unity / Blender common (case variants for non-Windows CI)
  "textures", "Textures", "texture", "Texture",
  "maps", "Maps", "map", "Map",
  "materials", "Materials", "material", "Material", "mat", "Mat",
  "pbr", "PBR", "images", "Images", "image", "tex", "Tex",
  "sourceimages", "SourceImages", "source_images", "Source_Images",
  // glTF sidecar next to GLB
  "glTF", "gltf",
]);

export interface SiblingTextureHit {
  path: string;
  name: string;
  /** Directory relative hint for scoring */
  dir: string;
}

/**
 * Find texture image files next to a model (same folder) and at pack roots.
 * Walks up a few parents and peeks into common texture folder names.
 */
export async function listSiblingTextures(modelPathInput: unknown): Promise<{
  modelPath: string;
  modelDir: string;
  files: SiblingTextureHit[];
  searchDirs: string[];
}> {
  const modelPath = resolve(resolveModelPath(modelPathInput));
  const modelDir = dirname(modelPath);
  const searchDirs: string[] = [];
  const seen = new Set<string>();
  const files: SiblingTextureHit[] = [];

  const addDir = (d: string) => {
    const abs = resolve(d);
    if (seen.has(abs.toLowerCase())) return;
    seen.add(abs.toLowerCase());
    searchDirs.push(abs);
  };

  // Same folder as asset
  addDir(modelDir);
  // Common subfolders of same dir
  for (const name of TEXTURE_DIR_NAMES) {
    addDir(join(modelDir, name));
  }

  // Walk up (pack root often holds shared textures/)
  let cur = modelDir;
  for (let up = 0; up < 4; up++) {
    const parent = dirname(cur);
    if (!parent || parent === cur) break;
    addDir(parent);
    for (const name of TEXTURE_DIR_NAMES) {
      addDir(join(parent, name));
    }
    cur = parent;
  }

  for (const dir of searchDirs) {
    try {
      const st = await stat(dir);
      if (!st.isDirectory()) continue;
      const entries = await readdir(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isFile()) continue;
        const ext = extname(ent.name).toLowerCase();
        if (!IMAGE_EXTS.has(ext)) continue;
        files.push({
          path: join(dir, ent.name),
          name: ent.name,
          dir,
        });
      }
    } catch {
      /* skip unreadable */
    }
  }

  log.info(
    `[forge] sibling textures for ${basename(modelPath)}: ${files.length} images in ${searchDirs.length} dirs`,
  );
  return { modelPath, modelDir, files, searchDirs };
}

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".tga": "image/targa",
};

/** Read a local image for renderer TextureLoader (base64 data URL). */
export async function readLocalImage(pathInput: unknown): Promise<{
  path: string;
  name: string;
  mime: string;
  dataUrl: string;
  size: number;
}> {
  const path = resolve(typeof pathInput === "string" ? pathInput : resolveModelPath(pathInput));
  const ext = extname(path).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) throw new Error(`Not an image: ${ext}`);
  const data = await readFile(path);
  const mime = IMAGE_MIME[ext] ?? "application/octet-stream";
  // TGA not browser-native — still return base64; TextureLoader may fail, skip later
  const b64 = data.toString("base64");
  return {
    path,
    name: basename(path),
    mime,
    dataUrl: `data:${mime};base64,${b64}`,
    size: data.byteLength,
  };
}

export function fileUrlForPath(diskPath: string): string {
  return pathToFileURL(resolve(diskPath)).href;
}

/** When the main window is created and the user already had a pending file, push it. */
/**
 * @deprecated OS cold-start uses openFileBridge.flushPendingTo → elite viewer.
 * This no longer auto-opens Forge.
 */
export function flushPendingTo(_mainWindow: BrowserWindow): void {
  // Intentionally a no-op for OS open. Use openFileBridge.flushPendingTo.
  if (pendingPath) {
    log.info(
      "[forge] flushPendingTo ignored for OS open (elite viewer owns it). pending=",
      pendingPath,
    );
  }
}
