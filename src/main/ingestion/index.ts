import { createReadStream, promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { extname, basename } from "node:path";
import { verifyFile, type SizeVerifyResult } from "./sizeVerify";
import { convertFile, makeThumbnail, type ConvertResult } from "./convert";
import { enrichAsset, type EnrichResult } from "./enrich";
import { inspectRig, type RigResult } from "./rig";
import { generateGrudgeUUID } from "../../shared/grudgeUUID";

export interface IngestOptions {
  category?: string;
  packId?: string;
  packVersion?: string;
  /** A 1..N ordinal for the Grudge UUID itemId (must fit 4 digits). */
  itemId: number;
  /** Skip flags for the optional stages. */
  skipConvert?: boolean;
  skipEnrich?: boolean;
  skipRig?: boolean;
  /** Enrich query (only used when not skipped). */
  enrichQuery?: string;
  enrichAssetType?: "model" | "material" | "brush" | "hdr" | "scene";
  /** Output directory for converted/companion files. */
  outDir?: string;
  /** Generate a 256px JPG thumbnail next to the asset. */
  makeThumbnail?: boolean;
}

export interface IngestEntry {
  ok: boolean;
  errors: string[];
  warnings: string[];
  // identity
  grudgeUUID: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
  // routing
  sourcePath: string;
  outputPath: string;          // path to upload
  companions: { path: string; role: string; sizeBytes: number }[];
  thumbnailPath?: string;
  // metadata
  family: string;
  category?: string;
  rig: string;
  jointCount: number;
  hasAnimations: boolean;
  conversionKind: string;
  enriched: boolean;
  // raw stage results (for debugging / manifest detail)
  stages: {
    sizeVerify: SizeVerifyResult;
    convert: ConvertResult;
    enrich: EnrichResult;
    rig: RigResult;
  };
}

const SLOT_BY_FAMILY: Record<string, string> = {
  image: "Texture",
  spritesheet: "Sprite",
  model: "BlendModel",
  audio: "Audio",
  scene: "Item",
  json: "Item",
  doc: "Item",
  other: "Other",
};

const CONTENT_TYPE: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".tga": "image/x-tga",
  ".bmp": "image/bmp",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".fbx": "application/octet-stream",
  ".blend": "application/x-blender",
  ".obj": "model/obj",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".txt": "text/plain",
};

function contentTypeFor(p: string): string {
  return CONTENT_TYPE[extname(p).toLowerCase()] || "application/octet-stream";
}

async function sha256File(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(p);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Run the full ingestion pipeline against a single file.
 * Stages execute in order; a failure in any stage marks the entry not-ok but
 * still emits as much data as possible so the caller can show a useful error.
 */
export async function ingestOne(absPath: string, opts: IngestOptions): Promise<IngestEntry> {
  // 1. size-verify
  const sizeRes = await verifyFile(absPath, { category: opts.category });

  // 2. convert (only if size-verify passed; otherwise fast-fail with a stub)
  let convertRes: ConvertResult;
  if (sizeRes.ok) {
    convertRes = await convertFile(absPath, sizeRes, { skip: opts.skipConvert, outDir: opts.outDir });
  } else {
    convertRes = {
      ok: false, errors: ["aborted: size-verify failed"], warnings: [],
      outputPath: absPath, companions: [], converted: false, conversionKind: "none",
    };
  }

  // 3. enrich (best-effort, never blocks)
  const enrichRes = sizeRes.ok && convertRes.ok
    ? await enrichAsset(convertRes.outputPath, {
        skip: opts.skipEnrich, query: opts.enrichQuery, assetType: opts.enrichAssetType, outDir: opts.outDir,
      })
    : { ok: true, errors: [], warnings: [], enriched: false, outputPath: convertRes.outputPath };

  // 4. rig
  const rigRes = await inspectRig(enrichRes.outputPath, { category: opts.category, skip: opts.skipRig });

  // 5. hash + UUID (always computed, even on failure, for traceability)
  const finalPath = enrichRes.outputPath;
  let sha = "";
  try { sha = await sha256File(finalPath); } catch { /* ignore */ }
  const stat = await fs.stat(finalPath).catch(() => ({ size: 0 } as any));

  const slot = SLOT_BY_FAMILY[sizeRes.family] || "Item";
  const grudgeUUID = generateGrudgeUUID(slot, null, opts.itemId);

  // 6. optional thumbnail (image only, unless model+blender path produced one elsewhere)
  let thumbPath: string | undefined;
  if (opts.makeThumbnail && (sizeRes.family === "image" || sizeRes.family === "spritesheet")) {
    const t = await makeThumbnail(absPath, opts.outDir ?? require("node:os").tmpdir());
    if (t) thumbPath = t;
  }

  const ok =
    sizeRes.ok &&
    convertRes.ok &&
    enrichRes.ok &&
    rigRes.ok;

  return {
    ok,
    errors: [...sizeRes.errors, ...convertRes.errors, ...enrichRes.errors, ...rigRes.errors],
    warnings: [...sizeRes.warnings, ...convertRes.warnings, ...enrichRes.warnings, ...rigRes.warnings],
    grudgeUUID,
    sha256: sha,
    sizeBytes: stat.size ?? 0,
    contentType: contentTypeFor(finalPath),
    sourcePath: absPath,
    outputPath: finalPath,
    companions: convertRes.companions,
    thumbnailPath: thumbPath,
    family: sizeRes.family,
    category: opts.category,
    rig: rigRes.rig,
    jointCount: rigRes.jointCount,
    hasAnimations: rigRes.hasAnimations,
    conversionKind: convertRes.conversionKind,
    enriched: enrichRes.enriched,
    stages: { sizeVerify: sizeRes, convert: convertRes, enrich: enrichRes, rig: rigRes },
  };
}

export { verifyFile, convertFile, makeThumbnail, enrichAsset, inspectRig };
