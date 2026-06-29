import { authHeaders } from "./auth.js";
import { resolveApiBase } from "./config.js";

export interface ManifestEntry {
  path: string;
  grudgeUUID: string;
  category: string;
  sha256: string;
  size: number;
  contentType: string;
  thumbPath?: string;
}

export class ObjectStoreClient {
  constructor(private apiBase = resolveApiBase()) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers = await authHeaders();
    const res = await fetch(`${this.apiBase}${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: T;
    try {
      json = JSON.parse(text) as T;
    } catch {
      throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      throw new Error(
        `${method} ${path} → ${res.status}: ${(json as { error?: string }).error || text}`,
      );
    }
    return json;
  }

  list(prefix: string, limit = 100) {
    const q = new URLSearchParams({ prefix, limit: String(limit) });
    return this.request<{ items: Array<{ name: string; size: number }> }>(
      "GET",
      `/api/objectstore/list?${q}`,
    );
  }

  search(opts: { q?: string; pack?: string; category?: string; limit?: number }) {
    const q = new URLSearchParams();
    if (opts.q) q.set("q", opts.q);
    if (opts.pack) q.set("pack", opts.pack);
    if (opts.category) q.set("category", opts.category);
    if (opts.limit) q.set("limit", String(opts.limit));
    return this.request<{ count: number; items: ManifestEntry[] }>(
      "GET",
      `/api/objectstore/search?${q}`,
    );
  }

  async uploadFile(
    targetPath: string,
    data: Buffer,
    contentType: string,
    sha256: string,
    allowOverwrite = false,
  ): Promise<string> {
    const { uploadURL } = await this.request<{ uploadURL: string }>(
      "POST",
      "/api/objectstore/upload-url",
      {
        path: targetPath,
        contentType,
        size: data.length,
        sha256,
        allowOverwrite,
      },
    );
    const put = await fetch(uploadURL, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: new Uint8Array(data),
    });
    if (!put.ok) {
      throw new Error(`PUT ${targetPath} failed: ${put.status}`);
    }
    return targetPath;
  }

  writeManifest(
    packId: string,
    version: string,
    entries: ManifestEntry[],
    meta: Record<string, string>,
  ) {
    return this.request<{ ok: boolean; count: number }>(
      "POST",
      "/api/objectstore/manifest",
      { packId, version, entries, meta },
    );
  }

  fleetManifest() {
    return this.request<Record<string, unknown>>("GET", "/api/fleet/manifest");
  }
}