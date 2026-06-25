import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cloud, CloudOff, Database, Server, type LucideIcon } from "lucide-react";
import DemoModeBanner from "../components/DemoModeBanner";
import { pathsFromFileList } from "../lib/filePaths";

interface QueueRow {
  filePath: string;
  status: string;
  bytesUploaded: number;
  bytesTotal: number;
  error?: string;
}

type BackendMode = "auto" | "grudge" | "cloudflare" | "r2-direct" | "cloudflare-worker";

interface CfStatus {
  worker: { url: boolean; apiKey: boolean };
  direct: { endpoint: boolean; bucket: boolean; accessKeyId: boolean; secret: boolean };
  ai:     { token: boolean; accountId: boolean; gatewayId: boolean };
  publicCdn: string | null;
}

export default function Upload() {
  const [prefix, setPrefix] = useState("asset-packs/");
  const [files, setFiles] = useState<{ path: string; name: string; size: number }[]>([]);
  const [queue, setQueue] = useState<Record<string, QueueRow>>({});
  const [mode, setMode] = useState<BackendMode>("auto");
  const [cf, setCf] = useState<CfStatus | null>(null);

  useEffect(() => {
    const off = window.grudge.upload.onProgress((p: any) => {
      setQueue((q) => ({ ...q, [p.filePath]: { ...p } }));
    });
    (async () => {
      try {
        const m = await window.grudge?.cf?.getBackendMode?.();
        if (m) setMode(m);
        const s = await window.grudge?.cf?.status?.();
        if (s) setCf(s);
      } catch { /* ignore */ }
    })();
    return () => off?.();
  }, []);

  /** Resolve which backend uploads will actually use given mode + cf creds. */
  function effectiveBackend(): { id: string; label: string; Icon: LucideIcon; tone: "ok" | "warn" | "bad" } {
    const haveWorker = !!(cf?.worker.url && cf?.worker.apiKey);
    const haveDirect = !!(cf?.direct.endpoint && cf?.direct.bucket && cf?.direct.accessKeyId && cf?.direct.secret);
    if (mode === "r2-direct" && haveDirect)
      return { id: "r2", label: "Cloudflare R2 (direct S3)", Icon: Database, tone: "ok" };
    if (mode === "cloudflare-worker" && haveWorker)
      return { id: "worker", label: "Cloudflare Worker (AI / objectstore)", Icon: Cloud, tone: "ok" };
    if (mode === "cloudflare")
      return haveWorker
        ? { id: "worker", label: "Cloudflare Worker (AI / objectstore)", Icon: Cloud, tone: "ok" }
        : { id: "none",   label: "Cloudflare selected but no worker creds set", Icon: CloudOff, tone: "bad" };
    if (mode === "grudge")
      return { id: "grudge", label: "Fleet client (client.grudge-studio.com)", Icon: Server, tone: "ok" };
    // auto
    if (haveDirect) return { id: "r2", label: "Cloudflare R2 (direct S3)  · auto", Icon: Database, tone: "ok" };
    if (haveWorker) return { id: "worker", label: "Cloudflare Worker (AI / objectstore)  · auto", Icon: Cloud, tone: "ok" };
    return { id: "grudge", label: "Fleet client (ONE TRUTH)  · auto", Icon: Server, tone: "ok" };
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const paths = pathsFromFileList(e.dataTransfer.files);
    const dropped = paths.map((p, i) => ({
      path: p,
      name: e.dataTransfer.files[i]?.name ?? p.split(/[\\/]/).pop() ?? p,
      size: e.dataTransfer.files[i]?.size ?? 0,
    }));
    if (!dropped.length) {
      toast.error("Could not read file paths", { description: "Use Pick files or check sandbox preload." });
      return;
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

  const be = effectiveBackend();
  return (
    <div>
      <h1 className="page-title">Upload</h1>
      <p className="page-sub">Drop files; they pass through size-verify → convert → enrich → rig before upload.</p>
      <div className={`card flex items-center gap-3 ${be.tone === "bad" ? "border-danger" : be.tone === "warn" ? "border-gold-deep" : ""}`}>
        <be.Icon size={18} />
        <div className="flex-1">
          <div className="text-xs muted">Uploads route to:</div>
          <div className={"font-semibold " + (be.tone === "bad" ? "status-bad" : be.tone === "warn" ? "text-gold" : "text-ink")}>{be.label}</div>
        </div>
        <select
          value={mode}
          onChange={async (e) => {
            const m = e.target.value as BackendMode;
            setMode(m);
            await window.grudge?.cf?.setBackendMode?.(m);
          }}
          style={{ width: "auto", minWidth: 180 }}
        >
          <option value="auto">Auto (worker if creds set)</option>
          <option value="cloudflare-worker">Cloudflare Worker (AI)</option>
          <option value="r2-direct">Cloudflare R2 (direct S3)</option>
          <option value="cloudflare">Cloudflare (legacy)</option>
          <option value="grudge">GrudgeBuilder API</option>
        </select>
      </div>
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
        <div className="mt-3">
          <button
            type="button"
            className="btn ghost text-xs"
            onClick={async () => {
              const paths = await window.grudge?.files?.pickForUpload?.();
              if (!paths?.length) return;
              setFiles((arr) => [
                ...arr,
                ...paths.map((p) => ({
                  path: p,
                  name: p.split(/[\\/]/).pop() ?? p,
                  size: 0,
                })),
              ]);
            }}
          >
            Pick files from disk
          </button>
        </div>
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
