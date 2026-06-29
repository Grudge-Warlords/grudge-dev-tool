import React, { useCallback, useEffect, useState } from "react";
import {
  User, Wallet, Coins, ShieldCheck, ExternalLink, Copy, RefreshCw,
  Loader2, Wrench, Server, AlertTriangle,
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
import { runTruthAudit } from "../../shared/fleet";
import { FLEET_CLIENT_URL } from "../../shared/fleet";

export default function Accounts() {
  const [session, setSession] = useState<any>(null);
  const [wallet, setWallet] = useState<{ address: string; chain?: string } | null>(null);
  const [walletStatus, setWalletStatus] = useState<string>("");
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

  const role = getAdminRole(session);
  const isAdmin = role === "admin";

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [s, t, paths, ale, settings] = await Promise.all([
        window.grudge.auth.getSession(),
        window.grudge.settings.toolchain(),
        window.grudge.accounts.getToolPaths(),
        window.grudge.accounts.getAleWallet(),
        window.grudge.settings.get(),
      ]);
      setSession(s);
      setTools(t);
      setToolPaths(paths);
      setAleWallet(ale ?? "");
      setApiBase(settings.apiBaseUrl ?? FLEET_CLIENT_URL);

      if (s?.grudgeId) {
        const w = await window.grudge.accounts.wallet(s.grudgeId);
        setWalletStatus(w.status);
        setWallet(w.wallet ?? null);

        const bal = await window.grudge.accounts.gbuxBalance(s.grudgeId);
        setGbuxBalance(bal.ok ? bal.balance : null);
        setGbuxError(bal.ok ? null : (bal.error ?? "Unavailable"));
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
    if (!session?.grudgeId) return;
    setBusy(true);
    try {
      const r = await window.grudge.accounts.provisionWallet({
        grudgeId: session.grudgeId,
        email: session.puterUser?.email,
      });
      if (r.ok) {
        setWallet(r.wallet);
        setWalletStatus("ready");
        toast.success("Grudge wallet provisioned");
      } else toast.error("Provision failed", { description: r.error });
    } finally {
      setBusy(false);
    }
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

  async function saveToolPath(key: "blender" | "ffmpeg" | "blenderkit") {
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
            <Wallet size={16} /> Grudge Wallet
          </h2>
          <p className="text-xs text-muted mb-3">
            Server-side Solana MPC wallet (Crossmint). Syncs across Warlords, Survival, and fleet games.
          </p>
          {wallet?.address ? (
            <>
              <div className="font-mono text-xs break-all bg-bg-2 p-2 rounded">{wallet.address}</div>
              <div className="flex gap-2 mt-2">
                <button type="button" className="btn ghost text-xs" onClick={() => copy(wallet.address, "wallet")}>
                  <Copy size={12} /> Copy
                </button>
                <button type="button" className="btn ghost text-xs" onClick={() => void window.grudge.os.openExternal("https://grudgewarlords.com/wallet")}>
                  <ExternalLink size={12} /> Full wallet UI
                </button>
              </div>
              <div className="text-[10px] text-muted mt-2">Status: {walletStatus} · {wallet.chain ?? "solana"}</div>
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted">No wallet yet ({walletStatus || "unknown"}).</p>
              <button type="button" className="btn" disabled={busy} onClick={() => void onProvisionWallet()}>
                Provision Grudge Wallet
              </button>
            </div>
          )}
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
            Purchases route through api.grudge-studio.com with ALE Legion agent fallback for fulfillment.
          </p>
        </div>
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
          {(["blender", "ffmpeg", "blenderkit"] as const).map((k) => (
            <button key={k} type="button" className="btn ghost text-xs" onClick={() => void saveToolPath(k)}>
              Set {k} path
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted mt-2">
          gltf-transform ships with Forge. Point Blender/ffmpeg/BlenderKit at your local installs if not on PATH.
        </p>
      </div>

      {isAdmin && (
        <div className="card border-gold/30">
          <h2 className="text-gold font-semibold flex items-center gap-2 mb-3">
            <ShieldCheck size={16} /> Admin — ALE agent treasury
          </h2>
          <p className="text-xs text-muted mb-3">
            Operators: grudachain / grudgedev@gmail.com · molochdadev / jonbemmons@gmail.com
          </p>
          <label className="text-xs text-muted">ALE admin agent wallet (Solana)</label>
          <div className="flex gap-2 mt-1 mb-3">
            <input className="flex-1 font-mono text-xs" value={aleWallet} onChange={(e) => setAleWallet(e.target.value)} placeholder="Treasury pubkey for GBUX fulfillment" />
            <button type="button" className="btn ghost text-xs" onClick={() => void saveAleWallet()}>Save</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <input className="font-mono text-xs sm:col-span-2" placeholder="Recipient Solana address" value={transferTo} onChange={(e) => setTransferTo(e.target.value)} />
            <input className="font-mono text-xs" placeholder="Amount GBUX" value={transferAmt} onChange={(e) => setTransferAmt(e.target.value)} />
          </div>
          <button type="button" className="btn mt-2" disabled={busy} onClick={() => void onAdminTransfer()}>
            Transfer GBUX (ALE admin)
          </button>
        </div>
      )}
    </div>
  );
}