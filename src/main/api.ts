import keytar from "keytar";
import type {
  ListRequest, ListResponse, SearchRequest, SearchResponse,
  RequestUrlInput, AssetMeta, UUIDGenInput,
} from "../shared/ipc";
import {
  workerList, workerSearch, workerUploadUrl, workerManifestWrite, workerAssetMeta,
} from "./cf/objectStoreWorker";
import {
  r2List, r2Head, r2GetSignedDownloadUrl, r2GetSignedUploadUrl, r2PublicUrl,
} from "./cf/r2Direct";
import { readCf } from "./cf/credentials";

const SERVICE = "grudge-dev-tool";
const ACCOUNT = "default";
const MODE_ACCOUNT = "backend-mode"; // values: 'auto' | 'grudge' | 'cloudflare'

let cachedBase: string | null = null;
let cachedAssetsBase: string | null = null;

export async function setApiBaseUrl(url: string): Promise<void> {
  cachedBase = url.replace(/\/$/, "");
  await keytar.setPassword(SERVICE, `${ACCOUNT}.apiBaseUrl`, cachedBase);
}

export async function getApiBaseUrl(): Promise<string> {
  if (cachedBase) return cachedBase;
  const stored = await keytar.getPassword(SERVICE, `${ACCOUNT}.apiBaseUrl`);
  cachedBase = (stored || process.env.GRUDGE_API_BASE || "https://api.grudge-studio.com").replace(/\/$/, "");
  return cachedBase;
}

/**
 * Asset-service base URL.
 *
 * The canonical production backend (Grudge-Warlords/grudge-studio-backend) splits
 * the HTTP surface across services:
 *   • api.grudge-studio.com           → game-api      (characters, missions, etc.)
 *   • assets-api.grudge-studio.com    → asset-service (upload-url, manifest, asset-meta, conversions, ObjectStore sync)
 *
 * Resolution order:
 *   1. keytar `default.assetsApiBaseUrl`   — explicit override
 *   2. process.env.GRUDGE_ASSETS_API_BASE   — build/run-time override
 *   3. keytar `default.apiBaseUrl`          — legacy fall-through (single-domain installs)
 *   4. https://assets-api.grudge-studio.com — canonical default
 */
export async function setAssetsApiBaseUrl(url: string): Promise<void> {
  cachedAssetsBase = url.replace(/\/$/, "");
  await keytar.setPassword(SERVICE, `${ACCOUNT}.assetsApiBaseUrl`, cachedAssetsBase);
}

export async function getAssetsApiBaseUrl(): Promise<string> {
  if (cachedAssetsBase) return cachedAssetsBase;
  const stored = await keytar.getPassword(SERVICE, `${ACCOUNT}.assetsApiBaseUrl`);
  if (stored) {
    cachedAssetsBase = stored.replace(/\/$/, "");
    return cachedAssetsBase;
  }
  const envOverride = process.env.GRUDGE_ASSETS_API_BASE;
  if (envOverride) {
    cachedAssetsBase = envOverride.replace(/\/$/, "");
    return cachedAssetsBase;
  }
  // No explicit setting — prefer the canonical asset-service host. We do NOT
  // automatically fall back to apiBaseUrl when both are unset, because the
  // canonical backend deliberately keeps these routes off api.grudge-studio.com.
  cachedAssetsBase = "https://assets-api.grudge-studio.com";
  return cachedAssetsBase;
}

export async function setToken(token: string): Promise<void> {
  await keytar.setPassword(SERVICE, ACCOUNT, token);
}

export async function getToken(): Promise<string | null> {
  return keytar.getPassword(SERVICE, ACCOUNT);
}

export async function clearToken(): Promise<void> {
  await keytar.deletePassword(SERVICE, ACCOUNT);
}

export type BackendMode = "auto" | "grudge" | "cloudflare" | "r2-direct" | "cloudflare-worker";
export async function getBackendMode(): Promise<BackendMode> {
  const v = await keytar.getPassword(SERVICE, MODE_ACCOUNT);
  if (v === "grudge" || v === "cloudflare" || v === "r2-direct" || v === "cloudflare-worker" || v === "auto") {
    return v as BackendMode;
  }
  return "auto";
}
export async function setBackendMode(mode: BackendMode): Promise<void> {
  await keytar.setPassword(SERVICE, MODE_ACCOUNT, mode);
}

