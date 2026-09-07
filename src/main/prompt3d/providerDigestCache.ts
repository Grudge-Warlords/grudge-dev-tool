import { createHash } from "node:crypto";
import { createReadStream, type BigIntStats } from "node:fs";
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

type DigestReader = (path: string) => Promise<string>;

interface CachedDigest {
  fingerprint: string;
  sha256: string;
}

// Model inventories are already bounded to 200,000 files. Keep the cache bounded
// to the same limit so additional installer roots cannot grow the main process
// indefinitely. This is intentionally process-local and is never persisted.
const MAX_CACHED_MODEL_FILES = 200_000;
const installedModelDigestCache = new Map<string, CachedDigest>();

async function sha256File(path: string): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

function normalizedPath(path: string): string {
  const absolute = resolve(path);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function fileFingerprint(info: BigIntStats): { value: string; cacheable: boolean } {
  return {
    // dev + ino are the filesystem identity. The nanosecond timestamps and
    // birth time prevent ordinary in-place writes and path replacements from
    // reusing an earlier digest. A zero inode is treated as unsupported.
    value: [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs, info.birthtimeNs].join(":"),
    cacheable: info.ino > 0n,
  };
}

function remember(key: string, value: CachedDigest): void {
  installedModelDigestCache.delete(key);
  installedModelDigestCache.set(key, value);
  if (installedModelDigestCache.size <= MAX_CACHED_MODEL_FILES) return;
  const oldest = installedModelDigestCache.keys().next().value as string | undefined;
  if (oldest !== undefined) installedModelDigestCache.delete(oldest);
}

/**
 * Return the SHA-256 for one already-lstat'd installed model file.
 *
 * The signed expected digest is part of the cache key, and only a matching
 * digest is cached. Callers must still perform their normal per-call lstat
 * file/size/link checks before using this function. Filesystems that do not
 * expose a stable inode simply retain the original hash-every-call behavior.
 */
export async function sha256InstalledModelFile(
  path: string,
  observed: BigIntStats,
  expectedSha256: string,
  readDigest: DigestReader = sha256File,
): Promise<string> {
  const before = fileFingerprint(observed);
  const key = `${normalizedPath(path)}\0${expectedSha256}`;
  const cached = before.cacheable ? installedModelDigestCache.get(key) : undefined;
  if (cached?.fingerprint === before.value) return cached.sha256;
  // Once the observed identity changes, the old digest must not become usable
  // again even if a later mutation happens to restore older timestamps.
  installedModelDigestCache.delete(key);

  const digest = await readDigest(path);
  const afterInfo = await lstat(path, { bigint: true });
  const after = fileFingerprint(afterInfo);
  if (!afterInfo.isFile() || afterInfo.isSymbolicLink() || after.value !== before.value) {
    installedModelDigestCache.delete(key);
    throw new Error("Installed model file changed while its SHA-256 was being verified.");
  }
  if (before.cacheable && digest === expectedSha256) remember(key, { fingerprint: before.value, sha256: digest });
  return digest;
}
