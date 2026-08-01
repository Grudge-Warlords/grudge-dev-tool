/**
 * Elite local file open system for Grudge Dev Tool (desktop app).
 *
 * OS double-click / "Open with" / drag-drop argv → always-on-top Asset Viewer
 * with the correct viewer for that type (3D, image, audio, video, text, PDF…).
 *
 * NOT Forge. Forge is an explicit in-app action only.
 */

import { app, BrowserWindow } from "electron";
import { existsSync, statSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import {
  inferContentType,
  isAudioPath,
  isImagePath,
  isModelPath,
  isThreeScenePath,
  isVideoPath,
} from "../shared/mediaTypes";
import log from "./logger";
import * as viewer from "./viewer";

/** Every extension the elite viewer can open from disk / Explorer. */
export const VIEWER_EXTS = new Set([
  // 3D
  ".glb",
  ".gltf",
  ".fbx",
  ".obj",
  ".stl",
  ".ply",
  ".dae",
  ".3mf",
  ".blend",
  ".gfscene",
  // Images
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".avif",
  ".svg",
  ".bmp",
  ".tga",
  ".tif",
  ".tiff",
  ".ico",
  ".heic",
  ".heif",
  ".apng",
  ".jxl",
  ".jp2",
  ".psd",
  // Audio
  ".mp3",
  ".wav",
  ".ogg",
  ".flac",
  ".m4a",
  ".aac",
  ".opus",
  // Video
  ".mp4",
  ".webm",
  ".mov",
  ".m4v",
  ".ogv",
  ".mkv",
  ".avi",
  // Text / data
  ".json",
  ".txt",
  ".md",
  ".markdown",
  ".yml",
  ".yaml",
  ".csv",
  ".tsv",
  ".log",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".env",
  ".toml",
  ".ini",
  // Docs / fonts
  ".pdf",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
]);

export type EliteKind =
  | "model3d"
  | "scene3d"
  | "image"
  | "audio"
  | "video"
  | "text"
  | "pdf"
  | "font"
  | "file";

export function classifyPath(filePath: string): EliteKind {
  const name = basename(filePath);
  if (isThreeScenePath(name) || /\.gfscene$/i.test(name) || /\.scene\.json$/i.test(name)) {
    return "scene3d";
  }
  if (isModelPath(name)) return "model3d";
  if (isImagePath(name) || /\.psd$/i.test(name)) return "image";
  if (isAudioPath(name)) return "audio";
  if (isVideoPath(name)) return "video";
  if (/\.pdf$/i.test(name)) return "pdf";
  if (/\.(ttf|otf|woff2?)$/i.test(name)) return "font";
  if (
    /\.(json|txt|md|markdown|ya?ml|csv|tsv|log|xml|html?|css|js|mjs|cjs|tsx?|jsx|env|toml|ini)$/i.test(
      name,
    )
  ) {
    return "text";
  }
  return "file";
}

export function isViewerPath(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  if (VIEWER_EXTS.has(ext)) return true;
  // .scene.json style
  return isThreeScenePath(basename(filePath));
}

/**
 * Scan argv for openable file paths (Windows Explorer / "Open with" / cold start).
 * Skips electron flags, "." cwd, and non-files.
 */
export function findOpenablePaths(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    let a = argv[i];
    if (!a || a.startsWith("--")) continue;
    if (a === "." || a === "electron" || a.endsWith("electron.exe")) continue;
    // Windows sometimes quotes paths
    a = a.replace(/^["']|["']$/g, "");
    try {
      const p = resolve(a);
      if (!existsSync(p)) continue;
      const st = statSync(p);
      if (!st.isFile()) continue;
      if (!isViewerPath(p)) {
        log.info("[openFile] skip unsupported ext:", p);
        continue;
      }
      out.push(p);
    } catch {
      /* ignore */
    }
  }
  return out;
}

let pendingPaths: string[] = [];

/** Cold start: stash paths until app is ready. */
export function captureInitialArgv(argv: string[] = process.argv): void {
  const found = findOpenablePaths(argv);
  if (!found.length) return;
  pendingPaths = found;
  log.info("[openFile] cold-start paths:", found.map((p) => basename(p)).join(", "));
}

/**
 * Open one absolute path in the elite pop-out viewer.
 * Also tells main shell to jump to Local Files with parent folder context.
 */
export async function openPathInEliteViewer(
  filePath: string,
  mainWindow: BrowserWindow | null,
): Promise<{ ok: true; token: string; kind: EliteKind } | { ok: false; error: string }> {
  try {
    const p = resolve(filePath);
    if (!existsSync(p)) return { ok: false, error: "File not found: " + p };
    if (!statSync(p).isFile()) return { ok: false, error: "Not a file: " + p };

    const kind = classifyPath(p);
    const contentType = inferContentType(basename(p));
    const size = statSync(p).size;

    log.info(`[openFile] elite viewer ← ${kind} ${p}`);
    const { token } = await viewer.openLocalPath(
      p,
      { contentType, size },
      mainWindow && !mainWindow.isDestroyed() ? mainWindow : null,
    );

    // Focus main shell on Local Files so the app is the open system, not a silent ghost
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send("nav", "/local");
      mainWindow.webContents.send("openFile:opened", {
        path: p,
        name: basename(p),
        dir: dirname(p),
        kind,
        contentType,
        size,
        token,
      });
    }

    return { ok: true, token, kind };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("[openFile] failed", msg);
    return { ok: false, error: msg };
  }
}

/** Open all paths (multi-select Open with). */
export async function openPaths(
  paths: string[],
  mainWindow: BrowserWindow | null,
): Promise<{ opened: number; errors: string[] }> {
  let opened = 0;
  const errors: string[] = [];
  for (const p of paths) {
    const r = await openPathInEliteViewer(p, mainWindow);
    if (r.ok) opened++;
    else errors.push(r.error);
  }
  return { opened, errors };
}

/** Second-instance (app already running): open viewer, focus app. */
export function onSecondInstance(argv: string[], mainWindow: BrowserWindow | null): void {
  const found = findOpenablePaths(argv);
  if (!found.length) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
    return;
  }
  void openPaths(found, mainWindow);
}

/**
 * After main window is ready: flush cold-start files into elite viewer.
 * Call instead of forge.flushPendingTo for OS open.
 */
export function flushPendingTo(mainWindow: BrowserWindow): void {
  if (!pendingPaths.length) return;
  const paths = [...pendingPaths];
  pendingPaths = [];

  const run = () => {
    void openPaths(paths, mainWindow);
  };

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once("did-finish-load", run);
  } else {
    // Small delay so preload + IPC are live
    setTimeout(run, 400);
  }
}

export function getPendingPaths(): string[] {
  return [...pendingPaths];
}

/** electron-builder fileAssociations list (ext without dot). */
export function fileAssociationExts(): string[] {
  return [...VIEWER_EXTS].map((e) => e.replace(/^\./, ""));
}

log.info(`[openFile] elite bridge ready — ${VIEWER_EXTS.size} extensions`);
