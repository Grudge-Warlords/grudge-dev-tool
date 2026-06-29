import { getApiBaseUrl } from "./api";
import { getPuterToken } from "./auth/puterSession";
import { readCf, writeCf } from "./cf/credentials";
import * as legion from "./legion/orchestrator";
import {
  GAME_API_URL,
  GAME_DATA_URL,
  GBUX_PURCHASE_PACKS,
} from "../shared/grudgeEconomy";
import {
  ECONOMY_API_URLS,
  type EconomyReward,
  type LedgerEntry,
  type SwapQuote,
  validateGbuxAmount,
} from "../shared/web3";
import { FLEET_URLS } from "../shared/fleet";

export interface WalletRecord {
  player_id?: string;
  address: string;
  chain?: string;
  provider?: string;
  custodial_id?: string | null;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getPuterToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const fleetKey = await legion.getFleetApiKey();
  if (fleetKey) headers["X-API-Key"] = fleetKey;
  return headers;
}

async function tryFetchJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e: unknown) {
    return { ok: false, status: 0, data: { error: e instanceof Error ? e.message : String(e) } };
  }
}

export async function getPlayerWallet(grudgeId: string): Promise<{
  status: "ready" | "none" | "unavailable" | "error";
  wallet: WalletRecord | null;
  source?: string;
  error?: string;
}> {
  const bases = [...new Set([await getApiBaseUrl(), GAME_DATA_URL])];
  for (const base of bases) {
    const r = await tryFetchJson(`${base.replace(/\/$/, "")}/api/wallets/${encodeURIComponent(grudgeId)}`);
    if (r.status === 404) return { status: "none", wallet: null, source: base };
    if (r.status === 503) return { status: "unavailable", wallet: null, source: base, error: "Crossmint not configured" };
    if (r.ok) {
      const body = r.data as { success?: boolean; wallet?: WalletRecord };
      if (body.wallet?.address) return { status: "ready", wallet: body.wallet, source: base };
    }
  }
  return { status: "error", wallet: null, error: "Wallet service unreachable" };
}

export async function provisionWallet(grudgeId: string, email?: string): Promise<{
  ok: boolean;
  wallet: WalletRecord | null;
  error?: string;
}> {
  const base = await getApiBaseUrl();
  const r = await tryFetchJson(
    `${base.replace(/\/$/, "")}/api/wallets/${encodeURIComponent(grudgeId)}`,
    {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(email ? { email } : {}),
    },
  );
  if (r.ok) {
    const body = r.data as { wallet?: WalletRecord };
    return { ok: true, wallet: body.wallet ?? null };
  }
  const body = r.data as { error?: string };
  return { ok: false, wallet: null, error: body.error ?? `HTTP ${r.status}` };
}

export async function getGbuxBalance(grudgeId: string): Promise<{
  ok: boolean;
  balance: number | null;
  source?: string;
  error?: string;
}> {
  const headers = await authHeaders();
  const urls = [
    `${ECONOMY_API_URLS.aiHub}/balance?grudgeId=${encodeURIComponent(grudgeId)}`,
    `${GAME_API_URL}/api/economy/balance?grudgeId=${encodeURIComponent(grudgeId)}`,
    `${GAME_API_URL}/api/economy/gbux/${encodeURIComponent(grudgeId)}`,
  ];
  for (const url of urls) {
    const r = await tryFetchJson(url, { headers });
    if (r.ok) {
      const body = r.data as { balance?: number; gbux?: number; amount?: number };
      const balance = body.balance ?? body.gbux ?? body.amount ?? null;
      if (balance != null) return { ok: true, balance: Number(balance), source: url };
    }
  }
  return { ok: false, balance: null, error: "GBUX balance endpoint unavailable" };
}

async function economyBases(): Promise<string[]> {
  return [...new Set([
    ECONOMY_API_URLS.aiHub,
    `${GAME_API_URL}/api/economy`,
    `${FLEET_URLS.ai}/v1/economy`,
  ])];
}

