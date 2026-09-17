/** Race kit FBX on CDN (SSOT for modular characters). */
declare const GRUDGE6_RACE_FBX: Record<string, string>;
declare const GRUDGE6_RACE_ATLAS: Record<string, string>;
declare function grudge6RaceUrl(raceId: string): string;
declare function grudge6AtlasUrl(raceId: string): string;
type AnimPackId = "sword_shield" | "magic" | "longbow" | "unarmed" | "rifle" | "pistol" | "crossbow" | "2h_melee" | "samurai" | "mace_1h" | "axe_1h" | "dash" | "reactions" | "block";
declare function weaponToAnimPack(weapon: string): AnimPackId;

/** Stylized nature packs — NEVER place whole multi-mesh GLB; isolate meshName. */
declare const STYLIZED_NATURE: {
    readonly vegetation: "models/nature/stylized/biome/nature_vegetation.glb";
    readonly trees: "models/nature/stylized/biome/realistic_trees.glb";
    readonly tropical: "models/nature/stylized/biome/tropical_plants.glb";
    readonly volcanic: "models/nature/stylized/biome/volcanicnature.glb";
    readonly snow: "models/nature/stylized/biome/snowbiomes.glb";
    readonly rocks: "models/nature/stylized/rocks/stylised_rocks.glb";
    readonly volcanicRocks: "models/nature/stylized/rocks/volcanic_rocks.glb";
    readonly cliff: "models/nature/stylized/cliffs/stylized_cliff_face.glb";
    readonly flowers: "models/nature/stylized/harvest/flowers_pack.glb";
    readonly foliage: "models/nature/stylized/harvest/foliage_pack.glb";
    readonly minerals: "models/nature/stylized/harvest/minerals_pack.glb";
    readonly oreNodes: "models/nature/stylized/harvest/ore_nodes.glb";
};
declare function natureUrl(key: keyof typeof STYLIZED_NATURE): string;
declare const STYLIZED_VARIANTS: {
    readonly rocks: readonly ["Plain_Rock1", "Plain_Rock2", "Plain_Rock3", "Plain_Rock5", "Plain_Rock8"];
    readonly oreNodes: readonly ["Iron_Node", "Copper_Node", "Coal_Node", "Tin_Node"];
};

/**
 * Baked Bip001 clips — prefer SAME-ORIGIN /anims/baked in games.
 * Fallback order: same-origin → assets CDN → arena (legacy live JSON host).
 * Do not treat HTML 404 pages as JSON.
 *
 * Pack ids SSOT: sword_shield (not 1h_sword_shield). See GrudgeBuilder shared/fleet/animPacks.ts
 */
declare const BAKED_ANIM_ARENA = "https://grudge-arena.grudge-studio.com/api/assets/anims/baked";
declare function bakedAnimUrl(rel: string, sameOrigin?: boolean): string;
/** Try same-origin → assets → arena until loader succeeds. */
declare function bakedAnimUrlCandidates(rel: string): string[];
/** Legacy pack id → canonical (fleet SSOT). */
declare function normalizeAnimPackId(id: string | null | undefined): string;
declare const LOCO_BAKED: {
    readonly idle: "locomotion/idle";
    readonly walk: "locomotion/walking";
    readonly run: "locomotion/running";
    readonly jump: "locomotion/jump";
    readonly warcry: "locomotion/standing taunt battlecry";
};

/**
 * Animation source roots — provenance for bake, debug, and fleet loaders.
 *
 * Policy:
 *   - Flare OPB / KayKit GLBs = **animation harvest only** (no hero/character product).
 *   - Production heroes stay grudge6 Bip001 kits.
 *   - Adio OPB GLB = pistol / crossbow / gunfight clip source.
 *   - Unity Mixamo FBX = knockback, block, get-up, dash, weapon packs → Bip001 bake.
 */
