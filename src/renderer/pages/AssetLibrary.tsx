import React, { useEffect, useState } from "react";
import { Download, FolderOpen, Hammer, Loader2, Upload as UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceField } from "../lib/useWorkspaceField";

const MODEL_EXTS = /\.(glb|gltf|blend|fbx|obj)$/i;

export default function AssetLibrary() {
  const [query, setQuery] = useState("medieval helmet");
  const [type, setType] = useState<"model" | "material" | "brush" | "hdr" | "scene">("model");
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloadDir, setDownloadDir] = useWorkspaceField("localAssetsRoot", "");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    void window.grudge?.bk?.ensure?.().catch(() => { /* daemon optional */ });
  }, []);

  async function pickDownloadDir() {
    const picked = await window.grudge.files.pickDirectory({ title: "BlenderKit download folder" });
    if (!picked) return;
    setDownloadDir(picked);
    toast.success("Download folder saved (shared with Settings)");
  }

  async function go() {
    setError(null); setLoading(true);
    try {
      await window.grudge?.bk?.ensure?.().catch(() => { /* continue if daemon offline */ });
      const res = await window.grudge.bk.search({ query, asset_type: type, page_size: 24 });
      setResults(res.results ?? []);
      if (!res.results) setError("No results field — check the daemon /report status.");
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  async function downloadAsset(asset: any) {
    if (!downloadDir) {
      toast.error("Pick a download folder first");
      return;
    }
    const assetId = asset.id ?? asset.assetBaseId;
    if (!assetId) {
      toast.error("Asset has no id");
      return;
    }
    setDownloadingId(String(assetId));
    try {
      await window.grudge.bk.ensure();
      const res = await window.grudge.bk.download({
        asset_id: assetId,
        asset_base_id: asset.assetBaseId,
        download_dir: downloadDir,
        resolution: "2k",
      });
      toast.success("Download queued", {
        description: `task ${res.task_id} → ${downloadDir}. Open Forge when complete.`,
        action: {
          label: "Forge",
          onClick: () => window.grudge.app.openRoute("/forge"),
        },
      });
    } catch (e: any) {
      toast.error("Download failed", { description: e?.message });
    } finally {
      setDownloadingId(null);
    }
  }

  async function sendToUpload(asset: any) {
    if (!downloadDir) {
      toast.error("Set download folder first — assets land there before upload");
      return;
    }
    const name = asset.name ?? "asset";
    toast.message("After download completes", {
      description: `Drag ${name} from ${downloadDir} into Upload, or use Forge to preview.`,
      action: {
        label: "Upload",
        onClick: () => window.grudge.app.openRoute("/upload"),
      },
    });
    await downloadAsset(asset);
  }

  return (
    <div>
      <h1 className="page-title">BlenderKit Asset Library</h1>
      <p className="page-sub">
        Search via local daemon · download to shared folder · preview in Forge · ingest via Upload.
      </p>
      <div className="card space-y-3">
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
        <label className="block text-xs">
          <span className="text-muted">Download folder (shared workspace path)</span>
          <div className="flex items-center gap-2 mt-1">
            <input
              className="flex-1"
              value={downloadDir}
              onChange={(e) => setDownloadDir(e.target.value)}
              placeholder="C:\Users\you\Downloads\blenderkit"
            />
            <button className="btn ghost text-xs" type="button" onClick={pickDownloadDir} title="Browse">
              <FolderOpen size={14} />
            </button>
            {downloadDir && (
              <button
                className="btn ghost text-xs flex items-center gap-1"
                type="button"
                onClick={() => window.grudge.app.openRoute("/forge")}
                title="Preview models from download folder"
              >
                <Hammer size={12} /> Forge
              </button>
            )}
          </div>
        </label>
      </div>
      {error && <div className="card status-bad">{error}</div>}
      <div className="grid">
        {results.map((r) => {
          const id = String(r.id ?? r.assetBaseId ?? r.name);
          const busy = downloadingId === id;
          const isModel = type === "model" || MODEL_EXTS.test(r.name ?? "");
          return (
            <div className="tile" key={id}>
              {r.thumbnail && <img src={r.thumbnail} alt={r.name} />}
              <div className="tile-name">{r.name}</div>
              <div className="muted" style={{ fontSize: 10 }}>{r.assetType ?? type}</div>
              <div className="flex flex-col gap-1 mt-2">
                <button
                  className="btn ghost text-xs flex items-center gap-1 w-full justify-center"
                  disabled={busy || !downloadDir}
                  onClick={() => downloadAsset(r)}
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                  {busy ? "Queuing…" : "Download"}
                </button>
                {isModel && (
                  <button
                    className="btn ghost text-xs flex items-center gap-1 w-full justify-center"
                    disabled={busy || !downloadDir}
                    onClick={() => sendToUpload(r)}
                  >
                    <UploadIcon size={12} /> Download → Upload
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {results.length === 0 && !loading && <div className="muted">No results yet.</div>}
      </div>
    </div>
  );
}