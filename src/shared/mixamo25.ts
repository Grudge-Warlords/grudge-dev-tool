/**
 * Mixamo-like 25-bone (no fingers) skeleton — Grudge Studio placement + retarget SSOT.
 * Used by Skeleton Studio for mouse placement, T-pose prep, and animation retarget.
 */

export const MIXAMO_25_VERSION = 1;

/** Canonical 25-bone chain (no finger phalanges). */
export const MIXAMO_25_BONES = [
  "Hips",
  "Spine",
  "Spine1",
  "Spine2",
  "Neck",
  "Head",
  "LeftShoulder",
  "LeftArm",
  "LeftForeArm",
  "LeftHand",
  "RightShoulder",
  "RightArm",
  "RightForeArm",
  "RightHand",
  "LeftUpLeg",
  "LeftLeg",
  "LeftFoot",
  "LeftToeBase",
  "RightUpLeg",
  "RightLeg",
  "RightFoot",
  "RightToeBase",
  // Optional extras often present in 24–26 joint packs
  "LeftEye",
  "RightEye",
  "HeadTop_End",
] as const;

export type Mixamo25Bone = (typeof MIXAMO_25_BONES)[number];

/** Core placement targets (22) — eyes/headtop optional */
export const MIXAMO_25_CORE: Mixamo25Bone[] = [
  "Hips", "Spine", "Spine1", "Spine2", "Neck", "Head",
  "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
  "RightShoulder", "RightArm", "RightForeArm", "RightHand",
  "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase",
  "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase",
];

export interface BonePlacement {
  bone: Mixamo25Bone;
  /** World-space marker from mouse pick */
  world: [number, number, number];
  /** Optional mesh local UV / triangle for rebuild */
  meshUuid?: string;
  confidence?: number;
}

export type AnimSkillCategory =
  | "locomotion"
  | "combat_melee"
  | "combat_ranged"
  | "magic"
  | "idle"
  | "hit"
  | "death"
  | "utility"
  | "emote";

export interface AnimSkillSlot {
  id: string;
  category: AnimSkillCategory;
  label: string;
  /** Preferred clip name patterns (case-insensitive match) */
  clipPatterns: string[];
  /** Grudge weapon pack keys that consume this slot */
  weaponPacks?: string[];
}

/** Grudge Studio animation skill management — maps packs to Mixamo 25 retarget targets */
export const ANIM_SKILL_SLOTS: AnimSkillSlot[] = [
  { id: "idle", category: "idle", label: "Idle", clipPatterns: ["idle", "stand", "breath"], weaponPacks: ["*"] },
  { id: "walk", category: "locomotion", label: "Walk", clipPatterns: ["walk", "walking"], weaponPacks: ["*"] },
  { id: "run", category: "locomotion", label: "Run", clipPatterns: ["run", "running", "sprint"], weaponPacks: ["*"] },
  { id: "strafe_l", category: "locomotion", label: "Strafe L", clipPatterns: ["strafe.*left", "left.*strafe"], weaponPacks: ["*"] },
  { id: "strafe_r", category: "locomotion", label: "Strafe R", clipPatterns: ["strafe.*right", "right.*strafe"], weaponPacks: ["*"] },
  { id: "jump", category: "locomotion", label: "Jump", clipPatterns: ["jump"], weaponPacks: ["*"] },
  { id: "attack1", category: "combat_melee", label: "Attack 1", clipPatterns: ["attack", "slash", "swing", "punch"], weaponPacks: ["sword", "sword_shield", "greataxe", "greatsword"] },
  { id: "attack2", category: "combat_melee", label: "Attack 2", clipPatterns: ["attack2", "combo", "slash2"], weaponPacks: ["sword", "sword_shield", "greataxe"] },
  { id: "block", category: "combat_melee", label: "Block", clipPatterns: ["block", "guard", "parry"], weaponPacks: ["sword_shield"] },
  { id: "shoot", category: "combat_ranged", label: "Shoot", clipPatterns: ["shoot", "fire", "aim.*recoil", "bow"], weaponPacks: ["bow", "crossbow", "gun", "rifle"] },
  { id: "cast", category: "magic", label: "Cast", clipPatterns: ["cast", "spell", "magic"], weaponPacks: ["fire_staff", "dark_staff", "focus"] },
  { id: "hit", category: "hit", label: "Hit / Hurt", clipPatterns: ["hit", "hurt", "react", "damage"], weaponPacks: ["*"] },
  { id: "death", category: "death", label: "Death", clipPatterns: ["death", "die", "dead"], weaponPacks: ["*"] },
  { id: "dodge", category: "utility", label: "Dodge", clipPatterns: ["dodge", "roll", "evade"], weaponPacks: ["*"] },
];

export function matchSkillSlot(clipName: string): AnimSkillSlot | null {
  const n = clipName.toLowerCase();
  for (const slot of ANIM_SKILL_SLOTS) {
    for (const pat of slot.clipPatterns) {
      try {
        if (new RegExp(pat, "i").test(n)) return slot;
      } catch {
        if (n.includes(pat.toLowerCase())) return slot;
      }
    }
  }
  return null;
}

/** Prefixed Mixamo bone names as exported by FBX2glTF */
export function mixamoPrefixed(bone: Mixamo25Bone): string[] {
  return [
    bone,
    `mixamorig:${bone}`,
    `mixamorig${bone}`,
    bone.replace(/([A-Z])/g, "_$1").replace(/^_/, ""),
  ];
}

export interface SkeletonMappingDoc {
  version: number;
  skeleton: "mixamo-25";
  sourceFile: string;
  placements: BonePlacement[];
  /** source bone name → Mixamo25 target */
  boneMap: Record<string, Mixamo25Bone>;
  createdAt: string;
}

export function emptyMapping(sourceFile: string): SkeletonMappingDoc {
  return {
    version: MIXAMO_25_VERSION,
    skeleton: "mixamo-25",
    sourceFile,
    placements: [],
    boneMap: {},
    createdAt: new Date().toISOString(),
  };
}
