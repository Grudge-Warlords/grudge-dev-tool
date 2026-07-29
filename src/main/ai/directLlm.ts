/**
 * Direct LLM providers using baked env / vault keys (no Settings UI required).
 */

import { readLlmKey } from "../bootstrapSecrets";
import log from "../logger";

export async function openaiDirectChat(opts: {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  max_tokens?: number;
  temperature?: number;
}): Promise<{ text: string; model: string; source: string }> {
  const key = await readLlmKey("openai");
  if (!key) throw new Error("OPENAI_API_KEY not in env/vault");
  const model = opts.model ?? "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: opts.messages,
      max_tokens: opts.max_tokens ?? 1024,
      temperature: opts.temperature ?? 0.4,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    model,
    source: "openai-env",
  };
}

export async function anthropicDirectChat(opts: {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  max_tokens?: number;
}): Promise<{ text: string; model: string; source: string }> {
  const key = await readLlmKey("anthropic");
  if (!key) throw new Error("ANTHROPIC_API_KEY not in env/vault");
  const model = opts.model ?? "claude-3-5-haiku-latest";
  const system = opts.messages.find((m) => m.role === "system")?.content;
  const messages = opts.messages.filter((m) => m.role !== "system");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: opts.max_tokens ?? 1024,
      system,
      messages: messages.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Anthropic HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  return {
    text: data.content?.map((c) => c.text ?? "").join("") ?? "",
    model,
    source: "anthropic-env",
  };
}

export async function geminiDirectChat(opts: {
  messages: Array<{ role: string; content: string }>;
  model?: string;
}): Promise<{ text: string; model: string; source: string }> {
  const key = await readLlmKey("gemini");
  if (!key) throw new Error("GEMINI_API_KEY not in env/vault");
  const model = opts.model ?? "gemini-2.0-flash";
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
      contents,
      ...(system
        ? { systemInstruction: { parts: [{ text: system }] } }
        : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Gemini HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return { text, model, source: "gemini-env" };
}

/** Try OpenAI → Anthropic → Gemini using baked keys. */
export async function directLlmChat(opts: {
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
}): Promise<{ text: string; model: string; source: string }> {
  const errors: string[] = [];
  for (const fn of [openaiDirectChat, anthropicDirectChat, geminiDirectChat] as const) {
    try {
      return await fn(opts);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
      log.warn(`[directLlm] ${msg}`);
    }
  }
  throw new Error(`No direct LLM key worked:\n${errors.join("\n")}`);
}
