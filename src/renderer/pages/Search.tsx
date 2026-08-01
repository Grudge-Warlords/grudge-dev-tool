import React, { useEffect, useState } from "react";
import { openAssetInViewMode } from "./ViewMode";

export default function Search() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [pack, setPack] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cdnBase, setCdnBase] = useState("https://assets.grudge-studio.com");

  useEffect(() => {
    (async () => {
      try {
        const url: string = await window.grudge?.cf?.r2PublicUrl?.("");
        if (url) setCdnBase(url.replace(/\/$/, ""));
      } catch { /* keep default */ }
    })();
  }, []);

  async function go() {
    setError(null);
    try {
      const res = await window.grudge.os.search({ q, category: category || undefined, pack: pack || undefined });
      setItems(res.items);
    } catch (e: any) { setError(e.message); }
  }

  function openInViewMode(it: any) {
    const path = it.path ?? it.name;
    if (!path) return;
    openAssetInViewMode({
      name: path,
      url: `${cdnBase}/${path.replace(/^\//, "")}`,
      contentType: it.contentType ?? "",
      size: it.sizeBytes ?? it.size ?? 0,
    });
  }

  return (
    <div>
      <h1 className="page-title">Manifest Search</h1>
      <p className="page-sub">Server-side filter against per-pack <span className="kbd">manifest.json</span> catalogs. Click a row → <strong>View Mode</strong> review.</p>
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
              <tr
                key={i}
                className="cursor-pointer hover:bg-bg-2"
                title="Open in View Mode"
                onClick={() => openInViewMode(it)}
              >
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