type AnimPipelineId = "unity_mixamo_to_bip001" | "raidriar_bmf_to_bip001" | "opb_clips_only" | "kaykit_clips_only" | "baked_bip001";
type SkeletonRuntime = "bip001" | "mixamo" | "b_mf" | "opb" | "kaykit" | "unknown";
interface AnimSourceRoot {
    id: string;
    label: string;
    pipeline: AnimPipelineId;
    skeleton: SkeletonRuntime;
    /** Absolute or machine-local path (dev/debug only) */
    localPath?: string;
    pathHint: string;
    output: "fbx" | "glb_embedded" | "baked_json" | "glb_library";
    /** If true: extract AnimationClips only — do not ship mesh as hero */
    clipsOnly: boolean;
    notes: string;
}
/** Canonical roots discovered on the studio machine / fleet */
declare const ANIM_SOURCE_ROOTS: readonly AnimSourceRoot[];
/** Adio clip name suffixes (pl_adio_orig01_*) */
declare const ADIO_CLIP_SUFFIX: {
    readonly idle: readonly ["_idle_a", "_idlehome_a"];
    readonly run: readonly ["_run"];
    readonly attack: readonly ["_combo_a", "_combo_b", "_combo_c"];
    readonly skill: readonly ["_skill_a", "_skill_b"];
    readonly dodge: readonly ["_dodge"];
    readonly jump: readonly ["_jump"];
    readonly jumpLp: readonly ["_jump_lp"];
    readonly land: readonly ["_jump_end"];
    readonly damage: readonly ["_damage"];
    readonly down: readonly ["_down"];
    readonly getup: readonly ["_down_end"];
    readonly blownback: readonly ["_blownback_lp"];
    readonly blownbackEnd: readonly ["_blownback_end"];
    readonly slam: readonly ["_slammed"];
    readonly stun: readonly ["_stun"];
    readonly boost: readonly ["_boost"];
    readonly shock: readonly ["_electric_shock"];
};
/** Full Adio clip names from GLB inventory (2026) */
declare const ADIO_CLIPS: readonly ["pl_adio_orig01_idle_a", "pl_adio_orig01_skill_a", "pl_adio_orig01_skill_b", "pl_adio_orig01_flagget", "pl_adio_orig01_boost", "pl_adio_orig01_dodge", "pl_adio_orig01_jump", "pl_adio_orig01_jump_lp", "pl_adio_orig01_jump_end", "pl_adio_orig01_damage", "pl_adio_orig01_flagget_lp", "pl_adio_orig01_flagget_end", "pl_adio_orig01_down", "pl_adio_orig01_down_end", "pl_adio_orig01_slammed", "pl_adio_orig01_opening", "pl_adio_orig01_victory", "pl_adio_orig01_lose", "pl_adio_orig01_stun", "pl_adio_orig01_idlehome_a", "pl_adio_orig01_blownback_lp", "pl_adio_orig01_blownback_end", "pl_adio_orig01_electric_shock", "pl_adio_orig01_shake", "pl_adio_orig01_run", "pl_adio_orig01_combo_a", "pl_adio_orig01_combo_b", "pl_adio_orig01_combo_c", "pl_adio_orig01_victory_lp", "pl_adio_orig01_lose_lp"];
declare const ADIO_WEAPON_JOINTS: readonly ["r_weapon_joint_049", "l_weapon_joint_042", "r_hand_weapon_01", "r_hand_weapon_02", "l_hand_weapon_01", "l_hand_weapon_02"];
declare function getAnimSource(id: string): AnimSourceRoot | undefined;
declare function sourcesByPipeline(pipeline: AnimPipelineId): AnimSourceRoot[];
/** Only sources marked clipsOnly (should be all Flare/OPB/KayKit harvest) */
declare function clipHarvestSources(): AnimSourceRoot[];
declare const UNITY_MIXAMO_FOLDERS: readonly ["block", "bow", "climb", "combo", "extra", "farming", "gestures", "greataxe", "greatsword", "knife", "mace", "magic", "magic-loco", "pistol", "reactions", "rifle", "spear", "striker", "swim", "sword"];
type UnityMixamoFolder = (typeof UNITY_MIXAMO_FOLDERS)[number];
/**
 * Raidriar Action Stash clips (Sketchfab export names are opaque).
 * Role labels are **provisional** for pack wiring — re-label after studio preview.
 */
