/**
 * Object Storage Browser — R2 folder tree + files with stable Grudge UUIDs.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronRight, ChevronDown, Folder, FolderOpen, FileText, Image as ImageIcon,
  Box, Music, Search as SearchIcon, Copy, ExternalLink, Home, Fingerprint,
  RefreshCw, Loader2, Eye, Hammer,
} from "lucide-react";
import DemoModeBanner from "../components/DemoModeBanner";
import { useWorkspaceField } from "../lib/useWorkspaceField";
import { is3dAssetPath, openBrowserAssetIn3d, openRemoteInForge } from "../lib/openInForge";

interface ListResp {
  items: Array<{ name: string; size: number; contentType: string; updated: string | null }>;
  folders: string[];
  prefix: string;
}

interface RegistryEntry {
  grudgeUUID: string;
  path: string;
  family?: string;
  slot?: string;
  contentType?: string | null;
  sizeBytes?: number;
}

const BUCKET_ROOT = "";
const ROOT_PREFIX = "";

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
  const qc = useQueryClient();
  const [selected, setSelected] = useWorkspaceField("browserPrefix", ROOT_PREFIX);
  const [filter, setFilter] = useState<string>("");
  const [uuidMap, setUuidMap] = useState<Record<string, RegistryEntry | null>>({});
  const [regStats, setRegStats] = useState<{ count: number; updatedAt: string | null } | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null);

  const isServerSearch = filter.startsWith(">");
  const serverQuery = isServerSearch ? filter.slice(1).trim() : "";

  const listing = useQuery({
    queryKey: ["os.list.contents", selected],
    queryFn: async (): Promise<ListResp> =>
      window.grudge.os.list({ prefix: selected, delimiter: "/", limit: 500 }),
    enabled: !isServerSearch,
  });

  const search = useQuery({
    queryKey: ["os.search", serverQuery],
    queryFn: async (): Promise<{ items: any[] }> =>
      window.grudge.os.search({ q: serverQuery, limit: 200 }),
    enabled: isServerSearch && serverQuery.length > 0,
  });

  const folders = listing.data?.folders ?? [];
  const files = listing.data?.items ?? [];

  const filtered = useMemo(() => {
    if (isServerSearch) return [];
    if (!filter) return files;
    const f = filter.toLowerCase();
    return files.filter((it) =>
      it.name.toLowerCase().includes(f) ||
      (uuidMap[it.name]?.grudgeUUID || "").toLowerCase().includes(f),
    );
  }, [files, filter, isServerSearch, uuidMap]);

  // Load registry stats + UUIDs for visible files
  useEffect(() => {
    void (async () => {
      try {
        const s = await window.grudge.registry?.stats?.();
        if (s) setRegStats({ count: s.count, updatedAt: s.updatedAt });
      } catch { /* R2 may be offline */ }
    })();
  }, []);

  useEffect(() => {
    const paths = files.map((f) => f.name);
    if (paths.length === 0) {
      setUuidMap({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Prefer batch lookup; mint missing via uuidForPath without full write flood
        const map = await window.grudge.registry?.lookupMany?.(paths);
        if (cancelled) return;
        if (map) {
          const next: Record<string, RegistryEntry | null> = { ...map };
          // Fill gaps with deterministic client-side path UUID (same algorithm in main)
          for (const p of paths) {
            if (!next[p]) {
              try {
                const uuid = await window.grudge.registry.uuidForPath(p);
                next[p] = { grudgeUUID: uuid, path: p };
              } catch { /* */ }
            }
          }
          setUuidMap(next);
        }
      } catch {
        // Fallback: compute path UUIDs one-by-one
        const next: Record<string, RegistryEntry | null> = {};
        for (const p of paths) {
          try {
            const uuid = await window.grudge.registry.uuidForPath(p);
            next[p] = { grudgeUUID: uuid, path: p };
          } catch {
            next[p] = null;
          }
        }
        if (!cancelled) setUuidMap(next);
      }
    })();
    return () => { cancelled = true; };
  }, [files]);

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

  async function runBackfill(prefix: string) {
    setBackfilling(true);
    setBackfillMsg(prefix ? `Scanning ${prefix}…` : "Scanning entire bucket…");
    try {
      const r = await window.grudge.registry.backfill({ prefix, limit: 50_000 });
      setBackfillMsg(
        r.error
          ? `Done with errors: ${r.error}`
          : `Registered ${r.registered} / scanned ${r.scanned} (skipped ${r.skipped})`,
      );
      const s = await window.grudge.registry.stats();
      setRegStats({ count: s.count, updatedAt: s.updatedAt });
      toast.success("Asset UUID registry updated", {
        description: `${s.count} assets indexed`,
      });
      // Refresh UUID map for current folder
      void qc.invalidateQueries({ queryKey: ["os.list.contents", selected] });
      const paths = (listing.data?.items ?? []).map((f) => f.name);
      if (paths.length) {
        const map = await window.grudge.registry.lookupMany(paths);
        setUuidMap(map || {});
      }
    } catch (e: any) {
      toast.error("Backfill failed", { description: e?.message ?? String(e) });
      setBackfillMsg(e?.message ?? "failed");
    } finally {
      setBackfilling(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="mb-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div>
          <h1 className="page-title">Object Storage Browser</h1>
          <p className="page-sub">
            Click a folder on the left. Use <span className="kbd">&gt; query</span> for server-side search.
            3D models: <strong>View 3D</strong> opens Assets → 3D Studio (viewer + converter).
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="text-[10px] text-muted">
            Registry:{" "}
            <span className="text-gold font-mono">{regStats?.count ?? "—"}</span> assets
            {regStats?.updatedAt && (
              <span className="ml-1 opacity-70">· {regStats.updatedAt.slice(0, 19)}</span>
            )}
          </div>
          <div className="flex gap-1 flex-wrap justify-end">
            <button
              type="button"
              className="btn ghost text-[10px] flex items-center gap-1"
              onClick={() => window.grudge.app.openRoute("/assets-3d")}
              title="Open 3D viewer & converter"
            >
              <Box size={11} /> 3D Studio
            </button>
            <button
              type="button"
              className="btn ghost text-[10px] flex items-center gap-1"
              disabled={backfilling}
              title="Index current folder into UUID registry"
              onClick={() => void runBackfill(selected)}
            >
              {backfilling ? <Loader2 size={11} className="animate-spin" /> : <Fingerprint size={11} />}
              Index folder
            </button>
            <button
              type="button"
              className="btn text-[10px] flex items-center gap-1"
              disabled={backfilling}
              title="Walk entire R2 bucket and assign stable UUIDs"
              onClick={() => {
                if (confirm("Backfill Grudge UUIDs for the entire bucket? This can take a while.")) {
                  void runBackfill("");
                }
              }}
            >
              {backfilling ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              Index all
            </button>
          </div>
          {backfillMsg && <div className="text-[10px] text-muted max-w-[240px] text-right">{backfillMsg}</div>}
        </div>
      </div>

      <DemoModeBanner feature="Browser" />

      <div className="flex flex-1 gap-3 min-h-0">
        <aside className="w-64 shrink-0 border border-line rounded-md bg-bg-1 overflow-y-auto p-1">
          <TreeNode prefix={BUCKET_ROOT} depth={0} selected={selected} onSelect={setSelected} />
        </aside>

        <section className="flex-1 flex flex-col min-w-0 border border-line rounded-md bg-bg-1">
          <div className="border-b border-line px-3 py-2 flex items-center gap-3">
            <Breadcrumb prefix={selected} onSelect={setSelected} />
            <div className="ml-auto relative">
              <SearchIcon size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
              <input
                placeholder="filter… (or '> query' for server search)"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="bg-bg-2 border border-line rounded pl-7 pr-2 py-1 text-xs w-60"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {(listing.isLoading && !isServerSearch) && <div className="text-muted text-sm">Loading…</div>}
            {listing.error && !isServerSearch && (
              <div className="text-danger text-sm">{(listing.error as Error).message}</div>
            )}

            {isServerSearch ? (
              <div>
                <div className="text-xs text-muted mb-2">Server search · {search.data?.items?.length ?? 0} matches</div>
                <div className="grid grid-cols-1 gap-1">
                  {(search.data?.items ?? []).map((it: any, i: number) => (
                    <div key={i} className="border border-line bg-bg-2 rounded p-2 flex items-center gap-2">
                      {fileIcon(it.contentType ?? "")}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs truncate">{it.path}</div>
                        {it.grudgeUUID && (
                          <div className="text-[10px] font-mono text-gold truncate">{it.grudgeUUID}</div>
                        )}
                      </div>
                      <span className="text-[10px] text-muted">{it.packId}</span>
                      <button className="copy-btn" onClick={() => copy(it.path, "path")}>
                        <Copy size={11} />
                      </button>
                      {it.grudgeUUID && (
                        <button className="copy-btn" title="Copy UUID" onClick={() => copy(it.grudgeUUID, "UUID")}>
                          <Fingerprint size={11} className="text-gold" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
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
                  {" · "}
                  <span className="text-gold">UUID on each card</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {filtered.map((it) => {
                    const isImg = it.contentType.startsWith("image/");
                    const entry = uuidMap[it.name];
                    const uuid = entry?.grudgeUUID;
                    return (
                      <div key={it.name} className="border border-line bg-bg-2 rounded p-2 flex flex-col gap-1 group">
                        <div className="aspect-square bg-black rounded overflow-hidden flex items-center justify-center">
                          {isImg ? (
                            <img src={cdnUrl(it.name)} alt="" loading="lazy" className="w-full h-full object-cover" />
                          ) : (
                            fileIcon(it.contentType)
                          )}
                        </div>
                        <div className="text-[11px] truncate" title={it.name}>{basename(it.name)}</div>
                        {uuid ? (
                          <div
                            className="text-[9px] font-mono text-gold/90 truncate"
                            title={uuid}
                          >
                            {uuid}
                          </div>
                        ) : (
                          <div className="text-[9px] text-muted">UUID pending…</div>
                        )}
                        <div className="flex items-center gap-1 text-[10px] text-muted flex-wrap">
                          <span>{(it.size / 1024).toFixed(1)} KB</span>
                          <span className="ml-auto flex items-center gap-0.5">
                            {is3dAssetPath(it.name) && (
                              <>
                                <button
                                  className="copy-btn opacity-100 sm:opacity-0 sm:group-hover:opacity-100 text-gold"
                                  title="View in 3D Studio"
                                  onClick={() => {
                                    void openBrowserAssetIn3d(it.name, cdnBase).then(() => {
                                      toast.success("Opening in 3D Studio");
                                    }).catch((e: any) => {
                                      toast.error(e?.message ?? "Open failed");
                                    });
                                  }}
                                >
                                  <Eye size={12} />
                                </button>
                                <button
                                  className="copy-btn opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                                  title="Open in Forge Quick 3D"
                                  onClick={() => {
                                    void openRemoteInForge(cdnUrl(it.name)).catch((e: any) =>
                                      toast.error(e?.message ?? "Forge open failed"),
                                    );
                                  }}
                                >
                                  <Hammer size={11} />
                                </button>
                              </>
                            )}
                            <button
                              className="copy-btn opacity-0 group-hover:opacity-100"
                              title="Copy CDN URL"
                              onClick={() => copy(cdnUrl(it.name), "CDN URL")}
                            >
                              <Copy size={11} />
                            </button>
                            {uuid && (
                              <button
                                className="copy-btn opacity-0 group-hover:opacity-100"
                                title="Copy Grudge UUID"
                                onClick={() => copy(uuid, "UUID")}
                              >
                                <Fingerprint size={11} className="text-gold" />
                              </button>
                            )}
                            <button
                              className="copy-btn opacity-0 group-hover:opacity-100"
                              title="Open in browser"
                              onClick={() => window.grudge?.os?.openExternal?.(cdnUrl(it.name))}
                            >
                              <ExternalLink size={11} />
                            </button>
                          </span>
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
