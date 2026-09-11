/**
 * Fleet agent / sub-agent API SSOT for pages, apps, sites, and Dev Tool.
 *
 * Do not invent a second agent stack. All products call Legion hub first,
 * then GRUDA agent, then optional Puter User-Pays / local Ollama (desktop only).
 *
 * Live hub: https://ai.grudge-studio.com
 * Contract mirrors Dev Tool `legion/orchestrator.ts` + hub `/api/*`.
 */

import { FLEET_URLS } from "./fleet";

export const FLEET_AI_HUB: string = String(FLEET_URLS.ai || "https://ai.grudge-studio.com");

/** Preferred agent roles for Grudge Studio surfaces */
export const FLEET_AGENT_ROLES = [
  "dev",
  "deploy",
  "assets",
  "character",
  "combat",
  "ui",
  "ops",
  "review",
] as const;

export type FleetAgentRole = (typeof FLEET_AGENT_ROLES)[number];

/**
 * Best default model routing (hub may override).
 * Prefer fleet/local free paths before paid providers.
 */
export const FLEET_AGENT_MODEL_PREFERENCE = [
  "gruda-dev",
  "gruda",
  "ollama",
  "workers-ai",
  "puter",
] as const;

export type FleetAgentSurface =
  | "dev-tool"
  | "page"
  | "app"
  | "site"
  | "worker"
  | "coder"
  | "forge"
  | "ui-studio";

export type FleetSubAgentKind =
  | "general"
  | "explore"
  | "plan"
  | "review"
  | "deploy"
  | "assets"
  | "character";

export type FleetAgentEndpoints = {
  hub: string;
  health: string;
  chat: string;
  agents: string;
  models: string;
  /** Optional GRUDA agent base (often same host or sibling) */
  grudaAgent: string;
  puterSpace: string;
};

export function fleetAgentEndpoints(hub = FLEET_AI_HUB): FleetAgentEndpoints {
  const base = hub.replace(/\/$/, "");
  return {
    hub: base,
    health: `${base}/health`,
    chat: `${base}/api/chat`,
    agents: `${base}/api/agents`,
    models: `${base}/api/models`,
    grudaAgent: base,
    puterSpace: FLEET_URLS.puterSpace,
  };
}

export type FleetChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type FleetChatRequest = {
  messages: FleetChatMessage[];
  role?: FleetAgentRole;
  model?: string;
  surface?: FleetAgentSurface;
  /** Inject ONE TRUTH / fleet context for infra questions */
  injectFleetTruth?: boolean;
  /** Sub-agent specialization hint (hub may route) */
  subagent?: FleetSubAgentKind;
  max_tokens?: number;
  temperature?: number;
};

export type FleetChatResponse = {
  response: string;
  source: string;
  model?: string;
  role?: string;
};

/**
 * Browser / page helper — call from SPAs with Grudge ID bearer when available.
 * Desktop Dev Tool prefers `window.grudge.legion.chat` (IPC) instead.
 */
export async function fleetAgentChat(
  req: FleetChatRequest,
  opts?: { token?: string; hub?: string; signal?: AbortSignal },
): Promise<FleetChatResponse> {
  const ep = fleetAgentEndpoints(opts?.hub);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (opts?.token) headers.authorization = `Bearer ${opts.token}`;

  const body = {
    messages: req.messages,
    role: req.role ?? "dev",
    model: req.model,
    surface: req.surface ?? "page",
    subagent: req.subagent,
    injectFleetTruth: req.injectFleetTruth,
    max_tokens: req.max_tokens,
    temperature: req.temperature,
  };

  const res = await fetch(ep.chat, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: opts?.signal ?? AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`fleet agent chat HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    response?: string;
    message?: string;
    content?: string;
    source?: string;
    model?: string;
    role?: string;
  };
  return {
    response: data.response ?? data.message ?? data.content ?? "",
    source: data.source ?? "legion-hub",
    model: data.model,
    role: data.role ?? req.role,
  };
}

/** Recommended sub-agent for a surface (Dev Tool / pages / deploy). */
export function bestSubAgentFor(surface: FleetAgentSurface, intent?: string): FleetSubAgentKind {
  const t = (intent || "").toLowerCase();
  if (/\b(review|audit|qa|bug)\b/.test(t)) return "review";
  if (/\b(deploy|vercel|railway|wrangler|cdn)\b/.test(t)) return "deploy";
  if (/\b(asset|glb|fbx|r2|texture|icon)\b/.test(t)) return "assets";
  if (/\b(character|skeleton|anim|toon|race)\b/.test(t)) return "character";
  if (/\b(plan|design|architect)\b/.test(t)) return "plan";
  if (/\b(explore|find|where|search)\b/.test(t)) return "explore";
  if (surface === "forge" || surface === "ui-studio") return "assets";
  if (surface === "coder") return "general";
  return "general";
}

/** Embed snippet for fleet pages (document in docs; copy into SPAs). */
export const FLEET_AGENT_EMBED_NOTES = `
Use FLEET_AI_HUB=${FLEET_AI_HUB}
POST /api/chat with { messages, role, model?, surface, subagent? }
Auth: Grudge ID bearer when signed in; Puter User-Pays for account-cloud AI only.
Dev Tool desktop: window.grudge.legion.chat — never call raw assets.* from browser.
`.trim();
