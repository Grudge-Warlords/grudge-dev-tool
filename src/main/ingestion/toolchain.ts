import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as toolPaths from "../toolPaths";
import { resolveBundledFbx2gltf } from "./fbx2gltfPath";

/** App root package.json — works from src/main and dist/main (ingestion is one level deeper). */
function appRootPackageJson(): string {
  // dist/main/ingestion → ../../../package.json
  // also works when compiled next to main if layout shifts
  const candidates = [
    join(__dirname, "..", "..", "..", "package.json"),
    join(__dirname, "..", "..", "package.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

const nodeRequire = createRequire(appRootPackageJson());

/** Repo / install root for portable tools under tools/ */
function appRootDir(): string {
  return dirname(appRootPackageJson());
}

/** Shallow recursive find of a binary under a root (depth-limited). */
function findBinaryUnder(root: string, name: string, maxDepth = 5): string | null {
  if (!root || !existsSync(root)) return null;
  const target = name.toLowerCase();
  const walk = (dir: string, depth: number): string | null => {
    if (depth < 0) return null;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return null;
    }
    for (const ent of entries) {
      const full = join(dir, ent);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) {
        if (ent.toLowerCase() === target) return full;
        continue;
      }
      // skip heavy trees
      if (/^(node_modules|\.git|__pycache__)$/i.test(ent)) continue;
      const hit = walk(full, depth - 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root, maxDepth);
}

export interface ToolStatus {
  name: string;
  available: boolean;
  version?: string;
  path?: string;
  reason?: string;
}

function which(cmd: string): string | null {
  // Cross-platform "where/which"
  const sniff = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
    encoding: "utf8",
    shell: false,
  });
  if (sniff.status === 0 && sniff.stdout) {
    const first = sniff.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && existsSync(first)) return first;
  }
  return null;
}

function probeVersion(bin: string, args: string[]): string | undefined {
  try {
    const r = spawnSync(bin, args, { encoding: "utf8", timeout: 4000 });
    if (r.status === 0) {
      const out = (r.stdout || r.stderr || "").trim().split(/\r?\n/)[0];
      return out;
    }
  } catch { /* ignore */ }
  return undefined;
}

function winBlenderCandidates(): string[] {
  const toolsRoot = join(appRootDir(), "tools");
  const versions = ["5.2", "5.1", "5.0", "4.5", "4.4", "4.3", "4.2", "4.1", "4.0"];
  const pf: string[] = [];
  for (const v of versions) {
    pf.push(`C:\\Program Files\\Blender Foundation\\Blender ${v}\\blender.exe`);
    pf.push(join(process.env.LOCALAPPDATA ?? "", `Programs\\Blender Foundation\\Blender ${v}\\blender.exe`));
  }
  // Portable under tools/blender/**/blender.exe (resolved via findBinaryUnder)
  return [
    ...pf,
    join(toolsRoot, "blender", "blender.exe"),
  ].filter(Boolean);
}

function winFfmpegCandidates(): string[] {
  const toolsRoot = join(appRootDir(), "tools");
  const local = process.env.LOCALAPPDATA ?? "";
  return [
    join(local, "Microsoft\\WinGet\\Links\\ffmpeg.exe"),
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
    "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe",
    join(toolsRoot, "ffmpeg", "bin", "ffmpeg.exe"),
  ];
}

