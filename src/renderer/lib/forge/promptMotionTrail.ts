import * as THREE from "three";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

const DEFAULT_GHOST_COUNT = 7;
const MIN_SAMPLE_SECONDS = 1 / 30;
const MAX_SAMPLE_SECONDS = 0.24;

interface PromptMotionPlanRecord {
  clipId?: unknown;
  durationSeconds?: unknown;
  rootPath?: unknown;
  pathDirection?: unknown;
  travelMeters?: unknown;
  hopHeightMeters?: unknown;
  radiusMeters?: unknown;
  trail?: unknown;
}

export interface PromptMotionTrailConfig {
  clipId: string;
  durationSeconds: number;
  rootPath: "linear" | "hop-arc" | "figure-eight" | "orbit" | "stationary";
  pathDirection: [number, number, number];
  travelMeters: number;
  hopHeightMeters: number;
  radiusMeters: number;
  lengthMeters: number;
  widthMeters: number;
  color: [number, number, number, number];
  ghostCount: number;
  sampleIntervalSeconds: number;
}

interface PromptMotionTrailGhost {
  root: THREE.Object3D;
  materials: THREE.Material[];
}

export interface PromptMotionTrailState {
  source: THREE.Object3D;
  config: PromptMotionTrailConfig;
  ghosts: PromptMotionTrailGhost[];
  sampleElapsedSeconds: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? THREE.MathUtils.clamp(value, min, max)
    : fallback;
}

function normalizedDirection(value: unknown): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return [1, 0, 0];
  const direction = new THREE.Vector3(
    finite(value[0], 1, -1, 1),
    finite(value[1], 0, -1, 1),
    finite(value[2], 0, -1, 1),
  );
  if (direction.lengthSq() < 1e-8) return [1, 0, 0];
  direction.normalize();
  return [direction.x, direction.y, direction.z];
}

function readPlan(root: THREE.Object3D, clip: THREE.AnimationClip): PromptMotionPlanRecord | null {
  const clipMetadata = asRecord(clip.userData?.grudgePromptAnimation);
  const clipPlan = asRecord(clipMetadata.plan);
  if (Object.keys(clipPlan).length > 0) return clipPlan as PromptMotionPlanRecord;

  const assetMetadata = asRecord(root.userData?.grudgePromptAnimation);
  const assetPlan = asRecord(assetMetadata.plan);
  if (Object.keys(assetPlan).length === 0) return null;
  const clipId = typeof clipMetadata.clipId === "string" ? clipMetadata.clipId : "";
  const latestClipId = typeof assetMetadata.latestClipId === "string" ? assetMetadata.latestClipId : "";
  return clipId && clipId === latestClipId ? assetPlan as PromptMotionPlanRecord : null;
}

/** Read and strictly normalize the trail contract retained in a prompted-animation GLB. */
export function readPromptMotionTrailConfig(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
): PromptMotionTrailConfig | null {
  const plan = readPlan(root, clip);
  if (!plan) return null;
  const trail = asRecord(plan.trail);
  if (trail.enabled !== true) return null;
  const colorValue = Array.isArray(trail.color) && trail.color.length === 4
    ? trail.color
    : [1, 0.48, 0.08, 0.62];
  const color: [number, number, number, number] = [
    finite(colorValue[0], 1, 0, 1),
    finite(colorValue[1], 0.48, 0, 1),
    finite(colorValue[2], 0.08, 0, 1),
    finite(colorValue[3], 0.62, 0, 1),
  ];
  const durationSeconds = finite(plan.durationSeconds, Math.max(clip.duration, 0.25), 0.25, 30);
  const travelMeters = finite(plan.travelMeters, 0, 0, 50);
  const lengthMeters = finite(trail.lengthMeters, 1.5, 0.01, 20);
  const historySeconds = travelMeters > 0.001
    ? durationSeconds * Math.min(0.8, lengthMeters / travelMeters)
    : Math.min(durationSeconds * 0.5, 1.5);
  const sampleIntervalSeconds = THREE.MathUtils.clamp(
    historySeconds / DEFAULT_GHOST_COUNT,
    MIN_SAMPLE_SECONDS,
    MAX_SAMPLE_SECONDS,
  );
  const rootPath = ["linear", "hop-arc", "figure-eight", "orbit", "stationary"].includes(String(plan.rootPath))
    ? String(plan.rootPath) as PromptMotionTrailConfig["rootPath"]
    : "stationary";
  return {
    clipId: typeof plan.clipId === "string" ? plan.clipId : String(asRecord(clip.userData?.grudgePromptAnimation).clipId ?? ""),
    durationSeconds,
    rootPath,
    pathDirection: normalizedDirection(plan.pathDirection),
    travelMeters,
    hopHeightMeters: finite(plan.hopHeightMeters, 0.75, 0.01, 10),
    radiusMeters: finite(plan.radiusMeters, 2, 0.01, 25),
    lengthMeters,
    widthMeters: finite(trail.widthMeters, 0.18, 0.002, 5),
    color,
    ghostCount: DEFAULT_GHOST_COUNT,
    sampleIntervalSeconds,
  };
}

function ghostMaterial(
  source: THREE.Material | THREE.Material[],
  color: THREE.Color,
): THREE.Material | THREE.Material[] {
  const create = (material: THREE.Material) => new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: material.side,
    toneMapped: false,
  });
  return Array.isArray(source) ? source.map(create) : create(source);
}

