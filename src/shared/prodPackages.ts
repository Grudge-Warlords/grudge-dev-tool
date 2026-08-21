/**
 * Production package + prefab catalog URLs (ObjectStore / R2 CDN).
 * SSOT built by ObjectStore scripts/build-prod-gltf-packages.mjs
 */

export const CDN_BASE = "https://assets.grudge-studio.com";

/** Play roots — Toon RTS GLB (not prod/gltf bake). Height SI meters. */
export const TOON_PLAY_KITS: Record<string, { r2Key: string; heightM: number }> = {
  human: { r2Key: "asset-packs/toon-rts-characters/glb/characters/human.glb", heightM: 1.8 },
  barbarian: { r2Key: "asset-packs/toon-rts-characters/glb/characters/barbarian.glb", heightM: 1.8 },
  elf: { r2Key: "asset-packs/toon-rts-characters/glb/characters/elf.glb", heightM: 1.8 },
  dwarf: { r2Key: "asset-packs/toon-rts-characters/glb/characters/dwarf.glb", heightM: 1.55 },
  orc: { r2Key: "asset-packs/toon-rts-characters/glb/characters/orc.glb", heightM: 2.0 },
  undead: { r2Key: "asset-packs/toon-rts-characters/glb/characters/undead.glb", heightM: 1.8 },
};

export const PROD_CATALOG = {
  assetsIndex: `${CDN_BASE}/manifests/assets-gltf-index.json`,
  packages: `${CDN_BASE}/manifests/grudge-prod-packages.json`,
  prefabs: `${CDN_BASE}/manifests/grudge-prod-prefabs.json`,
  weaponPrefabs: `${CDN_BASE}/api/v1/master-weapon-prefabs.json`,
  /** Weapon locomotion + attack anim packages (samurai, pistol, knight S&S, spear, …) */
  animPackages: `${CDN_BASE}/prod/anims/packages.json`,
  animPackagesMirror: `${CDN_BASE}/manifests/grudge-prod-anim-packages.json`,
} as const;

/** Combat anim pack id → CDN base for clips */
export const PROD_ANIM_PACKS: Record<string, string> = {
  sword_shield: `${CDN_BASE}/prod/anims/sword_shield/`,
  greatsword_samurai: `${CDN_BASE}/prod/anims/greatsword_samurai/`,
  pistol: `${CDN_BASE}/prod/anims/pistol/`,
  rifle: `${CDN_BASE}/prod/anims/rifle/`,
  polearm: `${CDN_BASE}/prod/anims/polearm/`,
  spear: `${CDN_BASE}/prod/anims/spear/`,
  harvest: `${CDN_BASE}/prod/anims/harvest/`,
  block: `${CDN_BASE}/prod/anims/block/`,
  roll_dodge: `${CDN_BASE}/prod/anims/roll_dodge/`,
  locomotion: `${CDN_BASE}/prod/anims/locomotion/`,
  longbow: `${CDN_BASE}/prod/anims/longbow/`,
  magic: `${CDN_BASE}/prod/anims/magic/`,
  "2h_melee": `${CDN_BASE}/prod/anims/2h_melee/`,
};

export const WEAPON_TO_ANIM_PACK: Record<string, string> = {
  sword: "sword_shield",
  sword_shield: "sword_shield",
  knight: "sword_shield",
  bow: "longbow",
  longbow: "longbow",
  staff: "magic",
  magic: "magic",
  spear: "polearm",
  polearm: "polearm",
  pistol: "pistol",
  rifle: "rifle",
  gun: "rifle",
  assault_rifle: "rifle",
  greatsword: "greatsword_samurai",
  "2h": "2h_melee",
  "2h_melee": "2h_melee",
  samurai: "greatsword_samurai",
  harvest: "harvest",
  block: "block",
  roll: "roll_dodge",
  dodge: "roll_dodge",
  locomotion: "locomotion",
};

