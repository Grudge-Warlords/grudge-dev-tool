/**
 * Browser / Electron Solana wallet connect helpers.
 * Prefer extension injectors (Phantom / Solflare). Fallback: open wallet site.
 */

import { WALLET_DASHBOARD_URL, WALLET_SITE_URL, isSolanaAddress } from "../../shared/walletBestPractices";

export type SolanaProviderName = "phantom" | "solflare";

interface InjectedProvider {
  isPhantom?: boolean;
  isSolflare?: boolean;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toBase58(): string } | string }>;
  signMessage?: (message: Uint8Array, display?: string) => Promise<Uint8Array | { signature: Uint8Array }>;
  publicKey?: { toBase58(): string } | null;
  disconnect?: () => Promise<void>;
}

function getInjected(name: SolanaProviderName): InjectedProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    phantom?: { solana?: InjectedProvider };
    solana?: InjectedProvider;
    solflare?: InjectedProvider;
  };
  if (name === "phantom") {
    return w.phantom?.solana ?? (w.solana?.isPhantom ? w.solana : null);
  }
  return w.solflare?.isSolflare ? w.solflare : w.solflare ?? null;
}

export function listAvailableSolanaProviders(): SolanaProviderName[] {
  const out: SolanaProviderName[] = [];
  if (getInjected("phantom")) out.push("phantom");
  if (getInjected("solflare")) out.push("solflare");
  return out;
}

/** Base58 encode (no deps) for nacl signatures. */
export function base58Encode(bytes: Uint8Array): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  if (bytes.length === 0) return "";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const size = ((bytes.length - zeros) * 138) / 100 + 1;
  const b = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    let j = size - 1;
    for (; (carry !== 0 || j >= size - length) && j >= 0; j--) {
      carry += 256 * b[j];
      b[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    length = size - 1 - j;
  }
  let it = size - length;
  while (it < size && b[it] === 0) it++;
  let str = "1".repeat(zeros);
  for (; it < size; it++) str += ALPHABET[b[it]];
  return str;
}

export async function connectSolanaWallet(
  provider: SolanaProviderName = "phantom",
): Promise<{ address: string; provider: SolanaProviderName }> {
  const inj = getInjected(provider);
  if (!inj?.connect) {
    throw new Error(
      `${provider} not available in this window. Install the browser extension, or use "Open wallet site" / paste address.`,
    );
  }
  const resp = await inj.connect();
  const pk = resp.publicKey;
  const address =
    typeof pk === "string"
      ? pk
      : pk && typeof (pk as { toBase58?: () => string }).toBase58 === "function"
        ? (pk as { toBase58: () => string }).toBase58()
        : String(pk ?? "");
  if (!isSolanaAddress(address)) throw new Error("Invalid Solana address from wallet");
  return { address, provider };
}

export async function signSolanaMessage(
  message: string,
  provider: SolanaProviderName = "phantom",
): Promise<string> {
  const inj = getInjected(provider);
  if (!inj?.signMessage) {
    throw new Error(
      `${provider} signMessage unavailable. Install Phantom/Solflare extension for link verification.`,
    );
  }
  const encoded = new TextEncoder().encode(message);
  const signed = await inj.signMessage(encoded, "utf8");
  const bytes =
    signed instanceof Uint8Array
      ? signed
      : (signed as { signature: Uint8Array }).signature;
  return base58Encode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

export function openWalletSites(): void {
  void window.grudge.os.openExternal(WALLET_SITE_URL);
  void window.grudge.os.openExternal(WALLET_DASHBOARD_URL);
}

export function shortAddress(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}
