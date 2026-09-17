import { ClipRole } from '@grudge-studio/assets';

/**
 * Framework-light gait director. Works with THREE.AnimationMixer actions.
 * Does not import three at runtime (duck-typed) so SSR/CJS stay clean.
 *
 * For combat (weapon skills on locomotion), prefer {@link LocomotionCore}.
 */
interface LocoClips {
    idle: unknown;
    walk: unknown;
    run: unknown;
    sprint?: unknown;
}
interface ActionLike {
    reset(): ActionLike;
    play(): ActionLike;
    stop(): ActionLike;
    fadeIn(d: number): ActionLike;
    fadeOut(d: number): ActionLike;
    setEffectiveWeight(w: number): ActionLike;
    setLoop(mode: number, reps: number): ActionLike;
    clampWhenFinished: boolean;
    isRunning(): boolean;
    getClip(): {
        duration: number;
    };
}
interface MixerLike {
    clipAction(clip: unknown): ActionLike;
    update(dt: number): void;
}
interface AnimationDirectorOptions {
    fade?: number;
    /** Speed fraction below which walk wins over run (default 0.45) */
    walkSpeedFrac?: number;
    /** Loco weight while one-shot overlay is busy (default 0.45) */
    busyLocoWeight?: number;
}
/**
 * Owns locomotion weights + overlay one-shots.
 * Call setGaitTarget every frame; requestOneShot for attacks.
 */
declare class AnimationDirector {
    private mixer;
    private idle;
    private walk;
    private run;
    private sprint;
    private fade;
    private walkSpeedFrac;
    private busyLocoWeight;
    private moving;
    private sprinting;
    private speed01;
    private overlay;
    busy: boolean;
    constructor(mixer: MixerLike, clips: LocoClips, opts?: AnimationDirectorOptions);
    /**
     * @param moving - any locomotion intent
     * @param sprinting - sprint hold
     * @param speed01 - optional 0–1 speed for walk vs run (omit → run when moving)
     */
    setGaitTarget(moving: boolean, sprinting?: boolean, speed01?: number): void;
    requestOneShot(clip: unknown, opts?: {
        fade?: number;
        blend?: number;
    }): boolean;
    update(dt: number): void;
    dispose(): void;
}

type BattleClipSlot = "idle" | "walk" | "run" | "attack1" | "attack2" | "jump" | "jumpAttack" | "cast" | "hit" | "death" | "warcry";
/** Default sword_shield battle map (rel paths under /anims/baked). */
declare const DEFAULT_BATTLE_CLIPS: Record<BattleClipSlot, string[]>;
declare function battleClipUrls(slot: BattleClipSlot, sameOrigin?: boolean): string[];
/**
 * Resolve candidate URL keys for a pack role via ANIM_PACKS registry.
 * Skips .fbx source keys (not loadable as baked JSON until bake).
 */
declare function packRoleUrls(packId: string, role: ClipRole | BattleClipSlot, sameOrigin?: boolean): string[];
/** Skill clip URL candidates for pack skillId */
declare function packSkillUrls(packId: string, skillId: string, sameOrigin?: boolean): string[];

/**
 * Animation blending helpers — weight curves, layer intents, bone-mask tokens.
 * Hosts apply weights to THREE.AnimationAction; this package stays duck-typed.
 *
 * Weapon skill profiles live in @grudge-studio/assets (SKILL_BLEND_PROFILES).
 * Runtime application: LocomotionCore + skillOnLocoWeights.
 * See packages/assets/docs/WEAPON_SKILL_BLENDS.md
 */
/** Common blend layer ids for combat + loco */
type BlendLayerId = "locomotion" | "upper_body" | "full_body_skill" | "additive" | "face" | "ik";
interface LayerWeights {
    locomotion: number;
    upper_body: number;
    full_body_skill: number;
    additive: number;
}
/** Default: full loco, no skill */
declare function defaultLayerWeights(): LayerWeights;
/**
 * When a weapon skill plays on top of locomotion:
 * - allowLoco keeps partial gait under upper-body weight
 * - otherwise almost freezes loco for full-body skills
 */
