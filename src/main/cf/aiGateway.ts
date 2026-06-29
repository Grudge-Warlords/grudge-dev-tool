import { readCf } from "./credentials";
import { legionChat, legionHealth } from "../legion/orchestrator";

/**
 * Cloudflare AI Gateway with Legion hub fallback.
 *
 * When CF_ACCOUNT_ID / CF_AI_GATEWAY_ID / CF_AI_WORKERS_API are not in keytar,
 * routes through ai.grudge-studio.com (Legion AI Hub) using the Grudge session
 * or fleet API key — same path the Legion tab uses.
 */

interface ProxyOptions {
  provider: string;
  path: string;
  body: any;
  authToken?: string;
  method?: "POST" | "GET";
  signal?: AbortSignal;
}

export type AiRoute = "cf-gateway" | "legion-hub";

async function hasLocalGateway(): Promise<boolean> {
  const [accountId, gatewayId, token] = await Promise.all([
    readCf("accountId"),
    readCf("aiGatewayId"),
    readCf("aiWorkersApi"),
  ]);
  return Boolean(accountId && gatewayId && token);
}

async function gatewayBase(): Promise<{ accountId: string; gatewayId: string; token: string }> {
  const accountId = await readCf("accountId");
  const gatewayId = await readCf("aiGatewayId");
  const token = await readCf("aiWorkersApi");
  if (!accountId) throw new Error("CF_ACCOUNT_ID not set — run npm run secret:import or use Legion hub (sign in)");
  if (!gatewayId) throw new Error("CF_AI_GATEWAY_ID not set — run npm run secret:import or use Legion hub (sign in)");
  if (!token) throw new Error("CF_AI_WORKERS_API not set — run npm run secret:import or use Legion hub (sign in)");
  return { accountId, gatewayId, token };
}

export async function aiGatewayProxy<T = unknown>(opts: ProxyOptions): Promise<T> {
  if (!(await hasLocalGateway())) {
    const result = await legionChat({
      messages: Array.isArray(opts.body?.messages)
        ? opts.body.messages
        : [{ role: "user", content: JSON.stringify(opts.body) }],
      role: "dev",
    });
    return { response: result.response, source: result.source } as T;
  }

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
    throw new Error(`AI Gateway ${opts.provider}/${opts.path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export async function workersAiChat(opts: {
  model?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  max_tokens?: number;
  temperature?: number;
  stream?: false;
}): Promise<{ result: { response: string }; success: boolean; via?: AiRoute }> {
  if (!(await hasLocalGateway())) {
    const { chatWithProviderChain } = await import("../ai/providers");
    const result = await chatWithProviderChain({
      messages: opts.messages,
      model: opts.model,
      role: "dev",
      max_tokens: opts.max_tokens,
      temperature: opts.temperature,
    });
    return {
      result: { response: result.response },
      success: true,
      via: result.source.startsWith("legion") ? "legion-hub" : "legion-hub",
    };
  }

  const model = opts.model ?? process.env.CF_AI_DEFAULT_MODEL ?? "@cf/meta/llama-3.1-8b-instruct";
  const data = await aiGatewayProxy<{ result?: { response: string }; success?: boolean }>({
    provider: "workers-ai",
    path: model,
    body: {
      messages: opts.messages,
      max_tokens: opts.max_tokens ?? 512,
      temperature: opts.temperature ?? 0.4,
      stream: false,
    },
  });
  return {
    result: { response: data.result?.response ?? "" },
    success: data.success ?? true,
    via: "cf-gateway",
  };
}

export async function workersAiCaption(opts: {
  imageBytes: Uint8Array | number[];
  model?: string;
}): Promise<{ result: { description: string }; success: boolean; via?: AiRoute }> {
  if (!(await hasLocalGateway())) {
    const { captionWithProviderChain } = await import("../ai/providers");
    const arr = opts.imageBytes instanceof Uint8Array ? opts.imageBytes : Uint8Array.from(opts.imageBytes);
    const result = await captionWithProviderChain({
      imageBytes: arr,
      prompt: "Describe this image for a game asset catalog (concise).",
      max_tokens: 256,
    });
    return {
      result: { description: result.description },
      success: true,
      via: "legion-hub",
    };
  }

  const model = opts.model ?? process.env.CF_AI_VISION_MODEL ?? "@cf/llava-hf/llava-1.5-7b-hf";
  const arr = opts.imageBytes instanceof Uint8Array ? Array.from(opts.imageBytes) : opts.imageBytes;
  const data = await aiGatewayProxy<{ result?: { description: string }; success?: boolean }>({
    provider: "workers-ai",
    path: model,
    body: { image: arr, prompt: "Describe this image concisely.", max_tokens: 128 },
  });
  return {
    result: { description: data.result?.description ?? "" },
    success: data.success ?? true,
    via: "cf-gateway",
  };
}

export async function aiGatewayHealth(): Promise<{
  ok: boolean;
  latencyMs: number;
  error: string | null;
  via: AiRoute;
}> {
  const start = Date.now();
  if (!(await hasLocalGateway())) {
    try {
      const { chatWithProviderChain } = await import("../ai/providers");
      const r = await chatWithProviderChain({
        messages: [{ role: "user", content: "ok" }],
        max_tokens: 4,
      });
      return {
        ok: Boolean(r.response),
        latencyMs: Date.now() - start,
        error: null,
        via: "legion-hub",
      };
    } catch (err: any) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err?.message ?? "No AI provider available — add Groq/OpenAI key in Settings",
        via: "legion-hub",
      };
    }
  }

  try {
    await workersAiChat({
      messages: [{ role: "user", content: "ok" }],
      max_tokens: 1,
    });
    return { ok: true, latencyMs: Date.now() - start, error: null, via: "cf-gateway" };
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err?.message ?? String(err),
      via: "cf-gateway",
    };
  }
}