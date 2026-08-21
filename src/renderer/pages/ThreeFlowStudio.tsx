/**
 * ThreeFlow inside Dev Tool — live https://threeflow.vercel.app
 * /view = ThreePipe inspect · /editor = Vue r185 scene.
 * Not a fourth editor. Forge stays deploy.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Bug, ExternalLink, Eye, Hammer, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { FLEET_URLS } from "../../shared/fleet";
import { asWebview, attachWebviewSession, embedUrlWithSession } from "../lib/webviewSession";

interface WebviewEl extends HTMLElement {
  src: string;
  reload(): void;
  loadURL(url: string): Promise<void>;
  openDevTools(): void;
  getURL(): string;
}

const HOME = FLEET_URLS.threeflow || "https://threeflow.vercel.app";

function withEmbed(href: string): string {
  try {
    const u = new URL(href);
    u.searchParams.set("embed", "1");
    u.searchParams.set("from", "grudge-dev-tool");
    return u.toString();
  } catch {
    return href;
  }
}

export default function ThreeFlowStudio() {
  const wvRef = useRef<WebviewEl | null>(null);
  const [mode, setMode] = useState<"view" | "editor">("view");
  const [loading, setLoading] = useState(true);
  const [src, setSrc] = useState<string | null>(null);

  const target = mode === "view" ? `${HOME}/view` : `${HOME}/editor`;

  useEffect(() => {
    void (async () => {
      const stamped = await embedUrlWithSession(withEmbed(target));
      setSrc(stamped);
    })();
  }, [target]);

  useEffect(() => {
    const wv = wvRef.current;
    if (!wv || !src) return;
    const detachAuth = attachWebviewSession(asWebview(wv));
    const onStart = () => setLoading(true);
    const onStop = () => setLoading(false);
    const onFail = (e: Event) => {
      setLoading(false);
      const d = e as unknown as { errorCode?: number; errorDescription?: string };
      if (d.errorCode === -3) return;
      toast.error(`ThreeFlow load failed: ${d.errorDescription ?? d.errorCode ?? "unknown"}`);
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

  const openExternal = useCallback(() => {
    void window.grudge?.os?.openExternal?.(target);
  }, [target]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0a0e1a]">
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2 shrink-0">
        <Box size={16} className="text-amber-400" />
        <div className="min-w-0">
          <strong className="text-sm text-amber-100">ThreeFlow</strong>
          <p className="text-[10px] text-white/45 truncate">
            {mode === "view" ? "ThreePipe viewer" : "Scene editor"} · {HOME.replace(/^https?:\/\//, "")}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs ${
              mode === "view" ? "border-amber-400/70 text-amber-200" : "border-white/15"
            }`}
            onClick={() => setMode("view")}
          >
            <Eye size={12} /> View
          </button>
          <button
            type="button"
            className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs ${
              mode === "editor" ? "border-amber-400/70 text-amber-200" : "border-white/15"
            }`}
            onClick={() => setMode("editor")}
          >
            <Box size={12} /> Editor
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-xs"
            onClick={() => {
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
        {src
          ? React.createElement("webview", {
              ref: wvRef as unknown as React.RefObject<HTMLElement>,
              src,
              className: "absolute inset-0 w-full h-full",
              partition: "persist:grudge-threeflow",
              allowpopups: "true",
              webpreferences: "allowRunningInsecureContent, nativeWindowOpen=yes",
            })
          : <div className="p-6 text-white/40 text-sm">Loading ThreeFlow…</div>}
      </div>
    </div>
  );
}
