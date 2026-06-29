import React, { useMemo, useRef } from "react";
import * as THREE from "three";
import {
  Bone, Play, Pause, Upload, RefreshCcw, Layers, Settings2, Wand2, Box, Sun,
} from "lucide-react";
import ForgeSceneTree from "./ForgeSceneTree";
import ForgeTransformPanel from "./ForgeTransformPanel";
import ForgeLightingPanel from "./ForgeLightingPanel";
import type { StudioLightState } from "../lib/forge/sceneEngine";
import type { StoreCategory } from "../../shared/fleetGames";
import {
  retargetClips,
  captureRestPose,
  applyBodyMorph,
  DEFAULT_BODY_MORPH,
  type BodyMorphConfig,
} from "../lib/forge/boneAliases";
import {
  DEFAULT_FORGE_ANIM,
  applyLoopMode,
  crossfadeTo,
  type ForgeAnimSettings,
  type AnimLoopMode,
} from "../lib/forge/forgeAnimation";
import { inspectSceneRig, type RigInspectResult } from "../lib/forge/rigInspect";
import { loadModel } from "../lib/forge/loaders";

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
}

type Tab = "scene" | "rig" | "animation" | "modeling" | "deploy";

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
  const [tab, setTab] = React.useState<Tab>("scene");
  const [deepInspect, setDeepInspect] = React.useState<string | null>(null);
  const [deepBusy, setDeepBusy] = React.useState(false);
  const animInputRef = useRef<HTMLInputElement>(null);
  const { item, animSettings, onAnimSettings, onBodyMorph, onAnimationsMerged } = props;

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
    if (!loaded.animations.length) return;
    const retargeted = retargetClips(loaded.animations, item.object, loaded.object, {
      dropRootChain: animSettings.dropRootChain,
    });
    onAnimationsMerged([...item.animations, ...retargeted]);
  }

  function retargetFromItem(sourceId: string) {
    const src = props.allItems.find((i) => i.id === sourceId);
    if (!src?.animations.length) return;
    const source = src.sourceRest
      ? src.sourceRest
      : captureRestPose(src.object);
    const retargeted = retargetClips(src.animations, item.object, source, {
      dropRootChain: animSettings.dropRootChain,
    });
    onAnimationsMerged([...item.animations, ...retargeted.map((c) => {
      const clip = c.clone();
      clip.name = `${src.name}:${clip.name}`;
      return clip;
    })]);
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

            <div className="text-gold font-semibold flex items-center gap-1"><Layers size={12} /> Retarget</div>
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
                <option value="">Retarget clips from scene item…</option>
                {retargetSources.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.animations.length} clips)</option>
                ))}
              </select>
            )}

            {item.animations.length > 0 && (
              <>
                <div className="text-gold font-semibold mt-2">Clips ({item.animations.length})</div>
                <div className="max-h-40 overflow-auto border border-line rounded">
                  {item.animations.map((clip) => {
                    const isActive = props.activeClip?.getClip() === clip;
                    return (
                      <div key={clip.uuid} className={`flex items-center gap-1 p-1 ${isActive ? "bg-gold/10" : ""}`}>
                        <button type="button" className="text-gold" onClick={() => props.onPlay(clip)}>
                          {isActive && !props.paused ? <Pause size={10} /> : <Play size={10} />}
                        </button>
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

export { DEFAULT_FORGE_ANIM };