import * as THREE from "three";

export interface MaterialSettings {
  color: string;
  metalness: number;
  roughness: number;
  emissive: string;
  emissiveIntensity: number;
  wireframe: boolean;
  mapUrl: string | null;
}

export const DEFAULT_MATERIAL: MaterialSettings = {
  color: "#c4a35a",
  metalness: 0.45,
  roughness: 0.55,
  emissive: "#000000",
  emissiveIntensity: 0,
  wireframe: false,
  mapUrl: null,
};

export function readMaterialSettings(mesh: THREE.Mesh): MaterialSettings {
  const mat = mesh.material;
  const m = (Array.isArray(mat) ? mat[0] : mat) as THREE.MeshStandardMaterial;
  if (!m || !("color" in m)) return { ...DEFAULT_MATERIAL };
  return {
    color: m.color ? `#${m.color.getHexString()}` : DEFAULT_MATERIAL.color,
    metalness: m.metalness ?? 0.5,
    roughness: m.roughness ?? 0.5,
    emissive: m.emissive ? `#${m.emissive.getHexString()}` : "#000000",
    emissiveIntensity: m.emissiveIntensity ?? 0,
    wireframe: m.wireframe ?? false,
    mapUrl: m.map?.userData?.sourceUrl ?? null,
  };
}

export function applyMaterialSettings(mesh: THREE.Mesh, settings: MaterialSettings): void {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const raw of mats) {
    const m = raw as THREE.MeshStandardMaterial;
    if (!m || !("color" in m)) continue;
    m.color.set(settings.color);
    m.metalness = settings.metalness;
    m.roughness = settings.roughness;
    if (m.emissive) m.emissive.set(settings.emissive);
    m.emissiveIntensity = settings.emissiveIntensity;
    m.wireframe = settings.wireframe;
    m.needsUpdate = true;
  }
}

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map<string, THREE.Texture>();

export async function applyTextureToMesh(mesh: THREE.Mesh, url: string): Promise<void> {
  let tex = textureCache.get(url);
  if (!tex) {
    tex = await textureLoader.loadAsync(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.userData.sourceUrl = url;
    textureCache.set(url, tex);
  }
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const raw of mats) {
    const m = raw as THREE.MeshStandardMaterial;
    if (!m || !("map" in m)) continue;
    m.map = tex;
    m.needsUpdate = true;
  }
}