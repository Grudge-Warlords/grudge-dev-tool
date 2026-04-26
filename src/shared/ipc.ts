/** Shared IPC contracts between Electron main and the React renderer. */

export interface ListRequest {
  prefix: string;
  cursor?: string;
  limit?: number;
  /** When set to '/', the listing returns folders separately from files. */
  delimiter?: string;
}

export interface ListItem {
  name: string;
  size: number;
  contentType: string;
  updated: string | null;
  /** Optional — not every backend exposes md5 (e.g. Cloudflare R2 returns sha256). */
  md5Hash?: string | null;
}

export interface ListResponse {
  items: ListItem[];
  nextCursor: string | null;
  prefix: string;
  count: number;
  /** Folder prefixes when the request was made with delimiter='/'. */
  folders?: string[];
}

export interface SearchRequest {
  q?: string;
  category?: string;
  pack?: string;
  limit?: number;
}

export interface SearchItem {
  packId: string;
  path: string;
  category?: string;
  grudgeUUID?: string;
  sizeBytes?: number;
  contentType?: string;
}

export interface SearchResponse {
  count: number;
  items: SearchItem[];
}

export interface UploadFile {
  /** Absolute path on disk (used by the main process). */
  localPath: string;
  /** Target object path under PRIVATE_OBJECT_DIR, e.g. asset-packs/classic64/v0.6/Books/cover.png */
  targetPath: string;
  contentType?: string;
}

export interface UploadJob {
  id: string;
  files: UploadFile[];
  packId?: string;
  packVersion?: string;
  /** When true, generate Grudge UUIDs and write a manifest at the end. */
  buildManifest?: boolean;
}

export type UploadStatus =
  | "queued"
  | "uploading"
  | "completed"
  | "failed"
  | "skipped";

export interface UploadProgress {
  jobId: string;
  fileIndex: number;
  filePath: string;
  status: UploadStatus;
  bytesUploaded: number;
  bytesTotal: number;
  error?: string;
  grudgeUUID?: string;
}

export interface RequestUrlInput {
  objectPath: string;
  /** When 'json', main returns metadata; otherwise opens in default browser. */
  format?: "json" | "redirect";
}

export interface AssetMeta {
  url: string;
  ttlSeconds: number;
  size: number;
  contentType: string | null;
  updated: string | null;
  publicCdn: string;
}

export interface UUIDGenInput {
  slot: string;
  tier: number | null;
  itemId: number;
}

export interface AppSettings {
  apiBaseUrl: string;
  /** Optional override for the public CDN host shown in the UI. */
  cdnBaseUrl: string;
  /** Stored separately in keytar; this flag just tells the UI a token is set. */
  hasToken: boolean;
}
