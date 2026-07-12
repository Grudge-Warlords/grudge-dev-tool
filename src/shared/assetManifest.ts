/**
 * Canonical CDN asset manifest — synced with The-ENGINE grudge-assets.ts
 * Keys resolve via assets.grudge-studio.com
 */

export interface AssetEntry {
  path: string;
  sizeKB?: number;
  tags?: string[];
}

export const ASSET_MANIFEST: Record<string, AssetEntry> = {
  // ── Canonical Grudge6 race kits (Engine / Warlords mesh equip) ──
  race_human:     { path: "models/grudge6/races/WK_Characters.glb",  tags: ["character", "grudge6", "race"] },
  race_barbarian: { path: "models/grudge6/races/BRB_Characters.glb", tags: ["character", "grudge6", "race"] },
  race_elf:       { path: "models/grudge6/races/ELF_Characters.glb", tags: ["character", "grudge6", "race"] },
  race_dwarf:     { path: "models/grudge6/races/DWF_Characters.glb", tags: ["character", "grudge6", "race"] },
  race_orc:       { path: "models/grudge6/races/ORC_Characters.glb", tags: ["character", "grudge6", "race"] },
  race_undead:    { path: "models/grudge6/races/UD_Characters.glb",  tags: ["character", "grudge6", "race"] },

  // Legacy toon-shooter (demos / Arena only — NOT Engine character viewer)
  char_enemy:   { path: "toon-shooter/characters/Character_Enemy.glb", sizeKB: 1233, tags: ["character", "enemy", "toon-shooter"] },
  char_hazmat:  { path: "toon-shooter/characters/Character_Hazmat.glb", sizeKB: 1273, tags: ["character", "toon-shooter"] },
  char_soldier: { path: "toon-shooter/characters/Character_Soldier.glb", sizeKB: 1283, tags: ["character", "player", "toon-shooter"] },

  weapon_ak:             { path: "toon-shooter/guns/AK.glb", sizeKB: 57, tags: ["weapon", "ranged"] },
  weapon_pistol:         { path: "toon-shooter/guns/Pistol.glb", sizeKB: 41, tags: ["weapon", "ranged"] },
  weapon_shotgun:        { path: "toon-shooter/guns/Shotgun.glb", sizeKB: 47, tags: ["weapon", "ranged"] },
  weapon_smg:            { path: "toon-shooter/guns/SMG.glb", sizeKB: 43, tags: ["weapon", "ranged"] },
  weapon_sniper:         { path: "toon-shooter/guns/Sniper.glb", sizeKB: 83, tags: ["weapon", "ranged"] },
  weapon_revolver:       { path: "toon-shooter/guns/Revolver.glb", sizeKB: 59, tags: ["weapon", "ranged"] },
  weapon_grenade:        { path: "toon-shooter/guns/Grenade.glb", sizeKB: 24, tags: ["weapon", "throwable"] },
  weapon_fire_grenade:   { path: "toon-shooter/guns/FireGrenade.glb", sizeKB: 29, tags: ["weapon", "throwable"] },
  weapon_grenade_launcher: { path: "toon-shooter/guns/GrenadeLauncher.glb", sizeKB: 55, tags: ["weapon", "ranged"] },
  weapon_rocket_launcher: { path: "toon-shooter/guns/RocketLauncher.glb", sizeKB: 50, tags: ["weapon", "ranged"] },
  weapon_knife_1:        { path: "toon-shooter/guns/Knife_1.glb", sizeKB: 24, tags: ["weapon", "melee"] },
  weapon_knife_2:        { path: "toon-shooter/guns/Knife_2.glb", sizeKB: 26, tags: ["weapon", "melee"] },
  weapon_shovel:         { path: "toon-shooter/guns/Shovel.glb", sizeKB: 24, tags: ["weapon", "melee"] },
  weapon_short_cannon:   { path: "toon-shooter/guns/ShortCannon.glb", sizeKB: 23, tags: ["weapon", "siege"] },

  env_tree_1:       { path: "toon-shooter/environment/Tree_1.glb", sizeKB: 46, tags: ["environment", "tree"] },
  env_tree_2:       { path: "toon-shooter/environment/Tree_2.glb", sizeKB: 31, tags: ["environment", "tree"] },
  env_tree_3:       { path: "toon-shooter/environment/Tree_3.glb", sizeKB: 45, tags: ["environment", "tree"] },
  env_tree_4:       { path: "toon-shooter/environment/Tree_4.glb", sizeKB: 20, tags: ["environment", "tree"] },
  env_structure_1:  { path: "toon-shooter/environment/Structure_1.glb", sizeKB: 241, tags: ["environment", "building"] },
  env_structure_2:  { path: "toon-shooter/environment/Structure_2.glb", sizeKB: 319, tags: ["environment", "building"] },
  env_structure_3:  { path: "toon-shooter/environment/Structure_3.glb", sizeKB: 317, tags: ["environment", "building"] },
  env_structure_4:  { path: "toon-shooter/environment/Structure_4.glb", sizeKB: 324, tags: ["environment", "building"] },
  env_crate:        { path: "toon-shooter/environment/Crate.glb", sizeKB: 12, tags: ["environment", "prop"] },
  env_barrel:       { path: "toon-shooter/environment/ExplodingBarrel.glb", sizeKB: 17, tags: ["environment", "prop", "destructible"] },
  env_barrier:      { path: "toon-shooter/environment/Barrier_Fixed.glb", sizeKB: 147, tags: ["environment", "barrier"] },
  env_sandbag:      { path: "toon-shooter/environment/SackTrench.glb", sizeKB: 18, tags: ["environment", "defense"] },
  env_tank:         { path: "toon-shooter/environment/Tank.glb", sizeKB: 106, tags: ["environment", "vehicle"] },
  env_fence:        { path: "toon-shooter/environment/Fence.glb", sizeKB: 6, tags: ["environment", "wall"] },
  env_metal_fence:  { path: "toon-shooter/environment/MetalFence.glb", sizeKB: 86, tags: ["environment", "wall"] },
  env_brick_wall:   { path: "toon-shooter/environment/BrickWall_1.glb", sizeKB: 7, tags: ["environment", "wall"] },
  env_street_light: { path: "toon-shooter/environment/StreetLight.glb", sizeKB: 10, tags: ["environment", "light"] },
  env_bear_trap:    { path: "toon-shooter/environment/BearTrap_Open.glb", sizeKB: 24, tags: ["environment", "trap"] },
  env_landmine:     { path: "toon-shooter/environment/Landmine.glb", sizeKB: 12, tags: ["environment", "trap"] },
  env_health:       { path: "toon-shooter/environment/Health.glb", sizeKB: 25, tags: ["pickup", "health"] },
  env_key:          { path: "toon-shooter/environment/Key.glb", sizeKB: 12, tags: ["pickup", "key"] },
};

