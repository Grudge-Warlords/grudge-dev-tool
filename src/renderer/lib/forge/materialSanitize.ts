/**
 * Material / texture sanitization for Grudge Dev Tool loaders & viewers.
 *
 * Fixes the most common yellow / black / sludge assets on import:
 *  - Missing atlas → FBX default yellow-ish Phong
 *  - Broken 1×1 / empty maps → pure black or grey
 *  - Wrong colorSpace (linear vs sRGB) on baseColor
 *  - metalness=1 with no env → black silhouettes
 *  - flipY wrong for GLB-embedded vs FBX external atlases
 *  - MeshBasic/Phong without conversion looking unlit black
 *
 * SSOT aligned with grudge-character-correctness + threejs-textures.
 */

import * as THREE from "three";

export interface MaterialSanitizeOptions {
  /** Source format hint — affects flipY defaults. */
  format?: "glb" | "gltf" | "fbx" | "obj" | "other";
  /** Prefer toon/polyart look: metalness 0, higher roughness. */
  toonStyle?: boolean;
  /** Replace pure default yellow / sludge when no map. */
  fixDefaultYellow?: boolean;
  /** Cap metalness so assets don't go pure black without IBL. */
  maxMetalness?: number;
  /** Force map color to white when a color map is present (multiply fix). */
  whiteWhenMapped?: boolean;
}

export interface MaterialIssue {
  meshName: string;
  materialName: string;
  code:
    | "missing-map"
    | "broken-map"
    | "default-yellow"
    | "pure-black"
    | "high-metalness"
    | "colorspace"
    | "converted-basic"
    | "vertex-colors";
  detail: string;
  fixed: boolean;
}

export interface MaterialSanitizeReport {
  meshes: number;
  materials: number;
  fixed: number;
  issues: MaterialIssue[];
}

const YELLOW_SLUDGE = new THREE.Color(0xffc62a);
const DEFAULT_GREY = new THREE.Color(0xc8c8c8);
const WHITE = new THREE.Color(0xffffff);

function isApproxColor(c: THREE.Color | undefined, target: THREE.Color, eps = 0.08): boolean {
  if (!c) return false;
  return (
    Math.abs(c.r - target.r) < eps &&
    Math.abs(c.g - target.g) < eps &&
    Math.abs(c.b - target.b) < eps
  );
}

/** Unity/FBX default often lands near (1, 0.8, 0) or pure yellow. */
function looksLikeDefaultYellow(c: THREE.Color | undefined): boolean {
  if (!c) return false;
  // High R+G, low B, fairly bright
  if (c.r > 0.85 && c.g > 0.55 && c.b < 0.35 && (c.r + c.g) / 2 > 0.7) return true;
  if (isApproxColor(c, YELLOW_SLUDGE, 0.12)) return true;
  // Classic Three MeshPhong default-ish orange-yellow
  if (c.r > 0.9 && c.g > 0.7 && c.b < 0.2) return true;
  return false;
}

function looksPureBlack(c: THREE.Color | undefined): boolean {
  if (!c) return false;
  return c.r < 0.02 && c.g < 0.02 && c.b < 0.02;
}

function isBrokenMap(tex: THREE.Texture | null | undefined): boolean {
  if (!tex) return true;
  const img = tex.image as { width?: number; height?: number } | undefined;
  if (!img) return true;
  const w = img.width ?? 0;
  const h = img.height ?? 0;
  // 0 or 1×1 placeholder from failed decode
  if (w <= 1 && h <= 1) return true;
  return false;
}

function configureColorMap(tex: THREE.Texture, format?: string): void {
  tex.colorSpace = THREE.SRGBColorSpace;
  // glTF embeds already flip correctly; FBX external often need flipY=false for atlases
  if (format === "fbx") tex.flipY = false;
  else if (format === "glb" || format === "gltf") {
    // GLTFLoader already sets flipY=false for baseColor; keep it
    tex.flipY = false;
  }
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
}

function configureDataMap(tex: THREE.Texture): void {
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = false;
  tex.needsUpdate = true;
}