declare const RAIDRIAR_GLB = "D:/Games/Models/raidriar_the_god_king_-_infinity_blade.glb";
declare const RAIDRIAR_CLIPS: readonly ["[Action Stash]", "[Action Stash].001", "[Action Stash].002", "[Action Stash].003", "[Action Stash].004", "[Action Stash].005", "[Action Stash].006", "[Action Stash].007", "[Action Stash].008", "[Action Stash].009"];
/** Provisional role map — confirm in Forge / lab viewer */
declare const RAIDRIAR_ROLE_MAP: {
    /** Often base / combat idle */
    readonly idle: "[Action Stash]";
    readonly attack1: "[Action Stash].001";
    readonly attack2: "[Action Stash].002";
    readonly attack3: "[Action Stash].003";
    readonly skill_a: "[Action Stash].004";
    readonly skill_b: "[Action Stash].005";
    /** Heavy / slam style — good 1H mace */
    readonly attack_heavy: "[Action Stash].006";
    readonly hit: "[Action Stash].007";
    /** Finisher / spin — good 1H axe */
    readonly skill_finisher: "[Action Stash].008";
    readonly death: "[Action Stash].009";
};
declare const RAIDRIAR_WEAPON_BONES: readonly ["b_MF_Weapon_R_29", "b_MF_Hand_R_30", "b_MF_Weapon_L_17", "b_MF_Hand_L_18"];

/**
 * Anim pack registry — slots, directional keys, skills, skeleton, bake status.
 *
 * Policy: Flare/OPB/KayKit contribute **clips only** (no hero product).
 * Adio GLB = pistol / crossbow / gunfight. Unity = blocks, knockbacks, get-ups.
 */

/** Locomotion / combat / reaction clip roles */
type ClipRole = "idle" | "walk" | "run" | "sprint" | "walk_back" | "walk_left" | "walk_right" | "run_back" | "run_left" | "run_right" | "strafe_left" | "strafe_right" | "jump" | "jump_loop" | "land" | "dash" | "dodge_f" | "dodge_b" | "dodge_l" | "dodge_r" | "attack1" | "attack2" | "attack3" | "skill_a" | "skill_b" | "block" | "block_idle" | "block_react" | "parry" | "hit" | "stun" | "knockback" | "flyback" | "flyback_loop" | "flyback_end" | "down" | "getup" | "slam" | "death" | "cast" | "aim" | "fire" | "reload" | "warcry" | "draw" | "sheath" | "boost";
type DirectionalSlot = "idle" | "forward" | "back" | "left" | "right" | "forward_left" | "forward_right" | "back_left" | "back_right";
type BakeStatus = "production_baked" | "needs_bake" | "native_embedded" | "library_shared" | "partial" | "clip_harvest";
interface ClipCandidate {
    key: string;
    sourceFolder?: string;
    /** glb path for embedded harvest */
    sourceGlb?: string;
    priority?: number;
}
interface SkillClipDef {
    skillId: string;
    name: string;
    role: ClipRole;
    candidates: ClipCandidate[];
    blendOnLocomotion: boolean;
    upperBodyWeight?: number;
    hitWindow?: [number, number];
    rangeM?: number;
    cooldownS?: number;
    locomotionSkill?: boolean;
    /** Reaction / CC — full body, interrupts loco */
    reaction?: boolean;
}
interface AnimPackDef {
    id: string;
    label: string;
    skeleton: SkeletonRuntime;
    sourceRootId: string;
    bakeStatus: BakeStatus;
    clips: Partial<Record<ClipRole, ClipCandidate[]>>;
    directional?: Partial<Record<DirectionalSlot, ClipRole>>;
    skills: SkillClipDef[];
    tags: string[];
    /** Never use pack meshes as fleet heroes */
    clipsOnly?: boolean;
    notes?: string;
}
declare const DEFAULT_DIRECTIONAL: Record<DirectionalSlot, ClipRole>;
/** Production grudge6 sword + shield (baked Bip001) */
declare const PACK_SWORD_SHIELD: AnimPackDef;
/**
 * Shared reactions — knockbacks, fly-backs, get-ups, stun, slam.
 * Unity reactions/ + Adio blownback/down (clips only).
 */
