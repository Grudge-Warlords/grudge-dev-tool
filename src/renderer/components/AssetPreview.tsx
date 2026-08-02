import React, { useEffect } from "react";
import {
  X, Copy, ExternalLink, Download, FileText, Image as ImageIcon,
  Music, Video as VideoIcon, Box, FileType2, FileQuestion,
  Maximize2, Layers3, Hammer, Bone,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { classify, basename, formatBytes, type AssetRef, type AssetKind } from "./viewers/types";
import ImageViewer from "./viewers/ImageViewer";
import VideoViewer from "./viewers/VideoViewer";
import TextViewer from "./viewers/TextViewer";
import PdfViewer from "./viewers/PdfViewer";
import FontViewer from "./viewers/FontViewer";

const AudioViewer = React.lazy(() => import("./viewers/AudioViewer"));
const Model3DViewer = React.lazy(() => import("./viewers/Model3DViewer"));
const DesignViewer = React.lazy(() => import("./viewers/DesignViewer"));

const KIND_ICON: Record<AssetKind, LucideIcon> = {
  image: ImageIcon,
  video: VideoIcon,
  audio: Music,
  model3d: Box,
  scene3d: Layers3,
  text: FileText,
  pdf: FileText,
  font: FileType2,
  design: Layers3,
  unknown: FileQuestion,
};

const iconBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--line)",
  color: "var(--text)",
  padding: "5px 8px",
  borderRadius: 5,
  cursor: "pointer",
  fontSize: 12,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

export default function AssetPreview(props: {
  asset: AssetRef | null;
  open: boolean;
  onClose: () => void;
}) {
  const { asset, open, onClose } = props;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !asset) return null;

  const kind = classify(asset);
  const Icon = KIND_ICON[kind];
  const fileName = basename(asset.name);
  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(() => toast.success(`Copied ${label}`));
  };
  const openExternal = () => window.grudge?.os?.openExternal?.(asset.url);
  const popOut = () => {
    void window.grudge?.viewer
      ?.open(asset)
      .catch((e: Error) => toast.error("Viewer failed", { description: e?.message }));
  };
  const sendForge = () => {
    void window.grudge?.viewer
      ?.sendToForge({ url: asset.url, name: asset.name })
      .then((r: { ok?: boolean; error?: string }) => {
        if (r?.ok) toast.success("Added to Forge 3D scene");
        else toast.error(r?.error ?? "Failed to send to Forge");
      })
      .catch(() => toast.error("Could not send to Forge"));
  };
  /** Download CDN model → open Skeleton Studio with local path. */
  const sendSkeleton = () => {
    void (async () => {
      try {
        toast.message("Downloading for Skeleton Studio…");
        const opened = await window.grudge?.forge?.openRemote?.(asset.url);
        const path = opened?.path as string | undefined;
        if (!path) {
          toast.error("Could not download model for Skeleton");
          return;
        }
        try {
          sessionStorage.setItem("grudge.skeleton.pendingPath", path);
        } catch {
          /* ignore */
        }
        onClose();
        await window.grudge?.app?.openRoute?.("/skeleton");
        toast.success("Opened in Skeleton Studio", { description: asset.name });
      } catch (e: unknown) {
        toast.error("Send to Skeleton failed", {
          description: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(0,0,0,0.78)",
        display: "flex",
        flexDirection: "column",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
          background: "var(--bg-1)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <Icon size={16} />
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
          <span
            title={asset.name}
            style={{
              color: "var(--gold)",
              fontWeight: 600,
              fontSize: 13,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {fileName}
          </span>
          <span
            title={asset.name}
            style={{
              color: "var(--muted)",
              fontSize: 11,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {asset.name} · {formatBytes(asset.size)} · {kind}
          </span>
        </div>

        <button type="button" title="Copy CDN URL" onClick={() => copy(asset.url, "CDN URL")} style={iconBtn}>
          <Copy size={14} />
        </button>
        <button type="button" title="Copy bucket path" onClick={() => copy(asset.name, "path")} style={iconBtn}>
          <FileText size={14} />
        </button>
        <a
          href={asset.url}
          download={fileName}
          title="Download"
          style={{ ...iconBtn, textDecoration: "none" }}
        >
          <Download size={14} />
        </a>
        <button type="button" title="Open externally" onClick={openExternal} style={iconBtn}>
          <ExternalLink size={14} />
        </button>
        <button
          type="button"
          title="Pop out Asset Viewer (always on top)"
          onClick={popOut}
          style={{ ...iconBtn, color: "var(--gold)", borderColor: "var(--gold)" }}
        >
          <Maximize2 size={14} />
        </button>
        {(kind === "model3d" || kind === "scene3d") && (
          <>
            <button
              type="button"
              title="Add to Forge 3D scene"
              onClick={sendForge}
              style={{ ...iconBtn, color: "var(--ok)", borderColor: "var(--ok)" }}
            >
              <Hammer size={14} />
            </button>
            <button
              type="button"
              title="Open in Skeleton Studio (Mixamo-25 / retarget)"
              onClick={sendSkeleton}
              style={{ ...iconBtn, color: "#67e8f9", borderColor: "#0891b2" }}
            >
              <Bone size={14} />
            </button>
          </>
        )}
        <button
          type="button"
          title="Close (Esc)"
          onClick={onClose}
          style={{ ...iconBtn, color: "var(--danger)" }}
        >
          <X size={16} />
        </button>
      </header>

      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <React.Suspense fallback={<ViewerLoading />}>
          {kind === "image" && <ImageViewer asset={asset} />}
          {kind === "video" && <VideoViewer asset={asset} />}
          {kind === "audio" && <AudioViewer asset={asset} />}
          {(kind === "model3d" || kind === "scene3d") && <Model3DViewer asset={asset} />}
          {kind === "text" && <TextViewer asset={asset} />}
          {kind === "pdf" && <PdfViewer asset={asset} />}
          {kind === "font" && <FontViewer asset={asset} />}
          {(kind === "design" || kind === "unknown") && <DesignViewer asset={asset} />}
        </React.Suspense>
      </div>
    </div>
  );
}

function ViewerLoading() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--muted)",
        fontSize: 12,
      }}
    >
      Loading viewer…
    </div>
  );
}

function UnknownViewer({ asset }: { asset: AssetRef }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        color: "var(--muted)",
        padding: 24,
        textAlign: "center",
      }}
    >
      <FileQuestion size={42} />
      <div style={{ color: "var(--text)", fontSize: 14 }}>No inline viewer for this file type.</div>
      <div style={{ fontSize: 12 }}>
        {asset.contentType || "unknown"} · {formatBytes(asset.size)}
      </div>
      <button
        type="button"
        className="btn"
        style={{ marginTop: 8 }}
        onClick={() => window.grudge?.os?.openExternal?.(asset.url)}
      >
        Open externally
      </button>
    </div>
  );
}
