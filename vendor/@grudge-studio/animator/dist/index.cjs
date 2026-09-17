'use strict';

var assets = require('@grudge-studio/assets');

// src/director.ts
var LOOP_REPEAT = 2201;
var LOOP_ONCE = 2200;
var AnimationDirector = class {
  constructor(mixer, clips, opts = {}) {
    this.moving = false;
    this.sprinting = false;
    this.overlay = null;
    this.busy = false;
    this.mixer = mixer;
    this.fade = opts.fade ?? 0.12;
    this.walkSpeedFrac = opts.walkSpeedFrac ?? 0.45;
    this.busyLocoWeight = opts.busyLocoWeight ?? 0.45;
    this.idle = mixer.clipAction(clips.idle);
    this.walk = mixer.clipAction(clips.walk);
    this.run = mixer.clipAction(clips.run);
    this.sprint = mixer.clipAction(clips.sprint ?? clips.run);
    for (const a of [this.idle, this.walk, this.run, this.sprint]) {
      a.setLoop(LOOP_REPEAT, Infinity);
      a.setEffectiveWeight(0);
      a.play();
    }
    this.idle.setEffectiveWeight(1);
  }
  /**
   * @param moving - any locomotion intent
   * @param sprinting - sprint hold
   * @param speed01 - optional 0–1 speed for walk vs run (omit → run when moving)
   */
  setGaitTarget(moving, sprinting = false, speed01) {
    this.moving = moving;
    this.sprinting = sprinting && moving;
    this.speed01 = speed01;
  }
  requestOneShot(clip, opts = {}) {
    if (this.busy && !opts.blend) return false;
    const fade = opts.fade ?? 0.1;
    if (this.overlay) {
      try {
        this.overlay.fadeOut(fade);
      } catch {
      }
    }
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(LOOP_ONCE, 1);
    action.clampWhenFinished = false;
    action.fadeIn(fade).play();
    this.overlay = action;
    this.busy = true;
    const dur = Math.max(0.2, action.getClip().duration || 0.6);
    setTimeout(() => {
      this.busy = false;
      try {
        action.fadeOut(0.12);
      } catch {
      }
    }, dur * 1e3);
    return true;
  }
  update(dt) {
    let target = "idle";
    if (this.moving) {
      if (this.sprinting) target = "sprint";
      else if (this.speed01 !== void 0 && this.speed01 < this.walkSpeedFrac) {
        target = "walk";
      } else target = "run";
    }
    const map = {
      idle: this.idle,
      walk: this.walk,
      run: this.run,
      sprint: this.sprint
    };
    const want = map[target] ?? this.idle;
    const locoW = this.busy ? this.busyLocoWeight : 1;
    for (const a of [this.idle, this.walk, this.run, this.sprint]) {
      if (a === want) a.setEffectiveWeight(locoW);
      else a.setEffectiveWeight(0);
    }
    this.mixer.update(dt);
  }
  dispose() {
    for (const a of [this.idle, this.walk, this.run, this.sprint]) {
      try {
        a.stop();
      } catch {
      }
    }
    this.overlay = null;
    this.busy = false;
  }
};
var DEFAULT_BATTLE_CLIPS = {
  idle: [assets.LOCO_BAKED.idle, "sword_shield/sword and shield idle"],
  walk: [assets.LOCO_BAKED.walk],
  run: [assets.LOCO_BAKED.run, "sword_shield/sword and shield run"],
  attack1: ["sword_shield/sword and shield attack", "sword_shield/sword and shield slash"],
  attack2: ["sword_shield/sword and shield attack (2)", "sword_shield/sword and shield slash 1"],
  jump: [assets.LOCO_BAKED.jump, "locomotion/jumping up"],
  jumpAttack: ["sword_shield/sword and shield attack (4)"],
  cast: ["sword_shield/sword and shield casting", "magic/spell casting"],
  hit: ["magic/Standing React Small From Front", "locomotion/reacting"],
  death: ["sword_shield/sword and shield death"],
  warcry: [assets.LOCO_BAKED.warcry, "sword_shield/sword and shield power up"]
};
function battleClipUrls(slot, sameOrigin = true) {
  return (DEFAULT_BATTLE_CLIPS[slot] ?? []).map((rel) => assets.bakedAnimUrl(rel, sameOrigin));
}
function packRoleUrls(packId, role, sameOrigin = true) {
  const pack = assets.getAnimPack(packId);
  const cands = pack.clips[role] ?? [];
  const keys = cands.map((c) => c.key).filter((k) => !k.endsWith(".fbx") && !k.startsWith("_"));
  if (keys.length === 0 && role in DEFAULT_BATTLE_CLIPS) {
    return battleClipUrls(role, sameOrigin);
  }
  return keys.map((rel) => assets.bakedAnimUrl(rel, sameOrigin));
}
function packSkillUrls(packId, skillId, sameOrigin = true) {
  const pack = assets.getAnimPack(assets.normalizeAnimPackId(packId));
  const skill = pack.skills.find((s) => s.skillId === skillId);
  if (!skill) return [];
  return skill.candidates.map((c) => c.key).filter((k) => !k.endsWith(".fbx") && !k.startsWith("_")).map((rel) => assets.bakedAnimUrl(rel, sameOrigin));
}

