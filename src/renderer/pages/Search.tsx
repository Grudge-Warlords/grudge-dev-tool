import React, { useEffect, useState } from "react";
import { openAssetInViewMode } from "./ViewMode";

export default function Search() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [pack, setPack] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    try {
      const res = await window.grudge.os.search({
        q,
        category: category || undefined,
        pack: pack || undefined,
        limit: 400,
      });
      setItems(res.items ?? []);
      setTotal(res.count ?? res.items?.length ?? 0);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
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
      <h1 className="page-title">Search all assets</h1>
      <p className="page-sub">
        Full Grudge Studio Assets catalog (live index + prod/gltf CDN packages). Same engine as the{" "}
        <strong>Assets</strong> tab search box. Click a row → <strong>View Mode</strong>.
      </p>
      <div className="card">
        <div className="row">
          <input
            placeholder="Query (name / path / category / UUID)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void go(); }}
          />
          <input placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
          <input placeholder="Pack id (e.g. classic64)" value={pack} onChange={(e) => setPack(e.target.value)} />
          <button className="btn" onClick={() => void go()} disabled={busy}>
            {busy ? "Searching…" : "Search all"}
          </button>
        </div>
      </div>
      {error && <div className="card status-bad">{error}</div>}
      <div className="card">
        <div className="text-xs text-muted mb-2">
          {total ? `${total.toLocaleString()} matches · showing ${items.length}` : "No results yet."}
        </div>
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
