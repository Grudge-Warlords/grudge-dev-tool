import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { toast } from "sonner";
import {
  Move, RotateCcw, Maximize2, Camera, Download, UploadCloud,
  Play, Pause, FileBox, Trash2, ChevronRight, ChevronDown, Box,
  Lightbulb, Grid3x3, Sun, FolderOpen, ExternalLink, Layers, Zap,
  Eye, EyeOff, Focus, Crosshair, Aperture,
} from "lucide-react";
import { SceneEngine, type GizmoMode, type TransformSpace } from "../lib/forge/sceneEngine";
import { resourceBaseFromModelLocation } from "../lib/filePaths";
import { loadModel, loadRemoteModel, type LoadedModel, isSupported } from "../lib/forge/loaders";
import {
  flattenMeshHierarchy, findObjectByUuid, aggregateMeshStats, KIND_COLOR,
  type MeshBreakdown,
} from "../lib/forge/meshHierarchy";
import { ForgeRapierWorld } from "../lib/forge/rapierWorld";
import { applyTextureToMesh } from "../lib/forge/materialUtils";
import ForgeAssetBrowser, { cdnKeyToUrl } from "../components/ForgeAssetBrowser";
import ForgeMaterialPanel from "../components/ForgeMaterialPanel";
import ForgePhysicsPanel from "../components/ForgePhysicsPanel";
import { cdnUrl } from "../../shared/grudge6Assets";
import { exportToGlb, downloadBlob, ACCEPT_ATTR } from "../lib/forge/converters";
import { inspectGlb, formatBytes, type GlbInspection } from "../lib/forge/glbInspect";
import { useWorkspaceField } from "../lib/useWorkspaceField";

interface SceneItem {
  id: string;
  name: string;
  format: string;
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
  mixer: THREE.AnimationMixer | null;
  triangles: number;
  vertices: number;
  bones: number;
  inspection: GlbInspection | null;
  sceneGraph: Record<string, unknown> | null;
  diskPath: string | null;
  bytes: number;
}

const ICON_BY_FORMAT: Record<string, string> = {
  glb: "📦", gltf: "📦", obj: "🧊", fbx: "🧱",
  stl: "🖨️", ply: "🌐", dae: "🎬", "3mf": "🛠️",
};