export type ProdPackageId =
  | "grudge6-races"
  | "armada-core"
  | "fantasy-weapons"
  | "skeletons"
  | "armada-props"
  | "creatures";

export interface ProdAssetRef {
  id: string;
  cdnUrl: string;
  r2Key: string;
  textures?: number;
  heightM?: number | null;
  bytes?: number;
}

export interface ProdPackage {
  id: string;
  count: number;
  yellowSafe: boolean;
  assets: ProdAssetRef[];
}

export interface ProdPackagesDoc {
  version: number;
  updatedAt: string;
  cdnBase: string;
  prefix: string;
  packages: ProdPackage[];
}

export interface ProdPrefab {
  prefabId: string;
  id: string;
  kind: string;
  name: string;
  mesh: {
    r2Key: string;
    cdnUrl: string;
    textures?: number;
    yellowSafe?: boolean;
  };
  package?: string;
  tags?: string[];
}

/** Race slug → prod/gltf character URL (atlas-baked, yellow-safe). */
export const GRUDGE6_PROD_GLTF: Record<string, string> = {
  human: `${CDN_BASE}/prod/gltf/characters/human.glb`,
  wk: `${CDN_BASE}/prod/gltf/characters/wk_characters.glb`,
  brb: `${CDN_BASE}/prod/gltf/characters/brb_characters.glb`,
  elf: `${CDN_BASE}/prod/gltf/characters/elf_characters.glb`,
  dwf: `${CDN_BASE}/prod/gltf/characters/dwf_characters.glb`,
  orc: `${CDN_BASE}/prod/gltf/characters/orc_characters.glb`,
  ud: `${CDN_BASE}/prod/gltf/characters/ud_characters.glb`,
  player: `${CDN_BASE}/prod/gltf/characters/player.glb`,
};

export const FANTASY_WEAPON_PROD_GLTF: Record<string, string> = {
  sword: `${CDN_BASE}/prod/gltf/weapons/sword.glb`,
  bow: `${CDN_BASE}/prod/gltf/weapons/bow.glb`,
  staff: `${CDN_BASE}/prod/gltf/weapons/staff.glb`,
  dagger: `${CDN_BASE}/prod/gltf/weapons/dagger.glb`,
  axe: `${CDN_BASE}/prod/gltf/weapons/axe.glb`,
  hammer: `${CDN_BASE}/prod/gltf/weapons/hammer.glb`,
  mace: `${CDN_BASE}/prod/gltf/weapons/mace.glb`,
  assault_rifle: `${CDN_BASE}/prod/gltf/weapons/assault_rifle.glb`,
  ak74u: `${CDN_BASE}/prod/gltf/weapons/ak74u.glb`,
  smg: `${CDN_BASE}/prod/gltf/weapons/smg.glb`,
  pistol: `${CDN_BASE}/prod/gltf/weapons/pistol.glb`,
  rifle: `${CDN_BASE}/prod/gltf/weapons/rifle.glb`,
  greatsword: `${CDN_BASE}/prod/gltf/weapons/greatsword.glb`,
};

export async function fetchProdAnimPackages(): Promise<unknown | null> {
  try {
    const r = await fetch(PROD_CATALOG.animPackages);
    if (!r.ok) {
      const r2 = await fetch(PROD_CATALOG.animPackagesMirror);
      if (!r2.ok) return null;
      return r2.json();
    }
    return r.json();
  } catch {
    return null;
  }
}

export async function fetchProdPackages(): Promise<ProdPackagesDoc | null> {
  try {
    const r = await fetch(PROD_CATALOG.packages);
    if (!r.ok) return null;
    return (await r.json()) as ProdPackagesDoc;
  } catch {
    return null;
  }
}

export async function fetchProdPrefabs(): Promise<{ prefabs: ProdPrefab[] } | null> {
  try {
    const r = await fetch(PROD_CATALOG.prefabs);
    if (!r.ok) return null;
    return (await r.json()) as { prefabs: ProdPrefab[] };
  } catch {
    return null;
  }
}
