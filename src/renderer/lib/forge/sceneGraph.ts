import * as THREE from "three";

export interface GraphNode {
  uuid: string;
  name: string;
  type: string;
  children: GraphNode[];
  object: THREE.Object3D;
  depth: number;
  isMesh: boolean;
  isBone: boolean;
}

const SKIP_TYPES = new Set(["GridHelper", "AxesHelper", "SkeletonHelper"]);

export function isEngineHelper(node: THREE.Object3D): boolean {
  if (node.userData.forgeInternal) return true;
  return SKIP_TYPES.has(node.type);
}

export function buildSceneGraph(root: THREE.Object3D, maxDepth = 10): GraphNode[] {
  const nodes: GraphNode[] = [];

  function walk(obj: THREE.Object3D, depth: number) {
    if (depth > maxDepth) return;
    if (isEngineHelper(obj)) return;
    const mesh = obj as THREE.Mesh;
    const bone = obj as THREE.Bone;
    const entry: GraphNode = {
      uuid: obj.uuid,
      name: obj.name || obj.type,
      type: obj.type,
      children: [],
      object: obj,
      depth,
      isMesh: mesh.isMesh === true,
      isBone: bone.isBone === true || obj.type === "Bone",
    };
    nodes.push(entry);
    for (const child of obj.children) {
      if (isEngineHelper(child)) continue;
      walk(child, depth + 1);
    }
  }

  walk(root, 0);
  return nodes;
}

export function findObjectByUuid(root: THREE.Object3D, uuid: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((n) => {
    if (!found && n.uuid === uuid) found = n;
  });
  return found;
}

export function nodeIcon(node: GraphNode): string {
  if (node.isBone) return "bone";
  if (node.isMesh) return "mesh";
  if (node.type === "Group") return "group";
  if (node.type === "PerspectiveCamera") return "camera";
  if (node.type.includes("Light")) return "light";
  return "node";
}
