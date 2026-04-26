import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

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

export function detectBlender(): ToolStatus {
  const envPath = process.env.BLENDER_PATH;
  const path = (envPath && existsSync(envPath)) ? envPath : which("blender");
  if (!path) {
    return {
      name: "Blender",
      available: false,
      reason: "Not found on PATH. Set BLENDER_PATH or install Blender 4.x.",
    };
  }
  const version = probeVersion(path, ["--version"]);
  return { name: "Blender", available: true, path, version };
}

export function detectFfmpeg(): ToolStatus {
  const path = which("ffmpeg");
  if (!path) return { name: "ffmpeg", available: false, reason: "Not found on PATH." };
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
    require.resolve("@gltf-transform/core");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require("@gltf-transform/core/package.json");
    return { name: "gltf-transform", available: true, version: pkg.version };
  } catch {
    return {
      name: "gltf-transform",
      available: false,
      reason: "@gltf-transform/core not installed (model probe / rig inspection disabled).",
    };
  }
}

/**
 * Detect a local BlenderKit addon install. We never bundle GPL addon files
 * inside this app — we just point Blender at an existing on-disk install via
 * the BLENDERKIT_PATH env var or a pinned default path.
 */
export function detectBlenderKit(): ToolStatus {
  const PINNED = "F:\\blenderkit-v3.19.2.260411\\blenderkit";
  const candidate = process.env.BLENDERKIT_PATH || PINNED;
  const manifest = `${candidate}\\blender_manifest.toml`;
  if (!existsSync(manifest)) {
    return {
      name: "BlenderKit",
      available: false,
      reason: `Addon not found at ${candidate}. Set BLENDERKIT_PATH or place the addon there.`,
    };
  }
  // Best-effort version probe (read first 30 lines of manifest)
  let version: string | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("node:fs");
    const text: string = fs.readFileSync(manifest, "utf8");
    const m = text.match(/version\s*=\s*"([^"]+)"/);
    if (m) version = m[1];
  } catch { /* ignore */ }
  return { name: "BlenderKit", available: true, path: candidate, version };
}

export function detectAll(): ToolStatus[] {
  return [
    detectSharp(),
    detectGltfTransform(),
    detectBlender(),
    detectFfmpeg(),
    detectBlenderKit(),
  ];
}
