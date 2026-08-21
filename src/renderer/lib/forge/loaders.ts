import * as THREE from "three";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";
import { TGALoader } from "three/addons/loaders/TGALoader.js";
import { createProductionGltfLoader } from "./gltfProdLoader";
import {
  assertMeshBytes,
  assertMeshResponseHeaders,
  parseFbxVersion,
  probeMagic,
} from "../../../shared/magicBytes";
import {
  classifyJsonSceneContent,
  isGltfBinFileName,
  isThreeSceneFileName,
} from "../../../shared/sceneKinds";
import {
  sanitizeMaterials,
  type MaterialSanitizeReport,
  type MaterialSanitizeOptions,
} from "./materialSanitize";
import { applyMatrix, type ForgeSceneDocument } from "./sceneSerializer";

/**
 * GLTFLoader with Meshopt + Draco + KTX2 (ThreeFlow / fleet production factory).
 * Per-open so LoadingManager can rewrite sibling maps via grudge-media.
 */
async function createGltfLoader(manager?: THREE.LoadingManager) {
  return createProductionGltfLoader(manager);
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
  | "glb"
  | "gltf"
  | "gltf-bin"
  | "obj"
  | "fbx"
  | "stl"
  | "ply"
  | "dae"
  | "3mf"
  | "vrm"
  | "three-json"
  | "forge-scene"
  | "css3d";

const EXT_TO_FORMAT: Record<string, ModelFormat> = {
  glb: "glb",
  gltf: "gltf",
  bin: "gltf-bin", // buffer companion → resolve sibling .gltf
  vrm: "vrm", // glTF avatar extension — load as GLB/glTF
  obj: "obj",
  fbx: "fbx",
  stl: "stl",
  ply: "ply",
  dae: "dae",
  "3mf": "3mf",
  // CSS3D / HTML plane quick-view (not a mesh bake format)
  html: "css3d",
  htm: "css3d",
  // Three.js scene dumps (also matched by isThreeJsonName)
  scene: "three-json",
  three: "three-json",
  gfscene: "three-json",
};

function isThreeJsonName(filename: string): boolean {
  return isThreeSceneFileName(filename);
}

export function detectFormat(filename: string): ModelFormat | null {
  if (isThreeJsonName(filename)) return "three-json";
  if (filename.toLowerCase().endsWith(".forge-scene.json")) return "forge-scene";
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return EXT_TO_FORMAT[ext] ?? null;
}

export function isSupported(filename: string): boolean {
  return detectFormat(filename) !== null;
}

/** Resolve .bin companion to sibling .gltf via main process or same-dir heuristics. */
async function resolveBinToGltf(diskPath: string): Promise<{ path: string; name: string; note?: string }> {
  const grudge = typeof window !== "undefined" ? (window as any).grudge : null;
  if (grudge?.forge?.resolveSceneOpenPath) {
    const r = await grudge.forge.resolveSceneOpenPath(diskPath);
    if (r?.path && r.path.toLowerCase() !== diskPath.toLowerCase()) {
      return { path: r.path, name: r.name || r.path.split(/[/\\]/).pop() || "scene.gltf", note: r.note };
    }
    if (r?.path?.toLowerCase().endsWith(".gltf") || r?.path?.toLowerCase().endsWith(".glb")) {
      return { path: r.path, name: r.name, note: r.note };
    }
  }
  // Fallback: same stem / scene.gltf (renderer cannot readdir — error if no IPC)
  throw new Error(
    `${diskPath.split(/[/\\]/).pop()} is a glTF .bin buffer. Open scene.gltf (or matching .gltf) in the same folder.`,
  );
}

/**
 * Load Forge multi-entity scene document (entities[] + disk paths).
 * Builds one Group for Elite Viewer / preview.
 */
async function loadForgeSceneDoc(
  data: ForgeSceneDocument,
  opts: LoadModelOptions,
): Promise<LoadedModel> {
  const root = new THREE.Group();
  root.name = data.name || "forge-scene";
  root.userData.forgeScene = {
    version: data.version,
    entityCount: data.entities?.length ?? 0,
  };
  const animations: THREE.AnimationClip[] = [];
  let loadedN = 0;
  const grudge = typeof window !== "undefined" ? (window as any).grudge : null;

  for (const ent of data.entities || []) {
    if (!ent.diskPath) continue;
    try {
      let file: File;
      let diskPath = ent.diskPath;
      if (grudge?.forge?.readFile) {
        const res = await grudge.forge.readFile(ent.diskPath);
        file = new File([res.bytes as BlobPart], res.name || ent.name, {
          type: res.mime || "application/octet-stream",
        });
        diskPath = ent.diskPath;
      } else {
        continue;
      }
      const child = await loadModel(file, {
        diskPath,
        sanitize: opts.sanitize,
        skipMagicBytes: false,
      });
      child.object.name = ent.name || child.object.name;
      if (ent.matrix?.length === 16) applyMatrix(child.object, ent.matrix);
      child.object.visible = ent.visible !== false;
      root.add(child.object);
      if (child.animations?.length) animations.push(...child.animations);
      loadedN++;
    } catch (e) {
      console.warn("[loaders] forge-scene entity failed", ent.name, e);
    }
  }

  if (loadedN === 0) {
    // Empty scene placeholder so viewer still frames something
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x666688, wireframe: true }),
    );
    marker.name = "forge-scene-empty";
    root.add(marker);
  }

  return finishModel(root, animations, null, "forge-scene", {
    toonStyle: true,
    fixDefaultYellow: true,
    ...opts.sanitize,
  });
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
 *
 * Also rewrites Kenney-style `Textures/foo.png` and strips broken absolute
 * prefixes so main mediaProtocol can fallback-search sibling texture folders.
 */
