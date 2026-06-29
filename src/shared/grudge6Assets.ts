/**
 * Grudge6 race character delivery — R2 library roots and CDN wiring.
 * Used by Grudge Engine tab for D1-style asset delivery to viewer + Forge.
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
    r2Prefix: "factioncharacters/",
    description: "6 races × FBX/GLB customizable units (WK_, BRB_, ELF_, DWF_, ORC_, UD_)",
    forgeEnabled: true,
  },
  {
    id: "weapons",
    label: "Weapons",
    r2Prefix: "asset-packs/weapons/",
    description: "Swords, axes, bows, staves — hand containers R_hand / L_hand",
    forgeEnabled: true,
  },
  {
    id: "armor",
    label: "Armour",
    r2Prefix: "asset-packs/armor/",
    description: "Body, arms, legs, shoulders, shields",
    forgeEnabled: true,
  },
  {
    id: "skins",
    label: "Skins",
    r2Prefix: "asset-packs/skins/",
    description: "Material variants and race skin packs",
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

export function raceModelR2Path(modelDir: string, prefix: string): string {
  return `factioncharacters/${modelDir}/models/${prefix}Characters_customizable.FBX`;
}