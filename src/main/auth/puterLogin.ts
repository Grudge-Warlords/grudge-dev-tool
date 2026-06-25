// Browser-based Puter authentication in the Electron main process.
//
// Puter's official getAuthToken() opens the *system* browser and waits for a
// redirect to http://127.0.0.1:<port>?token=… . On Windows that incoming
// connection is often blocked by the firewall ("stuck on signing in…").
//
// We run the same OAuth URL inside an in-app BrowserWindow instead. Chromium
// navigates to the loopback callback in-process — no firewall prompt — then we
// capture the token from the redirect URL.

import http from "node:http";
import { BrowserWindow, net, shell } from "electron";

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
</head><body><div><h1>Authentication successful</h1><p>You can close this window.</p></div></body></html>`;

function isPuterHost(hostname: string): boolean {
  return hostname === "puter.com" || /\.puter\.(com|site)$/i.test(hostname);
}

function tokenFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!CALLBACK_HOSTS.has(u.hostname)) return null;
    return u.searchParams.get("token");
  } catch {
    return null;
  }
}

async function fetchPuterUser(token: string): Promise<PuterUser> {
  const res = await net.fetch("https://api.puter.com/auth/user", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Puter API /auth/user returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json() as any;
  const user = data?.user ?? data;
  if (!user?.uuid || !user?.username) {
    throw new Error(`Puter user response missing uuid/username: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return {
    uuid: user.uuid,
    username: user.username,
    email: user.email ?? undefined,
    email_verified: user.email_verified ?? undefined,
  };
}

function startCallbackServer(onToken: (token: string) => void, onError: (err: Error) => void): http.Server {
  const server = http.createServer((req, res) => {
    const token = tokenFromUrl(`http://127.0.0.1${req.url ?? "/"}`);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(SUCCESS_HTML);
    if (token) onToken(token);
    else onError(new Error("Puter redirect reached localhost but no token was present."));
  });
  server.on("error", (err) => {
    onError(new Error(
      `Local auth callback server failed (${err.message}). ` +
      "If Windows Firewall blocked Node.js, allow Grudge Studio Forge on private networks, or use manual token sign-in.",
    ));
  });
  return server;
}

function createAuthWindow(authUrl: string, onToken: (token: string) => void, onClosed: () => void): BrowserWindow {
  const win = new BrowserWindow({
    width: 520,
    height: 740,
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

  win.webContents.on("will-navigate", (event, url) => {
    try {
      const u = new URL(url);
      if (CALLBACK_HOSTS.has(u.hostname)) {
        event.preventDefault();
        tryCapture(url);
        return;
      }
      if (!isPuterHost(u.hostname)) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  win.webContents.on("will-redirect", (_event, url) => {
    tryCapture(url);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (isPuterHost(u.hostname)) {
        win.loadURL(url);
        return { action: "deny" };
      }
      if (u.protocol === "https:" || u.protocol === "http:") shell.openExternal(url);
    } catch { /* ignore */ }
    return { action: "deny" };
  });

  win.on("closed", onClosed);
  void win.loadURL(authUrl);
  return win;
}

/**
 * Run Puter sign-in inside an in-app window (avoids Windows Firewall blocking
 * the external-browser → localhost callback).
 */
export async function puterLoginViaBrowser(
  timeoutMs: number = 5 * 60 * 1000,
): Promise<PuterLoginResult> {
  let log: { info: (...a: any[]) => void; error: (...a: any[]) => void };
  try { log = require("../logger").default; } catch { log = console; }

  return new Promise((resolve, reject) => {
    let settled = false;
    let authWin: BrowserWindow | null = null;
    let server: http.Server | null = null;

    const cleanup = () => {
      try { server?.close(); } catch { /* ignore */ }
      server = null;
      if (authWin && !authWin.isDestroyed()) authWin.close();
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
      if (settled) return;
      if (!token.trim()) {
        fail(new Error("Puter sign-in returned an empty token."));
        return;
      }
      try {
        log.info(`[puterLogin] token received (${token.length} chars), fetching user`);
        const user = await fetchPuterUser(token);
        log.info(`[puterLogin] user resolved: uuid=${user.uuid} username=${user.username}`);
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve({ token, user });
      } catch (e: unknown) {
        fail(e instanceof Error ? e : new Error(String(e)));
      }
    };

    const timer = setTimeout(() => {
      fail(new Error(
        `Puter sign-in timed out after ${Math.round(timeoutMs / 1000)}s. ` +
        "Complete sign-in in the Puter window, or use manual token paste on the Login screen.",
      ));
    }, timeoutMs);

    server = startCallbackServer(
      (token) => { void succeed(token); },
      (err) => fail(err),
    );

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

      authWin = createAuthWindow(
        authUrl,
        (token) => { void succeed(token); },
        () => {
          if (!settled) {
            fail(new Error("Sign-in window closed before authentication completed."));
          }
        },
      );
    });
  });
}