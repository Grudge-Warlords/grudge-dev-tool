import keytar from "keytar";
import { FLEET_URLS } from "../../shared/fleet";
import * as puterSession from "../auth/puterSession";
import { buildLegionFleetContext } from "./fleetTruth";

const SERVICE = "grudge-dev-tool";

const DEFAULT_HUB = process.env.GRUDGE_LEGION_HUB ?? FLEET_URLS.ai;
/** Canonical agent UI is proxied on ai.grudge-studio.com (UI_ORIGIN remains grudaagent.vercel.app). */
const DEFAULT_AGENT = process.env.GRUDGE_GRUDA_AGENT ?? FLEET_URLS.ai;
/** Prefer Open / fleet catalog — grudgedot.vercel.app is 404 (planned). */
const GRUDGEDOT_API = process.env.GRUDGEDOT_API ?? "https://open.grudge-studio.com";

async function readSecret(account: string, fallback: string): Promise<string> {
  try {
    const v = await keytar.getPassword(SERVICE, account);
    return (v || fallback).replace(/\/$/, "");
  } catch {
    return fallback.replace(/\/$/, "");
  }
}

async function writeSecret(account: string, value: string): Promise<void> {
  await keytar.setPassword(SERVICE, account, value.replace(/\/$/, ""));
}

async function deleteSecret(account: string): Promise<void> {
  try { await keytar.deletePassword(SERVICE, account); } catch { /* not set */ }
}

export async function getLegionHubUrl(): Promise<string> {
  return readSecret("legion.hubUrl", DEFAULT_HUB);
}

export async function setLegionHubUrl(url: string): Promise<void> {
  await writeSecret("legion.hubUrl", url);
}

export async function getGrudaAgentUrl(): Promise<string> {
  return readSecret("legion.grudaAgentUrl", DEFAULT_AGENT);
}

export async function setGrudaAgentUrl(url: string): Promise<void> {
  await writeSecret("legion.grudaAgentUrl", url);
}

export async function getFleetApiKey(): Promise<string | null> {
  const k = await keytar.getPassword(SERVICE, "legion.fleetApiKey");
  if (k) return k;
  return process.env.GRUDGE_AI_KEY ?? null;
}

export async function setFleetApiKey(key: string): Promise<void> {
  await writeSecret("legion.fleetApiKey", key);
}

