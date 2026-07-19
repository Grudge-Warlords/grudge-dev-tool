// Manages local dev servers + build-preview for Grudge Studio projects.
// Powers the Preview tab Dev Environment panel and agent handoff files.

import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  watch,
  mkdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BrowserWindow } from "electron";
import { app } from "electron";
import log from "./logger";
import {
  mergeDevProjects,
  type DevProject,
  type DevServerMode,
} from "../shared/devProjects";

export interface DevServerStatus {
  projectId: string;
  running: boolean;
  mode: DevServerMode | null;
  port: number;
  url: string;
  pid: number | null;
  error: string | null;
  building: boolean;
  lastLog: string[];
}

interface RunningServer {
  child: ChildProcess;
  projectId: string;
  mode: DevServerMode;
  port: number;
  logs: string[];
}

const servers = new Map<string, RunningServer>();
let handoffWatcher: ReturnType<typeof watch> | null = null;
let mainWindowRef: BrowserWindow | null = null;

const URL_RE =
  /(?:Local:\s+|➜\s+Local:\s+|ready in .+?\n)(https?:\/\/[^\s]+|localhost:\d+)/i;
const PORT_RE = /localhost:(\d{4,5})/i;

function handoffPath(): string {
  return join(app.getPath("userData"), "preview-handoff.json");
}

function pushLog(entry: RunningServer, line: string): void {
  entry.logs.push(line);
  if (entry.logs.length > 80) entry.logs.shift();
}

function parseUrlFromLog(line: string, fallbackPort: number): string {
  const m = line.match(URL_RE);
  if (m?.[1]) {
    const hit = m[1];
    return hit.startsWith("http") ? hit : `http://${hit}`;
  }
  const p = line.match(PORT_RE);
  if (p?.[1]) return `http://localhost:${p[1]}`;
  if (fallbackPort) return `http://localhost:${fallbackPort}`;
  return "";
}

function shellCommand(project: DevProject, cmd: string): string {
  const pm = project.packageManager ?? "pnpm";
  if (pm === "npm") return cmd.replace(/^pnpm\b/, "npm run").replace(/^pnpm /, "npm ");
  return cmd;
}

export function setDevEnvMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win;
}

export function listDevProjects(): DevProject[] {
  // Static fleet presets from shared/devProjects — no parallel coder manifest system.
  return mergeDevProjects([]).filter((p) => existsSync(p.rootDir));
}

export function getDevProject(id: string): DevProject | null {
  return listDevProjects().find((p) => p.id === id) ?? null;
}

export function getAllDevStatus(): DevServerStatus[] {
  const projects = listDevProjects();
  return projects.map((p) => {
    const run = servers.get(p.id);
    const port = run?.port ?? p.defaultPort ?? 0;
    return {
      projectId: p.id,
      running: !!run && !run.child.killed,
      mode: run?.mode ?? null,
      port,
      url: run ? parseUrlFromLog(run.logs.join("\n"), port) || `http://localhost:${port}` : "",
      pid: run?.child.pid ?? null,
      error: null,
      building: false,
      lastLog: run?.logs.slice(-12) ?? [],
    };
  });
}

export function getProjectStatus(projectId: string): DevServerStatus {
  const all = getAllDevStatus();
  return all.find((s) => s.projectId === projectId) ?? {
    projectId,
    running: false,
    mode: null,
    port: 0,
    url: "",
    pid: null,
    error: "Unknown project",
    building: false,
    lastLog: [],
  };
}

function stopProject(projectId: string): void {
  const run = servers.get(projectId);
  if (!run) return;
  if (!run.child.killed) {
    run.child.kill("SIGTERM");
    setTimeout(() => {
      if (!run.child.killed) run.child.kill("SIGKILL");
    }, 2500);
  }
  servers.delete(projectId);
}

export function stopDev(projectId: string): DevServerStatus {
  stopProject(projectId);
  return getProjectStatus(projectId);
}

export function stopAllDev(): void {
  for (const id of [...servers.keys()]) stopProject(id);
}

function spawnProjectCommand(
  project: DevProject,
  command: string,
  mode: DevServerMode,
): Promise<DevServerStatus> {
  stopProject(project.id);

  const root = resolve(project.rootDir);
  if (!existsSync(join(root, "package.json"))) {
    return Promise.resolve({
      ...getProjectStatus(project.id),
      error: `No package.json in ${root}`,
    });
  }

  const cmd = shellCommand(project, command);
  log.info(`[devEnv] ${project.id} ${mode}: ${cmd} (cwd=${root})`);

  const child = spawn(cmd, {
    cwd: root,
    shell: true,
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: "pipe",
  });

  const entry: RunningServer = {
    child,
    projectId: project.id,
    mode,
    port: project.defaultPort ?? 5173,
    logs: [],
  };
  servers.set(project.id, entry);

  const onData = (buf: Buffer) => {
    const text = buf.toString();
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      pushLog(entry, t);
      const url = parseUrlFromLog(t, entry.port);
      if (url) {
        const portMatch = url.match(PORT_RE);
        if (portMatch?.[1]) entry.port = Number(portMatch[1]);
      }
    }
  };

  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  child.on("exit", (code) => {
    pushLog(entry, `[exit ${code ?? "?"}]`);
    if (servers.get(project.id) === entry) servers.delete(project.id);
  });
  child.on("error", (err) => {
    pushLog(entry, `[error] ${err.message}`);
  });

  return new Promise((resolve) => {
    setTimeout(() => resolve(getProjectStatus(project.id)), 1200);
  });
}

