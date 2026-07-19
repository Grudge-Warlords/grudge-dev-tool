/**
 * Skeleton Studio — Mixamo-like 25-bone placement, FBX texture/anim extract,
 * AI-assisted T-pose prep, retarget library export for Grudge Studio.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { toast } from "sonner";
import {
  Bone, Download, FileBox, FolderOpen, MousePointer2, Sparkles, Target, Upload, Wand2, Layers,
} from "lucide-react";
import { SceneEngine } from "../lib/forge/sceneEngine";
import { loadModel, type LoadedModel } from "../lib/forge/loaders";
import {
  MIXAMO_25_CORE,
  type Mixamo25Bone,
  type BonePlacement,
  type SkeletonMappingDoc,
  emptyMapping,
  ANIM_SKILL_SLOTS,
  matchSkillSlot,
} from "../../shared/mixamo25";

declare global { interface Window { grudge: any } }

type Step = "load" | "extract" | "tpose" | "place" | "skills" | "export";

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
      const label = makeLabel(p.bone);
      label.position.set(p.world[0], p.world[1] + 0.08, p.world[2]);
      g.add(label);
    }
  }, [activeBone]);

  useEffect(() => {
    rebuildMarkers(mapping.placements);
  }, [mapping.placements, activeBone, rebuildMarkers]);

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
        toRemove.forEach((o) => scene.remove(o));
        loaded.object.userData.isUserModel = true;
        scene.add(loaded.object);
        engineRef.current.frame(loaded.object);
      }
      setModel(loaded);
      setDiskPath(path);
      setMapping(emptyMapping(path));
      setExtract(null);
      setPackDir(null);
      setTposePath(null);
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
        setStep("tpose");
        toast.success(`Extracted ${res.textures?.length ?? 0} textures, ${res.animations?.length ?? 0} clips`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "extract error");
    } finally {
      setBusy(false);
    }
  }

  async function runTPose() {
    if (!diskPath) return;
    setBusy(true);
    try {
      // Optional AI polish of hint
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

  // Mouse place bone on mesh
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
      setMapping((m) => {
        const placements = m.placements.filter((x) => x.bone !== activeBone);
        placements.push({ bone: activeBone, world, meshUuid: hits[0].object.uuid, confidence: 1 });
        // Auto-map nearest source bone name if skeleton present
        const boneMap = { ...m.boneMap };
        boneMap[activeBone] = activeBone;
        return { ...m, placements, boneMap, sourceFile: diskPath || m.sourceFile };
      });
      // Advance to next unplaced core bone
      setActiveBone((cur) => {
        const placed = new Set([...mapping.placements.map((x) => x.bone), activeBone]);
        const next = MIXAMO_25_CORE.find((b) => !placed.has(b));
        return next ?? cur;
      });
      toast.message(`Placed ${activeBone}`);
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
        toast.success("Anim library pack ready", { description: res.packDir });
      }
    } catch (e: any) {
      toast.error(e?.message ?? "export error");
    } finally {
      setBusy(false);
    }
  }

  async function uploadPack() {
    if (!packDir) return;
    setBusy(true);
    try {
      // Enqueue rest.glb + manifest via upload job if available
      const rest = `${packDir}\\rest.glb`.replace(/\\/g, "/");
      const job = {
        id: `skel-${Date.now()}`,
        packId: "anim-libraries",
        packVersion: "1.0.0",
        buildManifest: true,
        files: [
          { localPath: rest, targetPath: `models/anims/libraries/${Date.now()}/rest.glb`, contentType: "model/gltf-binary" },
          {
            localPath: `${packDir}/anim-library-manifest.json`,
            targetPath: `models/anims/libraries/${Date.now()}/anim-library-manifest.json`,
            contentType: "application/json",
          },
        ],
      };
      await window.grudge.upload.enqueue(job);
      toast.success("Upload queued to fleet storage");
    } catch (e: any) {
      toast.error("Upload failed", { description: e?.message });
    } finally {
      setBusy(false);
    }
  }

  const placedCount = mapping.placements.length;
  const clips = extract?.animations ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0a0e1a] text-slate-100">
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <Bone className="h-4 w-4 text-cyan-400" />
        <h1 className="font-semibold text-sm tracking-wide">Skeleton Studio</h1>
        <span className="text-[10px] text-slate-500">Mixamo-25 · FBX textures/anims · T-pose · retarget library</span>
        <div className="ml-auto flex gap-1">
          {(["load", "extract", "tpose", "place", "skills", "export"] as Step[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStep(s)}
              className={`rounded px-2 py-0.5 text-[10px] uppercase ${step === s ? "bg-cyan-800 text-cyan-100" : "text-slate-500 hover:text-slate-300"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Viewport */}
        <div className="relative min-w-0 flex-1">
          <div ref={viewportRef} className="absolute inset-0" />
          {step === "place" && (
            <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-[11px] text-cyan-200">
              <MousePointer2 className="mr-1 inline h-3 w-3" />
              Click mesh to place <strong>{activeBone}</strong> ({placedCount}/{MIXAMO_25_CORE.length})
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm">Working…</div>
          )}
        </div>

        {/* Side panel */}
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-white/10 p-3 space-y-3 text-xs">
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
            {diskPath && <p className="truncate text-[10px] text-slate-400" title={diskPath}>{diskPath}</p>}
          </section>

          <section className="space-y-1.5">
            <p className="text-[10px] uppercase text-slate-500 tracking-wide">Pipeline</p>
            <button type="button" disabled={!diskPath || busy} onClick={() => void runExtract()}
              className="flex w-full items-center gap-2 rounded bg-slate-800 px-2 py-1.5 disabled:opacity-40">
              <FileBox className="h-3.5 w-3.5" /> Extract textures + animations
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
            <button type="button" disabled={!diskPath || busy} onClick={() => void exportLibrary()}
              className="flex w-full items-center gap-2 rounded bg-emerald-900/40 border border-emerald-700/40 px-2 py-1.5 disabled:opacity-40">
              <Wand2 className="h-3.5 w-3.5" /> Build retarget anim library
            </button>
            {packDir && (
              <button type="button" disabled={busy} onClick={() => void uploadPack()}
                className="flex w-full items-center gap-2 rounded bg-cyan-900/40 border border-cyan-700/40 px-2 py-1.5">
                <Upload className="h-3.5 w-3.5" /> Upload pack to fleet R2
              </button>
            )}
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
                return (
                  <button
                    key={b}
                    type="button"
                    onClick={() => { setActiveBone(b); setStep("place"); }}
                    className={`flex w-full items-center justify-between rounded px-1.5 py-0.5 text-left ${
                      activeBone === b ? "bg-cyan-950 text-cyan-200" : "hover:bg-white/5 text-slate-300"
                    }`}
                  >
                    <span>{b}</span>
                    <span className={placed ? "text-emerald-400" : "text-slate-600"}>{placed ? "●" : "○"}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-1">
            <p className="text-[10px] uppercase text-slate-500">Skill slots (clips)</p>
            <div className="max-h-40 overflow-y-auto space-y-0.5">
              {clips.length === 0 && <p className="text-slate-600">Run extract first</p>}
              {clips.map((c: any) => {
                const slot = matchSkillSlot(c.name);
                return (
                  <div key={c.name} className="flex justify-between gap-1 text-[10px]">
                    <span className="truncate text-slate-300">{c.name}</span>
                    <span className="shrink-0 text-cyan-500/80">{slot?.id ?? c.skillSlotId ?? "—"}</span>
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
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = "#67e8f9";
  ctx.font = "28px sans-serif";
  ctx.fillText(text, 8, 40);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(0.35, 0.09, 1);
  return spr;
}
