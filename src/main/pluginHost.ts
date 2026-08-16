/**
 * Loopback plugin host — VS Code, standalone, CLI attach here.
 * Binds 127.0.0.1 only. Token required for agent / viewer / open.
 */

import http from "node:http";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, normalize, resolve as pathResolve } from "node:path";
import { inferContentType, isModelPath, isThreeScenePath } from "../shared/mediaTypes";
import { randomBytes } from "node:crypto";
import { app, shell } from "electron";
import log from "./logger";
import * as viewer from "./viewer";
import * as coder from "./coder";
import * as ollama from "./ollama";
import { localAgentChat, localAgentStatus, runLocalAgent } from "./agent/localAgent";
import { standalonePluginHtml } from "./plugin/standalonePage";
import {
  DEFAULT_PLUGIN_PORT,
  PLUGIN_LOOPBACK,
  PLUGIN_TOKEN_DIR_NAME,
  PLUGIN_TOKEN_FILE,
  PLUGIN_VERSION,
  pluginManifest,
  pluginOrigin,
  type PluginHealth,
  type PluginHostStatus,
  type PluginOpenRequest,
  type PluginViewerOpenRequest,
} from "../shared/plugin/contract";
import { listPluginPractices } from "../shared/plugin/practices";
import { FLEET_URLS } from "../shared/fleet";

let server: http.Server | null = null;
let status: PluginHostStatus | null = null;
let cachedToken = "";

function resolvePort(): number {
  const raw = process.env.GRUDGE_PLUGIN_PORT;
  const n = raw ? Number(raw) : DEFAULT_PLUGIN_PORT;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PLUGIN_PORT;
}

function discoverDir(): string {
  const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  return join(appData, PLUGIN_TOKEN_DIR_NAME);
}

async function ensureToken(): Promise<{ token: string; tokenPath: string; discoverPath: string }> {
  const userDir = app.getPath("userData");
  const tokenPath = join(userDir, PLUGIN_TOKEN_FILE);
  const discoverPath = join(discoverDir(), PLUGIN_TOKEN_FILE);
  let token = "";
  if (existsSync(tokenPath)) {
    token = (await readFile(tokenPath, "utf8")).trim();
  }
  if (!token) {
    token = randomBytes(24).toString("hex");
    await writeFile(tokenPath, token, "utf8");
  }
  try {
    await mkdir(discoverDir(), { recursive: true });
    await writeFile(discoverPath, token, "utf8");
  } catch (e) {
    log.warn(`[pluginHost] discover token write failed: ${e instanceof Error ? e.message : e}`);
  }
  cachedToken = token;
  return { token, tokenPath, discoverPath };
}

function readBearer(req: http.IncomingMessage): string {
  const auth = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  const hdr = req.headers["x-grudge-plugin-token"];
  return typeof hdr === "string" ? hdr.trim() : "";
}

function allowOrigin(req: http.IncomingMessage): string {
  const origin = req.headers.origin;
  if (!origin) return "*";
  if (
    origin.startsWith("vscode-") ||
    origin.startsWith("http://127.0.0.1") ||
    origin.startsWith("http://localhost") ||
    origin === "null"
  ) {
    return origin;
  }
  try {
    const host = new URL(origin).hostname;
    if (
      host === "threeflow.vercel.app" ||
      host.endsWith(".vercel.app") ||
      host.endsWith(".grudge-studio.com")
    ) {
      return origin;
    }
  } catch {
    /* keep default */
  }
  return "http://127.0.0.1";
}

