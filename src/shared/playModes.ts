import { FLEET_GAMES, type FleetGame } from "./fleetGames";

/**
 * Curated playable fleet experiences for the admin Play Modes tab.
 * Ordered by production funnel relevance — live domains only (no orphaned Vercel).
 *
 * SSOT domains: grudge-fleet + grudge-live-servers.
 * Water / home island = water.grudge-studio.com (Tactical-Infinity repo) — never tactical-infinity.vercel.app.
 */
export const PLAY_MODE_ORDER = [
  // Production funnel
  "open-launcher",
  "character-foundry",
  "client-play",
  "grudgewarlords",
  "tactical-infinity", // water.grudge-studio.com
  "grudox",
  "multiverse", // grudge-multiverse.vercel.app + dedicated Railway /api/mv
  // Editors & tools in play surface
  "studio-forge",
  "grudge-pipeline",
  "studio-editor",
  // Live / active games
  "grudges-survival",
  "rts-grudge",
  "grudge-drive",
  "grudge-arena",
  "dungeon-crawler",
  "grim-armada",
  "grudge-space-rts",
  "mech-forge",
  "metaverse", // avatars hub — not Multiverse
  "arena-bridge",
  "final-fighter",
] as const;

export type PlayModeId = (typeof PLAY_MODE_ORDER)[number];

export function getPlayModes(): FleetGame[] {
  const byId = new Map(FLEET_GAMES.map((g) => [g.id, g]));
  return PLAY_MODE_ORDER.map((id) => byId.get(id)).filter((g): g is FleetGame => Boolean(g));
}
