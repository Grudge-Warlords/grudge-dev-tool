import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronRight, ChevronDown, Folder, FolderOpen, FileText, Image as ImageIcon,
  Box, Music, Search as SearchIcon, Copy, ExternalLink, Home,
} from "lucide-react";
import DemoModeBanner from "../components/DemoModeBanner";

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
  const [selected, setSelected] = useState<string>(ROOT_PREFIX);
  const [filter, setFilter] = useState<string>("");

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
    return files.filter((it) => it.name.toLowerCase().includes(f));
  }, [files, filter, isServerSearch]);

  const cdnUrl = (path: string) => `https://assets.grudge-studio.com/${path}`;
  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`Copied ${label}`));
  };

  return (
    <div className="flex flex-col h-full">
      <div className="mb-3">
        <h1 className="page-title">Object Storage Browser</h1>
        <p className="page-sub">Click a folder on the left. Use <span className="kbd">&gt; query</span> for server-side search.</p>
      </div>

      <DemoModeBanner feature="Browser" />

      <div className="flex flex-1 gap-3 min-h-0">
        <aside className="w-64 shrink-0 border border-line rounded-md bg-bg-1 overflow-y-auto p-1">
          {/* Bucket root — lists whatever top-level prefixes actually exist. */}
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
                      <span className="text-xs truncate flex-1">{it.path}</span>
                      <span className="text-[10px] text-muted">{it.packId}</span>
                      <button className="copy-btn" onClick={() => copy(it.path, "path")}>
                        <Copy size={11} />
                      </button>
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
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {filtered.map((it) => {
                    const isImg = it.contentType.startsWith("image/");
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
                        <div className="flex items-center gap-1 text-[10px] text-muted">
                          <span>{(it.size / 1024).toFixed(1)} KB</span>
                          <button
                            className="ml-auto copy-btn opacity-0 group-hover:opacity-100"
                            title="Copy CDN URL"
                            onClick={() => copy(cdnUrl(it.name), "CDN URL")}
                          >
                            <Copy size={11} />
                          </button>
                          <button
                            className="copy-btn opacity-0 group-hover:opacity-100"
                            title="Open"
                            onClick={() => window.grudge?.os?.openExternal?.(cdnUrl(it.name))}
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
