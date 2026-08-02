/**
 * Single-login handoff for Grudge Dev Tool → fleet web surfaces.
 * Desktop Puter/Grudge session is the authority; webviews receive the same tokens
 * via URL params + localStorage injection (see renderer/lib/webviewSession.ts).
 */

/** Fleet clients read these keys (see grudge-production-wiring). */
export const FLEET_AUTH_TOKEN_KEYS = [
  "grudge_auth_token",
  "grudge_session_token",
  "grudge.token",
  "sso_token",
  "puter_auth_token",
] as const;

export const FLEET_AUTH_ID_KEYS = [
  "grudge_account_id",
  "grudge_id",
  "grudgeId",
] as const;

export interface FleetHandoffPayload {
  /** Puter auth token (desktop session) and/or optional fleet API bearer */
  token: string | null;
  grudgeId: string | null;
  username: string | null;
  email: string | null;
  puterUuid: string | null;
  /** true when desktop session is signed in */
  signedIn: boolean;
}

export interface EmbedAuthOptions {
  /** Production host to load */
  baseUrl: string;
  grudgeId?: string | null;
  username?: string | null;
  /** Prefer edit/play query already on URL */
  keepQuery?: boolean;
  extraParams?: Record<string, string>;
}

/**
 * Append standard handoff query params without wiping existing deep-links.
 * Does **not** put the raw token in the URL (security) — injection handles that.
 */
export function buildEmbedUrl(opts: EmbedAuthOptions): string {
  let u: URL;
  try {
    u = new URL(opts.baseUrl);
  } catch {
    return opts.baseUrl;
  }
  u.searchParams.set("from", "grudge-dev-tool");
  u.searchParams.set("embed", "1");
  if (opts.grudgeId) u.searchParams.set("grudgeId", opts.grudgeId);
  if (opts.username) u.searchParams.set("username", opts.username);
  if (opts.extraParams) {
    for (const [k, v] of Object.entries(opts.extraParams)) {
      if (v != null && v !== "") u.searchParams.set(k, v);
    }
  }
  return u.toString();
}

/** id.grudge-studio.com login that returns to a fleet surface after SSO. */
export function buildIdLoginUrl(returnTo: string, idBase = "https://id.grudge-studio.com"): string {
  const u = new URL("/login", idBase);
  u.searchParams.set("redirect_uri", returnTo);
  u.searchParams.set("from", "grudge-dev-tool");
  return u.toString();
}