function createAssetManager(resourceDir?: string | null): THREE.LoadingManager {
  const manager = new THREE.LoadingManager();
  manager.addHandler(/\.tga$/i, new TGALoader());
  // BMP sometimes used as FBX sidecar
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
      // Normalize Kenney / Unity relative refs
      let rel = url.replace(/\\/g, "/");
      // "./Textures/x.png" or "Textures/x.png" or "textures\\x.png"
      rel = rel.replace(/^\.\//, "");
      // Relative to model folder (FBX external maps, glTF .bin/.png, OBJ MTL maps)
      const abs = resolveAgainstDir(dir, rel);
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
  /** Skip Toon human unarmed host for clip-only files. */
  skipGenericPreview?: boolean;
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
  let format = detectFormat(file.name);
  if (!format && file.name.toLowerCase().endsWith(".json")) {
    // Content sniff for plain .json (ObjectLoader / glTF / forge-scene)
    try {
      const text =
        file.size > 0
          ? await file.text()
          : opts.diskPath
            ? await (await fetch(localFileUrl(opts.diskPath))).text()
            : "";
      const kind = classifyJsonSceneContent(text);
      if (kind === "gltf-json") format = "gltf";
      else if (kind === "forge-scene") format = "forge-scene";
      else if (kind === "three-objectloader") format = "three-json";
    } catch {
      /* leave null */
    }
  }
  if (!format) throw new Error(`Unsupported format: ${file.name}`);

  // .bin buffer companion → load sibling glTF scene instead
  if (format === "gltf-bin" || isGltfBinFileName(file.name)) {
    if (!opts.diskPath) {
      throw new Error(
        `${file.name} is a glTF .bin buffer companion. Open it from Local Files (disk) so scene.gltf can be resolved.`,
      );
    }
    const resolved = await resolveBinToGltf(opts.diskPath);
    const empty = new File([], resolved.name, { type: "model/gltf+json" });
    return loadModel(empty, {
      ...opts,
      diskPath: resolved.path,
      resourceDir: dirnamePath(resolved.path),
    });
  }

  // Magic-byte gate for glTF — rejects HTML error pages and empty stubs.
  // Empty File + diskPath: probe disk (Local Files placeholder has size 0).
  if (!opts.skipMagicBytes && (format === "glb" || format === "gltf" || format === "vrm")) {
    if (file.size > 0) {
      const buf = await file.arrayBuffer();
      assertMeshBytes(buf, file.name);
    } else if (opts.diskPath) {
      const res = await fetch(localFileUrl(opts.diskPath));
      assertMeshResponseHeaders(res, file.name);
      const buf = await res.arrayBuffer();
      assertMeshBytes(buf, file.name);
    }
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
      case "forge-scene": {
        const text = await (await fetch(urlToUse)).text();
        const data = JSON.parse(text) as ForgeSceneDocument;
        return loadForgeSceneDoc(data, opts);
      }
      case "glb":
      case "gltf":
      case "vrm": {
        const gltfLoader = await createGltfLoader(manager);
        // External .bin / textures: URL modifier rewrites relatives when resourceDir set.
        // For CDN multi-file glTF, setPath to the directory URL (http only).
        if (resourceDir) {
          const pathBase = resourceDir.replace(/\\/g, "/").replace(/\/?$/, "/");
          if (pathBase.startsWith("http://") || pathBase.startsWith("https://")) {
            gltfLoader.setPath(pathBase);
          } else {
            gltfLoader.setPath("");
          }
        } else if (
          /^https?:\/\//i.test(urlToUse) &&
          (format === "gltf" || file.name.toLowerCase().endsWith(".gltf"))
        ) {
          // Remote scene.gltf — resolve buffers/images relative to parent URL
          try {
            const u = new URL(urlToUse);
            const path = u.pathname;
            const slash = path.lastIndexOf("/");
            u.pathname = slash >= 0 ? path.slice(0, slash + 1) : "/";
            u.search = "";
            u.hash = "";
            gltfLoader.setPath(u.toString());
          } catch {
            /* leave default */
          }
        }
        const gltf = await gltfLoader.loadAsync(urlToUse);
        let scene = gltf.scene;
        let hasSkin = false;
        gltf.scene.traverse((n) => {
          if ((n as THREE.SkinnedMesh).isSkinnedMesh) hasSkin = true;
        });
        if (hasSkin) scene = SkeletonUtils.clone(gltf.scene) as THREE.Group;
        const outFmt: ModelFormat = format === "vrm" ? "glb" : format;
        return finishModel(
          scene,
          gltf.animations ?? [],
          gltf,
          outFmt,
          opts.sanitize,
        );
      }
      case "obj": {
        const objLoader = new OBJLoader(manager);
        if (resourceDir) {
          // MTLLoader resolves map_Kd relative to this path
          const mtlLoader = new MTLLoader(manager);
          mtlLoader.setResourcePath(resourceDir.replace(/\\/g, "/").replace(/\/?$/, "/"));
          mtlLoader.setPath(resourceDir.replace(/\\/g, "/").replace(/\/?$/, "/"));
          if (opts.diskPath) {
            const mtlName = (opts.diskPath.split(/[/\\]/).pop() || "model.obj").replace(
              /\.obj$/i,
              ".mtl",
            );
            try {
              const mtl = await mtlLoader.loadAsync(mtlName);
              mtl.preload();
              objLoader.setMaterials(mtl);
            } catch {
              // Fallback: absolute MTL path via media protocol
              try {
                const mtlDisk = opts.diskPath.replace(/\.obj$/i, ".mtl");
                const mtl = await new MTLLoader(manager).loadAsync(localFileUrl(mtlDisk));
                mtl.preload();
                objLoader.setMaterials(mtl);
              } catch {
                /* sibling fill later */
              }
            }
          }
        } else if (opts.diskPath) {
          const mtlDisk = opts.diskPath.replace(/\.obj$/i, ".mtl");
          try {
            const mtl = await new MTLLoader(manager).loadAsync(localFileUrl(mtlDisk));
            mtl.preload();
            objLoader.setMaterials(mtl);
          } catch {
            /* MTL optional */
          }
        }
        const obj = await objLoader.loadAsync(urlToUse);
        return finishModel(obj, [], null, format, opts.sanitize);
      }
      case "css3d": {
        // HTML / CSS quick view plane for layout mockups — not a game mesh bake.
        // Uses a textured plane with optional iframe via CSS3DObject when available.
        const group = new THREE.Group();
        group.name = "css3d-preview";
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(1.6, 0.9),
          new THREE.MeshBasicMaterial({
            color: 0x1a1a22,
            side: THREE.DoubleSide,
          }),
        );
        plane.name = "css3d-plane";
        group.add(plane);
        // Store source URL for Elite Viewer CSS3D overlay
        group.userData.css3d = {
          kind: "html",
          url: urlToUse,
          diskPath: opts.diskPath || null,
        };
        // Label marker
        const frame = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.62, 0.92)),
          new THREE.LineBasicMaterial({ color: 0xc9a04e }),
        );
        group.add(frame);
        return finishModel(group, [], null, "css3d", {
          toonStyle: false,
          fixDefaultYellow: false,
          whiteWhenMapped: false,
          ...opts.sanitize,
        });
      }
      case "fbx": {
        const buf = await (await fetch(urlToUse)).arrayBuffer();
        const ver = parseFbxVersion(buf);
        const grudge = typeof window !== "undefined" ? (window as any).grudge : null;
        const needConvert =
          !ver.threeSupported ||
          (ver.version != null && ver.version < 7000);
        const loadConvertedGlb = async (glbPath: string) => {
          const gltfLoader = await createGltfLoader(manager);
          const gltf = await gltfLoader.loadAsync(localFileUrl(glbPath));
          let scene = gltf.scene;
          let hasSkin = false;
          gltf.scene.traverse((n) => {
            if ((n as THREE.SkinnedMesh).isSkinnedMesh) hasSkin = true;
          });
          if (hasSkin) scene = SkeletonUtils.clone(gltf.scene) as THREE.Group;
          scene.userData.fbxConverted = {
            sourceVersion: ver.version,
            via: "ingest:convert",
          };
          return finishModel(scene, gltf.animations ?? [], gltf, "glb", {
            toonStyle: true,
            fixDefaultYellow: true,
            ...opts.sanitize,
          });
        };
        if (needConvert) {
          if (!opts.diskPath || !grudge?.ingest?.convert) {
            throw new Error(
              `${ver.detail}. Open the file from Local Files so Dev Tool can convert FBX 6.1 (6100) with Blender → GLB. THREE.FBXLoader cannot parse FileVersion 6100.`,
            );
          }
          const conv = await grudge.ingest.convert(opts.diskPath);
          if (!conv?.ok || !conv.converted || !conv.outputPath) {
            const err = (conv?.errors || []).join("; ") || conv?.warnings?.join("; ") || "unknown";
            throw new Error(`FBX ${ver.version ?? "legacy"} convert failed: ${err}`);
          }
          return loadConvertedGlb(conv.outputPath);
        }
        try {
          const fbx = new FBXLoader(manager).parse(buf, resourceDir ? resourceDir.replace(/\\/g, "/") + "/" : "");
          return finishModel(
            fbx,
            (fbx as any).animations ?? [],
            null,
            format,
            { toonStyle: true, fixDefaultYellow: true, ...opts.sanitize },
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/version not supported|FileVersion/i.test(msg) && opts.diskPath && grudge?.ingest?.convert) {
            const conv = await grudge.ingest.convert(opts.diskPath);
            if (conv?.ok && conv.converted && conv.outputPath) {
              return loadConvertedGlb(conv.outputPath);
            }
          }
          throw e;
        }
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
        if (!dae?.scene) throw new Error("Collada load returned empty scene");
        return finishModel(
          dae.scene,
          (dae as { animations?: THREE.AnimationClip[] }).animations ?? [],
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
        const kind = classifyJsonSceneContent(text);
        const data = JSON.parse(text);

        // Forge multi-entity document saved with a .scene.json name
        if (kind === "forge-scene" || (data?.entities && Array.isArray(data.entities) && data.version != null)) {
          return loadForgeSceneDoc(data as ForgeSceneDocument, opts);
        }

        // glTF JSON misnamed as .scene.json
        if (kind === "gltf-json") {
          const gltfLoader = await createGltfLoader(manager);
          if (resourceDir) {
            const pathBase = resourceDir.replace(/\\/g, "/").replace(/\/?$/, "/");
            if (pathBase.startsWith("http://") || pathBase.startsWith("https://")) {
              gltfLoader.setPath(pathBase);
            }
          }
          // Write temp blob as .gltf for GLTFLoader
          const blob = new Blob([text], { type: "model/gltf+json" });
          const gltfUrl = URL.createObjectURL(blob);
          try {
            const gltf = await gltfLoader.loadAsync(
              preferDisk && opts.diskPath ? urlToUse : gltfUrl,
            );
            let scene = gltf.scene;
            let hasSkin = false;
            gltf.scene.traverse((n) => {
              if ((n as THREE.SkinnedMesh).isSkinnedMesh) hasSkin = true;
            });
            if (hasSkin) scene = SkeletonUtils.clone(gltf.scene) as THREE.Group;
            return finishModel(scene, gltf.animations ?? [], gltf, "gltf", opts.sanitize);
          } finally {
            URL.revokeObjectURL(gltfUrl);
          }
        }

        // Three.js ObjectLoader scene graph
        const loader = new THREE.ObjectLoader(manager);
        const parsed = loader.parse(data) as THREE.Object3D;
        const anims: THREE.AnimationClip[] = [];
        // ObjectLoader may attach animations as sibling key (map of name → clip)
        if (Array.isArray((data as { animations?: unknown }).animations)) {
          try {
            const parsedAnims = loader.parseAnimations(
              (data as { animations: unknown[] }).animations as never,
            );
            if (parsedAnims && typeof parsedAnims === "object") {
              anims.push(...Object.values(parsedAnims));
            }
          } catch {
            /* optional */
          }
        }
        const root =
          parsed.type === "Scene" || (parsed as THREE.Scene).isScene
            ? (() => {
                const g = new THREE.Group();
                g.name = parsed.name || "three-scene";
                g.userData.threeScene = true;
                // Preserve lights/cameras/meshes as children
                while (parsed.children.length) g.add(parsed.children[0]);
                // Copy fog / background if present
                const sc = parsed as THREE.Scene;
                if (sc.background) g.userData.sceneBackground = sc.background;
                if (sc.environment) g.userData.sceneEnvironment = sc.environment;
                if (sc.fog) g.userData.sceneFog = sc.fog;
                return g;
              })()
            : parsed;
        root.userData.threeObjectLoader = true;
        return finishModel(root, anims, null, "three-json", {
          toonStyle: false,
          fixDefaultYellow: true,
          whiteWhenMapped: true,
          ...opts.sanitize,
        });
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
  try {
    const { bindGenericPreviewHost, isAnimWithoutMesh } = await import("./genericPreview");
    if (isAnimWithoutMesh(loaded) && !opts.skipGenericPreview) {
      loaded = await bindGenericPreviewHost(loaded);
      const stats = tallyStats(loaded.object);
      loaded.triangles = stats.triangles;
      loaded.vertices = stats.vertices;
      loaded.bones = stats.bones;
    }
  } catch (e) {
    console.warn("[loadModel] generic preview host failed", e);
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
  // Local disk elite path: stream via grudge-media so relatives (bin/png/tga) resolve
  if (opts.diskPath && typeof window !== "undefined") {
    const name =
      filenameHint ||
      opts.diskPath.split(/[/\\]/).pop() ||
      "model.glb";
    const format = detectFormat(name);
    try {
      // Empty File + diskPath: loadModel probes magic from disk and loads via media protocol
      const file = new File([], name, { type: "application/octet-stream" });
      return await loadModel(file, {
        ...opts,
        diskPath: opts.diskPath,
        skipMagicBytes: format !== "glb" && format !== "gltf" && format !== "vrm"
          ? true
          : opts.skipMagicBytes,
      });
    } catch (diskErr) {
      console.warn("[loadModelFromUrl] disk path failed", diskErr);
      /* fall through to URL fetch */
    }
  }

  const res = await fetch(url);
  assertMeshResponseHeaders(res, filenameHint || url);
  const buf = await res.arrayBuffer();
  const name =
    filenameHint ||
    url.split("?")[0].split("/").pop() ||
    "model.glb";
  if (!opts.skipMagicBytes) {
    const lower = name.toLowerCase();
    if (lower.endsWith(".glb") || lower.endsWith(".gltf") || lower.endsWith(".vrm")) {
      try {
        assertMeshBytes(buf, name);
      } catch (e) {
        const p = probeMagic(buf);
        if (!p.okForMesh) throw e;
      }
    } else if (!detectFormat(name) && buf.byteLength > 12) {
      // Unknown ext — still refuse HTML/empty stubs if it claims to be mesh bytes
      const p = probeMagic(buf);
      if (p.kind === "html" || p.kind === "json-stub" || p.bytes === 0) {
        throw new Error(
          `${name}: not a valid mesh (${p.detail}). Reject HTML/error pages and empty stubs.`,
        );
      }
    }
  }
  const type = name.toLowerCase().endsWith(".glb")
    ? "model/gltf-binary"
    : name.toLowerCase().endsWith(".gltf")
      ? "model/gltf+json"
      : "application/octet-stream";
  const file = new File([buf], name, { type });
  // For remote multi-file .gltf, pass resourceDir from URL parent
  let resourceDir = opts.resourceDir;
  if (!resourceDir && /^https?:\/\//i.test(url) && name.toLowerCase().endsWith(".gltf")) {
    try {
      const u = new URL(url);
      const path = u.pathname;
      const slash = path.lastIndexOf("/");
      u.pathname = slash >= 0 ? path.slice(0, slash + 1) : "/";
      u.search = "";
      u.hash = "";
      resourceDir = u.toString();
    } catch {
      /* ignore */
    }
  }
  return loadModel(file, { ...opts, resourceDir, skipMagicBytes: true });
}

/** Compute a tight bounding box in world space (after applying transforms). */
export function computeBounds(object: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3().setFromObject(object);
  return box;
}
