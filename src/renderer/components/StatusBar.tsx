import React, { useEffect, useState } from "react";
import { Wifi, WifiOff, RefreshCw, Download, FileText } from "lucide-react";

export interface ConnectivityState {
  reachable: boolean;
  online: boolean;
  apiBaseUrl: string;
  lastCheckedAt: number;
  latencyMs: number | null;
  status: number | null;
  error: string | null;
}

interface UpdaterStatus {
  phase?: "available" | "downloading" | "ready" | "error" | "none";
  version?: string;
  percent?: number;
  error?: string;
}

export function StatusDot({ state }: { state: "ok" | "warn" | "bad" | "idle" }) {
  const cls =
    state === "ok"   ? "bg-ok shadow-[0_0_6px_#46d586]" :
    state === "warn" ? "bg-gold animate-pulse-dot" :
    state === "bad"  ? "bg-danger" :
                       "bg-muted/40";
  return <span className={`inline-block w-2 h-2 rounded-full ${cls}`} aria-hidden />;
}

export default function StatusBar({ compact = false }: { compact?: boolean }) {
  const [conn, setConn] = useState<ConnectivityState | null>(null);
  const [upd, setUpd] = useState<UpdaterStatus | null>(null);

  useEffect(() => {
    let off1: (() => void) | undefined;
    let off2: (() => void) | undefined;
    (async () => {
      try {
        const initial = await window.grudge?.connectivity?.get?.();
        if (initial) setConn(initial);
      } catch { /* ignore */ }
      off1 = window.grudge?.connectivity?.onChange?.((s: any) => setConn(s));
      off2 = window.grudge?.updater?.onStatus?.((s: any) => setUpd(s));
    })();
    return () => { off1?.(); off2?.(); };
  }, []);

  const dot: "ok" | "warn" | "bad" | "idle" =
    !conn ? "idle"
    : !conn.online ? "bad"
    : conn.reachable ? "ok"
    : "warn";

  const label = !conn ? "checking…"
    : !conn.online ? "offline"
    : conn.reachable ? `online · ${conn.latencyMs ?? 0}ms`
    : "API unreachable";

  if (compact) {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-muted">
        <StatusDot state={dot} />
        <span>{conn?.online ? (conn.reachable ? "live" : "demo") : "offline"}</span>
      </span>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 text-[11px] text-muted border-t border-line bg-bg-1/60">
      <span className="flex items-center gap-1.5">
        <StatusDot state={dot} />
        {conn?.online ? <Wifi size={12} /> : <WifiOff size={12} />}
        <span title={conn?.error ?? ""}>{label}</span>
      </span>
      <span className="opacity-50">·</span>
      <span className="font-mono truncate max-w-[280px]" title={conn?.apiBaseUrl}>
        {conn?.apiBaseUrl ?? "—"}
      </span>
      <button
        className="ml-auto flex items-center gap-1 hover:text-gold transition-colors"
        onClick={() => window.grudge?.diag?.openLogFolder?.()}
        title="Open log folder"
      >
        <FileText size={12} /> logs
      </button>
      {upd?.phase && upd.phase !== "none" && (
        <span className="flex items-center gap-1 text-gold">
          {upd.phase === "downloading" && <Download size={12} />}
          {upd.phase === "ready" && <RefreshCw size={12} />}
          {upd.phase === "downloading" ? `update ${Math.round(upd.percent ?? 0)}%` :
           upd.phase === "available"   ? `update ${upd.version}` :
           upd.phase === "ready"       ? `update ready (restart)` :
           upd.phase === "error"       ? `update err` :
                                          ""}
        </span>
      )}
    </div>
  );
}
