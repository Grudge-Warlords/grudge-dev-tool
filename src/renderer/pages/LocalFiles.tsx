/**
 * Local Files — browse folders on disk and open any asset type into wired
 * viewers (3D, image, audio, video, text, PDF…). Default is NOT Forge.
 *
 * Actions:
 *   • Click / Enter → inline preview (View Mode viewers)
 *   • Pop-out 3D → ThreeFlow (save / multi-mesh)
 *   • Pop-out media → Elite viewer
 *   • Explicit "Send to Forge" only when user chooses it
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  FolderOpen,
  ChevronRight,
  ChevronUp,
  RefreshCw,
  ExternalLink,
  Maximize2,
  Hammer,
  HardDrive,
  Search,
  Eye,
  FolderSearch,
} from "lucide-react";
import {
  classify,
  formatBytes,
  type AssetRef,
  type AssetKind,
} from "../components/viewers/types";
import { infoIconForKind, INFO_ICONS, INFO_NAV } from "../../shared/infoIcons";
import ImageViewer from "../components/viewers/ImageViewer";
import VideoViewer from "../components/viewers/VideoViewer";
import TextViewer from "../components/viewers/TextViewer";
import PdfViewer from "../components/viewers/PdfViewer";
import FontViewer from "../components/viewers/FontViewer";
import { writeMirror, readMirror } from "../lib/workspace";
import { openAssetInViewMode } from "./ViewMode";

const AudioViewer = React.lazy(() => import("../components/viewers/AudioViewer"));
const Model3DViewer = React.lazy(() => import("../components/viewers/Model3DViewer"));

const RECENT_KEY = "grudge.localFiles.recent";
const MAX_RECENT = 8;

interface LocalEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
  ext: string;
  kind: string;
  contentType: string;
}

interface ListDirResult {
  path: string;
  parent: string | null;
  entries: LocalEntry[];
}

function KindImg({ kind, size = 16 }: { kind: string; size?: number }) {
  return (
    <img
      src={infoIconForKind(kind)}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-sm"
      style={{ objectFit: "contain", background: "rgba(0,0,0,0.25)" }}
      loading="lazy"
      onError={(e) => {
        (e.target as HTMLImageElement).src = INFO_ICONS.effect;
      }}
    />
  );
}

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as string[];
    return Array.isArray(arr) ? arr.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(dir: string) {
  const next = [dir, ...loadRecent().filter((p) => p !== dir)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

function pathParts(abs: string): string[] {
  const norm = abs.replace(/\//g, "\\");
  if (/^[A-Za-z]:\\/.test(norm)) {
    const rest = norm.slice(3).split("\\").filter(Boolean);
    return [norm.slice(0, 3), ...rest];
  }
  return norm.split(/[/\\]/).filter(Boolean);
}

function parentDir(abs: string): string {
  const n = abs.replace(/\//g, "\\");
  const i = n.lastIndexOf("\\");
  if (i <= 2) return n.slice(0, 3);
  return n.slice(0, i);
}

function samePath(a: string, b: string): boolean {
  return a.replace(/\//g, "\\").toLowerCase() === b.replace(/\//g, "\\").toLowerCase();
}

function joinFromParts(parts: string[], idx: number): string {
  if (!parts.length) return "";
  if (/^[A-Za-z]:\\?$/.test(parts[0]) || parts[0].endsWith(":\\") || parts[0].endsWith(":")) {
    const drive = parts[0].replace(/\\?$/, "") + "\\";
    if (idx === 0) return drive;
    return drive + parts.slice(1, idx + 1).join("\\");
  }
  return "/" + parts.slice(0, idx + 1).join("/");
}

async function fileToAssetRef(entry: LocalEntry): Promise<AssetRef> {
  // Video/audio: stream (grudge-media://) — never load whole MP4 into RAM
  const stream =
    entry.kind === "video" ||
    entry.kind === "audio" ||
    /\.(mp4|webm|mov|m4v|ogv|mkv|avi|mp3|wav|ogg|flac|m4a|aac|opus)$/i.test(entry.name);
  if (stream && window.grudge.files?.mediaUrl) {
    const url = await window.grudge.files.mediaUrl(entry.path);
    return {
      name: entry.path.replace(/\\/g, "/"),
      url,
      contentType: entry.contentType || (entry.kind === "video" ? "video/mp4" : "audio/mpeg"),
      size: entry.size || 0,
      localPath: entry.path,
      stream: true,
    };
  }
  const file = await window.grudge.files.read(entry.path);
  const bytes = file.bytes as Uint8Array;
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([ab], { type: file.mime || entry.contentType || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  return {
    name: entry.path.replace(/\\/g, "/"),
    url,
    contentType: file.mime || entry.contentType || "",
    size: file.size || entry.size || bytes.byteLength,
    localPath: entry.path,
  };
}

function PreviewPane({
  asset,
  onPopOut,
  onViewMode,
  onForge,
  onLocateInList,
  busy,
}: {
  asset: AssetRef | null;
  onPopOut: () => void;
  onViewMode: () => void;
  onForge: () => void;
  onLocateInList: () => void;
  busy: boolean;
}) {
  const kind: AssetKind = asset ? classify(asset) : "unknown";

  if (!asset) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted p-8 text-center">
        <HardDrive size={40} className="opacity-40" />
        <p className="text-sm max-w-xs">
          Click to preview. Double-click 3D opens{" "}
          <strong className="text-ink">ThreeFlow</strong> (save, multi-mesh). Images / audio / video stay in Elite.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-bg-1 shrink-0 flex-wrap">
        <Eye size={14} className="text-gold" />
        <span className="text-xs font-semibold truncate flex-1" title={asset.name}>
          {asset.name.split("/").pop()}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-muted border border-line rounded px-1.5 py-0.5">
          {kind}
        </span>
        {asset.size > 0 && (
          <span className="text-[10px] text-muted">{formatBytes(asset.size)}</span>
        )}
        <button
          type="button"
          className="btn ghost text-[11px] px-2 py-1"
          disabled={busy}
          onClick={onPopOut}
          title={kind === "model3d" || kind === "scene3d" ? "ThreeFlow scene editor" : "Elite media viewer"}
        >
          <Maximize2 size={12} className="inline mr-1" />
          {kind === "model3d" || kind === "scene3d" ? "ThreeFlow" : "Pop-out"}
        </button>
        <button
          type="button"
          className="btn ghost text-[11px] px-2 py-1"
          disabled={busy}
          onClick={onViewMode}
          title="Open in View Mode tab"
        >
          <Eye size={12} className="inline mr-1" />
          View Mode
        </button>
        <button
          type="button"
          className="btn ghost text-[11px] px-2 py-1 text-muted"
          disabled={busy}
          onClick={onForge}
          title="Explicit only — send model into Forge editor"
        >
          <Hammer size={12} className="inline mr-1" />
          Forge
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden bg-bg-0">
        <React.Suspense
          fallback={
            <div className="h-full flex items-center justify-center text-gold text-sm">
              Loading viewer…
            </div>
          }
        >
          {kind === "image" && <ImageViewer asset={asset} />}
          {kind === "video" && <VideoViewer asset={asset} />}
          {kind === "audio" && <AudioViewer asset={asset} />}
          {(kind === "model3d" || kind === "scene3d") && (
            <Model3DViewer asset={asset} onLocateInList={onLocateInList} />
          )}
          {kind === "text" && <TextViewer asset={asset} />}
          {kind === "pdf" && <PdfViewer asset={asset} />}
          {kind === "font" && <FontViewer asset={asset} />}
          {kind === "unknown" && (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-muted text-sm p-6">
              <KindImg kind="file" size={36} />
              <p>No specialized viewer for this type.</p>
              <p className="text-xs">Use Pop-out, system open, or View Mode.</p>
            </div>
          )}
        </React.Suspense>
      </div>
    </div>
  );
}

export default function LocalFiles() {
  const [cwd, setCwd] = useState<string>(() => {
    try {
      const m = readMirror() as { localAssetsRoot?: string };
      return m.localAssetsRoot || loadRecent()[0] || "";
    } catch {
      return loadRecent()[0] || "";
    }
  });
  const [listing, setListing] = useState<ListDirResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  /** Kind chip filter for game media packs (audio / video / 3D / …). */
  const [kindFilter, setKindFilter] = useState<
    "all" | "audio" | "video" | "model3d" | "image" | "design" | "text"
  >("all");
  const [selected, setSelected] = useState<LocalEntry | null>(null);
  const [preview, setPreview] = useState<AssetRef | null>(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const blobRevoke = useRef<string | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);

  const revokePreview = useCallback(() => {
    if (blobRevoke.current) {
      URL.revokeObjectURL(blobRevoke.current);
      blobRevoke.current = null;
    }
  }, []);

  const loadDir = useCallback(async (dir: string): Promise<ListDirResult | null> => {
    if (!dir) return null;
    setLoading(true);
    setError(null);
    try {
      const res = (await window.grudge.files.listDir(dir)) as ListDirResult;
      setListing(res);
      setCwd(res.path);
      setRecent(pushRecent(res.path));
      writeMirror({ localAssetsRoot: res.path });
      try {
        await window.grudge?.workspace?.patch?.({ localAssetsRoot: res.path });
      } catch {
        /* offline store */
      }
      return res;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setListing(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cwd) void loadDir(cwd);
    return () => revokePreview();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — mount restore only

  // OS / elite open bridge: Explorer double-click lands here + pop-out viewer
  useEffect(() => {
    const off = window.grudge?.openFile?.onOpened?.(async (info: {
      path: string;
      name: string;
      dir: string;
      kind: string;
      contentType: string;
      size: number;
      token?: string;
    }) => {
      try {
        if (info.dir) {
          setRecent(pushRecent(info.dir));
          writeMirror({ localAssetsRoot: info.dir });
          await loadDir(info.dir);
        }
        const entry: LocalEntry = {
          name: info.name,
          path: info.path,
          isDirectory: false,
          size: info.size || 0,
          mtimeMs: Date.now(),
          ext: info.name.includes(".") ? info.name.split(".").pop()!.toLowerCase() : "",
          kind: info.kind || "file",
          contentType: info.contentType || "",
        };
        setSelected(entry);
        // Mirror in-pane preview while pop-out already shows the file
        try {
          const asset = await fileToAssetRef(entry);
          revokePreview();
          blobRevoke.current = asset.url;
          setPreview(asset);
        } catch {
          /* pop-out is enough */
        }
        const is3d = info.kind === "model3d" || info.kind === "scene3d";
        toast.success(is3d ? "Elite 3D pipeline" : "Elite viewer", {
          description: `${info.kind} · ${info.name}${is3d ? " · ThreeFlow from viewer/Admin" : ""}`,
        });
      } catch (e: unknown) {
        console.warn("[LocalFiles] openFile:opened", e);
      }
    });
    return () => {
      if (typeof off === "function") off();
    };
  }, [loadDir, revokePreview]);

  const pickFolder = useCallback(async () => {
    try {
      const dir = await window.grudge.files.pickDirectory(cwd || undefined);
      if (!dir) return;
      setSelected(null);
      revokePreview();
      setPreview(null);
      await loadDir(dir);
    } catch (e: unknown) {
      toast.error("Could not open folder", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }, [loadDir, revokePreview]);

  const goParent = useCallback(() => {
    if (listing?.parent) void loadDir(listing.parent);
  }, [listing, loadDir]);

  const filtered = useMemo(() => {
    const entries = listing?.entries ?? [];
    const q = filter.trim().toLowerCase();
    return entries.filter((e) => {
      // Folders always listed so media packs stay navigable under kind chips
      if (e.isDirectory) {
        if (!q) return true;
        return e.name.toLowerCase().includes(q);
      }
      if (kindFilter !== "all") {
        const k = e.kind;
        if (kindFilter === "model3d") {
          if (k !== "model3d" && k !== "scene3d") return false;
        } else if (k !== kindFilter) {
          return false;
        }
      }
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.kind.includes(q) ||
        e.ext.includes(q)
      );
    });
  }, [listing, filter, kindFilter]);

  const openEntry = useCallback(
    async (entry: LocalEntry, mode: "preview" | "popout" | "viewmode" = "preview") => {
      if (entry.isDirectory) {
        setSelected(null);
        revokePreview();
        setPreview(null);
        await loadDir(entry.path);
        return;
      }
      setSelected(entry);
      setBusy(true);
      try {
        if (mode === "popout") {
          // Double-click / Pop-out: 3D → ThreeFlow ThreePipe; media → Elite.
          const r = await window.grudge.openFile?.openPath?.(entry.path);
          if (r && "ok" in r && r.ok) return;
          await window.grudge.viewer.openLocal({
            path: entry.path,
            contentType: entry.contentType,
            size: entry.size,
          });
          toast.error(
            (r && "error" in r && r.error) || "Open failed",
            { description: entry.name },
          );
          return;
        }

        const asset = await fileToAssetRef(entry);
        revokePreview();
        blobRevoke.current = asset.url;

        if (mode === "viewmode") {
          openAssetInViewMode(asset);
          toast.success("Opened in View Mode", { description: entry.name });
          return;
        }

        setPreview(asset);
      } catch (e: unknown) {
        toast.error("Open failed", {
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setBusy(false);
      }
    },
    [loadDir, revokePreview],
  );

  const crumbs = useMemo(() => (cwd ? pathParts(cwd) : []), [cwd]);

  const onPopOut = useCallback(async () => {
    const path = preview?.localPath || selected?.path;
    if (!path) return;
    const entry = selected && samePath(selected.path, path)
      ? selected
      : listing?.entries.find((e) => samePath(e.path, path));
    if (entry) {
      await openEntry(entry, "popout");
      return;
    }
    const stub: LocalEntry = {
      name: path.split(/[/\\]/).pop() || path,
      path,
      isDirectory: false,
      size: preview?.size || 0,
      mtimeMs: 0,
      ext: (path.split(".").pop() || "").toLowerCase(),
      kind: selected?.kind || "file",
      contentType: preview?.contentType || selected?.contentType || "",
    };
    await openEntry(stub, "popout");
  }, [selected, preview, listing, openEntry]);

  const locateViewportAsset = useCallback(async () => {
    const path = preview?.localPath;
    if (!path) {
      toast.message("Nothing in the viewport");
      return;
    }
    const dir = parentDir(path);
    setKindFilter("all");
    setFilter("");
    let list = listing;
    if (!cwd || !samePath(dir, cwd)) {
      list = await loadDir(dir);
    }
    const entry = list?.entries.find((e) => samePath(e.path, path));
    if (entry) setSelected(entry);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const rows = listScrollRef.current?.querySelectorAll<HTMLElement>("[data-local-path]");
        if (!rows) return;
        for (const row of rows) {
          if (samePath(row.dataset.localPath || "", path)) {
            row.scrollIntoView({ block: "center", behavior: "smooth" });
            row.focus();
            return;
          }
        }
        toast.message("Not in this list", { description: "Cleared filters — check the folder." });
      });
    });
  }, [preview, listing, cwd, loadDir]);

  const onViewMode = useCallback(() => {
    if (!preview) return;
    openAssetInViewMode(preview);
    toast.success("Opened in View Mode");
  }, [preview]);

  const onForge = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      // Prefer disk path via forge open when model; else blob won't work for Forge
      const isModel = /model3d|scene3d|glb|gltf|fbx|obj/i.test(selected.kind + selected.ext);
      if (!isModel) {
        toast.message("Forge is for 3D models", {
          description: "Use Pop-out or View Mode for images / audio.",
        });
        return;
      }
      // Navigate to local forge tools with file — user explicit action only
      sessionStorage.setItem("grudge.forge.pendingLocalPath", selected.path);
      await window.grudge?.app?.openRoute?.("/forge-local");
      toast.message("Opening in local Forge tools…", { description: selected.name });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Forge handoff failed");
    } finally {
      setBusy(false);
    }
  }, [selected]);

  return (
    <div className="h-full min-h-0 flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-line bg-bg-1 flex flex-col gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <img
            src={INFO_NAV.localFiles}
            alt=""
            width={22}
            height={22}
            className="rounded"
            style={{ objectFit: "contain" }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold text-gold tracking-wide">Local Files · Elite open</h1>
            <p className="text-[11px] text-muted">
              Click = preview. Double-click 3D = <strong className="text-ink">ThreeFlow</strong>. Images / audio / video = Elite.
              System open = OS app. AI card = clipboard for agents.
            </p>
          </div>
          <button type="button" className="btn text-xs px-3 py-1.5" onClick={pickFolder}>
            <FolderOpen size={14} className="inline mr-1.5" />
            Open folder…
          </button>
          <button
            type="button"
            className="btn ghost text-xs px-2 py-1.5"
            disabled={!cwd || loading}
            onClick={() => cwd && loadDir(cwd)}
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {cwd && (
          <div className="flex items-center gap-1 text-[11px] flex-wrap min-w-0">
            <button
              type="button"
              className="btn ghost p-1"
              disabled={!listing?.parent}
              onClick={goParent}
              title="Up"
            >
              <ChevronUp size={14} />
            </button>
            {crumbs.map((part, i) => (
              <React.Fragment key={`${part}-${i}`}>
                {i > 0 && <ChevronRight size={12} className="text-muted shrink-0" />}
                <button
                  type="button"
                  className="hover:text-gold truncate max-w-[140px]"
                  onClick={() => void loadDir(joinFromParts(crumbs, i))}
                >
                  {part}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}

        {!cwd && recent.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[10px] text-muted uppercase tracking-wide">Recent</span>
            {recent.map((r) => (
              <button
                key={r}
                type="button"
                className="text-[11px] px-2 py-0.5 rounded border border-line hover:border-gold/40 hover:text-gold truncate max-w-[220px]"
                title={r}
                onClick={() => void loadDir(r)}
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex">
        {/* File list */}
        <div className="w-[42%] min-w-[260px] max-w-[520px] border-r border-line flex flex-col min-h-0">
          <div className="shrink-0 p-2 border-b border-line flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Search size={14} className="text-muted" />
              <input
                className="flex-1 text-xs py-1"
                placeholder="Filter by name, kind, ext…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                disabled={!listing}
              />
              <span className="text-[10px] text-muted tabular-nums">
                {filtered.length}
                {listing ? ` / ${listing.entries.length}` : ""}
              </span>
            </div>
            {/* Kind chips — organize game media packs for quick SFX / video test */}
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["all", "All"],
                  ["audio", "Audio"],
                  ["video", "Video"],
                  ["model3d", "3D"],
                  ["image", "Image"],
                  ["design", "Design"],
                  ["text", "Text"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={
                    "text-[10px] px-2 py-0.5 rounded border " +
                    (kindFilter === id
                      ? "border-gold/50 bg-gold/15 text-gold"
                      : "border-line text-muted hover:border-gold/30 hover:text-ink")
                  }
                  onClick={() => setKindFilter(id)}
                  disabled={!listing}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-auto" ref={listScrollRef}>
            {!cwd && (
              <div className="p-8 text-center text-muted text-sm space-y-3">
                <FolderOpen size={36} className="mx-auto opacity-40" />
                <p>Choose a folder to browse models, textures, audio, and more.</p>
                <button type="button" className="btn text-xs" onClick={pickFolder}>
                  Open folder…
                </button>
              </div>
            )}
            {error && (
              <div className="p-4 text-danger text-xs">{error}</div>
            )}
            {loading && (
              <div className="p-4 text-muted text-xs">Listing…</div>
            )}
            {listing && !loading && (
              <ul className="py-1">
                {filtered.map((entry) => {
                  const active = selected?.path === entry.path;
                  return (
                    <li key={entry.path}>
                      <button
                        type="button"
                        data-local-path={entry.path}
                        className={
                          "w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-bg-2 " +
                          (active ? "bg-gold/10 text-gold" : "text-ink")
                        }
                        onClick={() => void openEntry(entry, "preview")}
                        onDoubleClick={() => void openEntry(entry, "popout")}
                        title={
                          entry.isDirectory
                            ? entry.path
                            : `${entry.path}\nDouble-click = ${entry.kind === "model3d" || entry.kind === "scene3d" ? "ThreeFlow editor" : "elite viewer"}`
                        }
                      >
                        <KindImg kind={entry.isDirectory ? "dir" : entry.kind} size={16} />
                        <span className="truncate flex-1">{entry.name}</span>
                        {!entry.isDirectory && (
                          <span className="text-[10px] text-muted tabular-nums shrink-0">
                            {formatBytes(entry.size)}
                          </span>
                        )}
                        {entry.isDirectory && (
                          <ChevronRight size={12} className="text-muted shrink-0" />
                        )}
                      </button>
                    </li>
                  );
                })}
                {filtered.length === 0 && (
                  <li className="px-3 py-6 text-center text-muted text-xs">No matches</li>
                )}
              </ul>
            )}
          </div>

          {selected && !selected.isDirectory && (
            <div className="shrink-0 border-t border-line p-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                className="btn ghost text-[11px] px-2 py-1"
                onClick={() => void onPopOut()}
              >
                <Maximize2 size={12} className="inline mr-1" />
                {selected.kind === "model3d" || selected.kind === "scene3d"
                  ? "Pop-out ThreeFlow"
                  : "Pop-out viewer"}
              </button>
              <button
                type="button"
                className="btn ghost text-[11px] px-2 py-1"
                title="Copy full disk path"
                onClick={() => {
                  void window.grudge.files.copyPath(selected.path).then((r: { path: string }) => {
                    toast.success("Path copied", { description: r.path });
                  }).catch((e: Error) => toast.error(e?.message || "Copy failed"));
                }}
              >
                Copy as path
              </button>
              <button
                type="button"
                className="btn ghost text-[11px] px-2 py-1"
                onClick={() => void openEntry(selected, "viewmode")}
              >
                <Eye size={12} className="inline mr-1" />
                View Mode
              </button>
              <button
                type="button"
                className="btn ghost text-[11px] px-2 py-1"
                onClick={() =>
                  void window.grudge.files.reveal(selected.path).then(() =>
                    toast.success("Revealed in Explorer"),
                  )
                }
              >
                <ExternalLink size={12} className="inline mr-1" />
                Reveal
              </button>
              <button
                type="button"
                className="btn ghost text-[11px] px-2 py-1"
                title="Open in the OS default app (Blender, Photoshop, Photos, …)"
                onClick={() =>
                  void window.grudge.files.openSystem(selected.path).then(() => {
                    toast.success("Opened in system app", { description: selected.name });
                  }).catch((e: Error) =>
                    toast.error(e?.message || "System open failed"),
                  )
                }
              >
                System open
              </button>
              <button
                type="button"
                className="btn ghost text-[11px] px-2 py-1"
                title="Copy markdown card for AI (kind, open path, GLB inspect). Vision caption only for images."
                onClick={() => {
                  void (async () => {
                    try {
                      const r = await window.grudge.asset?.understand?.({
                        path: selected.path,
                        name: selected.name,
                        contentType: selected.contentType,
                        size: selected.size,
                        withAi: selected.kind === "image",
                      });
                      if (!r?.ok) {
                        toast.error(r?.error || "Understand failed");
                        return;
                      }
                      await navigator.clipboard.writeText(r.markdown);
                      toast.success("AI card copied", {
                        description: r.aiNote?.slice(0, 120) || r.summary?.slice(0, 100),
                      });
                    } catch (e: unknown) {
                      toast.error(e instanceof Error ? e.message : "Understand failed");
                    }
                  })();
                }}
              >
                AI card
              </button>
            </div>
          )}
        </div>

        {/* Preview */}
        <PreviewPane
          asset={preview}
          onPopOut={onPopOut}
          onViewMode={onViewMode}
          onForge={onForge}
          onLocateInList={() => void locateViewportAsset()}
          busy={busy}
        />
      </div>
    </div>
  );
}
