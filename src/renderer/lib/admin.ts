import {
  CANONICAL_ADMIN_EMAILS,
  CANONICAL_ADMIN_USERNAMES,
  normalizeAdminToken,
} from "../../shared/adminAllowlist";

interface SessionShape {
  signedIn: boolean;
  grudgeId: string | null;
  puterUser: { uuid: string; username: string; email?: string } | null;
  hasToken: boolean;
}

const OVERRIDE_KEY = "grudge:admin-override";

function parseList(raw: string | undefined | null): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => normalizeAdminToken(s))
      .filter(Boolean),
  );
}

const ENV_USERNAMES = parseList(import.meta.env.VITE_ADMIN_USERNAMES as string | undefined);
const ENV_EMAILS = parseList(import.meta.env.VITE_ADMIN_EMAILS as string | undefined);
const ENV_GRUDGE_IDS = parseList(import.meta.env.VITE_ADMIN_GRUDGE_IDS as string | undefined);

const ADMIN_USERNAMES = ENV_USERNAMES.size > 0
  ? ENV_USERNAMES
  : new Set(CANONICAL_ADMIN_USERNAMES.map(normalizeAdminToken));

const ADMIN_EMAILS = ENV_EMAILS.size > 0
  ? ENV_EMAILS
  : new Set(CANONICAL_ADMIN_EMAILS.map(normalizeAdminToken));

const ADMIN_GRUDGE_IDS = ENV_GRUDGE_IDS;

/** Dev-only escape hatch — never set in production builds. */
export function isOpenMode(): boolean {
  return import.meta.env.VITE_OPEN_ADMIN_MODE === "true";
}

export function getAdminRole(session: SessionShape | null): "admin" | "customer" | "guest" {
  if (!session?.signedIn) return "guest";
  return isAdmin(session) ? "admin" : "customer";
}

export function isAdmin(session: SessionShape | null): boolean {
  if (!session || !session.signedIn) return false;

  try {
    const override = localStorage.getItem(OVERRIDE_KEY);
    if (override === "1") return true;
    if (override === "0") return false;
  } catch { /* ignore */ }

  if (isOpenMode()) return true;

  const gid = normalizeAdminToken(session.grudgeId ?? "");
  if (gid && ADMIN_GRUDGE_IDS.has(gid)) return true;

  const username = normalizeAdminToken(session.puterUser?.username ?? "");
  if (username && ADMIN_USERNAMES.has(username)) return true;

  const email = normalizeAdminToken(session.puterUser?.email ?? "");
  if (email && ADMIN_EMAILS.has(email)) return true;

  return false;
}

export function useAdmin(session: SessionShape | null): boolean {
  return isAdmin(session);
}

export function setAdminOverride(value: "on" | "off" | "clear"): void {
  try {
    if (value === "on") localStorage.setItem(OVERRIDE_KEY, "1");
    if (value === "off") localStorage.setItem(OVERRIDE_KEY, "0");
    if (value === "clear") localStorage.removeItem(OVERRIDE_KEY);
  } catch { /* ignore */ }
}

export function getAdminOverride(): "on" | "off" | "none" {
  try {
    const v = localStorage.getItem(OVERRIDE_KEY);
    if (v === "1") return "on";
    if (v === "0") return "off";
  } catch { /* ignore */ }
  return "none";
}