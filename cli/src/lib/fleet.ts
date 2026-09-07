/**
 * CLI fleet probes — duplicate of src/shared/fleet.ts Truth probes.
 * Keep aligned with src/shared/fleet.ts (cannot re-export across package roots under all tsx modes).
 */

export const FLEET_URLS = {
  auth: "https://id.grudge-studio.com",
  identityApi: "https://grudge-studio.com",
  gameData: "https://grudge-api-production-0d46.up.railway.app",
  assets: "https://assets.grudge-studio.com",
  objectStore: "https://objectstore.grudge-studio.com/api/v1",
  info: "https://info.grudge-studio.com/api/v1",
  client: "https://client.grudge-studio.com",
  ai: "https://ai.grudge-studio.com",
  /** Player account cloud — FS + puter.site. Never bag/roster. */
  puterSpace: "https://ai.grudge-studio.com/puter-space",
  warlords: "https://grudgewarlords.com",
  forge: "https://forge.grudge-studio.com",
  pipeline: "https://grudge-pipeline.vercel.app",
  multiverse: "https://grudge-multiverse.vercel.app",
  multiverseRoom: "https://grudge-multiverse-room-production.up.railway.app",
  observatory: "https://obs.grudge-studio.com",
  threeflow: "https://threeflow.vercel.app",
  coder: "https://coder.grudge-studio.com",
  velocity: "https://drive.grudge-studio.com",
  avernus: "https://grudge-studio.com/avernus-arena",
  voxelStudio: "https://grudox.grudge-studio.com/studio/",
  /** @deprecated legacy asset index — still may 200; not for new player APIs */
  deprecatedApi: "https://api.grudge-studio.com",
} as const;

export type TruthProbeRole =
  | "game-data"
  | "identity"
  | "assets"
  | "objectstore"
  | "ai"
  | "forge"
  | "play"
  | "multiplayer"
  | "legacy"
  | "optional";

export interface TruthProbe {
  id: string;
  label: string;
  url: string;
  role: TruthProbeRole;
  optional?: boolean;
  ok?: boolean;
  status?: number | null;
  detail?: string | null;
  latencyMs?: number | null;
}