export type ResolvedBackend = "grudge" | "r2-direct" | "cloudflare-worker";

/** Decide which backend handles object-storage calls right now. */
async function resolveBackend(): Promise<ResolvedBackend> {
  const mode = await getBackendMode();
  if (mode === "grudge") return "grudge";
  if (mode === "r2-direct") return "r2-direct";
  if (mode === "cloudflare-worker") return "cloudflare-worker";
  // 'cloudflare' is treated as an alias for 'r2-direct' (newer preferred path)
  if (mode === "cloudflare") return "r2-direct";
  // auto: prefer direct R2 (most reliable), then Worker, then Grudge
  const haveDirect = Boolean(await readCf("endpoint"))
    && Boolean(await readCf("accessKeyId"))
    && Boolean(await readCf("secret"))
    && Boolean(await readCf("bucket"));
  if (haveDirect) return "r2-direct";
  const haveWorker = Boolean(await readCf("workerUrl")) && Boolean(await readCf("workerApiKey"));
  if (haveWorker) return "cloudflare-worker";
  return "grudge";
}
export { resolveBackend };

async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const base = await getApiBaseUrl();
  const token = await getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${base}${path}`, { ...init, headers });
}

/** Same as authedFetch but routes to asset-service (assets-api.grudge-studio.com). */
async function authedFetchAssets(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const base = await getAssetsApiBaseUrl();
  const token = await getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${base}${path}`, { ...init, headers });
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: unknown } | null;
      if (body && typeof body === "object" && typeof body.error === "string") {
        detail = body.error;
      }
    } catch { /* ignore */ }
    throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Object-storage API — routes through GrudgeBuilder or the Cloudflare Worker
// based on the backend mode.
// ---------------------------------------------------------------------------
export async function listObjects(req: ListRequest & { delimiter?: string }): Promise<ListResponse & { folders?: string[] }> {
  const backend = await resolveBackend();
  if (backend === "r2-direct") {
    return r2List({ prefix: req.prefix, delimiter: req.delimiter, cursor: req.cursor, limit: req.limit });
  }
  if (backend === "cloudflare-worker") {
    return workerList({ prefix: req.prefix, delimiter: req.delimiter, cursor: req.cursor, limit: req.limit });
  }
  const params = new URLSearchParams({ prefix: req.prefix });
  if (req.delimiter) params.set("delimiter", req.delimiter);
  if (req.cursor) params.set("cursor", req.cursor);
  if (req.limit) params.set("limit", String(req.limit));
  const res = await authedFetchAssets(`/api/objectstore/list?${params}`);
  return jsonOrThrow<ListResponse>(res);
}

export async function searchObjects(req: SearchRequest): Promise<SearchResponse> {
  const backend = await resolveBackend();
  if (backend === "cloudflare-worker") {
    return workerSearch(req);
  }
  if (backend === "r2-direct") {
    // Direct R2 has no full-text manifest search; emulate via listing under the
    // 'asset-packs/' prefix and client-side filter by query substring.
    const all = await r2List({ prefix: "asset-packs/", delimiter: undefined, limit: 1000 });
    const q = (req.q ?? "").toLowerCase();
    const filtered = q ? all.items.filter((x) => x.name.toLowerCase().includes(q)) : all.items;
    return {
      count: filtered.length,
      items: filtered.slice(0, req.limit ?? 200).map((x) => ({
        path: x.name,
        sizeBytes: x.size,
        contentType: x.contentType,
        category: x.name.split("/")[2] ?? null,
        packId: x.name.split("/")[1] ?? null,
      })),
    };
  }
  const params = new URLSearchParams();
  if (req.q) params.set("q", req.q);
  if (req.category) params.set("category", req.category);
  if (req.pack) params.set("pack", req.pack);
  if (req.limit) params.set("limit", String(req.limit));
  const res = await authedFetchAssets(`/api/objectstore/search?${params}`);
  return jsonOrThrow<SearchResponse>(res);
}