declare function skillOnLocoWeights(opts: {
    skillWeight?: number;
    allowLocomotion?: boolean;
    skillLocoRetain?: number;
}): LayerWeights;
/** Smoothstep ease 0–1 */
declare function smoothstep(t: number): number;
/** Linear interpolate */
declare function lerp(a: number, b: number, t: number): number;
declare function clamp01(v: number): number;
/**
 * Crossfade plan for two exclusive actions (A → B over fadeS seconds).
 * Host applies each frame: A weight = out, B weight = in.
 */
declare function crossfadePlan(elapsedS: number, fadeS: number): {
    fromWeight: number;
    toWeight: number;
    done: boolean;
};
/**
 * Bone groups for optional mask filtering (hosts map to AnimationObjectGroup
 * or strip tracks). Names are Bip001 tokens after normalizeBoneToken.
 */
declare const BONE_MASK_GROUPS: {
    /** Legs + hips — keep under locomotion when skill is upper-body */
    readonly lowerBody: readonly ["pelvis", "lthigh", "lcalf", "lfoot", "rthigh", "rcalf", "rfoot"];
    readonly upperBody: readonly ["spine", "spine1", "spine2", "neck", "head", "lclavicle", "lupperarm", "lforearm", "lhand", "rclavicle", "rupperarm", "rforearm", "rhand"];
    readonly spineChain: readonly ["spine", "spine1", "spine2", "neck", "head"];
    readonly rightArm: readonly ["rclavicle", "rupperarm", "rforearm", "rhand"];
    readonly leftArm: readonly ["lclavicle", "lupperarm", "lforearm", "lhand"];
};
type BoneMaskGroup = keyof typeof BONE_MASK_GROUPS;
/**
 * Gait blend intent from continuous speed (for multi-clip weighted trees).
 * Weights sum ≈ 1.
 */
declare function gaitBlendFromSpeed(speed01: number, sprinting: boolean, walkFrac?: number): {
    idle: number;
    walk: number;
    run: number;
    sprint: number;
};
/**
 * Recommended skillLocoRetain by skill category (mirrors assets SKILL_BLEND_PROFILES).
 * Prefer importing profiles from assets when available.
 */
declare const DEFAULT_SKILL_LOCO_RETAIN: {
    readonly melee_upper: 0.55;
    readonly melee_full: 0.12;
    readonly finisher: 0.08;
    readonly ranged: 0.1;
    readonly magic: 0.1;
    readonly mobility: 0.08;
    readonly block: 0.65;
    readonly parry: 0.15;
    readonly reaction: 0.05;
};
type SkillLocoRetainKey = keyof typeof DEFAULT_SKILL_LOCO_RETAIN;

/**
 * Directional locomotion helpers — 4/8-way intent for hosts + debug.
 * Pack-level maps live in @grudge-studio/assets (clipRoleForDirection).
 */

type MoveCardinal = "idle" | "forward" | "back" | "left" | "right" | "forward_left" | "forward_right" | "back_left" | "back_right";
/**
 * Convert planar move intent (x right, z forward) to 8-way slot.
 * Same convention as assets.directionalSlotFromXZ.
 */
declare function moveIntentToCardinal(x: number, z: number, deadzone?: number): MoveCardinal;
/** Speed 0–1 from move stick magnitude */
declare function speed01FromXZ(x: number, z: number, max?: number): number;
/**
 * Simple 4-clip directional blend weights (forward/back/left/right).
 * Diagonals split weight between two cardinals. Sum ≈ 1 when moving.
 */
declare function directionalCardinalWeights(x: number, z: number, deadzone?: number): {
    idle: number;
    forward: number;
    back: number;
    left: number;
    right: number;
};
/**
 * Combine directional cardinal weights with gait (walk/run/sprint) scale.
 * Host multiplies: walkForwardWeight = cardinal.forward * gait.walk * locoScale
 */
declare function directionalGaitPlan(x: number, z: number, sprinting: boolean, opts?: {
    deadzone?: number;
    walkFrac?: number;
}): {
    cardinal: ReturnType<typeof directionalCardinalWeights>;
    gait: ReturnType<typeof gaitBlendFromSpeed>;
    speed01: number;
    slot: MoveCardinal;
};
/** Debug string for HUD */
declare function formatDirectionalDebug(x: number, z: number, sprinting?: boolean): string;
/** Ease yaw toward move direction (radians) */
declare function yawTowardXZ(currentYaw: number, x: number, z: number, dt: number, turnSpeed?: number): number;

