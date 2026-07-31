/**
 * Grok Builder — primary agentic Three.js + Rapier editor surface.
 * Embeds the Grok Builder SPA (fleet assets + Grok tool loop).
 * Replaces ad-hoc local editor as the default “build with AI” path;
 * production Forge map tools remain at /forge → forge.grudge-studio.com.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, Sparkles, Hammer } from "lucide-react";
import { FLEET_URLS } from "../../shared/fleet";

const LS_KEY = "grudge.grokBuilder.url";

function defaultBuilderUrl(): string {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) return saved;
  } catch {
    /* ignore */
  }
  // Prefer env from main if exposed; fall back to production / local defaults
  const fromFleet = (FLEET_URLS as Record<string, string>).grokBuilder;
  if (fromFleet) return fromFleet;
  if (import.meta.env.DEV) return "http://localhost:5190";
  return "https://grok-builder.vercel.app";
}

export default function GrokBuilder() {
  const [baseUrl, setBaseUrl] = useState(defaultBuilderUrl);
  const [urlDraft, setUrlDraft] = useState(baseUrl);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, baseUrl);
    } catch {
      /* ignore */
    }
  }, [baseUrl]);

  const embedSrc = useMemo(() => {
    try {
      const u = new URL(baseUrl);
      u.searchParams.set("embed", "1");
      u.searchParams.set("from", "grudge-dev-tool");
      u.searchParams.set("_", String(nonce));
      return u.toString();
    } catch {
      return baseUrl;
    }
  }, [baseUrl, nonce]);

  const openUrl = useCallback((u: string) => {
    const p = window.grudge?.os?.openExternal?.(u) as Promise<unknown> | undefined;
    if (p && typeof p.then === "function") {
      void p.catch(() => window.open(u, "_blank", "noopener,noreferrer"));
    } else {
      window.open(u, "_blank", "noopener,noreferrer");
    }
  }, []);

  const openExternal = useCallback(() => {
    openUrl(baseUrl.split("?")[0]);
  }, [baseUrl, openUrl]);

  const openForgeStudio = useCallback(() => {
    openUrl(FLEET_URLS.forge);
  }, [openUrl]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0a0e1a]">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <Sparkles size={16} className="text-amber-400" />
        <strong className="text-sm text-amber-100">Grok Builder</strong>
        <span className="text-xs text-white/45">
          Agentic Three.js · Rapier · Cloudflare assets
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            className="w-64 rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-white/80"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setBaseUrl(urlDraft.trim() || baseUrl);
            }}
            title="Grok Builder origin (local :5190 or production)"
          />
          <button
            type="button"
            className="rounded border border-white/15 px-2 py-1 text-xs hover:border-amber-400/50"
            onClick={() => setBaseUrl(urlDraft.trim() || baseUrl)}
          >
            Set URL
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-xs hover:border-sky-400/50"
            onClick={() => setNonce((n) => n + 1)}
            title="Reload embed"
          >
            <RefreshCw size={12} /> Reload
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-xs hover:border-amber-400/50"
            onClick={openExternal}
          >
            <ExternalLink size={12} /> Pop out
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-xs hover:border-violet-400/50"
            onClick={openForgeStudio}
            title="Full production Forge map editor"
          >
            <Hammer size={12} /> Forge studio
          </button>
        </div>
      </div>
      <iframe
        key={embedSrc}
        title="Grok Builder"
        src={embedSrc}
        className="min-h-0 w-full flex-1 border-0 bg-black"
        allow="clipboard-read; clipboard-write; fullscreen"
      />
    </div>
  );
}
