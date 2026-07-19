import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { SceneEngine } from "../../lib/forge/sceneEngine";
import { loadModel, isSupported } from "../../lib/forge/loaders";
import type { AssetRef } from "./types";

interface Stats { triangles: number; vertices: number; bones: number; animations: number; format: string }

/** Mini 3D preview — same engine the Forge page uses, but no gizmos, no
 *  inspector. Fetches the asset as a Blob → wraps as File → loadModel. */
export default function Model3DViewer({ asset }: { asset: AssetRef }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SceneEngine | null>(null);
  const objectRef = useRef<THREE.Object3D | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [playing, setPlaying] = useState(false);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<THREE.AnimationAction[]>([]);

  useEffect(() => {
    if (!hostRef.current) return;
    const engine = new SceneEngine(hostRef.current, {
      background: 0x0a0e1a, showGrid: true, showAxes: false, hdri: true,
    });
    engineRef.current = engine;
    return () => { engine.dispose(); engineRef.current = null; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null); setLoading(true); setStats(null);
    (async () => {
      try {
        if (!isSupported(asset.name)) throw new Error(`Unsupported 3D format: ${asset.name}`);
        const res = await fetch(asset.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        const file = new File([blob], asset.name.split("/").pop() ?? asset.name, { type: blob.type });
        const loaded = await loadModel(file);
        if (cancelled || !engineRef.current) return;

        // Clear any previous model from the scene before adding the new one.
        if (objectRef.current) {
          engineRef.current.scene.remove(objectRef.current);
          disposeTree(objectRef.current);
        }
        if (mixerRef.current) {
          engineRef.current.removeMixer(mixerRef.current);
          mixerRef.current = null;
          actionsRef.current = [];
        }

        loaded.object.traverse((n) => {
          (n as THREE.Mesh).castShadow = true;
          (n as THREE.Mesh).receiveShadow = true;
        });
        engineRef.current.scene.add(loaded.object);
        objectRef.current = loaded.object;
        engineRef.current.frame(loaded.object);

        if (loaded.animations.length > 0) {
          const mixer = engineRef.current.buildMixer(loaded.object, loaded.animations);
          if (mixer) {
            mixerRef.current = mixer;
            actionsRef.current = loaded.animations.map((c) => mixer.clipAction(c));
            actionsRef.current.forEach((a) => a.play());
            setPlaying(true);
          }
        }

        setStats({
          triangles: loaded.triangles,
          vertices: loaded.vertices,
          bones: loaded.bones,
          animations: loaded.animations.length,
          format: loaded.format,
        });
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [asset.url]);

  function toggleAnim() {
    const next = !playing;
    actionsRef.current.forEach((a) => { a.paused = !next; });
    setPlaying(next);
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#000" }}>
      <div ref={hostRef} style={{ width: "100%", height: "100%" }} />
      {loading && (
        <div style={{
          position: "absolute", top: 12, left: 12,
          background: "rgba(15,21,48,0.85)", border: "1px solid var(--line)",
          padding: "6px 10px", borderRadius: 6, fontSize: 12, color: "var(--gold)",
        }}>Loading model…</div>
      )}
      {error && (
        <div style={{
          position: "absolute", inset: 12, display: "flex", alignItems: "center",
          justifyContent: "center", color: "var(--danger)", fontSize: 12,
        }}>{error}</div>
      )}
      {stats && (
        <div style={{
          position: "absolute", bottom: 8, left: 8,
          background: "rgba(15,21,48,0.85)", border: "1px solid var(--line)",
          borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "var(--muted)",
          display: "flex", gap: 10, alignItems: "center",
        }}>
          <span style={{ color: "var(--gold)" }}>{stats.format.toUpperCase()}</span>
          <span>{stats.triangles.toLocaleString()} tris</span>
          <span>{stats.vertices.toLocaleString()} verts</span>
          {stats.bones > 0 && <span>{stats.bones} bones</span>}
          {stats.animations > 0 && (
            <button onClick={toggleAnim} className="text-gold hover:underline">
              {playing ? "Pause" : "Play"} ({stats.animations})
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((node) => {
    const m = node as THREE.Mesh;
    if (m.isMesh) {
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
      else mat?.dispose();
    }
  });
}
