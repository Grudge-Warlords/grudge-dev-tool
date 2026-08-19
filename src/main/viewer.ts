/**
 * Pop-out Asset Viewer windows.
 *
 * Opens always-on-top BrowserWindows (viewer.html) in front of every other
 * app window so folder clicks from GrudgeLoader / Browser can preview models,
 * images, audio, text, and Three.js-ready assets with transform + Forge actions.
 */

import { app, BrowserWindow, dialog, nativeImage, net, shell } from "electron";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, copyFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, normalize, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import log from "./logger";
import * as forge from "./forge";
import { convertFile, verifyFile } from "./ingestion";
import {
  convertImageFile,
  inspectImage,
  isConvertibleImagePath,
  type ImageOutFormat,
  type ImageConvertResult,
  type ImageMeta,
} from "./ingestion/imageConvert";
import { optimizeWebFile, type OptimizeWebOptions, type OptimizeWebResult } from "./ingestion/optimizeWeb";
import { requestUploadUrl } from "./api";
import { r2PublicUrl } from "./cf/r2Direct";
import { mediaStreamUrl, isStreamableMediaPath } from "./mediaProtocol";
import { inferContentType } from "../shared/mediaTypes";
import { localLoopbackAssetUrl, threeflowAssetUrl } from "../shared/editorHandoff";

export interface ViewerAssetRef {
  name: string;
  url: string;
  contentType: string;
  size: number;
  /**
   * Absolute disk path for local assets. When set, the viewer window reads
   * bytes via IPC and builds a blob: URL (blob URLs cannot cross windows).
   * url may be a placeholder `local://…` or streaming `grudge-media://…`.
   */
  localPath?: string;
  /** True when url is a streaming media protocol (video/audio) */
  stream?: boolean;
  /** Original path before PSD/BLEND auto-prepare */
  sourcePath?: string;
  /** e.g. psd | blend — shown in viewer chrome */
  sourceFormat?: string;
  /** Human-readable prepare note (layer count, convert path, …) */
  prepareNote?: string;
}

const assetStore = new Map<string, ViewerAssetRef>();
const openWindows = new Map<string, BrowserWindow>();

const VIEWER_WIDTH = 1100;
const VIEWER_HEIGHT = 720;

