import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Gamepad2, ExternalLink, RefreshCw, ArrowLeft, ArrowRight, RotateCw,
  Loader2, Globe, Maximize2,
} from "lucide-react";
import { getPlayModes, type PlayModeId } from "../../shared/playModes";
import type { FleetGame } from "../../shared/fleetGames";
import { readMirror, writeMirror } from "../lib/workspace";

interface WebviewEl extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  getURL(): string;
  loadURL(url: string): Promise<void>;
}

const WEBVIEW_PARTITION = "persist:grudge-playcanvas";

export default function GameModes() {
  const modes = getPlayModes();
  const wvRef = useRef<WebviewEl | null>(null);
  const [activeId, setActiveId] = useState<PlayModeId | null>(() => {
    const saved = readMirror().playModeId;
    return (saved && modes.some((m) => m.id === saved) ? saved : modes[0]?.id) as PlayModeId | null;
  });
  const [loading, setLoading] = useState(false);
  const [canBack, setCanBack] = useState(false);
  const [canFwd, setCanFwd] = useState(false);

  const active = modes.find((m) => m.id === activeId) ?? modes[0] ?? null;

  const loadGenRef = useRef(0);

  const selectMode = useCallback((game: FleetGame) => {
    setActiveId(game.id as PlayModeId);
    writeMirror({ playModeId: game.id });
    void window.grudge.workspace.patch({ playModeId: game.id });
    // Navigation is owned by the effect below — avoid double loadURL races
    // that produce GUEST_VIEW_MANAGER_CALL ERR_ABORTED (-3) spam in main.log.
  }, []);

  useEffect(() => {
    const wv = wvRef.current;
    if (!wv || !active?.url) return;
    const gen = ++loadGenRef.current;
    const target = active.url;

    const refreshNav = () => {
      try { setCanBack(wv.canGoBack()); setCanFwd(wv.canGoForward()); } catch { /* ignore */ }
    };
    const onStart = () => {
      if (gen !== loadGenRef.current) return;
      setLoading(true);
    };
    const onStop = () => {
      if (gen !== loadGenRef.current) return;
      setLoading(false);
      refreshNav();
    };
    const onFail = (e: { errorCode: number; errorDescription?: string }) => {
      if (gen !== loadGenRef.current) return;
      setLoading(false);
      // -3 ERR_ABORTED: superseded navigation — expected when switching modes fast
      if (e.errorCode === -3) return;
      toast.error(`Load failed: ${e.errorDescription ?? e.errorCode}`);
    };
    wv.addEventListener("did-start-loading", onStart);
    wv.addEventListener("did-stop-loading", onStop);
    wv.addEventListener("did-fail-load", onFail as unknown as EventListener);

    // Debounce slight to coalesce rapid mode clicks
    const t = window.setTimeout(() => {
      if (gen !== loadGenRef.current) return;
      void wv.loadURL(target).catch(() => {
        if (gen === loadGenRef.current) wv.src = target;
      });
    }, 50);

    return () => {
      window.clearTimeout(t);
      wv.removeEventListener("did-start-loading", onStart);
      wv.removeEventListener("did-stop-loading", onStop);
      wv.removeEventListener("did-fail-load", onFail as unknown as EventListener);
    };
  }, [active?.url]);

  return (
    <div className="flex flex-col h-full min-h-[480px]">
      <div className="mb-3">
        <h1 className="page-title flex items-center gap-2">
          <Gamepad2 size={20} /> Play Modes
        </h1>
        <p className="page-sub">
          Launch and smoke-test live fleet playables in a sandboxed webview — Warlords, Survival, RTS, Drive, Forge, Arena, and more.
        </p>
      </div>

      <div className="flex flex-1 gap-3 min-h-0">
        <aside className="w-56 shrink-0 border border-line rounded-md bg-bg-1 overflow-y-auto p-2 space-y-1">
          {modes.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => selectMode(g)}
              className={`w-full text-left rounded p-2 text-xs border transition-colors ${
                active?.id === g.id ? "border-gold bg-gold/10 text-gold" : "border-transparent hover:border-line hover:bg-bg-2"
              }`}
            >
              <div className="font-semibold truncate">{g.displayName}</div>
              <div className="text-[10px] text-muted truncate">{g.engine}</div>
              <div className="text-[10px] text-muted/80 mt-0.5 capitalize">{g.status} · {g.category}</div>
            </button>
          ))}
        </aside>

        <section className="flex-1 flex flex-col min-w-0 border border-line rounded-md bg-bg-1 overflow-hidden">
          {active ? (
            <>
              <div className="border-b border-line px-3 py-2 flex items-center gap-2 flex-wrap bg-bg-2/50">
                <span className="font-semibold text-sm text-gold">{active.displayName}</span>
                <span className="text-[10px] text-muted truncate flex-1">{active.url}</span>
                {loading && <Loader2 size={14} className="animate-spin text-gold" />}
                <div className="flex gap-1 ml-auto">
                  <button type="button" className="btn ghost text-xs py-0 px-2" disabled={!canBack} onClick={() => wvRef.current?.goBack()}>
                    <ArrowLeft size={12} />
                  </button>
                  <button type="button" className="btn ghost text-xs py-0 px-2" disabled={!canFwd} onClick={() => wvRef.current?.goForward()}>
                    <ArrowRight size={12} />
                  </button>
                  <button type="button" className="btn ghost text-xs py-0 px-2" onClick={() => wvRef.current?.reload()}>
                    <RotateCw size={12} />
                  </button>
                  <button type="button" className="btn ghost text-xs py-0 px-2" onClick={() => void window.grudge.os.openExternal(active.url)}>
                    <ExternalLink size={12} />
                  </button>
                  <button type="button" className="btn ghost text-xs py-0 px-2" onClick={() => void window.grudge.app.openRoute("/preview")}>
                    <Maximize2 size={12} /> Preview tab
                  </button>
                </div>
              </div>

              <p className="text-[10px] text-muted px-3 py-1 border-b border-line">{active.description}</p>

              <div className="flex-1 relative min-h-[360px]">
                <webview
                  ref={wvRef as React.Ref<HTMLWebViewElement>}
                  src={active.url}
                  partition={WEBVIEW_PARTITION}
                  allowpopups
                  className="absolute inset-0 w-full h-full"
                  style={{ display: "flex" }}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted gap-2">
              <Globe size={40} className="text-gold/30" />
              <p className="text-sm">No play modes in catalog</p>
            </div>
          )}
        </section>
      </div>

      <div className="mt-2 text-[10px] text-muted flex items-center gap-2">
        <RefreshCw size={10} />
        Embedded via Electron webview ({WEBVIEW_PARTITION}). Use External for full browser or Preview tab for local HTML.
      </div>
    </div>
  );
}