// src/blend.ts
function defaultLayerWeights() {
  return {
    locomotion: 1,
    upper_body: 0,
    full_body_skill: 0,
    additive: 0
  };
}
function skillOnLocoWeights(opts) {
  const skillW = clamp01(opts.skillWeight ?? 1);
  const retain = opts.skillLocoRetain ?? 0.55;
  const allow = opts.allowLocomotion !== false;
  return {
    locomotion: allow ? retain * (1 - skillW * 0.5) : 0.12 * (1 - skillW),
    upper_body: skillW,
    full_body_skill: allow ? 0 : skillW,
    additive: 0
  };
}
function smoothstep(t) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}
function lerp(a, b, t) {
  return a + (b - a) * clamp01(t);
}
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
function crossfadePlan(elapsedS, fadeS) {
  if (fadeS <= 0) return { fromWeight: 0, toWeight: 1, done: true };
  const t = clamp01(elapsedS / fadeS);
  const e = smoothstep(t);
  return { fromWeight: 1 - e, toWeight: e, done: t >= 1 };
}
var BONE_MASK_GROUPS = {
  /** Legs + hips — keep under locomotion when skill is upper-body */
  lowerBody: [
    "pelvis",
    "lthigh",
    "lcalf",
    "lfoot",
    "rthigh",
    "rcalf",
    "rfoot"
  ],
  upperBody: [
    "spine",
    "spine1",
    "spine2",
    "neck",
    "head",
    "lclavicle",
    "lupperarm",
    "lforearm",
    "lhand",
    "rclavicle",
    "rupperarm",
    "rforearm",
    "rhand"
  ],
  spineChain: ["spine", "spine1", "spine2", "neck", "head"],
  rightArm: ["rclavicle", "rupperarm", "rforearm", "rhand"],
  leftArm: ["lclavicle", "lupperarm", "lforearm", "lhand"]
};
function gaitBlendFromSpeed(speed01, sprinting, walkFrac = 0.45) {
  const s = clamp01(speed01);
  if (s < 0.05) {
    return { idle: 1, walk: 0, run: 0, sprint: 0 };
  }
  if (sprinting) {
    const t2 = smoothstep((s - 0.5) / 0.5);
    return { idle: 0, walk: 0, run: 1 - t2, sprint: t2 };
  }
  if (s < walkFrac) {
    const t2 = smoothstep(s / walkFrac);
    return { idle: 1 - t2, walk: t2, run: 0, sprint: 0 };
  }
  const t = smoothstep((s - walkFrac) / (1 - walkFrac));
  return { idle: 0, walk: 1 - t, run: t, sprint: 0 };
}
var DEFAULT_SKILL_LOCO_RETAIN = {
  melee_upper: 0.55,
  melee_full: 0.12,
  finisher: 0.08,
  ranged: 0.1,
  magic: 0.1,
  mobility: 0.08,
  block: 0.65,
  parry: 0.15,
  reaction: 0.05
};

