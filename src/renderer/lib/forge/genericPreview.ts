import type * as THREE from "three";

type PreviewLoaded = { object: THREE.Object3D; animations: THREE.AnimationClip[]; triangles: number; format: string };
export function isAnimWithoutMesh(loaded: PreviewLoaded): boolean {
  let hasGeometry = false;
  loaded.object.traverse(n => { const m = n as THREE.Mesh; if (m.isMesh && m.geometry?.getAttribute("position")?.count >= 3) hasGeometry = true; });
  return loaded.animations.length > 0 && !hasGeometry;
}
/** Compatibility entrypoint: never fetch or substitute a library preview body. */
export async function bindGenericPreviewHost<T extends PreviewLoaded>(loaded: T): Promise<T> {
  if (isAnimWithoutMesh(loaded)) loaded.object.userData.animationPreviewMessage = "This animation contains no mesh. Select your own created asset; no sample body was loaded.";
  return loaded;
}
