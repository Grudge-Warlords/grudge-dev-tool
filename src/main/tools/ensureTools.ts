/**
 * Ensure portable tools (ffmpeg) and start local AI services (Ollama, AnythingLLM).
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createRequire } from "node:module";
import { app, shell } from "electron";
import {
  detectAnythingLlmBinary,
  detectFfmpeg,
  detectOllamaBinary,
  ffmpegCandidates,
  toolsDir,
} from "../ingestion/toolchain";
import * as ollama from "../ollama";
import * as anythingllm from "../ai/anythingllm";
import log from "../logger";

const FFMPEG_ZIP_URL =
  process.env.GRUDGE_FFMPEG_ZIP_URL ||
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(300_000) });
  if (!res.ok || !res.body) throw new Error(`Download failed HTTP ${res.status}`);
  await pipeline(res.body as any, createWriteStream(dest));
}

function findFfmpegUnder(root: string): string | null {
  if (!existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    try {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, ent.name);
        if (ent.isFile() && ent.name.toLowerCase() === "ffmpeg.exe") return full;
        if (ent.isDirectory()) stack.push(full);
      }
    } catch { /* */ }
  }
  return null;
}

export async function ensureFfmpeg(): Promise<{
  ok: boolean;
  path?: string;
  message: string;
  installed?: boolean;
}> {
  const existing = detectFfmpeg();
  if (existing.available && existing.path) {
    return { ok: true, path: existing.path, message: "ffmpeg already available", installed: false };
  }

  const root = join(toolsDir(), "ffmpeg");
  ensureDir(root);
  const zipPath = join(toolsDir(), "ffmpeg-download.zip");

  try {
    log.info("[tools] downloading portable ffmpeg…");
    await downloadFile(FFMPEG_ZIP_URL, zipPath);

    // Prefer adm-zip if present; else PowerShell Expand-Archive
    let extracted = false;
    try {
      const req = createRequire(join(process.cwd(), "package.json"));
      // optional
      const AdmZip = req("adm-zip");
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(root, true);
      extracted = true;
    } catch {
      const r = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-Command", `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${root.replace(/'/g, "''")}' -Force`],
        { encoding: "utf8", timeout: 120_000 },
      );
      extracted = r.status === 0;
      if (!extracted) throw new Error(r.stderr || "Expand-Archive failed");
    }

    try { rmSync(zipPath, { force: true }); } catch { /* */ }

    const bin = findFfmpegUnder(root);
    if (!bin) throw new Error("ffmpeg.exe not found after extract");
    log.info("[tools] ffmpeg installed at", bin);
    return { ok: true, path: bin, message: "ffmpeg portable installed", installed: true };
  } catch (e: any) {
    log.warn("[tools] ffmpeg ensure failed:", e?.message);
    return {
      ok: false,
      message: e?.message ?? String(e),
    };
  }
}

