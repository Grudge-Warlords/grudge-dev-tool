/**
 * Grudge Studio Assets — full-catalog search for Dev Tool.
 *
 * ObjectStore `/search` and client rewrites are often 404. Live SSOT for
 * browsing/searching every registered R2 asset is the legacy live index:
 *   GET https://api.grudge-studio.com/assets?limit=&offset=
 * (~6k rows: models, textures, audio, UI, anims, …).
 *
 * Also merges public CDN prod catalogs (prod/gltf packages / prefabs / gltf index)
 * so yellow-safe production meshes always appear even if not yet in the index.
 */

import type { SearchItem, SearchRequest, SearchResponse } from "../shared/ipc";
import { PROD_CATALOG } from "../shared/prodPackages";
import { r2List } from "./cf/r2Direct";
import { readCf } from "./cf/credentials";

const LIVE_ASSETS_URL = "https://api.grudge-studio.com/assets";
const PAGE_SIZE = 500;
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface CatalogAsset {
  path: string;
  name: string;
  category?: string;
  packId?: string;
  grudgeUUID?: string;
  sizeBytes?: number;
  contentType?: string;
  source: "live-index" | "cdn-prod" | "r2";
}

let cache: { at: number; items: CatalogAsset[] } | null = null;
let inflight: Promise<CatalogAsset[]> | null = null;

function inferContentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    glb: "model/gltf-binary",
    gltf: "model/gltf+json",
    fbx: "application/octet-stream",
    obj: "model/obj",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    tga: "image/x-tga",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    mp4: "video/mp4",
    json: "application/json",
  };
  return map[ext] ?? "application/octet-stream";
}

function basename(path: string): string {
  const t = path.replace(/\/$/, "");
  const i = t.lastIndexOf("/");
  return i >= 0 ? t.slice(i + 1) : t;
}