export async function startDev(projectId: string): Promise<DevServerStatus> {
  const project = getDevProject(projectId);
  if (!project) return { ...getProjectStatus(projectId), error: "Project not found" };
  return spawnProjectCommand(project, project.devCommand ?? "pnpm dev", "dev");
}

export async function startPreviewServer(projectId: string): Promise<DevServerStatus> {
  const project = getDevProject(projectId);
  if (!project) return { ...getProjectStatus(projectId), error: "Project not found" };
  const cmd = project.previewCommand ?? "pnpm exec vite preview --host 0.0.0.0";
  return spawnProjectCommand(project, cmd, "preview");
}

function distFileUrl(project: DevProject): string | null {
  const rel = project.distIndex ?? "dist/index.html";
  const abs = join(resolve(project.rootDir), rel);
  if (!existsSync(abs)) return null;
  return pathToFileURL(abs).toString();
}

export async function buildProject(projectId: string): Promise<DevServerStatus> {
  const project = getDevProject(projectId);
  if (!project) return { ...getProjectStatus(projectId), error: "Project not found" };

  const root = resolve(project.rootDir);
  const cmd = shellCommand(project, project.buildCommand ?? "pnpm build");
  log.info(`[devEnv] build ${project.id}: ${cmd}`);

  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd: root, shell: true, stdio: "pipe" });
    const logs: string[] = [];
    const onData = (buf: Buffer) => {
      for (const line of buf.toString().split(/\r?\n/)) {
        if (line.trim()) logs.push(line.trim());
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => {
      if (code !== 0) {
        resolve({
          projectId,
          running: false,
          mode: null,
          port: 0,
          url: "",
          pid: null,
          error: `Build failed (exit ${code})`,
          building: false,
          lastLog: logs.slice(-20),
        });
        return;
      }
      const fileUrl = distFileUrl(project);
      resolve({
        projectId,
        running: false,
        mode: null,
        port: 0,
        url: fileUrl ?? "",
        pid: null,
        error: fileUrl ? null : "Build OK but dist index not found",
        building: false,
        lastLog: logs.slice(-20),
      });
    });
  });
}

export async function buildAndOpenPreview(projectId: string): Promise<DevServerStatus> {
  const built = await buildProject(projectId);
  if (built.error || !built.url) return built;
  openPreviewInApp(built.url, projectId);
  return built;
}

/** Navigate main window to Preview and load URL (local dev, file://, or remote). */
export function openPreviewInApp(url: string, projectId?: string): void {
  const win = mainWindowRef;
  if (!win) {
    writePreviewHandoff(url, projectId);
    return;
  }
  win.show();
  win.focus();
  win.webContents.send("nav", "/preview");
  setTimeout(() => {
    win.webContents.send("preview:load", { url, projectId: projectId ?? null });
  }, 80);
  log.info(`[devEnv] preview → ${url}`);
}

export function writePreviewHandoff(url: string, projectId?: string): void {
  const p = handoffPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(
    p,
    JSON.stringify({ url, projectId: projectId ?? null, at: new Date().toISOString() }, null, 2),
    "utf-8",
  );
}

export function readPreviewHandoff(): { url: string; projectId: string | null; at: string } | null {
  const p = handoffPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

export function clearPreviewHandoff(): void {
  const p = handoffPath();
  if (existsSync(p)) writeFileSync(p, "{}", "utf-8");
}

/** Watch handoff file so Cursor/agents can push preview URLs while the app runs. */
export function startHandoffWatcher(): void {
  if (handoffWatcher) return;
  const p = handoffPath();
  mkdirSync(dirname(p), { recursive: true });
  if (!existsSync(p)) writeFileSync(p, "{}", "utf-8");

  let debounce: ReturnType<typeof setTimeout> | null = null;
  handoffWatcher = watch(p, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      const handoff = readPreviewHandoff();
      if (handoff?.url) openPreviewInApp(handoff.url, handoff.projectId ?? undefined);
    }, 200);
  });
  log.info(`[devEnv] handoff watcher: ${p}`);
}

export function shutdownDevEnv(): void {
  stopAllDev();
  handoffWatcher?.close();
  handoffWatcher = null;
}