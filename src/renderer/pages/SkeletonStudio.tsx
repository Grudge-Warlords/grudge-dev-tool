/**
 * Skeleton Studio — Mixamo-25 author → Toon Bip001 play.
 * Load → extract → T-pose → place → bind (roles left / clips right) → grudge-convert → ship.
 * Play body is Toon {race}.glb (Bip001 22-core). Mixamo is author only.
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
import { makeBoneLabel } from "../lib/forge/skeletonOverlay";
import type { Prompt3DAnimationOverrides } from "../../shared/prompt3dWorkflow";
import { CREATION_BASE_HANDOFF, CREATION_REVISION_HANDOFF } from "../lib/creationHandoff";
import type { CreationAttempt } from "../../shared/creationFlow";

interface Prompt3DRigContext {
  sourcePath: string;
  sourceSha256?: string;
  finishJobId: string;
  sourceJobId?: string;
  instruction: string;
  animation?: Prompt3DAnimationOverrides;
  seed?: number;
  suggestedPlacements?: BonePlacement[];
}
import {
  applyUnarmedVisibility,
  loadToonPlayKit,
  rematchClipsToHost,
} from "../lib/forge/genericPreview";
import {
  MIXAMO_25_CORE,
  ANIM_WEAPON_PACKS,
  type Mixamo25Bone,
  type BonePlacement,
  type SkeletonMappingDoc,
  emptyMapping,
  matchSkillSlot,
  applyAutoMapToDoc,
  WARLORDS_PACK_IDS,
  WARLORDS_PACK_META,
  ANIM_FAMILY_ORDER,
  ANIM_FAMILY_LABELS,
  listStudioRoles,
  fetchAnimPacksCatalog,
  detectRigFamily,
  BIP001_PLAY_CORE,
  BIP001_PLAY_LAW,
} from "../../shared/mixamo25";
import { TOON_PLAY_KITS } from "../../shared/prodPackages";
import { FLEET_URLS } from "../../shared/fleet";

declare global {
  interface Window {
    grudge: any;
  }
}

type Step = "load" | "extract" | "tpose" | "place" | "bind" | "convert" | "ship";

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

const STEPS: Array<{ id: Step; label: string; hint: string }> = [
  { id: "load", label: "Load", hint: "Open FBX/GLB character" },
  { id: "extract", label: "Extract", hint: "Textures + anim clips" },
  { id: "tpose", label: "T-pose", hint: "Blender rest pose prep" },
  { id: "place", label: "Place", hint: "Map Mixamo-25 bones" },
  { id: "bind", label: "Bind", hint: "Actions left · clips right" },
  { id: "convert", label: "Convert", hint: "grudge-convert + Bip001 pack" },
  { id: "ship", label: "Ship", hint: "R2 + D1 index + Documents" },
];

const RACES = Object.keys(TOON_PLAY_KITS);

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

function apiReady(): boolean {
  return Boolean(window.grudge?.skeleton && window.grudge?.files && window.grudge?.forge);
}

function clipKey(name: string): string {
  return String(name || "").replace(/\.json$/i, "");
}

export default function SkeletonStudio() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SceneEngine | null>(null);
  const markersRef = useRef<THREE.Group | null>(null);
  const authorRef = useRef<THREE.Object3D | null>(null);
  const authorClipsRef = useRef<THREE.AnimationClip[]>([]);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);

  const [step, setStep] = useState<Step>("load");
  const [diskPath, setDiskPath] = useState<string | null>(null);
  const [model, setModel] = useState<LoadedModel | null>(null);
  const [operationBusy, setBusy] = useState(false);
  const [refinementBusy, setRefinementBusy] = useState(false);
  const busy=operationBusy||refinementBusy;
  const [refinementPrompt, setRefinementPrompt] = useState("");
  const [refinementStatus, setRefinementStatus] = useState("");
  const [statusLine, setStatusLine] = useState("Open a skinned FBX/GLB — Mixamo author, Toon Bip001 play.");
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
  const [apiOk, setApiOk] = useState(true);
  const [tools, setTools] = useState<{
    blender?: { available?: boolean; path?: string; version?: string };
    fbx2gltf?: { available?: boolean; path?: string };
  } | null>(null);
  const [prompt3dContext, setPrompt3dContext] = useState<Prompt3DRigContext | null>(null);

  const [packId, setPackId] = useState("sword_shield");
  const [playRace, setPlayRace] = useState("human");
  const [playHostOn, setPlayHostOn] = useState(false);
  const [selRole, setSelRole] = useState("");
  const [selClip, setSelClip] = useState("");
  const [roleBinds, setRoleBinds] = useState<Record<string, string>>({});
  const [cloudPacks, setCloudPacks] = useState<{
    url: string;
    packIds: string[];
  } | null>(null);
  const [rigFamily, setRigFamily] = useState<"mixamo" | "biped" | "bandai" | "unknown">("unknown");

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
    void window.grudge?.settings?.toolchain?.()
      .then((t: any) => {
        if (Array.isArray(t)) {
          const blender = t.find((x: any) => /blender/i.test(x?.name || ""));
          const fbx = t.find((x: any) => /fbx2gltf|fbx/i.test(x?.name || ""));
          setTools({ blender, fbx2gltf: fbx });
        } else if (t && typeof t === "object") {
          setTools({
            blender: t.blender || t.Blender,
            fbx2gltf: t.fbx2gltf || t.FBX2glTF,
          });
        }
      })
      .catch(() => setTools(null));
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
        const label = makeBoneLabel(p.bone + (p.sourceBone ? ` ← ${p.sourceBone}` : ""));
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
        prefix: "prod/anims",
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
    void fetchAnimPacksCatalog().then((doc) => {
      if (!doc) {
        setStatusLine((s) => s);
        return;
      }
      setCloudPacks({ url: doc.url, packIds: Object.keys(doc.packs) });
    });
  }, []);

  function clearUserModels() {
    const engine = engineRef.current;
    if (!engine) return;
    const scene = engine.scene;
    const toRemove: THREE.Object3D[] = [];
    scene.children.forEach((o) => {
      if (o.userData?.isUserModel) toRemove.push(o);
    });
    toRemove.forEach((o) => {
      engine.removeSkeletonHelper(o);
      const m = o.userData.grudgeMixer as THREE.AnimationMixer | undefined;
      if (m) engine.removeMixer(m);
      scene.remove(o);
    });
  }

  async function attachLoaded(loaded: LoadedModel, path: string, asAuthor: boolean) {
    if (!engineRef.current) return;
    clearUserModels();
    loaded.object.userData.isUserModel = true;
    engineRef.current.scene.add(loaded.object);
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
    setModel(loaded);
    setDiskPath(path);

    const jointNames = collectBoneNames(loaded.object);
    setRigFamily(detectRigFamily(jointNames));
    if (asAuthor) {
      authorRef.current = loaded.object;
      authorClipsRef.current = loaded.animations.slice();
      if (jointNames.length) {
        setMapping((m) =>
          applyAutoMapToDoc({ ...emptyMapping(path), placements: m.placements }, jointNames),
        );
      } else {
        setMapping(emptyMapping(path));
      }
    }
  }

  async function loadFromPath(path: string, suggestedPlacements?: BonePlacement[], reviewContext?: Prompt3DRigContext, exactSource = false) {
    if (!window.grudge?.forge?.readFile) {
      toast.error("Forge IPC missing — restart Dev Tool");
      return false;
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
      if (reviewContext?.sourceSha256) {
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", ab)), (value) => value.toString(16).padStart(2, "0")).join("");
        if (digest !== reviewContext.sourceSha256) throw new Error("The model changed since this skeleton review was requested. Reopen review from its exact retained revision.");
      }
      const file = new File([ab], name);
      const loaded = await loadModel(file, { diskPath: path, materialPolicy: "preserve-authored", skipGenericPreview: exactSource || Boolean(reviewContext) });
      if (!engineRef.current) throw new Error("The Skeleton Studio viewport is not ready. Reopen the model when it is ready.");
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
          setMapping(() =>
            applyAutoMapToDoc({ ...emptyMapping(path), placements: suggestedPlacements ?? [] }, jointNames),
          );
        } else {
          setMapping({ ...emptyMapping(path), placements: suggestedPlacements?.length ? suggestedPlacements : [] });
        }
      }
      setModel(loaded);
      setPrompt3dContext(reviewContext ?? null);
      setDiskPath(path);
      setExtract(null);
      setPackDir(null);
      setTposePath(null);
      setPlayHostOn(false);
      setRoleBinds({});
      setStep(reviewContext || suggestedPlacements?.length ? "place" : "extract");
      setStatusLine(
        suggestedPlacements?.length
          ? `Loaded · ${suggestedPlacements.length}/22 fitted markers · review and correct the overlay`
          : reviewContext
            ? `Loaded exact review model · ${loaded.bones} bones · no fitted markers supplied`
            : `Loaded · ${loaded.bones} bones · ${loaded.animations.length} clips · ready to extract`,
      );
      toast.success("Character loaded", {
        description: `${loaded.bones} bones · ${loaded.animations.length} clips`,
      });
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatusLine(`Load failed: ${msg}`);
      toast.error("Load failed", { description: msg });
      return false;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    try {
      const pending = sessionStorage.getItem("grudge.skeleton.pendingPath");
      const contextRaw = sessionStorage.getItem("grudge.skeleton.prompt3dContext");
      const context = contextRaw ? JSON.parse(contextRaw) as Prompt3DRigContext : null;
      if (pending) {
        sessionStorage.removeItem("grudge.skeleton.pendingPath");
        const matchedContext = context?.sourcePath === pending && context.finishJobId && context.instruction ? context : undefined;
        sessionStorage.removeItem("grudge.skeleton.prompt3dContext");
        void loadFromPath(pending, matchedContext?.suggestedPlacements, matchedContext, true);
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only handoff
  }, []);

  async function returnCorrectionToPrompt3D(applyPlacements = true) {
    if (!prompt3dContext) return;
    if (applyPlacements && mapping.placements.length !== MIXAMO_25_CORE.length) {
      toast.error(`Place all ${MIXAMO_25_CORE.length} Mixamo-25 core markers before returning.`);
      return;
    }
    const unique = new Set(mapping.placements.map((placement) => placement.bone));
    if (applyPlacements && unique.size !== MIXAMO_25_CORE.length) {
      toast.error("Each Mixamo-25 core bone needs exactly one placement.");
      return;
    }
    sessionStorage.setItem("grudge.prompt3d.pendingRigCorrection", JSON.stringify({
      sourcePath: prompt3dContext.sourcePath,
      sourceSha256: prompt3dContext.sourceSha256,
      finishJobId: prompt3dContext.finishJobId,
      sourceJobId: prompt3dContext.sourceJobId,
      instruction: prompt3dContext.instruction,
      animation: prompt3dContext.animation,
      seed: prompt3dContext.seed,
      ...(applyPlacements ? { placements: mapping.placements } : {}),
    }));
    toast.success(applyPlacements ? "Corrected placements returned to Prompt-to-3D" : "Animation prompt restored", { description: "The exact painted source and motion settings remain retained." });
    await window.grudge.app.openRoute("/prompt3d");
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

  async function previewOnToonRace(race: string) {
    const srcObj = authorRef.current;
    const srcClips = authorClipsRef.current.length
      ? authorClipsRef.current
      : animClips;
    if (!srcClips.length && !srcObj) {
      toast.error("Load an author FBX/GLB first");
      setStep("load");
      return;
    }
    setBusy(true);
    setPlayRace(race);
    setStatusLine(`Preview on Toon ${race} (Bip001 play)…`);
    try {
      const host = await loadToonPlayKit(race);
      applyUnarmedVisibility(host.object, race);
      let clips = rematchClipsToHost(srcClips, host.object);
      if (srcObj && clips.length < srcClips.length) {
        try {
          const { retargetClips } = await import("../lib/forge/boneAliases");
          const retargeted = retargetClips(srcClips, host.object, srcObj, {
            dropRootChain: true,
          });
          if (retargeted.length > clips.length) clips = retargeted;
        } catch {
          /* rematch-only fallback */
        }
      }
      const loaded: LoadedModel = {
        object: host.object,
        animations: clips,
        gltf: model?.gltf ?? null,
        format: "glb",
        triangles: model?.triangles ?? 0,
        vertices: model?.vertices ?? 0,
        bones: collectBoneNames(host.object).length,
        materials: model?.materials,
      };
      await attachLoaded(loaded, diskPath || toonKitUrlFallback(race), false);
      setPlayHostOn(true);
      setRigFamily("biped");
      setStep("bind");
      setStatusLine(
        `Play host · Toon ${race} · ${clips.length} clips rematched onto ${BIP001_PLAY_CORE.length}-bone Bip001`,
      );
      toast.success(`Preview on ${race}`, {
        description: `${clips.length} clips · hip .position stripped`,
      });
    } catch (e: unknown) {
      toast.error("Toon preview failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  function toonKitUrlFallback(race: string): string {
    const kit = TOON_PLAY_KITS[race] ?? TOON_PLAY_KITS.human;
    return `${FLEET_URLS.assets}/${kit.r2Key}`;
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
          setRigFamily(detectRigFamily(res.skeleton.jointNames));
        }
        if (res.glbPath && res.glbPath !== diskPath) setDiskPath(res.glbPath);
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
    setStatusLine("Building Warlords Bip001 anim library…");
    try {
      const mappingOut: SkeletonMappingDoc = {
        ...mapping,
        packId,
        roleBinds,
        authorSkeleton: "mixamo-25",
        playSkeleton: "bip001",
        skeleton: "bip001",
      };
      const res = await window.grudge.skeleton.buildLibrary({
        modelPath: path,
        mapping: mappingOut,
        packName: `${path.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") || "pack"}-${packId}`,
        packId,
        roleBinds,
        playSkeleton: "bip001",
      });
      if (!res?.ok) {
        toast.error("Library build failed", { description: res?.errors?.join("; ") });
        setStatusLine(`Export failed: ${res?.errors?.join("; ")}`);
      } else {
        setPackDir(res.packDir);
        setStep("convert");
        setStatusLine(`Pack ready (Bip001 play): ${res.packDir}`);
        toast.success("Play skeleton pack ready", {
          description: `${res.clips?.length ?? 0} clips · ${res.autoMapped ?? 0} bones · ${packId}`,
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
        setStep("ship");
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
      const prefix = `models/anims/libraries/${stamp}`;
      const rest = `${packDir}/rest.glb`.replace(/\\/g, "/");
      const files = [
        { localPath: rest, targetPath: `${prefix}/rest.glb`, contentType: "model/gltf-binary" },
        {
          localPath: `${packDir}/anim-library-manifest.json`,
          targetPath: `${prefix}/anim-library-manifest.json`,
          contentType: "application/json",
        },
        {
          localPath: `${packDir}/retarget-map.json`,
          targetPath: `${prefix}/retarget-map.json`,
          contentType: "application/json",
        },
        {
          localPath: `${packDir}/skeleton-mapping.json`,
          targetPath: `${prefix}/skeleton-mapping.json`,
          contentType: "application/json",
        },
        {
          localPath: `${packDir}/clips-index.json`,
          targetPath: `${prefix}/clips-index.json`,
          contentType: "application/json",
        },
        {
          localPath: `${packDir}/bip001-play-bones.json`,
          targetPath: `${prefix}/bip001-play-bones.json`,
          contentType: "application/json",
        },
        {
          localPath: `${packDir}/role-binds.json`,
          targetPath: `${prefix}/role-binds.json`,
          contentType: "application/json",
        },
        {
          localPath: `${packDir}/anim-packs-fragment.json`,
          targetPath: `${prefix}/anim-packs-fragment.json`,
          contentType: "application/json",
        },
      ];
      const job = {
        id: `skel-${stamp}`,
        packId: packId || "anim-libraries",
        packVersion: "2.0.0",
        buildManifest: true,
        files,
      };
      await window.grudge.upload.enqueue(job);
      const cdn = `${FLEET_URLS.assets}/${prefix}/rest.glb`;
      try {
        await window.grudge?.os?.registerAsset?.({
          grudge_uuid: `skel-${stamp}`,
          r2_key: `${prefix}/rest.glb`,
          category: "animation",
          content_type: "model/gltf-binary",
          pack_id: packId,
          name: `${packId}-bip001-play`,
          cdn_url: cdn,
          metadata: {
            skeleton: "bip001",
            authorSkeleton: "mixamo-25",
            purpose: "play",
            packId,
            roleBinds,
          },
        });
      } catch {
        /* index optional — binaries still queued */
      }
      toast.success("Upload queued → R2 libraries + D1 index");
      setStatusLine(`Queued ${prefix} · defs still merge into anim-packs.json`);
      setStep("ship");
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
      authorClipsRef.current = [...authorClipsRef.current, ...source.animations];
      const { attachAnimationMixer } = await import("../lib/forge/forgeAnimation");
      if (mixer) engineRef.current.removeMixer(mixer);
      const handle = attachAnimationMixer(model.object, merged, { dropRootMotion: true });
      engineRef.current.mixers.push(handle.mixer);
      setMixer(handle.mixer);
      setAnimClips(handle.clips);
      setActiveAction(null);
      toast.success(`Retargeted ${retargeted.length} clips`, { description: name });
      setStep("bind");
      setStatusLine(`+${retargeted.length} retargeted clips — bind roles on the left`);
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

  function playNamedClip(name: string) {
    const clip = animClips.find((c) => clipKey(c.name) === clipKey(name) || c.name === name);
    if (clip) playAnimClip(clip);
    else toast.message(`Clip not on mixer · ${name}`);
  }

  function bindRoleToClip(role: string, clipName: string) {
    const key = clipKey(clipName);
    setRoleBinds((b) => ({ ...b, [role]: key }));
    setSelRole(role);
    setSelClip(key);
    playNamedClip(key);
    toast.success(`Bound ${role} ← ${key}`);
  }

  async function goStep(s: Step) {
    setStep(s);
    if (s === "load" && !diskPath) {
      setStatusLine("Click Open FBX/GLB to load an author character");
      return;
    }
    if (s === "extract" && diskPath && !extract && !busy) {
      await runExtract();
      return;
    }
    if (s === "tpose" && diskPath && !busy) {
      setStatusLine("Review T-pose hint, then run AI T-pose prep");
      return;
    }
    if (s === "place") {
      if (!model) {
        toast.error("Load a model first");
        setStep("load");
        return;
      }
      if (prompt3dContext) {
        setStatusLine("Review the model and fitted markers, or return to its retained animation prompt.");
      } else if (!(mapping.autoMap?.matched || Object.keys(mapping.reverseMap || {}).length)) {
        await runAutoMap();
      } else {
        setStatusLine("Click mesh to place active Mixamo bone (snaps to nearest joint)");
      }
      return;
    }
    if (s === "bind") {
      setStatusLine("Click an action (left), then a clip (right) to bind. Preview on Toon race.");
      return;
    }
    if (s === "convert" && diskPath && !packDir && !busy) {
      await exportLibrary();
      return;
    }
    if (s === "ship") {
      void refreshLibraries();
      void refreshFleetAnims();
      setStatusLine("Install locally and/or upload R2 · D1 index (not player SSOT)");
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
    bind: Object.keys(roleBinds).length > 0 || animClips.length > 0,
    convert: Boolean(packDir),
    ship: libraries.length > 0,
  };

  const studioRoles = useMemo(() => {
    const packRoles = cloudPacks ? [] : [];
    return listStudioRoles(packRoles);
  }, [cloudPacks]);

  const clipRows = useMemo(() => {
    const names = new Set<string>();
    const rows: Array<{ name: string; duration?: number; source: "mixer" | "extract" }> = [];
    for (const c of animClips) {
      const n = c.name || "(unnamed)";
      if (names.has(n)) continue;
      names.add(n);
      rows.push({ name: n, duration: c.duration, source: "mixer" });
    }
    for (const c of clips) {
      const n = String(c.name || "");
      if (!n || names.has(n)) continue;
      names.add(n);
      rows.push({ name: n, duration: c.duration, source: "extract" });
    }
    return rows;
  }, [animClips, clips]);

  const onFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!/\.(fbx|glb|gltf|obj)$/i.test(file.name)) {
      toast.error("Drop an FBX, GLB, GLTF, or OBJ");
      return;
    }
    try {
      const p = window.grudge?.files?.getPathForFile?.(file);
      if (p) void loadFromPath(p);
      else toast.error("Could not resolve file path — use Open model");
    } catch (err: unknown) {
      toast.error("Drop failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  async function reviseModelWithPrompt() {
    if (!diskPath || busy) return;
    setBusy(true);
    try {
      const revision = (await window.grudge.creation.history() as CreationAttempt[]).find(row => row.state === "complete" && row.assetPath === diskPath);
      sessionStorage.removeItem(CREATION_BASE_HANDOFF);
      sessionStorage.removeItem(CREATION_REVISION_HANDOFF);
      if (revision) sessionStorage.setItem(CREATION_REVISION_HANDOFF, JSON.stringify({id:revision.id,path:diskPath}));
      else sessionStorage.setItem(CREATION_BASE_HANDOFF, JSON.stringify({kind:"local-file",path:diskPath}));
      await window.grudge.app.openRoute("/prompt3d");
    } catch (error) {
      setStatusLine(`Load failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally { setBusy(false); }
  }

  async function applyCharacterChanges() {
    if (!diskPath || busy || refinementBusy || !refinementPrompt.trim()) return;
    setRefinementBusy(true);
    setRefinementStatus("Applying character changes…");
    try {
      let revision = (await window.grudge.creation.history() as CreationAttempt[]).find(row => row.state === "complete" && row.assetPath === diskPath);
      if (!revision) {
        revision = await window.grudge.creation.submit({prompt:"Use selected existing asset as a working copy",category:"character",style:"stylized",usePlanner:false,baseSource:{kind:"local-file",path:diskPath}});
        if (revision?.state !== "complete") throw new Error(revision?.message || "Could not retain the current model.");
      }
      const result: CreationAttempt = await window.grudge.creation.submit({prompt:refinementPrompt.trim(),category:"character",style:revision.request.style,usePlanner:true,parentId:revision.id});
      if (result.state !== "complete" || !result.assetPath) throw new Error(result.message);
      if (!await loadFromPath(result.assetPath, undefined, undefined, true)) throw new Error("The revision was saved but could not be loaded in Skeleton Studio.");
      const draftKey="grudge:original-creation-session:v1";
      let draft: Record<string,unknown>={};
      try { draft=JSON.parse(localStorage.getItem(draftKey)||"{}"); } catch { /* Restore the current revision even when an old draft is invalid. */ }
      localStorage.setItem(draftKey,JSON.stringify({...draft,currentId:result.id}));
      setRefinementStatus(`Character changes saved: ${result.message}`);
    } catch (error) {
      setRefinementStatus(`Character changes failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally { setRefinementBusy(false); }
  }

  return (
    <div
      data-app-action-busy={busy || refinementBusy ? "true" : "false"}
      className="flex h-full min-h-0 flex-col bg-[#070a12] text-slate-100"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={onFileDrop}
    >
      <header className="shrink-0 border-b border-white/10 bg-black/40">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <Bone className="h-4 w-4 text-cyan-400" />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-wide">Skeleton Studio</h1>
            <p className="truncate text-[10px] text-slate-500">
              Mixamo-25 author · extract · T-pose · retarget · Toon Bip001 play · grudge-convert
            </p>
          </div>
          {!apiOk && (
            <span className="ml-2 flex items-center gap-1 text-[10px] text-amber-400">
              <AlertCircle className="h-3 w-3" /> IPC incomplete — restart app
            </span>
          )}
          <label className="ml-2 flex items-center gap-1 text-[10px] text-slate-400">
            Race
            <select
              className="rounded border border-slate-700 bg-black/60 px-1 py-0.5 text-[10px] text-cyan-200"
              value={playRace}
              onChange={(e) => void previewOnToonRace(e.target.value)}
              disabled={busy}
              title="Warlords play body — Toon {race}.glb Bip001"
            >
              {RACES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-[10px] text-slate-400">
            Pack
            <select
              className="rounded border border-slate-700 bg-black/60 px-1 py-0.5 text-[10px] text-cyan-200"
              value={packId}
              onChange={(e) => {
                setPackId(e.target.value);
                setSelRole("");
              }}
            >
              {WARLORDS_PACK_IDS.map((id) => (
                <option key={id} value={id}>
                  {WARLORDS_PACK_META[id]?.label || id}
                </option>
              ))}
            </select>
          </label>
          <div className="ml-auto flex flex-wrap gap-1">
            <button type="button" className="rounded border border-gold/50 px-2 py-1 text-[10px] text-gold" disabled={!model || !diskPath || busy} onClick={() => void reviseModelWithPrompt()}>Revise model with prompt</button>
            <button
              type="button"
              className="rounded border border-cyan-700/50 bg-cyan-950/40 px-2 py-1 text-[10px] hover:border-cyan-500"
              onClick={() => void pickFile()}
              disabled={busy}
            >
              <FolderOpen className="mr-1 inline h-3 w-3" />
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
        <details className="mx-3 mb-2 rounded border border-white/10 px-2 py-1" data-app-action-context="Character refinement">
          <summary className="cursor-pointer text-xs text-slate-300">Character refinement controls</summary>
          <label className="block text-xs text-slate-300">Changes to this character
            <textarea aria-label="Character refinement prompt" value={refinementPrompt} maxLength={1800} disabled={!model || busy || refinementBusy} onChange={e=>{setRefinementPrompt(e.target.value);setRefinementStatus("");}} className="my-2 block w-full rounded border border-slate-700 bg-black/40 p-2" placeholder="Smooth and unify the body, add a skeleton, or move Tail2 bone 5 cm down." />
          </label>
          <button type="button" disabled={!model || busy || refinementBusy || !refinementPrompt.trim()} onClick={()=>void applyCharacterChanges()} className="rounded bg-gold px-3 py-1 text-xs font-semibold text-black">Apply character changes</button>
        </details>
        {refinementStatus && <p className="mx-3 mb-2 text-xs text-slate-300" role="status" data-app-action-state={refinementStatus}>{refinementStatus}</p>}
        {activeAction && <p className="mx-3 mb-2 text-xs text-slate-300" data-app-action-state={`Playing clip: ${activeAction.getClip().name}`}>Playing: {activeAction.getClip().name}</p>}
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
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 truncate border-t border-white/5 px-3 py-1 font-mono text-[10px] text-slate-400">
          <span data-app-action-state={busy ? "Skeleton model loading" : statusLine.startsWith("Load failed:") ? `Skeleton model load failed: ${statusLine.slice(12)}` : model && diskPath ? `Skeleton model loaded: ${diskPath}` : "Skeleton Studio: no model loaded"}>
            {busy ? "Working…" : statusLine}
            {diskPath ? ` · ${diskPath.split(/[/\\]/).pop()}` : ""}
          </span>
          <span className="text-slate-600">
            Author {rigFamily}
            {" · "}
            Play {playHostOn ? `Toon ${playRace}` : "author mesh"}
            {" · Mixer "}
            {mixer ? <span className="text-emerald-400">on</span> : <span className="text-amber-400">off</span>}
            {" · "}
            Blender:{" "}
            {tools?.blender?.available === true ? (
              <span className="text-emerald-400">ready</span>
            ) : tools?.blender?.available === false ? (
              <span className="text-amber-400">missing</span>
            ) : (
              <span className="text-slate-500">…</span>
            )}
            {cloudPacks ? (
              <span className="text-cyan-700">
                {" · ANIM_PACKS "}
                {cloudPacks.packIds.length} ← {cloudPacks.url.replace(/^https:\/\//, "").split("/")[0]}
              </span>
            ) : (
              <span className="text-slate-600"> · ANIM_PACKS local fallback</span>
            )}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* LEFT — actions (or Mixamo-25 bones on Place) */}
        <aside className="flex w-[clamp(9rem,15vw,14rem)] shrink-0 flex-col border-r border-white/10 bg-black/35">
          <div className="flex items-center justify-between border-b border-white/5 px-2 py-1.5">
            <h2 className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {step === "place" ? "Mixamo-25 bones" : "Actions"}
            </h2>
            {step !== "place" && (
              <span className="text-[9px] text-slate-600">{Object.keys(roleBinds).length} bound</span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {step === "place" ? (
              <div className="space-y-0.5">
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
                          : "text-slate-300 hover:bg-white/5"
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
            ) : (
              ANIM_FAMILY_ORDER.map((fam) => {
                const list = studioRoles.filter((d) => d.family === fam);
                if (!list.length) return null;
                return (
                  <div key={fam} className="mb-2">
                    <h3 className="px-1 py-0.5 text-[9px] uppercase tracking-wide text-slate-600">
                      {ANIM_FAMILY_LABELS[fam]}
                    </h3>
                    {list.map((d) => {
                      const bound = roleBinds[d.role];
                      const on = selRole === d.role;
                      return (
                        <button
                          key={d.role}
                          type="button"
                          title={`${d.label}${d.input ? " · " + d.input : ""}${bound ? " · " + bound : ""}`}
                          onClick={() => {
                            setSelRole(d.role);
                            if (bound) {
                              setSelClip(bound);
                              playNamedClip(bound);
                            }
                            toast.message(bound ? `${d.role} · ${bound}` : `Pick a clip → ${d.role}`);
                          }}
                          className={`mb-0.5 flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-[11px] ${
                            on
                              ? "bg-cyan-950/80 text-cyan-100"
                              : bound
                                ? "text-emerald-200/90 hover:bg-white/5"
                                : "text-slate-400 hover:bg-white/5"
                          }`}
                        >
                          <span className="truncate">{d.role}</span>
                          <small className="ml-1 shrink-0 text-[9px] text-slate-500">
                            {bound ? "bound" : "set →"}
                          </small>
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* VIEWPORT */}
        <div className="relative min-h-0 min-w-0 flex-1 bg-[#0a0e1a]">
          <div ref={viewportRef} className="absolute inset-0" />
          {!model && (
            <div className="pointer-events-none absolute inset-0 z-[2] flex flex-col items-center justify-center gap-3 px-6 text-center">
              <Bone className="h-10 w-10 text-cyan-500/40" />
              <p className="text-sm text-slate-300">No character loaded</p>
              <p className="max-w-sm text-[11px] text-slate-500">
                Drop an FBX/GLB, or Open model. Author can be Mixamo — play save is Toon Bip001.
              </p>
            </div>
          )}
          {step === "place" && model && (
            <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/75 px-2 py-1 text-[11px] text-cyan-200">
              <MousePointer2 className="mr-1 inline h-3 w-3" />
              Click mesh → place <strong>{activeBone}</strong> ({placedCount}/{MIXAMO_25_CORE.length})
            </div>
          )}
          {playHostOn && (
            <div className="pointer-events-none absolute right-3 top-3 rounded bg-black/75 px-2 py-1 text-[10px] text-emerald-300">
              Play · Toon {playRace} · {BIP001_PLAY_CORE.length} Bip001
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-sm text-cyan-100">
              Working…
            </div>
          )}
        </div>

        {/* RIGHT — clips + step tools */}
        <aside className="flex w-[clamp(13rem,20vw,18rem)] shrink-0 flex-col border-l border-white/10 bg-black/30">
          <div className="flex-1 space-y-3 overflow-y-auto p-3 text-xs">
            {model && (
              <section className="space-y-1.5 rounded border border-white/10 bg-black/40 p-2">
                <div className="text-[10px] text-slate-400">
                  Bones {model.bones} · Clips {animClips.length} · Map {autoMatched}/22
                  {" · "}
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={showSkeleton}
                      onChange={(e) => setShowSkeleton(e.target.checked)}
                    />
                    helper
                  </label>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void previewOnToonRace(playRace)}
                  className="w-full rounded border border-emerald-800/50 bg-emerald-950/30 px-2 py-1.5 text-[11px] text-emerald-100 disabled:opacity-40"
                >
                  Preview on Toon {playRace} (play skeleton)
                </button>
              </section>
            )}

            <section>
              <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Clips
              </h2>
              <p className="mb-1 text-[10px] text-slate-600">
                Select an action on the left, then a clip here to bind.
              </p>
              <div className="max-h-48 overflow-auto rounded border border-slate-800">
                {clipRows.length === 0 && (
                  <p className="px-2 py-2 text-[10px] text-slate-600">No clips — extract or retarget</p>
                )}
                {clipRows.map((c) => {
                  const on = selClip === clipKey(c.name) || activeAction?.getClip()?.name === c.name;
                  const slot = matchSkillSlot(c.name);
                  return (
                    <button
                      key={c.name}
                      aria-label={`Play clip ${c.name}`}
                      type="button"
                      onClick={() => {
                        if (selRole) bindRoleToClip(selRole, c.name);
                        else {
                          setSelClip(clipKey(c.name));
                          playNamedClip(c.name);
                          toast.message(`Pick an action first · ${c.name}`);
                        }
                      }}
                      className={`flex w-full items-center gap-1 truncate px-2 py-1 text-left text-[10px] hover:bg-cyan-950/50 ${
                        on ? "bg-cyan-900/40 text-cyan-200" : "text-slate-400"
                      }`}
                    >
                      <Play className="h-2.5 w-2.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="shrink-0 text-[9px] text-slate-600">
                        {c.duration != null ? `${c.duration.toFixed(1)}s` : ""}
                        {slot ? ` · ${slot.id}` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {step === "load" && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-cyan-200">1 · Load author</h2>
                <p className="text-[11px] text-slate-400">
                  Mixamo / Bandai / Biped FBX or GLB. Play body stays Toon race kit.
                </p>
                <button
                  type="button"
                  onClick={() => void pickFile()}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-cyan-600/50 bg-cyan-950/50 px-3 py-3 text-sm font-medium hover:bg-cyan-900/40 disabled:opacity-40"
                >
                  <FolderOpen className="h-4 w-4" /> Open FBX / GLB / OBJ
                </button>
              </section>
            )}

            {step === "extract" && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-cyan-200">2 · Extract</h2>
                <button
                  type="button"
                  disabled={!diskPath || busy}
                  onClick={() => void runExtract()}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-slate-800 px-3 py-3 text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
                >
                  <FileBox className="h-4 w-4" /> Run extract
                </button>
                {extract && (
                  <div className="rounded border border-slate-700 p-2 text-[11px] text-slate-300">
                    Textures: {extract.textures?.length ?? 0} · Anims: {extract.animations?.length ?? 0} ·
                    Joints: {extract.skeleton?.jointCount ?? 0}
                  </div>
                )}
              </section>
            )}

            {step === "tpose" && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-cyan-200">3 · T-pose</h2>
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
                <p className="text-[10px] text-slate-500">{BIP001_PLAY_LAW}</p>
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
                {prompt3dContext && <div className="rounded border border-amber-500/40 bg-amber-950/20 p-2 text-[11px] text-amber-100">
                  <b>Prompt-to-3D correction</b>
                  <p className="mt-1 text-slate-400">Adjust the fitted overlay, then return all 22 placements. The painted source remains unchanged.</p>
                  <button type="button" disabled={busy || mapping.placements.length !== MIXAMO_25_CORE.length} onClick={() => void returnCorrectionToPrompt3D()} className="mt-2 w-full rounded border border-amber-400/50 px-2 py-2 font-semibold disabled:opacity-40">Use corrected placements in Prompt-to-3D</button>
                  <button type="button" disabled={busy} onClick={() => void returnCorrectionToPrompt3D(false)} className="mt-2 w-full rounded border border-white/20 px-2 py-2">Return to animation</button>
                </div>}
              </section>
            )}

            {step === "bind" && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-cyan-200">5 · Bind roles</h2>
                <p className="text-[11px] text-slate-400">
                  {WARLORDS_PACK_META[packId]?.skills || packId}. Same as Casting Showcase.
                </p>
                <button
                  type="button"
                  disabled={!model || busy}
                  onClick={() => void retargetFromExternalPack()}
                  className="flex w-full items-center gap-2 rounded border border-amber-800/40 bg-amber-950/30 px-2 py-2 disabled:opacity-40"
                >
                  <Wand2 className="h-3.5 w-3.5" /> Retarget clips from another pack
                </button>
                {selRole && (
                  <p className="text-[10px] text-cyan-300">
                    Action <strong>{selRole}</strong>
                    {selClip ? ` ← ${selClip}` : " — click a clip"}
                  </p>
                )}
              </section>
            )}

            {step === "convert" && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold text-cyan-200">6 · Convert · save play skeleton</h2>
                <button
                  type="button"
                  disabled={!diskPath || busy}
                  onClick={() => void exportLibrary()}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-emerald-700/50 bg-emerald-950/40 px-3 py-3 text-sm font-medium disabled:opacity-40"
                >
                  <Package className="h-4 w-4" /> Build Bip001 play pack
                </button>
                {packDir && (
                  <>
                    <p className="break-all text-[10px] text-emerald-400/90">{packDir}</p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void convertOnly()}
                      className="w-full rounded border border-slate-700 px-2 py-2 text-[11px]"
                    >
                      grudge-convert GLB
                    </button>
                  </>
                )}
              </section>
            )}

            {step === "ship" && (
              <section className="space-y-2">
                <h2 className="flex items-center gap-1 text-xs font-semibold text-cyan-200">
                  <Library className="h-3.5 w-3.5" /> 7 · Ship
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
                {packDir && (
                  <>
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
                      <Upload className="h-3.5 w-3.5" /> Upload R2 + D1 index
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => void window.grudge.skeleton.openLibraryDir()}
                  className="flex w-full items-center gap-2 rounded border border-slate-700 px-2 py-2 text-[11px] hover:border-cyan-700"
                >
                  <FolderOpen className="h-3.5 w-3.5" /> Open Documents/grudge-anim-libraries
                </button>
                <div className="max-h-36 space-y-1 overflow-y-auto">
                  {libraries.map((lib) => (
                    <button
                      key={lib.packDir}
                      type="button"
                      onClick={() => void loadLibraryRestGlb(lib)}
                      className="w-full rounded border border-slate-800 bg-black/30 px-2 py-1.5 text-left hover:border-cyan-800"
                    >
                      <div className="truncate font-medium text-slate-200">{lib.name}</div>
                      <div className="text-[9px] text-slate-500">
                        {lib.skeleton} · {lib.clipCount} clips · {lib.jointCount} joints
                      </div>
                    </button>
                  ))}
                </div>
                {fleetAnims.length > 0 && (
                  <div>
                    <p className="text-[9px] uppercase text-slate-600">Fleet prod/anims</p>
                    {fleetAnims.map((a, i) => (
                      <div key={`${a.key || a.name}-${i}`} className="truncate text-[10px] text-slate-500">
                        {a.name}
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[9px] text-slate-600">
                  Packs: {ANIM_WEAPON_PACKS.slice(0, 8).join(", ")}…
                </p>
                <p className="text-[9px] text-slate-600">
                  Lab bind: {FLEET_URLS.casting} · Combat: {FLEET_URLS.combatLab}
                </p>
              </section>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
