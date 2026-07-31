import { getApiBaseUrl } from "./api";
import { getPuterToken } from "./auth/puterSession";
import { readCf, writeCf } from "./cf/credentials";
import * as legion from "./legion/orchestrator";
import {
  GAME_API_URL,
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
import {
  WALLET_PATHS,
  walletApiBases,
  isSolanaAddress,
  type LinkedWalletRow,
  type WalletAuthResponse,
  type WalletConfigResponse,
  type WalletOverviewResponse,
  type WalletStatusResponse,
} from "../shared/walletBestPractices";

export interface WalletRecord {
  player_id?: string;
  address: string;
  chain?: string;
  provider?: string;
  custodial_id?: string | null;
  walletType?: string | null;
  gbuxBalance?: number;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getPuterToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const fleetKey = await legion.getFleetApiKey();
  if (fleetKey) headers["X-API-Key"] = fleetKey;
  return headers;
}

async function tryFetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e: unknown) {
    return { ok: false, status: 0, data: { error: e instanceof Error ? e.message : String(e) } };
  }
}

async function walletBases(): Promise<string[]> {
  const apiBase = await getApiBaseUrl();
  return walletApiBases(apiBase);
}

export async function getWalletConfig(): Promise<{
  ok: boolean;
  config: WalletConfigResponse | null;
  source?: string;
  error?: string;
}> {
  for (const base of await walletBases()) {
    const r = await tryFetchJson(`${base}${WALLET_PATHS.config}`);
    if (r.ok) {
      return { ok: true, config: r.data as WalletConfigResponse, source: base };
    }
  }
  return { ok: false, config: null, error: "Wallet config unavailable" };
}

export async function getPlayerWallet(grudgeId: string): Promise<{
  status: "ready" | "none" | "unavailable" | "error";
  wallet: WalletRecord | null;
  source?: string;
  error?: string;
  overview?: WalletOverviewResponse | null;
  linked?: LinkedWalletRow[];
  gbuxBalance?: number | null;
}> {
  const headers = await authHeaders();
  // Auth overview first (full picture)
  for (const base of await walletBases()) {
    const ov = await tryFetchJson(`${base}${WALLET_PATHS.overview}`, { headers });
    if (ov.ok) {
      const overview = ov.data as WalletOverviewResponse;
      const addr = overview.primaryWallet ?? null;
      if (addr) {
        return {
          status: "ready",
          wallet: {
            address: addr,
            chain: "solana",
            provider: overview.walletType ?? "crossmint",
            walletType: overview.walletType,
            gbuxBalance: overview.gbuxBalance,
          },
          source: base,
          overview,
          linked: overview.linkedWallets ?? [],
          gbuxBalance: overview.gbuxBalance ?? null,
        };
      }
      return {
        status: "none",
        wallet: null,
        source: base,
        overview,
        linked: overview.linkedWallets ?? [],
        gbuxBalance: overview.gbuxBalance ?? null,
      };
    }
  }

  // Public/session status fallback
  for (const base of await walletBases()) {
    const r = await tryFetchJson(`${base}${WALLET_PATHS.status}`, { headers });
    if (r.status === 503) {
      return { status: "unavailable", wallet: null, source: base, error: "Crossmint not configured" };
    }
    if (r.ok) {
      const body = r.data as WalletStatusResponse;
      if (body.hasWallet && body.walletAddress) {
        return {
          status: "ready",
          wallet: {
            address: body.walletAddress,
            chain: "solana",
            provider: body.walletType ?? "crossmint",
            walletType: body.walletType,
            gbuxBalance: body.gbuxBalance,
          },
          source: base,
          gbuxBalance: body.gbuxBalance ?? null,
        };
      }
      return { status: "none", wallet: null, source: base, gbuxBalance: body.gbuxBalance ?? null };
    }
  }

  void grudgeId; // reserved for future account-scoped lookup
  return { status: "error", wallet: null, error: "Wallet service unreachable" };
}

