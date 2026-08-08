/**
 * Smart texture discovery + apply for Forge materials.
 * Matches map files by mesh/material name tokens and standard PBR suffixes.
 */

import * as THREE from "three";
import { TGALoader } from "three/examples/jsm/loaders/TGALoader.js";

export type TextureRole =
  | "map"
  | "normalMap"
  | "roughnessMap"
  | "metalnessMap"
  | "aoMap"
  | "emissiveMap"
  | "alphaMap";

export interface TextureCandidate {
  url: string;
  name: string;
  role: TextureRole;
  score: number;
  /** Path or object key when known */
  key?: string;
}

export interface TextureMatchReport {
  meshName: string;
  materialName: string;
  applied: Array<{ role: TextureRole; name: string }>;
  skipped: string[];
}

export interface ApplySmartTexturesOptions {
  /**
   * When true (default for elite open), only fill roles that are missing or
   * broken — never overwrite a valid embedded / already-bound map.
   * Prevents wrong sibling textures from scrambling correct colors.
   */
  onlyMissingMaps?: boolean;
  /** Minimum name-affinity score before applying a map (default 1). */
  minAffinity?: number;
}

const ROLE_PATTERNS: Array<{ role: TextureRole; re: RegExp; weight: number }> = [
  { role: "map", re: /(?:^|[_\-.\s])(albedo|basecolor|base_color|diffuse|diff|color|col|alb)(?:$|[_\-.\s])/i, weight: 10 },
  { role: "normalMap", re: /(?:^|[_\-.\s])(normal|norm|nrm|nor)(?:$|[_\-.\s])/i, weight: 10 },
  { role: "roughnessMap", re: /(?:^|[_\-.\s])(roughness|rough|rgh)(?:$|[_\-.\s])/i, weight: 9 },
  { role: "metalnessMap", re: /(?:^|[_\-.\s])(metalness|metallic|metal|mtl)(?:$|[_\-.\s])/i, weight: 9 },
  { role: "aoMap", re: /(?:^|[_\-.\s])(ao|occlusion|ambientocclusion|ambient_occlusion)(?:$|[_\-.\s])/i, weight: 8 },
  { role: "emissiveMap", re: /(?:^|[_\-.\s])(emissive|emission|emit|glow)(?:$|[_\-.\s])/i, weight: 8 },
  { role: "alphaMap", re: /(?:^|[_\-.\s])(alpha|opacity|mask|transparency)(?:$|[_\-.\s])/i, weight: 7 },
  // Combined ORM / packed maps → roughness + metalness + ao heuristics
  { role: "roughnessMap", re: /(?:^|[_\-.\s])(orm|arm|roughmetal|metalrough)(?:$|[_\-.\s])/i, weight: 6 },
];

