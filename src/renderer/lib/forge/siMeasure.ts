/**
 * SI measure + height fit for elite viewer.
 * Skinned: bone structural box (feet = min.y). Static: mesh AABB.
 * Never force 1.8 m on props.
 */
import * as THREE from "three";

export interface SiBounds {
  w: number;
  h: number;
  d: number;
  min: [number, number, number];
  max: [number, number, number];
  source: "bones" | "mesh";
  boneCount: number;
}

function boneBox(root: THREE.Object3D): { box: THREE.Box3; count: number } {
  const box = new THREE.Box3();
  const wp = new THREE.Vector3();
  let count = 0;
  root.traverse((n) => {
    const b = n as THREE.Bone;
    if (!b.isBone) return;
    b.getWorldPosition(wp);
    box.expandByPoint(wp);
    count++;
  });
  return { box, count };
}

export function measureObjectSi(root: THREE.Object3D): SiBounds {
  const bones = boneBox(root);
  let box: THREE.Box3;
  let source: SiBounds["source"] = "mesh";
  if (bones.count >= 3 && !bones.box.isEmpty()) {
    box = bones.box;
    source = "bones";
  } else {
    box = new THREE.Box3().setFromObject(root);
  }
  if (box.isEmpty()) {
    return {
      w: 0, h: 0, d: 0,
      min: [0, 0, 0],
      max: [0, 0, 0],
      source,
      boneCount: bones.count,
    };
  }
  const size = box.getSize(new THREE.Vector3());
  return {
    w: size.x,
    h: size.y,
    d: size.z,
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
    source,
    boneCount: bones.count,
  };
}

export function formatSiMeters(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 10) return `${n.toFixed(2)} m`;
  return `${n.toFixed(3)} m`;
}

/**
 * Uniform-scale a skinned root so bone-box height = target (default 1.8 m human).
 * Static meshes: returns false — do not force hero height on props.
 */
export function fitHeightSi(
  root: THREE.Object3D,
  targetHeight = 1.8,
): { ok: boolean; scale: number; beforeH: number; afterH: number; reason?: string } {
  const before = measureObjectSi(root);
  if (before.source !== "bones") {
    return { ok: false, scale: 1, beforeH: before.h, afterH: before.h, reason: "static" };
  }
  if (before.h < 1e-4) {
    return { ok: false, scale: 1, beforeH: before.h, afterH: before.h, reason: "empty" };
  }
  const s = targetHeight / before.h;
  if (!Number.isFinite(s) || s <= 0) {
    return { ok: false, scale: 1, beforeH: before.h, afterH: before.h, reason: "bad-scale" };
  }
  root.scale.multiplyScalar(s);
  root.updateMatrixWorld(true);
  const after = measureObjectSi(root);
  return { ok: true, scale: s, beforeH: before.h, afterH: after.h };
}
