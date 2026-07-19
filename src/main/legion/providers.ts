import { getSecret } from "../auth/secretStore";
import { workersAiChat } from "../cf/aiGateway";
import type { ChatMessage, ProviderId } from "../../shared/legion";

/**
 * Legion provider clients — free-tier inference endpoints (Groq, Together,
 * OpenRouter, Fireworks) plus a passthrough to the existing Workers AI client.
 *
 * Puter is intentionally NOT implemented here: puter.ai.chat() only runs in
 * the renderer (browser context). The Envoy agent forwards via IPC in Phase 2.
 *
 * Keytar account names (added to scripts/import-secrets.mjs in Phase 2):
 *   groq-api-key, together-api-key, openrouter-api-key, fireworks-api-key
 */

export interface ProviderChatRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ProviderChatResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

export class MissingProviderCredentialError extends Error {
  constructor(public provider: ProviderId) {
    super(`No API key configured for provider '${provider}'`);
    this.name = "MissingProviderCredentialError";
  }
}

const SECRET_BY_PROVIDER: Partial<Record<ProviderId, string>> = {
  groq:       "groq-api-key",
  together:   "together-api-key",
  openrouter: "openrouter-api-key",
  fireworks:  "fireworks-api-key",
};

const BASE_URL_BY_PROVIDER: Partial<Record<ProviderId, string>> = {
  groq:       "https://api.groq.com/openai/v1",
  together:   "https://api.together.xyz/v1",
  openrouter: "https://openrouter.ai/api/v1",
  fireworks:  "https://api.fireworks.ai/inference/v1",
};

async function requireKey(provider: ProviderId): Promise<string> {
  const account = SECRET_BY_PROVIDER[provider];
  if (!account) throw new MissingProviderCredentialError(provider);
  const v = await getSecret(account);
  if (!v) throw new MissingProviderCredentialError(provider);
  return v;
}

/**
 * OpenAI-compatible chat completion. Used by Groq, Together, OpenRouter,
 * Fireworks — they all expose the same /v1/chat/completions shape.
 */
async function openAiCompat(
  provider: ProviderId,
  req: ProviderChatRequest,
): Promise<ProviderChatResponse> {
  const base = BASE_URL_BY_PROVIDER[provider];
  if (!base) throw new Error(`Provider '${provider}' has no base URL configured`);
  const key = await requireKey(provider);
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: req.model,
      messages: req.messages,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${provider} ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json() as any;
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
  };
}

async function workersAi(req: ProviderChatRequest): Promise<ProviderChatResponse> {
  const result = await workersAiChat({
    model: req.model,
    messages: req.messages,
    max_tokens: req.maxTokens,
    temperature: req.temperature,
  });
  // Workers AI returns usage at runtime on newer responses but it isn't in the
  // typed signature — read through any so we propagate token counts when present.
  const usage = (result.result as any)?.usage;
  return {
    text: result.result?.response ?? "",
    inputTokens: usage?.prompt_tokens,
    outputTokens: usage?.completion_tokens,
  };
}

/**
 * Dispatch a chat completion to a single provider. Throws on missing
 * credentials or HTTP errors — fallback logic lives in the registry.
 */
export async function providerChat(
  provider: ProviderId,
  req: ProviderChatRequest,
): Promise<ProviderChatResponse> {
  switch (provider) {
    case "groq":
    case "together":
    case "openrouter":
    case "fireworks":
      return openAiCompat(provider, req);
    case "workers-ai":
      return workersAi(req);
    case "puter":
      throw new Error("Puter dispatch requires renderer/browser context — wire via IPC in Phase 2");
    default:
      throw new Error(`Unknown provider: ${provider satisfies never}`);
  }
}

/** Probe whether a provider has credentials configured. Read-only. */
export async function providerHasCredentials(provider: ProviderId): Promise<boolean> {
  if (provider === "workers-ai") {
    return Boolean(await getSecret("cf-ai-workers-api"));
  }
  if (provider === "puter") {
    return Boolean(await getSecret("puter-token"));
  }
  const account = SECRET_BY_PROVIDER[provider];
  if (!account) return false;
  return Boolean(await getSecret(account));
}