/**
 * LocomotionCore — gait + blended weapon skill overlays on the same mixer.
 *
 * Design:
 *   - Locomotion (idle/walk/run/sprint) is always the *base* layer
 *   - Weapon skills are upper-body / full-body one-shots with configurable
 *     blend weight so run does not fully stop during slash
 *   - Hit windows + weapon collider hooks are data, not UI
 *   - Skill end is driven by update() (no setTimeout drift)
 *
 * Duck-typed THREE.AnimationMixer (no hard three import).
 */

interface WeaponSkillDef {
    id: string;
    /** Display / hotbar */
    name?: string;
    /** Clip to play as overlay */
    clip: unknown;
    /** 0–1 upper-body weight while skill plays; rest stays loco */
    upperBodyWeight?: number;
    /** Fade in/out seconds */
    fadeIn?: number;
    fadeOut?: number;
    /** Hit window as fraction of clip duration [start, end] */
    hitWindow?: [number, number];
    /** Melee range metres */
    rangeM?: number;
    /** Enable hand weapon collider during hit window */
    weaponCollider?: boolean;
    /** Allow casting while moving (keep loco weights) */
    allowLocomotion?: boolean;
    /** Cooldown seconds */
    cooldownS?: number;
    /** Optional anim pack id for deploy graphs */
    animPack?: string;
}
interface LocomotionCoreOptions {
    fade?: number;
    /** Walk speed threshold as fraction of max (0–1). Below → walk, above → run */
    walkSpeedFrac?: number;
    /** When skill plays, multiply loco weight by this (0 = freeze loco) */
    skillLocoRetain?: number;
    /**
     * Use continuous multi-clip gait weights (idle∩walk∩run) instead of hard switch.
     * Default true for smoother combat locomotion.
     */
    continuousGait?: boolean;
}
type GaitId = "idle" | "walk" | "run" | "sprint";
interface SkillRuntimeState {
    skillId: string | null;
    busy: boolean;
    /** 0–1 through active skill */
    progress: number;
    inHitWindow: boolean;
    weaponColliderActive: boolean;
}
/**
 * Core that hosts own locomotion AND weapon skill blend.
 * Prefer this over bare AnimationDirector when shipping combat.
 */
declare class LocomotionCore {
    private mixer;
    private idle;
    private walk;
    private run;
    private sprint;
    private fade;
    private walkSpeedFrac;
    private skillLocoRetain;
    private continuousGait;
    private moving;
    private speed01;
    private sprinting;
    private overlay;
    private activeSkill;
    private skillElapsed;
    private skillDuration;
    private skillUpper;
    private skillFadeOut;
    private skillEnding;
    private cdUntil;
    private now;
    /** Last computed layer weights (debug / UI) */
    layerWeights: LayerWeights;
    readonly skillState: SkillRuntimeState;
    constructor(mixer: MixerLike, clips: LocoClips, opts?: LocomotionCoreOptions);
    /**
     * @param moving - any locomotion intent
     * @param speed01 - 0 idle … 1 full run (host maps WASD magnitude)
     * @param sprinting - hold sprint
     */
    setGaitTarget(moving: boolean, speed01?: number, sprinting?: boolean): void;
    /** Compatibility with AnimationDirector API (moving, sprinting) */
    setGaitMoving(moving: boolean, sprinting?: boolean): void;
    get busy(): boolean;
    get currentGait(): GaitId;
    /** Remaining cooldown for skill id (seconds), 0 if ready */
    cooldownRemaining(skillId: string): number;
    /**
     * Play weapon skill blended over locomotion core.
     * Returns false if on cooldown or blocked.
     */
    playWeaponSkill(skill: WeaponSkillDef): boolean;
    /** Force-cancel active skill overlay */
    cancelSkill(fadeOut?: number): void;
    /** @deprecated use playWeaponSkill */
    requestOneShot(clip: unknown, opts?: {
        fade?: number;
    }): boolean;
    private resolveGait;
    private clearSkillState;
    private endSkill;
    update(dt: number): void;
    dispose(): void;
}
/** Default hit window fractions when clip has no events */
declare const DEFAULT_MELEE_HIT_WINDOW: [number, number];
declare function makeMeleeSkill(id: string, clip: unknown, rangeM?: number, extra?: Partial<WeaponSkillDef>): WeaponSkillDef;
declare function makeRangedSkill(id: string, clip: unknown, rangeM?: number, extra?: Partial<WeaponSkillDef>): WeaponSkillDef;
declare function makeMagicSkill(id: string, clip: unknown, rangeM?: number, extra?: Partial<WeaponSkillDef>): WeaponSkillDef;