function packFromPath(path: string): string | undefined {
  // asset-packs/<pack>/… or models/<pack>/… or prod/gltf/<cat>/…
  const parts = path.replace(/^\//, "").split("/");
  if (parts[0] === "asset-packs" && parts[1]) return parts[1];
  if (parts[0] === "prod" && parts[1] === "gltf" && parts[2]) return `prod-gltf-${parts[2]}`;
  if (parts[0] === "models" && parts[1]) return parts[1];
  return parts[0] || undefined;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    // Electron main has undici/node fetch
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

/** Paginate the full live asset registry (all categories). */
async function loadLiveIndex(): Promise<CatalogAsset[]> {
  const out: CatalogAsset[] = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total && offset < 50_000) {
    const url = `${LIVE_ASSETS_URL}?limit=${PAGE_SIZE}&offset=${offset}`;
    const json = (await fetchJson(url)) as {
      assets?: Array<Record<string, unknown>>;
      total?: number;
      limit?: number;
      offset?: number;
    };
    const rows = Array.isArray(json.assets) ? json.assets : [];
    if (typeof json.total === "number" && Number.isFinite(json.total)) {
      total = json.total;
    }
    if (!rows.length) break;
    for (const a of rows) {
      const path =
        String(a.r2Key || a.id || a.path || a.cdnUrl || "")
          .replace(/^https?:\/\/assets\.grudge-studio\.com\//i, "")
          .replace(/^\//, "");
      if (!path) continue;
      out.push({
        path,
        name: String(a.name || basename(path)),
        category: a.category != null ? String(a.category) : undefined,
        packId: packFromPath(path),
        grudgeUUID:
          a.grudgeUuid != null
            ? String(a.grudgeUuid)
            : a.grudgeUUID != null
              ? String(a.grudgeUUID)
              : undefined,
        sizeBytes:
          typeof a.fileSize === "number"
            ? a.fileSize
            : typeof a.size === "number"
              ? a.size
              : typeof a.bytes === "number"
                ? a.bytes
                : undefined,
        contentType:
          a.contentType != null ? String(a.contentType) : inferContentType(path),
        source: "live-index",
      });
    }
    offset += rows.length;
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

/** Public CDN prod/gltf catalogs (always available). */
async function loadCdnProdCatalogs(): Promise<CatalogAsset[]> {
  const out: CatalogAsset[] = [];
  const urls = [
    PROD_CATALOG.assetsIndex,
    PROD_CATALOG.packages,
    PROD_CATALOG.prefabs,
    PROD_CATALOG.animPackagesMirror,
  ];
  await Promise.all(
    urls.map(async (url) => {
      try {
        const json = (await fetchJson(url)) as Record<string, unknown>;
        // assets-gltf-index: { assets: [...] }
        if (Array.isArray(json.assets)) {
          for (const raw of json.assets) {
            const a = raw as Record<string, unknown>;
            // package doc shape: packages[].assets[]
            if (a.assets && Array.isArray(a.assets)) {
              const packId = a.id != null ? String(a.id) : undefined;
              for (const sub of a.assets as Record<string, unknown>[]) {
                const path = String(sub.r2Key || sub.id || "").replace(/^\//, "");
                if (!path) continue;
                out.push({
                  path,
                  name: basename(path),
                  category: path.split("/")[2] || "prod-gltf",
                  packId,
                  sizeBytes: typeof sub.bytes === "number" ? sub.bytes : undefined,
                  contentType: inferContentType(path),
                  source: "cdn-prod",
                });
              }
              continue;
            }
            const path = String(a.r2Key || a.id || "").replace(/^\//, "");
            if (!path.includes("/") && !path.endsWith(".glb")) continue;
            if (!path) continue;
            out.push({
              path,
              name: String(a.slug || a.id || basename(path)),
              category: a.class != null ? String(a.class) : path.split("/")[2],
              packId: a.package != null ? String(a.package) : packFromPath(path),
              sizeBytes: typeof a.bytes === "number" ? a.bytes : undefined,
              contentType:
                a.contentType != null ? String(a.contentType) : inferContentType(path),
              source: "cdn-prod",
            });
          }
        }
        // prefabs: { prefabs: [...] }
        if (Array.isArray(json.prefabs)) {
          for (const raw of json.prefabs) {
            const p = raw as Record<string, unknown>;
            const mesh = (p.mesh || {}) as Record<string, unknown>;
            const path = String(mesh.r2Key || p.id || "").replace(/^\//, "");
            if (!path) continue;
            out.push({
              path,
              name: String(p.name || basename(path)),
              category: p.kind != null ? String(p.kind) : undefined,
              packId: p.package != null ? String(p.package) : packFromPath(path),
              sizeBytes: typeof mesh.bytes === "number" ? mesh.bytes : undefined,
              contentType:
                mesh.contentType != null
                  ? String(mesh.contentType)
                  : inferContentType(path),
              source: "cdn-prod",
            });
          }
        }
        // anim packages: packs with clip paths
        if (Array.isArray(json.packages) && !Array.isArray(json.assets)) {
          for (const raw of json.packages) {
            const pack = raw as Record<string, unknown>;
            const packId = pack.id != null ? String(pack.id) : undefined;
            const clips = (pack.clips || pack.assets || pack.files) as
              | unknown[]
              | undefined;
            if (!Array.isArray(clips)) continue;
            for (const c of clips) {
              if (typeof c === "string") {
                const path = c.replace(/^\//, "");
                out.push({
                  path,
                  name: basename(path),
                  category: "animation",
                  packId,
                  contentType: inferContentType(path),
                  source: "cdn-prod",
                });
              } else if (c && typeof c === "object") {
                const o = c as Record<string, unknown>;
                const path = String(o.r2Key || o.path || o.id || "").replace(/^\//, "");
                if (!path) continue;
                out.push({
                  path,
                  name: String(o.name || basename(path)),
                  category: "animation",
                  packId,
                  contentType: inferContentType(path),
                  source: "cdn-prod",
                });
              }
            }
          }
        }
      } catch {
        /* optional catalog */
      }
    }),
  );
  return out;
}

/** Optional R2 prefix scan when S3 credentials are configured. */
async function loadR2Sample(): Promise<CatalogAsset[]> {
  try {
    const have =
      Boolean(await readCf("endpoint")) &&
      Boolean(await readCf("accessKeyId")) &&
      Boolean(await readCf("secret")) &&
      Boolean(await readCf("bucket"));
    if (!have) return [];
    const prefixes = [
      "prod/gltf/",
      "asset-packs/",
      "models/",
      "manifests/",
      "textures/",
      "audio/",
      "icons/",
    ];
    const out: CatalogAsset[] = [];
    for (const prefix of prefixes) {
      try {
        let cursor: string | undefined;
        let pages = 0;
        do {
          const page = await r2List({
            prefix,
            delimiter: undefined,
            cursor,
            limit: 1000,
          });
          for (const it of page.items) {
            if (!it.name || it.name.endsWith("/")) continue;
            out.push({
              path: it.name,
              name: basename(it.name),
              category: it.name.split("/")[0],
              packId: packFromPath(it.name),
              sizeBytes: it.size,
              contentType: it.contentType || inferContentType(it.name),
              source: "r2",
            });
          }
          cursor = page.nextCursor ?? undefined;
          pages++;
        } while (cursor && pages < 8);
      } catch {
        /* prefix optional */
      }
    }
    return out;
  } catch {
    return [];
  }
}

function mergeCatalogs(lists: CatalogAsset[][]): CatalogAsset[] {
  const byPath = new Map<string, CatalogAsset>();
  for (const list of lists) {
    for (const item of list) {
      const key = item.path.replace(/\\/g, "/");
      const prev = byPath.get(key);
      if (!prev) {
        byPath.set(key, { ...item, path: key });
        continue;
      }
      // Prefer richer metadata
      byPath.set(key, {
        ...prev,
        name: prev.name || item.name,
        category: prev.category || item.category,
        packId: prev.packId || item.packId,
        grudgeUUID: prev.grudgeUUID || item.grudgeUUID,
        sizeBytes: prev.sizeBytes ?? item.sizeBytes,
        contentType: prev.contentType || item.contentType,
        source: prev.source === "live-index" ? prev.source : item.source,
      });
    }
  }
  return [...byPath.values()];
}

/** Load (or return cached) full Grudge Studio asset catalog. */
export async function loadFullAssetCatalog(force = false): Promise<CatalogAsset[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.items;
  }
  if (!force && inflight) return inflight;

  inflight = (async () => {
    const parts = await Promise.all([
      loadLiveIndex().catch((e) => {
        console.warn("[assetSearch] live index failed", e);
        return [] as CatalogAsset[];
      }),
      loadCdnProdCatalogs().catch(() => [] as CatalogAsset[]),
      loadR2Sample().catch(() => [] as CatalogAsset[]),
    ]);
    const items = mergeCatalogs(parts);
    cache = { at: Date.now(), items };
    console.info(
      `[assetSearch] catalog ready: ${items.length} assets ` +
        `(live=${parts[0].length} cdn=${parts[1].length} r2=${parts[2].length})`,
    );
    return items;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

function matchesQuery(item: CatalogAsset, q: string, category?: string, pack?: string): boolean {
  if (category) {
    const c = category.toLowerCase();
    if (!(item.category || "").toLowerCase().includes(c) && !item.path.toLowerCase().includes(`/${c}/`)) {
      return false;
    }
  }
  if (pack) {
    const p = pack.toLowerCase();
    if (!(item.packId || "").toLowerCase().includes(p) && !item.path.toLowerCase().includes(p)) {
      return false;
    }
  }
  if (!q) return true;
  const hay = `${item.path} ${item.name} ${item.category ?? ""} ${item.packId ?? ""} ${item.grudgeUUID ?? ""}`.toLowerCase();
  // Support multi-token AND (space-separated)
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((t) => hay.includes(t));
}

function scoreItem(item: CatalogAsset, q: string): number {
  if (!q) return 0;
  const lower = q.toLowerCase();
  const name = item.name.toLowerCase();
  const path = item.path.toLowerCase();
  let s = 0;
  if (name === lower) s += 100;
  else if (name.startsWith(lower)) s += 60;
  else if (name.includes(lower)) s += 30;
  if (path.endsWith(`/${lower}`) || path.endsWith(`/${lower}.glb`)) s += 40;
  if (path.includes(lower)) s += 10;
  if ((item.category || "").toLowerCase() === lower) s += 15;
  // Prefer prod/gltf over legacy models/ for same score
  if (path.startsWith("prod/gltf/")) s += 5;
  return s;
}

/** Search all Grudge Studio Assets (full catalog). */
export async function searchAllStudioAssets(req: SearchRequest): Promise<SearchResponse> {
  const catalog = await loadFullAssetCatalog();
  const q = (req.q ?? "").trim();
  const limit = Math.min(Math.max(req.limit ?? 200, 1), 1000);

  const matched = catalog.filter((it) =>
    matchesQuery(it, q, req.category, req.pack),
  );
  matched.sort((a, b) => scoreItem(b, q) - scoreItem(a, q) || a.path.localeCompare(b.path));

  const items: SearchItem[] = matched.slice(0, limit).map((it) => ({
    packId: it.packId || "assets",
    path: it.path,
    category: it.category,
    grudgeUUID: it.grudgeUUID,
    sizeBytes: it.sizeBytes,
    contentType: it.contentType,
  }));

  return { count: matched.length, items };
}

/** Drop cache (after upload / reindex). */
export function invalidateAssetSearchCache(): void {
  cache = null;
}