declare const PACK_REACTIONS: AnimPackDef;
/** Blocks & parries — Unity block/ */
declare const PACK_BLOCK: AnimPackDef;
/**
 * Pistol / gunfight — Adio OPB clips (primary) + Unity pistol FBX (bake to Bip001).
 * Clips only from Adio GLB — not Adio as fleet hero.
 */
declare const PACK_PISTOL: AnimPackDef;
/**
 * Crossbow / xbow — Adio gunfight cadence + bow aim/fire language.
 * Same clip harvest policy (no OPB hero mesh).
 */
declare const PACK_CROSSBOW: AnimPackDef;
/** Dash / evade */
declare const PACK_DASH: AnimPackDef;
/** Samurai / 2H — Unity only, no OPB heroes */
declare const PACK_SAMURAI: AnimPackDef;
declare const PACK_LONGBOW: AnimPackDef;
declare const PACK_MAGIC: AnimPackDef;
/**
 * 1H Mace — Raidriar Infinity Blade retarget (primary) + Unity hell-slammer.
 * Pipeline: extract clips → B_MF_TO_BIP001 → strip hip-Y → bake.
 */
declare const PACK_MACE_1H: AnimPackDef;
/**
 * 1H Axe — Raidriar retarget (primary) + Unity greataxe combo (1H use).
 * Same source GLB; different skill cadence / range bias.
 */
declare const PACK_AXE_1H: AnimPackDef;
/**
 * OPB clip scheme reference (suffix map) — harvest from any OPB GLB including Adio.
 * Not a hero skin pack.
 */
declare const PACK_OPB_CLIPS: AnimPackDef;
/** KayKit library clips only — not KayKit heroes */
declare const PACK_KAYKIT_CLIPS: AnimPackDef;
/** @deprecated use PACK_OPB_CLIPS / PACK_PISTOL — was wrongly framed as skins/heroes */
declare const PACK_OPB_NATIVE: AnimPackDef;
/** @deprecated use PACK_KAYKIT_CLIPS */
declare const PACK_KAYKIT: AnimPackDef;
declare const ANIM_PACKS: readonly AnimPackDef[];
declare function getAnimPack(id: string | null | undefined): AnimPackDef;
/** Raidriar clip inventory for debug tools */
declare function raidriarClipInventory(): string[];
declare function listAnimPackIds(): string[];
declare function packsNeedingBake(): AnimPackDef[];
/** Packs that are clip harvest only (no hero mesh product) */
declare function packsClipsOnly(): AnimPackDef[];
declare function resolveClipCandidates(packId: string, role: ClipRole): ClipCandidate[];
/** Merge reaction pack into any combat pack for host state machines */
declare function withSharedReactions(packId: string): Partial<Record<ClipRole, ClipCandidate[]>>;
declare function directionalSlotFromXZ(x: number, z: number, deadzone?: number): DirectionalSlot;
declare function clipRoleForDirection(packId: string, slot: DirectionalSlot): ClipRole;
declare function bakeJobsForPack(packId: string): Array<{
    packId: string;
    skillOrRole: string;
    inputRel: string;
    outputKey: string;
    rotationOnly: boolean;
}>;
/** Adio inventory export for debug tools */
declare function adioClipInventory(): readonly string[];

/**
 * Weapon skill animation + blend SSOT.
 * Pack skills (animPacks) + blend profiles → hosts build LocomotionCore WeaponSkillDef.
 */

/** How the skill layers onto locomotion */
type SkillBlendKind = "melee_upper" | "melee_full" | "ranged" | "magic" | "mobility" | "block" | "parry" | "reaction" | "finisher";
/**
 * Full blend profile for a weapon skill.
 * Maps 1:1 to LocomotionCore.playWeaponSkill options (+ skillLocoRetain for host).
 */
