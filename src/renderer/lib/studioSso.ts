/**
 * Renderer helpers — keep Forge / Coder / Browser webviews logged in
 * whenever Grudge Studio (dev tool) is already signed in.
 *
 * One login in Studio = one identity in every embedded module.
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

export interface ModuleAuthBundle {
  puterToken: string | null;
  puterUser: { uuid: string; username: string; email?: string } | null;
  grudgeSessionToken: string | null;
  player: StudioSsoState["player"];
  forgeEditorUrl: string;
  coderUrl: string;
  forgeUrl: string;
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

export async function getModuleAuthBundle(): Promise<ModuleAuthBundle | null> {
  try {
    const b = await window.grudge?.auth?.getModuleAuthBundle?.();
    return (b as ModuleAuthBundle) || null;
  } catch {
    return null;
  }
}

/** Build JS that writes Puter + Grudge session into the guest page storage. */
function buildInjectScript(bundle: ModuleAuthBundle): string {
  const puterToken = bundle.puterToken || "";
  const sessionToken = bundle.grudgeSessionToken || "";
  const player = bundle.player;
  const puterUser = bundle.puterUser;

  return `
    (function(){
      try {
        var puterToken = ${JSON.stringify(puterToken)};
        var sessionToken = ${JSON.stringify(sessionToken)};
        var player = ${JSON.stringify(player)};
        var puterUser = ${JSON.stringify(puterUser)};

        // ── Puter SDK session (Forge Cloud Save / Publish / Puter AI) ──
        if (puterToken) {
          try {
            localStorage.setItem("puter.auth.token", puterToken);
            localStorage.setItem("puter_auth_token", puterToken);
            localStorage.setItem("authToken", puterToken);
            localStorage.setItem("token", puterToken);
            // Common Puter blob shapes across SDK versions
            var blobKeys = ["puter", "puter-auth", "puter.auth"];
            for (var i = 0; i < blobKeys.length; i++) {
              try {
                var raw = localStorage.getItem(blobKeys[i]);
                var o = raw ? JSON.parse(raw) : {};
                if (!o || typeof o !== "object") o = {};
                o.auth_token = puterToken;
                o.token = puterToken;
                o.access_token = puterToken;
                if (puterUser && puterUser.uuid) {
                  o.user = o.user || {};
                  o.user.uuid = puterUser.uuid;
                  o.user.username = puterUser.username;
                  if (puterUser.email) o.user.email = puterUser.email;
                }
                localStorage.setItem(blobKeys[i], JSON.stringify(o));
              } catch (e) {}
            }
            if (window.puter && window.puter.auth) {
              try {
                if (typeof window.puter.auth.setToken === "function") {
                  window.puter.auth.setToken(puterToken);
                }
              } catch (e) {}
            }
          } catch (e) {}
        }

        // ── Grudge ID session (Forge grudgeAuthBridge / Coder / Warlords) ──
        if (sessionToken && player && player.grudgeId) {
          try {
            var payload = {
              player: {
                id: player.id,
                username: player.username,
                grudgeId: player.grudgeId,
                displayName: player.displayName || player.username,
                avatarUrl: null,
                gbuxBalance: "0",
                role: "player"
              },
              token: sessionToken,
              storedAt: Date.now()
            };
            localStorage.setItem("grudge.auth.session", JSON.stringify(payload));
            // Also set non-httpOnly cookie readable by JS for same-site checks
            try {
              document.cookie = "gs_player_session=" + encodeURIComponent(sessionToken)
                + "; path=/; max-age=" + (60 * 60 * 24 * 12)
                + "; secure; samesite=none";
            } catch (e) {}
          } catch (e) {}
        }

        // Notify page that Studio hydrated auth (Forge listens for re-bootstrap)
        try {
          window.dispatchEvent(new CustomEvent("grudge:sso-hydrate", {
            detail: {
              player: player,
              token: sessionToken || null,
              puterToken: puterToken || null,
              puterUser: puterUser,
              source: "grudge-studio"
            }
          }));
        } catch (e) {}

        // Expose a tiny marker so we can verify inject in DevTools
        try { window.__GRUDGE_STUDIO_SSO__ = { at: Date.now(), hasPuter: !!puterToken, hasGrudge: !!(sessionToken && player) }; } catch (e) {}
      } catch (e) {}
    })();
  `;
}

/**
 * Inject Puter + Grudge session into a module webview.
 * Call on dom-ready AND did-finish-load (bootstrap may already have run).
 */
export async function injectPuterTokenIntoWebview(
  webview: HTMLElement | null | undefined,
): Promise<void> {
  if (!webview || typeof (webview as any).executeJavaScript !== "function") return;

  let bundle = await getModuleAuthBundle();
  if (!bundle?.puterToken && !bundle?.grudgeSessionToken) {
    // Force a sync once if Studio is signed in but bundle empty
    await syncStudioSso();
    bundle = await getModuleAuthBundle();
  }
  if (!bundle || (!bundle.puterToken && !bundle.grudgeSessionToken)) return;

  const script = buildInjectScript(bundle);
  try {
    await (webview as any).executeJavaScript(script, true);
  } catch {
    /* webview may not be ready */
  }
}

/** Alias — injects full module auth (Puter + Grudge), not just Puter. */
export const injectModuleAuthIntoWebview = injectPuterTokenIntoWebview;

/**
 * Wire a <webview> element for Studio SSO: sync, set src with launch token,
 * inject auth on every load.
 */
export function wireWebviewSso(
  webview: HTMLElement | null | undefined,
  opts?: { onLoadingChange?: (loading: boolean) => void },
): () => void {
  if (!webview) return () => {};
  const el = webview as any;

  const onDom = () => {
    void injectModuleAuthIntoWebview(webview);
  };
  const onFinish = () => {
    void injectModuleAuthIntoWebview(webview);
    opts?.onLoadingChange?.(false);
  };
  const onFail = () => opts?.onLoadingChange?.(false);
  const onStart = () => opts?.onLoadingChange?.(true);

  el.addEventListener("dom-ready", onDom);
  el.addEventListener("did-finish-load", onFinish);
  el.addEventListener("did-stop-loading", onFinish);
  el.addEventListener("did-fail-load", onFail);
  el.addEventListener("did-start-loading", onStart);

  // Immediate inject if already ready
  void injectModuleAuthIntoWebview(webview);

  return () => {
    el.removeEventListener("dom-ready", onDom);
    el.removeEventListener("did-finish-load", onFinish);
    el.removeEventListener("did-stop-loading", onFinish);
    el.removeEventListener("did-fail-load", onFail);
    el.removeEventListener("did-start-loading", onStart);
  };
}

/** Ensure SSO is fresh, then return module URL for webview src. */
export async function resolveModuleUrl(
  module: "forge" | "forgeEditor" | "coder",
): Promise<{ url: string; sso: StudioSsoState }> {
  let sso = await getStudioSso();
  if (!sso.ok || !sso.syncedAt || Date.now() - sso.syncedAt > 2 * 60 * 1000) {
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
