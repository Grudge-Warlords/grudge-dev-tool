/**
 * Mixamo-like 25-bone (no fingers) skeleton — Grudge Studio placement + retarget SSOT.
 * Used by Skeleton Studio for mouse placement, T-pose prep, and animation retarget.
 */

export const MIXAMO_25_VERSION = 2;

/** Canonical 25-bone chain (no finger phalanges). Core placement uses 22. */
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

/** Parent map for hierarchy checks / IK helpers (core only). */
export const MIXAMO_25_PARENT: Partial<Record<Mixamo25Bone, Mixamo25Bone | null>> = {
  Hips: null,
  Spine: "Hips",
  Spine1: "Spine",
  Spine2: "Spine1",
  Neck: "Spine2",
  Head: "Neck",
  LeftShoulder: "Spine2",
  LeftArm: "LeftShoulder",
  LeftForeArm: "LeftArm",
  LeftHand: "LeftForeArm",
  RightShoulder: "Spine2",
  RightArm: "RightShoulder",
  RightForeArm: "RightArm",
  RightHand: "RightForeArm",
  LeftUpLeg: "Hips",
  LeftLeg: "LeftUpLeg",
  LeftFoot: "LeftLeg",
  LeftToeBase: "LeftFoot",
  RightUpLeg: "Hips",
  RightLeg: "RightUpLeg",
  RightFoot: "RightLeg",
  RightToeBase: "RightFoot",
};