interface SkillBlendProfile {
    kind: SkillBlendKind;
    /** 0–1 skill action weight */
    upperBodyWeight: number;
    /** Keep gait under skill */
    allowLocomotion: boolean;
    /** Loco retain multiplier while skill plays (LocomotionCore skillLocoRetain) */
    skillLocoRetain: number;
    fadeIn: number;
    fadeOut: number;
    hitWindow: [number, number];
    weaponCollider: boolean;
    /** Full-body dash/roll */
    locomotionSkill?: boolean;
    /** CC / hit react — interrupts combat */
    reaction?: boolean;
    /** Optional bone mask hint for hosts */
    boneMask?: "upperBody" | "full" | "rightArm" | "lowerBody";
    /** Recommended continuous gait under skill */
    continuousGait?: boolean;
}
/** Canonical blend presets — do not invent per-game numbers */
declare const SKILL_BLEND_PROFILES: Record<SkillBlendKind, SkillBlendProfile>;
/** Infer blend kind from skill flags / role when not set */
declare function inferSkillBlendKind(skill: SkillClipDef): SkillBlendKind;
/** Resolve profile: explicit skill fields override preset */
declare function resolveSkillBlendProfile(skill: SkillClipDef, kind?: SkillBlendKind): SkillBlendProfile;
/** Flattened weapon skill anim entry for catalogs / hotbar / deploy */
interface WeaponSkillAnimEntry {
    skillId: string;
    name: string;
    animPack: string;
    role: ClipRole;
    candidates: ClipCandidate[];
    blend: SkillBlendProfile;
    rangeM: number;
    cooldownS: number;
    /** Hotbar slot hint 1–4 */
    slotHint?: number;
}
/** Collect all skills from a pack with resolved blends */
declare function weaponSkillsForPack(packId: string): WeaponSkillAnimEntry[];
/** All weapon skill anims across registered packs */
declare function listAllWeaponSkillAnims(): WeaponSkillAnimEntry[];
/** Skills for combat kit: weapon pack + shared reactions + block + dash */
declare function combatSkillKit(weaponPackId: string): WeaponSkillAnimEntry[];
/**
 * Data payload hosts pass into LocomotionCore (clip resolved separately).
 * Does not include the THREE clip object.
 */
interface WeaponSkillAnimPayload {
    id: string;
    name?: string;
    animPack: string;
    upperBodyWeight: number;
    allowLocomotion: boolean;
    fadeIn: number;
    fadeOut: number;
    hitWindow: [number, number];
    rangeM: number;
    cooldownS: number;
    weaponCollider: boolean;
    locomotionSkill?: boolean;
    reaction?: boolean;
    blendKind: SkillBlendKind;
    skillLocoRetain: number;
    boneMask?: SkillBlendProfile["boneMask"];
    /** First candidate key for loaders */
    preferredClipKey: string;
    candidates: ClipCandidate[];
}
declare function toWeaponSkillPayload(entry: WeaponSkillAnimEntry): WeaponSkillAnimPayload;
/** Human-readable blend practice line for docs / debug */
declare function describeSkillBlend(entry: WeaponSkillAnimEntry): string;
declare function formatWeaponSkillAnimCatalog(packId?: string): string;

/**
 * Animation asset debug — inventory reports, missing slots, blend recommendations.
 * Hosts print these to HUD / console during development.
 */

interface PackDebugLine {
    packId: string;
    label: string;
    skeleton: SkeletonRuntime;
    bakeStatus: BakeStatus;
    sourceRootId: string;
    clipRoles: ClipRole[];
    skillCount: number;
    hasDirectional: boolean;
    okForProduction: boolean;
    warnings: string[];
}
interface AnimSystemDebugReport {
    generatedAt: string;
    sources: Array<{
        id: string;
        pipeline: string;
        skeleton: string;
        pathHint: string;
    }>;
    packs: PackDebugLine[];
    needsBake: string[];
    weaponSkillCount: number;
    weaponSkillsByPack: Record<string, number>;
    practices: string[];
}
/** Full system report for /debug UI or CI */
declare function buildAnimSystemDebugReport(): AnimSystemDebugReport;
/** Compact console-friendly string */
declare function formatAnimDebugReport(report?: AnimSystemDebugReport): string;
/** Pack skill + blend dump for HUD */
declare function formatPackSkillDebug(packId: string): string;
/** Runtime snapshot: which clips loaded for a pack */
interface LoadedClipDebug {
    packId: string;
    role: string;
    requestedKeys: string[];
    resolvedKey: string | null;
    duration?: number;
    trackCount?: number;
}
declare function missingRoles(packId: string, loadedRoles: Iterable<string>): ClipRole[];
/**
 * Blend practice recommendation for a skill on current gait.
 * Hosts log this when debugging “why did loco freeze”.
 */
