import * as THREE from "three";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { GENERIC_GRUDGE_PREVIEW } from "../../../shared/genericPreviewHost";
import { normalizeBoneKey } from "../../../shared/mixamo25";
import { createProductionGltfLoader } from "./gltfProdLoader";

type PreviewLoaded = {
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
  triangles: number;
  format: string;
};

const UNARMED = new Set<string>(GENERIC_GRUDGE_PREVIEW.unarmedMeshIds);

export function isAnimWithoutMesh(loaded: PreviewLoaded): boolean {
  if (!loaded.animations?.length) return false;
  let skinned = 0;
  loaded.object.traverse((n) => {
    const sm = n as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh && sm.visible !== false) skinned++;
  });
  return skinned === 0 || loaded.triangles < 32;
}

function applyUnarmedVisibility(root: THREE.Object3D): void {
  root.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = mesh.name || "";
    if (!/^(WK_|BRB_|ELF_|DWF_|ORC_|UD_)/i.test(name) && !/weapon|Shield|Xtra|Units_/i.test(name)) {
      return;
    }
    mesh.visible = UNARMED.has(name);
  });
}

function hostBoneMap(root: THREE.Object3D): Map<string, string> {
  const map = new Map<string, string>();
  root.traverse((n) => {
    if ((n as THREE.Bone).isBone || /^Bip001/i.test(n.name)) {
      const k = normalizeBoneKey(n.name);
      if (k && !map.has(k)) map.set(k, n.name);
    }
  });
  return map;
}

function rematchClip(clip: THREE.AnimationClip, bones: Map<string, string>): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const t of clip.tracks) {
    const dot = t.name.indexOf(".");
    if (dot < 0) continue;
    const bone = t.name.slice(0, dot);
    const prop = t.name.slice(dot);
    if (prop === ".position" || prop.endsWith(".position")) continue;
    const target = bones.get(normalizeBoneKey(bone));
    if (!target) continue;
    const cloned = t.clone();
    cloned.name = target + prop;
    tracks.push(cloned);
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

let hostCache: THREE.Object3D | null = null;

async function loadHostKit(): Promise<THREE.Object3D> {
  if (hostCache) return SkeletonUtils.clone(hostCache) as THREE.Object3D;
  const loader = await createProductionGltfLoader();
  const gltf = await loader.loadAsync(GENERIC_GRUDGE_PREVIEW.kitUrl);
  const scene = SkeletonUtils.clone(gltf.scene) as THREE.Object3D;
  applyUnarmedVisibility(scene);
  hostCache = scene;
  return SkeletonUtils.clone(hostCache) as THREE.Object3D;
}

/**
 * Bind clip-only / bones-only animation files onto the generic Toon human unarmed kit.
 */
export async function bindGenericPreviewHost<T extends PreviewLoaded>(loaded: T): Promise<T> {
  if (!isAnimWithoutMesh(loaded)) return loaded;
  const host = await loadHostKit();
  const bones = hostBoneMap(host);
  const clips = loaded.animations
    .map((c) => rematchClip(c, bones))
    .filter((c) => c.tracks.length > 0);
  host.name = GENERIC_GRUDGE_PREVIEW.id;
  host.userData.genericPreviewHost = {
    ...GENERIC_GRUDGE_PREVIEW,
    sourceClips: loaded.animations.map((c) => c.name),
    rematchedTracks: clips.reduce((n, c) => n + c.tracks.length, 0),
  };
  loaded.object = host;
  loaded.animations = clips.length ? clips : loaded.animations;
  loaded.format = "glb";
  return loaded;
}
