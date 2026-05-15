/**
 * Model Inspector — parses GLB/GLTF files via @gltf-transform/core and
 * returns a structured scene graph suitable for a Three.js editor UI.
 *
 * Returns: node hierarchy (parent/child tree), meshes with primitive
 * counts, materials, textures, skeleton joints, and animation clips.
 */

import { extname } from "node:path";

export interface InspectNode {
  name: string;
  type: "node" | "mesh" | "skin" | "camera" | "light";
  index: number;
  children: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  primitiveCount?: number;
  vertexCount?: number;
  triangleCount?: number;
  materials?: string[];
}

export interface InspectMaterial {
  name: string;
  index: number;
  alphaMode: string;
  doubleSided: boolean;
  baseColorFactor?: number[];
  baseColorTexture?: string;
  metallicFactor?: number;
  roughnessFactor?: number;
}

export interface InspectSkin {
  name: string;
  jointCount: number;
  jointNames: string[];
}

export interface InspectAnimation {
  name: string;
  duration: number;
  channelCount: number;
  targets: string[];
}

export interface InspectResult {
  ok: boolean;
  error?: string;
  format: "glb" | "gltf" | "unknown";
  fileSize: number;
  bufferBytes: number;
  nodes: InspectNode[];
  roots: number[];
  materials: InspectMaterial[];
  skins: InspectSkin[];
  animations: InspectAnimation[];
  stats: {
    nodeCount: number;
    meshCount: number;
    materialCount: number;
    textureCount: number;
    skinCount: number;
    animationCount: number;
    totalVertices: number;
    totalTriangles: number;
  };
}

const EMPTY_STATS = { nodeCount: 0, meshCount: 0, materialCount: 0, textureCount: 0, skinCount: 0, animationCount: 0, totalVertices: 0, totalTriangles: 0 };

export async function inspectModel(absPath: string): Promise<InspectResult> {
  const ext = extname(absPath).toLowerCase();
  if (ext !== ".glb" && ext !== ".gltf") {
    return { ok: false, error: `Unsupported: ${ext}. Only .glb/.gltf.`, format: "unknown", fileSize: 0, bufferBytes: 0, nodes: [], roots: [], materials: [], skins: [], animations: [], stats: EMPTY_STATS };
  }
  try {
    const { NodeIO } = require("@gltf-transform/core");
    const { ALL_EXTENSIONS } = require("@gltf-transform/extensions");
    const { stat } = require("node:fs/promises");
    const fileStat = await stat(absPath);
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(absPath);
    const root = doc.getRoot();
    const gltfNodes = root.listNodes();
    const nodeMap = new Map<any, number>();
    gltfNodes.forEach((n: any, i: number) => nodeMap.set(n, i));
    const nodes: InspectNode[] = [];
    let totalVertices = 0, totalTriangles = 0, meshCount = 0;
    for (let i = 0; i < gltfNodes.length; i++) {
      const n = gltfNodes[i];
      const mesh = n.getMesh?.();
      const type: InspectNode["type"] = mesh ? "mesh" : n.getSkin?.() ? "skin" : n.getCamera?.() ? "camera" : "node";
      const children = (n.listChildren?.() ?? []).map((c: any) => nodeMap.get(c) ?? -1).filter((x: number) => x >= 0);
      const node: InspectNode = { name: n.getName?.() || `Node_${i}`, type, index: i, children, translation: n.getTranslation?.(), rotation: n.getRotation?.(), scale: n.getScale?.() };
      if (mesh) {
        meshCount++;
        const prims = mesh.listPrimitives?.() ?? [];
        node.primitiveCount = prims.length;
        node.materials = [];
        let verts = 0, tris = 0;
        for (const prim of prims) {
          const count = prim.getAttribute?.("POSITION")?.getCount?.() ?? 0;
          verts += count;
          const idx = prim.getIndices?.();
          tris += idx ? Math.floor(idx.getCount() / 3) : Math.floor(count / 3);
          const mat = prim.getMaterial?.();
          if (mat) node.materials.push(mat.getName?.() || "unnamed");
        }
        node.vertexCount = verts; node.triangleCount = tris;
        totalVertices += verts; totalTriangles += tris;
      }
      nodes.push(node);
    }
    const rootIndices: number[] = [];
    for (const scene of root.listScenes()) for (const child of scene.listChildren?.() ?? []) { const idx = nodeMap.get(child); if (idx !== undefined) rootIndices.push(idx); }
    const materials: InspectMaterial[] = root.listMaterials().map((m: any, i: number) => ({ name: m.getName?.() || `Material_${i}`, index: i, alphaMode: m.getAlphaMode?.() ?? "OPAQUE", doubleSided: m.getDoubleSided?.() ?? false, baseColorFactor: m.getBaseColorFactor?.(), baseColorTexture: m.getBaseColorTexture?.()?.getName?.(), metallicFactor: m.getMetallicFactor?.(), roughnessFactor: m.getRoughnessFactor?.() }));
    const skins: InspectSkin[] = root.listSkins().map((s: any) => ({ name: s.getName?.() || "unnamed", jointCount: s.listJoints?.().length ?? 0, jointNames: (s.listJoints?.() ?? []).map((j: any) => j.getName?.() || "") }));
    const animations: InspectAnimation[] = root.listAnimations().map((a: any) => {
      const channels = a.listChannels?.() ?? [];
      const targets = new Set<string>();
      let maxDur = 0;
      for (const ch of channels) { const t = ch.getTargetNode?.(); if (t) targets.add(t.getName?.() || "unnamed"); const s = ch.getSampler?.(); if (s) { const inp = s.getInput?.(); if (inp) { const c = inp.getCount?.() ?? 0; if (c > 0) { const l = inp.getElement?.(c - 1, [0])?.[0] ?? 0; if (l > maxDur) maxDur = l; } } } }
      return { name: a.getName?.() || "unnamed", duration: maxDur, channelCount: channels.length, targets: [...targets] };
    });
    return { ok: true, format: ext === ".glb" ? "glb" : "gltf", fileSize: fileStat.size, bufferBytes: Math.max(0, fileStat.size - 1024), nodes, roots: rootIndices, materials, skins, animations, stats: { nodeCount: nodes.length, meshCount, materialCount: materials.length, textureCount: root.listTextures?.().length ?? 0, skinCount: skins.length, animationCount: animations.length, totalVertices, totalTriangles } };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err), format: ext === ".glb" ? "glb" : "gltf", fileSize: 0, bufferBytes: 0, nodes: [], roots: [], materials: [], skins: [], animations: [], stats: EMPTY_STATS };
  }
}
