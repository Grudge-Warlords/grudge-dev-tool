import { getApiBaseUrl } from "./api";
import { getPuterToken } from "./auth/puterSession";
import { readCf, writeCf } from "./cf/credentials";
import * as legion from "./legion/orchestrator";
import {
  GAME_API_URL,
  GAME_DATA_URL,
  GBUX_PURCHASE_PACKS,
} from "../shared/grudgeEconomy";

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