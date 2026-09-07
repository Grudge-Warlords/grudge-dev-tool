import * as THREE from "three";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import {
  GENERIC_GRUDGE_PREVIEW,
  toonKitUrl,
  unarmedMeshIdsForRace,
} from "../../../shared/genericPreviewHost";
import { CDN_BASE, TOON_PLAY_KITS } from "../../../shared/prodPackages";
import { fetchAnimPacksCatalog, normalizeBoneKey } from "../../../shared/mixamo25";
import { createProductionGltfLoader } from "./gltfProdLoader";
import { plantPlayKitSi } from "./siMeasure";

type PreviewLoaded = {
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
  triangles: number;
  format: string;
};

export function isAnimWithoutMesh(loaded: PreviewLoaded): boolean {
  if (!loaded.animations?.length) return false;
  let skinned = 0;
  loaded.object.traverse((n) => {
    const sm = n as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh && sm.visible !== false) skinned++;
  });
  return skinned === 0 || loaded.triangles < 32;
}

function meshKey(name: string): string {
  return name
    .replace(/^(WK_|BRB_|ELF_|DWF_|ORC_|UD_)/i, "")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function isEquippableName(name: string): boolean {
  return /^(WK_|BRB_|ELF_|DWF_|ORC_|UD_)/i.test(name) || /weapon|shield|xtra_|units_/i.test(name);
}

/** Exclusive unarmed loadout — hide every Body_A–E / weapon at once (elf warp). */
export function applyUnarmedVisibility(root: THREE.Object3D, race = "human"): void {
  const allowKeys = new Set(unarmedMeshIdsForRace(race).map(meshKey));
  const meshes: THREE.Mesh[] = [];
  root.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (mesh.isMesh) meshes.push(mesh);
  });
  for (const mesh of meshes) {
    if (!isEquippableName(mesh.name || "")) continue;
    mesh.visible = false;
  }
  const shown: string[] = [];
  for (const mesh of meshes) {
    if (!isEquippableName(mesh.name || "")) continue;
    if (allowKeys.has(meshKey(mesh.name))) {
      mesh.visible = true;
      shown.push(mesh.name);
    }
  }
  const has = (re: RegExp) => shown.some((n) => re.test(n));
  const rescue = (re: RegExp) => {
    const hit = meshes.find((m) => re.test(m.name || "") && !/weapon/i.test(m.name || ""));
    if (hit && !hit.visible) {
      hit.visible = true;
      shown.push(hit.name);
    }
  };
  if (!has(/body/i)) rescue(/units_body_a|body_a/i);
  if (!has(/body/i)) rescue(/units_body|body_/i);
  if (!has(/arms/i)) rescue(/units_arms_a|arms_a/i);
  if (!has(/legs/i)) rescue(/units_legs_a|legs_a/i);
  if (!has(/head/i)) rescue(/units_head_a|head_a/i);
  for (const mesh of meshes) {
    if (/xtra_|quiver|bag|wood|weapon|shield/i.test(mesh.name || "")) mesh.visible = false;
  }
}

function hostBoneMap(root: THREE.Object3D): Map<string, string> {
  const map = new Map<string, string>();
  root.traverse((n) => {
    if ((n as THREE.Bone).isBone || /^Bip001/i.test(n.name)) {
      const k = normalizeBoneKey(n.name);
      if (k && !map.has(k)) map.set(k, n.name);
    }
  });
  return map;
}

export function rematchClip(clip: THREE.AnimationClip, bones: Map<string, string>): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const t of clip.tracks) {
    const dot = t.name.indexOf(".");
    if (dot < 0) continue;
    const bone = t.name.slice(0, dot);
    const prop = t.name.slice(dot);
    if (prop === ".position" || prop.endsWith(".position")) continue;
    const target = bones.get(normalizeBoneKey(bone));
    if (!target) continue;
    const cloned = t.clone();
    cloned.name = target + prop;
    tracks.push(cloned);
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

const hostCacheByRace = new Map<string, THREE.Object3D>();

async function loadHostKit(race = "human"): Promise<THREE.Object3D> {
  const cached = hostCacheByRace.get(race);
  if (cached) return SkeletonUtils.clone(cached) as THREE.Object3D;
  const loader = await createProductionGltfLoader();
  const gltf = await loader.loadAsync(toonKitUrl(race));
  const scene = SkeletonUtils.clone(gltf.scene) as THREE.Object3D;
  applyUnarmedVisibility(scene, race);
  hostCacheByRace.set(race, scene);
  return SkeletonUtils.clone(scene) as THREE.Object3D;
}

function clipRelToUrls(rel: string): string[] {
  let rest = String(rel || "")
    .replace(/^prod:/, "")
    .replace(/^\//, "")
    .replace(/\.(json|glb)$/i, "");
  if (!rest) return [];
  const slug = rest
    .split("/")
    .map((s) => encodeURIComponent(s.replace(/\s+/g, "-")))
    .join("/");
  const spaced = rest
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return [
    `${CDN_BASE}/prod/anims/${slug}.json`,
    `${CDN_BASE}/prod/anims/${slug}.glb`,
    `${CDN_BASE}/prod/anims/${spaced}.json`,
    `${CDN_BASE}/prod/anims/${spaced}.glb`,
    `${CDN_BASE}/anims/baked/${spaced}.json`,
  ];
}

const PLAY_PACK_FALLBACK: Record<string, string[]> = {
  idle: [
    "sword_shield/sword-and-shield-idle",
    "sword_shield/sword and shield idle",
    "prod:magic/standing-idle",
  ],
  walk: ["prod:magic/standing-walk-forward", "magic/standing-walk-forward"],
  run: ["prod:magic/standing-run-forward", "magic/standing-run-forward"],
  attack: ["sword_shield/ken_strike", "sword_shield/sword and shield attack"],
};

async function fetchClipFromUrls(urls: string[]): Promise<THREE.AnimationClip | null> {
  const loader = await createProductionGltfLoader();
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (url.endsWith(".json") || ct.includes("json")) {
        const json = await res.json();
        const clip = THREE.AnimationClip.parse(json);
        if (clip?.tracks?.length) return clip;
        continue;
      }
      const buf = await res.arrayBuffer();
      const gltf = await loader.parseAsync(buf, "");
      const clip = gltf.animations?.[0];
      if (clip) return clip;
    } catch {
      /* next candidate */
    }
  }
  return null;
}

