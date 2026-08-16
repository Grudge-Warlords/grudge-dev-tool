/**
 * Shared bone-name sprites for elite viewer + Skeleton Studio.
 */
import * as THREE from "three";

export function makeBoneLabel(text: string, color = "#67e8f9"): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = color;
    ctx.font = "bold 22px sans-serif";
    ctx.fillText(text.slice(0, 28), 8, 40);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, toneMapped: false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(0.45, 0.12, 1);
  spr.name = `BoneLabel:${text}`;
  spr.userData.forgeInternal = true;
  return spr;
}

export function attachBoneNameLabels(root: THREE.Object3D, scene: THREE.Scene): THREE.Group {
  const group = new THREE.Group();
  group.name = "GrudgeBoneLabels";
  group.userData.forgeInternal = true;
  const wp = new THREE.Vector3();
  let n = 0;
  root.traverse((o) => {
    const b = o as THREE.Bone;
    if (!b.isBone || !b.name) return;
    // Skip tiny end-site / twist clutter when many bones
    if (n > 80) return;
    b.getWorldPosition(wp);
    const label = makeBoneLabel(b.name);
    label.position.copy(wp).add(new THREE.Vector3(0, 0.06, 0));
    group.add(label);
    n++;
  });
  scene.add(group);
  return group;
}

export function disposeBoneLabelGroup(group: THREE.Group | null): void {
  if (!group) return;
  group.traverse((n) => {
    const s = n as THREE.Sprite;
    if (!s.isSprite) return;
    const mat = s.material as THREE.SpriteMaterial;
    mat.map?.dispose();
    mat.dispose();
  });
  group.parent?.remove(group);
}
