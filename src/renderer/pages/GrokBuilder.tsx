/**
 * Grok Builder — embed production SPA (grok-builder.vercel.app) in Electron webview.
 * Same pattern as ForgeStudio: live DNS/Vercel origin, not a local fork.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw, Sparkles, Hammer, Bug } from "lucide-react";
import { toast } from "sonner";
import { FLEET_URLS } from "../../shared/fleet";
import { asWebview, attachWebviewSession, embedUrlWithSession } from "../lib/webviewSession";

const LS_KEY = "grudge.grokBuilder.url";

interface WebviewEl extends HTMLElement {
  src: string;
  reload(): void;
  loadURL(url: string): Promise<void>;
  openDevTools(): void;
  getURL(): string;
}

function defaultBuilderUrl(): string {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) return saved;
  } catch {
    /* ignore */
  }
  return FLEET_URLS.grokBuilder || "https://grok-builder.vercel.app";
}

function embedUrl(base: string, nonce: number): string {
  try {
    const u = new URL(base);
    u.searchParams.set("embed", "1");
    u.searchParams.set("from", "grudge-dev-tool");
    u.searchParams.set("_", String(nonce));
    return u.toString();
  } catch {
    return base;
  }
}

export default function GrokBuilder() {
  const wvRef = useRef<WebviewEl | null>(null);
  const [baseUrl, setBaseUrl] = useState(defaultBuilderUrl);
  const [urlDraft, setUrlDraft] = useState(baseUrl);
  const [nonce, setNonce] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, baseUrl);
    } catch {
      /* ignore */
    }
  }, [baseUrl]);

  const [src, setSrc] = useState(() => embedUrl(baseUrl, nonce));

  useEffect(() => {
    void (async () => {
      const stamped = await embedUrlWithSession(embedUrl(baseUrl, nonce));
      setSrc(stamped);
    })();
  }, [baseUrl, nonce]);

  useEffect(() => {
    const wv = wvRef.current;
    if (!wv) return;
    const detachAuth = attachWebviewSession(asWebview(wv));
    const onStart = () => setLoading(true);
    const onStop = () => setLoading(false);
    const onFail = (e: Event) => {
      setLoading(false);
      const d = e as unknown as { errorCode?: number; errorDescription?: string };
      if (d.errorCode === -3) return;
      toast.error(`Grok Builder load failed: ${d.errorDescription ?? d.errorCode ?? "unknown"}`);
    };
    wv.addEventListener("did-start-loading", onStart);
    wv.addEventListener("did-stop-loading", onStop);
    wv.addEventListener("did-fail-load", onFail);
    return () => {
      detachAuth();
      wv.removeEventListener("did-start-loading", onStart);
      wv.removeEventListener("did-stop-loading", onStop);
      wv.removeEventListener("did-fail-load", onFail);
    };
  }, [src]);

  const applyUrl = useCallback(() => {
    const next = urlDraft.trim() || baseUrl;
    setBaseUrl(next);
    setNonce((n) => n + 1);
  }, [urlDraft, baseUrl]);

  const openExternal = useCallback(() => {
    void window.grudge?.os?.openExternal?.(baseUrl.split("?")[0]);
  }, [baseUrl]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0a0e1a]">
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2 shrink-0">
        <Sparkles size={16} className="text-amber-400" />
        <div className="min-w-0">
          <strong className="text-sm text-amber-100">Grok Builder</strong>
          <p className="text-[10px] text-white/45 truncate">
            Live SPA · {baseUrl.replace(/^https?:\/\//, "")}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            className="w-56 rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-white/80 font-mono"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyUrl();
            }}
            title="Production or local :5190"
          />
          <button
            type="button"
            className="rounded border border-white/15 px-2 py-1 text-xs hover:border-amber-400/50"
            onClick={applyUrl}
          >
            Set URL
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-xs"
            onClick={() => {
              setNonce((n) => n + 1);
              void wvRef.current?.reload?.();
            }}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Reload
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-xs"
            onClick={openExternal}
          >
            <ExternalLink size={12} /> Browser
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-xs"
            onClick={() => void window.grudge?.app?.openRoute?.("/forge")}
          >
            <Hammer size={12} /> Forge
          </button>
          <button
            type="button"
            className="p-1.5 rounded hover:bg-white/10"
            title="Webview DevTools"
            onClick={() => wvRef.current?.openDevTools?.()}
          >
            <Bug size={14} />
          </button>
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        {React.createElement("webview", {
          ref: wvRef as unknown as React.RefObject<HTMLElement>,
          src,
          className: "absolute inset-0 w-full h-full",
          partition: "persist:grudge-grok-builder",
          allowpopups: "true",
          webpreferences: "contextIsolation=yes, nodeIntegration=no",
          style: { width: "100%", height: "100%" },
        })}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20">
            <span className="text-xs text-amber-100 px-3 py-1.5 rounded border border-amber-500/30 bg-black/70">
              Loading Grok Builder…
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
