/**
 * Apply baked Grudge6 race atlas textures to race meshes.
 * CDN SSOT: https://assets.grudge-studio.com/textures/grudge6/{faction}/{file}.webp
 */
import * as THREE from "three";
import { raceTextureUrls, type RaceId } from "../../shared/grudge6Assets";

const _texLoader = new THREE.TextureLoader();
const _cache = new Map<string, THREE.Texture>();

function loadUrl(url: string): Promise<THREE.Texture | null> {
  const cached = _cache.get(url);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    _texLoader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;
        _cache.set(url, tex);
        resolve(tex);
      },
      undefined,
      () => resolve(null),
    );
  });
}

export async function applyGrudge6RaceTextures(
  root: THREE.Object3D,
  raceId: string,
): Promise<boolean> {
  const urls = raceTextureUrls(raceId as RaceId);
  let tex: THREE.Texture | null = null;
  for (const url of urls) {
    tex = await loadUrl(url);
    if (tex) break;
  }
  if (!tex) {
    console.warn(`[grudge6Textures] no atlas for race=${raceId}`, urls);
    return false;
  }

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (
        mat instanceof THREE.MeshStandardMaterial ||
        mat instanceof THREE.MeshPhongMaterial
      ) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
    }
  });
  return true;
}

export function ensureTextureColorSpace(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const m = mat as THREE.MeshStandardMaterial;
      if (m?.map) {
        m.map.colorSpace = THREE.SRGBColorSpace;
        m.needsUpdate = true;
      }
    }
  });
}
