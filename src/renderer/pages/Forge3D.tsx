import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { toast } from "sonner";
import {
  Move, RotateCcw, Maximize2, Camera, Download,
  FileBox, Trash2, ChevronRight, ChevronDown, Box,
  Lightbulb, Grid3x3, Sun, FolderOpen, Save, FolderInput, Undo2, Redo2, Plus,
  Paintbrush, PaintBucket, Wrench, Mountain, Sparkles, MousePointer2,
  Copy, ClipboardPaste, Scissors, AlignVerticalJustifyEnd,
} from "lucide-react";
import { SceneEngine, type GizmoMode, DEFAULT_STUDIO_LIGHTS, type StudioLightState } from "../lib/forge/sceneEngine";
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
import { findObjectByUuid } from "../lib/forge/sceneGraph";
import { serializeScene, downloadSceneJson, parseSceneJson, applyMatrix } from "../lib/forge/sceneSerializer";
import { TransformHistory, type EditorToolId, type HistoryEntry } from "../lib/forge/history";
import {
  snapshotTransform,
  applyTransformSnapshot,
  applyMaterialSnapshot,
  applyGeometrySnapshot,
  paintMesh,
  fillObject,
  fixMesh,
  fixTerrain,
  groundSnap,
  smoothNormals,
  findMeshByUuid,
  findObjectByUuidDeep,
  EDITOR_TOOL_META,
} from "../lib/forge/editorTools";
import { deployToFleet } from "../lib/forge/deploy";
import type { StoreCategory } from "../../shared/fleetGames";

