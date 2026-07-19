/**
 * ViewerWindow.tsx
 *
 * Full-featured pop-out asset viewer.  Receives its asset via the
 * viewer:getAsset IPC call (token carried in location.hash).
 *
 * • 3-D assets  → Three.js viewport (SceneEngine) + right controls panel
 *   - Scene: wireframe, grid, HDRI, shadows, background colour
 *   - Animations: per-clip play/pause + global speed control
 *   - Stats: tris, verts, bones, format
 *   - Actions: Open in Forge, Convert to GLB/glTF, Screenshot, Download
 *
 * • image/video/audio/text/font → full-screen with header toolbar only
 */

import React, {
    useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import * as THREE from "three";
import { toast } from "sonner";
import { SceneEngine } from "./lib/forge/sceneEngine";
import { loadModel, isSupported } from "./lib/forge/loaders";
import {
    classify, basename, formatBytes,
    type AssetRef, type AssetKind,
} from "./components/viewers/types";
import ImageViewer from "./components/viewers/ImageViewer";
import VideoViewer from "./components/viewers/VideoViewer";
import AudioViewer from "./components/viewers/AudioViewer";
import TextViewer from "./components/viewers/TextViewer";
import FontViewer from "./components/viewers/FontViewer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const G = () => (window as any).grudge;

function KindBadge({ kind }: { kind: AssetKind }) {
    const colours: Record<AssetKind, string> = {
        model3d: "#ffc62a", image: "#46d586", video: "#7c6bff", audio: "#ff9f1c",
        text: "#88aaff", pdf: "#ff5577", font: "#dd88ff", unknown: "#9aa6c8",
    };
    return (
        <span style= {{
        display: "inline-block", padding: "1px 7px", borderRadius: 999,
            fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
                background: "rgba(0,0,0,0.35)", border: `1px solid ${colours[kind]}`,
                    color: colours[kind], textTransform: "uppercase",
    }
}> { kind } </span>
  );
}

// ---------------------------------------------------------------------------
// Header toolbar
// ---------------------------------------------------------------------------

function ViewerHeader({
    asset, kind,
}: {
    asset: AssetRef; kind: AssetKind;
}) {
    const fname = useMemo(() => basename(asset.name), [asset.name]);

    function download() {
        const a = document.createElement("a");
        a.href = asset.url; a.download = fname;
        a.click();
    }
    function copyUrl() {
        navigator.clipboard.writeText(asset.url)
            .then(() => toast.success("URL copied"))
            .catch(() => toast.error("Copy failed"));
    }
    function openExternal() {
        G()?.os?.openExternal?.(asset.url);
    }
    function closeWindow() { window.close(); }

    return (
        <div style= {{
        flexShrink: 0, display: "flex", alignItems: "center", gap: 10,
            padding: "0 14px", height: 46,
                background: "var(--bg-1)", borderBottom: "1px solid var(--line)",
                    overflow: "hidden",
    }
}>
    {/* Left — filename + badges */ }
    < div style = {{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
        <span style={
    {
        fontWeight: 700, fontSize: 14, color: "var(--text)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }
}> { fname } </span>
    < KindBadge kind = { kind } />
    {
        asset.size > 0 && (
            <span style={ { color: "var(--muted)", fontSize: 11, flexShrink: 0 } }>
                { formatBytes(asset.size) }
                </span>
        )}
</div>
{/* Right — action buttons */ }
<div style={ { display: "flex", gap: 6, alignItems: "center", flexShrink: 0 } }>
    <HBtn title="Download" onClick = { download } >↓ Download </HBtn>
        < HBtn title = "Copy CDN URL" onClick = { copyUrl } >⧉ URL </HBtn>
            < HBtn title = "Open in browser" onClick = { openExternal } >↗ External </HBtn>
                < HBtn
title = "Close viewer"
onClick = { closeWindow }
style = {{ background: "transparent", color: "var(--danger)", border: "1px solid var(--danger)" }}
        >✕</HBtn>
    </div>
    </div>
  );
}

function HBtn({
    children, title, onClick, style: extraStyle = {},
}: React.PropsWithChildren<{ title: string; onClick: () => void; style?: React.CSSProperties }>) {
    const [hover, setHover] = useState(false);
    return (
        <button
      title= { title }
    onClick = { onClick }
    onMouseEnter = {() => setHover(true)
}
onMouseLeave = {() => setHover(false)}
style = {{
    background: hover ? "var(--bg-2)" : "transparent",
        color: "var(--muted)", border: "1px solid var(--line)",
            borderRadius: 5, padding: "3px 10px", fontSize: 11,
                cursor: "pointer", fontFamily: "inherit", transition: "background 0.12s",
        ...extraStyle,
      }}
    > { children } </button>
  );
}

// ---------------------------------------------------------------------------
// Toggle widget reused in the controls panel
// ---------------------------------------------------------------------------

function Toggle({
    label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <label style= {{
        display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
            padding: "3px 0", userSelect: "none",
    }
}>
    <div
        onClick={ () => onChange(!checked) }
style = {{
    width: 34, height: 18, borderRadius: 9,
        background: checked ? "var(--gold)" : "var(--bg-2)",
            border: "1px solid var(--line)", position: "relative",
                transition: "background 0.15s", flexShrink: 0, cursor: "pointer",
        }}
      >
    <div style={
    {
        position: "absolute", top: 2, left: checked ? 16 : 2,
            width: 12, height: 12, borderRadius: "50%",
                background: checked ? "#1a1300" : "var(--muted)",
                    transition: "left 0.15s",
        }
} />
    </div>
    < span style = {{ fontSize: 12, color: checked ? "var(--text)" : "var(--muted)" }}>
        { label }
        </span>
        </label>
  );
}

// ---------------------------------------------------------------------------
// Controls panel section header
// ---------------------------------------------------------------------------

function Section({ title, children }: React.PropsWithChildren<{ title: string }>) {
    return (
        <div style= {{ borderBottom: "1px solid var(--line)", paddingBottom: 10, marginBottom: 10 }
}>
    <div style={
    {
        fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
            color: "var(--gold)", textTransform: "uppercase", marginBottom: 8,
      }
}> { title } </div>
{ children }
</div>
  );
}

// ---------------------------------------------------------------------------
// 3-D viewer + controls panel
// ---------------------------------------------------------------------------

interface ModelStats {
    triangles: number; vertices: number; bones: number;
    animations: number; format: string;
}

function Model3DViewerFull({ asset }: { asset: AssetRef }) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const engineRef = useRef<SceneEngine | null>(null);
    const objectRef = useRef<THREE.Object3D | null>(null);
    const mixerRef = useRef<THREE.AnimationMixer | null>(null);
    const actionsRef = useRef<THREE.AnimationAction[]>([]);
    const clipsRef = useRef<THREE.AnimationClip[]>([]);
    const envMapRef = useRef<THREE.Texture | null>(null); // saved HDRI ref

    const [stats, setStats] = useState<ModelStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Scene controls state
    const [wireframe, setWireframe] = useState(false);
    const [grid, setGrid] = useState(true);
    const [hdri, setHdri] = useState(true);
    const [shadows, setShadows] = useState(true);
    const [bgColour, setBgColour] = useState("#0a0e1a");

    // Animation state  [index] → playing
    const [animPlaying, setAnimPlaying] = useState<boolean[]>([]);
    const [animSpeed, setAnimSpeed] = useState(1);
    const [allPlaying, setAllPlaying] = useState(false);

    // Converting state
    const [converting, setConverting] = useState(false);

    // ── Create SceneEngine once ──────────────────────────────────────────────
    useEffect(() => {
        if (!hostRef.current) return;
        const engine = new SceneEngine(hostRef.current, {
            background: 0x0a0e1a, showGrid: true, showAxes: false, hdri: true,
        });
        engineRef.current = engine;
        // Save env map reference so we can toggle it later.
        envMapRef.current = engine.scene.environment;
        return () => {
            engine.dispose();
            engineRef.current = null;
        };
    }, []);

    // ── Load model ────────────────────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false;
        setError(null); setLoading(true); setStats(null);
        setAnimPlaying([]); setAllPlaying(false); clipsRef.current = [];

        (async () => {
            try {
                if (!isSupported(asset.name)) throw new Error(`Unsupported format: ${asset.name}`);
                const res = await fetch(asset.url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const blob = await res.blob();
                if (cancelled) return;
                const fname = basename(asset.name);
                const file = new File([blob], fname, { type: blob.type });
                const loaded = await loadModel(file);
                if (cancelled || !engineRef.current) return;

                // Clear previous
                if (objectRef.current) {
                    engineRef.current.scene.remove(objectRef.current);
                    disposeTree(objectRef.current);
                }
                if (mixerRef.current) {
                    engineRef.current.removeMixer(mixerRef.current);
                    mixerRef.current = null;
                    actionsRef.current = [];
                }

                // Configure shadows
                loaded.object.traverse((n) => {
                    (n as THREE.Mesh).castShadow = true;
                    (n as THREE.Mesh).receiveShadow = true;
                });
                engineRef.current.scene.add(loaded.object);
                objectRef.current = loaded.object;
                engineRef.current.frame(loaded.object);

                // Animations
                if (loaded.animations.length > 0) {
                    const mixer = engineRef.current.buildMixer(loaded.object, loaded.animations);
                    if (mixer) {
                        mixerRef.current = mixer;
                        clipsRef.current = loaded.animations;
                        actionsRef.current = loaded.animations.map((c) => {
                            const action = mixer.clipAction(c);
                            action.play();
                            return action;
                        });
                        setAnimPlaying(loaded.animations.map(() => true));
                        setAllPlaying(true);
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

    // ── Scene control handlers ────────────────────────────────────────────────

    const handleWireframe = useCallback((enabled: boolean) => {
        setWireframe(enabled);
        if (!objectRef.current) return;
        objectRef.current.traverse((n) => {
            const mesh = n as THREE.Mesh;
            if (!mesh.isMesh) return;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((m) => {
                if (m && "wireframe" in m) (m as THREE.MeshStandardMaterial).wireframe = enabled;
            });
        });
    }, []);

    const handleGrid = useCallback((enabled: boolean) => {
        setGrid(enabled);
        engineRef.current?.setHelpers(enabled);
    }, []);

    const handleHdri = useCallback((enabled: boolean) => {
        setHdri(enabled);
        if (!engineRef.current) return;
        engineRef.current.scene.environment = enabled ? envMapRef.current : null;
    }, []);

    const handleShadows = useCallback((enabled: boolean) => {
        setShadows(enabled);
        if (!engineRef.current) return;
        engineRef.current.renderer.shadowMap.enabled = enabled;
        // Force all materials to update their shadow state
        engineRef.current.scene.traverse((n) => {
            const mesh = n as THREE.Mesh;
            if (mesh.isMesh) {
                const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                mats.forEach((m) => { if (m) m.needsUpdate = true; });
            }
        });
    }, []);

    const handleBg = useCallback((hex: string) => {
        setBgColour(hex);
        if (!engineRef.current) return;
        engineRef.current.scene.background = new THREE.Color(hex);
    }, []);

    // ── Animation handlers ────────────────────────────────────────────────────

    const handleToggleClip = useCallback((idx: number) => {
        const action = actionsRef.current[idx];
        if (!action) return;
        const nowPlaying = !animPlaying[idx];
        if (nowPlaying) {
            action.paused = false;
            if (action.time >= action.getClip().duration) action.time = 0;
        } else {
            action.paused = true;
        }
        setAnimPlaying((prev) => {
            const copy = [...prev]; copy[idx] = nowPlaying; return copy;
        });
    }, [animPlaying]);

    const handlePlayAll = useCallback(() => {
        actionsRef.current.forEach((a) => { a.paused = false; if (a.time >= a.getClip().duration) a.time = 0; });
        setAnimPlaying(actionsRef.current.map(() => true));
        setAllPlaying(true);
    }, []);

    const handleStopAll = useCallback(() => {
        actionsRef.current.forEach((a) => { a.paused = true; });
        setAnimPlaying(actionsRef.current.map(() => false));
        setAllPlaying(false);
    }, []);

    const handleSpeed = useCallback((speed: number) => {
        setAnimSpeed(speed);
        if (mixerRef.current) mixerRef.current.timeScale = speed;
    }, []);

    // ── Action handlers ───────────────────────────────────────────────────────

    async function sendToForge() {
        const result = await G()?.viewer?.sendToForge({ url: asset.url, name: asset.name });
        if (result?.ok) toast.success("Sent to Forge3D editor");
        else toast.error(result?.error ?? "Failed to send to Forge");
    }

    async function convertAndSave(targetFormat: "glb" | "gltf") {
        setConverting(true);
        try {
            const r = await G()?.viewer?.convertModel({ url: asset.url, name: asset.name, targetFormat });
            if (!r?.ok) { toast.error(r?.error ?? "Conversion failed"); return; }
            const s = await G()?.viewer?.saveConvertedFile({ path: r.path, defaultName: r.name });
            if (s?.ok) toast.success(`Saved as ${s.savedPath.split(/[\\/]/).pop()}`);
            else if (!s?.canceled) toast.error(s?.error ?? "Save failed");
        } catch (e: any) {
            toast.error(e?.message ?? "Conversion error");
        } finally {
            setConverting(false);
        }
    }

    function screenshot() {
        const dataUrl = engineRef.current?.screenshot();
        if (!dataUrl) return;
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `${basename(asset.name).replace(/\.[^.]+$/, "")}-screenshot.png`;
        a.click();
        toast.success("Screenshot saved");
    }

    function resetCamera() {
        if (objectRef.current) engineRef.current?.frame(objectRef.current);
    }

    // ── Render ────────────────────────────────────────────────────────────────

    const PANEL_WIDTH = 264;

    return (
        <div style= {{ flex: 1, display: "flex", overflow: "hidden" }
}>
    {/* 3-D viewport */ }
    < div ref = { hostRef } style = {{ flex: 1, position: "relative", overflow: "hidden" }}>
        { loading && (
            <div style={
    {
        position: "absolute", top: 12, left: 12, zIndex: 10,
            background: "rgba(15,21,48,0.9)", border: "1px solid var(--line)",
                padding: "6px 12px", borderRadius: 6, fontSize: 12, color: "var(--gold)",
          }
}> Loading model…</div>
        )}
{
    error && (
        <div style={
        {
            position: "absolute", inset: 0, zIndex: 10, display: "flex",
                alignItems: "center", justifyContent: "center",
                    flexDirection: "column", gap: 8,
          }
    }>
        <span style={ { color: "var(--danger)", fontSize: 14 } }>⚠ Load error </span>
            < span style = {{ color: "var(--muted)", fontSize: 12, maxWidth: 420, textAlign: "center" }
}> { error } </span>
    </div>
        )}
{/* Viewport overlay: orbit hint */ }
{
    !loading && !error && (
        <div style={
        {
            position: "absolute", bottom: 8, left: 8, zIndex: 10,
                fontSize: 10, color: "var(--muted)", pointerEvents: "none",
          }
    }>
        Orbit: left drag · Pan: right drag · Zoom: scroll
            </div>
        )
}
</div>

{/* Controls panel */ }
<div style={
    {
        width: PANEL_WIDTH, flexShrink: 0,
            background: "var(--bg-1)", borderLeft: "1px solid var(--line)",
                overflowY: "auto", padding: "14px 14px",
                    display: "flex", flexDirection: "column", gap: 0,
      }
}>
    {/* Scene controls */ }
    < Section title = "Scene" >
        <Toggle label="Wireframe" checked = { wireframe } onChange = { handleWireframe } />
            <Toggle label="Grid"      checked = { grid }      onChange = { handleGrid } />
                <Toggle label="HDRI lighting" checked = { hdri }  onChange = { handleHdri } />
                    <Toggle label="Shadows"   checked = { shadows }   onChange = { handleShadows } />
                        <div style={ { marginTop: 6, display: "flex", alignItems: "center", gap: 8 } }>
                            <span style={ { fontSize: 12, color: "var(--muted)" } }> Background </span>
                                < input
type = "color" value = { bgColour }
onChange = {(e) => handleBg(e.target.value)}
style = {{
    width: 36, height: 22, padding: 1, border: "1px solid var(--line)",
        borderRadius: 4, background: "var(--bg-2)", cursor: "pointer",
              }}
            />
    </div>
    < button onClick = { resetCamera } style = {{
    marginTop: 8, width: "100%", padding: "4px 0",
        background: "var(--bg-2)", border: "1px solid var(--line)",
            borderRadius: 5, color: "var(--muted)", fontSize: 11, cursor: "pointer",
          }}>⊕ Reset Camera </button>
    </Section>

{/* Stats */ }
{
    stats && (
        <Section title="Stats" >
            <table style={ { width: "100%", fontSize: 11, borderCollapse: "collapse" } }>
                <tbody>
                <StatRow label="Format"  value = { stats.format.toUpperCase() } />
                    <StatRow label="Triangles" value = { stats.triangles.toLocaleString() } />
                        <StatRow label="Vertices"  value = { stats.vertices.toLocaleString() } />
                            { stats.bones > 0 && <StatRow label="Bones"  value = { String(stats.bones) } />}
    { stats.animations > 0 && <StatRow label="Animations" value = { String(stats.animations) } />}
    </tbody>
        </table>
        </Section>
        )
}

{/* Animations */ }
{
    clipsRef.current.length > 0 && (
        <Section title={ `Animations (${clipsRef.current.length})` }>
            {/* Global controls */ }
            < div style = {{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }
}>
    <button onClick={ handlePlayAll } style = { pillBtn("var(--ok)") } >▶ All </button>
        < button onClick = { handleStopAll } style = { pillBtn("var(--danger)") } >■ Stop </button>
            < select
value = { animSpeed }
onChange = {(e) => handleSpeed(Number(e.target.value))}
style = {{
    fontSize: 11, padding: "1px 4px", background: "var(--bg-2)",
        border: "1px solid var(--line)", borderRadius: 4,
            color: "var(--text)", cursor: "pointer",
                }}
              >
{
    [0.25, 0.5, 1, 1.5, 2].map((s) => (
        <option key= { s } value = { s } > { s }×</option>
    ))
}
    </select>
    </div>
{/* Per-clip list */ }
<div style={ { display: "flex", flexDirection: "column", gap: 4 } }>
{
    clipsRef.current.map((clip, i) => (
        <div key= { i } style = {{
        display: "flex", alignItems: "center", gap: 6,
        background: "var(--bg-2)", border: "1px solid var(--line)",
        borderRadius: 5, padding: "4px 8px",
    }} >
    <button
                    onClick={ () => handleToggleClip(i) }
title = { animPlaying[i]? "Pause" : "Play"}
style = {{
    flexShrink: 0, width: 20, height: 20,
        background: animPlaying[i] ? "var(--gold)" : "var(--bg-1)",
            border: `1px solid ${animPlaying[i] ? "var(--gold)" : "var(--line)"}`,
                borderRadius: 4, color: animPlaying[i] ? "#1a1300" : "var(--muted)",
                    cursor: "pointer", fontSize: 9, display: "flex",
                        alignItems: "center", justifyContent: "center",
                    }}
                  > { animPlaying[i]? "▐▐" : "▶"} </button>
    < span style = {{
    fontSize: 11, color: "var(--text)", overflow: "hidden",
        textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
                  }} title = { clip.name } > { clip.name || `Clip ${i}` } </span>
    < span style = {{ fontSize: 10, color: "var(--muted)", flexShrink: 0 }}>
        { clip.duration.toFixed(1) }s
            </span>
            </div>
              ))}
</div>
    </Section>
        )}

{/* Actions */ }
<Section title="Actions" >
    <ActionBtn onClick={ sendToForge } icon = "⚔" label = "Open in Forge Editor" color = "var(--gold)" />
        <ActionBtn
            onClick={ () => convertAndSave("glb") }
disabled = { converting }
icon = "⇄" label = { converting? "Converting…": "Convert → GLB" }
color = "var(--ok)"
    />
    <ActionBtn
            onClick={ () => convertAndSave("gltf") }
disabled = { converting }
icon = "⇄" label = { converting? "Converting…": "Convert → glTF" }
color = "var(--ok)"
    />
    <ActionBtn onClick={ screenshot } icon = "📷" label = "Screenshot (PNG)" color = "var(--muted)" />
        </Section>
        </div>
        </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
    return (
        <tr>
        <td style= {{ color: "var(--muted)", paddingRight: 8, padding: "2px 8px 2px 0" }
}> { label } </td>
    < td style = {{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}> { value } </td>
        </tr>
  );
}

function pillBtn(colour: string): React.CSSProperties {
    return {
        padding: "2px 8px", fontSize: 11, borderRadius: 4, cursor: "pointer",
        background: `${colour}22`, border: `1px solid ${colour}`, color: colour, fontFamily: "inherit",
    };
}

function ActionBtn({
    onClick, icon, label, color, disabled = false,
}: { onClick: () => void; icon: string; label: string; color: string; disabled?: boolean }) {
    return (
        <button
      onClick= { onClick }
    disabled = { disabled }
    style = {{
        width: "100%", padding: "6px 10px", marginBottom: 6,
            display: "flex", alignItems: "center", gap: 8,
                background: disabled ? "var(--bg-2)" : `${color}18`,
                    border: `1px solid ${disabled ? "var(--line)" : color}`,
                        borderRadius: 6, cursor: disabled ? "default" : "pointer",
                            color: disabled ? "var(--muted)" : color,
                                fontSize: 12, fontFamily: "inherit",
                                    opacity: disabled ? 0.6 : 1,
      }
}
    >
    <span style={ { fontSize: 14 } }> { icon } </span>
        < span > { label } </span>
        </button>
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

// ---------------------------------------------------------------------------
// Non-3-D viewer (image / video / audio / text / font)
// ---------------------------------------------------------------------------

function FlatViewer({ asset, kind }: { asset: AssetRef; kind: AssetKind }) {
    const wrapStyle: React.CSSProperties = {
        flex: 1, overflow: "hidden", display: "flex", flexDirection: "column",
        background: "var(--bg-0)",
    };
    switch (kind) {
        case "image": return <div style={ wrapStyle }> <ImageViewer asset={ asset } /></div >;
        case "video": return <div style={ wrapStyle }> <VideoViewer asset={ asset } /></div >;
        case "audio": return <div style={ wrapStyle }> <AudioViewer asset={ asset } /></div >;
        case "text": return <div style={ wrapStyle }> <TextViewer  asset={ asset } /></div >;
        case "font": return <div style={ wrapStyle }> <FontViewer  asset={ asset } /></div >;
        default:
            return (
                <div style= {{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                    flexDirection: "column", gap: 10, color: "var(--muted)",
        }
    }>
        <span style={ { fontSize: 40 } }>📄</span>
            < span > No preview available for this file type.</span>
                < a href = { asset.url } download = { basename(asset.name) } style = {{ color: "var(--gold)" }
}>
    Download { basename(asset.name) }
</a>
    </div>
      );
  }
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export default function ViewerWindow() {
    const [asset, setAsset] = useState<AssetRef | null>(null);
    const [notFound, setNotFound] = useState(false);

    useEffect(() => {
        const token = location.hash.replace(/^#/, "");
        if (!token) { setNotFound(true); return; }
        const grudge = (window as any).grudge;
        if (!grudge?.viewer?.getAsset) { setNotFound(true); return; }
        grudge.viewer.getAsset(token).then((a: AssetRef | null) => {
            if (a) {
                setAsset(a);
                document.title = `${basename(a.name)} — Grudge Asset Viewer`;
            } else {
                setNotFound(true);
            }
        });
    }, []);

    if (notFound) {
        return (
            <div style= {{
            height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
                background: "var(--bg-0)", color: "var(--danger)", flexDirection: "column", gap: 10,
      }
    }>
        <span style={ { fontSize: 32 } }>⚠</span>
            < span > Asset not found.This window may have been opened from a stale session.</span>
                </div>
    );
}

if (!asset) {
    return (
        <div style= {{
        height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--bg-0)", color: "var(--gold)",
      }
}> Loading asset…</div>
    );
  }

const kind = classify(asset);

return (
    <div style= {{
    display: "flex", flexDirection: "column", height: "100vh",
        background: "var(--bg-0)", color: "var(--text)", overflow: "hidden",
    }}>
    <ViewerHeader asset={ asset } kind = { kind } />
        { kind === "model3d"
        ? <Model3DViewerFull asset={ asset } />
        : <FlatViewer asset={ asset } kind = { kind } />}
</div>
  );
}
