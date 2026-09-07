/**
 * Mixamo-like 25-bone (no fingers) skeleton — Grudge Studio placement + retarget SSOT.
 * Used by Skeleton Studio for mouse placement, T-pose prep, and animation retarget.
 *
 * Two lanes (do not collapse):
 *   Author = Mixamo-25 extract / T-pose / place
 *   Play   = Toon RTS Bip001 22-core (Warlords race kits). Never Mixamo tracks on the play mixer.
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
  | "emote"
  | "mobility"
  | "reaction"
  | "stealth"
  | "traversal"
  | "adventure";

/** Showcase / Skeleton Studio family (left column). */
export type AnimFamily =
  | "gait"
  | "stealth"
  | "combat"
  | "mobility"
  | "traversal"
  | "reaction"
  | "adventure"
  | "utility";

export const ANIM_FAMILY_ORDER: AnimFamily[] = [
  "gait",
  "stealth",
  "combat",
  "mobility",
  "traversal",
  "reaction",
  "adventure",
  "utility",
];

export const ANIM_FAMILY_LABELS: Record<AnimFamily, string> = {
  gait: "Gait / 8-way",
  stealth: "Crouch / sneak",
  combat: "Combat",
  mobility: "Dodge / roll",
  traversal: "Climb / cover / wall",
  reaction: "Hit / knockback",
  adventure: "Action / interact",
  utility: "Other",
};

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
  { id: "idle", category: "idle", label: "Idle", clipPatterns: ["idle", "stand", "breath", "tpose", "t-pose", "rest", "wait"], weaponPacks: ["*"] },
  { id: "idleAim", category: "idle", label: "Aim idle", clipPatterns: ["idle.?aim", "aiming.?idle", "rifle-aiming-idle"], weaponPacks: ["rifle", "pistol", "longbow"] },
  { id: "idleCrouchAim", category: "stealth", label: "Crouch aim idle", clipPatterns: ["idle-crouching-aiming", "crouch.*aim.*idle"], weaponPacks: ["rifle", "pistol"] },
  { id: "idleCrouch", category: "stealth", label: "Crouch idle", clipPatterns: ["idle-crouching", "crouch.?idle", "kneeling-idle"], weaponPacks: ["*"] },
  { id: "walkCrouchFL", category: "stealth", label: "Crouch walk FL", clipPatterns: ["walk-crouching-fl", "crouch.*forward.?left"], weaponPacks: ["rifle"] },
  { id: "walkCrouchFR", category: "stealth", label: "Crouch walk FR", clipPatterns: ["walk-crouching-fr", "crouch.*forward.?right"], weaponPacks: ["rifle"] },
  { id: "walkCrouchBL", category: "stealth", label: "Crouch walk BL", clipPatterns: ["walk-crouching-bl", "crouch.*back.?left"], weaponPacks: ["rifle"] },
  { id: "walkCrouchBR", category: "stealth", label: "Crouch walk BR", clipPatterns: ["walk-crouching-br", "crouch.*back.?right"], weaponPacks: ["rifle"] },
  { id: "walkCrouchL", category: "stealth", label: "Crouch walk L", clipPatterns: ["walk-crouching-left", "crouch.*walk.*left"], weaponPacks: ["rifle"] },
  { id: "walkCrouchR", category: "stealth", label: "Crouch walk R", clipPatterns: ["walk-crouching-right", "crouch.*walk.*right"], weaponPacks: ["rifle"] },
  { id: "walkCrouchB", category: "stealth", label: "Crouch walk B", clipPatterns: ["walk-crouching-back", "crouch.*back"], weaponPacks: ["rifle"] },
  { id: "walkCrouch", category: "stealth", label: "Crouch walk", clipPatterns: ["walk-crouching", "crouch.?walk", "crouch_walk"], weaponPacks: ["*"] },
  { id: "sneakL", category: "stealth", label: "Sneak L", clipPatterns: ["sneak-left", "sneak.?l", "sneak.?left"], weaponPacks: ["rifle"] },
  { id: "sneakR", category: "stealth", label: "Sneak R", clipPatterns: ["sneak-right", "sneak.?r", "sneak.?right"], weaponPacks: ["rifle"] },
  { id: "sneak", category: "stealth", label: "Sneak", clipPatterns: ["sneak", "stealth.?walk"], weaponPacks: ["*"] },
  { id: "walkFL", category: "locomotion", label: "Walk FL", clipPatterns: ["walk-forward-left", "walk.?fl"], weaponPacks: ["*"] },
  { id: "walkFR", category: "locomotion", label: "Walk FR", clipPatterns: ["walk-forward-right", "walk.?fr"], weaponPacks: ["*"] },
  { id: "walkBL", category: "locomotion", label: "Walk BL", clipPatterns: ["walk-backward-left", "walk.?bl"], weaponPacks: ["*"] },
  { id: "walkBR", category: "locomotion", label: "Walk BR", clipPatterns: ["walk-backward-right", "walk.?br"], weaponPacks: ["*"] },
  { id: "walkB", category: "locomotion", label: "Walk back", clipPatterns: ["walking-backwards", "walk.?back", "walkb"], weaponPacks: ["*"] },
  { id: "walk", category: "locomotion", label: "Walk", clipPatterns: ["walk", "walking", "locomotion"], weaponPacks: ["*"] },
  { id: "walkL", category: "locomotion", label: "Strafe walk L", clipPatterns: ["walk.*left", "strafe.*walk.*left", "standing-walk-left", "strafe-left"], weaponPacks: ["*"] },
  { id: "walkR", category: "locomotion", label: "Strafe walk R", clipPatterns: ["walk.*right", "strafe.*walk.*right", "standing-walk-right", "strafe-right"], weaponPacks: ["*"] },
  { id: "runFL", category: "locomotion", label: "Run FL", clipPatterns: ["run-forward-left", "run.?fl"], weaponPacks: ["rifle", "locomotion_8way"] },
  { id: "runFR", category: "locomotion", label: "Run FR", clipPatterns: ["run-forward-right", "run.?fr"], weaponPacks: ["rifle", "locomotion_8way"] },
  { id: "runBL", category: "locomotion", label: "Run BL", clipPatterns: ["run-backward-left", "run.?bl"], weaponPacks: ["rifle", "locomotion_8way"] },
  { id: "runBR", category: "locomotion", label: "Run BR", clipPatterns: ["run-backward-right", "run.?br"], weaponPacks: ["rifle", "locomotion_8way"] },
  { id: "runB", category: "locomotion", label: "Run back", clipPatterns: ["run-backward", "run.?back", "runb"], weaponPacks: ["rifle"] },
  { id: "run", category: "locomotion", label: "Run", clipPatterns: ["run", "running", "sprint", "jog"], weaponPacks: ["*"] },
  { id: "runL", category: "locomotion", label: "Strafe run L", clipPatterns: ["run-left", "run.*left", "standing-run-left"], weaponPacks: ["*"] },
  { id: "runR", category: "locomotion", label: "Strafe run R", clipPatterns: ["run-right", "run.*right", "standing-run-right"], weaponPacks: ["*"] },
  { id: "strafe_l", category: "locomotion", label: "Strafe L", clipPatterns: ["strafe.*left", "left.*strafe", "strafe_l", "strafeleft"], weaponPacks: ["*"] },
  { id: "strafe_r", category: "locomotion", label: "Strafe R", clipPatterns: ["strafe.*right", "right.*strafe", "strafe_r", "straferight"], weaponPacks: ["*"] },
  { id: "jump", category: "locomotion", label: "Jump", clipPatterns: ["jump", "leap"], weaponPacks: ["*"] },
  { id: "fallLoop", category: "mobility", label: "Fall loop", clipPatterns: ["fall.?loop", "falling", "fallidle"], weaponPacks: ["*", "combat_mobility"] },
  { id: "fallLand", category: "mobility", label: "Fall land", clipPatterns: ["fall.?land", "landing", "land"], weaponPacks: ["*", "combat_mobility"] },
  { id: "fallRoll", category: "mobility", label: "Fall roll", clipPatterns: ["fall.?roll"], weaponPacks: ["*", "combat_mobility"] },
  // Specific melee before generic "attack"
  { id: "attack3", category: "combat_melee", label: "Attack 3", clipPatterns: ["attack.?3", "attack3", "combo.?3", "hit.?3", "ken_hit3"], weaponPacks: ["sword", "sword_shield", "greataxe", "greatsword", "samurai", "2h_melee"] },
  { id: "attack2", category: "combat_melee", label: "Attack 2", clipPatterns: ["attack.?2", "attack2", "combo.?2", "slash.?2", "ken_slash"], weaponPacks: ["sword", "sword_shield", "greataxe", "greatsword", "samurai", "2h_melee"] },
  { id: "attack1", category: "combat_melee", label: "Attack 1", clipPatterns: ["attack.?1", "attack1", "slash", "swing", "punch", "melee", "ken_strike", "sword.?attack"], weaponPacks: ["sword", "sword_shield", "greataxe", "greatsword", "samurai", "2h_melee"] },
  { id: "twoHandJumpAttack", category: "combat_melee", label: "Greatsword jump attack", clipPatterns: ["great-sword-jump", "greatsword.*jump"], weaponPacks: ["2h_melee", "greatsword"] },
  { id: "twoHandHeavy", category: "combat_melee", label: "Greatsword heavy", clipPatterns: ["zoro_heavy", "greatsword.*heavy", "twohand.*heavy"], weaponPacks: ["2h_melee", "greatsword"] },
  { id: "twoHandBlock", category: "combat_melee", label: "Greatsword block", clipPatterns: ["great-sword-blocking", "greatsword.*block"], weaponPacks: ["2h_melee", "greatsword"] },
  { id: "twoHandCast", category: "combat_melee", label: "Greatsword cast", clipPatterns: ["great-sword-casting"], weaponPacks: ["2h_melee", "greatsword"] },
  { id: "twoHandIdle", category: "idle", label: "2H idle", clipPatterns: ["bane_fight_idle", "twohand.?idle", "2hand.?idle"], weaponPacks: ["2h_melee", "greatsword"] },
  { id: "twoHandRun", category: "locomotion", label: "2H run", clipPatterns: ["twohand.?run", "2h_melee/run", "ken_run"], weaponPacks: ["2h_melee", "greatsword"] },
  { id: "twoHandAttack3", category: "combat_melee", label: "2H combo 3", clipPatterns: ["twohand.*3", "2h.*3", "twoHandAttack3"], weaponPacks: ["2h_melee", "greatsword", "greataxe"] },
  { id: "twoHandAttack2", category: "combat_melee", label: "2H combo 2", clipPatterns: ["twohand.*2", "2h.*2", "twoHandAttack2"], weaponPacks: ["2h_melee", "greatsword", "greataxe"] },
  { id: "twoHandAttack", category: "combat_melee", label: "2H combo 1", clipPatterns: ["twohand", "2h_melee", "twoHandAttack", "greatsword", "great-sword"], weaponPacks: ["2h_melee", "greatsword", "greataxe"] },
  { id: "crouchFire", category: "combat_ranged", label: "Crouch fire", clipPatterns: ["crouch.?fire", "crouch.?shoot"], weaponPacks: ["rifle", "pistol"] },
  { id: "reload", category: "combat_ranged", label: "Reload", clipPatterns: ["reload", "reloading"], weaponPacks: ["rifle", "pistol", "gun"] },
  { id: "daggerAttack3", category: "combat_melee", label: "Dagger 3", clipPatterns: ["dagger.?3", "dag3", "zoro_dag3"], weaponPacks: ["sword", "sword_shield"] },
  { id: "daggerAttack2", category: "combat_melee", label: "Dagger 2", clipPatterns: ["dagger.?2", "dag2", "zoro_dag2"], weaponPacks: ["sword", "sword_shield"] },
  { id: "daggerAttack", category: "combat_melee", label: "Dagger 1", clipPatterns: ["dagger", "dag1", "zoro_dag"], weaponPacks: ["sword", "sword_shield"] },
  { id: "finisher", category: "combat_melee", label: "Finisher", clipPatterns: ["finisher", "jump.?dash", "lunge"], weaponPacks: ["sword_shield", "2h_melee", "polearm"] },
  { id: "block", category: "combat_melee", label: "Block", clipPatterns: ["block", "guard", "shield"], weaponPacks: ["sword_shield"] },
  { id: "parry", category: "combat_melee", label: "Parry", clipPatterns: ["parry"], weaponPacks: ["sword_shield", "combat_mobility"] },
  { id: "shoot", category: "combat_ranged", label: "Shoot", clipPatterns: ["firing-rifle", "shoot", "fire", "aim", "recoil", "bow", "arrow", "gun", "shot"], weaponPacks: ["bow", "crossbow", "gun", "rifle", "longbow", "pistol"] },
  { id: "draw", category: "combat_ranged", label: "Draw", clipPatterns: ["rifle-draw", "drawing-gun", "draw"], weaponPacks: ["rifle", "pistol"] },
  { id: "gunplay", category: "combat_ranged", label: "Gunplay", clipPatterns: ["gunplay", "pistol.?spin"], weaponPacks: ["pistol"] },
  { id: "shoulderThrow", category: "combat_melee", label: "Shoulder throw", clipPatterns: ["shoulder-throw", "rifle-shoulder-throw"], weaponPacks: ["rifle"] },
  { id: "kick", category: "combat_melee", label: "Kick", clipPatterns: ["kick", "kicking"], weaponPacks: ["unarmed"] },
  { id: "hurricane", category: "combat_melee", label: "Hurricane kick", clipPatterns: ["hurricane"], weaponPacks: ["unarmed"] },
  { id: "stomp", category: "combat_melee", label: "Stomp", clipPatterns: ["stomp"], weaponPacks: ["unarmed"] },
  { id: "uppercut", category: "combat_melee", label: "Uppercut", clipPatterns: ["uppercut"], weaponPacks: ["unarmed"] },
  { id: "special", category: "combat_melee", label: "Special", clipPatterns: ["special", "verigo"], weaponPacks: ["*"] },
  { id: "cast", category: "magic", label: "Cast", clipPatterns: ["cast", "spell", "magic", "channel", "staff"], weaponPacks: ["fire_staff", "dark_staff", "focus", "magic"] },
  { id: "skill", category: "combat_melee", label: "Skill", clipPatterns: ["skill", "special", "ability"], weaponPacks: ["*"] },
  { id: "skill1", category: "combat_melee", label: "Skill 1", clipPatterns: ["skill.?1", "skill1"], weaponPacks: ["*"] },
  { id: "skill2", category: "combat_melee", label: "Skill 2", clipPatterns: ["skill.?2", "skill2"], weaponPacks: ["*"] },
  { id: "skill3", category: "combat_melee", label: "Skill 3", clipPatterns: ["skill.?3", "skill3"], weaponPacks: ["*"] },
  { id: "hitReact", category: "reaction", label: "Take-hit", clipPatterns: ["hitreact", "hit_react", "damage", "flinch", "op_hit"], weaponPacks: ["*", "reactions"] },
  { id: "hit", category: "hit", label: "Hit / Hurt", clipPatterns: ["hit", "hurt", "react", "impact"], weaponPacks: ["*"] },
  { id: "knockedUp", category: "reaction", label: "Knockback", clipPatterns: ["knock", "blown", "knockback", "op_knock"], weaponPacks: ["*", "reactions"] },
  { id: "blownAway", category: "reaction", label: "Launch", clipPatterns: ["blown.?away", "op_blown", "launch"], weaponPacks: ["*", "reactions"] },
  { id: "stun", category: "reaction", label: "Stun", clipPatterns: ["stun", "freeze"], weaponPacks: ["*", "reactions"] },
  { id: "getup", category: "reaction", label: "Get up", clipPatterns: ["get.?up", "standup", "op_getup"], weaponPacks: ["*", "reactions"] },
  { id: "death", category: "death", label: "Death", clipPatterns: ["death", "die", "dead", "ko"], weaponPacks: ["*"] },
  { id: "dodgeL", category: "mobility", label: "Dodge L", clipPatterns: ["dodge.?l", "dodge.?left", "dodgel"], weaponPacks: ["*", "combat_mobility"] },
  { id: "dodgeR", category: "mobility", label: "Dodge R", clipPatterns: ["dodge.?r", "dodge.?right", "dodger"], weaponPacks: ["*", "combat_mobility"] },
  { id: "dodgeF", category: "mobility", label: "Dodge F", clipPatterns: ["dodge.?f", "dodge.?forward", "dodgef"], weaponPacks: ["*", "combat_mobility"] },
  { id: "dodgeB", category: "mobility", label: "Dodge B", clipPatterns: ["dodge.?b", "dodge.?back", "dodgeb"], weaponPacks: ["*", "combat_mobility"] },
  { id: "rollL", category: "mobility", label: "Roll L", clipPatterns: ["roll.?l", "roll.?left", "rolll"], weaponPacks: ["*", "combat_mobility"] },
  { id: "rollR", category: "mobility", label: "Roll R", clipPatterns: ["roll.?r", "roll.?right", "rollr"], weaponPacks: ["*", "combat_mobility"] },
  { id: "rollF", category: "mobility", label: "Roll F", clipPatterns: ["roll.?f", "roll.?forward", "roll_forward"], weaponPacks: ["*", "combat_mobility"] },
  { id: "rollB", category: "mobility", label: "Roll B", clipPatterns: ["roll.?b", "roll.?back", "roll_back"], weaponPacks: ["*", "combat_mobility"] },
  { id: "airDashL", category: "mobility", label: "Air dash L", clipPatterns: ["airdash_l", "air.?dash.?l"], weaponPacks: ["combat_mobility"] },
  { id: "airDashR", category: "mobility", label: "Air dash R", clipPatterns: ["airdash_r", "air.?dash.?r"], weaponPacks: ["combat_mobility"] },
  { id: "airDashB", category: "mobility", label: "Air dash B", clipPatterns: ["airdash_b", "air.?dash.?b"], weaponPacks: ["combat_mobility"] },
  { id: "airDash", category: "mobility", label: "Dash", clipPatterns: ["airdash", "dash", "air.?dash", "op_dash"], weaponPacks: ["*", "combat_mobility"] },
  { id: "slide", category: "mobility", label: "Slide", clipPatterns: ["slide"], weaponPacks: ["*", "combat_mobility"] },
  { id: "frontflip", category: "mobility", label: "Frontflip", clipPatterns: ["front.?flip", "front-twist"], weaponPacks: ["combat_mobility"] },
  { id: "backflip", category: "mobility", label: "Backflip", clipPatterns: ["back.?flip"], weaponPacks: ["combat_mobility", "unarmed"] },
  { id: "leap", category: "mobility", label: "Leap", clipPatterns: ["leap"], weaponPacks: ["combat_mobility"] },
  { id: "mantle", category: "traversal", label: "Mantle", clipPatterns: ["mantle", "vault", "top.?out"], weaponPacks: ["*", "combat_mobility"] },
  { id: "climb", category: "traversal", label: "Climb", clipPatterns: ["climb", "climbing"], weaponPacks: ["*"] },
  { id: "hang", category: "traversal", label: "Hang", clipPatterns: ["hang", "hanging", "freehang"], weaponPacks: ["*"] },
  { id: "wallRunL", category: "traversal", label: "Wall run L", clipPatterns: ["wall.?run.?l", "wallrun.?left"], weaponPacks: ["*"] },
  { id: "wallRunR", category: "traversal", label: "Wall run R", clipPatterns: ["wall.?run.?r", "wallrun.?right"], weaponPacks: ["*"] },
  { id: "wallRun", category: "traversal", label: "Wall run", clipPatterns: ["wall.?run", "wallrun"], weaponPacks: ["*"] },
  { id: "wallHugL", category: "traversal", label: "Wall hug L", clipPatterns: ["wall.?hug.?l", "wall.?hold.?l"], weaponPacks: ["*"] },
  { id: "wallHugR", category: "traversal", label: "Wall hug R", clipPatterns: ["wall.?hug.?r", "wall.?hold.?r"], weaponPacks: ["*"] },
  { id: "wallHug", category: "traversal", label: "Wall hug", clipPatterns: ["wall.?hug", "wall.?hold", "braced.?hang"], weaponPacks: ["*"] },
  { id: "coverPeekL", category: "traversal", label: "Cover peek L", clipPatterns: ["cover.?peek.?l", "peek.?left"], weaponPacks: ["*"] },
  { id: "coverPeekR", category: "traversal", label: "Cover peek R", clipPatterns: ["cover.?peek.?r", "peek.?right"], weaponPacks: ["*"] },
  { id: "coverWalkL", category: "traversal", label: "Cover walk L", clipPatterns: ["cover.?walk.?l"], weaponPacks: ["*"] },
  { id: "coverWalkR", category: "traversal", label: "Cover walk R", clipPatterns: ["cover.?walk.?r"], weaponPacks: ["*"] },
  { id: "coverEnter", category: "traversal", label: "To cover", clipPatterns: ["to.?cover", "cover.?enter"], weaponPacks: ["*"] },
  { id: "coverExit", category: "traversal", label: "Leave cover", clipPatterns: ["cover.?to.?stand", "cover.?exit"], weaponPacks: ["*"] },
  { id: "coverIdle", category: "traversal", label: "Cover idle", clipPatterns: ["cover.?idle", "in.?cover"], weaponPacks: ["*"] },
  { id: "swim", category: "traversal", label: "Swim", clipPatterns: ["swim"], weaponPacks: ["*"] },
  { id: "tread", category: "traversal", label: "Tread water", clipPatterns: ["tread"], weaponPacks: ["*"] },
  { id: "grapple", category: "traversal", label: "Grapple / rope", clipPatterns: ["grapple", "rope_up", "rope_idle"], weaponPacks: ["combat_mobility"] },
  { id: "zipline", category: "traversal", label: "Zipline", clipPatterns: ["zipline"], weaponPacks: ["combat_mobility"] },
  { id: "ride", category: "traversal", label: "Ride / skate", clipPatterns: ["ride", "skate"], weaponPacks: ["combat_mobility"] },
  { id: "interact", category: "adventure", label: "Interact", clipPatterns: ["interact", "use", "city_action"], weaponPacks: ["*"] },
  { id: "pickup", category: "adventure", label: "Pick up", clipPatterns: ["pickup", "pick.?up", "take_001"], weaponPacks: ["*"] },
  { id: "sit", category: "adventure", label: "Sit", clipPatterns: ["sit"], weaponPacks: ["*"] },
  { id: "taunt", category: "adventure", label: "Taunt", clipPatterns: ["taunt"], weaponPacks: ["*"] },
  { id: "harvest", category: "adventure", label: "Harvest", clipPatterns: ["harvest", "chop", "gather", "plant"], weaponPacks: ["*"] },
  { id: "throw", category: "adventure", label: "Throw", clipPatterns: ["throw", "grenade"], weaponPacks: ["*"] },
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
  "pistol",
  "polearm",
  "2h_melee",
  "fire_staff",
  "dark_staff",
  "focus",
  "magic",
  "unarmed",
  "locomotion_8way",
  "combat_mobility",
  "reactions",
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
  /** Author placement target. Play export also stamps playSkeleton. */
  skeleton: "mixamo-25" | "bip001";
  /** Mixamo-25 / FBX author lane */
  authorSkeleton?: "mixamo-25";
  /** Warlords race play lane — Toon Bip001 22-core */
  playSkeleton?: "bip001";
  sourceFile: string;
  placements: BonePlacement[];
  /** source bone name → Mixamo25 target */
  boneMap: Record<string, Mixamo25Bone>;
  /** Mixamo25 → source (optional, filled by auto-map) */
  reverseMap?: Partial<Record<Mixamo25Bone, string>>;
  autoMap?: AutoBoneMapResult | null;
  /** Left-column role → clip name (Showcase bind) */
  roleBinds?: Record<string, string>;
  packId?: string;
  createdAt: string;
  updatedAt?: string;
}

