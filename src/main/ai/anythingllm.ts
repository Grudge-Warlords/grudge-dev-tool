import keytar from "keytar";

const SERVICE = "grudge-dev-tool";
const DEFAULT_BASE = process.env.ANYTHINGLLM_BASE_URL ?? "http://localhost:3001";
const DEFAULT_WORKSPACE = process.env.ANYTHINGLLM_WORKSPACE_SLUG ?? "assistant-chats";

function normalizeBaseUrl(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/i, "");
}

async function readSecret(account: string, fallback: string): Promise<string> {
  try {
    const v = await keytar.getPassword(SERVICE, account);
    return normalizeBaseUrl(v || fallback);
  } catch {
    return normalizeBaseUrl(fallback);
  }
}

async function writeSecret(account: string, value: string): Promise<void> {
  await keytar.setPassword(SERVICE, account, value.trim());
}

export async function getAnythingLlmBaseUrl(): Promise<string> {
  return readSecret("grudachain.anythingllmBaseUrl", DEFAULT_BASE);
}

export async function setAnythingLlmBaseUrl(url: string): Promise<void> {
  await writeSecret("grudachain.anythingllmBaseUrl", normalizeBaseUrl(url));
}

export async function getAnythingLlmApiKey(): Promise<string | null> {
  const fromVault = await keytar.getPassword(SERVICE, "grudachain.anythingllmApiKey");
  if (fromVault) return fromVault;
  return process.env.ANYTHINGLLM_API_KEY ?? process.env.anythingllm_api_key ?? null;
}

export async function setAnythingLlmApiKey(key: string): Promise<void> {
  await writeSecret("grudachain.anythingllmApiKey", key);
}

export async function clearAnythingLlmApiKey(): Promise<void> {
  try { await keytar.deletePassword(SERVICE, "grudachain.anythingllmApiKey"); } catch { /* not set */ }
}

export async function getWorkspaceSlug(): Promise<string> {
  return readSecret("grudachain.workspaceSlug", DEFAULT_WORKSPACE);
}

export async function setWorkspaceSlug(slug: string): Promise<void> {
  await writeSecret("grudachain.workspaceSlug", slug);
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

export interface AnythingLlmWorkspace {
  id: number;
  name: string;
  slug: string;
}

export async function anythingLlmHealth(): Promise<{
  ok: boolean;
  baseUrl: string;
  ping: boolean;
  authenticated: boolean;
  workspaceSlug: string;
  error: string | null;
  /** True when cloud AI providers can answer without local RAG. */
  cloudFallbackReady: boolean;
  mode: "rag" | "cloud" | "offline";
}> {
  const baseUrl = await getAnythingLlmBaseUrl();
  const workspaceSlug = await getWorkspaceSlug();
  let ping = false;
  let authenticated = false;
  let error: string | null = null;

  // Try several common AnythingLLM endpoints (versions differ)
  const pingPaths = ["/api/ping", "/api/v1/system/ping", "/"];
  for (const p of pingPaths) {
    try {
      const pingRes = await fetch(`${baseUrl}${p}`, { signal: AbortSignal.timeout(3500) });
      if (pingRes.ok || pingRes.status === 401 || pingRes.status === 403) {
        ping = true;
        break;
      }
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : "ping failed";
    }
  }

  const apiKey = await getAnythingLlmApiKey();
  if (apiKey && ping) {
    try {
      const authPaths = ["/api/v1/auth", "/api/auth"];
      for (const ap of authPaths) {
        const authRes = await fetch(`${baseUrl}${ap}`, {
          headers: authHeaders(apiKey),
          signal: AbortSignal.timeout(5000),
        });
        if (authRes.ok) {
          const data = (await authRes.json().catch(() => ({}))) as { authenticated?: boolean };
          authenticated = data.authenticated === true || authRes.ok;
          if (authenticated) break;
        } else if (authRes.status !== 404) {
          error = `auth HTTP ${authRes.status}`;
        }
      }
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : "auth failed";
    }
  } else if (!apiKey) {
    error = error ?? (ping ? "no Developer API key configured" : "AnythingLLM not running");
  }

  let cloudFallbackReady = false;
  try {
    const { providerKeyStatus } = await import("./secrets");
    const st = await providerKeyStatus();
    cloudFallbackReady = Boolean(st.groq || st.openai || st.huggingface || st.gemini || st.together);
  } catch { /* */ }

  const ragOk = ping && authenticated;
  const mode: "rag" | "cloud" | "offline" = ragOk ? "rag" : cloudFallbackReady ? "cloud" : "offline";

  return {
    ok: ragOk,
    baseUrl,
    ping,
    authenticated,
    workspaceSlug,
    error: ragOk ? null : error,
    cloudFallbackReady,
    mode,
  };
}

export async function listWorkspaces(): Promise<AnythingLlmWorkspace[]> {
  const apiKey = await getAnythingLlmApiKey();
  if (!apiKey) throw new Error("AnythingLLM API key not set");
  const baseUrl = await getAnythingLlmBaseUrl();
  const res = await fetch(`${baseUrl}/api/v1/workspaces`, {
    headers: authHeaders(apiKey),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`workspaces ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { workspaces?: AnythingLlmWorkspace[] };
  return data.workspaces ?? [];
}

export interface AnythingLlmChatOpts {
  message: string;
  mode?: "chat" | "query";
  sessionId?: string;
  workspaceSlug?: string;
}

export interface AnythingLlmChatResult {
  response: string;
  source: string;
  sessionId?: string;
  sources?: unknown[];
}

export async function workspaceChat(opts: AnythingLlmChatOpts): Promise<AnythingLlmChatResult> {
  const apiKey = await getAnythingLlmApiKey();
  if (!apiKey) throw new Error("AnythingLLM API key not set — add in Settings → GrudaChain");
  const baseUrl = await getAnythingLlmBaseUrl();
  const slug = opts.workspaceSlug ?? (await getWorkspaceSlug());
  const res = await fetch(`${baseUrl}/api/v1/workspace/${encodeURIComponent(slug)}/chat`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      message: opts.message,
      mode: opts.mode ?? "chat",
      sessionId: opts.sessionId,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`AnythingLLM chat ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    textResponse?: string;
    response?: string;
    sessionId?: string;
    sources?: unknown[];
  };
  return {
    response: data.textResponse ?? data.response ?? "",
    source: `anythingllm:${slug}`,
    sessionId: data.sessionId,
    sources: data.sources,
  };
}