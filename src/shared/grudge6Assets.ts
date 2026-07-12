/**
 * Grudge6 race character delivery — canonical R2 / CDN wiring.
 * SSOT matches grudge-builder shared/fleet RACE_GRUDGE6 (Warlords / home-island).
 *
 * Equipment is NOT separate weapon GLBs — it is child-mesh visibility on the
 * race kit (Units_Body_A, Units_sword_A, …) via Grudge6EquipmentManager.
 */

export const CDN_BASE = "https://assets.grudge-studio.com";

export type AssetCategory =
  | "characters"
  | "weapons"
  | "armor"
  | "skins"
  | "effects"
  | "vfx"
  | "animations";

export type RaceId = "human" | "barbarian" | "elf" | "dwarf" | "orc" | "undead";

export interface Grudge6RaceConfig {
  modelId: RaceId;
  prefix: string;
  label: string;
  /** CDN-relative modular race kit (GLB) */
  cdnPath: string;
  /** Absolute CDN URL for the race GLB */
  cdnUrl: string;
  /** Optional FBX fallback */
  fbxPath: string;
  scale: number;
  faction: "crusade" | "fabled" | "legion";
  baseModelStem: string;
  /** Race atlas under textures/grudge6/ */
  textureFolder: string;
  textureFile: string;
}

/**
 * Canonical grudge6 race kits on R2.
 * Do NOT use toon-shooter Character_Soldier / Hazmat / Enemy placeholders.
 */
export const RACE_GRUDGE6: Record<RaceId, Grudge6RaceConfig> = {
  human: {
    modelId: "human",
    prefix: "WK_",
    label: "Human",
    cdnPath: "/models/grudge6/races/WK_Characters.glb",
    cdnUrl: `${CDN_BASE}/models/grudge6/races/WK_Characters.glb`,
    fbxPath: "/models/grudge6/races/WK_Characters.fbx",
    scale: 1.0,
    faction: "crusade",
    baseModelStem: "WK_Characters",
    textureFolder: "western-kingdoms",
    textureFile: "WK_Standard_Units.webp",
  },
  barbarian: {
    modelId: "barbarian",
    prefix: "BRB_",
    label: "Barbarian",
    cdnPath: "/models/grudge6/races/BRB_Characters.glb",
    cdnUrl: `${CDN_BASE}/models/grudge6/races/BRB_Characters.glb`,
    fbxPath: "/models/grudge6/races/BRB_Characters.fbx",
    scale: 1.1,
    faction: "crusade",
    baseModelStem: "BRB_Characters",
    textureFolder: "barbarians",
    textureFile: "BRB_StandardUnits_texture.webp",
  },
  elf: {
    modelId: "elf",
    prefix: "ELF_",
    label: "Elf",
    cdnPath: "/models/grudge6/races/ELF_Characters.glb",
    cdnUrl: `${CDN_BASE}/models/grudge6/races/ELF_Characters.glb`,
    fbxPath: "/models/grudge6/races/ELF_Characters.fbx",
    scale: 1.0,
    faction: "fabled",
    baseModelStem: "ELF_Characters",
    textureFolder: "elves",
    textureFile: "ELF_HighElves_Texture.webp",
  },
  dwarf: {
    modelId: "dwarf",
    prefix: "DWF_",
    label: "Dwarf",
    cdnPath: "/models/grudge6/races/DWF_Characters.glb",
    cdnUrl: `${CDN_BASE}/models/grudge6/races/DWF_Characters.glb`,
    fbxPath: "/models/grudge6/races/DWF_Characters.fbx",
    scale: 0.85,
    faction: "crusade",
    baseModelStem: "DWF_Characters",
    textureFolder: "dwarves",
    textureFile: "DWF_Standard_Units.webp",
  },
  orc: {
    modelId: "orc",
    prefix: "ORC_",
    label: "Orc",
    cdnPath: "/models/grudge6/races/ORC_Characters.glb",
    cdnUrl: `${CDN_BASE}/models/grudge6/races/ORC_Characters.glb`,
    fbxPath: "/models/grudge6/races/ORC_Characters.fbx",
    scale: 1.15,
    faction: "legion",
    baseModelStem: "ORC_Characters",
    textureFolder: "orcs",
    textureFile: "ORC_StandardUnits.webp",
  },
  undead: {
    modelId: "undead",
    prefix: "UD_",
    label: "Undead",
    cdnPath: "/models/grudge6/races/UD_Characters.glb",
    cdnUrl: `${CDN_BASE}/models/grudge6/races/UD_Characters.glb`,
    fbxPath: "/models/grudge6/races/UD_Characters.fbx",
    scale: 1.0,
    faction: "legion",
    baseModelStem: "UD_Characters",
    textureFolder: "undead",
    textureFile: "UD_Standard_Units.webp",
  },
};

