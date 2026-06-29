/**
 * Archive extraction — unzips .zip files using fflate (pure-JS, no native deps).
 */

import { promises as fs } from "node:fs";
import { join, dirname, extname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

export interface UnzipEntry { path: string; size: number; isDir: boolean; contentType: string; }
export interface UnzipResult { ok: boolean; error?: string; destDir: string; fileCount: number; totalBytes: number; entries: UnzipEntry[]; }

const CT: Record<string, string> = {
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream",
  ".fbx": "application/octet-stream", ".obj": "model/obj", ".mtl": "text/plain",
  ".stl": "model/stl", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".json": "application/json", ".txt": "text/plain",
  ".blend": "application/x-blender", ".dae": "model/vnd.collada+xml",
  ".ogg": "audio/ogg", ".wav": "audio/wav", ".mp3": "audio/mpeg",
};

export async function extractZip(zipPath: string, destDir?: string): Promise<UnzipResult> {
  try {
    const { unzipSync } = require("fflate") as typeof import("fflate");
    const zipData = new Uint8Array(await fs.readFile(zipPath));
    const extracted = unzipSync(zipData);
    const dest = destDir ?? join(tmpdir(), `grudge-unzip-${randomUUID()}`);
    await fs.mkdir(dest, { recursive: true });
    const entries: UnzipEntry[] = [];
    let totalBytes = 0, fileCount = 0;
    for (const [relativePath, data] of Object.entries(extracted)) {
      const isDir = relativePath.endsWith("/") || data.length === 0;
      const fullPath = join(dest, ...relativePath.split("/"));
      if (isDir) {
        await fs.mkdir(fullPath, { recursive: true });
        entries.push({ path: relativePath, size: 0, isDir: true, contentType: "inode/directory" });
      } else {
        await fs.mkdir(dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, data);
        fileCount++; totalBytes += data.length;
        entries.push({ path: relativePath, size: data.length, isDir: false, contentType: CT[extname(relativePath).toLowerCase()] ?? "application/octet-stream" });
      }
    }
    return { ok: true, destDir: dest, fileCount, totalBytes, entries };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err), destDir: "", fileCount: 0, totalBytes: 0, entries: [] };
  }
}
