import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CDN_BASE } from "../../shared/grudge6Assets";
import type { FactionId } from "../../shared/characterCatalog";

export interface AssetEntry {
  path: string;
  tags?: string[];
}

export const ASSET_MANIFEST: Record<string, AssetEntry> = {
  char_enemy:   { path: "toon-shooter/characters/Character_Enemy.glb", tags: ["character", "enemy"] },
  char_hazmat:  { path: "toon-shooter/characters/Character_Hazmat.glb", tags: ["character"] },
  char_soldier: { path: "toon-shooter/characters/Character_Soldier.glb", tags: ["character", "player"] },
  weapon_ak:    { path: "toon-shooter/guns/AK.glb", tags: ["weapon"] },
  weapon_pistol:{ path: "toon-shooter/guns/Pistol.glb", tags: ["weapon"] },
  weapon_knife_1: { path: "toon-shooter/guns/Knife_1.glb", tags: ["weapon", "melee"] },
  weapon_sniper:  { path: "toon-shooter/guns/Sniper.glb", tags: ["weapon"] },
};

export const FACTION_CDN_KEY: Record<FactionId, string> = {
  crusade: "char_soldier",
  fabled: "char_hazmat",
  legion: "char_enemy",
};

export type UnitAnimState = "idle" | "run" | "attack" | "hurt" | "death" | "attack2";

const ANIM_CLIP_MAP: Record<UnitAnimState, string> = {
  idle: "Idle",
  run: "Run",
  attack: "Punch",
  hurt: "HitReact",
  death: "Death",
  attack2: "Idle_Shoot",
};

const ANIM_LOOP: Record<UnitAnimState, boolean> = {
  idle: true, run: true, attack: false, hurt: false, death: false, attack2: false,
};

export class GrudgeAssets {
  private static _inst: GrudgeAssets | null = null;
  private _loader = new GLTFLoader();
  private _cache = new Map<string, GLTF>();

  static get(): GrudgeAssets {
    if (!GrudgeAssets._inst) GrudgeAssets._inst = new GrudgeAssets();
    return GrudgeAssets._inst;
  }

  resolveURL(keyOrPath: string): string {
    const entry = ASSET_MANIFEST[keyOrPath];
    if (entry) return `${CDN_BASE}/${entry.path}`;
    if (keyOrPath.startsWith("http")) return keyOrPath;
    return `${CDN_BASE}/${keyOrPath.replace(/^\/+/, "")}`;
  }

  async load(keyOrPath: string): Promise<GLTF | null> {
    const url = this.resolveURL(keyOrPath);
    if (this._cache.has(url)) return this._cache.get(url)!;
    try {
      const gltf = await this._loader.loadAsync(url);
      this._cache.set(url, gltf);
      return gltf;
    } catch {
      return null;
    }
  }
}

export class AnimatedUnit {
  readonly root: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  private _actions: Partial<Record<UnitAnimState, THREE.AnimationAction>> = {};
  private _current: THREE.AnimationAction | null = null;
  private _state: UnitAnimState = "idle";

  constructor(scene: THREE.Group, clips: THREE.AnimationClip[], tintHex: string, scale = 0.55) {
    this.root = scene;
    this.root.scale.setScalar(scale);
    this.mixer = new THREE.AnimationMixer(this.root);

    const tint = new THREE.Color(tintHex);
    this.root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const mat = mesh.material;
        const apply = (m: THREE.MeshStandardMaterial) => {
          if (m.emissive) {
            m.emissive.copy(tint);
            m.emissiveIntensity = 0.12;
          }
        };
        if (Array.isArray(mat)) mat.forEach((m) => apply(m as THREE.MeshStandardMaterial));
        else apply(mat as THREE.MeshStandardMaterial);
      }
    });

    for (const [state, clipName] of Object.entries(ANIM_CLIP_MAP)) {
      const clip = clips.find((c) => c.name === clipName);
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      const loop = ANIM_LOOP[state as UnitAnimState];
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      if (!loop) action.clampWhenFinished = true;
      this._actions[state as UnitAnimState] = action;
    }

    this.play("idle");
    this.mixer.addEventListener("finished", (e: { action: THREE.AnimationAction }) => {
      if (e.action === this._actions.death) return;
      if (this._state !== "idle" && this._state !== "run") this.play("idle");
    });
  }

  get state(): UnitAnimState { return this._state; }

  play(state: UnitAnimState): void {
    const next = this._actions[state];
    if (!next) return;
    if (this._current && this._current !== next) {
      next.reset().setEffectiveWeight(1);
      this._current.crossFadeTo(next, 0.15, true);
      next.play();
    } else {
      next.reset().play();
    }
    this._current = next;
    this._state = state;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        (child as THREE.Mesh).geometry?.dispose();
        const mat = (child as THREE.Mesh).material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else (mat as THREE.Material)?.dispose();
      }
    });
  }
}

export async function loadAnimatedUnit(
  manifestKey: string,
  tintHex: string,
): Promise<AnimatedUnit | null> {
  const gltf = await GrudgeAssets.get().load(manifestKey);
  if (!gltf) return null;
  return new AnimatedUnit(gltf.scene.clone(), gltf.animations, tintHex);
}