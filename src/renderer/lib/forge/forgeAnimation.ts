import * as THREE from "three";

export type AnimLoopMode = "repeat" | "once" | "pingpong";

export interface ForgeAnimSettings {
  timeScale: number;
  loop: AnimLoopMode;
  crossfadeMs: number;
  dropRootChain: boolean;
  showSkeleton: boolean;
}

export const DEFAULT_FORGE_ANIM: ForgeAnimSettings = {
  timeScale: 1,
  loop: "repeat",
  crossfadeMs: 250,
  dropRootChain: true,
  showSkeleton: false,
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
  to.reset().fadeIn(durationSec).play();
}