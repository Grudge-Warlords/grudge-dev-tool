import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AssetRef } from "./types";
import { basename, formatBytes } from "./types";

/**
 * Elite HTML5 video player for double-click / Local Files / View Mode.
 * Chromium plays mp4 (H.264), webm, mov, m4v natively with hardware accel.
 * Local large files should use grudge-media:// stream URLs (not full-file blobs).
 */
export default function VideoViewer({ asset }: { asset: AssetRef }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(false);

  useEffect(() => {
    setError(null);
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
  }, [asset.url]);

  const onLoaded = useCallback(() => {
    const v = videoRef.current;
    if (v && Number.isFinite(v.duration)) setDuration(v.duration);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play().then(() => setPlaying(true)).catch((e) => setError(e?.message || "Play failed"));
    } else {
      v.pause();
      setPlaying(false);
    }
  }, []);

  const seek = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(t)) return;
    v.currentTime = Math.max(0, Math.min(t, v.duration || t));
    setCurrent(v.currentTime);
  }, []);

  const toggleFs = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void v.requestFullscreen?.();
  }, []);

  const fmt = (s: number) => {
    if (!Number.isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const mime =
    asset.contentType?.startsWith("video/")
      ? asset.contentType
      : /\.webm$/i.test(asset.name)
        ? "video/webm"
        : /\.mov$/i.test(asset.name)
          ? "video/quicktime"
          : "video/mp4";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#000",
        minHeight: 0,
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
        onDoubleClick={toggleFs}
      >
        <video
          ref={videoRef}
          key={asset.url}
          controls={false}
          playsInline
          preload="metadata"
          loop={loop}
          muted={muted}
          onLoadedMetadata={onLoaded}
          onTimeUpdate={() => setCurrent(videoRef.current?.currentTime ?? 0)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() =>
            setError(
              "Could not play this video. Try MP4 (H.264) or WebM. Codec may be unsupported.",
            )
          }
          style={{ maxWidth: "100%", maxHeight: "100%", background: "#000" }}
        >
          <source src={asset.url} type={mime} />
          Your browser does not support HTML5 video.
        </video>
        {error && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.75)",
              color: "#ff5577",
              padding: 24,
              textAlign: "center",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Elite chrome controls */}
      <div
        style={{
          flexShrink: 0,
          padding: "10px 14px 12px",
          background: "var(--bg-1, #0f1530)",
          borderTop: "1px solid var(--line, #1c2a55)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              fontSize: 12,
              color: "var(--text, #e7ecff)",
              fontWeight: 600,
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
            <span style={{ fontSize: 11, color: "var(--muted, #9aa6c8)" }}>
              {formatBytes(asset.size)}
            </span>
          )}
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#7c6bff",
              border: "1px solid #7c6bff",
              borderRadius: 999,
              padding: "1px 8px",
            }}
          >
            VIDEO
          </span>
        </div>

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
          <button type="button" className="btn" style={{ padding: "4px 12px", fontSize: 12 }} onClick={togglePlay}>
            {playing ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            className="btn ghost"
            style={{ padding: "4px 10px", fontSize: 11 }}
            onClick={() => {
              setMuted((m) => !m);
              if (videoRef.current) videoRef.current.muted = !muted;
            }}
          >
            {muted ? "Unmute" : "Mute"}
          </button>
          <button
            type="button"
            className="btn ghost"
            style={{ padding: "4px 10px", fontSize: 11 }}
            onClick={() => setLoop((l) => !l)}
          >
            Loop {loop ? "on" : "off"}
          </button>
          <button type="button" className="btn ghost" style={{ padding: "4px 10px", fontSize: 11 }} onClick={toggleFs}>
            Fullscreen
          </button>
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted, #9aa6c8)", fontVariantNumeric: "tabular-nums" }}>
            {fmt(current)} / {fmt(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}
