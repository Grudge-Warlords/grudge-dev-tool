import React, { useState } from "react";
import DemoModeBanner from "../components/DemoModeBanner";

export default function Search() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [pack, setPack] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setError(null);
    try {
      const res = await window.grudge.os.search({ q, category: category || undefined, pack: pack || undefined });
      setItems(res.items);
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div>
      <h1 className="page-title">Manifest Search</h1>
      <p className="page-sub">Server-side filter against per-pack <span className="kbd">manifest.json</span> catalogs.</p>
      <DemoModeBanner feature="Search" />
      <div className="card">
        <div className="row">
          <input placeholder="Query (path / category / UUID substring)" value={q} onChange={(e) => setQ(e.target.value)} />
          <input placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
          <input placeholder="Pack id (e.g. classic64)" value={pack} onChange={(e) => setPack(e.target.value)} />
          <button className="btn" onClick={go}>Search</button>
        </div>
      </div>
      {error && <div className="card status-bad">{error}</div>}
      <div className="card">
        <table>
          <thead><tr><th>Pack</th><th>Path</th><th>Category</th><th>UUID</th><th>Size</th></tr></thead>
          <tbody>
            {items.map((it: any, i: number) => (
              <tr key={i}>
                <td>{it.packId}</td>
                <td>{it.path}</td>
                <td>{it.category ?? "—"}</td>
                <td className="muted">{it.grudgeUUID ?? "—"}</td>
                <td className="muted">{it.sizeBytes ? (it.sizeBytes / 1024).toFixed(1) + " KB" : "—"}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={5} className="muted">No results yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
