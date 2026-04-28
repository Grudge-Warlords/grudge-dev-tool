import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { toast } from "sonner";
import {
  Move, RotateCcw, Maximize2, Camera, Download, UploadCloud,
  Play, Pause, FileBox, Trash2, ChevronRight, ChevronDown, Box,
  Lightbulb, Grid3x3, Sun, FolderOpen,
} from "lucide-react";
import { SceneEngine, type GizmoMode } from "../lib/forge/sceneEngine";
import { loadModel, type LoadedModel, isSupported } from "../lib/forge/loaders";
import { exportToGlb, downloadBlob, ACCEPT_ATTR } from "../lib/forge/converters";
import { inspectGlb, formatBytes, type GlbInspection } from "../lib/forge/glbInspect";

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
  const [r2Path, setR2Path] = useState("user-uploads/forge");
  const [busyUpload, setBusyUpload] = useState(false);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);

  // -- Engine bootstrap ----------------------------------------------------
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

  // -- File loading --------------------------------------------------------
  const addFile = useCallback(async (file: File) => {
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
      };
      setItems((prev) => [...prev, item]);
      setSelectedId(id);
      if (autoFrame) engineRef.current.frame(loaded.object);
      toast.success(`Loaded ${file.name}`, {
        description: `${loaded.triangles.toLocaleString()} triangles · ${loaded.animations.length} animation${loaded.animations.length === 1 ? "" : "s"}`,
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
        void addFile(file);
      }).catch((err: any) => {
        toast.error("Open file failed", { description: err?.message ?? String(err) });
      });
    });
    // Also ask for any pending "initial file" the launcher captured before this page mounted.
    (window as any).grudge?.forge?.consumeInitialFile?.().then((file: { path: string; name: string } | null) => {
      if (file) {
        (window as any).grudge?.forge?.readFile?.(file.path).then((res: any) => {
          if (res?.bytes) void addFile(new File([res.bytes], res.name, { type: res.mime }));
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
      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr 320px", minHeight: 0 }}>
        {/* HIERARCHY */}
        <Panel title={`Scene (${items.length})`}>
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

        {/* INSPECTOR */}
        <Panel title="Inspector">
          {!selected ? (
            <div style={{ padding: 12, color: "var(--muted)", fontSize: 12 }}>
              Select an object in the hierarchy to inspect it.
            </div>
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
          {item.bones > 0 && <div>Bones: {item.bones}</div>}
          {item.animations.length > 0 && <div>Clips: {item.animations.length}</div>}
        </div>
      )}
    </li>
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
