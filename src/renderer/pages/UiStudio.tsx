/**
 * HYDRA Game UI Studio + CraftPix assets + Warlords character prefab.
 * Hosts: ui.grudge-studio.com/studio · /assets · character.grudge-studio.com/prefab?era=warlords
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, LayoutTemplate, Boxes, UserRound, RefreshCw, Loader2 } from "lucide-react";
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

type Shell = "studio" | "assets" | "prefab";

const SHELLS: Record<Shell, { label: string; url: string; hint: string }> = {
  studio: {
    label: "UI Studio",
    url: FLEET_URLS.uiStudio || `${FLEET_URLS.ui}/studio`,
    hint: "HYDRA 1920×1080 · CraftPix slots / action bars",
  },
  assets: {
    label: "UI Assets",
    url: FLEET_URLS.uiAssets || `${FLEET_URLS.ui}/assets`,
    hint: "3D + CraftPix pack browser",
  },
  prefab: {
    label: "Warlords Prefab",
    url: FLEET_URLS.characterPrefabWarlords || `${FLEET_URLS.characterFoundry}/prefab?era=warlords`,
    hint: "character.grudge-studio.com · era=warlords",
  },
};

function withEmbed(url: string): string {
  const u = new URL(url);
  u.searchParams.set("embed", "1");
  u.searchParams.set("from", "grudge-dev-tool");
  return u.toString();
}

export default function UiStudio() {
  const wvRef = useRef<WebviewEl | null>(null);
  const [shell, setShell] = useState<Shell>("studio");
  const [loading, setLoading] = useState(true);
  const [src, setSrc] = useState<string | null>(null);

  const loadShell = useCallback(async (id: Shell) => {
    setShell(id);
    setLoading(true);
    try {
      const stamped = await embedUrlWithSession(withEmbed(SHELLS[id].url));
      setSrc(stamped);
      await wvRef.current?.loadURL?.(stamped);
    } catch (e: unknown) {
      toast.error("UI shell failed", { description: e instanceof Error ? e.message : String(e) });
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadShell("studio");
  }, [loadShell]);

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
      toast.error(`UI load failed: ${d.errorDescription ?? d.errorCode ?? "unknown"}`);
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

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-black/40 shrink-0">
        <LayoutTemplate size={14} className="text-gold" />
        <div className="flex flex-col leading-tight min-w-0">
          <span className="text-xs font-semibold text-sky-100">HYDRA · UI systems</span>
          <span className="text-[10px] text-muted truncate">{SHELLS[shell].hint}</span>
        </div>
        <div className="flex items-center gap-1 ml-2 rounded border border-white/10 p-0.5 bg-black/30">
          {(Object.keys(SHELLS) as Shell[]).map((id) => (
            <button
              key={id}
              type="button"
              className={`px-2 py-1 text-[10px] rounded flex items-center gap-1 ${
                shell === id ? "bg-sky-500/25 text-sky-100" : "text-muted hover:text-sky-100"
              }`}
              onClick={() => void loadShell(id)}
            >
              {id === "studio" && <LayoutTemplate size={11} />}
              {id === "assets" && <Boxes size={11} />}
              {id === "prefab" && <UserRound size={11} />}
              {SHELLS[id].label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          type="button"
          className="p-1.5 rounded hover:bg-white/10"
          title="Reload"
          onClick={() => wvRef.current?.reload()}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
        <a
          className="p-1.5 rounded hover:bg-white/10 text-muted hover:text-gold"
          href={SHELLS[shell].url}
          target="_blank"
          rel="noreferrer"
          title="Open in browser"
        >
          <ExternalLink size={14} />
        </a>
        {loading && <Loader2 size={14} className="animate-spin text-muted" />}
      </div>
      <div className="flex-1 min-h-0 relative bg-[#070810]">
        {src &&
          React.createElement("webview", {
            ref: wvRef,
            src,
            style: { width: "100%", height: "100%", border: "none" },
            allowpopups: "true",
            webpreferences: "contextIsolation=yes, nativeWindowOpen=yes",
          })}
      </div>
    </div>
  );
}