function createGhost(source: THREE.Object3D, color: THREE.Color): PromptMotionTrailGhost {
  // SkeletonUtils preserves authored skin relationships. Geometry buffers remain
  // shared with the Hunyuan source; only translucent viewport materials are new.
  // AnimationMixer is a live renderer handle with circular references. It is
  // never authored model data, so keep it off the graph only while
  // SkeletonUtils copies serializable userData, then restore it exactly.
  const liveMixers: Array<[THREE.Object3D, unknown]> = [];
  source.traverse((node) => {
    if (!Object.prototype.hasOwnProperty.call(node.userData, "grudgeMixer")) return;
    liveMixers.push([node, node.userData.grudgeMixer]);
    delete node.userData.grudgeMixer;
  });
  let root: THREE.Object3D;
  try {
    root = SkeletonUtils.clone(source) as THREE.Object3D;
  } finally {
    for (const [node, mixer] of liveMixers) node.userData.grudgeMixer = mixer;
  }
  const materials: THREE.Material[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = ghostMaterial(mesh.material, color);
    const values = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.push(...values);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = -20;
  });
  root.visible = false;
  root.name = "Prompt motion trail afterimage";
  root.userData.grudgePromptAnimationEffect = { kind: "trail-afterimage", viewportOnly: true };
  return { root, materials };
}

function parallelNodes(root: THREE.Object3D): THREE.Object3D[] {
  const nodes: THREE.Object3D[] = [];
  root.traverse((node) => nodes.push(node));
  return nodes;
}

function copyPose(source: THREE.Object3D, target: THREE.Object3D): void {
  const sourceNodes = parallelNodes(source);
  const targetNodes = parallelNodes(target);
  const count = Math.min(sourceNodes.length, targetNodes.length);
  for (let index = 0; index < count; index += 1) {
    const from = sourceNodes[index];
    const to = targetNodes[index];
    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);
    to.scale.copy(from.scale);
    to.visible = from.visible;
    const sourceMesh = from as THREE.Mesh;
    const targetMesh = to as THREE.Mesh;
    if (sourceMesh.isMesh && targetMesh.isMesh) {
      // Reassert exact provider geometry even if a loader clone implementation changes.
      targetMesh.geometry = sourceMesh.geometry;
      if (sourceMesh.morphTargetInfluences && targetMesh.morphTargetInfluences) {
        targetMesh.morphTargetInfluences.splice(
          0,
          targetMesh.morphTargetInfluences.length,
          ...sourceMesh.morphTargetInfluences,
        );
      }
    }
  }
  target.visible = true;
  target.updateMatrixWorld(true);
}

function updateOpacity(state: PromptMotionTrailState): void {
  const baseAlpha = state.config.color[3];
  state.ghosts.forEach((ghost, index) => {
    const age = (index + 1) / state.ghosts.length;
    const opacity = baseAlpha * 0.48 * Math.pow(1 - age, 1.35);
    for (const material of ghost.materials) material.opacity = opacity;
  });
}

/** Attach transient afterimages which reuse only the exact loaded Hunyuan geometry. */
export function createPromptMotionTrail(
  scene: THREE.Scene,
  source: THREE.Object3D,
  config: PromptMotionTrailConfig,
): PromptMotionTrailState {
  const color = new THREE.Color(config.color[0], config.color[1], config.color[2]);
  const ghosts = Array.from({ length: config.ghostCount }, () => createGhost(source, color));
  for (const ghost of ghosts) scene.add(ghost.root);
  const state = { source, config, ghosts, sampleElapsedSeconds: config.sampleIntervalSeconds };
  updateOpacity(state);
  return state;
}

/** Sample the authored animation into a short, visibly animated viewport trail. */
export function updatePromptMotionTrail(state: PromptMotionTrailState, deltaSeconds: number): void {
  state.sampleElapsedSeconds += Math.max(0, deltaSeconds);
  if (state.sampleElapsedSeconds < state.config.sampleIntervalSeconds) return;
  state.sampleElapsedSeconds %= state.config.sampleIntervalSeconds;
  const ghost = state.ghosts.pop();
  if (!ghost) return;
  copyPose(state.source, ghost.root);
  state.ghosts.unshift(ghost);
  updateOpacity(state);
}

export function disposePromptMotionTrail(scene: THREE.Scene, state: PromptMotionTrailState | null): void {
  if (!state) return;
  for (const ghost of state.ghosts) {
    scene.remove(ghost.root);
    for (const material of ghost.materials) material.dispose();
  }
  state.ghosts.length = 0;
}

/** Expand a static source box to include the complete prompted path and its trail. */
export function expandBoundsForPromptMotion(
  box: THREE.Box3,
  config: PromptMotionTrailConfig | null,
): THREE.Box3 {
  if (!config || box.isEmpty()) return box;
  const original = box.clone();
  const direction = new THREE.Vector3(...config.pathDirection);
  const offsets: THREE.Vector3[] = [new THREE.Vector3()];
  if (config.rootPath === "linear" || config.rootPath === "hop-arc") {
    offsets.push(direction.clone().multiplyScalar(config.travelMeters));
    offsets.push(direction.clone().multiplyScalar(-config.lengthMeters));
    if (config.rootPath === "hop-arc") offsets.push(direction.clone().multiplyScalar(config.travelMeters * 0.5).add(new THREE.Vector3(0, config.hopHeightMeters, 0)));
  } else if (config.rootPath === "figure-eight" || config.rootPath === "orbit") {
    const radius = config.radiusMeters;
    offsets.push(
      new THREE.Vector3(radius, 0, radius),
      new THREE.Vector3(radius, 0, -radius),
      new THREE.Vector3(-radius, 0, radius),
      new THREE.Vector3(-radius, 0, -radius),
    );
  }
  for (const offset of offsets) {
    box.expandByPoint(original.min.clone().add(offset));
    box.expandByPoint(original.max.clone().add(offset));
  }
  return box;
}
