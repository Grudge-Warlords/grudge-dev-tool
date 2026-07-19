/**
 * ONE TRUTH fleet registry — keep aligned with:
 *   GrudgeBuilder shared/fleet/manifest.ts
 *   grudge-production-wiring skill
 *   warlord-genesis FLEET_URLS
 *
 * Never route new work through deprecated api.grudge-studio.com.
 */

export const FLEET_CLIENT_URL = "https://client.grudge-studio.com";

/** Railway Postgres game-data SSOT (characters, account, wallet, auth implementation). */
export const FLEET_GAME_DATA_URL =
  "https://grudge-api-production-0d46.up.railway.app";

export const FLEET_URLS = {
  /** Grudge ID public gateway (Cloudflare Worker → Railway auth) */
  auth: "https://id.grudge-studio.com",
  /** Studio portal shell (The-ENGINE) — not game-data SSOT */
  identityApi: "https://grudge-studio.com",
  /** Railway Postgres SSOT */
  gameData: FLEET_GAME_DATA_URL,
  assets: "https://assets.grudge-studio.com",
  objectStore: "https://objectstore.grudge-studio.com/api/v1",
  /** Vercel fleet client — same-origin rewrites for auth + game-data + objectstore */
  client: FLEET_CLIENT_URL,
  /** Legion / GRUDA AI hub */
  ai: "https://ai.grudge-studio.com",
  warlords: "https://grudgewarlords.com",
  /** Warlord Genesis production SPA */
  warlordGenesis: "https://warlord-genesis.vercel.app",
  warstrat: "https://warstrat.grudge-studio.com",
  /** Forge 3D editor (production) */
  forge: "https://forge.grudge-studio.com",
  /** Observatory telemetry */
  observatory: "https://obs.grudge-studio.com",
  /** Puter User-Pays SDK */
  puterSdk: "https://js.puter.com/v2/",
  /** Local Ollama default (desktop autonomous AI) */
  ollama: "http://localhost:11434",
  /** Deprecated — do not use for new auth or game-data */
  deprecatedApi: "https://api.grudge-studio.com",
} as const;

export type TruthProbeRole = "game-data" | "identity" | "assets" | "objectstore";

export interface TruthProbe {
  id: string;
  label: string;
  url: string;
  role: TruthProbeRole;
  ok?: boolean;
  status?: number | null;
  detail?: string | null;
  latencyMs?: number | null;
}

export function buildTruthProbes(apiBase: string): TruthProbe[] {
  const base = apiBase.replace(/\/$/, "");
  return [
    {
      id: "id-health",
      label: "Grudge ID health",
      url: `${FLEET_URLS.auth}/api/health`,
      role: "identity",
    },
    {
      id: "railway-health",
      label: "Railway game-data health",
      url: `${FLEET_URLS.gameData}/api/health`,
      role: "game-data",
    },
    {
      id: "auth-me",
      label: "Auth me (unauthed 401 ok)",
      url: `${base}/api/auth/me`,
      role: "identity",
    },
    {
      id: "os-items",
      label: "master-items.json",
      url: `${base}/api/objectstore/v1/master-items.json`,
      role: "objectstore",
    },
    {
      id: "os-recipes",
      label: "master-recipes.json",
      url: `${base}/api/objectstore/v1/master-recipes.json`,
      role: "objectstore",
    },
    {
      id: "os-direct",
      label: "ObjectStore direct",
      url: `${FLEET_URLS.objectStore}/master-items.json`,
      role: "objectstore",
    },
    {
      id: "icon-cdn",
      label: "CDN assets root",
      url: FLEET_URLS.assets,
      role: "assets",
    },
  ];
}

export async function probeEndpoint(probe: TruthProbe): Promise<TruthProbe> {
  const method = probe.role === "assets" ? "HEAD" : "GET";
  const start = Date.now();
  try {
    const res = await fetch(probe.url, {
      method,
      headers: method === "GET" ? { Accept: "application/json" } : undefined,
    });
    const ct = res.headers.get("content-type") || "";
    const htmlLeak = probe.role !== "assets" && ct.includes("text/html");
    // /api/auth/me without token is expected 401 — still proves route exists
    const authRouteOk =
      probe.id === "auth-me" && (res.status === 401 || res.status === 200);
    const ok = (res.ok || authRouteOk) && !htmlLeak;
    return {
      ...probe,
      ok,
      status: res.status,
      detail: htmlLeak
        ? "HTML leak (split-brain)"
        : authRouteOk && res.status === 401
          ? "route live (401 unauthenticated)"
          : ct.split(";")[0] || method,
      latencyMs: Date.now() - start,
    };
  } catch (e: unknown) {
    return {
      ...probe,
      ok: false,
      status: null,
      detail: e instanceof Error ? e.message : "unreachable",
      latencyMs: Date.now() - start,
    };
  }
}

export async function runTruthAudit(apiBase: string): Promise<{
  probes: TruthProbe[];
  score: number;
}> {
  const probes = buildTruthProbes(apiBase);
  const results = await Promise.all(probes.map(probeEndpoint));
  const ok = results.filter((p) => p.ok).length;
  return { probes: results, score: Math.round((ok / results.length) * 100) };
}

/** Minimum score for a healthy ONE TRUTH fleet (matches `grudge-dev doctor`). */
export const TRUTH_HEALTH_THRESHOLD = 85;