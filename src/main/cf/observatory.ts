import { readCf } from "./credentials";

/**
 * Electron-side client for grudge-observatory (obs.grudge-studio.com).
 * Uses the ADMIN_KEY stored in keytar for query/stats endpoints.
 * Uses the INGEST_KEY for pushing dev tool telemetry.
 */

const OBS_URL = process.env.OBSERVATORY_URL ?? "https://obs.grudge-studio.com";

async function obsBase(): Promise<{ url: string; adminKey: string }> {
  // Reuse the generic CF creds store — observatory keys stored alongside R2/AI keys.
  const adminKey = await readCf("workerApiKey"); // reuse the objectstore API key or set a dedicated one
  if (!adminKey) throw new Error("Observatory admin key not configured in keytar");
  return { url: OBS_URL, adminKey };
}

async function authedGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const { url, adminKey } = await obsBase();
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetch(`${url}${path}${qs}`, {
    headers: { Authorization: `Bearer ${adminKey}` },
  });
  if (!res.ok) throw new Error(`Observatory ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json() as Promise<T>;
}

// ─── Query logs ───
export interface ObsLog {
  id: number; ts: string; level: string; source: string; message: string;
  meta: string | null; grudge_id: string | null; request_id: string | null;
}

export async function obsQueryLogs(filters?: {
  source?: string; level?: string; since?: string; until?: string; limit?: number;
}): Promise<{ logs: ObsLog[]; count: number }> {
  const params: Record<string, string> = {};
  if (filters?.source) params.source = filters.source;
  if (filters?.level)  params.level = filters.level;
  if (filters?.since)  params.since = filters.since;
  if (filters?.until)  params.until = filters.until;
  if (filters?.limit)  params.limit = String(filters.limit);
  return authedGet("/query", params);
}

// ─── Stats ───
export async function obsStats(): Promise<{ stats: any; generated: string | null }> {
  return authedGet("/stats");
}

// ─── AI usage stats ───
export interface AiProviderStats {
  provider: string; calls: number; input_tokens: number; output_tokens: number;
  total_cost: number; avg_latency: number; errors: number;
}

export async function obsAiStats(hours = 24): Promise<{
  hours: number; since: string;
  by_provider: AiProviderStats[];
  by_model: Array<{ model: string; provider: string; calls: number; total_cost: number; avg_latency: number }>;
}> {
  return authedGet("/ai/stats", { hours: String(hours) });
}

// ─── Health ───
export async function obsHealth(): Promise<{ ok: boolean; latencyMs: number; error: string | null }> {
  const start = Date.now();
  try {
    const res = await fetch(`${OBS_URL}/health`);
    return { ok: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, error: err?.message ?? String(err) };
  }
}

// ─── Push telemetry from the dev tool ───
export async function obsPushLog(logs: Array<{
  level?: string; message: string; meta?: any;
}>): Promise<void> {
  const { url, adminKey } = await obsBase();
  await fetch(`${url}/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-source": "grudge-dev-tool",
      "x-ingest-key": adminKey,
    },
    body: JSON.stringify({ logs }),
  });
}

export async function obsPushAiEvent(event: {
  provider: string; model: string; input_tokens?: number; output_tokens?: number;
  cost_usd?: number; latency_ms?: number; status?: string;
}): Promise<void> {
  const { url, adminKey } = await obsBase();
  await fetch(`${url}/ai`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-source": "grudge-dev-tool",
      "x-ingest-key": adminKey,
    },
    body: JSON.stringify(event),
  });
}
