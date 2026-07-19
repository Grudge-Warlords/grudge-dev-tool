/**
 * Forge editor tools — paint, fill, mesh repair, terrain fix, ground snap.
 * Pure mesh ops over Three.js; history snapshots recorded by the page layer.
 */

import * as THREE from "three";
import type { GeometrySnapshot, MaterialSnapshot, TransformSnapshot } from "./history";

export const EDITOR_TOOL_META: Record<
  string,
  { id: string; label: string; hotkey: string; hint: string }
> = {
  select: { id: "select", label: "Select", hotkey: "Q", hint: "Pick objects (click)" },
  translate: { id: "translate", label: "Move", hotkey: "W", hint: "Translate gizmo" },
  rotate: { id: "rotate", label: "Rotate", hotkey: "E", hint: "Rotate gizmo" },
  scale: { id: "scale", label: "Scale", hotkey: "R", hint: "Scale gizmo" },
  paint: { id: "paint", label: "3D Brush", hotkey: "B", hint: "Vertex-color 3D brush on mesh" },
  "blend-paint": { id: "blend-paint", label: "Blend", hotkey: "V", hint: "Blend-mode vertex paint" },
  fill: { id: "fill", label: "Fill", hotkey: "G", hint: "Fill materials + vertex colors" },
  "fix-mesh": { id: "fix-mesh", label: "Fix Mesh", hotkey: "M", hint: "Normals, NaN, bounds" },
  "fix-terrain": { id: "fix-terrain", label: "Fix Terrain", hotkey: "T", hint: "Flatten base, ground Y=0" },
  smooth: { id: "smooth", label: "Smooth", hotkey: "Shift+S", hint: "Recompute smooth normals" },
  ground: { id: "ground", label: "Ground", hotkey: "End", hint: "Snap lowest point to Y=0" },
  "seal-back": { id: "seal-back", label: "Seal Back", hotkey: "K", hint: "Close open backs / island shells" },
  "flip-normals": { id: "flip-normals", label: "Flip N", hotkey: "N", hint: "Flip face winding + normals" },
  weld: { id: "weld", label: "Weld", hotkey: "J", hint: "Weld open edge cracks" },
  "island-prep": { id: "island-prep", label: "Island", hotkey: "I", hint: "Ground + weld + seal for islands" },
};

export function snapshotTransform(obj: THREE.Object3D): TransformSnapshot {
  return {
    kind: "transform",
    uuid: obj.uuid,
    position: obj.position.toArray() as [number, number, number],
    rotation: [
      THREE.MathUtils.radToDeg(obj.rotation.x),
      THREE.MathUtils.radToDeg(obj.rotation.y),
      THREE.MathUtils.radToDeg(obj.rotation.z),
    ],
    scale: obj.scale.toArray() as [number, number, number],
  };
}

export function applyTransformSnapshot(obj: THREE.Object3D, snap: TransformSnapshot): void {
  obj.position.fromArray(snap.position);
  obj.rotation.set(
    THREE.MathUtils.degToRad(snap.rotation[0]),
    THREE.MathUtils.degToRad(snap.rotation[1]),
    THREE.MathUtils.degToRad(snap.rotation[2]),
  );
  obj.scale.fromArray(snap.scale);
  obj.updateMatrixWorld(true);
}

function firstStandardMaterial(mesh: THREE.Mesh): THREE.MeshStandardMaterial | null {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    if (m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
      return m as THREE.MeshStandardMaterial;
    }
    if (m && (m as THREE.MeshBasicMaterial).isMeshBasicMaterial) {
      // Upgrade basic → standard for paint persistence
      const basic = m as THREE.MeshBasicMaterial;
      const std = new THREE.MeshStandardMaterial({
        color: basic.color.clone(),
        map: basic.map,
        transparent: basic.transparent,
        opacity: basic.opacity,
        metalness: 0.05,
        roughness: 0.85,
      });
      if (Array.isArray(mesh.material)) {
        const idx = mesh.material.indexOf(basic);
        if (idx >= 0) mesh.material[idx] = std;
      } else {
        mesh.material = std;
      }
      basic.dispose();
      return std;
    }
  }
  return null;
}

