/**
 * CharacterViewport — Create/Engine race viewer with live mesh equipment.
 *
 * Loads canonical Grudge6 race GLBs (models/grudge6/races/*_Characters.glb),
 * applies race atlas textures, catalogs Units_* child meshes, and re-applies
 * equipment loadouts without reloading — same pipeline as Warlords UMMORPG.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  Loader2, RotateCcw, Swords, Footprints, Heart, Skull, Zap, type LucideIcon,
} from "lucide-react";
import { SceneEngine } from "../lib/forge/sceneEngine";
import { loadRemoteModel } from "../lib/forge/loaders";
import {
  Grudge6EquipmentManager,
  prefabEquipmentToLoadout,
  type EquipmentLoadout,
} from "../lib/grudge6Equipment";
import { applyGrudge6RaceTextures, ensureTextureColorSpace } from "../lib/grudge6Textures";
import { RACE_GRUDGE6, raceCdnUrl, type RaceId } from "../../shared/grudge6Assets";
import { getEquipmentMeshNames, type CharacterPrefab, type EquipmentSlots } from "../../shared/characterCatalog";

export type EquipOverride = Partial<EquipmentSlots>;

interface Props {
  prefab: CharacterPrefab;
  /** Live equipment overrides (from Engine equip panel) — merges onto prefab.equipment */
  equipOverride?: EquipOverride | null;
  vfxMode?: boolean;
  /** Callback when catalog discovers available mesh variants */
  onSlotSummary?: (summary: Record<string, string[]>) => void;
}

const ANIM_BTNS: { id: string; label: string; Icon: LucideIcon; clipHints: string[] }[] = [
  { id: "idle", label: "Idle", Icon: RotateCcw, clipHints: ["idle", "stand", "tpose"] },
  { id: "run", label: "Run", Icon: Footprints, clipHints: ["run", "walk", "locomotion"] },
  { id: "attack", label: "Attack", Icon: Swords, clipHints: ["attack", "slash", "strike", "punch"] },
  { id: "hurt", label: "Hit", Icon: Heart, clipHints: ["hit", "hurt", "react", "damage"] },
  { id: "death", label: "Death", Icon: Skull, clipHints: ["death", "die", "dead"] },
  { id: "attack2", label: "Alt", Icon: Zap, clipHints: ["attack2", "skill", "cast", "shoot"] },
];

const TARGET_HEIGHT_M = 2.0;

function fitRootToHeight(root: THREE.Object3D, raceScale: number): void {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const h = size.y || 1;
  const target = TARGET_HEIGHT_M * (raceScale || 1);
  const s = target / h;
  root.scale.setScalar(s);
  root.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(root);
  root.position.y -= box2.min.y;
}

function mergeEquipment(
  base: EquipmentSlots,
  override?: EquipOverride | null,
): EquipmentSlots {
  if (!override) return { ...base, utility: [...(base.utility ?? [])] };
  return {
    body: override.body ?? base.body,
    arms: override.arms ?? base.arms,
    legs: override.legs ?? base.legs,
    head: override.head !== undefined ? override.head : base.head,
    shoulders: override.shoulders !== undefined ? override.shoulders : base.shoulders,
    rightHand: override.rightHand !== undefined ? override.rightHand : base.rightHand,
    rightHandType: override.rightHandType !== undefined ? override.rightHandType : base.rightHandType,
    leftHand: override.leftHand !== undefined ? override.leftHand : base.leftHand,
    leftHandType: override.leftHandType !== undefined ? override.leftHandType : base.leftHandType,
    shield: override.shield !== undefined ? override.shield : base.shield,
    utility: override.utility ?? base.utility ?? [],
  };
}

