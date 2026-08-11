import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AssetRef } from "./types";
import { basename, formatBytes } from "./types";

/**
 * Elite HTML5 audio player for Local Files / double-click / View Mode.
 *
 * Playback always uses <audio src> (supports grudge-media:// streams).
 * Waveform decode is best-effort and skipped for streams / large files so
 * game SFX packs and long tracks never force a full RAM load.
 */
const WAVEFORM_MAX_BYTES = 24 * 1024 * 1024;

export default function AudioViewer({ asset }: { asset: AssetRef }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bufRef = useRef<AudioBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waveNote, setWaveNote] = useState<string | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [meta, setMeta] = useState<{ duration: number; channels: number; rate: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loop, setLoop] = useState(false);
  const [rate, setRate] = useState(1);

  const skipWaveform =
    asset.stream === true ||
    /^grudge-media:/i.test(asset.url || "") ||
    (asset.size > 0 && asset.size > WAVEFORM_MAX_BYTES);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setWaveNote(null);
    setMeta(null);
    bufRef.current = null;
    setPlaying(false);
    setCurrent(0);
    setDuration(0);

    if (skipWaveform) {
      setDecoding(false);
      setWaveNote(
        asset.stream || /^grudge-media:/i.test(asset.url || "")
          ? "Streaming — waveform skipped (playback OK)"
          : `Large file (${formatBytes(asset.size)}) — waveform skipped`,
      );
      return () => {
        cancelled = true;
      };
    }

    setDecoding(true);
    (async () => {
      try {
        const res = await fetch(asset.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        if (buf.byteLength > WAVEFORM_MAX_BYTES) {
          setWaveNote("File too large for waveform — use transport below");
          return;
        }
        const Ctor = (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
        const ctx = new Ctor();
        const decoded = await ctx.decodeAudioData(buf.slice(0));
        if (cancelled) return;
        setMeta({
          duration: decoded.duration,
          channels: decoded.numberOfChannels,
          rate: decoded.sampleRate,
        });
        bufRef.current = decoded;
        drawWaveform(canvasRef.current, decoded);
        try {
          await ctx.close();
        } catch {
          /* no-op */
        }
      } catch (e: unknown) {
        // Waveform is optional — do not block native <audio> playback
        if (!cancelled) {
          setWaveNote(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setDecoding(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [asset.url, asset.size, asset.stream, skipWaveform]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      if (bufRef.current) drawWaveform(canvasRef.current, bufRef.current);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const a = audioRef.current;
    if (a) a.playbackRate = rate;
  }, [rate]);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      void a
        .play()
        .then(() => setPlaying(true))
        .catch((e: Error) => setError(e?.message || "Play failed"));
    } else {
      a.pause();
      setPlaying(false);
    }
  }, []);

  const seek = useCallback((t: number) => {
    const a = audioRef.current;
    if (!a || !Number.isFinite(t)) return;
    a.currentTime = Math.max(0, Math.min(t, a.duration || t));
    setCurrent(a.currentTime);
  }, []);

  const fmt = (s: number) => {
    if (!Number.isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const mime =
    asset.contentType?.startsWith("audio/")
      ? asset.contentType
      : /\.wav$/i.test(asset.name)
        ? "audio/wav"
        : /\.ogg$/i.test(asset.name)
          ? "audio/ogg"
          : /\.flac$/i.test(asset.name)
            ? "audio/flac"
            : /\.m4a$/i.test(asset.name)
              ? "audio/mp4"
              : "audio/mpeg";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "center",
        gap: 12,
        padding: 20,
        background: "var(--bg-0)",
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text, #e7ecff)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
          title={asset.localPath || asset.name}
        >
          {basename(asset.name)}
        </span>
        {asset.size > 0 && (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{formatBytes(asset.size)}</span>
        )}
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "#ff9f1c",
            border: "1px solid #ff9f1c",
            borderRadius: 999,
            padding: "1px 8px",
          }}
        >
          AUDIO
        </span>
        {asset.stream && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--gold, #ffc62a)",
              border: "1px solid var(--gold, #ffc62a)",
              borderRadius: 999,
              padding: "1px 8px",
            }}
          >
            STREAM
          </span>
        )}
      </div>

      <div
        style={{
          position: "relative",
          height: 140,
          background: "var(--bg-1)",
          border: "1px solid var(--line)",
          borderRadius: 8,
          flexShrink: 0,
        }}
      >
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
        {decoding && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--muted)",
              fontSize: 12,
            }}
          >
            decoding waveform…
          </div>
        )}
        {waveNote && !decoding && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--muted)",
              fontSize: 12,
              padding: 12,
              textAlign: "center",
            }}
          >
            {waveNote}
          </div>
        )}
      </div>

      {/* Hidden native element — stream src; chrome below mirrors VideoViewer */}
      <audio
        ref={audioRef}
        key={asset.url}
        preload="metadata"
        loop={loop}
        onLoadedMetadata={() => {
          const a = audioRef.current;
          if (a && Number.isFinite(a.duration)) {
            setDuration(a.duration);
            if (!meta) {
              setMeta({
                duration: a.duration,
                channels: 0,
                rate: 0,
              });
            }
          }
        }}
        onTimeUpdate={() => setCurrent(audioRef.current?.currentTime ?? 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() =>
          setError("Could not play this audio. Try MP3 / WAV / OGG. Codec may be unsupported.")
        }
        style={{ display: "none" }}
      >
        <source src={asset.url} type={mime} />
      </audio>

      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.05}
        value={current}
        onChange={(e) => seek(Number(e.target.value))}
        style={{ width: "100%", accentColor: "#ffc62a" }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn"
          style={{ padding: "4px 12px", fontSize: 12 }}
          onClick={togglePlay}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          className="btn ghost"
          style={{ padding: "4px 10px", fontSize: 11 }}
          onClick={() => setLoop((l) => !l)}
        >
          Loop {loop ? "on" : "off"}
        </button>
        <label style={{ fontSize: 11, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
          Rate
          <select
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            style={{
              fontSize: 11,
              background: "var(--bg-1)",
              color: "var(--text)",
              border: "1px solid var(--line)",
              borderRadius: 4,
              padding: "2px 6px",
            }}
          >
            <option value={0.5}>0.5×</option>
            <option value={0.75}>0.75×</option>
            <option value={1}>1×</option>
            <option value={1.25}>1.25×</option>
            <option value={1.5}>1.5×</option>
            <option value={2}>2×</option>
          </select>
        </label>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "var(--muted)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {fmt(current)} / {fmt(duration || meta?.duration || 0)}
        </span>
      </div>

      {meta && (meta.channels > 0 || meta.rate > 0) && (
        <div
          style={{
            fontSize: 11,
            color: "var(--muted)",
            display: "flex",
            gap: 14,
            justifyContent: "center",
          }}
        >
          {meta.channels > 0 && <span>{meta.channels} ch</span>}
          {meta.rate > 0 && <span>{meta.rate.toLocaleString()} Hz</span>}
        </div>
      )}

      {error && (
        <div style={{ color: "var(--danger, #ff5577)", fontSize: 12, textAlign: "center" }}>{error}</div>
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
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);

  const data = buf.getChannelData(0);
  const samplesPerBar = Math.max(1, Math.floor(data.length / W));
  const mid = H / 2;
  ctx.strokeStyle = "#1c2a55";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(W, mid);
  ctx.stroke();

  ctx.fillStyle = "#ffc62a";
  for (let x = 0; x < W; x++) {
    let min = 1,
      max = -1;
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
