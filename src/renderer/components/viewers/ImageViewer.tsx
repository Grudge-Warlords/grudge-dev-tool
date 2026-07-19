import React, { useEffect, useRef, useState } from "react";
import type { AssetRef } from "./types";

/** Pan + zoom image viewer. Wheel zooms toward the cursor, drag pans, double
 *  click toggles fit↔100%. Pure CSS transform, no canvas — the browser is
 *  already an extremely fast image decoder. */
export default function ImageViewer({ asset }: { asset: AssetRef }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dragging = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  function reset() { setScale(1); setTx(0); setTy(0); }

  useEffect(() => { reset(); setError(null); }, [asset.url]);

  // Native non-passive wheel listener — allows e.preventDefault() without browser warning.
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
  function onMouseUp() { dragging.current = null; }

  function fit() {
    if (!containerRef.current || !natural) return;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const s = Math.min(cw / natural.w, ch / natural.h, 1);
    setScale(s);
    setTx(0); setTy(0);
  }

  return (
    <div
      ref= { containerRef }
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onDoubleClick={() => (scale === 1 ? fit() : reset())}
      style={{
        position: "relative", overflow: "hidden",
        width: "100%", height: "100%",
        background: "#000",
        cursor: dragging.current ? "grabbing" : "grab",
        userSelect: "none",
      }}
    >
      {error ? (
        <div className="text-danger text-sm flex items-center justify-center h-full">{error}</div>
      ) : (
        <img
          src={asset.url}
          alt={asset.name}
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            setNatural({ w: img.naturalWidth, h: img.naturalHeight });
          }}
          onError={() => setError("Failed to load image (network or CORS)")}
          style={{
            position: "absolute", left: "50%", top: "50%",
            transform: `translate(-50%, -50%) translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: "center center",
            maxWidth: "none", maxHeight: "none",
            imageRendering: scale > 4 ? "pixelated" : "auto",
            pointerEvents: "none",
          }}
        />
      )}

      <div style={{
        position: "absolute", bottom: 8, left: 8,
        background: "rgba(15,21,48,0.85)", border: "1px solid var(--line)",
        borderRadius: 6, padding: "4px 8px", fontSize: 11, color: "var(--muted)",
        display: "flex", gap: 8, alignItems: "center",
      }}>
        {natural && <span>{natural.w}×{natural.h}</span>}
        <span style={{ color: "var(--gold)" }}>{(scale * 100).toFixed(0)}%</span>
        <button className="text-gold hover:underline" onClick={reset}>reset</button>
        <button className="text-gold hover:underline" onClick={fit}>fit</button>
      </div>
    </div>
  );
}
