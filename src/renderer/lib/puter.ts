// Lazy-loads the Puter SDK from https://js.puter.com/v2/ on first use.
// Returns the global `puter` object once it's available.

declare global {
  interface Window {
    puter?: any;
  }
}

let loadingPromise: Promise<any> | null = null;

export function loadPuter(): Promise<any> {
  if (window.puter) return Promise.resolve(window.puter);
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-puter-sdk]');
    if (existing) {
      existing.addEventListener("load", () => {
        if (window.puter) resolve(window.puter);
        else reject(new Error("Puter SDK loaded but window.puter is undefined"));
      });
      return;
    }
    const s = document.createElement("script");
    s.src = "https://js.puter.com/v2/";
    s.async = true;
    s.dataset.puterSdk = "1";
    s.onload = () => {
      if (window.puter) resolve(window.puter);
      else reject(new Error("Puter SDK loaded but window.puter is undefined"));
    };
    s.onerror = () => reject(new Error("Failed to load Puter SDK from https://js.puter.com/v2/ \u2014 check CSP and network."));
    document.head.appendChild(s);
  });
  return loadingPromise;
}

/**
 * Trigger the Puter sign-in popup, then read the token + user info.
 * Must be called from a direct user gesture (button click) so the popup
 * isn't blocked by browser policy.
 */
export async function puterSignIn(): Promise<{ token: string; user: any }> {
  const puter = await loadPuter();
  // Newer SDKs return a promise; older ones use a callback. Prefer promise form.
  if (typeof puter.auth?.signIn !== "function") {
    throw new Error("puter.auth.signIn is not available; SDK may be too old.");
  }
  await puter.auth.signIn();
  const user = await puter.auth.getUser();
  const token: string = puter.authToken ?? puter.auth.token ?? "";
  if (!user || !user.uuid) throw new Error("Puter sign-in returned no user");
  if (!token) throw new Error("Puter sign-in returned no token");
  return { token, user };
}

export async function puterSignOut(): Promise<void> {
  if (!window.puter) return;
  try { await window.puter.auth.signOut(); } catch { /* ignore */ }
}
