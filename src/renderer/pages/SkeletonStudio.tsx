/**
 * Skeleton Studio — Mixamo-like 25-bone placement, FBX texture/anim extract,
 * AI-assisted T-pose prep, retarget library export + local/fleet package access.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { toast } from "sonner";
import {
  Bone, Download, FileBox, FolderOpen, Library, MousePointer2, RefreshCw,
  Sparkles, Target, Upload, Wand2, Layers, Package,
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

declare global { interface Window { grudge: any } }

type Step = "load" | "extract" | "tpose" | "place" | "skills" | "export" | "libraries";

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
  const [extract, setExtract] = useState<any>(null);
  const [activeBone, setActiveBone] = useState<Mixamo25Bone>("Hips");
  const [mapping, setMapping] = useState<SkeletonMappingDoc>(() => emptyMapping(""));
  const [aiHint, setAiHint] = useState("Humanoid upright T-pose, arms horizontal, palms down, feet flat.");
  const [packDir, setPackDir] = useState<string | null>(null);
  const [tposePath, setTposePath] = useState<string | null>(null);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [mixer, setMixer] = useState<THREE.AnimationMixer | null>(null);
  const [animClips, setAnimClips] = useState<THREE.AnimationClip[]>([]);
  const [activeAction, setActiveAction] = useState<THREE.AnimationAction | null>(null);
  const [libraries, setLibraries] = useState<LocalLib[]>([]);
  const [fleetAnims, setFleetAnims] = useState<Array<{ name: string; url?: string; key?: string }>>([]);
  const [slotOverrides, setSlotOverrides] = useState<Record<string, string>>({});

  // Engine
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
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const rebuildMarkers = useCallback((placements: BonePlacement[]) => {
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
  }, [activeBone]);

  useEffect(() => {
    rebuildMarkers(mapping.placements);
  }, [mapping.placements, activeBone, rebuildMarkers]);

  async function refreshLibraries() {
    try {
      const list = await window.grudge.skeleton.listLibraries();
      setLibraries(Array.isArray(list) ? list : []);
    } catch {
      setLibraries([]);
    }
  }

  async function refreshFleetAnims() {
    try {
      const res = await window.grudge.os?.search?.({
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
    setBusy(true);
    try {
      const fileData = await window.grudge.forge.readFile(path);
      const bytes = fileData.bytes as Uint8Array;
      const name = fileData.name || path.split(/[/\\]/).pop() || "model.glb";
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const file = new File([ab], name);
      const loaded = await loadModel(file);
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
        toast.success("Model + AnimationMixer", {
          description: `${handle.bones} bones · ${handle.clips.length} clips · skeleton ${showSkeleton ? "on" : "off"}`,
        });

        // Auto bone map from live skeleton
        const jointNames = collectBoneNames(loaded.object);
        if (jointNames.length) {
          setMapping((m) => applyAutoMapToDoc({ ...emptyMapping(path), placements: m.placements }, jointNames));
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
      toast.success("Model loaded", { description: path });
    } catch (e: any) {
      toast.error("Load failed", { description: e?.message });
    } finally {
      setBusy(false);
    }
  }

  async function pickFile() {
    const paths: string[] = await window.grudge.files.pickForUpload();
    const path = paths?.find((p) => /\.(fbx|glb|gltf|obj)$/i.test(p));
    if (path) await loadFromPath(path);
  }

  async function runExtract() {
    if (!diskPath) return;
    setBusy(true);
    try {
      const res = await window.grudge.skeleton.extract(diskPath);
      if (!res.ok) {
        toast.error("Extract failed", { description: res.errors?.join("; ") });
      } else {
        setExtract(res);
        // Merge auto-map from extract joints
        if (res.skeleton?.jointNames?.length) {
          setMapping((m) => applyAutoMapToDoc(m, res.skeleton.jointNames));
          toast.message(`Auto-mapped bones from ${res.skeleton.jointCount} joints`);
        }
        setStep("tpose");
        toast.success(`Extracted ${res.textures?.length ?? 0} textures, ${res.animations?.length ?? 0} clips`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "extract error");
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
      // Place markers at bone world positions when possible
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
        if (placements.length) {
          setMapping((m) => ({ ...m, placements }));
        }
      }
      toast.success(`Auto-mapped ${auto.matched}/22 Mixamo-25 bones`);
      setStep("place");
    } catch (e: any) {
      toast.error(e?.message ?? "auto-map failed");
    }
  }

  async function runTPose() {
    if (!diskPath) return;
    setBusy(true);
    try {
      let hint = aiHint;
      try {
        const ai = await window.grudge.ollama.generate({
          prompt: `Rewrite as a short 3D rigging T-pose instruction for Blender (max 40 words): ${aiHint}`,
        });
        if (ai?.response) hint = String(ai.response).slice(0, 400);
      } catch { /* offline ok */ }

      const res = await window.grudge.skeleton.tpose(diskPath, { aiHint: hint });
      if (!res.ok || !res.outputPath) {
        toast.error("T-pose failed", { description: res.errors?.join("; ") });
      } else {
        setTposePath(res.outputPath);
        await loadFromPath(res.outputPath);
        setStep("place");
        toast.success("T-pose GLB ready for bone placement");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "tpose error");
    } finally {
      setBusy(false);
    }
  }

  // Mouse place bone on mesh — snap nearest source bone when skinned
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
      toast.message(
        sourceBone
          ? `Placed ${activeBone} ← ${sourceBone}`
          : `Placed ${activeBone}`,
      );
    };

    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [step, model, activeBone, diskPath, mapping.placements, pointer, raycaster]);

  async function exportLibrary() {
    const path = tposePath || diskPath;
    if (!path) return;
    setBusy(true);
    try {
      const res = await window.grudge.skeleton.buildLibrary({
        modelPath: path,
        mapping,
        packName: path.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") + "-mixamo25",
      });
      if (!res.ok) {
        toast.error("Library build failed", { description: res.errors?.join("; ") });
      } else {
        setPackDir(res.packDir);
        setStep("export");
        toast.success("Anim library pack ready (v2)", {
          description: `${res.clips?.length ?? 0} clips · auto-mapped ${res.autoMapped ?? 0} bones`,
        });
        if (res.warnings?.length) {
          toast.message(res.warnings[0]);
        }
        void refreshLibraries();
      }
    } catch (e: any) {
      toast.error(e?.message ?? "export error");
    } finally {
      setBusy(false);
    }
  }

  async function installPackLocal() {
    if (!packDir) return;
    setBusy(true);
    try {
      const res = await window.grudge.skeleton.installLibrary(packDir);
      if (res.ok) {
        toast.success("Installed to Documents/grudge-anim-libraries", { description: res.dest });
        void refreshLibraries();
      } else {
        toast.error(res.error || "Install failed");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "install error");
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
          { localPath: rest, targetPath: `models/anims/libraries/${stamp}/rest.glb`, contentType: "model/gltf-binary" },
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
      toast.success("Upload queued to fleet storage (models/anims/libraries)");
    } catch (e: any) {
      toast.error("Upload failed", { description: e?.message });
    } finally {
      setBusy(false);
    }
  }

  /** Load another FBX/GLB and retarget its clips onto the current character. */
  async function retargetFromExternalPack() {
    if (!model || !engineRef.current) {
      toast.error("Load a target character first");
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
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const file = new File([ab], name);
      const source = await loadModel(file);
      if (!source.animations.length) {
        toast.error("Source pack has no animation clips");
        return;
      }
      const { retargetClips } = await import("../lib/forge/boneAliases");
      const retargeted = retargetClips(
        source.animations,
        model.object,
        source.object,
        { dropRootChain: true },
      );
      const merged = [...model.animations, ...retargeted];
      model.animations = merged;
      const { attachAnimationMixer } = await import("../lib/forge/forgeAnimation");
      if (mixer) engineRef.current.removeMixer(mixer);
      const handle = attachAnimationMixer(model.object, merged, { dropRootMotion: true });
      engineRef.current.mixers.push(handle.mixer);
      setMixer(handle.mixer);
      setAnimClips(handle.clips);
      setActiveAction(null);
      toast.success(`Retargeted ${retargeted.length} clips onto character`, {
        description: name,
      });
      setStep("skills");
    } catch (e: any) {
      toast.error("Retarget failed", { description: e?.message });
    } finally {
      setBusy(false);
    }
  }

  async function loadLibraryRestGlb(lib: LocalLib) {
    const rest = `${lib.packDir}/rest.glb`.replace(/\\/g, "/");
    try {
      await loadFromPath(rest);
      toast.success(`Loaded library: ${lib.name}`);
    } catch (e: any) {
      toast.error("Could not load pack rest.glb", { description: e?.message });
    }
  }

  const placedCount = mapping.placements.length;
  const clips = extract?.animations ?? [];
  const autoMatched = mapping.autoMap?.matched ?? Object.keys(mapping.reverseMap || {}).length;

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

  async function attachMixerAgain() {
    if (!model || !engineRef.current) return;
    const { attachAnimationMixer } = await import("../lib/forge/forgeAnimation");
    if (mixer) engineRef.current.removeMixer(mixer);
    const handle = attachAnimationMixer(model.object, model.animations, {
      dropRootMotion: true,
    });
    engineRef.current.mixers.push(handle.mixer);
    engineRef.current.setSkeletonHelper(model.object, showSkeleton);
    setMixer(handle.mixer);
    setAnimClips(handle.clips);
    setActiveAction(null);
    toast.success("AnimationMixer re-attached", {
      description: `${handle.bones} bones · ${handle.clips.length} clips`,
    });
  }

  const steps: Step[] = ["load", "extract", "tpose", "place", "skills", "export", "libraries"];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0a0e1a] text-slate-100">
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <Bone className="h-4 w-4 text-cyan-400" />
        <h1 className="font-semibold text-sm tracking-wide">Skeleton · Dev Tool</h1>
        <span className="text-[10px] text-slate-500">
          Mixamo-25 · FBX extract · T-pose · retarget → grudge-convert → CDN
        </span>
        <div className="ml-auto flex flex-wrap gap-1">
          {steps.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStep(s)}
              className={`rounded px-2 py-0.5 text-[10px] uppercase ${
                step === s ? "bg-cyan-800 text-cyan-100" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <div ref={viewportRef} className="absolute inset-0" />
          {step === "place" && (
            <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-[11px] text-cyan-200">
              <MousePointer2 className="mr-1 inline h-3 w-3" />
              Click mesh to place <strong>{activeBone}</strong> ({placedCount}/{MIXAMO_25_CORE.length})
              {" · "}snaps to nearest source bone
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm">Working…</div>
          )}
        </div>

        <aside className="w-[22rem] shrink-0 overflow-y-auto border-l border-white/10 p-3 space-y-3 text-xs">
          <section className="space-y-1.5">
            <p className="text-[10px] uppercase text-slate-500 tracking-wide">Source</p>
            <button
              type="button"
              onClick={() => void pickFile()}
              className="flex w-full items-center gap-2 rounded border border-slate-700 bg-slate-900/60 px-2 py-2 hover:border-cyan-600"
            >
              <FolderOpen className="h-4 w-4 text-cyan-400" />
              Open FBX / GLB / OBJ
            </button>
            {diskPath && (
              <p className="truncate text-[10px] text-slate-400" title={diskPath}>{diskPath}</p>
            )}
          </section>

          {model && (
            <section className="space-y-1.5">
              <p className="text-[10px] uppercase text-slate-500 tracking-wide">AnimationMixer · Skeleton</p>
              <div className="rounded border border-slate-700 bg-black/40 px-2 py-1.5 text-[10px] text-slate-400">
                Mixer: {mixer ? <span className="text-emerald-400">attached</span> : <span className="text-amber-400">none</span>}
                {" · "}Bones: {model.bones}
                {" · "}Clips: {animClips.length}
                {" · "}Map: {autoMatched}/22
              </div>
              <label className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={showSkeleton}
                  onChange={(e) => setShowSkeleton(e.target.checked)}
                />
                Show skeleton helper
              </label>
              <button
                type="button"
                onClick={() => void attachMixerAgain()}
                className="flex w-full items-center gap-2 rounded border border-cyan-700/50 bg-cyan-950/40 px-2 py-1.5 hover:border-cyan-500"
              >
                <Bone className="h-3.5 w-3.5 text-cyan-400" /> Attach / rebuild AnimationMixer
              </button>
              {animClips.length > 0 && (
                <div className="max-h-28 overflow-auto rounded border border-slate-800">
                  {animClips.map((c) => {
                    const slot = matchSkillSlot(c.name);
                    return (
                      <button
                        key={c.uuid}
                        type="button"
                        onClick={() => playAnimClip(c)}
                        className={`flex w-full items-center justify-between gap-1 truncate px-2 py-1 text-left text-[10px] hover:bg-cyan-950/50 ${
                          activeAction?.getClip() === c ? "bg-cyan-900/40 text-cyan-200" : "text-slate-400"
                        }`}
                      >
                        <span className="truncate">▶ {c.name || "(unnamed)"} · {c.duration.toFixed(1)}s</span>
                        <span className="shrink-0 text-cyan-600">{slot?.id ?? "—"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          <section className="space-y-1.5">
            <p className="text-[10px] uppercase text-slate-500 tracking-wide">Pipeline</p>
            <button type="button" disabled={!diskPath || busy} onClick={() => void runExtract()}
              className="flex w-full items-center gap-2 rounded bg-slate-800 px-2 py-1.5 disabled:opacity-40">
              <FileBox className="h-3.5 w-3.5" /> Extract textures + animations
            </button>
            <button type="button" disabled={!model || busy} onClick={() => void runAutoMap()}
              className="flex w-full items-center gap-2 rounded bg-sky-950/50 border border-sky-800/40 px-2 py-1.5 disabled:opacity-40">
              <Target className="h-3.5 w-3.5" /> Auto-map Mixamo-25 bones
            </button>
            <div className="space-y-1">
              <label className="text-[10px] text-slate-500">AI T-pose hint</label>
              <textarea
                value={aiHint}
                onChange={(e) => setAiHint(e.target.value)}
                rows={2}
                className="w-full rounded border border-slate-700 bg-black/50 px-2 py-1 text-[11px]"
              />
              <button type="button" disabled={!diskPath || busy} onClick={() => void runTPose()}
                className="flex w-full items-center gap-2 rounded bg-violet-900/50 border border-violet-700/50 px-2 py-1.5 disabled:opacity-40">
                <Sparkles className="h-3.5 w-3.5" /> AI T-pose prep (Blender)
              </button>
            </div>
            <button type="button" disabled={!model || busy} onClick={() => void retargetFromExternalPack()}
              className="flex w-full items-center gap-2 rounded bg-amber-950/40 border border-amber-800/40 px-2 py-1.5 disabled:opacity-40">
              <Wand2 className="h-3.5 w-3.5" /> Retarget clips from pack (FBX/GLB)
            </button>
            <button type="button" disabled={!diskPath || busy} onClick={() => void exportLibrary()}
              className="flex w-full items-center gap-2 rounded bg-emerald-900/40 border border-emerald-700/40 px-2 py-1.5 disabled:opacity-40">
              <Package className="h-3.5 w-3.5" /> Build retarget anim library v2
            </button>
            {packDir && (
              <>
                <button type="button" disabled={busy} onClick={() => void installPackLocal()}
                  className="flex w-full items-center gap-2 rounded bg-teal-900/40 border border-teal-700/40 px-2 py-1.5">
                  <Download className="h-3.5 w-3.5" /> Install to Documents libraries
                </button>
                <button type="button" disabled={busy} onClick={() => void uploadPack()}
                  className="flex w-full items-center gap-2 rounded bg-cyan-900/40 border border-cyan-700/40 px-2 py-1.5">
                  <Upload className="h-3.5 w-3.5" /> Upload pack to fleet R2
                </button>
              </>
            )}
          </section>

          {/* Libraries browser */}
          <section className="space-y-1.5">
            <p className="text-[10px] uppercase text-slate-500 flex items-center gap-1">
              <Library className="h-3 w-3" /> Animation libraries & packs
              <button
                type="button"
                className="ml-auto text-slate-500 hover:text-cyan-400"
                onClick={() => { void refreshLibraries(); void refreshFleetAnims(); }}
                title="Refresh"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
            </p>
            <button
              type="button"
              onClick={() => void window.grudge.skeleton.openLibraryDir()}
              className="flex w-full items-center gap-2 rounded border border-slate-700 px-2 py-1.5 text-[11px] hover:border-cyan-700"
            >
              <FolderOpen className="h-3.5 w-3.5" /> Open Documents/grudge-anim-libraries
            </button>
            <div className="max-h-36 overflow-y-auto space-y-1">
              {libraries.length === 0 && (
                <p className="text-[10px] text-slate-600">No local packs yet — build a library first.</p>
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
                    {lib.clipCount} clips · {lib.jointCount} joints · {lib.skeleton}
                    {lib.fingerprint ? ` · ${lib.fingerprint}` : ""}
                  </div>
                </button>
              ))}
            </div>
            {fleetAnims.length > 0 && (
              <div className="space-y-0.5">
                <p className="text-[9px] uppercase text-slate-600">Fleet models/anims (search)</p>
                <div className="max-h-24 overflow-y-auto">
                  {fleetAnims.map((a, i) => (
                    <div key={`${a.key || a.name}-${i}`} className="truncate text-[10px] text-slate-500">
                      {a.name}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="text-[9px] text-slate-600">
              Weapon packs: {ANIM_WEAPON_PACKS.slice(0, 8).join(", ")}…
            </p>
          </section>

          {extract && (
            <section className="space-y-1">
              <p className="text-[10px] uppercase text-slate-500 flex items-center gap-1">
                <Layers className="h-3 w-3" /> Extract
              </p>
              <p className="text-slate-300">
                Textures: {extract.textures?.length ?? 0} · Anims: {extract.animations?.length ?? 0}
              </p>
              <p className="text-slate-500">
                Skeleton: {extract.skeleton?.jointCount ?? 0} joints
                {extract.skeleton?.fingerprint ? ` · ${extract.skeleton.fingerprint}` : " · unknown"}
              </p>
              <div className="max-h-24 overflow-y-auto space-y-0.5">
                {(extract.textures ?? []).slice(0, 12).map((t: any) => (
                  <div key={t.path} className="truncate text-[10px] text-slate-400">{t.role}: {t.name}</div>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-1">
            <p className="text-[10px] uppercase text-slate-500 flex items-center gap-1">
              <Target className="h-3 w-3" /> Mixamo-25 bones
            </p>
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {MIXAMO_25_CORE.map((b) => {
                const placed = mapping.placements.some((p) => p.bone === b);
                const src = mapping.reverseMap?.[b] || mapping.placements.find((p) => p.bone === b)?.sourceBone;
                return (
                  <button
                    key={b}
                    type="button"
                    onClick={() => { setActiveBone(b); setStep("place"); }}
                    className={`flex w-full items-center justify-between rounded px-1.5 py-0.5 text-left ${
                      activeBone === b ? "bg-cyan-950 text-cyan-200" : "hover:bg-white/5 text-slate-300"
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

          <section className="space-y-1">
            <p className="text-[10px] uppercase text-slate-500">Skill slots (clips)</p>
            <div className="max-h-40 overflow-y-auto space-y-0.5">
              {clips.length === 0 && animClips.length === 0 && (
                <p className="text-slate-600">Run extract or load clips first</p>
              )}
              {(clips.length ? clips : animClips.map((c) => ({ name: c.name }))).map((c: any) => {
                const slot = matchSkillSlot(c.name);
                const override = slotOverrides[c.name];
                return (
                  <div key={c.name} className="flex justify-between gap-1 text-[10px]">
                    <span className="truncate text-slate-300">{c.name}</span>
                    <select
                      className="max-w-[7rem] rounded bg-black/50 text-[9px] text-cyan-400 border border-slate-800"
                      value={override || slot?.id || ""}
                      onChange={(e) =>
                        setSlotOverrides((o) => ({ ...o, [c.name]: e.target.value }))
                      }
                    >
                      <option value="">—</option>
                      {ANIM_SKILL_SLOTS.map((s) => (
                        <option key={s.id} value={s.id}>{s.id}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
            <p className="text-[9px] text-slate-600">
              Slots: {ANIM_SKILL_SLOTS.map((s) => s.id).join(", ")}
            </p>
          </section>

          {packDir && (
            <p className="break-all text-[10px] text-emerald-400/90">Pack: {packDir}</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(0, 0, 320, 64);
  ctx.fillStyle = "#67e8f9";
  ctx.font = "22px sans-serif";
  ctx.fillText(text.slice(0, 40), 8, 40);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(0.45, 0.09, 1);
  return spr;
}