export function emptyMapping(sourceFile: string): SkeletonMappingDoc {
  return {
    version: MIXAMO_25_VERSION,
    skeleton: "mixamo-25",
    authorSkeleton: "mixamo-25",
    playSkeleton: "bip001",
    sourceFile,
    placements: [],
    boneMap: {},
    reverseMap: {},
    autoMap: null,
    roleBinds: {},
    packId: "sword_shield",
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
    authorSkeleton: doc.authorSkeleton ?? "mixamo-25",
    playSkeleton: doc.playSkeleton ?? "bip001",
    updatedAt: new Date().toISOString(),
  };
}

/* ── Play skeleton (Warlords Toon Bip001) ──────────────────────────────── */

/** Spaced Bip001 names — same contract as Casting `bip001-play-bones.json`. */
export const BIP001_PLAY_CORE = [
  "Bip001 Pelvis",
  "Bip001 Spine",
  "Bip001 Spine1",
  "Bip001 Spine2",
  "Bip001 Neck",
  "Bip001 Head",
  "Bip001 L Clavicle",
  "Bip001 L UpperArm",
  "Bip001 L Forearm",
  "Bip001 L Hand",
  "Bip001 R Clavicle",
  "Bip001 R UpperArm",
  "Bip001 R Forearm",
  "Bip001 R Hand",
  "Bip001 L Thigh",
  "Bip001 L Calf",
  "Bip001 L Foot",
  "Bip001 L Toe0",
  "Bip001 R Thigh",
  "Bip001 R Calf",
  "Bip001 R Foot",
  "Bip001 R Toe0",
] as const;

