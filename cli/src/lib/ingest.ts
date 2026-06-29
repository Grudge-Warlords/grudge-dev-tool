import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { generateAssetUUID, slotForFile } from "./uuid.js";
import type { ManifestEntry } from "./api.js";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".fbx": "application/octet-stream",
  ".obj": "application/octet-stream",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
};

export interface IngestOptions {
  root: string;
  packId: string;
  version: string;
  license: string;
  author: string;
  dryRun?: boolean;
  skipThumb?: boolean;
}

export interface IngestedFile {
  relPath: string;
  category: string;
  entry: ManifestEntry;
  data: Buffer;
  thumb?: Buffer;
}

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(".") || name === "_thumbs" || name === "_originals") continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full).replace(/\\/g, "/"));
  }
  return out;
}

async function maybeThumb(data: Buffer): Promise<Buffer | undefined> {
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(data).resize(256, 256, { fit: "inside" }).webp().toBuffer();
  } catch {
    return undefined;
  }
}

export async function ingestPack(opts: IngestOptions): Promise<IngestedFile[]> {
  const files = walk(opts.root);
  const results: IngestedFile[] = [];
  let itemId = 1;

  for (const rel of files) {
    const full = path.join(opts.root, rel);
    const data = fs.readFileSync(full);
    const ext = path.extname(rel).toLowerCase();
    const slot = slotForFile(rel);
    const category = rel.split("/")[0] || "misc";
    const hash = sha256(data);
    const grudgeUUID = generateAssetUUID(slot, itemId++);

    const entry: ManifestEntry = {
      path: `asset-packs/${opts.packId}/v${opts.version}/${rel}`,
      grudgeUUID,
      category,
      sha256: hash,
      size: data.length,
      contentType: MIME[ext] || "application/octet-stream",
    };

    let thumb: Buffer | undefined;
    if (!opts.skipThumb && /\.(png|jpe?g|webp|gif)$/i.test(rel) && !opts.dryRun) {
      thumb = await maybeThumb(data);
      if (thumb) {
        entry.thumbPath = `asset-packs/${opts.packId}/v${opts.version}/_thumbs/${rel}.webp`;
      }
    }

    results.push({ relPath: rel, category, entry, data, thumb });
  }
  return results;
}