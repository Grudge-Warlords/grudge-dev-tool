import { readCf } from "./credentials";

/**
 * Client for the Grudge Cloudflare Worker that fronts R2.
 * Default conventions (the dev tool will adapt automatically if a route 404s):
 *   GET  /list?prefix=&delimiter=&cursor=&limit=    \u2192 { items, folders, nextCursor }
 *   GET  /asset/<path>                              \u2192 302 redirect to a signed/public URL
 *   POST /upload-url  { path, contentType, size }   \u2192 { uploadURL, objectPath, ... }
 *   POST /manifest    { packId, version, entries }  \u2192 { ok, manifestPath, count }
 *   GET  /search?q=&category=&pack=&limit=          \u2192 { items, count }
 *   GET  /health                                    \u2192 200 OK
 *
 * If your Worker uses different paths, set the route overrides via env vars:
 *   CF_WORKER_PATH_LIST, CF_WORKER_PATH_UPLOAD, CF_WORKER_PATH_MANIFEST,
 *   CF_WORKER_PATH_ASSET, CF_WORKER_PATH_SEARCH, CF_WORKER_PATH_HEALTH
 */

export interface WorkerListResponse {
  items: Array<{ name: string; size: number; contentType: string; updated: string | null; md5Hash?: string | null }>;
  folders: string[];
  nextCursor: string | null;
  prefix: string;
  count: number;
}

export interface WorkerSearchResponse { items: any[]; count: number }
export interface WorkerUploadUrlResponse {
  uploadURL: string;
  objectPath: string;
  bucketPath?: string;
  ttlSeconds?: number;
  uploadId?: string;
}

const ROUTES = {
  list:     process.env.CF_WORKER_PATH_LIST     ?? "/list",
  upload:   process.env.CF_WORKER_PATH_UPLOAD   ?? "/upload-url",
  manifest: process.env.CF_WORKER_PATH_MANIFEST ?? "/manifest",
  asset:    process.env.CF_WORKER_PATH_ASSET    ?? "/asset",
  search:   process.env.CF_WORKER_PATH_SEARCH   ?? "/search",
  health:   process.env.CF_WORKER_PATH_HEALTH   ?? "/health",
} as const;

async function workerBase(): Promise<{ url: string; key: string }> {
  const url = await readCf("workerUrl");
  const key = await readCf("workerApiKey");
  if (!url) throw new Error("OBJECTSTORE_WORKER_URL not set in keytar");
  if (!key) throw new Error("OBJECTSTORE_API_KEY not set in keytar");
  return { url: url.replace(/\/$/, ""), key };
}

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { url, key } = await workerBase();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${key}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${url}${path}`, { ...init, headers });
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: unknown; message?: unknown };
      const candidate = (typeof body?.error === "string" && body.error)
        || (typeof body?.message === "string" && body.message);
      if (candidate) detail = ` \u2014 ${candidate}`;
    } catch { /* not json */ }
    throw new Error(`Worker ${res.status} ${res.statusText}${detail}`);
  }
  return res.json() as Promise<T>;
}

export async function workerHealth(): Promise<{ ok: boolean; latencyMs: number; status: number | null; error: string | null }> {
  const start = Date.now();
  try {
    const res = await authedFetch(ROUTES.health, { method: "GET" });
    return { ok: res.ok, latencyMs: Date.now() - start, status: res.status, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, status: null, error: err?.message ?? String(err) };
  }
}

export async function workerList(req: { prefix: string; delimiter?: string; cursor?: string; limit?: number }): Promise<WorkerListResponse> {
  const params = new URLSearchParams();
  params.set("prefix", req.prefix);
  if (req.delimiter) params.set("delimiter", req.delimiter);
  if (req.cursor) params.set("cursor", req.cursor);
  if (req.limit) params.set("limit", String(req.limit));
  const res = await authedFetch(`${ROUTES.list}?${params}`);
  // Workers sometimes return either {items, folders} or just {items}; normalize.
  const json = await jsonOrThrow<any>(res);
  return {
    items: json.items ?? json.files ?? [],
    folders: json.folders ?? json.prefixes ?? [],
    nextCursor: json.nextCursor ?? json.cursor ?? null,
    prefix: req.prefix,
    count: (json.items ?? json.files ?? []).length,
  };
}

export async function workerSearch(req: { q?: string; category?: string; pack?: string; limit?: number }): Promise<WorkerSearchResponse> {
  const params = new URLSearchParams();
  if (req.q) params.set("q", req.q);
  if (req.category) params.set("category", req.category);
  if (req.pack) params.set("pack", req.pack);
  if (req.limit) params.set("limit", String(req.limit));
  const res = await authedFetch(`${ROUTES.search}?${params}`);
  const json = await jsonOrThrow<any>(res);
  return { items: json.items ?? [], count: json.count ?? (json.items ?? []).length };
}

export async function workerUploadUrl(input: {
  path: string; contentType?: string; size?: number; sha256?: string; allowOverwrite?: boolean;
}): Promise<WorkerUploadUrlResponse> {
  const res = await authedFetch(ROUTES.upload, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return jsonOrThrow<WorkerUploadUrlResponse>(res);
}

export async function workerManifestWrite(payload: { packId: string; version: string; entries: any[]; meta?: Record<string, any> }): Promise<{ ok: boolean; manifestPath?: string; count?: number }> {
  const res = await authedFetch(ROUTES.manifest, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return jsonOrThrow(res);
}

export async function workerAssetMeta(objectPath: string): Promise<{ url: string; ttlSeconds: number; size: number; contentType: string | null; updated: string | null; publicCdn: string | null }> {
  const path = objectPath.replace(/^\//, "");
  const res = await authedFetch(`${ROUTES.asset}/${path}?format=json`);
  const json = await jsonOrThrow<any>(res);
  const publicCdn = (await readCf("publicR2Url")) ?? (await readCf("publicUrl"));
  return {
    url: json.url ?? json.signedUrl,
    ttlSeconds: json.ttlSeconds ?? 600,
    size: json.size ?? 0,
    contentType: json.contentType ?? null,
    updated: json.updated ?? null,
    publicCdn: publicCdn ? `${publicCdn.replace(/\/$/, "")}/${path}` : null,
  };
}
