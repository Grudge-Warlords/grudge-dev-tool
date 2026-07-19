import React, { useEffect, useState } from "react";
import type { AssetRef } from "./types";

const MAX_BYTES = 256 * 1024; // cap preview at 256 KB to keep render snappy

/** Trim any trailing partial UTF-8 sequence from a Uint8Array. */
function trimPartialUtf8(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  for (let i = 1; i <= 3 && i <= end; i++) {
    const b = bytes[end - i];
    if (b < 0x80) break; // ASCII byte — full char, no truncation
    if ((b & 0xc0) === 0xc0) {
      // Start byte: determine expected total sequence length
      const expected = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : 2;
      if (i < expected) end -= i; // truncated — drop the incomplete sequence
      break;
    }
    // Continuation byte (0x80–0xBF) — keep searching back
  }
  return end === bytes.length ? bytes : bytes.slice(0, end);
}

/** Plain-text / code preview. Pretty-prints JSON. No Monaco — keeps the
 *  bundle tiny; the dedicated Coder page handles real editing. */
export default function TextViewer({ asset }: { asset: AssetRef }) {
  const [content, setContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setContent(""); setTruncated(false);
    (async () => {
      try {
        // Range request to short-circuit huge files. Most R2 / CDNs honour it;
        // if not, we still read the stream and bail at MAX_BYTES.
        const res = await fetch(asset.url, { headers: { Range: `bytes=0-${MAX_BYTES - 1}` } });
        if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
        const reader = res.body?.getReader();
        if (!reader) {
          const text = await res.text();
          if (cancelled) return;
          applyText(text);
          return;
        }
        const chunks: Uint8Array[] = [];
        let total = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (cancelled) return;
          chunks.push(value);
          total += value.byteLength;
          if (total >= MAX_BYTES) {
            setTruncated(true);
            try { await reader.cancel(); } catch { /* no-op */ }
            break;
          }
        }
        let totalLen = 0;
        for (const c of chunks) totalLen += c.byteLength;
        const combined = new Uint8Array(totalLen);
        let offset = 0;
        for (const c of chunks) { combined.set(c, offset); offset += c.byteLength; }
        const text = new TextDecoder().decode(trimPartialUtf8(combined));
        if (cancelled) return;
        applyText(text);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    function applyText(t: string) {
      const ext = (asset.name.split(".").pop() ?? "").toLowerCase();
      if (ext === "json") {
        try { setContent(JSON.stringify(JSON.parse(t), null, 2)); return; } catch { /* fall through */ }
      }
      setContent(t);
    }
    return () => { cancelled = true; };
  }, [asset.url, asset.name]);

  return (
    <div style= {{
    width: "100%", height: "100%", display: "flex", flexDirection: "column",
      background: "var(--bg-0)",
    }
}>
  { loading && <div style={ { padding: 12, color: "var(--muted)", fontSize: 12 } }> Loading…</div>}
{ error && <div style={ { padding: 12, color: "var(--danger)", fontSize: 12 } }> { error } </div> }
{
  !loading && !error && (
    <>
    { truncated && (
      <div style={
        {
          padding: "6px 12px", background: "rgba(255,198,42,0.10)",
            borderBottom: "1px solid var(--line)", color: "var(--gold)", fontSize: 11,
            }
  }>
    Preview truncated at { MAX_BYTES / 1024 } KB — open externally to see the rest.
            </div>
          )
}
<pre style={
  {
    flex: 1, overflow: "auto", margin: 0,
      padding: "12px 14px",
        font: '12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace',
          color: "var(--text)", background: "var(--bg-0)",
            whiteSpace: "pre", tabSize: 2,
          }
}> { content } </pre>
  </>
      )}
</div>
  );
}