export default function Forge3D() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SceneEngine | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [items, setItems] = useState<SceneItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("translate");
  const [showHelpers, setShowHelpers] = useState(true);
  const [autoFrame, setAutoFrame] = useState(true);
  const [loading, setLoading] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [activeClip, setActiveClip] = useState<THREE.AnimationAction | null>(null);
  const [paused, setPaused] = useState(false);
  const [bgIndex, setBgIndex] = useState(0);
  const [r2Path, setR2Path] = useWorkspaceField("forgeLastUrl", "user-uploads/forge");
  const [busyUpload, setBusyUpload] = useState(false);
  const [leftTab, setLeftTab] = useState<"scene" | "assets">("scene");
  const [rightTab, setRightTab] = useState<"inspect" | "object" | "camera" | "materials" | "physics">("inspect");
  const [selectedMeshUuid, setSelectedMeshUuid] = useState<string | null>(null);
  const [physicsReady, setPhysicsReady] = useState(false);
  const [physicsPlaying, setPhysicsPlaying] = useState(false);
  const [physicsBodies, setPhysicsBodies] = useState(0);
  const physicsRef = useRef<ForgeRapierWorld | null>(null);
  const [transformSpace, setTransformSpace] = useState<TransformSpace>("world");
  const [wireframe, setWireframe] = useState(false);
  const [showBones, setShowBones] = useState(true);
  const [snapTranslate, setSnapTranslate] = useState(0);
  const [clipNear, setClipNear] = useState(0.01);
  const [clipFar, setClipFar] = useState(100_000);
  const [clipFov, setClipFov] = useState(50);
  const [fogKind, setFogKind] = useState<"none" | "linear" | "exp2">("none");
  const [renderStats, setRenderStats] = useState({ calls: 0, triangles: 0, points: 0, lines: 0, geometries: 0, textures: 0 });
  const [, forceTransform] = useState(0);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);
  const selectedObject = useMemo(() => {
    if (!selected) return null;
    if (!selectedMeshUuid) return selected.object;
    return findObjectByUuid(selected.object, selectedMeshUuid) ?? selected.object;
  }, [selected, selectedMeshUuid]);
  const selectedMesh = useMemo(() => {
    if (!selectedObject) return null;
    return (selectedObject as THREE.Mesh).isMesh ? (selectedObject as THREE.Mesh) : null;
  }, [selectedObject]);

  // -- Engine bootstrap ----------------------------------------------------
  useEffect(() => {
    if (!viewportRef.current) return;
    const engine = new SceneEngine(viewportRef.current, {
      background: 0x0a0e1a,
      showGrid: true,
      showAxes: true,
      hdri: true,
      near: 0.01,
      far: 100_000,
      gridSize: 100,
      gridDivisions: 100,
    });
    engineRef.current = engine;
    const planes = engine.getClipPlanes();
    setClipNear(planes.near);
    setClipFar(planes.far);
    setClipFov(planes.fov);
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setHelpers(showHelpers);
  }, [showHelpers]);

  useEffect(() => {
    engineRef.current?.setGizmoMode(gizmoMode);
  }, [gizmoMode]);

  useEffect(() => {
    engineRef.current?.setTransformSpace(transformSpace);
  }, [transformSpace]);

  useEffect(() => {
    engineRef.current?.setSnap(snapTranslate, snapTranslate > 0 ? 15 : 0, snapTranslate > 0 ? 0.1 : 0);
  }, [snapTranslate]);

  useEffect(() => {
    engineRef.current?.setWireframe(wireframe);
  }, [wireframe]);

  useEffect(() => {
    engineRef.current?.setClipPlanes(clipNear, clipFar, clipFov);
  }, [clipNear, clipFar, clipFov]);

  useEffect(() => {
    engineRef.current?.setFog(fogKind, 0x0a0e1a, 20, Math.min(clipFar * 0.4, 800), 0.015);
  }, [fogKind, clipFar]);

  useEffect(() => {
    if (!engineRef.current) return;
    const target = selectedObject;
    if (target) engineRef.current.attach(target);
    else engineRef.current.detach();
  }, [selectedObject]);

  useEffect(() => {
    engineRef.current?.setPickRoots(items.map((i) => i.object));
  }, [items]);

  // Click-to-select (three.js editor viewport pick)
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setPickHandler((obj) => {
      if (!obj) {
        setSelectedMeshUuid(null);
        return;
      }
      // Find parent scene item
      let walk: THREE.Object3D | null = obj;
      let itemId: string | null = null;
      while (walk) {
        if (walk.userData?.itemId) {
          itemId = String(walk.userData.itemId);
          break;
        }
        walk = walk.parent;
      }
      if (!itemId) {
        // match by scene membership
        for (const it of items) {
          let found = false;
          it.object.traverse((n) => { if (n === obj) found = true; });
          if (found) { itemId = it.id; break; }
        }
      }
      if (itemId) {
        setSelectedId(itemId);
        setSelectedMeshUuid(obj.uuid);
        setRightTab("object");
      }
    });
    return () => engine.setPickHandler(null);
  }, [items]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const off = engine.onTick((dt) => {
      physicsRef.current?.step(dt);
    });
    const id = window.setInterval(() => {
      if (engineRef.current) setRenderStats(engineRef.current.getRenderStats());
      forceTransform((n) => n + 1);
    }, 250);
    return () => {
      off();
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => () => {
    physicsRef.current?.dispose();
    physicsRef.current = null;
  }, []);

  // Studio hotkeys — three.js editor style
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "w") { setGizmoMode("translate"); e.preventDefault(); }
      else if (k === "e") { setGizmoMode("rotate"); e.preventDefault(); }
      else if (k === "r") { setGizmoMode("scale"); e.preventDefault(); }
      else if (k === "q") { setTransformSpace((s) => (s === "world" ? "local" : "world")); e.preventDefault(); }
      else if (k === "g") { setShowHelpers((v) => !v); e.preventDefault(); }
      else if (k === "x") { setWireframe((v) => !v); e.preventDefault(); }
      else if (k === "f") {
        const engine = engineRef.current;
        if (engine && selectedObject) { engine.frame(selectedObject); e.preventDefault(); }
      } else if (k === "a" && !e.shiftKey) {
        engineRef.current?.frameAll();
        e.preventDefault();
      } else if (k === "delete" || k === "backspace") {
        if (selectedId) {
          const engine = engineRef.current;
          const item = items.find((i) => i.id === selectedId);
          if (engine && item) {
            engine.scene.remove(item.object);
            item.mixer?.stopAllAction();
            setItems((prev) => prev.filter((i) => i.id !== selectedId));
            setSelectedId(null);
            setSelectedMeshUuid(null);
          }
          e.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selectedId, selectedObject]);

  const ingestLoaded = useCallback((loaded: LoadedModel, name: string, extras?: Partial<SceneItem>) => {
    const engine = engineRef.current;
    if (!engine) return;
    const id = `e${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`;
    loaded.object.userData.itemId = id;
    loaded.object.traverse((n) => { (n as THREE.Mesh).castShadow = true; (n as THREE.Mesh).receiveShadow = true; });
    engine.scene.add(loaded.object);
    const mixer = engine.buildMixer(loaded.object, loaded.animations);
    const item: SceneItem = {
      id,
      name,
      format: loaded.format,
      object: loaded.object,
      animations: loaded.animations,
      mixer,
      triangles: loaded.triangles,
      vertices: loaded.vertices,
      bones: loaded.bones,
      inspection: null,
      sceneGraph: null,
      diskPath: null,
      bytes: 0,
      ...extras,
    };
    setItems((prev) => [...prev, item]);
    setSelectedId(id);
    setSelectedMeshUuid(null);
    if (autoFrame) engine.frame(loaded.object);
    return item;
  }, [autoFrame]);

  const loadFromRemote = useCallback(async (url: string, displayName: string) => {
    if (!engineRef.current) return;
    setLoading(true);
    try {
      const loaded = await loadRemoteModel(url);
      ingestLoaded(loaded, displayName.split("/").pop() ?? displayName);
      toast.success(`Loaded ${displayName}`);
    } catch (err: unknown) {
      toast.error("CDN load failed", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, [ingestLoaded]);

  // -- File loading --------------------------------------------------------
  const addFile = useCallback(async (file: File, modelLocation?: string) => {
    if (!isSupported(file.name)) {
      toast.error(`Unsupported file: ${file.name}`);
      return;
    }
    if (!engineRef.current) return;
    setLoading(true);
    try {
      const diskPath = modelLocation ?? (file as File & { path?: string }).path;
      const resourceBaseUrl = diskPath ? resourceBaseFromModelLocation(diskPath) : undefined;
      const loaded: LoadedModel = await loadModel(file, { resourceBaseUrl });
      let inspection: GlbInspection | null = null;
      let sceneGraph: Record<string, unknown> | null = null;
      if (file.name.toLowerCase().endsWith(".glb")) {
        const buf = await file.arrayBuffer();
        inspection = inspectGlb(buf);
      }
      if (diskPath && /\.(glb|gltf)$/i.test(diskPath)) {
        try {
          const graph = await window.grudge.model.inspect(diskPath);
          if (graph?.ok) sceneGraph = graph as Record<string, unknown>;
        } catch { /* optional */ }
      }
      ingestLoaded(loaded, file.name, { inspection, sceneGraph, diskPath: diskPath ?? null, bytes: file.size });
      toast.success(`Loaded ${file.name}`, {
        description: `${loaded.triangles.toLocaleString()} triangles · ${loaded.animations.length} animation${loaded.animations.length === 1 ? "" : "s"}`,
      });
    } catch (err: any) {
      console.error("Forge3D load failed", err);
      toast.error(`Failed to load ${file.name}`, { description: err?.message ?? String(err) });
    } finally {
      setLoading(false);
    }
  }, [ingestLoaded]);

  const onPickFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files);
    arr.forEach((f) => { void addFile(f); });
  }, [addFile]);

  // -- Drag-drop -----------------------------------------------------------
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      const types = Array.from(e.dataTransfer.types);
      if (types.includes("Files")) {
        e.preventDefault();
        setDropping(true);
      }
    };
    const onDragLeave = () => setDropping(false);
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDropping(false);
      const files = e.dataTransfer?.files;
      onPickFiles(files ?? null);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [onPickFiles]);

  // -- "Open with..." path from main process ------------------------------
  useEffect(() => {
    const off = (window as any).grudge?.forge?.onOpenFile?.((info: { path: string; name: string; resourceBaseUrl?: string }) => {
      // The main process sends us a path; we read it back via fetch(file://) to get bytes.
      // To stay sandbox-safe, prefer ipc-based read.
      (window as any).grudge?.forge?.readFile?.(info.path).then((res: { name: string; bytes: ArrayBuffer; mime: string }) => {
        if (!res || !res.bytes) return;
        const file = new File([res.bytes], res.name, { type: res.mime });
        const modelLocation = info.resourceBaseUrl ?? info.path;
        void addFile(file, modelLocation);
      }).catch((err: any) => {
        toast.error("Open file failed", { description: err?.message ?? String(err) });
      });
    });
    // Also ask for any pending "initial file" the launcher captured before this page mounted.
    (window as any).grudge?.forge?.consumeInitialFile?.().then((file: { path: string; name: string; resourceBaseUrl?: string } | null) => {
      if (file) {
        (window as any).grudge?.forge?.readFile?.(file.path).then((res: any) => {
          if (res?.bytes) void addFile(new File([res.bytes], res.name, { type: res.mime }), file.resourceBaseUrl ?? file.path);
        });
      }
    });
    return () => off?.();
  }, [addFile]);

  // -- Animation control ---------------------------------------------------
  function playClip(item: SceneItem, clip: THREE.AnimationClip) {
    if (activeClip) activeClip.stop();
    if (!item.mixer) return;
    const action = item.mixer.clipAction(clip);
    action.reset().fadeIn(0.15).play();
    setActiveClip(action);
    setPaused(false);
  }

  function togglePlayPause() {
    if (!activeClip) return;
    activeClip.paused = !activeClip.paused;
    setPaused(activeClip.paused);
  }

  function stopClip() {
    if (activeClip) {
      activeClip.stop();
      setActiveClip(null);
      setPaused(false);
    }
  }

  // -- Remove + frame ------------------------------------------------------
  function removeItem(id: string) {
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target && engineRef.current) {
        engineRef.current.scene.remove(target.object);
        if (target.mixer) engineRef.current.removeMixer(target.mixer);
      }
      return prev.filter((i) => i.id !== id);
    });
    if (selectedId === id) setSelectedId(null);
    if (activeClip) stopClip();
  }

  function frameSelected() {
    if (selectedObject && engineRef.current) engineRef.current.frame(selectedObject);
    else if (selected && engineRef.current) engineRef.current.frame(selected.object);
  }

  function screenshot() {
    if (!engineRef.current) return;
    const url = engineRef.current.screenshot();
    const a = document.createElement("a");
    a.href = url;
    a.download = `forge-${Date.now()}.png`;
    a.click();
    toast.success("Screenshot saved");
  }

  // -- Export to GLB -------------------------------------------------------
  async function exportSelected() {
    if (!selected) return;
    try {
      const r = await exportToGlb(selected.object, selected.animations, selected.name.replace(/\.[^.]+$/, ""));
      downloadBlob(r.blob, r.filename);
      toast.success(`Exported ${r.filename}`, {
        description: `${formatBytes(r.bytes.byteLength)} · ${r.triangles.toLocaleString()} triangles · ${r.durationMs}ms`,
      });
    } catch (err: any) {
      toast.error("Export failed", { description: err?.message ?? String(err) });
    }
  }

  async function exportAll() {
    if (!engineRef.current || items.length === 0) return;
    const root = new THREE.Group();
    root.name = "ForgeScene";
    items.forEach((i) => root.add(i.object.clone(true)));
    try {
      const r = await exportToGlb(root, [], "forge-scene");
      downloadBlob(r.blob, r.filename);
      toast.success(`Exported full scene`, {
        description: `${items.length} entit${items.length === 1 ? "y" : "ies"} · ${formatBytes(r.bytes.byteLength)}`,
      });
    } catch (err: any) {
      toast.error("Scene export failed", { description: err?.message ?? String(err) });
    }
  }

  // -- Upload to R2 --------------------------------------------------------
  async function uploadSelectedToR2() {
    if (!selected) return;
    setBusyUpload(true);
    try {
      const r = await exportToGlb(selected.object, selected.animations, selected.name.replace(/\.[^.]+$/, ""));
      const safePrefix = r2Path.replace(/^\/+|\/+$/g, "");
      const key = `${safePrefix}/${r.filename}`;
      const signed: { ok: boolean; url?: string; error?: string } = await (window as any).grudge.cf.r2SignedUpload({
        key,
        contentType: "model/gltf-binary",
        ttlSeconds: 900,
      });
      if (!signed?.ok || !signed.url) throw new Error(signed?.error ?? "Failed to mint signed URL");
      const put = await fetch(signed.url, {
        method: "PUT",
        headers: { "content-type": "model/gltf-binary" },
        body: r.bytes,
      });
      if (!put.ok) throw new Error(`PUT ${put.status} ${put.statusText}`);
      const publicUrl: string | null = await (window as any).grudge.cf.r2PublicUrl(key);
      toast.success("Uploaded to R2", {
        description: publicUrl ? `Public URL: ${publicUrl}` : `Key: ${key}`,
      });
      // Stash on clipboard if available
      if (publicUrl) {
        try { await navigator.clipboard.writeText(publicUrl); } catch { /* ignore */ }
      }
    } catch (err: any) {
      toast.error("R2 upload failed", { description: err?.message ?? String(err) });
    } finally {
      setBusyUpload(false);
    }
  }

  // -- Background cycler ---------------------------------------------------
  const BG_PRESETS = [0x0a0e1a, 0x111418, 0x1a1a25, 0xffffff, 0x444a55];
  function cycleBackground() {
    const next = (bgIndex + 1) % BG_PRESETS.length;
    setBgIndex(next);
    if (engineRef.current) engineRef.current.scene.background = new THREE.Color(BG_PRESETS[next]);
  }

  async function initPhysics() {
    const world = new ForgeRapierWorld();
    const ok = await world.init();
    if (!ok) {
      toast.error("Rapier failed to load");
      return;
    }
    world.addGround();
    physicsRef.current = world;
    setPhysicsReady(true);
    setPhysicsBodies(0);
    toast.success("Physics ready — add objects and press Play");
  }

  function addSelectedToPhysics() {
    if (!selected || !physicsRef.current) return;
    physicsRef.current.addDynamicFromObject(selected.id, selected.object);
    setPhysicsBodies((n) => n + 1);
  }

  // ----------------------- Render ----------------------------------------
  return (
    <div className="forge3d forge-studio" style={{ height: "100%", display: "grid", gridTemplateRows: "auto 1fr", gap: 0 }}>
      <Toolbar
        gizmoMode={gizmoMode} setGizmoMode={setGizmoMode}
        transformSpace={transformSpace} setTransformSpace={setTransformSpace}
        showHelpers={showHelpers} setShowHelpers={setShowHelpers}
        autoFrame={autoFrame} setAutoFrame={setAutoFrame}
        wireframe={wireframe} setWireframe={setWireframe}
        snapOn={snapTranslate > 0}
        onToggleSnap={() => setSnapTranslate((v) => (v > 0 ? 0 : 0.5))}
        onPickFiles={() => fileInputRef.current?.click()}
        onFrame={frameSelected}
        onFrameAll={() => engineRef.current?.frameAll()}
        onScreenshot={screenshot}
        onCycleBg={cycleBackground}
        onExportSelected={exportSelected}
        onExportAll={exportAll}
        onClear={() => items.forEach((i) => removeItem(i.id))}
        canExport={selected != null}
        canExportAll={items.length > 0}
      />
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr 360px", minHeight: 0 }}>
        <Panel title="Outliner">
          <div className="forge-studio-tabs">
            <button type="button" className={`forge-studio-tab${leftTab === "scene" ? " active" : ""}`} onClick={() => setLeftTab("scene")}>
              <Layers size={12} /> Scene ({items.length})
            </button>
            <button type="button" className={`forge-studio-tab${leftTab === "assets" ? " active" : ""}`} onClick={() => setLeftTab("assets")}>
              <Box size={12} /> Assets
            </button>
          </div>
          {leftTab === "scene" ? (
            items.length === 0 ? (
              <div style={{ padding: "12px", color: "var(--muted)", fontSize: 12 }}>
                Drop GLB/FBX anywhere, browse <strong className="text-gold">Assets</strong>, or Open file.
                <div style={{ marginTop: 8, fontSize: 10, opacity: 0.8 }}>
                  Outliner shows mesh · geometry · material · tris · bones · LOD (three.js editor style).
                </div>
              </div>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {items.map((it) => (
                  <HierarchyRow
                    key={it.id} item={it}
                    selected={selectedId === it.id}
                    selectedMeshUuid={selectedMeshUuid}
                    showBones={showBones}
                    onSelect={() => { setSelectedId(it.id); setSelectedMeshUuid(null); setRightTab("object"); }}
                    onSelectNode={(uuid) => { setSelectedId(it.id); setSelectedMeshUuid(uuid); setRightTab("object"); }}
                    onRemove={() => removeItem(it.id)}
                    onFocus={() => engineRef.current?.frame(it.object)}
                  />
                ))}
              </ul>
            )
          ) : (
            <ForgeAssetBrowser
              onLoadCdnKey={(key) => void loadFromRemote(cdnKeyToUrl(key), key)}
              onLoadR2Key={(key) => void loadFromRemote(cdnUrl(key), key)}
              onApplyTexture={(url) => {
                if (selectedMesh) void applyTextureToMesh(selectedMesh, url);
                else toast.error("Select a mesh first (expand object in Scene)");
              }}
            />
          )}
          {leftTab === "scene" && items.length > 0 && (
            <div style={{ padding: "6px 10px", borderTop: "1px solid var(--line)", fontSize: 10, color: "var(--muted)" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={showBones} onChange={(e) => setShowBones(e.target.checked)} />
                Show bones in outliner
              </label>
            </div>
          )}
        </Panel>

        {/* VIEWPORT */}
        <div ref={viewportRef} style={{ position: "relative", background: "#000", minHeight: 0 }}>
          {dropping && (
            <div style={{
              position: "absolute", inset: 0, zIndex: 10,
              background: "rgba(255,198,42,0.15)",
              border: "3px dashed var(--gold)", pointerEvents: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22, color: "var(--gold)", fontWeight: 700,
            }}>
              Drop to load · {ACCEPT_ATTR}
            </div>
          )}
          {loading && (
            <div style={{
              position: "absolute", top: 12, left: 12, zIndex: 5,
              background: "rgba(15,21,48,0.85)", border: "1px solid var(--line)",
              padding: "6px 10px", borderRadius: 6, fontSize: 12, color: "var(--gold)",
            }}>
              Loading…
            </div>
          )}
          <div style={{
            position: "absolute", top: 10, right: 12, zIndex: 5,
            fontSize: 10, color: "var(--muted)", fontFamily: "ui-monospace, monospace",
            background: "rgba(15,21,48,0.78)", padding: "6px 10px", borderRadius: 6,
            border: "1px solid var(--line)", lineHeight: 1.45, textAlign: "right",
          }}>
            <div>draw {renderStats.calls} · tris {renderStats.triangles.toLocaleString()}</div>
            <div>geo {renderStats.geometries} · tex {renderStats.textures}</div>
            <div>near {clipNear} · far {clipFar >= 1000 ? `${(clipFar / 1000).toFixed(0)}k` : clipFar}</div>
          </div>
          <div style={{
            position: "absolute", bottom: 8, left: 12, zIndex: 5,
            fontSize: 10, color: "var(--muted)",
            background: "rgba(15,21,48,0.7)", padding: "4px 10px", borderRadius: 999,
            border: "1px solid var(--line)", maxWidth: "70%",
          }}>
            W/E/R gizmo · Q local/world · F focus · A frame all · X wireframe · G grid · click select · Del
          </div>
          <div style={{
            position: "absolute", bottom: 8, right: 12, zIndex: 5,
            display: "flex", gap: 6, alignItems: "center", fontSize: 11, color: "var(--muted)",
            background: "rgba(15,21,48,0.7)", padding: "4px 10px", borderRadius: 999,
            border: "1px solid var(--line)",
          }}>
            <Box size={12} />
            {items.length} object{items.length === 1 ? "" : "s"} ·
            {" "}{items.reduce((a, i) => a + i.triangles, 0).toLocaleString()} tris
            {physicsReady ? ` · phys ${physicsBodies}` : ""}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_ATTR}
            multiple
            style={{ display: "none" }}
            onChange={(e) => { onPickFiles(e.target.files); e.target.value = ""; }}
          />
        </div>

        <Panel title="Properties">
          <div className="forge-studio-tabs" style={{ flexWrap: "wrap" }}>
            {([
              ["inspect", "Inspect"],
              ["object", "Object"],
              ["camera", "Camera"],
              ["materials", "Materials"],
              ["physics", "Physics"],
            ] as const).map(([t, label]) => (
              <button key={t} type="button" className={`forge-studio-tab${rightTab === t ? " active" : ""}`} onClick={() => setRightTab(t)}>
                {t === "physics" ? <><Zap size={11} /> {label}</> : label}
              </button>
            ))}
          </div>
          {rightTab === "inspect" && (
            !selected ? (
              <div className="forge-panel-empty">Select an object to inspect animations, GLB chunks, and R2 upload.</div>
            ) : (
              <Inspector
                item={selected}
                activeClip={activeClip}
                paused={paused}
                onPlay={(clip) => playClip(selected, clip)}
                onPauseToggle={togglePlayPause}
                onStop={stopClip}
                onUploadR2={uploadSelectedToR2}
                busyUpload={busyUpload}
                r2Path={r2Path}
                setR2Path={setR2Path}
              />
            )
          )}
          {rightTab === "object" && (
            <ObjectPanel
              object={selectedObject}
              item={selected}
              onChange={() => forceTransform((n) => n + 1)}
              onFocus={() => selectedObject && engineRef.current?.frame(selectedObject)}
            />
          )}
          {rightTab === "camera" && (
            <CameraPanel
              near={clipNear} far={clipFar} fov={clipFov}
              setNear={setClipNear} setFar={setClipFar} setFov={setClipFov}
              fogKind={fogKind} setFogKind={setFogKind}
              onReset={() => {
                setClipNear(0.01);
                setClipFar(100_000);
                setClipFov(50);
                setFogKind("none");
              }}
            />
          )}
          {rightTab === "materials" && <ForgeMaterialPanel mesh={selectedMesh} />}
          {rightTab === "physics" && (
            <ForgePhysicsPanel
              physics={physicsRef.current}
              ready={physicsReady}
              playing={physicsPlaying}
              bodyCount={physicsBodies}
              onInit={() => void initPhysics()}
              onAddSelected={addSelectedToPhysics}
              onPlay={() => { physicsRef.current?.play(); setPhysicsPlaying(true); }}
              onPause={() => { physicsRef.current?.pause(); setPhysicsPlaying(false); }}
              onReset={() => { physicsRef.current?.reset(); setPhysicsPlaying(false); }}
            />
          )}
        </Panel>
      </div>
    </div>
  );
}