function viewerIconPath(): string {
  const candidates = [
    join(process.resourcesPath ?? "", "icon-256.png"),
    join(__dirname, "..", "..", "resources", "icon-256.png"),
    join(__dirname, "..", "..", "..", "resources", "icon-256.png"),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return candidates[candidates.length - 1];
}

function viewerHtmlUrl(token: string): string {
  if (!app.isPackaged) {
    return `http://localhost:5173/viewer.html#${token}`;
  }
  return `file://${join(__dirname, "..", "renderer", "viewer.html")}#${token}`;
}

function newToken(): string {
  return randomBytes(12).toString("hex");
}

function normalizeAsset(raw: unknown): ViewerAssetRef {
  if (!raw || typeof raw !== "object") throw new Error("viewer:open requires an asset object");
  const a = raw as Record<string, unknown>;
  const localPath =
    typeof a.localPath === "string" && a.localPath.trim() ? a.localPath.trim() : undefined;
  const name =
    typeof a.name === "string" && a.name
      ? a.name
      : localPath
        ? basename(localPath)
        : "";
  let url = typeof a.url === "string" ? a.url : "";

  // Local disk: stream media (mp4…) or placeholder for blob resolve
  if (localPath) {
    const stream =
      a.stream === true ||
      isStreamableMediaPath(name || basename(localPath)) ||
      (typeof url === "string" && url.startsWith("grudge-media:"));
    if (stream) {
      url = url.startsWith("grudge-media:") ? url : mediaStreamUrl(localPath);
    } else if (!url || url.startsWith("file:") || url.startsWith("local:")) {
      url = `local://${encodeURIComponent(localPath.replace(/\\/g, "/"))}`;
    }
    return {
      name: name || basename(localPath),
      url,
      contentType: typeof a.contentType === "string" ? a.contentType : "",
      size: typeof a.size === "number" && Number.isFinite(a.size) ? a.size : 0,
      localPath,
      stream,
      sourcePath: typeof a.sourcePath === "string" ? a.sourcePath : undefined,
      sourceFormat: typeof a.sourceFormat === "string" ? a.sourceFormat : undefined,
      prepareNote: typeof a.prepareNote === "string" ? a.prepareNote : undefined,
    };
  }

  if (!name || !url) throw new Error("viewer:open requires asset.name and asset.url (or localPath)");
  try {
    const u = new URL(url);
    if (
      u.protocol !== "https:" &&
      !(u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) &&
      u.protocol !== "blob:" &&
      u.protocol !== "local:" &&
      u.protocol !== "grudge-media:"
    ) {
      throw new Error("Only http(s), blob, grudge-media, or local asset URLs are allowed");
    }
  } catch (e: any) {
    if (e?.message?.includes("Only http") || e?.message?.includes("Only http(s)")) throw e;
    throw new Error(`Invalid asset URL: ${url}`);
  }
  return {
    name,
    url,
    contentType: typeof a.contentType === "string" ? a.contentType : "",
    size: typeof a.size === "number" && Number.isFinite(a.size) ? a.size : 0,
  };
}

/**
 * Pop-out ThreeFlow scene editor (save / multi-mesh / small edits).
 * CDN URL or local mesh via loopback plugin host (`/v1/local-file/<name>?path=`).
 * Local Files 3D opens here — Elite is images / audio / video / text / PDF.
 */
export function openThreeFlowEditor(opts: {
  name: string;
  cdnUrl?: string;
  localPath?: string;
}): { ok: true; url: string } {
  let assetUrl = "";
  if (opts.cdnUrl && /^https?:\/\//i.test(opts.cdnUrl) && !opts.cdnUrl.startsWith("blob:")) {
    assetUrl = opts.cdnUrl;
  } else if (opts.localPath) {
    assetUrl = localLoopbackAssetUrl(opts.localPath);
  }
  if (!assetUrl) throw new Error("ThreeFlow needs a CDN URL or local mesh path");

  const href = threeflowAssetUrl(assetUrl, { name: opts.name });
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 520,
    show: false,
    frame: true,
    autoHideMenuBar: true,
    backgroundColor: "#0a0e1a",
    title: `${basename(opts.name)} — ThreeFlow`,
    alwaysOnTop: true,
    skipTaskbar: false,
    icon: nativeImage.createFromPath(viewerIconPath()),
    webPreferences: {
      preload: join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.once("ready-to-show", () => {
    win.show();
    win.focus();
    win.moveTop();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    } catch {
      /* ignore */
    }
    return { action: "deny" };
  });
  void win.loadURL(href);
  log.info("ThreeFlow pop-out", opts.name, href.slice(0, 120));
  return { ok: true, url: href };
}

/** Open pop-out viewer for a file on disk (Local Files / Explorer — not Forge). */
export async function openLocalPath(
  filePath: string,
  meta?: { contentType?: string; size?: number },
  parent?: BrowserWindow | null,
): Promise<{ ok: true; token: string }> {
  const { needsAutoPrepare, prepareForEliteViewer } = await import("./ingestion/designPreview");

  let openPath = filePath;
  let sourcePath: string | undefined;
  let sourceFormat: string | undefined;
  let prepareNote: string | undefined;

  // PSD → PNG composite · BLEND → GLB (Blender) so Image/Three viewers can load
  if (needsAutoPrepare(filePath)) {
    log.info("[viewer] auto-prepare", basename(filePath));
    const prep = await prepareForEliteViewer(filePath);
    if (prep.ok && prep.path) {
      openPath = prep.path;
      sourcePath = filePath;
      sourceFormat = prep.sourceFormat;
      prepareNote = prep.note;
    } else {
      log.warn("[viewer] prepare failed, opening original", prep.error);
      prepareNote = prep.error || "Preview prepare failed — try system app or Convert";
      sourcePath = filePath;
      sourceFormat = prep.sourceFormat;
    }
  }

  const name = basename(openPath);
  const contentType = meta?.contentType || inferContentType(name);
  let size = meta?.size ?? 0;
  try {
    if (!size && existsSync(openPath)) size = (await stat(openPath)).size;
  } catch {
    /* optional */
  }

  // Video/audio (mp4, webm, mov, mp3…) → stream protocol so double-click
  // works on large files without loading the whole MP4 into RAM.
  const stream = isStreamableMediaPath(name);
  const url = stream
    ? mediaStreamUrl(openPath)
    : `local://${encodeURIComponent(openPath.replace(/\\/g, "/"))}`;

  // Display name keeps original DCC name when we prepared a preview
  const displayName = sourcePath
    ? sourcePath.replace(/\\/g, "/")
    : openPath.replace(/\\/g, "/");

  return openViewer(
    {
      name: displayName,
      url,
      contentType,
      size,
      localPath: openPath,
      stream,
      sourcePath,
      sourceFormat,
      prepareNote,
    },
    parent,
  );
}

/** Open an always-on-top viewer window for the given asset (independent of parent so it can float above Loader + main). */
export function openViewer(raw: unknown, _parent?: BrowserWindow | null): { ok: true; token: string } {
  const asset = normalizeAsset(raw);
  const token = newToken();
  assetStore.set(token, asset);

  const win = new BrowserWindow({
    width: VIEWER_WIDTH,
    height: VIEWER_HEIGHT,
    minWidth: 640,
    minHeight: 420,
    show: false,
    frame: true,
    autoHideMenuBar: true,
    backgroundColor: "#0a0e1a",
    title: `${basename(asset.name)} — Grudge Elite Viewer`,
    alwaysOnTop: true,
    skipTaskbar: false,
    icon: nativeImage.createFromPath(viewerIconPath()),
    // No parent: must stay free-floating above GrudgeLoader and the main shell.
    webPreferences: {
      preload: join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Highest practical level so the viewer sits above the main app, Forge, and GrudgeLoader.
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  openWindows.set(token, win);

  win.once("ready-to-show", () => {
    win.show();
    win.focus();
    win.moveTop();
  });

  win.on("closed", () => {
    openWindows.delete(token);
    // Keep asset a short while in case of reload; drop after 60s.
    setTimeout(() => assetStore.delete(token), 60_000);
  });

  // Navigation lockdown — stay on viewer.html / localhost / grudge CDN hosts only.
  win.webContents.on("will-navigate", (event, url) => {
    try {
      const u = new URL(url);
      if (u.protocol === "file:" && u.pathname.endsWith("viewer.html")) return;
      if (u.protocol === "http:" && u.hostname === "localhost") return;
      if (u.protocol === "https:" && /(^|\.)grudge-studio\.com$/.test(u.hostname)) return;
      if (u.protocol === "https:" && /(^|\.)vercel\.app$/.test(u.hostname)) return;
      if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return;
    } catch { /* deny */ }
    event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === "https:" || u.protocol === "http:") shell.openExternal(url);
    } catch { /* ignore */ }
    return { action: "deny" };
  });

  if (!app.isPackaged) {
    win.loadURL(viewerHtmlUrl(token));
  } else {
    win.loadFile(join(__dirname, "..", "renderer", "viewer.html"), { hash: token });
  }

  log.info("Viewer: opened", asset.name, "token=", token.slice(0, 8));
  return { ok: true, token };
}

export function getViewerAsset(token: string): ViewerAssetRef | null {
  if (!token || typeof token !== "string") return null;
  return assetStore.get(token) ?? null;
}

/** Download CDN model → open in main Forge 3D editor. */
export async function sendToForge(
  args: { url: string; name?: string },
  mainWindow: BrowserWindow | null,
): Promise<{ ok: true; path: string; name: string } | { ok: false; error: string }> {
  try {
    if (!args?.url) return { ok: false, error: "Missing model URL" };
    const result = await forge.openRemoteModel(args.url, mainWindow);
    return { ok: true, ...result };
  } catch (e: any) {
    log.error("Viewer sendToForge failed", e);
    return { ok: false, error: e?.message ?? String(e) };
  }
}

function downloadHttpToBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const req = net.request({ method: "GET", url });
    req.on("response", (res) => {
      const code = res.statusCode ?? 0;
      if (code >= 400) {
        reject(new Error(`HTTP ${code} downloading asset`));
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

/**
 * Resolve disk path from local:// or grudge-media:// viewer placeholders.
 * Electron net.request only accepts http(s) — local Elite Viewer assets never
 * go through that path when localPath or these schemes are present.
 */
function diskPathFromViewerUrl(url: string): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (trimmed.startsWith("file:")) {
    try {
      return fileURLToPath(trimmed);
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith("local://")) {
    try {
      // Built as local://${encodeURIComponent(path with /)}
      const raw = decodeURIComponent(trimmed.slice("local://".length));
      return pathResolve(normalize(raw.replace(/\//g, "\\")));
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith("grudge-media:")) {
    try {
      const u = new URL(trimmed);
      let filePath = u.searchParams.get("path") || "";
      if (!filePath) {
        filePath = decodeURIComponent(u.pathname || "");
        if (filePath.startsWith("/") && /^[A-Za-z]:/.test(filePath.slice(1))) {
          filePath = filePath.slice(1);
        }
      } else {
        filePath = decodeURIComponent(filePath);
      }
      return pathResolve(normalize(filePath));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Load asset bytes for convert / optimize / image tools.
 * Prefer absolute disk path; never pass blob:/local:/grudge-media: to net.request.
 */
async function loadAssetBytes(args: {
  url?: string;
  localPath?: string;
}): Promise<Buffer> {
  const disk =
    (args.localPath && args.localPath.trim()) ||
    diskPathFromViewerUrl(args.url || "");
  if (disk) {
    const abs = pathResolve(normalize(disk));
    if (!existsSync(abs)) {
      throw new Error(`Local file not found: ${abs}`);
    }
    return readFile(abs);
  }

  const url = (args.url || "").trim();
  if (!url) {
    throw new Error("No url or localPath to load asset");
  }
  if (url.startsWith("blob:")) {
    throw new Error(
      "Cannot optimize a blob: URL from the main process — re-open the file from Local Files (disk path) or use an https CDN URL",
    );
  }
  if (url.startsWith("http:") || url.startsWith("https:")) {
    return downloadHttpToBuffer(url);
  }
  throw new Error(
    `ClientRequest only supports http: and https: protocols — got "${url.slice(0, 48)}…". Pass localPath or use an https CDN URL.`,
  );
}

/** Download remote image, convert via sharp, return temp path for save dialog. */
export async function convertImage(args: {
  url: string;
  name: string;
  format: ImageOutFormat;
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** Absolute disk path when opened from Local Files — required for blob:/local: URLs */
  localPath?: string;
}): Promise<ImageConvertResult> {
  try {
    if (!args?.name) return { ok: false, error: "name required" };
    if (!args?.url && !args?.localPath) return { ok: false, error: "url or localPath required" };
    if (!isConvertibleImagePath(args.name) && !args.name.match(/\.(png|jpe?g|webp|gif|tga|tiff?|bmp|heic|avif)$/i)) {
      // Still try — remote may have wrong extension in key
    }
    const buf = await loadAssetBytes({ url: args.url, localPath: args.localPath });
    const dir = await mkdtemp(join(tmpdir(), "grudge-viewer-img-"));
    const srcName = basename(args.name) || "image.bin";
    const srcPath = join(dir, srcName);
    await writeFile(srcPath, buf);
    return convertImageFile(srcPath, {
      format: args.format,
      quality: args.quality,
      maxWidth: args.maxWidth,
      maxHeight: args.maxHeight,
      keepAlpha: true,
    }, dir);
  } catch (e: any) {
    log.error("Viewer convertImage failed", e);
    return { ok: false, error: e?.message ?? String(e) };
  }
}

export async function inspectRemoteImage(args: {
  url: string;
  name: string;
  localPath?: string;
}): Promise<{ ok: true; meta: ImageMeta } | { ok: false; error: string }> {
  try {
    const buf = await loadAssetBytes({ url: args.url, localPath: args.localPath });
    const dir = await mkdtemp(join(tmpdir(), "grudge-viewer-meta-"));
    const srcPath = join(dir, basename(args.name) || "image.bin");
    await writeFile(srcPath, buf);
    const meta = await inspectImage(srcPath);
    if (!meta) return { ok: false, error: "Could not read image metadata" };
    return { ok: true, meta };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/** Download remote model, convert via toolchain, return temp path for save dialog. */
export async function convertModel(args: {
  url: string;
  name: string;
  targetFormat: "glb" | "gltf";
  localPath?: string;
}): Promise<{ ok: true; path: string; name: string } | { ok: false; error: string }> {
  try {
    if (!args?.name) return { ok: false, error: "name required" };
    if (!args?.url && !args?.localPath) return { ok: false, error: "url or localPath required" };
    const buf = await loadAssetBytes({ url: args.url, localPath: args.localPath });
    const dir = await mkdtemp(join(tmpdir(), "grudge-viewer-convert-"));
    const srcName = basename(args.name) || "model.bin";
    const srcPath = join(dir, srcName);
    await writeFile(srcPath, buf);

    const verify = await verifyFile(srcPath);
    const converted = await convertFile(srcPath, verify, { outDir: dir });
    if (!converted.ok) {
      return { ok: false, error: converted.errors.join("; ") || "Conversion failed" };
    }

    let outPath = converted.outputPath;
    let outName = basename(outPath);

    // If toolchain already produced glb/gltf, use it. Otherwise rename hint for save dialog.
    const want = args.targetFormat === "gltf" ? ".gltf" : ".glb";
    if (extname(outPath).toLowerCase() !== want && args.targetFormat === "glb" && extname(outPath).toLowerCase() === ".glb") {
      // already glb
    } else if (extname(outPath).toLowerCase() !== want) {
      // Keep converted output; user asked for format — rename extension for save default only.
      outName = srcName.replace(/\.[^.]+$/, "") + want;
    }

    return { ok: true, path: outPath, name: outName };
  } catch (e: any) {
    log.error("Viewer convertModel failed", e);
    return { ok: false, error: e?.message ?? String(e) };
  }
}

export async function saveConvertedFile(
  args: { path: string; defaultName: string; kind?: "model" | "image" },
  parent?: BrowserWindow | null,
): Promise<{ ok: true; savedPath: string } | { ok: false; error: string } | { canceled: true }> {
  try {
    if (!args?.path || !existsSync(args.path)) {
      return { ok: false, error: "Converted file not found" };
    }
    const kind = args.kind ?? "model";
    const filters =
      kind === "image"
        ? [
            { name: "PNG", extensions: ["png"] },
            { name: "WebP", extensions: ["webp"] },
            { name: "JPEG", extensions: ["jpg", "jpeg"] },
            { name: "AVIF", extensions: ["avif"] },
            { name: "All files", extensions: ["*"] },
          ]
        : [
            { name: "glTF Binary", extensions: ["glb"] },
            { name: "glTF JSON", extensions: ["gltf"] },
            { name: "All files", extensions: ["*"] },
          ];
    const r = await dialog.showSaveDialog(parent && !parent.isDestroyed() ? parent : (undefined as any), {
      title: kind === "image" ? "Save converted image" : "Save converted model",
      defaultPath: args.defaultName || basename(args.path),
      filters,
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    await copyFile(args.path, r.filePath);
    return { ok: true, savedPath: r.filePath };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

export type OptimizeForWebResult =
  | (OptimizeWebResult & { ok: true; objectKey: string })
  | { ok: false; error: string; beforeBytes?: number; afterBytes?: number; reductionPct?: number; steps?: string[]; warnings?: string[]; profile?: string };

/**
 * Download CDN/local asset → grudge-web-v1 optimize → temp .web.glb + before/after sizes.
 * `objectKey` is the original bucket path (`asset.name`) for optional re-upload.
 * Local Elite Viewer assets must pass `localPath` (blob:/local: are not http).
 */
export async function optimizeForWeb(args: {
  url: string;
  name: string;
  opts?: OptimizeWebOptions;
  localPath?: string;
}): Promise<OptimizeForWebResult> {
  try {
    if (!args?.name) {
      return { ok: false, error: "name required" };
    }
    if (!args?.url && !args?.localPath) {
      return { ok: false, error: "url or localPath required" };
    }

    // Prefer disk. For multi-file .gltf, optimize FROM the original path so
    // external .bin + textures resolve (copying only scene.gltf orphans maps).
    const diskHint =
      (args.localPath && args.localPath.trim()) ||
      diskPathFromViewerUrl(args.url || "");
    const dir = await mkdtemp(join(tmpdir(), "grudge-viewer-opt-"));
    let srcPath: string;

    if (diskHint && existsSync(pathResolve(normalize(diskHint)))) {
      const abs = pathResolve(normalize(diskHint));
      const ext = extname(abs).toLowerCase();
      if (ext === ".gltf") {
        srcPath = abs;
      } else {
        const srcName = basename(abs) || basename(args.name) || "model.bin";
        srcPath = join(dir, srcName);
        await copyFile(abs, srcPath);
      }
    } else {
      const srcName = basename(args.name) || "model.bin";
      srcPath = join(dir, srcName);
      const buf = await loadAssetBytes({ url: args.url, localPath: args.localPath });
      // Reject HTML/error stubs before writing temp + optimize
      const { assertMeshBytes } = await import("../shared/magicBytes");
      const lower = srcName.toLowerCase();
      if (lower.endsWith(".glb") || lower.endsWith(".gltf") || lower.endsWith(".bin")) {
        assertMeshBytes(buf, srcName);
      }
      await writeFile(srcPath, buf);
      if (lower.endsWith(".gltf")) {
        log.warn(
          "Optimize downloaded a lone .gltf without sibling .bin/textures — embed may miss maps. Prefer Local Files open of the full pack folder.",
        );
      }
    }

    const result = await optimizeWebFile(srcPath, { ...args.opts, outDir: dir });
    if (!result.ok || !result.path) {
      return {
        ok: false,
        error: result.error ?? "Optimize failed",
        beforeBytes: result.beforeBytes,
        afterBytes: result.afterBytes,
        reductionPct: result.reductionPct,
        steps: result.steps,
        warnings: result.warnings,
        profile: result.profile,
      };
    }
    log.info(
      `Viewer optimize ${args.name}: ${result.beforeBytes} → ${result.afterBytes} (${result.reductionPct}%) steps=${result.steps.join(",")}`,
    );
    return {
      ...result,
      ok: true,
      objectKey: args.name.replace(/^\//, ""),
    };
  } catch (e: any) {
    log.error("Viewer optimizeForWeb failed", e);
    return { ok: false, error: e?.message ?? String(e) };
  }
}

async function putWithRetry(url: string, body: Buffer, contentType: string): Promise<void> {
  let lastErr: any = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body,
      });
      if (resp.ok) return;
      lastErr = new Error(`PUT ${resp.status} ${resp.statusText}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250 * Math.pow(2, attempt - 1)));
  }
  throw lastErr ?? new Error("upload failed");
}

/**
 * PUT optimized local file back to the same object-storage key (overwrite).
 */
export async function reuploadOptimized(args: {
  localPath: string;
  objectKey: string;
  contentType?: string;
}): Promise<
  | { ok: true; objectKey: string; bytes: number; cdnUrl: string }
  | { ok: false; error: string }
> {
  try {
    if (!args?.localPath || !existsSync(args.localPath)) {
      return { ok: false, error: "Optimized file not found" };
    }
    const key = (args.objectKey || "").replace(/^\//, "").trim();
    if (!key) return { ok: false, error: "objectKey (CDN path) required" };

    const st = await stat(args.localPath);
    const data = await readFile(args.localPath);
    const contentType = args.contentType
      || (extname(args.localPath).toLowerCase() === ".gltf" ? "model/gltf+json" : "model/gltf-binary");

    const ticket = await requestUploadUrl({
      path: key,
      contentType,
      size: st.size,
      allowOverwrite: true,
    });
    await putWithRetry(ticket.uploadURL, data, contentType);

    let cdnUrl = "";
    try {
      cdnUrl = await r2PublicUrl(key);
    } catch {
      cdnUrl = `https://assets.grudge-studio.com/${key}`;
    }

    log.info(`Viewer re-upload ${key} (${st.size} bytes)`);
    return { ok: true, objectKey: key, bytes: st.size, cdnUrl };
  } catch (e: any) {
    log.error("Viewer reuploadOptimized failed", e);
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/** Read optimized file bytes for reloading the Three.js viewport. */
export async function readOptimizedBytes(path: string): Promise<
  { ok: true; name: string; bytes: Uint8Array; mime: string } | { ok: false; error: string }
> {
  try {
    if (!path || !existsSync(path)) return { ok: false, error: "File not found" };
    const data = await readFile(path);
    const ext = extname(path).toLowerCase();
    const mime = ext === ".gltf" ? "model/gltf+json" : "model/gltf-binary";
    return { ok: true, name: basename(path), bytes: new Uint8Array(data), mime };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/** Optional: bring every open viewer to front (e.g. tray action). */
export function focusAllViewers(): void {
  for (const win of openWindows.values()) {
    if (!win.isDestroyed()) {
      win.setAlwaysOnTop(true, "screen-saver");
      win.show();
      win.focus();
      win.moveTop();
    }
  }
}

export function disposeAllViewers(): void {
  for (const win of openWindows.values()) {
    if (!win.isDestroyed()) win.destroy();
  }
  openWindows.clear();
  assetStore.clear();
}
