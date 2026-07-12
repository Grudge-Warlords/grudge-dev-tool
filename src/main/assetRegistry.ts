/**
 * Global Grudge asset UUID registry — every R2/CDN object key maps to one
 * stable Grudge UUID for inventory, game loadouts, and cross-deploy identity.
 *
 * SSOT object on R2:
 *   manifests/grudge-asset-registry/v1/index.json
 *
 * UUID is path-stable (same key → same UUID forever). File content hash is
 * stored separately for integrity, not as part of the id (so re-exports of
 * the same logical asset path keep inventory links valid).
 */
import { createHash } from "node:crypto";
import {
  generateStableAssetUUIDFromHash,
  inferAssetSlot,
  normalizeAssetPath,
  type GrudgeUUIDComponents,
  parseGrudgeUUID,
} from "../shared/grudgeUUID";
import { inferContentType } from "../shared/mediaTypes";
import { r2Get, r2List, r2PutJson, r2Head, r2PublicUrl } from "./cf/r2Direct";
import log from "./logger";

export const REGISTRY_KEY = "manifests/grudge-asset-registry/v1/index.json";

export interface AssetRegistryEntry {
  grudgeUUID: string;
  path: string;
  family: string;
  slot: string;
  contentType: string | null;
  sizeBytes: number;
  /** Optional content integrity hash when known */
  sha256?: string | null;
  updatedAt: string;
  source: "backfill" | "ingest" | "manual";
}

export interface AssetRegistry {
  version: 1;
  namespace: "grudge-asset-v1";
  updatedAt: string;
  count: number;
  /** path → entry */
  byPath: Record<string, AssetRegistryEntry>;
  /** uuid → path */
  byUuid: Record<string, string>;
}

let cache: AssetRegistry | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000;

function emptyRegistry(): AssetRegistry {
  return {
    version: 1,
    namespace: "grudge-asset-v1",
    updatedAt: new Date().toISOString(),
    count: 0,
    byPath: {},
    byUuid: {},
  };
}

/** Path-stable UUID: SHA-256 of namespaced key (not file bytes). */
export function uuidForAssetPath(objectPath: string): string {
  const path = normalizeAssetPath(objectPath);
  const hex = createHash("sha256").update(`grudge-asset-v1:${path}`, "utf8").digest("hex");
  const slot = inferAssetSlot(path);
  return generateStableAssetUUIDFromHash(path, hex, slot);
}

export async function loadRegistry(force = false): Promise<AssetRegistry> {
  if (!force && cache && Date.now() - cacheLoadedAt < CACHE_TTL_MS) {
    return cache;
  }
  try {
    const buf = await r2Get(REGISTRY_KEY);
    if (buf && buf.length > 0) {
      const parsed = JSON.parse(buf.toString("utf8")) as AssetRegistry;
      if (parsed?.version === 1 && parsed.byPath && parsed.byUuid) {
        cache = parsed;
        cacheLoadedAt = Date.now();
        return parsed;
      }
    }
  } catch (err: any) {
    log.warn("[assetRegistry] load failed (using empty):", err?.message ?? err);
  }
  cache = emptyRegistry();
  cacheLoadedAt = Date.now();
  return cache;
}

export async function saveRegistry(reg: AssetRegistry): Promise<void> {
  reg.updatedAt = new Date().toISOString();
  reg.count = Object.keys(reg.byPath).length;
  await r2PutJson(REGISTRY_KEY, reg);
  cache = reg;
  cacheLoadedAt = Date.now();
  log.info(`[assetRegistry] saved count=${reg.count} → ${REGISTRY_KEY}`);
}

export function ensureEntry(
  reg: AssetRegistry,
  objectPath: string,
  meta?: {
    sizeBytes?: number;
    contentType?: string | null;
    sha256?: string | null;
    source?: AssetRegistryEntry["source"];
  },
): AssetRegistryEntry {
  const path = normalizeAssetPath(objectPath);
  const existing = reg.byPath[path];
  const uuid = uuidForAssetPath(path);
  const slotLabel = inferAssetSlot(path);
  const entry: AssetRegistryEntry = {
    grudgeUUID: uuid,
    path,
    family: slotLabel.toLowerCase(),
    slot: slotLabel,
    contentType: meta?.contentType ?? existing?.contentType ?? inferContentType(path),
    sizeBytes: meta?.sizeBytes ?? existing?.sizeBytes ?? 0,
    sha256: meta?.sha256 ?? existing?.sha256 ?? null,
    updatedAt: new Date().toISOString(),
    source: meta?.source ?? existing?.source ?? "backfill",
  };

  // If path already had a different UUID (shouldn't with stable scheme), re-key
  if (existing && existing.grudgeUUID !== uuid) {
    delete reg.byUuid[existing.grudgeUUID];
  }
  reg.byPath[path] = entry;
  reg.byUuid[uuid] = path;
  return entry;
}

export async function getByPath(objectPath: string): Promise<AssetRegistryEntry | null> {
  const reg = await loadRegistry();
  const path = normalizeAssetPath(objectPath);
  return reg.byPath[path] ?? null;
}

