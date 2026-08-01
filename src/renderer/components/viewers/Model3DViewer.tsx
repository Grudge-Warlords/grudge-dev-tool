import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { SceneEngine } from "../../lib/forge/sceneEngine";
import { loadModelFromUrl, isSupported } from "../../lib/forge/loaders";
import type { AssetRef } from "./types";

interface Stats {
  triangles: number;
  vertices: number;
  bones: number;
  animations: number;
  format: string;
  materialsFixed?: number;
  missingMaps?: number;
}

/** Mini 3D preview — magic-byte gate + material sanitize (anti yellow/black). */
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
    // Slightly brighter ambient so dark metalness doesn't look pure black
    engine.studioLights.ambient.intensity = 0.28;
    engine.renderer.toneMappingExposure = 1.05;
    engineRef.current = engine;
    return () => { engine.dispose(); engineRef.current = null; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null); setLoading(true); setStats(null);
    (async () => {
      try {
        if (!isSupported(asset.name)) throw new Error(`Unsupported 3D format: ${asset.name}`);
        const loaded = await loadModelFromUrl(asset.url, asset.name.split("/").pop() ?? asset.name);
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

        // Mixer + first clip only (playing all clips at once looks broken)
        const skinned = loaded.bones > 0;
        if (skinned || loaded.animations.length > 0) {
          const { attachAnimationMixer, setPrimaryAction } = await import(
            "../../lib/forge/forgeAnimation"
          );
          const handle = attachAnimationMixer(loaded.object, loaded.animations, {
            dropRootMotion: true,
          });
          engineRef.current.mixers.push(handle.mixer);
          mixerRef.current = handle.mixer;
          actionsRef.current = handle.clips.map((c) => handle.mixer.clipAction(c));
          if (handle.clips.length) {
            setPrimaryAction(handle.mixer, handle.clips[0], "repeat");
            setPlaying(true);
          }
          // Skeleton helper is debug chrome — off by default in production viewer
          engineRef.current.setSkeletonHelper(loaded.object, false);
        }
        // Skinned meshes need matrix updates for correct texture/mesh pose
        loaded.object.traverse((n) => {
          const sm = n as THREE.SkinnedMesh;
          if (sm.isSkinnedMesh) {
            sm.frustumCulled = false;
            sm.matrixWorldNeedsUpdate = true;
          }
        });

        const missingMaps =
          loaded.materials?.issues.filter((i) => i.code === "missing-map" && !i.fixed).length ?? 0;
        setStats({
          triangles: loaded.triangles,
          vertices: loaded.vertices,
          bones: loaded.bones,
          animations: loaded.animations.length,
          format: loaded.format,
          materialsFixed: loaded.materials?.fixed,
          missingMaps,
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
          {typeof stats.materialsFixed === "number" && stats.materialsFixed > 0 && (
            <span title="Material sanitize fixed yellow/black/colorSpace issues" style={{ color: "#7dffa0" }}>
              mats+{stats.materialsFixed}
            </span>
          )}
          {typeof stats.missingMaps === "number" && stats.missingMaps > 0 && (
            <span title="Meshes with no baseColor map — re-bake with atlas" style={{ color: "#ffb86c" }}>
              no-map×{stats.missingMaps}
            </span>
          )}
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