// src/directional.ts
function moveIntentToCardinal(x, z, deadzone = 0.12) {
  const mag = Math.hypot(x, z);
  if (mag < deadzone) return "idle";
  const angle = Math.atan2(x, z);
  const deg = angle * 180 / Math.PI;
  if (deg >= -22.5 && deg < 22.5) return "forward";
  if (deg >= 22.5 && deg < 67.5) return "forward_right";
  if (deg >= 67.5 && deg < 112.5) return "right";
  if (deg >= 112.5 && deg < 157.5) return "back_right";
  if (deg >= 157.5 || deg < -157.5) return "back";
  if (deg >= -157.5 && deg < -112.5) return "back_left";
  if (deg >= -112.5 && deg < -67.5) return "left";
  return "forward_left";
}
function speed01FromXZ(x, z, max = 1) {
  return clamp01(Math.hypot(x, z) / Math.max(1e-6, max));
}
function directionalCardinalWeights(x, z, deadzone = 0.12) {
  const mag = Math.hypot(x, z);
  if (mag < deadzone) {
    return { idle: 1, forward: 0, back: 0, left: 0, right: 0 };
  }
  const nx = x / mag;
  const nz = z / mag;
  const forward = Math.max(0, nz);
  const back = Math.max(0, -nz);
  const right = Math.max(0, nx);
  const left = Math.max(0, -nx);
  const sum = forward + back + left + right || 1;
  return {
    idle: 0,
    forward: forward / sum,
    back: back / sum,
    left: left / sum,
    right: right / sum
  };
}
function directionalGaitPlan(x, z, sprinting, opts = {}) {
  const deadzone = opts.deadzone ?? 0.12;
  const speed01 = speed01FromXZ(x, z);
  return {
    cardinal: directionalCardinalWeights(x, z, deadzone),
    gait: gaitBlendFromSpeed(speed01, sprinting, opts.walkFrac ?? 0.45),
    speed01,
    slot: moveIntentToCardinal(x, z, deadzone)
  };
}
function formatDirectionalDebug(x, z, sprinting = false) {
  const p = directionalGaitPlan(x, z, sprinting);
  return `slot=${p.slot} spd=${p.speed01.toFixed(2)} card F${p.cardinal.forward.toFixed(2)}B${p.cardinal.back.toFixed(2)}L${p.cardinal.left.toFixed(2)}R${p.cardinal.right.toFixed(2)} gait i${p.gait.idle.toFixed(2)}w${p.gait.walk.toFixed(2)}r${p.gait.run.toFixed(2)}s${p.gait.sprint.toFixed(2)}`;
}
function yawTowardXZ(currentYaw, x, z, dt, turnSpeed = 10) {
  if (Math.hypot(x, z) < 0.05) return currentYaw;
  const target = Math.atan2(x, z);
  let d = target - currentYaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const t = 1 - Math.exp(-turnSpeed * dt);
  return currentYaw + d * smoothstep(t);
}

