/**
 * Preview — Grudge Dev Tool play-mode surface.
 *
 * Loads production clients/games in an Electron webview for admin testing.
 * Primary use: after Forge edit/publish, open client / open / water / GRUDOX /
 * Multiverse with sceneId / glb deep-links — same hosts as production deploys.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  FolderOpen,
  X,
  ExternalLink,
  Bug,
  Play,
  Hammer,
  Gamepad2,
} from "lucide-react";
import { toast } from "sonner";
import { FLEET_URLS } from "../../shared/fleet";
import { buildPlayTestUrl } from "../../shared/adminSurfaces";
import { getPlayModes } from "../../shared/playModes";
import { asWebview, attachWebviewSession, embedUrlWithSession } from "../lib/webviewSession";

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

const HOME_URL = "about:blank";

/** Curated play targets for Forge → Preview testing. */
const PLAY_PRESETS: Array<{
  id: string;
  label: string;
  url: string;
  hint: string;
}> = [
  {
    id: "open",
    label: "Open launcher",
    url: FLEET_URLS.open,
    hint: "Fleet library · canonical play entry",
  },
  {
    id: "client",
    label: "Client play",
    url: FLEET_URLS.client,
    hint: "Warlords live play funnel",
  },
  {
    id: "water",
    label: "Water island",
    url: FLEET_URLS.water,
    hint: "Home island production",
  },
  {
    id: "grudox",
    label: "GRUDOX",
    url: FLEET_URLS.grudox,
    hint: "Carrier / room hub",
  },
  {
    id: "multiverse",
    label: "Multiverse",
    url: `${FLEET_URLS.multiverse}/#room1`,
    hint: "Bermuda MP · Railway /api/mv",
  },
  {
    id: "warlords",
    label: "Warlords",
    url: FLEET_URLS.warlords,
    hint: "Marketing + shell",
  },
  {
    id: "foundry",
    label: "Foundry",
    url: FLEET_URLS.characterFoundry,
    hint: "Create + 4-slot only",
  },
  {
    id: "forge-play",
    label: "Forge (view)",
    url: FLEET_URLS.forge,
    hint: "Production editor (view mode)",
  },
];

function normalizeAddress(raw: string): string {
  const s = raw.trim();
  if (!s) return HOME_URL;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (s.startsWith("about:")) return s;
  if (/^[a-zA-Z]:[\\/]/.test(s) || s.startsWith("\\\\")) {
    return "file:///" + s.replace(/\\/g, "/");
  }
  if (s.startsWith("/")) return "file://" + s;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(s)) return "https://" + s;
  return s;
}

function readPreviewQuery(): { url?: string; sceneId?: string; glb?: string } {
  try {
    // 1) sessionStorage from App stashRouteQuery (Forge Play test)
    let q = "";
    try {
      q = sessionStorage.getItem("grudge-route-query") || "";
      if (q) sessionStorage.removeItem("grudge-route-query");
    } catch {
      /* ignore */
    }
    // 2) hash ?query (if loader uses hash routing)
    if (!q) {
      const hash = window.location.hash || "";
      q = hash.includes("?") ? hash.split("?")[1] : "";
    }
    if (!q) return {};
    const p = new URLSearchParams(q);
    return {
      url: p.get("url") || undefined,
      sceneId: p.get("sceneId") || undefined,
      glb: p.get("glb") || undefined,
    };
  } catch {
    return {};
  }
}

