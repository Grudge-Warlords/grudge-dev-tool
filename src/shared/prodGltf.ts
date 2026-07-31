/**
 * Production glTF layout on R2 (grudge-assets) + D1 registry helpers.
 *
 * Canonical keys (fleet SSOT):
 *   prod/gltf/<category>/<name>.glb
 *   prod/gltf/<category>/<name>.meta.json
 *
 * CDN: https://assets.grudge-studio.com/prod/gltf/...
 * Index: D1 / ObjectStore registry (not Railway player state).
 */

export const PROD_GLTF_PREFIX = "prod/gltf";
export const CDN_BASE = "https://assets.grudge-studio.com";

export type ProdGltfCategory =
  | "characters"
  | "weapons"
  | "enemies"
  | "props"
  | "nature"
  | "buildings"
  | "vfx"
  | "scenes"
  | "misc";

export interface ProdGltfKeyParts {
  category: ProdGltfCategory | string;
  name: string; // no extension
}

export function sanitizeAssetName(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase() || "asset";
}

/** Build R2 object key for a production GLB. */
export function prodGltfKey(parts: ProdGltfKeyParts, ext: "glb" | "meta.json" = "glb"): string {
  const cat = (parts.category || "misc").replace(/^\/+|\/+$/g, "");
  const name = sanitizeAssetName(parts.name);
  if (ext === "meta.json") return `${PROD_GLTF_PREFIX}/${cat}/${name}.meta.json`;
  return `${PROD_GLTF_PREFIX}/${cat}/${name}.glb`;
}

export function prodGltfCdnUrl(key: string): string {
  const k = key.replace(/^\//, "");
  return `${CDN_BASE}/${k}`;
}

/** Prefer prod/gltf over legacy models/ when resolving fleet play URLs. */
export function preferProdGltfUrl(urls: string[]): string | null {
  const prod = urls.find((u) => /\/prod\/gltf\//i.test(u) && /\.glb(\?|$)/i.test(u));
  if (prod) return prod;
  const anyGlb = urls.find((u) => /\.glb(\?|$)/i.test(u) && !/<!DOCTYPE|<html/i.test(u));
  return anyGlb ?? urls[0] ?? null;
}

export interface D1AssetRegistryRow {
  grudge_uuid: string;
  r2_key: string;
  category: string;
  content_type: string;
  size_bytes: number;
  sha256?: string;
  pack_id?: string;
  name?: string;
  cdn_url?: string;
  metadata?: Record<string, unknown>;
}

/** Build a registry row ready for ObjectStore manifest / D1 seed batch. */
export function buildRegistryRow(input: {
  grudgeUUID: string;
  r2Key: string;
  category: string;
  sizeBytes: number;
  sha256?: string;
  packId?: string;
  name?: string;
  metadata?: Record<string, unknown>;
}): D1AssetRegistryRow {
  return {
    grudge_uuid: input.grudgeUUID,
    r2_key: input.r2Key,
    category: input.category,
    content_type: "model/gltf-binary",
    size_bytes: input.sizeBytes,
    sha256: input.sha256,
    pack_id: input.packId,
    name: input.name,
    cdn_url: prodGltfCdnUrl(input.r2Key),
    metadata: {
      pipeline: "grudge-dev-tool",
      layout: PROD_GLTF_PREFIX,
      ...input.metadata,
    },
  };
}

/** Guess category from path / filename heuristics. */
export function guessCategory(pathOrName: string): ProdGltfCategory {
  const s = pathOrName.toLowerCase();
  if (/weapon|sword|bow|staff|axe|gun|rifle|shield/.test(s)) return "weapons";
  if (/enemy|mob|creature|monster|boss|orc|undead|skeleton/.test(s)) return "enemies";
  if (/character|hero|player|human|elf|dwarf|barb|race|wk_|brb_|elf_|dwf_/.test(s)) return "characters";
  if (/tree|rock|grass|nature|plant|bush/.test(s)) return "nature";
  if (/build|house|wall|tower|castle|kenney/.test(s)) return "buildings";
  if (/vfx|fx|effect|orb|slash|fireball|particle/.test(s)) return "vfx";
  if (/scene|island|sector|map/.test(s)) return "scenes";
  if (/prop|crate|barrel|item|furniture/.test(s)) return "props";
  return "misc";
}
