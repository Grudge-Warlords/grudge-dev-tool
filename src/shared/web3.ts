/**
 * Fleet ONE TRUTH — Web3, wallets, rewards, swaps, and economy best practices.
 * Mirror in RTS-Grudge `shared/web3.ts` and game clients via grudgeServices imports.
 */

import {
  GBUX_TOKEN_MINT,
  GAME_API_URL,
  GAME_DATA_URL,
  GRUDGE_ID_URL,
} from "./grudgeEconomy";
import { FLEET_URLS } from "./fleet";

// Re-export canonical mint for convenience
export { GBUX_TOKEN_MINT };

// ── Chain ────────────────────────────────────────────────────────────────────

export const SOLANA_CHAIN = "solana" as const;
export const SOLANA_CLUSTER = "mainnet-beta" as const;

/** Public Helius RPC (games should use server-side proxy for writes). Override via VITE_HELIUS_RPC_URL in renderer. */
export const HELIUS_RPC_URL = "https://mainnet.helius-rpc.com";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const GBUX_DECIMALS = 6;
export const SOL_DECIMALS = 9;

// ── Service endpoints ────────────────────────────────────────────────────────

export const ECONOMY_API_URLS = {
  gameApi: `${GAME_API_URL}/api/economy`,
  aiHub: `${FLEET_URLS.ai}/v1/economy`,
  walletApi: `${GAME_DATA_URL}/api/wallets`,
} as const;

export const ECONOMY_PATHS = {
  balance: "/balance",
  rewards: "/rewards",
  claimReward: "/rewards/claim",
  ledger: "/ledger",
  swapQuote: "/swap/quote",
  swapExecute: "/swap/execute",
  transfer: "/transfer",
  purchase: "/purchase",
} as const;

// ── Rate limits & caps (enforce server-side) ─────────────────────────────────

export const ECONOMY_LIMITS = {
  maxSingleTransferGbux: 10_000,
  maxDailyGbuxPerUser: 5_000,
  economyRequestsPerMinute: 5,
  authRequestsPerMinute: 10,
  writeRequestsPerMinute: 20,
} as const;

// ── Reward types & ranges ────────────────────────────────────────────────────

export const REWARD_TYPES = [
  "daily_login",
  "quest",
  "achievement",
  "event",
  "pvp",
  "admin",
  "referral",
  "nft_bonus",
] as const;

export type RewardType = (typeof REWARD_TYPES)[number];

export const REWARD_RANGES: Record<RewardType, { min: number; max: number }> = {
  daily_login: { min: 50, max: 100 },
  quest: { min: 100, max: 500 },
  achievement: { min: 500, max: 2_000 },
  event: { min: 250, max: 1_000 },
  pvp: { min: 50, max: 300 },
  admin: { min: 1, max: 10_000 },
  referral: { min: 100, max: 500 },
  nft_bonus: { min: 25, max: 250 },
};

export type RewardStatus = "pending" | "claimed" | "expired" | "cancelled";

export interface EconomyReward {
  id: string;
  grudgeId: string;
  rewardType: RewardType;
  amount: number;
  sourceGame: string;
  sourceRef?: string | null;
  title: string;
  description?: string | null;
  itemId?: string | null;
  nftMint?: string | null;
  status: RewardStatus;
  expiresAt?: string | null;
  createdAt: string;
  claimedAt?: string | null;
}

// ── Swap pairs ───────────────────────────────────────────────────────────────

export interface SwapPair {
  id: string;
  fromMint: string;
  toMint: string;
  fromSymbol: string;
  toSymbol: string;
  /** Indicative rate: 1 from = N to (hub may override via Jupiter). */
  indicativeRate: number;
  minFromAmount: number;
  maxFromAmount: number;
  enabled: boolean;
}

