/**
 * Island deployment SSOT for Grudge Dev Tool + Forge open targets.
 *
 * Sources (Warlords / GrudgeBuilder definitions — keep in sync conceptually):
 *   - homeIslandSpec / homeIslandSeed / home-island-contract.json
 *   - floatingIslandBossAssets (event + boss GLBs)
 *   - lobbyIslands + factionLobbyIslands
 *   - pirate-islands lobby mesh
 *
 * Open targets:
 *   - playUrl      → live SPA surface
 *   - forgeUrl      → forge.grudge-studio.com with island query
 *   - meshUrls[]    → CDN GLBs for local Forge 3D tools
 *   - deployPrefix  → R2 path for generator / bake outputs
 */

export type IslandKind =
  | "home_generator"
  | "home_play"
  | "event"
  | "boss"
  | "faction"
  | "lobby"
  | "open_world";

export type IslandStatus = "live" | "partial" | "planned";

export interface IslandDeploymentDefinition {
  id: string;
  displayName: string;
  kind: IslandKind;
  status: IslandStatus;
  /** Live client/water surface (browser play) */
  playUrl: string;
  /** Production Forge deep-link (edit + import) */
  forgeQuery: Record<string, string>;
  /** Representative CDN meshes (open in local Forge tools) */
  meshUrls: string[];
  /** R2 prefixes for deploy / generator output */
  deployPrefix: string;
  assetPrefixes: string[];
  /** ObjectStore / contract keys */
  contracts?: string[];
  /** GrudgeBuilder / TI definition file hints */
  sourceDefs: string[];
  notes: string[];
  /** Prefer this when listing “open in Forge” defaults */
  primaryMesh?: string;
}

const CDN = "https://assets.grudge-studio.com";
const CLIENT = "https://client.grudge-studio.com";
const WATER = "https://water.grudge-studio.com";
const FORGE = "https://forge.grudge-studio.com";

/** Pirate open-world lobby GLB (Forge skill SSOT). */
export const PIRATE_ISLANDS_MESH = `${CDN}/models/lobby/pirate-islands/scene.glb`;

/** Boss / event floating island meshes (floatingIslandBossAssets.ts). */
export const BOSS_EVENT_MESHES = {
  lyoko: `${CDN}/models/biomes/ethereal/lyoko_mountain_sector.glb`,
  spiralMountain: `${CDN}/models/biomes/event/spiral_mountain_reimagined.glb`,
  hothBossRoom: `${CDN}/models/biomes/frozen/hoth_boss_room_low_poly.glb`,
  iceland: `${CDN}/models/biomes/cold/iceland_scene_for_canimatic.glb`,
} as const;

