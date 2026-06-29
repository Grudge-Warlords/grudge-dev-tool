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