// ---------------------- Subcomponents ---------------------------------------

function Toolbar(props: {
  gizmoMode: GizmoMode;
  setGizmoMode: (m: GizmoMode) => void;
  transformSpace: TransformSpace;
  setTransformSpace: (s: TransformSpace) => void;
  showHelpers: boolean;
  setShowHelpers: (v: boolean) => void;
  autoFrame: boolean;
  setAutoFrame: (v: boolean) => void;
  wireframe: boolean;
  setWireframe: (v: boolean) => void;
  snapOn: boolean;
  onToggleSnap: () => void;
  onPickFiles: () => void;
  onFrame: () => void;
  onFrameAll: () => void;
  onScreenshot: () => void;
  onCycleBg: () => void;
  onExportSelected: () => void;
  onExportAll: () => void;
  onClear: () => void;
  canExport: boolean;
  canExportAll: boolean;
}) {
  const Btn = ({ active, onClick, title, children }: any) => (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: active ? "rgba(255,198,42,0.18)" : "transparent",
        color: active ? "var(--gold)" : "var(--text)",
        border: "1px solid " + (active ? "var(--gold-deep)" : "var(--line)"),
        borderRadius: 5, padding: "5px 8px", cursor: "pointer", fontSize: 12,
        display: "inline-flex", alignItems: "center", gap: 4,
      }}>
      {children}
    </button>
  );
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "8px 14px", borderBottom: "1px solid var(--line)",
      background: "var(--bg-1)", flexWrap: "wrap",
    }}>
      <Btn onClick={props.onPickFiles} title="Open file (Ctrl+O)"><FolderOpen size={14} />Open</Btn>
      <span style={{ width: 1, height: 22, background: "var(--line)" }} />
      <Btn active={props.gizmoMode === "translate"} onClick={() => props.setGizmoMode("translate")} title="Translate (W)"><Move size={14} />T</Btn>
      <Btn active={props.gizmoMode === "rotate"} onClick={() => props.setGizmoMode("rotate")} title="Rotate (E)"><RotateCcw size={14} />R</Btn>
      <Btn active={props.gizmoMode === "scale"} onClick={() => props.setGizmoMode("scale")} title="Scale (R)"><Maximize2 size={14} />S</Btn>
      <Btn
        active={props.transformSpace === "local"}
        onClick={() => props.setTransformSpace(props.transformSpace === "world" ? "local" : "world")}
        title="Local / World space (Q)"
      >
        <Crosshair size={14} />{props.transformSpace === "local" ? "Local" : "World"}
      </Btn>
      <Btn active={props.snapOn} onClick={props.onToggleSnap} title="Snap translate 0.5u / rotate 15°">Snap</Btn>
      <span style={{ width: 1, height: 22, background: "var(--line)" }} />
      <Btn onClick={props.onFrame} title="Focus selection (F)"><Focus size={14} />Focus</Btn>
      <Btn onClick={props.onFrameAll} title="Frame all (A)"><Aperture size={14} />All</Btn>
      <Btn active={props.showHelpers} onClick={() => props.setShowHelpers(!props.showHelpers)} title="Toggle grid (G)"><Grid3x3 size={14} />Grid</Btn>
      <Btn active={props.wireframe} onClick={() => props.setWireframe(!props.wireframe)} title="Wireframe (X)">Wire</Btn>
      <Btn active={props.autoFrame} onClick={() => props.setAutoFrame(!props.autoFrame)} title="Auto-frame on load"><Lightbulb size={14} />Auto</Btn>
      <Btn onClick={props.onCycleBg} title="Cycle background"><Sun size={14} />BG</Btn>
      <Btn onClick={props.onScreenshot} title="Screenshot"><Camera size={14} />PNG</Btn>
      <Btn onClick={() => void window.grudge?.forge?.popOut?.()} title="Pop out viewport"><ExternalLink size={14} />Pop-out</Btn>
      <span style={{ flex: 1 }} />
      <Btn onClick={props.onExportSelected} title="Export selected as GLB" >
        <Download size={14} />Export GLB
      </Btn>
      <Btn onClick={props.onExportAll} title="Export entire scene as GLB" >
        <FileBox size={14} />Scene GLB
      </Btn>
      <Btn onClick={props.onClear} title="Clear scene"><Trash2 size={14} />Clear</Btn>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      borderRight: "1px solid var(--line)",
      borderLeft: "1px solid var(--line)",
      background: "var(--bg-1)",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--line)", color: "var(--gold)", fontWeight: 700, fontSize: 12 }}>
        {title}
      </div>
      <div style={{ overflow: "auto", flex: 1 }}>{children}</div>
    </div>
  );
}

