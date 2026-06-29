import { FLEET_GAMES, type FleetGame } from "./fleetGames";

/**
 * Curated playable fleet experiences for the admin Play Modes tab.
 * Ordered by production relevance — not the full Games launcher catalog.
 */
export const PLAY_MODE_ORDER = [
  "studio-forge",
  "grudgewarlords",
  "grudges-survival",
  "rts-grudge",
  "grudge-drive",
  "grudge-arena",
  "dungeon-crawler",
  "grim-armada",
  "grudge-space-rts",
  "grudgeworld",
  "mech-forge",
  "arena-bridge",
  "final-fighter",
  "tactical-infinity",
] as const;

export type PlayModeId = (typeof PLAY_MODE_ORDER)[number];

export function getPlayModes(): FleetGame[] {
  const byId = new Map(FLEET_GAMES.map((g) => [g.id, g]));
  return PLAY_MODE_ORDER.map((id) => byId.get(id)).filter((g): g is FleetGame => Boolean(g));
}