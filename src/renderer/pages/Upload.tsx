import React, { useEffect, useState } from "react";
import DemoModeBanner from "../components/DemoModeBanner";

interface QueueRow {
  filePath: string;
  status: string;
  bytesUploaded: number;
  bytesTotal: number;
  error?: string;
}

export default function Upload() {
  const [prefix, setPrefix] = useState("asset-packs/");
  const [files, setFiles] = useState<{ path: string; name: string; size: number }[]>([]);
  const [queue, setQueue] = useState<Record<string, QueueRow>>({});

  useEffect(() => {
    const off = window.grudge.upload.onProgress((p: any) => {
      setQueue((q) => ({ ...q, [p.filePath]: { ...p } }));
    });
    return () => off?.();
  }, []);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const dropped: { path: string; name: string; size: number }[] = [];
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      const f = e.dataTransfer.files[i];
      // Electron exposes the absolute path on dropped files.
      const p = (f as any).path as string | undefined;
      if (p) dropped.push({ path: p, name: f.name, size: f.size });
    }
    setFiles((arr) => [...arr, ...dropped]);
  }

  async function startUpload() {
    const jobId = `job-${Date.now()}`;
    await window.grudge.upload.enqueue({
      id: jobId,
      files: files.map((f) => ({
        localPath: f.path,
        targetPath: prefix.replace(/\/?$/, "/") + f.name,
      })),
    });
  }

  return (
    <div>
      <h1 className="page-title">Upload</h1>
      <p className="page-sub">Drop files; they pass through size-verify → convert → enrich → rig before upload.</p>
      <DemoModeBanner feature="Upload" />
      <div className="card">
        <label className="muted">Target prefix</label>
        <input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
      </div>
      <div
        className="card"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        style={{ border: "2px dashed var(--gold-deep)", textAlign: "center", padding: 32 }}
      >
        Drop files here  ·  {files.length} queued
      </div>
      {files.length > 0 && (
        <div className="card">
          <button className="btn" onClick={startUpload}>Start upload</button>
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>File</th><th>Size</th><th>Status</th><th>Progress</th></tr></thead>
            <tbody>
              {files.map((f, i) => {
                const row = queue[f.path];
                return (
                  <tr key={i}>
                    <td>{f.name}</td>
                    <td className="muted">{(f.size / 1024).toFixed(1)} KB</td>
                    <td>{row?.status ?? "queued"}</td>
                    <td className="muted">
                      {row ? `${row.bytesUploaded}/${row.bytesTotal}` : "—"}
                      {row?.error && <span className="status-bad"> ({row.error})</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