export const SWAP_PAIRS: SwapPair[] = [
  {
    id: "gbux_sol",
    fromMint: GBUX_TOKEN_MINT,
    toMint: SOL_MINT,
    fromSymbol: "GBUX",
    toSymbol: "SOL",
    indicativeRate: 0.000_01,
    minFromAmount: 10,
    maxFromAmount: 5_000,
    enabled: true,
  },
  {
    id: "sol_gbux",
    fromMint: SOL_MINT,
    toMint: GBUX_TOKEN_MINT,
    fromSymbol: "SOL",
    toSymbol: "GBUX",
    indicativeRate: 100_000,
    minFromAmount: 0.001,
    maxFromAmount: 2,
    enabled: true,
  },
  {
    id: "gbux_usdc",
    fromMint: GBUX_TOKEN_MINT,
    toMint: USDC_MINT,
    fromSymbol: "GBUX",
    toSymbol: "USDC",
    indicativeRate: 0.05,
    minFromAmount: 10,
    maxFromAmount: 5_000,
    enabled: true,
  },
];

export interface SwapQuote {
  quoteId: string;
  pairId: string;
  fromMint: string;
  toMint: string;
  fromAmount: number;
  toAmount: number;
  rate: number;
  feeGbux: number;
  expiresAt: string;
}

export type LedgerEntryType = "reward" | "purchase" | "transfer" | "swap" | "admin" | "withdrawal";
export type LedgerDirection = "credit" | "debit";

export interface LedgerEntry {
  id: string;
  grudgeId: string;
  walletAddress?: string | null;
  type: LedgerEntryType;
  amount: number;
  direction: LedgerDirection;
  sourceGame?: string | null;
  rewardId?: string | null;
  txSignature?: string | null;
  memo?: string | null;
  status: "pending" | "confirmed" | "failed";
  createdAt: string;
}

// ── Fleet games (rewards attribution) ────────────────────────────────────────

export const FLEET_GAMES = [
  { id: "warlords", label: "Grudge Warlords", economy: "gbux" },
  { id: "survival", label: "Grudge Survival", economy: "gbux" },
  { id: "rts", label: "Grudge RTS", economy: "gbux" },
  { id: "armada", label: "Grim Armada", economy: "gbux" },
  { id: "starway", label: "Star Way GRUDA", economy: "gbux" },
  { id: "arena", label: "Grudge Arena", economy: "gbux" },
  { id: "forge", label: "Grudge Studio Forge", economy: "gbux" },
] as const;

// ── Best practices (documented + enforced in validators) ───────────────────────

export const WEB3_BEST_PRACTICES = {
  neverStorePrivateKeysClientSide: true,
  walletProvider: "crossmint-mpc",
  gbuxOnChain: true,
  inGameGoldDbOnly: true,
  jwtIncludesWalletAddress: true,
  maxSingleTransferGbux: ECONOMY_LIMITS.maxSingleTransferGbux,
  maxDailyGbuxPerUser: ECONOMY_LIMITS.maxDailyGbuxPerUser,
  economyRateLimitPerMinute: ECONOMY_LIMITS.economyRequestsPerMinute,
} as const;

/** Validate transfer amount against fleet caps. */
export function validateGbuxAmount(amount: number): { ok: boolean; error?: string } {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Amount must be a positive number" };
  }
  if (amount > ECONOMY_LIMITS.maxSingleTransferGbux) {
    return {
      ok: false,
      error: `Max single transfer is ${ECONOMY_LIMITS.maxSingleTransferGbux.toLocaleString()} GBUX`,
    };
  }
  return { ok: true };
}

export function findSwapPair(pairId: string): SwapPair | undefined {
  return SWAP_PAIRS.find((p) => p.id === pairId);
}

export function solscanTxUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

export function solscanAccountUrl(address: string): string {
  return `https://solscan.io/account/${address}`;
}

export const WALLET_DASHBOARD_URL = "https://grudgewarlords.com/wallet";
export const GRUDGE_ACCOUNT_URL = `${GRUDGE_ID_URL}/account`;