import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { TGALoader } from "three/examples/jsm/loaders/TGALoader.js";
import { MeshoptDecoder } from "meshoptimizer";
import { assertMeshBytes } from "../../../shared/magicBytes";
import {
  sanitizeMaterials,
  type MaterialSanitizeReport,
  type MaterialSanitizeOptions,
} from "./materialSanitize";

/** Await once — WASM init for EXT_meshopt_compression (grudge-web-v1 optimized GLBs). */
let meshoptReady: Promise<void> | null = null;

function ensureMeshoptReady(): Promise<void> {
  if (!meshoptReady) {
    meshoptReady =
      MeshoptDecoder?.ready != null
        ? Promise.resolve(MeshoptDecoder.ready).then(() => undefined)
        : Promise.resolve();
  }
  return meshoptReady;
}

/**
 * GLTFLoader with MeshoptDecoder bound (required for meshopt-compressed GLBs).
 * Without this, THREE throws: "setMeshoptDecoder must be called before loading compressed files"
 * and meshes/colors/textures look wrong or empty.
 */
async function createGltfLoader(manager?: THREE.LoadingManager): Promise<GLTFLoader> {
  const loader = new GLTFLoader(manager);
  try {
    if (MeshoptDecoder && MeshoptDecoder.supported !== false) {
      await ensureMeshoptReady();
      loader.setMeshoptDecoder(MeshoptDecoder);
    } else {
      console.warn("[loaders] MeshoptDecoder not supported in this environment");
    }
  } catch (e) {
    console.warn("[loaders] MeshoptDecoder init failed — compressed GLBs may fail", e);
  }
  return loader;
}

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

/**
 * Build a fetchable URL for a local absolute path via the Electron
 * grudge-media protocol (works for models + sibling textures/TGA).
 * Falls back to identity when not in the Dev Tool shell.
 */
