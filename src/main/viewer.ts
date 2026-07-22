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
import { basename, extname, join } from "node:path";
import log from "./logger";
import * as forge from "./forge";
import { convertFile, verifyFile } from "./ingestion";
import { optimizeWebFile, type OptimizeWebOptions, type OptimizeWebResult } from "./ingestion/optimizeWeb";
import { requestUploadUrl } from "./api";
import { r2PublicUrl } from "./cf/r2Direct";

export interface ViewerAssetRef {
  name: string;
  url: string;
  contentType: string;
  size: number;
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
  const name = typeof a.name === "string" ? a.name : "";
  const url = typeof a.url === "string" ? a.url : "";
  if (!name || !url) throw new Error("viewer:open requires asset.name and asset.url");
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))) {
      throw new Error("Only http(s) asset URLs are allowed");
    }
  } catch (e: any) {
    if (e?.message?.includes("Only http")) throw e;
    throw new Error(`Invalid asset URL: ${url}`);
  }
  return {
    name,
    url,
    contentType: typeof a.contentType === "string" ? a.contentType : "",
    size: typeof a.size === "number" && Number.isFinite(a.size) ? a.size : 0,
  };
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
    title: `${basename(asset.name)} — Grudge Asset Viewer`,
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

function downloadToBuffer(url: string): Promise<Buffer> {
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

/** Download remote model, convert via toolchain, return temp path for save dialog. */
export async function convertModel(args: {
  url: string;
  name: string;
  targetFormat: "glb" | "gltf";
}): Promise<{ ok: true; path: string; name: string } | { ok: false; error: string }> {
  try {
    if (!args?.url || !args?.name) return { ok: false, error: "url and name required" };
    const buf = await downloadToBuffer(args.url);
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
  args: { path: string; defaultName: string },
  parent?: BrowserWindow | null,
): Promise<{ ok: true; savedPath: string } | { ok: false; error: string } | { canceled: true }> {
  try {
    if (!args?.path || !existsSync(args.path)) {
      return { ok: false, error: "Converted file not found" };
    }
    const r = await dialog.showSaveDialog(parent && !parent.isDestroyed() ? parent : (undefined as any), {
      title: "Save converted model",
      defaultPath: args.defaultName || basename(args.path),
      filters: [
        { name: "glTF Binary", extensions: ["glb"] },
        { name: "glTF JSON", extensions: ["gltf"] },
        { name: "All files", extensions: ["*"] },
      ],
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
 */
export async function optimizeForWeb(args: {
  url: string;
  name: string;
  opts?: OptimizeWebOptions;
}): Promise<OptimizeForWebResult> {
  try {
    if (!args?.url || !args?.name) {
      return { ok: false, error: "url and name required" };
    }
    const dir = await mkdtemp(join(tmpdir(), "grudge-viewer-opt-"));
    const srcName = basename(args.name) || "model.bin";
    const srcPath = join(dir, srcName);
    const buf = await downloadToBuffer(args.url);
    await writeFile(srcPath, buf);

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
