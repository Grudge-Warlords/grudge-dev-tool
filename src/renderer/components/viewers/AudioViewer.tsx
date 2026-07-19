import React, { useEffect, useRef, useState } from "react";
import type { AssetRef } from "./types";

/** Native HTML5 audio + a tiny canvas waveform drawn from the decoded buffer.
 *  Waveform is drawn ONCE at mount (cheap downsampled min/max bars), no live
 *  FFT, no realtime spectrum — keeps it under a millisecond per frame. */
export default function AudioViewer({ asset }: { asset: AssetRef }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bufRef = useRef<AudioBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decoding, setDecoding] = useState(true);
  const [meta, setMeta] = useState<{ duration: number; channels: number; rate: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDecoding(true); setError(null); setMeta(null);
    (async () => {
      try {
        const res = await fetch(asset.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
        const ctx = new Ctor();
        const decoded = await ctx.decodeAudioData(buf.slice(0));
        if (cancelled) return;
        setMeta({ duration: decoded.duration, channels: decoded.numberOfChannels, rate: decoded.sampleRate });
        bufRef.current = decoded;
        drawWaveform(canvasRef.current, decoded);
        try { await ctx.close(); } catch { /* no-op */ }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setDecoding(false);
      }
    })();
    return () => { cancelled = true; };
  }, [asset.url]);

  // Redraw waveform when the canvas is resized (e.g., window resize or panel resize).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      if (bufRef.current) drawWaveform(canvasRef.current, bufRef.current);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  return (
    <div style={{
      width: "100%", height: "100%",
      display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "center",
      gap: 14, padding: 24, background: "var(--bg-0)",
    }}>
      <div style={{ position: "relative", height: 160, background: "var(--bg-1)", border: "1px solid var(--line)", borderRadius: 8 }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
        {decoding && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center",
            justifyContent: "center", color: "var(--muted)", fontSize: 12,
          }}>decoding waveform…</div>
        )}
        {error && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center",
            justifyContent: "center", color: "var(--danger)", fontSize: 12,
          }}>{error}</div>
        )}
      </div>

      <audio
        ref={audioRef}
        src={asset.url}
        controls
        preload="metadata"
        style={{ width: "100%" }}
      />

      {meta && (
        <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", gap: 14, justifyContent: "center" }}>
          <span>{meta.duration.toFixed(2)}s</span>
          <span>{meta.channels} ch</span>
          <span>{meta.rate.toLocaleString()} Hz</span>
        </div>
      )}
    </div>
  );
}

/** Downsample channel 0 into min/max bars at canvas width — O(samples). */
function drawWaveform(canvas: HTMLCanvasElement | null, buf: AudioBuffer): void {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const W = Math.max(1, Math.floor(rect.width * dpr));
  const H = Math.max(1, Math.floor(rect.height * dpr));
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "transparent";
  ctx.clearRect(0, 0, W, H);

  const data = buf.getChannelData(0);
  const samplesPerBar = Math.max(1, Math.floor(data.length / W));
  const mid = H / 2;
  ctx.strokeStyle = "#1c2a55";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();

  ctx.fillStyle = "#ffc62a";
  for (let x = 0; x < W; x++) {
    let min = 1, max = -1;
    const start = x * samplesPerBar;
    const end = Math.min(data.length, start + samplesPerBar);
    for (let i = start; i < end; i++) {
      const v = data[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const y1 = mid + min * mid;
    const y2 = mid + max * mid;
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
}