export interface BonePlacement {
  bone: Mixamo25Bone;
  /** World-space marker from mouse pick */
  world: [number, number, number];
  /** Optional mesh local UV / triangle for rebuild */
  meshUuid?: string;
  /** Source skeleton bone that maps to this Mixamo-25 target */
  sourceBone?: string;
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

/**
 * Grudge Studio animation skill management — maps packs to Mixamo 25 retarget targets.
 * Patterns: more specific first where order matters; matchSkillSlot scores by specificity.
 */
export const ANIM_SKILL_SLOTS: AnimSkillSlot[] = [
  { id: "idle", category: "idle", label: "Idle", clipPatterns: ["idle", "stand", "breath", "tpose", "t-pose", "rest"], weaponPacks: ["*"] },
  { id: "walk", category: "locomotion", label: "Walk", clipPatterns: ["walk", "walking", "locomotion"], weaponPacks: ["*"] },
  { id: "run", category: "locomotion", label: "Run", clipPatterns: ["run", "running", "sprint", "jog"], weaponPacks: ["*"] },
  { id: "strafe_l", category: "locomotion", label: "Strafe L", clipPatterns: ["strafe.*left", "left.*strafe", "strafe_l", "strafeleft"], weaponPacks: ["*"] },
  { id: "strafe_r", category: "locomotion", label: "Strafe R", clipPatterns: ["strafe.*right", "right.*strafe", "strafe_r", "straferight"], weaponPacks: ["*"] },
  { id: "jump", category: "locomotion", label: "Jump", clipPatterns: ["jump", "leap"], weaponPacks: ["*"] },
  // Specific melee before generic "attack"
  { id: "attack2", category: "combat_melee", label: "Attack 2", clipPatterns: ["attack.?2", "attack2", "combo.?2", "slash.?2", "combo", "heavy.?slash"], weaponPacks: ["sword", "sword_shield", "greataxe", "greatsword", "samurai"] },
  { id: "attack1", category: "combat_melee", label: "Attack 1", clipPatterns: ["attack.?1", "attack1", "slash", "swing", "punch", "melee", "attack", "sword.?attack"], weaponPacks: ["sword", "sword_shield", "greataxe", "greatsword", "samurai"] },
  { id: "block", category: "combat_melee", label: "Block", clipPatterns: ["block", "guard", "parry", "shield"], weaponPacks: ["sword_shield"] },
  { id: "shoot", category: "combat_ranged", label: "Shoot", clipPatterns: ["shoot", "fire", "aim", "recoil", "bow", "draw", "arrow", "rifle", "gun"], weaponPacks: ["bow", "crossbow", "gun", "rifle", "longbow"] },
  { id: "cast", category: "magic", label: "Cast", clipPatterns: ["cast", "spell", "magic", "channel", "staff"], weaponPacks: ["fire_staff", "dark_staff", "focus", "magic"] },
  { id: "hit", category: "hit", label: "Hit / Hurt", clipPatterns: ["hit", "hurt", "react", "damage", "flinch", "impact"], weaponPacks: ["*"] },
  { id: "death", category: "death", label: "Death", clipPatterns: ["death", "die", "dead", "ko"], weaponPacks: ["*"] },
  { id: "dodge", category: "utility", label: "Dodge", clipPatterns: ["dodge", "roll", "evade", "sidestep"], weaponPacks: ["*"] },
];

/** Canonical weapon / anim package keys fleet games load. */
export const ANIM_WEAPON_PACKS = [
  "sword",
  "sword_shield",
  "greataxe",
  "greatsword",
  "samurai",
  "bow",
  "longbow",
  "crossbow",
  "gun",
  "rifle",
  "fire_staff",
  "dark_staff",
  "focus",
  "magic",
  "unarmed",
] as const;

export type AnimWeaponPack = (typeof ANIM_WEAPON_PACKS)[number];

/**
 * Match clip name → skill slot. Scores by pattern specificity so
 * "Sword_Attack_2" hits attack2, not attack1.
 */
export function matchSkillSlot(clipName: string): AnimSkillSlot | null {
  const n = clipName.toLowerCase().replace(/[_\-\s]+/g, " ");
  let best: { slot: AnimSkillSlot; score: number } | null = null;
  for (const slot of ANIM_SKILL_SLOTS) {
    for (const pat of slot.clipPatterns) {
      try {
        const re = new RegExp(pat, "i");
        if (!re.test(n) && !re.test(clipName)) continue;
        // Longer pattern + digit/specificity bonus
        let score = pat.length;
        if (/\d|combo|heavy|2|strafe|slash/.test(pat)) score += 12;
        if (slot.id.endsWith("2")) score += 4;
        if (!best || score > best.score) best = { slot, score };
      } catch {
        if (n.includes(pat.toLowerCase())) {
          const score = pat.length;
          if (!best || score > best.score) best = { slot, score };
        }
      }
    }
  }
  return best?.slot ?? null;
}

/** Collapse bone name for fuzzy match (mixamorig:Hips → hips). */
export function normalizeBoneKey(name: string): string {
  return name
    .replace(/^(mixamorig[:.]?|bip001[\s._-]*|cc_base_|c_?)/i, "")
    .replace(/[:.\s_-]+/g, "")
    .toLowerCase();
}

/** Prefixed Mixamo bone names as exported by FBX2glTF / Blender */
export function mixamoPrefixed(bone: Mixamo25Bone): string[] {
  const snake = bone.replace(/([A-Z])/g, "_$1").replace(/^_/, "");
  return [
    bone,
    `mixamorig:${bone}`,
    `mixamorig${bone}`,
    `mixamorig_${bone}`,
    snake,
    snake.toLowerCase(),
  ];
}

/**
 * Extra source-name keys → Mixamo-25 target (Bip001, UE, CC, generic).
 * Keys must already be normalizeBoneKey'd.
 */
const EXTRA_SOURCE_ALIASES: Record<string, Mixamo25Bone> = {
  // Hips
  hips: "Hips", hip: "Hips", pelvis: "Hips", root: "Hips",
  // Spine
  spine: "Spine", spine1: "Spine1", spine01: "Spine1", spine2: "Spine2",
  spine02: "Spine2", chest: "Spine2", upperchest: "Spine2",
  // Head
  neck: "Neck", head: "Head",
  // Arms L
  leftshoulder: "LeftShoulder", lshoulder: "LeftShoulder", claviclel: "LeftShoulder",
  leftarm: "LeftArm", luparm: "LeftArm", leftupperarm: "LeftArm", upperarml: "LeftArm",
  leftforearm: "LeftForeArm", lforearm: "LeftForeArm", leftlowerarm: "LeftForeArm", lowerarml: "LeftForeArm",
  lefthand: "LeftHand", lhand: "LeftHand", handl: "LeftHand",
  // Arms R
  rightshoulder: "RightShoulder", rshoulder: "RightShoulder", clavicler: "RightShoulder",
  rightarm: "RightArm", ruparm: "RightArm", rightupperarm: "RightArm", upperarmr: "RightArm",
  rightforearm: "RightForeArm", rforearm: "RightForeArm", rightlowerarm: "RightForeArm", lowerarmr: "RightForeArm",
  righthand: "RightHand", rhand: "RightHand", handr: "RightHand",
  // Legs L
  leftupleg: "LeftUpLeg", lthigh: "LeftUpLeg", leftthigh: "LeftUpLeg", thighl: "LeftUpLeg", upperlegl: "LeftUpLeg",
  leftleg: "LeftLeg", lcalf: "LeftLeg", leftcalf: "LeftLeg", lowerlegl: "LeftLeg", shinl: "LeftLeg",
  leftfoot: "LeftFoot", lfoot: "LeftFoot", footl: "LeftFoot",
  lefttoebase: "LeftToeBase", ltoe: "LeftToeBase", toel: "LeftToeBase",
  // Legs R
  rightupleg: "RightUpLeg", rthigh: "RightUpLeg", rightthigh: "RightUpLeg", thighr: "RightUpLeg", upperlegr: "RightUpLeg",
  rightleg: "RightLeg", rcalf: "RightLeg", rightcalf: "RightLeg", lowerlegr: "RightLeg", shinr: "RightLeg",
  rightfoot: "RightFoot", rfoot: "RightFoot", footr: "RightFoot",
  righttoebase: "RightToeBase", rtoe: "RightToeBase", toer: "RightToeBase",
  // Bip001 style
  bip001pelvis: "Hips",
  bip001spine: "Spine",
  bip001spine1: "Spine1",
  bip001spine2: "Spine2",
  bip001neck: "Neck",
  bip001head: "Head",
  bip001lclavicle: "LeftShoulder",
  bip001lupperarm: "LeftArm",
  bip001lforearm: "LeftForeArm",
  bip001lhand: "LeftHand",
  bip001rclavicle: "RightShoulder",
  bip001rupperarm: "RightArm",
  bip001rforearm: "RightForeArm",
  bip001rhand: "RightHand",
  bip001lthigh: "LeftUpLeg",
  bip001lcalf: "LeftLeg",
  bip001lfoot: "LeftFoot",
  bip001ltoe0: "LeftToeBase",
  bip001rthigh: "RightUpLeg",
  bip001rcalf: "RightLeg",
  bip001rfoot: "RightFoot",
  bip001rtoe0: "RightToeBase",
};

export interface AutoBoneMapResult {
  /** source bone name → Mixamo25 target */
  boneMap: Record<string, Mixamo25Bone>;
  /** Mixamo25 target → best source bone name */
  reverseMap: Partial<Record<Mixamo25Bone, string>>;
  matched: number;
  unmatchedTargets: Mixamo25Bone[];
  unmatchedSources: string[];
}

/**
 * Auto-map skeleton joint names onto Mixamo-25 targets.
 * Prefer exact Mixamo prefixes; fall back to EXTRA_SOURCE_ALIASES / normalizeBoneKey.
 */
export function autoMapBonesFromNames(jointNames: string[]): AutoBoneMapResult {
  const boneMap: Record<string, Mixamo25Bone> = {};
  const reverseMap: Partial<Record<Mixamo25Bone, string>> = {};
  const usedSources = new Set<string>();

  // Index sources by normalized key
  const byNorm = new Map<string, string[]>();
  for (const j of jointNames) {
    const k = normalizeBoneKey(j);
    if (!k) continue;
    const arr = byNorm.get(k) ?? [];
    arr.push(j);
    byNorm.set(k, arr);
  }

  const tryBind = (target: Mixamo25Bone, candidates: string[]) => {
    if (reverseMap[target]) return;
    for (const c of candidates) {
      const sources = byNorm.get(normalizeBoneKey(c)) ?? [];
      // Also exact name match
      const exact = jointNames.find((j) => j === c || j.toLowerCase() === c.toLowerCase());
      const pick = exact || sources[0];
      if (!pick || usedSources.has(pick)) continue;
      boneMap[pick] = target;
      reverseMap[target] = pick;
      usedSources.add(pick);
      return;
    }
  };

  for (const target of MIXAMO_25_CORE) {
    const prefixed = mixamoPrefixed(target);
    tryBind(target, prefixed);
    if (reverseMap[target]) continue;
    // Extra aliases that normalize to this target
    const extras = Object.entries(EXTRA_SOURCE_ALIASES)
      .filter(([, t]) => t === target)
      .map(([k]) => k);
    for (const k of extras) {
      const sources = byNorm.get(k);
      if (!sources?.length) continue;
      const pick = sources.find((s) => !usedSources.has(s)) ?? sources[0];
      if (usedSources.has(pick)) continue;
      boneMap[pick] = target;
      reverseMap[target] = pick;
      usedSources.add(pick);
      break;
    }
  }

  const unmatchedTargets = MIXAMO_25_CORE.filter((t) => !reverseMap[t]);
  const unmatchedSources = jointNames.filter((j) => !usedSources.has(j));

  return {
    boneMap,
    reverseMap,
    matched: Object.keys(reverseMap).length,
    unmatchedTargets,
    unmatchedSources,
  };
}

/**
 * SkeletonUtils-style names map: { [targetBoneName]: sourceBoneName }
 * Uses reverseMap when target scene uses Mixamo-25 names; otherwise identity.
 */
export function buildSkuNamesMap(
  reverseMap: Partial<Record<Mixamo25Bone, string>>,
  targetBoneNames?: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [target, source] of Object.entries(reverseMap) as [Mixamo25Bone, string][]) {
    if (!source) continue;
    out[target] = source;
    // Also map common prefixed forms on target
    for (const alias of mixamoPrefixed(target)) {
      out[alias] = source;
    }
  }
  if (targetBoneNames?.length) {
    // If target bones are already Mixamo-prefixed, ensure they appear as keys
    for (const tb of targetBoneNames) {
      const norm = normalizeBoneKey(tb);
      for (const core of MIXAMO_25_CORE) {
        if (normalizeBoneKey(core) === norm && reverseMap[core]) {
          out[tb] = reverseMap[core]!;
        }
      }
    }
  }
  return out;
}