export type Bip001PlayBone = (typeof BIP001_PLAY_CORE)[number];

/** Mixamo-25 core → Toon Bip001 play bone. Hip ROTATION kept; hip POSITION stripped at bind. */
export const MIXAMO_CORE_TO_BIP001: Partial<Record<Mixamo25Bone, Bip001PlayBone>> = {
  Hips: "Bip001 Pelvis",
  Spine: "Bip001 Spine",
  Spine1: "Bip001 Spine1",
  Spine2: "Bip001 Spine2",
  Neck: "Bip001 Neck",
  Head: "Bip001 Head",
  LeftShoulder: "Bip001 L Clavicle",
  LeftArm: "Bip001 L UpperArm",
  LeftForeArm: "Bip001 L Forearm",
  LeftHand: "Bip001 L Hand",
  RightShoulder: "Bip001 R Clavicle",
  RightArm: "Bip001 R UpperArm",
  RightForeArm: "Bip001 R Forearm",
  RightHand: "Bip001 R Hand",
  LeftUpLeg: "Bip001 L Thigh",
  LeftLeg: "Bip001 L Calf",
  LeftFoot: "Bip001 L Foot",
  LeftToeBase: "Bip001 L Toe0",
  RightUpLeg: "Bip001 R Thigh",
  RightLeg: "Bip001 R Calf",
  RightFoot: "Bip001 R Foot",
  RightToeBase: "Bip001 R Toe0",
};

