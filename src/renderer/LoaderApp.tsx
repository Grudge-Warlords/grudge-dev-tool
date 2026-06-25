import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  X, ChevronRight, Folder, ExternalLink, Upload as UploadIcon,
  Search as SearchIcon, Box, MoreHorizontal,
} from "lucide-react";
import StatusBar from "./components/StatusBar";
import DemoModeBanner from "./components/DemoModeBanner";
import { pathsFromFileList } from "./lib/filePaths";
import { isImagePath, isModelPath } from "../shared/mediaTypes";

type Tab = "pinned" | "browse" | "upload";

const DEFAULT_PINNED = ["asset-packs/", "user-uploads/", "shared/"];

function buildCmdFormats(cdnBase: string) {
  const base = cdnBase.replace(/\/$/, "");
  return [
    { id: "path", label: "path", tpl: (p: string) => p },
    { id: "cdn", label: "cdn", tpl: (p: string) => `${base}/${p}` },
    { id: "curl", label: "curl", tpl: (p: string) => `curl -L ${base}/${p} -O` },
    { id: "wget", label: "wget", tpl: (p: string) => `wget ${base}/${p}` },
    { id: "node", label: "node", tpl: (p: string) => `assetUrl(\"${p.startsWith("/") ? p : "/" + p}\")` },
  ] as const;
}
type CmdFormat = "path" | "cdn" | "curl" | "wget" | "node";

interface UploadStatus {
  filePath: string;
  status: string;
  bytesUploaded: number;
  bytesTotal: number;
  error?: string;
}

interface ListItem {
  name: string;
  size: number;
  contentType: string;
  updated: string | null;
}

function loadPinned(): string[] {
  try {
    const raw = localStorage.getItem("loader.pinned");
    if (!raw) return [...DEFAULT_PINNED];
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return [...DEFAULT_PINNED];
    const merged = [...DEFAULT_PINNED];
    for (const p of saved) {
      if (typeof p === "string" && !merged.includes(p)) merged.push(p);
    }
    return merged;
  } catch {
    return [...DEFAULT_PINNED];
  }
}