export interface SkeletonMappingDoc {
  version: number;
  skeleton: "mixamo-25";
  sourceFile: string;
  placements: BonePlacement[];
  /** source bone name → Mixamo25 target */
  boneMap: Record<string, Mixamo25Bone>;
  /** Mixamo25 → source (optional, filled by auto-map) */
  reverseMap?: Partial<Record<Mixamo25Bone, string>>;
  autoMap?: AutoBoneMapResult | null;
  createdAt: string;
  updatedAt?: string;
}

export function emptyMapping(sourceFile: string): SkeletonMappingDoc {
  return {
    version: MIXAMO_25_VERSION,
    skeleton: "mixamo-25",
    sourceFile,
    placements: [],
    boneMap: {},
    reverseMap: {},
    autoMap: null,
    createdAt: new Date().toISOString(),
  };
}

/** Apply autoMap into a mapping document (keeps existing placements). */
export function applyAutoMapToDoc(
  doc: SkeletonMappingDoc,
  jointNames: string[],
): SkeletonMappingDoc {
  const auto = autoMapBonesFromNames(jointNames);
  return {
    ...doc,
    version: MIXAMO_25_VERSION,
    boneMap: { ...auto.boneMap, ...doc.boneMap },
    reverseMap: { ...auto.reverseMap, ...doc.reverseMap },
    autoMap: auto,
    updatedAt: new Date().toISOString(),
  };
}
