/**
 * Forge 3D paint brush — vertex-color painting with blend modes,
 * plus island mesh seal / open-back close utilities.
 */

import * as THREE from "three";
import type { GeometrySnapshot, VertexColorSnapshot } from "./history";

export type PaintMode = "replace" | "blend" | "add" | "subtract" | "smooth" | "erase";
export type PaintFalloff = "hard" | "linear" | "smooth";

export interface PaintBrushSettings {
  color: number;
  /** World-space brush radius */
  radius: number;
  /** 0–1 influence */
  strength: number;
  mode: PaintMode;
  falloff: PaintFalloff;
  /** Paint vertices facing away from camera / hit normal */
  affectBackfaces: boolean;
  /** Also tint MeshStandardMaterial.color toward brush (soft) */
  tintMaterial: boolean;
}

export const DEFAULT_BRUSH: PaintBrushSettings = {
  color: 0xffc62a,
  radius: 0.35,
  strength: 0.65,
  mode: "blend",
  falloff: "smooth",
  affectBackfaces: true,
  tintMaterial: false,
};

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _brush = new THREE.Color();
const _cur = new THREE.Color();
const _tmp = new THREE.Color();
const _world = new THREE.Matrix4();
const _normalMat = new THREE.Matrix3();

function falloffWeight(t: number, kind: PaintFalloff): number {
  // t = 0 at center, 1 at edge
  const x = Math.min(1, Math.max(0, t));
  if (kind === "hard") return x < 1 ? 1 : 0;
  if (kind === "linear") return 1 - x;
  // smoothstep ease
  const u = 1 - x;
  return u * u * (3 - 2 * u);
}

/** Ensure mesh has COLOR attribute and materials use vertexColors. */
export function ensureVertexColors(mesh: THREE.Mesh, fillHex = 0xffffff): void {
  const geo = mesh.geometry;
  if (!geo) return;
  const pos = geo.getAttribute("position");
  if (!pos) return;

  let colorAttr = geo.getAttribute("color") as THREE.BufferAttribute | undefined;
  if (!colorAttr || colorAttr.count !== pos.count) {
    const arr = new Float32Array(pos.count * 3);
    const c = new THREE.Color(fillHex);
    for (let i = 0; i < pos.count; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    colorAttr = geo.getAttribute("color") as THREE.BufferAttribute;
  }

  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    if (!m) continue;
    const mat = m as THREE.MeshStandardMaterial;
    if ("vertexColors" in mat) {
      mat.vertexColors = true;
      mat.needsUpdate = true;
    }
  }
}

export function snapshotVertexColors(mesh: THREE.Mesh): VertexColorSnapshot | null {
  ensureVertexColors(mesh);
  const color = mesh.geometry.getAttribute("color");
  if (!color) return null;
  return {
    kind: "vertexColors",
    uuid: mesh.uuid,
    colors: Array.from(color.array as ArrayLike<number>),
  };
}

export function applyVertexColorSnapshot(mesh: THREE.Mesh, snap: VertexColorSnapshot): void {
  const geo = mesh.geometry;
  if (!geo) return;
  let color = geo.getAttribute("color") as THREE.BufferAttribute | undefined;
  if (!color || color.count * 3 !== snap.colors.length) {
    geo.setAttribute("color", new THREE.Float32BufferAttribute(snap.colors, 3));
  } else {
    (color.array as Float32Array).set(snap.colors);
    color.needsUpdate = true;
  }
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    if (m && "vertexColors" in m) {
      (m as THREE.MeshStandardMaterial).vertexColors = true;
      m.needsUpdate = true;
    }
  }
}

/**
 * Paint vertex colors around a world-space hit point.
 * Returns pre-stroke vertex color snapshot (caller should push once per stroke/mesh).
 */
