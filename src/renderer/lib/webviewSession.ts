/**
 * Inject the desktop single-login session into Electron <webview> guests
 * so Forge / Coder / Preview / Builder share the same Grudge identity.
 */
import {
  FLEET_AUTH_ID_KEYS,
  FLEET_AUTH_TOKEN_KEYS,
  type FleetHandoffPayload,
  buildEmbedUrl,
} from "../../shared/fleetAuthHandoff";

export type WebviewLike = {
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
  addEventListener: (type: string, listener: (e: Event) => void) => void;
  removeEventListener: (type: string, listener: (e: Event) => void) => void;
  getURL?: () => string;
  src?: string;
};

/** Cast Electron <webview> refs (typed loosely in React). */
export function asWebview(el: unknown): WebviewLike | null {
  return el && typeof el === "object" ? (el as WebviewLike) : null;
}

let cachedHandoff: FleetHandoffPayload | null = null;
let cacheAt = 0;

/** Load handoff from main (Puter token + optional fleet API bearer). */
export async function loadHandoff(force = false): Promise<FleetHandoffPayload> {
  const now = Date.now();
  if (!force && cachedHandoff && now - cacheAt < 15_000) return cachedHandoff;
  try {
    const h =
      (await window.grudge?.auth?.getHandoff?.()) as FleetHandoffPayload | undefined;
    if (h) {
      cachedHandoff = h;
      cacheAt = now;
      return h;
    }
  } catch {
    /* fall through */
  }
  try {
    const s = await window.grudge?.auth?.getSession?.();
    const token = (await window.grudge?.auth?.getPuterToken?.()) as string | null;
    cachedHandoff = {
      token: token || null,
      grudgeId: s?.grudgeId ?? null,
      username: s?.puterUser?.username ?? null,
      email: s?.puterUser?.email ?? null,
      puterUuid: s?.puterUser?.uuid ?? null,
      signedIn: Boolean(s?.signedIn),
    };
    cacheAt = now;
    return cachedHandoff;
  } catch {
    return {
      token: null,
      grudgeId: null,
      username: null,
      email: null,
      puterUuid: null,
      signedIn: false,
    };
  }
}

export function clearHandoffCache(): void {
  cachedHandoff = null;
  cacheAt = 0;
}

/** Build embed URL with from=grudge-dev-tool + identity (no secret in query). */
export async function embedUrlWithSession(
  baseUrl: string,
  extra?: Record<string, string>,
): Promise<string> {
  const h = await loadHandoff();
  return buildEmbedUrl({
    baseUrl,
    grudgeId: h.grudgeId,
    username: h.username,
    extraParams: extra,
  });
}

/**
 * Inject tokens into the guest page localStorage/sessionStorage.
 * Safe to call on every did-finish-load / dom-ready.
 */
export async function injectSessionIntoWebview(
  wv: WebviewLike | null | undefined,
  handoff?: FleetHandoffPayload | null,
): Promise<boolean> {
  if (!wv?.executeJavaScript) return false;
  const h = handoff ?? (await loadHandoff());
  if (!h.signedIn && !h.token) return false;

  const payload = {
    token: h.token,
    grudgeId: h.grudgeId,
    username: h.username,
    email: h.email,
    puterUuid: h.puterUuid,
    tokenKeys: [...FLEET_AUTH_TOKEN_KEYS],
    idKeys: [...FLEET_AUTH_ID_KEYS],
    from: "grudge-dev-tool",
  };

  const code = `(() => {
    try {
      const p = ${JSON.stringify(payload)};
      window.__GRUDGE_DEV_TOOL__ = p;
      if (p.token) {
        for (const k of p.tokenKeys) {
          try { localStorage.setItem(k, p.token); } catch (e) {}
          try { sessionStorage.setItem(k, p.token); } catch (e) {}
        }
      }
      if (p.grudgeId) {
        for (const k of p.idKeys) {
          try { localStorage.setItem(k, p.grudgeId); } catch (e) {}
        }
      }
      if (p.username) {
        try { localStorage.setItem("grudge_username", p.username); } catch (e) {}
      }
      if (p.puterUuid) {
        try { localStorage.setItem("puter_uuid", p.puterUuid); } catch (e) {}
      }
      try {
        window.dispatchEvent(new CustomEvent("grudge-dev-tool:session", { detail: p }));
      } catch (e) {}
      return true;
    } catch (e) {
      return false;
    }
  })()`;

  try {
    await wv.executeJavaScript(code, false);
    return true;
  } catch {
    return false;
  }
}

/**
 * Bind load listeners so every navigation re-injects the desktop session.
 * Returns cleanup.
 */
export function attachWebviewSession(wv: WebviewLike | null | undefined): () => void {
  if (!wv) return () => {};
  let cancelled = false;

  const inject = () => {
    if (cancelled) return;
    void injectSessionIntoWebview(wv);
  };

  const onDom = () => inject();
  const onFinish = () => inject();
  const onNav = () => inject();

  wv.addEventListener("dom-ready", onDom);
  wv.addEventListener("did-finish-load", onFinish);
  wv.addEventListener("did-navigate", onNav);
  wv.addEventListener("did-navigate-in-page", onNav);

  // Immediate attempt if already loaded
  inject();

  return () => {
    cancelled = true;
    wv.removeEventListener("dom-ready", onDom);
    wv.removeEventListener("did-finish-load", onFinish);
    wv.removeEventListener("did-navigate", onNav);
    wv.removeEventListener("did-navigate-in-page", onNav);
  };
}
