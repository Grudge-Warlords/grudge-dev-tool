// Puter OAuth in Electron main process.
//
// v0.5.1 blocked Google/GitHub sign-in by calling preventDefault() on every
// non-puter.com navigation. OAuth providers must be allowed through.

import http from "node:http";
import { BrowserWindow, net } from "electron";

type PuterUser = {
  uuid: string;
  username: string;
  email?: string;
  email_verified?: boolean;
};

export interface PuterLoginResult {
  token: string;
  user: PuterUser;
}

const PUTER_GUI_ORIGIN = "https://puter.com";
const CALLBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

const SUCCESS_HTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Signed in</title>
<style>body{font-family:system-ui;background:#0c1334;color:#ffc62a;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:24px}</style>
</head><body><div><h1>Authentication successful</h1><p>Return to Grudge Studio Forge.</p></div></body></html>`;

function isPuterHost(hostname: string): boolean {
  return hostname === "puter.com" || /\.puter\.(com|site)$/i.test(hostname);
}

/** Allow OAuth IdPs and Puter during the auth window navigation. */
function isAllowedAuthHost(hostname: string): boolean {
  if (CALLBACK_HOSTS.has(hostname)) return true;
  if (isPuterHost(hostname)) return true;
  const h = hostname.toLowerCase();
  return (
    h === "accounts.google.com" ||
    h.endsWith(".google.com") ||
    h === "github.com" ||
    h === "api.github.com" ||
    h.endsWith(".github.com") ||
    h === "login.microsoftonline.com" ||
    h.endsWith(".live.com") ||
    h === "appleid.apple.com" ||
    h.endsWith(".apple.com")
  );
}

function tokenFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!CALLBACK_HOSTS.has(u.hostname)) return null;
    const fromQuery = u.searchParams.get("token");
    if (fromQuery) return fromQuery;
    // Some flows use hash fragments.
    if (u.hash) {
      const hash = u.hash.startsWith("#") ? u.hash.slice(1) : u.hash;
      const params = new URLSearchParams(hash);
      const fromHash = params.get("token");
      if (fromHash) return fromHash;
    }
    return null;
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const json = Buffer.from(b64 + pad, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function userFromJwt(token: string): PuterUser | null {
  const p = decodeJwtPayload(token);
  if (!p) return null;
  const uuid = String(p.uuid ?? p.sub ?? p.user_id ?? p.userId ?? "").trim();
  const username = String(p.username ?? p.name ?? p.preferred_username ?? p.user ?? "").trim();
  if (!uuid || !username) return null;
  return {
    uuid,
    username,
    email: typeof p.email === "string" ? p.email : undefined,
    email_verified: typeof p.email_verified === "boolean"
      ? p.email_verified
      : typeof p.email_confirmed === "boolean"
        ? p.email_confirmed
        : undefined,
  };
}

function normalizeWhoami(data: any): PuterUser | null {
  const user = data?.user ?? data?.result ?? data;
  if (!user?.uuid || !user?.username) return null;
  return {
    uuid: String(user.uuid),
    username: String(user.username),
    email: user.email ?? undefined,
    email_verified: user.email_verified ?? user.email_confirmed ?? undefined,
  };
}

async function fetchWhoami(token: string, headerStyle: "bearer" | "token" | "puter"): Promise<PuterUser | null> {
  let authHeader: string;
  switch (headerStyle) {
    case "bearer":
      authHeader = `Bearer ${token}`;
      break;
    case "token":
      authHeader = token;
      break;
    case "puter":
      authHeader = `puter ${token}`;
      break;
  }
  const res = await net.fetch("https://api.puter.com/whoami", {
    method: "GET",
    headers: { Authorization: authHeader, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return normalizeWhoami(data);
}

/** Resolve Puter user from an auth token (whoami, then JWT fallback). */
export async function resolvePuterUserFromToken(token: string): Promise<PuterUser> {
  for (const style of ["bearer", "token", "puter"] as const) {
    try {
      const user = await fetchWhoami(token, style);
      if (user) return user;
    } catch { /* try next */ }
  }
  const fromJwt = userFromJwt(token);
  if (fromJwt) return fromJwt;
  throw new Error(
    "Could not resolve Puter user from token (whoami failed and JWT had no uuid/username). " +
    "Use manual sign-in with token + uuid + username from puter.com/?show_token=1",
  );
}

function startCallbackServer(onToken: (token: string) => void): http.Server {
  const server = http.createServer((req, res) => {
    const token = tokenFromUrl(`http://127.0.0.1${req.url ?? "/"}`);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(SUCCESS_HTML);
    if (token) onToken(token);
  });
  return server;
}