function mapReward(row: Record<string, unknown>): EconomyReward {
  return {
    id: String(row.id ?? ""),
    grudgeId: String(row.grudgeId ?? row.grudge_id ?? ""),
    rewardType: (row.rewardType ?? row.reward_type ?? "quest") as EconomyReward["rewardType"],
    amount: Number(row.amount ?? 0),
    sourceGame: String(row.sourceGame ?? row.source_game ?? "forge"),
    sourceRef: (row.sourceRef ?? row.source_ref ?? null) as string | null,
    title: String(row.title ?? "Reward"),
    description: (row.description ?? null) as string | null,
    itemId: (row.itemId ?? row.item_id ?? null) as string | null,
    nftMint: (row.nftMint ?? row.nft_mint ?? null) as string | null,
    status: (row.status ?? "pending") as EconomyReward["status"],
    expiresAt: (row.expiresAt ?? row.expires_at ?? null) as string | null,
    createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()),
    claimedAt: (row.claimedAt ?? row.claimed_at ?? null) as string | null,
  };
}

function mapLedger(row: Record<string, unknown>): LedgerEntry {
  return {
    id: String(row.id ?? ""),
    grudgeId: String(row.grudgeId ?? row.grudge_id ?? ""),
    walletAddress: (row.walletAddress ?? row.wallet_address ?? null) as string | null,
    type: (row.type ?? "transfer") as LedgerEntry["type"],
    amount: Number(row.amount ?? 0),
    direction: (row.direction ?? "credit") as LedgerEntry["direction"],
    sourceGame: (row.sourceGame ?? row.source_game ?? null) as string | null,
    rewardId: (row.rewardId ?? row.reward_id ?? null) as string | null,
    txSignature: (row.txSignature ?? row.tx_signature ?? null) as string | null,
    memo: (row.memo ?? null) as string | null,
    status: (row.status ?? "pending") as LedgerEntry["status"],
    createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()),
  };
}

export async function listRewards(grudgeId: string): Promise<{
  ok: boolean;
  rewards: EconomyReward[];
  source?: string;
  error?: string;
}> {
  const headers = await authHeaders();
  for (const base of await economyBases()) {
    const r = await tryFetchJson(
      `${base.replace(/\/$/, "")}/rewards?grudgeId=${encodeURIComponent(grudgeId)}`,
      { headers },
    );
    if (r.ok) {
      const body = r.data as { rewards?: unknown[] };
      const rewards = (body.rewards ?? []).map((row) => mapReward(row as Record<string, unknown>));
      return { ok: true, rewards, source: base };
    }
  }
  return { ok: false, rewards: [], error: "Rewards service unavailable" };
}

export async function claimReward(input: {
  grudgeId: string;
  rewardId: string;
  walletAddress?: string;
}): Promise<{ ok: boolean; message: string; txSignature?: string }> {
  const headers = await authHeaders();
  const body = JSON.stringify({
    grudgeId: input.grudgeId,
    rewardId: input.rewardId,
    walletAddress: input.walletAddress,
  });
  for (const base of await economyBases()) {
    const r = await tryFetchJson(`${base.replace(/\/$/, "")}/rewards/claim`, {
      method: "POST",
      headers,
      body,
    });
    if (r.ok) {
      const data = r.data as { message?: string; txSignature?: string; tx?: string };
      return {
        ok: true,
        message: data.message ?? "Reward claimed",
        txSignature: data.txSignature ?? data.tx,
      };
    }
  }
  return { ok: false, message: "Claim failed — economy service unavailable" };
}

export async function getLedger(grudgeId: string, limit = 50): Promise<{
  ok: boolean;
  entries: LedgerEntry[];
  source?: string;
  error?: string;
}> {
  const headers = await authHeaders();
  const q = `grudgeId=${encodeURIComponent(grudgeId)}&limit=${limit}`;
  for (const base of await economyBases()) {
    const r = await tryFetchJson(`${base.replace(/\/$/, "")}/ledger?${q}`, { headers });
    if (r.ok) {
      const body = r.data as { entries?: unknown[]; ledger?: unknown[] };
      const raw = body.entries ?? body.ledger ?? [];
      return { ok: true, entries: raw.map((row) => mapLedger(row as Record<string, unknown>)), source: base };
    }
  }
  return { ok: false, entries: [], error: "Ledger unavailable" };
}

export async function getSwapQuote(input: {
  grudgeId: string;
  pairId: string;
  fromAmount: number;
}): Promise<{ ok: boolean; quote: SwapQuote | null; error?: string }> {
  const headers = await authHeaders();
  const body = JSON.stringify(input);
  for (const base of await economyBases()) {
    const r = await tryFetchJson(`${base.replace(/\/$/, "")}/swap/quote`, {
      method: "POST",
      headers,
      body,
    });
    if (r.ok) {
      const data = r.data as { quote?: SwapQuote };
      if (data.quote) return { ok: true, quote: data.quote };
    }
  }
  return { ok: false, quote: null, error: "Swap quote unavailable" };
}

