import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, Check, Pin, X, ChevronRight, FolderOpen, Upload as UploadIcon } from "lucide-react";
import StatusBar from "./components/StatusBar";

declare global { interface Window { grudge: any } }

type Tab = "pinned" | "browse" | "upload";

const DEFAULT_PINNED = [
  "asset-packs/",
  "asset-packs/classic64/v0.6/",
  "user-uploads/",
  "shared/",
];

const CMD_FORMATS = [
  { id: "path",   label: "path",   tpl: (p: string) => p },
  { id: "cdn",    label: "cdn",    tpl: (p: string) => `https://assets.grudge-studio.com/${p}` },
  { id: "curl",   label: "curl",   tpl: (p: string) => `curl -L https://assets.grudge-studio.com/${p} -O` },
  { id: "wget",   label: "wget",   tpl: (p: string) => `wget https://assets.grudge-studio.com/${p}` },
  { id: "node",   label: "node",   tpl: (p: string) => `assetUrl(\"${p.startsWith("/") ? p : "/" + p}\")` },
] as const;
type CmdFormat = (typeof CMD_FORMATS)[number]["id"];

interface UploadStatus {
  filePath: string;
  status: string;
  bytesUploaded: number;
  bytesTotal: number;
  error?: string;
}

export default function LoaderApp() {
  const [tab, setTab] = useState<Tab>("pinned");
  const [prefix, setPrefix] = useState("asset-packs/");
  const [items, setItems] = useState<any[]>([]);
  const [filter, setFilter] = useState("");
  const [cmdFormat, setCmdFormat] = useState<CmdFormat>("curl");
  const [pinned, setPinned] = useState<string[]>(DEFAULT_PINNED);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [uploadQueue, setUploadQueue] = useState<Record<string, UploadStatus>>({});
  const [pinnedTarget, setPinnedTarget] = useState("user-uploads/");

  // Load pinned shortcuts from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("loader.pinned");
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) setPinned(arr);
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    localStorage.setItem("loader.pinned", JSON.stringify(pinned));
  }, [pinned]);

  // Subscribe to upload progress
  useEffect(() => {
    const off = window.grudge?.upload?.onProgress?.((p: any) => {
      setUploadQueue((q) => ({ ...q, [p.filePath]: p }));
    });
    return () => off?.();
  }, []);

  async function browse(p: string) {
    setTab("browse"); setPrefix(p); setLoading(true); setError(null);
    try {
      const res = await window.grudge.os.list({ prefix: p, limit: 200 });
      setItems(res.items ?? []);
    } catch (e: any) {
      setError(e.message);
      setItems([]);
    } finally { setLoading(false); }
  }

  function copy(text: string, label?: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(text);
      toast.success(label ? `Copied ${label}` : "Copied", { description: text.slice(0, 80) });
      window.setTimeout(() => setCopied(null), 1200);
    }).catch((err) => {
      toast.error("Copy failed", { description: err?.message ?? String(err) });
    });
  }

  function pinHere() {
    if (pinned.includes(prefix)) return;
    setPinned([...pinned, prefix]);
  }
  function unpin(p: string) {
    setPinned(pinned.filter((x) => x !== p));
  }

  const filtered = useMemo(() => {
    if (!filter) return items;
    const f = filter.toLowerCase();
    return items.filter((it) => it.name.toLowerCase().includes(f));
  }, [items, filter]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const dropped: { localPath: string; targetPath: string }[] = [];
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      const f = e.dataTransfer.files[i];
      const lp = (f as any).path as string | undefined;
      if (lp) {
        const targetBase = pinnedTarget.replace(/\/?$/, "/");
        dropped.push({ localPath: lp, targetPath: `${targetBase}${f.name}` });
      }
    }
    if (dropped.length === 0) return;
    const jobId = `loader-${Date.now()}`;
    window.grudge.upload.enqueue({ id: jobId, files: dropped });
  }

  return (
    <div className="loader-shell">
      <div className="loader-titlebar">
        <img src="/logo-256.png" width={20} height={20} alt="Grudge" />
        <span className="loader-title">GrudgeLoader</span>
        <StatusBar compact />
        <div className="loader-tab-row ml-auto">
          <button className={tab === "pinned" ? "active" : ""} onClick={() => setTab("pinned")}>Pinned</button>
          <button className={tab === "browse" ? "active" : ""} onClick={() => browse(prefix)}>Browse</button>
          <button className={tab === "upload" ? "active" : ""} onClick={() => setTab("upload")}>Upload</button>
        </div>
        <button className="loader-close" title="Hide" onClick={() => window.grudge?.loader?.hide?.()}><X size={14} /></button>
      </div>

      {tab === "pinned" && (
        <div className="loader-section">
          <div className="loader-hint">Quick folders. Click to browse, copy button copies the path.</div>
          {pinned.map((p) => (
            <div className="loader-row" key={p}>
              <span className="loader-folder-icon">📁</span>
              <button className="loader-link" onClick={() => browse(p)}>{p}</button>
              <button className="copy-btn" title="Copy path" onClick={() => copy(p)}>{copied === p ? "✓" : "⧉"}</button>
              <button className="copy-btn danger" title="Unpin" onClick={() => unpin(p)}>×</button>
            </div>
          ))}
          <div className="loader-row">
            <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="prefix to pin" />
            <button className="loader-pin-btn" onClick={pinHere}>＋ pin</button>
          </div>
        </div>
      )}

      {tab === "browse" && (
        <div className="loader-section">
          <div className="loader-bar">
            <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="prefix" />
            <button onClick={() => browse(prefix)}>Go</button>
            <select value={cmdFormat} onChange={(e) => setCmdFormat(e.target.value as CmdFormat)}>
              {CMD_FORMATS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <input
            className="loader-filter"
            placeholder="filter visible…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {loading && <div className="muted">Loading…</div>}
          {error && <div className="status-bad small">{error}</div>}
          <div className="loader-list">
            {filtered.map((it: any) => {
              const fmt = CMD_FORMATS.find((c) => c.id === cmdFormat)!;
              const cmd = fmt.tpl(it.name);
              const isImg = (it.contentType || "").startsWith("image/");
              const cdnThumb = `https://assets.grudge-studio.com/${it.name}`;
              return (
                <div className="loader-asset" key={it.name}>
                  <div className="loader-asset-thumb">
                    {isImg ? <img src={cdnThumb} alt="" loading="lazy" />
                           : <span className="loader-asset-glyph">📄</span>}
                  </div>
                  <div className="loader-asset-meta">
                    <div className="loader-asset-name" title={it.name}>{it.name.split("/").slice(-1)[0]}</div>
                    <div className="muted small">{(it.size / 1024).toFixed(1)} KB</div>
                  </div>
                  <button className="copy-btn" title={`Copy ${cmdFormat}`} onClick={() => copy(cmd)}>
                    {copied === cmd ? "✓" : "⧉"}
                  </button>
                </div>
              );
            })}
            {!loading && filtered.length === 0 && <div className="muted">Empty.</div>}
          </div>
        </div>
      )}

      {tab === "upload" && (
        <div className="loader-section">
          <div className="loader-hint">Drop files anywhere below. They'll upload to the target prefix.</div>
          <div className="loader-bar">
            <input value={pinnedTarget} onChange={(e) => setPinnedTarget(e.target.value)} placeholder="target prefix" />
          </div>
          <div
            className="loader-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
          >
            Drop files here<br />
            <span className="muted small">{Object.keys(uploadQueue).length} in flight</span>
          </div>
          <div className="loader-list">
            {Object.values(uploadQueue).slice(-12).reverse().map((row) => (
              <div className="loader-asset" key={row.filePath}>
                <span className="loader-asset-glyph">⬆</span>
                <div className="loader-asset-meta">
                  <div className="loader-asset-name" title={row.filePath}>{row.filePath.split(/[\\/]/).pop()}</div>
                  <div className="muted small">
                    {row.status} · {row.bytesUploaded}/{row.bytesTotal}
                    {row.error && <span className="status-bad"> · {row.error}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
