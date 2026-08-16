/**
 * Multi-asset elite viewer scene — same SceneEngine, many roots.
 * Mirrors Forge3D SceneItem enough to pick / gizmo / offset, without Forge tools.
 */
import * as THREE from "three";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

export const VIEWER_ITEM_ID = "viewerItemId";

export interface ViewerSceneItem {
  id: string;
  name: string;
  format: string;
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
  mixer: THREE.AnimationMixer | null;
  triangles: number;
  vertices: number;
  bones: number;
  visible: boolean;
  diskPath?: string;
  authorXform: {
    pos: [number, number, number];
    rot: [number, number, number];
    scl: [number, number, number];
  };
}

export function newViewerItemId(): string {
  return `v${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`;
}

export function stampViewerItem(root: THREE.Object3D, id: string): void {
  root.userData[VIEWER_ITEM_ID] = id;
  root.traverse((n) => {
    n.userData[VIEWER_ITEM_ID] = id;
  });
}

export function findViewerItemId(obj: THREE.Object3D | null): string | null {
  let p: THREE.Object3D | null = obj;
  while (p) {
    const id = p.userData?.[VIEWER_ITEM_ID];
    if (typeof id === "string" && id) return id;
    p = p.parent;
  }
  return null;
}

/** Place the next drop just +X of the current collection (SI metres). */
export function nextPlaceX(items: ViewerSceneItem[]): number {
  const box = new THREE.Box3();
  let maxX = -Infinity;
  for (const it of items) {
    if (!it.visible || !it.object.visible) continue;
    box.setFromObject(it.object);
    if (box.isEmpty()) continue;
    maxX = Math.max(maxX, box.max.x);
  }
  if (!Number.isFinite(maxX)) return 0;
  return maxX + 0.4;
}

export function readAuthorXform(obj: THREE.Object3D): ViewerSceneItem["authorXform"] {
  return {
    pos: [obj.position.x, obj.position.y, obj.position.z],
    rot: [
      THREE.MathUtils.radToDeg(obj.rotation.x),
      THREE.MathUtils.radToDeg(obj.rotation.y),
      THREE.MathUtils.radToDeg(obj.rotation.z),
    ],
    scl: [obj.scale.x, obj.scale.y, obj.scale.z],
  };
}

/** Skinned-safe clone for Shift+D. */
export function cloneViewerObject(src: THREE.Object3D): THREE.Object3D {
  return SkeletonUtils.clone(src);
}
