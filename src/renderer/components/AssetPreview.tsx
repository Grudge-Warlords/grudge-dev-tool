import React, { useEffect } from "react";
import {
  X, Copy, ExternalLink, Download, FileText, Image as ImageIcon,
  Music, Video as VideoIcon, Box, FileType2, FileQuestion,
  Maximize2, Layers3,
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

const KIND_ICON: Record<AssetKind, LucideIcon> = {
  image: ImageIcon, video: VideoIcon, audio: Music,
  model3d: Box, scene3d: Layers3, text: FileText, pdf: FileText, font: FileType2,
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
};

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 60,
  background: "rgba(0,0,0,0.78)",
  display: "flex",
  flexDirection: "column",
};

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 16px",
  background: "var(--bg-1)",
  borderBottom: "1px solid var(--line)",
};

export default function AssetPreview(props: { asset: AssetRef | null; open: boolean; onClose: () => void }) {
  const { asset, open, onClose } = props;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !asset) return null;

  const kind = classify(asset);
  const Icon = KIND_ICON[kind];
  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`Copied ${label}`));
  };
  const openExternal = () => (window as any).grudge?.os?.openExternal?.(asset.url);
  const fileName = basename(asset.name);

  return (
    <div style= { overlay } onClick = {(e) => { if (e.target === e.currentTarget) onClose(); }
}>
  <header style={ header }>
    <Icon size={ 16 } />
      < div style = {{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
        <span title={ asset.name } style = {{ color: "var(--gold)", fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}> { fileName } </span>
          < span title = { asset.name } style = {{ color: "var(--muted)", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}> { asset.name } · { formatBytes(asset.size) } · { kind } </span>
            </div>
  < button title = "Copy CDN URL" onClick = {() => copy(asset.url, "CDN URL")} style = { iconBtn } > <Copy size={ 14 } /></button >
    <button title="Copy bucket path" onClick = {() => copy(asset.name, "path")} style = { iconBtn } > <FileText size={ 14 } /></button >
      <a href={ asset.url } download = { fileName } title = "Download" style = {{ ...iconBtn, display: "inline-flex", alignItems: "center", justifyContent: "center" }}> <Download size={ 14 } /></a >
        <button title="Open in default app / browser" onClick = { openExternal } style = { iconBtn } > <ExternalLink size={ 14 } /></button >
          {/* Pop-out viewer — opens a standalone window with full 3-D controls */ }
          < button
title = "Pop out in viewer window"
onClick = {() => (window as any).grudge?.viewer?.open(asset)}
style = {{ ...iconBtn, color: "var(--gold)", borderColor: "var(--gold)" }}
        > <Maximize2 size={ 14 } /></button >
  {/* Send to Forge — only relevant for 3-D assets */ }
{
  (kind === "model3d" || kind === "scene3d") && (
    <button
            title="Add to Forge 3D scene"
  onClick = {() => {
    (window as any).grudge?.viewer?.sendToForge({ url: asset.url, name: asset.name })
      .then((r: any) => { if (r?.ok) toast.success("Added to Forge 3D scene"); else toast.error(r?.error ?? "Failed"); })
      .catch(() => toast.error("Could not send to Forge"));
  }
}
style = {{ ...iconBtn, color: "var(--ok)", borderColor: "var(--ok)" }}
          > <Layers3 size={ 14 } /></button >
        )}
<button title="Close (Esc)" onClick = { onClose } style = {{ ...iconBtn, color: "var(--danger)" }}> <X size={ 16 } /></button >
  </header>

  < div style = {{ flex: 1, minHeight: 0, position: "relative" }}>
    <React.Suspense fallback={ <ViewerLoading /> }>
      { kind === "image" && <ImageViewer asset={ asset } />}
{ kind === "video" && <VideoViewer asset={ asset } /> }
{ kind === "audio" && <AudioViewer asset={ asset } /> }
{ (kind === "model3d" || kind === "scene3d") && <Model3DViewer asset={ asset } /> }
{ kind === "text" && <TextViewer asset={ asset } /> }
{ kind === "pdf" && <PdfViewer asset={ asset } /> }
{ kind === "font" && <FontViewer asset={ asset } /> }
{ kind === "unknown" && <UnknownViewer asset={ asset } /> }
</React.Suspense>
  </div>
  </div>
  );
}

function ViewerLoading() {
  return (
    <div style= {{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 12 }
}>
  Loading viewer…
</div>
  );
}

function UnknownViewer({ asset }: { asset: AssetRef }) {
  return (
    <div style= {{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "var(--muted)", padding: 24, textAlign: "center" }
}>
  <FileQuestion size={ 42 } />
    < div style = {{ color: "var(--text)", fontSize: 14 }}> No inline viewer for this file type.</div>
      < div style = {{ fontSize: 12 }}> { asset.contentType || "unknown" } · { formatBytes(asset.size) } </div>
        < button className = "btn" onClick = {() => (window as any).grudge?.os?.openExternal?.(asset.url)} style = {{ marginTop: 8 }}> Open externally </button>
          </div>
  );
}
