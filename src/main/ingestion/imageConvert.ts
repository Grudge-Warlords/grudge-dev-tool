/**
 * Image conversion pipeline for Upload + Asset Viewer.
 * Uses sharp (libvips) for TGA/TIFF/HEIF/AVIF/WebP/PNG/JPEG and companions.
 */
import { promises as fs } from "node:fs";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import log from "../logger";

export type ImageOutFormat = "png" | "webp" | "jpeg" | "avif" | "gif";

export interface ImageConvertOptions {
  format: ImageOutFormat;
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** Keep alpha when possible (png/webp/avif). */
  keepAlpha?: boolean;
}

export interface ImageMeta {
  width: number;
  height: number;
  format?: string;
  space?: string;
  channels?: number;
  hasAlpha?: boolean;
  density?: number;
  sizeBytes: number;
}

export interface ImageConvertResult {
  ok: boolean;
  error?: string;
  path?: string;
  name?: string;
  format?: ImageOutFormat;
  beforeBytes?: number;
  afterBytes?: number;
  meta?: ImageMeta;
}

function loadSharp(): typeof import("sharp") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("sharp");
}

/** Extensions sharp can decode for us (input). */
export const IMAGE_INPUT_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".tif", ".tiff",
  ".bmp", ".tga", ".svg", ".heic", ".heif", ".ico", ".jp2", ".jxl",
]);

export function isConvertibleImagePath(name: string): boolean {
  return IMAGE_INPUT_EXTS.has(extname(name).toLowerCase());
}

export async function inspectImage(absPath: string): Promise<ImageMeta | null> {
  try {
    const sharp = loadSharp();
    const st = await fs.stat(absPath);
    const meta = await sharp(absPath).metadata();
    return {
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      format: meta.format,
      space: meta.space,
      channels: meta.channels,
      hasAlpha: meta.hasAlpha,
      density: meta.density,
      sizeBytes: st.size,
    };
  } catch (e) {
    log.warn("[imageConvert] inspect failed", e);
    return null;
  }
}

export async function convertImageFile(
  absPath: string,
  opts: ImageConvertOptions,
  outDir?: string,
): Promise<ImageConvertResult> {
  try {
    const sharp = loadSharp();
    const before = (await fs.stat(absPath)).size;
    const meta = await inspectImage(absPath);
    const dir = outDir ?? (await mkdtemp(join(tmpdir(), "grudge-img-")));
    await fs.mkdir(dir, { recursive: true });

    const format = opts.format;
    const quality = opts.quality ?? (format === "png" ? 90 : 86);
    const base = basename(absPath, extname(absPath));
    const outName = `${base}.${format === "jpeg" ? "jpg" : format}`;
    const outPath = join(dir, outName);

    let pipeline = sharp(absPath, {
      // animated gif/webp: take first frame for still export unless gif out
      animated: format === "gif",
      limitInputPixels: 268_402_689, // ~16k² safety
    });

    if (opts.maxWidth || opts.maxHeight) {
      pipeline = pipeline.resize({
        width: opts.maxWidth,
        height: opts.maxHeight,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    switch (format) {
      case "png":
        pipeline = pipeline.png({
          compressionLevel: 9,
          effort: 7,
          palette: false,
        });
        break;
      case "webp":
        pipeline = pipeline.webp({
          quality,
          effort: 5,
          alphaQuality: opts.keepAlpha === false ? 0 : 90,
        });
        break;
      case "jpeg":
        pipeline = pipeline.flatten({ background: "#0a0e1a" }).jpeg({
          quality,
          mozjpeg: true,
        });
        break;
      case "avif":
        pipeline = pipeline.avif({ quality, effort: 4 });
        break;
      case "gif":
        pipeline = pipeline.gif();
        break;
      default:
        return { ok: false, error: `Unsupported format: ${format}` };
    }

    await pipeline.toFile(outPath);
    const after = (await fs.stat(outPath)).size;
    const outMeta = await inspectImage(outPath);

    return {
      ok: true,
      path: outPath,
      name: outName,
      format,
      beforeBytes: before,
      afterBytes: after,
      meta: outMeta ?? meta ?? undefined,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("[imageConvert] convert failed", msg);
    return { ok: false, error: msg };
  }
}

/** WebP companion next to source (does not replace original). */
export async function makeWebpCompanion(
  absPath: string,
  outDir?: string,
  quality = 86,
): Promise<ImageConvertResult> {
  return convertImageFile(absPath, { format: "webp", quality, keepAlpha: true }, outDir);
}

export async function makeImageThumbnail(
  absPath: string,
  outDir: string,
  size = 256,
): Promise<string | null> {
  try {
    const sharp = loadSharp();
    await fs.mkdir(outDir, { recursive: true });
    const out = join(outDir, `${basename(absPath, extname(absPath))}.thumb.jpg`);
    await sharp(absPath)
      .resize(size, size, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toFile(out);
    return out;
  } catch {
    return null;
  }
}