const IMAGE_EXT = /\.(png|jpe?g|webp|ktx2|basis|tga|bmp)$/i;

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function stem(filename: string): string {
  return basename(filename).replace(IMAGE_EXT, "");
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

function detectRole(filename: string): { role: TextureRole; weight: number } | null {
  const name = basename(filename);
  let best: { role: TextureRole; weight: number } | null = null;
  for (const p of ROLE_PATTERNS) {
    if (p.re.test(name) && (!best || p.weight > best.weight)) {
      best = { role: p.role, weight: p.weight };
    }
  }
  // Fallback: bare albedo-like if no role tag
  if (!best && IMAGE_EXT.test(name)) {
    best = { role: "map", weight: 2 };
  }
  return best;
}

function nameAffinity(fileStem: string, meshName: string, matName: string): number {
  const ft = new Set(tokens(fileStem));
  const mt = [...tokens(meshName), ...tokens(matName)];
  if (!mt.length) return 1.5; // bare folder textures still usable
  let hit = 0;
  for (const t of mt) {
    if (ft.has(t)) hit += 2;
    for (const f of ft) {
      if (f.includes(t) || t.includes(f)) hit += 0.5;
    }
  }
  // Bonus when texture stem equals mesh/file stem loosely
  const meshStem = tokens(meshName)[0];
  if (meshStem && ft.has(meshStem)) hit += 3;
  return hit;
}

/** Score a file path against a mesh/material for a given role. */
export function scoreTexturePath(
  path: string,
  meshName: string,
  matName: string,
): TextureCandidate | null {
  if (!IMAGE_EXT.test(path)) return null;
  const roleInfo = detectRole(path);
  if (!roleInfo) return null;
  const st = stem(path);
  const affinity = nameAffinity(st, meshName, matName);
  const score = roleInfo.weight + affinity * 3;
  return {
    url: path,
    name: basename(path),
    role: roleInfo.role,
    score,
    key: path,
  };
}

/** Rank texture paths for a mesh/material; best per role. */
export function findTexturesForMaterial(
  paths: string[],
  meshName: string,
  matName: string,
): Map<TextureRole, TextureCandidate> {
  const best = new Map<TextureRole, TextureCandidate>();
  for (const p of paths) {
    const c = scoreTexturePath(p, meshName, matName);
    if (!c) continue;
    const prev = best.get(c.role);
    if (!prev || c.score > prev.score) best.set(c.role, c);
  }
  return best;
}

const loader = new THREE.TextureLoader();
const tgaLoader = new TGALoader();

function looksLikeTga(url: string, nameHint?: string): boolean {
  const s = `${nameHint || ""} ${url}`.toLowerCase();
  return s.includes(".tga") || s.includes("image/targa") || s.includes("image/x-tga");
}

function loadTexture(
  url: string,
  nameHint?: string,
  role: TextureRole = "map",
): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const onOk = (tex: THREE.Texture) => {
      // Albedo/emissive = sRGB; data maps = linear (wrong space = muddy / inverted colors)
      const isColor =
        role === "map" || role === "emissiveMap";
      tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.flipY = false;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;
      resolve(tex);
    };
    if (looksLikeTga(url, nameHint)) {
      tgaLoader.load(url, onOk, undefined, (err) => reject(err));
      return;
    }
    // Prefer grudge-media for absolute disk paths so main process can fallback-search Textures/
    let fetchUrl = url;
    if (/^[A-Za-z]:[\\/]/.test(url) || url.startsWith("\\\\")) {
      fetchUrl = `grudge-media://local/?path=${encodeURIComponent(url.replace(/\//g, "\\"))}`;
    }
    loader.load(fetchUrl, onOk, undefined, (err) => reject(err));
  });
}

function mapIsUsable(tex: THREE.Texture | null | undefined): boolean {
  if (!tex) return false;
  const src = (tex as THREE.Texture & { source?: { data?: unknown } }).source;
  if (src?.data != null) {
    const data = src.data as { width?: number; height?: number };
    if (typeof data?.width === "number" && typeof data?.height === "number") {
      return data.width > 1 && data.height > 1;
    }
    return true;
  }
  const img = tex.image as {
    width?: number;
    height?: number;
    complete?: boolean;
    naturalWidth?: number;
    naturalHeight?: number;
  } | undefined;
  if (!img) return false;
  if (typeof img.complete === "boolean" && !img.complete) return true; // still loading
  const w = img.naturalWidth || img.width || 0;
  const h = img.naturalHeight || img.height || 0;
  return w > 1 && h > 1;
}

function ensureStandard(mesh: THREE.Mesh): THREE.MeshStandardMaterial[] {
  const raw = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const out: THREE.MeshStandardMaterial[] = [];
  raw.forEach((m, idx) => {
    if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
      out.push(m as THREE.MeshStandardMaterial);
      return;
    }
    const basic = m as THREE.MeshBasicMaterial;
    const std = new THREE.MeshStandardMaterial({
      color: basic.color?.clone?.() ?? new THREE.Color(0xcccccc),
      map: basic.map,
      transparent: basic.transparent,
      opacity: basic.opacity ?? 1,
      metalness: 0.1,
      roughness: 0.75,
      name: basic.name || mesh.name || "Material",
    });
    if (Array.isArray(mesh.material)) mesh.material[idx] = std;
    else mesh.material = std;
    basic.dispose?.();
    out.push(std);
  });
  return out;
}

/**
 * Apply best-matching maps from a pool of URLs/paths onto every mesh under root.
 * `resolveUrl` converts a path/key into a fetchable URL (identity for blob/http).
 */
