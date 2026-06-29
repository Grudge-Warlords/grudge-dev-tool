import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { toast } from "sonner";
import {
  Move, RotateCcw, Maximize2, Camera, Download,
  FileBox, Trash2, ChevronRight, ChevronDown, Box,
  Lightbulb, Grid3x3, Sun, FolderOpen,
} from "lucide-react";
import { SceneEngine, type GizmoMode } from "../lib/forge/sceneEngine";
import { loadModel, type LoadedModel, isSupported } from "../lib/forge/loaders";
import { exportToGlb, downloadBlob, ACCEPT_ATTR } from "../lib/forge/converters";
import { inspectGlb, formatBytes, type GlbInspection } from "../lib/forge/glbInspect";
import {
  captureRestPose,
  DEFAULT_BODY_MORPH,
  type BodyMorphConfig,
  type RestPoseEntry,
} from "../lib/forge/boneAliases";
import { inspectSceneRig, type RigInspectResult } from "../lib/forge/rigInspect";
import {
  DEFAULT_FORGE_ANIM,
  applyLoopMode,
  crossfadeTo,
  type ForgeAnimSettings,
} from "../lib/forge/forgeAnimation";
import ForgeWorkbench from "../components/ForgeWorkbench";
import type { StoreCategory } from "../../shared/fleetGames";

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
  bytes: number;
  rig: RigInspectResult;
  bodyMorph: BodyMorphConfig;
  sourceRest: Map<string, RestPoseEntry> | null;
  diskPath: string | null;
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
  const [r2Path, setR2Path] = useState("models/");
  const [busyUpload, setBusyUpload] = useState(false);
  const [fleetPrefixes, setFleetPrefixes] = useState<Array<{ id: string; label: string; prefix: string }>>([]);
  const [animSettings, setAnimSettings] = useState<ForgeAnimSettings>(DEFAULT_FORGE_ANIM);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);

  // -- Engine bootstrap ----------------------------------------------------
  useEffect(() => {
    void window.grudge.fleet.storeCategories().then((cats: StoreCategory[] | null | undefined) => {
      setFleetPrefixes((cats ?? []).slice(0, 8).map((c) => ({
        id: c.id, label: c.label, prefix: c.prefix,
      })));
    });
  }, []);

  async function openFleetSample(prefix: string) {
    try {
      const res = await window.grudge.os.list({ prefix, delimiter: "/", limit: 50 });
      const model = (res.items ?? []).find((it: { name: string }) =>
        /\.(glb|gltf)$/i.test(it.name),
      );
      if (!model) {
        toast.info("No GLB in prefix yet", { description: prefix });
        void window.grudge.app.openRoute("/library");
        return;
      }
      const url: string = await window.grudge.cf.r2PublicUrl(model.name);
      await window.grudge.forge.openRemote(url);
      toast.success(`Loaded ${model.name.split("/").pop()}`);
    } catch (e: any) {
      toast.error("Fleet asset open failed", { description: e?.message });
    }
  }

  useEffect(() => {
    if (!viewportRef.current) return;
    const engine = new SceneEngine(viewportRef.current, {
      background: 0x0a0e1a,
      showGrid: true,
      showAxes: true,
      hdri: true,
    });
    engineRef.current = engine;
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
    if (!engineRef.current) return;
    if (selected) engineRef.current.attach(selected.object);
    else engineRef.current.detach();
  }, [selected]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.timeScale = animSettings.timeScale;
  }, [animSettings.timeScale]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    for (const it of items) {
      const show = selected?.id === it.id && animSettings.showSkeleton && it.bones > 0;
      engine.setSkeletonHelper(it.object, show);
    }
  }, [items, selected, animSettings.showSkeleton]);

  // -- File loading --------------------------------------------------------
  const addFile = useCallback(async (file: File, diskPath: string | null = null) => {
    if (!isSupported(file.name)) {
      toast.error(`Unsupported file: ${file.name}`);
      return;
    }
    if (!engineRef.current) return;
    setLoading(true);
    try {
      const loaded: LoadedModel = await loadModel(file);
      // Inspect GLB binary container if applicable.
      let inspection: GlbInspection | null = null;
      if (file.name.toLowerCase().endsWith(".glb")) {
        const buf = await file.arrayBuffer();
        inspection = inspectGlb(buf);
      }
      const id = `e${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`;
      loaded.object.userData.itemId = id;
      loaded.object.traverse((n) => { (n as THREE.Mesh).castShadow = true; (n as THREE.Mesh).receiveShadow = true; });
      engineRef.current.scene.add(loaded.object);
      const mixer = engineRef.current.buildMixer(loaded.object, loaded.animations);
      const rig = inspectSceneRig(loaded.object);
      const sourceRest = loaded.bones > 0 ? captureRestPose(loaded.object) : null;
      const item: SceneItem = {
        id,
        name: file.name,
        format: loaded.format,
        object: loaded.object,
        animations: loaded.animations,
        mixer,
        triangles: loaded.triangles,
        vertices: loaded.vertices,
        bones: loaded.bones,
        inspection,
        bytes: file.size,
        rig,
        bodyMorph: { ...DEFAULT_BODY_MORPH },
        sourceRest,
        diskPath: diskPath ?? (() => {
          try { return window.grudge.files.getPathForFile(file) || null; } catch { return null; }
        })(),
      };
      setItems((prev) => [...prev, item]);
      setSelectedId(id);
      if (autoFrame) engineRef.current.frame(loaded.object);
      const rigHint = rig.fingerprintLabel ? ` · ${rig.fingerprintLabel}` : rig.boneCount > 0 ? ` · ${rig.boneCount} bones` : "";
      toast.success(`Loaded ${file.name}`, {
        description: `${loaded.triangles.toLocaleString()} triangles · ${loaded.animations.length} clip${loaded.animations.length === 1 ? "" : "s"}${rigHint}`,
      });
    } catch (err: any) {
      console.error("Forge3D load failed", err);
      toast.error(`Failed to load ${file.name}`, { description: err?.message ?? String(err) });
    } finally {
      setLoading(false);
    }
  }, [autoFrame]);

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
    const off = (window as any).grudge?.forge?.onOpenFile?.((info: { path: string; name: string }) => {
      // The main process sends us a path; we read it back via fetch(file://) to get bytes.
      // To stay sandbox-safe, prefer ipc-based read.
      (window as any).grudge?.forge?.readFile?.(info.path).then((res: { name: string; bytes: ArrayBuffer; mime: string }) => {
        if (!res || !res.bytes) return;
        const file = new File([res.bytes], res.name, { type: res.mime });
        void addFile(file, info.path);
      }).catch((err: any) => {
        toast.error("Open file failed", { description: err?.message ?? String(err) });
      });
    });
    // Also ask for any pending "initial file" the launcher captured before this page mounted.
    (window as any).grudge?.forge?.consumeInitialFile?.().then((file: { path: string; name: string } | null) => {
      if (file) {
        (window as any).grudge?.forge?.readFile?.(file.path).then((res: any) => {
          if (res?.bytes) void addFile(new File([res.bytes], res.name, { type: res.mime }), file.path);
        });
      }
    });
    return () => off?.();
  }, [addFile]);

  function mergeAnimations(itemId: string, clips: THREE.AnimationClip[]) {
    setItems((prev) => prev.map((it) => {
      if (it.id !== itemId) return it;
      if (it.mixer && engineRef.current) engineRef.current.removeMixer(it.mixer);
      const mixer = engineRef.current?.buildMixer(it.object, clips) ?? null;
      return { ...it, animations: clips, mixer };
    }));
    toast.success(`Merged ${clips.length} animation clip${clips.length === 1 ? "" : "s"}`);
  }

  function updateBodyMorph(itemId: string, morph: BodyMorphConfig) {
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, bodyMorph: morph } : it)));
  }

  // -- Animation control ---------------------------------------------------
  function playClip(item: SceneItem, clip: THREE.AnimationClip) {
    if (!item.mixer) return;
    const action = item.mixer.clipAction(clip);
    applyLoopMode(action, animSettings.loop);
    crossfadeTo(activeClip, action, animSettings.crossfadeMs / 1000);
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
        engineRef.current.removeSkeletonHelper(target.object);
        engineRef.current.scene.remove(target.object);
        if (target.mixer) engineRef.current.removeMixer(target.mixer);
      }
      return prev.filter((i) => i.id !== id);
    });
    if (selectedId === id) setSelectedId(null);
    if (activeClip) stopClip();
  }

  function frameSelected() {
    if (selected && engineRef.current) engineRef.current.frame(selected.object);
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

  // ----------------------- Render ----------------------------------------
  return (
    <div className="forge3d" style={{ height: "100%", display: "grid", gridTemplateRows: "auto 1fr", gap: 0 }}>
      <Toolbar
        gizmoMode={gizmoMode} setGizmoMode={setGizmoMode}
        showHelpers={showHelpers} setShowHelpers={setShowHelpers}
        autoFrame={autoFrame} setAutoFrame={setAutoFrame}
        onPickFiles={() => fileInputRef.current?.click()}
        onFrame={frameSelected}
        onScreenshot={screenshot}
        onCycleBg={cycleBackground}
        onExportSelected={exportSelected}
        onExportAll={exportAll}
        onClear={() => items.forEach((i) => removeItem(i.id))}
        canExport={selected != null}
        canExportAll={items.length > 0}
      />
      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr 360px", minHeight: 0 }}>
        {/* HIERARCHY */}
        <Panel title={`Scene (${items.length})`}>
          {fleetPrefixes.length > 0 && (
            <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ fontSize: 10, color: "var(--gold)", fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>
                Fleet resources
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {fleetPrefixes.map((c) => (
                  <button
                    key={c.id}
                    className="btn ghost"
                    style={{ fontSize: 10, padding: "2px 6px" }}
                    title={c.prefix}
                    onClick={() => openFleetSample(c.prefix)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <button
                className="btn ghost text-[10px] mt-2 w-full"
                onClick={() => window.grudge.app.openRoute("/library")}
              >
                Open Grudge Store
              </button>
            </div>
          )}
          {items.length === 0 ? (
            <div style={{ padding: "12px", color: "var(--muted)", fontSize: 12 }}>
              Drop a 3D file anywhere on this window, or click <strong className="text-gold">+ Open file</strong>.
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {items.map((it) => (
                <HierarchyRow
                  key={it.id} item={it}
                  selected={selectedId === it.id}
                  onSelect={() => setSelectedId(it.id)}
                  onRemove={() => removeItem(it.id)}
                />
              ))}
            </ul>
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
            position: "absolute", bottom: 8, right: 12, zIndex: 5,
            display: "flex", gap: 6, alignItems: "center", fontSize: 11, color: "var(--muted)",
            background: "rgba(15,21,48,0.7)", padding: "4px 10px", borderRadius: 999,
            border: "1px solid var(--line)",
          }}>
            <Box size={12} />
            {items.length} object{items.length === 1 ? "" : "s"} ·
            {" "}{items.reduce((a, i) => a + i.triangles, 0).toLocaleString()} tris
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

        {/* GRUDGE WORKBENCH — rig / retarget / morph / export */}
        <Panel title="Grudge Workbench">
          {!selected ? (
            <div style={{ padding: 12, color: "var(--muted)", fontSize: 12 }}>
              Select a model to inspect rig, retarget animations, apply body morph, or upload to fleet storage.
            </div>
          ) : (
            <ForgeWorkbench
              item={selected}
              allItems={items}
              animSettings={animSettings}
              onAnimSettings={setAnimSettings}
              onBodyMorph={(m) => updateBodyMorph(selected.id, m)}
              onAnimationsMerged={(clips) => mergeAnimations(selected.id, clips)}
              activeClip={activeClip}
              paused={paused}
              onPlay={(clip) => playClip(selected, clip)}
              onPauseToggle={togglePlayPause}
              onStop={stopClip}
              r2Path={r2Path}
              setR2Path={setR2Path}
              onUploadR2={uploadSelectedToR2}
              busyUpload={busyUpload}
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
  showHelpers: boolean;
  setShowHelpers: (v: boolean) => void;
  autoFrame: boolean;
  setAutoFrame: (v: boolean) => void;
  onPickFiles: () => void;
  onFrame: () => void;
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
      <span style={{ width: 1, height: 22, background: "var(--line)" }} />
      <Btn onClick={props.onFrame} title="Frame selection (F)"><Box size={14} />Frame</Btn>
      <Btn active={props.showHelpers} onClick={() => props.setShowHelpers(!props.showHelpers)} title="Toggle grid"><Grid3x3 size={14} />Grid</Btn>
      <Btn active={props.autoFrame} onClick={() => props.setAutoFrame(!props.autoFrame)} title="Auto-frame on load"><Lightbulb size={14} />Auto</Btn>
      <Btn onClick={props.onCycleBg} title="Cycle background"><Sun size={14} />BG</Btn>
      <Btn onClick={props.onScreenshot} title="Screenshot"><Camera size={14} />PNG</Btn>
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

function HierarchyRow({ item, selected, onSelect, onRemove }:
  { item: SceneItem; selected: boolean; onSelect: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div
        onClick={onSelect}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: "5px 8px", cursor: "pointer", fontSize: 12,
          background: selected ? "rgba(255,198,42,0.10)" : "transparent",
          borderLeft: selected ? "2px solid var(--gold)" : "2px solid transparent",
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
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove"
          style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", padding: 2 }}
        ><Trash2 size={12} /></button>
      </div>
      {open && (
        <div style={{ paddingLeft: 32, paddingBottom: 4, fontSize: 11, color: "var(--muted)" }}>
          <div>Triangles: <strong>{item.triangles.toLocaleString()}</strong></div>
          <div>Vertices: {item.vertices.toLocaleString()}</div>
          {item.bones > 0 && <div>Bones: {item.bones}{item.rig.fingerprintLabel ? ` (${item.rig.fingerprintLabel})` : ""}</div>}
          {item.animations.length > 0 && <div>Clips: {item.animations.length}</div>}
        </div>
      )}
    </li>
  );
}


