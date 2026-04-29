import { readCf } from "./credentials";

/**
 * Thin wrapper over the Cloudflare AI Gateway.
 *
 * Gateway URL shape:
 *   https://gateway.ai.cloudflare.com/v1/{accountId}/{gatewayId}/{provider}/...
 *
 * The CF_AI_WORKERS_API token authenticates calls to **Workers AI** as the
 * provider; for OpenAI/Anthropic/etc you'd pass the upstream provider token
 * via the `Authorization` header (Cloudflare proxies it). We expose two
 * convenience methods plus a generic passthrough so we can route any provider.
 */

interface ProxyOptions {
  provider: string;        // e.g. "workers-ai", "openai", "anthropic", "google-ai-studio"
  path: string;            // e.g. "@cf/meta/llama-3.1-8b-instruct" for workers-ai
  body: any;
  /** Override Authorization header. Defaults to `Bearer <CF_AI_WORKERS_API>`. */
  authToken?: string;
  method?: "POST" | "GET";
  signal?: AbortSignal;
}

async function gatewayBase(): Promise<{ accountId: string; gatewayId: string; token: string }> {
  const accountId = await readCf("accountId");
  const gatewayId = await readCf("aiGatewayId");
  const token = await readCf("aiWorkersApi");
  if (!accountId) throw new Error("CF_ACCOUNT_ID not set in keytar");
  if (!gatewayId) throw new Error("CF_AI_GATEWAY_ID not set in keytar");
  if (!token) throw new Error("CF_AI_WORKERS_API not set in keytar");
  return { accountId, gatewayId, token };
}

/** Generic passthrough \u2014 lets any provider be called through the gateway. */
export async function aiGatewayProxy<T = unknown>(opts: ProxyOptions): Promise<T> {
  const { accountId, gatewayId, token } = await gatewayBase();
  const url = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/${opts.provider}/${opts.path.replace(/^\//, "")}`;
  const res = await fetch(url, {
    method: opts.method ?? "POST",
    headers: {
      Authorization: `Bearer ${opts.authToken ?? token}`,
      "Content-Type": "application/json",
    },
    body: opts.method === "GET" ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI Gateway ${opts.provider}/${opts.path} \u2192 ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Convenience: Workers AI text generation. Pick a model from
 * https://developers.cloudflare.com/workers-ai/models/.
 */
export async function workersAiChat(opts: {
  model?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  max_tokens?: number;
  temperature?: number;
  stream?: false;  // streaming not exposed yet
}): Promise<{ result: { response: string }; success: boolean }> {
  // Default model can be overridden via env var so the dev tool tracks
  // upstream Workers AI rotation without a code release.
  const model = opts.model ?? process.env.CF_AI_DEFAULT_MODEL ?? "@cf/meta/llama-3.1-8b-instruct";
  return aiGatewayProxy({
    provider: "workers-ai",
    path: model,
    body: {
      messages: opts.messages,
      max_tokens: opts.max_tokens ?? 512,
      temperature: opts.temperature ?? 0.4,
      stream: false,
    },
  });
}

/** Convenience: Workers AI image-to-text (captioning). Useful for asset auto-tagging. */
export async function workersAiCaption(opts: { imageBytes: Uint8Array | number[]; model?: string }): Promise<{ result: { description: string }; success: boolean }> {
  // Vision model is env-overridable for the same reason as the chat model above.
  const model = opts.model ?? process.env.CF_AI_VISION_MODEL ?? "@cf/llava-hf/llava-1.5-7b-hf";
  const arr = opts.imageBytes instanceof Uint8Array ? Array.from(opts.imageBytes) : opts.imageBytes;
  return aiGatewayProxy({
    provider: "workers-ai",
    path: model,
    body: { image: arr, prompt: "Describe this image concisely.", max_tokens: 128 },
  });
}

/** Health check \u2014 does a tiny model call against Workers AI to validate the gateway path + token. */
export async function aiGatewayHealth(): Promise<{ ok: boolean; latencyMs: number; error: string | null }> {
  const start = Date.now();
  try {
    await workersAiChat({
      messages: [{ role: "user", content: "ok" }],
      max_tokens: 1,
    });
    return { ok: true, latencyMs: Date.now() - start, error: null };
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, error: err?.message ?? String(err) };
  }
}
