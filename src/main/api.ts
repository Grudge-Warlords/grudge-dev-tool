import keytar from "keytar";
import type {
  ListRequest, ListResponse, SearchRequest, SearchResponse,
  RequestUrlInput, AssetMeta, UUIDGenInput,
} from "../shared/ipc";

const SERVICE = "grudge-dev-tool";
const ACCOUNT = "default";

let cachedBase: string | null = null;

export async function setApiBaseUrl(url: string): Promise<void> {
  cachedBase = url.replace(/\/$/, "");
  await keytar.setPassword(SERVICE, `${ACCOUNT}.apiBaseUrl`, cachedBase);
}

export async function getApiBaseUrl(): Promise<string> {
  if (cachedBase) return cachedBase;
  const stored = await keytar.getPassword(SERVICE, `${ACCOUNT}.apiBaseUrl`);
  cachedBase = (stored || process.env.GRUDGE_API_BASE || "https://grudgewarlords.com").replace(/\/$/, "");
  return cachedBase;
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
// Object-storage API
// ---------------------------------------------------------------------------
export async function listObjects(req: ListRequest): Promise<ListResponse> {
  const params = new URLSearchParams({ prefix: req.prefix });
  if (req.cursor) params.set("cursor", req.cursor);
  if (req.limit) params.set("limit", String(req.limit));
  const res = await authedFetch(`/api/objectstore/list?${params}`);
  return jsonOrThrow<ListResponse>(res);
}

export async function searchObjects(req: SearchRequest): Promise<SearchResponse> {
  const params = new URLSearchParams();
  if (req.q) params.set("q", req.q);
  if (req.category) params.set("category", req.category);
  if (req.pack) params.set("pack", req.pack);
  if (req.limit) params.set("limit", String(req.limit));
  const res = await authedFetch(`/api/objectstore/search?${params}`);
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
  const res = await authedFetch("/api/objectstore/upload-url", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return jsonOrThrow<UploadUrlResponse>(res);
}

export async function writeManifest(payload: {
  packId: string; version: string; entries: any[]; meta?: Record<string, any>;
}): Promise<{ ok: boolean; manifestPath: string; count: number }> {
  const res = await authedFetch("/api/objectstore/manifest", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return jsonOrThrow(res);
}

export async function getAssetMeta(input: RequestUrlInput): Promise<AssetMeta> {
  const path = input.objectPath.replace(/^\//, "");
  const res = await authedFetch(`/api/objectstore/asset/${path}?format=json`);
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