/**
 * Provision Crossmint custodial wallet (grudachain admin / any signed-in user).
 * Production: POST /api/wallet/create { email } with Bearer JWT.
 */
export async function provisionWallet(grudgeId: string, email?: string): Promise<{
  ok: boolean;
  wallet: WalletRecord | null;
  error?: string;
  message?: string;
}> {
  if (!email?.trim()) {
    return {
      ok: false,
      wallet: null,
      error: "Email is required for Crossmint custodial wallet creation",
    };
  }
  const headers = await authHeaders();
  if (!headers.Authorization) {
    return { ok: false, wallet: null, error: "Sign in first (Grudge ID / Puter / wallet JWT)" };
  }

  const body = JSON.stringify({ email: email.trim(), grudgeId });
  for (const base of await walletBases()) {
    const r = await tryFetchJson(`${base}${WALLET_PATHS.create}`, {
      method: "POST",
      headers,
      body,
    });
    if (r.ok) {
      const data = r.data as {
        success?: boolean;
        walletAddress?: string;
        walletType?: string;
        message?: string;
        wallet?: WalletRecord;
      };
      const address = data.walletAddress ?? data.wallet?.address;
      if (address) {
        return {
          ok: true,
          wallet: {
            address,
            chain: "solana",
            provider: data.walletType ?? "crossmint",
            walletType: data.walletType ?? "crossmint",
          },
          message: data.message ?? "Wallet created",
        };
      }
      return { ok: true, wallet: data.wallet ?? null, message: data.message };
    }
    const err = r.data as { error?: string };
    // Prefer first explicit API error over generic
    if (r.status === 400 || r.status === 401 || r.status === 404) {
      return { ok: false, wallet: null, error: err.error ?? `HTTP ${r.status}` };
    }
  }
  return { ok: false, wallet: null, error: "Wallet create failed on all fleet hosts" };
}

export async function getLinkedWallets(): Promise<{
  ok: boolean;
  linked: LinkedWalletRow[];
  error?: string;
}> {
  const headers = await authHeaders();
  for (const base of await walletBases()) {
    const r = await tryFetchJson(`${base}${WALLET_PATHS.linked}`, { headers });
    if (r.ok) {
      const body = r.data as { linkedWallets?: LinkedWalletRow[] };
      return { ok: true, linked: body.linkedWallets ?? [] };
    }
  }
  return { ok: false, linked: [], error: "Linked wallets unavailable" };
}

