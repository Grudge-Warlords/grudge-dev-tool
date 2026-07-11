import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Hammer, Box, ExternalLink, RefreshCw, Globe, Loader2,
} from "lucide-react";
import { STUDIO_MODULE_URLS } from "../../shared/fleet";
import { useWorkspaceField } from "../lib/useWorkspaceField";

const Forge3D = React.lazy(() => import("./Forge3D"));

type ForgeMode = "full" | "quick";

const FULL_URL = STUDIO_MODULE_URLS.forgeEditor;
const LANDING_URL = STUDIO_MODULE_URLS.forge;

export default function Forge() {
  const [mode, setMode] = useWorkspaceField("forgeMode", "full" as ForgeMode);
  const [wvKey, setWvKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const wvRef = useRef<HTMLElement | null>(null);

  const setFull = useCallback(() => setMode("full"), [setMode]);
  const setQuick = useCallback(() => setMode("quick"), [setMode]);

  useEffect(() => {
    if (mode !== "full") return;
    setLoading(true);
    const el = wvRef.current;
    if (!el) return;
    const onStop = () => setLoading(false);
    const onFail = () => setLoading(false);
    el.addEventListener("did-stop-loading", onStop);
    el.addEventListener("did-fail-load", onFail);
    return () => {
      el.removeEventListener("did-stop-loading", onStop);
      el.removeEventListener("did-fail-load", onFail);
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
              <a
                className="btn ghost text-xs flex items-center gap-1"
                href={LANDING_URL}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={12} /> Open in browser
              </a>
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
              src={FULL_URL}
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
