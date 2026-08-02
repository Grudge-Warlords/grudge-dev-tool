/**
 * Coder — Grudge Dev Tool hybrid surface.
 *
 * 1) Production embed: https://coder.grudge-studio.com (same source as DNS)
 * 2) Local full-power: spawn GrudachainCode PTY server for FS/agent when cloud is insufficient
 *
 * Do not confuse Legion (ai.grudge-studio.com) with Coder AI hub worker.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Play,
  Square,
  ExternalLink,
  RefreshCw,
  FolderOpen,
  Terminal,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Cloud,
  HardDrive,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Bug,
  Code2,
} from "lucide-react";
import { FLEET_URLS } from "../../shared/fleet";
import { asWebview, attachWebviewSession, embedUrlWithSession } from "../lib/webviewSession";

interface CoderStatus {
  running: boolean;
  port: number;
  url: string;
  pid: number | null;
  projectDir: string | null;
  error: string | null;
}

interface WebviewEl extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  loadURL(url: string): Promise<void>;
  openDevTools(): void;
  getURL(): string;
}

const PROD_CODER = FLEET_URLS.coder || "https://coder.grudge-studio.com";
const DEFAULT_PORT = 5111;
const DEFAULT_DIRS = [
  "F:\\GitHub\\GrudachainCode",
  "F:\\GitHub\\Grudge-Studio-Forge",
  "F:\\GitHub\\grudge-dev-tool",
  "D:\\GrudgeRepos\\RTS-Grudge",
];

type Mode = "cloud" | "local";

function coderHandoffUrl(base: string): string {
  const u = new URL(base);
  u.searchParams.set("from", "grudge-dev-tool");
  u.searchParams.set("bootstrap", "1");
  u.searchParams.set("embed", "1");
  return u.toString();
}

export default function Coder() {
  const wvRef = useRef<WebviewEl | null>(null);
  const [mode, setMode] = useState<Mode>("cloud");
  const [status, setStatus] = useState<CoderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [port, setPort] = useState(DEFAULT_PORT);
  const [projectDir, setProjectDir] = useState(DEFAULT_DIRS[0]);
  const [loading, setLoading] = useState(true);
  const [canBack, setCanBack] = useState(false);
  const [canFwd, setCanFwd] = useState(false);
  const [url, setUrl] = useState(coderHandoffUrl(PROD_CODER));
  const [panelOpen, setPanelOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await window.grudge.coder.status();
      setStatus(s);
      if (s.port) setPort(s.port);
      if (s.projectDir) setProjectDir(s.projectDir);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);

  // Re-stamp cloud URL with session identity on mount
  useEffect(() => {
    if (mode !== "cloud") return;
    void (async () => {
      const next = await embedUrlWithSession(coderHandoffUrl(PROD_CODER));
      setUrl(next);
    })();
  }, [mode]);

  useEffect(() => {
    const wv = wvRef.current;
    if (!wv) return;
    const detachAuth = attachWebviewSession(asWebview(wv));
    const refreshNav = () => {
      try {
        setCanBack(wv.canGoBack());
        setCanFwd(wv.canGoForward());
      } catch {
        /* ignore */
      }
    };
    const onStart = () => setLoading(true);
    const onStop = () => {
      setLoading(false);
      refreshNav();
      try {
        setUrl(wv.getURL() || url);
      } catch {
        /* ignore */
      }
    };
    const onFail = (e: Event) => {
      setLoading(false);
      const detail = e as unknown as { errorCode?: number; errorDescription?: string };
      if (detail.errorCode === -3) return;
      toast.error(`Coder load failed: ${detail.errorDescription ?? detail.errorCode ?? "unknown"}`);
    };
    wv.addEventListener("did-start-loading", onStart);
    wv.addEventListener("did-stop-loading", onStop);
    wv.addEventListener("did-navigate", onStop);
    wv.addEventListener("did-navigate-in-page", onStop);
    wv.addEventListener("did-fail-load", onFail);
    return () => {
      detachAuth();
      wv.removeEventListener("did-start-loading", onStart);
      wv.removeEventListener("did-stop-loading", onStop);
      wv.removeEventListener("did-navigate", onStop);
      wv.removeEventListener("did-navigate-in-page", onStop);
      wv.removeEventListener("did-fail-load", onFail);
    };
  }, [url]);

  const loadUrl = useCallback((next: string) => {
    setUrl(next);
    void wvRef.current?.loadURL(next);
  }, []);

  const switchCloud = useCallback(() => {
    setMode("cloud");
    void (async () => {
      loadUrl(await embedUrlWithSession(coderHandoffUrl(PROD_CODER)));
    })();
  }, [loadUrl]);

  const switchLocal = useCallback(() => {
    setMode("local");
    setPanelOpen(true);
    if (status?.running && status.url) {
      loadUrl(status.url);
    }
  }, [loadUrl, status]);

  async function pickDir() {
    try {
      const picked = await window.grudge.coder.pickProjectDir();
      if (picked) setProjectDir(picked);
    } catch (e: unknown) {
      toast.error("Folder picker failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function launch() {
    setBusy(true);
    try {
      const s = await window.grudge.coder.launch({ port, projectDir });
      setStatus(s);
      if (s.running) {
        toast.success(`Local Coder on port ${s.port}`);
        setMode("local");
        loadUrl(s.url);
      } else if (s.error) {
        toast.error("Launch failed", { description: s.error });
      }
    } catch (err: unknown) {
      toast.error("Launch failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      const s = await window.grudge.coder.stop();
      setStatus(s);
      toast.success("Local Coder stopped");
      switchCloud();
    } catch (err: unknown) {
      toast.error("Stop failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  const openExternal = useCallback(() => {
    const u = wvRef.current?.getURL() ?? url;
    void window.grudge?.os?.openExternal?.(u);
  }, [url]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0a0c12]">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-black/40 shrink-0">
        <Code2 size={16} className="text-sky-300" />
        <div className="flex flex-col leading-tight min-w-0">
          <span className="text-xs font-semibold text-sky-100 tracking-wide">
            Grudge Coder
          </span>
          <span className="text-[10px] text-muted truncate">
            {mode === "cloud"
              ? "coder.grudge-studio.com · production SPA"
              : "Local PTY + FS · GrudachainCode"}
          </span>
        </div>

        <div className="flex items-center gap-1 ml-2 rounded border border-white/10 p-0.5 bg-black/30">
          <button
            type="button"
            className={`px-2 py-1 text-[10px] rounded flex items-center gap-1 ${
              mode === "cloud" ? "bg-sky-500/25 text-sky-100" : "text-muted hover:text-sky-100"
            }`}
            onClick={switchCloud}
          >
            <Cloud size={11} /> Cloud
          </button>
          <button
            type="button"
            className={`px-2 py-1 text-[10px] rounded flex items-center gap-1 ${
              mode === "local" ? "bg-amber-500/25 text-amber-100" : "text-muted hover:text-amber-100"
            }`}
            onClick={switchLocal}
          >
            <HardDrive size={11} /> Local
          </button>
        </div>

        <div className="flex items-center gap-1 ml-1">
          <button
            type="button"
            className="p-1.5 rounded hover:bg-white/10 disabled:opacity-40"
            disabled={!canBack}
            onClick={() => wvRef.current?.goBack()}
          >
            <ArrowLeft size={14} />
          </button>
          <button
            type="button"
            className="p-1.5 rounded hover:bg-white/10 disabled:opacity-40"
            disabled={!canFwd}
            onClick={() => wvRef.current?.goForward()}
          >
            <ArrowRight size={14} />
          </button>
          <button
            type="button"
            className="p-1.5 rounded hover:bg-white/10"
            onClick={() => wvRef.current?.reload()}
          >
            <RotateCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        <div className="flex-1 mx-2 px-2 py-1 rounded bg-black/50 border border-white/10 text-[10px] font-mono text-slate-300 truncate">
          {url}
        </div>

        <button
          type="button"
          className="btn ghost text-[11px]"
          onClick={() => setPanelOpen((v) => !v)}
        >
          <Terminal size={12} className="inline mr-1" />
          Local server
        </button>
        <button type="button" className="btn ghost p-1.5" onClick={openExternal} title="Browser">
          <ExternalLink size={14} />
        </button>
        <button
          type="button"
          className="btn ghost p-1.5"
          onClick={() => wvRef.current?.openDevTools()}
          title="DevTools"
        >
          <Bug size={14} />
        </button>
      </header>

      <div className="px-3 py-1.5 text-[10px] text-slate-400 border-b border-white/5 bg-sky-950/20 shrink-0">
        <strong className="text-sky-200">Dev Tool Coder</strong> — same production surface as{" "}
        <span className="font-mono text-slate-300">coder.grudge-studio.com</span>. Local mode for
        full PTY/FS when cloud API is 503. Legion chat stays on{" "}
        <span className="font-mono">ai.grudge-studio.com</span> (separate product).
      </div>

      {panelOpen && (
        <div className="px-3 py-3 border-b border-white/10 bg-black/50 shrink-0 space-y-3">
          <div className="flex items-center gap-2 text-xs">
            {status?.running ? (
              <>
                <CheckCircle2 size={14} className="text-emerald-400" />
                <span className="text-emerald-200">
                  Running · port {status.port} · pid {status.pid ?? "—"}
                </span>
              </>
            ) : (
              <>
                <AlertCircle size={14} className="text-muted" />
                <span className="text-muted">Local server stopped</span>
              </>
            )}
            {status?.error && (
              <span className="text-danger text-[11px] ml-2 truncate">{status.error}</span>
            )}
            <button type="button" className="btn ghost text-[10px] ml-auto" onClick={() => void refresh()}>
              <RefreshCw size={11} className="inline" /> Refresh
            </button>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <label className="text-[10px] text-muted">Port</label>
            <input
              type="number"
              className="w-20 px-2 py-1 text-xs font-mono bg-black/40 border border-white/10 rounded"
              value={port}
              onChange={(e) => setPort(Number(e.target.value) || DEFAULT_PORT)}
            />
            <label className="text-[10px] text-muted">Workspace</label>
            <input
              className="flex-1 min-w-[12rem] px-2 py-1 text-[11px] font-mono bg-black/40 border border-white/10 rounded"
              value={projectDir}
              onChange={(e) => setProjectDir(e.target.value)}
            />
            <button type="button" className="btn ghost text-[11px]" onClick={() => void pickDir()}>
              <FolderOpen size={12} className="inline" /> Pick
            </button>
            {!status?.running ? (
              <button
                type="button"
                className="btn text-[11px] flex items-center gap-1"
                disabled={busy}
                onClick={() => void launch()}
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                Start local
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn ghost text-[11px]"
                  onClick={() => status.url && loadUrl(status.url)}
                >
                  Open local URL
                </button>
                <button
                  type="button"
                  className="btn ghost text-[11px] text-danger"
                  disabled={busy}
                  onClick={() => void stop()}
                >
                  <Square size={12} className="inline" /> Stop
                </button>
              </>
            )}
          </div>
          <p className="text-[10px] text-muted">
            Expects GrudachainCode at <span className="font-mono">F:\GitHub\GrudachainCode</span>{" "}
            (or pick). Fleet games still follow CDN / grudge-convert — Coder does not replace bake.
          </p>
        </div>
      )}

      <div className="flex-1 min-h-0 relative">
        {React.createElement("webview", {
          ref: wvRef as unknown as React.RefObject<HTMLElement>,
          src: coderHandoffUrl(PROD_CODER),
          className: "absolute inset-0 w-full h-full",
          partition: "persist:grudge-coder",
          allowpopups: "true",
          webpreferences: "contextIsolation=yes, nodeIntegration=no",
          style: { width: "100%", height: "100%" },
        })}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20">
            <span className="text-xs text-sky-100 px-3 py-1.5 rounded border border-sky-500/30 bg-black/70">
              Loading Coder…
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
