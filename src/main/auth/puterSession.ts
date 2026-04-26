import keytar from "keytar";
import { createHash } from "node:crypto";

const SERVICE = "grudge-dev-tool";
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
  // Reuse existing Grudge ID if one was minted before for this user.
  const existingRaw = await keytar.getPassword(SERVICE, ACCOUNT_GID);
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

  await keytar.setPassword(SERVICE, ACCOUNT_TOKEN, puterToken);
  await keytar.setPassword(SERVICE, ACCOUNT_USER,  JSON.stringify(user));
  await keytar.setPassword(SERVICE, ACCOUNT_GID,   JSON.stringify({ grudgeId, puterUuid: user.uuid, firstSeenAt: Date.now() }));
  return { grudgeId };
}

export async function getSession(): Promise<GrudgeSession> {
  const token = await keytar.getPassword(SERVICE, ACCOUNT_TOKEN);
  const userRaw = await keytar.getPassword(SERVICE, ACCOUNT_USER);
  const gidRaw  = await keytar.getPassword(SERVICE, ACCOUNT_GID);
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
  return keytar.getPassword(SERVICE, ACCOUNT_TOKEN);
}

export async function clearSession(): Promise<void> {
  await keytar.deletePassword(SERVICE, ACCOUNT_TOKEN);
  await keytar.deletePassword(SERVICE, ACCOUNT_USER);
  // Keep the Grudge ID across sign-outs so the user can sign back in and
  // recover the same identity. Pass `wipeIdentity=true` to nuke it.
}

export async function wipeIdentity(): Promise<void> {
  await clearSession();
  await keytar.deletePassword(SERVICE, ACCOUNT_GID);
}
