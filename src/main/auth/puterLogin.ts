// src/main/auth/puterLogin.ts
//
// Browser-based Puter authentication. Runs in the Electron main process.
//
// Flow:
//   1. getAuthToken() (from @heyputer/puter.js) starts a localhost HTTP server.
//   2. Opens the user's default browser to puter.com with a redirect URL.
//   3. User authenticates, Puter redirects back with ?token=<token>.
//   4. We fetch user info via direct HTTP to avoid the SDK's vm.runInNewContext
//      which silently fails inside Electron's Node.js runtime.

import { net } from "electron";

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

let cachedGetAuthToken: ((origin?: string) => Promise<string>) | null = null;

function loadGetAuthToken(): (origin?: string) => Promise<string> {
  if (cachedGetAuthToken) return cachedGetAuthToken;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("@heyputer/puter.js/src/init.cjs");
  if (!mod || typeof mod.getAuthToken !== "function") {
    throw new Error(
      "@heyputer/puter.js/src/init.cjs missing getAuthToken. Run `npm install @heyputer/puter.js@latest --legacy-peer-deps`.",
    );
  }
  cachedGetAuthToken = mod.getAuthToken;
  return mod.getAuthToken;
}

/**
 * Fetch user info directly from the Puter API using an auth token.
 * This bypasses the SDK's `init()` which uses vm.runInNewContext and
 * breaks silently in Electron's Node.js context.
 */
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
  // Puter may return the user directly or nested under a key
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

/**
 * Run the full browser-based Puter sign-in. Resolves with the token + user
 * once the user completes auth.
 */
export async function puterLoginViaBrowser(
  timeoutMs: number = 5 * 60 * 1000,
): Promise<PuterLoginResult> {
  let log: { info: (...a: any[]) => void; error: (...a: any[]) => void };
  try { log = require("../logger").default; } catch { log = console; }

  log.info("[puterLogin] starting browser-based auth flow");
  const getAuthToken = loadGetAuthToken();

  const tokenPromise = getAuthToken("https://puter.com");
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(
      `Puter sign-in timed out after ${Math.round(timeoutMs / 1000)}s. Open Login again to retry.`,
    )), timeoutMs);
  });

  log.info("[puterLogin] waiting for browser redirect");
  const token = await Promise.race([tokenPromise, timeoutPromise]);
  if (!token || typeof token !== "string") {
    throw new Error("Puter sign-in returned no token (browser closed before auth completed?)");
  }
  log.info(`[puterLogin] token received (${token.length} chars)`);

  // Fetch user via direct HTTP — avoids the SDK's broken vm.runInNewContext.
  log.info("[puterLogin] fetching user via direct API call");
  const user = await fetchPuterUser(token);
  log.info(`[puterLogin] user resolved: uuid=${user.uuid} username=${user.username}`);

  return { token, user };
}