function firstExisting(paths: string[]): string | null {
  for (const p of paths) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

export async function detectBlender(): Promise<ToolStatus> {
  const stored = await toolPaths.getToolPath("blender");
  const envPath = process.env.BLENDER_PATH;
  const path =
    (stored && existsSync(stored) ? stored : null)
    ?? (envPath && existsSync(envPath) ? envPath : null)
    ?? which("blender")
    ?? firstExisting(winBlenderCandidates())
    ?? findBinaryUnder(join(appRootDir(), "tools", "blender"), "blender.exe", 4);
  if (!path) {
    return {
      name: "Blender",
      available: false,
      reason:
        "Not found — run npm run toolchain:install (or install Blender 4.x) and set path in Accounts → Toolchain.",
    };
  }
  const version = probeVersion(path, ["--version"]);
  return { name: "Blender", available: true, path, version };
}

const WIN_FBX2GLTF_CANDIDATES = [
  "D:\\FBX2glTF.exe",
  "C:\\Tools\\FBX2glTF.exe",
  join(appRootDir(), "resources", "tools", "FBX2glTF.exe"),
];

export async function detectFbx2gltf(): Promise<ToolStatus> {
  const stored = await toolPaths.getToolPath("fbx2gltf");
  const envPath = process.env.FBX2GLTF_PATH;
  const path =
    (stored && existsSync(stored) ? stored : null)
    ?? (envPath && existsSync(envPath) ? envPath : null)
    ?? resolveBundledFbx2gltf()
    ?? which("FBX2glTF")
    ?? firstExisting(WIN_FBX2GLTF_CANDIDATES);
  if (!path) {
    return {
      name: "FBX2glTF",
      available: false,
      reason: "Not found — bundled tool missing or set path in Accounts → Toolchain.",
    };
  }
  const version = probeVersion(path, ["-V", "--version"]);
  return { name: "FBX2glTF", available: true, path, version };
}

export async function detectFfmpeg(): Promise<ToolStatus> {
  const stored = await toolPaths.getToolPath("ffmpeg");
  const envPath = process.env.FFMPEG_PATH;
  const path =
    (stored && existsSync(stored) ? stored : null)
    ?? (envPath && existsSync(envPath) ? envPath : null)
    ?? which("ffmpeg")
    ?? firstExisting(winFfmpegCandidates())
    ?? findBinaryUnder(join(appRootDir(), "tools", "ffmpeg"), "ffmpeg.exe", 5);
  if (!path) {
    return {
      name: "ffmpeg",
      available: false,
      reason: "Not found — run npm run toolchain:install or set path in Accounts → Toolchain.",
    };
  }
  return { name: "ffmpeg", available: true, path, version: probeVersion(path, ["-version"]) };
}

export function detectSharp(): ToolStatus {
  try {
    const sharp = require("sharp");
    return { name: "sharp", available: true, version: sharp.versions?.sharp };
  } catch (err: any) {
    return { name: "sharp", available: false, reason: err.message };
  }
}

/**
 * Detect @gltf-transform/core.
 * Do NOT resolve `@gltf-transform/core/package.json` — package "exports" blocks that subpath
 * (ERR_PACKAGE_PATH_NOT_EXPORTED) even when the module is installed.
 */
export function detectGltfTransform(): ToolStatus {
  try {
    const entry = nodeRequire.resolve("@gltf-transform/core");
    // Smoke-load the CJS entry (exports.require → dist/index.cjs).
    nodeRequire("@gltf-transform/core");

    let version = "installed";
    let dir = dirname(entry);
    for (let i = 0; i < 5; i++) {
      const pkgFile = join(dir, "package.json");
      if (existsSync(pkgFile)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as {
            name?: string;
            version?: string;
          };
          if (pkg.name === "@gltf-transform/core" && pkg.version) {
            version = pkg.version;
            break;
          }
        } catch {
          /* keep walking */
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    return { name: "gltf-transform", available: true, version, path: entry };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: "gltf-transform",
      available: false,
      reason: `${msg} — ensure @gltf-transform/core is installed (npm install in app root).`,
    };
  }
}

/**
 * Detect a local BlenderKit addon install. We never bundle GPL addon files
 * inside this app — we just point Blender at an existing on-disk install.
 *
 * Probe order:
 *   1. BLENDERKIT_PATH env var (production override)
 *   2. Blender user extensions dir on Windows: %APPDATA%\Blender Foundation\Blender\<ver>\extensions\user_default\blenderkit
 *   3. The Grudge-pinned dev path (only useful on the original dev box)
 */
function blenderKitCandidatePaths(): string[] {
  const candidates: string[] = [];
  if (process.env.BLENDERKIT_PATH) candidates.push(process.env.BLENDERKIT_PATH);
  // Blender extensions dir (4.2+) — try the four most-likely active versions.
  const appData = process.env.APPDATA;
  if (appData) {
    for (const ver of ["4.5", "4.4", "4.3", "4.2"]) {
      candidates.push(`${appData}\\Blender Foundation\\Blender\\${ver}\\extensions\\user_default\\blenderkit`);
      candidates.push(`${appData}\\Blender Foundation\\Blender\\${ver}\\scripts\\addons\\blenderkit`);
    }
  }
  // Grudge-pinned dev fallback. Removed entirely if the user opts out via env var.
  if (!process.env.BLENDERKIT_NO_PINNED) {
    candidates.push("F:\\blenderkit-v3.19.2.260411\\blenderkit");
  }
  return candidates;
}

export async function detectBlenderKit(): Promise<ToolStatus> {
  const stored = await toolPaths.getToolPath("blenderkit");
  const candidates = stored ? [stored, ...blenderKitCandidatePaths()] : blenderKitCandidatePaths();
  for (const path of candidates) {
    const manifest = `${path}\\blender_manifest.toml`;
    if (!existsSync(manifest)) continue;
    let version: string | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("node:fs");
      const text: string = fs.readFileSync(manifest, "utf8");
      const m = text.match(/version\s*=\s*"([^"]+)"/);
      if (m) version = m[1];
    } catch { /* ignore */ }
    return { name: "BlenderKit", available: true, path, version };
  }
  return {
    name: "BlenderKit",
    available: false,
    reason: `Addon not found in any candidate path. Set BLENDERKIT_PATH to point at an existing install.`,
  };
}

export async function detectAll(): Promise<ToolStatus[]> {
  return [
    detectSharp(),
    detectGltfTransform(),
    await detectFbx2gltf(),
    await detectBlender(),
    await detectFfmpeg(),
    await detectBlenderKit(),
  ];
}