function Breadcrumb({ prefix, onSelect }: { prefix: string; onSelect: (p: string) => void }) {
  const parts = prefix.split("/").filter(Boolean);
  let acc = "";
  return (
    <div className="loader-breadcrumb">
      <button type="button" onClick={() => onSelect("")}>root</button>
      {parts.map((p) => {
        acc += `${p}/`;
        const path = acc;
        return (
          <React.Fragment key={path}>
            <ChevronRight size={10} className="opacity-40" />
            <button type="button" onClick={() => onSelect(path)}>{p}</button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function LoaderApp() {
  const [tab, setTab] = useState<Tab>("pinned");
  const [prefix, setPrefix] = useState("asset-packs/");
  const [folders, setFolders] = useState<string[]>([]);
  const [items, setItems] = useState<ListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [cmdFormat, setCmdFormat] = useState<CmdFormat>("cdn");
  const [pinned, setPinned] = useState<string[]>(loadPinned);
  const [cdnBase, setCdnBase] = useState("https://assets.grudge-studio.com");
  const cmdFormatsList = useMemo(() => buildCmdFormats(cdnBase), [cdnBase]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [uploadQueue, setUploadQueue] = useState<Record<string, UploadStatus>>({});
  const [pinnedTarget, setPinnedTarget] = useState("user-uploads/");
  const [searchResults, setSearchResults] = useState<ListItem[]>([]);

  const isServerSearch = filter.startsWith(">");
  const serverQuery = isServerSearch ? filter.slice(1).trim() : "";

  useEffect(() => {
    localStorage.setItem("loader.pinned", JSON.stringify(pinned));
  }, [pinned]);

  useEffect(() => {
    const offProg = window.grudge?.upload?.onProgress?.((p: UploadStatus) => {
      setUploadQueue((q) => ({ ...q, [p.filePath]: p }));
    });
    const offDone = window.grudge?.upload?.onJobDone?.((p: UploadStatus) => {
      setUploadQueue((q) => ({ ...q, [p.filePath]: p }));
      if (p.status === "done") {
        toast.success("Upload complete", { description: p.filePath.split(/[\\/]/).pop() });
      } else if (p.error) {
        toast.error("Upload failed", { description: p.error });
      }
    });
    return () => { offProg?.(); offDone?.(); };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const url: string = await window.grudge?.cf?.r2PublicUrl?.("");
        if (url) setCdnBase(url.replace(/\/$/, ""));
      } catch { /* keep default */ }
    })();
  }, []);

  const browse = useCallback(async (p: string, cursor?: string | null) => {
    setTab("browse");
    setPrefix(p);
    setLoading(true);
    setError(null);
    if (!cursor) {
      setFolders([]);
      setItems([]);
      setNextCursor(null);
    }
    try {
      const res = await window.grudge.os.list({
        prefix: p,
        delimiter: "/",
        limit: 200,
        cursor: cursor ?? undefined,
      });
      setFolders((prev) => (cursor ? prev : (res.folders ?? [])));
      setItems((prev) => (cursor ? [...prev, ...(res.items ?? [])] : (res.items ?? [])));
      setNextCursor(res.nextCursor ?? null);
    } catch (e: any) {
      setError(e.message ?? String(e));
      if (!cursor) {
        setFolders([]);
        setItems([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isServerSearch || !serverQuery) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await window.grudge.os.search({ q: serverQuery, limit: 100 });
        if (cancelled) return;
        setSearchResults((res.items ?? []).map((it: any) => ({
          name: it.path ?? it.name,
          size: it.sizeBytes ?? it.size ?? 0,
          contentType: it.contentType ?? "",
          updated: it.updated ?? null,
        })));
        setTab("browse");
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isServerSearch, serverQuery]);

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
    toast.success("Pinned", { description: prefix });
  }

  function unpin(p: string) {
    setPinned(pinned.filter((x) => x !== p));
  }

  const visibleItems = useMemo(() => {
    if (isServerSearch && serverQuery) return searchResults;
    if (!filter || isServerSearch) return items;
    const f = filter.toLowerCase();
    return items.filter((it) => it.name.toLowerCase().includes(f));
  }, [items, filter, isServerSearch, serverQuery, searchResults]);

  async function enqueueUpload(paths: string[], targetPrefix: string) {
    if (!paths.length) {
      toast.error("No file paths", { description: "Drag-drop or pick files from disk." });
      return;
    }
    const targetBase = targetPrefix.replace(/\/?$/, "/");
    const dropped = paths.map((lp) => ({
      localPath: lp,
      targetPath: `${targetBase}${lp.split(/[\\/]/).pop()}`,
    }));
    try {
      await window.grudge.upload.enqueue({ id: `loader-${Date.now()}`, files: dropped });
      toast.success(`Queued ${dropped.length} file(s)`);
      setTab("upload");
    } catch (e: any) {
      toast.error("Upload enqueue failed", { description: e?.message ?? String(e) });
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    void enqueueUpload(pathsFromFileList(e.dataTransfer.files), pinnedTarget);
  }

  async function pickFiles() {
    const paths = await window.grudge?.files?.pickForUpload?.();
    if (paths?.length) void enqueueUpload(paths, pinnedTarget);
  }

  async function openAssetActions(name: string) {
    const cdn = `${cdnBase}/${name}`;
    if (isModelPath(name)) {
      try {
        await window.grudge?.forge?.openRemote?.(cdn);
        toast.success("Opened in Forge 3D", { description: name.split("/").pop() });
        return;
      } catch (e: any) {
        toast.error("Forge open failed", { description: e?.message ?? String(e) });
      }
    }
    void window.grudge.os.openExternal(cdn);
  }

  return (
    <div className="loader-shell">
      <div className="loader-titlebar">
        <img
          src="./logo-256.png"
          width={22}
          height={22}
          alt="Grudge"
          className="loader-titlebar-emblem"
          onError={(e) => {
            const img = e.currentTarget;
            if (!img.dataset.fallback) {
              img.dataset.fallback = "1";
              img.src = "./favicon.ico";
            }
          }}
        />
        <span className="loader-title">GrudgeLoader</span>
        <StatusBar compact />
        <div className="loader-tab-row ml-auto">
          <button type="button" className={tab === "pinned" ? "active" : ""} onClick={() => setTab("pinned")}>Pinned</button>
          <button type="button" className={tab === "browse" ? "active" : ""} onClick={() => browse(prefix)}>Browse</button>
          <button type="button" className={tab === "upload" ? "active" : ""} onClick={() => setTab("upload")}>Upload</button>
        </div>
        <button type="button" className="loader-close" title="Hide" onClick={() => window.grudge?.loader?.hide?.()}>
          <X size={14} />
        </button>
      </div>

      <div className="loader-body">
        <DemoModeBanner feature="object storage browse / upload" compact />

        {tab === "pinned" && (
          <div className="loader-section">
            <div className="loader-hint">Quick folders — click to browse, ⧉ copies the prefix path.</div>
            {pinned.map((p) => (
              <div className="loader-row" key={p}>
                <Folder size={14} className="text-gold shrink-0" />
                <button type="button" className="loader-link" onClick={() => browse(p)}>{p}</button>
                <button type="button" className="copy-btn" title="Copy path" onClick={() => copy(p)}>{copied === p ? "✓" : "⧉"}</button>
                {!DEFAULT_PINNED.includes(p) && (
                  <button type="button" className="copy-btn danger" title="Unpin" onClick={() => unpin(p)}>×</button>
                )}
              </div>
            ))}
            <div className="loader-row">
              <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="prefix to pin" />
              <button type="button" className="loader-pin-btn" onClick={pinHere}>＋ pin</button>
            </div>
          </div>
        )}

        {tab === "browse" && (
          <div className="loader-section">
            <Breadcrumb prefix={prefix} onSelect={(p) => browse(p)} />
            <div className="loader-bar">
              <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="prefix" />
              <button type="button" onClick={() => browse(prefix)}>Go</button>
              <select value={cmdFormat} onChange={(e) => setCmdFormat(e.target.value as CmdFormat)}>
                {cmdFormatsList.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <input
              className="loader-filter"
              placeholder="filter… or >search server-side"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {isServerSearch && (
              <div className="loader-hint flex items-center gap-1">
                <SearchIcon size={12} /> Server search: {serverQuery || "(type after >)"}
              </div>
            )}
            {loading && <div className="muted text-xs">Loading…</div>}
            {error && <div className="status-bad small">{error}</div>}
            {!isServerSearch && folders.length > 0 && (
              <div className="loader-folder-list">
                {folders.map((f) => (
                  <button type="button" key={f} className="loader-folder-row" onClick={() => browse(f)}>
                    <Folder size={14} className="text-gold" />
                    <span>{f.replace(prefix, "").replace(/\/$/, "") || f}</span>
                    <ChevronRight size={12} className="ml-auto opacity-50" />
                  </button>
                ))}
              </div>
            )}
            <div className="loader-list">
              {visibleItems.map((it) => {
                const fmt = cmdFormatsList.find((c) => c.id === cmdFormat)!;
                const cmd = fmt.tpl(it.name);
                const showImg = isImagePath(it.name) || (it.contentType || "").startsWith("image/");
                const cdnThumb = `${cdnBase}/${it.name}`;
                return (
                  <div className="loader-asset" key={it.name}>
                    <div className="loader-asset-thumb">
                      {showImg
                        ? <img src={cdnThumb} alt="" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        : isModelPath(it.name)
                          ? <Box size={18} className="text-gold" />
                          : <span className="loader-asset-glyph">📄</span>}
                    </div>
                    <div className="loader-asset-meta">
                      <div className="loader-asset-name" title={it.name}>{it.name.split("/").slice(-1)[0]}</div>
                      <div className="muted small">{(it.size / 1024).toFixed(1)} KB</div>
                    </div>
                    <button type="button" className="copy-btn" title={`Copy ${cmdFormat}`} onClick={() => copy(cmd, cmdFormat)}>
                      {copied === cmd ? "✓" : "⧉"}
                    </button>
                    <button
                      type="button"
                      className="copy-btn"
                      title={isModelPath(it.name) ? "Open in Forge 3D" : "Open CDN"}
                      onClick={() => void openAssetActions(it.name)}
                    >
                      {isModelPath(it.name) ? <Box size={12} /> : <ExternalLink size={12} />}
                    </button>
                  </div>
                );
              })}
              {!loading && visibleItems.length === 0 && !folders.length && <div className="muted text-xs">Empty.</div>}
            </div>
            {nextCursor && !isServerSearch && (
              <button type="button" className="btn ghost text-xs w-full mt-2" onClick={() => browse(prefix, nextCursor)}>
                Load more…
              </button>
            )}
          </div>
        )}

        {tab === "upload" && (
          <div className="loader-section">
            <div className="loader-hint">Drop files or pick from disk — uploads to the target prefix via the active backend (R2 / fleet client).</div>
            <div className="loader-bar">
              <input value={pinnedTarget} onChange={(e) => setPinnedTarget(e.target.value)} placeholder="target prefix" />
              <button type="button" className="btn ghost text-xs flex items-center gap-1" onClick={pickFiles}>
                <UploadIcon size={12} /> Pick
              </button>
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
                  <UploadIcon size={14} className="text-gold shrink-0" />
                  <div className="loader-asset-meta">
                    <div className="loader-asset-name" title={row.filePath}>{row.filePath.split(/[\\/]/).pop()}</div>
                    <div className="muted small">
                      {row.status}
                      {row.bytesTotal ? ` · ${Math.round((row.bytesUploaded / row.bytesTotal) * 100)}%` : ""}
                      {row.error && <span className="status-bad"> · {row.error}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="btn ghost text-xs w-full mt-1 flex items-center justify-center gap-1" onClick={() => window.grudge?.app?.openRoute?.("/upload")}>
              <MoreHorizontal size={12} /> Full upload pipeline in main window
            </button>
          </div>
        )}
      </div>
    </div>
  );
}