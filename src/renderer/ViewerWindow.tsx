/**
 * ViewerWindow.tsx
 *
 * Full-featured pop-out asset viewer.  Receives its asset via the
 * viewer:getAsset IPC call (token carried in location.hash).
 *
 * • 3-D assets  → Three.js viewport (SceneEngine) + right controls panel
 *   - Scene: wireframe, grid, HDRI, shadows, background colour
 *   - Animations: exclusive per-clip select (review) + speed; never stack multi-clip
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
import { SceneEngine, type StudioView } from "./lib/forge/sceneEngine";
import { loadModel, loadModelFromUrl, isSupported, localFileUrl } from "./lib/forge/loaders";
import {
    attachAnimationMixer,
    setPrimaryAction,
    stopMixer,
    type AnimLoopMode,
} from "./lib/forge/forgeAnimation";
import { formatSiMeters, type SiBounds } from "./lib/forge/siMeasure";
import AssetStudioInspector from "./components/viewers/AssetStudioInspector";
import {
    cloneViewerObject,
    findViewerItemId,
    newViewerItemId,
    nextPlaceX,
    readAuthorXform,
    stampViewerItem,
    type ViewerSceneItem,
} from "./lib/forge/viewerScene";
import {
    classify, basename, formatBytes,
    type AssetRef, type AssetKind,
} from "./components/viewers/types";
import { isPublicCdnUrl, forgeStudioAssetUrl, threeflowAssetUrl } from "../shared/editorHandoff";
import ImageViewer from "./components/viewers/ImageViewer";
import VideoViewer from "./components/viewers/VideoViewer";
import AudioViewer from "./components/viewers/AudioViewer";
import TextViewer from "./components/viewers/TextViewer";
import FontViewer from "./components/viewers/FontViewer";
import DesignViewer from "./components/viewers/DesignViewer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const G = () => (window as any).grudge;

function KindBadge({ kind }: { kind: AssetKind }) {
    const colours: Record<AssetKind, string> = {
        model3d: "#ffc62a", scene3d: "#ffc62a", image: "#46d586", video: "#7c6bff", audio: "#ff9f1c",
        text: "#88aaff", pdf: "#ff5577", font: "#dd88ff", design: "#c084fc", unknown: "#9aa6c8",
    };
    // info.grudge-studio.com chrome icons (never assets.*)
    const infoIcon: Partial<Record<AssetKind, string>> = {
        model3d: "https://info.grudge-studio.com/icons/pack/weapons/Sword_01.png",
        scene3d: "https://info.grudge-studio.com/icons/pack/weapons/Hammer_01.png",
        image: "https://info.grudge-studio.com/icons/pack/misc/Effect.png",
        audio: "https://info.grudge-studio.com/icons/skills/class/hunter/hunter_01.png",
        video: "https://info.grudge-studio.com/icons/skills/class/firemage/firemage_01.png",
        text: "https://info.grudge-studio.com/icons/skills/class/engineer/engineer_01.png",
        pdf: "https://info.grudge-studio.com/icons/pack/armor/Chest_01.png",
        font: "https://info.grudge-studio.com/icons/skills/class/paladin/paladin_01.png",
    };
    const src = infoIcon[kind];
    return (
        <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "1px 7px", borderRadius: 999,
            fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
            background: "rgba(0,0,0,0.35)", border: `1px solid ${colours[kind]}`,
            color: colours[kind], textTransform: "uppercase",
        }}>
            {src && (
                <img
                    src={src}
                    alt=""
                    width={14}
                    height={14}
                    style={{ objectFit: "contain", borderRadius: 2 }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
            )}
            {kind}
        </span>
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
    const [aiBusy, setAiBusy] = useState(false);
    const isLocal = Boolean(asset.localPath) || asset.url?.startsWith("blob:") || asset.url?.startsWith("local:");

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
    function copyPath() {
        const p = asset.localPath || asset.sourcePath || asset.url;
        if (asset.localPath || asset.sourcePath) {
            void G()?.files?.copyPath?.(p).then((r: { path?: string }) => {
                toast.success("Path copied", { description: r?.path || p });
            }).catch(() => {
                void navigator.clipboard.writeText(p).then(() => toast.success("Path copied"));
            });
            return;
        }
        void navigator.clipboard.writeText(p).then(() => toast.success("Path copied"));
    }
    function openExternal() {
        if (asset.localPath) {
            void G()?.files?.reveal?.(asset.localPath);
            return;
        }
        G()?.os?.openExternal?.(asset.url);
    }
    function closeWindow() { window.close(); }

    async function understandAsset(withAi: boolean) {
        setAiBusy(true);
        try {
            const r = await G()?.asset?.understand?.({
                path: asset.localPath || asset.sourcePath,
                name: asset.name,
                url: asset.url?.startsWith("blob:") || asset.url?.startsWith("local:") ? undefined : asset.url,
                contentType: asset.contentType,
                size: asset.size,
                withAi,
            });
            if (!r?.ok) {
                toast.error(r?.error || "Understand failed");
                return;
            }
            await navigator.clipboard.writeText(r.markdown);
            toast.success(withAi ? "AI asset card copied" : "Asset card copied", {
                description: r.summary?.slice(0, 120) || r.kind,
            });
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Understand failed");
        } finally {
            setAiBusy(false);
        }
    }

    return (
        <div className="elite-header">
            <div className="elite-header-meta">
                <span className="elite-header-title" title={asset.localPath || asset.name}>
                    Elite · {fname}
                </span>
                <KindBadge kind={kind} />
                {isLocal && (
                    <span style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
                        color: "var(--gold)", border: "1px solid var(--gold)",
                        borderRadius: 999, padding: "1px 7px",
                    }}>LOCAL</span>
                )}
                {asset.size > 0 && (
                    <span style={{ color: "var(--muted)", fontSize: 11, flexShrink: 0 }}>
                        {formatBytes(asset.size)}
                    </span>
                )}
                {asset.prepareNote && (
                    <span
                        title={asset.sourcePath || asset.prepareNote}
                        style={{
                            fontSize: 10, color: "#c084fc", maxWidth: 280,
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}
                    >
                        {asset.prepareNote}
                    </span>
                )}
            </div>
            <div className="elite-header-actions">
                <HBtn
                    title="Copy asset card for AI (kind, open hints, model stats)"
                    onClick={() => void understandAsset(false)}
                >
                    {aiBusy ? "…" : "AI card"}
                </HBtn>
                {(kind === "image" || kind === "model3d") && (
                    <HBtn
                        title="Understand with vision / model inspect + copy card"
                        onClick={() => void understandAsset(true)}
                    >
                        AI+
                    </HBtn>
                )}
                {(asset.sourcePath || asset.localPath) && (
                    <HBtn
                        title="Open original in system app (Photoshop / Blender / …)"
                        onClick={() => {
                            const p = asset.sourcePath || asset.localPath!;
                            void G()?.files?.openSystem?.(p);
                        }}
                    >
                        🖌 System
                    </HBtn>
                )}
                <HBtn title="Download" onClick={download}>↓ Download</HBtn>
                <HBtn title="Copy disk path or CDN URL" onClick={copyPath}>⧉ Path</HBtn>
                {!isLocal && <HBtn title="Copy CDN URL" onClick={copyUrl}>⧉ URL</HBtn>}
                <HBtn title={isLocal ? "Reveal in Explorer" : "Open in browser"} onClick={openExternal}>
                    {isLocal ? "📁 Reveal" : "↗ External"}
                </HBtn>
                <HBtn
                    title="Close viewer"
                    onClick={closeWindow}
                    style={{ background: "transparent", color: "var(--danger)", border: "1px solid var(--danger)" }}
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
            className="elite-hbtn"
            title={title}
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                background: hover ? "rgb(69 137 255 / 16%)" : "transparent",
                ...extraStyle,
            }}
        >{children}</button>
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
    materialsFixed?: number;
    missingMaps?: number;
}

function Model3DViewerFull({ asset }: { asset: AssetRef | null }) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const engineRef = useRef<SceneEngine | null>(null);
    const objectRef = useRef<THREE.Object3D | null>(null);
    const itemsRef = useRef<ViewerSceneItem[]>([]);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
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
    const [skeleton, setSkeleton] = useState(false);
    const [boundsOn, setBoundsOn] = useState(false);
    const [si, setSi] = useState<SiBounds | null>(null);
    const [viewKind, setViewKind] = useState<StudioView>("persp");
    const [bgColour, setBgColour] = useState("#efd1b5");
    const [items, setItems] = useState<ViewerSceneItem[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [gizmoSpace, setGizmoSpace] = useState<"world" | "local">("world");
    const [adding, setAdding] = useState(false);

    // Animation review: exclusive primary clip (never stack multi-clip)
    const [clips, setClips] = useState<THREE.AnimationClip[]>([]);
    const [activeClipIdx, setActiveClipIdx] = useState<number | null>(null);
    const [animPaused, setAnimPaused] = useState(false);
    const [animSpeed, setAnimSpeed] = useState(1);
    const [animLoop] = useState<AnimLoopMode>("repeat");

    // Transform state (position / rotation deg / uniform+per-axis scale)
    const [pos, setPos] = useState<[number, number, number]>([0, 0, 0]);
    const [rot, setRot] = useState<[number, number, number]>([0, 0, 0]);
    const [scl, setScl] = useState<[number, number, number]>([1, 1, 1]);
    const [uniformScale, setUniformScale] = useState(1);
    const transformRef = useRef({
        pos: [0, 0, 0] as [number, number, number],
        rot: [0, 0, 0] as [number, number, number],
        scl: [1, 1, 1] as [number, number, number],
    });
    /** Author root transform at load — Reset returns here (not forced 1,1,1). */
    const authorXformRef = useRef({
        pos: [0, 0, 0] as [number, number, number],
        rot: [0, 0, 0] as [number, number, number],
        scl: [1, 1, 1] as [number, number, number],
    });

    // Converting / optimize state
    const [converting, setConverting] = useState(false);
    const [optimizing, setOptimizing] = useState(false);
    const [reuploading, setReuploading] = useState(false);
    const [optResult, setOptResult] = useState<{
        path: string;
        name: string;
        objectKey: string;
        beforeBytes: number;
        afterBytes: number;
        reductionPct: number;
        steps: string[];
        warnings: string[];
        profile: string;
    } | null>(null);

    // ── Create SceneEngine once ──────────────────────────────────────────────
    useEffect(() => {
        if (!hostRef.current) return;
        const engine = new SceneEngine(hostRef.current, {
            background: 0xefd1b5,
            showGrid: true,
            showAxes: false,
            hdri: true,
            showGround: true,
            gridCellColor: 0x7a5a38,
            gridSectionColor: 0x3d2818,
        });
        // Studio, not blown-out: keep IBL + key, avoid ACES white-out on sand floor.
        engine.studioLights.ambient.intensity = 0.28;
        engine.studioLights.key.intensity = 1.15;
        engine.studioLights.fill.intensity = 0.4;
        engine.renderer.toneMappingExposure = 1.0;
        engine.resize();
        engineRef.current = engine;
        // Save env map reference so we can toggle it later.
        envMapRef.current = engine.scene.environment;
        const unsub = engine.onTransformChange(() => {
            const obj = objectRef.current;
            if (!obj) return;
            const nextPos: [number, number, number] = [obj.position.x, obj.position.y, obj.position.z];
            const nextRot: [number, number, number] = [
                THREE.MathUtils.radToDeg(obj.rotation.x),
                THREE.MathUtils.radToDeg(obj.rotation.y),
                THREE.MathUtils.radToDeg(obj.rotation.z),
            ];
            const nextScl: [number, number, number] = [obj.scale.x, obj.scale.y, obj.scale.z];
            transformRef.current = { pos: nextPos, rot: nextRot, scl: nextScl };
            setPos(nextPos); setRot(nextRot); setScl(nextScl);
            setUniformScale(obj.scale.x || 1);
            setSi(engine.measureBounds(obj));
        });
        return () => {
            unsub();
            engine.dispose();
            engineRef.current = null;
        };
    }, []);

    const applySelection = useCallback((item: ViewerSceneItem | null) => {
        const engine = engineRef.current;
        if (!item) {
            objectRef.current = null;
            mixerRef.current = null;
            clipsRef.current = [];
            setClips([]);
            setSelectedId(null);
            setSi(null);
            engine?.detach();
            return;
        }
        objectRef.current = item.object;
        mixerRef.current = item.mixer;
        clipsRef.current = item.animations;
        setClips(item.animations);
        setSelectedId(item.id);
        setActiveClipIdx(item.animations.length ? 0 : null);
        const cur = readAuthorXform(item.object);
        transformRef.current = { pos: cur.pos, rot: cur.rot, scl: cur.scl };
        authorXformRef.current = item.authorXform;
        setPos(cur.pos); setRot(cur.rot); setScl(cur.scl);
        setUniformScale(cur.scl[0] || 1);
        engine?.attach(item.object);
        engine?.pulseSelect(item.object);
        if (engine) setSi(engine.measureBounds(item.object));
        setStats({
            triangles: item.triangles,
            vertices: item.vertices,
            bones: item.bones,
            animations: item.animations.length,
            format: item.format,
        });
        if (engine) {
            engine.setSkeletonHelper(item.object, skeleton && item.bones > 0);
            engine.setBoundsHelper(item.object, boundsOn);
        }
    }, [skeleton, boundsOn]);

    const clearSceneItems = useCallback(() => {
        const engine = engineRef.current;
        for (const it of itemsRef.current) {
            if (it.mixer) engine?.removeMixer(it.mixer);
            engine?.removeSkeletonHelper(it.object);
            engine?.scene.remove(it.object);
            disposeTree(it.object);
        }
        itemsRef.current = [];
        setItems([]);
        applySelection(null);
    }, [applySelection]);

    const commitLoaded = useCallback((
        loaded: {
            object: THREE.Object3D;
            animations: THREE.AnimationClip[];
            triangles: number;
            vertices: number;
            bones: number;
            format: string;
        },
        name: string,
        opts?: { diskPath?: string; replace?: boolean; placeBeside?: boolean },
    ): ViewerSceneItem | null => {
        const engine = engineRef.current;
        if (!engine) return null;
        if (opts?.replace) clearSceneItems();
        loaded.object.traverse((n) => {
            const m = n as THREE.Mesh;
            if (m.isMesh) {
                m.castShadow = true;
                m.receiveShadow = true;
            }
            const sm = n as THREE.SkinnedMesh;
            if (sm.isSkinnedMesh) {
                sm.frustumCulled = false;
                sm.matrixWorldNeedsUpdate = true;
            }
        });
        loaded.object.updateMatrixWorld(true);
        if (opts?.placeBeside && itemsRef.current.length) {
            loaded.object.position.x += nextPlaceX(itemsRef.current);
        }
        const id = newViewerItemId();
        stampViewerItem(loaded.object, id);
        engine.scene.add(loaded.object);
        let mixer: THREE.AnimationMixer | null = null;
        let clips: THREE.AnimationClip[] = loaded.animations;
        if (loaded.animations.length > 0 || loaded.bones > 0) {
            const handle = attachAnimationMixer(loaded.object, loaded.animations, {
                dropRootMotion: true,
            });
            engine.mixers.push(handle.mixer);
            mixer = handle.mixer;
            clips = handle.clips;
            if (handle.clips.length) {
                setPrimaryAction(handle.mixer, handle.clips[0], "repeat");
                handle.mixer.timeScale = animSpeed;
            }
        }
        const item: ViewerSceneItem = {
            id,
            name,
            format: loaded.format,
            object: loaded.object,
            animations: clips,
            mixer,
            triangles: loaded.triangles,
            vertices: loaded.vertices,
            bones: loaded.bones,
            visible: true,
            diskPath: opts?.diskPath,
            authorXform: readAuthorXform(loaded.object),
        };
        itemsRef.current = [...itemsRef.current, item];
        setItems(itemsRef.current);
        applySelection(item);
        engine.setSkeletonHelper(loaded.object, loaded.bones > 0);
        setSkeleton(loaded.bones > 0);
        engine.frame(loaded.object);
        return item;
    }, [applySelection, animSpeed, clearSceneItems]);

    // ── Load model ────────────────────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false;
        if (!asset) {
            setError(null);
            setLoading(false);
            setStats(null);
            return;
        }
        setError(null); setLoading(true); setStats(null);
        setClips([]); setActiveClipIdx(null); setAnimPaused(false);
        clipsRef.current = [];

        (async () => {
            try {
                if (!isSupported(asset.name)) throw new Error(`Unsupported format: ${asset.name}`);
                const fname = basename(asset.name);
                const sanitize = {
                    toonStyle: true as const,
                    fixDefaultYellow: true as const,
                    whiteWhenMapped: true as const,
                };
                // Local elite open: diskPath + grudge-media so relative textures/MTL/TGA resolve.
                // CDN/blob: fetch URL (embedded maps only).
                let loaded;
                if (asset.localPath) {
                    const diskUrl =
                        asset.url?.startsWith("grudge-media:")
                            ? asset.url
                            : localFileUrl(asset.localPath);
                    loaded = await loadModelFromUrl(diskUrl, fname, {
                        diskPath: asset.localPath,
                        sanitize,
                    });
                } else {
                    const res = await fetch(asset.url);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const blob = await res.blob();
                    if (cancelled) return;
                    const file = new File([blob], fname, { type: blob.type || "application/octet-stream" });
                    loaded = await loadModel(file, { sanitize });
                }
                if (cancelled || !engineRef.current) return;

                commitLoaded(loaded, fname, {
                    diskPath: asset.localPath,
                    replace: true,
                });
                setBoundsOn(false);

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
    }, [asset?.url, asset?.localPath]);

    // ── Scene control handlers ────────────────────────────────────────────────

    const handleWireframe = useCallback((enabled: boolean) => {
        setWireframe(enabled);
        const roots = itemsRef.current.length
            ? itemsRef.current.map((it) => it.object)
            : objectRef.current ? [objectRef.current] : [];
        for (const root of roots) root.traverse((n) => {
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
        engineRef.current?.setGridVisible(enabled);
    }, []);

    const handleSkeleton = useCallback((enabled: boolean) => {
        setSkeleton(enabled);
        if (objectRef.current) engineRef.current?.setSkeletonHelper(objectRef.current, enabled);
    }, []);

    const handleBounds = useCallback((enabled: boolean) => {
        setBoundsOn(enabled);
        if (objectRef.current) engineRef.current?.setBoundsHelper(objectRef.current, enabled);
    }, []);

    const applyView = useCallback((kind: StudioView) => {
        engineRef.current?.setView(kind, objectRef.current);
        setViewKind(kind);
    }, []);

    const applyGizmoSpace = useCallback((space: "world" | "local") => {
        setGizmoSpace(space);
        try { engineRef.current?.transform.setSpace(space); } catch { /* ignore */ }
    }, []);

    const addFilesFromList = useCallback(async (files: FileList | File[]) => {
        const list = Array.from(files);
        if (!list.length) return;
        setAdding(true);
        try {
            for (const file of list) {
                if (!isSupported(file.name)) {
                    toast.error(`Unsupported: ${file.name}`);
                    continue;
                }
                const diskPath = (file as File & { path?: string }).path;
                const loaded = await loadModel(file, {
                    diskPath,
                    sanitize: { toonStyle: true, fixDefaultYellow: true, whiteWhenMapped: true },
                });
                commitLoaded(loaded, file.name, { diskPath, placeBeside: true });
            }
            toast.success(`Added ${list.length} asset(s)`);
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Add failed");
        } finally {
            setAdding(false);
        }
    }, [commitLoaded]);

    const removeItem = useCallback((id: string) => {
        const engine = engineRef.current;
        const it = itemsRef.current.find((x) => x.id === id);
        if (!it || !engine) return;
        if (it.mixer) engine.removeMixer(it.mixer);
        engine.removeSkeletonHelper(it.object);
        engine.detach();
        engine.scene.remove(it.object);
        disposeTree(it.object);
        const next = itemsRef.current.filter((x) => x.id !== id);
        itemsRef.current = next;
        setItems(next);
        applySelection(next[next.length - 1] ?? null);
        if (next.length) engine.frame(next[next.length - 1].object);
    }, [applySelection]);

    const duplicateItem = useCallback((id: string) => {
        const engine = engineRef.current;
        const src = itemsRef.current.find((x) => x.id === id);
        if (!src || !engine) return;
        const clone = cloneViewerObject(src.object);
        clone.position.x += 0.5;
        const newId = newViewerItemId();
        stampViewerItem(clone, newId);
        engine.scene.add(clone);
        const item: ViewerSceneItem = {
            ...src,
            id: newId,
            name: src.name.replace(/(\.[^.]+)?$/, " copy$1"),
            object: clone,
            mixer: null,
            authorXform: readAuthorXform(clone),
        };
        itemsRef.current = [...itemsRef.current, item];
        setItems(itemsRef.current);
        applySelection(item);
        engine.attach(clone);
        toast.success("Duplicated");
    }, [applySelection]);

    const toggleItemVisible = useCallback((id: string) => {
        const next = itemsRef.current.map((it) => {
            if (it.id !== id) return it;
            it.object.visible = !it.object.visible;
            return { ...it, visible: it.object.visible };
        });
        itemsRef.current = next;
        setItems(next);
    }, []);

    const frameAll = useCallback(() => {
        const roots = itemsRef.current.filter((it) => it.visible).map((it) => it.object);
        if (roots.length) engineRef.current?.frameMany(roots);
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

    // ── Animation handlers (exclusive primary clip — review/repair path) ─────

    /** Select a clip and play it alone. Click active playing → pause/resume. */
    const handleSelectClip = useCallback((idx: number) => {
        const mixer = mixerRef.current;
        const clip = clipsRef.current[idx];
        if (!mixer || !clip) return;

        // Same clip already primary → toggle pause/resume (do not rebind)
        if (activeClipIdx === idx) {
            const existing = actionsRef.current[idx] ?? mixer.clipAction(clip);
            if (existing.isRunning() && !existing.paused) {
                existing.paused = true;
                setAnimPaused(true);
            } else {
                existing.paused = false;
                if (!existing.isRunning()) {
                    existing.reset().setEffectiveWeight(1).play();
                } else if (existing.time >= existing.getClip().duration) {
                    existing.time = 0;
                }
                setAnimPaused(false);
            }
            actionsRef.current[idx] = existing;
            return;
        }

        // Switch primary: stop others, play selected (Forge/SSOT setPrimaryAction)
        const act = setPrimaryAction(mixer, clip, animLoop);
        act.paused = false;
        mixer.timeScale = animSpeed;
        actionsRef.current = clipsRef.current.map((c, i) =>
            i === idx ? act : mixer.clipAction(c),
        );
        setActiveClipIdx(idx);
        setAnimPaused(false);
    }, [activeClipIdx, animLoop, animSpeed]);

    /** Restart selected (or first) clip exclusively — never stack multi-clip. */
    const handleReplay = useCallback(() => {
        const mixer = mixerRef.current;
        const list = clipsRef.current;
        if (!mixer || !list.length) return;
        const idx = activeClipIdx != null && list[activeClipIdx] ? activeClipIdx : 0;
        const clip = list[idx];
        const act = setPrimaryAction(mixer, clip, animLoop);
        act.paused = false;
        mixer.timeScale = animSpeed;
        actionsRef.current = list.map((c, i) => (i === idx ? act : mixer.clipAction(c)));
        setActiveClipIdx(idx);
        setAnimPaused(false);
    }, [activeClipIdx, animLoop, animSpeed]);

    const handleStopAll = useCallback(() => {
        stopMixer(mixerRef.current);
        setAnimPaused(true);
        // Keep selection so user can hit Play again on the same clip
    }, []);

    const handleSpeed = useCallback((speed: number) => {
        setAnimSpeed(speed);
        if (mixerRef.current) mixerRef.current.timeScale = speed;
    }, []);

    // ── Transform handlers ────────────────────────────────────────────────────

    const applyTransform = useCallback((
        nextPos: [number, number, number],
        nextRot: [number, number, number],
        nextScl: [number, number, number],
    ) => {
        transformRef.current = { pos: nextPos, rot: nextRot, scl: nextScl };
        const obj = objectRef.current;
        if (!obj) return;
        obj.position.set(nextPos[0], nextPos[1], nextPos[2]);
        obj.rotation.set(
            THREE.MathUtils.degToRad(nextRot[0]),
            THREE.MathUtils.degToRad(nextRot[1]),
            THREE.MathUtils.degToRad(nextRot[2]),
        );
        obj.scale.set(nextScl[0], nextScl[1], nextScl[2]);
        obj.updateMatrixWorld(true);
    }, []);

    const setPosAxis = useCallback((i: number, v: number) => {
        const t = transformRef.current;
        const next: [number, number, number] = [...t.pos];
        next[i] = v;
        setPos(next);
        applyTransform(next, t.rot, t.scl);
    }, [applyTransform]);

    const setRotAxis = useCallback((i: number, v: number) => {
        const t = transformRef.current;
        const next: [number, number, number] = [...t.rot];
        next[i] = v;
        setRot(next);
        applyTransform(t.pos, next, t.scl);
    }, [applyTransform]);

    const setSclAxis = useCallback((i: number, v: number) => {
        const safe = Number.isFinite(v) && v !== 0 ? v : 0.001;
        const t = transformRef.current;
        const next: [number, number, number] = [...t.scl];
        next[i] = safe;
        setScl(next);
        applyTransform(t.pos, t.rot, next);
    }, [applyTransform]);

    const setUniform = useCallback((v: number) => {
        const safe = Number.isFinite(v) && v > 0 ? v : 0.001;
        setUniformScale(safe);
        const t = transformRef.current;
        const next: [number, number, number] = [safe, safe, safe];
        setScl(next);
        applyTransform(t.pos, t.rot, next);
    }, [applyTransform]);

    const resetTransform = useCallback(() => {
        const a = authorXformRef.current;
        setPos(a.pos); setRot(a.rot); setScl(a.scl);
        setUniformScale(a.scl[0] || 1);
        applyTransform(a.pos, a.rot, a.scl);
    }, [applyTransform]);

    // Blender-style views + gizmo (viewer only — not combat keys)
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) {
                return;
            }
            if (e.key === "1") { e.preventDefault(); applyView("front"); }
            else if (e.key === "3") { e.preventDefault(); applyView("right"); }
            else if (e.key === "7") { e.preventDefault(); applyView("top"); }
            else if (e.key === "5") {
                e.preventDefault();
                engineRef.current?.togglePerspOrtho(objectRef.current);
                setViewKind(engineRef.current?.getViewKind() ?? "persp");
            } else if (e.key === "a" && e.shiftKey) {
                e.preventDefault();
                fileInputRef.current?.click();
            } else if (e.key === "a" || e.key === "A" || e.key === "Home") {
                e.preventDefault();
                frameAll();
            } else if (e.key === "d" && e.shiftKey && selectedId) {
                e.preventDefault();
                duplicateItem(selectedId);
            } else if ((e.key === "x" || e.key === "X" || e.key === "Delete") && selectedId) {
                e.preventDefault();
                removeItem(selectedId);
            } else if (e.key === "h" && e.altKey) {
                e.preventDefault();
                const next = itemsRef.current.map((it) => {
                    it.object.visible = true;
                    return { ...it, visible: true };
                });
                itemsRef.current = next;
                setItems(next);
            } else if ((e.key === "h" || e.key === "H") && selectedId) {
                e.preventDefault();
                toggleItemVisible(selectedId);
            } else if (e.key === "z" || e.key === "Z") {
                e.preventDefault();
                if (objectRef.current) engineRef.current?.frame(objectRef.current);
            } else if (e.key === "`") {
                e.preventDefault();
                handleGrid(!grid);
            } else if (e.key === "g" || e.key === "G" || e.key === "w" || e.key === "W") {
                e.preventDefault();
                engineRef.current?.setGizmoMode("translate");
            } else if (e.key === "e" || e.key === "E" || e.key === "r" || e.key === "R") {
                e.preventDefault();
                engineRef.current?.setGizmoMode("rotate");
            } else if (e.key === "s" || e.key === "S") {
                e.preventDefault();
                engineRef.current?.setGizmoMode("scale");
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [applyView, grid, handleGrid, frameAll, selectedId, duplicateItem, removeItem, toggleItemVisible]);

    // Click mesh → select item + attach gizmo (empty click deselects gizmo)
    useEffect(() => {
        const engine = engineRef.current;
        if (!engine) return;
        const el = engine.canvas;
        const onClick = (ev: MouseEvent) => {
            const rect = el.getBoundingClientRect();
            if (ev.clientX > rect.right - 128 && ev.clientY > rect.bottom - 128) return;
            const roots = itemsRef.current.map((it) => it.object);
            const hit = roots.length ? engine.pick(ev.clientX, ev.clientY, roots) : null;
            if (!hit) {
                engine.detach();
                engine.pulseSelect(null);
                return;
            }
            const itemId = findViewerItemId(hit.object);
            const item = itemId ? itemsRef.current.find((x) => x.id === itemId) : null;
            if (item && item.id !== selectedId) {
                applySelection(item);
                engine.attach(item.object);
                engine.pulseSelect(item.object);
            } else {
                engine.attach(hit.object);
                engine.pulseSelect(hit.object);
            }
        };
        el.addEventListener("click", onClick);
        return () => el.removeEventListener("click", onClick);
    }, [loading, selectedId, applySelection]);

    // ── Action handlers ───────────────────────────────────────────────────────

    function cdnAssetUrl(): string | null {
        return asset && isPublicCdnUrl(asset.url) ? asset.url : null;
    }

    async function sendToForge() {
        if (!asset) { toast.error("No asset"); return; }
        const result = await G()?.viewer?.sendToForge({ url: asset.url, name: asset.name });
        if (result?.ok) toast.success("Added to local Forge tools", { description: "Main window → Forge tools (secondary). Use Forge tab for forge.grudge-studio.com" });
        else toast.error(result?.error ?? "Failed to send to Forge");
    }

    function openForgeLive() {
        const cdn = cdnAssetUrl();
        if (!cdn) {
            toast.error("Forge live needs a CDN/http URL — upload first");
            return;
        }
        G()?.os?.openExternal?.(forgeStudioAssetUrl(cdn));
    }

    function openThreeFlow() {
        const cdn = cdnAssetUrl();
        if (!cdn) {
            toast.error("ThreeFlow needs a CDN/http URL — upload or copy a public asset first");
            return;
        }
        G()?.os?.openExternal?.(threeflowAssetUrl(cdn));
    }

    async function convertAndSave(targetFormat: "glb" | "gltf") {
        if (!asset) { toast.error("No asset"); return; }
        setConverting(true);
        try {
            const r = await G()?.viewer?.convertModel({
                url: asset.url,
                name: asset.name,
                targetFormat,
                localPath: asset.localPath || asset.sourcePath,
            });
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

    function formatBytes(n: number): string {
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        return `${(n / 1024 / 1024).toFixed(2)} MB`;
    }

    async function optimizeForWeb() {
        if (!asset) { toast.error("No asset"); return; }
        setOptimizing(true);
        setOptResult(null);
        try {
            const r = await G()?.viewer?.optimizeForWeb({
                url: asset.url,
                name: asset.name,
                // Local / blob / grudge-media assets must use disk — net.request is http(s) only
                localPath: asset.localPath || asset.sourcePath,
            });
            if (!r?.ok || !r.path) {
                toast.error(r?.error ?? "Optimize failed");
                if (r?.warnings?.length) {
                    toast.message("Optimize warnings", { description: r.warnings.slice(0, 3).join(" · ") });
                }
                return;
            }
            setOptResult({
                path: r.path,
                name: r.name ?? "optimized.web.glb",
                objectKey: r.objectKey ?? asset.name,
                beforeBytes: r.beforeBytes ?? 0,
                afterBytes: r.afterBytes ?? 0,
                reductionPct: r.reductionPct ?? 0,
                steps: r.steps ?? [],
                warnings: r.warnings ?? [],
                profile: r.profile ?? "grudge-web-v1",
            });
            const delta = (r.reductionPct ?? 0) >= 0
                ? `−${r.reductionPct}%`
                : `+${Math.abs(r.reductionPct ?? 0)}%`;
            toast.success(`Optimized ${delta}`, {
                description: `${formatBytes(r.beforeBytes)} → ${formatBytes(r.afterBytes)}`,
            });
            if (r.warnings?.length) {
                toast.message("Optimize notes", { description: r.warnings.slice(0, 2).join(" · ") });
            }
        } catch (e: any) {
            toast.error(e?.message ?? "Optimize error");
        } finally {
            setOptimizing(false);
        }
    }

    async function saveOptimizedLocally() {
        if (!optResult?.path) return;
        try {
            const s = await G()?.viewer?.saveConvertedFile({
                path: optResult.path,
                defaultName: optResult.name || "optimized.web.glb",
            });
            if (s?.ok) toast.success(`Saved ${s.savedPath.split(/[\\/]/).pop()}`);
            else if (!s?.canceled) toast.error(s?.error ?? "Save failed");
        } catch (e: any) {
            toast.error(e?.message ?? "Save error");
        }
    }

    async function reuploadOptimized() {
        if (!optResult?.path || !optResult.objectKey) return;
        const key = optResult.objectKey;
        if (!confirm(
            `Overwrite CDN object?\n\n${key}\n\n${formatBytes(optResult.beforeBytes)} → ${formatBytes(optResult.afterBytes)} (${optResult.reductionPct}% smaller)\n\nThis replaces the existing file at the same key.`,
        )) return;
        setReuploading(true);
        try {
            const r = await G()?.viewer?.reuploadOptimized({
                localPath: optResult.path,
                objectKey: key,
                contentType: "model/gltf-binary",
            });
            if (!r?.ok) {
                toast.error(r?.error ?? "Re-upload failed");
                return;
            }
            toast.success("Re-uploaded to same CDN key", {
                description: `${r.objectKey} · ${formatBytes(r.bytes)}`,
            });
        } catch (e: any) {
            toast.error(e?.message ?? "Re-upload error");
        } finally {
            setReuploading(false);
        }
    }

    function screenshot() {
        const dataUrl = engineRef.current?.screenshot();
        if (!dataUrl) return;
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `${basename(asset?.name || "studio").replace(/\.[^.]+$/, "")}-screenshot.png`;
        a.click();
        toast.success("Screenshot saved");
    }

    function resetCamera() {
        if (objectRef.current) engineRef.current?.frame(objectRef.current);
        else engineRef.current?.focusHome();
    }

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="elite-body">
            <aside className="elite-left">
                <div className="elite-left-title">Scene</div>
                {items.length === 0 && (
                    <div style={{ padding: "4px 12px 10px", color: "var(--elite-muted)", fontSize: 11 }}>
                        Empty studio — drop a GLB or click Add
                    </div>
                )}
                {items.map((it) => (
                    <div
                        key={it.id}
                        className={`elite-tree-item${selectedId === it.id ? " is-active" : ""}`}
                        onClick={() => applySelection(it)}
                    >
                        <span style={{ opacity: it.visible ? 1 : 0.4 }}>{it.name}</span>
                    </div>
                ))}
                <div className="elite-left-actions">
                    <button
                        type="button"
                        className="elite-hbtn"
                        style={{ width: "100%" }}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        + Add mesh
                    </button>
                </div>
            </aside>
            <div className="elite-stage">
    <div
        ref={hostRef}
        className="elite-viewport"
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
        onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files?.length) void addFilesFromList(e.dataTransfer.files);
        }}
    >
        <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".glb,.gltf,.fbx,.obj,.stl,.ply,.dae,.3mf,.vrm"
            style={{ display: "none" }}
            onChange={(e) => {
                if (e.target.files?.length) void addFilesFromList(e.target.files);
                e.target.value = "";
            }}
        />
        {loading && <div className="elite-banner">Loading model…</div>}
        {error && <div className="elite-banner is-error">Load error · {error}</div>}
        {!loading && !error && (
        <>
            <div className="elite-hud elite-hud-tl">
                {si
                    ? `${si.source === "bones" ? "Bones" : "Mesh"} · H ${formatSiMeters(si.h)} · W ${formatSiMeters(si.w)} · D ${formatSiMeters(si.d)}${si.boneCount ? ` · ${si.boneCount} bones` : ""}`
                    : "Studio"}
                {" · "}{viewKind}
            </div>
            <div className="elite-hud elite-hud-tr">
                {(["persp", "front", "right", "top"] as StudioView[]).map((v) => (
                    <button
                        key={v}
                        type="button"
                        className={`elite-view-btn${viewKind === v ? " is-on" : ""}`}
                        onClick={() => applyView(v)}
                    >
                        {v}
                    </button>
                ))}
            </div>
            <div className="elite-hud elite-hud-bl">
                {adding ? "Adding…" : `${items.length} object(s)`}
                {" · "}G/R/S · drop files · Shift+A add · Shift+D copy · X delete · A frame
            </div>
        </>
        )}
    </div>
    </div>

    <aside className="elite-right">
    <Section title="Scene">
        <Toggle label="Wireframe" checked = { wireframe } onChange = { handleWireframe } />
            <Toggle label="Grid"      checked = { grid }      onChange = { handleGrid } />
                <Toggle label="Skeleton" checked = { skeleton } onChange = { handleSkeleton } />
                <Toggle label="Bounds"   checked = { boundsOn } onChange = { handleBounds } />
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

{!loading && !error && objectRef.current && asset && (
        <Section title="Studio">
            <AssetStudioInspector
                engine={engineRef.current}
                root={objectRef.current}
                asset={asset}
                clips={clips}
                mixer={mixerRef.current}
                si={si}
                onSiChange={setSi}
                onTransformTick={() => {
                    const obj = objectRef.current;
                    if (!obj) return;
                    const nextPos: [number, number, number] = [obj.position.x, obj.position.y, obj.position.z];
                    const nextRot: [number, number, number] = [
                        THREE.MathUtils.radToDeg(obj.rotation.x),
                        THREE.MathUtils.radToDeg(obj.rotation.y),
                        THREE.MathUtils.radToDeg(obj.rotation.z),
                    ];
                    const nextScl: [number, number, number] = [obj.scale.x, obj.scale.y, obj.scale.z];
                    transformRef.current = { pos: nextPos, rot: nextRot, scl: nextScl };
                    setPos(nextPos); setRot(nextRot); setScl(nextScl);
                    setUniformScale(obj.scale.x || 1);
                    if (engineRef.current) setSi(engineRef.current.measureBounds(obj));
                }}
                onClipsChange={(next) => {
                    clipsRef.current = next;
                    setClips(next);
                    setActiveClipIdx(next.length ? 0 : null);
                    const it = itemsRef.current.find((x) => x.id === selectedId);
                    if (it) it.animations = next;
                }}
                skeletonOn={skeleton}
                onSkeleton={handleSkeleton}
                sceneItems={items.map((it) => ({
                    id: it.id, name: it.name, visible: it.visible, bones: it.bones,
                }))}
                selectedItemId={selectedId}
                onSelectItem={(id) => {
                    const it = itemsRef.current.find((x) => x.id === id);
                    if (it) applySelection(it);
                }}
                onRemoveItem={removeItem}
                onDuplicateItem={duplicateItem}
                onToggleItemVisible={toggleItemVisible}
                onAddFiles={() => fileInputRef.current?.click()}
                gizmoSpace={gizmoSpace}
                onGizmoSpace={applyGizmoSpace}
            />
        </Section>
    )}

{/* Transform — position / rotate / scale */ }
{
    !loading && !error && (
        <Section title="Transform" >
            <AxisRow label="Pos" values={ pos } step={ 0.1 } onChange={ setPosAxis } />
            <AxisRow label="Rot°" values={ rot } step={ 1 } onChange={ setRotAxis } />
            <AxisRow label="Scl" values={ scl } step={ 0.05 } onChange={ setSclAxis } />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                <span style={{ fontSize: 11, color: "var(--muted)", width: 36 }}>Uni</span>
                <input
                    type="range" min={ 0.05 } max={ 5 } step={ 0.05 }
                    value={ uniformScale }
                    onChange={(e) => setUniform(Number(e.target.value))}
                    style={{ flex: 1 }}
                />
                <input
                    type="number" step={ 0.05 } value={ Number(uniformScale.toFixed(3)) }
                    onChange={(e) => setUniform(Number(e.target.value))}
                    style={{
                        width: 52, fontSize: 11, padding: "2px 4px",
                        background: "var(--bg-2)", border: "1px solid var(--line)",
                        borderRadius: 4, color: "var(--text)",
                    }}
                />
            </div>
            <button onClick={ resetTransform } style={{
                marginTop: 8, width: "100%", padding: "4px 0",
                background: "var(--bg-2)", border: "1px solid var(--line)",
                borderRadius: 5, color: "var(--muted)", fontSize: 11, cursor: "pointer",
            }}>↺ Reset Transform</button>
        </Section>
    )
}

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
    { typeof stats.materialsFixed === "number" && stats.materialsFixed > 0 && (
        <StatRow label="Mats fixed" value={String(stats.materialsFixed)} />
    )}
    { typeof stats.missingMaps === "number" && stats.missingMaps > 0 && (
        <StatRow label="No map" value={String(stats.missingMaps)} />
    )}
    </tbody>
        </table>
        </Section>
        )
}

{/* Animations — exclusive select = correct clip on screen */}
{
    clips.length > 0 && (
        <Section title={`Animations (${clips.length})`}>
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 8, lineHeight: 1.35 }}>
                Select a clip to review. Only one plays at a time (no multi-clip stack).
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
                <button
                    type="button"
                    onClick={handleReplay}
                    style={pillBtn("var(--ok)")}
                    title="Restart selected (or first) clip"
                >
                    ▶ Play
                </button>
                <button
                    type="button"
                    onClick={handleStopAll}
                    style={pillBtn("var(--danger)")}
                    title="Stop animation"
                >
                    ■ Stop
                </button>
                <select
                    value={animSpeed}
                    onChange={(e) => handleSpeed(Number(e.target.value))}
                    style={{
                        fontSize: 11, padding: "1px 4px", background: "var(--bg-2)",
                        border: "1px solid var(--line)", borderRadius: 4,
                        color: "var(--text)", cursor: "pointer",
                    }}
                >
                    {[0.25, 0.5, 1, 1.5, 2].map((s) => (
                        <option key={s} value={s}>{s}×</option>
                    ))}
                </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {clips.map((clip, i) => {
                    const isActive = activeClipIdx === i;
                    const isLive = isActive && !animPaused;
                    return (
                        <div
                            key={`${clip.name || "clip"}-${i}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => handleSelectClip(i)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    handleSelectClip(i);
                                }
                            }}
                            style={{
                                display: "flex", alignItems: "center", gap: 6,
                                background: isActive ? "rgba(255,198,42,0.12)" : "var(--bg-2)",
                                border: `1px solid ${isActive ? "var(--gold)" : "var(--line)"}`,
                                borderRadius: 5, padding: "4px 8px",
                                cursor: "pointer",
                            }}
                            title={isLive ? "Pause this clip" : "Play this clip"}
                        >
                            <span
                                style={{
                                    flexShrink: 0, width: 20, height: 20,
                                    background: isLive ? "var(--gold)" : "var(--bg-1)",
                                    border: `1px solid ${isLive ? "var(--gold)" : "var(--line)"}`,
                                    borderRadius: 4,
                                    color: isLive ? "#1a1300" : "var(--muted)",
                                    fontSize: 9, display: "flex",
                                    alignItems: "center", justifyContent: "center",
                                }}
                            >
                                {isLive ? "▐▐" : "▶"}
                            </span>
                            <span
                                style={{
                                    fontSize: 11,
                                    color: isActive ? "var(--gold)" : "var(--text)",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
                                    fontWeight: isActive ? 600 : 400,
                                }}
                                title={clip.name}
                            >
                                {clip.name || `Clip ${i}`}
                            </span>
                            <span style={{ fontSize: 10, color: "var(--muted)", flexShrink: 0 }}>
                                {clip.duration.toFixed(1)}s
                            </span>
                        </div>
                    );
                })}
            </div>
        </Section>
    )}

{/* Optimize for web (gltf-transform) */ }
<Section title="Optimize (gltf-transform)" >
    <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 8, lineHeight: 1.35 }}>
        Profile <span style={{ color: "var(--gold)" }}>grudge-web-v1</span>
        : dedup · prune · resample · WebP textures · meshopt
    </div>
    <ActionBtn
        onClick={ optimizeForWeb }
        disabled={ optimizing || converting }
        icon="⚡"
        label={ optimizing ? "Optimizing…" : "Optimize for web" }
        color="var(--gold)"
    />
    {optResult && (
        <div style={{
            marginTop: 8, padding: 10, borderRadius: 6,
            background: "var(--bg-2)", border: "1px solid var(--line)",
            fontSize: 11,
        }}>
            <div style={{ color: "var(--gold)", fontWeight: 700, marginBottom: 6 }}>
                {optResult.profile} · {optResult.reductionPct >= 0 ? "−" : "+"}{Math.abs(optResult.reductionPct)}%
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }}>
                <tbody>
                    <StatRow label="Before" value={formatBytes(optResult.beforeBytes)} />
                    <StatRow label="After" value={formatBytes(optResult.afterBytes)} />
                    <StatRow
                        label="Saved"
                        value={formatBytes(Math.max(0, optResult.beforeBytes - optResult.afterBytes))}
                    />
                </tbody>
            </table>
            {optResult.steps.length > 0 && (
                <div style={{ color: "var(--muted)", fontSize: 10, marginBottom: 8, wordBreak: "break-word" }}>
                    {optResult.steps.join(" → ")}
                </div>
            )}
            {optResult.warnings.length > 0 && (
                <div style={{ color: "#ff9f1c", fontSize: 10, marginBottom: 8 }}>
                    {optResult.warnings.slice(0, 3).join(" · ")}
                </div>
            )}
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 6, wordBreak: "break-all" }}>
                CDN key: {optResult.objectKey}
            </div>
            <ActionBtn onClick={saveOptimizedLocally} icon="💾" label="Save optimized locally" color="var(--ok)" />
            <ActionBtn
                onClick={reuploadOptimized}
                disabled={reuploading}
                icon="☁"
                label={reuploading ? "Re-uploading…" : "Re-upload same CDN key"}
                color="var(--gold)"
            />
        </div>
    )}
</Section>

{/* Actions */ }
<Section title="Actions" >
    <ActionBtn onClick={ sendToForge } icon = "⚔" label = "Add to local Forge tools" color = "var(--gold)" />
    <ActionBtn onClick={ openForgeLive } icon = "⚔" label = "Open in Forge (live)" color = "var(--gold)" />
    <ActionBtn onClick={ openThreeFlow } icon = "✦" label = "Open in ThreeFlow" color = "#7c6bff" />
        <ActionBtn
            onClick={ () => convertAndSave("glb") }
disabled = { converting || optimizing }
icon = "⇄" label = { converting? "Converting…": "Convert → GLB" }
color = "var(--ok)"
    />
    <ActionBtn
            onClick={ () => convertAndSave("gltf") }
disabled = { converting || optimizing }
icon = "⇄" label = { converting? "Converting…": "Convert → glTF" }
color = "var(--ok)"
    />
    <ActionBtn onClick={screenshot} icon="📷" label="Screenshot (PNG)" color="var(--muted)" />
        </Section>
        </aside>
        </div>
  );
}

function AxisRow({
    label, values, step, onChange,
}: {
    label: string;
    values: [number, number, number];
    step: number;
    onChange: (i: number, v: number) => void;
}) {
    const colours = ["#ff6b6b", "#6bff6b", "#6b9eff"];
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: "var(--muted)", width: 36 }}>{label}</span>
            {values.map((v, i) => (
                <input
                    key={i}
                    type="number"
                    step={step}
                    value={Number(v.toFixed(4))}
                    onChange={(e) => onChange(i, Number(e.target.value))}
                    style={{
                        width: 58, fontSize: 11, padding: "2px 4px", fontFamily: "ui-monospace, monospace",
                        background: "var(--bg-2)", border: "1px solid var(--line)",
                        borderRadius: 4, color: colours[i],
                    }}
                />
            ))}
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
        case "design":
        case "unknown":
            return <div style={wrapStyle}><DesignViewer asset={asset} /></div>;
        default:
            return (
                <div style={{
                    flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                    flexDirection: "column", gap: 10, color: "var(--muted)",
                }}>
                    <span style={{ fontSize: 40 }}>📄</span>
                    <span>No preview available for this file type.</span>
                    <a href={asset.url} download={basename(asset.name)} style={{ color: "var(--gold)" }}>
                        Download {basename(asset.name)}
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
        let revoked: string | null = null;
        grudge.viewer.getAsset(token).then(async (a: (AssetRef & { localPath?: string; stream?: boolean }) | null) => {
            if (!a) {
                setNotFound(true);
                return;
            }
            // Streaming video/audio (mp4, webm, mov, mp3…) — no full-file blob
            if (
                a.url?.startsWith("grudge-media:") ||
                a.stream ||
                (a.localPath && /\.(mp4|webm|mov|m4v|ogv|mkv|avi|mp3|wav|ogg|flac|m4a|aac|opus)$/i.test(a.localPath))
            ) {
                try {
                    let url = a.url;
                    if (a.localPath && !url?.startsWith("grudge-media:")) {
                        url = await grudge.files?.mediaUrl?.(a.localPath);
                    }
                    if (!url) throw new Error("No media stream URL");
                    const resolved: AssetRef = {
                        name: a.name,
                        url,
                        contentType: a.contentType || "",
                        size: a.size || 0,
                        localPath: a.localPath,
                        stream: true,
                    };
                    setAsset(resolved);
                    document.title = `${basename(resolved.name)} — Grudge Elite Viewer`;
                    return;
                } catch (e) {
                    console.error("media stream resolve failed", e);
                    setNotFound(true);
                    return;
                }
            }
            // Local disk images/models: resolve to blob: URL inside this window
            if (a.localPath || a.url?.startsWith("local:")) {
                try {
                    const path = a.localPath || decodeURIComponent(a.url.replace(/^local:\/\//, ""));
                    const file = await grudge.files?.read?.(path);
                    if (!file?.bytes) throw new Error("Could not read local file");
                    const bytes = file.bytes as Uint8Array;
                    const ab = bytes.buffer.slice(
                        bytes.byteOffset,
                        bytes.byteOffset + bytes.byteLength,
                    ) as ArrayBuffer;
                    const blob = new Blob([ab], { type: file.mime || a.contentType || "application/octet-stream" });
                    const blobUrl = URL.createObjectURL(blob);
                    revoked = blobUrl;
                    const resolved: AssetRef = {
                        name: a.name || file.name,
                        url: blobUrl,
                        contentType: file.mime || a.contentType || "",
                        size: file.size || a.size || bytes.byteLength,
                        localPath: path,
                        sourcePath: a.sourcePath,
                        sourceFormat: a.sourceFormat,
                        prepareNote: a.prepareNote,
                    };
                    setAsset(resolved);
                    document.title = `${basename(resolved.name)} — Grudge Elite Viewer`;
                    return;
                } catch (e) {
                    console.error("local resolve failed", e);
                    setNotFound(true);
                    return;
                }
            }
            setAsset(a);
            document.title = `${basename(a.name)} — Grudge Elite Viewer`;
        });
        return () => {
            if (revoked) URL.revokeObjectURL(revoked);
        };
    }, []);

    if (!asset) {
        return (
            <div className="elite-shell">
                <div className="elite-header">
                    <span className="elite-header-title">Grudge Elite</span>
                    <span style={{ color: "var(--elite-muted)", fontSize: 11 }}>
                        {notFound ? "No asset token — empty studio" : "Loading asset…"}
                    </span>
                </div>
                <Model3DViewerFull asset={null} />
            </div>
        );
    }

    const kind = classify(asset);
    const is3d = kind === "model3d" || kind === "scene3d";

    return (
        <div className="elite-shell">
            <ViewerHeader asset={asset} kind={kind} />
            {is3d
                ? <Model3DViewerFull asset={asset} />
                : <FlatViewer asset={asset} kind={kind} />}
        </div>
    );
}
