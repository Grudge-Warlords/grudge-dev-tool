import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { TGALoader } from "three/examples/jsm/loaders/TGALoader.js";
import { assertMeshBytes } from "../../../shared/magicBytes";
import {
  sanitizeMaterials,
  type MaterialSanitizeReport,
  type MaterialSanitizeOptions,
} from "./materialSanitize";

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
  /** Material / color-space fix report (yellow/black prevention). */
  materials?: MaterialSanitizeReport;
}

export type ModelFormat =
  | "glb" | "gltf" | "obj" | "fbx" | "stl" | "ply" | "dae" | "3mf" | "three-json";

const EXT_TO_FORMAT: Record<string, ModelFormat> = {
  glb: "glb", gltf: "gltf",
  obj: "obj", fbx: "fbx",
  stl: "stl", ply: "ply",
  dae: "dae", "3mf": "3mf",
};

function isThreeJsonName(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith(".scene.json")
    || lower.endsWith(".three.json")
    || lower.endsWith(".scene")
    || (lower.includes("/scenes/") && lower.endsWith(".json"));
}

export function detectFormat(filename: string): ModelFormat | null {
  if (isThreeJsonName(filename)) return "three-json";
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

/** Shared LoadingManager: TGA (Unity Toon RTS) + texture hooks. */
function createAssetManager(): THREE.LoadingManager {
  const manager = new THREE.LoadingManager();
  manager.addHandler(/\.tga$/i, new TGALoader());
  return manager;
}

function finishModel(
  object: THREE.Object3D,
  animations: THREE.AnimationClip[],
  gltf: GLTF | null,
  format: ModelFormat,
  sanitizeOpts?: MaterialSanitizeOptions,
): LoadedModel {
  const fmtHint =
    format === "glb" || format === "gltf" || format === "fbx" || format === "obj"
      ? format
      : "other";
  const materials = sanitizeMaterials(object, {
    format: fmtHint,
    toonStyle: true,
    ...sanitizeOpts,
  });
  const stats = tallyStats(object);
  return {
    object,
    animations,
    gltf,
    format,
    triangles: stats.triangles,
    vertices: stats.vertices,
    bones: stats.bones,
    materials,
  };
}

export interface LoadModelOptions {
  /** Absolute disk path of the source file (enables sibling texture / MTL roots). */
  diskPath?: string | null;
  /** Explicit directory for external maps (defaults to dirname of diskPath). */
  resourceDir?: string | null;
  /** Skip magic-byte gate (not recommended). */
  skipMagicBytes?: boolean;
  /** Extra material sanitize options. */
  sanitize?: MaterialSanitizeOptions;
}

function dirnamePath(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(0, i + 1) : "";
}

/**
 * Load a model from a Blob/File using the right loader for its extension.
 * GLB/glTF: magic-byte gate + material sanitize.
 * FBX: TGA handler so Unity atlases don't decode as black.
 * diskPath: enables sibling texture rebind after load (finishImportedAsset).
 */
export async function loadModel(file: File, opts: LoadModelOptions = {}): Promise<LoadedModel> {
  const format = detectFormat(file.name);
  if (!format) throw new Error(`Unsupported format: ${file.name}`);

  // Magic-byte gate for binary glTF — the #1 cause of "black cube" from CDN HTML.
  if (!opts.skipMagicBytes && (format === "glb" || format === "gltf")) {
    const buf = await file.arrayBuffer();
    assertMeshBytes(buf, file.name);
  }

  const url = URL.createObjectURL(file);
  const resourceDir =
    opts.resourceDir ||
    (opts.diskPath ? dirnamePath(opts.diskPath) : null);
  const manager = createAssetManager();
  try {
    switch (format) {
      case "glb":
      case "gltf": {
        // Blob URLs lose relative texture paths — finishImportedAsset() rebinds
        // maps from disk siblings after load when diskPath is known.
        void resourceDir;
        const gltf = await new GLTFLoader(manager).loadAsync(url);
        let scene = gltf.scene;
        let hasSkin = false;
        gltf.scene.traverse((n) => {
          if ((n as THREE.SkinnedMesh).isSkinnedMesh) hasSkin = true;
        });
        if (hasSkin) scene = SkeletonUtils.clone(gltf.scene) as THREE.Group;
        return finishModel(scene, gltf.animations ?? [], gltf, format, opts.sanitize);
      }
      case "obj": {
        const obj = await new OBJLoader(manager).loadAsync(url);
        return finishModel(obj, [], null, format, opts.sanitize);
      }
      case "fbx": {
        const fbx = await new FBXLoader(manager).loadAsync(url);
        return finishModel(
          fbx,
          (fbx as any).animations ?? [],
          null,
          format,
          { toonStyle: true, fixDefaultYellow: true, ...opts.sanitize },
        );
      }
      case "stl": {
        const geom = await new STLLoader(manager).loadAsync(url);
        geom.computeVertexNormals();
        const mesh = new THREE.Mesh(
          geom,
          new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6, metalness: 0.05 }),
        );
        return finishModel(mesh, [], null, format, opts.sanitize);
      }
      case "ply": {
        const geom = await new PLYLoader(manager).loadAsync(url);
        geom.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({
          color: 0xcccccc,
          roughness: 0.6,
          metalness: 0.05,
          vertexColors: !!geom.getAttribute("color"),
        });
        const obj: THREE.Object3D =
          geom.index || geom.getAttribute("position")
            ? new THREE.Mesh(geom, mat)
            : new THREE.Points(
                geom,
                new THREE.PointsMaterial({
                  size: 0.01,
                  vertexColors: !!geom.getAttribute("color"),
                }),
              );
        return finishModel(obj, [], null, format, opts.sanitize);
      }
      case "dae": {
        const dae = await new ColladaLoader(manager).loadAsync(url);
        return finishModel(
          dae.scene,
          (dae as any).animations ?? [],
          null,
          format,
          opts.sanitize,
        );
      }
      case "3mf": {
        const obj = await new ThreeMFLoader(manager).loadAsync(url);
        return finishModel(obj, [], null, format, opts.sanitize);
      }
      case "three-json": {
        const text = await (await fetch(url)).text();
        const data = JSON.parse(text);
        const loader = new THREE.ObjectLoader();
        const parsed = loader.parse(data) as THREE.Object3D;
        const root =
          parsed.type === "Scene"
            ? (() => {
                const g = new THREE.Group();
                g.name = "three-scene";
                while (parsed.children.length) g.add(parsed.children[0]);
                return g;
              })()
            : parsed;
        return finishModel(root, [], null, format, opts.sanitize);
      }
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Load from a CDN/http(s) URL with magic-byte gate on the response body.
 * Prefer `prod/gltf/**` paths from assets.grudge-studio.com.
 */
export async function loadModelFromUrl(
  url: string,
  filenameHint?: string,
  opts: LoadModelOptions = {},
): Promise<LoadedModel> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
  const buf = await res.arrayBuffer();
  const name =
    filenameHint ||
    url.split("?")[0].split("/").pop() ||
    "model.glb";
  if (!opts.skipMagicBytes) {
    const lower = name.toLowerCase();
    if (lower.endsWith(".glb") || lower.endsWith(".gltf") || !detectFormat(name)) {
      if (lower.endsWith(".glb") || lower.endsWith(".gltf") || buf.byteLength > 12) {
        try {
          assertMeshBytes(buf, name);
        } catch (e) {
          const { probeMagic } = await import("../../../shared/magicBytes");
          const p = probeMagic(buf);
          if (!p.okForMesh) throw e;
        }
      }
    }
  }
  const type = name.toLowerCase().endsWith(".glb")
    ? "model/gltf-binary"
    : "application/octet-stream";
  const file = new File([buf], name, { type });
  return loadModel(file, { ...opts, skipMagicBytes: true });
}

/** Compute a tight bounding box in world space (after applying transforms). */
export function computeBounds(object: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3().setFromObject(object);
  return box;
}