export function resolveFfmpegPath(): string | null {
  for (const p of ffmpegCandidates()) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

export async function startOllama(): Promise<{ ok: boolean; message: string; alreadyRunning?: boolean }> {
  // Already up?
  try {
    const h = await ollama.ollamaHealth();
    if (h.ok) return { ok: true, message: "Ollama already running", alreadyRunning: true };
  } catch { /* */ }

  const bin = detectOllamaBinary();
  if (!bin.available || !bin.path) {
    return {
      ok: false,
      message: "Ollama is not installed. Download from https://ollama.com/download and re-run Setup.",
    };
  }

  try {
    // Launch tray app / serve
    const child = spawn(bin.path, ["serve"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch (e: any) {
    // Fallback: open the installer-app
    try {
      await shell.openPath(bin.path);
    } catch {
      return { ok: false, message: e?.message ?? "Failed to start Ollama" };
    }
  }

  // Wait up to ~20s for API
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const h = await ollama.ollamaHealth();
      if (h.ok) {
        // Prefer a small default model if none listed
        try {
          const models = await ollama.ollamaModels();
          if (!models.length) {
            // pull tiny model in background
            const pull = spawn(bin.path!, ["pull", "llama3.2:1b"], {
              detached: true,
              stdio: "ignore",
              windowsHide: true,
            });
            pull.unref();
            return {
              ok: true,
              message: "Ollama started — pulling llama3.2:1b in background (first run)",
            };
          }
          const preferred = await ollama.getPreferredModel();
          if (!preferred) await ollama.setPreferredModel(models[0].name);
        } catch { /* */ }
        return { ok: true, message: `Ollama online (${h.latencyMs}ms)` };
      }
    } catch { /* retry */ }
  }
  return { ok: false, message: "Ollama process launched but API not reachable yet — wait a few seconds and Test again." };
}

export async function setupOllamaFull(): Promise<{
  ok: boolean;
  steps: string[];
  health?: Awaited<ReturnType<typeof ollama.ollamaHealth>>;
}> {
  const steps: string[] = [];
  const bin = detectOllamaBinary();
  if (!bin.available) {
    steps.push("Ollama binary missing — open https://ollama.com/download");
    try { await shell.openExternal("https://ollama.com/download"); } catch { /* */ }
    return { ok: false, steps };
  }
  steps.push(`Found Ollama at ${bin.path}`);

  const start = await startOllama();
  steps.push(start.message);
  if (!start.ok && !start.alreadyRunning) return { ok: false, steps };

  try {
    const models = await ollama.ollamaModels();
    steps.push(models.length ? `Models: ${models.map((m) => m.name).join(", ")}` : "No models yet");
    if (!models.length && bin.path) {
      steps.push("Pulling llama3.2:1b (background)…");
      const pull = spawn(bin.path, ["pull", "llama3.2:1b"], { detached: true, stdio: "ignore", windowsHide: true });
      pull.unref();
    } else if (models[0]) {
      await ollama.setPreferredModel(models[0].name);
      steps.push(`Preferred model → ${models[0].name}`);
    }
    await ollama.setAiPreference("auto");
    steps.push("AI preference → auto (Ollama when online, cloud providers as fallback)");
  } catch (e: any) {
    steps.push(`Model setup: ${e?.message ?? e}`);
  }

  const health = await ollama.ollamaHealth();
  return { ok: health.ok, steps, health };
}

export async function startAnythingLlm(): Promise<{ ok: boolean; message: string; health?: any }> {
  const h0 = await anythingllm.anythingLlmHealth();
  if (h0.ping) {
    return {
      ok: h0.ok,
      message: h0.ok
        ? "AnythingLLM already online"
        : `AnythingLLM reachable but not authenticated (${h0.error ?? "set Developer API key"})`,
      health: h0,
    };
  }

  const bin = detectAnythingLlmBinary();
  if (!bin.available || !bin.path) {
    try { await shell.openExternal("https://anythingllm.com/download"); } catch { /* */ }
    return {
      ok: false,
      message: "AnythingLLM Desktop not installed — opened download page. Install, create a workspace, copy Developer API key into Settings.",
    };
  }

  try {
    await shell.openPath(bin.path);
  } catch (e: any) {
    return { ok: false, message: e?.message ?? "Failed to launch AnythingLLM" };
  }

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const h = await anythingllm.anythingLlmHealth();
    if (h.ping) {
      return {
        ok: h.ok,
        message: h.ok
          ? "AnythingLLM RAG online"
          : "AnythingLLM started — paste a Developer API key in Settings to finish auth",
        health: h,
      };
    }
  }
  return {
    ok: false,
    message: "AnythingLLM launched but /api/ping not up yet — wait and click Test RAG",
  };
}

export async function ensureAllTools(): Promise<{
  ffmpeg: Awaited<ReturnType<typeof ensureFfmpeg>>;
  ollama: Awaited<ReturnType<typeof setupOllamaFull>>;
  anythingllm: Awaited<ReturnType<typeof startAnythingLlm>>;
  gltf: { ok: boolean; version?: string };
}> {
  const { detectGltfTransform } = await import("../ingestion/toolchain");
  const gltf = detectGltfTransform();
  const ffmpeg = await ensureFfmpeg();
  const ollamaSetup = await setupOllamaFull();
  const allm = await startAnythingLlm();
  return {
    ffmpeg,
    ollama: ollamaSetup,
    anythingllm: allm,
    gltf: { ok: gltf.available, version: gltf.version },
  };
}
