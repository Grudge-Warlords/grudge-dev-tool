import React, { useEffect, useState } from "react";
import { Wifi, WifiOff, RefreshCw, Download, FileText, ShieldCheck, Bot } from "lucide-react";

export interface ConnectivityState {
  reachable: boolean;
  online: boolean;
  apiBaseUrl: string;
  lastCheckedAt: number;
  latencyMs: number | null;
  status: number | null;
  error: string | null;
  truthScore?: number | null;
}

interface UpdaterStatus {
  phase?: "available" | "downloading" | "ready" | "error" | "none";
  version?: string;
  percent?: number;
  error?: string;
}

export function StatusDot({ state }: { state: "ok" | "warn" | "bad" | "idle" }) {
  const cls =
    state === "ok"
      ? "bg-ok shadow-[0_0_6px_#46d586]"
      : state === "warn"
        ? "bg-gold animate-pulse-dot"
        : state === "bad"
          ? "bg-danger"
          : "bg-muted/40";
  return <span className={`inline-block w-2 h-2 rounded-full ${cls}`} role="presentation" />;
}

export default function StatusBar({
  compact = false,
  admin = false,
}: {
  compact?: boolean;
  admin?: boolean;
}) {
  const [conn, setConn] = useState<ConnectivityState | null>(null);
  const [upd, setUpd] = useState<UpdaterStatus | null>(null);
  const [ollama, setOllama] = useState<{
    ok?: boolean;
    backend?: string;
    agenticReady?: boolean;
    version?: string;
  } | null>(null);

  useEffect(() => {
    let off1: (() => void) | undefined;
    let off2: (() => void) | undefined;
    let off3: (() => void) | undefined;
    void (async () => {
      try {
        const initial = await window.grudge?.connectivity?.get?.();
        if (initial) setConn(initial);
      } catch {
        /* ignore */
      }
      try {
        const st = await window.grudge?.ollama?.status?.();
        if (st) setOllama(st);
      } catch {
        /* ignore */
      }
      off1 = window.grudge?.connectivity?.onChange?.((s: ConnectivityState) => setConn(s));
      off2 = window.grudge?.updater?.onStatus?.((s: UpdaterStatus) => setUpd(s));
      off3 = window.grudge?.ollama?.onStatus?.((s: any) => setOllama(s));
    })();
    return () => {
      off1?.();
      off2?.();
      off3?.();
    };
  }, []);

  const dot: "ok" | "warn" | "bad" | "idle" = !conn
    ? "idle"
    : !conn.online
      ? "bad"
      : conn.reachable
        ? "ok"
        : "warn";

  const truthScore = conn?.truthScore;
  const label = !conn
    ? "checking…"
    : !conn.online
      ? "offline"
      : conn.reachable
        ? truthScore != null
          ? `ONE TRUTH ${truthScore}% · ${conn.latencyMs ?? 0}ms`
          : `online · ${conn.latencyMs ?? 0}ms`
        : truthScore != null
          ? `ONE TRUTH ${truthScore}%`
          : "fleet unreachable";

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
      {admin && (
        <span
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-gold/15 text-gold border border-gold/30"
          title="Signed in as a Grudge Studio admin"
        >
          <ShieldCheck size={10} />
          ADMIN
        </span>
      )}
      <span
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
          ollama?.ok
            ? "bg-ok/10 text-ok border-ok/30"
            : "bg-muted/10 text-muted border-line"
        }`}
        title={
          ollama?.ok
            ? `GRUDACHAIN Ollama online · ${ollama.backend ?? "?"} · v${ollama.version ?? "?"}${
                ollama.agenticReady ? " · agentic ready" : ""
              }`
            : "GRUDACHAIN Ollama offline — will auto-start on open / admin sign-in"
        }
      >
        <Bot size={10} />
        {ollama?.ok ? (ollama.agenticReady ? "OLLAMA · AGENTIC" : "OLLAMA") : "OLLAMA …"}
      </span>
      <button
        type="button"
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
          {upd.phase === "downloading"
            ? `update ${Math.round(upd.percent ?? 0)}%`
            : upd.phase === "available"
              ? `update ${upd.version}`
              : upd.phase === "ready"
                ? "update ready (restart)"
                : upd.phase === "error"
                  ? "update err"
                  : ""}
        </span>
      )}
    </div>
  );
}
