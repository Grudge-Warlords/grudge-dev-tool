/** Canonical Grudge economy + service URLs (aligned with RTS grudgeServices.ts). */

export const GRUDGE_ID_URL = "https://id.grudge-studio.com";
export const GAME_API_URL = "https://api.grudge-studio.com";
export const GAME_DATA_URL = "https://grudge-builder-production.up.railway.app";
export const ACCOUNT_API_URL = "https://account.grudge-studio.com";
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
  { id: "api", label: "Game API", url: GAME_API_URL, role: "economy" },
  { id: "gameData", label: "Game data / wallet", url: GAME_DATA_URL, role: "wallet" },
  { id: "account", label: "Account API", url: ACCOUNT_API_URL, role: "profile" },
  { id: "walletPage", label: "Wallet dashboard", url: "https://grudgewarlords.com/wallet", role: "wallet" },
] as const;