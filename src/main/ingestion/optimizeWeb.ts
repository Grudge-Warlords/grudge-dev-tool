/**
 * grudge-web-v1 — production-ish GLB optimize via @gltf-transform.
 *
 * Pipeline (safe for skinned / animated assets):
 *   dedup → prune → resample → textureCompress (sharp WebP + max edge) → meshopt
 *
 * Does NOT flatten/join (breaks skins) or aggressive simplify by default.
 */

import { promises as fs } from "node:fs";
import { basename, extname, join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { convertFile } from "./convert";
import { verifyFile } from "./sizeVerify";

export const OPTIMIZE_PROFILE = "grudge-web-v1" as const;

export interface OptimizeWebOptions {
  /** Max texture edge length (px). Default 2048. */
  maxTextureSize?: number;
  /** WebP quality 1–100. Default 82. */
  textureQuality?: number;
  /** Meshopt level. Default "medium". */
  meshoptLevel?: "medium" | "high";
  /** Skip meshopt (still dedup/prune/resample/textures). */
  skipMeshopt?: boolean;
  /** Skip texture recompress. */
  skipTextures?: boolean;
  /** Output directory (defaults to temp). */
  outDir?: string;
}

export interface OptimizeWebResult {
  ok: boolean;
  error?: string;
  profile: typeof OPTIMIZE_PROFILE;
  /** Absolute path to optimized .glb */
  path?: string;
  name?: string;
  beforeBytes: number;
  afterBytes: number;
  reductionPct: number;
  steps: string[];
  warnings: string[];
  stats?: {
    before: { meshes: number; materials: number; textures: number; animations: number };
    after: { meshes: number; materials: number; textures: number; animations: number };
  };
}

function reduction(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.round(((before - after) / before) * 1000) / 10;
}

function docStats(doc: any): { meshes: number; materials: number; textures: number; animations: number } {
  const root = doc.getRoot();
  return {
    meshes: root.listMeshes?.().length ?? 0,
    materials: root.listMaterials?.().length ?? 0,
    textures: root.listTextures?.().length ?? 0,
    animations: root.listAnimations?.().length ?? 0,
  };
}

/** Ensure input is a .glb/.gltf on disk (convert FBX/OBJ/… first). */
async function ensureGltfOnDisk(
  absPath: string,
  outDir: string,
): Promise<{ path: string; warnings: string[] }> {
  const ext = extname(absPath).toLowerCase();
  if (ext === ".glb" || ext === ".gltf") return { path: absPath, warnings: [] };
  const verify = await verifyFile(absPath);
  const conv = await convertFile(absPath, verify, { outDir });
  if (!conv.ok) {
    throw new Error(conv.errors.join("; ") || "Pre-convert failed");
  }
  const outExt = extname(conv.outputPath).toLowerCase();
  if (outExt !== ".glb" && outExt !== ".gltf") {
    throw new Error(`Convert did not produce glTF (got ${outExt || "unknown"})`);
  }
  return {
    path: conv.outputPath,
    warnings: [
      ...conv.warnings,
      `Pre-converted via ${conv.conversionKind} → ${basename(conv.outputPath)}`,
    ],
  };
}

/**
 * Optimize a local model file. Returns a new temp .glb path + before/after sizes.
 */
export async function optimizeWebFile(
  absPath: string,
  opts: OptimizeWebOptions = {},
): Promise<OptimizeWebResult> {
  const steps: string[] = [];
  const warnings: string[] = [];
  const maxTex = opts.maxTextureSize ?? 2048;
  const quality = opts.textureQuality ?? 82;
  const meshoptLevel = opts.meshoptLevel ?? "medium";

  let beforeBytes = 0;
  try {
    const st = await fs.stat(absPath);
    beforeBytes = st.size;
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message ?? "Input file missing",
      profile: OPTIMIZE_PROFILE,
      beforeBytes: 0,
      afterBytes: 0,
      reductionPct: 0,
      steps,
      warnings,
    };
  }

  const outDir = opts.outDir ?? (await mkdtemp(join(tmpdir(), "grudge-opt-")));
  await fs.mkdir(outDir, { recursive: true });

  try {
    const prepared = await ensureGltfOnDisk(absPath, outDir);
    warnings.push(...prepared.warnings);
    if (prepared.path !== absPath) {
      steps.push("convert→glb");
      try {
        beforeBytes = (await fs.stat(prepared.path)).size;
      } catch { /* keep original beforeBytes */ }
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NodeIO } = require("@gltf-transform/core");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ALL_EXTENSIONS } = require("@gltf-transform/extensions");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fn = require("@gltf-transform/functions");

    let MeshoptEncoder: any = null;
    let MeshoptDecoder: any = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const meshopt = require("meshoptimizer");
      MeshoptEncoder = meshopt.MeshoptEncoder;
      MeshoptDecoder = meshopt.MeshoptDecoder;
      if (MeshoptEncoder?.ready) await MeshoptEncoder.ready;
      if (MeshoptDecoder?.ready) await MeshoptDecoder.ready;
    } catch {
      warnings.push("meshoptimizer package unavailable — skipping meshopt compression");
    }

    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    if (MeshoptDecoder && MeshoptEncoder) {
      io.registerDependencies({
        "meshopt.decoder": MeshoptDecoder,
        "meshopt.encoder": MeshoptEncoder,
      });
    }

    const doc = await io.read(prepared.path);
    const beforeStats = docStats(doc);

    const transforms: any[] = [];
    if (typeof fn.dedup === "function") {
      transforms.push(fn.dedup());
      steps.push("dedup");
    }
    if (typeof fn.prune === "function") {
      transforms.push(fn.prune());
      steps.push("prune");
    }
    if (typeof fn.resample === "function") {
      transforms.push(fn.resample());
      steps.push("resample");
    }

    if (!opts.skipTextures && typeof fn.textureCompress === "function") {
      let sharpEnc: unknown;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        sharpEnc = require("sharp");
      } catch {
        sharpEnc = undefined;
        warnings.push("sharp unavailable — textureCompress uses limited fallback");
      }
      transforms.push(
        fn.textureCompress({
          encoder: sharpEnc,
          targetFormat: "webp",
          resize: [maxTex, maxTex],
          quality,
          // Leave already-webp / basis alone via formats filter if supported
          formats: /^(jpeg|jpg|png)$/i,
        }),
      );
      steps.push(`textureCompress(webp,max${maxTex})`);
    }

    if (!opts.skipMeshopt && MeshoptEncoder && typeof fn.meshopt === "function") {
      transforms.push(fn.meshopt({ encoder: MeshoptEncoder, level: meshoptLevel }));
      steps.push(`meshopt(${meshoptLevel})`);
    } else if (!opts.skipMeshopt && !MeshoptEncoder) {
      warnings.push("Meshopt skipped (encoder missing)");
    }

    if (transforms.length === 0) {
      return {
        ok: false,
        error: "No gltf-transform functions available",
        profile: OPTIMIZE_PROFILE,
        beforeBytes,
        afterBytes: beforeBytes,
        reductionPct: 0,
        steps,
        warnings,
      };
    }

    await doc.transform(...transforms);
    const afterStats = docStats(doc);

    const base = basename(prepared.path).replace(/\.(glb|gltf)$/i, "");
    const outName = `${base}.web.glb`;
    const outPath = join(outDir, outName);
    await io.write(outPath, doc);

    const afterBytes = (await fs.stat(outPath)).size;
    steps.push("write.glb");

    return {
      ok: true,
      profile: OPTIMIZE_PROFILE,
      path: outPath,
      name: outName,
      beforeBytes,
      afterBytes,
      reductionPct: reduction(beforeBytes, afterBytes),
      steps,
      warnings,
      stats: { before: beforeStats, after: afterStats },
    };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message ?? String(e),
      profile: OPTIMIZE_PROFILE,
      beforeBytes,
      afterBytes: 0,
      reductionPct: 0,
      steps,
      warnings,
    };
  }
}
