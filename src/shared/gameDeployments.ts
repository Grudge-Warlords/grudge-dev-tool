/**
 * GAME_DEPLOYMENT_DEFINITIONS — SSOT for live play URLs, asset prefixes,
 * deploy kinds, and Forge 3D open targets.
 *
 * Align with grudge-fleet + grudge-live-servers.
 * Water / home island = water.grudge-studio.com (Tactical-Infinity repo) —
 * never tactical-infinity.vercel.app.
 *
 * Island-specific open targets (home generator, lobby, faction, event, boss):
 *   → see `islandDeployments.ts` + `renderer/lib/forge/openIsland.ts`
 */

export type DeployKind = "vercel" | "cf-pages" | "railway" | "external" | "electron";
export type GameDeployStatus = "live" | "active" | "beta" | "archive";

export interface GameDeploymentDefinition {
  id: string;
  /** Matches FLEET_GAMES / PLAY_MODE_ORDER id when applicable */
  playModeId: string;
  displayName: string;
  playUrl: string;
  /** R2 / CDN prefixes to open representative meshes in Forge 3D */
  assetPrefixes: string[];
  /** Preferred R2 prefix when deploying from Forge for this game */
  deployPrefix: string;
  storeCategoryId: string;
  deployKind: DeployKind;
  status: GameDeployStatus;
  repo?: string;
  hasServer?: boolean;
  /** Short best-practice bullets for deploy / access */
  bestPractices: string[];
  /** GRUDA agentic task text for make & deploy */
  agenticDeployTask: string;
  /** Project template slug for hub create */
  projectTemplate?: string;
}