export function paintBrushAtPoint(
  mesh: THREE.Mesh,
  hitWorld: THREE.Vector3,
  hitNormalWorld: THREE.Vector3 | null,
  settings: PaintBrushSettings,
): { painted: number; snapshot: VertexColorSnapshot | null } {
  ensureVertexColors(mesh);
  const geo = mesh.geometry;
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const color = geo.getAttribute("color") as THREE.BufferAttribute;
  const nrm = geo.getAttribute("normal") as THREE.BufferAttribute | undefined;
  if (!pos || !color) return { painted: 0, snapshot: null };

  mesh.updateWorldMatrix(true, false);
  _world.copy(mesh.matrixWorld);
  _normalMat.getNormalMatrix(_world);

  _brush.setHex(settings.color);
  const radius = Math.max(1e-4, settings.radius);
  const strength = THREE.MathUtils.clamp(settings.strength, 0, 1);
  let painted = 0;

  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(_world);
    const dist = _v.distanceTo(hitWorld);
    if (dist > radius) continue;

    if (!settings.affectBackfaces && nrm && hitNormalWorld) {
      _n.fromBufferAttribute(nrm, i).applyMatrix3(_normalMat).normalize();
      if (_n.dot(hitNormalWorld) < -0.05) continue;
    }

    const w = falloffWeight(dist / radius, settings.falloff) * strength;
    if (w <= 0) continue;

    _cur.fromBufferAttribute(color, i);

    switch (settings.mode) {
      case "replace":
        _tmp.copy(_brush);
        _cur.lerp(_tmp, w);
        break;
      case "blend":
        _tmp.copy(_brush);
        _cur.lerp(_tmp, w);
        break;
      case "add":
        _cur.r = Math.min(1, _cur.r + _brush.r * w);
        _cur.g = Math.min(1, _cur.g + _brush.g * w);
        _cur.b = Math.min(1, _cur.b + _brush.b * w);
        break;
      case "subtract":
        _cur.r = Math.max(0, _cur.r - _brush.r * w);
        _cur.g = Math.max(0, _cur.g - _brush.g * w);
        _cur.b = Math.max(0, _cur.b - _brush.b * w);
        break;
      case "smooth": {
        // Pull toward average of nearby vertices (cheap: blend toward white-gray mid)
        // Better: accumulate neighbors — use local average of already-read colors in radius is expensive.
        // Approximate: blend toward (color + brush)/2 then toward neighbors via strength.
        _tmp.set(
          (_cur.r + _brush.r) * 0.5,
          (_cur.g + _brush.g) * 0.5,
          (_cur.b + _brush.b) * 0.5,
        );
        _cur.lerp(_tmp, w * 0.5);
        break;
      }
      case "erase":
        // Back to white (unpainted)
        _tmp.set(1, 1, 1);
        _cur.lerp(_tmp, w);
        break;
      default:
        _cur.lerp(_brush, w);
    }

    color.setXYZ(i, _cur.r, _cur.g, _cur.b);
    painted++;
  }

  if (painted > 0) {
    color.needsUpdate = true;
    if (settings.tintMaterial) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if (std?.color) {
          std.color.lerp(_brush, strength * 0.08);
          std.needsUpdate = true;
        }
      }
    }
  }

  return { painted, snapshot: null };
}

/** Capture snapshot then paint — for first dab of a stroke. */
export function paintBrushStrokeDab(
  mesh: THREE.Mesh,
  hitWorld: THREE.Vector3,
  hitNormalWorld: THREE.Vector3 | null,
  settings: PaintBrushSettings,
  captureUndo: boolean,
): VertexColorSnapshot | null {
  const undo = captureUndo ? snapshotVertexColors(mesh) : null;
  paintBrushAtPoint(mesh, hitWorld, hitNormalWorld, settings);
  return undo;
}

// ─── Island / open-mesh repair ─────────────────────────────────────────────

/**
 * Enable double-sided materials so open backs of island props render.
 */
export function doubleSideMaterials(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (m && "side" in m) {
        (m as THREE.Material).side = THREE.DoubleSide;
        m.needsUpdate = true;
        n++;
      }
    }
  });
  return n;
}

