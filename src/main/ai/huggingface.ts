import keytar from "keytar";
import { readProviderKey } from "./secrets";

const SERVICE = "grudge-dev-tool";
const HF_CHAT_URL = "https://router.huggingface.co/v1/chat/completions";

/** Coding-focused default — fast on HF Inference Providers free tier. */
export const HF_CODER_MODELS = [
  "Qwen/Qwen2.5-Coder-7B-Instruct",
  "deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct",
  "meta-llama/Llama-3.2-3B-Instruct",
  "mistralai/Mistral-7B-Instruct-v0.3",
] as const;

const DEFAULT_MODEL = HF_CODER_MODELS[0];

export async function getHfModel(): Promise<string> {
  try {
    const v = await keytar.getPassword(SERVICE, "ai.huggingfaceModel");
    if (v?.trim()) return v.trim();
  } catch { /* ignore */ }
  return process.env.HF_DEFAULT_MODEL ?? process.env.HUGGINGFACE_MODEL ?? DEFAULT_MODEL;
}

export async function setHfModel(model: string): Promise<void> {
  await keytar.setPassword(SERVICE, "ai.huggingfaceModel", model.trim());
}

export interface HfChatOpts {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  max_tokens?: number;
  temperature?: number;
}

export interface HfChatResult {
  response: string;
  source: string;
}

function openAiMessages(messages: HfChatOpts["messages"]): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  return messages.map((m) => ({
    role: (m.role === "system" || m.role === "assistant" ? m.role : "user") as "system" | "user" | "assistant",
    content: m.content,
  }));
}

export async function chatHuggingface(opts: HfChatOpts): Promise<HfChatResult> {
  const key = await readProviderKey("huggingface");
  if (!key) throw new Error("no huggingface key");
  const model = opts.model?.includes("/")
    ? opts.model.replace(/^huggingface\//, "")
    : (opts.model ?? (await getHfModel()));
  const res = await fetch(HF_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: openAiMessages(opts.messages),
      max_tokens: opts.max_tokens ?? 1024,
      temperature: opts.temperature ?? 0.35,
      stream: false,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HuggingFace ${res.status}: ${t.slice(0, 240)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return {
    response: data.choices?.[0]?.message?.content ?? "",
    source: `huggingface:${model}`,
  };
}

export async function huggingfaceHealth(): Promise<{
  ok: boolean;
  configured: boolean;
  model: string;
  error: string | null;
}> {
  const model = await getHfModel();
  const key = await readProviderKey("huggingface");
  if (!key) {
    return { ok: false, configured: false, model, error: "no API token" };
  }
  try {
    await chatHuggingface({
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      max_tokens: 8,
      model,
    });
    return { ok: true, configured: true, model, error: null };
  } catch (e: unknown) {
    return {
      ok: false,
      configured: true,
      model,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}