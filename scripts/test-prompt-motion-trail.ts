import assert from "node:assert/strict";
import * as THREE from "three";
import {
  createPromptMotionTrail,
  disposePromptMotionTrail,
  expandBoundsForPromptMotion,
  readPromptMotionTrailConfig,
  updatePromptMotionTrail,
} from "../src/renderer/lib/forge/promptMotionTrail";

const sourceGeometry = new THREE.BoxGeometry(1, 1, 1);
const sourceMaterial = new THREE.MeshStandardMaterial({ color: 0x303030 });
const sourceMesh = new THREE.Mesh(sourceGeometry, sourceMaterial);
const root = new THREE.Group();
root.add(sourceMesh);

const clip = new THREE.AnimationClip("Shooting star", 2, []);
clip.userData.grudgePromptAnimation = {
  version: 1,
  clipId: "trail-test",
  plan: {
    clipId: "trail-test",
    durationSeconds: 2,
    rootPath: "linear",
    pathDirection: [1, 0, 0],
    travelMeters: 3,
    hopHeightMeters: 0.75,
    radiusMeters: 2,
    trail: {
      enabled: true,
      lengthMeters: 1.5,
      widthMeters: 0.18,
      color: [1, 0.48, 0.08, 0.62],
    },
  },
};

const config = readPromptMotionTrailConfig(root, clip);
assert.ok(config, "persisted per-clip trail metadata must load");
assert.equal(config.clipId, "trail-test");
assert.equal(config.sampleIntervalSeconds, 1 / 7);

const scene = new THREE.Scene();
scene.add(root);
const runtimeMixer = { root };
root.userData.grudgeMixer = runtimeMixer;
const state = createPromptMotionTrail(scene, root, config);
assert.equal(
  root.userData.grudgeMixer,
  runtimeMixer,
  "a circular runtime mixer must be restored without entering the viewport clone",
);
assert.equal(state.ghosts.length, 7);
assert.equal(scene.children.length, 8, "the viewport should contain the source and seven transient afterimages");
for (const ghost of state.ghosts) {
  const mesh = ghost.root.children[0] as THREE.Mesh;
  assert.equal(mesh.geometry, sourceGeometry, "every afterimage must reuse exact provider geometry");
  assert.notEqual(mesh.material, sourceMaterial, "viewport translucency must not mutate the authored material");
  assert.equal(ghost.root.userData.grudgeMixer, undefined, "runtime mixer handles must not leak into afterimages");
  assert.equal(ghost.root.userData.grudgePromptAnimationEffect.viewportOnly, true);
}

root.position.set(0.75, 0.2, -0.1);
updatePromptMotionTrail(state, config.sampleIntervalSeconds);
assert.equal(state.ghosts[0].root.visible, true);
assert.deepEqual(state.ghosts[0].root.position.toArray(), root.position.toArray());

const bounds = expandBoundsForPromptMotion(
  new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5)),
  config,
);
assert.deepEqual(bounds.min.toArray(), [-2, -0.5, -0.5]);
assert.deepEqual(bounds.max.toArray(), [3.5, 0.5, 0.5]);

disposePromptMotionTrail(scene, state);
assert.equal(scene.children.length, 1);

const noTrail = new THREE.AnimationClip("No trail", 1, []);
noTrail.userData.grudgePromptAnimation = { plan: { trail: { enabled: false } } };
assert.equal(readPromptMotionTrailConfig(root, noTrail), null);

sourceGeometry.dispose();
sourceMaterial.dispose();
console.log("Prompt motion trail renderer tests passed.");
