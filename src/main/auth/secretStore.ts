import { app, safeStorage } from "electron";
import keytar from "keytar";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import log from "../logger";

/**
 * Hybrid secret storage with automatic fallback.
 *
 * Why:
 *   Windows Credential Manager (the keytar backend on Win32) rejects credential
 *   blobs larger than ~2.5 KB with the cryptic Win32 error
 *   `RPC_X_BAD_STUB_DATA (0x800706F7)` — surfaced through node-keytar as
 *   "The stub received bad data." Modern Puter / OAuth tokens are signed JWTs
 *   that comfortably exceed that limit, so storing the raw token via keytar
 *   was failing for everyone signing in via the browser flow on v0.3.0.
 *
 * Strategy:
 *   1. Try keytar first. On Linux (libsecret) and macOS (Keychain) it has no
 *      size cap, and small values on Windows fit fine.
 *   2. On any keytar error (size, RPC, or native binding failure), fall back
 *      to an Electron `safeStorage`-encrypted file under
 *      `app.getPath("userData")/secrets/<account>.bin`. safeStorage uses
 *      Windows DPAPI / macOS Keychain / Linux secret-service under the hood,
 *      so the file is bound to the OS user account.
 *   3. Reads check keytar first (back-compat for v0.3.0 installs that wrote
 *      small values), then the file. Deletes clear both locations so a stale
 *      keytar entry never shadows a fresh file write (or vice versa).
 *
 * Note: this stores ALL secrets the dev tool keeps, not just the Puter token.
 * Switching everything keeps the storage uniform and avoids future overflow
 * surprises if any other field ever grows.
 */

const SERVICE = "grudge-dev-tool";

function secretsDir(): string {
  return join(app.getPath("userData"), "secrets");
}

function pathFor(account: string): string {
  // Account names can contain dots, slashes, etc. (e.g. "default.apiBaseUrl")
  // — sanitise to a safe filename.
  const safe = account.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(secretsDir(), `${safe}.bin`);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(secretsDir(), { recursive: true });
}

/**
 * Store a secret. Returns a `via` indicator describing which backend won so
 * callers can log it for diagnostics.
 */
export async function setSecret(
  account: string,
  value: string,
): Promise<{ via: "keytar" | "safeStorage" }> {
  try {
    await keytar.setPassword(SERVICE, account, value);
    // keytar succeeded — clean up any stale file from a previous fallback.
    await fs.unlink(pathFor(account)).catch(() => { /* not present */ });
    return { via: "keytar" };
  } catch (err: any) {
    log.warn(
      `[secretStore] keytar.setPassword failed for account=${account} ` +
      `(${value.length} chars): ${err?.message ?? String(err)} ` +
      `— falling back to safeStorage-encrypted file.`,
    );
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        `keytar rejected the secret and safeStorage encryption is not available on this platform. ` +
        `Underlying error: ${err?.message ?? String(err)}`,
      );
    }
    await ensureDir();
    const encrypted = safeStorage.encryptString(value);
    await fs.writeFile(pathFor(account), encrypted, { mode: 0o600 });
    // Clear any partial keytar entry so subsequent reads see the fresh file value.
    await keytar.deletePassword(SERVICE, account).catch(() => { /* ignore */ });
    return { via: "safeStorage" };
  }
}

/** Read a secret. keytar first (back-compat), then the safeStorage file. */
export async function getSecret(account: string): Promise<string | null> {
  try {
    const v = await keytar.getPassword(SERVICE, account);
    if (v != null) return v;
  } catch (err: any) {
    log.warn(`[secretStore] keytar.getPassword failed for account=${account}: ${err?.message ?? String(err)}`);
  }
  try {
    const buf = await fs.readFile(pathFor(account));
    if (!safeStorage.isEncryptionAvailable()) {
      log.warn(`[secretStore] safeStorage unavailable; cannot decrypt ${account}`);
      return null;
    }
    return safeStorage.decryptString(buf);
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      log.warn(`[secretStore] file read failed for ${account}: ${err?.message ?? String(err)}`);
    }
    return null;
  }
}

/** Delete a secret from both backends. */
export async function deleteSecret(account: string): Promise<void> {
  await keytar.deletePassword(SERVICE, account).catch(() => { /* ignore */ });
  await fs.unlink(pathFor(account)).catch(() => { /* ignore */ });
}