export async function createWalletLinkChallenge(walletAddress: string): Promise<{
  ok: boolean;
  message?: string;
  error?: string;
}> {
  if (!isSolanaAddress(walletAddress)) {
    return { ok: false, error: "Invalid Solana address" };
  }
  const headers = await authHeaders();
  for (const base of await walletBases()) {
    const r = await tryFetchJson(`${base}${WALLET_PATHS.linkChallenge}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ walletAddress: walletAddress.trim() }),
    });
    if (r.ok) {
      const data = r.data as { message?: string };
      if (data.message) return { ok: true, message: data.message };
    }
    const err = r.data as { error?: string };
    if (r.status === 401) return { ok: false, error: err.error ?? "Sign in required to link wallet" };
  }
  return { ok: false, error: "Link challenge failed" };
}

export async function confirmWalletLink(input: {
  walletAddress: string;
  message: string;
  signature: string;
  provider?: string;
  label?: string;
}): Promise<{ ok: boolean; error?: string; message?: string }> {
  const headers = await authHeaders();
  const body = JSON.stringify({
    walletAddress: input.walletAddress.trim(),
    message: input.message,
    signature: input.signature,
    provider: input.provider ?? "phantom",
    label: input.label,
  });
  for (const base of await walletBases()) {
    // Preferred challenge/confirm routes
    const r = await tryFetchJson(`${base}${WALLET_PATHS.linkConfirm}`, {
      method: "POST",
      headers,
      body,
    });
    if (r.ok) {
      return { ok: true, message: "External wallet linked" };
    }
    // Legacy link-external
    const r2 = await tryFetchJson(`${base}${WALLET_PATHS.linkExternal}`, {
      method: "POST",
      headers,
      body,
    });
    if (r2.ok) {
      return { ok: true, message: "External wallet linked" };
    }
  }
  return { ok: false, error: "Wallet link confirm failed" };
}

/**
 * Web3 login with Solana wallet address → fleet JWT.
 * Used for admin wallet login and third-party wallet accounts.
 */
export async function loginWithSolanaWallet(walletAddress: string): Promise<{
  ok: boolean;
  token?: string;
  grudgeId?: string;
  username?: string;
  userId?: string;
  wallet?: WalletRecord | null;
  error?: string;
}> {
  if (!isSolanaAddress(walletAddress)) {
    return { ok: false, error: "Invalid Solana address" };
  }
  const body = JSON.stringify({
    wallet_address: walletAddress.trim(),
    walletAddress: walletAddress.trim(),
  });
  for (const base of await walletBases()) {
    const r = await tryFetchJson(`${base}${WALLET_PATHS.authWallet}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (r.ok) {
      const data = r.data as WalletAuthResponse;
      if (data.success === false) {
        return { ok: false, error: data.error ?? "Wallet auth failed" };
      }
      const token = data.token;
      if (!token) return { ok: false, error: "No token in wallet auth response" };
      const user = data.user;
      const grudgeId =
        data.grudgeId ??
        user?.grudgeId ??
        (user as { grudge_id?: string } | undefined)?.grudge_id;
      const username =
        user?.username ??
        `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`;
      const userId = user?.id ?? user?.userId ?? walletAddress;
      const addr = data.account?.walletAddress ?? walletAddress.trim();
      return {
        ok: true,
        token,
        grudgeId: grudgeId ?? undefined,
        username,
        userId: userId ? String(userId) : walletAddress,
        wallet: {
          address: addr,
          chain: "solana",
          provider: data.account?.walletType ?? "external",
          walletType: data.account?.walletType ?? "external",
          gbuxBalance: data.account?.gbuxBalance,
        },
      };
    }
  }
  return { ok: false, error: "Wallet auth unreachable" };
}

export async function getGbuxBalance(grudgeId: string): Promise<{
  ok: boolean;
  balance: number | null;
  source?: string;
  error?: string;
}> {
  // Prefer wallet status / overview (authoritative account balance)
  const w = await getPlayerWallet(grudgeId);
  if (w.gbuxBalance != null) {
    return { ok: true, balance: Number(w.gbuxBalance), source: w.source };
  }

  const headers = await authHeaders();
  const urls = [
    `${ECONOMY_API_URLS.aiHub}/balance?grudgeId=${encodeURIComponent(grudgeId)}`,
    `${GAME_API_URL}/api/economy/balance?grudgeId=${encodeURIComponent(grudgeId)}`,
    `${GAME_API_URL}/api/economy/gbux/${encodeURIComponent(grudgeId)}`,
  ];
  for (const url of urls) {
    const r = await tryFetchJson(url, { headers });
    if (r.ok) {
      const body = r.data as { balance?: number; gbux?: number; amount?: number; gbuxBalance?: number };
      const balance = body.balance ?? body.gbux ?? body.amount ?? body.gbuxBalance ?? null;
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
  if (!isSolanaAddress(input.toAddress)) {
    return { ok: false, message: "Invalid recipient Solana address" };
  }

  const treasury = await readCf("aleAdminWallet");
  const r = await tryFetchJson(`${GAME_API_URL}/api/economy/transfer`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      toAddress: input.toAddress.trim(),
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
  const trimmed = address.trim();
  if (trimmed && !isSolanaAddress(trimmed)) {
    throw new Error("Invalid Solana treasury address");
  }
  await writeCf("aleAdminWallet", trimmed);
}