export const ISLAND_DEPLOYMENT_DEFINITIONS: IslandDeploymentDefinition[] = [
  // ── Home island generator + play ──────────────────────────────────────────
  {
    id: "home-island-generator",
    displayName: "Home Island Generator (spec + seed)",
    kind: "home_generator",
    status: "live",
    playUrl: `${CLIENT}/home-island`,
    forgeQuery: {
      edit: "1",
      mode: "edit",
      island: "home_generator",
      from: "grudge-dev-tool",
      contract: "home-island-contract.json",
    },
    meshUrls: [
      `${CDN}/models/nature/stylized/concept/example_home_island.glb`,
      `${CDN}/models/nature/stylized/biome/nature_vegetation.glb`,
      `${CDN}/models/nature/stylized/rocks/stylised_rocks.glb`,
    ],
    deployPrefix: "models/environment/water/",
    assetPrefixes: ["models/nature/", "models/environment/water/", "models/ships/"],
    contracts: ["home-island-contract.json"],
    sourceDefs: [
      "GrudgeBuilder/shared/definitions/homeIslandSpec.ts",
      "GrudgeBuilder/shared/definitions/homeIslandSeed.ts",
      "GrudgeBuilder/shared/definitions/homeIslandFoundations.ts",
    ],
    notes: [
      "Railway home_islands + generator seed; SI 1.8–2.0 m human",
      "Play surface: client.grudge-studio.com/home-island",
      "Water SPA: water.grudge-studio.com (TI repo) — not tactical-infinity.vercel.app",
    ],
    primaryMesh: `${CDN}/models/nature/stylized/concept/example_home_island.glb`,
  },
  {
    id: "home-island-water",
    displayName: "Water SPA Home Island",
    kind: "home_play",
    status: "live",
    playUrl: WATER,
    forgeQuery: {
      edit: "1",
      island: "water_home",
      playUrl: WATER,
      from: "grudge-dev-tool",
    },
    meshUrls: [
      `${CDN}/models/nature/stylized/concept/example_home_island.glb`,
      `${CDN}/models/ships/`,
    ],
    deployPrefix: "models/environment/water/",
    assetPrefixes: ["models/nature/", "models/ships/", "models/environment/sectors/"],
    contracts: ["home-island-contract.json"],
    sourceDefs: ["Tactical-Infinity client home island", "gameDeployments tactical-infinity"],
    notes: ["Production domain ONLY water.grudge-studio.com"],
    primaryMesh: `${CDN}/models/nature/stylized/concept/example_home_island.glb`,
  },

  // ── Lobby / open world ────────────────────────────────────────────────────
  {
    id: "lobby-pirate-islands",
    displayName: "Lobby · Pirate Islands (open world)",
    kind: "lobby",
    status: "live",
    playUrl: `${CLIENT}/island-3d?mode=lobby&map=pirate-islands`,
    forgeQuery: {
      edit: "1",
      island: "lobby_pirate",
      map: "pirate-islands",
      mesh: PIRATE_ISLANDS_MESH,
      from: "grudge-dev-tool",
    },
    meshUrls: [PIRATE_ISLANDS_MESH],
    deployPrefix: "models/lobby/pirate-islands/",
    assetPrefixes: ["models/lobby/pirate-islands/", "models/environment/"],
    contracts: ["lobbyIslands.ts"],
    sourceDefs: [
      "GrudgeBuilder/shared/definitions/lobbyIslands.ts",
      "LOBBY_MAP_ID=pirate-islands",
    ],
    notes: [
      "Free Port + Shipwreck Cove + satellite islands",
      "Forge preferred GLB: models/lobby/pirate-islands/scene.glb",
    ],
    primaryMesh: PIRATE_ISLANDS_MESH,
  },
  {
    id: "lobby-shipwreck-cove",
    displayName: "Lobby · Shipwreck Cove",
    kind: "lobby",
    status: "live",
    playUrl: `${CLIENT}/island-3d?mode=lobby&focus=shipwreck_cove`,
    forgeQuery: {
      edit: "1",
      island: "shipwreck_cove",
      map: "pirate-islands",
      from: "grudge-dev-tool",
    },
    meshUrls: [PIRATE_ISLANDS_MESH],
    deployPrefix: "models/lobby/pirate-islands/",
    assetPrefixes: ["models/lobby/", "models/ships/"],
    sourceDefs: ["lobbyIslands.ts SHIPWRECK_ISLAND"],
    notes: ["Featured lobby island — wreck + scavenge loop"],
    primaryMesh: PIRATE_ISLANDS_MESH,
  },

  // ── Faction capitals ──────────────────────────────────────────────────────
  ...(["human", "barbarian", "elf", "dwarf", "orc", "undead"] as const).map(
    (race): IslandDeploymentDefinition => ({
      id: `faction-${race}`,
      displayName: `Faction Capital · ${race}`,
      kind: "faction",
      status: "partial",
      playUrl: `${CLIENT}/island-3d?mode=lobby&faction=${race}`,
      forgeQuery: {
        edit: "1",
        island: `faction_${race}`,
        race,
        map: "pirate-islands",
        from: "grudge-dev-tool",
      },
      meshUrls: [
        PIRATE_ISLANDS_MESH,
        `${CDN}/models/grudge6/races/${racePrefix(race)}_Characters.glb`,
      ],
      deployPrefix: `models/islands/faction/${race}/`,
      assetPrefixes: ["models/lobby/", "models/grudge6/", "models/nature/"],
      sourceDefs: ["factionLobbyIslands.ts", "FACTION_ISLAND_TEMPLATE"],
      notes: [
        "4 docks · 5 buildings · 8 unarmed + 8 heroes · captain mount",
        "Border placement on pirate-islands lobby",
      ],
      primaryMesh: PIRATE_ISLANDS_MESH,
    }),
  ),

  // ── Event / boss islands ──────────────────────────────────────────────────
  {
    id: "event-lyoko-ethereal",
    displayName: "Event · Ethereal Falls (Lyoko shelves)",
    kind: "event",
    status: "partial",
    playUrl: `${CLIENT}/island-3d?mode=zone&sector=ethereal_falls`,
    forgeQuery: {
      edit: "1",
      island: "event_lyoko",
      mesh: BOSS_EVENT_MESHES.lyoko,
      from: "grudge-dev-tool",
    },
    meshUrls: [BOSS_EVENT_MESHES.lyoko],
    deployPrefix: "models/biomes/ethereal/",
    assetPrefixes: ["models/biomes/ethereal/"],
    sourceDefs: ["floatingIslandBossAssets.ts LYOKO"],
    notes: ["Stacked floating island variants A/B"],
    primaryMesh: BOSS_EVENT_MESHES.lyoko,
  },
  {
    id: "event-spiral-mountain",
    displayName: "Event · Spiral Mountain",
    kind: "event",
    status: "partial",
    playUrl: `${CLIENT}/island-3d?mode=event&map=spiral_mountain`,
    forgeQuery: {
      edit: "1",
      island: "event_spiral",
      mesh: BOSS_EVENT_MESHES.spiralMountain,
      from: "grudge-dev-tool",
    },
    meshUrls: [BOSS_EVENT_MESHES.spiralMountain],
    deployPrefix: "models/biomes/event/",
    assetPrefixes: ["models/biomes/event/"],
    sourceDefs: ["floatingIslandBossAssets.ts spiralMountain"],
    notes: ["Event island sink/raise + boss instances"],
    primaryMesh: BOSS_EVENT_MESHES.spiralMountain,
  },
  {
    id: "boss-hoth-room",
    displayName: "Boss · Hoth Boss Room",
    kind: "boss",
    status: "partial",
    playUrl: `${CLIENT}/boss-walkup?boss=hoth`,
    forgeQuery: {
      edit: "1",
      island: "boss_hoth",
      mesh: BOSS_EVENT_MESHES.hothBossRoom,
      from: "grudge-dev-tool",
    },
    meshUrls: [BOSS_EVENT_MESHES.hothBossRoom],
    deployPrefix: "models/biomes/frozen/",
    assetPrefixes: ["models/biomes/frozen/"],
    sourceDefs: ["floatingIslandBossAssets.ts hothBossRoom"],
    notes: ["Frozen biome boss instance — strip skybox on load"],
    primaryMesh: BOSS_EVENT_MESHES.hothBossRoom,
  },
  {
    id: "boss-iceland-cinematic",
    displayName: "Boss / Event · Iceland Cinematic",
    kind: "boss",
    status: "partial",
    playUrl: `${CLIENT}/island-3d?mode=zone&biome=cold`,
    forgeQuery: {
      edit: "1",
      island: "boss_iceland",
      mesh: BOSS_EVENT_MESHES.iceland,
      from: "grudge-dev-tool",
    },
    meshUrls: [BOSS_EVENT_MESHES.iceland],
    deployPrefix: "models/biomes/cold/",
    assetPrefixes: ["models/biomes/cold/"],
    sourceDefs: ["floatingIslandBossAssets.ts iceland"],
    notes: ["Frozen + near-frozen zone plates"],
    primaryMesh: BOSS_EVENT_MESHES.iceland,
  },

  // ── Open world / sectors ──────────────────────────────────────────────────
  {
    id: "open-haven-shore",
    displayName: "Open Zone · Haven Shore",
    kind: "open_world",
    status: "live",
    playUrl: `${CLIENT}/play?mode=zone&sector=haven_shore&worldSeed=grudge-world-1`,
    forgeQuery: {
      edit: "1",
      island: "haven_shore",
      sector: "haven_shore",
      from: "grudge-dev-tool",
    },
    meshUrls: [
      PIRATE_ISLANDS_MESH,
      `${CDN}/models/nature/stylized/biome/nature_vegetation.glb`,
    ],
    deployPrefix: "models/environment/sectors/",
    assetPrefixes: ["models/environment/sectors/", "models/nature/"],
    sourceDefs: ["warlords-zones.json", "biomeEcosystemCatalog.ts"],
    notes: ["Sector play + nature scatter; share home-island contracts"],
    primaryMesh: PIRATE_ISLANDS_MESH,
  },
];