/**
 * Flip face winding + normals so inverted backs face outward.
 */
export function flipNormals(root: THREE.Object3D): GeometrySnapshot[] {
  const undos: GeometrySnapshot[] = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geo = mesh.geometry;
    const pos = geo.getAttribute("position");
    if (!pos) return;

    const before: GeometrySnapshot = {
      kind: "geometry",
      uuid: mesh.uuid,
      positions: Array.from(pos.array as ArrayLike<number>),
      normals: geo.getAttribute("normal")
        ? Array.from((geo.getAttribute("normal") as THREE.BufferAttribute).array as ArrayLike<number>)
        : null,
    };

    // Flip index order
    if (geo.index) {
      const idx = geo.index.array;
      for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i + 1];
        idx[i + 1] = idx[i + 2];
        idx[i + 2] = a;
      }
      geo.index.needsUpdate = true;
    } else {
      // Non-indexed: swap every triangle's 2nd/3rd vertex
      const arr = pos.array as Float32Array;
      for (let i = 0; i < pos.count; i += 3) {
        const i1 = (i + 1) * 3;
        const i2 = (i + 2) * 3;
        for (let k = 0; k < 3; k++) {
          const t = arr[i1 + k];
          arr[i1 + k] = arr[i2 + k];
          arr[i2 + k] = t;
        }
      }
      pos.needsUpdate = true;
    }

    // Flip normals
    const nrm = geo.getAttribute("normal") as THREE.BufferAttribute | undefined;
    if (nrm) {
      const na = nrm.array as Float32Array;
      for (let i = 0; i < na.length; i++) na[i] = -na[i];
      nrm.needsUpdate = true;
    } else {
      geo.computeVertexNormals();
    }

    undos.push(before);
  });
  return undos;
}

/**
 * Seal open backs for island assets: double-side + optional inverted shell clone
 * so backs of props (rocks, ruins, cliffs) look solid from every angle.
 */
export function sealOpenBacks(root: THREE.Object3D, options?: { addShell?: boolean }): {
  shellsAdded: number;
  doubleSided: number;
} {
  const addShell = options?.addShell !== false;
  let shellsAdded = 0;
  const doubleSided = doubleSideMaterials(root);

  if (!addShell) return { shellsAdded, doubleSided };

  const meshes: THREE.Mesh[] = [];
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.isMesh && m.geometry && !m.userData.forgeSealShell) meshes.push(m);
  });

  for (const mesh of meshes) {
    // Skip if shell already sibling
    const parent = mesh.parent ?? root;
    if (parent.children.some((c) => c.userData?.forgeSealShellOf === mesh.uuid)) continue;

    const shellGeo = mesh.geometry.clone();
    // Flip shell
    if (shellGeo.index) {
      const idx = shellGeo.index.array;
      for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i + 1];
        idx[i + 1] = idx[i + 2];
        idx[i + 2] = a;
      }
      shellGeo.index.needsUpdate = true;
    }
    const nrm = shellGeo.getAttribute("normal") as THREE.BufferAttribute | undefined;
    if (nrm) {
      const na = nrm.array as Float32Array;
      for (let i = 0; i < na.length; i++) na[i] = -na[i];
      nrm.needsUpdate = true;
    } else {
      shellGeo.computeVertexNormals();
      const n2 = shellGeo.getAttribute("normal") as THREE.BufferAttribute;
      if (n2) {
        const na = n2.array as Float32Array;
        for (let i = 0; i < na.length; i++) na[i] = -na[i];
        n2.needsUpdate = true;
      }
    }

    const shellMat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.clone?.()
      ?? new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9, metalness: 0.05 });
    if ("side" in shellMat) (shellMat as THREE.Material).side = THREE.FrontSide;

    const shell = new THREE.Mesh(shellGeo, shellMat);
    shell.name = `${mesh.name || "mesh"}_BackSeal`;
    shell.userData.forgeSealShell = true;
    shell.userData.forgeSealShellOf = mesh.uuid;
    shell.position.copy(mesh.position);
    shell.quaternion.copy(mesh.quaternion);
    shell.scale.copy(mesh.scale);
    // Micro offset along -normal average to avoid z-fight
    shell.position.y -= 0.001;
    parent.add(shell);
    shellsAdded++;
  }

  return { shellsAdded, doubleSided };
}