export const RACE_IDS: RaceId[] = ["human", "barbarian", "elf", "dwarf", "orc", "undead"];

export function raceCdnUrl(raceId: string): string {
  const id = (raceId in RACE_GRUDGE6 ? raceId : "human") as RaceId;
  return RACE_GRUDGE6[id].cdnUrl;
}

export function raceTextureUrls(raceId: string): string[] {
  const id = (raceId in RACE_GRUDGE6 ? raceId : "human") as RaceId;
  const r = RACE_GRUDGE6[id];
  const key = `textures/grudge6/${r.textureFolder}/${r.textureFile}`;
  return [
    `${CDN_BASE}/${key}`,
    `${CDN_BASE}/textures/grudge6/${r.textureFolder}/${r.textureFile}`,
  ];
}

export interface AssetRoot {
  id: AssetCategory;
  label: string;
  r2Prefix: string;
  description: string;
  forgeEnabled: boolean;
}

/** Canonical R2 prefixes for Grudge6 delivery pipeline. */
export const GRUDGE6_ASSET_ROOTS: AssetRoot[] = [
  {
    id: "characters",
    label: "Race characters",
    r2Prefix: "models/grudge6/races/",
    description: "6 races × modular GLB (WK_/BRB_/ELF_/DWF_/ORC_/UD_ Characters.glb)",
    forgeEnabled: true,
  },
  {
    id: "weapons",
    label: "Weapon packs (legacy)",
    r2Prefix: "asset-packs/weapons/",
    description: "Optional external weapons — prefer child meshes on race kit",
    forgeEnabled: true,
  },
  {
    id: "armor",
    label: "Armour packs (legacy)",
    r2Prefix: "asset-packs/armor/",
    description: "Optional external armor — prefer Units_* variants on race kit",
    forgeEnabled: true,
  },
  {
    id: "skins",
    label: "Race textures",
    r2Prefix: "textures/grudge6/",
    description: "Race atlas webp per faction folder",
    forgeEnabled: true,
  },
  {
    id: "effects",
    label: "Combat effects",
    r2Prefix: "asset-packs/effects/",
    description: "Hit flashes, spell impacts, status FX",
    forgeEnabled: true,
  },
  {
    id: "vfx",
    label: "VFX playground",
    r2Prefix: "asset-packs/vfx/",
    description: "Particles, trails, aura loops for viewer playground",
    forgeEnabled: true,
  },
  {
    id: "animations",
    label: "Animation packs",
    r2Prefix: "asset-packs/animations/",
    description: "1h_sword_shield, magic, longbow, 2h_melee state clips",
    forgeEnabled: false,
  },
];

export const CHARACTER_VIEWER_PROD = "https://character.grudge-studio.com/viewer";
export const ENGINE_PORTAL_PROD = "https://grudge-studio.com";
export const ENGINE_LOCAL_DEFAULT = "http://localhost:5000";

export function viewerUrl(opts?: { race?: string; classId?: string; vfx?: boolean }): string {
  const u = new URL(CHARACTER_VIEWER_PROD);
  if (opts?.race) u.searchParams.set("race", opts.race);
  if (opts?.classId) u.searchParams.set("class", opts.classId);
  if (opts?.vfx) u.searchParams.set("vfx", "1");
  return u.toString();
}

export function cdnUrl(r2Key: string): string {
  const key = r2Key.replace(/^\/+/, "");
  return `${CDN_BASE}/${key}`;
}

/** @deprecated Prefer RACE_GRUDGE6[*].cdnPath — FBX customizable path is legacy. */
export function raceModelR2Path(modelDir: string, prefix: string): string {
  return `models/grudge6/races/${prefix.replace(/_$/, "")}_Characters.glb`;
}
