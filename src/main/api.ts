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
import {
  FLEET_CLIENT_URL,
  FLEET_GAME_DATA_URL,
  FLEET_URLS,
} from "../shared/fleet";

const SERVICE = "grudge-dev-tool";
const ACCOUNT = "default";
const MODE_ACCOUNT = "backend-mode"; // values: 'auto' | 'grudge' | 'cloudflare' | 'r2-direct' | 'cloudflare-worker'
/** Grudge ID gateway — always id.grudge-studio.com (never auth.grudge-studio.com). */
const FLEET_ID_ACCOUNT = "fleet.idBase";
const FLEET_GAME_DATA_ACCOUNT = "fleet.gameDataUrl";

let cachedBase: string | null = null;
let cachedAssetsBase: string | null = null;

/** Reject deprecated auth hosts when saving fleet URLs. */
function normalizeFleetUrl(url: string, kind: "client" | "id" | "gameData"): string {
  let u = url.trim().replace(/\r/g, "").replace(/\/$/, "");
  if (/^https?:\/\/auth\.grudge-studio\.com/i.test(u)) {
    u = FLEET_URLS.auth;
  }
  if (kind === "client" && /^https?:\/\/api\.grudge-studio\.com/i.test(u)) {
    u = FLEET_CLIENT_URL;
  }
  if (kind === "id" && !/^https?:\/\/id\.grudge-studio\.com/i.test(u) && u.length > 0) {
    // Force canonical ID gateway
    u = FLEET_URLS.auth;
  }
  return u;
}

export async function setApiBaseUrl(url: string): Promise<void> {
  cachedBase = normalizeFleetUrl(url, "client") || FLEET_CLIENT_URL;
  await keytar.setPassword(SERVICE, `${ACCOUNT}.apiBaseUrl`, cachedBase);
}

export async function getApiBaseUrl(): Promise<string> {
  if (cachedBase) return cachedBase;
  const stored = await keytar.getPassword(SERVICE, `${ACCOUNT}.apiBaseUrl`);
  let base = (stored || process.env.GRUDGE_API_BASE || FLEET_CLIENT_URL).replace(/\/$/, "");
  if (/api\.grudge-studio\.com|auth\.grudge-studio\.com/i.test(base)) {
    base = FLEET_CLIENT_URL;
  }
  cachedBase = base;
  return cachedBase;
}

export async function getIdBaseUrl(): Promise<string> {
  const stored = await keytar.getPassword(SERVICE, FLEET_ID_ACCOUNT);
  const env = process.env.GRUDGE_ID_BASE || process.env.GRUDGE_AUTH_URL;
  let base = (stored || env || FLEET_URLS.auth).replace(/\/$/, "");
  if (/auth\.grudge-studio\.com|api\.grudge-studio\.com/i.test(base)) {
    base = FLEET_URLS.auth;
  }
  return base;
}

export async function setIdBaseUrl(url: string): Promise<void> {
  const base = normalizeFleetUrl(url, "id") || FLEET_URLS.auth;
  await keytar.setPassword(SERVICE, FLEET_ID_ACCOUNT, base);
}

export async function getGameDataUrl(): Promise<string> {
  const stored = await keytar.getPassword(SERVICE, FLEET_GAME_DATA_ACCOUNT);
  return (stored || process.env.GRUDGE_GAME_DATA_URL || FLEET_GAME_DATA_URL).replace(/\/$/, "");
}

export async function setGameDataUrl(url: string): Promise<void> {
  const base = normalizeFleetUrl(url, "gameData") || FLEET_GAME_DATA_URL;
  await keytar.setPassword(SERVICE, FLEET_GAME_DATA_ACCOUNT, base);
}

