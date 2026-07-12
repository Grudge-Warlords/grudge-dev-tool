import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Hammer, Box, ExternalLink, RefreshCw, Globe, Loader2, ShieldCheck,
} from "lucide-react";
import { STUDIO_MODULE_URLS } from "../../shared/fleet";
import { useWorkspaceField } from "../lib/useWorkspaceField";
import { resolveModuleUrl, wireWebviewSso } from "../lib/studioSso";

const Forge3D = React.lazy(() => import("./Forge3D"));

type ForgeMode = "full" | "quick";

const LANDING_URL = STUDIO_MODULE_URLS.forge;

export default function Forge() {
  const [mode, setMode] = useWorkspaceField("forgeMode", "full" as ForgeMode);
  const [wvKey, setWvKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [src, setSrc] = useState<string>(STUDIO_MODULE_URLS.forgeEditor);
  const [ssoLabel, setSsoLabel] = useState<string | null>(null);
  const wvRef = useRef<HTMLElement | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const setFull = useCallback(() => setMode("full"), [setMode]);
  const setQuick = useCallback(() => setMode("quick"), [setMode]);

  // SSO: seed cookies + grudge_token when Studio is signed in
  useEffect(() => {
    if (mode !== "full") return;
    let cancelled = false;
    (async () => {
      const { url, sso } = await resolveModuleUrl("forgeEditor");
      if (cancelled) return;
      setSrc(url);
      setSsoLabel(
        sso.ok && sso.player
          ? sso.player.displayName || sso.player.username
          : sso.error
            ? null
            : null,
      );
      setWvKey((k) => k + 1);
    })();
    return () => { cancelled = true; };
  }, [mode]);

  useEffect(() => {
    if (mode !== "full") return;
    setLoading(true);
    // Wait a tick so <webview key=…> mounts with the new src
    const t = window.setTimeout(() => {
      const el = wvRef.current;
      if (!el) {
        setLoading(false);
        return;
      }
      unsubRef.current?.();
      unsubRef.current = wireWebviewSso(el, { onLoadingChange: setLoading });
    }, 50);
    return () => {
      window.clearTimeout(t);
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [mode, wvKey]);

  return (
    <div className="forge-shell">
      <header className="forge-shell-bar">
        <div className="flex items-center gap-2 min-w-0">
          <Hammer size={16} className="text-gold shrink-0" />
          <span className="font-semibold text-sm">Forge</span>
          <span className="text-muted text-[11px] hidden sm:inline truncate">
            {mode === "full" ? "Full editor · forge.grudge-studio.com" : "Quick 3D · local files & CDN"}
          </span>
          {mode === "full" && ssoLabel && (
            <span className="hidden md:inline-flex items-center gap-1 text-[10px] text-emerald-400/90 border border-emerald-500/30 rounded px-1.5 py-0.5">
              <ShieldCheck size={10} /> {ssoLabel}
            </span>
          )}
        </div>

        <div className="forge-mode-toggle" role="tablist" aria-label="Forge mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "full"}
            className={"forge-mode-btn" + (mode === "full" ? " active" : "")}
            onClick={setFull}
          >
            <Globe size={12} /> Full Forge
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "quick"}
            className={"forge-mode-btn" + (mode === "quick" ? " active" : "")}
            onClick={setQuick}
          >
            <Box size={12} /> Quick 3D
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {mode === "full" && (
            <>
              <button
                type="button"
                className="btn ghost text-xs flex items-center gap-1"
                title="Reload editor"
                onClick={() => setWvKey((k) => k + 1)}
              >
                <RefreshCw size={12} />
              </button>
              <button
                type="button"
                className="btn ghost text-xs flex items-center gap-1"
                title="Open Forge in system browser (with Studio SSO token)"
                onClick={async () => {
                  const { url } = await resolveModuleUrl("forgeEditor");
                  void window.grudge?.os?.openExternal?.(url);
                }}
              >
                <ExternalLink size={12} /> Open in browser
              </button>
            </>
          )}
        </div>
      </header>

      <div className="forge-shell-body">
        {mode === "full" ? (
          <div className="forge-webview-wrap">
            {loading && (
              <div className="forge-webview-loading">
                <Loader2 size={22} className="animate-spin text-gold" />
                <span className="text-xs text-muted">Loading Forge editor…</span>
              </div>
            )}
            <webview
              key={wvKey}
              ref={wvRef as React.RefObject<HTMLWebViewElement>}
              src={src}
              partition="persist:grudge-forge"
              className="forge-webview"
              allowpopups
            />
          </div>
        ) : (
          <React.Suspense
            fallback={
              <div className="flex items-center justify-center h-full text-muted gap-2">
                <Loader2 size={20} className="animate-spin text-gold" />
                <span className="text-xs">Loading Quick 3D…</span>
              </div>
            }
          >
            <Forge3D />
          </React.Suspense>
        )}
      </div>
    </div>
  );
}