// src/locomotionCore.ts
var LOOP_REPEAT2 = 2201;
var LOOP_ONCE2 = 2200;
var LocomotionCore = class {
  constructor(mixer, clips, opts = {}) {
    this.moving = false;
    this.speed01 = 0;
    this.sprinting = false;
    this.overlay = null;
    this.activeSkill = null;
    this.skillElapsed = 0;
    this.skillDuration = 0.6;
    this.skillUpper = 1;
    this.skillFadeOut = 0.12;
    this.skillEnding = false;
    this.cdUntil = /* @__PURE__ */ new Map();
    this.now = 0;
    /** Last computed layer weights (debug / UI) */
    this.layerWeights = {
      locomotion: 1,
      upper_body: 0,
      full_body_skill: 0,
      additive: 0
    };
    this.skillState = {
      skillId: null,
      busy: false,
      progress: 0,
      inHitWindow: false,
      weaponColliderActive: false
    };
    this.mixer = mixer;
    this.fade = opts.fade ?? 0.12;
    this.walkSpeedFrac = opts.walkSpeedFrac ?? 0.45;
    this.skillLocoRetain = opts.skillLocoRetain ?? 0.55;
    this.continuousGait = opts.continuousGait !== false;
    this.idle = mixer.clipAction(clips.idle);
    this.walk = mixer.clipAction(clips.walk);
    this.run = mixer.clipAction(clips.run);
    this.sprint = mixer.clipAction(clips.sprint ?? clips.run);
    for (const a of [this.idle, this.walk, this.run, this.sprint]) {
      a.setLoop(LOOP_REPEAT2, Infinity);
      a.setEffectiveWeight(0);
      a.play();
    }
    this.idle.setEffectiveWeight(1);
  }
  /**
   * @param moving - any locomotion intent
   * @param speed01 - 0 idle … 1 full run (host maps WASD magnitude)
   * @param sprinting - hold sprint
   */
  setGaitTarget(moving, speed01 = 0, sprinting = false) {
    this.moving = moving;
    this.speed01 = Math.max(0, Math.min(1, speed01));
    this.sprinting = sprinting && moving;
  }
  /** Compatibility with AnimationDirector API (moving, sprinting) */
  setGaitMoving(moving, sprinting = false) {
    this.setGaitTarget(moving, moving ? sprinting ? 1 : 0.7 : 0, sprinting);
  }
  get busy() {
    return this.skillState.busy;
  }
  get currentGait() {
    return this.resolveGait();
  }
  /** Remaining cooldown for skill id (seconds), 0 if ready */
  cooldownRemaining(skillId) {
    const until = this.cdUntil.get(skillId) ?? 0;
    return Math.max(0, until - this.now);
  }
  /**
   * Play weapon skill blended over locomotion core.
   * Returns false if on cooldown or blocked.
   */
  playWeaponSkill(skill) {
    const until = this.cdUntil.get(skill.id) ?? 0;
    if (this.now < until) return false;
    if (this.skillState.busy && !skill.allowLocomotion) return false;
    const fadeIn = skill.fadeIn ?? 0.08;
    const fadeOut = skill.fadeOut ?? 0.12;
    if (this.overlay) {
      try {
        this.overlay.fadeOut(fadeIn);
      } catch {
      }
    }
    const action = this.mixer.clipAction(skill.clip);
    action.reset();
    action.setLoop(LOOP_ONCE2, 1);
    action.clampWhenFinished = false;
    action.setEffectiveWeight(skill.upperBodyWeight ?? 1);
    action.fadeIn(fadeIn).play();
    this.overlay = action;
    this.activeSkill = skill;
    this.skillElapsed = 0;
    this.skillDuration = Math.max(0.15, action.getClip().duration || 0.6);
    this.skillUpper = skill.upperBodyWeight ?? 1;
    this.skillFadeOut = fadeOut;
    this.skillEnding = false;
    this.skillState.skillId = skill.id;
    this.skillState.busy = true;
    this.skillState.progress = 0;
    this.skillState.inHitWindow = false;
    this.skillState.weaponColliderActive = false;
    if (skill.cooldownS && skill.cooldownS > 0) {
      this.cdUntil.set(skill.id, this.now + skill.cooldownS);
    }
    return true;
  }
  /** Force-cancel active skill overlay */
  cancelSkill(fadeOut) {
    if (!this.skillState.busy) return;
    const fo = fadeOut ?? this.skillFadeOut;
    if (this.overlay) {
      try {
        this.overlay.fadeOut(fo);
      } catch {
      }
    }
    this.clearSkillState();
  }
  /** @deprecated use playWeaponSkill */
  requestOneShot(clip, opts = {}) {
    return this.playWeaponSkill({
      id: "oneshot",
      clip,
      fadeIn: opts.fade,
      upperBodyWeight: 1,
      allowLocomotion: true
    });
  }
  resolveGait() {
    if (!this.moving || this.speed01 < 0.05) return "idle";
    if (this.sprinting) return "sprint";
    if (this.speed01 < this.walkSpeedFrac) return "walk";
    return "run";
  }
  clearSkillState() {
    this.overlay = null;
    this.activeSkill = null;
    this.skillEnding = false;
    this.skillState.skillId = null;
    this.skillState.busy = false;
    this.skillState.progress = 0;
    this.skillState.inHitWindow = false;
    this.skillState.weaponColliderActive = false;
    this.layerWeights = {
      locomotion: 1,
      upper_body: 0,
      full_body_skill: 0,
      additive: 0
    };
  }
  endSkill() {
    if (this.skillEnding) return;
    this.skillEnding = true;
    if (this.overlay) {
      try {
        this.overlay.fadeOut(this.skillFadeOut);
      } catch {
      }
    }
    this.clearSkillState();
  }
  update(dt) {
    this.now += dt;
    if (this.skillState.busy && this.activeSkill) {
      this.skillElapsed += dt;
      const p = Math.min(1, this.skillElapsed / this.skillDuration);
      this.skillState.progress = p;
      const hw = this.activeSkill.hitWindow ?? [0.28, 0.55];
      const inHit = p >= hw[0] && p <= hw[1];
      this.skillState.inHitWindow = inHit;
      this.skillState.weaponColliderActive = !!(this.activeSkill.weaponCollider !== false && inHit);
      if (this.skillElapsed >= this.skillDuration) {
        this.endSkill();
      }
    }
    if (this.skillState.busy && this.activeSkill) {
      this.layerWeights = skillOnLocoWeights({
        skillWeight: this.skillUpper,
        allowLocomotion: this.activeSkill.allowLocomotion,
        skillLocoRetain: this.skillLocoRetain
      });
    } else {
      this.layerWeights = {
        locomotion: 1,
        upper_body: 0,
        full_body_skill: 0,
        additive: 0
      };
    }
    const locoScale = this.layerWeights.locomotion;
    if (this.continuousGait && this.moving) {
      const g = gaitBlendFromSpeed(
        this.speed01,
        this.sprinting,
        this.walkSpeedFrac
      );
      this.idle.setEffectiveWeight(g.idle * locoScale);
      this.walk.setEffectiveWeight(g.walk * locoScale);
      this.run.setEffectiveWeight(g.run * locoScale);
      this.sprint.setEffectiveWeight(g.sprint * locoScale);
    } else {
      const gait = this.resolveGait();
      const actions = {
        idle: this.idle,
        walk: this.walk,
        run: this.run,
        sprint: this.sprint
      };
      const want = actions[gait];
      for (const a of [this.idle, this.walk, this.run, this.sprint]) {
        if (a === want) a.setEffectiveWeight(locoScale);
        else a.setEffectiveWeight(0);
      }
    }
    if (this.overlay && this.skillState.busy) {
      try {
        this.overlay.setEffectiveWeight(this.skillUpper);
      } catch {
      }
    }
    this.mixer.update(dt);
  }
  dispose() {
    for (const a of [this.idle, this.walk, this.run, this.sprint]) {
      try {
        a.stop();
      } catch {
      }
    }
    this.clearSkillState();
  }
};
var DEFAULT_MELEE_HIT_WINDOW = [0.28, 0.55];
function makeMeleeSkill(id, clip, rangeM = 2.5, extra = {}) {
  return {
    id,
    clip,
    rangeM,
    upperBodyWeight: 0.95,
    allowLocomotion: true,
    hitWindow: DEFAULT_MELEE_HIT_WINDOW,
    weaponCollider: true,
    fadeIn: 0.08,
    fadeOut: 0.12,
    cooldownS: 0.35,
    ...extra
  };
}
function makeRangedSkill(id, clip, rangeM = 22, extra = {}) {
  return {
    id,
    clip,
    rangeM,
    upperBodyWeight: 1,
    allowLocomotion: false,
    hitWindow: [0.35, 0.5],
    weaponCollider: false,
    fadeIn: 0.1,
    fadeOut: 0.15,
    cooldownS: 0.5,
    ...extra
  };
}
function makeMagicSkill(id, clip, rangeM = 18, extra = {}) {
  return {
    id,
    clip,
    rangeM,
    upperBodyWeight: 1,
    allowLocomotion: false,
    hitWindow: [0.4, 0.65],
    weaponCollider: false,
    fadeIn: 0.12,
    fadeOut: 0.18,
    cooldownS: 0.8,
    animPack: "magic",
    ...extra
  };
}

