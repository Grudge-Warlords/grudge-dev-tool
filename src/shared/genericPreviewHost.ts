/**
 * Generic Grudge preview body for animation files with no skinned mesh.
 *
 * Decision (Warlords / Dev Tool / Trait Store):
 *   Host = Toon RTS GOLDEN {race}.glb, unarmed mesh_ids only, Bip001, SI.
 *   Not 30characters.glb (outline only). Not Meshy / capsule. Not Mixamo Y-Bot as play.
 *
 * Mixamo-named clips rematch onto Bip001 via mixamo25 normalizeBoneKey.
 * Position tracks stripped so the grounded kit does not hip-float.
 */
import { CDN_BASE, TOON_PLAY_KITS } from "./prodPackages";

export const TOON_RACE_PREFIX: Record<string, string> = {
  human: "WK",
  barbarian: "BRB",
  elf: "ELF",
  dwarf: "DWF",
  orc: "ORC",
  undead: "UD",
};

export function toonKitUrl(race: string): string {
  const kit = TOON_PLAY_KITS[race] ?? TOON_PLAY_KITS.human;
  return `${CDN_BASE}/${kit.r2Key}`;
}

export function unarmedMeshIdsForRace(race: string): string[] {
  const prefix = TOON_RACE_PREFIX[race] || "WK";
  return [
    `${prefix}_Units_head_A`,
    `${prefix}_Units_Body_B`,
    `${prefix}_Units_Arms_A`,
    `${prefix}_Units_Legs_A`,
  ];
}

export const GENERIC_GRUDGE_PREVIEW = {
  id: "toon-human-unarmed",
  label: "Toon RTS human unarmed (Bip001)",
  skeleton: "bip001" as const,
  heightM: 1.8,
  kitUrl: toonKitUrl("human"),
  unarmedMeshIds: unarmedMeshIdsForRace("human"),
};

export type GenericPreviewId = typeof GENERIC_GRUDGE_PREVIEW.id;
