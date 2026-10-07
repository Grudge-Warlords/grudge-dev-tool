import * as THREE from "three";
import type { BodyMorphConfig } from "./boneAliases";
import { DEFAULT_FORGE_ANIM, type ForgeAnimSettings } from "./forgeAnimation";
import type { StudioLightState } from "./sceneEngine";

export const FORGE_SCENE_VERSION = 1 as const;

/** Runtime mixers/helpers contain cycles and are rebuilt when the scene loads. */
function retainedObjectJson(object: THREE.Object3D): ReturnType<THREE.Object3D["toJSON"]> {
  const restored: Array<{object:THREE.Object3D;data:Record<string,unknown>}> = [];
  object.traverse(node => {
    restored.push({object:node,data:node.userData});
    node.userData = Object.fromEntries(Object.entries(node.userData).filter(([key,value]) =>
      !["grudgeMixer","grudgeSkeletonRoot","grudgeSkeletonHelper"].includes(key) && !(value instanceof THREE.Object3D) && !(value instanceof THREE.AnimationMixer)));
  });
  try { return object.toJSON(); }
  finally { for(const row of restored) row.object.userData=row.data; }
}

export interface ForgeEntityRecord {
  id: string;
  name: string;
  format: string;
  diskPath?: string | null;
  remoteUrl?: string | null;
  matrix: number[];
  bodyMorph?: BodyMorphConfig;
  visible: boolean;
  /** Exact edited geometry/materials, including primitives without a disk path. */
  embedded?: ReturnType<THREE.Object3D["toJSON"]>;
  clips?: ReturnType<THREE.AnimationClip["toJSON"]>[];
}

export interface ForgeSceneDocument {
  version: typeof FORGE_SCENE_VERSION;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: {
    background: number;
    showHelpers: boolean;
    animSettings: ForgeAnimSettings;
    camera: { position: [number, number, number]; target: [number, number, number] };
    lights: StudioLightState;
  };
  entities: ForgeEntityRecord[];
}

export function matrixToArray(m: THREE.Matrix4): number[] {
  return Array.from(m.elements);
}

export function applyMatrix(object: THREE.Object3D, elements: number[]): void {
  const m = new THREE.Matrix4();
  m.fromArray(elements);
  m.decompose(object.position, object.quaternion, object.scale);
  object.updateMatrixWorld(true);
}

export function serializeScene(opts: {
  name: string;
  entities: Array<{
    id: string;
    name: string;
    format: string;
    object: THREE.Object3D;
    diskPath: string | null;
    bodyMorph: BodyMorphConfig;
    animations?: THREE.AnimationClip[];
  }>;
  background: number;
  showHelpers: boolean;
  animSettings: ForgeAnimSettings;
  camera: THREE.PerspectiveCamera;
  controlsTarget: THREE.Vector3;
  lights: StudioLightState;
}): ForgeSceneDocument {
  const now = new Date().toISOString();
  return {
    version: FORGE_SCENE_VERSION,
    name: opts.name,
    createdAt: now,
    updatedAt: now,
    settings: {
      background: opts.background,
      showHelpers: opts.showHelpers,
      animSettings: opts.animSettings,
      camera: {
        position: opts.camera.position.toArray() as [number, number, number],
        target: opts.controlsTarget.toArray() as [number, number, number],
      },
      lights: opts.lights,
    },
    entities: opts.entities.map((e) => {
      e.object.updateMatrixWorld(true);
      return {
        id: e.id,
        name: e.name,
        format: e.format,
        diskPath: e.diskPath,
        matrix: matrixToArray(e.object.matrixWorld),
        bodyMorph: e.bodyMorph,
        visible: e.object.visible,
        embedded: retainedObjectJson(e.object),
        clips: (e.animations ?? []).map(clip => clip.toJSON()),
      };
    }),
  };
}

export function downloadSceneJson(doc: ForgeSceneDocument): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${doc.name.replace(/\.[^.]+$/, "") || "forge-scene"}.forge-scene.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseSceneJson(raw: string): ForgeSceneDocument {
  const doc = JSON.parse(raw) as ForgeSceneDocument;
  if (doc.version !== FORGE_SCENE_VERSION) {
    throw new Error(`Unsupported scene version: ${doc.version}`);
  }
  if (!Array.isArray(doc.entities)) throw new Error("Invalid scene: missing entities");
  // Back-compat: older scenes omit newer anim flags
  doc.settings.animSettings = {
    ...DEFAULT_FORGE_ANIM,
    ...(doc.settings.animSettings ?? {}),
  };
  return doc;
}