export const BIP001_PLAY_LAW =
  "Play skeleton is Toon Bip001 spaced names. Clips must use these spellings. Hip ROTATION kept; hip POSITION stripped. No Prop1, no Bip001 root, no Xtra, no Mixamo on the play mixer.";

/** Warlords weapon + overlay packs (Casting ANIM_PACKS ids). */
export const WARLORDS_PACK_IDS = [
  "magic",
  "sword_shield",
  "longbow",
  "pistol",
  "rifle",
  "polearm",
  "2h_melee",
  "unarmed",
  "locomotion_8way",
  "combat_mobility",
  "reactions",
] as const;

export type WarlordsPackId = (typeof WARLORDS_PACK_IDS)[number];

export const WARLORDS_PACK_META: Record<
  string,
  { label: string; skills: string }
> = {
  magic: { label: "Magic / staff", skills: "cast · skill" },
  sword_shield: { label: "Sword & shield", skills: "combo×3 · dagger · block" },
  longbow: { label: "Longbow", skills: "shot · dodge" },
  pistol: { label: "Pistol", skills: "gunplay · draw" },
  rifle: { label: "Rifle", skills: "fire · 8-way · crouch · sneak" },
  polearm: { label: "Spear / polearm", skills: "combo · lunge" },
  "2h_melee": { label: "Greatsword / 2H", skills: "2H combo · jump · heavy · block" },
  unarmed: { label: "Unarmed", skills: "kick · uppercut · stomp" },
  locomotion_8way: { label: "8-way loco overlay", skills: "walk/run octants" },
  combat_mobility: { label: "Rolls / dodges / slide", skills: "dodge · roll · dash · mantle" },
  reactions: { label: "Hit / knockback", skills: "hit · knock · getup" },
};