export function snapshotMaterial(mesh: THREE.Mesh): MaterialSnapshot | null {
  const mat = firstStandardMaterial(mesh);
  if (!mat) return null;
  return {
    kind: "material",
    uuid: mesh.uuid,
    color: mat.color.getHex(),
    metalness: mat.metalness,
    roughness: mat.roughness,
  };
}

export function applyMaterialSnapshot(mesh: THREE.Mesh, snap: MaterialSnapshot): void {
  const mat = firstStandardMaterial(mesh);
  if (!mat) return;
  mat.color.setHex(snap.color);
  if (snap.metalness != null) mat.metalness = snap.metalness;
  if (snap.roughness != null) mat.roughness = snap.roughness;
  mat.needsUpdate = true;
}

export function paintMesh(mesh: THREE.Mesh, colorHex: number): MaterialSnapshot | null {
  const before = snapshotMaterial(mesh);
  const mat = firstStandardMaterial(mesh);
  if (!mat) return null;
  mat.color.setHex(colorHex);
  mat.needsUpdate = true;
  return before;
}

/** Fill every MeshStandardMaterial under a root with one color. Returns undos. */
export function fillObject(root: THREE.Object3D, colorHex: number): MaterialSnapshot[] {
  const undos: MaterialSnapshot[] = [];
  root.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh) return;
    const before = paintMesh(mesh, colorHex);
    if (before) undos.push(before);
  });
  return undos;
}

export function snapshotGeometry(mesh: THREE.Mesh): GeometrySnapshot | null {
  const pos = mesh.geometry?.getAttribute("position");
  if (!pos) return null;
  const normals = mesh.geometry.getAttribute("normal");
  return {
    kind: "geometry",
    uuid: mesh.uuid,
    positions: Array.from(pos.array as ArrayLike<number>),
    normals: normals ? Array.from(normals.array as ArrayLike<number>) : null,
  };
}

export function applyGeometrySnapshot(mesh: THREE.Mesh, snap: GeometrySnapshot): void {
  const geo = mesh.geometry;
  if (!geo) return;
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  if (!pos || pos.count * 3 !== snap.positions.length) {
    geo.setAttribute("position", new THREE.Float32BufferAttribute(snap.positions, 3));
  } else {
    (pos.array as Float32Array).set(snap.positions);
    pos.needsUpdate = true;
  }
  if (snap.normals) {
    const nrm = geo.getAttribute("normal") as THREE.BufferAttribute | undefined;
    if (nrm && nrm.count * 3 === snap.normals.length) {
      (nrm.array as Float32Array).set(snap.normals);
      nrm.needsUpdate = true;
    } else {
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(snap.normals, 3));
    }
  } else {
    geo.computeVertexNormals();
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

function forEachMesh(root: THREE.Object3D, fn: (mesh: THREE.Mesh) => void): void {
  root.traverse((n) => {
    const m = n as THREE.Mesh;
    if (m.isMesh && m.geometry) fn(m);
  });
}

/**
 * Fix mesh: strip NaNs, recompute normals, ensure indexed geometry bounds.
 * Returns geometry undos for each modified mesh.
 */
export function fixMesh(root: THREE.Object3D): GeometrySnapshot[] {
  const undos: GeometrySnapshot[] = [];
  forEachMesh(root, (mesh) => {
    const before = snapshotGeometry(mesh);
    if (!before) return;
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    if (!pos) return;
    let dirty = false;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      if (!Number.isFinite(arr[i])) {
        arr[i] = 0;
        dirty = true;
      }
    }
    if (dirty) pos.needsUpdate = true;
    // Drop zero-area / empty
    if (pos.count === 0) return;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    undos.push(before);
  });
  return undos;
}

