import React, { useState } from "react";

export default function AssetLibrary() {
  const [query, setQuery] = useState("medieval helmet");
  const [type, setType] = useState<"model" | "material" | "brush" | "hdr" | "scene">("model");
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function go() {
    setError(null); setLoading(true);
    try {
      const res = await window.grudge.bk.search({ query, asset_type: type, page_size: 24 });
      setResults(res.results ?? []);
      if (!res.results) setError("No results field — check the daemon /report status.");
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  return (
    <div>
      <h1 className="page-title">BlenderKit Asset Library</h1>
      <p className="page-sub">Search the BlenderKit catalog via the local daemon. Requires API key in <span className="kbd">Settings</span>.</p>
      <div className="card">
        <div className="row">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="medieval helmet" />
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
      {error && <div className="card status-bad">{error}</div>}
      <div className="grid">
        {results.map((r) => (
          <div className="tile" key={r.id ?? r.assetBaseId ?? r.name}>
            {r.thumbnail && <img src={r.thumbnail} alt={r.name} />}
            <div className="tile-name">{r.name}</div>
            <div className="muted" style={{ fontSize: 10 }}>{r.assetType}</div>
          </div>
        ))}
        {results.length === 0 && !loading && <div className="muted">No results yet.</div>}
      </div>
    </div>
  );
}
