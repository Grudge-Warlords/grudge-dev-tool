import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { toast } from "sonner";
import {
  Move, RotateCcw, Maximize2, Camera, Download,
  FileBox, Trash2, ChevronRight, ChevronDown, Box,
  Lightbulb, Grid3x3, Sun, FolderOpen, Save, FolderInput, Undo2, Redo2, Plus,
  Paintbrush, PaintBucket, Wrench, Mountain, Sparkles, MousePointer2,
  Copy, ClipboardPaste, Scissors, AlignVerticalJustifyEnd,
  Blend, Layers, FlipVertical2, Combine, LandPlot,
  Wand2, Image as ImageIcon, Bot,
} from "lucide-react";
import { SceneEngine, type GizmoMode, DEFAULT_STUDIO_LIGHTS, type StudioLightState } from "../lib/forge/sceneEngine";
import { loadModel, type LoadedModel, isSupported } from "../lib/forge/loaders";
import { finishImportedAsset } from "../lib/forge/localMaterials";
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
  stopMixer,
  type ForgeAnimSettings,
} from "../lib/forge/forgeAnimation";
import { buildProceduralClip } from "../lib/forge/animApply";
import { FORGE_HOTKEYS, hotkeysByGroup } from "../lib/forge/forgeHotkeys";
import type { ForgeScriptHost } from "../lib/forge/forgeScript";
import ForgeWorkbench from "../components/ForgeWorkbench";
import { findObjectByUuid } from "../lib/forge/sceneGraph";
import { serializeScene, downloadSceneJson, parseSceneJson, applyMatrix } from "../lib/forge/sceneSerializer";
import { TransformHistory, type EditorToolId, type HistoryEntry } from "../lib/forge/history";
import {
  snapshotTransform,
  applyTransformSnapshot,
  applyMaterialSnapshot,
  applyGeometrySnapshot,
  snapshotMaterial,
  fillObject,
  fixMesh,
  fixTerrain,
  groundSnap,
  smoothNormals,
  findMeshByUuid,
  findObjectByUuidDeep,
  EDITOR_TOOL_META,
} from "../lib/forge/editorTools";
import {
  DEFAULT_BRUSH,
  paintBrushStrokeDab,
  applyVertexColorSnapshot,
  snapshotVertexColors,
  sealOpenBacks,
  flipNormals,
  weldVertices,
  prepareIslandAsset,
  ensureVertexColors,
  type PaintBrushSettings,
  type PaintMode,
  type PaintFalloff,
} from "../lib/forge/paintBrush";
import { deployToFleet } from "../lib/forge/deploy";
import {
  aiSuggestTextures,
  aiPlanEdit,
  applyMaterialSuggestion,
  type AiEditCommand,
} from "../lib/forge/forgeAi";
import {
  applySmartTextures,
  filterImagePaths,
  siblingTexturePrefixes,
} from "../lib/forge/textureFinder";
import {
  collectSceneMeshStats,
  executeSceneCompletionPlan,
} from "../lib/forge/sceneCompletionExec";
import type { SceneCompletionPlan } from "../../shared/sceneCompletion";
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
  const brushRef = useRef<PaintBrushSettings>({ ...DEFAULT_BRUSH });

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
  const [brushRadius, setBrushRadius] = useState(DEFAULT_BRUSH.radius);
  const [brushStrength, setBrushStrength] = useState(DEFAULT_BRUSH.strength);
  const [paintMode, setPaintMode] = useState<PaintMode>("blend");
  const [paintFalloff, setPaintFalloff] = useState<PaintFalloff>("smooth");
  const [affectBackfaces, setAffectBackfaces] = useState(true);
  const [tintMaterial, setTintMaterial] = useState(false);
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
  const [hotkeyHelp, setHotkeyHelp] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiEditOpen, setAiEditOpen] = useState(false);
  const [aiEditPrompt, setAiEditPrompt] = useState("make it gold metal and ground it");
  const [completionOpen, setCompletionOpen] = useState(false);
  const [completionMode, setCompletionMode] = useState<"auto" | "mesh-repair" | "island" | "character-rig" | "full">("auto");
  const [completionGoal, setCompletionGoal] = useState("prep for production game import");
  const [completionLog, setCompletionLog] = useState<string>("");

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);
  const selectedNode = useMemo(() => {
    if (!selected) return null;
    if (selectedNodeUuid) return findObjectByUuid(selected.object, selectedNodeUuid);
    return selected.object;
  }, [selected, selectedNodeUuid]);
  const canUndo = historyTick >= 0 && historyRef.current.canUndo;
  const canRedo = historyTick >= 0 && historyRef.current.canRedo;

  const scriptHost = useMemo<ForgeScriptHost>(() => ({
    get engine() {
      const e = engineRef.current;
      if (!e) throw new Error("Engine not ready");
      return e;
    },
    get items() {
      return itemsRef.current;
    },
    get selectedId() {
      return selectedId;
    },
    getSelected() {
      return itemsRef.current.find((i) => i.id === selectedId) ?? null;
    },
    setSelectedId(id) {
      setSelectedId(id);
    },
    mergeAnimations(itemId, clips) {
      mergeAnimations(itemId, clips);
    },
    playClip(item, clip) {
      playClip(item as SceneItem, clip);
    },
    frame(object) {
      if (object) engineRef.current?.frame(object);
      else frameSelected();
    },
    frameAll() {
      engineRef.current?.frameAll();
    },
    log(msg) {
      console.info("[forge-script]", msg);
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- host is a stable façade over refs/state
  }), [selectedId]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Keep brush ref live for pointer handlers
  useEffect(() => {
    brushRef.current = {
      color: paintColor,
      radius: brushRadius,
      strength: brushStrength,
      mode: editorTool === "blend-paint" ? "blend" : paintMode,
      falloff: paintFalloff,
      affectBackfaces,
      tintMaterial,
    };
  }, [paintColor, brushRadius, brushStrength, paintMode, paintFalloff, affectBackfaces, tintMaterial, editorTool]);

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
      const diskForTextures =
        resolvedDiskPath ??
        (() => {
          try {
            return window.grudge.files?.getPathForFile?.(file) || null;
          } catch {
            return null;
          }
        })();

      const loaded: LoadedModel = await loadModel(loadFile, { diskPath: diskForTextures });
      // Inspect GLB binary container if applicable.
      let inspection: GlbInspection | null = null;
      if (loadFile.name.toLowerCase().endsWith(".glb")) {
        const buf = await loadFile.arrayBuffer();
        inspection = inspectGlb(buf);
      }
      const id = `e${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`;
      loaded.object.userData.itemId = id;
      loaded.object.traverse((n) => {
        const m = n as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });

      // Colors + sibling-folder textures (same dir / pack root) — not brand gold
      let texNote = "";
      try {
        const fin = await finishImportedAsset(loaded.object, diskForTextures);
        const maps = fin.textures.reports.reduce((n, r) => n + r.applied.length, 0);
        if (maps > 0) {
          texNote = ` · ${maps} local map(s) from folder`;
        } else if (fin.sanitize.goldNeutralized > 0) {
          texNote = ` · neutralized ${fin.sanitize.goldNeutralized} gold default(s)`;
        } else if (diskForTextures && fin.textures.filesTried === 0) {
          texNote = " · no sibling textures found";
        }
      } catch (texErr) {
        console.warn("local texture resolve failed", texErr);
      }

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
        diskPath: diskForTextures,
      };
      setItems((prev) => [...prev, item]);
      setSelectedId(id);
      setSelectedNodeUuid(null);
      if (autoFrame) engineRef.current.frame(loaded.object);
      // Soft selection pulse then clear gold emissive so assets don't stay yellow
      engineRef.current.pulseSelect(loaded.object);
      window.setTimeout(() => engineRef.current?.pulseSelect(null), 450);
      const rigHint = rig.fingerprintLabel ? ` · ${rig.fingerprintLabel}` : rig.boneCount > 0 ? ` · ${rig.boneCount} bones` : "";
      toast.success(`Loaded ${loadFile.name}`, {
        description: `${loaded.triangles.toLocaleString()} triangles · ${loaded.animations.length} clip${loaded.animations.length === 1 ? "" : "s"}${rigHint}${texNote}`,
      });
      if (animSettings.autoPlayFirst && mixer && loaded.animations[0]) {
        const action = mixer.clipAction(loaded.animations[0]);
        applyLoopMode(action, animSettings.loop);
        action.play();
        setActiveClip(action);
        setPaused(false);
      }
    } catch (err: any) {
      console.error("Forge3D load failed", err);
      toast.error(`Failed to load ${file.name}`, { description: err?.message ?? String(err) });
    } finally {
      setLoading(false);
    }
  }, [autoFrame, animSettings.autoPlayFirst, animSettings.loop]);

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
      // Always create a mixer when clips exist (rigged skeleton or unrigged object tracks)
      const mixer =
        clips.length > 0
          ? (engineRef.current?.buildMixer(it.object, clips) ?? new THREE.AnimationMixer(it.object))
          : null;
      if (mixer && engineRef.current && !engineRef.current.mixers.includes(mixer)) {
        engineRef.current.mixers.push(mixer);
      }
      return { ...it, animations: clips, mixer };
    }));
    toast.success(`Set ${clips.length} animation clip${clips.length === 1 ? "" : "s"}`);
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
    if (entry.kind === "vertexColors") {
      for (const it of itemsRef.current) {
        const mesh = findMeshByUuid(it.object, entry.uuid);
        if (!mesh) continue;
        ensureVertexColors(mesh);
        const color = mesh.geometry.getAttribute("color");
        return {
          kind: "vertexColors",
          uuid: mesh.uuid,
          colors: color ? Array.from(color.array as ArrayLike<number>) : [],
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
      return;
    }
    if (entry.kind === "vertexColors") {
      for (const it of itemsRef.current) {
        const mesh = findMeshByUuid(it.object, entry.uuid);
        if (mesh) {
          applyVertexColorSnapshot(mesh, entry);
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
    if (!entry) {
      toast.message("Nothing to undo");
      return;
    }
    const live = captureLiveFor(entry);
    if (live) historyRef.current.pushLiveToRedo(live);
    applyHistoryEntry(entry);
    setHistoryTick((n) => n + 1);
    toast.success("Undo", { description: entry.kind });
  }

  function redoTransform() {
    const entry = historyRef.current.popRedo();
    if (!entry) {
      toast.message("Nothing to redo");
      return;
    }
    const live = captureLiveFor(entry);
    if (live) historyRef.current.pushLiveToUndo(live);
    applyHistoryEntry(entry);
    setHistoryTick((n) => n + 1);
    toast.success("Redo", { description: entry.kind });
  }

  function pushEntries(entries: HistoryEntry[]) {
    for (const e of entries) historyRef.current.push(e);
    if (entries.length) setHistoryTick((n) => n + 1);
  }

  // -- Clipboard -----------------------------------------------------------
  function copySelected() {
    if (!selected) {
      toast.message("Nothing selected — click a model first (Ctrl+C)");
      return;
    }
    clipboardRef.current = selected.object.clone(true);
    // Also stash a short text tag so OS paste apps see *something*
    try {
      void navigator.clipboard?.writeText?.(`grudge-forge-copy:${selected.name}`);
    } catch { /* ignore */ }
    toast.success("Copied", { description: `${selected.name} · Ctrl+V to paste` });
  }

  function cutSelected() {
    if (!selectedId || !selected) {
      toast.message("Nothing selected to cut (Ctrl+X)");
      return;
    }
    const name = selected.name;
    clipboardRef.current = selected.object.clone(true);
    removeItem(selectedId);
    toast.success("Cut", { description: `${name} · Ctrl+V to paste` });
  }

  function pasteClipboard() {
    const engine = engineRef.current;
    const src = clipboardRef.current;
    if (!engine || !src) {
      toast.message("Clipboard empty — copy with Ctrl+C first");
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
    engine.attach(clone);
    engine.pulseSelect(clone);
    toast.success("Pasted", { description: item.name });
  }

  function duplicateSelected() {
    if (!selected) {
      toast.message("Nothing selected to duplicate (Ctrl+D)");
      return;
    }
    copySelected();
    pasteClipboard();
  }

  // -- AI Texture / AI Edit ------------------------------------------------
  async function runAiTexture() {
    if (!selected) {
      toast.message("Select a model for AI Texture (Ctrl+Shift+T)");
      return;
    }
    if (aiBusy) return;
    setAiBusy(true);
    const toastId = toast.loading("AI Texture…", { description: "Suggesting PBR + searching maps" });
    try {
      // Snapshot materials for undo
      const undos: HistoryEntry[] = [];
      selected.object.traverse((n) => {
        const mesh = n as THREE.Mesh;
        if (!mesh.isMesh) return;
        const snap = snapshotMaterial(mesh);
        if (snap) undos.push(snap);
      });

      const { suggestion, via } = await aiSuggestTextures(selected.object, selected.name);
      applyMaterialSuggestion(selected.object, suggestion);
      setPaintColor(suggestion.colorHex);

      // Fleet search for texture maps using AI keywords + sibling prefixes
      const keys: string[] = [];
      const prefixes = selected.diskPath
        ? siblingTexturePrefixes(selected.diskPath.replace(/\\/g, "/"))
        : ["textures/", "models/textures/", "maps/", "icons/"];
      for (const term of suggestion.searchTerms.slice(0, 6)) {
        try {
          const res = await window.grudge.os.search?.({ query: term, limit: 30 });
          for (const it of res?.items ?? res?.results ?? []) {
            const name = it?.name ?? it?.key ?? it?.path;
            if (name) keys.push(String(name));
          }
        } catch { /* search optional */ }
      }
      for (const prefix of prefixes.slice(0, 4)) {
        try {
          const res = await window.grudge.os.list({ prefix, delimiter: "", limit: 80 });
          for (const it of res.items ?? []) {
            if (it?.name) keys.push(String(it.name));
          }
        } catch { /* ignore */ }
      }
      const images = filterImagePaths([...new Set(keys)]);
      let mapCount = 0;
      if (images.length) {
        const reports = await applySmartTextures(selected.object, images, async (key) => {
          try {
            return await window.grudge.cf.r2PublicUrl(key);
          } catch {
            return key;
          }
        });
        mapCount = reports.reduce((n, r) => n + r.applied.length, 0);
      }

      if (undos.length) pushEntries(undos);
      toast.success("AI Texture applied", {
        id: toastId,
        description: [
          via,
          `#${suggestion.colorHex.toString(16)}`,
          `m${suggestion.metalness.toFixed(2)} r${suggestion.roughness.toFixed(2)}`,
          mapCount ? `${mapCount} maps` : `${images.length} candidates`,
          suggestion.notes,
        ].filter(Boolean).join(" · "),
      });
    } catch (e: unknown) {
      toast.error("AI Texture failed", {
        id: toastId,
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setAiBusy(false);
    }
  }

  function applyAiCommand(cmd: AiEditCommand, root: THREE.Object3D) {
    switch (cmd.op) {
      case "fill": {
        const hex = cmd.colorHex ?? (typeof cmd.value === "number" ? cmd.value : paintColor);
        const undos = fillObject(root, Number(hex));
        pushEntries(undos);
        setPaintColor(Number(hex));
        break;
      }
      case "metalness":
      case "roughness": {
        const v = Math.min(1, Math.max(0, Number(cmd.value) || 0));
        root.traverse((n) => {
          const mesh = n as THREE.Mesh;
          if (!mesh.isMesh) return;
          const before = snapshotMaterial(mesh);
          if (before) historyRef.current.push(before);
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            const std = m as THREE.MeshStandardMaterial;
            if (!std?.isMeshStandardMaterial) continue;
            if (cmd.op === "metalness") std.metalness = v;
            else std.roughness = v;
            std.needsUpdate = true;
          }
        });
        setHistoryTick((n) => n + 1);
        break;
      }
      case "ground": {
        const before = snapshotTransform(root);
        groundSnap(root);
        historyRef.current.push(before);
        setHistoryTick((n) => n + 1);
        break;
      }
      case "scale": {
        const s = Number(cmd.value) || 1;
        historyRef.current.push(snapshotTransform(root));
        root.scale.multiplyScalar(s);
        root.updateMatrixWorld(true);
        setHistoryTick((n) => n + 1);
        break;
      }
      case "rotate_y": {
        const deg = Number(cmd.value) || 0;
        historyRef.current.push(snapshotTransform(root));
        root.rotation.y += THREE.MathUtils.degToRad(deg);
        root.updateMatrixWorld(true);
        setHistoryTick((n) => n + 1);
        break;
      }
      case "offset": {
        const arr = Array.isArray(cmd.value) ? cmd.value : [0, 0, 0];
        historyRef.current.push(snapshotTransform(root));
        root.position.x += Number(arr[0]) || 0;
        root.position.y += Number(arr[1]) || 0;
        root.position.z += Number(arr[2]) || 0;
        root.updateMatrixWorld(true);
        setHistoryTick((n) => n + 1);
        break;
      }
      case "frame":
        engineRef.current?.frame(root);
        break;
      case "note":
        toast.message("AI note", { description: String(cmd.value ?? "") });
        break;
      default:
        break;
    }
  }

  async function runSceneCompletion(opts?: {
    mode?: "auto" | "mesh-repair" | "island" | "character-rig" | "full";
    goal?: string;
  }) {
    if (!selected) {
      toast.message("Select a model for Scene Completion (Ctrl+Shift+C)");
      return;
    }
    if (aiBusy) return;
    setAiBusy(true);
    setCompletionOpen(false);
    const mode = opts?.mode ?? completionMode;
    const goal = opts?.goal ?? completionGoal;
    const logs: string[] = [];
    const log = (msg: string) => {
      logs.push(msg);
      setCompletionLog(logs.join("\n"));
    };
    const toastId = toast.loading("Scene Completion…", {
      description: `${mode} · planning weld / patch / rig`,
    });
    try {
      const stats = collectSceneMeshStats(selected.object, selected.name);
      log(`stats: ${stats.meshCount} meshes · ${stats.boneCount} bones · skinned=${stats.hasSkinnedMesh}`);
      const plan = (await window.grudge.fleet.sceneCompletionPlan({
        name: selected.name,
        stats,
        goal,
        mode,
      })) as SceneCompletionPlan;

      log(`plan: ${plan.summary} (${plan.source}${plan.provider ? ` · ${plan.provider}` : ""})`);
      plan.risks?.forEach((r) => log(`risk: ${r}`));
      plan.bestPractices?.slice(0, 4).forEach((b) => log(`bp: ${b}`));

      const results = executeSceneCompletionPlan(plan, {
        root: selected.object,
        name: selected.name,
        pushHistory: (entries) => pushEntries(entries),
        frame: (obj) => engineRef.current?.frame(obj),
        ensureMixer: () => {
          if (!selected.mixer && engineRef.current) {
            const mixer = engineRef.current.buildMixer(selected.object, selected.animations);
            if (mixer) {
              setItems((prev) =>
                prev.map((it) => (it.id === selected.id ? { ...it, mixer } : it)),
              );
            }
          }
        },
        log,
      });

      // Refresh rig inspect after skeleton steps
      const rig = inspectSceneRig(selected.object);
      setItems((prev) =>
        prev.map((it) => (it.id === selected.id ? { ...it, rig, bones: rig.boneCount } : it)),
      );
      engineRef.current?.pulseSelect(selected.object);

      const okN = results.filter((r) => r.ok).length;
      const failN = results.length - okN;
      toast.success(`Scene Completion · ${okN}/${results.length} steps`, {
        id: toastId,
        description: [
          plan.summary,
          plan.source,
          plan.provider,
          failN ? `${failN} failed` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      });
    } catch (e: unknown) {
      toast.error("Scene Completion failed", {
        id: toastId,
        description: e instanceof Error ? e.message : String(e),
      });
      log(`error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAiBusy(false);
    }
  }

  async function runAiEdit(instruction?: string) {
    if (!selected) {
      toast.message("Select a model for AI Edit (Ctrl+Shift+E)");
      return;
    }
    const prompt = (instruction ?? aiEditPrompt).trim();
    if (!prompt) {
      setAiEditOpen(true);
      return;
    }
    if (aiBusy) return;
    setAiBusy(true);
    setAiEditOpen(false);
    const toastId = toast.loading("AI Edit…", { description: prompt.slice(0, 80) });
    try {
      const { plan, via } = await aiPlanEdit(selected.object, selected.name, prompt);
      for (const cmd of plan.commands) {
        applyAiCommand(cmd, selected.object);
      }
      engineRef.current?.pulseSelect(selected.object);
      toast.success(plan.summary || "AI Edit done", {
        id: toastId,
        description: `${via} · ${plan.commands.length} step(s)`,
      });
    } catch (e: unknown) {
      toast.error("AI Edit failed", {
        id: toastId,
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setAiBusy(false);
    }
  }

  // -- Editor tools --------------------------------------------------------
  function isPaintTool(tool: EditorToolId = editorTool): boolean {
    return tool === "paint" || tool === "blend-paint";
  }

  function runPaintOnHit(clientX: number, clientY: number) {
    const engine = engineRef.current;
    if (!engine) return;
    const roots = itemsRef.current.map((i) => i.object);
    const hit = engine.pick(clientX, clientY, roots);
    if (!hit) return;
    const mesh = hit.object as THREE.Mesh;
    if (!mesh.isMesh) return;

    const settings: PaintBrushSettings = {
      ...brushRef.current,
      mode: editorTool === "blend-paint" ? "blend" : brushRef.current.mode,
    };

    // First dab on this mesh in stroke → capture full vertex-color undo
    const capture = !paintStrokeRef.current.has(mesh.uuid);
    const undo = paintBrushStrokeDab(
      mesh,
      hit.point,
      hit.face?.normal
        ? hit.face.normal.clone().transformDirection(mesh.matrixWorld)
        : null,
      settings,
      capture,
    );
    if (undo && capture) {
      paintStrokeRef.current.add(mesh.uuid);
      pushEntries([undo]);
    }
  }

  function runFillSelected() {
    if (!selected) {
      toast.message("Select a mesh to fill");
      return;
    }
    const undos: HistoryEntry[] = [];
    // Material fill
    undos.push(...fillObject(selected.object, paintColor));
    // Vertex-color fill
    selected.object.traverse((n) => {
      const mesh = n as THREE.Mesh;
      if (!mesh.isMesh) return;
      const before = snapshotVertexColors(mesh);
      if (before) undos.push(before);
      ensureVertexColors(mesh, paintColor);
      const color = mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
      if (!color) return;
      const c = new THREE.Color(paintColor);
      for (let i = 0; i < color.count; i++) color.setXYZ(i, c.r, c.g, c.b);
      color.needsUpdate = true;
    });
    pushEntries(undos);
    toast.success("Fill applied", { description: "Materials + vertex colors" });
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

  function runSealBack() {
    if (!selected) {
      toast.message("Select island / open mesh");
      return;
    }
    const { shellsAdded, doubleSided } = sealOpenBacks(selected.object, { addShell: true });
    toast.success("Sealed open backs", {
      description: `${shellsAdded} back shell(s) · ${doubleSided} double-sided mats`,
    });
  }

  function runFlipNormals() {
    if (!selected) return;
    pushEntries(flipNormals(selected.object));
    toast.success("Flipped normals / winding");
  }

  function runWeld() {
    if (!selected) return;
    const undos = weldVertices(selected.object, 0.002);
    pushEntries(undos);
    toast.success("Welded open edges", {
      description: undos.length ? `${undos.length} mesh(es) rebuilt` : "No cracks found",
    });
  }

  function runIslandPrep() {
    if (!selected) {
      toast.message("Select prop / terrain for island prep");
      return;
    }
    const result = prepareIslandAsset(selected.object);
    pushEntries(result.geometry);
    toast.success("Island prep complete", {
      description: `Grounded · welded ${result.welded} · ${result.shellsAdded} seals · ${result.doubleSided} double-side`,
    });
  }

  function setTool(tool: EditorToolId) {
    setEditorTool(tool);
    if (tool === "translate" || tool === "rotate" || tool === "scale") {
      setGizmoMode(tool);
    }
    if (tool === "blend-paint") {
      setPaintMode("blend");
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
    let mixer = item.mixer;
    if (!mixer && engineRef.current) {
      mixer = engineRef.current.buildMixer(item.object, item.animations.length ? item.animations : [clip]);
      if (!mixer) {
        mixer = new THREE.AnimationMixer(item.object);
        engineRef.current.mixers.push(mixer);
      }
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, mixer } : it)));
    }
    if (!mixer) return;
    const action = mixer.clipAction(clip);
    applyLoopMode(action, animSettings.loop);
    crossfadeTo(activeClip, action, animSettings.crossfadeMs / 1000);
    setActiveClip(action);
    setPaused(false);
  }

  function togglePlayPause() {
    if (!activeClip) {
      // No active clip — play first on selection
      if (selected?.animations[0]) playClip(selected, selected.animations[0]);
      return;
    }
    activeClip.paused = !activeClip.paused;
    setPaused(activeClip.paused);
  }

  function stopClip() {
    if (selected?.mixer) stopMixer(selected.mixer);
    else if (activeClip) activeClip.stop();
    setActiveClip(null);
    setPaused(false);
  }

  function playClipIndex(index: number) {
    if (!selected?.animations[index]) return;
    playClip(selected, selected.animations[index]);
  }

  function addProceduralSpin() {
    if (!selected) return;
    const clip = buildProceduralClip(selected.object, "spin-y");
    mergeAnimations(selected.id, [...selected.animations, clip]);
    // Play after state flush
    queueMicrotask(() => {
      const it = itemsRef.current.find((i) => i.id === selected.id);
      const c = it?.animations[it.animations.length - 1];
      if (it && c) playClip(it, c);
    });
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
    if (selectedId === id) {
      setSelectedId(null);
      engineRef.current?.pulseSelect(null);
    }
    if (activeClip) stopClip();
  }

  function frameSelected() {
    const engine = engineRef.current;
    if (!engine) return;
    if (selectedNode) {
      engine.frame(selectedNode);
      engine.pulseSelect(selectedNode);
      return;
    }
    if (selected) {
      engine.frame(selected.object);
      engine.pulseSelect(selected.object);
    }
  }

  function frameAll() {
    engineRef.current?.frameAll();
  }

  function cameraHome() {
    engineRef.current?.focusHome();
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

      // Help overlay
      if (!mod && (k === "?" || (e.shiftKey && k === "/"))) {
        e.preventDefault();
        setHotkeyHelp((v) => !v);
        return;
      }
      if (k === "escape" && hotkeyHelp) {
        setHotkeyHelp(false);
        return;
      }

      // Undo / redo (Ctrl/Cmd+Z, Ctrl+Y, Ctrl+Shift+Z)
      if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); undoTransform(); return; }
      if (mod && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); e.stopPropagation(); redoTransform(); return; }

      // Clipboard (Ctrl/Cmd+C/X/V/D)
      if (mod && k === "c" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); copySelected(); return; }
      if (mod && k === "x" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); cutSelected(); return; }
      if (mod && k === "v" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); pasteClipboard(); return; }
      if (mod && k === "d" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); duplicateSelected(); return; }
      if (mod && k === "s" && !e.shiftKey) { e.preventDefault(); saveScene(); return; }
      if (mod && k === "o" && !e.shiftKey) { e.preventDefault(); fileInputRef.current?.click(); return; }

      // AI Texture / AI Edit / Scene Completion
      if ((mod && e.shiftKey && k === "t") || (e.altKey && k === "t")) {
        e.preventDefault();
        void runAiTexture();
        return;
      }
      if ((mod && e.shiftKey && k === "e") || (e.altKey && k === "e")) {
        e.preventDefault();
        setAiEditOpen(true);
        return;
      }
      if ((mod && e.shiftKey && k === "c") || (e.altKey && k === "c" && !mod)) {
        e.preventDefault();
        setCompletionOpen(true);
        return;
      }

      // Frame / camera
      if (!mod && e.shiftKey && k === "f") { e.preventDefault(); frameAll(); return; }
      if (!mod && k === "f") { e.preventDefault(); frameSelected(); return; }
      if (e.key === "Home") { e.preventDefault(); cameraHome(); return; }
      if (!mod && k === "h") { setShowHelpers((v) => !v); return; }

      // Animation
      if (!mod && k === " ") { e.preventDefault(); togglePlayPause(); return; }
      if (!mod && k === "0") { e.preventDefault(); stopClip(); return; }
      if (!mod && e.shiftKey && k === "a") { e.preventDefault(); addProceduralSpin(); return; }
      if (!mod && !e.shiftKey && k >= "1" && k <= "9") {
        e.preventDefault();
        playClipIndex(Number(k) - 1);
        return;
      }

      // Tools
      if (!mod && k === "q") { setTool("select"); return; }
      if (!mod && k === "w") { setTool("translate"); return; }
      if (!mod && k === "e") { setTool("rotate"); return; }
      if (!mod && k === "r" && !e.shiftKey) { setTool("scale"); return; }
      if (!mod && k === "b") { setTool("paint"); return; }
      if (!mod && k === "v" && !e.shiftKey) { setTool("blend-paint"); return; }
      if (!mod && k === "g" && !e.shiftKey) { setTool("fill"); runFillSelected(); return; }
      if (!mod && k === "m") { setTool("fix-mesh"); runFixMesh(); return; }
      if (!mod && k === "t" && !e.shiftKey) { setTool("fix-terrain"); runFixTerrain(); return; }
      if (!mod && k === "k") { setTool("seal-back"); runSealBack(); return; }
      if (!mod && k === "n") { setTool("flip-normals"); runFlipNormals(); return; }
      if (!mod && k === "j") { setTool("weld"); runWeld(); return; }
      if (!mod && k === "i") { setTool("island-prep"); runIslandPrep(); return; }
      if (!mod && e.shiftKey && k === "s") { e.preventDefault(); runSmooth(); return; }
      if (e.key === "End") { e.preventDefault(); runGround(); return; }
      // Brush radius [ ] and strength ; '
      if (!mod && k === "[") { setBrushRadius((r) => Math.max(0.02, +(r * 0.8).toFixed(3))); return; }
      if (!mod && k === "]") { setBrushRadius((r) => Math.min(8, +(r * 1.25).toFixed(3))); return; }
      if (!mod && k === ";") { setBrushStrength((s) => Math.max(0.05, +(s - 0.1).toFixed(2))); return; }
      if (!mod && k === "'") { setBrushStrength((s) => Math.min(1, +(s + 0.1).toFixed(2))); return; }
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

      if (isPaintTool(editorTool)) {
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
          engine.pulseSelect(hit.object);
          // Double-click frames the hit object
          if (ev.detail >= 2) engine.frame(hit.object);
        }
      }
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (!isPaintTool(editorTool) || (ev.buttons & 1) === 0) return;
      if (isDraggingGizmo()) return;
      runPaintOnHit(ev.clientX, ev.clientY);
    };

    const onPointerUp = () => {
      paintStrokeRef.current = new Set();
    };

    // Cursor feedback for paint tools
    canvas.style.cursor = isPaintTool(editorTool) ? "crosshair" : "";

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      canvas.style.cursor = "";
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [editorTool, paintColor, brushRadius, brushStrength, paintMode, items.length]);

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
        brushRadius={brushRadius} setBrushRadius={setBrushRadius}
        brushStrength={brushStrength} setBrushStrength={setBrushStrength}
        paintMode={paintMode} setPaintMode={setPaintMode}
        paintFalloff={paintFalloff} setPaintFalloff={setPaintFalloff}
        affectBackfaces={affectBackfaces} setAffectBackfaces={setAffectBackfaces}
        tintMaterial={tintMaterial} setTintMaterial={setTintMaterial}
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
        onAiTexture={() => void runAiTexture()}
        onAiEdit={() => setAiEditOpen(true)}
        onSceneComplete={() => setCompletionOpen(true)}
        aiBusy={aiBusy}
        onFill={runFillSelected}
        onFixMesh={runFixMesh}
        onFixTerrain={runFixTerrain}
        onSmooth={runSmooth}
        onGround={runGround}
        onSealBack={runSealBack}
        onFlipNormals={runFlipNormals}
        onWeld={runWeld}
        onIslandPrep={runIslandPrep}
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
            <button
              type="button"
              className="text-gold hover:underline ml-1"
              title="Hotkeys (?)"
              onClick={() => setHotkeyHelp(true)}
            >
              ?
            </button>
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
              scriptHost={scriptHost}
              onAiTexture={() => void runAiTexture()}
              onAiEdit={() => setAiEditOpen(true)}
              onSceneComplete={() => setCompletionOpen(true)}
              aiBusy={aiBusy}
              completionLog={completionLog}
            />
          )}
        </Panel>
      </div>

      {completionOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => !aiBusy && setCompletionOpen(false)}
        >
          <div
            className="card max-w-md w-[92%] border border-gold/30"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-2 text-gold font-semibold text-sm">
              <Sparkles size={16} /> Scene Completion AI Worker
            </div>
            <p className="text-[11px] text-muted mb-2">
              Plan + run weld, seal/patch, mesh fix, island prep, and Mixamo-25 skeleton checks.
              Hotkey: <span className="font-mono text-gold">Ctrl+Shift+C</span> / <span className="font-mono text-gold">Alt+C</span>
            </p>
            <label className="block text-[11px] text-muted mb-1">Mode</label>
            <select
              className="w-full text-xs mb-2"
              value={completionMode}
              onChange={(e) => setCompletionMode(e.target.value as typeof completionMode)}
            >
              <option value="auto">Auto (heuristic + AI)</option>
              <option value="mesh-repair">Mesh repair (weld / patch)</option>
              <option value="island">Island prep</option>
              <option value="character-rig">Character rig / Mixamo-25</option>
              <option value="full">Full + AI refine</option>
            </select>
            <label className="block text-[11px] text-muted mb-1">Goal</label>
            <input
              className="w-full text-xs mb-3"
              value={completionGoal}
              onChange={(e) => setCompletionGoal(e.target.value)}
              placeholder="prep for warlords character"
            />
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn ghost text-xs" disabled={aiBusy} onClick={() => setCompletionOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn text-xs"
                disabled={aiBusy || !selected}
                onClick={() => void runSceneCompletion()}
              >
                {aiBusy ? "Running…" : "Plan & execute"}
              </button>
            </div>
            {completionLog && (
              <pre className="mt-3 text-[9px] max-h-36 overflow-auto bg-bg-2 p-2 rounded font-mono whitespace-pre-wrap">
                {completionLog}
              </pre>
            )}
          </div>
        </div>
      )}

      {aiEditOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => !aiBusy && setAiEditOpen(false)}
        >
          <div
            className="card max-w-md w-[92%] border border-gold/30"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-2 text-gold font-semibold text-sm">
              <Bot size={16} /> AI Edit
            </div>
            <p className="text-[11px] text-muted mb-2">
              Describe the change — e.g. “make it gold metal”, “ground and scale 1.5”, “fill blue matte”.
              Hotkey: <span className="font-mono text-gold">Ctrl+Shift+E</span> / <span className="font-mono text-gold">Alt+E</span>
            </p>
            <textarea
              className="w-full text-xs min-h-[72px] mb-2"
              value={aiEditPrompt}
              onChange={(e) => setAiEditPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void runAiEdit(aiEditPrompt);
                }
              }}
              placeholder="What should we change?"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn ghost text-xs" disabled={aiBusy} onClick={() => setAiEditOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn text-xs"
                disabled={aiBusy || !selected}
                onClick={() => void runAiEdit(aiEditPrompt)}
              >
                {aiBusy ? "Working…" : "Run AI Edit"}
              </button>
            </div>
            <p className="text-[10px] text-muted mt-2">Ctrl+Enter to run · uses Ollama / Legion / Workers AI</p>
          </div>
        </div>
      )}

      {hotkeyHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setHotkeyHelp(false)}
        >
          <div
            className="card max-w-lg w-[90%] max-h-[80vh] overflow-auto border border-gold/30"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-gold font-semibold text-sm">Forge hotkeys</h2>
              <button type="button" className="btn ghost text-xs" onClick={() => setHotkeyHelp(false)}>Esc</button>
            </div>
            {Object.entries(hotkeysByGroup()).map(([group, list]) => (
              <div key={group} className="mb-3">
                <div className="text-[10px] uppercase tracking-wide text-muted mb-1">{group}</div>
                <div className="space-y-1">
                  {list.map((h) => (
                    <div key={h.keys + h.action} className="flex justify-between gap-3 text-xs">
                      <span className="font-mono text-gold shrink-0">{h.keys}</span>
                      <span className="text-muted text-right">{h.action}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-[10px] text-muted mt-2">Press <span className="font-mono">?</span> to toggle · {FORGE_HOTKEYS.length} bindings</p>
          </div>
        </div>
      )}
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
  brushRadius: number;
  setBrushRadius: (r: number) => void;
  brushStrength: number;
  setBrushStrength: (s: number) => void;
  paintMode: PaintMode;
  setPaintMode: (m: PaintMode) => void;
  paintFalloff: PaintFalloff;
  setPaintFalloff: (f: PaintFalloff) => void;
  affectBackfaces: boolean;
  setAffectBackfaces: (v: boolean) => void;
  tintMaterial: boolean;
  setTintMaterial: (v: boolean) => void;
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
  onAiTexture: () => void;
  onAiEdit: () => void;
  onSceneComplete: () => void;
  aiBusy: boolean;
  onFill: () => void;
  onFixMesh: () => void;
  onFixTerrain: () => void;
  onSmooth: () => void;
  onGround: () => void;
  onSealBack: () => void;
  onFlipNormals: () => void;
  onWeld: () => void;
  onIslandPrep: () => void;
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
  const paintActive = props.editorTool === "paint" || props.editorTool === "blend-paint";
  const slider: React.CSSProperties = { width: 72, accentColor: "var(--gold)" };
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
      <Btn onClick={props.onUndo} title="Undo (Ctrl+Z)" disabled={!props.canUndo}><Undo2 size={14} />Undo</Btn>
      <Btn onClick={props.onRedo} title="Redo (Ctrl+Y / Ctrl+Shift+Z)" disabled={!props.canRedo}><Redo2 size={14} />Redo</Btn>
      <Btn onClick={props.onCopy} title="Copy (Ctrl+C)" disabled={!props.hasSelection}><Copy size={14} />Copy</Btn>
      <Btn onClick={props.onCut} title="Cut (Ctrl+X)" disabled={!props.hasSelection}><Scissors size={14} />Cut</Btn>
      <Btn onClick={props.onPaste} title="Paste (Ctrl+V)"><ClipboardPaste size={14} />Paste</Btn>
      <Btn onClick={props.onDuplicate} title="Duplicate (Ctrl+D)" disabled={!props.hasSelection}><Plus size={14} />Dup</Btn>
      <Btn
        onClick={props.onAiTexture}
        title="AI Texture — PBR + find maps (Ctrl+Shift+T / Alt+T)"
        disabled={!props.hasSelection || props.aiBusy}
      >
        <ImageIcon size={14} />AI Tex
      </Btn>
      <Btn
        onClick={props.onAiEdit}
        title="AI Edit — natural language (Ctrl+Shift+E / Alt+E)"
        disabled={!props.hasSelection || props.aiBusy}
      >
        <Wand2 size={14} />AI Edit
      </Btn>
      <Btn
        onClick={props.onSceneComplete}
        title="Scene Completion — weld / patch / rig (Ctrl+Shift+C / Alt+C)"
        disabled={!props.hasSelection || props.aiBusy}
      >
        <Sparkles size={14} />Complete
      </Btn>
      <Btn onClick={() => props.onAddPrimitive("box")} title="Add box primitive"><Plus size={14} />Box</Btn>
      <span style={{ width: 1, height: 22, background: "var(--line)" }} />
      <Btn active={props.editorTool === "select"} onClick={() => props.setTool("select")} title={`${EDITOR_TOOL_META.select.label} (${EDITOR_TOOL_META.select.hotkey})`}><MousePointer2 size={14} /></Btn>
      <Btn active={props.editorTool === "translate" || props.gizmoMode === "translate"} onClick={() => props.setTool("translate")} title="Translate (W)"><Move size={14} />T</Btn>
      <Btn active={props.editorTool === "rotate" || props.gizmoMode === "rotate"} onClick={() => props.setTool("rotate")} title="Rotate (E)"><RotateCcw size={14} />R</Btn>
      <Btn active={props.editorTool === "scale" || props.gizmoMode === "scale"} onClick={() => props.setTool("scale")} title="Scale (R)"><Maximize2 size={14} />S</Btn>
      <span style={{ width: 1, height: 22, background: "var(--line)" }} />
      <Btn active={props.editorTool === "paint"} onClick={() => props.setTool("paint")} title="3D vertex brush (B)"><Paintbrush size={14} />Brush</Btn>
      <Btn active={props.editorTool === "blend-paint"} onClick={() => props.setTool("blend-paint")} title="Blend paint (V)"><Blend size={14} />Blend</Btn>
      <label title="Brush color" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--muted)" }}>
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
      <label title="Radius ([ ])" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--muted)" }}>
        R
        <input type="range" min={0.02} max={3} step={0.01} value={props.brushRadius}
          onChange={(e) => props.setBrushRadius(parseFloat(e.target.value))} style={slider} />
        <span style={{ minWidth: 28 }}>{props.brushRadius.toFixed(2)}</span>
      </label>
      <label title="Strength (; ')" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--muted)" }}>
        S
        <input type="range" min={0.05} max={1} step={0.05} value={props.brushStrength}
          onChange={(e) => props.setBrushStrength(parseFloat(e.target.value))} style={slider} />
        <span style={{ minWidth: 28 }}>{props.brushStrength.toFixed(2)}</span>
      </label>
      <select
        title="Paint mode"
        value={props.paintMode}
        onChange={(e) => props.setPaintMode(e.target.value as PaintMode)}
        style={{ fontSize: 11, background: "var(--bg-2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 4, padding: "3px 4px" }}
      >
        <option value="blend">Blend</option>
        <option value="replace">Replace</option>
        <option value="add">Add</option>
        <option value="subtract">Subtract</option>
        <option value="smooth">Smooth</option>
        <option value="erase">Erase</option>
      </select>
      <select
        title="Falloff"
        value={props.paintFalloff}
        onChange={(e) => props.setPaintFalloff(e.target.value as PaintFalloff)}
        style={{ fontSize: 11, background: "var(--bg-2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 4, padding: "3px 4px" }}
      >
        <option value="smooth">Smooth</option>
        <option value="linear">Linear</option>
        <option value="hard">Hard</option>
      </select>
      <label title="Paint backfaces" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--muted)" }}>
        <input type="checkbox" checked={props.affectBackfaces} onChange={(e) => props.setAffectBackfaces(e.target.checked)} />
        Back
      </label>
      <label title="Also tint material color" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--muted)" }}>
        <input type="checkbox" checked={props.tintMaterial} onChange={(e) => props.setTintMaterial(e.target.checked)} />
        Tint
      </label>
      {paintActive && (
        <span style={{ fontSize: 10, color: "var(--gold)" }}>3D brush active — drag on mesh</span>
      )}
      <Btn active={props.editorTool === "fill"} onClick={() => { props.setTool("fill"); props.onFill(); }} title="Fill selection (G)" disabled={!props.hasSelection}><PaintBucket size={14} />Fill</Btn>
      <span style={{ width: 1, height: 22, background: "var(--line)" }} />
      <Btn onClick={props.onFixMesh} title="Fix mesh (M)" disabled={!props.hasSelection}><Wrench size={14} />Mesh</Btn>
      <Btn onClick={props.onFixTerrain} title="Fix terrain (T)" disabled={!props.hasSelection}><Mountain size={14} />Terrain</Btn>
      <Btn onClick={props.onSealBack} title="Seal open backs (K) — island shells" disabled={!props.hasSelection}><Layers size={14} />Seal</Btn>
      <Btn onClick={props.onFlipNormals} title="Flip normals (N)" disabled={!props.hasSelection}><FlipVertical2 size={14} />Flip</Btn>
      <Btn onClick={props.onWeld} title="Weld cracks (J)" disabled={!props.hasSelection}><Combine size={14} />Weld</Btn>
      <Btn onClick={props.onIslandPrep} title="Island prep (I) — ground + weld + seal" disabled={!props.hasSelection}><LandPlot size={14} />Island</Btn>
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


