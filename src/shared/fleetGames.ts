/** Grudge Studio fleet game catalog — Steam-style launcher entries. */

export type GameCategory = "action" | "rpg" | "rts" | "racing" | "puzzle" | "demo" | "tool" | "mobile";
export type GameStatus = "live" | "active" | "beta" | "planned";

export interface FleetGame {
  id: string;
  name: string;
  displayName: string;
  description: string;
  url: string;
  repo: string;
  engine: string;
  status: GameStatus;
  category: GameCategory;
  topics: string[];
  thumbnail?: string;
  hasServer?: boolean;
  /** Optional GitHub release download page */
  releasesUrl?: string;
}

const THUMB = (repo: string) =>
  `https://opengraph.githubassets.com/1/MolochDaGod/${repo}`;

/** Static fleet catalog — merged with live grudgedot /api/games when available. */
export const FLEET_GAMES: FleetGame[] = [
  {
    id: "grudgewarlords",
    name: "Grudge-Warlords",
    displayName: "Grudge Warlords",
    description: "Main MMO — island crafting, characters, world map sailing, cNFT minting.",
    url: "https://grudgewarlords.com",
    repo: "Grudge-Builder",
    engine: "React + Three.js + Phaser",
    status: "live",
    category: "rpg",
    topics: ["rpg", "mmo", "crafting"],
    thumbnail: THUMB("Grudge-Builder"),
    hasServer: true,
    releasesUrl: "https://github.com/MolochDaGod/Grudge-Builder/releases",
  },
  {
    id: "studio-forge",
    name: "RTS-Grudge",
    displayName: "Grudge Studio Forge",
    description: "Fleet map & model editor — terrain, ObjectStore CDN, play mode. Warlords · RTS · DCQ.",
    url: "https://forge.grudge-studio.com",
    repo: "RTS-Grudge",
    engine: "R3F + Rapier + drei",
    status: "live",
    category: "tool",
    topics: ["tool", "editor", "3d"],
    thumbnail: THUMB("RTS-Grudge"),
  },
  {
    id: "rts-grudge",
    name: "RTS-Grudge",
    displayName: "RTS Grudge",
    description: "Real-time strategy with R3F + Rapier physics and fleet characters.",
    url: "https://rts-grudge.vercel.app",
    repo: "RTS-Grudge",
    engine: "R3F + Rapier",
    status: "live",
    category: "rts",
    topics: ["rts", "action"],
    thumbnail: THUMB("RTS-Grudge"),
    hasServer: true,
  },
  {
    id: "grudges-survival",
    name: "survival",
    displayName: "Grudges Survival",
    description: "Open-world survival — harvest, build, fight in 3D.",
    url: "https://grudges.grudge-studio.com",
    repo: "survival",
    engine: "R3F + Rapier",
    status: "active",
    category: "rpg",
    topics: ["rpg", "survival"],
    thumbnail: THUMB("survival"),
    hasServer: true,
  },
  {
    id: "grudge-drive",
    name: "grudge-drive",
    displayName: "Grudge Drive",
    description: "Racing prototype — migrating to Three.js fleet stack.",
    url: "https://drive.grudge-studio.com",
    repo: "grudge-drive",
    engine: "Three.js (migrating)",
    status: "active",
    category: "racing",
    topics: ["racing", "demo"],
    thumbnail: THUMB("grudge-drive"),
  },
  {
    id: "grudge-arena",
    name: "grudge-arena",
    displayName: "Grudge Arena",
    description: "Three.js arena combat with Socket.IO multiplayer.",
    url: "https://grudge-arena.vercel.app",
    repo: "grudge-arena",
    engine: "Three.js",
    status: "active",
    category: "action",
    topics: ["action", "pvp"],
    thumbnail: THUMB("grudge-arena"),
    hasServer: true,
  },
  {
    id: "flare-boss-arena",
    name: "grudge-game",
    displayName: "Flare Boss Arena",
    description: "Action roguelike boss arena — Grudge6 characters, Rapier physics, forge dungeon.",
    url: "https://fba.grudge-studio.com",
    repo: "flare-boss-arena",
    engine: "Three.js + Rapier + Vite",
    status: "active",
    category: "action",
    topics: ["action", "roguelike", "boss"],
    thumbnail: THUMB("flare-boss-arena"),
    hasServer: true,
  },
  {
    id: "arena-bridge",
    name: "grudge-arena-bridge",
    displayName: "Arena Bridge (WoW)",
    description: "WoW bridge client for cross-game arena events.",
    url: "https://wow.grudge-studio.com",
    repo: "grudge-arena-bridge",
    engine: "Web",
    status: "active",
    category: "action",
    topics: ["action"],
    thumbnail: THUMB("grudge-arena-bridge"),
  },
  {
    id: "grim-armada",
    name: "grim-armada-web",
    displayName: "Grim Armada",
    description: "Naval strategy — fleet battles in Three.js.",
    url: "https://grim-armada-web.vercel.app",
    repo: "grim-armada-web",
    engine: "Three.js + React",
    status: "active",
    category: "rts",
    topics: ["rts", "action"],
    thumbnail: THUMB("grim-armada-web"),
  },
  {
    id: "dungeon-crawler",
    name: "Dungeon-Crawler-Quest",
    displayName: "Dungeon Crawler Quest",
    description: "Voxel dungeon crawler — procedural rooms and loot.",
    url: "https://dungeon-crawler-quest.vercel.app",
    repo: "Dungeon-Crawler-Quest",
    engine: "Three.js + Voxel + Rapier",
    status: "active",
    category: "rpg",
    topics: ["rpg", "dungeon"],
    thumbnail: THUMB("Dungeon-Crawler-Quest"),
  },
  {
    id: "grudge-space-rts",
    name: "GrudgeSpaceRTS",
    displayName: "GrudgeSpace RTS",
    description: "Space RTS with Three.js fleet combat.",
    url: "https://grudge-space-rts.vercel.app",
    repo: "GrudgeSpaceRTS",
    engine: "Three.js",
    status: "active",
    category: "rts",
    topics: ["rts", "space"],
    thumbnail: THUMB("GrudgeSpaceRTS"),
  },
  {
    id: "mech-forge",
    name: "grudge-mech-forge",
    displayName: "Grudge Mech Forge",
    description: "Mech builder playground — R3F + Rapier test rig.",
    url: "https://mech-playground.vercel.app",
    repo: "grudge-mech-forge",
    engine: "R3F + Rapier",
    status: "active",
    category: "demo",
    topics: ["demo", "mech"],
    thumbnail: THUMB("grudge-mech-forge"),
  },
  {
    id: "character-creator",
    name: "grudge-character-creator",
    displayName: "Character Creator",
    description: "3D character equipment and animation tester.",
    url: "https://playground-teal-zeta.vercel.app",
    repo: "grudge-character-creator",
    engine: "Three.js",
    status: "active",
    category: "tool",
    topics: ["tool", "characters"],
    thumbnail: THUMB("grudge-character-creator"),
  },
  {
    id: "final-fighter",
    name: "FinalFighter",
    displayName: "Final Fighter",
    description: "Arcade fighter prototype.",
    url: "https://final-fighter.vercel.app",
    repo: "FinalFighter",
    engine: "Three.js",
    status: "active",
    category: "action",
    topics: ["action", "fighting"],
    thumbnail: THUMB("FinalFighter"),
  },
  {
    id: "tactical-infinity",
    name: "Tactical-Infinity",
    displayName: "Tactical Infinity",
    description: "Tactical turn-based combat prototype.",
    url: "https://tactical-infinity.vercel.app",
    repo: "Tactical-Infinity",
    engine: "Three.js",
    status: "active",
    category: "rts",
    topics: ["rts", "tactical"],
    thumbnail: THUMB("Tactical-Infinity"),
  },
  {
    id: "wcs",
    name: "grudge-wcs",
    displayName: "WCS (Betta Warlords)",
    description: "Warlord Crafting Suite shell — character + island UI.",
    url: "https://wcs.grudge-studio.com",
    repo: "grudge-wcs",
    engine: "Web",
    status: "active",
    category: "tool",
    topics: ["tool", "crafting"],
    thumbnail: THUMB("grudge-wcs"),
  },
  {
    id: "grudgeworld",
    name: "GrudgeWorld-Action-RPG",
    displayName: "GrudgeWorld Action RPG",
    description: "Action RPG prototype — Three.js fleet stack.",
    url: "https://grudgeworld-action-rpg.vercel.app",
    repo: "GrudgeWorld-Action-RPG",
    engine: "Three.js + R3F",
    status: "active",
    category: "rpg",
    topics: ["rpg", "action"],
    thumbnail: THUMB("GrudgeWorld-Action-RPG"),
  },
  {
    id: "the-engine",
    name: "The-ENGINE",
    displayName: "The ENGINE (Portal)",
    description: "Grudge Studio portal shell — fleet hub and docs.",
    url: "https://grudge-studio.com",
    repo: "The-ENGINE",
    engine: "Vite",
    status: "live",
    category: "tool",
    topics: ["tool", "portal"],
    thumbnail: THUMB("The-ENGINE"),
  },
  {
    id: "character-viewer",
    name: "character-viewer",
    displayName: "Grudge6 Character Viewer",
    description: "6-race character viewer — weapons, armour, skins, VFX playground.",
    url: "https://character.grudge-studio.com/viewer",
    repo: "The-ENGINE",
    engine: "Three.js + Grudge Engine",
    status: "live",
    category: "tool",
    topics: ["tool", "characters", "vfx"],
    thumbnail: THUMB("The-ENGINE"),
  },
  {
    id: "grudgecontrol",
    name: "grudgecontrol",
    displayName: "Grudge Control",
    description: "Fleet control panel — grudge6 showcase and systems map.",
    url: "https://grudgecontrol.vercel.app",
    repo: "grudgecontrol",
    engine: "React",
    status: "active",
    category: "tool",
    topics: ["tool", "admin"],
    thumbnail: THUMB("grudgecontrol"),
  },
  {
    id: "grudgedot",
    name: "grudgedot",
    displayName: "grudgedot Launcher",
    description: "GitHub Releases game library — download desktop builds.",
    url: "https://grudgedot.vercel.app",
    repo: "grudgedot",
    engine: "Web",
    status: "beta",
    category: "tool",
    topics: ["tool", "launcher"],
    thumbnail: THUMB("grudgedot"),
    releasesUrl: "https://github.com/MolochDaGod/grudgedot/releases",
  },
  {
    id: "fresh-grudge",
    name: "FRESH-GRUDGE",
    displayName: "FRESH GRUDGE",
    description: "Unity mobile action game on Google Play.",
    url: "https://play.google.com/store/apps/details?id=com.grudgestudio.freshgrudge",
    repo: "FRESH-GRUDGE",
    engine: "Unity",
    status: "active",
    category: "mobile",
    topics: ["mobile", "action"],
    thumbnail: THUMB("FRESH-GRUDGE"),
  },
  {
    id: "grudaagent",
    name: "grudge-agent",
    displayName: "GRUDA Agent",
    description: "Local + cloud AI agent — Ollama, skills, IDE bridge.",
    url: "https://grudaagent.vercel.app",
    repo: "grudge-agent",
    engine: "Node + Express",
    status: "live",
    category: "tool",
    topics: ["tool", "ai"],
    thumbnail: THUMB("grudge-agent"),
  },
];

