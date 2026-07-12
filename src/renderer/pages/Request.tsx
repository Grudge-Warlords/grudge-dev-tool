/**
 * Request URL — mint signed download URLs + always-show public CDN for R2 keys.
 */
import React, { useState } from "react";
import { toast } from "sonner";
import { Link2, Copy, ExternalLink, RefreshCw, Check } from "lucide-react";

interface AssetMetaResult {
  key?: string;
  backend?: string;
  url: string;
  ttlSeconds: number;
  size: number;
  contentType: string | null;
  updated: string | null;
  publicCdn: string;
}

function normalizePathInput(raw: string): string {
  let p = raw.trim();
  p = p.replace(/^https?:\/\/assets\.grudge-studio\.com\//i, "");
  p = p.replace(/^https?:\/\/[^/]+\/objects\//i, "");
  p = p.replace(/^\/+/, "");
  p = p.replace(/^objects\//, "");
  return p.split("?")[0].split("#")[0];
}

export default function RequestPage() {
  const [path, setPath] = useState("models/grudge6/races/WK_Characters.glb");
  const [meta, setMeta] = useState<AssetMetaResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function fetchMeta() {
    setError(null);
    setMeta(null);
    const objectPath = normalizePathInput(path);
    if (!objectPath) {
      setError("Enter an R2 object path or full assets.grudge-studio.com URL");
      return;
    }
    setPath(objectPath);
    setBusy(true);
    try {
      const m = await window.grudge.os.assetMeta({ objectPath });
      setMeta(m);
      if (m?.backend === "public-cdn" && !m.ttlSeconds) {
        toast.message("Public CDN URL ready", {
          description: "Signed URL unavailable (no R2 creds / API) — public URL still works for immutable assets.",
        });
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      toast.success(`Copied ${label}`);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Clipboard failed");
    }
  }

  return (
    <div>
      <h1 className="page-title flex items-center gap-2">
        <Link2 size={20} className="text-gold" />
        Request URL
      </h1>
      <p className="page-sub">
        Resolve any R2 object to a <strong>public CDN URL</strong> and a short-lived{" "}
        <strong>signed download URL</strong> when credentials are available.
      </p>

      <div className="card">
        <label className="muted text-xs">Object path or full CDN URL</label>
        <input
          className="mt-1 w-full font-mono text-xs"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void fetchMeta();
          }}
          placeholder="models/grudge6/races/WK_Characters.glb"
          data-testid="input-request-path"
        />
        <p className="muted text-[10px] mt-1">
          Examples: <span className="font-mono">models/grudge6/races/WK_Characters.glb</span>
          {" · "}
          <span className="font-mono">asset-packs/…</span>
          {" · "}paste full <span className="font-mono">https://assets.grudge-studio.com/…</span>
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          <button className="btn flex items-center gap-1" onClick={() => void fetchMeta()} disabled={busy}>
            {busy ? <RefreshCw size={14} className="animate-spin" /> : <Link2 size={14} />}
            {busy ? "Resolving…" : "Get URL"}
          </button>
          <button
            type="button"
            className="btn ghost text-xs"
            onClick={() => setPath("models/grudge6/races/WK_Characters.glb")}
          >
            Race GLB sample
          </button>
          <button
            type="button"
            className="btn ghost text-xs"
            onClick={() => setPath("textures/grudge6/western-kingdoms/WK_Standard_Units.webp")}
          >
            Texture sample
          </button>
        </div>
      </div>

      {error && (
        <div className="card status-bad text-sm" data-testid="request-error">
          {error}
        </div>
      )}

      {meta && (
        <div className="card space-y-3" data-testid="request-result">
          <div className="flex flex-wrap gap-2 text-[10px]">
            <span className="px-2 py-0.5 rounded border border-line text-muted">
              key <span className="font-mono text-ink">{meta.key || path}</span>
            </span>
            <span className="px-2 py-0.5 rounded border border-line text-muted">
              backend <span className="text-gold">{meta.backend || "—"}</span>
            </span>
            {meta.contentType && (
              <span className="px-2 py-0.5 rounded border border-line text-muted">{meta.contentType}</span>
            )}
            <span className="px-2 py-0.5 rounded border border-line text-muted">
              {meta.size > 0 ? `${(meta.size / 1024).toFixed(1)} KB` : "size n/a"}
            </span>
            {meta.updated && (
              <span className="px-2 py-0.5 rounded border border-line text-muted">
                {String(meta.updated).slice(0, 19)}
              </span>
            )}
          </div>

          <div>
            <div className="muted text-xs mb-1">Public CDN (always usable for public assets)</div>
            <div className="flex gap-2 items-start">
              <pre className="flex-1 text-[11px] break-all whitespace-pre-wrap m-0">{meta.publicCdn}</pre>
              <button
                type="button"
                className="btn ghost text-xs shrink-0"
                onClick={() => void copy(meta.publicCdn, "public CDN")}
              >
                {copied === "public CDN" ? <Check size={12} /> : <Copy size={12} />}
              </button>
              <button
                type="button"
                className="btn ghost text-xs shrink-0"
                title="Open in browser"
                onClick={() => window.grudge.os.openExternal(meta.publicCdn)}
              >
                <ExternalLink size={12} />
              </button>
            </div>
          </div>

          <div>
            <div className="muted text-xs mb-1">
              Signed URL
              {meta.ttlSeconds > 0 ? ` (expires in ${meta.ttlSeconds}s)` : " (same as public — no private signer)"}
            </div>
            <div className="flex gap-2 items-start">
              <pre className="flex-1 text-[11px] break-all whitespace-pre-wrap m-0">{meta.url}</pre>
              <button
                type="button"
                className="btn ghost text-xs shrink-0"
                onClick={() => void copy(meta.url, "signed URL")}
              >
                {copied === "signed URL" ? <Check size={12} /> : <Copy size={12} />}
              </button>
              <button
                type="button"
                className="btn ghost text-xs shrink-0"
                onClick={() => window.grudge.os.openExternal(meta.url)}
              >
                <ExternalLink size={12} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
