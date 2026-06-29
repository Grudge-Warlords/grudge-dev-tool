import * as THREE from "three";

export interface MeshNode {
  uuid: string;
  name: string;
  type: string;
  depth: number;
  mesh: THREE.Mesh | null;
  childCount: number;
}

export function flattenMeshHierarchy(root: THREE.Object3D, maxDepth = 8): MeshNode[] {
  const out: MeshNode[] = [];
  function walk(node: THREE.Object3D, depth: number) {
    if (depth > maxDepth) return;
    const isMesh = (node as THREE.Mesh).isMesh;
    out.push({
      uuid: node.uuid,
      name: node.name || node.type,
      type: node.type,
      depth,
      mesh: isMesh ? (node as THREE.Mesh) : null,
      childCount: node.children.length,
    });
    for (const child of node.children) walk(child, depth + 1);
  }
  walk(root, 0);
  return out;
}

export function findObjectByUuid(root: THREE.Object3D, uuid: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((n) => { if (n.uuid === uuid) found = n; });
  return found;
}