function send(res: http.ServerResponse, req: http.IncomingMessage, statusCode: number, body: unknown): void {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const isHtml = typeof body === "string" && payload.startsWith("<!doctype");
  res.writeHead(statusCode, {
    "Content-Type": isHtml ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": allowOrigin(req),
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Grudge-Plugin-Token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

function requireToken(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!cachedToken) return true;
  if (readBearer(req) === cachedToken) return true;
  send(res, req, 401, { ok: false, error: "plugin_token_required" });
  return false;
}

async function healthPayload(): Promise<PluginHealth> {
  const port = status?.port ?? resolvePort();
  let ollamaUp = false;
  let agenticReady = false;
  try {
    const st = await localAgentStatus();
    ollamaUp = Boolean(st.ollama?.ok);
    agenticReady = st.ready;
  } catch {
    /* optional */
  }
  return {
    ok: true,
    host: "grudge-dev-tool",
    plugin: "grudge-studio-plugin",
    version: PLUGIN_VERSION,
    origin: pluginOrigin(port),
    port,
    tokenRequired: true,
    agentic: {
      ready: agenticReady,
      ollama: ollamaUp,
      cascade: "ollama → puter → env keys → workers/legion",
    },
    viewer: true,
    fleet: {
      ai: FLEET_URLS.ai,
      coder: FLEET_URLS.coder,
      forge: FLEET_URLS.forge,
      client: FLEET_URLS.client,
      assets: FLEET_URLS.assets,
      objectStore: FLEET_URLS.objectStore,
      id: FLEET_URLS.auth,
    },
  };
}

async function handleViewer(body: PluginViewerOpenRequest): Promise<unknown> {
  const localPath = typeof body.localPath === "string" ? body.localPath.trim() : "";
  if (localPath) {
    if (!existsSync(localPath)) return { ok: false, error: `path_not_found:${localPath}` };
    return viewer.openLocalPath(localPath, { contentType: body.contentType });
  }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) return { ok: false, error: "url_or_localPath_required" };
  return viewer.openViewer({
    name: body.name || url,
    url,
    contentType: body.contentType || "application/octet-stream",
    size: 0,
  });
}

async function handleOpen(body: PluginOpenRequest, showMain: () => void): Promise<unknown> {
  switch (body.target) {
    case "forge":
      await shell.openExternal(FLEET_URLS.forge);
      return { ok: true, url: FLEET_URLS.forge };
    case "coder":
      coder.openInBrowser();
      await shell.openExternal(FLEET_URLS.coder);
      return { ok: true, url: FLEET_URLS.coder };
    case "ai":
      await shell.openExternal(FLEET_URLS.ai);
      return { ok: true, url: FLEET_URLS.ai };
    case "devtools":
      showMain();
      return { ok: true, target: "devtools" };
    case "standalone":
      await shell.openExternal(pluginOrigin(status?.port ?? resolvePort()) + "/");
      return { ok: true, url: pluginOrigin(status?.port ?? resolvePort()) };
    default:
      return { ok: false, error: "unknown_target" };
  }
}

export async function startPluginHost(opts: { showMain: () => void }): Promise<PluginHostStatus> {
  if (status?.running && server) return status;
  const port = resolvePort();
  const { token, tokenPath, discoverPath } = await ensureToken();

  server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url || "/", `http://${PLUGIN_LOOPBACK}`);
        if (req.method === "OPTIONS") {
          send(res, req, 204, "");
          return;
        }
        if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
          send(res, req, 200, await healthPayload());
          return;
        }
        if (req.method === "GET" && url.pathname === "/v1/manifest") {
          send(res, req, 200, pluginManifest(port));
          return;
        }
        if (req.method === "GET" && url.pathname === "/v1/practices") {
          const source = url.searchParams.get("source") || undefined;
          const category = url.searchParams.get("category") || undefined;
          send(res, req, 200, {
            ok: true,
            practices: listPluginPractices({
              source: source as never,
              category,
            }),
          });
          return;
        }
        if (req.method === "GET" && url.pathname === "/v1/surfaces") {
          send(res, req, 200, {
            ok: true,
            surfaces: pluginManifest(port).surfaces,
            fleet: pluginManifest(port).fleet,
          });
          return;
        }
        if (req.method === "GET" && url.pathname === "/v1/local-file") {
          const raw = url.searchParams.get("path") || "";
          if (!raw.trim()) {
            send(res, req, 400, { ok: false, error: "path_required" });
            return;
          }
          const disk = pathResolve(normalize(raw.trim()));
          if (!existsSync(disk) || !statSync(disk).isFile()) {
            send(res, req, 404, { ok: false, error: "not_found" });
            return;
          }
          const name = basename(disk);
          if (!isModelPath(name) && !isThreeScenePath(name)) {
            send(res, req, 403, { ok: false, error: "not_a_mesh" });
            return;
          }
          const data = await readFile(disk);
          res.writeHead(200, {
            "Content-Type": inferContentType(name) || "application/octet-stream",
            "Access-Control-Allow-Origin": allowOrigin(req),
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Content-Disposition": `inline; filename="${name.replace(/"/g, "")}"`,
            "Cache-Control": "no-store",
          });
          res.end(data);
          return;
        }

        if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
          send(
            res,
            req,
            200,
            standalonePluginHtml({
              origin: pluginOrigin(port),
              token,
              version: app.getVersion(),
            }),
          );
          return;
        }

        if (req.method === "POST" && url.pathname === "/v1/agent/chat") {
          if (!requireToken(req, res)) return;
          const body = await readJson(req);
          const messages = Array.isArray(body.messages)
            ? (body.messages as Array<{ role: "system" | "user" | "assistant"; content: string }>)
            : [];
          if (!messages.length) {
            send(res, req, 400, { ok: false, error: "messages_required" });
            return;
          }
          const result = await localAgentChat(messages);
          send(res, req, 200, { ok: true, ...result });
          return;
        }

        if (req.method === "POST" && url.pathname === "/v1/agent/run") {
          if (!requireToken(req, res)) return;
          const body = await readJson(req);
          const task = typeof body.task === "string" ? body.task : "";
          if (!task.trim()) {
            send(res, req, 400, { ok: false, error: "task_required" });
            return;
          }
          const result = await runLocalAgent({
            task,
            role: typeof body.role === "string" ? body.role : "dev",
          });
          send(res, req, 200, { ok: true, ...result });
          return;
        }

        if (req.method === "POST" && url.pathname === "/v1/viewer/open") {
          if (!requireToken(req, res)) return;
          const body = (await readJson(req)) as unknown as PluginViewerOpenRequest;
          send(res, req, 200, await handleViewer(body));
          return;
        }

        if (req.method === "POST" && url.pathname === "/v1/open") {
          if (!requireToken(req, res)) return;
          const body = (await readJson(req)) as unknown as PluginOpenRequest;
          send(res, req, 200, await handleOpen(body, opts.showMain));
          return;
        }

        send(res, req, 404, { ok: false, error: "not_found" });
      } catch (e) {
        log.warn(`[pluginHost] ${e instanceof Error ? e.message : e}`);
        send(res, req, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(port, PLUGIN_LOOPBACK, () => resolve());
  });

  status = {
    running: true,
    origin: pluginOrigin(port),
    port,
    tokenPath,
    discoverPath,
  };
  log.info(`[pluginHost] listening ${status.origin} (token ${tokenPath})`);
  void ollama.ollamaHealth().catch(() => null);
  return status;
}

export function stopPluginHost(): void {
  if (server) {
    server.close();
    server = null;
  }
  if (status) status = { ...status, running: false };
}

export function getPluginHostStatus(): PluginHostStatus | null {
  return status;
}

export function getPluginToken(): string {
  return cachedToken;
}