export async function applySmartTextures(
  root: THREE.Object3D,
  texturePaths: string[],
  resolveUrl: (path: string) => string | Promise<string> = (p) => p,
  opts: ApplySmartTexturesOptions = {},
): Promise<TextureMatchReport[]> {
  const onlyMissing = opts.onlyMissingMaps !== false; // default: protect good maps
  const minAffinity = opts.minAffinity ?? 1;
  const reports: TextureMatchReport[] = [];
  const meshList: THREE.Mesh[] = [];
  root.traverse((n) => {
    const m = n as THREE.Mesh;
    if (m.isMesh) meshList.push(m);
  });

  for (const mesh of meshList) {
    const mats = ensureStandard(mesh);
    for (const mat of mats) {
      const meshName = mesh.name || "mesh";
      const matName = mat.name || meshName;
      const matches = findTexturesForMaterial(texturePaths, meshName, matName);
      const applied: TextureMatchReport["applied"] = [];
      const skipped: string[] = [];

      // If base color already looks good and onlyMissing — skip entire material
      // unless some PBR slots are empty (still fill those).
      for (const [role, cand] of matches) {
        // Reject weak bare-folder matches that would paint random images
        if (cand.score < 4 + minAffinity && role === "map" && mapIsUsable(mat.map)) {
          skipped.push(`${cand.name}(weak-keep-existing)`);
          continue;
        }
        if (onlyMissing) {
          const existing = (mat as any)[role] as THREE.Texture | null | undefined;
          if (mapIsUsable(existing)) {
            skipped.push(`${cand.name}(keep-existing-${role})`);
            continue;
          }
        }
        // Require some name affinity for non-map roles; for map require score ≥ 5
        // unless material has zero maps at all
        const needsMap = !mapIsUsable(mat.map);
        if (role === "map" && cand.score < (needsMap ? 3 : 8)) {
          skipped.push(`${cand.name}(low-score)`);
          continue;
        }
        try {
          const url = await resolveUrl(cand.url);
          const tex = await loadTexture(url, cand.name, role);
          if (role === "normalMap") {
            mat.normalMap = tex;
            mat.normalScale = new THREE.Vector2(1, 1);
          } else if (role === "roughnessMap") {
            mat.roughnessMap = tex;
            mat.roughness = 1;
          } else if (role === "metalnessMap") {
            mat.metalnessMap = tex;
            mat.metalness = 1;
          } else if (role === "aoMap") {
            mat.aoMap = tex;
            mat.aoMapIntensity = 1;
            // aoMap needs uv2 — duplicate uv if missing
            const geo = mesh.geometry as THREE.BufferGeometry;
            if (geo && !geo.getAttribute("uv2") && geo.getAttribute("uv")) {
              geo.setAttribute("uv2", geo.getAttribute("uv"));
            }
          } else if (role === "emissiveMap") {
            mat.emissiveMap = tex;
            mat.emissive = new THREE.Color(0xffffff);
          } else if (role === "alphaMap") {
            mat.alphaMap = tex;
            mat.transparent = true;
          } else {
            mat.map = tex;
            // Albedo in map — keep base color white so atlas colors are true
            mat.color?.setHex?.(0xffffff);
          }
          mat.needsUpdate = true;
          applied.push({ role, name: cand.name });
        } catch {
          skipped.push(cand.name);
        }
      }
      if (applied.length || skipped.length) {
        reports.push({ meshName, materialName: matName, applied, skipped });
      }
    }
  }
  return reports;
}

/** Collect image-like keys from an object-store / folder listing. */
export function filterImagePaths(paths: string[]): string[] {
  return paths.filter((p) => IMAGE_EXT.test(p));
}

/**
 * Guess sibling texture folder keys from a model path.
 * e.g. models/hero/hero.glb → models/hero/, models/hero/textures/, models/textures/
 */
export function siblingTexturePrefixes(modelPath: string): string[] {
  const norm = modelPath.replace(/\\/g, "/");
  const dir = norm.includes("/") ? norm.slice(0, norm.lastIndexOf("/") + 1) : "";
  const parent = dir.replace(/\/[^/]+\/$/, "/");
  return [
    `${dir}textures/`,
    `${dir}Maps/`,
    `${dir}maps/`,
    dir,
    `${parent}textures/`,
  ].filter(Boolean);
}
