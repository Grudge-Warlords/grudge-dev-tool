import * as THREE from "three";

export type AnimLoopMode = "repeat" | "once" | "pingpong";

export interface ForgeAnimSettings {
  timeScale: number;
  loop: AnimLoopMode;
  crossfadeMs: number;
  dropRootChain: boolean;
  showSkeleton: boolean;
  /** Prefer auto-playing first clip when a model loads */
  autoPlayFirst: boolean;
}

export const DEFAULT_FORGE_ANIM: ForgeAnimSettings = {
  timeScale: 1,
  loop: "repeat",
  crossfadeMs: 250,
  dropRootChain: true,
  showSkeleton: false,
  autoPlayFirst: false,
};

export function applyLoopMode(action: THREE.AnimationAction, mode: AnimLoopMode): void {
  action.setLoop(
    mode === "pingpong" ? THREE.LoopPingPong : mode === "repeat" ? THREE.LoopRepeat : THREE.LoopOnce,
    mode === "once" ? 1 : Infinity,
  );
  action.clampWhenFinished = mode === "once";
}

export function crossfadeTo(
  from: THREE.AnimationAction | null,
  to: THREE.AnimationAction,
  durationSec: number,
): void {
  if (from && from !== to) {
    from.crossFadeTo(to, durationSec, false);
  }
  to.enabled = true;
  to.setEffectiveWeight(1);
  to.reset().fadeIn(Math.max(0, durationSec)).play();
}

/** Stop every action on a mixer cleanly. */
export function stopMixer(mixer: THREE.AnimationMixer | null): void {
  if (!mixer) return;
  mixer.stopAllAction();
  mixer.setTime(0);
}

/** Set a default clip as the "primary" action (weight 1, others 0). */
export function setPrimaryAction(
  mixer: THREE.AnimationMixer,
  clip: THREE.AnimationClip,
  loop: AnimLoopMode = "repeat",
): THREE.AnimationAction {
  mixer.stopAllAction();
  const action = mixer.clipAction(clip);
  applyLoopMode(action, loop);
  action.reset().setEffectiveWeight(1).play();
  return action;
}

/** Ensure AnimationMixer exists for root and is registered with an engine mixers list. */
export function ensureMixer(
  root: THREE.Object3D,
  clips: THREE.AnimationClip[],
  mixers: THREE.AnimationMixer[],
  existing?: THREE.AnimationMixer | null,
): THREE.AnimationMixer | null {
  if (existing) {
    const i = mixers.indexOf(existing);
    if (i >= 0) mixers.splice(i, 1);
    existing.stopAllAction();
  }
  if (!clips.length && !hasAnyBone(root)) {
    // Still allow unrigged procedural later — create empty mixer for object tracks
  }
  const mixer = new THREE.AnimationMixer(root);
  mixers.push(mixer);
  return mixer;
}

function hasAnyBone(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((n) => {
    if ((n as THREE.Bone).isBone) found = true;
  });
  return found;
}