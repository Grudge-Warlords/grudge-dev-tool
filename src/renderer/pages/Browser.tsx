import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronRight, ChevronDown, Folder, FolderOpen, FileText, Image as ImageIcon,
  Box, Music, Search as SearchIcon, Copy, ExternalLink, Home,
} from "lucide-react";
import type { AssetRef } from "../components/viewers/types";
import { readMirror } from "../lib/workspace";
import { openAssetInViewMode } from "./ViewMode";

interface ListResp {
  items: Array<{ name: string; size: number; contentType: string; updated: string | null }>;
  folders: string[];
  prefix: string;
}

const BUCKET_ROOT = ""; // empty string = list every top-level prefix in the bucket
const ROOT_PREFIX = ""; // start at the bucket root by default

function fileIcon(contentType: string) {
  if (contentType.startsWith("image/")) return <ImageIcon size={14} className="text-gold" />;
  if (contentType.startsWith("audio/")) return <Music size={14} className="text-gold" />;
  if (contentType.includes("gltf") || contentType.includes("blender") || contentType.includes("octet-stream"))
    return <Box size={14} className="text-gold" />;
  return <FileText size={14} className="text-muted" />;
}

function basename(path: string): string {
  const trimmed = path.replace(/\/$/, "");
  const i = trimmed.lastIndexOf("/");
  return i >= 0 ? trimmed.slice(i + 1) : trimmed;
}

interface TreeNodeProps {
  prefix: string;
  depth: number;
  selected: string;
  onSelect: (p: string) => void;
}

