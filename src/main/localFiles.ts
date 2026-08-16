/**
 * Local disk folder browser for the Dev Tool "Local Files" tab.
 *
 * Opens any asset type into wired viewers (3D / image / audio / video / text…)
 * — not into Forge by default. Forge remains an explicit secondary action.
 */

import { BrowserWindow, clipboard, dialog, shell } from "electron";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, normalize, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  inferContentType,
  isAudioPath,
  isDesignPath,
  isImagePath,
  isModelPath,
  isThreeScenePath,
  isVideoPath,
} from "../shared/mediaTypes";
import log from "./logger";

export type LocalEntryKind =
  | "dir"
  | "image"
  | "model3d"
  | "scene3d"
  | "audio"
  | "video"
  | "text"
  | "pdf"
  | "font"
  | "archive"
  | "design"
  | "file";

export interface LocalDirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
  ext: string;
  kind: LocalEntryKind;
  contentType: string;
}

export interface ListDirResult {
  path: string;
  parent: string | null;
  entries: LocalDirEntry[];
}

/** Max bytes for in-memory read into viewers (blob URL). */
const MAX_READ_BYTES = 256 * 1024 * 1024;

const TEXT_EXTS = new Set([
  ".txt", ".json", ".md", ".markdown", ".yml", ".yaml", ".ts", ".tsx", ".js", ".jsx",
  ".mjs", ".cjs", ".css", ".scss", ".html", ".htm", ".xml", ".csv", ".tsv", ".log",
  ".ini", ".toml", ".env", ".rs", ".go", ".py", ".sh", ".ps1", ".scene",
  ".tmx", ".tsx", ".atlas",
]);
const FONT_EXTS = new Set([".ttf", ".otf", ".woff", ".woff2"]);
const ARCHIVE_EXTS = new Set([".zip", ".7z", ".rar", ".tar", ".gz"]);
const PDF_EXTS = new Set([".pdf"]);

function classifyLocal(name: string, isDirectory: boolean): LocalEntryKind {
  if (isDirectory) return "dir";
  if (isThreeScenePath(name)) return "scene3d";
  if (isModelPath(name)) return "model3d";
  if (isImagePath(name)) return "image";
  if (isAudioPath(name)) return "audio";
  if (isVideoPath(name)) return "video";
  const ext = extname(name).toLowerCase();
  if (PDF_EXTS.has(ext)) return "pdf";
  if (FONT_EXTS.has(ext)) return "font";
  if (TEXT_EXTS.has(ext) || [".tmx", ".tsx", ".atlas"].includes(ext)) return "text";
  if (ARCHIVE_EXTS.has(ext)) return "archive";
  if (isDesignPath(name)) return "design";
  return "file";
}

function safeResolve(absPath: string): string {
  if (!absPath || typeof absPath !== "string") throw new Error("Path required");
  const p = resolve(normalize(absPath.trim()));
  // Block oddities; absolute user paths are intentional for this desktop tool.
  if (p.includes("\0")) throw new Error("Invalid path");
  return p;
}

export async function pickDirectory(
  parent?: BrowserWindow | null,
  defaultPath?: string | null,
): Promise<string | null> {
  const opts: Electron.OpenDialogOptions = {
    title: "Open local folder for viewing",
    defaultPath: defaultPath && existsSync(defaultPath) ? defaultPath : undefined,
    properties: ["openDirectory", "createDirectory"],
  };
  const r =
    parent && !parent.isDestroyed()
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts);
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
}

export function copyPathToClipboard(filePath: string): { ok: true; path: string } {
  const path = safeResolve(filePath);
  clipboard.writeText(path);
  return { ok: true, path };
}

export async function listDirectory(dirPath: string): Promise<ListDirResult> {
  const path = safeResolve(dirPath);
  const st = await stat(path);
  if (!st.isDirectory()) throw new Error("Not a directory: " + path);

  const names = await readdir(path);
  const entries: LocalDirEntry[] = [];

  for (const name of names) {
    if (name === "." || name === "..") continue;
    // Skip heavy / system noise by default (still openable if user navigates)
    if (name === "node_modules" || name === ".git" || name === "dist" || name === ".next") {
      // still show them as dirs so users can open if needed
    }
    const full = join(path, name);
    try {
      const s = await stat(full);
      const isDir = s.isDirectory();
      const kind = classifyLocal(name, isDir);
      entries.push({
        name,
        path: full,
        isDirectory: isDir,
        size: isDir ? 0 : s.size,
        mtimeMs: s.mtimeMs,
        ext: isDir ? "" : extname(name).toLowerCase().replace(/^\./, ""),
        kind,
        contentType: isDir ? "inode/directory" : inferContentType(name),
      });
    } catch {
      /* skip unreadable */
    }
  }

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  const parentDir = dirname(path);
  const parent = parentDir && parentDir !== path ? parentDir : null;

  return { path, parent, entries };
}

export interface LocalFileBytes {
  name: string;
  path: string;
  bytes: Uint8Array;
  mime: string;
  size: number;
  kind: LocalEntryKind;
  /** file:// URL — use only for shell / reveal; viewers should use blob from bytes */
  fileUrl: string;
}

export async function readLocalFile(filePath: string): Promise<LocalFileBytes> {
  const path = safeResolve(filePath);
  const st = await stat(path);
  if (!st.isFile()) throw new Error("Not a file: " + path);
  if (st.size > MAX_READ_BYTES) {
    throw new Error(
      `File too large for in-app viewer (${Math.round(st.size / 1024 / 1024)} MB). Max ${MAX_READ_BYTES / 1024 / 1024} MB.`,
    );
  }
  const data = await readFile(path);
  const name = basename(path);
  return {
    name,
    path,
    bytes: data,
    mime: inferContentType(name),
    size: data.byteLength,
    kind: classifyLocal(name, false),
    fileUrl: pathToFileURL(path).toString(),
  };
}

export async function revealInFolder(filePath: string): Promise<{ ok: true }> {
  const path = safeResolve(filePath);
  shell.showItemInFolder(path);
  return { ok: true };
}

export async function openWithSystem(filePath: string): Promise<{ ok: true }> {
  const path = safeResolve(filePath);
  const err = await shell.openPath(path);
  if (err) throw new Error(err);
  return { ok: true };
}

/** Convenience for logs / debugging. */
export function localFilesRootHint(): string {
  return process.cwd().split(sep).slice(0, 3).join(sep);
}

log.info("[localFiles] module loaded");
