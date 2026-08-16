/**
 * Fleet production GLTF loader — same factory as ThreeFlow `src/utils/gltfProdLoader.ts`.
 *
 * r185 DRACOLoader hashes decoder WASM via import.meta.url — do not fetch
 * gstatic.com (viewer CSP blocks it → empty Draco meshes).
 * Meshopt from three/addons (not npm `meshoptimizer` decoder).
 * KTX2 is lazy: bind after a live WebGLRenderer exists.
 *
 * Dev Tool also accepts a LoadingManager so Elite/local opens can rewrite
 * sibling textures via grudge-media. ThreeFlow's singleton cannot do that.
 */
import type { LoadingManager, WebGLRenderer } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

let draco: DRACOLoader | null = null;
let ktx2: import("three/addons/loaders/KTX2Loader.js").KTX2Loader | null = null;
let ktx2Bound = false;
let ktx2Pending: Promise<void> | null = null;
let singleton: GLTFLoader | null = null;
let meshoptReady: Promise<void> | null = null;

function ensureMeshoptReady(): Promise<void> {
  if (!meshoptReady) {
    const ready = (MeshoptDecoder as { ready?: Promise<unknown> }).ready;
    meshoptReady = ready != null ? Promise.resolve(ready).then(() => undefined) : Promise.resolve();
  }
  return meshoptReady;
}

function getDraco(): DRACOLoader {
  if (!draco) {
    draco = new DRACOLoader();
    // r185 default WASM via import.meta.url. Do not setDecoderPath(gstatic)
    // and do not force type:"js" — both empty compressed GLBs under Electron CSP.
  }
  return draco;
}

function attachDecoders(loader: GLTFLoader): void {
  loader.setDRACOLoader(getDraco());
  loader.setMeshoptDecoder(MeshoptDecoder as never);
  if (ktx2) loader.setKTX2Loader(ktx2);
}

/** Per-open loader (Elite/Forge) — keeps LoadingManager URL rewrite + TGA handler. */
export async function createProductionGltfLoader(
  manager?: LoadingManager,
): Promise<GLTFLoader> {
  await ensureMeshoptReady();
  const loader = new GLTFLoader(manager);
  attachDecoders(loader);
  return loader;
}

/** Shared CDN loader (no manager) — same name as ThreeFlow. */
export function getProductionGltfLoader(): GLTFLoader {
  if (!singleton) {
    singleton = new GLTFLoader();
    attachDecoders(singleton);
  }
  return singleton;
}

/** Attach KTX2 only when a renderer exists — keeps Basis WASM off first paint. */
export function bindProductionKtx2(renderer: WebGLRenderer | null | undefined): Promise<void> {
  if (!renderer || ktx2Bound) return Promise.resolve();
  if (ktx2Pending) return ktx2Pending;
  ktx2Pending = import("three/addons/loaders/KTX2Loader.js")
    .then(({ KTX2Loader }) => {
      const next = new KTX2Loader();
      next.detectSupport(renderer);
      ktx2 = next;
      if (singleton) singleton.setKTX2Loader(next);
      ktx2Bound = true;
    })
    .catch((err) => {
      console.warn("[gltfProdLoader] KTX2 transcoder skipped", err);
    })
    .finally(() => {
      ktx2Pending = null;
    });
  return ktx2Pending;
}

export function disposeProductionGltfLoader(): void {
  draco?.dispose();
  try {
    ktx2?.dispose();
  } catch {
    /* optional */
  }
  draco = null;
  ktx2 = null;
  singleton = null;
  ktx2Bound = false;
  ktx2Pending = null;
  meshoptReady = null;
}
