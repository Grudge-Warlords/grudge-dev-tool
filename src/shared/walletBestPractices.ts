/**
 * Wallet system SSOT + best practices for Grudge Studio.
 * Aligns with GrudgeBuilder server routes:
 *   GET  /api/wallet/status | /config | /overview | /linked
 *   POST /api/wallet/create | /link/challenge | /link/confirm | /link-external
 *   POST /api/auth/wallet
 *
 * Production surfaces: client.grudge-studio.com, wallet.grudge-studio.com,
 * Railway grudge-api-production (game-data SSOT).
 */

import { FLEET_GAME_DATA_URL, FLEET_URLS } from "./fleet";
import { GBUX_TOKEN_MINT } from "./grudgeEconomy";

/** Custodial game wallet (Crossmint MPC) — server creates; never export keys to client. */
export const WALLET_PROVIDER_CUSTODIAL = "crossmint" as const;
/** Player-owned extension / mobile wallet. */
export const WALLET_PROVIDER_EXTERNAL = "external" as const;

export type WalletKind = "custodial" | "external" | "admin_treasury" | "escrow";

export const WALLET_SITE_URL = "https://wallet.grudge-studio.com";
export const WALLET_DASHBOARD_URL = "https://grudgewarlords.com/wallet";

/** Prefer fleet client rewrites; fall back to wallet worker + Railway. */
export function walletApiBases(apiBase?: string): string[] {
  const bases = [
    apiBase?.replace(/\/$/, ""),
    FLEET_URLS.client,
    WALLET_SITE_URL,
    FLEET_GAME_DATA_URL,
  ].filter(Boolean) as string[];
  return [...new Set(bases)];
}

export const WALLET_PATHS = {
  status: "/api/wallet/status",
  config: "/api/wallet/config",
  create: "/api/wallet/create",
  overview: "/api/wallet/overview",
  linked: "/api/wallet/linked",
  linkChallenge: "/api/wallet/link/challenge",
  linkConfirm: "/api/wallet/link/confirm",
  linkExternal: "/api/wallet/link-external",
  authWallet: "/api/auth/wallet",
} as const;

/**
 * Production escrow / ALE treasury used for cNFT mint custody (not player keys).
 * Full pubkey is set via Accounts → ALE admin wallet or Railway AI_AGENT_WALLET.
 * Players claim optional transfers; play is never gated on wallet.
 */
export const DEFAULT_ESCROW_ADMIN_WALLET_HINT = "Set ALE admin / AI_AGENT_WALLET in Accounts";

export const WALLET_BEST_PRACTICES = {
  neverStorePrivateKeysClientSide: true,
  custodialProvider: WALLET_PROVIDER_CUSTODIAL,
  externalProviders: ["phantom", "solflare"] as const,
  gbuxMint: GBUX_TOKEN_MINT,
  chain: "solana" as const,
  cluster: "mainnet-beta" as const,
  /** In-game gold/currency lives in Railway DB; GBUX is on-chain utility. */
  inGameGoldDbOnly: true,
  /** cNFT mints go to admin escrow by default; claim is optional. */
  cnftEscrowFirst: true,
  /** Auth can be Puter / Grudge ID / wallet address. */
  multiAuth: true,
  playNeverGatedOnWallet: true,
  rules: [
    "Custodial Crossmint MPC wallet is the default game wallet — provision via POST /api/wallet/create with email + JWT.",
    "Never put private keys or seed phrases in the Electron app, localStorage, or ObjectStore.",
    "Users may link Phantom/Solflare via sign-message challenge (POST /api/wallet/link/challenge + /confirm).",
    "Web3 login: POST /api/auth/wallet with wallet_address — creates account if new; returns JWT.",
    "Admin ALE treasury is for GBUX fulfillment / cNFT escrow only — set in Accounts → Admin.",
    "Railway Postgres is SSOT for wallet address on account; D1 is not player wallet SSOT.",
    "Play is never gated on wallet or cNFT claim.",
  ],
} as const;

export interface WalletStatusResponse {
  hasWallet: boolean;
  walletType: string | null;
  walletAddress: string | null;
  crossmintEmail?: string | null;
  gbuxBalance?: number;
}

export interface WalletConfigResponse {
  network?: string;
  rpcEndpoint?: string;
  crossmintEnabled?: boolean;
  gbuxMint?: string;
  treasuryAddress?: string | null;
}

export interface LinkedWalletRow {
  id?: string;
  walletAddress: string;
  provider: string;
  label?: string | null;
  isPrimary?: boolean;
}

export interface WalletOverviewResponse {
  gbuxBalance?: number;
  primaryWallet?: string | null;
  walletType?: string | null;
  linkedWallets?: LinkedWalletRow[];
  onChain?: Array<{
    walletAddress: string;
    sol?: number | null;
    gbux?: number | null;
  }>;
  treasuryAddress?: string | null;
  rates?: { gbuxUsd?: number; purchaseFeePercent?: number };
}

export interface WalletAuthResponse {
  success?: boolean;
  token?: string;
  grudgeId?: string;
  user?: {
    id?: string;
    userId?: string;
    username?: string;
    email?: string | null;
    grudgeId?: string;
  };
  account?: {
    walletAddress?: string | null;
    walletType?: string | null;
    gbuxBalance?: number;
  };
  error?: string;
}

/** Solana base58 pubkey length check (loose). */
export function isSolanaAddress(addr: string): boolean {
  const a = addr.trim();
  if (a.length < 32 || a.length > 48) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(a);
}
