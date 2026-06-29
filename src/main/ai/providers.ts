import { ollamaChat } from "../ollama";
import { readCf } from "../cf/credentials";
import { getFleetApiKey, getLegionHubUrl, getGrudaAgentUrl } from "../legion/orchestrator";
import * as puterSession from "../auth/puterSession";
import { readProviderKey, resolveGeminiKey, resolveOpenAiKey } from "./secrets";

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ProviderChatOpts {
  messages: ChatMessage[];
  model?: string;
  role?: string;
  max_tokens?: number;
  temperature?: number;
}

export interface ProviderChatResult {
  response: string;
  source: string;
}

function lastUserContent(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return messages[messages.length - 1]?.content ?? "";
}

function openAiMessages(messages: ChatMessage[]): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  return messages.map((m) => ({
    role: (m.role === "system" || m.role === "assistant" ? m.role : "user") as "system" | "user" | "assistant",
    content: m.content,
  }));
}

async function chatGroq(opts: ProviderChatOpts): Promise<ProviderChatResult> {
  const key = await readProviderKey("groq");
  if (!key) throw new Error("no groq key");
  const model = opts.model?.includes("groq") || opts.model?.includes("llama") || opts.model?.includes("mixtral")
    ? opts.model.replace(/^groq\//, "")
    : "llama-3.3-70b-versatile";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: openAiMessages(opts.messages),
      max_tokens: opts.max_tokens ?? 1024,
      temperature: opts.temperature ?? 0.4,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Groq ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return {
    response: data.choices?.[0]?.message?.content ?? "",
    source: `groq:${model}`,
  };
}

async function chatOpenAi(opts: ProviderChatOpts): Promise<ProviderChatResult> {
  const key = await resolveOpenAiKey();
  if (!key) throw new Error("no openai key");
  const model = opts.model?.startsWith("gpt") ? opts.model : "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: openAiMessages(opts.messages),
      max_tokens: opts.max_tokens ?? 1024,
      temperature: opts.temperature ?? 0.4,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return {
    response: data.choices?.[0]?.message?.content ?? "",
    source: `openai:${model}`,
  };
}

async function chatGemini(opts: ProviderChatOpts): Promise<ProviderChatResult> {
  const key = await resolveGeminiKey();
  if (!key) throw new Error("no gemini key");
  const model = opts.model?.includes("gemini")
    ? opts.model.replace(/^google\//, "")
    : "gemini-2.0-flash";
  const contents = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  const system = opts.messages.find((m) => m.role === "system")?.content;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents,
      generationConfig: { maxOutputTokens: opts.max_tokens ?? 1024, temperature: opts.temperature ?? 0.4 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return { response: text, source: `gemini:${model}` };
}

async function chatTogether(opts: ProviderChatOpts): Promise<ProviderChatResult> {
  const key = await readProviderKey("together");
  if (!key) throw new Error("no together key");
  const model = opts.model?.includes("together") ? opts.model.replace(/^together\//, "") : "meta-llama/Llama-3-8b-chat-hf";
  const res = await fetch("https://api.together.xyz/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: openAiMessages(opts.messages),
      max_tokens: opts.max_tokens ?? 1024,
      temperature: opts.temperature ?? 0.4,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Together ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return {
    response: data.choices?.[0]?.message?.content ?? "",
    source: `together:${model}`,
  };
}

type ProviderFn = (opts: ProviderChatOpts) => Promise<ProviderChatResult>;

type ChainStep = { id: string; fn: ProviderFn; available: () => Promise<boolean> };

const BASE_CHAIN: ChainStep[] = [
  {
    id: "grudachain-rag",
    fn: async (opts) => {
      const { grudachainChat } = await import("./grudachainAgent");
      const lastUser = opts.messages.filter((m) => m.role === "user").pop()?.content ?? "";
      const r = await grudachainChat({
        message: lastUser,
        history: opts.messages,
        enableTools: true,
      });
      return { response: r.response, source: r.source };
    },
    available: async () => {
      const { anythingLlmHealth } = await import("./anythingllm");
      const h = await anythingLlmHealth();
      return h.ok;
    },
  },
  {
    id: "groq",
    fn: chatGroq,
    available: async () => Boolean(await readProviderKey("groq")),
  },
  {
    id: "openai",
    fn: chatOpenAi,
    available: async () => Boolean(await resolveOpenAiKey()),
  },
  {
    id: "gemini",
    fn: chatGemini,
    available: async () => Boolean(await resolveGeminiKey()),
  },
  {
    id: "together",
    fn: chatTogether,
    available: async () => Boolean(await readProviderKey("together")),
  },
  {
    id: "huggingface",
    fn: async (opts) => {
      const { chatHuggingface } = await import("./huggingface");
      return chatHuggingface(opts);
    },
    available: async () => Boolean(await readProviderKey("huggingface")),
  },
  {
    id: "ollama",
    fn: async (opts) => {
      const r = await ollamaChat({ messages: opts.messages });
      return { response: r.message.content, source: "ollama" };
    },
    available: async () => {
      try {
        const { ollamaHealth } = await import("../ollama");
        return (await ollamaHealth()).ok;
      } catch {
        return false;
      }
    },
  },
  {
    id: "cf-workers",
    fn: chatCfWorkers,
    available: async () => {
      const [accountId, gatewayId, token] = await Promise.all([
        readCf("accountId"),
        readCf("aiGatewayId"),
        readCf("aiWorkersApi"),
      ]);
      return Boolean(accountId && gatewayId && token);
    },
  },
  {
    id: "legion-hub",
    fn: chatLegionHub,
    available: async () => true,
  },
];

async function orderedChain(): Promise<ChainStep[]> {
  const { getAiPreference } = await import("../ollama");
  const pref = await getAiPreference();
  if (pref === "ollama") {
    const ollama = BASE_CHAIN.find((s) => s.id === "ollama");
    const rest = BASE_CHAIN.filter((s) => s.id !== "ollama");
    return ollama ? [ollama, ...rest] : BASE_CHAIN;
  }
  if (pref === "cloudflare") {
    const cf = BASE_CHAIN.find((s) => s.id === "cf-workers");
    const rest = BASE_CHAIN.filter((s) => s.id !== "cf-workers");
    return cf ? [cf, ...rest] : BASE_CHAIN;
  }
  return BASE_CHAIN;
}

async function hubAuthHeaders(): Promise<Record<string, string>> {
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

async function chatCfWorkers(opts: ProviderChatOpts): Promise<ProviderChatResult> {
  const [accountId, gatewayId, token] = await Promise.all([
    readCf("accountId"),
    readCf("aiGatewayId"),
    readCf("aiWorkersApi"),
  ]);
  if (!accountId || !gatewayId || !token) throw new Error("CF gateway incomplete");
  const model = opts.model ?? process.env.CF_AI_DEFAULT_MODEL ?? "@cf/meta/llama-3.1-8b-instruct";
  const url = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/workers-ai/${model.replace(/^\//, "")}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: openAiMessages(opts.messages),
      max_tokens: opts.max_tokens ?? 512,
      temperature: opts.temperature ?? 0.4,
      stream: false,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`CF Workers AI ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { result?: { response?: string } };
  return { response: data.result?.response ?? "", source: `cf-workers:${model}` };
}

async function chatLegionHub(opts: ProviderChatOpts): Promise<ProviderChatResult> {
  const hub = await getLegionHubUrl();
  const messages = opts.messages.length
    ? opts.messages
    : [{ role: "user", content: lastUserContent(opts.messages) }];
  const res = await fetch(`${hub}/api/chat`, {
    method: "POST",
    headers: await hubAuthHeaders(),
    body: JSON.stringify({ messages, role: opts.role ?? "dev", model: opts.model }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const agent = await getGrudaAgentUrl();
    const fallback = await fetch(`${agent}/api/chat`, {
      method: "POST",
      headers: await hubAuthHeaders(),
      body: JSON.stringify({ messages, model: opts.model }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!fallback.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Legion hub ${res.status}: ${t.slice(0, 200)}`);
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

function imageBase64(imageBytes: Uint8Array | number[]): string {
  const arr = imageBytes instanceof Uint8Array ? imageBytes : Uint8Array.from(imageBytes);
  return Buffer.from(arr).toString("base64");
}

export interface CaptionOpts {
  imageBytes: Uint8Array | number[];
  prompt?: string;
  max_tokens?: number;
}

export interface CaptionResult {
  description: string;
  source: string;
}

async function captionOpenAi(opts: CaptionOpts): Promise<CaptionResult> {
  const key = await resolveOpenAiKey();
  if (!key) throw new Error("no openai key");
  const b64 = imageBase64(opts.imageBytes);
  const prompt = opts.prompt ?? "Describe this image for a game asset catalog (concise).";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      }],
      max_tokens: opts.max_tokens ?? 256,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI vision ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return { description: data.choices?.[0]?.message?.content ?? "", source: "openai:gpt-4o-mini" };
}

async function captionGemini(opts: CaptionOpts): Promise<CaptionResult> {
  const key = await resolveGeminiKey();
  if (!key) throw new Error("no gemini key");
  const b64 = imageBase64(opts.imageBytes);
  const prompt = opts.prompt ?? "Describe this image for a game asset catalog (concise).";
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + encodeURIComponent(key);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          { inline_data: { mime_type: "image/png", data: b64 } },
        ],
      }],
      generationConfig: { maxOutputTokens: opts.max_tokens ?? 256 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Gemini vision ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return { description: text, source: "gemini:gemini-2.0-flash" };
}

const VISION_CHAIN: Array<{ id: string; fn: (opts: CaptionOpts) => Promise<CaptionResult>; available: () => Promise<boolean> }> = [
  { id: "groq", fn: async () => ({ description: "", source: "groq" }), available: async () => Boolean(await readProviderKey("groq")) },
  { id: "openai", fn: captionOpenAi, available: async () => Boolean(await resolveOpenAiKey()) },
  { id: "gemini", fn: captionGemini, available: async () => Boolean(await resolveGeminiKey()) },
];

export async function captionWithProviderChain(opts: CaptionOpts): Promise<CaptionResult> {
  const errors: string[] = [];
  for (const step of VISION_CHAIN) {
    if (!(await step.available())) continue;
    try {
      if (step.id === "groq") {
        const key = await readProviderKey("groq");
        if (!key) continue;
        const b64 = imageBase64(opts.imageBytes);
        const prompt = opts.prompt ?? "Describe this image for a game asset catalog (concise).";
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "llama-3.2-90b-vision-preview",
            messages: [{
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
              ],
            }],
            max_tokens: opts.max_tokens ?? 256,
          }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) throw new Error(`Groq vision ${res.status}`);
        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        return { description: data.choices?.[0]?.message?.content ?? "", source: "groq:llama-3.2-90b-vision-preview" };
      }
      return await step.fn(opts);
    } catch (e: unknown) {
      errors.push(`${step.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(errors.length ? errors.join(" | ") : "No vision providers configured");
}

export async function chatWithProviderChain(opts: ProviderChatOpts): Promise<ProviderChatResult> {
  const errors: string[] = [];
  const chain = await orderedChain();
  for (const step of chain) {
    if (!(await step.available())) continue;
    try {
      return await step.fn(opts);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${step.id}: ${msg}`);
      // Skip Legion hub when Grok credits are exhausted.
      if (/permission-denied|spending limit|403|grok/i.test(msg) && step.id === "legion-hub") {
        continue;
      }
    }
  }
  throw new Error(errors.length ? errors.join(" | ") : "No AI providers configured");
}

export async function probeProviders(): Promise<Array<{ id: string; configured: boolean; ok: boolean; error: string | null }>> {
  const rows: Array<{ id: string; configured: boolean; ok: boolean; error: string | null }> = [];
  const chain = await orderedChain();
  for (const step of chain.filter((s) => s.id !== "legion-hub")) {
    const configured = await step.available();
    if (!configured) {
      rows.push({ id: step.id, configured: false, ok: false, error: null });
      continue;
    }
    try {
      await step.fn({
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
        max_tokens: 8,
      });
      rows.push({ id: step.id, configured: true, ok: true, error: null });
    } catch (e: unknown) {
      rows.push({
        id: step.id,
        configured: true,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return rows;
}