import { open, realpath } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";
import type { CreationBaseSource, CreationSourceRecord } from "../../shared/creationFlow";
import { sha256 } from "./conceptReview";

const MAX_BYTES = 256 * 1024 ** 2;

function isEmbeddedDataUri(uri: unknown): boolean {
  return typeof uri === "string" && /^data:[^,]*,/i.test(uri);
}

/** Snapshot only the selected source. A catalog key is an identity, never an arbitrary URL. */
export async function readCreationBase(source: CreationBaseSource): Promise<{ bytes: Buffer; record: CreationSourceRecord }> {
  let bytes: Buffer;
  let canonical: CreationBaseSource;
  let catalogIdentity: Record<string, unknown> | undefined;
  if (source?.kind === "local-file") {
    if (typeof source.path !== "string" || !isAbsolute(source.path) || extname(source.path).toLowerCase() !== ".glb") throw new Error("Choose a local GLB. Convert other model formats with the existing Forge tools first.");
    const path = await realpath(source.path);
    const file = await open(path, "r");
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size < 20 || stat.size > MAX_BYTES) throw new Error("Choose a GLB smaller than 256 MB.");
      bytes = await file.readFile();
      if (bytes.length !== stat.size) throw new Error("The source changed while reading. Choose it again when its write has finished.");
    } finally { await file.close(); }
    canonical = { kind: "local-file", path };
  } else if (source?.kind === "objectstore") {
    if (typeof source.key !== "string" || source.key.length > 1024 || !source.key.toLowerCase().endsWith(".glb") || source.key.split("/").some(part => !part || part === "." || part === "..") || /[\\?#\u0000-\u001f]/.test(source.key)) throw new Error("Choose a GLB from the Grudge asset catalog.");
    const { r2PublicUrl } = await import("../cf/r2Direct");
    const { cachedCatalogAsset } = await import("../assetSearch");
    const entry=cachedCatalogAsset(source.key);
    if(entry)catalogIdentity={...entry};
    const url = await r2PublicUrl(source.key.split("/").map(encodeURIComponent).join("/"));
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: "error" });
    if (!response.ok || !response.body) throw new Error(`The selected Grudge catalog model is unavailable (${response.status}). No substitute was loaded.`);
    if (Number(response.headers.get("content-length")) > MAX_BYTES) { await response.body.cancel(); throw new Error("This model exceeds the 256 MB working-copy limit."); }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > MAX_BYTES) throw new Error("This model exceeds the 256 MB working-copy limit."); chunks.push(next.value); } }
    finally { await reader.cancel(); }
    bytes = Buffer.concat(chunks); canonical = { kind: "objectstore", key: source.key };
  } else throw new Error("Choose an existing local file or Grudge catalog model.");
  if (bytes.length > MAX_BYTES || bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error("The selected file is not a valid GLB 2.0 model.");
  const length = bytes.readUInt32LE(12);
  if (length > bytes.length - 20) throw new Error("Invalid GLB metadata length.");
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString("utf8"));
  if ((json.buffers ?? []).some((b: any) => b.uri && !isEmbeddedDataUri(b.uri)) || (json.images ?? []).some((i: any) => i.uri && !isEmbeddedDataUri(i.uri))) throw new Error("Use a self-contained GLB. Models that depend on separate files or external URLs cannot be used as a base.");
  const identity: Record<string, unknown> = { ...(catalogIdentity?{catalog:catalogIdentity}:{}), assetExtras: json.asset?.extras ?? {}, nodeIdentities: (json.nodes ?? []).filter((n: any) => n.extras?.grudge_id || n.extras?.grudge_uuid || n.extras?.grudgeProvenance || n.extras?.characterId).map((n: any) => ({ name: n.name, extras: n.extras })) };
  return { bytes, record: { source: canonical, sha256: sha256(bytes), byteSize: bytes.length, identity } };
}