function ensureStandard(
  mesh: THREE.Mesh,
  mat: THREE.Material,
  idx: number,
  issues: MaterialIssue[],
): THREE.MeshStandardMaterial {
  if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    return mat as THREE.MeshStandardMaterial;
  }
  if ((mat as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
    return mat as THREE.MeshStandardMaterial;
  }

  const any = mat as THREE.MeshPhongMaterial & THREE.MeshBasicMaterial & THREE.MeshLambertMaterial;
  const std = new THREE.MeshStandardMaterial({
    name: mat.name || mesh.name || "Material",
    color: any.color?.clone?.() ?? DEFAULT_GREY.clone(),
    map: any.map ?? null,
    normalMap: (any as THREE.MeshPhongMaterial).normalMap ?? null,
    aoMap: (any as any).aoMap ?? null,
    emissiveMap: (any as THREE.MeshPhongMaterial).emissiveMap ?? null,
    emissive: (any as THREE.MeshPhongMaterial).emissive?.clone?.() ?? new THREE.Color(0x000000),
    transparent: mat.transparent,
    opacity: mat.opacity,
    side: mat.side,
    alphaTest: mat.alphaTest,
    depthWrite: mat.depthWrite,
    metalness: 0.05,
    roughness: 0.75,
    vertexColors: !!(any as any).vertexColors,
  });
  // r152+: skinning lives on the mesh; morph flags on material when supported
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
    (std as any).skinning = true;
  }
  if ((any as any).morphTargets) (std as any).morphTargets = true;
  if ((any as any).morphNormals) (std as any).morphNormals = true;

  if (Array.isArray(mesh.material)) mesh.material[idx] = std;
  else mesh.material = std;
  mat.dispose?.();

  issues.push({
    meshName: mesh.name || "mesh",
    materialName: std.name,
    code: "converted-basic",
    detail: `Converted ${mat.type} → MeshStandardMaterial`,
    fixed: true,
  });
  return std;
}

/**
 * Walk an Object3D tree and normalize materials/textures for correct rendering.
 * Mutates in place. Safe to call multiple times (idempotent-ish).
 */
