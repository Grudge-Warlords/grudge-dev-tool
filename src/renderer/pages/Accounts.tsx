import React, { useCallback, useEffect, useState } from "react";
import {
  User, Wallet, Coins, ShieldCheck, ExternalLink, Copy, RefreshCw,
  Loader2, Wrench, Server, AlertTriangle, Gift, ArrowLeftRight, History,
  Link2, LogIn, Unplug,
} from "lucide-react";
import { toast } from "sonner";
import { getAdminRole } from "../lib/admin";
import {
  GRUDGE_SERVICES,
  GBUX_PURCHASE_PACKS,
  GBUX_TOKEN_MINT,
  GBUX_SOLSCAN,
  ACCOUNT_PAGE_URL,
} from "../../shared/grudgeEconomy";
import {
  SWAP_PAIRS,
  WEB3_BEST_PRACTICES,
  solscanTxUrl,
  solscanAccountUrl,
  type EconomyReward,
  type LedgerEntry,
  type SwapQuote,
} from "../../shared/web3";
import {
  WALLET_BEST_PRACTICES,
  WALLET_DASHBOARD_URL,
  WALLET_SITE_URL,
  isSolanaAddress,
} from "../../shared/walletBestPractices";
import {
  connectSolanaWallet,
  listAvailableSolanaProviders,
  openWalletSites,
  shortAddress,
  signSolanaMessage,
  type SolanaProviderName,
} from "../lib/solanaWallet";
import { runTruthAudit } from "../../shared/fleet";
import { FLEET_CLIENT_URL } from "../../shared/fleet";