export async function clearFleetApiKey(): Promise<void> {
  await deleteSecret("legion.fleetApiKey");
}

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const fleetKey = await getFleetApiKey();
  if (fleetKey) {
    headers.Authorization = `Bearer ${fleetKey}`;
    return headers;
  }
  const token = await puterSession.getPuterToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function probe(url: string): Promise<{
  url: string;
  status: number | null;
  latencyMs: number;
  error: string | null;
}> {
  const start = Date.now();
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return {
      url,
      status: res.status,
      latencyMs: Date.now() - start,
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (e: unknown) {
    return {
      url,
      status: null,
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : "unreachable",
    };
  }
}

export async function legionHealth(): Promise<{
  ok: boolean;
  hub: { url: string; status: number | null; latencyMs: number; error: string | null };
  agent: { url: string; status: number | null; latencyMs: number; error: string | null };
  hasFleetKey: boolean;
}> {
  const [hubUrl, agentUrl, hasFleetKey] = await Promise.all([
    getLegionHubUrl(),
    getGrudaAgentUrl(),
    getFleetApiKey().then(Boolean),
  ]);
  const [hub, agent] = await Promise.all([probe(hubUrl), probe(agentUrl)]);
  const ok = (hub.status != null && hub.status < 500) || (agent.status != null && agent.status < 500);
  return { ok, hub, agent, hasFleetKey };
}

export async function listAgents(): Promise<unknown[]> {
  const hub = await getLegionHubUrl();
  const res = await fetch(`${hub}/api/agents`, {
    headers: await authHeaders(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { agents?: unknown[] };
  return data.agents ?? (Array.isArray(data) ? data : []);
}

const INFRA_PATTERN =
  /\b(worker|workers|cloudflare|d1|r2|deploy|fleet|truth|canonical|mismatch|railway|objectstore|assets\.grudge|api\.grudge|legion|infrastructure|production|vercel)\b/i;

async function messagesWithFleetTruth(opts: {
  message?: string;
  messages?: Array<{ role: string; content: string }>;
  injectFleetTruth?: boolean;
}): Promise<Array<{ role: string; content: string }>> {
  const base =
    opts.messages ?? (opts.message ? [{ role: "user", content: opts.message }] : []);
  const inject = opts.injectFleetTruth !== false;
  const text = opts.message ?? opts.messages?.map((m) => m.content).join("\n") ?? "";
  if (!inject || !INFRA_PATTERN.test(text)) return base;
  try {
    const ctx = await buildLegionFleetContext();
    return [{ role: "system", content: ctx }, ...base];
  } catch {
    return base;
  }
}

export async function legionChat(opts: {
  message?: string;
  messages?: Array<{ role: string; content: string }>;
  role?: string;
  model?: string;
  injectFleetTruth?: boolean;
}): Promise<{ response: string; source: string }> {
  const messages = await messagesWithFleetTruth(opts);
  const errors: string[] = [];

  // 1) Legion hub /api/chat
  try {
    const hub = await getLegionHubUrl();
    const res = await fetch(`${hub}/api/chat`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        messages,
        role: opts.role ?? "dev",
        model: opts.model,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { response?: string; message?: string; content?: string };
      return {
        response: data.response ?? data.message ?? data.content ?? "",
        source: "legion-hub",
      };
    }
    errors.push(`hub HTTP ${res.status}`);
  } catch (e: unknown) {
    errors.push(`hub: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2) Gruda agent URL /api/chat
  try {
    const agent = await getGrudaAgentUrl();
    const fallback = await fetch(`${agent}/api/chat`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ messages, model: opts.model }),
      signal: AbortSignal.timeout(60_000),
    });
    if (fallback.ok) {
      const fb = (await fallback.json()) as { response?: string; message?: string };
      return { response: fb.response ?? fb.message ?? "", source: "gruda-agent" };
    }
    errors.push(`agent HTTP ${fallback.status}`);
  } catch (e: unknown) {
    errors.push(`agent: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3) In-app stack (Ollama → Workers AI) — no browser
  try {
    const { localAgentChat } = await import("../agent/localAgent");
    const typed = messages.map((m) => ({
      role: (m.role === "assistant" || m.role === "system" ? m.role : "user") as
        | "system"
        | "user"
        | "assistant",
      content: m.content,
    }));
    const local = await localAgentChat(typed);
    return { response: local.text, source: local.source };
  } catch (e: unknown) {
    errors.push(`local: ${e instanceof Error ? e.message : String(e)}`);
  }

  throw new Error(`Legion chat failed (all backends):\n${errors.join("\n")}`);
}

export async function grudaAgentModels(): Promise<string[]> {
  const agent = await getGrudaAgentUrl();
  try {
    const res = await fetch(`${agent}/api/models`, {
      headers: await authHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: string[] } | string[];
    return Array.isArray(data) ? data : (data.models ?? []);
  } catch {
    return [];
  }
}

export async function fetchGrudgedotGames(): Promise<unknown[]> {
  const res = await fetch(`${GRUDGEDOT_API}/api/games`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const data = (await res.json()) as { games?: unknown[] } | unknown[];
  return Array.isArray(data) ? data : (data.games ?? []);
}

/** Alias map for catalogs that moved or never shipped under the legacy name. */
const CATALOG_ALIASES: Record<string, string[]> = {
  "buildings.json": [
    "buildings.json",
    "home-island-contract.json",
    "warlords-catalog.json",
    "era-asset-taxonomy.json",
    "master-items.json",
  ],
  "master-items.json": ["master-items.json", "era-asset-taxonomy.json", "warlords-catalog.json"],
  "ships.json": ["ships.json", "grudge-armada.json", "master-items.json"],
  "audio.json": ["audio.json", "asset-media-types.json"],
  "voxelAssets.json": ["voxelAssets.json", "era-characters.json"],
};

export async function fetchObjectStoreCatalog(catalogPath: string): Promise<unknown> {
  const { getAssetsApiBaseUrl } = await import("../api");
  const apiBase = (await getAssetsApiBaseUrl()).replace(/\/$/, "");

  // ONE TRUTH: {client}/api/objectstore/v1/{catalog}.json
  // Accept legacy shapes: "/api/v1/weapons.json", "weapons.json", "master-items.json"
  let file = catalogPath.replace(/^\/+/, "");
  file = file.replace(/^api\/v1\//, "").replace(/^api\/objectstore\/v1\//, "");
  if (!file.endsWith(".json")) file = `${file}.json`;

  const candidates = CATALOG_ALIASES[file] ?? [file];
  // info.grudge-studio.com is the live catalog host today; client/objectstore rewrites often 404.
  const hosts = [
    "https://info.grudge-studio.com",
    apiBase,
    FLEET_URLS.client,
    "https://objectstore.grudge-studio.com",
  ].map((h) => h.replace(/\/$/, ""));

  const tried: string[] = [];
  let lastErr = "";

  for (const name of candidates) {
    for (const host of [...new Set(hosts)]) {
      const url =
        host.includes("objectstore.grudge-studio.com") || host.includes("info.grudge-studio.com")
          ? `${host}/api/v1/${name}`
          : `${host}/api/objectstore/v1/${name}`;
      tried.push(url);
      try {
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) {
          lastErr = `HTTP ${res.status}`;
          continue;
        }
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("text/html")) {
          lastErr = "HTML response";
          continue;
        }
        return res.json();
      } catch (e: unknown) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
  }

  throw new Error(
    `Catalog ${file}: unavailable (${lastErr}). Tried ${tried.length} URLs — catalog may not be published yet; browse R2 prefix instead.`,
  );
}