/**
 * Left-column roles (Showcase bind). Family order is ANIM_FAMILY_ORDER.
 * Do not invent parallel role names — extend this table.
 */
export const ANIM_ROLE_META: Record<
  string,
  { family: AnimFamily; label: string; input?: string }
> = {
  idle: { family: "gait", label: "Idle" },
  walk: { family: "gait", label: "Walk" },
  walkB: { family: "gait", label: "Walk back", input: "S" },
  walkL: { family: "gait", label: "Strafe walk left", input: "Focus · A" },
  walkR: { family: "gait", label: "Strafe walk right", input: "Focus · D" },
  walkFL: { family: "gait", label: "Walk forward-left" },
  walkFR: { family: "gait", label: "Walk forward-right" },
  walkBL: { family: "gait", label: "Walk back-left" },
  walkBR: { family: "gait", label: "Walk back-right" },
  run: { family: "gait", label: "Run / sprint" },
  runB: { family: "gait", label: "Run back", input: "S + Shift" },
  runL: { family: "gait", label: "Strafe run left", input: "Focus · A + Shift" },
  runR: { family: "gait", label: "Strafe run right", input: "Focus · D + Shift" },
  runFL: { family: "gait", label: "Run forward-left" },
  runFR: { family: "gait", label: "Run forward-right" },
  runBL: { family: "gait", label: "Run back-left" },
  runBR: { family: "gait", label: "Run back-right" },
  jump: { family: "gait", label: "Jump", input: "Space" },
  fall: { family: "gait", label: "Falling body" },
  fallLoop: { family: "gait", label: "Fall loop" },
  fallIdle: { family: "gait", label: "Fall idle" },
  fallLand: { family: "mobility", label: "Fall → landing" },
  fallRoll: { family: "mobility", label: "Fall → roll out" },

  idleAim: { family: "stealth", label: "Aim idle", input: "RMB ADS" },
  idleCrouch: { family: "stealth", label: "Crouch idle", input: "Z" },
  idleCrouchAim: { family: "stealth", label: "Crouch aim idle", input: "Z + RMB" },
  walkCrouch: { family: "stealth", label: "Crouch walk", input: "Z + WASD" },
  walkCrouchB: { family: "stealth", label: "Crouch walk back" },
  walkCrouchL: { family: "stealth", label: "Crouch walk left" },
  walkCrouchR: { family: "stealth", label: "Crouch walk right" },
  walkCrouchFL: { family: "stealth", label: "Crouch walk FL" },
  walkCrouchFR: { family: "stealth", label: "Crouch walk FR" },
  walkCrouchBL: { family: "stealth", label: "Crouch walk BL" },
  walkCrouchBR: { family: "stealth", label: "Crouch walk BR" },
  sneak: { family: "stealth", label: "Sneak" },
  sneakF: { family: "stealth", label: "Sneak forward" },
  sneakB: { family: "stealth", label: "Sneak back" },
  sneakL: { family: "stealth", label: "Sneak left" },
  sneakR: { family: "stealth", label: "Sneak right" },
  crouchFire: { family: "stealth", label: "Crouch fire", input: "Z + LMB" },
  kneelEnter: { family: "stealth", label: "Kneel enter" },
  kneelIdle: { family: "stealth", label: "Kneel idle" },
  kneelExit: { family: "stealth", label: "Kneel stand" },

  attack1: { family: "combat", label: "Melee combo 1", input: "LMB 1" },
  attack2: { family: "combat", label: "Melee combo 2", input: "LMB 2" },
  attack3: { family: "combat", label: "Melee combo 3", input: "LMB 3" },
  twoHandIdle: { family: "combat", label: "Greatsword idle" },
  twoHandRun: { family: "combat", label: "Greatsword run" },
  twoHandAttack: { family: "combat", label: "Greatsword 1", input: "LMB · 2H" },
  twoHandAttack2: { family: "combat", label: "Greatsword 2" },
  twoHandAttack3: { family: "combat", label: "Greatsword 3" },
  twoHandHeavy: { family: "combat", label: "Greatsword heavy" },
  twoHandJumpAttack: { family: "combat", label: "Greatsword jump attack" },
  twoHandBlock: { family: "combat", label: "Greatsword block" },
  twoHandCast: { family: "combat", label: "Greatsword cast" },
  daggerAttack: { family: "combat", label: "Dagger 1", input: "LMB · dagger" },
  daggerAttack2: { family: "combat", label: "Dagger 2" },
  daggerAttack3: { family: "combat", label: "Dagger 3" },
  attack: { family: "combat", label: "Attack / rifle fire", input: "LMB" },
  finisher: { family: "combat", label: "Finisher" },
  finisherAir: { family: "combat", label: "Air finisher" },
  block: { family: "combat", label: "Block", input: "E" },
  parry: { family: "combat", label: "Parry", input: "C" },
  cast: { family: "combat", label: "Cast", input: "1–4 / staff" },
  shoot: { family: "combat", label: "Shoot" },
  reload: { family: "combat", label: "Reload" },
  draw: { family: "combat", label: "Draw weapon" },
  gunplay: { family: "combat", label: "Gunplay / spin" },
  spin: { family: "combat", label: "Spin" },
  skill: { family: "combat", label: "Skill" },
  skill1: { family: "combat", label: "Skill 1" },
  skill2: { family: "combat", label: "Skill 2" },
  skill3: { family: "combat", label: "Skill 3" },
  skill4: { family: "combat", label: "Skill 4" },
  special: { family: "combat", label: "Special" },
  kick: { family: "combat", label: "Kick" },
  hurricane: { family: "combat", label: "Hurricane kick" },
  stomp: { family: "combat", label: "Stomp" },
  uppercut: { family: "combat", label: "Uppercut" },
  shoulderThrow: { family: "combat", label: "Shoulder throw" },
  shoulderThrowAir: { family: "combat", label: "Air throw" },

  dodgeL: { family: "mobility", label: "Dodge left", input: "AA" },
  dodgeR: { family: "mobility", label: "Dodge right", input: "DD" },
  dodgeF: { family: "mobility", label: "Dodge forward", input: "WW" },
  dodgeB: { family: "mobility", label: "Dodge back", input: "X" },
  dodge: { family: "mobility", label: "Dodge" },
  rollL: { family: "mobility", label: "Roll left", input: "Ctrl+A" },
  rollR: { family: "mobility", label: "Roll right", input: "Ctrl+D" },
  rollF: { family: "mobility", label: "Roll forward", input: "Ctrl+W" },
  rollB: { family: "mobility", label: "Roll back", input: "Ctrl+S" },
  slide: { family: "mobility", label: "Sprint slide", input: "Shift+Ctrl" },
  airDash: { family: "mobility", label: "Dash" },
  airDashL: { family: "mobility", label: "Air dash left" },
  airDashR: { family: "mobility", label: "Air dash right" },
  airDashB: { family: "mobility", label: "Air dash back" },
  frontflip: { family: "mobility", label: "Frontflip" },
  backflip: { family: "mobility", label: "Backflip" },
  leap: { family: "mobility", label: "Leap" },

  climb: { family: "traversal", label: "Climb" },
  climbUp: { family: "traversal", label: "Climb up" },
  climbDown: { family: "traversal", label: "Climb down" },
  hang: { family: "traversal", label: "Hang / grab" },
  hangIdle: { family: "traversal", label: "Hanging idle" },
  mantle: { family: "traversal", label: "Mantle / vault" },
  wallRun: { family: "traversal", label: "Wall run" },
  wallRunL: { family: "traversal", label: "Wall run left" },
  wallRunR: { family: "traversal", label: "Wall run right" },
  wallHug: { family: "traversal", label: "Wall hug" },
  wallHugL: { family: "traversal", label: "Wall hug left" },
  wallHugR: { family: "traversal", label: "Wall hug right" },
  wallHugWalkL: { family: "traversal", label: "Wall hug walk L" },
  wallHugWalkR: { family: "traversal", label: "Wall hug walk R" },
  coverIdle: { family: "traversal", label: "Cover idle" },
  coverEnter: { family: "traversal", label: "To cover" },
  coverExit: { family: "traversal", label: "Leave cover" },
  coverWalkL: { family: "traversal", label: "Cover walk left" },
  coverWalkR: { family: "traversal", label: "Cover walk right" },
  coverPeekL: { family: "traversal", label: "Cover peek left" },
  coverPeekR: { family: "traversal", label: "Cover peek right" },
  swim: { family: "traversal", label: "Swim" },
  tread: { family: "traversal", label: "Tread water" },
  grapple: { family: "traversal", label: "Grapple / rope" },
  zipline: { family: "traversal", label: "Zipline" },
  ride: { family: "traversal", label: "Ride / skate" },

  hitReact: { family: "reaction", label: "Take-hit" },
  hit: { family: "reaction", label: "Hit / Hurt" },
  knockedUp: { family: "reaction", label: "Knockback" },
  blownAway: { family: "reaction", label: "Launch" },
  stun: { family: "reaction", label: "Stun" },
  getup: { family: "reaction", label: "Get up" },

  interact: { family: "adventure", label: "Interact" },
  pickup: { family: "adventure", label: "Pick up" },
  push: { family: "adventure", label: "Push" },
  pull: { family: "adventure", label: "Pull" },
  throw: { family: "adventure", label: "Throw" },
  sit: { family: "adventure", label: "Sit" },
  sitDown: { family: "adventure", label: "Sit down" },
  taunt: { family: "adventure", label: "Taunt" },
  emote: { family: "adventure", label: "Emote" },
  harvest: { family: "adventure", label: "Harvest" },
  drink: { family: "adventure", label: "Drink / use" },

  death: { family: "utility", label: "Death" },
};