function roleRelsFromCatalog(
  catalog: Awaited<ReturnType<typeof fetchAnimPacksCatalog>>,
  role: string,
): string[] {
  if (!catalog?.packs) return [];
  const packs = catalog.packs;
  const order = ["sword_shield", "magic", "locomotion_8way", "locomotion"];
  const keys =
    role === "attack"
      ? ["attack1", "attack", "attack_1"]
      : role === "walk"
        ? ["walk", "walkF", "walk_forward"]
        : role === "run"
          ? ["run", "runF", "run_forward"]
          : ["idle", "fight_idle"];
  for (const packId of order) {
    const pack = packs[packId];
    if (!pack) continue;
    for (const k of keys) {
      const v = pack[k];
      if (typeof v === "string") return [v];
      if (Array.isArray(v) && v[0]) return v.map(String);
    }
  }
  return [];
}

/** Bip001 idle/walk/run/attack from prod/anims — rematch onto the Toon kit. */
export async function loadToonPlayPackClips(host: THREE.Object3D): Promise<THREE.AnimationClip[]> {
  const catalog = await fetchAnimPacksCatalog();
  const out: THREE.AnimationClip[] = [];
  for (const role of ["idle", "walk", "run", "attack"] as const) {
    const rels = [...roleRelsFromCatalog(catalog, role), ...(PLAY_PACK_FALLBACK[role] || [])];
    const urls = rels.flatMap(clipRelToUrls);
    const clip = await fetchClipFromUrls(urls);
    if (!clip) continue;
    clip.name = role;
    out.push(clip);
  }
  return rematchClipsToHost(out, host);
}

export function looksLikeToonKit(root: THREE.Object3D): boolean {
  let hit = false;
  root.traverse((n) => {
    if (/^(WK_|BRB_|ELF_|DWF_|ORC_|UD_)/i.test(n.name) || /^Bip001/i.test(n.name)) hit = true;
  });
  return hit;
}

/** Load a Warlords Toon race kit (Bip001) for Skeleton Studio / Native Play. */
export async function loadToonPlayKit(race = "human"): Promise<{
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
}> {
  const object = await loadHostKit(race);
  applyUnarmedVisibility(object, race);
  const heightM = TOON_PLAY_KITS[race]?.heightM ?? 1.8;
  plantPlayKitSi(object, heightM);
  object.name = `toon-${race}-unarmed`;
  object.userData.genericPreviewHost = {
    ...GENERIC_GRUDGE_PREVIEW,
    id: `toon-${race}-unarmed`,
    race,
    kitUrl: toonKitUrl(race),
    unarmedMeshIds: unarmedMeshIdsForRace(race),
  };
  object.userData.warlordsPlayContract = "2026-08-18.play-kit.1";
  object.userData.grudge6Play = true;
  return { object, animations: [] };
}

export function rematchClipsToHost(
  clips: THREE.AnimationClip[],
  host: THREE.Object3D,
): THREE.AnimationClip[] {
  const bones = hostBoneMap(host);
  return clips
    .map((c) => rematchClip(c, bones))
    .filter((c) => c.tracks.length > 0);
}

/**
 * Bind clip-only / bones-only animation files onto the generic Toon human unarmed kit.
 */
export async function bindGenericPreviewHost<T extends PreviewLoaded>(loaded: T): Promise<T> {
  if (!isAnimWithoutMesh(loaded)) return loaded;
  const host = await loadHostKit("human");
  const clips = rematchClipsToHost(loaded.animations, host);
  host.name = GENERIC_GRUDGE_PREVIEW.id;
  host.userData.genericPreviewHost = {
    ...GENERIC_GRUDGE_PREVIEW,
    sourceClips: loaded.animations.map((c) => c.name),
    rematchedTracks: clips.reduce((n, c) => n + c.tracks.length, 0),
  };
  loaded.object = host;
  loaded.animations = clips.length ? clips : loaded.animations;
  loaded.format = "glb";
import type * as THREE from "three";

type PreviewLoaded = { object: THREE.Object3D; animations: THREE.AnimationClip[]; triangles: number; format: string };
export function isAnimWithoutMesh(loaded: PreviewLoaded): boolean {
  let hasGeometry = false;
  loaded.object.traverse(n => { const m = n as THREE.Mesh; if (m.isMesh && m.geometry?.getAttribute("position")?.count >= 3) hasGeometry = true; });
  return loaded.animations.length > 0 && !hasGeometry;
}
/** Compatibility entrypoint: never fetch or substitute a library preview body. */
export async function bindGenericPreviewHost<T extends PreviewLoaded>(loaded: T): Promise<T> {
  if (isAnimWithoutMesh(loaded)) loaded.object.userData.animationPreviewMessage = "This animation contains no mesh. Select your own created asset; no sample body was loaded.";
  return loaded;
}
