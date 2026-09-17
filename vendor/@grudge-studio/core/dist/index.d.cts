/** Canonical Grudge Studio fleet endpoints. Override via setFleetUrls(). */
declare const DEFAULT_FLEET_URLS: {
    readonly auth: "https://id.grudge-studio.com";
    readonly gameData: "https://grudge-api-production-0d46.up.railway.app";
    readonly assets: "https://assets.grudge-studio.com";
    readonly objectStore: "https://objectstore.grudge-studio.com/api/v1";
    readonly ai: "https://ai.grudge-studio.com";
    readonly portal: "https://grudge-studio.com";
    readonly warlords: "https://grudgewarlords.com";
    readonly forge: "https://forge.grudge-studio.com";
    readonly studioEditor: "https://grudge-studio-editor.vercel.app";
    readonly warlordGenesis: "https://warlord-genesis.vercel.app";
    readonly characterStudio: "https://character.grudge-studio.com";
    /** HYDRA UI Kit + studio — ui.grudge-studio.com */
    readonly uiEditor: "https://ui.grudge-studio.com";
    readonly dash: "https://dash.grudge-studio.com";
};
type FleetUrlKey = keyof typeof DEFAULT_FLEET_URLS;
declare function getFleetUrls(): Readonly<Record<FleetUrlKey, string>>;
declare function setFleetUrls(partial: Partial<Record<FleetUrlKey, string>>): void;
/** FLEET_GAME_ORIGINS — SSO return + navigateToGame. */
declare const FLEET_GAME_ORIGINS: {
    readonly "warlord-genesis": "https://warlord-genesis.vercel.app";
    readonly "rts-grudge": "https://rts-grudge.vercel.app";
    readonly forge: "https://forge.grudge-studio.com";
    readonly "tactical-infinity": "https://water.grudge-studio.com";
    readonly arena: "https://grudge-arena.grudge-studio.com";
    readonly survival: "https://survival.grudge-studio.com";
};

/** Approved client token storage keys (read all, write canonical). */
declare const FLEET_AUTH_TOKEN_KEYS: readonly ["grudge_auth_token", "grudge_session_token", "grudge.token", "sso_token"];
declare function buildGrudgeLoginUrl(redirectUri: string, opts?: {
    app?: string;
    origin?: string;
}): string;
/** Default callback on current origin. */
declare function buildDefaultLoginUrl(app?: string): string;
declare function readStoredToken(): string | null;
declare function storeAuthToken(token: string): void;
/** Consume ?grudge_token= / ?sso_token= from URL and clean history. */
declare function consumeAuthQuery(search?: string): string | null;

export { DEFAULT_FLEET_URLS, FLEET_AUTH_TOKEN_KEYS, FLEET_GAME_ORIGINS, type FleetUrlKey, buildDefaultLoginUrl, buildGrudgeLoginUrl, consumeAuthQuery, getFleetUrls, readStoredToken, setFleetUrls, storeAuthToken };