export function buildTruthProbes(apiBase: string): TruthProbe[] {
  const base = apiBase.replace(/\/$/, "");
  return [
    {
      id: "client-health",
      label: "Client API health",
      url: `${base}/api/health`,
      role: "game-data",
    },
    {
      id: "railway-health",
      label: "Railway game-data health",
      url: `${FLEET_URLS.gameData}/api/health`,
      role: "game-data",
    },
    {
      id: "id-health",
      label: "Grudge ID health",
      url: `${FLEET_URLS.auth}/api/health`,
      role: "identity",
    },
    {
      id: "auth-me",
      label: "Auth me (401 ok)",
      url: `${base}/api/auth/me`,
      role: "identity",
    },
    {
      id: "characters",
      label: "Characters API (401 ok)",
      url: `${base}/api/characters`,
      role: "game-data",
    },
    {
      id: "os-proxy-v1-items",
      label: "Proxy master-items v1",
      url: `${base}/api/objectstore/v1/master-items.json`,
      role: "objectstore",
    },
    {
      id: "os-direct-catalog",
      label: "ObjectStore catalog",
      url: `${FLEET_URLS.objectStore}/catalog`,
      role: "objectstore",
    },
    {
      id: "os-direct-items",
      label: "ObjectStore master-items",
      url: `${FLEET_URLS.objectStore}/master-items.json`,
      role: "objectstore",
    },
    {
      id: "os-ummorpg-placeables",
      label: "uMMORPG placeables catalog",
      url: `${FLEET_URLS.objectStore}/ummorpg-placeables-for-forge.json`,
      role: "objectstore",
      optional: true,
    },
    {
      id: "os-ummorpg-skills",
      label: "uMMORPG skills catalog",
      url: `${FLEET_URLS.objectStore}/ummorpg-skills-for-forge.json`,
      role: "objectstore",
      optional: true,
    },
    {
      id: "info-weapons",
      label: "info weapons.json",
      url: `${FLEET_URLS.info}/weapons.json`,
      role: "objectstore",
    },
    {
      id: "cdn-grudge6",
      label: "CDN grudge6 WK FBX",
      url: `${FLEET_URLS.assets}/models/grudge6/races/WK_Characters.fbx`,
      role: "assets",
    },
    {
      id: "cdn-warlords-entity",
      label: "CDN warlords horse.glb",
      url: `${FLEET_URLS.assets}/models/warlords/entities/horse.glb`,
      role: "assets",
    },
    {
      id: "ai-legion",
      label: "Legion AI hub",
      url: FLEET_URLS.ai,
      role: "ai",
    },
    {
      id: "puter-space",
      label: "Puter Space (account cloud)",
      url: FLEET_URLS.puterSpace,
      role: "ai",
    },
    {
      id: "cdn-toon-human",
      label: "CDN Toon human.glb",
      url: `${FLEET_URLS.assets}/asset-packs/toon-rts-characters/glb/characters/human.glb`,
      role: "assets",
    },
    {
      id: "forge",
      label: "Forge editor",
      url: FLEET_URLS.forge,
      role: "forge",
    },
    {
      id: "threeflow",
      label: "ThreeFlow editor",
      url: FLEET_URLS.threeflow,
      role: "forge",
    },
    {
      id: "coder",
      label: "Coder IDE",
      url: FLEET_URLS.coder,
      role: "forge",
    },
    {
      id: "velocity",
      label: "Velocity Grudge City",
      url: FLEET_URLS.velocity,
      role: "play",
    },
    {
      id: "avernus",
      label: "Avernus Arena",
      url: FLEET_URLS.avernus,
      role: "play",
    },
    {
      id: "voxel-studio",
      label: "GRUDOX Studio (world gold)",
      url: FLEET_URLS.voxelStudio,
      role: "play",
    },
    {
      id: "multiverse-room",
      label: "Multiverse room health",
      url: `${FLEET_URLS.multiverseRoom}/api/health`,
      role: "multiplayer",
    },
    {
      id: "legacy-api-index",
      label: "Legacy api.grudge-studio.com",
      url: `${FLEET_URLS.deprecatedApi}/assets?limit=1`,
      role: "legacy",
      optional: true,
    },
    {
      id: "obs",
      label: "Observatory (optional)",
      url: FLEET_URLS.observatory,
      role: "optional",
      optional: true,
    },
  ];
}

export const TRUTH_PROBE_TIMEOUT_MS = 8_000;

export async function probeEndpoint(probe: TruthProbe): Promise<TruthProbe> {
  const method = probe.role === "assets" ? "HEAD" : "GET";
  const start = Date.now();
  try {
    const res = await fetch(probe.url, {
      method,
      signal: AbortSignal.timeout(TRUTH_PROBE_TIMEOUT_MS),
      headers:
        method === "GET" ? { Accept: "application/json, text/html, */*" } : undefined,
    });
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    // These are reachability probes: cancel the body instead of downloading catalogs or HTML.
    void res.body?.cancel().catch(() => undefined);
    const htmlLeak =
      probe.role !== "ai" &&
      probe.role !== "forge" &&
      probe.role !== "play" &&
      probe.role !== "optional" &&
      (ct.includes("text/html") || ct.includes("application/xhtml+xml"));
    const authRouteOk =
      (probe.id === "auth-me" || probe.id === "characters") &&
      (res.status === 401 || res.status === 200);
    const spaOk =
      (probe.role === "ai" || probe.role === "forge" || probe.role === "play") &&
      res.ok &&
      (ct.includes("text/html") || ct.includes("json"));
    const ok = spaOk || ((res.ok || authRouteOk) && !htmlLeak);
    return {
      ...probe,
      ok,
      status: res.status,
      detail: htmlLeak
        ? "HTML leak (split-brain)"
        : authRouteOk && res.status === 401
          ? "route live (401 unauthenticated)"
          : spaOk
            ? "SPA/shell live"
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
  criticalScore: number;
  optional: TruthProbe[];
}> {
  const probes = buildTruthProbes(apiBase);
  const results = await Promise.all(probes.map(probeEndpoint));
  const critical = results.filter((p) => !p.optional);
  const optional = results.filter((p) => p.optional);
  const ok = critical.filter((p) => p.ok).length;
  const score = Math.round((ok / Math.max(1, critical.length)) * 100);
  return { probes: results, score, criticalScore: score, optional };
}

export const TRUTH_HEALTH_THRESHOLD = 85;
