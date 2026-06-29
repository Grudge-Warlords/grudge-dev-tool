import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Link2, Copy, ExternalLink, Loader2, RefreshCw, Hammer, Image as ImageIcon,
  Box, FolderOpen, CheckCircle2, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import DemoModeBanner from "../components/DemoModeBanner";
import type { AssetMeta } from "../../shared/ipc";
import { readMirror, writeMirror } from "../lib/workspace";
import { FLEET_URLS } from "../../shared/fleet";

const QUICK_PATHS = [
  "models/characters/",
  "models/weapons/",
  "models/battle_towers/Archer_Tower_L1.glb",
  "asset-packs/classic64/v0.6/Books/cover.png",
  "icons/pack/weapons/Sword_01.png",
  "master-items.json",
];

function isGlb(path: string): boolean {
  return /\.(glb|gltf)$/i.test(path);
}
function isImage(path: string): boolean {
  return /\.(png|jpe?g|webp|gif|svg)$/i.test(path);
}

export default function RequestPage() {
  const [path, setPath] = useState(() => readMirror().requestObjectPath ?? QUICK_PATHS[3]);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<AssetMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backendMode, setBackendMode] = useState<string>("");
  const [cdnBase, setCdnBase] = useState(FLEET_URLS.assets);
  const [headInfo, setHeadInfo] = useState<{ size: number; contentType: string | null } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [mode, url] = await Promise.all([
          window.grudge.cf.getBackendMode(),
          window.grudge.cf.r2PublicUrl(""),
        ]);
        setBackendMode(mode);
        if (url) setCdnBase(url.replace(/\/$/, ""));
      } catch { /* offline */ }
      const snap = await window.grudge.workspace.get().catch(() => null);
      if (snap?.requestObjectPath) setPath(snap.requestObjectPath);
    })();
  }, []);

  const publicCdn = useMemo(() => {
    const p = path.replace(/^\//, "");
    return meta?.publicCdn ?? `${cdnBase}/${p}`;
  }, [path, meta, cdnBase]);

  const copy = useCallback((text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(() => toast.success(`Copied ${label}`));
  }, []);

  const persistPath = useCallback((p: string) => {
    writeMirror({ requestObjectPath: p });
    void window.grudge.workspace.patch({ requestObjectPath: p });
  }, []);

  const fetchMeta = useCallback(async () => {
    const objectPath = path.trim().replace(/^\//, "");
    if (!objectPath) {
      toast.error("Enter an object path");
      return;
    }
    setBusy(true);
    setError(null);
    setMeta(null);
    setHeadInfo(null);
    try {
      const m = await window.grudge.os.assetMeta({ objectPath });
      setMeta(m);
      persistPath(objectPath);
      toast.success("Signed URL minted");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("Request failed", { description: msg.slice(0, 160) });
      try {
        const head = await window.grudge.cf.r2Head(objectPath);
        setHeadInfo({ size: head.size ?? 0, contentType: head.contentType ?? null });
      } catch { /* no head either */ }
    } finally {
      setBusy(false);
    }
  }, [path, persistPath]);

  function useBrowserSelection() {
    const prefix = readMirror().browserPrefix ?? "";
    if (!prefix) {
      toast.error("No Browser folder selected — pick one in Object Storage Browser first");
      return;
    }
    setPath(prefix.replace(/\/$/, ""));
    toast.message(`Path set from Browser: ${prefix}`);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <Link2 size={20} /> Request URL
        </h1>
        <p className="page-sub">
          Mint signed GET URLs and resolve public CDN links for any object in fleet storage.
          Backend: <span className="font-mono text-gold">{backendMode || "…"}</span>
        </p>
      </div>

      <DemoModeBanner feature="Request URL / asset meta" />

      <div className="card space-y-3">
        <label className="text-xs text-muted">Object path (no leading slash)</label>
        <div className="flex gap-2">
          <input
            className="flex-1 font-mono text-sm"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void fetchMeta(); }}
            placeholder="models/characters/barbarian.glb"
          />
          <button type="button" className="btn" disabled={busy} onClick={() => void fetchMeta()}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {busy ? "Minting…" : "Get URL"}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn ghost text-xs" onClick={useBrowserSelection}>
            <FolderOpen size={12} /> Use Browser selection
          </button>
          {QUICK_PATHS.map((p) => (
            <button
              key={p}
              type="button"
              className="btn ghost text-[10px] py-0 px-2"
              onClick={() => setPath(p)}
            >
              {p.split("/").slice(-2).join("/") || p}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="card border-red-800/50 bg-red-950/20 flex gap-2 items-start">
          <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm text-red-300 font-semibold">Request failed</div>
            <div className="text-xs text-muted mt-1 font-mono whitespace-pre-wrap">{error}</div>
            {headInfo && (
              <div className="text-[10px] text-muted mt-2">
                R2 head fallback: {(headInfo.size / 1024).toFixed(1)} KB · {headInfo.contentType ?? "unknown type"}
              </div>
            )}
            <button type="button" className="btn ghost text-xs mt-2" onClick={() => void window.grudge.app.openRoute("/settings")}>
              Check Settings → Cloudflare credentials
            </button>
          </div>
        </div>
      )}

      {meta && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card space-y-3">
            <div className="flex items-center gap-2 text-gold text-sm font-semibold">
              <CheckCircle2 size={16} /> Asset resolved
            </div>

            <div>
              <div className="text-[10px] text-muted mb-1">Public CDN</div>
              <div className="flex gap-2 items-center">
                <code className="text-xs flex-1 truncate">{publicCdn}</code>
                <button type="button" className="btn ghost text-xs" onClick={() => copy(publicCdn, "CDN URL")}>
                  <Copy size={12} />
                </button>
                <button type="button" className="btn ghost text-xs" onClick={() => void window.grudge.os.openExternal(publicCdn)}>
                  <ExternalLink size={12} />
                </button>
              </div>
            </div>

            <div>
              <div className="text-[10px] text-muted mb-1">Signed URL ({meta.ttlSeconds}s TTL)</div>
              <pre className="text-[10px] bg-bg-2 p-2 rounded max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono">
                {meta.url}
              </pre>
              <div className="flex gap-2 mt-2 flex-wrap">
                <button type="button" className="btn text-xs" onClick={() => copy(meta.url, "signed URL")}>
                  <Copy size={12} /> Copy signed
                </button>
                <button type="button" className="btn ghost text-xs" onClick={() => void window.grudge.os.openExternal(meta.url)}>
                  <ExternalLink size={12} /> Open signed
                </button>
                {isGlb(path) && (
                  <button
                    type="button"
                    className="btn ghost text-xs"
                    onClick={() => void window.grudge.forge.openRemote(publicCdn).then(() => window.grudge.app.openRoute("/forge"))}
                  >
                    <Hammer size={12} /> Open in Forge 3D
                  </button>
                )}
              </div>
            </div>

            <div className="text-xs text-muted font-mono">
              {(meta.contentType ?? "unknown")} · {((meta.size ?? 0) / 1024).toFixed(1)} KB
              {meta.updated ? ` · updated ${meta.updated.slice(0, 19)}` : ""}
            </div>
          </div>

          <div className="card">
            <div className="text-xs text-muted mb-2">Preview</div>
            {isImage(path) ? (
              <div className="aspect-video bg-black rounded overflow-hidden flex items-center justify-center">
                <img src={publicCdn} alt="" className="max-w-full max-h-full object-contain" onError={() => toast.error("CDN preview failed — try signed URL")} />
              </div>
            ) : isGlb(path) ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted">
                <Box size={40} className="text-gold/40" />
                <p className="text-sm">GLB — open in Forge 3D for viewport preview</p>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void window.grudge.forge.openRemote(publicCdn).then(() => window.grudge.app.openRoute("/forge"))}
                >
                  <Hammer size={14} /> Load in Forge
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted">
                <ImageIcon size={40} className="text-gold/20" />
                <p className="text-sm">No inline preview for this content type</p>
                <button type="button" className="btn ghost text-xs" onClick={() => void window.grudge.os.openExternal(publicCdn)}>
                  Open via CDN
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}