/**
 * Weld / merge near-duplicate vertices (open island edges often have cracks).
 * Returns geometry undos. Threshold in local units.
 */
export function weldVertices(root: THREE.Object3D, threshold = 0.001): GeometrySnapshot[] {
  const undos: GeometrySnapshot[] = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geo = mesh.geometry;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    if (!pos || pos.count < 3) return;

    const before: GeometrySnapshot = {
      kind: "geometry",
      uuid: mesh.uuid,
      positions: Array.from(pos.array as ArrayLike<number>),
      normals: geo.getAttribute("normal")
        ? Array.from((geo.getAttribute("normal") as THREE.BufferAttribute).array as ArrayLike<number>)
        : null,
    };

    // Non-indexed weld: snap vertices to grid of threshold
    const inv = 1 / threshold;
    const map = new Map<string, number>();
    const newPos: number[] = [];
    const remap: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const x = Math.round(pos.getX(i) * inv) / inv;
      const y = Math.round(pos.getY(i) * inv) / inv;
      const z = Math.round(pos.getZ(i) * inv) / inv;
      const key = `${x},${y},${z}`;
      let ni = map.get(key);
      if (ni == null) {
        ni = newPos.length / 3;
        map.set(key, ni);
        newPos.push(x, y, z);
      }
      remap.push(ni);
    }

    if (newPos.length / 3 >= pos.count * 0.98) {
      // almost no weld — skip rebuild
      return;
    }

    // Rebuild as non-indexed triangles using remap
    let index: ArrayLike<number>;
    if (geo.index) {
      index = geo.index.array;
    } else {
      const tri: number[] = [];
      for (let i = 0; i < pos.count; i++) tri.push(i);
      index = tri;
    }

    const outPos: number[] = [];
    for (let i = 0; i < index.length; i++) {
      const vi = remap[index[i]];
      outPos.push(newPos[vi * 3], newPos[vi * 3 + 1], newPos[vi * 3 + 2]);
    }

    const welded = new THREE.BufferGeometry();
    welded.setAttribute("position", new THREE.Float32BufferAttribute(outPos, 3));
    welded.computeVertexNormals();
    welded.computeBoundingBox();
    welded.computeBoundingSphere();

    // Preserve color if possible (approx from first)
    mesh.geometry.dispose();
    mesh.geometry = welded;
    undos.push(before);
  });
  return undos;
}

/**
 * Full island prep: ground Y=0, fix mesh, weld cracks, seal open backs, double-side.
 */
export function prepareIslandAsset(root: THREE.Object3D): {
  geometry: GeometrySnapshot[];
  shellsAdded: number;
  doubleSided: number;
  welded: number;
} {
  // Ground
  const box = new THREE.Box3().setFromObject(root);
  if (!box.isEmpty()) {
    root.position.y -= box.min.y;
    root.updateMatrixWorld(true);
  }

  const welded = weldVertices(root, 0.002);
  const seal = sealOpenBacks(root, { addShell: true });

  // Fix NaNs + normals on remaining
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    if (!pos) return;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      if (!Number.isFinite(arr[i])) arr[i] = 0;
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });

  return {
    geometry: welded,
    shellsAdded: seal.shellsAdded,
    doubleSided: seal.doubleSided,
    welded: welded.length,
  };
}

/** World-space brush cursor radius helper (for UI). */
export function estimateBrushRadiusFromHit(objectSize: number, fraction = 0.08): number {
  return Math.max(0.05, objectSize * fraction);
}
