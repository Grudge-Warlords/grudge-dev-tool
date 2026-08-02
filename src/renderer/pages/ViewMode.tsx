/**
 * View Mode — universal asset review surface.
 * Open any CDN/local asset (image, audio, video, GLB, scene, text, PDF, PSD…)
 * with save / Forge / storage / AI-define actions.
 *
 * Replaces the blank "Play Modes" tab (play lives in Preview + Games).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Eye,
  FolderOpen,
  Copy,
  ExternalLink,
  Download,
  Hammer,
  Bone,
  Upload,
  Sparkles,
  Maximize2,
  FileText,
  Save,
  RefreshCw,
  Link2,
  X,
  Box,
  Image as ImageIcon,
  Music,
  Video,
  Layers3,
  type LucideIcon,
} from "lucide-react";
import {
  classify,
  basename,
  formatBytes,
  type AssetRef,
  type AssetKind,
} from "../components/viewers/types";
import ImageViewer from "../components/viewers/ImageViewer";
import VideoViewer from "../components/viewers/VideoViewer";
import TextViewer from "../components/viewers/TextViewer";
import PdfViewer from "../components/viewers/PdfViewer";
import FontViewer from "../components/viewers/FontViewer";
import { writeMirror, readMirror } from "../lib/workspace";

const AudioViewer = React.lazy(() => import("../components/viewers/AudioViewer"));
const Model3DViewer = React.lazy(() => import("../components/viewers/Model3DViewer"));
const DesignViewer = React.lazy(() => import("../components/viewers/DesignViewer"));

const VIEW_ASSET_KEY = "grudge.viewMode.asset";

const KIND_META: Record<AssetKind, { label: string; Icon: LucideIcon }> = {
  image: { label: "Image", Icon: ImageIcon },
  video: { label: "Video", Icon: Video },
  audio: { label: "Audio", Icon: Music },
  model3d: { label: "3D model", Icon: Box },
  scene3d: { label: "Scene", Icon: Layers3 },
  text: { label: "Text / data", Icon: FileText },
  pdf: { label: "PDF", Icon: FileText },
  font: { label: "Font", Icon: FileText },
  design: { label: "Design / DCC", Icon: Layers3 },
  unknown: { label: "File", Icon: FileText },
};

const VIEW_ASSET_EVENT = "grudge:view-mode-asset";

/** Persist + open View Mode with an asset (from Browser, Search, etc.). */
export function openAssetInViewMode(asset: AssetRef): void {
  try {
    sessionStorage.setItem(VIEW_ASSET_KEY, JSON.stringify(asset));
    writeMirror({
      viewAsset: {
        name: asset.name,
        url: asset.url,
        contentType: asset.contentType,
        size: asset.size,
      },
    });
    window.dispatchEvent(new CustomEvent(VIEW_ASSET_EVENT, { detail: asset }));
  } catch {
    /* ignore */
  }
  void window.grudge?.app?.openRoute?.("/view");
}

function loadStoredAsset(): AssetRef | null {
  try {
    const raw = sessionStorage.getItem(VIEW_ASSET_KEY);
    if (raw) {
      const a = JSON.parse(raw) as AssetRef;
      if (a?.url && a?.name) return a;
    }
  } catch {
    /* ignore */
  }
  try {
    const m = readMirror() as { viewAsset?: AssetRef };
    if (m.viewAsset?.url) return m.viewAsset;
  } catch {
    /* ignore */
  }
  return null;
}