/**
 * Fix terrain-like meshes: drop min Y to 0, mild height clamp, recompute normals.
 */
export function fixTerrain(root: THREE.Object3D): { geometry: GeometrySnapshot[]; transform: TransformSnapshot | null } {
  const geoUndos: GeometrySnapshot[] = [];
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return { geometry: [], transform: null };

  const xformBefore = snapshotTransform(root);
  // World-space drop so lowest vertex sits on Y=0
  const minY = box.min.y;
  if (Math.abs(minY) > 1e-6) {
    root.position.y -= minY;
    root.updateMatrixWorld(true);
  }

  forEachMesh(root, (mesh) => {
    const before = snapshotGeometry(mesh);
    if (!before) return;
    // Local height soften: pull extreme spikes toward mean Y of mesh
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    if (!pos) return;
    let sumY = 0;
    for (let i = 0; i < pos.count; i++) sumY += pos.getY(i);
    const meanY = sumY / Math.max(1, pos.count);
    const arr = pos.array as Float32Array;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const blended = y * 0.85 + meanY * 0.15;
      arr[i * 3 + 1] = blended;
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    mesh.receiveShadow = true;
    geoUndos.push(before);
  });

  return {
    geometry: geoUndos,
    transform: Math.abs(minY) > 1e-6 ? xformBefore : null,
  };
}

/** Snap object so its world bounding-box min Y is 0. */
export function groundSnap(root: THREE.Object3D): TransformSnapshot | null {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return null;
  const before = snapshotTransform(root);
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);
  return before;
}

/** Recompute smooth vertex normals on all meshes. */
export function smoothNormals(root: THREE.Object3D): GeometrySnapshot[] {
  const undos: GeometrySnapshot[] = [];
  forEachMesh(root, (mesh) => {
    const before = snapshotGeometry(mesh);
    if (!before) return;
    mesh.geometry.computeVertexNormals();
    undos.push(before);
  });
  return undos;
}

/** Center pivot: shift geometry so local origin is bbox center; keep world pose. */
export function centerPivot(root: THREE.Object3D): GeometrySnapshot[] {
  const undos: GeometrySnapshot[] = [];
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return undos;
  const center = new THREE.Vector3();
  box.getCenter(center);
  // Move root so world center stays, but geometry centers at local 0 is harder multi-mesh;
  // offset root position to put bbox center at root origin relative to parent.
  const local = center.clone();
  root.worldToLocal(local);
  forEachMesh(root, (mesh) => {
    const before = snapshotGeometry(mesh);
    if (!before) return;
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    if (!pos) return;
    // Offset positions in mesh local space by inverse of mesh-local center offset
    mesh.updateWorldMatrix(true, false);
    const meshCenter = new THREE.Vector3();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.boundingBox?.getCenter(meshCenter);
    const arr = pos.array as Float32Array;
    for (let i = 0; i < pos.count; i++) {
      arr[i * 3] -= meshCenter.x;
      arr[i * 3 + 1] -= meshCenter.y;
      arr[i * 3 + 2] -= meshCenter.z;
    }
    pos.needsUpdate = true;
    mesh.position.add(meshCenter);
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    undos.push(before);
  });
  return undos;
}

export function findMeshByUuid(root: THREE.Object3D, uuid: string): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((n) => {
    if (found) return;
    if (n.uuid === uuid && (n as THREE.Mesh).isMesh) found = n as THREE.Mesh;
  });
  return found;
}

export function findObjectByUuidDeep(roots: THREE.Object3D[], uuid: string): THREE.Object3D | null {
  for (const root of roots) {
    if (root.uuid === uuid) return root;
    let found: THREE.Object3D | null = null;
    root.traverse((n) => {
      if (!found && n.uuid === uuid) found = n;
    });
    if (found) return found;
  }
  return null;
}
