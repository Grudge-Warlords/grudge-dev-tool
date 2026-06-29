/**
 * Game roster — synced with The-ENGINE shared/game-roster.ts
 */

import {
  CHARACTER_PREFABS,
  getPrefab,
  getEquipmentMeshNames,
  type CharacterPrefab,
} from "./characterCatalog";

export const LANE_HEROES: CharacterPrefab[] = CHARACTER_PREFABS;

export interface PregameWeapon {
  id: string;
  label: string;
  icon: string;
  manifestKey: string;
  tags: string[];
}

export const PREGAME_WEAPONS: PregameWeapon[] = [
  { id: "knife", label: "Combat Knife", icon: "🗡️", manifestKey: "weapon_knife_1", tags: ["melee"] },
  { id: "shovel", label: "Shovel", icon: "⛏️", manifestKey: "weapon_shovel", tags: ["melee"] },
  { id: "pistol", label: "Pistol", icon: "🔫", manifestKey: "weapon_pistol", tags: ["ranged"] },
  { id: "smg", label: "SMG", icon: "🔫", manifestKey: "weapon_smg", tags: ["ranged"] },
  { id: "shotgun", label: "Shotgun", icon: "💥", manifestKey: "weapon_shotgun", tags: ["ranged"] },
  { id: "ak", label: "Assault Rifle", icon: "🎯", manifestKey: "weapon_ak", tags: ["ranged"] },
  { id: "sniper", label: "Sniper", icon: "🎯", manifestKey: "weapon_sniper", tags: ["ranged"] },
  { id: "revolver", label: "Revolver", icon: "🤠", manifestKey: "weapon_revolver", tags: ["ranged"] },
  { id: "grenade", label: "Grenade", icon: "💣", manifestKey: "weapon_grenade", tags: ["throwable"] },
  { id: "launcher", label: "Grenade Launcher", icon: "🚀", manifestKey: "weapon_grenade_launcher", tags: ["ranged"] },
];

export interface PlayerLoadout {
  heroId: string;
  primaryWeapon: string;
  secondaryWeapon: string | null;
}

export const LOADOUT_STORAGE_KEY = "grudge:pregame-loadout";

export function toUnarmedPrefab(prefab: CharacterPrefab): CharacterPrefab {
  return {
    ...prefab,
    equipment: {
      ...prefab.equipment,
      rightHand: null,
      rightHandType: null,
      leftHand: null,
      leftHandType: null,
      shield: null,
      utility: [],
    },
    animationPack: "unarmed",
  };
}

const WEAPON_MESH_RE = /Units_(sword|axe|hammer|mace|dagger|bow|staff|shield|gun|pistol|rifle)_|Units_Bow|Xtra_/i;

export function applyUnarmedMeshVisibility(root: import("three").Object3D): void {
  root.traverse((child) => {
    if (!(child as import("three").Mesh).isMesh) return;
    if (WEAPON_MESH_RE.test(child.name)) child.visible = false;
  });
}

export function applyLaneMeshVisibility(root: import("three").Object3D, prefab: CharacterPrefab): void {
  const visible = new Set(getEquipmentMeshNames(prefab));
  root.traverse((child) => {
    if (!(child as import("three").Mesh).isMesh) return;
    child.visible = visible.has(child.name) || child.name.includes("Bip") || child.name.includes("mixamo");
  });
}

export function savePlayerLoadout(loadout: PlayerLoadout): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(LOADOUT_STORAGE_KEY, JSON.stringify(loadout));
}

export function readPlayerLoadout(): PlayerLoadout | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(LOADOUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlayerLoadout;
    if (!parsed.heroId || !parsed.primaryWeapon) return null;
    if (!getPrefab(parsed.heroId)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getWeaponById(id: string): PregameWeapon | undefined {
  return PREGAME_WEAPONS.find((w) => w.id === id);
}