/**
 * Local file open system for Grudge Dev Tool.
 *
 * 3D meshes / scenes → ThreeFlow ThreePipe viewer / scene editor (loopback).
 * Images / audio / video / text / PDF → Elite media viewer.
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
  listViewerExtensionsWithDot,
} from "../shared/mediaTypes";
import log from "./logger";
import * as viewer from "./viewer";
import { resolveSceneOpenPath } from "./forge";
import { needsAutoPrepare, prepareForEliteViewer } from "./ingestion/designPreview";

/**
 * Every extension the elite viewer can open from disk / Explorer.
 * Built from mediaTypes SSOT — do not maintain a parallel hardcoded list.
 */
export const VIEWER_EXTS = new Set(listViewerExtensionsWithDot());

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
  if (
    isThreeScenePath(name) ||
    /\.gfscene$/i.test(name) ||
    /\.scene\.json$/i.test(name) ||
    /\.forge-scene\.json$/i.test(name) ||
    /\.three\.json$/i.test(name)
  ) {
    return "scene3d";
  }
  // .bin companions + glTF packs open as 3D (resolved to .gltf on open)
  if (isModelPath(name) || /\.bin$/i.test(name)) return "model3d";
  if (isImagePath(name) || /\.psd$/i.test(name)) return "image";
  if (isAudioPath(name)) return "audio";
  if (isVideoPath(name)) return "video";
  if (/\.pdf$/i.test(name)) return "pdf";
  if (/\.(ttf|otf|woff2?)$/i.test(name)) return "font";
  // Plain .json under /scenes/ already scene3d; other JSON stays text unless name matches
  if (
    /\.(txt|md|markdown|ya?ml|csv|tsv|log|xml|html?|css|js|mjs|cjs|tsx?|jsx|env|toml|ini)$/i.test(
      name,
    )
  ) {
    return "text";
  }
  if (/\.json$/i.test(name)) {
    // Prefer 3D scene when name hints; Elite open still content-sniffs
    if (/scene|forge|three|gfscene/i.test(name)) return "scene3d";
    return "text";
  }
  return "file";
}

/** Meshes ThreeFlow can edit (not CSS3D html stubs). */
export function isThreeFlowMeshPath(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".html" || ext === ".htm") return false;
  const kind = classifyPath(filePath);
  return kind === "model3d" || kind === "scene3d";
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
    let p = resolve(filePath);
    if (!existsSync(p)) return { ok: false, error: "File not found: " + p };
    if (!statSync(p).isFile()) return { ok: false, error: "Not a file: " + p };

    const sourcePath = p;
    let openNote: string | undefined;
    // .bin → sibling .gltf; JSON scene sniff; keep multi-file pack root
    try {
      const ext = extname(p).toLowerCase();
      if (
        ext === ".bin" ||
        ext === ".json" ||
        ext === ".gfscene" ||
        ext === ".scene" ||
        ext === ".three" ||
        /\.(forge-scene|scene|three|gfscene)\.json$/i.test(basename(p))
      ) {
        const resolved = await resolveSceneOpenPath(p);
        if (resolved.path !== p) {
          log.info(`[openFile] resolved ${basename(p)} → ${basename(resolved.path)} (${resolved.note || resolved.role})`);
        }
        p = resolved.path;
        openNote = resolved.note;
      }
    } catch (resolveErr: unknown) {
      const msg = resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
      return { ok: false, error: msg };
    }

    let kind = classifyPath(p);
    // Content-resolved three/forge scenes
    if (openNote?.includes("ObjectLoader") || openNote?.includes("Forge multi")) {
      kind = "scene3d";
    }
    const contentType = inferContentType(basename(p));
    const size = statSync(p).size;

    if ((kind === "model3d" || kind === "scene3d") && needsAutoPrepare(p)) {
      const prep = await prepareForEliteViewer(p);
      if (prep.ok && prep.path) p = prep.path;
    }

    // 3D: ThreePipe viewer (default) with editor query — not Elite SceneEngine.
    if (kind === "model3d" || kind === "scene3d") {
      log.info(`[openFile] ThreeFlow pipeline ← ${kind} ${p}${openNote ? ` (${openNote})` : ""}`);
      const { url } = viewer.openThreeFlowPipeline({
        name: basename(p),
        localPath: p,
        mode: "view",
        extra: { note: openNote || "" },
      });
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.webContents.send("nav", "/threeflow");
        mainWindow.webContents.send("openFile:opened", {
          path: p,
          sourcePath,
          name: basename(p),
          dir: dirname(p),
          kind,
          contentType,
          size,
          url,
          note: openNote,
        });
      }
      return { ok: true, token: url, kind };
    }

    log.info(`[openFile] elite viewer ← ${kind} ${p}${openNote ? ` (${openNote})` : ""}`);
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
        sourcePath,
        name: basename(p),
        dir: dirname(p),
        kind,
        contentType,
        size,
        token,
        note: openNote,
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
