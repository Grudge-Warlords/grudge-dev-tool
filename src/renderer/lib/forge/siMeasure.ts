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
    // The fast path expands geometry bounds by every morph-target delta, even
    // when all current weights are zero. Use the precise path so the displayed
    // SI dimensions describe the visible pose rather than a conservative
    // animation envelope.
    box = new THREE.Box3().setFromObject(root, true);
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

/** Casting / loadRaceKit structural bones — not every finger/weapon nub. */
const PLAY_BONE_GROUPS: string[][] = [
  ["Bip001 Head", "Bip001_Head", "Head"],
  ["Bip001 HeadNub", "Bip001_HeadNub"],
  ["Bip001 Pelvis", "Bip001_Pelvis", "Pelvis"],
  ["Bip001 Spine", "Bip001_Spine"],
  ["Bip001 L Foot", "Bip001_L_Foot"],
  ["Bip001 R Foot", "Bip001_R_Foot"],
  ["Bip001 L Toe0", "Bip001_L_Toe0"],
  ["Bip001 R Toe0", "Bip001_R_Toe0"],
  ["Bip001 L Hand", "Bip001_L_Hand"],
  ["Bip001 R Hand", "Bip001_R_Hand"],
  ["Bip001 L Calf", "Bip001_L_Calf"],
  ["Bip001 R Calf", "Bip001_R_Calf"],
];

function findNamed(root: THREE.Object3D, names: string[]): THREE.Object3D | null {
  for (const n of names) {
    const o = root.getObjectByName(n);
    if (o) return o;
  }
  return null;
}

/** Bone-driven AABB for Toon play kits (mesh AABB is local-bind and wrong). */
export function measurePlayBoneBox(root: THREE.Object3D): THREE.Box3 | null {
  root.updateMatrixWorld(true);
  const seen = new Set<THREE.Skeleton>();
  root.traverse((n) => {
    const sm = n as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh || !sm.skeleton) return;
    if (seen.has(sm.skeleton)) return;
    seen.add(sm.skeleton);
    sm.skeleton.update();
  });
  const wp = new THREE.Vector3();
  const box = new THREE.Box3();
  let n = 0;
  for (const names of PLAY_BONE_GROUPS) {
    const bone = findNamed(root, names);
    if (!bone) continue;
    bone.getWorldPosition(wp);
    if (!Number.isFinite(wp.x + wp.y + wp.z)) continue;
    if (n === 0) {
      box.min.copy(wp);
      box.max.copy(wp);
    } else box.expandByPoint(wp);
    n++;
  }
  if (n < 2) return null;
  const h = Math.max(box.max.y - box.min.y, 1e-4);
  const pad = Math.max(h * 0.1, h * 0.02);
  box.min.y -= pad * 0.55;
  box.max.y += pad * 0.45;
  return box;
}

/**
 * loadRaceKit / toonKitPlay SI: uniform scale on ROOT + plant feet at y=0.
 * Yaw 0 (Toon play GLB already +Z). Never pose() here.
 */
export function plantPlayKitSi(
  root: THREE.Object3D,
  targetHeight = 1.8,
): { height: number; scale: number } {
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.setScalar(1);
  root.updateMatrixWorld(true);

  let box = measurePlayBoneBox(root) || new THREE.Box3().setFromObject(root, false);
  let h = Math.max(box.max.y - box.min.y, 1e-4);
  if (h > 40) {
    root.scale.setScalar(0.01);
    root.updateMatrixWorld(true);
    box = measurePlayBoneBox(root) || new THREE.Box3().setFromObject(root, false);
    h = Math.max(box.max.y - box.min.y, 1e-4);
  }
  const s = targetHeight / h;
  if (Number.isFinite(s) && s > 0) root.scale.setScalar(root.scale.x * s);
  root.updateMatrixWorld(true);
  box = measurePlayBoneBox(root) || new THREE.Box3().setFromObject(root, false);
  root.position.y -= box.min.y;
  const cx = (box.min.x + box.max.x) * 0.5;
  const cz = (box.min.z + box.max.z) * 0.5;
  root.position.x -= cx;
  root.position.z -= cz;
  root.updateMatrixWorld(true);
  box = measurePlayBoneBox(root) || new THREE.Box3().setFromObject(root, false);
  const finalH = box.max.y - box.min.y;
  root.userData.deployHeightM = finalH;
  root.userData.artForwardYaw = 0;
  root.userData.importPipeline = root.userData.importPipeline || "toon-rts-glb";
  return { height: finalH, scale: root.scale.x };
}

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
