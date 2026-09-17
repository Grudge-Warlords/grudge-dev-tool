'use strict';

// src/urls.ts
var DEFAULT_FLEET_URLS = {
  auth: "https://id.grudge-studio.com",
  gameData: "https://grudge-api-production-0d46.up.railway.app",
  assets: "https://assets.grudge-studio.com",
  objectStore: "https://objectstore.grudge-studio.com/api/v1",
  ai: "https://ai.grudge-studio.com",
  portal: "https://grudge-studio.com",
  warlords: "https://grudgewarlords.com",
  forge: "https://forge.grudge-studio.com",
  studioEditor: "https://grudge-studio-editor.vercel.app",
  warlordGenesis: "https://warlord-genesis.vercel.app",
  characterStudio: "https://character.grudge-studio.com",
  /** HYDRA UI Kit + studio — ui.grudge-studio.com */
  uiEditor: "https://ui.grudge-studio.com",
  dash: "https://dash.grudge-studio.com"
};
var fleetUrls = { ...DEFAULT_FLEET_URLS };
function getFleetUrls() {
  return fleetUrls;
}
function setFleetUrls(partial) {
  fleetUrls = { ...fleetUrls, ...partial };
}
var FLEET_GAME_ORIGINS = {
  "warlord-genesis": "https://warlord-genesis.vercel.app",
  "rts-grudge": "https://rts-grudge.vercel.app",
  forge: "https://forge.grudge-studio.com",
  "tactical-infinity": "https://water.grudge-studio.com",
  arena: "https://grudge-arena.grudge-studio.com",
  survival: "https://survival.grudge-studio.com"
};

// src/auth.ts
var FLEET_AUTH_TOKEN_KEYS = [
  "grudge_auth_token",
  "grudge_session_token",
  "grudge.token",
  "sso_token"
];
function buildGrudgeLoginUrl(redirectUri, opts = {}) {
  const auth = getFleetUrls().auth.replace(/\/$/, "");
  const dest = redirectUri;
  const q = new URLSearchParams();
  q.set("redirect_uri", dest);
  q.set("redirect", dest);
  q.set("return", dest);
  if (opts.app) q.set("app", opts.app);
  if (opts.origin) q.set("origin", opts.origin);
  return `${auth}/login?${q.toString()}`;
}
function buildDefaultLoginUrl(app = "grudge-app") {
  if (typeof window === "undefined") {
    return buildGrudgeLoginUrl("https://grudgewarlords.com/auth/callback", { app });
  }
  const origin = window.location.origin;
  return buildGrudgeLoginUrl(`${origin}/auth/callback`, { app, origin });
}
function readStoredToken() {
  if (typeof localStorage === "undefined") return null;
  for (const k of FLEET_AUTH_TOKEN_KEYS) {
    const v = localStorage.getItem(k);
    if (v) return v;
  }
  return null;
}
function storeAuthToken(token) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem("grudge_auth_token", token);
  localStorage.setItem("grudge_session_token", token);
  localStorage.setItem("sso_token", token);
}
function consumeAuthQuery(search = typeof location !== "undefined" ? location.search : "") {
  try {
    const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const t = p.get("grudge_token") || p.get("sso_token");
    if (t) {
      storeAuthToken(t);
      if (typeof window !== "undefined" && window.history?.replaceState) {
        const u = new URL(window.location.href);
        u.searchParams.delete("grudge_token");
        u.searchParams.delete("sso_token");
        window.history.replaceState({}, "", u.pathname + u.search + u.hash);
      }
    }
    return t;
  } catch {
    return null;
  }
}

exports.DEFAULT_FLEET_URLS = DEFAULT_FLEET_URLS;
exports.FLEET_AUTH_TOKEN_KEYS = FLEET_AUTH_TOKEN_KEYS;
exports.FLEET_GAME_ORIGINS = FLEET_GAME_ORIGINS;
exports.buildDefaultLoginUrl = buildDefaultLoginUrl;
exports.buildGrudgeLoginUrl = buildGrudgeLoginUrl;
exports.consumeAuthQuery = consumeAuthQuery;
exports.getFleetUrls = getFleetUrls;
exports.readStoredToken = readStoredToken;
exports.setFleetUrls = setFleetUrls;
exports.storeAuthToken = storeAuthToken;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map