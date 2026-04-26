import keytar from "keytar";
import type {
  ListRequest, ListResponse, SearchRequest, SearchResponse,
  RequestUrlInput, AssetMeta, UUIDGenInput,
} from "../shared/ipc";
import {
  workerList, workerSearch, workerUploadUrl, workerManifestWrite, workerAssetMeta,
} from "./cf/objectStoreWorker";
import { readCf } from "./cf/credentials";

const SERVICE = "grudge-dev-tool";
const ACCOUNT = "default";
const MODE_ACCOUNT = "backend-mode"; // values: 'auto' | 'grudge' | 'cloudflare'

let cachedBase: string | null = null;

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

export async function setToken(token: string): Promise<void> {
  await keytar.setPassword(SERVICE, ACCOUNT, token);
}

export async function getToken(): Promise<string | null> {
  return keytar.getPassword(SERVICE, ACCOUNT);
}

export async function clearToken(): Promise<void> {
  await keytar.deletePassword(SERVICE, ACCOUNT);
}

export type BackendMode = "auto" | "grudge" | "cloudflare";
export async function getBackendMode(): Promise<BackendMode> {
  const v = await keytar.getPassword(SERVICE, MODE_ACCOUNT);
  if (v === "grudge" || v === "cloudflare" || v === "auto") return v;
  return "auto";
}
export async function setBackendMode(mode: BackendMode): Promise<void> {
  await keytar.setPassword(SERVICE, MODE_ACCOUNT, mode);
}

/** Decide which backend handles object-storage calls right now. */
async function resolveBackend(): Promise<"grudge" | "cloudflare"> {
  const mode = await getBackendMode();
  if (mode === "grudge") return "grudge";
  if (mode === "cloudflare") return "cloudflare";
  // auto: prefer Cloudflare Worker if both worker URL + key are set
  const haveWorker = Boolean(await readCf("workerUrl")) && Boolean(await readCf("workerApiKey"));
  return haveWorker ? "cloudflare" : "grudge";
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
// Object-storage API — routes through GrudgeBuilder or the Cloudflare Worker
// based on the backend mode.
// ---------------------------------------------------------------------------
export async function listObjects(req: ListRequest & { delimiter?: string }): Promise<ListResponse & { folders?: string[] }> {
  if ((await resolveBackend()) === "cloudflare") {
    return workerList({ prefix: req.prefix, delimiter: req.delimiter, cursor: req.cursor, limit: req.limit });
  }
  const params = new URLSearchParams({ prefix: req.prefix });
  if (req.delimiter) params.set("delimiter", req.delimiter);
  if (req.cursor) params.set("cursor", req.cursor);
  if (req.limit) params.set("limit", String(req.limit));
  const res = await authedFetch(`/api/objectstore/list?${params}`);
  return jsonOrThrow<ListResponse>(res);
}

export async function searchObjects(req: SearchRequest): Promise<SearchResponse> {
  if ((await resolveBackend()) === "cloudflare") {
    return workerSearch(req);
  }
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
  if ((await resolveBackend()) === "cloudflare") {
    const r = await workerUploadUrl(input);
    return {
      uploadURL: r.uploadURL,
      objectPath: r.objectPath,
      bucketPath: r.bucketPath ?? "",
      ttlSeconds: r.ttlSeconds ?? 900,
      uploadId: r.uploadId ?? "",
    };
  }
  const res = await authedFetch("/api/objectstore/upload-url", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return jsonOrThrow<UploadUrlResponse>(res);
}

export async function writeManifest(payload: {
  packId: string; version: string; entries: any[]; meta?: Record<string, any>;
}): Promise<{ ok: boolean; manifestPath: string; count: number }> {
  if ((await resolveBackend()) === "cloudflare") {
    const r = await workerManifestWrite(payload);
    return { ok: !!r.ok, manifestPath: r.manifestPath ?? "", count: r.count ?? payload.entries.length };
  }
  const res = await authedFetch("/api/objectstore/manifest", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return jsonOrThrow(res);
}

export async function getAssetMeta(input: RequestUrlInput): Promise<AssetMeta> {
  if ((await resolveBackend()) === "cloudflare") {
    const r = await workerAssetMeta(input.objectPath);
    return {
      url: r.url,
      ttlSeconds: r.ttlSeconds,
      size: r.size,
      contentType: r.contentType,
      updated: r.updated,
      publicCdn: r.publicCdn ?? `https://assets.grudge-studio.com/${input.objectPath.replace(/^\//, "")}`,
    };
  }
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
