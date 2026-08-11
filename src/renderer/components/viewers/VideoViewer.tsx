import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AssetRef } from "./types";
import { basename, formatBytes } from "./types";

/**
 * Simple reliable HTML5 video viewer for Local Files / elite open / View Mode.
 * Prefers grudge-media:// stream URLs for large local files (no full RAM blob).
 * Chromium: MP4 (H.264), WebM, many MOV/M4V. Unsupported codecs show a clear error.
 */
export default function VideoViewer({ asset }: { asset: AssetRef }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(false);
  const [volume, setVolume] = useState(1);
  const [nativeControls, setNativeControls] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setError(null);
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setDims(null);
    setReady(false);
  }, [asset.url]);

  // Keyboard: Space play/pause, F fullscreen, M mute (when focused in pane)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const v = videoRef.current;
      if (!v) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (v.paused) void v.play().catch(() => undefined);
        else v.pause();
      } else if (e.key === "f" || e.key === "F") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void v.requestFullscreen?.();
      } else if (e.key === "m" || e.key === "M") {
        v.muted = !v.muted;
        setMuted(v.muted);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onLoaded = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (Number.isFinite(v.duration)) setDuration(v.duration);
    if (v.videoWidth > 0) setDims({ w: v.videoWidth, h: v.videoHeight });
    setReady(true);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v
        .play()
        .then(() => setPlaying(true))
        .catch((e: Error) => setError(e?.message || "Play failed — try native controls or MP4 H.264"));
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
          : /\.mkv$/i.test(asset.name)
            ? "video/x-matroska"
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
        onClick={(e) => {
          // Single click on empty chrome area: play/pause (not on controls)
          if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "VIDEO") {
            if (!nativeControls) togglePlay();
          }
        }}
      >
        <video
          ref={videoRef}
          key={asset.url}
          src={asset.url}
          controls={nativeControls}
          playsInline
          preload="metadata"
          loop={loop}
          muted={muted}
          onLoadedMetadata={onLoaded}
          onLoadedData={onLoaded}
          onTimeUpdate={() => setCurrent(videoRef.current?.currentTime ?? 0)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onVolumeChange={() => {
            const v = videoRef.current;
            if (!v) return;
            setVolume(v.volume);
            setMuted(v.muted);
          }}
          onError={() =>
            setError(
              "Could not play this video. Prefer MP4 (H.264/AAC) or WebM. MKV/AVI may need system open. Try “Native controls”.",
            )
          }
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            width: nativeControls ? "100%" : undefined,
            height: nativeControls ? "100%" : undefined,
            background: "#000",
            objectFit: "contain",
          }}
        >
          <source src={asset.url} type={mime} />
        </video>

        {!ready && !error && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--muted, #9aa6c8)",
              fontSize: 12,
              pointerEvents: "none",
            }}
          >
            Loading video…
          </div>
        )}

        {error && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              background: "rgba(0,0,0,0.8)",
              color: "#ff5577",
              padding: 24,
              textAlign: "center",
              fontSize: 13,
            }}
          >
            <div>{error}</div>
            <button
              type="button"
              className="btn"
              style={{ padding: "6px 14px", fontSize: 12 }}
              onClick={() => {
                setError(null);
                setNativeControls(true);
              }}
            >
              Retry with native controls
            </button>
            {asset.localPath && (
              <button
                type="button"
                className="btn ghost"
                style={{ padding: "6px 14px", fontSize: 12 }}
                onClick={() => void (window as any).grudge?.files?.openSystem?.(asset.localPath)}
              >
                System open
              </button>
            )}
          </div>
        )}
      </div>

      {/* Simple chrome */}
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
          {dims && (
            <span style={{ fontSize: 11, color: "var(--muted, #9aa6c8)" }}>
              {dims.w}×{dims.h}
            </span>
          )}
          {asset.size > 0 && (
            <span style={{ fontSize: 11, color: "var(--muted, #9aa6c8)" }}>{formatBytes(asset.size)}</span>
          )}
          {(asset.stream || /^grudge-media:/i.test(asset.url || "")) && (
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

        {!nativeControls && (
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.05}
            value={current}
            onChange={(e) => seek(Number(e.target.value))}
            style={{ width: "100%", accentColor: "#ffc62a" }}
          />
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {!nativeControls && (
            <>
              <button type="button" className="btn" style={{ padding: "4px 12px", fontSize: 12 }} onClick={togglePlay}>
                {playing ? "Pause" : "Play"}
              </button>
              <button
                type="button"
                className="btn ghost"
                style={{ padding: "4px 10px", fontSize: 11 }}
                onClick={() => {
                  const next = !muted;
                  setMuted(next);
                  if (videoRef.current) videoRef.current.muted = next;
                }}
              >
                {muted ? "Unmute" : "Mute"}
              </button>
              <label style={{ fontSize: 11, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
                Vol
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => {
                    const vol = Number(e.target.value);
                    setVolume(vol);
                    setMuted(vol === 0);
                    if (videoRef.current) {
                      videoRef.current.volume = vol;
                      videoRef.current.muted = vol === 0;
                    }
                  }}
                  style={{ width: 72, accentColor: "#ffc62a" }}
                />
              </label>
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
            </>
          )}
          <button
            type="button"
            className="btn ghost"
            style={{ padding: "4px 10px", fontSize: 11 }}
            onClick={() => setNativeControls((n) => !n)}
            title="Toggle Chromium native video controls"
          >
            {nativeControls ? "Custom controls" : "Native controls"}
          </button>
          <span
            style={{
              marginLeft: "auto",
              fontSize: 11,
              color: "var(--muted, #9aa6c8)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {fmt(current)} / {fmt(duration)}
            <span style={{ opacity: 0.6, marginLeft: 8 }}>Space · F · M</span>
          </span>
        </div>
      </div>
    </div>
  );
}