export const GAME_DEPLOYMENT_DEFINITIONS: GameDeploymentDefinition[] = [
  {
    id: "open-launcher",
    playModeId: "open-launcher",
    displayName: "Open Launcher",
    playUrl: "https://open.grudge-studio.com",
    assetPrefixes: [
      "prod/gltf/characters/",
      "prod/gltf/weapons/",
      "models/grudge6/",
      "models/nature/",
    ],
    deployPrefix: "prod/gltf/characters/",
    storeCategoryId: "warlords",
    deployKind: "vercel",
    status: "live",
    repo: "gameopen",
    hasServer: true,
    bestPractices: [
      "Library entry via gameLibrary.ts (L9)",
      "Same-origin /api/* → Railway; assets → R2 rewrites",
      "Never hardcode WS hosts — use window.location.host",
    ],
    agenticDeployTask:
      "Deploy gameopen to open.grudge-studio.com production: verify fleet assets CDN, vercel-build, probe /api/health, report library doors.",
    projectTemplate: "open-launcher",
  },
  {
    id: "character-foundry",
    playModeId: "character-foundry",
    displayName: "Character Foundry",
    playUrl: "https://character.grudge-studio.com",
    assetPrefixes: [
      "prod/gltf/characters/",
      "prod/gltf/weapons/",
      "models/grudge6/",
      "models/characters/",
    ],
    deployPrefix: "prod/gltf/characters/",
    storeCategoryId: "warlords",
    deployKind: "cf-pages",
    status: "live",
    repo: "grudge-character-animator",
    hasServer: true,
    bestPractices: [
      "Create-only funnel — no live-play loop in Foundry",
      "4-slot select → client.grudge-studio.com handoff",
      "SI scale grudge6 packs only (character-correctness)",
    ],
    agenticDeployTask:
      "Package grudge6 hero mesh + baked anims at SI scale, upload models/grudge6/, verify feet/hips, open in Foundry character.grudge-studio.com.",
    projectTemplate: "character-foundry",
  },
  {
    id: "client-play",
    playModeId: "client-play",
    displayName: "Warlords Client (Live Play)",
    playUrl: "https://client.grudge-studio.com",
    assetPrefixes: ["models/grudge6/", "models/nature/", "models/environment/"],
    deployPrefix: "models/warlords/",
    storeCategoryId: "home-island",
    deployKind: "vercel",
    status: "live",
    repo: "Grudge-Builder",
    hasServer: true,
    bestPractices: [
      "ONE TRUTH API base = client.grudge-studio.com",
      "Player state writes → Railway Postgres only",
      "ObjectStore JSON + assets CDN for binaries",
    ],
    agenticDeployTask:
      "Deploy GrudgeBuilder client to client.grudge-studio.com, run ONE TRUTH doctor probes, verify characters/auth rewrites.",
    projectTemplate: "warlords-client",
  },
  {
    id: "grudgewarlords",
    playModeId: "grudgewarlords",
    displayName: "Grudge Warlords",
    playUrl: "https://grudgewarlords.com",
    assetPrefixes: ["models/grudge6/", "models/ships/"],
    deployPrefix: "models/warlords/",
    storeCategoryId: "warlords",
    deployKind: "vercel",
    status: "live",
    repo: "Grudge-Builder",
    hasServer: true,
    bestPractices: [
      "Marketing + shell may differ from client.grudge-studio.com",
      "Prefer client.grudge-studio.com for API/ONE TRUTH work",
    ],
    agenticDeployTask:
      "Smoke grudgewarlords.com shell and deep-link into client play with active character.",
    projectTemplate: "warlords-client",
  },
  {
    id: "tactical-infinity",
    playModeId: "tactical-infinity",
    displayName: "Warlords Water / Home Island",
    playUrl: "https://water.grudge-studio.com",
    assetPrefixes: ["models/nature/", "models/ships/", "models/environment/sectors/"],
    deployPrefix: "models/environment/water/",
    storeCategoryId: "home-island",
    deployKind: "vercel",
    status: "live",
    repo: "Tactical-Infinity",
    hasServer: true,
    bestPractices: [
      "Production domain is water.grudge-studio.com ONLY",
      "Never open tactical-infinity.vercel.app (orphaned)",
      "Open Water sailing path: /sailing when testing boats",
      "Railway characters via rewrites — not Replit",
    ],
    agenticDeployTask:
      "Deploy Tactical-Infinity home island to water.grudge-studio.com, verify nature/ship GLBs from assets CDN, smoke /sailing if present.",
    projectTemplate: "water-island",
  },
  {
    id: "grudox",
    playModeId: "grudox",
    displayName: "GRUDOX Hub",
    playUrl: "https://grudox.grudge-studio.com",
    assetPrefixes: ["models/voxel/", "models/grudge6/"],
    deployPrefix: "models/grudox/",
    storeCategoryId: "voxel",
    deployKind: "cf-pages",
    status: "live",
    repo: "gameopen",
    hasServer: true,
    bestPractices: [
      "WS via CF Worker → Railway room (Vercel cannot upgrade WS)",
      "Carrier paths: /api/carrier|space|brawl",
    ],
    agenticDeployTask:
      "Smoke grudox.grudge-studio.com hub + carrier health; confirm CF edge WS proxy to Railway room.",
    projectTemplate: "grudox-room",
  },
  {
    id: "studio-forge",
    playModeId: "studio-forge",
    displayName: "Grudge Studio Forge",
    playUrl: "https://forge.grudge-studio.com",
    assetPrefixes: ["models/environment/", "models/nature/", "models/buildings/"],
    deployPrefix: "scenes/",
    storeCategoryId: "scenes",
    deployKind: "vercel",
    status: "live",
    repo: "RTS-Grudge",
    bestPractices: [
      "Export production GLB; CDN only large meshes",
      "ObjectStore scene JSON for multi-object layouts",
    ],
    agenticDeployTask:
      "Export current Forge scene as production GLB, optimize for web, upload under scenes/, return forge.grudge-studio.com deep link.",
    projectTemplate: "forge-scene",
  },
  {
    id: "grudge-pipeline",
    playModeId: "grudge-pipeline",
    displayName: "Grudge Pipeline",
    playUrl: "https://grudge-pipeline.vercel.app",
    assetPrefixes: ["models/grudge6/", "models/environment/", "models/nature/"],
    deployPrefix: "models/pipeline/",
    storeCategoryId: "warlords",
    deployKind: "vercel",
    status: "live",
    repo: "grudge-pipeline",
    bestPractices: [
      "Ingest → convert → rig/UUID → R2; large GLBs not in git",
      "Open-in-Forge via postMessage (grudge:pipeline:import-scene)",
      "Production URL: https://grudge-pipeline.vercel.app/",
    ],
    agenticDeployTask:
      "Smoke grudge-pipeline.vercel.app, convert a sample mesh, push to R2, open pack in forge.grudge-studio.com via pipeline handoff.",
    projectTemplate: "asset-pipeline",
  },
  {
    id: "rts-grudge",
    playModeId: "rts-grudge",
    displayName: "RTS Grudge",
    playUrl: "https://rts-grudge.vercel.app",
    assetPrefixes: ["models/grudge6/", "models/buildings/"],
    deployPrefix: "models/rts/",
    storeCategoryId: "warlords",
    deployKind: "vercel",
    status: "live",
    repo: "RTS-Grudge",
    hasServer: true,
    bestPractices: ["R3F + Rapier SI scale", "Fleet character packs only"],
    agenticDeployTask:
      "Deploy RTS-Grudge production, verify grudge6 unit loads and Rapier ground contact.",
    projectTemplate: "r3f-boilerplate",
  },
  {
    id: "grudges-survival",
    playModeId: "grudges-survival",
    displayName: "Grudges Survival",
    playUrl: "https://grudges.grudge-studio.com",
    assetPrefixes: ["models/nature/", "models/buildings/"],
    deployPrefix: "models/survival/",
    storeCategoryId: "environment",
    deployKind: "vercel",
    status: "active",
    repo: "survival",
    hasServer: true,
    bestPractices: ["Harvest break + nature packs from R2", "survival-api Railway"],
    agenticDeployTask:
      "Deploy survival to grudges.grudge-studio.com and verify nature pack mesh isolation.",
    projectTemplate: "r3f-boilerplate",
  },
  {
    id: "grudge-drive",
    playModeId: "grudge-drive",
    displayName: "Grudge Drive",
    playUrl: "https://drive.grudge-studio.com",
    assetPrefixes: ["models/ships/", "models/environment/"],
    deployPrefix: "models/drive/",
    storeCategoryId: "ships",
    deployKind: "vercel",
    status: "active",
    repo: "grudge-drive",
    bestPractices: ["Three.js fleet stack", "drive.grudge-studio.com alias"],
    agenticDeployTask: "Smoke drive.grudge-studio.com race loop and vehicle mesh loads.",
    projectTemplate: "r3f-boilerplate",
  },
  {
    id: "grudge-arena",
    playModeId: "grudge-arena",
    displayName: "Grudge Arena",
    playUrl: "https://grudge-arena.vercel.app",
    assetPrefixes: ["models/grudge6/", "models/weapons/"],
    deployPrefix: "models/arena/",
    storeCategoryId: "characters",
    deployKind: "vercel",
    status: "active",
    repo: "grudge-arena",
    hasServer: true,
    bestPractices: ["Socket.IO multiplayer", "Combat targeting LMB/RMB"],
    agenticDeployTask: "Deploy arena and smoke Socket.IO room join with a grudge6 hero.",
    projectTemplate: "r3f-boilerplate",
  },
  {
    id: "dungeon-crawler",
    playModeId: "dungeon-crawler",
    displayName: "Dungeon Crawler Quest",
    playUrl: "https://dcq.grudge-studio.com",
    assetPrefixes: ["models/voxel/", "models/environment/"],
    deployPrefix: "models/dcq/",
    storeCategoryId: "voxel",
    deployKind: "vercel",
    status: "active",
    repo: "Dungeon-Crawler-Quest",
    bestPractices: ["Canonical domain dcq.grudge-studio.com", "Voxel + Rapier"],
    agenticDeployTask: "Deploy DCQ to dcq.grudge-studio.com and verify procedural room load.",
    projectTemplate: "r3f-boilerplate",
  },
  {
    id: "grim-armada",
    playModeId: "grim-armada",
    displayName: "Grim Armada",
    playUrl: "https://grim-armada-web.vercel.app",
    assetPrefixes: ["grudge-armada/", "models/ships/"],
    deployPrefix: "grudge-armada/",
    storeCategoryId: "armada",
    deployKind: "vercel",
    status: "active",
    repo: "grim-armada-web",
    bestPractices: ["Armada era assets under grudge-armada/"],
    agenticDeployTask: "Smoke grim-armada-web fleet battle scene loads from CDN.",
    projectTemplate: "r3f-boilerplate",
  },
  {
    id: "grudge-space-rts",
    playModeId: "grudge-space-rts",
    displayName: "GrudgeSpace RTS / Mech PvP",
    playUrl: "https://grudge-space-rts.vercel.app",
    assetPrefixes: ["models/", "models/ships/"],
    deployPrefix: "models/space-rts/",
    storeCategoryId: "ships",
    deployKind: "vercel",
    status: "active",
    repo: "GrudgeSpaceRTS",
    bestPractices: ["Mech PvP may need VITE_PVP_SERVER_URL Railway"],
    agenticDeployTask: "Deploy space RTS and verify PvP room env if configured.",
    projectTemplate: "r3f-boilerplate",
  },
  {
    id: "mech-forge",
    playModeId: "mech-forge",
    displayName: "Grudge Mech Forge",
    playUrl: "https://mech-playground.vercel.app",
    assetPrefixes: ["models/"],
    deployPrefix: "models/mech/",
    storeCategoryId: "characters",
    deployKind: "vercel",
    status: "active",
    repo: "grudge-mech-forge",
    bestPractices: ["R3F + Rapier test rig"],
    agenticDeployTask: "Smoke mech-playground.vercel.app builder load.",
    projectTemplate: "r3f-boilerplate",
  },
  {
    id: "metaverse",
    playModeId: "metaverse",
    displayName: "Grudge Metaverse",
    playUrl: "https://metaverse.grudge-studio.com",
    assetPrefixes: ["models/grudge6/metaverse/", "models/grudge6/"],
    deployPrefix: "models/grudge6/metaverse/",
    storeCategoryId: "warlords",
    deployKind: "vercel",
    status: "active",
    repo: "grudge-metaverse",
    bestPractices: ["Metaverse avatars path models/grudge6/metaverse/"],
    agenticDeployTask: "Smoke metaverse.grudge-studio.com avatar load from CDN.",
    projectTemplate: "r3f-boilerplate",
  },
  {
    id: "final-fighter",
    playModeId: "final-fighter",
    displayName: "Final Fighter",
    playUrl: "https://final-fighter.vercel.app",
    assetPrefixes: ["models/grudge6/", "models/characters/"],
    deployPrefix: "models/fighters/",
    storeCategoryId: "characters",
    deployKind: "vercel",
    status: "active",
    repo: "FinalFighter",
    bestPractices: ["Arcade fighter prototype"],
    agenticDeployTask: "Smoke final-fighter.vercel.app character load.",
    projectTemplate: "r3f-boilerplate",
  },
  {
    id: "studio-editor",
    playModeId: "studio-editor",
    displayName: "Studio Editor",
    playUrl: "https://studio.grudge-studio.com",
    assetPrefixes: ["models/nature/", "models/environment/"],
    deployPrefix: "scenes/studio/",
    storeCategoryId: "scenes",
    deployKind: "vercel",
    status: "active",
    repo: "grudge-studio",
    bestPractices: ["StylizedNatureCDN mesh isolation — never whole island GLB"],
    agenticDeployTask: "Deploy studio artifact and verify nature CDN meshName isolation.",
    projectTemplate: "forge-scene",
  },
];

