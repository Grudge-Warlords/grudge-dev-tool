import React, { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Loader2, RotateCcw, Swords, Footprints, Heart, Skull, Zap } from "lucide-react";
import { SceneEngine } from "../lib/forge/sceneEngine";
import { loadRemoteModel } from "../lib/forge/loaders";
import {
  AnimatedUnit,
  FACTION_CDN_KEY,
  GrudgeAssets,
  loadAnimatedUnit,
  type UnitAnimState,
} from "../lib/grudgeAssets";
import { getEquipmentMeshNames, type CharacterPrefab } from "../../shared/characterCatalog";
import { cdnUrl } from "../../shared/grudge6Assets";

interface Props {
  prefab: CharacterPrefab;
  weaponR2Key?: string | null;
  vfxMode?: boolean;
}

const ANIM_BTNS: { id: UnitAnimState; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "idle", label: "Idle", Icon: RotateCcw },
  { id: "run", label: "Run", Icon: Footprints },
  { id: "attack", label: "Attack", Icon: Swords },
  { id: "hurt", label: "Hit", Icon: Heart },
  { id: "death", label: "Death", Icon: Skull },
  { id: "attack2", label: "Alt", Icon: Zap },
];

export default function CharacterViewport({ prefab, weaponR2Key, vfxMode }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SceneEngine | null>(null);
  const unitRef = useRef<AnimatedUnit | null>(null);
  const weaponRef = useRef<THREE.Object3D | null>(null);
  const vfxRef = useRef<THREE.Points | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);


  const clearScene = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (unitRef.current) {
      engine.scene.remove(unitRef.current.root);
      engine.removeMixer(unitRef.current.mixer);
      unitRef.current.dispose();
      unitRef.current = null;
    }
    if (weaponRef.current) {
      engine.scene.remove(weaponRef.current);
      weaponRef.current = null;
    }
    if (vfxRef.current) {
      engine.scene.remove(vfxRef.current);
      vfxRef.current.geometry.dispose();
      (vfxRef.current.material as THREE.Material).dispose();
      vfxRef.current = null;
    }
  }, []);

  const spawnVfx = useCallback((engine: SceneEngine, color: string) => {
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
    setLoading(true);
    setError(null);
    clearScene();

    const manifestKey = prefab.cdnModelKey ?? FACTION_CDN_KEY[prefab.faction];
    let unit = await loadAnimatedUnit(manifestKey, prefab.classColor);

    if (!unit) {
      const fbxUrl = cdnUrl(prefab.modelPath);
      try {
        const loaded = await loadRemoteModel(fbxUrl);
        unit = new AnimatedUnit(
          loaded.object as THREE.Group,
          loaded.animations,
          prefab.classColor,
        );
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load character model");
        setLoading(false);
        return;
      }
    }

    if (!unit) {
      setError("No model on CDN — check R2 path or upload faction GLB");
      setLoading(false);
      return;
    }

    unit.root.position.set(0, 0, 0);
    engine.scene.add(unit.root);
    engine.frame(unit.root);
    unitRef.current = unit;

    if (vfxMode) spawnVfx(engine, prefab.classColor);

    setLoading(false);
  }, [prefab, vfxMode, clearScene, spawnVfx]);

  const attachWeapon = useCallback(async () => {
    if (!weaponR2Key || !engineRef.current || !unitRef.current) return;
    const engine = engineRef.current;
    if (weaponRef.current) {
      engine.scene.remove(weaponRef.current);
      weaponRef.current = null;
    }
    const gltf = await GrudgeAssets.get().load(weaponR2Key);
    if (!gltf) {
      try {
        const loaded = await loadRemoteModel(cdnUrl(weaponR2Key));
        const w = loaded.object;
        w.scale.setScalar(0.35);
        w.position.set(0.35, 1.0, 0.1);
        engine.scene.add(w);
        weaponRef.current = w;
      } catch { /* ignore */ }
      return;
    }
    const w = gltf.scene.clone();
    w.scale.setScalar(0.35);
    w.position.set(0.35, 1.0, 0.1);
    engine.scene.add(w);
    weaponRef.current = w;
  }, [weaponR2Key]);

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
    void loadCharacter();
  }, [loadCharacter]);

  useEffect(() => {
    void attachWeapon();
  }, [attachWeapon]);

  useEffect(() => {
    if (!vfxMode || !engineRef.current || vfxRef.current) return;
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

  function playAnim(state: UnitAnimState) {
    unitRef.current?.play(state);
  }

  const equipment = getEquipmentMeshNames(prefab);

  return (
    <div className="char-viewport">
      <div className="char-viewport-bar">
        <span className="text-gold text-xs font-semibold">{prefab.name}</span>
        <span className="text-[10px] text-muted">{prefab.animationPack}</span>
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
        <span>Faction {prefab.faction}</span>
        <span>·</span>
        <span>{equipment.length} equipment meshes</span>
        {weaponR2Key && (
          <>
            <span>·</span>
            <span className="text-gold">weapon attached</span>
          </>
        )}
        {vfxMode && (
          <>
            <span>·</span>
            <span className="text-gold">VFX aura active</span>
          </>
        )}
      </div>
    </div>
  );
}