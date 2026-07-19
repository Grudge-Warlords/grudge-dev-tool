/** Canonical Grudge economy + service URLs (aligned with fleet ONE TRUTH). */

import { FLEET_URLS, FLEET_GAME_DATA_URL } from "./fleet";

export const GRUDGE_ID_URL = FLEET_URLS.auth;
/** Prefer fleet client (same-origin rewrites). Railway is the implementation. */
export const GAME_API_URL = FLEET_URLS.client;
export const GAME_DATA_URL = FLEET_GAME_DATA_URL;
/** Account/profile — Railway via client proxy or direct game-data */
export const ACCOUNT_API_URL = FLEET_URLS.client;
export const ACCOUNT_PAGE_URL = `${GRUDGE_ID_URL}/account`;

/** Solana SPL mint — GBUX utility token (fleet ONE TRUTH). */
export const GBUX_TOKEN_MINT = "55TpSoMNxbfsNJ9U1dQoo9H3dRtDmjBZVMcKqvU2nray";

export const GBUX_SOLSCAN = `https://solscan.io/token/${GBUX_TOKEN_MINT}`;

/** ALE Legion treasury / admin agent wallet (set in Settings → Accounts for live transfers). */
export const GBUX_PURCHASE_PACKS = [
  { id: "starter_100", label: "Starter", gbux: 100, usdHint: "$4.99", description: "Daily quests & store cosmetics" },
  { id: "standard_500", label: "Standard", gbux: 500, usdHint: "$19.99", description: "Battle pass tier + fleet unlocks" },
  { id: "founder_2000", label: "Founder", gbux: 2000, usdHint: "$69.99", description: "Founder crate + cross-game GBUX" },
] as const;

export const GRUDGE_SERVICES = [
  { id: "id", label: "Grudge ID", url: GRUDGE_ID_URL, role: "identity" },
  { id: "client", label: "Fleet client", url: GAME_API_URL, role: "economy" },
  { id: "aiHub", label: "GRUDA AI Hub (economy)", url: `${FLEET_URLS.ai}/v1/economy`, role: "economy" },
  { id: "gameData", label: "Game data / wallet (Railway)", url: GAME_DATA_URL, role: "wallet" },
  { id: "account", label: "Account API (fleet)", url: ACCOUNT_API_URL, role: "profile" },
  { id: "forge", label: "Forge editor", url: FLEET_URLS.forge, role: "editor" },
  { id: "walletPage", label: "Wallet dashboard", url: "https://grudgewarlords.com/wallet", role: "wallet" },
] as const;
