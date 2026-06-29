import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cloud, CloudOff, Database, Hammer, Server, Sparkles, type LucideIcon } from "lucide-react";
import DemoModeBanner from "../components/DemoModeBanner";
import { pathsFromFileList } from "../lib/filePaths";
import { useWorkspaceField } from "../lib/useWorkspaceField";
import { openInForge } from "../lib/openInForge";

interface QueueRow {
  filePath: string;
  status: string;
  bytesUploaded: number;
  bytesTotal: number;
  error?: string;
}

interface QueuedFile {
  path: string;
  name: string;
  size: number;
  caption?: string;
  fromZip?: string;
}

type BackendMode = "auto" | "grudge" | "cloudflare" | "r2-direct" | "cloudflare-worker";

interface CfStatus {
  worker: { url: boolean; apiKey: boolean };
  direct: { endpoint: boolean; bucket: boolean; accessKeyId: boolean; secret: boolean };
  ai: { token: boolean; accountId: boolean; gatewayId: boolean };
  publicCdn: string | null;
}

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;
const MODEL_RE = /\.(glb|gltf|fbx|obj|blend|stl|ply|dae|3mf)$/i;
const ZIP_RE = /\.zip$/i;

export default function Upload() {
  const [prefix, setPrefix] = useWorkspaceField("uploadPrefix", "asset-packs/");
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [queue, setQueue] = useState<Record<string, QueueRow>>({});
  const [mode, setMode] = useState<BackendMode>("auto");
  const [cf, setCf] = useState<CfStatus | null>(null);
  const [runPipeline, setRunPipeline] = useState(true);
  const [buildManifest, setBuildManifest] = useState(false);
  const [packId, setPackId] = useState("");
  const [category, setCategory] = useState("models");
  const [extractZips, setExtractZips] = useState(true);
  const [captioning, setCaptioning] = useState<string | null>(null);

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
        : { id: "none", label: "Cloudflare selected but no worker creds set", Icon: CloudOff, tone: "bad" };
    if (mode === "grudge")
      return { id: "grudge", label: "Fleet client (client.grudge-studio.com)", Icon: Server, tone: "ok" };
    if (haveDirect) return { id: "r2", label: "Cloudflare R2 (direct S3)  · auto", Icon: Database, tone: "ok" };
    if (haveWorker) return { id: "worker", label: "Cloudflare Worker (AI / objectstore)  · auto", Icon: Cloud, tone: "ok" };
    return { id: "grudge", label: "Fleet client (ONE TRUTH)  · auto", Icon: Server, tone: "ok" };
  }

  async function ingestPaths(incoming: QueuedFile[]) {
    const expanded: QueuedFile[] = [];
    for (const f of incoming) {
      if (extractZips && ZIP_RE.test(f.name)) {
        try {
          const result = await window.grudge.archive.unzip(f.path);
          if (!result.ok) {
            toast.error(`Unzip failed: ${f.name}`, { description: result.error });
            expanded.push(f);
            continue;
          }
          const assets = result.entries.filter((ent: { isDir: boolean; path: string }) => !ent.isDir && !ent.path.startsWith("__MACOSX"));
          for (const e of assets) {
            const fullPath = [result.destDir, ...e.path.split("/").filter(Boolean)].join("\\");
            expanded.push({
              path: fullPath,
              name: e.path.split("/").pop() ?? e.path,
              size: e.size,
              fromZip: f.name,
            });
          }
          toast.success(`Extracted ${assets.length} files from ${f.name}`);
        } catch (e: any) {
          toast.error(`Archive error: ${f.name}`, { description: e?.message });
          expanded.push(f);
        }
      } else {
        expanded.push(f);
      }
    }
    setFiles((arr) => [...arr, ...expanded]);
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
    void ingestPaths(dropped);
  }

  async function captionFile(file: QueuedFile) {
    if (!IMAGE_RE.test(file.name)) return;
    setCaptioning(file.path);
    try {
      const { bytes } = await window.grudge.files.readBytes(file.path);
      const res = await window.grudge.ai.caption({ imageBytes: bytes });
      const description = res?.result?.description ?? "";
      setFiles((arr) => arr.map((f) => f.path === file.path ? { ...f, caption: description } : f));
      toast.success("AI caption generated");
    } catch (e: any) {
      toast.error("Caption failed", { description: e?.message });
    } finally {
      setCaptioning(null);
    }
  }

  async function inspectAndOpen(file: QueuedFile) {
    if (!MODEL_RE.test(file.name)) return;
    try {
      if (/\.(glb|gltf)$/i.test(file.name)) {
        const graph = await window.grudge.model.inspect(file.path);
        if (graph?.ok) {
          toast.success("Scene graph", {
            description: `${graph.stats.meshCount} meshes · ${graph.stats.animationCount} clips`,
          });
        }
      }
      await openInForge(file.path);
    } catch (e: any) {
      toast.error("Forge open failed", { description: e?.message });
    }
  }

  async function startUpload() {
    const jobId = `job-${Date.now()}`;
    await window.grudge.upload.enqueue({
      id: jobId,
      runPipeline,
      buildManifest: buildManifest && !!packId.trim(),
      packId: packId.trim() || undefined,
      category: category || undefined,
      files: files.map((f) => ({
        localPath: f.path,
        targetPath: prefix.replace(/\/?$/, "/") + f.name,
        caption: f.caption,
      })),
    });
    toast.success(runPipeline ? "Upload queued with ingestion pipeline" : "Upload queued (raw)");
  }

  const be = effectiveBackend();
  return (
    <div>
      <h1 className="page-title">Upload</h1>
      <p className="page-sub">
        Drop files or zips · auto-extract archives · AI-caption images · inspect models in Forge before upload.
      </p>
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
        <label className="muted">Target prefix (persisted)</label>
        <input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        <div className="row mt-2 flex-wrap gap-3 items-center">
          <label className="text-xs flex items-center gap-1">
            <input type="checkbox" checked={runPipeline} onChange={(e) => setRunPipeline(e.target.checked)} />
            Run pipeline (size-verify → convert → enrich → rig)
          </label>
          <label className="text-xs flex items-center gap-1">
            <input type="checkbox" checked={extractZips} onChange={(e) => setExtractZips(e.target.checked)} />
            Extract .zip archives on add
          </label>
          <label className="text-xs flex items-center gap-1">
            <input type="checkbox" checked={buildManifest} onChange={(e) => setBuildManifest(e.target.checked)} disabled={!packId.trim()} />
            Write manifest.json
          </label>
          <input className="text-xs" placeholder="pack id (for manifest)" value={packId} onChange={(e) => setPackId(e.target.value)} style={{ maxWidth: 180 }} />
          <input className="text-xs" placeholder="category" value={category} onChange={(e) => setCategory(e.target.value)} style={{ maxWidth: 120 }} />
        </div>
      </div>
      <div
        className="card"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        style={{ border: "2px dashed var(--gold-deep)", textAlign: "center", padding: 32 }}
      >
        Drop files or zip packs here · {files.length} queued
        <div className="mt-3">
          <button
            type="button"
            className="btn ghost text-xs"
            onClick={async () => {
              const paths = await window.grudge?.files?.pickForUpload?.();
              if (!paths?.length) return;
              void ingestPaths(paths.map((p: string) => ({
                path: p,
                name: p.split(/[\\/]/).pop() ?? p,
                size: 0,
              })));
            }}
          >
            Pick files from disk
          </button>
        </div>
      </div>
      {files.length > 0 && (
        <div className="card">
          <div className="flex gap-2 mb-3">
            <button className="btn" onClick={startUpload}>Start upload</button>
            <button className="btn ghost text-xs" onClick={() => setFiles([])}>Clear queue</button>
          </div>
          <table style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>File</th>
                <th>Size</th>
                <th>Caption / source</th>
                <th>Actions</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f, i) => {
                const row = queue[f.path];
                return (
                  <tr key={`${f.path}-${i}`}>
                    <td>
                      {f.name}
                      {f.fromZip && <span className="text-[9px] text-muted block">from {f.fromZip}</span>}
                    </td>
                    <td className="muted">{f.size ? `${(f.size / 1024).toFixed(1)} KB` : "—"}</td>
                    <td className="muted text-xs max-w-[200px] truncate" title={f.caption}>
                      {f.caption ?? "—"}
                    </td>
                    <td>
                      <div className="flex gap-1 flex-wrap">
                        {IMAGE_RE.test(f.name) && (
                          <button
                            className="btn ghost text-[10px] px-1 py-0.5 flex items-center gap-0.5"
                            disabled={captioning === f.path}
                            onClick={() => captionFile(f)}
                          >
                            <Sparkles size={10} /> {captioning === f.path ? "…" : "Caption"}
                          </button>
                        )}
                        {MODEL_RE.test(f.name) && (
                          <button
                            className="btn ghost text-[10px] px-1 py-0.5 flex items-center gap-0.5"
                            onClick={() => inspectAndOpen(f)}
                          >
                            <Hammer size={10} /> Forge
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="muted text-xs">
                      {row?.status ?? "queued"}
                      {row ? ` ${row.bytesUploaded}/${row.bytesTotal}` : ""}
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