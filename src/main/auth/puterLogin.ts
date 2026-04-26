// src/main/auth/puterLogin.ts
//
// Browser-based Puter authentication using the official @heyputer/puter.js
// Node integration. Runs entirely in the Electron main process — bypasses
// every renderer-side blocker (CSP, file:// origin, postMessage, sandboxed
// window.open, popup-blocker policies).
//
// Flow:
//   1. getAuthToken() starts a localhost HTTP server on a random port.
//   2. Opens the user's default browser to
//      https://puter.com/?action=authme&redirectURL=http://localhost:PORT.
//   3. User authenticates (Google / GitHub / username / new account).
//   4. Puter redirects to the localhost URL with ?token=<token>.
//   5. Our server captures it, resolves the promise.
//   6. We init the SDK with that token and fetch the user info.
//
// Reference: https://developer.puter.com/blog/browser-based-auth-puter-js-node/

// The package exposes a CJS entry that uses vm.runInNewContext + readFileSync
// to load dist/puter.cjs. We require it lazily so a missing optional dep
// doesn't crash app boot.
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

let cachedModule: { init: (t?: string) => any; getAuthToken: (origin?: string) => Promise<string> } | null = null;

function loadPuterModule(): { init: (t?: string) => any; getAuthToken: (origin?: string) => Promise<string> } {
  if (cachedModule) return cachedModule;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("@heyputer/puter.js/src/init.cjs");
  if (!mod || typeof mod.getAuthToken !== "function" || typeof mod.init !== "function") {
    throw new Error(
      "@heyputer/puter.js/src/init.cjs missing init/getAuthToken — package may be the wrong version. Run `npm install @heyputer/puter.js@latest --legacy-peer-deps`.",
    );
  }
  cachedModule = mod;
  return mod;
}

/**
 * Run the full browser-based Puter sign-in. Resolves with the token + user
 * once the user completes auth. The localhost server inside getAuthToken
 * stays alive until the redirect arrives — there's no cancel API; if the user
 * closes the browser without finishing, this never resolves.
 *
 * The optional `timeoutMs` arg lets us racing-reject after N seconds so the
 * IPC call can return a useful error to the renderer.
 */
export async function puterLoginViaBrowser(
  timeoutMs: number = 5 * 60 * 1000,
): Promise<PuterLoginResult> {
  const { init, getAuthToken } = loadPuterModule();

  const tokenPromise = getAuthToken("https://puter.com");

  // Race: token | timeout. Don't unref the timer; we want the wait to happen.
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(
      `Puter sign-in timed out after ${Math.round(timeoutMs / 1000)}s. Open Login again to retry.`,
    )), timeoutMs);
  });

  const token = await Promise.race([tokenPromise, timeoutPromise]);
  if (!token || typeof token !== "string") {
    throw new Error("Puter sign-in returned no token (browser closed before auth completed?)");
  }

  // Hydrate the SDK with the token and fetch the canonical user info.
  const puter = init(token);
  if (!puter || !puter.auth || typeof puter.auth.getUser !== "function") {
    throw new Error("Puter SDK initialised but auth.getUser is unavailable.");
  }

  let user: PuterUser;
  try {
    user = await puter.auth.getUser();
  } catch (err: any) {
    throw new Error(`Failed to fetch Puter user after sign-in: ${err?.message ?? String(err)}`);
  }
  if (!user || !user.uuid || !user.username) {
    throw new Error("Puter user record missing uuid/username — sign-in did not complete cleanly.");
  }

  return { token, user };
}
