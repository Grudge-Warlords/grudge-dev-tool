import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import {
  VIEWPORT_NAVIGATION_HELP,
  applyViewportNavigation,
  perspectiveFitDistance,
  viewportNavigationActionFromButton,
  viewportNavigationActionLabel,
} from "../src/renderer/lib/forge/viewportNavigation";

const controls = {
  enablePan: false,
  enableRotate: false,
  enableZoom: false,
  mouseButtons: {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.PAN,
  },
};

applyViewportNavigation(controls);
assert.equal(controls.enablePan, true);
assert.equal(controls.enableRotate, true);
assert.equal(controls.enableZoom, true);
assert.deepEqual(controls.mouseButtons, {
  LEFT: THREE.MOUSE.PAN,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.ROTATE,
});

assert.equal(viewportNavigationActionFromButton(0), "move-xy");
assert.equal(viewportNavigationActionFromButton(1), "camera-position");
assert.equal(viewportNavigationActionFromButton(2), "orbit");
assert.equal(viewportNavigationActionFromButton(3), null);
assert.equal(viewportNavigationActionLabel("move-xy"), "Move X/Y");
assert.equal(viewportNavigationActionLabel("orbit"), "Orbit angle");
assert.equal(viewportNavigationActionLabel("camera-position"), "Camera position");
assert.equal(viewportNavigationActionLabel("zoom"), "Wheel zoom");
assert.match(VIEWPORT_NAVIGATION_HELP, /Left drag: move X\/Y/);
assert.match(VIEWPORT_NAVIGATION_HELP, /Right drag: orbit/);
assert.match(VIEWPORT_NAVIGATION_HELP, /Middle drag: camera position/);
assert.match(VIEWPORT_NAVIGATION_HELP, /Wheel: zoom/);

const fov = THREE.MathUtils.degToRad(50);
const tallFit = perspectiveFitDistance(0.8, 1.8, fov, 2.5);
const wideFit = perspectiveFitDistance(4, 1, fov, 2.5);
assert.ok(tallFit > 1.8 / (2 * Math.tan(fov / 2)), "tall subjects must retain a visible safety margin");
assert.ok(wideFit > 4 / (2 * Math.tan(fov / 2) * 2.5), "wide subjects and tails must retain a visible safety margin");
assert.ok(tallFit < perspectiveFitDistance(1.8, 1.8, fov, 2.5, 1.5), "the inspection fit must avoid the old excessive square-bound padding");

const sceneEngineSource = readFileSync(fileURLToPath(new URL(
  "../src/renderer/lib/forge/sceneEngine.ts",
  import.meta.url,
)), "utf8");
const multiCanvasSource = readFileSync(fileURLToPath(new URL(
  "../src/renderer/lib/forge/multiCanvasHub.ts",
  import.meta.url,
)), "utf8");
const modelViewerSource = readFileSync(fileURLToPath(new URL(
  "../src/renderer/components/viewers/Model3DViewer.tsx",
  import.meta.url,
)), "utf8");

assert.match(sceneEngineSource, /applyViewportNavigation\(this\.controls\)/);
assert.doesNotMatch(sceneEngineSource, /onShiftPanKey|shiftPanBound/,
  "modifier-key cleanup must not restore a stale left-button mapping");
assert.match(multiCanvasSource, /applyViewportNavigation\(controls\)/,
  "inline previews must share the full editor mapping");
assert.match(modelViewerSource, /applyViewportNavigation\(view\.controls\)/,
  "asset and workflow-stage handoff must reassert the mapping");
assert.match(modelViewerSource, /Exact \$\{visualInspectionStage\} inspection navigation/);
assert.match(modelViewerSource, /data-viewport-navigation-status/,
  "the current navigation state must be visible in the viewport");
assert.match(modelViewerSource, /addEventListener\("end", finishNavigation\)/,
  "OrbitControls must hand interaction state back to ready when a drag ends");
assert.match(modelViewerSource, /setTimeout\(finishNavigation, 1_200\)/,
  "a missed pointer-up must not leave stale active navigation state visible");

console.log("Viewport navigation mapping and handoff tests passed.");