// src/weaponSkills.ts
function weaponSkillFromPayload(clip, payload) {
  return {
    id: payload.id,
    name: payload.name,
    clip,
    animPack: payload.animPack,
    upperBodyWeight: payload.upperBodyWeight,
    allowLocomotion: payload.allowLocomotion,
    fadeIn: payload.fadeIn,
    fadeOut: payload.fadeOut,
    hitWindow: payload.hitWindow,
    rangeM: payload.rangeM,
    cooldownS: payload.cooldownS,
    weaponCollider: payload.weaponCollider
  };
}
function makeMobilitySkill(id, clip, extra = {}) {
  return {
    id,
    clip,
    upperBodyWeight: 1,
    allowLocomotion: false,
    fadeIn: 0.05,
    fadeOut: 0.1,
    hitWindow: [0.1, 0.85],
    weaponCollider: false,
    rangeM: 0,
    cooldownS: 0.9,
    ...extra
  };
}
function makeBlockSkill(id, clip, extra = {}) {
  return {
    id,
    clip,
    upperBodyWeight: 0.85,
    allowLocomotion: true,
    fadeIn: 0.06,
    fadeOut: 0.1,
    hitWindow: [0, 1],
    weaponCollider: false,
    rangeM: 0,
    cooldownS: 0,
    ...extra
  };
}
function makeParrySkill(id, clip, extra = {}) {
  return {
    id,
    clip,
    upperBodyWeight: 1,
    allowLocomotion: false,
    fadeIn: 0.04,
    fadeOut: 0.1,
    hitWindow: [0.1, 0.35],
    weaponCollider: false,
    rangeM: 0,
    cooldownS: 0.8,
    ...extra
  };
}
function makeReactionSkill(id, clip, extra = {}) {
  return {
    id,
    clip,
    upperBodyWeight: 1,
    allowLocomotion: false,
    fadeIn: 0.05,
    fadeOut: 0.15,
    hitWindow: [0, 1],
    weaponCollider: false,
    rangeM: 0,
    cooldownS: 0.2,
    ...extra
  };
}
function makeFinisherSkill(id, clip, rangeM = 3, extra = {}) {
  return {
    id,
    clip,
    rangeM,
    upperBodyWeight: 1,
    allowLocomotion: false,
    fadeIn: 0.1,
    fadeOut: 0.18,
    hitWindow: [0.3, 0.7],
    weaponCollider: true,
    cooldownS: 1.5,
    ...extra
  };
}
function previewSkillLayerWeights(skill, skillLocoRetain = 0.55) {
  return skillOnLocoWeights({
    skillWeight: skill.upperBodyWeight ?? 1,
    allowLocomotion: skill.allowLocomotion,
    skillLocoRetain
  });
}
function makeSkillByCategory(category, id, clip, opts = {}) {
  const { rangeM, ...extra } = opts;
  switch (category) {
    case "melee":
      return makeMeleeSkill(id, clip, rangeM ?? 2.5, extra);
    case "ranged":
      return makeRangedSkill(id, clip, rangeM ?? 22, extra);
    case "magic":
      return makeMagicSkill(id, clip, rangeM ?? 18, extra);
    case "mobility":
      return makeMobilitySkill(id, clip, extra);
    case "block":
      return makeBlockSkill(id, clip, extra);
    case "parry":
      return makeParrySkill(id, clip, extra);
    case "reaction":
      return makeReactionSkill(id, clip, extra);
    case "finisher":
      return makeFinisherSkill(id, clip, rangeM ?? 3, extra);
    default:
      return makeMeleeSkill(id, clip, 2.5, extra);
  }
}