const BG_PRESETS = [0x0a0e1a, 0x111418, 0x1a1a25, 0xffffff, 0x444a55];

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
  const sceneInputRef = useRef<HTMLInputElement | null>(null);
  const historyRef = useRef(new TransformHistory());
  const clipboardRef = useRef<THREE.Object3D | null>(null);
  const itemsRef = useRef<SceneItem[]>([]);
  const paintStrokeRef = useRef<Set<string>>(new Set());

  const [items, setItems] = useState<SceneItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedNodeUuid, setSelectedNodeUuid] = useState<string | null>(null);
  const [studioLights, setStudioLights] = useState<StudioLightState>(DEFAULT_STUDIO_LIGHTS);
  const [sceneName, setSceneName] = useState("forge-scene");
  const [storeCategories, setStoreCategories] = useState<StoreCategory[]>([]);
  const [deployCategoryId, setDeployCategoryId] = useState("characters");
  const [runIngest, setRunIngest] = useState(true);
  const [historyTick, setHistoryTick] = useState(0);
  const [editorTool, setEditorTool] = useState<EditorToolId>("select");
  const [paintColor, setPaintColor] = useState(0xffc62a);
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
  const selectedNode = useMemo(() => {
    if (!selected) return null;
    if (selectedNodeUuid) return findObjectByUuid(selected.object, selectedNodeUuid);
    return selected.object;
  }, [selected, selectedNodeUuid]);
  const canUndo = historyTick >= 0 && historyRef.current.canUndo;
  const canRedo = historyTick >= 0 && historyRef.current.canRedo;

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Sync tool → gizmo mode for transform tools
  useEffect(() => {
    if (editorTool === "translate" || editorTool === "rotate" || editorTool === "scale") {
      setGizmoMode(editorTool);
    }
  }, [editorTool]);

  // -- Engine bootstrap ----------------------------------------------------
  useEffect(() => {
    void window.grudge.fleet.storeCategories().then((cats: StoreCategory[] | null | undefined) => {
      const list = cats ?? [];
      setStoreCategories(list);
      setFleetPrefixes(list.slice(0, 8).map((c) => ({
        id: c.id, label: c.label, prefix: c.prefix,
      })));
      const chars = list.find((c) => c.id === "characters");
      if (chars) setR2Path(chars.prefix);
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
    engine.applyStudioLightState(DEFAULT_STUDIO_LIGHTS);
    engineRef.current = engine;
    // History: capture pre-state on drag start, commit on drag end (true undo)
    const offDrag = engine.onDragChanged((dragging) => {
      const obj = (engine.transform as unknown as { object?: THREE.Object3D }).object;
      if (!obj) return;
      if (dragging) {
        historyRef.current.beginDrag(snapshotTransform(obj));
      } else if (historyRef.current.endDrag()) {
        setHistoryTick((n) => n + 1);
      }
    });
    return () => {
      offDrag();
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
    if (selectedNode) engineRef.current.attach(selectedNode);
    else engineRef.current.detach();
  }, [selectedNode]);

  useEffect(() => {
    engineRef.current?.applyStudioLightState(studioLights);
  }, [studioLights]);

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
      let loadFile = file;
      let resolvedDiskPath = diskPath;
      if (file.name.toLowerCase().endsWith(".fbx")) {
        let sourcePath = diskPath;
        if (!sourcePath) {
          const buf = await file.arrayBuffer();
          sourcePath = await window.grudge.forge.writeTempFile({
            name: file.name,
            bytes: new Uint8Array(buf),
          });
        }
        const converted = await window.grudge.ingest.convert(sourcePath) as {
          ok: boolean;
          converted: boolean;
          outputPath: string;
          conversionKind: string;
          errors: string[];
          warnings: string[];
        };
        if (converted.ok && converted.converted) {
          const res = await window.grudge.forge.readFile(converted.outputPath);
          const glbName = converted.outputPath.split(/[\\/]/).pop() ?? file.name.replace(/\.fbx$/i, ".glb");
          loadFile = new File([res.bytes], glbName, { type: "model/gltf-binary" });
          resolvedDiskPath = converted.outputPath;
          if (converted.conversionKind === "fbx2gltf-glb") {
            toast.info("FBX converted via FBX2glTF", { description: glbName });
          }
        } else if (converted.errors?.length) {
          toast.warning("FBX2glTF conversion skipped", { description: converted.errors[0] });
        }
      }
      const loaded: LoadedModel = await loadModel(loadFile);
      // Inspect GLB binary container if applicable.
      let inspection: GlbInspection | null = null;
      if (loadFile.name.toLowerCase().endsWith(".glb")) {
        const buf = await loadFile.arrayBuffer();
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
        name: loadFile.name,
        format: loaded.format,
        object: loaded.object,
        animations: loaded.animations,
        mixer,
        triangles: loaded.triangles,
        vertices: loaded.vertices,
        bones: loaded.bones,
        inspection,
        bytes: loadFile.size,
        rig,
        bodyMorph: { ...DEFAULT_BODY_MORPH },
        sourceRest,
        diskPath: resolvedDiskPath ?? (() => {
          try { return window.grudge.files.getPathForFile(file) || null; } catch { return null; }
        })(),
      };
      setItems((prev) => [...prev, item]);
      setSelectedId(id);
      setSelectedNodeUuid(null);
      if (autoFrame) engineRef.current.frame(loaded.object);
      const rigHint = rig.fingerprintLabel ? ` · ${rig.fingerprintLabel}` : rig.boneCount > 0 ? ` · ${rig.boneCount} bones` : "";
      toast.success(`Loaded ${loadFile.name}`, {
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

  function resolveObject(uuid: string): THREE.Object3D | null {
    return findObjectByUuidDeep(
      itemsRef.current.map((i) => i.object),
      uuid,
    );
  }

  /** Capture live state for an entry's target (for redo/undo inverse). */
  function captureLiveFor(entry: HistoryEntry): HistoryEntry | null {
    if (entry.kind === "transform") {
      const obj = resolveObject(entry.uuid);
      return obj ? snapshotTransform(obj) : null;
    }
    if (entry.kind === "material") {
      for (const it of itemsRef.current) {
        const mesh = findMeshByUuid(it.object, entry.uuid);
        if (!mesh) continue;
        const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const std = m as THREE.MeshStandardMaterial;
        return {
          kind: "material",
          uuid: mesh.uuid,
          color: std?.color?.getHex?.() ?? entry.color,
          metalness: std?.metalness,
          roughness: std?.roughness,
        };
      }
      return null;
    }
    if (entry.kind === "geometry") {
      for (const it of itemsRef.current) {
        const mesh = findMeshByUuid(it.object, entry.uuid);
        if (!mesh) continue;
        const pos = mesh.geometry?.getAttribute("position");
        const nrm = mesh.geometry?.getAttribute("normal");
        return {
          kind: "geometry",
          uuid: mesh.uuid,
          positions: pos ? Array.from(pos.array as ArrayLike<number>) : [],
          normals: nrm ? Array.from(nrm.array as ArrayLike<number>) : null,
        };
      }
    }
    return null;
  }

  function applyHistoryEntry(entry: HistoryEntry): void {
    if (entry.kind === "transform") {
      const obj = resolveObject(entry.uuid);
      if (obj) applyTransformSnapshot(obj, entry);
      return;
    }
    if (entry.kind === "material") {
      for (const it of itemsRef.current) {
        const mesh = findMeshByUuid(it.object, entry.uuid);
        if (mesh) {
          applyMaterialSnapshot(mesh, entry);
          return;
        }
      }
      return;
    }
    if (entry.kind === "geometry") {
      for (const it of itemsRef.current) {
        const mesh = findMeshByUuid(it.object, entry.uuid);
        if (mesh) {
          applyGeometrySnapshot(mesh, entry);
          return;
        }
      }
    }
  }

  function selectNode(uuid: string, object: THREE.Object3D) {
    setSelectedNodeUuid(uuid);
    engineRef.current?.attach(object);
  }

  function onTransformTick() {
    // Numeric panel edits: snapshot immediately before React re-render settles
    if (selectedNode) {
      historyRef.current.push(snapshotTransform(selectedNode));
      setHistoryTick((n) => n + 1);
    }
  }

  function undoTransform() {
    const entry = historyRef.current.popUndo();
    if (!entry) return;
    const live = captureLiveFor(entry);
    if (live) historyRef.current.pushLiveToRedo(live);
    applyHistoryEntry(entry);
    setHistoryTick((n) => n + 1);
  }

  function redoTransform() {
    const entry = historyRef.current.popRedo();
    if (!entry) return;
    const live = captureLiveFor(entry);
    if (live) historyRef.current.pushLiveToUndo(live);
    applyHistoryEntry(entry);
    setHistoryTick((n) => n + 1);
  }

  function pushEntries(entries: HistoryEntry[]) {
    for (const e of entries) historyRef.current.push(e);
    if (entries.length) setHistoryTick((n) => n + 1);
  }

  // -- Clipboard -----------------------------------------------------------
  function copySelected() {
    if (!selected) {
      toast.message("Nothing selected to copy");
      return;
    }
    clipboardRef.current = selected.object.clone(true);
    toast.success("Copied", { description: selected.name });
  }

  function cutSelected() {
    if (!selectedId || !selected) return;
    clipboardRef.current = selected.object.clone(true);
    removeItem(selectedId);
    toast.success("Cut", { description: selected.name });
  }

  function pasteClipboard() {
    const engine = engineRef.current;
    const src = clipboardRef.current;
    if (!engine || !src) {
      toast.message("Clipboard empty");
      return;
    }
    const clone = src.clone(true);
    clone.position.x += 0.5;
    clone.position.z += 0.5;
    const id = `e${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`;
    clone.userData.itemId = id;
    engine.scene.add(clone);
    const rig = inspectSceneRig(clone);
    const item: SceneItem = {
      id,
      name: `${src.name || "Paste"}_copy`,
      format: "clone",
      object: clone,
      animations: [],
      mixer: null,
      triangles: 0,
      vertices: 0,
      bones: rig.boneCount,
      inspection: null,
      bytes: 0,
      rig,
      bodyMorph: { ...DEFAULT_BODY_MORPH },
      sourceRest: rig.boneCount > 0 ? captureRestPose(clone) : null,
      diskPath: null,
    };
    setItems((prev) => [...prev, item]);
    setSelectedId(id);
    setSelectedNodeUuid(clone.uuid);
    historyRef.current.push(snapshotTransform(clone));
    setHistoryTick((n) => n + 1);
    toast.success("Pasted");
  }

  function duplicateSelected() {
    copySelected();
    pasteClipboard();
  }

  // -- Editor tools --------------------------------------------------------
  function runPaintOnHit(clientX: number, clientY: number) {
    const engine = engineRef.current;
    if (!engine) return;
    const roots = itemsRef.current.map((i) => i.object);
    const hit = engine.pick(clientX, clientY, roots);
    if (!hit) return;
    const mesh = hit.object as THREE.Mesh;
    if (!mesh.isMesh) return;
    // One undo entry per mesh per stroke (not every pointermove)
    const already = paintStrokeRef.current.has(mesh.uuid);
    const before = paintMesh(mesh, paintColor);
    if (before && !already) {
      paintStrokeRef.current.add(mesh.uuid);
      pushEntries([before]);
    }
  }

  function runFillSelected() {
    if (!selected) {
      toast.message("Select a mesh to fill");
      return;
    }
    const undos = fillObject(selected.object, paintColor);
    pushEntries(undos);
    toast.success("Fill applied", { description: `${undos.length} material(s)` });
  }

  function runFixMesh() {
    if (!selected) {
      toast.message("Select an object to fix");
      return;
    }
    const undos = fixMesh(selected.object);
    pushEntries(undos);
    toast.success("Mesh fixed", {
      description: undos.length ? `${undos.length} mesh(es) · normals + NaN clean` : "Nothing to fix",
    });
  }

  function runFixTerrain() {
    if (!selected) {
      toast.message("Select terrain mesh");
      return;
    }
    const { geometry, transform } = fixTerrain(selected.object);
    const entries: HistoryEntry[] = [...geometry];
    if (transform) entries.push(transform);
    pushEntries(entries);
    toast.success("Terrain fixed", {
      description: "Grounded Y=0 · height soften · normals",
    });
  }

  function runSmooth() {
    if (!selected) return;
    pushEntries(smoothNormals(selected.object));
    toast.success("Smooth normals");
  }

  function runGround() {
    if (!selected) return;
    const before = groundSnap(selected.object);
    if (before) pushEntries([before]);
    toast.success("Snapped to ground (Y=0)");
  }

  function setTool(tool: EditorToolId) {
    setEditorTool(tool);
    if (tool === "translate" || tool === "rotate" || tool === "scale") {
      setGizmoMode(tool);
    }
    if (tool === "select") {
      // keep current gizmo but prefer translate for selection moves
    }
  }

  function saveScene() {
    const engine = engineRef.current;
    if (!engine) return;
    const doc = serializeScene({
      name: sceneName,
      entities: items.map((it) => ({
        id: it.id,
        name: it.name,
        format: it.format,
        object: it.object,
        diskPath: it.diskPath,
        bodyMorph: it.bodyMorph,
      })),
      background: engine.getBackgroundColor(),
      showHelpers,
      animSettings,
      camera: engine.camera,
      controlsTarget: engine.controls.target,
      lights: engine.getStudioLightState(),
    });
    downloadSceneJson(doc);
    toast.success("Scene saved", { description: `${doc.entities.length} entities` });
  }

  async function loadSceneFile(file: File) {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      const doc = parseSceneJson(await file.text());
      setSceneName(doc.name);
      setShowHelpers(doc.settings.showHelpers);
      setAnimSettings(doc.settings.animSettings);
      setStudioLights(doc.settings.lights);
      const bg = doc.settings.background;
      setBgIndex(BG_PRESETS.indexOf(bg) >= 0 ? BG_PRESETS.indexOf(bg) : 0);
      engine.setBackgroundColor(bg);
      engine.camera.position.fromArray(doc.settings.camera.position);
      engine.controls.target.fromArray(doc.settings.camera.target);
      engine.controls.update();

      for (const it of items) {
        engine.removeSkeletonHelper(it.object);
        engine.scene.remove(it.object);
        if (it.mixer) engine.removeMixer(it.mixer);
      }
      setItems([]);
      setSelectedId(null);
      setSelectedNodeUuid(null);
      historyRef.current.clear();

      const loadedItems: SceneItem[] = [];
      for (const ent of doc.entities) {
        if (!ent.diskPath) {
          toast.warning(`Skipped ${ent.name} — no disk path in scene file`);
          continue;
        }
        const res = await window.grudge.forge.readFile(ent.diskPath);
        const f = new File([res.bytes as BlobPart], res.name, { type: res.mime });
        const loaded: LoadedModel = await loadModel(f);
        applyMatrix(loaded.object, ent.matrix);
        loaded.object.visible = ent.visible;
        const id = ent.id || `e${Date.now().toString(36)}`;
        loaded.object.userData.itemId = id;
        engine.scene.add(loaded.object);
        const mixer = engine.buildMixer(loaded.object, loaded.animations);
        loadedItems.push({
          id,
          name: ent.name,
          format: ent.format,
          object: loaded.object,
          animations: loaded.animations,
          mixer,
          triangles: loaded.triangles,
          vertices: loaded.vertices,
          bones: loaded.bones,
          inspection: null,
          bytes: f.size,
          rig: inspectSceneRig(loaded.object),
          bodyMorph: ent.bodyMorph ?? { ...DEFAULT_BODY_MORPH },
          sourceRest: loaded.bones > 0 ? captureRestPose(loaded.object) : null,
          diskPath: ent.diskPath,
        });
      }
      setItems(loadedItems);
      if (loadedItems.length) setSelectedId(loadedItems[0].id);
      toast.success(`Loaded scene ${doc.name}`, { description: `${loadedItems.length} entities` });
    } catch (e: unknown) {
      toast.error("Scene load failed", { description: e instanceof Error ? e.message : String(e) });
    }
  }

  function addPrimitive(kind: "box" | "sphere" | "plane") {
    const engine = engineRef.current;
    if (!engine) return;
    const mesh = engine.addPrimitive(kind);
    const id = `prim_${Date.now().toString(36)}`;
    mesh.userData.itemId = id;
    const rig = inspectSceneRig(mesh);
    const item: SceneItem = {
      id,
      name: mesh.name,
      format: "primitive",
      object: mesh,
      animations: [],
      mixer: null,
      triangles: kind === "sphere" ? 512 : kind === "plane" ? 2 : 12,
      vertices: kind === "sphere" ? 256 : kind === "plane" ? 4 : 8,
      bones: 0,
      inspection: null,
      bytes: 0,
      rig,
      bodyMorph: { ...DEFAULT_BODY_MORPH },
      sourceRest: null,
      diskPath: null,
    };
    setItems((prev) => [...prev, item]);
    setSelectedId(id);
    setSelectedNodeUuid(mesh.uuid);
    if (autoFrame) engine.frame(mesh);
  }

  async function fleetDeploySelected() {
    if (!selected) return;
    setBusyUpload(true);
    try {
      const cat = storeCategories.find((c) => c.id === deployCategoryId);
      const result = await deployToFleet({
        object: selected.object,
        animations: selected.animations,
        filenameBase: selected.name.replace(/\.[^.]+$/, ""),
        prefix: r2Path || cat?.prefix || "models/",
        categoryId: deployCategoryId,
        runIngest,
      });
      if (!result.ok) {
        toast.error("Fleet deploy failed", { description: result.errors?.join("; ") });
        return;
      }
      toast.success("Fleet deploy complete", {
        description: [
          result.grudgeUUID ? `UUID ${result.grudgeUUID}` : null,
          result.rig ? `rig ${result.rig}` : null,
          result.publicUrl ?? result.key,
        ].filter(Boolean).join(" · "),
      });
    } catch (e: unknown) {
      toast.error("Fleet deploy failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyUpload(false);
    }
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;

      // Undo / redo
      if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); undoTransform(); return; }
      if (mod && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); redoTransform(); return; }

      // Clipboard
      if (mod && k === "c") { e.preventDefault(); copySelected(); return; }
      if (mod && k === "x") { e.preventDefault(); cutSelected(); return; }
      if (mod && k === "v") { e.preventDefault(); pasteClipboard(); return; }
      if (mod && k === "d") { e.preventDefault(); duplicateSelected(); return; }
      if (mod && k === "s") { e.preventDefault(); saveScene(); return; }

      // Tools
      if (!mod && k === "q") { setTool("select"); return; }
      if (!mod && k === "w") { setTool("translate"); return; }
      if (!mod && k === "e") { setTool("rotate"); return; }
      if (!mod && k === "r" && !e.shiftKey) { setTool("scale"); return; }
      if (!mod && k === "b") { setTool("paint"); return; }
      if (!mod && k === "g" && !e.shiftKey) { setTool("fill"); runFillSelected(); return; }
      if (!mod && k === "m") { setTool("fix-mesh"); runFixMesh(); return; }
      if (!mod && k === "t" && !e.shiftKey) { setTool("fix-terrain"); runFixTerrain(); return; }
      if (!mod && e.shiftKey && k === "s") { e.preventDefault(); runSmooth(); return; }
      if (e.key === "End") { e.preventDefault(); runGround(); return; }
      if (!mod && k === "f") { frameSelected(); return; }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId) { e.preventDefault(); removeItem(selectedId); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Viewport pointer tools (paint / select)
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const canvas = engine.canvas;

    const isDraggingGizmo = () =>
      !!(engine.transform as unknown as { dragging?: boolean }).dragging;

    const onPointerDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      if (isDraggingGizmo()) return;

      if (editorTool === "paint") {
        paintStrokeRef.current = new Set();
        ev.preventDefault();
        runPaintOnHit(ev.clientX, ev.clientY);
        return;
      }

      if (editorTool === "select" || editorTool === "translate" || editorTool === "rotate" || editorTool === "scale") {
        const roots = itemsRef.current.map((i) => i.object);
        const hit = engine.pick(ev.clientX, ev.clientY, roots);
        if (!hit) return;
        let node: THREE.Object3D | null = hit.object;
        let itemId: string | null = null;
        while (node) {
          if (node.userData?.itemId) {
            itemId = String(node.userData.itemId);
            break;
          }
          node = node.parent;
        }
        if (itemId) {
          setSelectedId(itemId);
          setSelectedNodeUuid(hit.object.uuid);
          engine.attach(hit.object);
        }
      }
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (editorTool !== "paint" || (ev.buttons & 1) === 0) return;
      if (isDraggingGizmo()) return;
      runPaintOnHit(ev.clientX, ev.clientY);
    };

    const onPointerUp = () => {
      paintStrokeRef.current = new Set();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [editorTool, paintColor, items.length]);

  // -- Background cycler ---------------------------------------------------
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
        editorTool={editorTool} setTool={setTool}
        paintColor={paintColor} setPaintColor={setPaintColor}
        showHelpers={showHelpers} setShowHelpers={setShowHelpers}
        autoFrame={autoFrame} setAutoFrame={setAutoFrame}
        onPickFiles={() => fileInputRef.current?.click()}
        onLoadScene={() => sceneInputRef.current?.click()}
        onSaveScene={saveScene}
        onUndo={undoTransform}
        onRedo={redoTransform}
        canUndo={canUndo}
        canRedo={canRedo}
        onCopy={copySelected}
        onCut={cutSelected}
        onPaste={pasteClipboard}
        onDuplicate={duplicateSelected}
        onFill={runFillSelected}
        onFixMesh={runFixMesh}
        onFixTerrain={runFixTerrain}
        onSmooth={runSmooth}
        onGround={runGround}
        onAddPrimitive={addPrimitive}
        onFrame={frameSelected}
        onScreenshot={screenshot}
        onCycleBg={cycleBackground}
        onExportSelected={exportSelected}
        onExportAll={exportAll}
        onClear={() => items.forEach((i) => removeItem(i.id))}
        canExport={selected != null}
        canExportAll={items.length > 0}
        hasSelection={selected != null}
      />
      <input
        ref={sceneInputRef}
        type="file"
        accept=".forge-scene.json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void loadSceneFile(f);
          e.target.value = "";
        }}
      />
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr 380px", minHeight: 0 }}>
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
                  onSelect={() => { setSelectedId(it.id); setSelectedNodeUuid(null); }}
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
              onFleetDeploy={fleetDeploySelected}
              busyUpload={busyUpload}
              selectedNode={selectedNode}
              selectedNodeUuid={selectedNodeUuid ?? selected.object.uuid}
              onSelectNode={selectNode}
              onTransformTick={onTransformTick}
              studioLights={studioLights}
              onStudioLights={setStudioLights}
              storeCategories={storeCategories}
              deployCategoryId={deployCategoryId}
              setDeployCategoryId={setDeployCategoryId}
              runIngest={runIngest}
              setRunIngest={setRunIngest}
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
  editorTool: EditorToolId;
  setTool: (t: EditorToolId) => void;
  paintColor: number;
  setPaintColor: (c: number) => void;
  showHelpers: boolean;
  setShowHelpers: (v: boolean) => void;
  autoFrame: boolean;
  setAutoFrame: (v: boolean) => void;
  onPickFiles: () => void;
  onLoadScene: () => void;
  onSaveScene: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onFill: () => void;
  onFixMesh: () => void;
  onFixTerrain: () => void;
  onSmooth: () => void;
  onGround: () => void;
  onAddPrimitive: (kind: "box" | "sphere" | "plane") => void;
  onFrame: () => void;
  onScreenshot: () => void;
  onCycleBg: () => void;
  onExportSelected: () => void;
  onExportAll: () => void;
  onClear: () => void;
  canExport: boolean;
  canExportAll: boolean;
  hasSelection: boolean;
}) {
  const Btn = ({ active, onClick, title, children, disabled }: any) => (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        background: active ? "rgba(255,198,42,0.18)" : "transparent",
        color: disabled ? "var(--muted)" : active ? "var(--gold)" : "var(--text)",
        border: "1px solid " + (active ? "var(--gold-deep)" : "var(--line)"),
        borderRadius: 5, padding: "5px 8px", cursor: disabled ? "not-allowed" : "pointer", fontSize: 12,
        display: "inline-flex", alignItems: "center", gap: 4, opacity: disabled ? 0.5 : 1,
      }}>
      {children}
    </button>
  );
  const hex = `#${props.paintColor.toString(16).padStart(6, "0")}`;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "8px 14px", borderBottom: "1px solid var(--line)",
      background: "var(--bg-1)", flexWrap: "wrap",
    }}>
      <Btn onClick={props.onPickFiles} title="Open model"><FolderOpen size={14} />Open</Btn>
      <Btn onClick={props.onLoadScene} title="Load .forge-scene.json"><FolderInput size={14} />Scene</Btn>
      <Btn onClick={props.onSaveScene} title="Save scene (Ctrl+S)"><Save size={14} />Save</Btn>
      <span style={{ width: 1, height: 22, background: "var(--line)" }} />
      <Btn onClick={props.onUndo} title="Undo (Ctrl+Z)" disabled={!props.canUndo}><Undo2 size={14} /></Btn>
      <Btn onClick={props.onRedo} title="Redo (Ctrl+Y / Ctrl+Shift+Z)" disabled={!props.canRedo}><Redo2 size={14} /></Btn>
      <Btn onClick={props.onCopy} title="Copy (Ctrl+C)" disabled={!props.hasSelection}><Copy size={14} /></Btn>
      <Btn onClick={props.onCut} title="Cut (Ctrl+X)" disabled={!props.hasSelection}><Scissors size={14} /></Btn>
      <Btn onClick={props.onPaste} title="Paste (Ctrl+V)"><ClipboardPaste size={14} /></Btn>
      <Btn onClick={props.onDuplicate} title="Duplicate (Ctrl+D)" disabled={!props.hasSelection}><Plus size={14} />Dup</Btn>
      <Btn onClick={() => props.onAddPrimitive("box")} title="Add box primitive"><Plus size={14} />Box</Btn>
      <span style={{ width: 1, height: 22, background: "var(--line)" }} />
      <Btn active={props.editorTool === "select"} onClick={() => props.setTool("select")} title={`${EDITOR_TOOL_META.select.label} (${EDITOR_TOOL_META.select.hotkey})`}><MousePointer2 size={14} /></Btn>
      <Btn active={props.editorTool === "translate" || props.gizmoMode === "translate"} onClick={() => props.setTool("translate")} title="Translate (W)"><Move size={14} />T</Btn>
      <Btn active={props.editorTool === "rotate" || props.gizmoMode === "rotate"} onClick={() => props.setTool("rotate")} title="Rotate (E)"><RotateCcw size={14} />R</Btn>
      <Btn active={props.editorTool === "scale" || props.gizmoMode === "scale"} onClick={() => props.setTool("scale")} title="Scale (R)"><Maximize2 size={14} />S</Btn>
      <span style={{ width: 1, height: 22, background: "var(--line)" }} />
      <Btn active={props.editorTool === "paint"} onClick={() => props.setTool("paint")} title="Paint (B) — click/drag on mesh"><Paintbrush size={14} />Paint</Btn>
      <label title="Paint / fill color" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--muted)" }}>
        <input
          type="color"
          value={hex}
          onChange={(e) => {
            const v = e.target.value.replace("#", "");
            props.setPaintColor(parseInt(v, 16) || 0xffc62a);
          }}
          style={{ width: 28, height: 24, border: "1px solid var(--line)", borderRadius: 4, padding: 0, background: "transparent", cursor: "pointer" }}
        />
      </label>
      <Btn active={props.editorTool === "fill"} onClick={() => { props.setTool("fill"); props.onFill(); }} title="Fill selection (G)" disabled={!props.hasSelection}><PaintBucket size={14} />Fill</Btn>
      <Btn onClick={props.onFixMesh} title="Fix mesh (M) — normals, NaN, shadows" disabled={!props.hasSelection}><Wrench size={14} />Mesh</Btn>
      <Btn onClick={props.onFixTerrain} title="Fix terrain (T) — ground Y=0, soften heights" disabled={!props.hasSelection}><Mountain size={14} />Terrain</Btn>
      <Btn onClick={props.onSmooth} title="Smooth normals (Shift+S)" disabled={!props.hasSelection}><Sparkles size={14} />Smooth</Btn>
      <Btn onClick={props.onGround} title="Snap to ground (End)" disabled={!props.hasSelection}><AlignVerticalJustifyEnd size={14} />Ground</Btn>
      <span style={{ width: 1, height: 22, background: "var(--line)" }} />
      <Btn onClick={props.onFrame} title="Frame selection (F)"><Box size={14} />Frame</Btn>
      <Btn active={props.showHelpers} onClick={() => props.setShowHelpers(!props.showHelpers)} title="Toggle grid"><Grid3x3 size={14} />Grid</Btn>
      <Btn active={props.autoFrame} onClick={() => props.setAutoFrame(!props.autoFrame)} title="Auto-frame on load"><Lightbulb size={14} />Auto</Btn>
      <Btn onClick={props.onCycleBg} title="Cycle background"><Sun size={14} />BG</Btn>
      <Btn onClick={props.onScreenshot} title="Screenshot"><Camera size={14} />PNG</Btn>
      <span style={{ flex: 1 }} />
      <Btn onClick={props.onExportSelected} title="Export selected as GLB" disabled={!props.canExport}>
        <Download size={14} />Export GLB
      </Btn>
      <Btn onClick={props.onExportAll} title="Export entire scene as GLB" disabled={!props.canExportAll}>
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