export type AssetTag =
  | "character" | "weapon" | "environment" | "building" | "tree" | "prop"
  | "texture" | "all";

export const MANIFEST_CATEGORIES: { id: AssetTag; label: string }[] = [
  { id: "all", label: "All CDN" },
  { id: "character", label: "Characters" },
  { id: "weapon", label: "Weapons" },
  { id: "environment", label: "Environment" },
  { id: "building", label: "Buildings" },
  { id: "tree", label: "Trees" },
  { id: "prop", label: "Props" },
];

export function manifestByTag(tag: AssetTag): Array<{ key: string; entry: AssetEntry }> {
  const all = Object.entries(ASSET_MANIFEST).map(([key, entry]) => ({ key, entry }));
  if (tag === "all") return all;
  return all.filter(({ entry }) => entry.tags?.includes(tag));
}

/** Procedural / PBR texture presets (CDN or data URLs for quick testing) */
export const TEXTURE_PRESETS: Array<{ id: string; label: string; url: string; tags: string[] }> = [
  { id: "grid", label: "Debug grid", url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", tags: ["debug"] },
  { id: "metal", label: "Metal plate", url: "https://assets.grudge-studio.com/asset-packs/textures/metal_plate_01.jpg", tags: ["pbr", "metal"] },
  { id: "wood", label: "Wood planks", url: "https://assets.grudge-studio.com/asset-packs/textures/wood_planks_01.jpg", tags: ["pbr", "wood"] },
  { id: "stone", label: "Stone wall", url: "https://assets.grudge-studio.com/asset-packs/textures/stone_wall_01.jpg", tags: ["pbr", "stone"] },
  { id: "grass", label: "Grass ground", url: "https://assets.grudge-studio.com/asset-packs/textures/grass_ground_01.jpg", tags: ["pbr", "ground"] },
];