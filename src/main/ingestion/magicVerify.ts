/**
 * Main-process magic-byte verification for mesh files on disk.
 * Re-exports probe from shared and adds fs helpers for ingest.
 */

import { promises as fs } from "node:fs";
import { assertMeshBytes, probeMagic, type MagicProbe } from "../../shared/magicBytes";

export { assertMeshBytes, probeMagic };
export type { MagicProbe };

export async function probeFileMagic(absPath: string): Promise<MagicProbe> {
  const fh = await fs.open(absPath, "r");
  try {
    const { size } = await fh.stat();
    // glTF JSON may put "asset" after a long extensionsUsed block — read 256 KiB head
    const len = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, 0);
    const p = probeMagic(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    return { ...p, bytes: size };
  } finally {
    await fh.close();
  }
}

/** Fail hard if path claims to be GLB/glTF but isn't. */
export async function assertMeshFile(absPath: string): Promise<MagicProbe> {
  const lower = absPath.toLowerCase();
  const p = await probeFileMagic(absPath);
  if (lower.endsWith(".glb") || lower.endsWith(".gltf")) {
    if (!p.okForMesh) {
      throw new Error(
        `${absPath}: invalid mesh after convert (${p.detail}). ` +
          `Refuse HTML error pages and empty stubs — re-run convert or fix source textures.`,
      );
    }
  }
  return p;
}
