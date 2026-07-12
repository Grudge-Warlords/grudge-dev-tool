/**
 * Studio module SSO — when Grudge Studio (dev tool) is signed in via Puter,
 * propagate that identity into embedded Forge + Coder webviews.
 *
 * Flow:
 *   1. Puter token + user from secret store
 *   2. POST /api/auth/puter-sso  → Grudge player session JWT (gs_player_session)
 *   3. Set cookie on webview partitions (persist:grudge-forge / grudge-coder)
 *   4. Mint short-lived launch tokens for ?grudge_token= handoff (Forge bridge)
 *   5. Expose module URLs the renderer uses for <webview src>
 */

import { session, net } from "electron";
import log from "../logger";
import * as puterSession from "./puterSession";
import { FLEET_URLS, STUDIO_MODULE_URLS } from "../../shared/fleet";

const IDENTITY_API = (process.env.GRUDGE_IDENTITY_API || FLEET_URLS.identityApi).replace(/\/$/, "");

/** Webview partitions used by Studio modules (must match renderer). */
export const STUDIO_PARTITIONS = {
  forge: "persist:grudge-forge",
  coder: "persist:grudge-coder",
} as const;

export type StudioModuleId = keyof typeof STUDIO_PARTITIONS;

export interface StudioSsoState {
  ok: boolean;
  syncedAt: number | null;
  player: {
    id: number;
    username: string;
    grudgeId: string;
    displayName?: string | null;
  } | null;
  /** Session token for cookie injection (not a launch token). */
  hasSessionToken: boolean;
  forgeUrl: string;
  coderUrl: string;
  forgeEditorUrl: string;
  error?: string | null;
}

let lastState: StudioSsoState = emptyState();
let cachedSessionToken: string | null = null;
let cachedPlayer: StudioSsoState["player"] = null;

function emptyState(error?: string): StudioSsoState {
  return {
    ok: false,
    syncedAt: null,
    player: null,
    hasSessionToken: false,
    forgeUrl: STUDIO_MODULE_URLS.forge,
    coderUrl: STUDIO_MODULE_URLS.coder,
    forgeEditorUrl: STUDIO_MODULE_URLS.forgeEditor,
    error: error ?? null,
  };
}

function withToken(url: string, launchToken: string | null): string {
  if (!launchToken) return url;
  const u = new URL(url);
  u.searchParams.set("grudge_token", launchToken);
  u.searchParams.set("auth", "studio-sso");
  return u.toString();
}

