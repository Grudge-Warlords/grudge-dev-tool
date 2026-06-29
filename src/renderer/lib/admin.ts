// Renderer-side admin gating for the Grudge Dev Tool.
//
// "Admin" here means: this session is allowed to see / use the elevated
// surfaces of the app (Upload, Forge 3D, Coder, Settings, Preview, etc.).
// It is a UX gate, NOT a security boundary — the actual privileged ops
// (R2 writes, Worker calls, asset-service mutations) are enforced server-
// side by Cloudflare and the backend. We just hide UI from non-admins.
//
// Sources of truth, in order of precedence:
//   1. localStorage["grudge:admin-override"] === "1"   → admin (dev only)
//   2. localStorage["grudge:admin-override"] === "0"   → NOT admin (dev only)
//   3. session.grudgeId in VITE_ADMIN_GRUDGE_IDS       → admin
//   4. session.puterUser.username in VITE_ADMIN_USERNAMES → admin
//   5. neither env var set                             → admin (open mode)
//   6. otherwise                                       → NOT admin
//
// Both env vars are comma-separated. They're injected at build time by Vite,
// so to change the allowlist you set them in .env and rebuild. For dev /
// support sessions, use the localStorage override.

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
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.toLowerCase()),
  );
}

const ADMIN_GRUDGE_IDS = parseList(import.meta.env.VITE_ADMIN_GRUDGE_IDS as string | undefined);
const ADMIN_USERNAMES  = parseList(import.meta.env.VITE_ADMIN_USERNAMES  as string | undefined);

/** True when the build had no allowlist configured at all. */
export function isOpenMode(): boolean {
  return ADMIN_GRUDGE_IDS.size === 0 && ADMIN_USERNAMES.size === 0;
}

/** Compute admin state for a given session. Pure — safe to call anywhere. */
export function isAdmin(session: SessionShape | null): boolean {
  if (!session || !session.signedIn) return false;

  // Dev override always wins (only meaningful in dev builds anyway).
  try {
    const override = localStorage.getItem(OVERRIDE_KEY);
    if (override === "1") return true;
    if (override === "0") return false;
  } catch {
    // localStorage may be unavailable (private mode, exotic sandboxing) — ignore.
  }

  // No allowlist configured → every signed-in user is admin.
  if (isOpenMode()) return true;

  const gid = (session.grudgeId ?? "").toLowerCase();
  if (gid && ADMIN_GRUDGE_IDS.has(gid)) return true;

  const username = (session.puterUser?.username ?? "").toLowerCase();
  if (username && ADMIN_USERNAMES.has(username)) return true;

  return false;
}

/** Convenience for components that already have the session in state. */
export function useAdmin(session: SessionShape | null): boolean {
  return isAdmin(session);
}

/** For settings/dev panels that want to flip the override at runtime. */
export function setAdminOverride(value: "on" | "off" | "clear"): void {
  try {
    if (value === "on")   localStorage.setItem(OVERRIDE_KEY, "1");
    if (value === "off")  localStorage.setItem(OVERRIDE_KEY, "0");
    if (value === "clear") localStorage.removeItem(OVERRIDE_KEY);
  } catch {
    // ignore
  }
}

export function getAdminOverride(): "on" | "off" | "none" {
  try {
    const v = localStorage.getItem(OVERRIDE_KEY);
    if (v === "1") return "on";
    if (v === "0") return "off";
  } catch { /* ignore */ }
  return "none";
}
