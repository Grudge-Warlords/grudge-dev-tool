// Manages local The-ENGINE dev server (Grudge Studio portal) as a child process.

import { spawn, ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { shell } from "electron";
import log from "./logger";
import * as workspaceStore from "./workspaceStore";

export interface EngineStatus {
  running: boolean;
  port: number;
  url: string;
  pid: number | null;
  engineRoot: string | null;
  error: string | null;
}

let child: ChildProcess | null = null;
let currentPort = 0;
let currentRoot: string | null = null;
let lastError: string | null = null;

const ENGINE_CANDIDATES = [
  join(process.env.USERPROFILE ?? "", "Desktop", "The-ENGINE"),
  "F:\\GitHub\\The-ENGINE",
  "D:\\GitHub\\The-ENGINE",
  join(process.env.USERPROFILE ?? "", "The-ENGINE"),
];

function isEngineRoot(dir: string): boolean {
  return existsSync(join(dir, "package.json")) && existsSync(join(dir, "client"));
}

function findEngineRoot(): string | null {
  for (const p of ENGINE_CANDIDATES) {
    if (isEngineRoot(p)) return p;
  }
  return null;
}

async function resolveEngineRoot(override?: string): Promise<string | null> {
  if (override && isEngineRoot(override)) return resolve(override);
  const ws = await workspaceStore.loadWorkspace();
  if (ws.engineRoot && isEngineRoot(ws.engineRoot)) return resolve(ws.engineRoot);
  return findEngineRoot();
}

export async function launch(opts?: { port?: number; engineRoot?: string }): Promise<EngineStatus> {
  if (child && !child.killed) return getStatus();

  const ws = await workspaceStore.loadWorkspace();
  const engineRoot = await resolveEngineRoot(opts?.engineRoot);
  if (!engineRoot) {
    lastError = "The-ENGINE not found — pick the repo root in Grudge Engine settings.";
    log.error(`[engine] ${lastError}`);
    return getStatus();
  }

  const port = opts?.port ?? ws.enginePort ?? 5000;
  currentPort = port;
  currentRoot = engineRoot;
  lastError = null;

  await workspaceStore.saveWorkspace({ engineRoot, enginePort: port });

  const env: Record<string, string | undefined> = {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(port),
    PORTAL_ORIGIN: `http://localhost:${port}`,
  };

  log.info(`[engine] launching: port=${port} root=${engineRoot}`);

  try {
    child = spawn("npm", ["run", "dev"], {
      cwd: engineRoot,
      env,
      stdio: "pipe",
      shell: true,
    });

    child.stdout?.on("data", (buf: Buffer) => {
      const line = buf.toString().trim();
      if (line) log.info(`[engine:out] ${line}`);
    });
    child.stderr?.on("data", (buf: Buffer) => {
      const line = buf.toString().trim();
      if (line) log.warn(`[engine:err] ${line}`);
    });
    child.on("exit", (code) => {
      log.info(`[engine] process exited with code ${code}`);
      child = null;
      if (code && code !== 0) lastError = `Engine exited with code ${code}`;
    });
    child.on("error", (err) => {
      lastError = err.message;
      log.error(`[engine] spawn error: ${err.message}`);
      child = null;
    });
  } catch (err: unknown) {
    lastError = err instanceof Error ? err.message : String(err);
    log.error(`[engine] launch failed: ${lastError}`);
  }

  return getStatus();
}

export function stop(): EngineStatus {
  if (child && !child.killed) {
    log.info("[engine] stopping child process");
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child && !child.killed) child.kill("SIGKILL");
    }, 3000);
  }
  child = null;
  return getStatus();
}

export function getStatus(): EngineStatus {
  return {
    running: child != null && !child.killed,
    port: currentPort,
    url: currentPort ? `http://localhost:${currentPort}` : "",
    pid: child?.pid ?? null,
    engineRoot: currentRoot,
    error: lastError,
  };
}

export function openInBrowser(path = "/"): void {
  if (!currentPort) return;
  const p = path.startsWith("/") ? path : `/${path}`;
  shell.openExternal(`http://localhost:${currentPort}${p}`);
}

export function shutdownEngine(): void {
  if (child && !child.killed) child.kill("SIGTERM");
}