export default function Accounts() {
  const [session, setSession] = useState<any>(null);
  const [wallet, setWallet] = useState<{
    address: string;
    chain?: string;
    provider?: string;
    walletType?: string | null;
  } | null>(null);
  const [walletStatus, setWalletStatus] = useState<string>("");
  const [linkedWallets, setLinkedWallets] = useState<
    Array<{ walletAddress: string; provider: string; isPrimary?: boolean; label?: string | null }>
  >([]);
  const [externalAddress, setExternalAddress] = useState("");
  const [provisionEmail, setProvisionEmail] = useState("");
  const [walletLoginAddr, setWalletLoginAddr] = useState("");
  const [walletConfig, setWalletConfig] = useState<{
    network?: string;
    crossmintEnabled?: boolean;
    gbuxMint?: string;
  } | null>(null);
  const [availableProviders, setAvailableProviders] = useState<SolanaProviderName[]>([]);
  const [gbuxBalance, setGbuxBalance] = useState<number | null>(null);
  const [gbuxError, setGbuxError] = useState<string | null>(null);
  const [truthScore, setTruthScore] = useState<number | null>(null);
  const [tools, setTools] = useState<any[]>([]);
  const [toolPaths, setToolPaths] = useState<Record<string, string | null>>({});
  const [aleWallet, setAleWallet] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferAmt, setTransferAmt] = useState("100");
  const [busy, setBusy] = useState(false);
  const [apiBase, setApiBase] = useState(FLEET_CLIENT_URL);
  const [rewards, setRewards] = useState<EconomyReward[]>([]);
  const [rewardsError, setRewardsError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [swapPairId, setSwapPairId] = useState(SWAP_PAIRS[0]?.id ?? "gbux_sol");
  const [swapAmount, setSwapAmount] = useState("100");
  const [swapQuote, setSwapQuote] = useState<SwapQuote | null>(null);
  const [grantAmt, setGrantAmt] = useState("100");
  const [grantTitle, setGrantTitle] = useState("Forge operator grant");

  const role = getAdminRole(session);
  const isAdmin = role === "admin";

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setAvailableProviders(listAvailableSolanaProviders());
      const [s, t, paths, ale, settings, cfg] = await Promise.all([
        window.grudge.auth.getSession(),
        window.grudge.settings.toolchain(),
        window.grudge.accounts.getToolPaths(),
        window.grudge.accounts.getAleWallet(),
        window.grudge.settings.get(),
        window.grudge.accounts.walletConfig?.().catch(() => null),
      ]);
      setSession(s);
      setTools(t);
      setToolPaths(paths);
      setAleWallet(ale ?? "");
      setApiBase(settings.apiBaseUrl ?? FLEET_CLIENT_URL);
      if (cfg?.ok) setWalletConfig(cfg.config);
      if (s?.puterUser?.email) setProvisionEmail((prev) => prev || s.puterUser.email);

      if (s?.grudgeId || s?.signedIn) {
        const w = await window.grudge.accounts.wallet(s.grudgeId ?? "");
        setWalletStatus(w.status);
        setWallet(w.wallet ?? null);
        setLinkedWallets(w.linked ?? w.overview?.linkedWallets ?? []);

        const bal = await window.grudge.accounts.gbuxBalance(s.grudgeId ?? "");
        setGbuxBalance(
          bal.ok ? bal.balance : (w.gbuxBalance ?? w.wallet?.gbuxBalance ?? null),
        );
        setGbuxError(bal.ok || w.gbuxBalance != null ? null : (bal.error ?? "Unavailable"));

        if (s.grudgeId) {
          const rw = await window.grudge.accounts.listRewards(s.grudgeId);
          setRewards(rw.ok ? rw.rewards : []);
          setRewardsError(rw.ok ? null : (rw.error ?? "Unavailable"));

          const lg = await window.grudge.accounts.ledger(s.grudgeId, 30);
          setLedger(lg.ok ? lg.entries : []);
          setLedgerError(lg.ok ? null : (lg.error ?? "Unavailable"));
        }
      }

      const audit = await runTruthAudit(settings.apiBaseUrl ?? FLEET_CLIENT_URL);
      setTruthScore(audit.score);
    } catch (e: unknown) {
      toast.error("Accounts refresh failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function onProvisionWallet() {
    if (!session?.grudgeId && !session?.signedIn) {
      toast.error("Sign in first (Puter / Grudge ID / wallet)");
      return;
    }
    const email = provisionEmail.trim() || session?.puterUser?.email;
    if (!email) {
      toast.error("Email required for Crossmint custodial wallet");
      return;
    }
    setBusy(true);
    try {
      const r = await window.grudge.accounts.provisionWallet({
        grudgeId: session.grudgeId ?? "",
        email,
      });
      if (r.ok) {
        setWallet(r.wallet);
        setWalletStatus("ready");
        toast.success("Custodial wallet provisioned", {
          description: r.message ?? r.wallet?.address,
        });
        void refresh();
      } else toast.error("Provision failed", { description: r.error });
    } finally {
      setBusy(false);
    }
  }

  async function loginWithWalletAddress(addr: string): Promise<boolean> {
    const r = await window.grudge.accounts.loginWithWallet(addr);
    if (r.ok) {
      toast.success("Signed in with Solana wallet", {
        description: r.grudgeId ?? shortAddress(addr),
      });
      setWalletLoginAddr(addr);
      if (r.wallet) setWallet(r.wallet);
      await refresh();
      return true;
    }
    toast.error("Wallet login failed", { description: r.error });
    return false;
  }

  async function onWalletLogin(address?: string) {
    const addr = (address ?? walletLoginAddr).trim();
    if (!isSolanaAddress(addr)) {
      toast.error("Enter a valid Solana address");
      return;
    }
    setBusy(true);
    try {
      await loginWithWalletAddress(addr);
    } finally {
      setBusy(false);
    }
  }

  async function onConnectAndLogin(provider: SolanaProviderName) {
    setBusy(true);
    try {
      const { address } = await connectSolanaWallet(provider);
      setExternalAddress(address);
      setWalletLoginAddr(address);
      await loginWithWalletAddress(address);
    } catch (e: unknown) {
      toast.error("Connect failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  async function onLinkExternal(provider: SolanaProviderName = "phantom") {
    if (!session?.signedIn) {
      toast.error("Sign in first, then link a third-party wallet");
      return;
    }
    setBusy(true);
    try {
      const { address } = await connectSolanaWallet(provider);
      setExternalAddress(address);
      const challenge = await window.grudge.accounts.linkChallenge(address);
      if (!challenge.ok || !challenge.message) {
        toast.error("Link challenge failed", { description: challenge.error });
        return;
      }
      const signature = await signSolanaMessage(challenge.message, provider);
      const confirm = await window.grudge.accounts.linkConfirm({
        walletAddress: address,
        message: challenge.message,
        signature,
        provider,
      });
      if (confirm.ok) {
        toast.success("Third-party wallet linked", { description: shortAddress(address) });
        void refresh();
      } else {
        toast.error("Link confirm failed", { description: confirm.error });
      }
    } catch (e: unknown) {
      toast.error("Link wallet failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  async function onLinkManualAddress() {
    const addr = externalAddress.trim();
    if (!isSolanaAddress(addr)) {
      toast.error("Invalid Solana address");
      return;
    }
    if (!session?.signedIn) {
      toast.error("Sign in first");
      return;
    }
    // Without extension, open sites for user to complete link in browser
    toast.message("Signature required", {
      description: "Install Phantom/Solflare, or complete link on wallet.grudge-studio.com",
    });
    openWalletSites();
  }

  async function onPurchase(packId: string) {
    if (!session?.grudgeId) return;
    setBusy(true);
    try {
      const r = await window.grudge.accounts.gbuxPurchase({
        packId,
        grudgeId: session.grudgeId,
        walletAddress: wallet?.address,
      });
      if (r.ok) toast.success("GBUX purchase", { description: r.message });
      else toast.error("Purchase failed", { description: r.message });
    } finally {
      setBusy(false);
    }
  }

  async function onAdminTransfer() {
    const amount = Number(transferAmt);
    if (!transferTo.trim() || !Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter valid address and amount");
      return;
    }
    setBusy(true);
    try {
      const r = await window.grudge.accounts.gbuxTransfer({
        toAddress: transferTo.trim(),
        amount,
        memo: `Forge admin → ${session?.puterUser?.username ?? "user"}`,
      });
      if (r.ok) toast.success("ALE transfer submitted", { description: r.message });
      else toast.error("Transfer failed", { description: r.message });
    } finally {
      setBusy(false);
    }
  }

  async function saveToolPath(key: "blender" | "ffmpeg" | "blenderkit" | "fbx2gltf") {
    const current = toolPaths[key] ?? "";
    const next = prompt(`Path to ${key} executable/folder:`, current) ?? null;
    if (next === null) return;
    await window.grudge.accounts.setToolPath(key, next.trim() || null);
    toast.success(`${key} path saved`);
    void refresh();
  }

  async function saveAleWallet() {
    await window.grudge.accounts.setAleWallet(aleWallet.trim());
    toast.success("ALE admin treasury wallet saved");
  }

  async function onClaimReward(rewardId: string) {
    if (!session?.grudgeId) return;
    setBusy(true);
    try {
      const r = await window.grudge.accounts.claimReward({
        grudgeId: session.grudgeId,
        rewardId,
        walletAddress: wallet?.address,
      });
      if (r.ok) {
        toast.success("Reward claimed", { description: r.message });
        void refresh();
      } else toast.error("Claim failed", { description: r.message });
    } finally {
      setBusy(false);
    }
  }

  async function onSwapQuote() {
    if (!session?.grudgeId) return;
    const fromAmount = Number(swapAmount);
    if (!Number.isFinite(fromAmount) || fromAmount <= 0) {
      toast.error("Enter a valid swap amount");
      return;
    }
    setBusy(true);
    try {
      const r = await window.grudge.accounts.swapQuote({
        grudgeId: session.grudgeId,
        pairId: swapPairId,
        fromAmount,
      });
      if (r.ok && r.quote) {
        setSwapQuote(r.quote);
        toast.success("Quote ready", {
          description: `${r.quote.fromAmount} → ${r.quote.toAmount.toFixed(6)}`,
        });
      } else toast.error("Quote failed", { description: r.error ?? "Unavailable" });
    } finally {
      setBusy(false);
    }
  }

  async function onSwapExecute() {
    if (!session?.grudgeId || !swapQuote) return;
    setBusy(true);
    try {
      const r = await window.grudge.accounts.swapExecute({
        grudgeId: session.grudgeId,
        quoteId: swapQuote.quoteId,
        walletAddress: wallet?.address,
      });
      if (r.ok) {
        toast.success("Swap submitted", { description: r.message });
        setSwapQuote(null);
        void refresh();
      } else toast.error("Swap failed", { description: r.message });
    } finally {
      setBusy(false);
    }
  }

  async function onAdminGrant() {
    if (!session?.grudgeId) return;
    const amount = Number(grantAmt);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter valid grant amount");
      return;
    }
    setBusy(true);
    try {
      const r = await window.grudge.accounts.grantReward({
        grudgeId: session.grudgeId,
        rewardType: "admin",
        amount,
        sourceGame: "forge",
        title: grantTitle.trim() || "Operator grant",
        description: `Granted by ${session.puterUser?.username ?? "admin"}`,
      });
      if (r.ok) {
        toast.success("Reward granted", { description: r.message });
        void refresh();
      } else toast.error("Grant failed", { description: r.message });
    } finally {
      setBusy(false);
    }
  }

  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(() => toast.success(`Copied ${label}`));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <User size={20} /> Accounts & Systems
          </h1>
          <p className="page-sub">
            Canonical Grudge ID, Solana wallet, GBUX economy, and fleet health — your Steam-style account hub.
          </p>
        </div>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => void refresh()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
        </button>
      </div>

      <div className="card flex flex-wrap gap-4 items-center">
        <div>
          <div className="text-xs text-muted">Your role</div>
          <div className={`font-semibold flex items-center gap-2 ${isAdmin ? "text-gold" : ""}`}>
            {isAdmin ? <ShieldCheck size={16} /> : <User size={16} />}
            {isAdmin ? "Admin / Dev Operator" : "Customer"}
          </div>
        </div>
        {session?.signedIn && (
          <>
            <div>
              <div className="text-xs text-muted">Grudge ID</div>
              <div className="font-mono text-sm text-gold">{session.grudgeId}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Puter</div>
              <div className="text-sm">{session.puterUser?.username}</div>
              {session.puterUser?.email && (
                <div className="text-[10px] text-muted">{session.puterUser.email}</div>
              )}
            </div>
          </>
        )}
        <button type="button" className="btn ghost text-xs ml-auto" onClick={() => void window.grudge.os.openExternal(ACCOUNT_PAGE_URL)}>
          <ExternalLink size={12} /> id.grudge-studio.com/account
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="text-gold font-semibold flex items-center gap-2 mb-3">
            <Wallet size={16} /> Grudge Wallet (custodial + external)
          </h2>
          <p className="text-xs text-muted mb-3">
            Best practice: Crossmint MPC custodial wallet for game GBUX · optional Phantom/Solflare link for claims.
            Keys never leave the server. Play is never gated on wallet.
          </p>

          {/* Web3 login */}
          <div className="border border-line rounded p-2 mb-3 space-y-2">
            <div className="text-[11px] font-semibold text-ink flex items-center gap-1">
              <LogIn size={12} className="text-gold" /> Solana wallet login
            </div>
            <p className="text-[10px] text-muted">
              Admin or player: connect extension, or paste address → fleet JWT via{" "}
              <span className="font-mono">POST /api/auth/wallet</span>.
            </p>
            <div className="flex flex-wrap gap-1">
              {(availableProviders.length ? availableProviders : (["phantom", "solflare"] as SolanaProviderName[])).map(
                (p) => (
                  <button
                    key={p}
                    type="button"
                    className="btn ghost text-[10px]"
                    disabled={busy}
                    onClick={() => void onConnectAndLogin(p)}
                  >
                    Connect {p} + login
                  </button>
                ),
              )}
            </div>
            <div className="flex gap-1">
              <input
                className="flex-1 font-mono text-[10px]"
                placeholder="Or paste Solana address…"
                value={walletLoginAddr}
                onChange={(e) => setWalletLoginAddr(e.target.value)}
              />
              <button type="button" className="btn text-[10px]" disabled={busy} onClick={() => void onWalletLogin()}>
                Login
              </button>
            </div>
          </div>

          {wallet?.address ? (
            <>
              <div className="text-[10px] text-muted mb-1">
                Primary · {wallet.walletType ?? wallet.provider ?? "solana"} · {walletStatus}
              </div>
              <div className="font-mono text-xs break-all bg-bg-2 p-2 rounded">{wallet.address}</div>
              <div className="flex flex-wrap gap-2 mt-2">
                <button type="button" className="btn ghost text-xs" onClick={() => copy(wallet.address, "wallet")}>
                  <Copy size={12} /> Copy
                </button>
                <button
                  type="button"
                  className="btn ghost text-xs"
                  onClick={() => void window.grudge.os.openExternal(solscanAccountUrl(wallet.address))}
                >
                  <ExternalLink size={12} /> Solscan
                </button>
                <button
                  type="button"
                  className="btn ghost text-xs"
                  onClick={() => void window.grudge.os.openExternal(WALLET_DASHBOARD_URL)}
                >
                  Dashboard
                </button>
                <button
                  type="button"
                  className="btn ghost text-xs"
                  onClick={() => void window.grudge.os.openExternal(WALLET_SITE_URL)}
                >
                  wallet.grudge-studio.com
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-2 mb-2">
              <p className="text-sm text-muted">No custodial wallet yet ({walletStatus || "unknown"}).</p>
            </div>
          )}

          {/* Provision custodial */}
          <div className="border border-line rounded p-2 mt-3 space-y-2">
            <div className="text-[11px] font-semibold">Provision Crossmint MPC wallet</div>
            <input
              className="w-full font-mono text-[10px]"
              placeholder="Email for Crossmint (required)"
              value={provisionEmail}
              onChange={(e) => setProvisionEmail(e.target.value)}
            />
            <button type="button" className="btn w-full text-xs" disabled={busy} onClick={() => void onProvisionWallet()}>
              Provision Grudge Wallet
            </button>
            {walletConfig && (
              <p className="text-[10px] text-muted">
                Network {walletConfig.network ?? "mainnet-beta"} · Crossmint{" "}
                {walletConfig.crossmintEnabled ? "enabled" : "flag off (server may still provision)"} · mint{" "}
                {(walletConfig.gbuxMint ?? GBUX_TOKEN_MINT).slice(0, 8)}…
              </p>
            )}
          </div>

          {/* Link third-party */}
          <div className="border border-line rounded p-2 mt-3 space-y-2">
            <div className="text-[11px] font-semibold flex items-center gap-1">
              <Link2 size={12} className="text-gold" /> Link third-party wallet
            </div>
            <p className="text-[10px] text-muted">
              Phantom / Solflare sign-message challenge · does not replace custodial game wallet.
            </p>
            <div className="flex flex-wrap gap-1">
              <button type="button" className="btn ghost text-[10px]" disabled={busy} onClick={() => void onLinkExternal("phantom")}>
                Link Phantom
              </button>
              <button type="button" className="btn ghost text-[10px]" disabled={busy} onClick={() => void onLinkExternal("solflare")}>
                Link Solflare
              </button>
              <button type="button" className="btn ghost text-[10px]" onClick={() => openWalletSites()}>
                Open wallet sites
              </button>
            </div>
            <div className="flex gap-1">
              <input
                className="flex-1 font-mono text-[10px]"
                placeholder="Manual address (needs extension to sign)"
                value={externalAddress}
                onChange={(e) => setExternalAddress(e.target.value)}
              />
              <button type="button" className="btn ghost text-[10px]" disabled={busy} onClick={() => void onLinkManualAddress()}>
                Help
              </button>
            </div>
            {linkedWallets.length > 0 && (
              <ul className="text-[10px] space-y-1 max-h-24 overflow-auto">
                {linkedWallets.map((lw) => (
                  <li key={lw.walletAddress} className="font-mono flex justify-between gap-2">
                    <span className="truncate">{shortAddress(lw.walletAddress)}</span>
                    <span className="text-muted">{lw.provider}{lw.isPrimary ? " · primary" : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="card">
          <h2 className="text-gold font-semibold flex items-center gap-2 mb-3">
            <Coins size={16} /> GBUX
          </h2>
          <p className="text-xs text-muted mb-2">
            On-chain utility token · mint{" "}
            <button type="button" className="text-gold font-mono text-[10px]" onClick={() => void window.grudge.os.openExternal(GBUX_SOLSCAN)}>
              {GBUX_TOKEN_MINT.slice(0, 8)}…
            </button>
          </p>
          {gbuxBalance != null ? (
            <div className="text-2xl font-bold text-gold mb-2">{gbuxBalance.toLocaleString()} GBUX</div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted mb-2">
              <AlertTriangle size={14} /> {gbuxError ?? "Balance unavailable"}
            </div>
          )}
          <div className="grid gap-2 mt-3">
            {GBUX_PURCHASE_PACKS.map((pack) => (
              <button
                key={pack.id}
                type="button"
                className="border border-line rounded p-2 text-left hover:border-gold/50 transition-colors"
                disabled={busy}
                onClick={() => void onPurchase(pack.id)}
              >
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-sm">{pack.label}</span>
                  <span className="text-gold text-sm">{pack.gbux} GBUX</span>
                </div>
                <div className="text-[10px] text-muted">{pack.description} · {pack.usdHint}</div>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted mt-2">
            Purchases route through client.grudge-studio.com / Railway game-data with ALE Legion agent fallback for fulfillment.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="text-gold font-semibold flex items-center gap-2 mb-3">
            <Gift size={16} /> Rewards inbox
          </h2>
          <p className="text-xs text-muted mb-3">
            Server-side GBUX rewards from quests, events, and fleet games. Claim credits your MPC wallet.
          </p>
          {rewardsError && (
            <div className="flex items-center gap-2 text-sm text-muted mb-2">
              <AlertTriangle size={14} /> {rewardsError}
            </div>
          )}
          {rewards.length === 0 ? (
            <p className="text-sm text-muted">No pending rewards.</p>
          ) : (
            <ul className="space-y-2 max-h-48 overflow-y-auto">
              {rewards.map((rw) => (
                <li key={rw.id} className="border border-line rounded p-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold">{rw.title}</span>
                    <span className="text-gold">{rw.amount} GBUX</span>
                  </div>
                  <div className="text-muted">{rw.sourceGame} · {rw.rewardType}</div>
                  {rw.status === "pending" ? (
                    <button
                      type="button"
                      className="btn ghost text-[10px] mt-1"
                      disabled={busy}
                      onClick={() => void onClaimReward(rw.id)}
                    >
                      Claim
                    </button>
                  ) : (
                    <span className="text-[10px] text-muted">{rw.status}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2 className="text-gold font-semibold flex items-center gap-2 mb-3">
            <ArrowLeftRight size={16} /> Token swap
          </h2>
          <p className="text-xs text-muted mb-3">
            GBUX ↔ SOL/USDC via fleet Jupiter proxy. Quotes expire in 60s.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 mb-2">
            <select
              className="text-xs font-mono"
              value={swapPairId}
              onChange={(e) => { setSwapPairId(e.target.value); setSwapQuote(null); }}
            >
              {SWAP_PAIRS.filter((p) => p.enabled).map((p) => (
                <option key={p.id} value={p.id}>{p.fromSymbol} → {p.toSymbol}</option>
              ))}
            </select>
            <input
              className="font-mono text-xs"
              placeholder="Amount"
              value={swapAmount}
              onChange={(e) => { setSwapAmount(e.target.value); setSwapQuote(null); }}
            />
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn ghost text-xs" disabled={busy} onClick={() => void onSwapQuote()}>
              Get quote
            </button>
            <button
              type="button"
              className="btn text-xs"
              disabled={busy || !swapQuote}
              onClick={() => void onSwapExecute()}
            >
              Execute swap
            </button>
          </div>
          {swapQuote && (
            <div className="text-[10px] text-muted mt-2 font-mono">
              {swapQuote.fromAmount} {SWAP_PAIRS.find((p) => p.id === swapQuote.pairId)?.fromSymbol} →{" "}
              {swapQuote.toAmount.toFixed(6)} · fee {swapQuote.feeGbux} GBUX
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2 className="text-gold font-semibold flex items-center gap-2 mb-3">
          <History size={16} /> Transaction history
        </h2>
        {ledgerError && (
          <div className="flex items-center gap-2 text-sm text-muted mb-2">
            <AlertTriangle size={14} /> {ledgerError}
          </div>
        )}
        {ledger.length === 0 ? (
          <p className="text-sm text-muted">No ledger entries yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="text-left">When</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ledger.map((e) => (
                <tr key={e.id}>
                  <td className="text-muted">{new Date(e.createdAt).toLocaleString()}</td>
                  <td>{e.type} ({e.direction})</td>
                  <td className="text-gold">{e.amount} GBUX</td>
                  <td>{e.status}</td>
                  <td>
                    {e.txSignature && (
                      <button
                        type="button"
                        className="text-gold"
                        onClick={() => void window.grudge.os.openExternal(solscanTxUrl(e.txSignature!))}
                      >
                        <ExternalLink size={10} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card border-line/50">
        <h2 className="text-gold font-semibold text-sm mb-2">Wallet & Web3 best practices</h2>
        <ul className="text-[10px] text-muted grid sm:grid-cols-2 gap-1">
          {WALLET_BEST_PRACTICES.rules.map((rule) => (
            <li key={rule.slice(0, 40)}>• {rule}</li>
          ))}
          <li>• Max transfer {WEB3_BEST_PRACTICES.maxSingleTransferGbux.toLocaleString()} GBUX / tx</li>
          <li>• Max daily {WEB3_BEST_PRACTICES.maxDailyGbuxPerUser.toLocaleString()} GBUX per user</li>
          <li>• Economy rate limit {WEB3_BEST_PRACTICES.economyRateLimitPerMinute}/min</li>
          <li>• Provider: {WEB3_BEST_PRACTICES.walletProvider} · never store keys client-side</li>
        </ul>
      </div>

      <div className="card">
        <h2 className="text-gold font-semibold flex items-center gap-2 mb-3">
          <Server size={16} /> Fleet systems
        </h2>
        <div className="text-sm mb-2">
          ONE TRUTH score:{" "}
          <span className={truthScore != null && truthScore >= 85 ? "text-green-400" : "text-amber-400"}>
            {truthScore ?? "…"}%
          </span>
          {" "}· client <span className="font-mono text-xs">{apiBase}</span>
        </div>
        <ul className="grid gap-1 sm:grid-cols-2 text-xs">
          {GRUDGE_SERVICES.map((s) => (
            <li key={s.id} className="flex items-center justify-between border border-line rounded px-2 py-1">
              <span>{s.label}</span>
              <button type="button" className="text-gold" onClick={() => void window.grudge.os.openExternal(s.url)}>
                <ExternalLink size={10} />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2 className="text-gold font-semibold flex items-center gap-2 mb-3">
          <Wrench size={16} /> Toolchain
        </h2>
        <table className="w-full text-xs mb-3">
          <thead><tr><th className="text-left">Tool</th><th>Status</th><th>Detail</th></tr></thead>
          <tbody>
            {tools.map((t) => (
              <tr key={t.name}>
                <td>{t.name}</td>
                <td className={t.available ? "text-green-400" : "text-red-400"}>{t.available ? "ok" : "missing"}</td>
                <td className="text-muted font-mono text-[10px] truncate max-w-[200px]">{t.path ?? t.reason ?? t.version ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap gap-2">
          {(["fbx2gltf", "blender", "ffmpeg", "blenderkit"] as const).map((k) => (
            <button key={k} type="button" className="btn ghost text-xs" onClick={() => void saveToolPath(k)}>
              Set {k} path
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted mt-2">
          FBX2glTF ships embedded for FBX→GLB (grudge6 / Mixamo). Override paths for Blender, ffmpeg, or BlenderKit if not on PATH.
        </p>
      </div>

      {isAdmin && (
        <div className="card border-gold/30">
          <h2 className="text-gold font-semibold flex items-center gap-2 mb-3">
            <ShieldCheck size={16} /> Admin — grudachain wallet provision
          </h2>
          <p className="text-xs text-muted mb-3">
            Operators: grudachain / grudgedev@gmail.com · molochdadev / jonbemmons@gmail.com · ALE treasury for
            GBUX fulfillment &amp; cNFT escrow (play never gated on claim).
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              type="button"
              className="btn text-xs"
              disabled={busy}
              onClick={() => void onProvisionWallet()}
            >
              Provision my custodial wallet
            </button>
            <button
              type="button"
              className="btn ghost text-xs"
              disabled={busy}
              onClick={() => void onConnectAndLogin("phantom")}
            >
              <Unplug size={12} /> Admin login with Phantom
            </button>
          </div>
          <label className="text-xs text-muted">ALE admin / escrow treasury (Solana)</label>
          <div className="flex gap-2 mt-1 mb-3">
            <input className="flex-1 font-mono text-xs" value={aleWallet} onChange={(e) => setAleWallet(e.target.value)} placeholder="AI_AGENT_WALLET / treasury pubkey" />
            <button type="button" className="btn ghost text-xs" onClick={() => void saveAleWallet()}>Save</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <input className="font-mono text-xs sm:col-span-2" placeholder="Recipient Solana address" value={transferTo} onChange={(e) => setTransferTo(e.target.value)} />
            <input className="font-mono text-xs" placeholder="Amount GBUX" value={transferAmt} onChange={(e) => setTransferAmt(e.target.value)} />
          </div>
          <button type="button" className="btn mt-2" disabled={busy} onClick={() => void onAdminTransfer()}>
            Transfer GBUX (ALE admin)
          </button>
          <div className="border-t border-line mt-4 pt-3">
            <div className="text-xs text-muted mb-2">Grant pending reward (hub ledger)</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <input className="font-mono text-xs sm:col-span-2" placeholder="Title" value={grantTitle} onChange={(e) => setGrantTitle(e.target.value)} />
              <input className="font-mono text-xs" placeholder="GBUX" value={grantAmt} onChange={(e) => setGrantAmt(e.target.value)} />
            </div>
            <button type="button" className="btn ghost text-xs mt-2" disabled={busy} onClick={() => void onAdminGrant()}>
              Grant reward to current user
            </button>
          </div>
        </div>
      )}
    </div>
  );
}