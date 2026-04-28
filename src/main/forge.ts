import { BrowserWindow } from "electron";
import { promises as fs } from "node:fs";
import { basename, extname } from "node:path";
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

/** Called from second-instance handler. */
export function captureSecondInstanceArgv(argv: string[], mainWindow: BrowserWindow | null): void {
  const path = findModelArg(argv);
  if (!path) return;
  log.info("Forge: second-instance file:", path);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("forge:openFile", { path, name: basename(path) });
    // Also navigate to the Forge page so the user actually sees the file.
    mainWindow.webContents.send("nav", "/forge");
  } else {
    pendingPath = path;
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

export async function readModelFile(path: string): Promise<ReadFileResult> {
  const ext = extname(path).toLowerCase();
  if (!SUPPORTED_EXTS.has(ext)) throw new Error(`Unsupported extension: ${ext}`);
  const data = await fs.readFile(path);
  return {
    name: basename(path),
    bytes: data,
    mime: MIME_BY_EXT[ext] ?? "application/octet-stream",
    size: data.byteLength,
  };
}

/** When the main window is created and the user already had a pending file, push it. */
export function flushPendingTo(mainWindow: BrowserWindow): void {
  if (!pendingPath) return;
  const path = pendingPath;
  pendingPath = null;
  // Wait for renderer to be ready, then deliver.
  mainWindow.webContents.once("did-finish-load", () => {
    mainWindow.webContents.send("forge:openFile", { path, name: basename(path) });
    mainWindow.webContents.send("nav", "/forge");
  });
  // If it has already loaded by the time we get here (rare), fire immediately too.
  if (!mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send("forge:openFile", { path, name: basename(path) });
    mainWindow.webContents.send("nav", "/forge");
  }
}
