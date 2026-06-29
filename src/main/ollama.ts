const DEFAULT_HOST = "http://localhost:11434";

type AiPref = "auto" | "ollama" | "cloudflare";

interface OllamaStore {
  get<T>(key: string, defaultValue?: T): T;
  set<T>(key: string, value: T): void;
}

let store: OllamaStore | null = null;

async function getStore(): Promise<OllamaStore> {
  if (store) return store;
  const mod: any = await import("electron-store");
  const StoreCtor = mod.default ?? mod;
  store = new StoreCtor({ name: "grudge-ollama" });
  return store!;
}

function hostUrl(): string {
  return (process.env.OLLAMA_HOST ?? DEFAULT_HOST).replace(/\/$/, "");
}

export async function getOllamaHost(): Promise<string> {
  const s = await getStore();
  return (s.get("host", hostUrl()) as string).replace(/\/$/, "");
}

export function setOllamaHost(host: string): void {
  void getStore().then((s) => s.set("host", host.replace(/\/$/, "")));
}

export async function getPreferredModel(): Promise<string> {
  const s = await getStore();
  return s.get("model", "") as string;
}

export function setPreferredModel(model: string): void {
  void getStore().then((s) => s.set("model", model));
}

export async function getAiPreference(): Promise<AiPref> {
  const s = await getStore();
  const v = s.get("aiPref", "auto") as AiPref;
  return v === "ollama" || v === "cloudflare" ? v : "auto";
}

export function setAiPreference(pref: AiPref): void {
  void getStore().then((s) => s.set("aiPref", pref));
}

export async function ollamaHealth(): Promise<{
  ok: boolean;
  latencyMs: number;
  version?: string;
  error?: string;
}> {
  const start = Date.now();
  const host = await getOllamaHost();
  try {
    const res = await fetch(`${host}/api/version`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) {
      return { ok: false, latencyMs: Date.now() - start, error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { version?: string };
    return { ok: true, latencyMs: Date.now() - start, version: body.version };
  } catch (e: unknown) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : "unreachable",
    };
  }
}

export async function ollamaModels(): Promise<Array<{ name: string; size?: number }>> {
  const host = await getOllamaHost();
  const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Ollama models: HTTP ${res.status}`);
  const data = (await res.json()) as { models?: Array<{ name: string; size?: number }> };
  return data.models ?? [];
}

export async function ollamaChat(opts: {
  model?: string;
  messages: Array<{ role: string; content: string }>;
}): Promise<{ message: { content: string } }> {
  const host = await getOllamaHost();
  const model = opts.model || (await getPreferredModel()) || (await pickDefaultModel(host));
  const res = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: opts.messages, stream: false }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Ollama chat: ${res.status} — ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { message?: { content: string } };
  return { message: { content: data.message?.content ?? "" } };
}

export async function ollamaGenerate(opts: {
  model?: string;
  system?: string;
  prompt: string;
}): Promise<{ response: string }> {
  const host = await getOllamaHost();
  const model = opts.model || (await getPreferredModel()) || (await pickDefaultModel(host));
  const res = await fetch(`${host}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      system: opts.system,
      prompt: opts.prompt,
      stream: false,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Ollama generate: ${res.status} — ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { response?: string };
  return { response: data.response ?? "" };
}

async function pickDefaultModel(host: string): Promise<string> {
  try {
    const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return "llama3.2";
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return data.models?.[0]?.name ?? "llama3.2";
  } catch {
    return "llama3.2";
  }
}