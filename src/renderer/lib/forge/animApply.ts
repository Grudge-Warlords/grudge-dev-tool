/**
 * Apply / build animation clips for both rigged and unrigged assets.
 *
 * - Rigged: retarget or bind skeleton tracks onto the target mixer root.
 * - Unrigged: generate object-space transform clips (spin / bob / float / breathe)
 *   or map positional tracks onto the root Object3D.
 */

import * as THREE from "three";
import { retargetClips } from "./boneAliases";

export type UnriggedPreset =
  | "spin-y"
  | "bob"
  | "float"
  | "breathe"
  | "wobble"
  | "pulse-scale";

export interface ApplyAnimResult {
  clips: THREE.AnimationClip[];
  mode: "rigged-retarget" | "rigged-bind" | "unrigged-remap" | "unrigged-procedural";
  droppedTracks: number;
  warnings: string[];
}

function hasSkeleton(root: THREE.Object3D): boolean {
  let bones = 0;
  let skinned = false;
  root.traverse((n) => {
    if ((n as THREE.Bone).isBone) bones++;
    if ((n as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
  });
  return bones > 0 || skinned;
}

function isBoneTrack(name: string): boolean {
  if (name.includes(".bones[")) return true;
  if (name.startsWith(".")) return false;
  return /\.(quaternion|position|scale)$/.test(name) && name.includes(".");
}

/** Count bone-like vs object-root tracks. */
function classifyTracks(clips: THREE.AnimationClip[]): {
  boneTracks: number;
  objectTracks: number;
} {
  let boneTracks = 0;
  let objectTracks = 0;
  for (const c of clips) {
    for (const t of c.tracks) {
      if (t.name.startsWith(".") || t.name.startsWith(c.name)) objectTracks++;
      else if (isBoneTrack(t.name) || !t.name.startsWith(".")) boneTracks++;
      else objectTracks++;
    }
  }
  return { boneTracks, objectTracks };
}

/**
 * Remap animation tracks onto a non-rigged object root.
 * Bone quaternion → root rotation; bone position → root position (scaled down);
 * unknown tracks dropped with counters.
 */
export function remapClipsToObject(
  clips: THREE.AnimationClip[],
  targetRoot: THREE.Object3D,
): { clips: THREE.AnimationClip[]; dropped: number } {
  const rootName = targetRoot.name || "Root";
  let dropped = 0;
  const out = clips.map((clip) => {
    const tracks: THREE.KeyframeTrack[] = [];
    for (const track of clip.tracks) {
      const prop = track.name.includes(".")
        ? track.name.slice(track.name.lastIndexOf("."))
        : "";
      if (prop === ".quaternion" || prop.endsWith(".quaternion")) {
        const t = track.clone();
        t.name = `${rootName}.quaternion`;
        // Prefer first quaternion track only to avoid stacking bone channels
        if (!tracks.some((x) => x.name.endsWith(".quaternion"))) tracks.push(t);
        else dropped++;
        continue;
      }
      if (prop === ".position" || prop.endsWith(".position")) {
        // Skip pure root-motion position dumps for static props — use slight Y only if multi-axis
        dropped++;
        continue;
      }
      if (prop === ".scale" || prop.endsWith(".scale")) {
        const t = track.clone();
        t.name = `${rootName}.scale`;
        if (!tracks.some((x) => x.name.endsWith(".scale"))) tracks.push(t);
        else dropped++;
        continue;
      }
      // Morph / misc object tracks that already target root
      if (track.name.startsWith(".") || track.name.startsWith(rootName)) {
        tracks.push(track.clone());
      } else {
        dropped++;
      }
    }
    const name = clip.name.startsWith("obj:") ? clip.name : `obj:${clip.name}`;
    return new THREE.AnimationClip(name, clip.duration, tracks);
  }).filter((c) => c.tracks.length > 0);
  return { clips: out, dropped };
}

/** Procedural unrigged motion presets (object-space). */
export function buildProceduralClip(
  root: THREE.Object3D,
  preset: UnriggedPreset,
  duration = 2,
): THREE.AnimationClip {
  const name = root.name || "Root";
  const times = [0, duration / 4, duration / 2, (3 * duration) / 4, duration];
  const q0 = root.quaternion.clone();
  const p0 = root.position.clone();
  const s0 = root.scale.clone();

  const tracks: THREE.KeyframeTrack[] = [];

  if (preset === "spin-y") {
    const eulers = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, Math.PI * 2];
    const values: number[] = [];
    for (const yaw of eulers) {
      const q = q0.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
      values.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values));
  }

  if (preset === "bob" || preset === "float") {
    const amp = preset === "float" ? 0.12 : 0.06;
    const values: number[] = [];
    const offs = [0, amp, 0, -amp, 0];
    for (const o of offs) values.push(p0.x, p0.y + o, p0.z);
    tracks.push(new THREE.VectorKeyframeTrack(`${name}.position`, times, values));
  }

  if (preset === "breathe" || preset === "pulse-scale") {
    const amp = preset === "pulse-scale" ? 0.08 : 0.03;
    const scales = [1, 1 + amp, 1, 1 - amp * 0.5, 1];
    const values: number[] = [];
    for (const m of scales) values.push(s0.x * m, s0.y * m, s0.z * m);
    tracks.push(new THREE.VectorKeyframeTrack(`${name}.scale`, times, values));
  }

  if (preset === "wobble") {
    const values: number[] = [];
    const angles = [0, 0.08, 0, -0.08, 0];
    for (const a of angles) {
      const q = q0.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a));
      values.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values));
  }

  return new THREE.AnimationClip(`proc:${preset}`, duration, tracks);
}

