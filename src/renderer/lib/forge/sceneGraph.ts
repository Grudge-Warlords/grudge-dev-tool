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
  role?: string;
}

const SKIP_TYPES = new Set(["GridHelper", "AxesHelper", "SkeletonHelper", "Box3Helper"]);

export function isEngineHelper(node: THREE.Object3D): boolean {
  if (node.userData.forgeInternal) return true;
  return SKIP_TYPES.has(node.type);
}

function toNode(obj: THREE.Object3D, depth: number): GraphNode {
  const mesh = obj as THREE.Mesh;
  const bone = obj as THREE.Bone;
  return {
    uuid: obj.uuid,
    name: obj.name || obj.type,
    type: obj.type,
    children: [],
    object: obj,
    depth,
    isMesh: mesh.isMesh === true,
    isBone: bone.isBone === true || obj.type === "Bone",
    role: typeof obj.userData?.grudgeRole === "string" ? obj.userData.grudgeRole : undefined,
  };
}

export function buildSceneGraph(root: THREE.Object3D, maxDepth = 12): GraphNode[] {
  function walk(obj: THREE.Object3D, depth: number): GraphNode | null {
    if (depth > maxDepth) return null;
    if (isEngineHelper(obj)) return null;
    const entry = toNode(obj, depth);
    for (const child of obj.children) {
      const n = walk(child, depth + 1);
      if (n) entry.children.push(n);
    }
    return entry;
  }

  const top = walk(root, 0);
  return top ? [top] : [];
}

export function findObjectByUuid(root: THREE.Object3D, uuid: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((n) => {
    if (!found && n.uuid === uuid) found = n;
  });
  return found;
}

export function nodeIcon(node: GraphNode): string {
  if (node.role === "hud-root" || node.role === "hud-frame") return "hud";
  if (node.role === "game-manager") return "game";
  if (node.role === "network-manager") return "net";
  if (node.isBone) return "bone";
  if (node.isMesh) return "mesh";
  if (node.type === "Group") return "group";
  if (node.type === "PerspectiveCamera") return "camera";
  if (node.type.includes("Light")) return "light";
  if (node.type === "SkinnedMesh") return "skin";
  return "node";
}

export function reparentObject(child: THREE.Object3D, newParent: THREE.Object3D): boolean {
  if (!child || !newParent || child === newParent) return false;
  let p: THREE.Object3D | null = newParent;
  while (p) {
    if (p === child) return false;
    p = p.parent;
  }
  newParent.attach(child);
  return true;
}
