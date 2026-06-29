import keytar from "keytar";

const SERVICE = "grudge-dev-tool";

/** keytar account names for direct AI provider keys (bypass Legion/Grok hub). */
export const AI_PROVIDER_ACCOUNTS = {
  groq: "ai.groq",
  openai: "ai.openai",
  gemini: "ai.gemini",
  together: "ai.together",
  huggingface: "ai.huggingface",
  github: "ai.github",
  polyPizza: "ai.poly-pizza",
  colyseus: "ai.colyseus",
  cfApiToken: "cf-api-token",
} as const;

export type AiProviderId = keyof typeof AI_PROVIDER_ACCOUNTS;

const ENV_FALLBACK: Record<AiProviderId, string[]> = {
  groq: ["GROQ_API_KEY", "groq_api_key"],
  openai: ["OPENAI_API_KEY", "GEMINI_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  together: ["TOGETHER_API_KEY", "together_api_token"],
  huggingface: ["HUGGINGFACE_API_TOKEN", "HF_TOKEN", "huggingface_api_token"],
  github: ["GH_TOKEN", "GITHUB_TOKEN", "Gh_api_token"],
  polyPizza: ["POLY_PIZZA_API_KEY", "Poly_Pizza_api"],
  colyseus: ["COLYSEUS_CLOUD_TOKEN"],
  cfApiToken: ["CLOUDFLARE_MAX_API", "CF_API_TOKEN"],
};

export async function readProviderKey(id: AiProviderId): Promise<string | null> {
  try {
    const fromVault = await keytar.getPassword(SERVICE, AI_PROVIDER_ACCOUNTS[id]);
    if (fromVault) return fromVault;
  } catch { /* ignore */ }
  for (const envKey of ENV_FALLBACK[id]) {
    const v = process.env[envKey];
    if (v) return v;
  }
  return null;
}

export async function writeProviderKey(id: AiProviderId, value: string): Promise<void> {
  await keytar.setPassword(SERVICE, AI_PROVIDER_ACCOUNTS[id], value.trim());
}

export async function clearProviderKey(id: AiProviderId): Promise<void> {
  try { await keytar.deletePassword(SERVICE, AI_PROVIDER_ACCOUNTS[id]); } catch { /* not set */ }
}

export async function providerKeyStatus(): Promise<Record<AiProviderId, boolean>> {
  const out = {} as Record<AiProviderId, boolean>;
  for (const id of Object.keys(AI_PROVIDER_ACCOUNTS) as AiProviderId[]) {
    out[id] = Boolean(await readProviderKey(id));
  }
  return out;
}

/** OpenAI project keys (sk-proj-…) stored under GEMINI_API_KEY are routed to OpenAI. */
export async function resolveOpenAiKey(): Promise<string | null> {
  const openai = await readProviderKey("openai");
  if (openai) return openai;
  const geminiSlot = await readProviderKey("gemini");
  if (geminiSlot?.startsWith("sk-")) return geminiSlot;
  return null;
}

export async function resolveGeminiKey(): Promise<string | null> {
  const gemini = await readProviderKey("gemini");
  if (gemini && !gemini.startsWith("sk-")) return gemini;
  return null;
}