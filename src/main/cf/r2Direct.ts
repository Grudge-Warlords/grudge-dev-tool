import { S3Client, ListObjectsV2Command, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { readCf } from "./credentials";

/**
 * Cloudflare R2 client using the S3-compatible API. Uses creds stored in keytar:
 *   cf-r2-endpoint        \u2192 https://<account-id>.r2.cloudflarestorage.com
 *   cf-r2-access-key-id   \u2192 32-char access key
 *   cf-r2-secret          \u2192 64-char secret
 *   cf-r2-bucket          \u2192 bucket name (default; can be overridden per-call)
 *   cf-r2-region          \u2192 typically "auto"
 *
 * Compared to the Worker path, this is a known-stable protocol \u2014 no need to
 * guess endpoints. Trade-off: presigned URLs are R2-account-scoped, so we
 * can't easily proxy them through a CDN with a custom domain. For public
 * reads, fall back to OBJECT_STORAGE_PUBLIC_URL / OBJECT_STORAGE_PUBLIC_R2_URL.
 */

let cachedClient: S3Client | null = null;
let cachedBucket: string | null = null;

async function getClient(): Promise<{ s3: S3Client; bucket: string }> {
  if (cachedClient && cachedBucket) return { s3: cachedClient, bucket: cachedBucket };
  const endpoint = await readCf("endpoint");
  const accessKeyId = await readCf("accessKeyId");
  const secretAccessKey = await readCf("secret");
  const bucket = await readCf("bucket");
  const region = (await readCf("region")) || "auto";
  if (!endpoint) throw new Error("OBJECT_STORAGE_ENDPOINT not set in keytar");
  if (!accessKeyId) throw new Error("OBJECT_STORAGE_KEY not set in keytar");
  if (!secretAccessKey) throw new Error("OBJECT_STORAGE_SECRET not set in keytar");
  if (!bucket) throw new Error("OBJECT_STORAGE_BUCKET not set in keytar");
  cachedClient = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    // R2 rejects the AWS-SDK auto-injected x-amz-checksum-* headers (see
    // https://developers.cloudflare.com/r2/api/s3/api/ — "Unsupported
    // header: x-amz-checksum-crc32"). Force the SDK to only add a checksum
    // when the operation actually requires one.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  } as any);
  cachedBucket = bucket;
  return { s3: cachedClient, bucket };
}

/** Drop the cached client \u2014 call this when creds change. */
export function resetR2Client(): void {
  cachedClient = null;
  cachedBucket = null;
}

export interface R2ListResponse {
  items: Array<{ name: string; size: number; contentType: string; updated: string | null; md5Hash?: string | null }>;
  folders: string[];
  nextCursor: string | null;
  prefix: string;
  count: number;
}

export async function r2List(req: { prefix: string; delimiter?: string; cursor?: string; limit?: number }): Promise<R2ListResponse> {
  const { s3, bucket } = await getClient();
  const cmd = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: req.prefix,
    Delimiter: req.delimiter,
    MaxKeys: req.limit ?? 1000,
    ContinuationToken: req.cursor,
  });
  const r = await s3.send(cmd);
  return {
    items: (r.Contents ?? []).map((o) => ({
      name: o.Key ?? "",
      size: Number(o.Size ?? 0),
      contentType: "application/octet-stream", // S3 ListObjectsV2 doesn't return Content-Type; fetch via HEAD when needed
      updated: o.LastModified ? o.LastModified.toISOString() : null,
      md5Hash: o.ETag ?? null,
    })),
    folders: (r.CommonPrefixes ?? []).map((p) => p.Prefix ?? "").filter(Boolean),
    nextCursor: r.NextContinuationToken ?? null,
    prefix: req.prefix,
    count: (r.Contents ?? []).length,
  };
}

export async function r2Head(key: string): Promise<{ size: number; contentType: string | null; updated: string | null; md5Hash: string | null }> {
  const { s3, bucket } = await getClient();
  const r = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  return {
    size: Number(r.ContentLength ?? 0),
    contentType: r.ContentType ?? null,
    updated: r.LastModified ? r.LastModified.toISOString() : null,
    md5Hash: r.ETag ?? null,
  };
}

export async function r2GetSignedDownloadUrl(key: string, ttlSeconds: number = 600): Promise<string> {
  const { s3, bucket } = await getClient();
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: ttlSeconds });
}

export async function r2GetSignedUploadUrl(key: string, contentType?: string, ttlSeconds: number = 900): Promise<string> {
  const { s3, bucket } = await getClient();
  return getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), { expiresIn: ttlSeconds });
}

export async function r2Delete(key: string): Promise<void> {
  const { s3, bucket } = await getClient();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** Health probe \u2014 HeadBucket is the cheapest "are creds valid + reachable" call. */
export async function r2Health(): Promise<{ ok: boolean; latencyMs: number; error: string | null; bucket: string | null }> {
  const start = Date.now();
  try {
    const { s3, bucket } = await getClient();
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return { ok: true, latencyMs: Date.now() - start, error: null, bucket };
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, error: err?.name === "Forbidden" ? "403 Forbidden \u2014 token lacks permissions on bucket" : (err?.message ?? String(err)), bucket: null };
  }
}

/** Compose the public CDN URL for a key. Returns null if no public URL is configured. */
export async function r2PublicUrl(key: string): Promise<string | null> {
  const baseR2 = await readCf("publicR2Url");
  const base = (await readCf("publicUrl")) ?? baseR2;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
}
