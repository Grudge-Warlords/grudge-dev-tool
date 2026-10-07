import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

export type ViewportNavigationAction = "move-xy" | "orbit" | "camera-position" | "zoom";

export const VIEWPORT_NAVIGATION_HELP =
  "Left drag: move X/Y · Right drag: orbit · Middle drag: camera position · Wheel: zoom";

type ViewportControls = Pick<
  OrbitControls,
  "enablePan" | "enableRotate" | "enableZoom" | "mouseButtons"
>;

/** Keep every Dev Tool 3D viewport on the same explicit mouse contract. */
export function applyViewportNavigation(controls: ViewportControls): void {
  controls.enablePan = true;
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  };
}

export function viewportNavigationActionFromButton(button: number): ViewportNavigationAction | null {
  if (button === 0) return "move-xy";
  if (button === 1) return "camera-position";
  if (button === 2) return "orbit";
  return null;
}

export function viewportNavigationActionLabel(action: ViewportNavigationAction): string {
  if (action === "move-xy") return "Move X/Y";
  if (action === "orbit") return "Orbit angle";
  if (action === "camera-position") return "Camera position";
  return "Wheel zoom";
}

/** Fit the two dimensions visible from a fixed inspection camera, with a small safety margin. */
export function perspectiveFitDistance(
  projectedWidth: number,
  projectedHeight: number,
  verticalFovRadians: number,
  aspect: number,
  margin = 1.18,
  projectedDepth = 0,
): number {
  const safeFov = Math.max(0.01, Math.min(Math.PI - 0.01, verticalFovRadians));
  const safeAspect = Math.max(0.1, aspect);
  const safeMargin = Math.max(1, margin);
  const vertical = Math.max(0.05, projectedHeight) / (2 * Math.tan(safeFov / 2));
  const horizontal = Math.max(0.05, projectedWidth) / (2 * Math.tan(safeFov / 2) * safeAspect);
  // The near face must fit too: measuring only from the bounds centre can
  // put the camera inside a deep object or crop its front face.
  return Math.max(vertical, horizontal) * safeMargin + Math.max(0, projectedDepth) / 2;
}

/** Fit an enclosing sphere so near corners remain visible from any orbit angle. */
export function perspectiveSphereFitDistance(radius: number, verticalFovRadians: number, aspect: number, margin = 1.18): number {
  const halfVertical = Math.max(.01, Math.min(Math.PI - .01, verticalFovRadians)) / 2;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * Math.max(.1, aspect));
  return Math.max(.025, radius) / Math.sin(Math.min(halfVertical, halfHorizontal)) * Math.max(1, margin);
}
