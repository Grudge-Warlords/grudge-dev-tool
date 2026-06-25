import { FLEET_URLS } from "./fleet";

export interface FleetEndpoint {
  id: string;
  label: string;
  url: string;
  role: "client" | "auth" | "assets" | "objectstore" | "game-data" | "ai" | "frontend";
}

/** Canonical fleet endpoints for Games / Settings diagnostics (ONE TRUTH). */
export const FLEET_ENDPOINTS: FleetEndpoint[] = [
  { id: "client", label: "Fleet client (ONE TRUTH)", url: FLEET_URLS.client, role: "client" },
  { id: "auth", label: "Identity", url: FLEET_URLS.auth, role: "auth" },
  { id: "assets", label: "Public CDN", url: FLEET_URLS.assets, role: "assets" },
  { id: "objectstore", label: "ObjectStore JSON", url: FLEET_URLS.objectStore, role: "objectstore" },
  { id: "game-data", label: "Game API (Railway)", url: FLEET_URLS.gameData, role: "game-data" },
  { id: "ai", label: "Legion AI Hub", url: FLEET_URLS.ai, role: "ai" },
  { id: "warlords", label: "Game frontend", url: FLEET_URLS.warlords, role: "frontend" },
];