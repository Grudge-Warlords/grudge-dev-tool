/**
 * Renderer helpers — keep Forge/Coder <webview>s logged in when Studio is signed in.
 */

export interface StudioSsoState {
  ok: boolean;
  syncedAt: number | null;
  player: {
    id: number;
    username: string;
    grudgeId: string;
    displayName?: string | null;
  } | null;
  hasSessionToken: boolean;
  forgeUrl: string;
  coderUrl: string;
  forgeEditorUrl: string;
  error?: string | null;
}

const FALLBACK: StudioSsoState = {
  ok: false,
  syncedAt: null,
  player: null,
  hasSessionToken: false,
  forgeUrl: "https://forge.grudge-studio.com",
  coderUrl: "https://coder.grudge-studio.com",
  forgeEditorUrl: "https://forge.grudge-studio.com/editor",
  error: null,
};

export async function syncStudioSso(): Promise<StudioSsoState> {
  try {
    const s = await window.grudge?.auth?.syncStudioSso?.();
    return (s as StudioSsoState) || FALLBACK;
  } catch {
    return { ...FALLBACK, error: "sync failed" };
  }
}

export async function getStudioSso(): Promise<StudioSsoState> {
  try {
    const s = await window.grudge?.auth?.getStudioSso?.();
    return (s as StudioSsoState) || FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/**
 * Inject Puter access token into a webview so puter.js sees a signed-in user.
 * Call on dom-ready / did-finish-load of the module webview.
 */
export async function injectPuterTokenIntoWebview(webview: HTMLElement | null | undefined): Promise<void> {
  if (!webview || typeof (webview as any).executeJavaScript !== "function") return;
  let token: string | null = null;
  try {
    token = (await window.grudge?.auth?.getPuterTokenForModules?.()) ?? null;
  } catch {
    return;
  }
  if (!token) return;

  const script = `
    (function(){
      try {
        var t = ${JSON.stringify(token)};
        localStorage.setItem("puter.auth.token", t);
        localStorage.setItem("puter_auth_token", t);
        localStorage.setItem("authToken", t);
        localStorage.setItem("token", t);
        // Some Puter builds store a small session blob
        try {
          var blob = localStorage.getItem("puter");
          if (blob) {
            var o = JSON.parse(blob);
            if (o && typeof o === "object") {
              o.auth_token = t;
              o.token = t;
              localStorage.setItem("puter", JSON.stringify(o));
            }
          }
        } catch (e) {}
        if (window.puter && window.puter.auth && typeof window.puter.auth.setToken === "function") {
          try { window.puter.auth.setToken(t); } catch (e) {}
        }
      } catch (e) {}
    })();
  `;
  try {
    await (webview as any).executeJavaScript(script, true);
  } catch {
    /* webview may not be ready */
  }
}

/** Ensure SSO is fresh, then return module URL for webview src. */
export async function resolveModuleUrl(
  module: "forge" | "forgeEditor" | "coder",
): Promise<{ url: string; sso: StudioSsoState }> {
  let sso = await getStudioSso();
  if (!sso.ok || !sso.syncedAt || Date.now() - sso.syncedAt > 4 * 60 * 1000) {
    sso = await syncStudioSso();
  }
  const url =
    module === "forge"
      ? sso.forgeUrl
      : module === "forgeEditor"
        ? sso.forgeEditorUrl
        : sso.coderUrl;
  return { url, sso };
}
