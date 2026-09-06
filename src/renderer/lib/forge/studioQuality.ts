/**
 * Fleet quality imports for Dev Tool Native Play.
 * @grudge-studio/* (file: GrudgeStudioNPM) — CCT contract + LocomotionCore + combatSkillKit.
 * Does not add Rapier WASM here. Live playtest URLs stay Open/Casting.
 */
import type { AnimationClip, AnimationMixer } from "three";
import { LocomotionCore, weaponSkillFromPayload, type WeaponSkillDef } from "@grudge-studio/animator";
import { combatSkillKit, toWeaponSkillPayload } from "@grudge-studio/assets";
import {
  HUMAN_CCT,
  PLAYTEST_WITH_CONTROLLER,
  applyGamepadDeadzone,
  capsuleCenterOffset,
} from "@grudge-studio/engine";

export {
  HUMAN_CCT,
  PLAYTEST_WITH_CONTROLLER,
  applyGamepadDeadzone,
  capsuleCenterOffset,
};

function clipByKeys(clips: AnimationClip[], keys: string[]): AnimationClip | null {
  const lower = clips.map((c) => ({ c, n: c.name.toLowerCase() }));
  for (const k of keys) {
    const hit = lower.find((x) => x.n.includes(k.toLowerCase()) || x.n === k.toLowerCase());
    if (hit) return hit.c;
  }
  return null;
}

export function bindLocomotionCore(
  mixer: AnimationMixer,
  clips: AnimationClip[],
): LocomotionCore | null {
  const idle = clipByKeys(clips, ["idle", "stand", "wait"]) ?? clips[0];
  if (!idle) return null;
  const walk = clipByKeys(clips, ["walk", "move"]) ?? idle;
  const run = clipByKeys(clips, ["run", "sprint"]) ?? walk;
  return new LocomotionCore(mixer, { idle, walk, run, sprint: run }, { continuousGait: true });
}

/** Match combatSkillKit entries to clips already on the mixer (Toon kit + pack). */
export function bindCombatSkills(
  clips: AnimationClip[],
  weaponPackId = "sword_shield",
): WeaponSkillDef[] {
  const kit = combatSkillKit(weaponPackId);
  const out: WeaponSkillDef[] = [];
  for (const entry of kit) {
    const keys = entry.candidates.map((c) => c.key);
    const clip = clipByKeys(clips, keys);
    if (!clip) continue;
    out.push(weaponSkillFromPayload(clip, toWeaponSkillPayload(entry)));
  }
  return out;
}

export const FLEET_PLAYTEST_LINKS = PLAYTEST_WITH_CONTROLLER.filter(
  (s) => s.walk === "rapier-cct",
);