export interface UploadUrlResponse {
  uploadURL: string;
  objectPath: string;
  bucketPath: string;
  ttlSeconds: number;
  uploadId: string;
}

export async function requestUploadUrl(input: {
  path: string; contentType?: string; size?: number; sha256?: string; allowOverwrite?: boolean;
}): Promise<UploadUrlResponse> {
  const backend = await resolveBackend();
  if (backend === "r2-direct") {
    const url = await r2GetSignedUploadUrl(input.path, input.contentType, 900);
    return {
      uploadURL: url,
      objectPath: `/objects/${input.path}`,
      bucketPath: input.path,
      ttlSeconds: 900,
      uploadId: `r2-${Date.now()}`,
    };
  }
  if (backend === "cloudflare-worker") {
    const r = await workerUploadUrl(input);
    return {
      uploadURL: r.uploadURL,
      objectPath: r.objectPath,
      bucketPath: r.bucketPath ?? "",
      ttlSeconds: r.ttlSeconds ?? 900,
      uploadId: r.uploadId ?? "",
    };
  }
  const res = await authedFetchAssets("/api/objectstore/upload-url", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return jsonOrThrow<UploadUrlResponse>(res);
}

export async function writeManifest(payload: {
  packId: string; version: string; entries: any[]; meta?: Record<string, any>;
}): Promise<{ ok: boolean; manifestPath: string; count: number }> {
  const backend = await resolveBackend();
  if (backend === "r2-direct") {
    // Direct R2: presign a PUT for asset-packs/<packId>/manifest.json and PUT the JSON.
    const key = `asset-packs/${payload.packId}/manifest.json`;
    const url = await r2GetSignedUploadUrl(key, "application/json", 900);
    const body = JSON.stringify({
      packId: payload.packId,
      version: payload.version,
      generatedAt: new Date().toISOString(),
      meta: payload.meta ?? {},
      count: payload.entries.length,
      entries: payload.entries,
    }, null, 2);
    const res = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`R2 PUT manifest failed: ${res.status} — ${t.slice(0, 200)}`);
    }
    return { ok: true, manifestPath: `/objects/${key}`, count: payload.entries.length };
  }
  if (backend === "cloudflare-worker") {
    const r = await workerManifestWrite(payload);
    return { ok: !!r.ok, manifestPath: r.manifestPath ?? "", count: r.count ?? payload.entries.length };
  }
  const res = await authedFetchAssets("/api/objectstore/manifest", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return jsonOrThrow(res);
}

export async function getAssetMeta(input: RequestUrlInput): Promise<AssetMeta> {
  const backend = await resolveBackend();
  const path = input.objectPath.replace(/^\//, "");
  if (backend === "r2-direct") {
    const [head, signedUrl, publicUrl] = await Promise.all([
      r2Head(path).catch(() => ({ size: 0, contentType: null, updated: null, md5Hash: null })),
      r2GetSignedDownloadUrl(path, 600),
      r2PublicUrl(path),
    ]);
    return {
      url: signedUrl,
      ttlSeconds: 600,
      size: head.size,
      contentType: head.contentType,
      updated: head.updated,
      publicCdn: publicUrl ?? `https://assets.grudge-studio.com/${path}`,
    };
  }
  if (backend === "cloudflare-worker") {
    const r = await workerAssetMeta(input.objectPath);
    return {
      url: r.url,
      ttlSeconds: r.ttlSeconds,
      size: r.size,
      contentType: r.contentType,
      updated: r.updated,
      publicCdn: r.publicCdn ?? `https://assets.grudge-studio.com/${path}`,
    };
  }
  const res = await authedFetchAssets(`/api/objectstore/asset/${path}?format=json`);
  return jsonOrThrow<AssetMeta>(res);
}

// ---------------------------------------------------------------------------
// UUID API (proxies the existing GrudgeBuilder /api/uuid endpoints)
// ---------------------------------------------------------------------------
export async function generateUUID(input: UUIDGenInput): Promise<{ uuid: string }> {
  const res = await authedFetch("/api/uuid/generate", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return jsonOrThrow(res);
}

export async function listSlots(): Promise<Record<string, string>> {
  const res = await authedFetch("/api/uuid/slots");
  return jsonOrThrow(res);
}