export const ANIM_PACK_HYDRATE_URLS = [
  "https://casting.grudge.studio/api/v1/anim-packs.json",
  "https://assets.grudge-studio.com/prod/anims/_manifest/anim-packs.json",
  "https://info.grudge-studio.com/api/v1/anim-packs.json",
  "https://objectstore.grudge-studio.com/api/v1/anim-packs.json",
] as const;

export type AnimPacksCatalog = {
  url: string;
  packs: Record<string, Record<string, string | string[]>>;
  meta?: Record<string, unknown>;
};

/** Overlay ANIM_PACKS from Cloudflare defs JSON (clips stay R2; not Railway / D1 rows). */
export async function fetchAnimPacksCatalog(): Promise<AnimPacksCatalog | null> {
  const seen = new Set<string>();
  for (const url of ANIM_PACK_HYDRATE_URLS) {
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const doc = (await r.json()) as {
        packs?: Record<string, Record<string, string | string[]>>;
        meta?: Record<string, unknown>;
      };
      if (!doc?.packs || typeof doc.packs !== "object") continue;
      return { url, packs: doc.packs, meta: doc.meta };
    } catch {
      /* next */
    }
  }
  return null;
}

export function detectRigFamily(boneNames: string[]): "mixamo" | "biped" | "bandai" | "unknown" {
  for (const n of boneNames) {
    if (/^mixamorig/i.test(n) || /^(Hips|LeftArm|RightUpLeg)$/i.test(n)) return "mixamo";
    if (
      /^Body[ _]/i.test(n) ||
      /^(LArm_|RArm_|LLeg_|RLeg_|LHand_|RHand_|Head_Neck|Head_Face)/i.test(n)
    ) {
      return "bandai";
    }
    if (/^Bip001/i.test(n) || /^Bip01(?!\d)/i.test(n)) return "biped";
  }
  return "unknown";
}