/** Verified storefront asset categories on assets.grudge-studio.com / ObjectStore. */
export interface StoreCategory {
  id: string;
  label: string;
  icon: string;
  prefix: string;
  objectStorePath?: string;
}

/** Catalog JSON filenames on ONE TRUTH fleet client (`/api/objectstore/v1/…`). */
export const STORE_CATEGORIES: StoreCategory[] = [
  { id: "weapons", label: "Weapons & Guns", icon: "⚔️", prefix: "models/weapons/", objectStorePath: "/weapons.json" },
  { id: "characters", label: "Characters", icon: "🧙", prefix: "models/characters/", objectStorePath: "/characters.json" },
  { id: "ships", label: "Ships & Vehicles", icon: "🚢", prefix: "models/ships/", objectStorePath: "/ships.json" },
  { id: "environment", label: "Nature & Environment", icon: "🌲", prefix: "models/environment/", objectStorePath: "/environment.json" },
  { id: "buildings", label: "Buildings & Scenes", icon: "🏰", prefix: "models/buildings/", objectStorePath: "/buildings.json" },
  { id: "vfx", label: "VFX & Particles", icon: "✨", prefix: "vfx/", objectStorePath: undefined },
  { id: "icons", label: "Icons & UI", icon: "🎨", prefix: "icons/", objectStorePath: undefined },
  { id: "audio", label: "Audio", icon: "🔊", prefix: "audio/", objectStorePath: undefined },
  { id: "scenes", label: "Scene Editors", icon: "🎬", prefix: "scenes/", objectStorePath: undefined },
  { id: "asset-packs", label: "Asset Packs", icon: "📦", prefix: "asset-packs/", objectStorePath: undefined },
];

