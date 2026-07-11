import * as THREE from "three";

/** Node type badge — mirrors three.js editor outliner categories. */
export type OutlinerKind =
  | "Scene"
  | "Camera"
  | "Light"
  | "Mesh"
  | "SkinnedMesh"
  | "Line"
  | "Points"
  | "Group"
  | "Bone"
  | "LOD"
  | "Helper"
  | "Object3D";

export interface MeshBreakdown {
  uuid: string;
  name: string;
  type: string;
  kind: OutlinerKind;
  depth: number;
  visible: boolean;
  /** Geometry display name + stats when mesh-like */
  geometryName: string | null;
  materialNames: string[];
  triangles: number;
  vertices: number;
  morphTargets: number;
  bones: number;
  /** LOD levels when node is THREE.LOD */
  lodLevels: number;
  childCount: number;
  hasChildren: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  /** Live ref for visibility toggles / focus */
  object: THREE.Object3D;
}

export function getOutlinerKind(object: THREE.Object3D): OutlinerKind {
  if ((object as THREE.Scene).isScene) return "Scene";
  if ((object as THREE.Camera).isCamera) return "Camera";
  if ((object as THREE.Light).isLight) return "Light";
  if ((object as THREE.SkinnedMesh).isSkinnedMesh) return "SkinnedMesh";
  if ((object as THREE.Mesh).isMesh) return "Mesh";
  if ((object as THREE.Line).isLine) return "Line";
  if ((object as THREE.Points).isPoints) return "Points";
  if ((object as THREE.Bone).isBone) return "Bone";
  if ((object as THREE.LOD).isLOD) return "LOD";
  if ((object as THREE.Group).isGroup) return "Group";
  if (object.type.includes("Helper")) return "Helper";
  return "Object3D";
}

function meshStats(mesh: THREE.Mesh): { triangles: number; vertices: number; morphTargets: number; bones: number } {
  const geo = mesh.geometry;
  let vertices = 0;
  let triangles = 0;
  if (geo) {
    const pos = geo.getAttribute("position");
    vertices = pos?.count ?? 0;
    if (geo.index) triangles = Math.floor(geo.index.count / 3);
    else triangles = Math.floor(vertices / 3);
  }
  const morphTargets = geo?.morphAttributes?.position?.length ?? 0;
  const bones = (mesh as THREE.SkinnedMesh).isSkinnedMesh
    ? ((mesh as THREE.SkinnedMesh).skeleton?.bones?.length ?? 0)
    : 0;
  return { triangles, vertices, morphTargets, bones };
}

function materialNames(mesh: THREE.Mesh): string[] {
  const mat = mesh.material;
  if (Array.isArray(mat)) return mat.map((m) => m.name || m.type);
  if (mat) return [mat.name || mat.type];
  return [];
}

/**
 * Flatten object hierarchy for the Forge outliner (three.js editor style).
 * Includes groups, bones, lights, LODs — not only meshes.
 * `maxDepth` defaults high enough for full character rigs.
 */
export function flattenMeshHierarchy(
  root: THREE.Object3D,
  opts: { maxDepth?: number; includeBones?: boolean; expandAll?: boolean } = {},
): MeshBreakdown[] {
  const maxDepth = opts.maxDepth ?? 32;
  const includeBones = opts.includeBones ?? true;
  const out: MeshBreakdown[] = [];

  function walk(node: THREE.Object3D, depth: number) {
    if (depth > maxDepth) return;
    const kind = getOutlinerKind(node);
    if (!includeBones && kind === "Bone") return;

    const isMesh = (node as THREE.Mesh).isMesh;
    const stats = isMesh
      ? meshStats(node as THREE.Mesh)
      : { triangles: 0, vertices: 0, morphTargets: 0, bones: 0 };

    let lodLevels = 0;
    if ((node as THREE.LOD).isLOD) {
      lodLevels = (node as THREE.LOD).levels?.length ?? 0;
    }

    out.push({
      uuid: node.uuid,
      name: node.name || node.type,
      type: node.type,
      kind,
      depth,
      visible: node.visible,
      geometryName: isMesh
        ? ((node as THREE.Mesh).geometry?.name || (node as THREE.Mesh).geometry?.type || "BufferGeometry")
        : null,
      materialNames: isMesh ? materialNames(node as THREE.Mesh) : [],
      triangles: stats.triangles,
      vertices: stats.vertices,
      morphTargets: stats.morphTargets,
      bones: stats.bones,
      lodLevels,
      childCount: node.children.length,
      hasChildren: node.children.length > 0,
      castShadow: isMesh ? !!(node as THREE.Mesh).castShadow : false,
      receiveShadow: isMesh ? !!(node as THREE.Mesh).receiveShadow : false,
      object: node,
    });

    for (const child of node.children) walk(child, depth + 1);
  }

  walk(root, 0);
  return out;
}

/** Aggregate stats for a root (all descendant meshes). */
export function aggregateMeshStats(root: THREE.Object3D): {
  meshes: number;
  triangles: number;
  vertices: number;
  materials: number;
  bones: number;
  morphTargets: number;
  lods: number;
} {
  let meshes = 0;
  let triangles = 0;
  let vertices = 0;
  let bones = 0;
  let morphTargets = 0;
  let lods = 0;
  const matIds = new Set<string>();

  root.traverse((n) => {
    if ((n as THREE.LOD).isLOD) lods += 1;
    if ((n as THREE.SkinnedMesh).isSkinnedMesh) {
      bones += (n as THREE.SkinnedMesh).skeleton?.bones?.length ?? 0;
    }
    if ((n as THREE.Mesh).isMesh) {
      meshes += 1;
      const s = meshStats(n as THREE.Mesh);
      triangles += s.triangles;
      vertices += s.vertices;
      morphTargets += s.morphTargets;
      const mats = Array.isArray((n as THREE.Mesh).material)
        ? ((n as THREE.Mesh).material as THREE.Material[])
        : [(n as THREE.Mesh).material as THREE.Material];
      for (const m of mats) if (m?.uuid) matIds.add(m.uuid);
    }
  });

  return {
    meshes,
    triangles,
    vertices,
    materials: matIds.size,
    bones,
    morphTargets,
    lods,
  };
}

export function findObjectByUuid(root: THREE.Object3D, uuid: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((n) => {
    if (n.uuid === uuid) found = n;
  });
  return found;
}

/** Kind → outliner accent color (three.js editor palette inspired). */
export const KIND_COLOR: Record<OutlinerKind, string> = {
  Scene: "#8888ff",
  Camera: "#ff8888",
  Light: "#ffff88",
  Mesh: "#88ff88",
  SkinnedMesh: "#66ddaa",
  Line: "#88ffff",
  Points: "#ff88ff",
  Group: "#aaaaaa",
  Bone: "#ffaa66",
  LOD: "#66aaff",
  Helper: "#666666",
  Object3D: "#cccccc",
};