export function sanitizeMaterials(
  root: THREE.Object3D,
  opts: MaterialSanitizeOptions = {},
): MaterialSanitizeReport {
  const format = opts.format ?? "other";
  const toon = opts.toonStyle !== false; // default on for Grudge polyart packs
  const fixYellow = opts.fixDefaultYellow !== false;
  const maxMetal = opts.maxMetalness ?? (toon ? 0.25 : 0.85);
  const whiteWhenMapped = opts.whiteWhenMapped !== false;

  const issues: MaterialIssue[] = [];
  let meshCount = 0;
  let matCount = 0;
  let fixed = 0;

  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    meshCount++;

    // Skinned / morph: keep on for correct animation + texture deformation
    const skinned = mesh as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      skinned.frustumCulled = false;
      if (skinned.skeleton) skinned.skeleton.pose();
    }

    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    list.forEach((raw, idx) => {
      if (!raw) return;
      matCount++;
      const mat = ensureStandard(mesh, raw, idx, issues);

      // --- maps colorSpace / flipY ---
      if (mat.map) {
        if (isBrokenMap(mat.map)) {
          issues.push({
            meshName: mesh.name || "mesh",
            materialName: mat.name,
            code: "broken-map",
            detail: "Base color map is empty or 1×1 — stripped",
            fixed: true,
          });
          mat.map.dispose?.();
          mat.map = null;
          fixed++;
        } else {
          const before = mat.map.colorSpace;
          configureColorMap(mat.map, format);
          if (before !== THREE.SRGBColorSpace) {
            issues.push({
              meshName: mesh.name || "mesh",
              materialName: mat.name,
              code: "colorspace",
              detail: `baseColor colorSpace → sRGB (was ${before})`,
              fixed: true,
            });
            fixed++;
          }
        }
      }

      for (const key of [
        "normalMap",
        "roughnessMap",
        "metalnessMap",
        "aoMap",
        "bumpMap",
        "displacementMap",
        "alphaMap",
      ] as const) {
        const tex = (mat as any)[key] as THREE.Texture | null;
        if (!tex) continue;
        if (isBrokenMap(tex)) {
          (mat as any)[key] = null;
          tex.dispose?.();
          fixed++;
          continue;
        }
        configureDataMap(tex);
      }

      if (mat.emissiveMap && !isBrokenMap(mat.emissiveMap)) {
        configureColorMap(mat.emissiveMap, format);
      } else if (mat.emissiveMap && isBrokenMap(mat.emissiveMap)) {
        mat.emissiveMap.dispose?.();
        mat.emissiveMap = null;
      }

      // --- vertex colors ---
      const geo = mesh.geometry as THREE.BufferGeometry | undefined;
      const hasVCol = !!(geo && geo.getAttribute("color"));
      if (hasVCol && !mat.vertexColors) {
        mat.vertexColors = true;
        issues.push({
          meshName: mesh.name || "mesh",
          materialName: mat.name,
          code: "vertex-colors",
          detail: "Enabled vertexColors (geometry has color attr)",
          fixed: true,
        });
        fixed++;
      }

      // --- yellow sludge without map ---
      if (fixYellow && !mat.map && looksLikeDefaultYellow(mat.color)) {
        mat.color.copy(DEFAULT_GREY);
        issues.push({
          meshName: mesh.name || "mesh",
          materialName: mat.name,
          code: "default-yellow",
          detail: "Replaced default yellow/sludge with neutral grey (no atlas)",
          fixed: true,
        });
        fixed++;
      }

      // --- pure black body ---
      if (!mat.map && looksPureBlack(mat.color) && !mat.emissiveMap) {
        mat.color.copy(DEFAULT_GREY);
        issues.push({
          meshName: mesh.name || "mesh",
          materialName: mat.name,
          code: "pure-black",
          detail: "Replaced pure black material color with grey",
          fixed: true,
        });
        fixed++;
      }

      // --- multiply map by non-white color washes wrong ---
      if (whiteWhenMapped && mat.map && !looksPureBlack(mat.color) && !isApproxColor(mat.color, WHITE, 0.05)) {
        // Keep intentional tints that aren't sludge; only reset yellow/black extremes
        if (looksLikeDefaultYellow(mat.color) || looksPureBlack(mat.color)) {
          mat.color.copy(WHITE);
          fixed++;
        }
      } else if (whiteWhenMapped && mat.map) {
        // Standard PBR: map * color; prefer white so atlas shows true colors
        if (!mat.userData?.grudgeKeepTint) {
          mat.color.copy(WHITE);
        }
      }

      // --- metalness black-hole ---
      if (typeof mat.metalness === "number" && mat.metalness > maxMetal) {
        issues.push({
          meshName: mesh.name || "mesh",
          materialName: mat.name,
          code: "high-metalness",
          detail: `metalness ${mat.metalness.toFixed(2)} → ${maxMetal} (avoid black silhouettes)`,
          fixed: true,
        });
        mat.metalness = maxMetal;
        fixed++;
      }

      if (toon) {
        if (mat.metalness > 0.15 && !mat.metalnessMap) mat.metalness = Math.min(mat.metalness, 0.12);
        if (mat.roughness < 0.35 && !mat.roughnessMap) mat.roughness = 0.65;
      }

      // aoMap needs uv2
      if (mat.aoMap && geo && !geo.getAttribute("uv2") && geo.getAttribute("uv")) {
        geo.setAttribute("uv2", geo.getAttribute("uv"));
      }

      if (!mat.map && !mat.vertexColors && !hasVCol) {
        issues.push({
          meshName: mesh.name || "mesh",
          materialName: mat.name,
          code: "missing-map",
          detail: "No baseColor map — use Apply textures / re-bake with atlas",
          fixed: false,
        });
      }

      mat.needsUpdate = true;
    });
  });

  return { meshes: meshCount, materials: matCount, fixed, issues };
}

/**
 * Bind a single atlas texture onto all meshes under root (grudge6 race pattern).
 * color=white, metalness=0, roughness≈0.75, flipY=false, sRGB.
 */
export async function bindAtlasToRoot(
  root: THREE.Object3D,
  atlasUrl: string,
  opts?: { flipY?: boolean; roughness?: number },
): Promise<void> {
  const loader = new THREE.TextureLoader();
  const map = await new Promise<THREE.Texture>((resolve, reject) => {
    loader.load(atlasUrl, resolve, undefined, reject);
  });
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = opts?.flipY ?? false;
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  map.needsUpdate = true;

  const roughness = opts?.roughness ?? 0.75;
  root.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m, i) => {
      if (!m) return;
      let std: THREE.MeshStandardMaterial;
      if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        std = m as THREE.MeshStandardMaterial;
      } else {
        std = new THREE.MeshStandardMaterial({ name: m.name });
        if (Array.isArray(mesh.material)) mesh.material[i] = std;
        else mesh.material = std;
        m.dispose?.();
      }
      std.map = map;
      std.color.copy(WHITE);
      std.metalness = 0;
      std.roughness = roughness;
      std.needsUpdate = true;
    });
  });
}
