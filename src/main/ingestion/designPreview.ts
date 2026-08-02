/**
 * Design / DCC preview helpers for elite viewer.
 * - PSD/PSB → composite PNG via ag-psd + sharp
 * - BLEND → GLB via Blender convert pipeline
 * - Other design formats → metadata + system open fallback
 */
import { promises as fs } from "node:fs";
import { basename, extname, join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readPsd } from "ag-psd";
import log from "../logger";
import { convertFile } from "./convert";
import { verifyFile } from "./sizeVerify";

export type DesignKind =
  | "psd"
  | "blend"
  | "texture-gpu"
  | "hdr"
  | "game-data"
  | "dcc-other";

export function designKindForPath(name: string): DesignKind | null {
  const ext = extname(name).toLowerCase();
  if (ext === ".psd" || ext === ".psb") return "psd";
  if (ext === ".blend") return "blend";
  if ([".ktx", ".ktx2", ".basis", ".dds", ".astc"].includes(ext)) return "texture-gpu";
  if ([".hdr", ".exr", ".rgbe"].includes(ext)) return "hdr";
  if ([".tmx", ".tsx", ".atlas", ".spine", ".skel", ".ase", ".aseprite"].includes(ext)) {
    return "game-data";
  }
  if ([".xcf", ".kra", ".clip", ".afdesign", ".afphoto", ".procreate"].includes(ext)) {
    return "dcc-other";
  }
  if ([".vrm", ".usdz", ".abc", ".usda", ".usdc", ".usd"].includes(ext)) return "dcc-other";
  return null;
}

export function needsAutoPrepare(name: string): boolean {
  const k = designKindForPath(name);
  return k === "psd" || k === "blend";
}

export interface PrepareResult {
  ok: boolean;
  error?: string;
  path?: string;
  contentType?: string;
  note?: string;
  sourceFormat?: string;
  layerCount?: number;
  width?: number;
  height?: number;
}

function loadSharp(): typeof import("sharp") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("sharp");
}

function countLayers(psd: { children?: unknown[] }): number {
  let n = 0;
  const walk = (nodes?: unknown[]) => {
    if (!nodes) return;
    for (const node of nodes) {
      n++;
      const ch = (node as { children?: unknown[] }).children;
      if (ch) walk(ch);
    }
  };
  walk(psd.children);
  return n;
}

async function writeRgbaPng(
  outPath: string,
  width: number,
  height: number,
  data: Uint8Array | Uint8ClampedArray,
): Promise<void> {
  const sharp = loadSharp();
  const raw = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  await sharp(raw, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toFile(outPath);
}

/**
 * Rasterize PSD/PSB composite to a temp PNG for the elite viewer.
 */
export async function preparePsdPreview(absPath: string): Promise<PrepareResult> {
  try {
    const buf = await fs.readFile(absPath);
    // useImageData avoids browser canvas; composite lives in psd.imageData when present
    const psd = readPsd(buf, {
      skipLayerImageData: true,
      skipCompositeImageData: false,
      skipThumbnail: false,
      useImageData: true,
      throwForMissingFeatures: false,
    });

    const dir = await mkdtemp(join(tmpdir(), "grudge-psd-"));
    const outPath = join(dir, `${basename(absPath, extname(absPath))}.preview.png`);
    const layers = countLayers(psd);
    const w = psd.width ?? 0;
    const h = psd.height ?? 0;

    const imageData = psd.imageData as
      | { data: Uint8Array | Uint8ClampedArray; width: number; height: number }
      | undefined;

    if (imageData?.data && imageData.width > 0 && imageData.height > 0) {
      await writeRgbaPng(outPath, imageData.width, imageData.height, imageData.data);
      return {
        ok: true,
        path: outPath,
        contentType: "image/png",
        note: `PSD composite · ${imageData.width}×${imageData.height}${layers ? ` · ${layers} layers` : ""}`,
        sourceFormat: "psd",
        layerCount: layers,
        width: imageData.width,
        height: imageData.height,
      };
    }

    return {
      ok: false,
      error:
        "Could not extract PSD composite (empty imageData). Export a PNG from Photoshop or use a flattened PSD.",
      sourceFormat: "psd",
      layerCount: layers,
      width: w,
      height: h,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn("[designPreview] PSD prepare failed", msg);
    return { ok: false, error: msg, sourceFormat: "psd" };
  }
}

/** Convert .blend to GLB via Blender/FBX2glTF toolchain. */
export async function prepareBlendPreview(absPath: string): Promise<PrepareResult> {
  try {
    const dir = await mkdtemp(join(tmpdir(), "grudge-blend-"));
    const verify = await verifyFile(absPath);
    const converted = await convertFile(absPath, verify, { outDir: dir });
    if (!converted.ok || !converted.outputPath) {
      return {
        ok: false,
        error:
          (converted.errors && converted.errors.join("; ")) ||
          "Blend → GLB failed. Install Blender (Settings → Toolchain) or export GLB from Blender.",
        sourceFormat: "blend",
        note: converted.warnings?.join(" · "),
      };
    }
    return {
      ok: true,
      path: converted.outputPath,
      contentType: "model/gltf-binary",
      note: `Converted from Blender · ${basename(absPath)} → ${basename(converted.outputPath)}`,
      sourceFormat: "blend",
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn("[designPreview] blend prepare failed", msg);
    return { ok: false, error: msg, sourceFormat: "blend" };
  }
}

export async function prepareForEliteViewer(
  absPath: string,
): Promise<PrepareResult & { originalPath: string }> {
  const kind = designKindForPath(absPath);
  const base = { originalPath: absPath };
  if (kind === "psd") {
    return { ...base, ...(await preparePsdPreview(absPath)) };
  }
  if (kind === "blend") {
    return { ...base, ...(await prepareBlendPreview(absPath)) };
  }
  return {
    ...base,
    ok: true,
    path: absPath,
    note: kind
      ? `Limited native preview for ${kind} — Convert or Open with system app`
      : undefined,
    sourceFormat: kind ?? undefined,
  };
}
