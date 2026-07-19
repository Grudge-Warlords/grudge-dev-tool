import React, { useEffect, useState } from "react";
import type { AssetRef } from "./types";

const SAMPLE = "The quick brown fox jumps over the lazy dog 0123456789";
const SIZES = [12, 18, 24, 36, 48, 64, 96];

/** Loads the font with the FontFace API (no @font-face string parsing, no
 *  external libs) and renders sample text at multiple sizes. */
export default function FontViewer({ asset }: { asset: AssetRef }) {
  const [fontName, setFontName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState(SAMPLE);

  useEffect(() => {
    let cancelled = false;
    setError(null); setFontName(null);
    const family = `preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const face = new FontFace(family, `url(${JSON.stringify(asset.url)})`);
    face.load().then(
      (loaded) => {
        if (cancelled) return;
        (document as any).fonts.add(loaded);
        setFontName(family);
      },
      (err) => {
        if (!cancelled) setError(err?.message ?? String(err));
      },
    );
    return () => {
      cancelled = true;
      try { (document as any).fonts.delete?.(face); } catch { /* no-op */ }
    };
  }, [asset.url]);

  return (
    <div style={{
      width: "100%", height: "100%", overflow: "auto",
      background: "var(--bg-0)", padding: 24,
    }}>
      <div style={{ marginBottom: 16 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type to preview…"
          style={{ width: "100%", fontSize: 14 }}
        />
      </div>

      {error && <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>}
      {!fontName && !error && <div style={{ color: "var(--muted)", fontSize: 12 }}>Loading font…</div>}

      {fontName && SIZES.map((px) => (
        <div key={px} style={{
          padding: "10px 0", borderBottom: "1px dotted var(--line)",
          display: "flex", alignItems: "baseline", gap: 16,
        }}>
          <span style={{ color: "var(--muted)", fontSize: 11, width: 50, flexShrink: 0 }}>
            {px}px
          </span>
          <span style={{
            fontFamily: `"${fontName}", sans-serif`,
            fontSize: px, color: "var(--text)", lineHeight: 1.2,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>{text}</span>
        </div>
      ))}
    </div>
  );
}
