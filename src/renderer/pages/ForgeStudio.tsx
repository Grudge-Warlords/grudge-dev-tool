/**
 * Primary Forge surface — same source as https://forge.grudge-studio.com DNS deploy.
 *
 * Production stack: R3F + Rapier + ObjectStore + AI Worker (three.js editor parity).
 * Dev Tool embeds that host; Local tools (/forge-local) are secondary convert/pop-out only.
 * After edit, send playtests to Preview (open / client / water / GRUDOX / Multiverse).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  ExternalLink,
  Hammer,
  Boxes,
  Bug,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import { FLEET_URLS } from "../../shared/fleet";
import { buildForgeEditUrl, buildPlayTestUrl } from "../../shared/adminSurfaces";

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

const FORGE_HOME = FLEET_URLS.forge || "https://forge.grudge-studio.com";

/** Deep-link into edit mode (interactive authoring + deploy). */
export function forgeEditUrl(opts?: {
  era?: string;
  sceneId?: string;
  glb?: string;
}): string {
  return buildForgeEditUrl(opts);
}

export default function ForgeStudio() {
  const wvRef = useRef<WebviewEl | null>(null);
  const [url, setUrl] = useState(forgeEditUrl({ era: "warlords", sceneId: "warlords_grudge_airship" }));
  const [loading, setLoading] = useState(true);
  const [canBack, setCanBack] = useState(false);
  const [canFwd, setCanFwd] = useState(false);

  useEffect(() => {
    const wv = wvRef.current;
    if (!wv) return;
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
      toast.error(`Forge load failed: ${detail.errorDescription ?? detail.errorCode ?? "unknown"}`);
    };
    wv.addEventListener("did-start-loading", onStart);
    wv.addEventListener("did-stop-loading", onStop);
    wv.addEventListener("did-navigate", onStop);
    wv.addEventListener("did-navigate-in-page", onStop);
    wv.addEventListener("did-fail-load", onFail);
    return () => {
      wv.removeEventListener("did-start-loading", onStart);
      wv.removeEventListener("did-stop-loading", onStop);
      wv.removeEventListener("did-navigate", onStop);
      wv.removeEventListener("did-navigate-in-page", onStop);
      wv.removeEventListener("did-fail-load", onFail);
    };
  }, [url]);

  const goHome = useCallback(() => {
    const home = forgeEditUrl({ era: "warlords", sceneId: "warlords_grudge_airship" });
    setUrl(home);
    void wvRef.current?.loadURL(home);
  }, []);

  const openExternal = useCallback(() => {
    const u = wvRef.current?.getURL() ?? url;
    void window.grudge?.os?.openExternal?.(u);
  }, [url]);

  const openLocalTools = useCallback(() => {
    void window.grudge?.app?.openRoute?.("/forge-local");
  }, []);

  const openPreviewPlay = useCallback(() => {
    // Hand off to Preview with optional scene from current Forge URL
    try {
      const current = wvRef.current?.getURL() ?? url;
      const u = new URL(current);
      const sceneId = u.searchParams.get("sceneId") || "warlords_grudge_airship";
      const glb = u.searchParams.get("glb") || "";
      const play = buildPlayTestUrl({
        base: FLEET_URLS.open,
        sceneId,
        glb: glb || undefined,
        mode: "play",
      });
      const qs = new URLSearchParams({
        url: play,
        sceneId,
        ...(glb ? { glb } : {}),
      });
      void window.grudge?.app?.openRoute?.(`/preview?${qs.toString()}`);
    } catch {
      void window.grudge?.app?.openRoute?.("/preview");
    }
    toast.message("Preview · play mode", {
      description: "Open / client / water / GRUDOX / Multiverse for Forge playtests",
    });
  }, [url]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0a0c12]">
      {/* Primary Forge chrome */}
      <header className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-black/40 shrink-0">
        <Hammer size={16} className="text-violet-300" />
        <div className="flex flex-col leading-tight min-w-0">
          <span className="text-xs font-semibold text-violet-100 tracking-wide">
            Grudge Studio Forge
          </span>
          <span className="text-[10px] text-muted truncate">
            forge.grudge-studio.com · R3F + Rapier · same DNS deploy source
          </span>
        </div>

        <div className="flex items-center gap-1 ml-3">
          <button
            type="button"
            className="btn ghost p-1.5"
            disabled={!canBack}
            title="Back"
            onClick={() => wvRef.current?.goBack()}
          >
            <ArrowLeft size={14} />
          </button>
          <button
            type="button"
            className="btn ghost p-1.5"
            disabled={!canFwd}
            title="Forward"
            onClick={() => wvRef.current?.goForward()}
          >
            <ArrowRight size={14} />
          </button>
          <button
            type="button"
            className="btn ghost p-1.5"
            title="Reload"
            onClick={() => wvRef.current?.reload()}
          >
            <RotateCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        <div className="flex-1 mx-2 px-2 py-1 rounded bg-black/50 border border-white/10 text-[10px] font-mono text-slate-300 truncate">
          {url}
        </div>

        <button type="button" className="btn ghost text-[11px]" onClick={goHome}>
          Warlords edit
        </button>
        <button
          type="button"
          className="btn ghost text-[11px] flex items-center gap-1"
          onClick={openExternal}
          title="Open in system browser"
        >
          <ExternalLink size={12} /> Browser
        </button>
        <button
          type="button"
          className="btn ghost text-[11px] flex items-center gap-1 text-emerald-200/90"
          onClick={openPreviewPlay}
          title="Play-test current scene in Preview (fleet clients)"
        >
          <Play size={12} /> Play test
        </button>
        <button
          type="button"
          className="btn ghost text-[11px] flex items-center gap-1 text-amber-200/80"
          onClick={openLocalTools}
          title="Secondary: local pop-out, glTF convert helpers, site connections"
        >
          <Boxes size={12} /> Local tools
        </button>
        <button
          type="button"
          className="btn ghost p-1.5"
          title="Webview DevTools"
          onClick={() => wvRef.current?.openDevTools()}
        >
          <Bug size={14} />
        </button>
      </header>

      <div className="px-3 py-1.5 text-[10px] text-slate-400 border-b border-white/5 bg-violet-950/20 shrink-0">
        <strong className="text-violet-200">Primary Forge</strong> = production host{" "}
        <span className="font-mono text-slate-300">{FORGE_HOME}</span> (R3F · Rapier · AI Worker ·
        meshopt GLB · SI metres).{" "}
        <strong className="text-emerald-200/90">Play test</strong> → Preview clients.{" "}
        <strong className="text-amber-200/90">Local tools</strong> = convert/pop-out only — not a
        second editor SSOT. Bake for CDN still uses <span className="font-mono">grudge-convert</span>.
      </div>

      <div className="flex-1 min-h-0 relative">
        {/* Electron <webview> — attrs not fully typed in React DOM */}
        {React.createElement("webview", {
          ref: wvRef as unknown as React.RefObject<HTMLElement>,
          src: forgeEditUrl({ era: "warlords", sceneId: "warlords_grudge_airship" }),
          className: "absolute inset-0 w-full h-full",
          allowpopups: "true",
          webpreferences: "contextIsolation=yes, nodeIntegration=no",
          style: { width: "100%", height: "100%" },
        })}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20">
            <span className="text-xs text-violet-100 px-3 py-1.5 rounded border border-violet-500/30 bg-black/70">
              Loading Forge…
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
