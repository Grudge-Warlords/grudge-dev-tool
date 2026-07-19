/** ONE TRUTH fleet registry — keep aligned with src/shared/fleet.ts + GrudgeBuilder manifest */

export const FLEET_URLS = {
  auth: "https://id.grudge-studio.com",
  identityApi: "https://grudge-studio.com",
  gameData: "https://grudge-api-production-0d46.up.railway.app",
  assets: "https://assets.grudge-studio.com",
  objectStore: "https://objectstore.grudge-studio.com/api/v1",
  client: "https://client.grudge-studio.com",
  ai: "https://ai.grudge-studio.com",
  warlords: "https://grudgewarlords.com",
  forge: "https://forge.grudge-studio.com",
  /** @deprecated never use for new work */
  deprecatedApi: "https://api.grudge-studio.com",
} as const;

export type TruthProbeRole = "game-data" | "identity" | "assets" | "objectstore";

export interface TruthProbe {
  id: string;
  label: string;
  url: string;
  role: TruthProbeRole;
  ok?: boolean;
  status?: number;
  detail?: string;
}

export function buildTruthProbes(apiBase: string): TruthProbe[] {
  const base = apiBase.replace(/\/$/, "");
  return [
    { id: "fleet-manifest", label: "Fleet manifest", url: `${base}/api/fleet/manifest`, role: "game-data" },
    { id: "auth-verify", label: "Auth verify", url: `${base}/api/auth/verify`, role: "identity" },
    { id: "os-items", label: "master-items.json", url: `${base}/api/objectstore/v1/master-items.json`, role: "objectstore" },
    { id: "os-recipes", label: "master-recipes.json", url: `${base}/api/objectstore/v1/master-recipes.json`, role: "objectstore" },
    { id: "icon-pack", label: "Pack weapon icon", url: `${base}/api/assets/icons/pack/weapons/Sword_01.png`, role: "assets" },
    { id: "supabase-health", label: "Supabase health", url: `${base}/api/supabase/health`, role: "game-data" },
  ];
}

export async function probeEndpoint(probe: TruthProbe): Promise<TruthProbe> {
  const method = probe.role === "assets" ? "HEAD" : "GET";
  try {
    const res = await fetch(probe.url, {
      method,
      headers: method === "GET" ? { Accept: "application/json" } : undefined,
    });
    const ct = res.headers.get("content-type") || "";
    const htmlLeak =
      probe.role !== "assets" && ct.includes("text/html");
    return {
      ...probe,
      ok: res.ok && !htmlLeak,
      status: res.status,
      detail: htmlLeak ? "HTML leak (split-brain)" : ct.split(";")[0] || method,
    };
  } catch (e: unknown) {
    return {
      ...probe,
      ok: false,
      detail: e instanceof Error ? e.message : "unreachable",
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