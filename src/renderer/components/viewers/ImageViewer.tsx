import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { AssetRef } from "./types";
import { formatBytes, isRasterImageName } from "./types";

type OutFmt = "png" | "webp" | "jpeg" | "avif";

/** Pan + zoom image viewer with sharp-backed convert actions. */
export default function ImageViewer({ asset }: { asset: AssetRef }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    width: number;
    height: number;
    format?: string;
    hasAlpha?: boolean;
    sizeBytes: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const dragging = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  function reset() {
    setScale(1);
    setTx(0);
    setTy(0);
  }

  useEffect(() => {
    reset();
    setError(null);
    setMeta(null);
    // Deep inspect via sharp (handles TGA/TIFF/HEIC the browser may not)
    if (isRasterImageName(asset.name) && window.grudge?.viewer?.inspectImage) {
      void window.grudge.viewer.inspectImage({ url: asset.url, name: asset.name }).then((r: {
        ok: boolean;
        meta?: { width: number; height: number; format?: string; hasAlpha?: boolean; sizeBytes: number };
        error?: string;
      }) => {
        if (r.ok && r.meta) setMeta(r.meta);
      });
    }
  }, [asset.url, asset.name]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setScale((prevScale) => {
        const next = Math.max(0.05, Math.min(40, prevScale * factor));
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          const cx = e.clientX - rect.left - rect.width / 2;
          const cy = e.clientY - rect.top - rect.height / 2;
          const k = next / prevScale;
          setTx((prev) => cx - (cx - prev) * k);
          setTy((prev) => cy - (cy - prev) * k);
        }
        return next;
      });
    };
    el.addEventListener("wheel", wheelHandler, { passive: false });
    return () => el.removeEventListener("wheel", wheelHandler);
  }, []);

  function onMouseDown(e: React.MouseEvent) {
    dragging.current = { x: e.clientX, y: e.clientY, tx, ty };
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragging.current) return;
    setTx(dragging.current.tx + (e.clientX - dragging.current.x));
    setTy(dragging.current.ty + (e.clientY - dragging.current.y));
  }
  function onMouseUp() {
    dragging.current = null;
  }

  function fit() {
    if (!containerRef.current || !natural) return;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const s = Math.min(cw / natural.w, ch / natural.h, 1);
    setScale(s);
    setTx(0);
    setTy(0);
  }

  async function convert(format: OutFmt) {
    if (!window.grudge?.viewer?.convertImage) {
      toast.error("Image convert unavailable");
      return;
    }
    setBusy(true);
    try {
      const r = await window.grudge.viewer.convertImage({
        url: asset.url,
        name: asset.name,
        format,
        quality: format === "png" ? 90 : 86,
      });
      if (!r.ok || !r.path) {
        toast.error("Convert failed", { description: r.error });
        return;
      }
      const saved = await window.grudge.viewer.saveConvertedFile({
        path: r.path,
        defaultName: r.name ?? asset.name.replace(/\.[^.]+$/, `.${format === "jpeg" ? "jpg" : format}`),
        kind: "image",
      });
      if ("canceled" in saved && saved.canceled) return;
      if ("ok" in saved && saved.ok) {
        const before = r.beforeBytes ?? 0;
        const after = r.afterBytes ?? 0;
        toast.success(`Saved ${format.toUpperCase()}`, {
          description:
            before && after
              ? `${formatBytes(before)} → ${formatBytes(after)}`
              : saved.savedPath,
        });
      } else if ("error" in saved) {
        toast.error("Save failed", { description: saved.error });
      }
    } catch (e: unknown) {
      toast.error("Convert error", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const dims = meta
    ? `${meta.width}×${meta.height}`
    : natural
      ? `${natural.w}×${natural.h}`
      : null;

  // TGA / HEIC etc. may not render in <img>; sharp meta still helps
  const browserMayFail = /\.(tga|tif|tiff|heic|heif|dds|exr)$/i.test(asset.name);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          padding: "6px 8px",
          borderBottom: "1px solid var(--line)",
          background: "var(--bg-1)",
          alignItems: "center",
        }}
      >
        <span className="text-[10px] text-muted">Convert (sharp)</span>
        {(["webp", "png", "jpeg", "avif"] as OutFmt[]).map((f) => (
          <button
            key={f}
            type="button"
            className="btn ghost text-[10px] py-0 px-2"
            disabled={busy}
            onClick={() => void convert(f)}
          >
            → {f.toUpperCase()}
          </button>
        ))}
        {meta && (
          <span className="text-[10px] text-muted ml-auto font-mono">
            {meta.format ?? "?"} · {meta.hasAlpha ? "alpha" : "opaque"} · {formatBytes(meta.sizeBytes)}
          </span>
        )}
      </div>

      <div
        ref={containerRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onDoubleClick={() => (scale === 1 ? fit() : reset())}
        style={{
          position: "relative",
          overflow: "hidden",
          flex: 1,
          minHeight: 0,
          background: "#000",
          cursor: dragging.current ? "grabbing" : "grab",
          userSelect: "none",
        }}
      >
        {error ? (
          <div className="text-danger text-sm flex flex-col items-center justify-center h-full gap-2 p-4 text-center">
            <div>{error}</div>
            {browserMayFail && (
              <div className="text-muted text-xs max-w-sm">
                Browser cannot display this format inline. Use Convert → PNG/WebP above (sharp pipeline).
              </div>
            )}
            {meta && (
              <div className="text-gold text-xs font-mono">
                Detected {meta.width}×{meta.height} {meta.format}
              </div>
            )}
          </div>
        ) : (
          <img
            src={asset.url}
            alt={asset.name}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNatural({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onError={() =>
              setError(
                browserMayFail
                  ? "Preview unsupported in browser — convert with sharp toolbar"
                  : "Failed to load image (network or CORS)",
              )
            }
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: `translate(-50%, -50%) translate(${tx}px, ${ty}px) scale(${scale})`,
              transformOrigin: "center center",
              maxWidth: "none",
              maxHeight: "none",
              imageRendering: scale > 4 ? "pixelated" : "auto",
              pointerEvents: "none",
            }}
          />
        )}

        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: 8,
            background: "rgba(15,21,48,0.85)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            padding: "4px 8px",
            fontSize: 11,
            color: "var(--muted)",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          {dims && <span>{dims}</span>}
          <span style={{ color: "var(--gold)" }}>{(scale * 100).toFixed(0)}%</span>
          <button type="button" className="text-gold hover:underline" onClick={reset}>
            reset
          </button>
          <button type="button" className="text-gold hover:underline" onClick={fit}>
            fit
          </button>
        </div>
      </div>
    </div>
  );
}