/**
 * Smart apply: choose retarget vs object remap vs procedural based on target rig.
 */
export function applyAnimationsToTarget(
  clips: THREE.AnimationClip[],
  target: THREE.Object3D,
  opts?: {
    source?: THREE.Object3D | Map<string, import("./boneAliases").RestPoseEntry> | null;
    dropRootChain?: boolean;
    /** If target is unrigged and clips are bone-heavy, fall back to procedural. */
    fallbackPreset?: UnriggedPreset;
  },
): ApplyAnimResult {
  const warnings: string[] = [];
  const rigged = hasSkeleton(target);
  const { boneTracks, objectTracks } = classifyTracks(clips);

  if (rigged) {
    if (boneTracks > 0 || opts?.source) {
      try {
        const retargeted = retargetClips(clips, target, opts?.source, {
          dropRootChain: opts?.dropRootChain ?? true,
        });
        if (retargeted.some((c) => c.tracks.length > 0)) {
          return {
            clips: retargeted.map((c) => {
              const n = c.clone();
              if (!n.name.startsWith("rig:")) n.name = `rig:${n.name}`;
              return n;
            }),
            mode: "rigged-retarget",
            droppedTracks: 0,
            warnings,
          };
        }
        warnings.push("Retarget produced empty clips — trying bind as-is");
      } catch (e) {
        warnings.push(e instanceof Error ? e.message : "retarget failed");
      }
    }
    // Bind tracks as-is (same skeleton names)
    return {
      clips: clips.map((c) => c.clone()),
      mode: "rigged-bind",
      droppedTracks: 0,
      warnings,
    };
  }

  // Unrigged target
  if (boneTracks > objectTracks && boneTracks > 0) {
    const remapped = remapClipsToObject(clips, target);
    if (remapped.clips.length > 0) {
      return {
        clips: remapped.clips,
        mode: "unrigged-remap",
        droppedTracks: remapped.dropped,
        warnings: remapped.dropped
          ? [`Dropped ${remapped.dropped} bone tracks not usable on static mesh`]
          : warnings,
      };
    }
    const preset = opts?.fallbackPreset ?? "spin-y";
    warnings.push("Could not remap bone clips — added procedural motion");
    return {
      clips: [buildProceduralClip(target, preset)],
      mode: "unrigged-procedural",
      droppedTracks: remapped.dropped,
      warnings,
    };
  }

  // Object-space clips already
  if (clips.length > 0) {
    const remapped = remapClipsToObject(clips, target);
    return {
      clips: remapped.clips.length ? remapped.clips : clips.map((c) => c.clone()),
      mode: "unrigged-remap",
      droppedTracks: remapped.dropped,
      warnings,
    };
  }

  return {
    clips: [buildProceduralClip(target, opts?.fallbackPreset ?? "bob")],
    mode: "unrigged-procedural",
    droppedTracks: 0,
    warnings: ["No clips provided — generated procedural bob"],
  };
}

/** Ensure mixer exists and register clips; returns action for first clip. */
export function bindClipsToMixer(
  mixer: THREE.AnimationMixer,
  clips: THREE.AnimationClip[],
): THREE.AnimationAction[] {
  return clips.map((c) => {
    const action = mixer.clipAction(c);
    action.enabled = true;
    return action;
  });
}

export const UNRIGGED_PRESETS: Array<{ id: UnriggedPreset; label: string; hint: string }> = [
  { id: "spin-y", label: "Spin Y", hint: "Full yaw rotation loop" },
  { id: "bob", label: "Bob", hint: "Subtle vertical bounce" },
  { id: "float", label: "Float", hint: "Larger hover loop" },
  { id: "breathe", label: "Breathe", hint: "Scale inhale/exhale" },
  { id: "wobble", label: "Wobble", hint: "Z-axis tilt" },
  { id: "pulse-scale", label: "Pulse", hint: "Strong scale pulse" },
];
