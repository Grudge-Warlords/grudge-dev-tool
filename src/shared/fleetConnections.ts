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
  { id: "forge", label: "Forge editor", url: FLEET_URLS.forge, role: "frontend", adminCritical: true },
  { id: "coder", label: "Coder IDE", url: FLEET_URLS.coder, role: "frontend", adminCritical: true },
  { id: "pipeline", label: "Grudge Pipeline", url: FLEET_URLS.pipeline, role: "frontend" },
  { id: "builder", label: "Grok Builder", url: FLEET_URLS.grokBuilder, role: "frontend" },
  { id: "open", label: "Open launcher", url: FLEET_URLS.open, role: "frontend", adminCritical: true },
  { id: "grudox", label: "GRUDOX hub", url: FLEET_URLS.grudox, role: "frontend", adminCritical: true },
  { id: "carrier", label: "Carrier edge", url: FLEET_URLS.carrier, role: "frontend" },
  { id: "water", label: "Water home island", url: FLEET_URLS.water, role: "frontend", adminCritical: true },
  { id: "warlords", label: "Warlords frontend", url: FLEET_URLS.warlords, role: "frontend", adminCritical: true },
  { id: "foundry", label: "Character Foundry", url: FLEET_URLS.characterFoundry, role: "frontend" },
  { id: "warlord-genesis", label: "Warlord Genesis", url: FLEET_URLS.warlordGenesis, role: "frontend" },
  { id: "observatory", label: "Observatory", url: FLEET_URLS.observatory, role: "ops" },
];

/** Admin Dev Tool: endpoints that should appear on Home / Preview chips. */
export function adminCriticalEndpoints(): FleetEndpoint[] {
  return FLEET_ENDPOINTS.filter((e) => e.adminCritical);
}