/**
 * Skeleton Studio — wired Mixamo-25 wizard:
 * load → extract → tpose → place → skills → export → libraries
 * Each step tab runs/focuses a real action (not a no-op label).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { toast } from "sonner";
import {
  Bone,
  Download,
  FileBox,
  FolderOpen,
  Library,
  MousePointer2,
  Package,
  Play,
  RefreshCw,
  Sparkles,
  Target,
  Upload,
  Wand2,
  CheckCircle2,
  Circle,
  AlertCircle,
} from "lucide-react";
import { SceneEngine } from "../lib/forge/sceneEngine";
import { loadModel, type LoadedModel } from "../lib/forge/loaders";
import {
  MIXAMO_25_CORE,
  ANIM_WEAPON_PACKS,
  type Mixamo25Bone,
  type BonePlacement,
  type SkeletonMappingDoc,
  emptyMapping,
  ANIM_SKILL_SLOTS,
  matchSkillSlot,
  applyAutoMapToDoc,
} from "../../shared/mixamo25";

declare global {
  interface Window {
    grudge: any;
  }
}

type Step =
  | "load"
  | "extract"
  | "tpose"
  | "place"
  | "skills"
  | "export"
  | "libraries";

interface LocalLib {
  packDir: string;
  name: string;
  skeleton: string;
  clipCount: number;
  textureCount: number;
  jointCount: number;
  fingerprint: string | null;
  createdAt: string | null;
  manifestPath: string;
}

const STEPS: Array<{
  id: Step;
  label: string;
  hint: string;
}> = [
  { id: "load", label: "Load", hint: "Open FBX/GLB character" },
  { id: "extract", label: "Extract", hint: "Textures + anim clips" },
  { id: "tpose", label: "T-pose", hint: "Blender rest pose prep" },
  { id: "place", label: "Place", hint: "Map Mixamo-25 bones" },
  { id: "skills", label: "Skills", hint: "Clip → skill slots" },
  { id: "export", label: "Export", hint: "Build anim library pack" },
  { id: "libraries", label: "Libraries", hint: "Local + fleet packs" },
];

function findNearestBone(root: THREE.Object3D, world: THREE.Vector3): THREE.Bone | null {
  let best: THREE.Bone | null = null;
  let bestD = Infinity;
  const wp = new THREE.Vector3();
  root.traverse((o) => {
    const b = o as THREE.Bone;
    if (!b.isBone) return;
    b.getWorldPosition(wp);
    const d = wp.distanceToSquared(world);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  });
  return best;
}

function collectBoneNames(root: THREE.Object3D): string[] {
  const names: string[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) names.push(o.name);
  });
  return names;
}

function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = "#67e8f9";
  ctx.font = "bold 22px sans-serif";
  ctx.fillText(text.slice(0, 28), 8, 40);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(0.45, 0.12, 1);
  return spr;
}

function apiReady(): boolean {
  return Boolean(window.grudge?.skeleton && window.grudge?.files && window.grudge?.forge);
}

export default function SkeletonStudio() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SceneEngine | null>(null);
  const markersRef = useRef<THREE.Group | null>(null);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);

  const [step, setStep] = useState<Step>("load");
  const [diskPath, setDiskPath] = useState<string | null>(null);
  const [model, setModel] = useState<LoadedModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState("Open a skinned FBX/GLB to begin.");
  const [extract, setExtract] = useState<any>(null);
  const [activeBone, setActiveBone] = useState<Mixamo25Bone>("Hips");
  const [mapping, setMapping] = useState<SkeletonMappingDoc>(() => emptyMapping(""));
  const [aiHint, setAiHint] = useState(
    "Humanoid upright T-pose, arms horizontal, palms down, feet flat.",
  );
  const [packDir, setPackDir] = useState<string | null>(null);
  const [tposePath, setTposePath] = useState<string | null>(null);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [mixer, setMixer] = useState<THREE.AnimationMixer | null>(null);
  const [animClips, setAnimClips] = useState<THREE.AnimationClip[]>([]);
  const [activeAction, setActiveAction] = useState<THREE.AnimationAction | null>(null);
  const [libraries, setLibraries] = useState<LocalLib[]>([]);
  const [fleetAnims, setFleetAnims] = useState<Array<{ name: string; url?: string; key?: string }>>(
    [],
  );
  const [slotOverrides, setSlotOverrides] = useState<Record<string, string>>({});
  const [apiOk, setApiOk] = useState(true);

  // Scene host
  useEffect(() => {
    if (!viewportRef.current) return;
    const engine = new SceneEngine(viewportRef.current, {
      background: 0x0a0e1a,
      showGrid: true,
      showAxes: true,
      hdri: true,
    });
    engineRef.current = engine;
    const markers = new THREE.Group();
    markers.name = "bone-markers";
    engine.scene.add(markers);
    markersRef.current = markers;
    // Force resize after layout settles (full-height shell)
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    setApiOk(apiReady());
  }, []);

  const rebuildMarkers = useCallback(
    (placements: BonePlacement[]) => {
      const g = markersRef.current;
      if (!g) return;
      while (g.children.length) g.remove(g.children[0]);
      for (const p of placements) {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.04, 12, 12),
          new THREE.MeshStandardMaterial({
            color: p.bone === activeBone ? 0x22d3ee : 0xf59e0b,
            emissive: p.bone === activeBone ? 0x0891b2 : 0x78350f,
            emissiveIntensity: 0.4,
          }),
        );
        mesh.position.set(...p.world);
        mesh.userData.bone = p.bone;
        g.add(mesh);
        const label = makeLabel(p.bone + (p.sourceBone ? ` ← ${p.sourceBone}` : ""));
        label.position.set(p.world[0], p.world[1] + 0.08, p.world[2]);
        g.add(label);
      }
    },
    [activeBone],
  );

  useEffect(() => {
    rebuildMarkers(mapping.placements);
  }, [mapping.placements, activeBone, rebuildMarkers]);

  async function refreshLibraries() {
    try {
      if (!window.grudge?.skeleton?.listLibraries) return;
      const list = await window.grudge.skeleton.listLibraries();
      setLibraries(Array.isArray(list) ? list : []);
    } catch {
      setLibraries([]);
    }
  }

  async function refreshFleetAnims() {
    try {
      const res = await window.grudge?.os?.search?.({
        q: "anim",
        limit: 24,
        prefix: "models/anims",
      });
      const items = res?.items ?? res?.results ?? res ?? [];
      if (Array.isArray(items)) {
        setFleetAnims(
          items.slice(0, 24).map((it: any) => ({
            name: it.name || it.key || it.path || "asset",
            url: it.url || it.cdnUrl,
            key: it.key || it.path,
          })),
        );
      }
    } catch {
      setFleetAnims([]);
    }
  }

  useEffect(() => {
    void refreshLibraries();
    void refreshFleetAnims();
  }, []);

  async function loadFromPath(path: string) {
    if (!window.grudge?.forge?.readFile) {
      toast.error("Forge IPC missing — restart Dev Tool");
      return;
    }
    setBusy(true);
    setStatusLine(`Loading ${path}…`);
    try {
      const fileData = await window.grudge.forge.readFile(path);
      const bytes = fileData.bytes as Uint8Array;
      const name = fileData.name || path.split(/[/\\]/).pop() || "model.glb";
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const file = new File([ab], name);
      const loaded = await loadModel(file, { diskPath: path });
      if (engineRef.current) {
        const scene = engineRef.current.scene;
        const toRemove: THREE.Object3D[] = [];
        scene.children.forEach((o) => {
          if (o.userData?.isUserModel) toRemove.push(o);
        });
        toRemove.forEach((o) => {
          engineRef.current?.removeSkeletonHelper(o);
          const m = o.userData.grudgeMixer as THREE.AnimationMixer | undefined;
          if (m) engineRef.current?.removeMixer(m);
          scene.remove(o);
        });
        loaded.object.userData.isUserModel = true;
        scene.add(loaded.object);
        engineRef.current.frame(loaded.object);

        const { attachAnimationMixer } = await import("../lib/forge/forgeAnimation");
        const handle = attachAnimationMixer(loaded.object, loaded.animations, {
          dropRootMotion: true,
        });
        engineRef.current.mixers.push(handle.mixer);
        engineRef.current.setSkeletonHelper(loaded.object, showSkeleton);
        setMixer(handle.mixer);
        setAnimClips(handle.clips);
        setActiveAction(null);

        const jointNames = collectBoneNames(loaded.object);
        if (jointNames.length) {
          setMapping((m) =>
            applyAutoMapToDoc({ ...emptyMapping(path), placements: m.placements }, jointNames),
          );
        } else {
          setMapping(emptyMapping(path));
        }
      }
      setModel(loaded);
      setDiskPath(path);
      setExtract(null);
      setPackDir(null);
      setTposePath(null);
      setSlotOverrides({});
      setStep("extract");
      setStatusLine(
        `Loaded · ${loaded.bones} bones · ${loaded.animations.length} clips · ready to extract`,
      );
      toast.success("Character loaded", {
        description: `${loaded.bones} bones · ${loaded.animations.length} clips`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatusLine(`Load failed: ${msg}`);
      toast.error("Load failed", { description: msg });
    } finally {
      setBusy(false);
    }
  }

  async function pickFile() {
    if (!window.grudge?.files?.pickForUpload) {
      toast.error("File picker unavailable — restart the app");
      return;
    }
    try {
      const paths: string[] = await window.grudge.files.pickForUpload();
      const path = paths?.find((p) => /\.(fbx|glb|gltf|obj)$/i.test(p));
      if (!path) {
        if (paths?.length) toast.message("Pick an FBX, GLB, GLTF, or OBJ");
        return;
      }
      await loadFromPath(path);
    } catch (e: unknown) {
      toast.error("Picker failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function runExtract() {
    if (!diskPath) {
      toast.error("Load a model first");
      setStep("load");
      return;
    }
    setBusy(true);
    setStatusLine("Extracting textures + animations…");
    try {
      const res = await window.grudge.skeleton.extract(diskPath);
      if (!res?.ok) {
        toast.error("Extract failed", { description: res?.errors?.join("; ") || "unknown" });
        setStatusLine(`Extract failed: ${res?.errors?.join("; ") || "unknown"}`);
      } else {
        setExtract(res);
        if (res.skeleton?.jointNames?.length) {
          setMapping((m) => applyAutoMapToDoc(m, res.skeleton.jointNames));
        }
        if (res.glbPath && res.glbPath !== diskPath) {
          // Prefer converted GLB for later steps
          setDiskPath(res.glbPath);
        }
        setStep("tpose");
        setStatusLine(
          `Extracted ${res.textures?.length ?? 0} textures · ${res.animations?.length ?? 0} clips · ${res.skeleton?.jointCount ?? 0} joints`,
        );
        toast.success("Extract complete", {
          description: `${res.textures?.length ?? 0} textures · ${res.animations?.length ?? 0} clips`,
        });
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "extract error");
    } finally {
      setBusy(false);
    }
  }

  async function runAutoMap() {
    const names =
      extract?.skeleton?.jointNames?.length
        ? extract.skeleton.jointNames
        : model
          ? collectBoneNames(model.object)
          : [];
    if (!names.length) {
      toast.error("No skeleton joints — load a skinned FBX/GLB first");
      setStep("load");
      return;
    }
    try {
      const auto = await window.grudge.skeleton.autoMap(names);
      setMapping((m) => ({
        ...applyAutoMapToDoc(m, names),
        autoMap: auto,
        reverseMap: auto.reverseMap,
        boneMap: { ...auto.boneMap, ...m.boneMap },
      }));
      if (model) {
        const placements: BonePlacement[] = [];
        const wp = new THREE.Vector3();
        for (const target of MIXAMO_25_CORE) {
          const srcName = auto.reverseMap?.[target];
          if (!srcName) continue;
          let boneObj: THREE.Bone | null = null;
          model.object.traverse((o) => {
            if ((o as THREE.Bone).isBone && o.name === srcName) boneObj = o as THREE.Bone;
          });
          if (boneObj) {
            (boneObj as THREE.Bone).getWorldPosition(wp);
            placements.push({
              bone: target,
              world: [wp.x, wp.y, wp.z],
              sourceBone: srcName,
              confidence: 0.9,
            });
          }
        }
        if (placements.length) setMapping((m) => ({ ...m, placements }));
      }
      toast.success(`Auto-mapped ${auto.matched}/22 Mixamo-25 bones`);
      setStatusLine(`Bone map ${auto.matched}/22 — click mesh to place remaining`);
      setStep("place");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "auto-map failed");
    }
  }

  async function runTPose() {
    if (!diskPath) {
      toast.error("Load a model first");
      setStep("load");
      return;
    }
    setBusy(true);
    setStatusLine("T-pose prep (Blender)…");
    try {
      let hint = aiHint;
      try {
        const ai = await window.grudge?.ollama?.generate?.({
          prompt: `Rewrite as a short 3D rigging T-pose instruction for Blender (max 40 words): ${aiHint}`,
        });
        if (ai?.response) hint = String(ai.response).slice(0, 400);
      } catch {
        /* offline ok */
      }

      const res = await window.grudge.skeleton.tpose(diskPath, { aiHint: hint });
      if (!res?.ok || !res.outputPath) {
        const err = res?.errors?.join("; ") || "Blender missing or failed";
        toast.error("T-pose failed", { description: err });
        setStatusLine(`T-pose failed: ${err}`);
      } else {
        setTposePath(res.outputPath);
        await loadFromPath(res.outputPath);
        setStep("place");
        setStatusLine("T-pose GLB ready — auto-map or click to place bones");
        toast.success("T-pose GLB ready");
        void runAutoMap();
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "tpose error");
    } finally {
      setBusy(false);
    }
  }

  // Place mode clicks
  useEffect(() => {
    const el = viewportRef.current;
    const engine = engineRef.current;
    if (!el || !engine || step !== "place") return;

    const onClick = (ev: MouseEvent) => {
      if (!model) return;
      const rect = el.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, engine.camera);
      const meshes: THREE.Object3D[] = [];
      model.object.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes.push(o);
      });
      const hits = raycaster.intersectObjects(meshes, true);
      if (!hits.length) return;
      const p = hits[0].point;
      const world: [number, number, number] = [p.x, p.y, p.z];
      const nearest = findNearestBone(model.object, p);
      const sourceBone = nearest?.name;

      setMapping((m) => {
        const placements = m.placements.filter((x) => x.bone !== activeBone);
        placements.push({
          bone: activeBone,
          world,
          meshUuid: hits[0].object.uuid,
          sourceBone,
          confidence: sourceBone ? 0.85 : 1,
        });
        const boneMap = { ...m.boneMap };
        const reverseMap = { ...(m.reverseMap || {}) };
        if (sourceBone) {
          boneMap[sourceBone] = activeBone;
          reverseMap[activeBone] = sourceBone;
        } else {
          boneMap[activeBone] = activeBone;
          reverseMap[activeBone] = activeBone;
        }
        return {
          ...m,
          placements,
          boneMap,
          reverseMap,
          sourceFile: diskPath || m.sourceFile,
          updatedAt: new Date().toISOString(),
        };
      });
      setActiveBone((cur) => {
        const placed = new Set([...mapping.placements.map((x) => x.bone), activeBone]);
        const next = MIXAMO_25_CORE.find((b) => !placed.has(b));
        return next ?? cur;
      });
      toast.message(sourceBone ? `Placed ${activeBone} ← ${sourceBone}` : `Placed ${activeBone}`);
    };

    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [step, model, activeBone, diskPath, mapping.placements, pointer, raycaster]);

  async function exportLibrary() {
    const path = tposePath || diskPath;
    if (!path) {
      toast.error("Load a model first");
      setStep("load");
      return;
    }
    setBusy(true);
    setStatusLine("Building retarget anim library v2…");
    try {
      const res = await window.grudge.skeleton.buildLibrary({
        modelPath: path,
        mapping,
        packName: path.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") + "-mixamo25",
      });
      if (!res?.ok) {
        toast.error("Library build failed", { description: res?.errors?.join("; ") });
        setStatusLine(`Export failed: ${res?.errors?.join("; ")}`);
      } else {
        setPackDir(res.packDir);
        setStep("export");
        setStatusLine(`Pack ready: ${res.packDir}`);
        toast.success("Anim library pack ready", {
          description: `${res.clips?.length ?? 0} clips · ${res.autoMapped ?? 0} bones mapped`,
        });
        void refreshLibraries();
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "export error");
    } finally {
      setBusy(false);
    }
  }

  async function installPackLocal() {
    if (!packDir) return;
    setBusy(true);
    try {
      const res = await window.grudge.skeleton.installLibrary(packDir);
      if (res?.ok) {
        toast.success("Installed to Documents/grudge-anim-libraries", {
          description: res.dest,
        });
        void refreshLibraries();
        setStep("libraries");
      } else toast.error(res?.error || "Install failed");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "install error");
    } finally {
      setBusy(false);
    }
  }

  async function uploadPack() {
    if (!packDir) return;
    setBusy(true);
    try {
      const stamp = Date.now();
      const rest = `${packDir}/rest.glb`.replace(/\\/g, "/");
      const job = {
        id: `skel-${stamp}`,
        packId: "anim-libraries",
        packVersion: "2.0.0",
        buildManifest: true,
        files: [
          {
            localPath: rest,
            targetPath: `models/anims/libraries/${stamp}/rest.glb`,
            contentType: "model/gltf-binary",
          },
          {
            localPath: `${packDir}/anim-library-manifest.json`,
            targetPath: `models/anims/libraries/${stamp}/anim-library-manifest.json`,
            contentType: "application/json",
          },
          {
            localPath: `${packDir}/retarget-map.json`,
            targetPath: `models/anims/libraries/${stamp}/retarget-map.json`,
            contentType: "application/json",
          },
          {
            localPath: `${packDir}/skeleton-mapping.json`,
            targetPath: `models/anims/libraries/${stamp}/skeleton-mapping.json`,
            contentType: "application/json",
          },
          {
            localPath: `${packDir}/clips-index.json`,
            targetPath: `models/anims/libraries/${stamp}/clips-index.json`,
            contentType: "application/json",
          },
        ],
      };
      await window.grudge.upload.enqueue(job);
      toast.success("Upload queued → models/anims/libraries on R2");
      setStatusLine("Upload queued to fleet CDN");
    } catch (e: unknown) {
      toast.error("Upload failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  async function convertOnly() {
    if (!diskPath) return;
    setBusy(true);
    try {
      const res = await window.grudge.ingest.convert(diskPath);
      if (res?.ok && res.outputPath) {
        toast.success("Converted to production GLB", { description: res.outputPath });
        await loadFromPath(res.outputPath);
      } else {
        toast.error("Convert failed", { description: res?.errors?.join("; ") });
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "convert error");
    } finally {
      setBusy(false);
    }
  }

  async function retargetFromExternalPack() {
    if (!model || !engineRef.current) {
      toast.error("Load a target character first");
      setStep("load");
      return;
    }
    const paths: string[] = await window.grudge.files.pickForUpload();
    const path = paths?.find((p) => /\.(fbx|glb|gltf)$/i.test(p));
    if (!path) return;
    setBusy(true);
    try {
      const fileData = await window.grudge.forge.readFile(path);
      const bytes = fileData.bytes as Uint8Array;
      const name = fileData.name || path.split(/[/\\]/).pop() || "pack.glb";
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const file = new File([ab], name);
      const source = await loadModel(file, { diskPath: path });
      if (!source.animations.length) {
        toast.error("Source pack has no animation clips");
        return;
      }
      const { retargetClips } = await import("../lib/forge/boneAliases");
      const retargeted = retargetClips(source.animations, model.object, source.object, {
        dropRootChain: true,
      });
      const merged = [...model.animations, ...retargeted];
      model.animations = merged;
      const { attachAnimationMixer } = await import("../lib/forge/forgeAnimation");
      if (mixer) engineRef.current.removeMixer(mixer);
      const handle = attachAnimationMixer(model.object, merged, { dropRootMotion: true });
      engineRef.current.mixers.push(handle.mixer);
      setMixer(handle.mixer);
      setAnimClips(handle.clips);
      setActiveAction(null);
      toast.success(`Retargeted ${retargeted.length} clips`, { description: name });
      setStep("skills");
      setStatusLine(`+${retargeted.length} retargeted clips — assign skill slots`);
    } catch (e: unknown) {
      toast.error("Retarget failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  async function loadLibraryRestGlb(lib: LocalLib) {
    const rest = `${lib.packDir}/rest.glb`.replace(/\\/g, "/");
    try {
      await loadFromPath(rest);
      toast.success(`Loaded library: ${lib.name}`);
    } catch (e: unknown) {
      toast.error("Could not load pack rest.glb", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }

  useEffect(() => {
    if (!model || !engineRef.current) return;
    engineRef.current.setSkeletonHelper(model.object, showSkeleton);
  }, [showSkeleton, model]);

  function playAnimClip(clip: THREE.AnimationClip) {
    if (!mixer) {
      toast.error("No AnimationMixer — reload the model");
      return;
    }
    if (activeAction) activeAction.fadeOut(0.15);
    const act = mixer.clipAction(clip);
    act.reset().fadeIn(0.15).setLoop(THREE.LoopRepeat, Infinity).play();
    setActiveAction(act);
  }

  /** Step tab click: navigate AND run the step's primary action when ready */
  async function goStep(s: Step) {
    setStep(s);
    if (s === "load" && !diskPath) {
      setStatusLine("Click Open FBX/GLB to load a character");
      return;
    }
    if (s === "extract" && diskPath && !extract && !busy) {
      await runExtract();
      return;
    }
    if (s === "tpose" && diskPath && !busy) {
      // Stay on panel; user confirms AI hint then runs
      setStatusLine("Review T-pose hint, then run AI T-pose prep");
      return;
    }
    if (s === "place") {
      if (!model) {
        toast.error("Load a model first");
        setStep("load");
        return;
      }
      if (!(mapping.autoMap?.matched || Object.keys(mapping.reverseMap || {}).length)) {
        await runAutoMap();
      } else {
        setStatusLine("Click mesh to place active Mixamo bone (snaps to nearest joint)");
      }
      return;
    }
    if (s === "skills") {
      setStatusLine(
        animClips.length || extract?.animations?.length
          ? "Assign clips to skill slots"
          : "Extract or load clips first",
      );
      return;
    }
    if (s === "export" && diskPath && !packDir && !busy) {
      await exportLibrary();
      return;
    }
    if (s === "libraries") {
      void refreshLibraries();
      void refreshFleetAnims();
      setStatusLine("Local Documents libraries + fleet anim search");
    }
  }

  const placedCount = mapping.placements.length;
  const clips = extract?.animations ?? [];
  const autoMatched =
    mapping.autoMap?.matched ?? Object.keys(mapping.reverseMap || {}).length;

  const stepDone: Record<Step, boolean> = {
    load: Boolean(model && diskPath),
    extract: Boolean(extract?.ok),
    tpose: Boolean(tposePath),
    place: placedCount >= 8 || autoMatched >= 12,
    skills: animClips.length > 0 || clips.length > 0,
    export: Boolean(packDir),
    libraries: libraries.length > 0,
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#070a12] text-slate-100">
      {/* Header + actionable steps */}
      <header className="shrink-0 border-b border-white/10 bg-black/40">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <Bone className="h-4 w-4 text-cyan-400" />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-wide">Skeleton Studio</h1>
            <p className="text-[10px] text-slate-500 truncate">
              Mixamo-25 · extract · T-pose · retarget · grudge-convert → CDN
            </p>
          </div>
          {!apiOk && (
            <span className="ml-2 flex items-center gap-1 text-[10px] text-amber-400">
              <AlertCircle className="h-3 w-3" /> IPC incomplete — restart app
            </span>
          )}
          <div className="ml-auto flex flex-wrap gap-1">
            <button
              type="button"
              className="rounded border border-cyan-700/50 bg-cyan-950/40 px-2 py-1 text-[10px] hover:border-cyan-500"
              onClick={() => void pickFile()}
              disabled={busy}
            >
              <FolderOpen className="inline h-3 w-3 mr-1" />
              Open model
            </button>
            <button
              type="button"
              className="rounded border border-slate-700 px-2 py-1 text-[10px] hover:border-slate-500"
              onClick={() => void convertOnly()}
              disabled={!diskPath || busy}
              title="grudge-convert / FBX→GLB"
            >
              Convert GLB
            </button>
          </div>
        </div>
        <nav className="flex flex-wrap gap-1 px-2 pb-2">
          {STEPS.map((s, i) => {
            const done = stepDone[s.id];
            const active = step === s.id;
            return (
              <button
                key={s.id}
                type="button"
                disabled={busy}
                title={s.hint}
                onClick={() => void goStep(s.id)}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] transition-colors ${
                  active
                    ? "border-cyan-500/60 bg-cyan-950/60 text-cyan-100"
                    : done
                      ? "border-emerald-800/40 bg-emerald-950/20 text-emerald-200/90 hover:border-emerald-600/50"
                      : "border-white/10 bg-black/30 text-slate-400 hover:border-white/20 hover:text-slate-200"
                }`}
              >
                {done ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                ) : (
                  <Circle className="h-3 w-3 opacity-50" />
                )}
                <span className="font-medium">
                  {i + 1}. {s.label}
                </span>
              </button>
            );
          })}
        </nav>
        <div className="border-t border-white/5 px-3 py-1 text-[10px] text-slate-400 font-mono truncate">
          {busy ? "Working…" : statusLine}
          {diskPath ? ` · ${diskPath.split(/[/\\]/).pop()}` : ""}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Viewport */}
        <div className="relative min-h-0 min-w-0 flex-1 bg-[#0a0e1a]">
          <div ref={viewportRef} className="absolute inset-0" />
          {!model && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
              <Bone className="h-10 w-10 text-cyan-500/40" />
              <p className="text-sm text-slate-300">No character loaded</p>
              <p className="text-[11px] text-slate-500 max-w-sm">
                Use <strong className="text-cyan-300">Open model</strong> or step{" "}
                <strong>1. Load</strong> — pick FBX/GLB with a humanoid skeleton.
              </p>
            </div>
          )}
          {step === "place" && model && (
            <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/75 px-2 py-1 text-[11px] text-cyan-200">
              <MousePointer2 className="mr-1 inline h-3 w-3" />
              Click mesh → place <strong>{activeBone}</strong> ({placedCount}/
              {MIXAMO_25_CORE.length}) · snaps to nearest bone
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-sm text-cyan-100">
              Working…
            </div>
          )}
        </div>

        {/* Step panel */}
        <aside className="flex w-[24rem] shrink-0 flex-col border-l border-white/10 bg-black/30">
          <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
            {/* Always: model status */}
            {model && (
              <section className="rounded border border-white/10 bg-black/40 p-2 space-y-1.5">
                <div className="text-[10px] text-slate-400">
                  Mixer:{" "}
                  {mixer ? (
                    <span className="text-emerald-400">on</span>
                  ) : (
                    <span className="text-amber-400">off</span>
                  )}{" "}
                  · Bones {model.bones} · Clips {animClips.length} · Map {autoMatched}/22
                </div>
                <label className="flex items-center gap-2 text-[11px]">
                  <input
                    type="checkbox"
                    checked={showSkeleton}
                    onChange={(e) => setShowSkeleton(e.target.checked)}
                  />
                  Skeleton helper
                </label>
                {animClips.length > 0 && (
                  <div className="max-h-24 overflow-auto rounded border border-slate-800">
                    {animClips.map((c) => (
                      <button
                        key={c.uuid}
                        type="button"
                        onClick={() => playAnimClip(c)}
                        className={`flex w-full items-center gap-1 truncate px-2 py-1 text-left text-[10px] hover:bg-cyan-950/50 ${
                          activeAction?.getClip() === c
                            ? "bg-cyan-900/40 text-cyan-200"
                            : "text-slate-400"
                        }`}
                      >
                        <Play className="h-2.5 w-2.5 shrink-0" />
                        {c.name || "(unnamed)"} · {c.duration.toFixed(1)}s
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Step: LOAD */}
            {step === "load" && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-cyan-200">1 · Load character</h2>
                <p className="text-[11px] text-slate-400">
                  Open a skinned FBX or GLB. Viewport shows the mesh + skeleton + playable clips.
                </p>
                <button
                  type="button"
                  onClick={() => void pickFile()}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-cyan-600/50 bg-cyan-950/50 px-3 py-3 text-sm font-medium hover:bg-cyan-900/40 disabled:opacity-40"
                >
                  <FolderOpen className="h-4 w-4" /> Open FBX / GLB / OBJ
                </button>
                {diskPath && (
                  <button
                    type="button"
                    className="w-full rounded border border-emerald-700/40 px-2 py-2 text-[11px] text-emerald-200"
                    onClick={() => void goStep("extract")}
                  >
                    Next: Extract →
                  </button>
                )}
              </section>
            )}

            {/* Step: EXTRACT */}
            {step === "extract" && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-cyan-200">2 · Extract</h2>
                <p className="text-[11px] text-slate-400">
                  Converts if needed, pulls textures + animation metadata, auto-maps joints.
                </p>
                <button
                  type="button"
                  disabled={!diskPath || busy}
                  onClick={() => void runExtract()}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-slate-800 px-3 py-3 text-sm font-medium disabled:opacity-40 hover:bg-slate-700"
                >
                  <FileBox className="h-4 w-4" /> Run extract
                </button>
                {extract && (
                  <div className="rounded border border-slate-700 p-2 text-[11px] text-slate-300">
                    Textures: {extract.textures?.length ?? 0} · Anims:{" "}
                    {extract.animations?.length ?? 0} · Joints:{" "}
                    {extract.skeleton?.jointCount ?? 0}
                    {extract.glbPath && (
                      <div className="mt-1 truncate text-[10px] text-slate-500">
                        GLB: {extract.glbPath}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* Step: TPOSE */}
            {step === "tpose" && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-cyan-200">3 · T-pose</h2>
                <p className="text-[11px] text-slate-400">
                  Requires Blender on PATH or toolchain settings. Optional AI hint polish via Ollama.
                </p>
                <label className="text-[10px] text-slate-500">Hint</label>
                <textarea
                  value={aiHint}
                  onChange={(e) => setAiHint(e.target.value)}
                  rows={3}
                  className="w-full rounded border border-slate-700 bg-black/50 px-2 py-1 text-[11px]"
                />
                <button
                  type="button"
                  disabled={!diskPath || busy}
                  onClick={() => void runTPose()}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-violet-600/50 bg-violet-950/40 px-3 py-3 text-sm font-medium disabled:opacity-40"
                >
                  <Sparkles className="h-4 w-4" /> Run T-pose prep
                </button>
              </section>
            )}

            {/* Step: PLACE */}
            {step === "place" && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-cyan-200">4 · Place bones</h2>
                <button
                  type="button"
                  disabled={!model || busy}
                  onClick={() => void runAutoMap()}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-sky-700/50 bg-sky-950/40 px-3 py-2 text-sm disabled:opacity-40"
                >
                  <Target className="h-4 w-4" /> Auto-map Mixamo-25
                </button>
                <div className="max-h-56 overflow-y-auto space-y-0.5">
                  {MIXAMO_25_CORE.map((b) => {
                    const placed = mapping.placements.some((p) => p.bone === b);
                    const src =
                      mapping.reverseMap?.[b] ||
                      mapping.placements.find((p) => p.bone === b)?.sourceBone;
                    return (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setActiveBone(b)}
                        className={`flex w-full items-center justify-between rounded px-1.5 py-0.5 text-left text-[11px] ${
                          activeBone === b
                            ? "bg-cyan-950 text-cyan-200"
                            : "hover:bg-white/5 text-slate-300"
                        }`}
                      >
                        <span className="truncate">
                          {b}
                          {src ? <span className="text-slate-600"> ← {src}</span> : null}
                        </span>
                        <span className={placed || src ? "text-emerald-400" : "text-slate-600"}>
                          {placed || src ? "●" : "○"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Step: SKILLS */}
            {step === "skills" && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-cyan-200">5 · Skill slots</h2>
                <button
                  type="button"
                  disabled={!model || busy}
                  onClick={() => void retargetFromExternalPack()}
                  className="flex w-full items-center gap-2 rounded border border-amber-800/40 bg-amber-950/30 px-2 py-2 disabled:opacity-40"
                >
                  <Wand2 className="h-3.5 w-3.5" /> Retarget clips from another pack
                </button>
                <div className="max-h-52 overflow-y-auto space-y-0.5">
                  {(clips.length
                    ? clips
                    : animClips.map((c) => ({ name: c.name }))
                  ).map((c: any) => {
                    const slot = matchSkillSlot(c.name);
                    const override = slotOverrides[c.name];
                    return (
                      <div key={c.name} className="flex justify-between gap-1 text-[10px]">
                        <span className="truncate text-slate-300">{c.name}</span>
                        <select
                          className="max-w-[7.5rem] rounded border border-slate-800 bg-black/50 text-[9px] text-cyan-400"
                          value={override || slot?.id || ""}
                          onChange={(e) =>
                            setSlotOverrides((o) => ({ ...o, [c.name]: e.target.value }))
                          }
                        >
                          <option value="">—</option>
                          {ANIM_SKILL_SLOTS.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.id}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                  {!clips.length && !animClips.length && (
                    <p className="text-slate-600">No clips — extract or retarget first</p>
                  )}
                </div>
              </section>
            )}

            {/* Step: EXPORT */}
            {step === "export" && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-cyan-200">6 · Export library</h2>
                <button
                  type="button"
                  disabled={!diskPath || busy}
                  onClick={() => void exportLibrary()}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-emerald-700/50 bg-emerald-950/40 px-3 py-3 text-sm font-medium disabled:opacity-40"
                >
                  <Package className="h-4 w-4" /> Build retarget pack v2
                </button>
                {packDir && (
                  <>
                    <p className="break-all text-[10px] text-emerald-400/90">{packDir}</p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void installPackLocal()}
                      className="flex w-full items-center gap-2 rounded border border-teal-700/40 bg-teal-950/30 px-2 py-2"
                    >
                      <Download className="h-3.5 w-3.5" /> Install to Documents
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void uploadPack()}
                      className="flex w-full items-center gap-2 rounded border border-cyan-700/40 bg-cyan-950/30 px-2 py-2"
                    >
                      <Upload className="h-3.5 w-3.5" /> Upload to fleet R2
                    </button>
                  </>
                )}
              </section>
            )}

            {/* Step: LIBRARIES */}
            {step === "libraries" && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-cyan-200 flex items-center gap-1">
                  <Library className="h-3.5 w-3.5" /> 7 · Libraries
                  <button
                    type="button"
                    className="ml-auto text-slate-500 hover:text-cyan-400"
                    onClick={() => {
                      void refreshLibraries();
                      void refreshFleetAnims();
                    }}
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                </h2>
                <button
                  type="button"
                  onClick={() => void window.grudge.skeleton.openLibraryDir()}
                  className="flex w-full items-center gap-2 rounded border border-slate-700 px-2 py-2 text-[11px] hover:border-cyan-700"
                >
                  <FolderOpen className="h-3.5 w-3.5" /> Open Documents/grudge-anim-libraries
                </button>
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {libraries.length === 0 && (
                    <p className="text-[10px] text-slate-600">
                      No local packs — finish Export first.
                    </p>
                  )}
                  {libraries.map((lib) => (
                    <button
                      key={lib.packDir}
                      type="button"
                      onClick={() => void loadLibraryRestGlb(lib)}
                      className="w-full rounded border border-slate-800 bg-black/30 px-2 py-1.5 text-left hover:border-cyan-800"
                    >
                      <div className="truncate font-medium text-slate-200">{lib.name}</div>
                      <div className="text-[9px] text-slate-500">
                        {lib.clipCount} clips · {lib.jointCount} joints
                      </div>
                    </button>
                  ))}
                </div>
                {fleetAnims.length > 0 && (
                  <div>
                    <p className="text-[9px] uppercase text-slate-600">Fleet models/anims</p>
                    {fleetAnims.map((a, i) => (
                      <div
                        key={`${a.key || a.name}-${i}`}
                        className="truncate text-[10px] text-slate-500"
                      >
                        {a.name}
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[9px] text-slate-600">
                  Weapon packs: {ANIM_WEAPON_PACKS.slice(0, 6).join(", ")}…
                </p>
              </section>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
