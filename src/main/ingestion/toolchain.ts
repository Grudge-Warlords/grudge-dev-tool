import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import * as toolPaths from "../toolPaths";

const nodeRequire = createRequire(join(__dirname, "..", "..", "package.json"));

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

const WIN_BLENDER_CANDIDATES = [
  "C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe",
  "C:\\Program Files\\Blender Foundation\\Blender 4.4\\blender.exe",
  "C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe",
  "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe",
  "C:\\Program Files\\Blender Foundation\\Blender 4.1\\blender.exe",
];

function firstExisting(paths: string[]): string | null {
  for (const p of paths) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

export async function detectBlender(): Promise<ToolStatus> {
  const stored = await toolPaths.getToolPath("blender");
  const envPath = process.env.BLENDER_PATH;
  const path = stored
    ?? (envPath && existsSync(envPath) ? envPath : null)
    ?? which("blender")
    ?? firstExisting(WIN_BLENDER_CANDIDATES);
  if (!path) {
    return {
      name: "Blender",
      available: false,
      reason: "Not found — install Blender 4.x or set path in Accounts → Toolchain.",
    };
  }
  const version = probeVersion(path, ["--version"]);
  return { name: "Blender", available: true, path, version };
}

const WIN_FFMPEG_CANDIDATES = [
  "C:\\ffmpeg\\bin\\ffmpeg.exe",
  "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
  "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe",
];

export async function detectFfmpeg(): Promise<ToolStatus> {
  const stored = await toolPaths.getToolPath("ffmpeg");
  const path = stored ?? which("ffmpeg") ?? firstExisting(WIN_FFMPEG_CANDIDATES);
  if (!path) return { name: "ffmpeg", available: false, reason: "Not found — install ffmpeg or set path in Accounts." };
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

export function detectGltfTransform(): ToolStatus {
  try {
    const pkgPath = nodeRequire.resolve("@gltf-transform/core/package.json");
    const pkg = nodeRequire(pkgPath) as { version?: string };
    return { name: "gltf-transform", available: true, version: pkg.version ?? "bundled" };
  } catch {
    return {
      name: "gltf-transform",
      available: false,
      reason: "@gltf-transform/core not resolvable — run npm install in app root.",
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
    await detectBlender(),
    await detectFfmpeg(),
    await detectBlenderKit(),
  ];
}
