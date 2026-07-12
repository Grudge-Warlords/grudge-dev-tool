import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { app } from "electron";

export interface ToolStatus {
  name: string;
  available: boolean;
  version?: string;
  path?: string;
  reason?: string;
  /** When false, hide from Settings (retired tools). */
  show?: boolean;
}

function which(cmd: string): string | null {
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

/** Resolve require() roots that work in Electron main (dist/main) and packaged builds. */
function packageRoots(): string[] {
  const roots: string[] = [];
  try {
    if (app?.isPackaged) {
      roots.push(process.resourcesPath);
      roots.push(join(process.resourcesPath, "app.asar"));
      roots.push(join(process.resourcesPath, "app.asar.unpacked"));
    }
  } catch { /* app not ready */ }
  // source / dev: dist/main → repo root
  roots.push(join(__dirname, "..", ".."));
  roots.push(process.cwd());
  try {
    roots.push(app.getAppPath());
  } catch { /* */ }
  return [...new Set(roots.filter(Boolean))];
}

function resolveFromApp(moduleId: string): { path: string; version?: string } | null {
  for (const root of packageRoots()) {
    try {
      const req = createRequire(join(root, "package.json"));
      const resolved = req.resolve(moduleId);
      let version: string | undefined;
      try {
        const fs = require("node:fs") as typeof import("node:fs");
        // Walk up from resolved file for package.json (exports map often hides package.json)
        let dir = dirname(resolved);
        for (let i = 0; i < 6; i++) {
          const pkgPath = join(dir, "package.json");
          if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string; name?: string };
            if (pkg.name?.includes(moduleId.split("/").pop() || "") || pkg.version) {
              version = pkg.version;
              break;
            }
          }
          const parent = dirname(dir);
          if (parent === dir) break;
          dir = parent;
        }
      } catch { /* */ }
      return { path: resolved, version };
    } catch { /* try next root */ }
  }
  return null;
}

export function toolsDir(): string {
  try {
    return join(app.getPath("userData"), "tools");
  } catch {
    // Fallback when app not ready — match productName userData when possible
    const roaming = process.env.APPDATA || process.cwd();
    for (const name of ["Grudge Studio", "grudge-dev-tool"]) {
      const p = join(roaming, name, "tools");
      if (existsSync(p)) return p;
    }
    return join(roaming, "Grudge Studio", "tools");
  }
}

export function ffmpegCandidates(): string[] {
  const t = toolsDir();
  const list = [
    process.env.FFMPEG_PATH || "",
    which("ffmpeg") || "",
    join(t, "ffmpeg", "ffmpeg.exe"),
    join(t, "ffmpeg", "bin", "ffmpeg.exe"),
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Links", "ffmpeg.exe"),
    join(process.env.USERPROFILE || "", "scoop", "shims", "ffmpeg.exe"),
    "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe",
  ].filter(Boolean);

  // Scan tools/ffmpeg for nested release folders
  const scanRoot = join(t, "ffmpeg");
  if (existsSync(scanRoot)) {
    try {
      for (const ent of readdirSync(scanRoot, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        list.push(join(scanRoot, ent.name, "bin", "ffmpeg.exe"));
        list.push(join(scanRoot, ent.name, "ffmpeg.exe"));
      }
    } catch { /* */ }
  }
  return list;
}

export function detectFfmpeg(): ToolStatus {
  for (const path of ffmpegCandidates()) {
    if (path && existsSync(path)) {
      return {
        name: "ffmpeg",
        available: true,
        path,
        version: probeVersion(path, ["-version"]),
      };
    }
  }
  return {
    name: "ffmpeg",
    available: false,
    reason: "Not found. Use Settings → Toolchain → Install ffmpeg (downloads portable build).",
  };
}

export function detectSharp(): ToolStatus {
  try {
    // sharp is a devDependency used by icons; still probe if present
    const hit = resolveFromApp("sharp");
    if (hit) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sharp = require(hit.path);
      return { name: "sharp", available: true, version: sharp.versions?.sharp ?? hit.version, path: hit.path };
    }
    return { name: "sharp", available: false, reason: "Optional image toolkit not loaded" };
  } catch (err: any) {
    return { name: "sharp", available: false, reason: err?.message ?? "unavailable" };
  }
}

export function detectGltfTransform(): ToolStatus {
  const core = resolveFromApp("@gltf-transform/core");
  if (!core) {
    return {
      name: "gltf-transform",
      available: false,
      reason: "@gltf-transform/core not resolvable — run npm install in the Studio repo.",
    };
  }
  return {
    name: "gltf-transform",
    available: true,
    version: core.version,
    path: core.path,
  };
}

export function detectOllamaBinary(): ToolStatus {
  const candidates = [
    process.env.OLLAMA_PATH || "",
    which("ollama") || "",
    join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe"),
    "C:\\Program Files\\Ollama\\ollama.exe",
    join(process.env.USERPROFILE || "", "AppData", "Local", "Programs", "Ollama", "ollama.exe"),
  ].filter(Boolean);
  for (const path of candidates) {
    if (existsSync(path)) {
      return { name: "ollama-bin", available: true, path, version: probeVersion(path, ["--version"]) };
    }
  }
  return {
    name: "ollama-bin",
    available: false,
    reason: "Ollama not installed. Install from https://ollama.com/download then click Setup.",
  };
}

export function detectAnythingLlmBinary(): ToolStatus {
  const candidates = [
    process.env.ANYTHINGLLM_PATH || "",
    join(process.env.LOCALAPPDATA || "", "Programs", "AnythingLLM", "AnythingLLM.exe"),
    "C:\\Program Files\\AnythingLLM\\AnythingLLM.exe",
  ].filter(Boolean);
  for (const path of candidates) {
    if (existsSync(path)) {
      return { name: "anythingllm-bin", available: true, path };
    }
  }
  return {
    name: "anythingllm-bin",
    available: false,
    reason: "AnythingLLM Desktop not found. Install from https://anythingllm.com then click Start RAG.",
  };
}

/** Retired — kept as stubs so old ingestion imports do not crash. */
export function detectBlender(): ToolStatus {
  return {
    name: "Blender",
    available: false,
    reason: "Not used by Grudge Studio (retired).",
    show: false,
  };
}

/** Retired — BlenderKit pipeline removed from Studio. */
export function detectBlenderKit(): ToolStatus {
  return {
    name: "BlenderKit",
    available: false,
    reason: "Not used by Grudge Studio (retired).",
    show: false,
  };
}

/**
 * Tools shown in Settings. Blender / BlenderKit retired (not listed).
 */
export function detectAll(): ToolStatus[] {
  return [
    detectGltfTransform(),
    detectFfmpeg(),
    detectSharp(),
    detectOllamaBinary(),
    detectAnythingLlmBinary(),
  ];
}

/** Module require helper for modelInspect (same resolution strategy). */
export function requireFromApp(moduleId: string): any {
  const hit = resolveFromApp(moduleId);
  if (!hit) throw new Error(`Cannot resolve ${moduleId}`);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(hit.path);
}
