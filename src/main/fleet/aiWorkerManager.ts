import { aiGatewayProxy, workersAiChat, workersAiCaption, aiGatewayHealth } from "../cf/aiGateway";
import { workerList, workerSearch, workerUploadUrl, workerHealth, workerAssetMeta } from "../cf/objectStoreWorker";
import { r2List, r2Head, r2Delete, r2GetSignedUploadUrl, r2PublicUrl } from "../cf/r2Direct";
import { obsAiStats, obsPushAiEvent } from "../cf/observatory";
import { ollamaChat, ollamaHealth, getAiPreference } from "../ollama";
import { FLEET_URLS, FLEET_GAME_DATA_URL } from "../../shared/fleet";

/**
 * AI Worker Manager — unified interface for dispatching AI tasks across all
 * platforms (CF Workers AI, CF AI Gateway, Puter AI, Anthropic direct) and
 * managing fleet operations (R2 assets, D1 queries, accounts).
 */

// ─────────────────────────────────────────────────────────────
//  AI DISPATCH — route to the best provider by model preference
// ─────────────────────────────────────────────────────────────

export type AiProvider =
  | "workers-ai"
  | "anthropic"
  | "openai"
  | "puter"
  | "google-ai-studio"
  | "ollama"
  | "legion";

export interface AiChatRequest {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  model?: string;
  provider?: AiProvider;
  max_tokens?: number;
  temperature?: number;
  /** If true, telemetry is pushed to the observatory */
  track?: boolean;
}

export interface AiChatResponse {
  text: string;
  provider: AiProvider;
  model: string;
  latencyMs: number;
  input_tokens?: number;
  output_tokens?: number;
}

