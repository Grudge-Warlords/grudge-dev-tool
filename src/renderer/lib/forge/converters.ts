import * as THREE from "three";
import { GLTFExporter, type GLTFExporterOptions } from "three/examples/jsm/exporters/GLTFExporter.js";
import { loadModel, type ModelFormat } from "./loaders";

export interface ExportResult {
  blob: Blob;
  bytes: ArrayBuffer;
  filename: string;
  triangles: number;
  vertices: number;
  durationMs: number;
}

/**
 * Export an Object3D (with optional animations) as GLB.
 * GLTFExporter does the binary chunk packing for us; we then wrap in a Blob
 * the renderer can hand to URL.createObjectURL or upload via fetch().
 */
export async function exportToGlb(
  object: THREE.Object3D,
  animations: THREE.AnimationClip[] = [],
  filenameBase = "scene",
  opts: GLTFExporterOptions = {},
): Promise<ExportResult> {
  const start = performance.now();
  const exporter = new GLTFExporter();
  const buffer: ArrayBuffer = await new Promise((resolve, reject) => {
    exporter.parse(
      object,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error("GLTFExporter returned JSON instead of binary GLB"));
      },
      (err) => reject(err),
      { binary: true, animations, includeCustomExtensions: true, ...opts },
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

/** Convert an arbitrary file → GLB. Round-trip via three loaders + GLTFExporter. */
export async function convertToGlb(file: File): Promise<ExportResult> {
  const loaded = await loadModel(file);
  const base = file.name.replace(/\.[^.]+$/, "");
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
export const SUPPORTED_FORMATS: ModelFormat[] = ["glb", "gltf", "obj", "fbx", "stl", "ply", "dae", "3mf"];
export const ACCEPT_ATTR = SUPPORTED_FORMATS.map((f) => `.${f}`).join(",");