function HierarchyRow({ item, selected, selectedMeshUuid, showBones, onSelect, onSelectNode, onRemove, onFocus }:
  {
    item: SceneItem; selected: boolean; selectedMeshUuid: string | null; showBones: boolean;
    onSelect: () => void; onSelectNode: (uuid: string) => void; onRemove: () => void; onFocus: () => void;
  }) {
  const [open, setOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const nodes = useMemo(
    () => flattenMeshHierarchy(item.object, { includeBones: showBones, maxDepth: 40 }),
    [item.object, showBones],
  );
  const stats = useMemo(() => aggregateMeshStats(item.object), [item.object]);

  const visibleNodes = useMemo(() => {
    const out: MeshBreakdown[] = [];
    const path: MeshBreakdown[] = [];
    for (const n of nodes) {
      while (path.length && path[path.length - 1]!.depth >= n.depth) path.pop();
      const blocked = path.some((a) => collapsed.has(a.uuid));
      if (!blocked) out.push(n);
      path.push(n);
    }
    return out;
  }, [nodes, collapsed]);

  function toggleCollapse(uuid: string, e: React.MouseEvent) {
    e.stopPropagation();
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  }

  return (
    <li>
      <div
        onClick={onSelect}
        onDoubleClick={(e) => { e.stopPropagation(); onFocus(); }}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: "5px 8px", cursor: "pointer", fontSize: 12,
          background: selected && !selectedMeshUuid ? "rgba(255,198,42,0.10)" : "transparent",
          borderLeft: selected && !selectedMeshUuid ? "2px solid var(--gold)" : "2px solid transparent",
        }}>
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
          style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0, display: "flex" }}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span style={{ width: 16, textAlign: "center" }}>{ICON_BY_FORMAT[item.format] ?? "🔷"}</span>
        <span style={{ flex: 1, color: selected ? "var(--gold)" : "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.name}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onFocus(); }}
          title="Focus (F)"
          style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", padding: 2 }}
        ><Focus size={12} /></button>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove"
          style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", padding: 2 }}
        ><Trash2 size={12} /></button>
      </div>
      {open && (
        <div style={{ paddingBottom: 6, fontSize: 10, color: "var(--muted)" }}>
          <div style={{ padding: "2px 10px 6px 28px", lineHeight: 1.4 }}>
            <strong style={{ color: "var(--text)" }}>{stats.meshes}</strong> mesh ·{" "}
            <strong style={{ color: "var(--text)" }}>{stats.triangles.toLocaleString()}</strong> tris ·{" "}
            <strong style={{ color: "var(--text)" }}>{stats.vertices.toLocaleString()}</strong> vtx ·{" "}
            {stats.materials} mat
            {stats.bones > 0 ? ` · ${stats.bones} bones` : ""}
            {stats.lods > 0 ? ` · ${stats.lods} LOD` : ""}
            {item.animations.length > 0 ? ` · ${item.animations.length} clips` : ""}
          </div>
          {visibleNodes.slice(0, 500).map((m) => {
            const isSel = selectedMeshUuid === m.uuid;
            const kindColor = KIND_COLOR[m.kind] ?? "#ccc";
            return (
              <div
                key={m.uuid}
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onSelectNode(m.uuid); }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onSelectNode(m.uuid);
                  // focus this node
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 8px 2px 0",
                  paddingLeft: 12 + m.depth * 12,
                  cursor: "pointer",
                  background: isSel ? "rgba(255,198,42,0.12)" : "transparent",
                  borderLeft: isSel ? "2px solid var(--gold)" : "2px solid transparent",
                  opacity: m.visible ? 1 : 0.45,
                }}
              >
                {m.hasChildren ? (
                  <button
                    type="button"
                    onClick={(e) => toggleCollapse(m.uuid, e)}
                    style={{ background: "none", border: "none", color: "var(--muted)", padding: 0, cursor: "pointer", width: 14 }}
                  >
                    {collapsed.has(m.uuid) ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                  </button>
                ) : (
                  <span style={{ width: 14 }} />
                )}
                <span
                  title={m.kind}
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: kindColor,
                    minWidth: 28,
                    textTransform: "uppercase",
                  }}
                >
                  {m.kind === "SkinnedMesh" ? "Skin" : m.kind.slice(0, 4)}
                </span>
                <span style={{
                  flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  color: isSel ? "var(--gold)" : "var(--text)", fontSize: 11,
                }}>
                  {m.name}
                </span>
                {m.geometryName && (
                  <span style={{ color: "var(--muted)", fontSize: 9, maxWidth: 72, overflow: "hidden", textOverflow: "ellipsis" }} title={m.geometryName}>
                    {m.geometryName}
                  </span>
                )}
                {m.materialNames[0] && (
                  <span style={{ color: "#8af", fontSize: 9, maxWidth: 64, overflow: "hidden", textOverflow: "ellipsis" }} title={m.materialNames.join(", ")}>
                    {m.materialNames[0]}
                  </span>
                )}
                {m.triangles > 0 && (
                  <span style={{ color: "var(--muted)", fontSize: 9, fontVariantNumeric: "tabular-nums" }}>
                    {m.triangles >= 1000 ? `${(m.triangles / 1000).toFixed(1)}k` : m.triangles}
                  </span>
                )}
                <button
                  type="button"
                  title={m.visible ? "Hide" : "Show"}
                  onClick={(e) => {
                    e.stopPropagation();
                    m.object.visible = !m.object.visible;
                    onSelectNode(m.uuid);
                  }}
                  style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0 }}
                >
                  {m.visible ? <Eye size={10} /> : <EyeOff size={10} />}
                </button>
              </div>
            );
          })}
          {nodes.length > 500 && (
            <div style={{ padding: "4px 12px", fontSize: 10 }}>…{nodes.length - 500} more nodes</div>
          )}
        </div>
      )}
    </li>
  );
}