/**
 * Weapon skill → LocomotionCore bridge.
 * Uses pack skill data + blend profiles from @grudge-studio/assets when available;
 * pure factories work without loading packs.
 */

/** Duck-typed payload from assets.toWeaponSkillPayload (avoid hard cycle at typecheck) */
interface SkillAnimPayloadLike {
    id: string;
    name?: string;
    animPack?: string;
    upperBodyWeight: number;
    allowLocomotion: boolean;
    fadeIn: number;
    fadeOut: number;
    hitWindow: [number, number];
    rangeM: number;
    cooldownS: number;
    weaponCollider: boolean;
    locomotionSkill?: boolean;
    skillLocoRetain?: number;
    blendKind?: string;
}
/**
 * Build a LocomotionCore WeaponSkillDef from a resolved THREE clip + pack payload.
 */
declare function weaponSkillFromPayload(clip: unknown, payload: SkillAnimPayloadLike): WeaponSkillDef;
/** Quick factories by combat category */
declare function makeMobilitySkill(id: string, clip: unknown, extra?: Partial<WeaponSkillDef>): WeaponSkillDef;
declare function makeBlockSkill(id: string, clip: unknown, extra?: Partial<WeaponSkillDef>): WeaponSkillDef;
declare function makeParrySkill(id: string, clip: unknown, extra?: Partial<WeaponSkillDef>): WeaponSkillDef;
declare function makeReactionSkill(id: string, clip: unknown, extra?: Partial<WeaponSkillDef>): WeaponSkillDef;
declare function makeFinisherSkill(id: string, clip: unknown, rangeM?: number, extra?: Partial<WeaponSkillDef>): WeaponSkillDef;
/**
 * Layer weights while a skill runs — same math as LocomotionCore.
 * Hosts can preview without starting the skill.
 */
declare function previewSkillLayerWeights(skill: Pick<WeaponSkillDef, "upperBodyWeight" | "allowLocomotion">, skillLocoRetain?: number): LayerWeights;
/** Category → factory */
declare function makeSkillByCategory(category: "melee" | "ranged" | "magic" | "mobility" | "block" | "parry" | "reaction" | "finisher", id: string, clip: unknown, opts?: {
    rangeM?: number;
} & Partial<WeaponSkillDef>): WeaponSkillDef;

export { type ActionLike, AnimationDirector, type AnimationDirectorOptions, BONE_MASK_GROUPS, type BattleClipSlot, type BlendLayerId, type BoneMaskGroup, DEFAULT_BATTLE_CLIPS, DEFAULT_MELEE_HIT_WINDOW, DEFAULT_SKILL_LOCO_RETAIN, type GaitId, type LayerWeights, type LocoClips, LocomotionCore, type LocomotionCoreOptions, type MixerLike, type MoveCardinal, type SkillAnimPayloadLike, type SkillLocoRetainKey, type SkillRuntimeState, type WeaponSkillDef, battleClipUrls, clamp01, crossfadePlan, defaultLayerWeights, directionalCardinalWeights, directionalGaitPlan, formatDirectionalDebug, gaitBlendFromSpeed, lerp, makeBlockSkill, makeFinisherSkill, makeMagicSkill, makeMeleeSkill, makeMobilitySkill, makeParrySkill, makeRangedSkill, makeReactionSkill, makeSkillByCategory, moveIntentToCardinal, packRoleUrls, packSkillUrls, previewSkillLayerWeights, skillOnLocoWeights, smoothstep, speed01FromXZ, weaponSkillFromPayload, yawTowardXZ };
