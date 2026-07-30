/**
 * Fix imported materials + auto-wire local textures so assets are not
 * forced to gold/yellow and keep real albedo from folder-side maps.
 */

import * as THREE from "three";
import {
  applySmartTextures,
  filterImagePaths,
  type TextureMatchReport,
} from "./textureFinder";

/** Grudge gold used by paint UI — do not force this onto imports. */
const GRUDGE_GOLD = 0xffc62a;

function isNearGold(hex: number): boolean {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  // high R+G, low B, or exact brand gold
  if (hex === GRUDGE_GOLD) return true;
  return r > 180 && g > 140 && b < 100 && r >= g;
}

export interface MaterialSanitizeStats {
  meshes: number;
  materials: number;
  goldNeutralized: number;
  mapsPreserved: number;
  vertexColorEnabled: number;
}

/**
 * After load: preserve file colors/maps, neutralize accidental gold defaults,
 * enable vertex colors when present, white base when albedo map exists.
 */
export function sanitizeImportedMaterials(root: THREE.Object3D): MaterialSanitizeStats {
  const stats: MaterialSanitizeStats = {
    meshes: 0,
    materials: 0,
    goldNeutralized: 0,
    mapsPreserved: 0,
    vertexColorEnabled: 0,
  };

  root.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    stats.meshes++;

    const hasVertexColor = Boolean(mesh.geometry.getAttribute("color"));
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    for (let i = 0; i < mats.length; i++) {
      let mat = mats[i] as THREE.Material;
      if (!mat) continue;
      stats.materials++;

      // Upgrade MeshBasic / Phong → Standard without losing color/map
      if ((mat as THREE.MeshBasicMaterial).isMeshBasicMaterial) {
        const basic = mat as THREE.MeshBasicMaterial;
        const std = new THREE.MeshStandardMaterial({
          color: basic.color?.clone?.() ?? new THREE.Color(0xcccccc),
          map: basic.map,
          transparent: basic.transparent,
          opacity: basic.opacity,
          side: basic.side,
          name: basic.name || mesh.name || "Material",
          metalness: 0.05,
          roughness: 0.75,
          vertexColors: hasVertexColor || basic.vertexColors,
        });
        if (Array.isArray(mesh.material)) mesh.material[i] = std;
        else mesh.material = std;
        basic.dispose();
        mat = std;
      } else if ((mat as THREE.MeshPhongMaterial).isMeshPhongMaterial) {
        const phong = mat as THREE.MeshPhongMaterial;
        const std = new THREE.MeshStandardMaterial({
          color: phong.color?.clone?.() ?? new THREE.Color(0xcccccc),
          map: phong.map,
          normalMap: phong.normalMap,
          emissive: phong.emissive?.clone?.() ?? new THREE.Color(0),
          emissiveMap: phong.emissiveMap,
          transparent: phong.transparent,
          opacity: phong.opacity,
          side: phong.side,
          name: phong.name || mesh.name || "Material",
          metalness: 0.1,
          roughness: 1 - Math.min(1, phong.shininess / 100),
          vertexColors: hasVertexColor || phong.vertexColors,
        });
        if (Array.isArray(mesh.material)) mesh.material[i] = std;
        else mesh.material = std;
        phong.dispose();
        mat = std;
      }

      const std = mat as THREE.MeshStandardMaterial;
      if (!std.isMeshStandardMaterial && !(std as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
        continue;
      }

      if (hasVertexColor && !std.vertexColors) {
        std.vertexColors = true;
        stats.vertexColorEnabled++;
      }

      if (std.map) {
        stats.mapsPreserved++;
        // PBR: albedo lives in the map — base color should be white
        if (std.color) std.color.setHex(0xffffff);
      } else if (std.color) {
        const hex = std.color.getHex();
        // Don't leave accidental brand-gold on textureless imports
        if (isNearGold(hex) && !std.emissiveMap) {
          std.color.setHex(0xc8c8c8);
          stats.goldNeutralized++;
        }
      }

      // Clear strong gold emissive leftovers (e.g. selection pulse stuck)
      if (std.emissive && isNearGold(std.emissive.getHex()) && !std.emissiveMap) {
        std.emissive.setHex(0x000000);
        std.emissiveIntensity = 0;
      }

      std.needsUpdate = true;
    }
  });

  return stats;
}

/**
 * Resolve diskPath folder textures and apply via smart matcher.
 * Prefer same folder / pack root over fleet CDN.
 */
export async function autoApplyLocalTextures(
  root: THREE.Object3D,
  diskPath: string | null | undefined,
): Promise<{ reports: TextureMatchReport[]; filesTried: number; dirs: number }> {
  if (!diskPath || !window.grudge?.forge?.listSiblingTextures) {
    return { reports: [], filesTried: 0, dirs: 0 };
  }

  const listing = await window.grudge.forge.listSiblingTextures(diskPath);
  const paths = listing.files.map((f: { path: string }) => f.path);
  const images = filterImagePaths(paths);
  if (!images.length) {
    return { reports: [], filesTried: 0, dirs: listing.searchDirs?.length ?? 0 };
  }

  // Prefer images in the same directory as the model (score higher via path)
  const modelDir = (listing.modelDir || "").replace(/\\/g, "/").toLowerCase();
  const ordered = [...images].sort((a, b) => {
    const aLocal = a.replace(/\\/g, "/").toLowerCase().startsWith(modelDir) ? 0 : 1;
    const bLocal = b.replace(/\\/g, "/").toLowerCase().startsWith(modelDir) ? 0 : 1;
    return aLocal - bLocal;
  });

  const reports = await applySmartTextures(root, ordered, async (absPath) => {
    // Load via main process → data URL (works without file:// privileges)
    if (window.grudge.forge.readLocalImage) {
      const img = await window.grudge.forge.readLocalImage(absPath);
      return img.dataUrl;
    }
    return absPath;
  });

  return {
    reports,
    filesTried: ordered.length,
    dirs: listing.searchDirs?.length ?? 0,
  };
}

/** One-shot after model load: sanitize colors then local maps. */
export async function finishImportedAsset(
  root: THREE.Object3D,
  diskPath: string | null | undefined,
): Promise<{
  sanitize: MaterialSanitizeStats;
  textures: { reports: TextureMatchReport[]; filesTried: number; dirs: number };
}> {
  const sanitize = sanitizeImportedMaterials(root);
  const textures = await autoApplyLocalTextures(root, diskPath);
  // After maps applied, re-white base colors where maps landed
  sanitizeImportedMaterials(root);
  return { sanitize, textures };
}