declare function blendPracticeHint(opts: {
    skillId: string;
    blendOnLocomotion: boolean;
    upperBodyWeight?: number;
    locomotionSkill?: boolean;
    moving: boolean;
}): string;
/** Directional debug: human-readable move vector → slot → role */
declare function directionalDebugLine(packId: string, x: number, z: number, slotFn: (x: number, z: number) => string, roleFn: (packId: string, slot: string) => string): string;
/** Layer weight snapshot for HUD */
declare function formatLayerWeights(w: {
    locomotion: number;
    upper_body: number;
    full_body_skill: number;
    additive?: number;
}): string;

/**
 * Debug, directional, blending, and weapon-skill practices — agent + host SSOT.
 */
declare const ANIM_DEBUG_PRACTICES: {
    /** Always log pack + skeleton + bakeStatus on character spawn */
    readonly logPackOnSpawn: true;
    /** Prefer buildAnimSystemDebugReport() in /debug overlay */
    readonly systemReport: "buildAnimSystemDebugReport | formatAnimDebugReport";
    /** Per-frame optional (dev only): layer weights + skill progress */
    readonly frameHud: "formatLayerWeights(loco.layerWeights) + skillState";
    /** On skill fire: blendPracticeHint(...) */
    readonly onSkill: "blendPracticeHint";
    /** Never silent-fail missing clips — list missingRoles() */
    readonly missingClips: "missingRoles(packId, loaded)";
    /** Catalog hotbar skills + blends */
    readonly skillCatalog: "formatWeaponSkillAnimCatalog(packId?) | describeSkillBlend";
};
declare const ANIM_DIRECTIONAL_PRACTICES: {
    /** Map stick/WASD to xz then directionalSlotFromXZ */
    readonly input: "directionalSlotFromXZ(x, z) → clipRoleForDirection(pack, slot)";
    /** Prefer continuous gaitBlendFromSpeed when only forward speed */
    readonly forwardOnly: "gaitBlendFromSpeed(speed01, sprinting) on idle/walk/run/sprint";
    /** When pack has 4/8-way clips (longbow), use directional roles */
    readonly eightWay: "walk_left/right/back + run_* from pack.clips";
    /** Strafe: do not mirror left onto right without checking root facing */
    readonly noBlindMirror: true;
    readonly deadzone: 0.12;
};
declare const ANIM_BLEND_PRACTICES: {
    /** Base layer always locomotion */
    readonly baseLayer: "locomotion";
    /** Use SKILL_BLEND_PROFILES — do not invent retain numbers */
    readonly profiles: "SKILL_BLEND_PROFILES / resolveSkillBlendProfile";
    /** Light melee while moving */
    readonly melee_upper: "upper 0.95, allowLocomotion true, skillLocoRetain 0.55";
    /** Heavy / plant */
    readonly melee_full: "upper 1, allowLocomotion false, retain ~0.12";
    /** Dash/roll/slide */
    readonly mobility: "locomotionSkill, full body, fadeIn 0.05";
    /** Block hold can walk */
    readonly block: "upper 0.85, retain 0.65";
    /** Reactions interrupt everything */
    readonly reaction: "full body freeze, reaction: true";
    /** Runtime weights */
    readonly weaponOnLoco: "skillOnLocoWeights / previewSkillLayerWeights";
    readonly fadeInS: 0.08;
    readonly fadeOutS: 0.12;
    readonly hitWindowDefault: [number, number];
    readonly continuousGait: true;
    readonly boneMasks: "BONE_MASK_GROUPS in @grudge-studio/animator";
    readonly docs: "packages/assets/docs/WEAPON_SKILL_BLENDS.md";
};
declare const ANIM_WEAPON_SKILL_PRACTICES: {
    /** Kit = weapon pack + reactions + block + dash */
    readonly kit: "combatSkillKit(weaponPackId)";
    /** Payload → LocomotionCore */
    readonly play: "toWeaponSkillPayload → weaponSkillFromPayload(clip, payload) → playWeaponSkill";
    /** Collider only in hit window */
    readonly collider: "skillState.inHitWindow && skillState.weaponColliderActive";
    /** State machine */
    readonly state: "applyLocoSnapshot + combat states knockback/flyback/getup/block/parry";
    /** Pack skill fields */
    readonly skillDef: "SkillClipDef: candidates, blendOnLocomotion, hitWindow, rangeM, cooldownS";
    /** Factories */
    readonly factories: "makeMeleeSkill | makeRangedSkill | makeMobilitySkill | makeBlockSkill | makeReactionSkill | makeFinisherSkill";
};
declare const ANIM_PIPELINE_PRACTICES: {
    readonly bip001Production: "Mixamo/Unity FBX → MIXAMO_TO_BIP001 → strip hip position → baked JSON";
    /** Flare / OPB / KayKit = clips only — never ship as fleet heroes */
    readonly clipsOnlyFromFlare: true;
    readonly noFlareHeroes: "Do not use Flare skins or KayKit heroes as playable characters";
    readonly opb: "Harvest AnimationClips from OPB GLBs (prefer Adio for pistol). Suffix scheme.";
    readonly adioPistol: "D:/Games/Models/one_piece_bounty_rush_adio.glb → pistol + crossbow packs";
    readonly raidriarMaceAxe: "D:/Games/Models/raidriar_the_god_king_-_infinity_blade.glb → B_MF_TO_BIP001 → mace_1h + axe_1h";
    readonly kaykit: "Harvest anim/*.glb libraries only — ignore heroes/";
    readonly reactions: "Unity reactions/ + Adio blownback/down/getup → PACK_REACTIONS";
    readonly blocks: "Unity block/ → PACK_BLOCK";
    readonly kill: "unretargeted_mixamorig_on_bip001";
    readonly sameOriginFirst: true;
};
/** Checklist for PR / QA */
declare function animQualityChecklist(): string[];