function racePrefix(race: string): string {
  const m: Record<string, string> = {
    human: "WK",
    barbarian: "BRB",
    elf: "ELF",
    dwarf: "DWF",
    orc: "ORC",
    undead: "UD",
  };
  return m[race] ?? "WK";
}

export function getIslandDeployment(id: string): IslandDeploymentDefinition | undefined {
  return ISLAND_DEPLOYMENT_DEFINITIONS.find((i) => i.id === id);
}

export function listIslandsByKind(kind: IslandKind): IslandDeploymentDefinition[] {
  return ISLAND_DEPLOYMENT_DEFINITIONS.filter((i) => i.kind === kind);
}

export function listOpenableIslands(): IslandDeploymentDefinition[] {
  return ISLAND_DEPLOYMENT_DEFINITIONS.filter((i) => i.status !== "planned");
}

export function buildForgeIslandUrl(island: IslandDeploymentDefinition): string {
  const u = new URL(FORGE);
  for (const [k, v] of Object.entries(island.forgeQuery)) {
    u.searchParams.set(k, v);
  }
  if (island.primaryMesh) u.searchParams.set("mesh", island.primaryMesh);
  if (island.playUrl) u.searchParams.set("playUrl", island.playUrl);
  return u.toString();
}

export function groupIslandsForUi(): { kind: IslandKind; label: string; items: IslandDeploymentDefinition[] }[] {
  const order: { kind: IslandKind; label: string }[] = [
    { kind: "home_generator", label: "Home island generator" },
    { kind: "home_play", label: "Home island play" },
    { kind: "lobby", label: "Lobby islands" },
    { kind: "faction", label: "Faction capitals" },
    { kind: "event", label: "Event islands" },
    { kind: "boss", label: "Boss islands" },
    { kind: "open_world", label: "Open world / sectors" },
  ];
  return order
    .map((o) => ({
      ...o,
      items: listIslandsByKind(o.kind),
    }))
    .filter((g) => g.items.length > 0);
}