export default function ViewMode() {
  const [asset, setAsset] = useState<AssetRef | null>(() => loadStoredAsset());
  const [aiNote, setAiNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");

  useEffect(() => {
    const a = loadStoredAsset();
    if (a) setAsset(a);
    const onAsset = (e: Event) => {
      const detail = (e as CustomEvent<AssetRef>).detail;
      if (detail?.url) {
        setAsset(detail);
        setAiNote("");
      } else {
        const next = loadStoredAsset();
        if (next) setAsset(next);
      }
    };
    window.addEventListener(VIEW_ASSET_EVENT, onAsset);
    return () => window.removeEventListener(VIEW_ASSET_EVENT, onAsset);
  }, []);

  const kind = useMemo(() => {
    if (!asset) return "unknown" as AssetKind;
    return classify(asset);
  }, [asset]);

  const meta = KIND_META[kind] || KIND_META.unknown;
  const KindIcon = meta.Icon;

  const setAndStore = useCallback((a: AssetRef | null) => {
    setAsset(a);
    try {
      if (a) {
        sessionStorage.setItem(VIEW_ASSET_KEY, JSON.stringify(a));
        writeMirror({
          viewAsset: {
            name: a.name,
            url: a.url,
            contentType: a.contentType,
            size: a.size,
          },
        });
      } else {
        sessionStorage.removeItem(VIEW_ASSET_KEY);
        writeMirror({ viewAsset: undefined });
      }
    } catch {
      /* ignore */
    }
  }, []);

  const openFromPicker = useCallback(async () => {
    try {
      const paths: string[] = await window.grudge?.files?.pickForUpload?.();
      if (!paths?.length) return;
      const path = paths[0];
      const name = path.split(/[/\\]/).pop() || path;
      const ext = name.split(".").pop()?.toLowerCase() || "";
      // Video/audio: stream (mp4 etc.) — double-click / picker same path as elite open
      if (/\.(mp4|webm|mov|m4v|ogv|mkv|avi|mp3|wav|ogg|flac|m4a|aac|opus)$/i.test(name)) {
        const url = await window.grudge.files.mediaUrl(path);
        const ct = ext === "webm" ? "video/webm" : ext === "mp3" ? "audio/mpeg" : "video/mp4";
        setAndStore({
          name: path.replace(/\\/g, "/"),
          url,
          contentType: ct,
          size: 0,
          localPath: path,
          stream: true,
        });
        toast.success("Opened video/audio for review", { description: name });
        return;
      }
      const fileData = await window.grudge.files.read(path);
      const bytes = fileData.bytes as Uint8Array;
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const blob = new Blob([ab], { type: fileData.mime || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const ct =
        fileData.mime ||
        (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp"
          ? `image/${ext === "jpg" ? "jpeg" : ext}`
          : ext === "glb"
            ? "model/gltf-binary"
            : "application/octet-stream");
      setAndStore({
        name: path.replace(/\\/g, "/"),
        url,
        contentType: ct,
        size: bytes.byteLength,
        localPath: path,
      });
      toast.success("Opened for review", { description: name });
    } catch (e: unknown) {
      toast.error("Open failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }, [setAndStore]);

  const openFromUrl = useCallback(() => {
    const raw = urlDraft.trim();
    if (!raw) return;
    try {
      const u = raw.startsWith("http") ? raw : `https://${raw}`;
      new URL(u);
      const name = u.split("?")[0].split("/").pop() || u;
      setAndStore({
        name: name.includes("/") ? name : `remote/${name}`,
        url: u,
        contentType: "",
        size: 0,
      });
      toast.success("Loaded URL");
    } catch {
      toast.error("Invalid URL");
    }
  }, [urlDraft, setAndStore]);

  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(() => toast.success(`Copied ${label}`));
  };

  const popOut = () => {
    if (!asset) return;
    void window.grudge?.viewer
      ?.open(asset)
      .then(() => toast.success("Pop-out viewer"))
      .catch((e: Error) => toast.error(e?.message || "Viewer failed"));
  };

  const sendForge = () => {
    if (!asset) return;
    void window.grudge?.viewer
      ?.sendToForge({ url: asset.url, name: asset.name })
      .then((r: { ok?: boolean; error?: string }) => {
        if (r?.ok) toast.success("Sent to Forge");
        else toast.error(r?.error ?? "Forge send failed");
      })
      .catch(() => toast.error("Could not send to Forge"));
  };

  const sendSkeleton = async () => {
    if (!asset) return;
    setBusy(true);
    try {
      toast.message("Downloading for Skeleton…");
      const opened = await window.grudge?.forge?.openRemote?.(asset.url);
      const path = opened?.path as string | undefined;
      if (!path) {
        toast.error("Download failed");
        return;
      }
      sessionStorage.setItem("grudge.skeleton.pendingPath", path);
      await window.grudge?.app?.openRoute?.("/skeleton");
      toast.success("Opened in Skeleton Studio");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Skeleton failed");
    } finally {
      setBusy(false);
    }
  };

  const sendStorage = async () => {
    if (!asset) return;
    setBusy(true);
    try {
      // Re-index / re-queue for upload path when local; for CDN just register note
      if (asset.url.startsWith("blob:") || asset.url.startsWith("file:")) {
        toast.message("Local file — use Upload tab to push to R2");
        await window.grudge?.app?.openRoute?.("/upload");
        return;
      }
      // CDN asset: copy pack path for upload/register workflows
      copy(asset.name, "storage key");
      toast.success("Storage key ready", {
        description: "Paste into Upload or register via Agent AI",
      });
      await window.grudge?.app?.openRoute?.("/upload");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Storage handoff failed");
    } finally {
      setBusy(false);
    }
  };

  const saveLocal = async () => {
    if (!asset) return;
    try {
      // Prefer download via shell / open external; blob can force download
      if (asset.url.startsWith("blob:")) {
        const a = document.createElement("a");
        a.href = asset.url;
        a.download = basename(asset.name);
        a.click();
        toast.success("Download started");
        return;
      }
      void window.grudge?.os?.openExternal?.(asset.url);
      toast.message("Opened in system browser to save");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const defineForAi = async () => {
    if (!asset) return;
    setBusy(true);
    try {
      const kindLabel = meta.label;
      const note = aiNote.trim();
      const prompt = [
        `Define this Grudge Studio asset for AI / agent tools.`,
        `Key: ${asset.name}`,
        `CDN: ${asset.url}`,
        `Kind: ${kindLabel}`,
        `Size: ${formatBytes(asset.size)}`,
        note ? `Editor notes: ${note}` : "",
        `Return: short title, category tags, SI scale notes if 3D, usage (UI/combat/env), and a one-line tool description.`,
      ]
        .filter(Boolean)
        .join("\n");

      let definition = "";
      try {
        const r = await window.grudge?.ollama?.generate?.({ prompt });
        definition = (r?.response || r?.text || "").trim();
      } catch {
        /* offline */
      }
      if (!definition) {
        try {
          const r = await window.grudge?.ai?.chat?.({
            messages: [{ role: "user", content: prompt }],
          });
          definition = (r?.content || r?.text || r?.message || "").trim();
        } catch {
          /* no cloud */
        }
      }
      if (!definition) {
        definition = [
          `title: ${basename(asset.name)}`,
          `key: ${asset.name}`,
          `cdn: ${asset.url}`,
          `kind: ${kindLabel}`,
          note ? `notes: ${note}` : "",
          `status: draft — generate with Ollama or Legion when online`,
        ]
          .filter(Boolean)
          .join("\n");
        toast.message("Offline draft definition (copy below)");
      } else {
        toast.success("AI definition ready");
      }

      const payload = {
        asset: { name: asset.name, url: asset.url, contentType: asset.contentType, size: asset.size },
        kind: kindLabel,
        notes: note,
        definition,
        definedAt: new Date().toISOString(),
      };
      const json = JSON.stringify(payload, null, 2);
      await navigator.clipboard.writeText(json);
      setAiNote(definition.slice(0, 2000));
      toast.success("Definition copied to clipboard (JSON)");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "AI define failed");
    } finally {
      setBusy(false);
    }
  };

  const is3d = kind === "model3d" || kind === "scene3d";

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#070a12] text-slate-100">
      <header className="shrink-0 border-b border-white/10 bg-black/40 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Eye size={16} className="text-sky-400" />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-wide">View Mode</h1>
            <p className="text-[10px] text-slate-500">
              Review any asset · save · Forge · storage · AI define
            </p>
          </div>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-sky-700/50 bg-sky-950/40 px-2 py-1 text-[11px] hover:border-sky-500"
              onClick={() => void openFromPicker()}
            >
              <FolderOpen size={12} /> Open file
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-[11px]"
              onClick={() => void window.grudge?.app?.openRoute?.("/browser")}
            >
              From Assets
            </button>
            {asset && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-[11px] text-slate-400"
                onClick={() => setAndStore(null)}
              >
                <X size={12} /> Clear
              </button>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <input
            className="min-w-[14rem] flex-1 rounded border border-white/10 bg-black/40 px-2 py-1 text-[11px] font-mono text-slate-300"
            placeholder="Paste CDN URL or https://…"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") openFromUrl();
            }}
          />
          <button
            type="button"
            className="rounded border border-white/15 px-2 py-1 text-[11px]"
            onClick={openFromUrl}
          >
            <Link2 size={12} className="inline mr-1" />
            Load URL
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Viewer stage */}
        <div className="relative min-h-0 min-w-0 flex-1 bg-black">
          {!asset && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <Eye className="h-12 w-12 text-sky-500/30" />
              <p className="text-sm text-slate-300">No asset in View Mode</p>
              <p className="max-w-md text-[11px] text-slate-500">
                Open a local file, paste a CDN URL, or from{" "}
                <strong className="text-sky-300">Assets</strong> click a file → review here.
                Images, audio, video, GLB/scenes, PDF, text, PSD, fonts.
              </p>
            </div>
          )}
          {asset && (
            <React.Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-sm text-slate-400">
                  Loading viewer…
                </div>
              }
            >
              <div className="absolute inset-0">
                {kind === "image" && <ImageViewer asset={asset} />}
                {kind === "video" && <VideoViewer asset={asset} />}
                {kind === "audio" && <AudioViewer asset={asset} />}
                {(kind === "model3d" || kind === "scene3d") && <Model3DViewer asset={asset} />}
                {kind === "text" && <TextViewer asset={asset} />}
                {kind === "pdf" && <PdfViewer asset={asset} />}
                {kind === "font" && <FontViewer asset={asset} />}
                {(kind === "design" || kind === "unknown") && <DesignViewer asset={asset} />}
              </div>
            </React.Suspense>
          )}
        </div>

        {/* Actions rail */}
        <aside className="flex w-72 shrink-0 flex-col border-l border-white/10 bg-black/35">
          <div className="flex-1 space-y-3 overflow-y-auto p-3 text-xs">
            {asset ? (
              <>
                <section className="space-y-1">
                  <div className="flex items-center gap-2 text-sky-200">
                    <KindIcon size={14} />
                    <span className="font-semibold">{meta.label}</span>
                  </div>
                  <p className="truncate font-medium text-slate-100" title={asset.name}>
                    {basename(asset.name)}
                  </p>
                  <p className="break-all text-[10px] text-slate-500 font-mono">{asset.name}</p>
                  <p className="text-[10px] text-slate-500">
                    {formatBytes(asset.size)}
                    {asset.contentType ? ` · ${asset.contentType}` : ""}
                  </p>
                </section>

                <section className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Actions</p>
                  <ActionBtn icon={Save} label="Save / download" onClick={() => void saveLocal()} />
                  <ActionBtn
                    icon={Maximize2}
                    label="Pop-out viewer"
                    onClick={popOut}
                    tone="gold"
                  />
                  <ActionBtn
                    icon={Copy}
                    label="Copy CDN URL"
                    onClick={() => copy(asset.url, "CDN URL")}
                  />
                  <ActionBtn
                    icon={Copy}
                    label="Copy storage key"
                    onClick={() => copy(asset.name, "key")}
                  />
                  <ActionBtn
                    icon={ExternalLink}
                    label="Open in browser"
                    onClick={() => void window.grudge?.os?.openExternal?.(asset.url)}
                  />
                  <ActionBtn
                    icon={Hammer}
                    label="Send to Forge"
                    onClick={sendForge}
                    tone="ok"
                  />
                  {is3d && (
                    <ActionBtn
                      icon={Bone}
                      label="Send to Skeleton"
                      onClick={() => void sendSkeleton()}
                      tone="cyan"
                      disabled={busy}
                    />
                  )}
                  <ActionBtn
                    icon={Upload}
                    label="Send to storage / Upload"
                    onClick={() => void sendStorage()}
                    disabled={busy}
                  />
                </section>

                <section className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 flex items-center gap-1">
                    <Sparkles size={11} /> Define for AI
                  </p>
                  <textarea
                    className="w-full rounded border border-white/10 bg-black/50 px-2 py-1.5 text-[11px] text-slate-200 min-h-[4.5rem]"
                    placeholder="Optional notes (role, SI scale, faction…)"
                    value={aiNote}
                    onChange={(e) => setAiNote(e.target.value)}
                  />
                  <ActionBtn
                    icon={Sparkles}
                    label="Save & define for AI"
                    onClick={() => void defineForAi()}
                    tone="violet"
                    disabled={busy}
                  />
                  <p className="text-[9px] text-slate-600">
                    Uses local Ollama when available, else Legion; always copies JSON definition.
                  </p>
                </section>
              </>
            ) : (
              <p className="text-[11px] text-slate-500">
                Select an asset to enable save, Forge, storage, and AI define.
              </p>
            )}
          </div>
          <div className="border-t border-white/5 p-2 text-[9px] text-slate-600">
            Play / game smoke-test → <button type="button" className="text-sky-500 underline" onClick={() => void window.grudge?.app?.openRoute?.("/preview")}>Preview</button>
            {" · "}
            <button type="button" className="text-sky-500 underline" onClick={() => void window.grudge?.app?.openRoute?.("/games")}>Games</button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  onClick,
  tone,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  tone?: "gold" | "ok" | "cyan" | "violet";
  disabled?: boolean;
}) {
  const tones: Record<string, string> = {
    gold: "border-amber-700/50 text-amber-200 hover:bg-amber-950/30",
    ok: "border-emerald-700/50 text-emerald-200 hover:bg-emerald-950/30",
    cyan: "border-cyan-700/50 text-cyan-200 hover:bg-cyan-950/30",
    violet: "border-violet-700/50 text-violet-200 hover:bg-violet-950/40",
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded border px-2 py-2 text-left text-[11px] disabled:opacity-40 ${
        tone ? tones[tone] : "border-white/10 text-slate-300 hover:bg-white/5"
      }`}
    >
      <Icon size={13} className="shrink-0" />
      {label}
    </button>
  );
}
