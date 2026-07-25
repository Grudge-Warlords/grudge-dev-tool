/**
 * Canonical Grudge Studio Forge admin allowlist (Steam-style dev/admin operators).
 * Everyone else is a customer. UX gate only — backend enforces real permissions.
 */
export const CANONICAL_ADMIN_USERNAMES = [
  "grudachain",
  "molochdadev",
] as const;

export const CANONICAL_ADMIN_EMAILS = [
  "grudgedev@gmail.com",
  "jonbemmons@gmail.com",
] as const;

export type AdminRole = "admin" | "customer";

export function normalizeAdminToken(value: string): string {
  return value.trim().toLowerCase();
}

const ADMIN_USERNAME_SET = new Set(
  CANONICAL_ADMIN_USERNAMES.map((u) => normalizeAdminToken(u)),
);
const ADMIN_EMAIL_SET = new Set(
  CANONICAL_ADMIN_EMAILS.map((e) => normalizeAdminToken(e)),
);

/**
 * Main-process + renderer safe admin check against the canonical allowlist.
 * Used to auto-plug GRUDACHAIN Ollama / agentic systems on sign-in.
 */
export function isCanonicalAdmin(user: {
  username?: string | null;
  email?: string | null;
} | null | undefined): boolean {
  if (!user) return false;
  const username = normalizeAdminToken(user.username ?? "");
  if (username && ADMIN_USERNAME_SET.has(username)) return true;
  const email = normalizeAdminToken(user.email ?? "");
  if (email && ADMIN_EMAIL_SET.has(email)) return true;
  return false;
}