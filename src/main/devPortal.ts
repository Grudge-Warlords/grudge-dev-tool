import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { shell } from "electron";
import log from "./logger";
import * as coder from "./coder";
import { isAllowedDevCommand, type LocalPod } from "../shared/devPortal";

const execFileAsync = promisify(execFile);

let lastProjectDir: string | null = null;

const DEFAULT_PROJECT_DIRS = [
  "C:\\Users\\david\\grudge-build",
  "D:\\GrudgeRepos\\RTS-Grudge",
  "D:\\repos\\grudge-dev-tool-gh",
  "F:\\GitHub\\GrudachainCode",
];

export function getDefaultProjectDir(): string {
  for (const p of DEFAULT_PROJECT_DIRS) {
    if (existsSync(join(p, "package.json"))) return p;
  }
  return DEFAULT_PROJECT_DIRS[0];
}

export function setWorkspaceDir(dir: string): void {
  lastProjectDir = resolve(dir);
}

export function getWorkspaceDir(): string {
  return lastProjectDir ?? getDefaultProjectDir();
}

export async function runTerminalCommand(cmd: string, cwd?: string): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}> {
  if (!isAllowedDevCommand(cmd)) {
    return { ok: false, stdout: "", stderr: `Command not allowed: ${cmd}`, exitCode: 1 };
  }
  const workDir = cwd ? resolve(cwd) : getWorkspaceDir();
  log.info(`[devPortal] exec: ${cmd} cwd=${workDir}`);
  try {
    const { stdout, stderr } = await execFileAsync(
      process.platform === "win32" ? "cmd.exe" : "sh",
      process.platform === "win32" ? ["/c", cmd] : ["-c", cmd],
      { cwd: workDir, maxBuffer: 2 * 1024 * 1024, timeout: 120_000 },
    );
    return { ok: true, stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      ok: false,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message ?? String(e),
      exitCode: typeof err.code === "number" ? err.code : 1,
    };
  }
}

export async function runNpmScript(script: string, cwd?: string): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
}> {
  const safe = script.replace(/[^a-zA-Z0-9:_-]/g, "");
  return runTerminalCommand(`npm run ${safe}`, cwd);
}

export async function openVsCode(dir?: string): Promise<{ ok: boolean; error?: string }> {
  const target = resolve(dir ?? getWorkspaceDir());
  if (!existsSync(target)) return { ok: false, error: `Path not found: ${target}` };
  const commands: Array<[string, string[]]> = process.platform === "win32"
    ? [["cmd", ["/c", "code", target]], ["cmd", ["/c", "cursor", target]]]
    : [["code", [target]], ["cursor", [target]]];
  for (const [bin, args] of commands) {
    try {
      await execFileAsync(bin, args, { timeout: 15_000 });
      return { ok: true };
    } catch { /* try next */ }
  }
  try {
    await shell.openPath(target);
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function probeOllama(): Promise<LocalPod | null> {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    return {
      id: "ollama-local",
      name: "Ollama",
      kind: "ollama",
      status: "running",
      url: "http://127.0.0.1:11434",
    };
  } catch {
    return {
      id: "ollama-local",
      name: "Ollama",
      kind: "node",
      status: "stopped",
    };
  }
}

export async function listLocalPods(): Promise<LocalPod[]> {
  const pods: LocalPod[] = [];
  const coderStatus = coder.getStatus();
  pods.push({
    id: "coder-ide",
    name: "GrudgeChain Coder",
    kind: "coder",
    status: coderStatus.running ? "running" : coderStatus.error ? "error" : "stopped",
    url: coderStatus.url || undefined,
    pid: coderStatus.pid,
    port: coderStatus.port || undefined,
    projectDir: coderStatus.projectDir,
  });
  pods.push({
    id: "forge-3d",
    name: "Forge 3D / WebGL",
    kind: "forge",
    status: "stopped",
    url: undefined,
    projectDir: getWorkspaceDir(),
  });
  const ollama = await probeOllama();
  if (ollama) pods.push(ollama);
  return pods;
}

export function spawnNodeScript(scriptPath: string, cwd?: string): { ok: boolean; pid?: number; error?: string } {
  const workDir = cwd ? resolve(cwd) : getWorkspaceDir();
  const abs = resolve(workDir, scriptPath);
  if (!existsSync(abs)) return { ok: false, error: `Script not found: ${abs}` };
  try {
    const child = spawn("node", [abs], { cwd: workDir, stdio: "pipe", detached: true });
    child.unref();
    return { ok: true, pid: child.pid };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}