/** Merge live grudgedot releases into the static fleet catalog (live wins on id). */
export function mergeFleetGames(
  staticGames: FleetGame[],
  live: unknown[],
): FleetGame[] {
  const byId = new Map<string, FleetGame>();
  for (const g of staticGames) byId.set(g.id, g);
  for (const raw of live) {
    if (!raw || typeof raw !== "object") continue;
    const L = raw as Record<string, unknown>;
    const id = String(L.id ?? L.name ?? "").trim();
    if (!id) continue;
    const base = byId.get(id);
    byId.set(id, {
      id,
      name: String(L.name ?? base?.name ?? id),
      displayName: String(L.displayName ?? L.display_name ?? base?.displayName ?? id),
      description: String(L.description ?? base?.description ?? ""),
      url: String(L.url ?? L.homepage ?? base?.url ?? ""),
      repo: String(L.repo ?? L.repository ?? base?.repo ?? ""),
      engine: String(L.engine ?? base?.engine ?? ""),
      status: (String(L.status ?? base?.status ?? "live") as FleetGame["status"]),
      category: (String(L.category ?? base?.category ?? "demo") as FleetGame["category"]),
      topics: Array.isArray(L.topics) ? (L.topics as string[]) : (base?.topics ?? []),
      thumbnail: typeof L.thumbnail === "string" ? L.thumbnail : base?.thumbnail,
      hasServer: Boolean(L.hasServer ?? base?.hasServer),
      releasesUrl: typeof L.releasesUrl === "string" ? L.releasesUrl : base?.releasesUrl,
    });
  }
  return [...byId.values()];
}