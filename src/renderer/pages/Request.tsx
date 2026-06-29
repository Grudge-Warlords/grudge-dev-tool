import React, { useState } from "react";

export default function RequestPage() {
  const [path, setPath] = useState("asset-packs/classic64/v0.6/Books/cover.png");
  const [meta, setMeta] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchMeta() {
    setError(null); setMeta(null);
    try {
      const m = await window.grudge.os.assetMeta({ objectPath: path });
      setMeta(m);
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div>
      <h1 className="page-title">Request URL</h1>
      <p className="page-sub">Mint a short-lived signed GET URL for any object — or grab the public CDN URL.</p>
      <div className="card">
        <label className="muted">Object path</label>
        <input value={path} onChange={(e) => setPath(e.target.value)} />
        <div style={{ marginTop: 10 }}>
          <button className="btn" onClick={fetchMeta}>Get URL</button>
        </div>
      </div>
      {error && <div className="card status-bad">{error}</div>}
      {meta && (
        <div className="card">
          <div><span className="muted">Public CDN:</span> <a onClick={() => window.grudge.os.openExternal(meta.publicCdn)} style={{ cursor: "pointer", color: "var(--gold)" }}>{meta.publicCdn}</a></div>
          <div style={{ marginTop: 6 }}><span className="muted">Signed URL ({meta.ttlSeconds}s):</span></div>
          <pre>{meta.url}</pre>
          <div className="muted">{meta.contentType} · {(meta.size / 1024).toFixed(1)} KB · updated {meta.updated?.slice(0, 19) ?? "—"}</div>
          <button className="btn ghost" onClick={() => navigator.clipboard.writeText(meta.url)}>Copy signed URL</button>
        </div>
      )}
    </div>
  );
}