export function localFileUrl(absolutePath: string): string {
  const p = absolutePath.replace(/\//g, "\\");
  // Prefer native media protocol when running inside Electron
  if (typeof window !== "undefined") {
    return `grudge-media://local/?path=${encodeURIComponent(p)}`;
  }
  return absolutePath;
}

/** Join model dir + relative texture path (Windows / posix safe). */
function resolveAgainstDir(baseDir: string, rel: string): string {
  const base = baseDir.replace(/\\/g, "/").replace(/\/?$/, "/");
  let r = rel.replace(/\\/g, "/");
  // Strip file:// and leading ./
  if (r.startsWith("file://")) {
    try {
      r = decodeURIComponent(new URL(r).pathname);
      if (/^\/[A-Za-z]:/.test(r)) r = r.slice(1);
      return r.replace(/\//g, "\\");
    } catch {
      /* fall through */
    }
  }
  if (/^[A-Za-z]:\//.test(r) || r.startsWith("/")) {
    return r.replace(/\//g, "\\");
  }
  const parts = (base + r).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  // Windows drive: "C:" segment stays
  return out.join("\\");
}

/**
 * Shared LoadingManager: TGA (Unity Toon RTS) + optional disk-path rewrite.
 * When resourceDir is set, relative texture/bin paths resolve via grudge-media
 * so blob-loaded FBX/OBJ/glTF still get correct atlases and colors.
 */
function createAssetManager(resourceDir?: string | null): THREE.LoadingManager {
  const manager = new THREE.LoadingManager();
  manager.addHandler(/\.tga$/i, new TGALoader());
  if (resourceDir) {
    const dir = resourceDir.replace(/\\/g, "/").replace(/\/?$/, "/");
    manager.setURLModifier((url) => {
      if (!url) return url;
      // Already absolute fetchable
      if (
        url.startsWith("blob:") ||
        url.startsWith("data:") ||
        url.startsWith("http://") ||
        url.startsWith("https://") ||
        url.startsWith("grudge-media:")
      ) {
        return url;
      }
      // Absolute Windows / posix disk path
      if (/^[A-Za-z]:[\\/]/.test(url) || url.startsWith("\\\\")) {
        return localFileUrl(url);
      }
      if (url.startsWith("file:")) {
        try {
          let p = decodeURIComponent(new URL(url).pathname);
          if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
          return localFileUrl(p);
        } catch {
          return url;
        }
      }
      // Relative to model folder (FBX external maps, glTF .bin/.png, OBJ MTL maps)
      const abs = resolveAgainstDir(dir, url);
      return localFileUrl(abs);
    });
  }
  return manager;
}

/**
 * Mesh hygiene after load — correct bounds, normals, skinned pose for Elite/Forge.
 * Does not alter author root transform (scale/rotation stay as authored).
 */
function prepareMeshes(object: THREE.Object3D): void {
  object.updateMatrixWorld(true);
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geom = mesh.geometry as THREE.BufferGeometry;
    if (!geom.getAttribute("normal") && geom.getAttribute("position")) {
      geom.computeVertexNormals();
    }
    if (!geom.boundingBox) geom.computeBoundingBox();
    if (!geom.boundingSphere) geom.computeBoundingSphere();

    const sm = mesh as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh) {
      sm.frustumCulled = false;
      sm.matrixWorldNeedsUpdate = true;
      // Ensure skeleton matrices match current bind for first paint
      if (sm.skeleton) {
        sm.skeleton.update();
      }
      try {
        sm.computeBoundingSphere();
      } catch {
        /* some clones lack bone inverses until posed */
      }
    }

    // Invisible zero-scale mesh children often break framing; leave scale but flag
    if (mesh.visible === false) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  object.updateMatrixWorld(true);
}

function finishModel(
  object: THREE.Object3D,
  animations: THREE.AnimationClip[],
  gltf: GLTF | null,
  format: ModelFormat,
  sanitizeOpts?: MaterialSanitizeOptions,
): LoadedModel {
  prepareMeshes(object);
  const fmtHint =
    format === "glb" || format === "gltf" || format === "fbx" || format === "obj"
      ? format
      : "other";
  const materials = sanitizeMaterials(object, {
    format: fmtHint,
    toonStyle: true,
    fixDefaultYellow: true,
    whiteWhenMapped: true,
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
 * diskPath: load via grudge-media when possible so relative textures resolve;
 * also enables sibling fill for materials that still lack maps.
 */
export async function loadModel(file: File, opts: LoadModelOptions = {}): Promise<LoadedModel> {
  const format = detectFormat(file.name);
  if (!format) throw new Error(`Unsupported format: ${file.name}`);

  // Magic-byte gate for binary glTF — the #1 cause of "black cube" from CDN HTML.
  if (!opts.skipMagicBytes && (format === "glb" || format === "gltf")) {
    const buf = await file.arrayBuffer();
    assertMeshBytes(buf, file.name);
  }

  const resourceDir =
    opts.resourceDir ||
    (opts.diskPath ? dirnamePath(opts.diskPath) : null);

  // Prefer disk URL so FBX/OBJ/glTF external maps resolve next to the model.
  // Blob URLs alone lose relative texture paths → wrong/missing colors.
  let url: string;
  let revokeBlob: string | null = null;
  const preferDisk = Boolean(opts.diskPath && typeof window !== "undefined");
  if (preferDisk) {
    url = localFileUrl(opts.diskPath!);
  } else {
    revokeBlob = URL.createObjectURL(file);
    url = revokeBlob;
  }

  const manager = createAssetManager(resourceDir);
  let loaded: LoadedModel;

  async function loadFrom(urlToUse: string): Promise<LoadedModel> {
    switch (format) {
      case "glb":
      case "gltf": {
        const gltfLoader = await createGltfLoader(manager);
        const gltf = await gltfLoader.loadAsync(urlToUse);
        let scene = gltf.scene;
        let hasSkin = false;
        gltf.scene.traverse((n) => {
          if ((n as THREE.SkinnedMesh).isSkinnedMesh) hasSkin = true;
        });
        if (hasSkin) scene = SkeletonUtils.clone(gltf.scene) as THREE.Group;
        return finishModel(scene, gltf.animations ?? [], gltf, format, opts.sanitize);
      }
      case "obj": {
        const objLoader = new OBJLoader(manager);
        // Sidecar MTL (same basename) — required for real materials/textures
        if (opts.diskPath) {
          const mtlDisk = opts.diskPath.replace(/\.obj$/i, ".mtl");
          try {
            const mtl = await new MTLLoader(manager).loadAsync(localFileUrl(mtlDisk));
            mtl.preload();
            objLoader.setMaterials(mtl);
          } catch {
            /* MTL optional; sibling fill may still attach maps */
          }
        }
        const obj = await objLoader.loadAsync(urlToUse);
        return finishModel(obj, [], null, format, opts.sanitize);
      }
      case "fbx": {
        const fbx = await new FBXLoader(manager).loadAsync(urlToUse);
        return finishModel(
          fbx,
          (fbx as any).animations ?? [],
          null,
          format,
          { toonStyle: true, fixDefaultYellow: true, ...opts.sanitize },
        );
      }
      case "stl": {
        const geom = await new STLLoader(manager).loadAsync(urlToUse);
        geom.computeVertexNormals();
        const mesh = new THREE.Mesh(
          geom,
          new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6, metalness: 0.05 }),
        );
        return finishModel(mesh, [], null, format, opts.sanitize);
      }
      case "ply": {
        const geom = await new PLYLoader(manager).loadAsync(urlToUse);
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
        const dae = await new ColladaLoader(manager).loadAsync(urlToUse);
        return finishModel(
          dae.scene,
          (dae as any).animations ?? [],
          null,
          format,
          opts.sanitize,
        );
      }
      case "3mf": {
        const obj = await new ThreeMFLoader(manager).loadAsync(urlToUse);
        return finishModel(obj, [], null, format, opts.sanitize);
      }
      case "three-json": {
        const text = await (await fetch(urlToUse)).text();
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
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  try {
    try {
      loaded = await loadFrom(url);
    } catch (diskErr) {
      // grudge-media may fail outside Electron or if protocol not ready — blob fallback
      // Only when the File actually has bytes (empty File is disk-only placeholder).
      if (preferDisk && file.size > 0) {
        console.warn("[loadModel] disk URL failed, falling back to blob", diskErr);
        revokeBlob = URL.createObjectURL(file);
        loaded = await loadFrom(revokeBlob);
      } else {
        throw diskErr;
      }
    }
  } finally {
    if (revokeBlob) URL.revokeObjectURL(revokeBlob);
  }

  // Fill missing maps only (never overwrite good embedded/atlas maps).
  // Prefer the real model file path so sibling search walks the correct dirs.
  const siblingRoot = opts.diskPath || null;
  if (siblingRoot) {
    try {
      const { finishImportedAsset } = await import("./localMaterials");
      await finishImportedAsset(loaded.object, siblingRoot, {
        onlyMissingMaps: true,
      });
      // Re-sanitize after optional map fill (colorSpace / yellow / metalness)
      loaded.materials = sanitizeMaterials(loaded.object, {
        format:
          format === "glb" || format === "gltf" || format === "fbx" || format === "obj"
            ? format
            : "other",
        toonStyle: true,
        fixDefaultYellow: true,
        whiteWhenMapped: true,
        ...opts.sanitize,
      });
      prepareMeshes(loaded.object);
    } catch {
      /* sibling maps optional */
    }
  }
  return loaded;
}

/**
 * Load from a CDN/http(s)/grudge-media URL with magic-byte gate on the response body.
 * Prefer `prod/gltf/**` paths from assets.grudge-studio.com.
 * Pass `diskPath` for local elite open so relative textures + sibling maps resolve.
 */
export async function loadModelFromUrl(
  url: string,
  filenameHint?: string,
  opts: LoadModelOptions = {},
): Promise<LoadedModel> {
  // Local disk elite path: skip full-body fetch when we can stream via grudge-media
  if (opts.diskPath && typeof window !== "undefined") {
    const name =
      filenameHint ||
      opts.diskPath.split(/[/\\]/).pop() ||
      "model.glb";
    const format = detectFormat(name);
    // For GLB still need magic-byte gate — small head fetch or full via media
    if (!opts.skipMagicBytes && (format === "glb" || format === "gltf")) {
      try {
        const res = await fetch(localFileUrl(opts.diskPath));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        assertMeshBytes(buf, name);
        const type = name.toLowerCase().endsWith(".glb")
          ? "model/gltf-binary"
          : "application/octet-stream";
        const file = new File([buf], name, { type });
        return loadModel(file, {
          ...opts,
          diskPath: opts.diskPath,
          skipMagicBytes: true,
        });
      } catch {
        /* fall through to generic URL fetch */
      }
    } else {
      // FBX/OBJ/etc: empty File + diskPath → loadModel uses grudge-media
      const file = new File([], name, { type: "application/octet-stream" });
      try {
        return await loadModel(file, {
          ...opts,
          diskPath: opts.diskPath,
          skipMagicBytes: true,
        });
      } catch {
        /* fall through */
      }
    }
  }

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