export async function executeSwap(input: {
  grudgeId: string;
  quoteId: string;
  walletAddress?: string;
}): Promise<{ ok: boolean; message: string; txSignature?: string }> {
  const headers = await authHeaders();
  const body = JSON.stringify(input);
  for (const base of await economyBases()) {
    const r = await tryFetchJson(`${base.replace(/\/$/, "")}/swap/execute`, {
      method: "POST",
      headers,
      body,
    });
    if (r.ok) {
      const data = r.data as { message?: string; txSignature?: string; tx?: string };
      return {
        ok: true,
        message: data.message ?? "Swap submitted",
        txSignature: data.txSignature ?? data.tx,
      };
    }
    const err = r.data as { error?: string };
    if (r.status === 400 && err.error) return { ok: false, message: err.error };
  }
  return { ok: false, message: "Swap execution unavailable" };
}

export async function grantReward(input: {
  grudgeId: string;
  rewardType: string;
  amount: number;
  sourceGame: string;
  title: string;
  description?: string;
  itemId?: string;
}): Promise<{ ok: boolean; message: string; rewardId?: string }> {
  const valid = validateGbuxAmount(input.amount);
  if (!valid.ok) return { ok: false, message: valid.error ?? "Invalid amount" };

  const headers = await authHeaders();
  const body = JSON.stringify({ ...input, agent: "ale" });
  for (const base of await economyBases()) {
    const r = await tryFetchJson(`${base.replace(/\/$/, "")}/rewards/grant`, {
      method: "POST",
      headers,
      body,
    });
    if (r.ok) {
      const data = r.data as { message?: string; rewardId?: string; id?: string };
      return {
        ok: true,
        message: data.message ?? "Reward granted",
        rewardId: data.rewardId ?? data.id,
      };
    }
  }
  return { ok: false, message: "Grant reward failed — admin economy route unavailable" };
}

export async function requestGbuxPurchase(input: {
  packId: string;
  grudgeId: string;
  walletAddress?: string;
}): Promise<{ ok: boolean; message: string; orderId?: string }> {
  const pack = GBUX_PURCHASE_PACKS.find((p) => p.id === input.packId);
  if (!pack) return { ok: false, message: "Unknown pack" };

  const r = await tryFetchJson(`${GAME_API_URL}/api/economy/purchase`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      packId: pack.id,
      grudgeId: input.grudgeId,
      walletAddress: input.walletAddress,
      agent: "ale",
      currency: "GBUX",
    }),
  });

  if (r.ok) {
    const body = r.data as { orderId?: string; message?: string };
    return { ok: true, message: body.message ?? `Purchase queued — ${pack.gbux} GBUX`, orderId: body.orderId };
  }

  // Fallback: route through Legion ALE agent for manual fulfillment
  try {
    const chat = await legion.legionChat({
      role: "dev",
      message: `GBUX purchase request: pack=${pack.id} (${pack.gbux} GBUX) grudgeId=${input.grudgeId} wallet=${input.walletAddress ?? "pending"}. Route via ALE admin agent treasury.`,
    });
    return {
      ok: true,
      message: `ALE agent queued: ${chat.response?.slice(0, 240) ?? "check ai.grudge-studio.com"}`,
    };
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function adminGbuxTransfer(input: {
  toAddress: string;
  amount: number;
  memo?: string;
}): Promise<{ ok: boolean; message: string }> {
  const valid = validateGbuxAmount(input.amount);
  if (!valid.ok) return { ok: false, message: valid.error ?? "Invalid amount" };

  const treasury = await readCf("aleAdminWallet");
  const r = await tryFetchJson(`${GAME_API_URL}/api/economy/transfer`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      toAddress: input.toAddress,
      amount: input.amount,
      fromTreasury: treasury ?? undefined,
      memo: input.memo ?? "Forge admin ALE transfer",
      agent: "ale",
    }),
  });
  if (r.ok) {
    const body = r.data as { message?: string; tx?: string };
    return { ok: true, message: body.message ?? body.tx ?? "Transfer submitted" };
  }
  const body = r.data as { error?: string };
  return { ok: false, message: body.error ?? `Transfer failed (${r.status})` };
}

export async function getAleAdminWallet(): Promise<string | null> {
  return readCf("aleAdminWallet");
}

export async function setAleAdminWallet(address: string): Promise<void> {
  await writeCf("aleAdminWallet", address.trim());
}