export default function CharacterViewport({
  prefab,
  equipOverride,
  vfxMode,
  onSlotSummary,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SceneEngine | null>(null);
  const rootRef = useRef<THREE.Object3D | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Map<string, THREE.AnimationAction>>(new Map());
  const equipMgrRef = useRef<Grudge6EquipmentManager | null>(null);
  const clipsRef = useRef<THREE.AnimationClip[]>([]);
  const loadedRaceRef = useRef<string | null>(null);
  const vfxRef = useRef<THREE.Points | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meshCount, setMeshCount] = useState(0);
  const [textured, setTextured] = useState(false);
  const [modelUrl, setModelUrl] = useState("");

  const clearScene = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (rootRef.current) {
      engine.scene.remove(rootRef.current);
      rootRef.current = null;
    }
    if (mixerRef.current) {
      engine.removeMixer(mixerRef.current);
      mixerRef.current = null;
    }
    actionsRef.current.clear();
    equipMgrRef.current = null;
    loadedRaceRef.current = null;
    clipsRef.current = [];
    if (vfxRef.current) {
      engine.scene.remove(vfxRef.current);
      vfxRef.current.geometry.dispose();
      (vfxRef.current.material as THREE.Material).dispose();
      vfxRef.current = null;
    }
  }, []);

  const applyEquipment = useCallback(
    (equipment: EquipmentSlots) => {
      const em = equipMgrRef.current;
      if (!em) return;
      const loadout: EquipmentLoadout = prefabEquipmentToLoadout(equipment);
      em.applyLoadout(loadout);
      setMeshCount(em.meshCount);
    },
    [],
  );

  const spawnVfx = useCallback((engine: SceneEngine, color: string) => {
    if (vfxRef.current) {
      engine.scene.remove(vfxRef.current);
      vfxRef.current.geometry.dispose();
      (vfxRef.current.material as THREE.Material).dispose();
      vfxRef.current = null;
    }
    const count = 400;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 0.8 + Math.random() * 0.6;
      const theta = Math.random() * Math.PI * 2;
      const y = Math.random() * 1.8;
      positions[i * 3] = Math.cos(theta) * r;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(theta) * r;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: new THREE.Color(color),
      size: 0.06,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geom, mat);
    points.position.y = 0.2;
    engine.scene.add(points);
    vfxRef.current = points;
  }, []);

  const loadCharacter = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;

    const raceId = prefab.race as RaceId;
    const raceCfg = RACE_GRUDGE6[raceId] ?? RACE_GRUDGE6.human;
    const url = raceCdnUrl(raceId);
    setModelUrl(url);

    // Same race already loaded — only re-equip (UMMORPG live mesh swap)
    if (loadedRaceRef.current === raceId && rootRef.current && equipMgrRef.current) {
      const eq = mergeEquipment(prefab.equipment, equipOverride);
      applyEquipment(eq);
      return;
    }

    setLoading(true);
    setError(null);
    clearScene();

    try {
      const loaded = await loadRemoteModel(url);
      const root = loaded.object;
      root.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Textures before equip so all variants get atlas
      const okTex = await applyGrudge6RaceTextures(root, raceId);
      setTextured(okTex);
      ensureTextureColorSpace(root);

      const em = new Grudge6EquipmentManager(raceCfg.prefix);
      const summary = em.catalog(root);
      equipMgrRef.current = em;
      onSlotSummary?.(summary);

      const eq = mergeEquipment(prefab.equipment, equipOverride);
      applyEquipment(eq);

      // Textures again after equip (some materials recreated)
      await applyGrudge6RaceTextures(root, raceId);
      ensureTextureColorSpace(root);

      fitRootToHeight(root, raceCfg.scale);
      root.position.x = 0;
      root.position.z = 0;
      engine.scene.add(root);
      engine.frame(root);
      rootRef.current = root;
      loadedRaceRef.current = raceId;

      // Animations (embedded clips on race kit)
      clipsRef.current = loaded.animations ?? [];
      if (clipsRef.current.length > 0) {
        const mixer = engine.buildMixer(root, clipsRef.current);
        if (mixer) {
          mixerRef.current = mixer;
          const actions = new Map<string, THREE.AnimationAction>();
          for (const clip of clipsRef.current) {
            actions.set(clip.name.toLowerCase(), mixer.clipAction(clip));
          }
          actionsRef.current = actions;
          const idle = [...actions.entries()].find(([n]) =>
            n.includes("idle") || n.includes("stand"),
          );
          if (idle) idle[1].reset().play();
          else actions.values().next().value?.reset().play();
        }
      }

      if (vfxMode) spawnVfx(engine, prefab.classColor);
      setMeshCount(em.meshCount);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load race model";
      setError(`${msg} — expected ${url}`);
      console.error("[CharacterViewport]", e);
    } finally {
      setLoading(false);
    }
  }, [
    prefab,
    equipOverride,
    vfxMode,
    clearScene,
    spawnVfx,
    applyEquipment,
    onSlotSummary,
  ]);

  // Load / re-equip when prefab race or equipment changes
  useEffect(() => {
    void loadCharacter();
  }, [loadCharacter]);

  // Live equip without full reload when only equipOverride changes on same race
  useEffect(() => {
    if (!equipMgrRef.current || loadedRaceRef.current !== prefab.race) return;
    const eq = mergeEquipment(prefab.equipment, equipOverride);
    applyEquipment(eq);
  }, [equipOverride, prefab.equipment, prefab.race, applyEquipment]);

  useEffect(() => {
    if (!hostRef.current) return;
    const engine = new SceneEngine(hostRef.current, { showGrid: true, showAxes: false, hdri: true });
    engineRef.current = engine;
    return () => {
      clearScene();
      engine.dispose();
      engineRef.current = null;
    };
  }, [clearScene]);

  useEffect(() => {
    if (!vfxMode || !engineRef.current) return;
    spawnVfx(engineRef.current, prefab.classColor);
    return () => {
      if (vfxRef.current && engineRef.current) {
        engineRef.current.scene.remove(vfxRef.current);
        vfxRef.current.geometry.dispose();
        (vfxRef.current.material as THREE.Material).dispose();
        vfxRef.current = null;
      }
    };
  }, [vfxMode, prefab.classColor, spawnVfx]);

  useEffect(() => {
    if (!vfxMode || !vfxRef.current) return;
    let t = 0;
    let raf = 0;
    const tick = () => {
      t += 0.016;
      if (vfxRef.current) {
        vfxRef.current.rotation.y = t * 0.4;
        const pos = vfxRef.current.geometry.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          pos.setY(i, (pos.getY(i) + Math.sin(t * 2 + i) * 0.002) % 2);
        }
        pos.needsUpdate = true;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [vfxMode]);

  function playAnim(btnId: string) {
    const mixer = mixerRef.current;
    const actions = actionsRef.current;
    if (!mixer || actions.size === 0) return;
    const btn = ANIM_BTNS.find((b) => b.id === btnId);
    const hints = btn?.clipHints ?? [btnId];
    let action: THREE.AnimationAction | undefined;
    for (const [name, a] of actions) {
      if (hints.some((h) => name.includes(h))) {
        action = a;
        break;
      }
    }
    if (!action) action = actions.values().next().value;
    if (!action) return;
    mixer.stopAllAction();
    action.reset().fadeIn(0.15).play();
  }

  const equipment = getEquipmentMeshNames({
    ...prefab,
    equipment: mergeEquipment(prefab.equipment, equipOverride),
  });

  return (
    <div className="char-viewport">
      <div className="char-viewport-bar">
        <span className="text-gold text-xs font-semibold">{prefab.name}</span>
        <span className="text-[10px] text-muted">{prefab.prefix} · {prefab.animationPack}</span>
        {loading && <Loader2 size={12} className="animate-spin text-gold ml-auto" />}
      </div>
      <div className="char-viewport-stage" ref={hostRef} />
      {error && <div className="char-viewport-error">{error}</div>}
      <div className="char-viewport-controls">
        {ANIM_BTNS.map(({ id, label, Icon }) => (
          <button key={id} type="button" className="engine-chip" onClick={() => playAnim(id)} title={label}>
            <Icon size={11} /> {label}
          </button>
        ))}
      </div>
      <div className="char-viewport-meta muted text-[9px]">
        <span className="text-gold">Grudge6 race kit</span>
        <span>·</span>
        <span>{meshCount} equip meshes</span>
        <span>·</span>
        <span>{equipment.length} active slots</span>
        <span>·</span>
        <span>{textured ? "atlas OK" : "atlas miss"}</span>
        {vfxMode && (
          <>
            <span>·</span>
            <span className="text-gold">VFX aura</span>
          </>
        )}
      </div>
      {modelUrl && (
        <div className="char-viewport-meta muted text-[8px] font-mono truncate px-1" title={modelUrl}>
          {modelUrl.replace("https://assets.grudge-studio.com/", "")}
        </div>
      )}
    </div>
  );
}