exports.AnimationDirector = AnimationDirector;
exports.BONE_MASK_GROUPS = BONE_MASK_GROUPS;
exports.DEFAULT_BATTLE_CLIPS = DEFAULT_BATTLE_CLIPS;
exports.DEFAULT_MELEE_HIT_WINDOW = DEFAULT_MELEE_HIT_WINDOW;
exports.DEFAULT_SKILL_LOCO_RETAIN = DEFAULT_SKILL_LOCO_RETAIN;
exports.LocomotionCore = LocomotionCore;
exports.battleClipUrls = battleClipUrls;
exports.clamp01 = clamp01;
exports.crossfadePlan = crossfadePlan;
exports.defaultLayerWeights = defaultLayerWeights;
exports.directionalCardinalWeights = directionalCardinalWeights;
exports.directionalGaitPlan = directionalGaitPlan;
exports.formatDirectionalDebug = formatDirectionalDebug;
exports.gaitBlendFromSpeed = gaitBlendFromSpeed;
exports.lerp = lerp;
exports.makeBlockSkill = makeBlockSkill;
exports.makeFinisherSkill = makeFinisherSkill;
exports.makeMagicSkill = makeMagicSkill;
exports.makeMeleeSkill = makeMeleeSkill;
exports.makeMobilitySkill = makeMobilitySkill;
exports.makeParrySkill = makeParrySkill;
exports.makeRangedSkill = makeRangedSkill;
exports.makeReactionSkill = makeReactionSkill;
exports.makeSkillByCategory = makeSkillByCategory;
exports.moveIntentToCardinal = moveIntentToCardinal;
exports.packRoleUrls = packRoleUrls;
exports.packSkillUrls = packSkillUrls;
exports.previewSkillLayerWeights = previewSkillLayerWeights;
exports.skillOnLocoWeights = skillOnLocoWeights;
exports.smoothstep = smoothstep;
exports.speed01FromXZ = speed01FromXZ;
exports.weaponSkillFromPayload = weaponSkillFromPayload;
exports.yawTowardXZ = yawTowardXZ;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map