function jsonRequest(
  method: string,
  url: string,
  body?: unknown,
  bearer?: string | null,
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = body != null ? JSON.stringify(body) : null;
    const req = net.request({ method, url });
    req.setHeader("Accept", "application/json");
    req.setHeader("Content-Type", "application/json");
    if (bearer) req.setHeader("Authorization", `Bearer ${bearer}`);
    // Electron net from desktop app — Origin helps allowlists
    req.setHeader("Origin", "https://grudge-studio.com");

    const chunks: Buffer[] = [];
    req.on("response", (res) => {
      res.on("data", (c) => chunks.push(Buffer.from(c)));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let data: any = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          data = { raw: raw.slice(0, 200) };
        }
        resolve({ status: res.statusCode ?? 0, data });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function puterSso(
  puterId: string,
  puterUsername: string,
  email?: string,
): Promise<{ player: NonNullable<StudioSsoState["player"]>; token: string }> {
  const { status, data } = await jsonRequest("POST", `${IDENTITY_API}/api/auth/puter-sso`, {
    puterId,
    puterUsername,
    email: email || undefined,
  });
  if (status < 200 || status >= 300 || !data?.token || !data?.grudgeId) {
    throw new Error(data?.error || `puter-sso failed (HTTP ${status})`);
  }
  return {
    token: String(data.token),
    player: {
      id: Number(data.id),
      username: String(data.username),
      grudgeId: String(data.grudgeId),
      displayName: data.displayName ?? null,
    },
  };
}

async function mintLaunchToken(sessionToken: string, audience: string): Promise<string | null> {
  try {
    const { status, data } = await jsonRequest(
      "POST",
      `${IDENTITY_API}/api/auth/popup-token`,
      { audience },
      sessionToken,
    );
    if (status >= 200 && status < 300 && data?.token) return String(data.token);
    log.warn(`[studio-sso] popup-token ${status}`, data?.error || "");
    return null;
  } catch (err: any) {
    log.warn("[studio-sso] popup-token failed", err?.message || err);
    return null;
  }
}

async function setPartitionCookie(partition: string, sessionToken: string): Promise<void> {
  const ses =
    !partition || partition === "default"
      ? session.defaultSession
      : session.fromPartition(partition);
  const value = encodeURIComponent(sessionToken);
  const expiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 12; // ~12d

  const hosts = [
    "https://grudge-studio.com/",
    "https://forge.grudge-studio.com/",
    "https://coder.grudge-studio.com/",
    "https://id.grudge-studio.com/",
    "https://character.grudge-studio.com/",
    "https://play.grudge.studio/",
  ];

  // Apex cookie with Domain=.grudge-studio.com
  try {
    await ses.cookies.set({
      url: "https://grudge-studio.com/",
      name: "gs_player_session",
      value,
      domain: ".grudge-studio.com",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "no_restriction",
      expirationDate: expiry,
    });
  } catch (err: any) {
    log.warn(`[studio-sso] apex cookie failed: ${err?.message || err}`);
  }

  // Host-scoped cookies (more reliable for some Chromium partition cases)
  for (const url of hosts) {
    try {
      await ses.cookies.set({
        url,
        name: "gs_player_session",
        value,
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "no_restriction",
        expirationDate: expiry,
      });
    } catch { /* non-fatal per host */ }
  }
}

async function clearPartitionCookie(partition: string): Promise<void> {
  const ses = session.fromPartition(partition);
  try {
    await ses.cookies.remove("https://grudge-studio.com/", "gs_player_session");
  } catch { /* */ }
  try {
    await ses.cookies.remove("https://forge.grudge-studio.com/", "gs_player_session");
  } catch { /* */ }
  try {
    await ses.cookies.remove("https://coder.grudge-studio.com/", "gs_player_session");
  } catch { /* */ }
}

/**
 * Full SSO sync: Puter session → Grudge account → cookies + launch URLs.
 * Safe to call repeatedly; no-ops when not signed in.
 */
export async function syncStudioSso(): Promise<StudioSsoState> {
  const sess = await puterSession.getSession();
  const puterToken = await puterSession.getPuterToken();

  if (!sess.signedIn || !sess.puterUser || !puterToken) {
    lastState = emptyState("Not signed in");
    cachedSessionToken = null;
    cachedPlayer = null;
    return lastState;
  }

  try {
    const { player, token } = await puterSso(
      sess.puterUser.uuid,
      sess.puterUser.username,
      sess.puterUser.email,
    );
    cachedSessionToken = token;
    cachedPlayer = player;

    // Seed every Studio module partition + defaultSession so embedded
    // webviews and in-app BrowserViews all see the same Grudge session.
    await Promise.all([
      setPartitionCookie(STUDIO_PARTITIONS.forge, token),
      setPartitionCookie(STUDIO_PARTITIONS.coder, token),
      setPartitionCookie("persist:grudge-preview", token),
      setPartitionCookie("persist:grudge-browser", token).catch(() => undefined),
    ]);
    // defaultSession for any window that doesn't use a partition
    try {
      await setPartitionCookie("" as string, token);
    } catch {
      try {
        const ses = session.defaultSession;
        const value = encodeURIComponent(token);
        const expiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 12;
        await ses.cookies.set({
          url: "https://forge.grudge-studio.com/",
          name: "gs_player_session",
          value,
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "no_restriction",
          expirationDate: expiry,
        });
        await ses.cookies.set({
          url: "https://coder.grudge-studio.com/",
          name: "gs_player_session",
          value,
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "no_restriction",
          expirationDate: expiry,
        });
      } catch { /* non-fatal */ }
    }

    const forgeAudience = new URL(STUDIO_MODULE_URLS.forge).origin;
    const coderAudience = new URL(STUDIO_MODULE_URLS.coder).origin;
    const idAudience = "https://id.grudge-studio.com";
    const [forgeLaunch, coderLaunch] = await Promise.all([
      mintLaunchToken(token, forgeAudience),
      mintLaunchToken(token, coderAudience),
    ]);
    // Also try minting with session token as fallback launch token when
    // popup-token API is unavailable — Forge exchange may still accept
    // full session JWTs depending on identity service version.
    const forgeTok = forgeLaunch || token;
    const coderTok = coderLaunch || token;

    lastState = {
      ok: true,
      syncedAt: Date.now(),
      player,
      hasSessionToken: true,
      forgeUrl: withToken(STUDIO_MODULE_URLS.forge, forgeTok),
      forgeEditorUrl: withToken(STUDIO_MODULE_URLS.forgeEditor, forgeTok),
      coderUrl: withToken(STUDIO_MODULE_URLS.coder, coderTok),
      error: null,
    };
    void idAudience; // reserved for future id.grudge-studio.com embeds
    log.info(
      `[studio-sso] synced grudgeId=${player.grudgeId} username=${player.username} forgeLaunch=${!!forgeLaunch} coderLaunch=${!!coderLaunch}`,
    );
    return lastState;
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    log.error("[studio-sso] sync failed:", msg);
    lastState = emptyState(msg);
    return lastState;
  }
}

export function getStudioSsoState(): StudioSsoState {
  return lastState;
}

/** Puter access token for inject into module webviews (localStorage). */
export async function getPuterTokenForModules(): Promise<string | null> {
  return puterSession.getPuterToken();
}

/**
 * Payload for embedding Studio login into Forge/Coder webviews.
 * Renderer injects this into the webview before/after load so users are
 * not asked to sign in again inside each module.
 */
export interface ModuleAuthBundle {
  puterToken: string | null;
  puterUser: puterSession.PuterUser | null;
  grudgeSessionToken: string | null;
  player: StudioSsoState["player"];
  /** URLs with ?grudge_token= for first navigation */
  forgeEditorUrl: string;
  coderUrl: string;
  forgeUrl: string;
}

export async function getModuleAuthBundle(): Promise<ModuleAuthBundle> {
  // Refresh if we have Puter but no Grudge session yet
  if (!cachedSessionToken || !cachedPlayer) {
    const s = await syncStudioSso();
    if (!s.ok) {
      const puterToken = await puterSession.getPuterToken();
      const sess = await puterSession.getSession();
      return {
        puterToken,
        puterUser: sess.puterUser,
        grudgeSessionToken: null,
        player: null,
        forgeEditorUrl: STUDIO_MODULE_URLS.forgeEditor,
        coderUrl: STUDIO_MODULE_URLS.coder,
        forgeUrl: STUDIO_MODULE_URLS.forge,
      };
    }
  }
  const puterToken = await puterSession.getPuterToken();
  const sess = await puterSession.getSession();
  return {
    puterToken,
    puterUser: sess.puterUser,
    grudgeSessionToken: cachedSessionToken,
    player: cachedPlayer,
    forgeEditorUrl: lastState.forgeEditorUrl,
    coderUrl: lastState.coderUrl,
    forgeUrl: lastState.forgeUrl,
  };
}

export async function clearStudioSso(): Promise<void> {
  cachedSessionToken = null;
  cachedPlayer = null;
  await Promise.all([
    clearPartitionCookie(STUDIO_PARTITIONS.forge),
    clearPartitionCookie(STUDIO_PARTITIONS.coder),
    clearPartitionCookie("persist:grudge-preview"),
  ]);
  lastState = emptyState("Signed out");
}

/** Ensure forge partition is included in cache-clear lists. */
export function listStudioPartitions(): string[] {
  return Object.values(STUDIO_PARTITIONS);
}