/**
 * SkeletonUtils names map for play: { [Bip001 bone]: sourceBone }.
 * Source is the author joint (Mixamo / Bandai / Biped).
 */
export function buildBip001PlayNamesMap(
  reverseMap: Partial<Record<Mixamo25Bone, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const core of MIXAMO_25_CORE) {
    const src = reverseMap[core];
    const bip = MIXAMO_CORE_TO_BIP001[core];
    if (src && bip) out[bip] = src;
  }
  return out;
}

export function familyForRole(role: string): AnimFamily {
  return ANIM_ROLE_META[role]?.family ?? "utility";
}

export function listStudioRoles(packRoles?: string[]): Array<{
  role: string;
  label: string;
  family: AnimFamily;
  input: string;
}> {
  const seen = new Set<string>();
  const rows: Array<{ role: string; label: string; family: AnimFamily; input: string }> = [];
  const push = (role: string) => {
    if (!role || seen.has(role)) return;
    seen.add(role);
    const meta = ANIM_ROLE_META[role];
    rows.push({
      role,
      label: meta?.label || role,
      family: meta?.family || "utility",
      input: meta?.input || "",
    });
  };
  for (const fam of ANIM_FAMILY_ORDER) {
    for (const [role, meta] of Object.entries(ANIM_ROLE_META)) {
      if (meta.family === fam) push(role);
    }
  }
  for (const r of packRoles ?? []) push(r);
  return rows;
}
