/**
 * Free / User-Pays Puter AI from the Electron main process.
 * Uses the signed-in Puter session token (or PUTER_AUTH_TOKEN from env).
 * OpenAI-compatible endpoint — no developer API key billing.
 */

import * as puterSession from "../auth/puterSession";
import { getSecret } from "../auth/secretStore";
import log from "../logger";

const PUTER_OPENAI_BASE = "https://api.puter.com/puterai/openai/v1";

/** Cheap free-tier friendly defaults */
export const PUTER_FREE_MODELS = [
  "gpt-4o-mini",
  "gpt-5.4-nano",
  "claude-3-5-haiku-latest",
  "gemini-2.0-flash",
  "meta-llama/llama-3.1-8b-instruct",
] as const;

async function resolvePuterToken(): Promise<string | null> {
  const sessionTok = await puterSession.getPuterToken();
  if (sessionTok) return sessionTok;
  const env =
    process.env.PUTER_AUTH_TOKEN?.trim() ||
    process.env.PUTER_TOKEN?.trim() ||
    process.env.PUTER_API_TOKEN?.trim();
  if (env) return env;
  try {
    return await getSecret("puter-token");
  } catch {
    return null;
  }
}

export async function puterAiAvailable(): Promise<boolean> {
  return Boolean(await resolvePuterToken());
}

export async function puterAiChat(opts: {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  max_tokens?: number;
  temperature?: number;
}): Promise<{ text: string; model: string; source: string }> {
  const token = await resolvePuterToken();
  if (!token) {
    throw new Error(
      "Puter AI needs a signed-in session (Login) or PUTER_AUTH_TOKEN in env — free User-Pays tier",
    );
  }

  const models = opts.model
    ? [opts.model, ...PUTER_FREE_MODELS]
    : [...PUTER_FREE_MODELS];

  let lastErr = "unknown";
  for (const model of models) {
    try {
      const res = await fetch(`${PUTER_OPENAI_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
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
        lastErr = `HTTP ${res.status} ${model}: ${t.slice(0, 160)}`;
        log.warn(`[puterAi] ${lastErr}`);
        continue;
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
      };
      const raw = data.choices?.[0]?.message?.content;
      let text = "";
      if (typeof raw === "string") text = raw;
      else if (Array.isArray(raw)) text = raw.map((p) => p.text ?? "").join("");
      if (!text) {
        lastErr = `empty content from ${model}`;
        continue;
      }
      return { text, model, source: "puter-user-pays" };
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e.message : String(e);
      log.warn(`[puterAi] ${model}: ${lastErr}`);
    }
  }
  throw new Error(`Puter AI failed: ${lastErr}`);
}
