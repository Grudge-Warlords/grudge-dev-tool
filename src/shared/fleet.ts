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
  /** Live JSON catalogs (definitions) — often more complete than objectstore edge */
  info: "https://info.grudge-studio.com/api/v1",
  /** Vercel fleet client — same-origin rewrites for auth + game-data + objectstore */
  client: FLEET_CLIENT_URL,
  /** Legion / GRUDA AI hub */
  ai: "https://ai.grudge-studio.com",
  warlords: "https://grudgewarlords.com",
  /** Open launcher (canonical library) */
  open: "https://open.grudge-studio.com",
  /** Character Foundry (create + 4-slot only) */
  characterFoundry: "https://character.grudge-studio.com",
  /** Warlords home island / open water (Tactical-Infinity production) */
  water: "https://water.grudge-studio.com",
  /** GRUDOX hub + Carrier edge */
  grudox: "https://grudox.grudge-studio.com",
  carrier: "https://carrier.grudge-studio.com",
  /** Warlord Genesis production SPA */
  warlordGenesis: "https://warlord-genesis.vercel.app",
  warstrat: "https://warstrat.grudge-studio.com",
  /** Forge 3D editor (production) — develop + deploy 3D games */
  forge: "https://forge.grudge-studio.com",
  /**
   * ThreeFlow — Warlords scene editor / deploy surface (Vue + three r185).
   * Viewer/Forge hand off CDN URLs via ?asset= — not a second play host.
   */
  threeflow: "https://threeflow.vercel.app",
  /**
   * Game UI Studio (HYDRA) — HUD / menus / settings / packs for all editors.
   * Open hosts GRUDOX as voxel launcher; UI is shared chrome SSOT.
   */
  ui: "https://ui.grudge-studio.com",
  /**
   * Grok Builder — agentic Three.js + Rapier editor (Open + Dev Tool primary builder).
   * Prod: Vercel project `grok-builder` (grudgenexus). Local: http://localhost:5190.
   * Custom DNS `builder.grudge-studio.com` is optional — do not hardcode until CNAME is live.
   */
  grokBuilder: "https://grok-builder.vercel.app",
  /**
   * Grudge Pipeline — FBX/GLB ingest → bake → R2 → handoff to Forge.
   * Production: grudge-pipeline.vercel.app (postMessage import into Forge).
   */
  pipeline: "https://grudge-pipeline.vercel.app",
  /** GrudgeChain Vibe IDE (CF Pages) + AI workers */
  coder: "https://coder.grudge-studio.com",
  /** Coder alias */
  grudachain: "https://grudachain.grudge-studio.com",
  /** Browser studio editor */
  studio: "https://studio.grudge-studio.com",
  /** Dungeon Crawler Quest */
  dcq: "https://dcq.grudge-studio.com",
  /** Survival */
  survival: "https://grudges.grudge-studio.com",
  /** Metaverse (avatars hub — not Multiverse) */
  metaverse: "https://metaverse.grudge-studio.com",
  /**
   * Grudge Multiverse — Bermuda island MP (grudge6 RTS Toon).
   * Vercel SPA + dedicated Railway room `/api/mv` (NOT Carrier / gameopen-production).
   */
  multiverse: "https://grudge-multiverse.vercel.app",
  /** Multiverse multiplayer room (own Railway service) */
  multiverseRoom: "https://grudge-multiverse-room-production.up.railway.app",
  /** Observatory telemetry */
  observatory: "https://obs.grudge-studio.com",
  /** Puter User-Pays SDK */
  puterSdk: "https://js.puter.com/v2/",
  /** Local Ollama default (desktop autonomous AI) */
  ollama: "http://localhost:11434",
  /** Deprecated — do not use for new auth or game-data */
  deprecatedApi: "https://api.grudge-studio.com",
} as const;

export type TruthProbeRole =
  | "game-data"
  | "identity"
  | "assets"
  | "objectstore"
  | "ai"
  | "forge"
  | "multiplayer"
  | "legacy"
  | "optional";

export interface TruthProbe {
  id: string;
  label: string;
  url: string;
  role: TruthProbeRole;
  /** When true, failure does not lower fleet health score (info only). */
  optional?: boolean;
  ok?: boolean;
  status?: number | null;
  detail?: string | null;
  latencyMs?: number | null;
}

/**
 * Live-proved ONE TRUTH probes (2026-08).
 * Prefer paths that return 200 or expected 401 — not aspirational 404 routes
 * like `/api/objectstore/list` or `/api/auth/session`.
 */
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
    },
    {
      id: "os-ummorpg-skills",
      label: "uMMORPG skills catalog",
      url: `${FLEET_URLS.objectStore}/ummorpg-skills-for-forge.json`,
      role: "objectstore",
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
      id: "forge",
      label: "Forge editor",
      url: FLEET_URLS.forge,
      role: "forge",
    },
    {
      id: "multiverse-room",
      label: "Multiverse room health",
      url: `${FLEET_URLS.multiverseRoom}/api/health`,
      role: "multiplayer",
    },
    // Informational — not scored
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

export async function probeEndpoint(probe: TruthProbe): Promise<TruthProbe> {
  const method = probe.role === "assets" ? "HEAD" : "GET";
  const start = Date.now();
  try {
    const res = await fetch(probe.url, {
      method,
      headers: method === "GET" ? { Accept: "application/json, text/html, */*" } : undefined,
    });
    const ct = res.headers.get("content-type") || "";
    const htmlLeak =
      probe.role !== "assets" &&
      probe.role !== "ai" &&
      probe.role !== "forge" &&
      probe.role !== "optional" &&
      ct.includes("text/html") &&
      !res.ok;
    // Expected auth without token
    const authRouteOk =
      (probe.id === "auth-me" || probe.id === "characters") &&
      (res.status === 401 || res.status === 200);
    // SPA shells (Forge, Legion UI) return HTML 200
    const spaOk =
      (probe.role === "ai" || probe.role === "forge") &&
      res.ok &&
      (ct.includes("text/html") || ct.includes("json"));
    const ok =
      spaOk ||
      ((res.ok || authRouteOk) && !htmlLeak);
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
  return {
    probes: results,
    score,
    criticalScore: score,
    optional,
  };
}

/** Minimum score for a healthy ONE TRUTH fleet (matches `grudge-dev doctor`). */
export const TRUTH_HEALTH_THRESHOLD = 85;