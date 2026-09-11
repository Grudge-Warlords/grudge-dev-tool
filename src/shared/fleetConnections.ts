import { FLEET_URLS } from "./fleet";

export interface FleetEndpoint {
  id: string;
  label: string;
  url: string;
  role:
    | "client"
    | "auth"
    | "assets"
    | "objectstore"
    | "info"
    | "game-data"
    | "ai"
    | "frontend"
    | "engine"
    | "ops";
  /** Highlight on admin Dev Tool diagnostics */
  adminCritical?: boolean;
}

/** Canonical fleet endpoints for Games / Settings / Preview diagnostics (ONE TRUTH). */
export const FLEET_ENDPOINTS: FleetEndpoint[] = [
  { id: "client", label: "Fleet client (ONE TRUTH)", url: FLEET_URLS.client, role: "client", adminCritical: true },
  { id: "auth", label: "Grudge ID", url: FLEET_URLS.auth, role: "auth", adminCritical: true },
  { id: "game-data", label: "Game data (Railway SSOT)", url: FLEET_URLS.gameData, role: "game-data", adminCritical: true },
  { id: "engine", label: "Portal / The-ENGINE", url: FLEET_URLS.identityApi, role: "engine", adminCritical: true },
  { id: "assets", label: "Public CDN", url: FLEET_URLS.assets, role: "assets", adminCritical: true },
  { id: "objectstore", label: "ObjectStore JSON", url: FLEET_URLS.objectStore, role: "objectstore", adminCritical: true },
  { id: "info", label: "info.* catalogs", url: FLEET_URLS.info, role: "info", adminCritical: true },
  { id: "ai", label: "Legion AI Hub", url: FLEET_URLS.ai, role: "ai", adminCritical: true },
  { id: "puter-space", label: "Puter Space (account cloud)", url: FLEET_URLS.puterSpace, role: "ai" },
  { id: "forge", label: "Forge editor", url: FLEET_URLS.forge, role: "frontend", adminCritical: true },
  { id: "coder", label: "Coder IDE", url: FLEET_URLS.coder, role: "frontend", adminCritical: true },
  { id: "cloudpilot", label: "CloudPilot AI Studio", url: FLEET_URLS.cloudpilot || `${FLEET_URLS.coder}/cloudpilot`, role: "frontend" },
  { id: "ui", label: "UI Kit (HYDRA)", url: FLEET_URLS.ui, role: "frontend", adminCritical: true },
  { id: "ui-studio", label: "UI Studio", url: FLEET_URLS.uiStudio || `${FLEET_URLS.ui}/studio`, role: "frontend", adminCritical: true },
  { id: "ui-assets", label: "UI Assets browser", url: FLEET_URLS.uiAssets || `${FLEET_URLS.ui}/assets`, role: "frontend" },
  { id: "pipeline", label: "Grudge Pipeline", url: FLEET_URLS.pipeline, role: "frontend" },
  { id: "builder", label: "Grok Builder", url: FLEET_URLS.grokBuilder, role: "frontend" },
  { id: "open", label: "Open launcher", url: FLEET_URLS.open, role: "frontend", adminCritical: true },
  { id: "grudox", label: "GRUDOX hub", url: FLEET_URLS.grudox, role: "frontend", adminCritical: true },
  { id: "carrier", label: "Carrier edge", url: FLEET_URLS.carrier, role: "frontend" },
  { id: "multiverse", label: "Multiverse SPA", url: FLEET_URLS.multiverse, role: "frontend", adminCritical: true },
  {
    id: "multiverse-room",
    label: "Multiverse Railway (/api/mv)",
    url: FLEET_URLS.multiverseRoom,
    role: "game-data",
    adminCritical: true,
  },
  { id: "water", label: "Water home island", url: FLEET_URLS.water, role: "frontend", adminCritical: true },
  { id: "warlords", label: "Warlords frontend", url: FLEET_URLS.warlords, role: "frontend", adminCritical: true },
  { id: "foundry", label: "Character Foundry", url: FLEET_URLS.characterFoundry, role: "frontend" },
  {
    id: "foundry-prefab-warlords",
    label: "Foundry prefab (Warlords)",
    url: FLEET_URLS.characterPrefabWarlords || `${FLEET_URLS.characterFoundry}/prefab?era=warlords`,
    role: "frontend",
  },
  { id: "velocity", label: "Velocity City", url: FLEET_URLS.velocity, role: "frontend", adminCritical: true },
  { id: "avernus", label: "Avernus Arena", url: FLEET_URLS.avernus, role: "frontend", adminCritical: true },
  { id: "voxel-studio", label: "Studio world gold", url: FLEET_URLS.voxelStudio, role: "frontend" },
  { id: "threeflow", label: "ThreeFlow", url: FLEET_URLS.threeflow, role: "frontend", adminCritical: true },
  { id: "warlord-genesis", label: "Warlord Genesis", url: FLEET_URLS.warlordGenesis, role: "frontend" },
  { id: "observatory", label: "Observatory", url: FLEET_URLS.observatory, role: "ops" },
];

