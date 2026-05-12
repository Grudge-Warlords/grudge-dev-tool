// src/main/coder.ts
//
// Manages the local GrudgeChain Vibe IDE (coder.grudge-studio.com) as a child
// process. Launches the Node.js server from GrudachainCode, tracks its state,
// and exposes IPC for the renderer to start/stop/check the coder.

import { spawn, ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { shell } from "electron";
import log from "./logger";

export interface CoderStatus {
  running: boolean;
  port: number;
  url: string;
  pid: number | null;
  projectDir: string | null;
  error: string | null;
}

let child: ChildProcess | null = null;
let currentPort = 0;
let currentDir: string | null = null;
let lastError: string | null = null;

/**
 * Default paths where GrudachainCode may live. We check these in order.
 * The user can override via the `dir` argument to `launch()`.
 */
const CODER_CANDIDATES = [
  "F:\\GitHub\\GrudachainCode",
  "D:\\GitHub\\GrudachainCode",
  join(process.env.HOME ?? process.env.USERPROFILE ?? "", "GrudachainCode"),
];

function findCoderRoot(): string | null {
  for (const p of CODER_CANDIDATES) {
    if (existsSync(join(p, "package.json"))) return p;
  }
  return null;
}

/**
 * Launch the GrudachainCode IDE server targeting a specific project directory.
 * Uses the `bin/grudge-ide.js` entry or falls back to `npm run dev`.
 */
export async function launch(opts?: {
  projectDir?: string;
  port?: number;
}): Promise<CoderStatus> {
  if (child && !child.killed) {
    return getStatus();
  }

  const coderRoot = findCoderRoot();
  if (!coderRoot) {
    lastError = "GrudachainCode not found. Expected at F:\\GitHub\\GrudachainCode.";
    log.error(`[coder] ${lastError}`);
    return getStatus();
  }

  const port = opts?.port ?? 5111;
  const projectDir = opts?.projectDir ?? coderRoot;
  currentPort = port;
  currentDir = projectDir;
  lastError = null;

  // Prefer the built entry point (bin/grudge-ide.js) if dist exists,
  // otherwise fall back to the dev server via tsx.
  const builtEntry = join(coderRoot, "dist", "index.cjs");
  const hasDist = existsSync(builtEntry);

  const env = {
    ...process.env,
    NODE_ENV: hasDist ? "production" : "development",
    PORT: String(port),
    ENABLE_LOCAL_FS: "true",
    WORKSPACE_ROOT: resolve(projectDir),
    PTY_CWD: resolve(projectDir),
    SESSION_SECRET: `grudge-forge-${Date.now()}`,
  };

  log.info(`[coder] launching: port=${port} dir=${projectDir} mode=${hasDist ? "prod" : "dev"} root=${coderRoot}`);

  try {
    if (hasDist) {
      child = spawn("node", [builtEntry], { cwd: coderRoot, env, stdio: "pipe" });
    } else {
      // Dev mode: use npx tsx to run the TS entry directly
      child = spawn("npx", ["tsx", "server/index.ts"], {
        cwd: coderRoot, env, stdio: "pipe", shell: true,
      });
    }

    child.stdout?.on("data", (buf: Buffer) => {
      const line = buf.toString().trim();
      if (line) log.info(`[coder:out] ${line}`);
    });
    child.stderr?.on("data", (buf: Buffer) => {
      const line = buf.toString().trim();
      if (line) log.warn(`[coder:err] ${line}`);
    });
    child.on("exit", (code) => {
      log.info(`[coder] process exited with code ${code}`);
      child = null;
      if (code && code !== 0) {
        lastError = `Coder exited with code ${code}`;
      }
    });
    child.on("error", (err) => {
      lastError = err.message;
      log.error(`[coder] spawn error: ${err.message}`);
      child = null;
    });
  } catch (err: any) {
    lastError = err?.message ?? String(err);
    log.error(`[coder] launch failed: ${lastError}`);
  }

  return getStatus();
}

export function stop(): CoderStatus {
  if (child && !child.killed) {
    log.info("[coder] stopping child process");
    child.kill("SIGTERM");
    // Force kill after 3s if still alive
    setTimeout(() => {
      if (child && !child.killed) {
        child.kill("SIGKILL");
      }
    }, 3000);
  }
  child = null;
  return getStatus();
}

export function getStatus(): CoderStatus {
  return {
    running: child != null && !child.killed,
    port: currentPort,
    url: currentPort ? `http://localhost:${currentPort}` : "",
    pid: child?.pid ?? null,
    projectDir: currentDir,
    error: lastError,
  };
}

export function openInBrowser(): void {
  if (currentPort) {
    shell.openExternal(`http://localhost:${currentPort}`);
  }
}

/** Clean shutdown — call from app before-quit. */
export function shutdownCoder(): void {
  if (child && !child.killed) {
    child.kill("SIGTERM");
  }
}
