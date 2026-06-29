import React, { useState } from "react";
import { Search, Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export default function AssetLibrary() {
  const [query, setQuery] = useState("medieval helmet");
  const [type, setType] = useState<"model" | "material" | "brush" | "hdr" | "scene">("model");
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function go() {
    setError(null);
    setLoading(true);
    try {
      const res = await window.grudge.bk.search({ query, asset_type: type, page_size: 24 });
      setResults(res.results ?? []);
      if (!res.results?.length) setError("No results — check BlenderKit API key in Settings and daemon status.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="page-title flex items-center gap-2">
        <Search size={20} className="text-gold" /> BlenderKit Library
      </h1>
      <p className="page-sub">
        Search BlenderKit via the local daemon. Requires API key in Settings and BlenderKit daemon running.
      </p>
      <div className="card">
        <div className="row">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="medieval helmet" onKeyDown={(e) => e.key === "Enter" && go()} />
          <select value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="model">Models</option>
            <option value="material">Materials</option>
            <option value="brush">Brushes</option>
            <option value="hdr">HDRIs</option>
            <option value="scene">Scenes</option>
          </select>
          <button className="btn" disabled={loading} onClick={go}>{loading ? "Searching…" : "Search"}</button>
        </div>
      </div>
      {error && <div className="card status-bad text-xs">{error}</div>}
      <div className="grid">
        {results.map((r) => (
          <div className="tile" key={r.id ?? r.assetBaseId ?? r.name}>
            {r.thumbnail && (
              <img
                src={r.thumbnail}
                alt={r.name}
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.3"; }}
              />
            )}
            <div className="tile-name">{r.name}</div>
            <div className="muted text-[10px]">{r.assetType ?? type}</div>
            <div className="flex gap-1 mt-1">
              {r.url && (
                <button className="btn ghost text-[10px] py-0 px-1" onClick={() => window.grudge.os.openExternal(r.url)}>
                  <ExternalLink size={10} /> Web
                </button>
              )}
              <button
                className="btn ghost text-[10px] py-0 px-1"
                onClick={async () => {
                  try {
                    await window.grudge.bk.download({ asset_id: r.id ?? r.assetBaseId });
                    toast.success("Download queued");
                  } catch (e: any) {
                    toast.error("Download failed", { description: e?.message });
                  }
                }}
              >
                <Download size={10} /> Get
              </button>
            </div>
          </div>
        ))}
        {results.length === 0 && !loading && <div className="muted text-sm">No results yet.</div>}
      </div>
    </div>
  );
}