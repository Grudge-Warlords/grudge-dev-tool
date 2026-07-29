import React, { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  Bone, Play, Pause, Upload, RefreshCcw, Layers, Settings2, Wand2, Box, Sun,
  Image as ImageIcon, Terminal, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import ForgeSceneTree from "./ForgeSceneTree";
import ForgeTransformPanel from "./ForgeTransformPanel";
import ForgeLightingPanel from "./ForgeLightingPanel";
import type { StudioLightState } from "../lib/forge/sceneEngine";
import type { StoreCategory } from "../../shared/fleetGames";
import {
  captureRestPose,
  applyBodyMorph,
  DEFAULT_BODY_MORPH,
  type BodyMorphConfig,
} from "../lib/forge/boneAliases";
import {
  type ForgeAnimSettings,
  type AnimLoopMode,
} from "../lib/forge/forgeAnimation";
import { type RigInspectResult } from "../lib/forge/rigInspect";
import { loadModel } from "../lib/forge/loaders";
import {
  applyAnimationsToTarget,
  buildProceduralClip,
  UNRIGGED_PRESETS,
  type UnriggedPreset,
} from "../lib/forge/animApply";
import {
  applySmartTextures,
  filterImagePaths,
  siblingTexturePrefixes,
} from "../lib/forge/textureFinder";
import { runForgeScript, SCRIPT_EXAMPLES, type ForgeScriptHost } from "../lib/forge/forgeScript";

export interface ForgeSceneItem {
  id: string;
  name: string;
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
  mixer: THREE.AnimationMixer | null;
  bones: number;
  rig: RigInspectResult | null;
  bodyMorph: BodyMorphConfig;
  sourceRest: Map<string, import("../lib/forge/boneAliases").RestPoseEntry> | null;
  diskPath?: string | null;
}

interface Props {
  item: ForgeSceneItem;
  allItems: ForgeSceneItem[];
  animSettings: ForgeAnimSettings;
  onAnimSettings: (s: ForgeAnimSettings) => void;
  onBodyMorph: (m: BodyMorphConfig) => void;
  onAnimationsMerged: (clips: THREE.AnimationClip[]) => void;
  activeClip: THREE.AnimationAction | null;
  paused: boolean;
  onPlay: (clip: THREE.AnimationClip) => void;
  onPauseToggle: () => void;
  onStop: () => void;
  r2Path: string;
  setR2Path: (v: string) => void;
  onUploadR2: () => void;
  onFleetDeploy: () => void;
  busyUpload: boolean;
  selectedNode: THREE.Object3D | null;
  selectedNodeUuid: string | null;
  onSelectNode: (uuid: string, object: THREE.Object3D) => void;
  onTransformTick: () => void;
  studioLights: StudioLightState;
  onStudioLights: (s: StudioLightState) => void;
  storeCategories: StoreCategory[];
  deployCategoryId: string;
  setDeployCategoryId: (id: string) => void;
  runIngest: boolean;
  setRunIngest: (v: boolean) => void;
  /** Optional host for in-panel scripting (engine + scene hooks). */
  scriptHost?: ForgeScriptHost | null;
  onAiTexture?: () => void;
  onAiEdit?: () => void;
  onSceneComplete?: () => void;
  aiBusy?: boolean;
  completionLog?: string;
}

type Tab = "scene" | "rig" | "animation" | "textures" | "script" | "modeling" | "deploy";

const MORPH_SLIDERS: Array<{ key: keyof BodyMorphConfig; label: string; min: number; max: number; step: number }> = [
  { key: "torsoLength", label: "Torso", min: 0.7, max: 1.4, step: 0.01 },
  { key: "armLength", label: "Arms", min: 0.7, max: 1.4, step: 0.01 },
  { key: "legLength", label: "Legs", min: 0.7, max: 1.4, step: 0.01 },
  { key: "shoulderWidth", label: "Shoulders", min: 0.7, max: 1.4, step: 0.01 },
  { key: "hipWidth", label: "Hips", min: 0.7, max: 1.4, step: 0.01 },
  { key: "muscle", label: "Muscle", min: 0.8, max: 1.3, step: 0.01 },
  { key: "headScale", label: "Head", min: 0.8, max: 1.3, step: 0.01 },
  { key: "chestWidth", label: "Chest", min: 0.8, max: 1.3, step: 0.01 },
  { key: "handScale", label: "Hands", min: 0.8, max: 1.3, step: 0.01 },
];

export default function ForgeWorkbench(props: Props) {
  const [tab, setTab] = useState<Tab>("scene");
  const [deepInspect, setDeepInspect] = useState<string | null>(null);
  const [deepBusy, setDeepBusy] = useState(false);
  const [texBusy, setTexBusy] = useState(false);
  const [texReport, setTexReport] = useState<string | null>(null);
  const [scriptCode, setScriptCode] = useState(SCRIPT_EXAMPLES[0]?.code ?? "api.help();");
  const [scriptLog, setScriptLog] = useState<string>("");
  const [scriptBusy, setScriptBusy] = useState(false);
  const animInputRef = useRef<HTMLInputElement>(null);
  const texInputRef = useRef<HTMLInputElement>(null);
  const { item, animSettings, onAnimSettings, onBodyMorph, onAnimationsMerged } = props;
  const isRigged = item.bones > 0 || !!item.rig?.hasSkinnedMesh;

  async function runDeepInspect() {
    if (!item.diskPath) return;
    setDeepBusy(true);
    try {
      const res = await window.grudge.model.inspect(item.diskPath) as {
        ok: boolean;
        stats?: { skinCount: number; animationCount: number; totalTriangles: number };
        skins?: Array<{ jointCount: number; jointNames: string[] }>;
        error?: string;
      };
      if (!res.ok) {
        setDeepInspect(res.error ?? "inspect failed");
        return;
      }
      const skin = res.skins?.[0];
      const lines = [
        `nodes: ${res.stats?.totalTriangles ?? 0} tris`,
        `skins: ${res.stats?.skinCount ?? 0}`,
        `anims: ${res.stats?.animationCount ?? 0}`,
        skin ? `joints: ${skin.jointCount}` : "",
        skin?.jointNames?.slice(0, 12).join(", ") ?? "",
      ].filter(Boolean);
      setDeepInspect(lines.join("\n"));
    } catch (e: unknown) {
      setDeepInspect(e instanceof Error ? e.message : String(e));
    } finally {
      setDeepBusy(false);
    }
  }

  const retargetSources = useMemo(
    () => props.allItems.filter((i) => i.id !== item.id && i.animations.length > 0),
    [props.allItems, item.id],
  );

  async function importAnimFile(file: File) {
    const loaded = await loadModel(file);
    if (!loaded.animations.length) {
      toast.info("No clips in file");
      return;
    }
    const result = applyAnimationsToTarget(loaded.animations, item.object, {
      source: loaded.object,
      dropRootChain: animSettings.dropRootChain,
      fallbackPreset: "spin-y",
    });
    onAnimationsMerged([...item.animations, ...result.clips]);
    toast.success(`Applied ${result.clips.length} clip(s)`, {
      description: `${result.mode}${result.warnings[0] ? ` · ${result.warnings[0]}` : ""}`,
    });
  }

  function retargetFromItem(sourceId: string) {
    const src = props.allItems.find((i) => i.id === sourceId);
    if (!src?.animations.length) return;
    const source = src.sourceRest
      ? src.sourceRest
      : captureRestPose(src.object);
    const result = applyAnimationsToTarget(src.animations, item.object, {
      source,
      dropRootChain: animSettings.dropRootChain,
      fallbackPreset: "bob",
    });
    const named = result.clips.map((c) => {
      const clip = c.clone();
      clip.name = `${src.name}:${clip.name}`;
      return clip;
    });
    onAnimationsMerged([...item.animations, ...named]);
    toast.success(`Set ${named.length} clip(s) on ${isRigged ? "rig" : "static mesh"}`, {
      description: result.mode,
    });
  }

  function addProcedural(preset: UnriggedPreset) {
    const clip = buildProceduralClip(item.object, preset);
    onAnimationsMerged([...item.animations, clip]);
    toast.success(`Added ${preset}`, { description: isRigged ? "Also works on rig roots" : "Unrigged object clip" });
  }

  async function smartFindTexturesFromDisk(files: FileList | null) {
    if (!files?.length) return;
    setTexBusy(true);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files)) {
        if (/\.(png|jpe?g|webp|bmp)$/i.test(f.name)) urls.push(URL.createObjectURL(f));
      }
      const reports = await applySmartTextures(item.object, urls);
      const applied = reports.reduce((n, r) => n + r.applied.length, 0);
      setTexReport(
        reports.map((r) =>
          `${r.meshName} / ${r.materialName}: ${r.applied.map((a) => `${a.role}←${a.name}`).join(", ") || "—"}`,
        ).join("\n") || "No matches",
      );
      toast.success(`Applied ${applied} texture map(s)`, { description: `${reports.length} material(s)` });
    } catch (e: unknown) {
      toast.error("Texture apply failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setTexBusy(false);
    }
  }

  async function smartFindTexturesFromFleet() {
    setTexBusy(true);
    try {
      const prefixes = item.diskPath
        ? siblingTexturePrefixes(item.diskPath.replace(/\\/g, "/"))
        : ["textures/", "models/textures/", "maps/"];
      const keys: string[] = [];
      for (const prefix of prefixes.slice(0, 4)) {
        try {
          const res = await window.grudge.os.list({ prefix, delimiter: "", limit: 100 });
          for (const it of res.items ?? []) {
            if (it?.name) keys.push(String(it.name));
          }
        } catch { /* try next prefix */ }
      }
      const images = filterImagePaths(keys);
      if (!images.length) {
        toast.info("No textures found near model path", { description: prefixes[0] });
        setTexReport("No image keys under sibling prefixes");
        return;
      }
      const reports = await applySmartTextures(item.object, images, async (key) => {
        const url: string = await window.grudge.cf.r2PublicUrl(key);
        return url;
      });
      const applied = reports.reduce((n, r) => n + r.applied.length, 0);
      setTexReport(
        `Scanned ${images.length} images\n` +
        reports.map((r) =>
          `${r.meshName}: ${r.applied.map((a) => a.role).join(", ") || "—"}`,
        ).join("\n"),
      );
      toast.success(`Fleet textures: ${applied} map(s)`, { description: `${images.length} candidates` });
    } catch (e: unknown) {
      toast.error("Fleet texture search failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setTexBusy(false);
    }
  }

  async function runScript() {
    if (!props.scriptHost) {
      toast.error("Script host not available");
      return;
    }
    setScriptBusy(true);
    const result = await runForgeScript(scriptCode, props.scriptHost);
    setScriptLog(result.logs.join("\n") + (result.error ? `\n// ${result.error}` : ""));
    setScriptBusy(false);
    if (result.ok) toast.success("Script ok");
    else toast.error("Script error", { description: result.error });
  }

  function applyMorph(patch: Partial<BodyMorphConfig>) {
    const next = { ...item.bodyMorph, ...patch };
    if (item.rig?.bodyParts) {
      applyBodyMorph(item.object, next, item.rig.bodyParts);
      item.object.updateMatrixWorld(true);
    }
    onBodyMorph(next);
  }

  const TabBtn = ({ id, label, icon: Icon }: { id: Tab; label: string; icon: React.ComponentType<{ size?: number | string }> }) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`btn ghost text-[10px] py-0 px-2 ${tab === id ? "border-gold text-gold" : ""}`}
    >
      <Icon size={12} /> {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap gap-1 p-2 border-b border-line">
        <TabBtn id="scene" label="Scene" icon={Box} />
        <TabBtn id="rig" label="Rig" icon={Bone} />
        <TabBtn id="animation" label="Anim" icon={Play} />
        <TabBtn id="textures" label="Tex" icon={ImageIcon} />
        <TabBtn id="script" label="Script" icon={Terminal} />
        <TabBtn id="modeling" label="Morph" icon={Wand2} />
        <TabBtn id="deploy" label="Deploy" icon={Upload} />
      </div>

      <div className="flex-1 overflow-auto p-2 text-xs">
        {tab === "scene" && (
          <div className="space-y-3">
            <div className="text-gold font-semibold">Object graph</div>
            <ForgeSceneTree
              root={item.object}
              selectedUuid={props.selectedNodeUuid}
              onSelect={props.onSelectNode}
            />
            <ForgeTransformPanel object={props.selectedNode} onChange={props.onTransformTick} />
            <div className="text-gold font-semibold flex items-center gap-1"><Sun size={12} /> Lighting</div>
            <ForgeLightingPanel lights={props.studioLights} onChange={props.onStudioLights} />
          </div>
        )}

        {tab === "rig" && !item.rig && (
          <p className="text-muted">No rig data — static mesh or load failed.</p>
        )}

        {tab === "rig" && item.rig && (
          <div className="space-y-2">
            <Row label="Skeleton">{item.rig.skeletonType}</Row>
            <Row label="Fingerprint">{item.rig.fingerprintLabel ?? "unknown"}</Row>
            <Row label="Bones">{item.rig.boneCount}</Row>
            <Row label="Skinned">{item.rig.hasSkinnedMesh ? "yes" : "no"}</Row>
            {item.rig.morphTargetCount > 0 && <Row label="Morph targets">{item.rig.morphTargetCount}</Row>}
            <div className="text-gold font-semibold mt-2">Attachment bones</div>
            {Object.entries(item.rig.attachments).map(([k, v]) => (
              <Row key={k} label={k}>{v ?? "—"}</Row>
            ))}
            <div className="text-gold font-semibold mt-2">Bone list</div>
            <pre className="text-[9px] max-h-32 overflow-auto bg-bg-2 p-1 rounded font-mono">
              {item.rig.boneNames.slice(0, 40).join("\n")}
              {item.rig.boneNames.length > 40 ? `\n…+${item.rig.boneNames.length - 40}` : ""}
            </pre>
            {item.diskPath && (
              <button
                type="button"
                className="btn ghost text-xs w-full mt-2"
                disabled={deepBusy}
                onClick={() => void runDeepInspect()}
              >
                {deepBusy ? "Inspecting GLB…" : "Deep GLB inspect (main process)"}
              </button>
            )}
            {deepInspect && (
              <pre className="text-[9px] max-h-24 overflow-auto bg-bg-2 p-1 rounded font-mono whitespace-pre-wrap">
                {deepInspect}
              </pre>
            )}
          </div>
        )}

        {tab === "animation" && (
          <div className="space-y-3">
            <div className="text-[10px] text-muted border border-line rounded p-2 bg-bg-2/40">
              Target: <strong className="text-gold">{isRigged ? "Rigged" : "Unrigged / static"}</strong>
              {isRigged
                ? " — retarget bone clips onto this skeleton."
                : " — bone packs remap to object spin/pose, or use procedural presets."}
              {" "}Hotkeys: <span className="font-mono text-ink">1–9</span> play · <span className="font-mono text-ink">Space</span> pause · <span className="font-mono text-ink">0</span> stop · <span className="font-mono text-ink">Shift+A</span> spin
            </div>

            <div className="text-gold font-semibold flex items-center gap-1"><Settings2 size={12} /> Playback</div>
            <label className="block">
              <span className="text-muted">Time scale</span>
              <input
                type="range" min={0.1} max={2} step={0.05}
                value={animSettings.timeScale}
                onChange={(e) => onAnimSettings({ ...animSettings, timeScale: Number(e.target.value) })}
                className="w-full"
              />
              <span className="font-mono">{animSettings.timeScale.toFixed(2)}×</span>
            </label>
            <label className="block">
              <span className="text-muted">Loop</span>
              <select
                value={animSettings.loop}
                onChange={(e) => onAnimSettings({ ...animSettings, loop: e.target.value as AnimLoopMode })}
                className="w-full text-xs"
              >
                <option value="repeat">Repeat</option>
                <option value="once">Once</option>
                <option value="pingpong">Ping-pong</option>
              </select>
            </label>
            <label className="block">
              <span className="text-muted">Crossfade (ms)</span>
              <input
                type="number" min={0} max={2000} step={50}
                value={animSettings.crossfadeMs}
                onChange={(e) => onAnimSettings({ ...animSettings, crossfadeMs: Number(e.target.value) })}
                className="w-full"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={animSettings.dropRootChain}
                onChange={(e) => onAnimSettings({ ...animSettings, dropRootChain: e.target.checked })}
              />
              <span>Drop root chain (Mixamo / external packs)</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={animSettings.showSkeleton}
                onChange={(e) => onAnimSettings({ ...animSettings, showSkeleton: e.target.checked })}
              />
              <span>Show skeleton helper</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={animSettings.autoPlayFirst}
                onChange={(e) => onAnimSettings({ ...animSettings, autoPlayFirst: e.target.checked })}
              />
              <span>Auto-play first clip on load</span>
            </label>

            <div className="text-gold font-semibold flex items-center gap-1"><Sparkles size={12} /> Procedural (any mesh)</div>
            <div className="grid grid-cols-2 gap-1">
              {UNRIGGED_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="btn ghost text-[10px] py-1"
                  title={p.hint}
                  onClick={() => addProcedural(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="text-gold font-semibold flex items-center gap-1"><Layers size={12} /> Set / retarget clips</div>
            <button type="button" className="btn ghost text-xs w-full" onClick={() => animInputRef.current?.click()}>
              Import animation GLB/FBX…
            </button>
            <input
              ref={animInputRef}
              type="file"
              accept=".glb,.gltf,.fbx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importAnimFile(f);
                e.target.value = "";
              }}
            />
            {retargetSources.length > 0 && (
              <select
                className="w-full text-xs"
                defaultValue=""
                onChange={(e) => { if (e.target.value) retargetFromItem(e.target.value); e.target.value = ""; }}
              >
                <option value="">Apply clips from scene item…</option>
                {retargetSources.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.animations.length} clips)</option>
                ))}
              </select>
            )}

            {item.animations.length > 0 && (
              <>
                <div className="text-gold font-semibold mt-2">Clips ({item.animations.length})</div>
                <div className="max-h-40 overflow-auto border border-line rounded">
                  {item.animations.map((clip, idx) => {
                    const isActive = props.activeClip?.getClip() === clip;
                    return (
                      <div key={clip.uuid} className={`flex items-center gap-1 p-1 ${isActive ? "bg-gold/10" : ""}`}>
                        <button type="button" className="text-gold" onClick={() => props.onPlay(clip)} title={`Play (hotkey ${idx < 9 ? idx + 1 : "—"})`}>
                          {isActive && !props.paused ? <Pause size={10} /> : <Play size={10} />}
                        </button>
                        <span className="text-muted font-mono w-3">{idx < 9 ? idx + 1 : ""}</span>
                        <span className="truncate flex-1" title={clip.name}>{clip.name}</span>
                        <span className="text-muted">{clip.duration.toFixed(1)}s</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-1 mt-1">
                  <button type="button" className="btn ghost text-xs flex-1" onClick={props.onPauseToggle}>
                    {props.paused ? "Resume" : "Pause"}
                  </button>
                  <button type="button" className="btn ghost text-xs flex-1" onClick={props.onStop}>Stop</button>
                </div>
              </>
            )}
            {item.animations.length === 0 && (
              <p className="text-muted text-[10px]">No clips yet — import a pack, retarget from another item, or add a procedural motion.</p>
            )}
          </div>
        )}

        {tab === "textures" && (
          <div className="space-y-3">
            <p className="text-muted text-[10px]">
              Smart match by mesh/material name + PBR suffixes (albedo, normal, roughness, metal, ao, emissive).
            </p>
            {props.onAiTexture && (
              <button
                type="button"
                className="btn text-xs w-full"
                disabled={texBusy || props.aiBusy}
                onClick={() => props.onAiTexture?.()}
                title="Ctrl+Shift+T / Alt+T"
              >
                {props.aiBusy ? "AI Texture…" : "AI Texture (Ctrl+Shift+T)"}
              </button>
            )}
            {props.onAiEdit && (
              <button
                type="button"
                className="btn ghost text-xs w-full"
                disabled={props.aiBusy}
                onClick={() => props.onAiEdit?.()}
                title="Ctrl+Shift+E / Alt+E"
              >
                AI Edit (Ctrl+Shift+E)
              </button>
            )}
            {props.onSceneComplete && (
              <button
                type="button"
                className="btn ghost text-xs w-full"
                disabled={props.aiBusy}
                onClick={() => props.onSceneComplete?.()}
                title="Ctrl+Shift+C / Alt+C — weld, patch, skeleton"
              >
                {props.aiBusy ? "Completing…" : "Scene Completion (Ctrl+Shift+C)"}
              </button>
            )}
            {props.completionLog && (
              <pre className="text-[9px] max-h-28 overflow-auto bg-bg-2 p-2 rounded font-mono whitespace-pre-wrap">
                {props.completionLog}
              </pre>
            )}
            <button
              type="button"
              className="btn ghost text-xs w-full"
              disabled={texBusy}
              onClick={() => texInputRef.current?.click()}
            >
              {texBusy ? "Applying…" : "Pick texture files…"}
            </button>
            <input
              ref={texInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              multiple
              className="hidden"
              onChange={(e) => {
                void smartFindTexturesFromDisk(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="btn ghost text-xs w-full"
              disabled={texBusy}
              onClick={() => void smartFindTexturesFromFleet()}
            >
              {texBusy ? "Searching…" : "Find on fleet (sibling folders)"}
            </button>
            {texReport && (
              <pre className="text-[9px] max-h-40 overflow-auto bg-bg-2 p-2 rounded font-mono whitespace-pre-wrap">
                {texReport}
              </pre>
            )}
          </div>
        )}

        {tab === "script" && (
          <div className="space-y-2">
            <p className="text-muted text-[10px]">
              Run JS against the live scene via <span className="font-mono text-gold">api</span>. No Node access.
            </p>
            <select
              className="w-full text-xs"
              defaultValue=""
              onChange={(e) => {
                const ex = SCRIPT_EXAMPLES.find((x) => x.label === e.target.value);
                if (ex) setScriptCode(ex.code);
                e.target.value = "";
              }}
            >
              <option value="">Examples…</option>
              {SCRIPT_EXAMPLES.map((ex) => (
                <option key={ex.label} value={ex.label}>{ex.label}</option>
              ))}
            </select>
            <textarea
              className="w-full font-mono text-[10px] min-h-[120px]"
              value={scriptCode}
              onChange={(e) => setScriptCode(e.target.value)}
              spellCheck={false}
            />
            <button type="button" className="btn text-xs w-full" disabled={scriptBusy || !props.scriptHost} onClick={() => void runScript()}>
              {scriptBusy ? "Running…" : "Run script"}
            </button>
            {scriptLog && (
              <pre className="text-[9px] max-h-32 overflow-auto bg-bg-2 p-2 rounded font-mono whitespace-pre-wrap">{scriptLog}</pre>
            )}
          </div>
        )}

        {tab === "modeling" && (
          <div className="space-y-2">
            <p className="text-muted text-[10px]">
              Grudge body morph — same bone scaling used in RTS character pipeline.
            </p>
            {MORPH_SLIDERS.map((s) => (
              <label key={s.key} className="block">
                <span className="text-muted">{s.label}</span>
                <input
                  type="range"
                  min={s.min} max={s.max} step={s.step}
                  value={item.bodyMorph[s.key]}
                  onChange={(e) => applyMorph({ [s.key]: Number(e.target.value) })}
                  className="w-full"
                />
              </label>
            ))}
            <button
              type="button"
              className="btn ghost text-xs w-full mt-2"
              onClick={() => {
                applyMorph(DEFAULT_BODY_MORPH);
              }}
            >
              <RefreshCcw size={10} /> Reset morph
            </button>
          </div>
        )}

        {tab === "deploy" && (
          <div className="space-y-2">
            <label className="block">
              <span className="text-muted">Fleet category</span>
              <select
                className="w-full text-xs"
                value={props.deployCategoryId}
                onChange={(e) => {
                  props.setDeployCategoryId(e.target.value);
                  const cat = props.storeCategories.find((c) => c.id === e.target.value);
                  if (cat) props.setR2Path(cat.prefix);
                }}
              >
                {props.storeCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-muted">R2 prefix</span>
              <input value={props.r2Path} onChange={(e) => props.setR2Path(e.target.value)} className="w-full font-mono text-[10px]" />
            </label>
            <label className="flex items-center gap-2 text-[10px]">
              <input type="checkbox" checked={props.runIngest} onChange={(e) => props.setRunIngest(e.target.checked)} />
              Run Grudge ingest (UUID, rig, thumbnail)
            </label>
            <button type="button" className="btn w-full text-xs" onClick={props.onFleetDeploy} disabled={props.busyUpload}>
              {props.busyUpload ? "Deploying…" : "Fleet deploy (ingest → R2)"}
            </button>
            <button type="button" className="btn ghost w-full text-xs" onClick={props.onUploadR2} disabled={props.busyUpload}>
              Quick upload (skip ingest)
            </button>
            <p className="text-muted text-[10px]">
              Fleet deploy runs size-verify → convert → rig → Grudge UUID before publishing to ObjectStore.
              Save scene JSON from the toolbar to version multi-object layouts.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 border-b border-line/50 py-0.5">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-right truncate max-w-[55%]">{children}</span>
    </div>
  );
}

export { DEFAULT_FORGE_ANIM } from "../lib/forge/forgeAnimation";