/** ONE TRUTH preset → Credential Vault (Settings button). */
export async function applyOneTruthFleetPreset(): Promise<{
  apiBaseUrl: string;
  idBaseUrl: string;
  gameDataUrl: string;
  objectStoreWorker: string;
  assetsCdn: string;
  legionHub: string;
  backendMode: BackendMode;
}> {
  await setApiBaseUrl(FLEET_CLIENT_URL);
  await clearAssetsApiBaseUrl();
  await setIdBaseUrl(FLEET_URLS.auth);
  await setGameDataUrl(FLEET_GAME_DATA_URL);
  await setBackendMode("r2-direct");
  const workerHost = FLEET_URLS.objectStore.replace(/\/api\/v1\/?$/, "");
  await keytar.setPassword(SERVICE, "cf-objectstore-worker-url", workerHost);
  await keytar.setPassword(SERVICE, "cf-r2-public-url", FLEET_URLS.assets);
  await keytar.setPassword(SERVICE, "legion.hubUrl", FLEET_URLS.ai);
  return {
    apiBaseUrl: FLEET_CLIENT_URL,
    idBaseUrl: FLEET_URLS.auth,
    gameDataUrl: FLEET_GAME_DATA_URL,
    objectStoreWorker: workerHost,
    assetsCdn: FLEET_URLS.assets,
    legionHub: FLEET_URLS.ai,
    backendMode: "r2-direct",
  };
}

/**
 * Objectstore / asset-service base URL.
 *
 * ONE TRUTH (v0.5+): a single fleet client host (`client.grudge-studio.com`) serves
 * `/api/objectstore/*` via Vercel rewrites — same URL as `getApiBaseUrl()` unless
 * you explicitly override for legacy split-host installs.
 *
 * Resolution order:
 *   1. keytar `default.assetsApiBaseUrl`   — explicit override
 *   2. process.env.GRUDGE_ASSETS_API_BASE   — build/run-time override
 *   3. `getApiBaseUrl()`                      — ONE TRUTH fall-through (default)
 */
export async function setAssetsApiBaseUrl(url: string): Promise<void> {
  cachedAssetsBase = url.replace(/\/$/, "");
  await keytar.setPassword(SERVICE, `${ACCOUNT}.assetsApiBaseUrl`, cachedAssetsBase);
}

export async function clearAssetsApiBaseUrl(): Promise<void> {
  cachedAssetsBase = null;
  try {
    await keytar.deletePassword(SERVICE, `${ACCOUNT}.assetsApiBaseUrl`);
  } catch { /* not stored */ }
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
  return getApiBaseUrl();
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

/** Same as authedFetch but routes to objectstore host (fleet client by default). */
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

/**
 * Safe JSON parse for fleet REST.
 * Root cause of mass `os:list` / treaty IPC spam in main.log:
 * SPA hosts often return HTML (`<!DOCTYPE…`) when rewrites miss → res.json() throws.
 */
async function readBodyText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function looksLikeHtml(text: string, contentType: string | null): boolean {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("text/html")) return true;
  const head = text.trimStart().slice(0, 32).toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html");
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type");
  const text = await readBodyText(res);

  if (looksLikeHtml(text, ct)) {
    throw new Error(
      `HTTP ${res.status} returned HTML instead of JSON (route miss or SPA fallback). ` +
        `Check fleet rewrites / objectstore base URL.`,
    );
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = text ? (JSON.parse(text) as { error?: unknown }) : null;
      if (body && typeof body === "object" && typeof body.error === "string") {
        detail = body.error;
      }
    } catch { /* ignore */ }
    throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
  }

  if (!text.trim()) {
    throw new Error(`HTTP ${res.status} empty body (expected JSON)`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `HTTP ${res.status} invalid JSON (content-type=${ct || "unknown"}). ` +
        `Body starts: ${text.slice(0, 80).replace(/\s+/g, " ")}`,
    );
  }
}

/** Empty list when objectstore is unreachable — keeps UI usable, logs once. */
function emptyListResponse(reason: string, prefix = ""): ListResponse {
  console.warn(`[api] objectstore list degraded: ${reason}`);
  return { items: [], folders: [], nextCursor: null, prefix, count: 0 };
}

