import React, { useEffect, useState } from "react";
import { ExternalLink, RefreshCcw, Store } from "lucide-react";
import { toast } from "sonner";

interface StoreCategory {
  id: string;
  label: string;
  icon: string;
  prefix: string;
  objectStorePath?: string;
}

export default function GrudgeStore() {
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [selected, setSelected] = useState<StoreCategory | null>(null);
  const [catalog, setCatalog] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const cats = await window.grudge.fleet.storeCategories();
        setCategories(cats ?? []);
      } catch { /* offline */ }
    })();
  }, []);

  async function loadCatalog(cat: StoreCategory) {
    setSelected(cat);
    setCatalog(null);
    if (!cat.objectStorePath) {
      setCatalog({ note: "Browse via object storage prefix", prefix: cat.prefix });
      return;
    }
    setBusy(true);
    try {
      const data = await window.grudge.fleet.objectStore(cat.objectStorePath);
      setCatalog(data);
    } catch (e: any) {
      toast.error("Catalog load failed", { description: e?.message });
      setCatalog({ error: e?.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="page-title flex items-center gap-2">
        <Store size={20} className="text-gold" /> Grudge Store
      </h1>
      <p className="page-sub">
        Fleet storefront categories — JSON catalogs via ONE TRUTH objectstore or CDN prefixes on{" "}
        <span className="font-mono">assets.grudge-studio.com</span>.
      </p>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
        {categories.map((c) => (
          <button
            key={c.id}
            className={`card text-left ${selected?.id === c.id ? "border-gold" : ""}`}
            onClick={() => loadCatalog(c)}
          >
            <div className="text-2xl mb-1">{c.icon}</div>
            <div className="font-semibold text-sm">{c.label}</div>
            <div className="text-[10px] text-muted font-mono mt-1">{c.prefix}</div>
          </button>
        ))}
      </div>
      {selected && (
        <div className="card mt-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-semibold">{selected.label}</span>
            <button className="btn ghost text-xs flex items-center gap-1" onClick={() => loadCatalog(selected)} disabled={busy}>
              <RefreshCcw size={12} /> Reload
            </button>
            <button
              className="btn ghost text-xs flex items-center gap-1 ml-auto"
              onClick={() => window.grudge.os.openExternal(`https://assets.grudge-studio.com/${selected.prefix}`)}
            >
              <ExternalLink size={12} /> CDN
            </button>
          </div>
          {busy ? (
            <p className="muted text-xs">Loading catalog…</p>
          ) : (
            <pre className="text-[10px] overflow-auto max-h-96 bg-bg-2 p-2 rounded">
              {JSON.stringify(catalog, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}