function ObjectPanel({
  object, item, onChange, onFocus,
}: {
  object: THREE.Object3D | null;
  item: SceneItem | null;
  onChange: () => void;
  onFocus: () => void;
}) {
  if (!object) {
    return <div className="forge-panel-empty">Click a node in the outliner or viewport to edit transform & mesh stats.</div>;
  }
  const isMesh = (object as THREE.Mesh).isMesh;
  const mesh = isMesh ? (object as THREE.Mesh) : null;
  const p = object.position;
  const r = object.rotation;
  const s = object.scale;
  const setNum = (axis: "x" | "y" | "z", target: THREE.Vector3 | THREE.Euler, v: number) => {
    target[axis] = v;
    object.updateMatrixWorld(true);
    onChange();
  };

  return (
    <div style={{ padding: 10, fontSize: 12 }}>
      <SectionTitle>Selection</SectionTitle>
      <Field label="Name"><span style={{ color: "var(--gold)" }}>{object.name || object.type}</span></Field>
      <Field label="Type">{object.type}</Field>
      <Field label="UUID"><span style={{ fontSize: 9 }}>{object.uuid.slice(0, 13)}…</span></Field>
      <Field label="Visible">{object.visible ? "yes" : "no"}</Field>
      <div style={{ display: "flex", gap: 6, margin: "8px 0" }}>
        <button className="btn ghost" style={{ flex: 1, fontSize: 11 }} onClick={onFocus}><Focus size={12} /> Focus</button>
        <button className="btn ghost" style={{ flex: 1, fontSize: 11 }} onClick={() => { object.visible = !object.visible; onChange(); }}>
          {object.visible ? <><EyeOff size={12} /> Hide</> : <><Eye size={12} /> Show</>}
        </button>
      </div>

      <SectionTitle>Transform</SectionTitle>
      <TransformInputs label="Position" x={p.x} y={p.y} z={p.z} onChange={(ax, v) => setNum(ax, p, v)} />
      <TransformInputs label="Rotation" x={r.x} y={r.y} z={r.z} onChange={(ax, v) => setNum(ax, r, v)} step={0.01} />
      <TransformInputs label="Scale" x={s.x} y={s.y} z={s.z} onChange={(ax, v) => setNum(ax, s, v)} step={0.01} />

      {mesh && (
        <>
          <SectionTitle>Mesh breakdown</SectionTitle>
          <Field label="Geometry">{mesh.geometry?.name || mesh.geometry?.type || "—"}</Field>
          <Field label="Vertices">{(mesh.geometry?.getAttribute("position")?.count ?? 0).toLocaleString()}</Field>
          <Field label="Triangles">{(
            mesh.geometry?.index
              ? Math.floor(mesh.geometry.index.count / 3)
              : Math.floor((mesh.geometry?.getAttribute("position")?.count ?? 0) / 3)
          ).toLocaleString()}</Field>
          <Field label="Materials">
            {Array.isArray(mesh.material)
              ? mesh.material.map((m) => m.name || m.type).join(", ")
              : (mesh.material?.name || mesh.material?.type || "—")}
          </Field>
          {(mesh as THREE.SkinnedMesh).isSkinnedMesh && (
            <Field label="Bones">{(mesh as THREE.SkinnedMesh).skeleton?.bones?.length ?? 0}</Field>
          )}
          <Field label="Morph targets">{mesh.geometry?.morphAttributes?.position?.length ?? 0}</Field>
          <Field label="Cast shadow">{mesh.castShadow ? "yes" : "no"}</Field>
          <Field label="Receive shadow">{mesh.receiveShadow ? "yes" : "no"}</Field>
        </>
      )}

      {item && (
        <>
          <SectionTitle>Asset</SectionTitle>
          <Field label="File">{item.name}</Field>
          <Field label="Format">{item.format.toUpperCase()}</Field>
          <Field label="Root tris">{item.triangles.toLocaleString()}</Field>
        </>
      )}
    </div>
  );
}

