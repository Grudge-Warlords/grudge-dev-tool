import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";

/** Result of loading any supported 3D file. */
export interface LoadedModel {
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
  /** Original glTF object when source was .glb/.gltf, otherwise null. */
  gltf: GLTF | null;
  format: ModelFormat;
  /** Approximate triangle count summed across meshes (best-effort). */
  triangles: number;
  /** Sum of vertex positions across meshes. */
  vertices: number;
  /** Bone count when the model has a skeleton. */
  bones: number;
}

export type ModelFormat =
  | "glb" | "gltf" | "obj" | "fbx" | "stl" | "ply" | "dae" | "3mf";

const EXT_TO_FORMAT: Record<string, ModelFormat> = {
  glb: "glb", gltf: "gltf",
  obj: "obj", fbx: "fbx",
  stl: "stl", ply: "ply",
  dae: "dae", "3mf": "3mf",
};

export function detectFormat(filename: string): ModelFormat | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return EXT_TO_FORMAT[ext] ?? null;
}

export function isSupported(filename: string): boolean {
  return detectFormat(filename) !== null;
}

/** Recursively count triangles, vertices, and bones in an Object3D tree. */
function tallyStats(object: THREE.Object3D): { triangles: number; vertices: number; bones: number } {
  let triangles = 0;
  let vertices = 0;
  let bones = 0;
  object.traverse((node) => {
    if ((node as THREE.Bone).isBone) bones++;
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      const geom = mesh.geometry as THREE.BufferGeometry;
      const pos = geom.getAttribute("position");
      if (pos) {
        vertices += pos.count;
        triangles += geom.index ? geom.index.count / 3 : pos.count / 3;
      }
    }
  });
  return { triangles: Math.round(triangles), vertices, bones };
}

/** Load a model from a Blob/File using the right loader for its extension. */
export async function loadModel(file: File): Promise<LoadedModel> {
  const format = detectFormat(file.name);
  if (!format) throw new Error(`Unsupported format: ${file.name}`);
  const url = URL.createObjectURL(file);
  try {
    switch (format) {
      case "glb":
      case "gltf": {
        const gltf = await new GLTFLoader().loadAsync(url);
        const stats = tallyStats(gltf.scene);
        return {
          object: gltf.scene,
          animations: gltf.animations ?? [],
          gltf,
          format,
          triangles: stats.triangles,
          vertices: stats.vertices,
          bones: stats.bones,
        };
      }
      case "obj": {
        const obj = await new OBJLoader().loadAsync(url);
        const stats = tallyStats(obj);
        return { object: obj, animations: [], gltf: null, format, ...stats };
      }
      case "fbx": {
        const fbx = await new FBXLoader().loadAsync(url);
        const stats = tallyStats(fbx);
        return {
          object: fbx,
          animations: (fbx as any).animations ?? [],
          gltf: null,
          format,
          ...stats,
        };
      }
      case "stl": {
        const geom = await new STLLoader().loadAsync(url);
        geom.computeVertexNormals();
        const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6, metalness: 0.05 }));
        const stats = tallyStats(mesh);
        return { object: mesh, animations: [], gltf: null, format, ...stats };
      }
      case "ply": {
        const geom = await new PLYLoader().loadAsync(url);
        geom.computeVertexNormals();
        // PLY can be a point cloud (no faces) — fall back to Points mode.
        const mat = (geom.index || geom.attributes.position?.count) ?
          new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6, metalness: 0.05 }) : null;
        const obj: THREE.Object3D = (geom.index || (geom as any).faces) ?
          new THREE.Mesh(geom, mat ?? new THREE.MeshStandardMaterial({ color: 0xcccccc })) :
          new THREE.Points(geom, new THREE.PointsMaterial({ size: 0.01, vertexColors: !!geom.getAttribute("color") }));
        const stats = tallyStats(obj);
        return { object: obj, animations: [], gltf: null, format, ...stats };
      }
      case "dae": {
        const dae = await new ColladaLoader().loadAsync(url);
        const stats = tallyStats(dae.scene);
        return {
          object: dae.scene,
          animations: (dae as any).animations ?? [],
          gltf: null,
          format,
          ...stats,
        };
      }
      case "3mf": {
        const obj = await new ThreeMFLoader().loadAsync(url);
        const stats = tallyStats(obj);
        return { object: obj, animations: [], gltf: null, format, ...stats };
      }
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Compute a tight bounding box in world space (after applying transforms). */
export function computeBounds(object: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3().setFromObject(object);
  return box;
}
