import { getLegionHubUrl } from "./orchestrator";
import { getOllamaHost } from "../ollama";

export async function whisperHealth(): Promise<{
  ok: boolean;
  model?: string;
  via?: "legion" | "ollama";
  error?: string;
}> {
  const hub = await getLegionHubUrl();
  try {
    const res = await fetch(`${hub}/api/whisper/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = (await res.json()) as { model?: string };
      return { ok: true, model: data.model ?? "whisper", via: "legion" };
    }
  } catch { /* fall through */ }

  const host = await getOllamaHost();
  try {
    const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { ok: false, error: "Ollama unreachable" };
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const whisperModel = data.models?.find((m) => /whisper/i.test(m.name));
    if (whisperModel) {
      return { ok: true, model: whisperModel.name, via: "ollama" };
    }
    return { ok: false, error: "No whisper model in Ollama" };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : "unreachable" };
  }
}

export async function transcribeAudio(opts: {
  audioBase64: string;
  model?: string;
}): Promise<{ text: string; source: string }> {
  const hub = await getLegionHubUrl();
  try {
    const res = await fetch(`${hub}/api/whisper/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: opts.audioBase64, model: opts.model }),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { text?: string; transcript?: string };
      return { text: data.text ?? data.transcript ?? "", source: "legion-hub" };
    }
  } catch { /* fall through */ }

  const host = await getOllamaHost();
  const model = opts.model ?? "whisper";
  const res = await fetch(`${host}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: "Transcribe the attached audio.",
      images: [opts.audioBase64],
      stream: false,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Whisper transcribe failed: ${res.status} — ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { response?: string };
  return { text: data.response ?? "", source: "ollama" };
}