function createAuthWindow(authUrl: string, onToken: (token: string) => void): BrowserWindow {
  const win = new BrowserWindow({
    width: 560,
    height: 780,
    center: true,
    autoHideMenuBar: true,
    title: "Sign in to Puter — Grudge Studio",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const tryCapture = (url: string) => {
    const token = tokenFromUrl(url);
    if (token) onToken(token);
  };

  const onNav = (_event: Electron.Event, url: string) => {
    tryCapture(url);
  };

  win.webContents.on("will-navigate", (event, url) => {
    try {
      const u = new URL(url);
      if (CALLBACK_HOSTS.has(u.hostname)) {
        event.preventDefault();
        tryCapture(url);
        return;
      }
      if (u.protocol !== "https:" && u.protocol !== "http:") {
        event.preventDefault();
        return;
      }
      if (!isAllowedAuthHost(u.hostname)) {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });

  win.webContents.on("will-redirect", onNav);
  win.webContents.on("did-navigate", onNav);
  win.webContents.on("did-navigate-in-page", onNav);

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === "https:" || u.protocol === "http:") {
        void win.loadURL(url);
      }
    } catch { /* ignore */ }
    return { action: "deny" };
  });

  void win.loadURL(authUrl);
  return win;
}

/** Official Puter.js flow — system browser + localhost callback (firewall may prompt once). */
export async function puterLoginViaExternalBrowser(timeoutMs = 5 * 60 * 1000): Promise<PuterLoginResult> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("@heyputer/puter.js/src/init.cjs");
  if (!mod?.getAuthToken) throw new Error("Puter getAuthToken unavailable");
  const token = await Promise.race([
    mod.getAuthToken("https://puter.com"),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Browser sign-in timed out")), timeoutMs);
    }),
  ]);
  if (!token || typeof token !== "string") throw new Error("Puter browser sign-in returned no token");
  const user = await resolvePuterUserFromToken(token);
  return { token, user };
}

export async function puterLoginViaBrowser(timeoutMs = 5 * 60 * 1000): Promise<PuterLoginResult> {
  let log: { info: (...a: any[]) => void; error: (...a: any[]) => void };
  try { log = require("../logger").default; } catch { log = console; }

  return new Promise((resolve, reject) => {
    let settled = false;
    let authWin: BrowserWindow | null = null;
    let server: http.Server | null = null;
    let completing = false;

    const cleanup = () => {
      try { server?.close(); } catch { /* ignore */ }
      server = null;
      if (authWin && !authWin.isDestroyed()) authWin.destroy();
      authWin = null;
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      log.error("[puterLogin] failed:", err.message);
      reject(err);
    };

    const succeed = async (token: string) => {
      if (settled || completing) return;
      if (!token.trim()) return;
      completing = true;
      try {
        log.info(`[puterLogin] token received (${token.length} chars), resolving user`);
        const user = await resolvePuterUserFromToken(token);
        log.info(`[puterLogin] user resolved: uuid=${user.uuid} username=${user.username}`);
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve({ token, user });
      } catch (e: unknown) {
        completing = false;
        fail(e instanceof Error ? e : new Error(String(e)));
      }
    };

    const timer = setTimeout(() => {
      fail(new Error(
        `Puter sign-in timed out after ${Math.round(timeoutMs / 1000)}s. ` +
        "Try again, use “Sign in with system browser”, or paste a token manually.",
      ));
    }, timeoutMs);

    server = startCallbackServer((token) => { void succeed(token); });
    server.on("error", (err) => {
      fail(new Error(`Local auth callback failed: ${err.message}`));
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server!.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      if (!port) {
        fail(new Error("Could not bind local auth callback port."));
        return;
      }
      const redirectURL = encodeURIComponent(`http://127.0.0.1:${port}`);
      const authUrl = `${PUTER_GUI_ORIGIN}/?action=authme&redirectURL=${redirectURL}`;
      log.info(`[puterLogin] opening in-app auth window (callback 127.0.0.1:${port})`);

      authWin = createAuthWindow(authUrl, (token) => { void succeed(token); });
      authWin.on("closed", () => {
        if (!settled && !completing) {
          fail(new Error(
            "Sign-in window closed before authentication completed. " +
            "If you used Google/GitHub, try again or use “Sign in with system browser”.",
          ));
        }
      });
    });
  });
}

/** In-app first; fall back to system browser if user preference or retry. */
export async function puterLoginAuto(opts?: { external?: boolean }): Promise<PuterLoginResult> {
  if (opts?.external) return puterLoginViaExternalBrowser();
  try {
    return await puterLoginViaBrowser();
  } catch (inAppErr) {
    let log: { warn: (...a: any[]) => void };
    try { log = require("../logger").default; } catch { log = console; }
    log.warn("[puterLogin] in-app failed, trying system browser:", (inAppErr as Error)?.message);
    return puterLoginViaExternalBrowser();
  }
}