// ---------------------------------------------------------------------------
// Object-storage API — routes through GrudgeBuilder or the Cloudflare Worker
// based on the backend mode.
// ---------------------------------------------------------------------------
export async function listObjects(req: ListRequest & { delimiter?: string }): Promise<ListResponse> {
  const backend = await resolveBackend();
  if (backend === "r2-direct") {
    try {
      return await r2List({ prefix: req.prefix, delimiter: req.delimiter, cursor: req.cursor, limit: req.limit });
    } catch (e) {
      return emptyListResponse(e instanceof Error ? e.message : String(e), req.prefix);
    }
  }
  if (backend === "cloudflare-worker") {
    try {
      return await workerList({ prefix: req.prefix, delimiter: req.delimiter, cursor: req.cursor, limit: req.limit });
    } catch (e) {
      return emptyListResponse(e instanceof Error ? e.message : String(e), req.prefix);
    }
  }

  const params = new URLSearchParams({ prefix: req.prefix });
  if (req.delimiter) params.set("delimiter", req.delimiter);
  if (req.cursor) params.set("cursor", req.cursor);
  if (req.limit) params.set("limit", String(req.limit));

  // Primary: fleet client same-origin rewrite
  try {
    const res = await authedFetchAssets(`/api/objectstore/list?${params}`);
    return await jsonOrThrow<ListResponse>(res);
  } catch (primaryErr) {
    const msg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
    // Fallback: R2 direct if credentials configured
    try {
      const haveDirect =
        Boolean(await readCf("endpoint")) &&
        Boolean(await readCf("accessKeyId")) &&
        Boolean(await readCf("secret")) &&
        Boolean(await readCf("bucket"));
      if (haveDirect) {
        return await r2List({
          prefix: req.prefix,
          delimiter: req.delimiter,
          cursor: req.cursor,
          limit: req.limit,
        });
      }
    } catch (r2Err) {
      return emptyListResponse(
        `client rewrite failed (${msg}); r2 fallback failed (${r2Err instanceof Error ? r2Err.message : r2Err})`,
        req.prefix,
      );
    }
    return emptyListResponse(`client rewrite failed: ${msg}`, req.prefix);
  }
}

/**
 * Search **all** Grudge Studio Assets (not just the current browser folder).
 *
 * Primary: full live registry + CDN prod catalogs (`assetSearch.ts`).
 * Secondary: Worker / ObjectStore search when configured (merged).
 * ObjectStore `/search` often 404s — never fail closed with empty when catalog works.
 */
export async function searchObjects(req: SearchRequest): Promise<SearchResponse> {
  const { searchAllStudioAssets } = await import("./assetSearch");

  // Always use the full catalog (6k+ assets) as SSOT for Assets tab search.
  let primary: SearchResponse = { count: 0, items: [] };
  try {
    primary = await searchAllStudioAssets(req);
  } catch (e) {
    console.warn("[api] searchAllStudioAssets failed", e);
  }

  // Optional: merge worker / fleet search hits that might not be in the index yet
  const backend = await resolveBackend();
  let extra: SearchResponse = { count: 0, items: [] };
  try {
    if (backend === "cloudflare-worker") {
      extra = await workerSearch(req);
    } else if (backend !== "r2-direct") {
      const params = new URLSearchParams();
      if (req.q) params.set("q", req.q);
      if (req.category) params.set("category", req.category);
      if (req.pack) params.set("pack", req.pack);
      if (req.limit) params.set("limit", String(req.limit ?? 100));
      const res = await authedFetchAssets(`/api/objectstore/search?${params}`);
      extra = await jsonOrThrow<SearchResponse>(res);
    }
  } catch {
    /* optional — catalog is enough */
  }

  if (!extra.items?.length) return primary;

  const seen = new Set(primary.items.map((i) => i.path));
  const merged = [...primary.items];
  for (const it of extra.items) {
    const path = it.path || (it as { name?: string }).name;
    if (!path || seen.has(path)) continue;
    seen.add(path);
    merged.push({
      packId: it.packId ?? "assets",
      path,
      category: it.category,
      grudgeUUID: it.grudgeUUID,
      sizeBytes: it.sizeBytes,
      contentType: it.contentType,
    });
  }
  const limit = req.limit ?? 200;
  return {
    count: Math.max(primary.count, merged.length),
    items: merged.slice(0, limit),
  };
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
