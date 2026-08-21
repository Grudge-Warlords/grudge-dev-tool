/**
 * Generic Grudge preview body for animation files with no skinned mesh.
 *
 * Decision (Warlords / Dev Tool / Trait Store):
 *   Host = Toon RTS GOLDEN human.glb, unarmed mesh_ids only, Bip001, SI 1.8 m.
 *   Not 30characters.glb (outline only). Not Meshy / capsule. Not Mixamo Y-Bot as play.
 *
 * Mixamo-named clips rematch onto Bip001 via mixamo25 normalizeBoneKey.
 * Position tracks stripped so the grounded kit does not hip-float.
 */
export const GENERIC_GRUDGE_PREVIEW = {
  id: "toon-human-unarmed",
  label: "Toon RTS human unarmed (Bip001)",
  skeleton: "bip001",
  heightM: 1.8,
  kitUrl:
    "https://assets.grudge-studio.com/asset-packs/toon-rts-characters/glb/characters/human.glb",
  unarmedMeshIds: [
    "WK_Units_head_A",
    "WK_Units_Body_B",
    "WK_Units_Arms_A",
    "WK_Units_Legs_A",
  ],
} as const;

export type GenericPreviewId = typeof GENERIC_GRUDGE_PREVIEW.id;
