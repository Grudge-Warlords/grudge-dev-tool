import React, { useEffect, useMemo, useState } from "react";
import {
  ExternalLink, RefreshCcw, Store, FolderOpen, Box, Image as ImageIcon,
  Layers, ChevronDown, ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import {
  normalizeCatalogItems,
  groupCatalogItems,
  catalogItemThumb,
  isModelPath,
  type StoreCatalogItem,
  type StoreGroupingKey,
} from "../../shared/storeCatalog";
import { resolveCdnBase, cdnUrl } from "../lib/cdn";
import { writeMirror } from "../lib/workspace";

interface StoreCategory {
  id: string;
  label: string;
  icon: string;
  prefix: string;
  objectStorePath?: string;
}

interface PrefixEntry {
  name: string;
  size: number;
  contentType: string;
}

export default function GrudgeStore() {
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [selected, setSelected] = useState<StoreCategory | null>(null);
  const [items, setItems] = useState<StoreCatalogItem[]>([]);
  const [prefixEntries, setPrefixEntries] = useState<PrefixEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [cdnBase, setCdnBase] = useState("https://assets.grudge-studio.com");
  const [groupBy, setGroupBy] = useState<StoreGroupingKey>("category");
  const [showRaw, setShowRaw] = useState(false);
  const [rawCatalog, setRawCatalog] = useState<unknown>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    void resolveCdnBase().then(setCdnBase);
    void window.grudge.fleet.storeCategories().then((cats: StoreCategory[] | null | undefined) =>
      setCategories(cats ?? []),
    );
  }, []);

  const filtered = useMemo(() => {
    if (!filter.trim()) return items;
    const q = filter.toLowerCase();
    return items.filter((it) =>
      it.name.toLowerCase().includes(q) ||
      (it.path ?? "").toLowerCase().includes(q) ||
      (it.pack ?? "").toLowerCase().includes(q),
    );
  }, [items, filter]);

  const groups = useMemo(
    () => (filtered.length ? groupCatalogItems(filtered, groupBy) : []),
    [filtered, groupBy],
  );

  async function loadPrefixBrowse(cat: StoreCategory) {
    setBusy(true);
    try {
      const res = await window.grudge.os.list({ prefix: cat.prefix, delimiter: "/", limit: 200 });
      setPrefixEntries(res.items ?? []);
    } catch (e: any) {
      toast.error("Prefix browse failed", { description: e?.message });
      setPrefixEntries([]);
    } finally {
      setBusy(false);
    }
  }

  async function loadCatalog(cat: StoreCategory) {
    setSelected(cat);
    setItems([]);
    setPrefixEntries([]);
    setRawCatalog(null);
    setFilter("");

    if (!cat.objectStorePath) {
      void loadPrefixBrowse(cat);
      return;
    }

    setBusy(true);
    try {
      const data = await window.grudge.fleet.objectStore(cat.objectStorePath);
      setRawCatalog(data);
      setItems(normalizeCatalogItems(data));
    } catch (e: any) {
      toast.error("Catalog load failed", { description: e?.message });
      setRawCatalog({ error: e?.message });
      // Fall back to prefix listing when JSON catalog is missing
      void loadPrefixBrowse(cat);
    } finally {
      setBusy(false);
    }
  }

  function openInBrowser(prefix: string) {
    writeMirror({ browserPrefix: prefix });
    void window.grudge.workspace.patch({ browserPrefix: prefix });
    void window.grudge.app.openRoute("/browser");
    toast.info(`Browser → ${prefix || "root"}`);
  }

  async function openInForge(path: string) {
    const url = cdnUrl(cdnBase, path);
    try {
      await window.grudge.forge.openRemote(url);
      toast.success("Opened in Forge 3D");
    } catch (e: any) {
      toast.error("Forge open failed", { description: e?.message });
    }
  }

  function thumbFor(item: StoreCatalogItem): string | null {
    return catalogItemThumb(item, cdnBase, selected?.prefix);
  }

  return (
    <div>
      <h1 className="page-title flex items-center gap-2">
        <Store size={20} className="text-gold" /> Grudge Store
      </h1>
      <p className="page-sub">
        Fleet asset storefront — JSON catalogs from ONE TRUTH objectstore, CDN previews, Forge 3D open.
        CDN: <span className="font-mono text-gold">{cdnBase}</span>
      </p>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
        {categories.map((c) => (
          <button
            key={c.id}
            className={`card text-left ${selected?.id === c.id ? "border-gold" : ""}`}
            onClick={() => loadCatalog(c)}
          >
            <div className="text-2xl mb-1">{c.icon}</div>
            <div className="font-semibold text-sm">{c.label}</div>
            <div className="text-[10px] text-muted font-mono mt-1 truncate">{c.prefix}</div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="card mt-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="font-semibold">{selected.label}</span>
            <button className="btn ghost text-xs flex items-center gap-1" onClick={() => loadCatalog(selected)} disabled={busy}>
              <RefreshCcw size={12} /> Reload
            </button>
            <button className="btn ghost text-xs flex items-center gap-1" onClick={() => openInBrowser(selected.prefix)}>
              <FolderOpen size={12} /> Browse prefix
            </button>
            <button
              className="btn ghost text-xs flex items-center gap-1 ml-auto"
              onClick={() => window.grudge.os.openExternal(cdnUrl(cdnBase, selected.prefix))}
            >
              <ExternalLink size={12} /> CDN folder
            </button>
          </div>

          {items.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <input
                className="flex-1 min-w-[140px]"
                placeholder="Filter items…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as StoreGroupingKey)} className="text-xs">
                <option value="category">Group: category</option>
                <option value="pack">Group: pack</option>
                <option value="tier">Group: tier</option>
                <option value="slot">Group: slot</option>
              </select>
              <span className="text-xs text-muted flex items-center gap-1">
                <Layers size={12} /> {filtered.length} items
              </span>
            </div>
          )}

          {busy && <p className="muted text-xs mb-2">Loading…</p>}

          {groups.map((g) => (
            <div key={g.label} className="mb-4">
              <div className="text-xs font-semibold text-gold mb-2 uppercase tracking-wide">{g.label} ({g.items.length})</div>
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
                {g.items.map((item) => {
                  const thumb = thumbFor(item);
                  const model = item.path && isModelPath(item.path);
                  return (
                    <div key={`${item.id}-${item.path ?? ""}`} className="tile">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={item.name}
                          loading="lazy"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <div className="flex items-center justify-center h-24 bg-bg-2 text-muted">
                          {model ? <Box size={28} /> : <ImageIcon size={28} />}
                        </div>
                      )}
                      <div className="tile-name truncate" title={item.name}>{item.name}</div>
                      {item.pack && <div className="text-[10px] text-muted truncate">{item.pack}</div>}
                      {item.path && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {model && (
                            <button className="btn ghost text-[10px] py-0 px-1" onClick={() => openInForge(item.path!)}>
                              Forge
                            </button>
                          )}
                          <button
                            className="btn ghost text-[10px] py-0 px-1"
                            onClick={() => window.grudge.os.openExternal(cdnUrl(cdnBase, item.path!))}
                          >
                            CDN
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {!items.length && prefixEntries.length > 0 && (
            <div>
              <div className="text-xs text-muted mb-2">Objects under <span className="font-mono">{selected.prefix}</span></div>
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
                {prefixEntries.map((ent) => {
                  const isImg = ent.contentType?.startsWith("image/");
                  const isModel = isModelPath(ent.name);
                  const url = cdnUrl(cdnBase, ent.name);
                  return (
                    <div key={ent.name} className="tile">
                      {isImg ? (
                        <img src={url} alt="" loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                      ) : (
                        <div className="flex items-center justify-center h-24 bg-bg-2 text-muted">
                          {isModel ? <Box size={28} /> : <ImageIcon size={28} />}
                        </div>
                      )}
                      <div className="tile-name truncate font-mono text-[10px]" title={ent.name}>
                        {ent.name.replace(selected.prefix, "")}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {isModel && (
                          <button className="btn ghost text-[10px] py-0 px-1" onClick={() => openInForge(ent.name)}>
                            Forge
                          </button>
                        )}
                        <button className="btn ghost text-[10px] py-0 px-1" onClick={() => window.grudge.os.openExternal(url)}>
                          CDN
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!busy && !items.length && !prefixEntries.length && (
            <p className="muted text-xs">No catalog items. Set ONE TRUTH client in Settings, then reload.</p>
          )}

          {rawCatalog != null && (
            <button
              type="button"
              className="mt-3 text-xs text-muted flex items-center gap-1"
              onClick={() => setShowRaw((v) => !v)}
            >
              {showRaw ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              Raw JSON
            </button>
          )}
          {showRaw && rawCatalog != null && (
            <pre className="text-[10px] overflow-auto max-h-48 bg-bg-2 p-2 rounded mt-2">
              {JSON.stringify(rawCatalog, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}