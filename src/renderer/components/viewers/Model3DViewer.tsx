import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { loadModelFromUrl, isSupported } from "../../lib/forge/loaders";
import { measureObjectSi } from "../../lib/forge/siMeasure";
import {
  getMultiCanvasHub,
  type MultiCanvasView,
} from "../../lib/forge/multiCanvasHub";
import type { AssetRef } from "./types";

interface Stats {
  triangles: number;
  vertices: number;
  bones: number;
  animations: number;
  format: string;
  materialsFixed?: number;
  missingMaps?: number;
  heightM?: number;
}

/**
 * Inline 3D preview using MultiCanvasHub (single WebGL → many canvases).
 * Pattern: three.js multi-canvas (webgpu_multiple_canvas / webgl_multiple_elements).
 * Avoids one WebGLRenderer per thumbnail (context loss / yellow sludge / black frames).
 */
export default function Model3DViewer({
  asset,
  onLocateInList,
}: {
  asset: AssetRef;
  /** Scroll the Local Files list to this viewport asset. */
  onLocateInList?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<MultiCanvasView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [playing, setPlaying] = useState(false);
  const actionsRef = useRef<THREE.AnimationAction[]>([]);

  // Create multi-canvas view once per mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const hub = getMultiCanvasHub();
    const view = hub.createView(canvas, {
      quality: "medium",
      background: 0x0a0e1a,
      showGrid: true,
      hdri: true,
    });
    viewRef.current = view;
    return () => {
      hub.disposeView(view);
      viewRef.current = null;
    };
  }, []);

  // Load / swap model when asset changes
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);
    setStats(null);
    actionsRef.current = [];
    setPlaying(false);

    (async () => {
      const view = viewRef.current;
      if (!view) return;
      try {
        if (!isSupported(asset.name)) {
          throw new Error(`Unsupported 3D format: ${asset.name}`);
        }
        const nameHint = asset.name.split("/").pop() ?? asset.name;
        const loaded = await loadModelFromUrl(asset.url, nameHint, {
          diskPath: asset.localPath || undefined,
          sanitize: { toonStyle: true, fixDefaultYellow: true, whiteWhenMapped: true },
        });
        if (cancelled || !viewRef.current) return;

        // Clear previous mixers
        for (const m of view.mixers) m.stopAllAction();
        view.mixers.length = 0;

        getMultiCanvasHub().setRoot(view, loaded.object);

        const skinned = loaded.bones > 0;
        if (skinned || loaded.animations.length > 0) {
          const { attachAnimationMixer, setPrimaryAction } = await import(
            "../../lib/forge/forgeAnimation"
          );
          const handle = attachAnimationMixer(loaded.object, loaded.animations, {
            dropRootMotion: true,
          });
          view.mixers.push(handle.mixer);
          actionsRef.current = handle.clips.map((c) => handle.mixer.clipAction(c));
          if (handle.clips.length) {
            setPrimaryAction(handle.mixer, handle.clips[0], "repeat");
            setPlaying(true);
          }
        }

        const missingMaps =
          loaded.materials?.issues.filter((i) => i.code === "missing-map" && !i.fixed).length ?? 0;
        const si = measureObjectSi(loaded.object);
        setStats({
          triangles: loaded.triangles,
          vertices: loaded.vertices,
          bones: loaded.bones,
          animations: loaded.animations.length,
          format: loaded.format,
          materialsFixed: loaded.materials?.fixed,
          missingMaps,
          heightM: si.h,
        });
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [asset.url, asset.localPath, asset.name]);

  function toggleAnim() {
    const next = !playing;
    actionsRef.current.forEach((a) => {
      a.paused = !next;
    });
    setPlaying(next);
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#0a0e1a" }}>
      {/* Display canvas — hub blits WebGL here (multi-canvas present) */}
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block", outline: "none" }}
      />
      {loading && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            background: "rgba(15,21,48,0.88)",
            border: "1px solid var(--line)",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 12,
            color: "var(--gold)",
          }}
        >
          Loading model…
        </div>
      )}
      {error && (
        <div
          style={{
            position: "absolute",
            inset: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--danger)",
            fontSize: 12,
            textAlign: "center",
            padding: 12,
          }}
        >
          {error}
        </div>
      )}
      {(onLocateInList || stats) && (
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: 8,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 6,
            zIndex: 2,
          }}
        >
      {onLocateInList && (
        <button
          type="button"
          onClick={onLocateInList}
          title="Scroll the left list to this viewport asset"
          style={{
            background: "rgba(15,21,48,0.92)",
            border: "1px solid var(--gold)",
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 11,
            color: "var(--gold)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Show in list
        </button>
      )}
      {stats && (
        <div
          style={{
            background: "rgba(15,21,48,0.88)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 11,
            color: "var(--muted)",
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={{ color: "var(--gold)" }}>{stats.format.toUpperCase()}</span>
          <span>{stats.triangles.toLocaleString()} tris</span>
          <span>{stats.vertices.toLocaleString()} verts</span>
          {stats.bones > 0 && <span>{stats.bones} bones</span>}
          {typeof stats.heightM === "number" && stats.heightM > 0 && (
            <span title="SI height">{stats.heightM.toFixed(2)} m</span>
          )}
          {typeof stats.materialsFixed === "number" && stats.materialsFixed > 0 && (
            <span title="Material sanitize fixed yellow/black/colorSpace" style={{ color: "#7dffa0" }}>
              mats+{stats.materialsFixed}
            </span>
          )}
          {typeof stats.missingMaps === "number" && stats.missingMaps > 0 && (
            <span title="No baseColor map — re-bake with atlas" style={{ color: "#ffb86c" }}>
              no-map×{stats.missingMaps}
            </span>
          )}
          {stats.animations > 0 && (
            <button type="button" onClick={toggleAnim} className="text-gold hover:underline">
              {playing ? "Pause" : "Play"} ({stats.animations})
            </button>
          )}
          <span title="Shared multi-canvas WebGL hub" style={{ opacity: 0.55, fontSize: 10 }}>
            multi-canvas
          </span>
        </div>
      )}
        </div>
      )}
    </div>
  );
}