function TransformInputs({
  label, x, y, z, onChange, step = 0.001,
}: {
  label: string; x: number; y: number; z: number;
  onChange: (axis: "x" | "y" | "z", v: number) => void;
  step?: number;
}) {
  const inp = (axis: "x" | "y" | "z", val: number, color: string) => (
    <input
      type="number"
      step={step}
      value={Number.isFinite(val) ? Number(val.toFixed(4)) : 0}
      onChange={(e) => onChange(axis, parseFloat(e.target.value) || 0)}
      style={{
        width: 64, fontSize: 10, padding: "2px 4px",
        border: `1px solid ${color}44`, background: "var(--bg-2)", color: "var(--text)", borderRadius: 3,
      }}
    />
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4, fontSize: 11 }}>
      <span style={{ width: 52, color: "var(--muted)" }}>{label}</span>
      {inp("x", x, "#ff6b6b")}
      {inp("y", y, "#6bff6b")}
      {inp("z", z, "#6b9eff")}
    </div>
  );
}

function CameraPanel(props: {
  near: number; far: number; fov: number;
  setNear: (n: number) => void; setFar: (n: number) => void; setFov: (n: number) => void;
  fogKind: "none" | "linear" | "exp2"; setFogKind: (k: "none" | "linear" | "exp2") => void;
  onReset: () => void;
}) {
  return (
    <div style={{ padding: 10, fontSize: 12 }}>
      <SectionTitle>Clip planes</SectionTitle>
      <p style={{ color: "var(--muted)", fontSize: 10, marginBottom: 8 }}>
        Matches three.js editor camera near/far. Large maps need far ≥ 10k–100k; tiny props need near ≤ 0.01.
      </p>
      <label style={{ display: "block", marginBottom: 6, fontSize: 11, color: "var(--muted)" }}>
        Near
        <input type="number" min={0.0001} step={0.001} value={props.near}
          onChange={(e) => props.setNear(Math.max(0.0001, Number(e.target.value) || 0.01))}
          style={{ width: "100%", marginTop: 2, fontSize: 12 }} />
      </label>
      <label style={{ display: "block", marginBottom: 6, fontSize: 11, color: "var(--muted)" }}>
        Far
        <input type="number" min={1} step={100} value={props.far}
          onChange={(e) => props.setFar(Math.max(1, Number(e.target.value) || 1000))}
          style={{ width: "100%", marginTop: 2, fontSize: 12 }} />
      </label>
      <label style={{ display: "block", marginBottom: 6, fontSize: 11, color: "var(--muted)" }}>
        FOV
        <input type="number" min={10} max={120} step={1} value={props.fov}
          onChange={(e) => props.setFov(Math.min(120, Math.max(10, Number(e.target.value) || 50)))}
          style={{ width: "100%", marginTop: 2, fontSize: 12 }} />
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
        {[
          { label: "Prop", n: 0.01, f: 500 },
          { label: "Character", n: 0.05, f: 2000 },
          { label: "Arena", n: 0.1, f: 10_000 },
          { label: "World", n: 0.5, f: 100_000 },
        ].map((p) => (
          <button key={p.label} type="button" className="btn ghost" style={{ fontSize: 10, padding: "3px 8px" }}
            onClick={() => { props.setNear(p.n); props.setFar(p.f); }}>
            {p.label}
          </button>
        ))}
      </div>

      <SectionTitle>Fog</SectionTitle>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {(["none", "linear", "exp2"] as const).map((k) => (
          <button key={k} type="button" className={`btn ghost${props.fogKind === k ? "" : ""}`}
            style={{
              flex: 1, fontSize: 10, padding: "4px",
              borderColor: props.fogKind === k ? "var(--gold)" : undefined,
              color: props.fogKind === k ? "var(--gold)" : undefined,
            }}
            onClick={() => props.setFogKind(k)}>
            {k === "exp2" ? "Exp2" : k[0]!.toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>

      <button type="button" className="btn ghost" style={{ width: "100%", fontSize: 11 }} onClick={props.onReset}>
        Reset camera defaults
      </button>
    </div>
  );
}

function Inspector(props: {
  item: SceneItem;
  activeClip: THREE.AnimationAction | null;
  paused: boolean;
  onPlay: (clip: THREE.AnimationClip) => void;
  onPauseToggle: () => void;
  onStop: () => void;
  onUploadR2: () => void;
  busyUpload: boolean;
  r2Path: string;
  setR2Path: (s: string) => void;
}) {
  const { item, activeClip, paused, onPlay, onPauseToggle, onStop, onUploadR2, busyUpload, r2Path, setR2Path } = props;
  const [, force] = useState(0);
  // Re-render every 200ms while playing so clip time updates.
  useEffect(() => {
    if (!activeClip) return;
    const id = window.setInterval(() => force((c) => c + 1), 200);
    return () => window.clearInterval(id);
  }, [activeClip]);

  const t = item.object.position;
  const r = item.object.rotation;
  const s = item.object.scale;

  return (
    <div style={{ padding: 10, fontSize: 12, color: "var(--text)" }}>
      <Field label="Name"><span style={{ color: "var(--gold)" }}>{item.name}</span></Field>
      <Field label="Format">{item.format.toUpperCase()}</Field>
      <Field label="Size">{formatBytes(item.bytes)}</Field>
      <Field label="Triangles">{item.triangles.toLocaleString()}</Field>
      <Field label="Vertices">{item.vertices.toLocaleString()}</Field>
      {item.bones > 0 && <Field label="Bones">{item.bones}</Field>}

      <SectionTitle>Transform</SectionTitle>
      <VecRow label="Pos" x={t.x} y={t.y} z={t.z} />
      <VecRow label="Rot" x={r.x} y={r.y} z={r.z} />
      <VecRow label="Scl" x={s.x} y={s.y} z={s.z} />

      {item.sceneGraph && (item.sceneGraph as any).stats && (
        <>
          <SectionTitle>Scene graph</SectionTitle>
          <Field label="Nodes">{(item.sceneGraph as any).stats.nodeCount}</Field>
          <Field label="Meshes">{(item.sceneGraph as any).stats.meshCount}</Field>
          <Field label="Materials">{(item.sceneGraph as any).stats.materialCount}</Field>
          <Field label="Animations">{(item.sceneGraph as any).stats.animationCount}</Field>
          {(item.sceneGraph as any).animations?.length > 0 && (
            <Field label="Clips">
              <div style={{ fontSize: 10, color: "var(--muted)" }}>
                {(item.sceneGraph as any).animations.map((a: any) => a.name).join(", ")}
              </div>
            </Field>
          )}
        </>
      )}

      {item.inspection && (
        <>
          <SectionTitle>GLB Container</SectionTitle>
          <Field label="Magic">{item.inspection.magic}</Field>
          <Field label="Version">{item.inspection.version}</Field>
          <Field label="JSON chunk">{formatBytes(item.inspection.jsonLength)}</Field>
          <Field label="BIN chunk">{formatBytes(item.inspection.binLength)}</Field>
          {item.inspection.generator && <Field label="Generator">{item.inspection.generator}</Field>}
          {item.inspection.extensionsUsed.length > 0 && (
            <Field label="Extensions">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {item.inspection.extensionsUsed.map((e) => (
                  <span key={e} className="badge">{e}</span>
                ))}
              </div>
            </Field>
          )}
        </>
      )}

      {item.animations.length > 0 && (
        <>
          <SectionTitle>Animations ({item.animations.length})</SectionTitle>
          <div style={{ maxHeight: 160, overflow: "auto", border: "1px solid var(--line)", borderRadius: 4, padding: 4 }}>
            {item.animations.map((clip) => {
              const isActive = activeClip?.getClip() === clip;
              return (
                <div key={clip.uuid}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "4px 6px", borderRadius: 4,
                    background: isActive ? "rgba(255,198,42,0.10)" : "transparent",
                  }}>
                  <button
                    onClick={() => isActive ? onPauseToggle() : onPlay(clip)}
                    style={{ background: "transparent", border: "none", color: "var(--gold)", cursor: "pointer" }}
                    title={isActive ? (paused ? "Resume" : "Pause") : "Play"}
                  >
                    {isActive && !paused ? <Pause size={12} /> : <Play size={12} />}
                  </button>
                  <span style={{ flex: 1, color: isActive ? "var(--gold)" : "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {clip.name}
                  </span>
                  <span style={{ color: "var(--muted)", fontSize: 10 }}>{clip.duration.toFixed(2)}s</span>
                </div>
              );
            })}
          </div>
          {activeClip && (
            <div style={{ marginTop: 4, display: "flex", gap: 4 }}>
              <button className="btn ghost" style={{ flex: 1, fontSize: 11, padding: "4px 8px" }} onClick={onPauseToggle}>
                {paused ? "Resume" : "Pause"}
              </button>
              <button className="btn ghost" style={{ flex: 1, fontSize: 11, padding: "4px 8px" }} onClick={onStop}>Stop</button>
            </div>
          )}
        </>
      )}

      <SectionTitle>Object Storage (R2)</SectionTitle>
      <div style={{ marginBottom: 6 }}>
        <label style={{ color: "var(--muted)", fontSize: 11, marginBottom: 2, display: "block" }}>Prefix (key path)</label>
        <input
          value={r2Path}
          onChange={(e) => setR2Path(e.target.value)}
          placeholder="user-uploads/forge"
          style={{ width: "100%", fontSize: 11 }}
        />
      </div>
      <button
        className="btn"
        onClick={onUploadR2}
        disabled={busyUpload}
        style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12 }}
      >
        <UploadCloud size={14} /> {busyUpload ? "Uploading…" : "Convert → GLB → Upload"}
      </button>
      <div style={{ color: "var(--muted)", fontSize: 10, marginTop: 6 }}>
        Uploads via signed PUT. Public URL is copied to your clipboard when available.
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px dotted var(--line)" }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ textAlign: "right", maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: "var(--gold)", fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", margin: "10px 0 4px" }}>
      {children}
    </div>
  );
}

function VecRow({ label, x, y, z }: { label: string; x: number; y: number; z: number }) {
  const fmt = (v: number) => v.toFixed(2).replace(/\.?0+$/, "");
  return (
    <div style={{ display: "flex", gap: 4, fontSize: 11, alignItems: "center" }}>
      <span style={{ color: "var(--muted)", width: 28 }}>{label}</span>
      <span style={{ color: "#ff6b6b", width: 60, textAlign: "right" }}>{fmt(x)}</span>
      <span style={{ color: "#6bff6b", width: 60, textAlign: "right" }}>{fmt(y)}</span>
      <span style={{ color: "#6b9eff", width: 60, textAlign: "right" }}>{fmt(z)}</span>
    </div>
  );
}
