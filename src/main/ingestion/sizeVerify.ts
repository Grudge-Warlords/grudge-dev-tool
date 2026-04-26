import { promises as fs } from "node:fs";
import { extname } from "node:path";

export type AssetFamily =
  | "image"
  | "spritesheet"
  | "model"
  | "audio"
  | "scene"
  | "json"
  | "doc"
  | "other";

export interface SizeVerifyResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  family: AssetFamily;
  probed: {
    sizeBytes: number;
    width?: number;
    height?: number;
    ext: string;
  };
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".tga", ".bmp"]);
const MODEL_EXTS = new Set([".glb", ".gltf", ".fbx", ".blend", ".obj"]);
const AUDIO_EXTS = new Set([".ogg", ".wav", ".mp3"]);
const SCENE_EXTS = new Set([".scene.json"]); // sentinel — checked by full filename
const DOC_EXTS = new Set([".md", ".txt"]);

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_DIM = 8192;
const WARN_IMAGE_DIM_LOW = 64;
const MAX_MODEL_BYTES = 64 * 1024 * 1024;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const MAX_JSON_BYTES = 5 * 1024 * 1024;

function familyFor(filename: string): AssetFamily {
  const lower = filename.toLowerCase();
  const ext = extname(lower);
  if (lower.endsWith(".scene.json") || lower === "scene.json") return "scene";
  if (IMAGE_EXTS.has(ext)) {
    if (lower.includes("sheet") || lower.includes("sprite")) return "spritesheet";
    return "image";
  }
  if (MODEL_EXTS.has(ext)) return "model";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (ext === ".json") return "json";
  if (DOC_EXTS.has(ext)) return "doc";
  return "other";
}

function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

export async function verifyFile(absPath: string, opts: { category?: string } = {}): Promise<SizeVerifyResult> {
  const stat = await fs.stat(absPath);
  const sizeBytes = stat.size;
  const ext = extname(absPath).toLowerCase();
  const family = familyFor(absPath);

  const result: SizeVerifyResult = {
    ok: true,
    errors: [],
    warnings: [],
    family,
    probed: { sizeBytes, ext },
  };

  switch (family) {
    case "image":
    case "spritesheet": {
      if (sizeBytes > MAX_IMAGE_BYTES) {
        result.errors.push(`Image exceeds ${MAX_IMAGE_BYTES} bytes (${sizeBytes}).`);
      }
      try {
        // Lazy require so the pipeline still runs without sharp installed.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const sharp = require("sharp");
        const meta = await sharp(absPath).metadata();
        result.probed.width = meta.width;
        result.probed.height = meta.height;
        if (meta.width && meta.width > MAX_IMAGE_DIM) {
          result.errors.push(`Width ${meta.width}px exceeds ${MAX_IMAGE_DIM}px.`);
        }
        if (meta.height && meta.height > MAX_IMAGE_DIM) {
          result.errors.push(`Height ${meta.height}px exceeds ${MAX_IMAGE_DIM}px.`);
        }
        if (meta.width && meta.width < WARN_IMAGE_DIM_LOW) {
          result.warnings.push(`Width ${meta.width}px is unusually small.`);
        }
        if (family === "spritesheet" && meta.width && meta.height) {
          if (!isPow2(meta.width) && !isPow2(meta.height)) {
            result.warnings.push(
              `Sprite sheet ${meta.width}x${meta.height} is not power-of-two on either axis.`,
            );
          }
        }
      } catch (err: any) {
        result.warnings.push(`Image probe skipped (${err.message ?? "sharp unavailable"}).`);
      }
      break;
    }
    case "model": {
      if (sizeBytes > MAX_MODEL_BYTES) {
        result.errors.push(`Model exceeds ${MAX_MODEL_BYTES} bytes (${sizeBytes}).`);
      }
      // Triangle-count probe is deferred until after convert step (.blend/.fbx
      // can't be cheaply parsed in JS). Convert.ts will revisit.
      break;
    }
    case "audio": {
      if (sizeBytes > MAX_AUDIO_BYTES) {
        result.errors.push(`Audio exceeds ${MAX_AUDIO_BYTES} bytes (${sizeBytes}).`);
      }
      break;
    }
    case "json":
    case "scene": {
      if (sizeBytes > MAX_JSON_BYTES) {
        result.errors.push(`JSON exceeds ${MAX_JSON_BYTES} bytes (${sizeBytes}).`);
      }
      break;
    }
    case "doc":
    case "other":
      break;
  }

  // Category-aware: if category is "characters" / "weapons" / "mounts" / "companions",
  // disallow non-model uploads to those category prefixes.
  const characterCats = new Set(["characters", "weapons", "mounts", "companions"]);
  if (opts.category && characterCats.has(opts.category.toLowerCase()) && family !== "model") {
    result.errors.push(
      `Category '${opts.category}' only accepts models; got ${family}.`,
    );
  }

  if (result.errors.length > 0) result.ok = false;
  return result;
}
