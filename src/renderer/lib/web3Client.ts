/**
 * Fleet Web3 client — use from Forge renderer via IPC.
 * Games (RTS, Warlords) can mirror this pattern with fetch + JWT from grudgeServices.
 */

import {
  SWAP_PAIRS,
  WEB3_BEST_PRACTICES,
  type EconomyReward,
  type LedgerEntry,
  type SwapQuote,
} from "../../shared/web3";

export { SWAP_PAIRS, WEB3_BEST_PRACTICES };

export async function fetchRewards(grudgeId: string): Promise<EconomyReward[]> {
  const r = await window.grudge.accounts.listRewards(grudgeId);
  return r.ok ? r.rewards : [];
}

export async function claimFleetReward(input: {
  grudgeId: string;
  rewardId: string;
  walletAddress?: string;
}): Promise<{ ok: boolean; message: string; txSignature?: string }> {
  return window.grudge.accounts.claimReward(input);
}

export async function fetchLedger(grudgeId: string, limit = 50): Promise<LedgerEntry[]> {
  const r = await window.grudge.accounts.ledger(grudgeId, limit);
  return r.ok ? r.entries : [];
}

export async function quoteSwap(input: {
  grudgeId: string;
  pairId: string;
  fromAmount: number;
}): Promise<SwapQuote | null> {
  const r = await window.grudge.accounts.swapQuote(input);
  return r.ok ? r.quote : null;
}

export async function executeFleetSwap(input: {
  grudgeId: string;
  quoteId: string;
  walletAddress?: string;
}): Promise<{ ok: boolean; message: string; txSignature?: string }> {
  return window.grudge.accounts.swapExecute(input);
}

export async function grantFleetReward(input: {
  grudgeId: string;
  rewardType: string;
  amount: number;
  sourceGame: string;
  title: string;
  description?: string;
  itemId?: string;
}): Promise<{ ok: boolean; message: string; rewardId?: string }> {
  return window.grudge.accounts.grantReward(input);
}