export const PROJECT_TEMPLATES: Array<{
  id: string;
  label: string;
  description: string;
  hubTemplate: string;
}> = [
  {
    id: "r3f-boilerplate",
    label: "R3F game boilerplate",
    description: "React Three Fiber + Rapier starter wired for fleet SSO.",
    hubTemplate: "r3f-boilerplate",
  },
  {
    id: "warlords-client",
    label: "Warlords client slice",
    description: "Island / zone / lobby play funnel hooks.",
    hubTemplate: "warlords-client",
  },
  {
    id: "water-island",
    label: "Water / home island",
    description: "Tactical Infinity water.grudge-studio.com surface.",
    hubTemplate: "water-island",
  },
  {
    id: "character-foundry",
    label: "Character Foundry pack",
    description: "Create-only hero + 4-slot handoff.",
    hubTemplate: "character-foundry",
  },
  {
    id: "open-launcher",
    label: "Open library game",
    description: "gameopen library entry + native door.",
    hubTemplate: "open-launcher",
  },
  {
    id: "forge-scene",
    label: "Forge scene project",
    description: "Scene JSON + GLB export pipeline.",
    hubTemplate: "forge-scene",
  },
  {
    id: "grudox-room",
    label: "GRUDOX / Carrier room",
    description: "CF edge + Railway room multiplayer.",
    hubTemplate: "grudox-room",
  },
];

export function getGameDeployment(id: string): GameDeploymentDefinition | undefined {
  return GAME_DEPLOYMENT_DEFINITIONS.find((g) => g.id === id || g.playModeId === id);
}

export function getLiveGameDeployments(): GameDeploymentDefinition[] {
  return GAME_DEPLOYMENT_DEFINITIONS.filter((g) => g.status === "live" || g.status === "active");
}

export function gameDeployAgenticPresets(): Array<{ label: string; task: string }> {
  return getLiveGameDeployments().map((g) => ({
    label: `Deploy ${g.displayName}`,
    task: g.agenticDeployTask,
  }));
}