export async function getByUuid(uuid: string): Promise<AssetRegistryEntry | null> {
  const reg = await loadRegistry();
  const path = reg.byUuid[uuid];
  if (!path) return null;
  return reg.byPath[path] ?? null;
}

export async function ensurePath(
  objectPath: string,
  meta?: { sizeBytes?: number; contentType?: string | null; source?: AssetRegistryEntry["source"] },
): Promise<AssetRegistryEntry> {
  const reg = await loadRegistry();
  const entry = ensureEntry(reg, objectPath, meta);
  // Debounced save is nicer but for correctness save on ensure when called singly
  await saveRegistry(reg);
  return entry;
}

export async function lookupMany(paths: string[]): Promise<Record<string, AssetRegistryEntry | null>> {
  const reg = await loadRegistry();
  const out: Record<string, AssetRegistryEntry | null> = {};
  for (const p of paths) {
    const key = normalizeAssetPath(p);
    out[key] = reg.byPath[key] ?? null;
  }
  return out;
}

export interface BackfillProgress {
  scanned: number;
  registered: number;
  skipped: number;
  prefix: string;
  done: boolean;
  error?: string;
}

/**
 * Walk R2 under `prefix` and register every object with a stable Grudge UUID.
 * Writes the registry index at the end (and periodically).
 */
export async function backfillRegistry(opts?: {
  prefix?: string;
  limit?: number;
  onProgress?: (p: BackfillProgress) => void;
}): Promise<BackfillProgress> {
  const prefix = opts?.prefix ?? "";
  const hardLimit = opts?.limit ?? 50_000;
  const reg = await loadRegistry(true);
  let scanned = 0;
  let registered = 0;
  let skipped = 0;
  let cursor: string | undefined;

  const report = (done: boolean, error?: string): BackfillProgress => {
    const p: BackfillProgress = { scanned, registered, skipped, prefix, done, error };
    opts?.onProgress?.(p);
    return p;
  };

  try {
    while (scanned < hardLimit) {
      const page = await r2List({
        prefix,
        delimiter: undefined,
        cursor,
        limit: Math.min(1000, hardLimit - scanned),
      });
      for (const it of page.items) {
        if (!it.name || it.name.endsWith("/")) {
          skipped++;
          continue;
        }
        // Skip the registry index itself and temp files
        if (it.name.startsWith("manifests/grudge-asset-registry/")) {
          skipped++;
          continue;
        }
        if (it.name.endsWith(".tmp") || it.name.endsWith(".tmp.json")) {
          skipped++;
          continue;
        }
        scanned++;
        const key = normalizeAssetPath(it.name);
        const before = reg.byPath[key];
        ensureEntry(reg, it.name, {
          sizeBytes: it.size,
          contentType: it.contentType || inferContentType(it.name),
          source: "backfill",
        });
        registered++;
        void before; // upsert always counted
      }
      if (!page.nextCursor || page.items.length === 0) break;
      cursor = page.nextCursor;
      // periodic save every ~5k objects
      if (scanned % 5000 < page.items.length) {
        await saveRegistry(reg);
        report(false);
      }
    }
    await saveRegistry(reg);
    return report(true);
  } catch (err: any) {
    try {
      await saveRegistry(reg);
    } catch { /* */ }
    return report(true, err?.message ?? String(err));
  }
}

export async function registryStats(): Promise<{
  count: number;
  updatedAt: string | null;
  registryKey: string;
  publicUrl: string | null;
}> {
  const reg = await loadRegistry();
  let publicUrl: string | null = null;
  try {
    publicUrl = await r2PublicUrl(REGISTRY_KEY);
  } catch {
    publicUrl = `https://assets.grudge-studio.com/${REGISTRY_KEY}`;
  }
  return {
    count: reg.count || Object.keys(reg.byPath).length,
    updatedAt: reg.updatedAt || null,
    registryKey: REGISTRY_KEY,
    publicUrl,
  };
}

export function parseAssetUuid(uuid: string): GrudgeUUIDComponents | null {
  return parseGrudgeUUID(uuid);
}

/** Resolve game/inventory reference: uuid → CDN URL */
export async function resolveAssetUrl(uuidOrPath: string): Promise<{
  grudgeUUID: string;
  path: string;
  publicCdn: string;
  entry: AssetRegistryEntry | null;
} | null> {
  const reg = await loadRegistry();
  let path: string | null = null;
  let entry: AssetRegistryEntry | null = null;

  if (parseGrudgeUUID(uuidOrPath)) {
    path = reg.byUuid[uuidOrPath] ?? null;
    if (path) entry = reg.byPath[path] ?? null;
  } else {
    path = normalizeAssetPath(uuidOrPath);
    entry = reg.byPath[path] ?? null;
    if (!entry) {
      // Auto-mint for known paths without requiring backfill first
      entry = ensureEntry(reg, path, { source: "manual" });
      await saveRegistry(reg);
    }
  }
  if (!path) return null;
  const uuid = entry?.grudgeUUID ?? uuidForAssetPath(path);
  let publicCdn = `https://assets.grudge-studio.com/${path}`;
  try {
    publicCdn = (await r2PublicUrl(path)) || publicCdn;
  } catch { /* */ }
  return { grudgeUUID: uuid, path, publicCdn, entry };
}