export default function Preview() {
  const wvRef = useRef<WebviewEl | null>(null);
  const [pending, setPending] = useState<string>(HOME_URL);
  const [loading, setLoading] = useState(false);
  const [canBack, setCanBack] = useState(false);
  const [canFwd, setCanFwd] = useState(false);
  const [sceneId, setSceneId] = useState("");
  const [glb, setGlb] = useState("");
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const playModes = useMemo(() => getPlayModes().slice(0, 12), []);

  useEffect(() => {
    const q = readPreviewQuery();
    if (q.sceneId) setSceneId(q.sceneId);
    if (q.glb) setGlb(q.glb);
    if (q.url) {
      const u = normalizeAddress(q.url);
      setPending(u);
      setTimeout(() => {
        void wvRef.current?.loadURL(u);
      }, 50);
    }
  }, []);

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
        setPending(wv.getURL() || pending);
      } catch {
        /* ignore */
      }
    };
    const onFail = (e: Event) => {
      setLoading(false);
      const detail = e as unknown as { errorCode?: number; errorDescription?: string };
      if (detail.errorCode === -3) return;
      toast.error(`Load failed: ${detail.errorDescription ?? detail.errorCode ?? "unknown"}`);
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
  }, [pending]);

  const go = useCallback((raw: string, presetId?: string | null) => {
    void (async () => {
      const base = normalizeAddress(raw);
      const url = base.startsWith("http") ? await embedUrlWithSession(base) : base;
      setPending(url);
      if (presetId !== undefined) setActivePreset(presetId);
      void wvRef.current?.loadURL(url).catch(() => {
        /* did-fail-load */
      });
    })();
  }, []);

  const loadPreset = useCallback(
    (preset: (typeof PLAY_PRESETS)[0]) => {
      const url = buildPlayTestUrl({
        base: preset.url,
        sceneId: sceneId.trim() || undefined,
        glb: glb.trim() || undefined,
        mode: "play",
      });
      go(url, preset.id);
      toast.success(`Preview: ${preset.label}`);
    },
    [go, sceneId, glb],
  );

  const openHtml = useCallback(async () => {
    try {
      const r = await window.grudge.preview.openHtmlDialog();
      if (r.canceled || !r.url) return;
      go(r.url, null);
    } catch (err: unknown) {
      toast.error("Open failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [go]);

  const openExternal = useCallback(() => {
    const u = wvRef.current?.getURL() ?? pending;
    if (!u || u === HOME_URL) return;
    void window.grudge?.os?.openExternal?.(u);
  }, [pending]);

  const openForge = useCallback(() => {
    void window.grudge?.app?.openRoute?.("/forge");
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0a0c12]">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-black/40 shrink-0">
        <Play size={16} className="text-emerald-300" />
        <div className="flex flex-col leading-tight min-w-0">
          <span className="text-xs font-semibold text-emerald-100 tracking-wide">
            Preview · Play mode
          </span>
          <span className="text-[10px] text-muted truncate">
            Load fleet clients for Forge playtests · open · client · water · GRUDOX
          </span>
        </div>

        <div className="flex items-center gap-1 ml-2">
          <button
            type="button"
            className="p-1.5 rounded hover:bg-white/10 disabled:opacity-40"
            disabled={!canBack}
            onClick={() => wvRef.current?.goBack()}
            title="Back"
          >
            <ArrowLeft size={14} />
          </button>
          <button
            type="button"
            className="p-1.5 rounded hover:bg-white/10 disabled:opacity-40"
            disabled={!canFwd}
            onClick={() => wvRef.current?.goForward()}
            title="Forward"
          >
            <ArrowRight size={14} />
          </button>
          <button
            type="button"
            className="p-1.5 rounded hover:bg-white/10"
            title={loading ? "Stop" : "Reload"}
            onClick={() => (loading ? wvRef.current?.stop() : wvRef.current?.reload())}
          >
            {loading ? <X size={14} /> : <RotateCw size={14} />}
          </button>
        </div>

        <form
          className="flex-1 mx-2"
          onSubmit={(e) => {
            e.preventDefault();
            go(pending, null);
          }}
        >
          <input
            className="w-full px-2 py-1 text-[11px] font-mono bg-black/50 border border-white/10 rounded focus:outline-none focus:border-emerald-500/50 text-slate-200"
            value={pending}
            onChange={(e) => setPending(e.target.value)}
            placeholder="https://open.grudge-studio.com · file:///… · client.grudge-studio.com"
            spellCheck={false}
          />
        </form>

        <button
          type="button"
          className="btn ghost text-[11px] flex items-center gap-1"
          onClick={openHtml}
          title="Open local HTML"
        >
          <FolderOpen size={12} /> HTML
        </button>
        <button
          type="button"
          className="btn ghost text-[11px] flex items-center gap-1 text-violet-200/90"
          onClick={openForge}
          title="Back to production Forge"
        >
          <Hammer size={12} /> Forge
        </button>
        <button
          type="button"
          className="p-1.5 rounded hover:bg-white/10 text-muted"
          title="Webview DevTools"
          onClick={() => wvRef.current?.openDevTools()}
        >
          <Bug size={14} />
        </button>
        <button
          type="button"
          className="p-1.5 rounded hover:bg-white/10 text-muted"
          title="Open in system browser"
          onClick={openExternal}
        >
          <ExternalLink size={14} />
        </button>
      </header>

      {/* Forge playtest params + presets */}
      <div className="px-3 py-2 border-b border-white/5 bg-emerald-950/15 shrink-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-emerald-200/80 font-medium uppercase tracking-wide">
            From Forge
          </span>
          <input
            className="px-2 py-0.5 text-[11px] font-mono bg-black/40 border border-white/10 rounded w-40 text-slate-200"
            placeholder="sceneId"
            value={sceneId}
            onChange={(e) => setSceneId(e.target.value)}
          />
          <input
            className="px-2 py-0.5 text-[11px] font-mono bg-black/40 border border-white/10 rounded flex-1 min-w-[12rem] text-slate-200"
            placeholder="glb CDN URL (optional)"
            value={glb}
            onChange={(e) => setGlb(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PLAY_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              title={p.hint}
              onClick={() => loadPreset(p)}
              className={`px-2 py-1 rounded text-[10px] border transition-colors ${
                activePreset === p.id
                  ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-100"
                  : "border-white/10 bg-black/30 text-slate-300 hover:border-emerald-500/30 hover:text-emerald-100"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 items-center">
          <Gamepad2 size={11} className="text-muted" />
          <span className="text-[10px] text-muted mr-1">Fleet:</span>
          {playModes.map((g) => (
            <button
              key={g.id}
              type="button"
              className="px-1.5 py-0.5 rounded text-[10px] text-slate-400 hover:text-gold hover:bg-white/5"
              title={g.description}
              onClick={() => {
                go(
                  buildPlayTestUrl({
                    base: g.url,
                    sceneId: sceneId.trim() || undefined,
                    glb: glb.trim() || undefined,
                  }),
                  g.id,
                );
              }}
            >
              {g.displayName}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 relative bg-black">
        {React.createElement("webview", {
          ref: wvRef as unknown as React.RefObject<HTMLElement>,
          src: HOME_URL,
          className: "absolute inset-0 w-full h-full",
          partition: "persist:grudge-preview",
          allowpopups: "true",
          webpreferences: "contextIsolation=yes, nodeIntegration=no",
          style: { width: "100%", height: "100%" },
        })}
        {pending === HOME_URL && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none text-center px-6">
            <Play size={28} className="text-emerald-400/60" />
            <p className="text-sm text-slate-300 max-w-md">
              Pick a <strong className="text-emerald-200">play target</strong> above to test
              clients the same way production Forge deploys do.
            </p>
            <p className="text-[11px] text-muted max-w-lg">
              Pattern: edit on{" "}
              <span className="text-violet-300">forge.grudge-studio.com</span> → Preview with{" "}
              <span className="font-mono text-slate-400">sceneId</span> / CDN{" "}
              <span className="font-mono text-slate-400">glb</span> → Open / client / water /
              GRUDOX.
            </p>
          </div>
        )}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20">
            <span className="text-xs text-emerald-100 px-3 py-1.5 rounded border border-emerald-500/30 bg-black/70">
              Loading client…
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
