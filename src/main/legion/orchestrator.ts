import keytar from "keytar";
import { FLEET_URLS } from "../../shared/fleet";
import * as puterSession from "../auth/puterSession";

const SERVICE = "grudge-dev-tool";

const DEFAULT_HUB = process.env.GRUDGE_LEGION_HUB ?? FLEET_URLS.ai;
const DEFAULT_AGENT = process.env.GRUDGE_GRUDA_AGENT ?? "https://grudaagent.vercel.app";
const GRUDGEDOT_API = process.env.GRUDGEDOT_API ?? "https://grudgedot.vercel.app";

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

export async function legionChat(opts: {
  message?: string;
  messages?: Array<{ role: string; content: string }>;
  role?: string;
  model?: string;
}): Promise<{ response: string; source: string }> {
  const hub = await getLegionHubUrl();
  const messages = opts.messages ?? (
    opts.message ? [{ role: "user", content: opts.message }] : []
  );
  const res = await fetch(`${hub}/api/chat`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      messages,
      role: opts.role ?? "dev",
      model: opts.model,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const agent = await getGrudaAgentUrl();
    const fallback = await fetch(`${agent}/api/chat`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ messages, model: opts.model }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!fallback.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Legion chat failed: ${res.status} — ${t.slice(0, 200)}`);
    }
    const fb = (await fallback.json()) as { response?: string; message?: string };
    return { response: fb.response ?? fb.message ?? "", source: "gruda-agent" };
  }
  const data = (await res.json()) as { response?: string; message?: string; content?: string };
  return {
    response: data.response ?? data.message ?? data.content ?? "",
    source: "legion-hub",
  };
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

export async function fetchObjectStoreCatalog(path: string): Promise<unknown> {
  const base = FLEET_URLS.objectStore.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  const res = await fetch(`${base}${p}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ObjectStore ${p}: HTTP ${res.status}`);
  return res.json();
}