/** Admin Dev Tool: endpoints that should appear on Home / Preview chips. */
export function adminCriticalEndpoints(): FleetEndpoint[] {
  return FLEET_ENDPOINTS.filter((e) => e.adminCritical);
}

/* ─── Deploy platform tokens + redeploy targets (Settings) ─── */

export const FLEET_TOKEN_ACCOUNTS = {
  vercel: "fleet.vercelToken",
  railway: "fleet.railwayToken",
  cloudflare: "fleet.cfApiToken",
  puter: "puter-token",
} as const;

export type FleetTokenKind = keyof typeof FLEET_TOKEN_ACCOUNTS;

export type FleetDeployTarget = {
  id: string;
  label: string;
  platform: "vercel" | "railway" | "cloudflare" | "puter";
  url: string;
  cwd?: string;
  vercelProject?: string;
  railwayService?: string;
  workerName?: string;
  puterSite?: string;
};

/** Curated redeploy matrix — local cwd when present; else CLI redeploy-by-URL. */
export const FLEET_DEPLOY_TARGETS: FleetDeployTarget[] = [
  {
    id: "ui",
    label: "UI Studio (HYDRA)",
    platform: "vercel",
    url: "https://ui.grudge-studio.com",
    cwd: "F:\\GitHub\\grudge-ui-editor",
    vercelProject: "grudge-ui-editor",
  },
  {
    id: "coder",
    label: "Coder / CloudPilot",
    platform: "cloudflare",
    url: "https://coder.grudge-studio.com",
    cwd: "F:\\GitHub\\GrudachainCode",
  },
  {
    id: "ai-hub",
    label: "Legion AI hub",
    platform: "cloudflare",
    url: "https://ai.grudge-studio.com",
    cwd: "F:\\GitHub\\grudge-ai-hub",
    workerName: "grudge-ai-hub",
  },
  {
    id: "objectstore-cdn",
    label: "Asset CDN Worker",
    platform: "cloudflare",
    url: "https://assets.grudge-studio.com",
    cwd: "F:\\GitHub\\ObjectStore\\workers\\cdn",
    workerName: "grudge-asset-cdn",
  },
  {
    id: "objectstore-api",
    label: "ObjectStore Worker",
    platform: "cloudflare",
    url: "https://objectstore.grudge-studio.com",
    cwd: "F:\\GitHub\\ObjectStore\\workers\\assets",
    workerName: "grudgeassets",
  },
  {
    id: "game-data",
    label: "Railway game-data",
    platform: "railway",
    url: "https://grudge-api-production-0d46.up.railway.app",
    railwayService: "grudge-api",
  },
  {
    id: "forge",
    label: "Forge editor",
    platform: "vercel",
    url: "https://forge.grudge-studio.com",
    vercelProject: "forge",
  },
  {
    id: "threeflow",
    label: "ThreeFlow",
    platform: "vercel",
    url: "https://threeflow.vercel.app",
    vercelProject: "threeflow",
  },
  {
    id: "character",
    label: "Character Foundry",
    platform: "vercel",
    url: "https://character.grudge-studio.com",
    vercelProject: "character",
  },
  {
    id: "open",
    label: "Grudge Open",
    platform: "vercel",
    url: "https://open.grudge-studio.com",
    vercelProject: "gameopen",
  },
];

export const FLEET_TOKEN_ENV_MAP: Record<string, string> = {
  VERCEL_TOKEN: FLEET_TOKEN_ACCOUNTS.vercel,
  RAILWAY_TOKEN: FLEET_TOKEN_ACCOUNTS.railway,
  CF_API_TOKEN: FLEET_TOKEN_ACCOUNTS.cloudflare,
  CLOUDFLARE_API_TOKEN: FLEET_TOKEN_ACCOUNTS.cloudflare,
  PUTER_AUTH_TOKEN: FLEET_TOKEN_ACCOUNTS.puter,
  PUTER_TOKEN: FLEET_TOKEN_ACCOUNTS.puter,
};