declare function fetchObjectStoreJson<T = unknown>(file: string, init?: RequestInit): Promise<T>;
declare const OBJECTSTORE_KEYS: readonly ["weapons", "equipment", "materials", "races", "armor", "grudge6-gear-presets", "race-models.v1"];

/** Hard rules for agents and games consuming Grudge assets. */
declare const ASSET_BEST_PRACTICES: {
    readonly banMeshy: true;
    readonly banPermanentCapsules: true;
    readonly isolateMultiMeshPacks: true;
    readonly preferSameOriginBakedAnims: true;
    readonly magicByteCheckGlb: true;
    readonly cdnSsot: "https://assets.grudge-studio.com";
    readonly objectStoreSsot: "https://objectstore.grudge-studio.com/api/v1";
    readonly grudge6Equip: "child-mesh visibility on Bip001 kit, not model swap";
    readonly forgeDeployApp: "https://forge.grudge-studio.com";
    /** Quality SSOT monorepo */
    readonly npmQualitySystem: "@grudge-studio/sdk + character/units/bake/deploy";
    /** Uniformed motion: strip hip/root .position on grounded kits */
    readonly rotationOnlyGroundedAnims: true;
    /** Ground from skinned Box3 min.y — never pelvis.y */
    readonly groundFromBodyBoxMinY: true;
    readonly characterDeployPackage: "@grudge-studio/character";
    readonly unitsNpcPackage: "@grudge-studio/units";
    readonly bakePackage: "@grudge-studio/bake";
    readonly deployPackage: "@grudge-studio/deploy";
    /** Anim asset management */
    readonly animPackRegistry: "getAnimPack / ANIM_PACKS / animSources";
    readonly animDebug: "buildAnimSystemDebugReport / formatAnimDebugReport";
    readonly mixamoToBip001Only: true;
    readonly noCrossSkeletonWithoutAdapter: true;
    /** Never promote Flare skins / KayKit heroes to fleet characters */
    readonly flareClipsOnly: true;
    readonly adioPistolSource: "D:/Games/Models/one_piece_bounty_rush_adio.glb";
    readonly raidriarMaceAxeSource: "D:/Games/Models/raidriar_the_god_king_-_infinity_blade.glb";
    readonly raidriarRetarget: "B_MF_TO_BIP001 / retargetRaidriarClipToBip001";
    readonly directional: "directionalSlotFromXZ + clipRoleForDirection";
    readonly blend: "LocomotionCore + skillOnLocoWeights + SKILL_BLEND_PROFILES";
    readonly weaponSkills: "combatSkillKit → toWeaponSkillPayload → weaponSkillFromPayload";
    readonly weaponSkillDocs: "packages/assets/docs/WEAPON_SKILL_BLENDS.md";
    readonly sharedReactions: "withSharedReactions(packId) + PACK_REACTIONS + combatSkillKit";
};