/** Model → provider routing table. Extend as models are added. */
const MODEL_ROUTES: Record<string, { provider: AiProvider; path: string }> = {
  // Workers AI (free / included)
  "llama-3.1-8b":           { provider: "workers-ai", path: "@cf/meta/llama-3.1-8b-instruct" },
  "llama-3.3-70b":          { provider: "workers-ai", path: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
  "mistral-7b":             { provider: "workers-ai", path: "@cf/mistral/mistral-7b-instruct-v0.2" },
  "gemma-7b":               { provider: "workers-ai", path: "@cf/google/gemma-7b-it-lora" },
  "qwen-1.5-14b":           { provider: "workers-ai", path: "@cf/qwen/qwen1.5-14b-chat-awq" },
  // Anthropic (via AI Gateway)
  "claude-sonnet":          { provider: "anthropic", path: "v1/messages" },
  "claude-haiku":           { provider: "anthropic", path: "v1/messages" },
  // OpenAI (via AI Gateway)
  "gpt-4o":                 { provider: "openai", path: "v1/chat/completions" },
  "gpt-4o-mini":            { provider: "openai", path: "v1/chat/completions" },
  // Puter (serverless bridge)
  "puter-claude":           { provider: "puter", path: "" },
  "puter-gpt4o":            { provider: "puter", path: "" },
  // Local Ollama (autonomous desktop / vibe coding)
  "ollama":                 { provider: "ollama", path: "" },
  "ollama-local":           { provider: "ollama", path: "" },
  // Legion hub (ai.grudge-studio.com)
  "legion":                 { provider: "legion", path: "/v1/chat" },
  "gruda-agent":            { provider: "legion", path: "/v1/chat" },
};

/** Resolve a short model name to its provider + gateway path. */
function resolveModel(model?: string): { provider: AiProvider; path: string; fullModel: string } {
  if (!model) return { provider: "workers-ai", path: "@cf/meta/llama-3.1-8b-instruct", fullModel: "llama-3.1-8b" };
  const route = MODEL_ROUTES[model];
  if (route) return { ...route, fullModel: model };
  // If it starts with @cf/ assume workers-ai raw model
  if (model.startsWith("@cf/")) return { provider: "workers-ai", path: model, fullModel: model };
  // Default: try workers-ai with the model name as path
  return { provider: "workers-ai", path: model, fullModel: model };
}

/**
 * Dispatch an AI chat request to the optimal provider.
 * Tracks telemetry to the observatory if `track` is true (default).
 */
export async function aiChat(req: AiChatRequest): Promise<AiChatResponse> {
  // Honor desktop AI preference (Settings → Ollama): auto tries local first when up
  let forcedProvider = req.provider;
  if (!forcedProvider) {
    try {
      const pref = await getAiPreference();
      if (pref === "ollama") forcedProvider = "ollama";
      else if (pref === "auto") {
        const h = await ollamaHealth();
        if (h.ok && (req.model?.startsWith("ollama") || !req.model)) {
          forcedProvider = "ollama";
        }
      }
    } catch {
      /* ignore preference lookup */
    }
  }

  const { provider, path, fullModel } = forcedProvider
    ? {
        provider: forcedProvider,
        path: "",
        fullModel: req.model ?? (forcedProvider === "ollama" ? "ollama-local" : "unknown"),
      }
    : resolveModel(req.model);

  const start = Date.now();
  let text = "";
  let input_tokens: number | undefined;
  let output_tokens: number | undefined;

  try {
    if (provider === "ollama") {
      const result = await ollamaChat({
        model: req.model?.replace(/^ollama[-:]?/, "") || undefined,
        messages: req.messages,
      });
      text = result.message?.content ?? "";
    } else if (provider === "legion") {
      const hub = (process.env.GRUDGE_LEGION_HUB ?? FLEET_URLS.ai).replace(/\/$/, "");
      const key = process.env.GRUDGE_AI_KEY;
      const res = await fetch(`${hub}${path || "/v1/chat"}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({
          model: req.model ?? "default",
          messages: req.messages,
          max_tokens: req.max_tokens,
          temperature: req.temperature,
        }),
      });
      if (!res.ok) throw new Error(`Legion hub HTTP ${res.status}`);
      const body = (await res.json()) as {
        text?: string;
        content?: string;
        choices?: Array<{ message?: { content?: string } }>;
      };
      text =
        body.text ||
        body.content ||
        body.choices?.[0]?.message?.content ||
        "";
    } else if (provider === "workers-ai") {
      const result = await workersAiChat({
        model: path || undefined,
        messages: req.messages,
        max_tokens: req.max_tokens,
        temperature: req.temperature,
      });
      text = result.result?.response ?? "";
    } else if (provider === "anthropic") {
      const result = await aiGatewayProxy<any>({
        provider: "anthropic",
        path: "v1/messages",
        body: {
          model: req.model ?? "claude-sonnet-4-20250514",
          max_tokens: req.max_tokens ?? 1024,
          messages: req.messages.filter(m => m.role !== "system"),
          system: req.messages.find(m => m.role === "system")?.content,
        },
      });
      text = result.content?.[0]?.text ?? "";
      input_tokens = result.usage?.input_tokens;
      output_tokens = result.usage?.output_tokens;
    } else if (provider === "openai") {
      const result = await aiGatewayProxy<any>({
        provider: "openai",
        path: "v1/chat/completions",
        body: {
          model: req.model ?? "gpt-4o-mini",
          max_tokens: req.max_tokens ?? 1024,
          temperature: req.temperature ?? 0.4,
          messages: req.messages,
        },
      });
      text = result.choices?.[0]?.message?.content ?? "";
      input_tokens = result.usage?.prompt_tokens;
      output_tokens = result.usage?.completion_tokens;
    } else if (provider === "puter") {
      // Puter AI calls through the puter.js SDK (requires puter context)
      throw new Error("Puter AI dispatch requires browser context — use puter.ai.chat() directly");
    } else {
      // Generic gateway passthrough
      const result = await aiGatewayProxy<any>({ provider, path, body: { messages: req.messages, max_tokens: req.max_tokens } });
      text = typeof result === "string" ? result : JSON.stringify(result);
    }
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    if (req.track !== false) {
      obsPushAiEvent({ provider, model: fullModel, latency_ms: latencyMs, status: "error" }).catch(() => {});
    }
    throw err;
  }

  const latencyMs = Date.now() - start;

  // Track to observatory
  if (req.track !== false) {
    obsPushAiEvent({
      provider, model: fullModel, input_tokens, output_tokens,
      latency_ms: latencyMs, status: "ok",
    }).catch(() => {});
  }

  return { text, provider, model: fullModel, latencyMs, input_tokens, output_tokens };
}

// ─────────────────────────────────────────────────────────────
//  AI WORKER STATUS — check all AI providers
// ─────────────────────────────────────────────────────────────

export interface AiWorkerStatus {
  provider: string;
  ok: boolean;
  latencyMs: number;
  error: string | null;
}

export async function checkAllAiWorkers(): Promise<AiWorkerStatus[]> {
  const results = await Promise.allSettled([
    // Workers AI via CF AI Gateway
    (async (): Promise<AiWorkerStatus> => {
      const r = await aiGatewayHealth();
      return { provider: "workers-ai (CF Gateway)", ok: r.ok, latencyMs: r.latencyMs, error: r.error };
    })(),

    // Anthropic via AI Gateway
    (async (): Promise<AiWorkerStatus> => {
      const start = Date.now();
      try {
        const res = await fetch("https://api.anthropic.com", { method: "GET" });
        return { provider: "anthropic", ok: res.status < 500, latencyMs: Date.now() - start, error: null };
      } catch (err: any) {
        return { provider: "anthropic", ok: false, latencyMs: Date.now() - start, error: err?.message };
      }
    })(),

    // Puter AI
    (async (): Promise<AiWorkerStatus> => {
      const start = Date.now();
      try {
        const res = await fetch("https://api.puter.com", { method: "GET" });
        return { provider: "puter-ai", ok: res.status < 500, latencyMs: Date.now() - start, error: null };
      } catch (err: any) {
        return { provider: "puter-ai", ok: false, latencyMs: Date.now() - start, error: err?.message };
      }
    })(),

    // AI Hub worker (Legion / GrudaNode)
    (async (): Promise<AiWorkerStatus> => {
      const start = Date.now();
      try {
        const hub = (process.env.GRUDGE_LEGION_HUB ?? FLEET_URLS.ai).replace(/\/$/, "");
        const res = await fetch(`${hub}/health`);
        return { provider: "grudge-ai-hub", ok: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
      } catch (err: any) {
        return { provider: "grudge-ai-hub", ok: false, latencyMs: Date.now() - start, error: err?.message };
      }
    })(),

    // Local Ollama (optional autonomous / vibe coding)
    (async (): Promise<AiWorkerStatus> => {
      const r = await ollamaHealth();
      return {
        provider: "ollama-local",
        ok: r.ok,
        latencyMs: r.latencyMs,
        error: r.ok ? null : (r.error ?? "not running (optional)"),
      };
    })(),
  ]);

  const names = ["workers-ai", "anthropic", "puter-ai", "grudge-ai-hub", "ollama-local"];
  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return { provider: names[i] ?? "unknown", ok: false, latencyMs: 0, error: r.reason?.message ?? "Check failed" };
  });
}

/** List available models (static registry + dynamic Workers AI catalog) */
export function listAvailableModels(): Array<{ shortName: string; provider: AiProvider; path: string }> {
  return Object.entries(MODEL_ROUTES).map(([shortName, route]) => ({ shortName, ...route }));
}

/** Get AI usage stats from the observatory */
export { obsAiStats as getAiUsageStats };

// ─────────────────────────────────────────────────────────────
//  R2 ASSET MANAGEMENT — unified interface for R2 operations
// ─────────────────────────────────────────────────────────────

export interface AssetInfo {
  name: string;
  size: number;
  contentType: string;
  updated: string | null;
  publicUrl: string | null;
}

/** List assets with optional prefix filter */
export async function listAssets(prefix = "", limit = 100): Promise<{ items: AssetInfo[]; folders: string[]; nextCursor: string | null }> {
  try {
    // Try worker first (has search + metadata enrichment)
    const result = await workerList({ prefix, delimiter: "/", limit });
    const items: AssetInfo[] = await Promise.all(
      result.items.map(async (item) => ({
        ...item,
        publicUrl: await r2PublicUrl(item.name).catch(() => null),
      }))
    );
    return { items, folders: result.folders, nextCursor: result.nextCursor };
  } catch {
    // Fallback to direct R2
    const result = await r2List({ prefix, delimiter: "/", limit });
    const items: AssetInfo[] = result.items.map(item => ({
      ...item,
      publicUrl: null,
    }));
    return { items, folders: result.folders, nextCursor: result.nextCursor };
  }
}

/** Search assets by query */
export async function searchAssets(query: string, opts?: { category?: string; pack?: string; limit?: number }) {
  return workerSearch({ q: query, ...opts });
}

/** Get a presigned upload URL */
export async function getUploadUrl(path: string, contentType?: string): Promise<{ uploadUrl: string; publicUrl: string }> {
  try {
    const result = await workerUploadUrl({ path, contentType });
    return { uploadUrl: result.uploadURL, publicUrl: await r2PublicUrl(path) };
  } catch {
    const uploadUrl = await r2GetSignedUploadUrl(path, contentType);
    return { uploadUrl, publicUrl: await r2PublicUrl(path) };
  }
}

/** Delete an asset */
export async function deleteAsset(key: string): Promise<void> {
  await r2Delete(key);
}

/** Get asset metadata + public URL */
export async function getAssetInfo(key: string): Promise<AssetInfo> {
  const head = await r2Head(key);
  return {
    name: key,
    size: head.size,
    contentType: head.contentType ?? "application/octet-stream",
    updated: head.updated,
    publicUrl: await r2PublicUrl(key),
  };
}

// ─────────────────────────────────────────────────────────────
//  ACCOUNT MANAGEMENT — interact with Grudge ID + Game API
// ─────────────────────────────────────────────────────────────

/** Fleet client (rewrites) or Railway game-data — never deprecated api.grudge-studio.com */
const API_BASE =
  process.env.GRUDGE_API_BASE ??
  process.env.GRUDGE_GAME_DATA_URL ??
  FLEET_URLS.client;
const ID_BASE = process.env.GRUDGE_ID_BASE ?? FLEET_URLS.auth;
const GAME_DATA = process.env.GRUDGE_GAME_DATA_URL ?? FLEET_GAME_DATA_URL;

async function apiGet<T>(base: string, path: string, token?: string): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { headers });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json() as Promise<T>;
}

/** Check if a Grudge ID JWT is valid (prefer /api/auth/me with Bearer). */
export async function validateJwt(
  token: string,
): Promise<{ valid: boolean; grudge_id?: string; error?: string }> {
  try {
    const result = await apiGet<any>(ID_BASE, "/api/auth/me", token);
    return {
      valid: true,
      grudge_id: result.grudgeId ?? result.grudge_id ?? result.sub ?? result.id,
    };
  } catch (err: any) {
    // Fallback Railway direct
    try {
      const result = await apiGet<any>(GAME_DATA, "/api/auth/me", token);
      return {
        valid: true,
        grudge_id: result.grudgeId ?? result.grudge_id ?? result.id,
      };
    } catch (e2: any) {
      return { valid: false, error: e2?.message ?? err?.message };
    }
  }
}

/** Get account info — Railway /api/account */
export async function getAccountInfo(_grudgeId: string, token: string): Promise<any> {
  try {
    return await apiGet(API_BASE, `/api/account`, token);
  } catch {
    return apiGet(GAME_DATA, `/api/account`, token);
  }
}

/** List characters for signed-in player */
export async function listCharacters(_grudgeId: string, token: string): Promise<any[]> {
  try {
    const result = await apiGet<any>(API_BASE, `/api/characters`, token);
    return Array.isArray(result) ? result : result.characters ?? result.data ?? [];
  } catch {
    const result = await apiGet<any>(GAME_DATA, `/api/characters`, token);
    return Array.isArray(result) ? result : result.characters ?? result.data ?? [];
  }
}

/** Check game-data database health (Railway SSOT) */
export async function checkDatabaseHealth(): Promise<{
  ok: boolean;
  latencyMs: number;
  tables?: number;
}> {
  const start = Date.now();
  try {
    const result = await apiGet<any>(GAME_DATA, "/api/health");
    return {
      ok: true,
      latencyMs: Date.now() - start,
      tables: result.tables,
    };
  } catch {
    try {
      await apiGet<any>(API_BASE, "/api/health");
      return { ok: true, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  FLEET OPERATIONS — high-level combined operations
// ─────────────────────────────────────────────────────────────

/** Full fleet status: AI workers + R2 + DB + observatory */
export async function getFleetOperationsStatus() {
  const [aiWorkers, objectstore, r2, db, obs] = await Promise.allSettled([
    checkAllAiWorkers(),
    workerHealth(),
    (async () => { try { return await r2List({ prefix: "", limit: 1 }); } catch { return null; } })(),
    checkDatabaseHealth(),
    obsAiStats(24).catch(() => null),
  ]);

  return {
    ai: aiWorkers.status === "fulfilled" ? aiWorkers.value : [],
    objectstore: objectstore.status === "fulfilled" ? objectstore.value : { ok: false },
    r2: { connected: r2.status === "fulfilled" && r2.value !== null },
    database: db.status === "fulfilled" ? db.value : { ok: false, latencyMs: 0 },
    observatory: obs.status === "fulfilled" ? obs.value : null,
    ts: new Date().toISOString(),
  };
}
