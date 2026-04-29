import { createHash } from "node:crypto";
import log from "../logger";
import { setSecret, getSecret, deleteSecret } from "./secretStore";

const ACCOUNT_TOKEN = "puter-token";
const ACCOUNT_USER  = "puter-user";   // JSON stringified
const ACCOUNT_GID   = "grudge-id";

export interface PuterUser {
  uuid: string;
  username: string;
  email?: string;
  email_verified?: boolean;
}

export interface GrudgeSession {
  signedIn: boolean;
  grudgeId: string | null;
  puterUser: PuterUser | null;
  hasToken: boolean;
}

/**
 * Deterministic Grudge ID derived from the Puter UUID.
 * Format: grudge-<8-char-sha1-prefix>-<base36 ms timestamp>
 * Same Puter UUID + same first-seen-at always produces the same Grudge ID.
 */
export function deriveGrudgeId(puterUuid: string, firstSeenAtMs: number): string {
  const h = createHash("sha1").update(puterUuid).digest("hex").slice(0, 8);
  const t = firstSeenAtMs.toString(36);
  return `grudge-${h}-${t}`;
}

export async function setSession(puterToken: string, user: PuterUser): Promise<{ grudgeId: string }> {
  log.info(`[auth] setSession: tokenChars=${puterToken.length} userUuid=${user.uuid} username=${user.username}`);

  // Reuse existing Grudge ID if one was minted before for this user.
  const existingRaw = await getSecret(ACCOUNT_GID);
  let grudgeId: string;
  if (existingRaw) {
    try {
      const parsed = JSON.parse(existingRaw) as { grudgeId: string; puterUuid: string };
      grudgeId = parsed.puterUuid === user.uuid
        ? parsed.grudgeId
        : deriveGrudgeId(user.uuid, Date.now());
    } catch { grudgeId = deriveGrudgeId(user.uuid, Date.now()); }
  } else {
    grudgeId = deriveGrudgeId(user.uuid, Date.now());
  }

  // Use the hybrid secret store — keytar first, with safeStorage-encrypted
  // file fallback for values that exceed the Win32 Credential Manager 2.5 KB
  // limit. Modern Puter tokens are JWTs that routinely exceed that, which is
  // what was producing the "The stub received bad data" sign-in failure on
  // v0.3.0 and earlier.
  const tokenStore = await setSecret(ACCOUNT_TOKEN, puterToken);
  const userStore  = await setSecret(ACCOUNT_USER,  JSON.stringify(user));
  const gidStore   = await setSecret(ACCOUNT_GID,   JSON.stringify({ grudgeId, puterUuid: user.uuid, firstSeenAt: Date.now() }));
  log.info(`[auth] setSession persisted: token=${tokenStore.via} user=${userStore.via} gid=${gidStore.via}`);
  return { grudgeId };
}

export async function getSession(): Promise<GrudgeSession> {
  const token = await getSecret(ACCOUNT_TOKEN);
  const userRaw = await getSecret(ACCOUNT_USER);
  const gidRaw  = await getSecret(ACCOUNT_GID);
  if (!token || !userRaw) {
    return { signedIn: false, grudgeId: null, puterUser: null, hasToken: false };
  }
  let puterUser: PuterUser | null = null;
  try { puterUser = JSON.parse(userRaw); } catch { /* ignore */ }
  let grudgeId: string | null = null;
  try { grudgeId = gidRaw ? (JSON.parse(gidRaw) as { grudgeId: string }).grudgeId : null; } catch { grudgeId = null; }
  return { signedIn: true, grudgeId, puterUser, hasToken: true };
}

export async function getPuterToken(): Promise<string | null> {
  return getSecret(ACCOUNT_TOKEN);
}

export async function clearSession(): Promise<void> {
  await deleteSecret(ACCOUNT_TOKEN);
  await deleteSecret(ACCOUNT_USER);
  // Keep the Grudge ID across sign-outs so the user can sign back in and
  // recover the same identity. Pass `wipeIdentity=true` to nuke it.
}

export async function wipeIdentity(): Promise<void> {
  await clearSession();
  await deleteSecret(ACCOUNT_GID);
}