export { ADIO_CLIPS, ADIO_CLIP_SUFFIX, ADIO_WEAPON_JOINTS, ANIM_BLEND_PRACTICES, ANIM_DEBUG_PRACTICES, ANIM_DIRECTIONAL_PRACTICES, ANIM_PACKS, ANIM_PIPELINE_PRACTICES, ANIM_SOURCE_ROOTS, ANIM_WEAPON_SKILL_PRACTICES, ASSET_BEST_PRACTICES, type AnimPackDef, type AnimPackId, type AnimPipelineId, type AnimSourceRoot, type AnimSystemDebugReport, BAKED_ANIM_ARENA, type BakeStatus, type ClipCandidate, type ClipRole, DEFAULT_DIRECTIONAL, type DirectionalSlot, GRUDGE6_RACE_ATLAS, GRUDGE6_RACE_FBX, LOCO_BAKED, type LoadedClipDebug, OBJECTSTORE_KEYS, PACK_AXE_1H, PACK_BLOCK, PACK_CROSSBOW, PACK_DASH, PACK_KAYKIT, PACK_KAYKIT_CLIPS, PACK_LONGBOW, PACK_MACE_1H, PACK_MAGIC, PACK_OPB_CLIPS, PACK_OPB_NATIVE, PACK_PISTOL, PACK_REACTIONS, PACK_SAMURAI, PACK_SWORD_SHIELD, type PackDebugLine, RAIDRIAR_CLIPS, RAIDRIAR_GLB, RAIDRIAR_ROLE_MAP, RAIDRIAR_WEAPON_BONES, SKILL_BLEND_PROFILES, STYLIZED_NATURE, STYLIZED_VARIANTS, type SkeletonRuntime, type SkillBlendKind, type SkillBlendProfile, type SkillClipDef, UNITY_MIXAMO_FOLDERS, type UnityMixamoFolder, type WeaponSkillAnimEntry, type WeaponSkillAnimPayload, adioClipInventory, animQualityChecklist, bakeJobsForPack, bakedAnimUrl, bakedAnimUrlCandidates, blendPracticeHint, buildAnimSystemDebugReport, clipHarvestSources, clipRoleForDirection, combatSkillKit, describeSkillBlend, directionalDebugLine, directionalSlotFromXZ, fetchObjectStoreJson, formatAnimDebugReport, formatLayerWeights, formatPackSkillDebug, formatWeaponSkillAnimCatalog, getAnimPack, getAnimSource, grudge6AtlasUrl, grudge6RaceUrl, inferSkillBlendKind, listAllWeaponSkillAnims, listAnimPackIds, missingRoles, natureUrl, normalizeAnimPackId, packsClipsOnly, packsNeedingBake, raidriarClipInventory, resolveClipCandidates, resolveSkillBlendProfile, sourcesByPipeline, toWeaponSkillPayload, weaponSkillsForPack, weaponToAnimPack, withSharedReactions };