function TreeNode({ prefix, depth, selected, onSelect }: TreeNodeProps) {
  const [open, setOpen] = useState(depth === 0);
  const display = prefix === ""
    ? "(bucket root)"
    : (depth === 0 ? prefix : basename(prefix));
  const { data, isLoading, error } = useQuery({
    queryKey: ["os.list.folders", prefix],
    queryFn: async (): Promise<ListResp> =>
      window.grudge.os.list({ prefix, delimiter: "/", limit: 200 }),
    enabled: open,
  });
  const isSelected = selected === prefix;

  return (
    <div>
      <button
        className={`flex items-center gap-1 w-full text-left px-2 py-1 rounded hover:bg-bg-2 ${isSelected ? "bg-gold/10 text-gold" : "text-ink"}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => { setOpen(!open); onSelect(prefix); }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {open ? <FolderOpen size={14} className="text-gold" /> : <Folder size={14} className="text-muted" />}
        <span className="text-xs truncate">{display}</span>
      </button>
      {open && (
        <div>
          {isLoading && <div className="text-[10px] text-muted px-2" style={{ paddingLeft: 6 + (depth + 1) * 12 }}>loading…</div>}
          {error && <div className="text-[10px] text-danger px-2" style={{ paddingLeft: 6 + (depth + 1) * 12 }}>{(error as Error).message}</div>}
          {data?.folders?.map((f) => (
            <TreeNode key={f} prefix={f} depth={depth + 1} selected={selected} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

function Breadcrumb({ prefix, onSelect }: { prefix: string; onSelect: (p: string) => void }) {
  const parts = prefix.split("/").filter(Boolean);
  const crumbs: { label: string; path: string }[] = [];
  let acc = "";
  for (const p of parts) {
    acc += p + "/";
    crumbs.push({ label: p, path: acc });
  }
  return (
    <div className="flex items-center gap-1 text-xs text-muted overflow-x-auto whitespace-nowrap">
      <button onClick={() => onSelect("")} className="hover:text-gold flex items-center gap-1">
        <Home size={12} /> root
      </button>
      {crumbs.map((c, i) => (
        <React.Fragment key={c.path}>
          <ChevronRight size={10} className="opacity-50" />
          <button
            onClick={() => onSelect(c.path)}
            className={i === crumbs.length - 1 ? "text-gold" : "hover:text-gold"}
          >
            {c.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

export default function Browser() {
  const [selected, setSelected] = useState<string>(() => readMirror().browserPrefix ?? ROOT_PREFIX);
  const [filter, setFilter] = useState<string>("");
  /** Debounced query for full-catalog search (all Grudge Studio Assets). */
  const [debouncedQ, setDebouncedQ] = useState("");

  useEffect(() => {
    void (async () => {
      const snap = await window.grudge?.workspace?.get?.();
      if (snap?.browserPrefix != null) setSelected(snap.browserPrefix);
    })();
  }, []);

  // Normalize: leading ">" is optional legacy syntax for server search
  const rawQuery = filter.startsWith(">") ? filter.slice(1).trim() : filter.trim();
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(rawQuery), 280);
    return () => window.clearTimeout(t);
  }, [rawQuery]);

  /** Global search whenever the user types 1+ chars — entire R2 / live index. */
  const isGlobalSearch = debouncedQ.length > 0;

  const listing = useQuery({
    queryKey: ["os.list.contents", selected],
    queryFn: async (): Promise<ListResp> =>
      window.grudge.os.list({ prefix: selected, delimiter: "/", limit: 500 }),
    enabled: !isGlobalSearch,
  });

  const search = useQuery({
    queryKey: ["os.search.all", debouncedQ],
    queryFn: async (): Promise<{ count: number; items: any[] }> =>
      window.grudge.os.search({ q: debouncedQ, limit: 400 }),
    enabled: isGlobalSearch,
    staleTime: 30_000,
  });

  const folders = listing.data?.folders ?? [];
  const files = listing.data?.items ?? [];

  const filtered = useMemo(() => {
    // Folder browse only when not in global search mode
    if (isGlobalSearch) return [];
    return files;
  }, [files, isGlobalSearch]);

  // CDN base resolved at runtime via cf.r2PublicUrl("") so a private deploy
  // pointing at a different domain Just Works. Defaults to the canonical
  // assets.grudge-studio.com until the IPC resolves.
  const [cdnBase, setCdnBase] = useState("https://assets.grudge-studio.com");
  useEffect(() => {
    (async () => {
      try {
        const url: string = await (window as any).grudge?.cf?.r2PublicUrl?.("");
        if (url) setCdnBase(url.replace(/\/$/, ""));
      } catch { /* keep default */ }
    })();
  }, []);
  const cdnUrl = (path: string) => `${cdnBase}/${path}`;
  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`Copied ${label}`));
  };
  const toRef = (it: { name: string; size: number; contentType: string }): AssetRef => ({
    name: it.name,
    url: cdnUrl(it.name),
    contentType: it.contentType ?? "",
    size: it.size ?? 0,
  });

  /** Open any asset in View Mode for review / save / Forge / storage / AI define. */
  const openInViewMode = (it: { name: string; size: number; contentType: string }) => {
    openAssetInViewMode(toRef(it));
  };

  return (
    <div className="flex flex-col h-full">
      <div className="mb-3">
        <h1 className="page-title">Grudge Studio Assets</h1>
        <p className="page-sub">
          Full fleet catalog · R2 binaries on{" "}
          <span className="font-mono text-[11px]">assets.grudge-studio.com</span>.{" "}
          <strong className="text-gold">Search</strong> queries{" "}
          <em>all</em> assets (models, textures, audio, UI, anims, prod/gltf…). Empty search browses the folder tree. Click →
          <strong className="text-sky-300"> View Mode</strong>.
        </p>
      </div>

      <div className="flex flex-1 gap-3 min-h-0">
        <aside className="w-64 shrink-0 border border-line rounded-md bg-bg-1 overflow-y-auto p-1">
          {/* Bucket root — lists whatever top-level prefixes actually exist. */}
          <TreeNode prefix={BUCKET_ROOT} depth={0} selected={selected} onSelect={setSelected} />
        </aside>

        <section className="flex-1 flex flex-col min-w-0 border border-line rounded-md bg-bg-1">
          <div className="border-b border-line px-3 py-2 flex items-center gap-3 flex-wrap">
            {!isGlobalSearch && <Breadcrumb prefix={selected} onSelect={setSelected} />}
            {isGlobalSearch && (
              <span className="text-xs text-gold font-medium">
                All assets · “{debouncedQ}”
              </span>
            )}
            <div className="ml-auto relative flex items-center gap-2">
              <SearchIcon size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                placeholder="Search all Grudge Studio Assets…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="bg-bg-2 border border-line rounded pl-7 pr-2 py-1 text-xs w-72"
                aria-label="Search all Grudge Studio Assets"
              />
              {filter && (
                <button
                  type="button"
                  className="text-[10px] text-muted hover:text-gold"
                  onClick={() => setFilter("")}
                  title="Clear search"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {(listing.isLoading && !isGlobalSearch) && <div className="text-muted text-sm">Loading…</div>}
            {listing.error && !isGlobalSearch && (
              <div className="text-danger text-sm">{(listing.error as Error).message}</div>
            )}

            {isGlobalSearch ? (
              <div>
                {search.isLoading && (
                  <div className="text-muted text-sm mb-2">Searching full asset catalog…</div>
                )}
                {search.error && (
                  <div className="text-danger text-sm mb-2">{(search.error as Error).message}</div>
                )}
                <div className="text-xs text-muted mb-2">
                  {search.data
                    ? `Found ${search.data.count.toLocaleString()} · showing ${search.data.items?.length ?? 0}`
                    : "…"}
                  {" "}across all Grudge Studio Assets
                </div>
                <div className="grid grid-cols-1 gap-1">
                  {(search.data?.items ?? []).map((it: any, i: number) => {
                    const path = it.path || it.name;
                    return (
                      <div
                        key={`${path}-${i}`}
                        className="border border-line bg-bg-2 rounded p-2 flex items-center gap-2 cursor-pointer hover:border-gold/50"
                        title="Open in View Mode"
                        role="button"
                        tabIndex={0}
                        onClick={() => openInViewMode({
                          name: path,
                          size: it.sizeBytes ?? it.size ?? 0,
                          contentType: it.contentType ?? "",
                        })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openInViewMode({
                              name: path,
                              size: it.sizeBytes ?? it.size ?? 0,
                              contentType: it.contentType ?? "",
                            });
                          }
                        }}
                      >
                        {fileIcon(it.contentType ?? "")}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs truncate text-ink">{basename(path)}</div>
                          <div className="text-[10px] text-muted truncate" title={path}>{path}</div>
                        </div>
                        {it.category && (
                          <span className="text-[10px] text-gold/80 shrink-0">{it.category}</span>
                        )}
                        <span className="text-[10px] text-muted shrink-0">{it.packId}</span>
                        <button
                          type="button"
                          className="copy-btn"
                          title="Copy as path (R2 key)"
                          onClick={(e) => {
                            e.stopPropagation();
                            copy(path, "path");
                          }}
                        >
                          Path
                        </button>
                        <button
                          type="button"
                          className="copy-btn"
                          title="Copy CDN URL"
                          onClick={(e) => {
                            e.stopPropagation();
                            copy(cdnUrl(path), "CDN URL");
                          }}
                        >
                          <Copy size={11} />
                        </button>
                        <button
                          type="button"
                          className="copy-btn"
                          title="Open CDN URL"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.grudge?.os?.openExternal?.(cdnUrl(path));
                          }}
                        >
                          <ExternalLink size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                {!search.isLoading && (search.data?.items?.length ?? 0) === 0 && (
                  <div className="text-muted text-sm mt-4">No assets match “{debouncedQ}”.</div>
                )}
              </div>
            ) : (
              <>
                {folders.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs text-muted mb-1">Folders</div>
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                      {folders.map((f) => (
                        <button
                          key={f}
                          onClick={() => setSelected(f)}
                          className="border border-line bg-bg-2 hover:bg-bg-2/70 hover:border-gold-deep rounded p-2 flex flex-col items-center gap-1 text-xs"
                        >
                          <Folder size={20} className="text-gold" />
                          <span className="truncate w-full text-center">{basename(f)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="text-xs text-muted mb-1">
                  Files {filtered.length !== files.length ? `(${filtered.length} of ${files.length})` : `(${files.length})`}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {filtered.map((it) => {
                    const isImg = it.contentType.startsWith("image/");
                    return (
                      <div
                        key={it.name}
                        className="border border-line bg-bg-2 rounded p-2 flex flex-col gap-1 group cursor-pointer hover:border-gold/50"
                        title="Open in View Mode"
                        role="button"
                        tabIndex={0}
                        onClick={() => openInViewMode(it)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openInViewMode(it);
                          }
                        }}
                      >
                        <div className="aspect-square bg-black rounded overflow-hidden flex items-center justify-center">
                          {isImg ? (
                            <img src={cdnUrl(it.name)} alt="" loading="lazy" className="w-full h-full object-cover" />
                          ) : (
                            fileIcon(it.contentType)
                          )}
                        </div>
                        <div className="text-[11px] truncate" title={it.name}>{basename(it.name)}</div>
                        <div className="flex items-center gap-1 text-[10px] text-muted">
                          <span>{(it.size / 1024).toFixed(1)} KB</span>
                          <button
                            className="ml-auto copy-btn opacity-0 group-hover:opacity-100"
                            title="Copy as path (R2 key)"
                            onClick={(e) => { e.stopPropagation(); copy(it.name, "path"); }}
                          >
                            Path
                          </button>
                          <button
                            className="copy-btn opacity-0 group-hover:opacity-100"
                            title="Copy CDN URL"
                            onClick={(e) => { e.stopPropagation(); copy(cdnUrl(it.name), "CDN URL"); }}
                          >
                            <Copy size={11} />
                          </button>
                          <button
                            className="copy-btn opacity-0 group-hover:opacity-100"
                            title="Open externally"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.grudge?.os?.openExternal?.(cdnUrl(it.name));
                            }}
                          >
                            <ExternalLink size={11} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {filtered.length === 0 && folders.length === 0 && !listing.isLoading && (
                  <div className="text-muted text-sm">Empty.</div>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
