import * as THREE from "three";
import { GLTFExporter, type GLTFExporterOptions } from "three/addons/exporters/GLTFExporter.js";
import {
  loadModel,
  type LoadModelOptions,
  type ModelFormat,
  detectFormat,
} from "./loaders";

export interface ExportResult {
  blob: Blob;
  bytes: ArrayBuffer;
  filename: string;
  triangles: number;
  vertices: number;
  durationMs: number;
  /** True when source was css3d/html — not a production mesh bake. */
  previewOnly?: boolean;
}

/**
 * Export an Object3D (with optional animations) as GLB.
 * Embeds maps currently bound on materials (best-effort for game pack use).
 * Prefer diskPath on load first so Kenney/FBX external textures are present.
 */
export async function exportToGlb(
  object: THREE.Object3D,
  animations: THREE.AnimationClip[] = [],
  filenameBase = "scene",
  opts: GLTFExporterOptions = {},
): Promise<ExportResult> {
  const start = performance.now();
  // Ensure maps are ready before export (avoid blank embeds)
  object.traverse((n) => {
    const m = n as THREE.Mesh;
    if (!m.isMesh || !m.material) return;
    const list = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of list) {
      const std = mat as THREE.MeshStandardMaterial;
      if (std?.map) std.map.needsUpdate = true;
      if (std) std.needsUpdate = true;
    }
  });
  const exporter = new GLTFExporter();
  const buffer: ArrayBuffer = await new Promise((resolve, reject) => {
    exporter.parse(
      object,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error("GLTFExporter returned JSON instead of binary GLB"));
      },
      (err) => reject(err),
      {
        binary: true,
        animations,
        includeCustomExtensions: true,
        onlyVisible: false,
        embedImages: true,
        ...opts,
      },
    );
  });
  let triangles = 0;
  let vertices = 0;
  object.traverse((node) => {
    const m = node as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      const pos = m.geometry.getAttribute("position");
      if (pos) {
        vertices += pos.count;
        triangles += m.geometry.index ? m.geometry.index.count / 3 : pos.count / 3;
      }
    }
  });
  return {
    blob: new Blob([buffer], { type: "model/gltf-binary" }),
    bytes: buffer,
    filename: `${filenameBase}.glb`,
    triangles: Math.round(triangles),
    vertices,
    durationMs: Math.round(performance.now() - start),
  };
}

export interface ConvertToGlbOptions extends LoadModelOptions {
  /** Override output basename (no extension). */
  filenameBase?: string;
}

/**
 * Convert an arbitrary supported file → convenience GLB (Elite / local Forge).
 * Uses the same production `loadModel` (Draco + Meshopt + KTX2 + sanitize).
 * Always pass `diskPath` for local files so relative textures embed correctly.
 * HTML/CSS3D is not a game bake.
 *
 * Production CDN bake stays main-process `convertFile` (FBX2glTF / Blender)
 * then `optimizeWebFile` (gltf-transform meshopt) — not this browser exporter.
 */
export async function convertToGlb(
  file: File,
  opts: ConvertToGlbOptions = {},
): Promise<ExportResult> {
  const fmt = detectFormat(file.name);
  if (fmt === "css3d") {
    throw new Error(
      "HTML/CSS3D is for Elite quick view only — convert UI mockups separately; use OBJ/FBX/GLB for game meshes",
    );
  }
  const loaded = await loadModel(file, {
    diskPath: opts.diskPath,
    resourceDir: opts.resourceDir,
    sanitize: {
      toonStyle: true,
      fixDefaultYellow: true,
      whiteWhenMapped: true,
      ...opts.sanitize,
    },
    ...opts,
  });
  const base =
    opts.filenameBase || file.name.replace(/\.[^.]+$/, "").replace(/\s+/g, "_");
  return exportToGlb(loaded.object, loaded.animations, base);
}

/** Helper: trigger a browser download for an exported blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Format-supported list shown in the UI / accept attribute. */
export const SUPPORTED_FORMATS: ModelFormat[] = [
  "glb",
  "gltf",
  "gltf-bin",
  "vrm",
  "obj",
  "fbx",
  "stl",
  "ply",
  "dae",
  "3mf",
  "three-json",
  "forge-scene",
  "css3d",
];
export const ACCEPT_ATTR = [
  ".glb",
  ".gltf",
  ".bin",
  ".vrm",
  ".obj",
  ".fbx",
  ".stl",
  ".ply",
  ".dae",
  ".3mf",
  ".json",
  ".scene.json",
  ".three.json",
  ".forge-scene.json",
  ".gfscene",
  ".scene",
  ".html",
  ".htm",
].join(",");

/** Game-ship formats (exclude css3d / pure preview). */
export const GAME_MESH_FORMATS: ModelFormat[] = [
  "glb",
  "gltf",
  "vrm",
  "obj",
  "fbx",
  "stl",
  "ply",
  "dae",
  "3mf",
  "three-json",
  "forge-scene",
];
