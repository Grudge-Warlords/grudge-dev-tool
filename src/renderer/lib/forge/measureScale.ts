/**
 * Shift+Ctrl+LMB drag: dragged span becomes 2 m (uniform scale).
 * 1 unit = 1 m. Same SI law as ThreeFlow measureScale.
 */
import * as THREE from "three";
import type { SceneEngine } from "./sceneEngine";

export const SPAN_TARGET_M = 2.0;

function ndc(ev: PointerEvent, el: HTMLElement, out: THREE.Vector2) {
  const r = el.getBoundingClientRect();
  out.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  out.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
}

export function bindSceneMeasure(engine: SceneEngine, toast?: (msg: string) => void): () => void {
  const canvas = engine.renderer.domElement;
  const ray = new THREE.Raycaster();
  const ndcV = new THREE.Vector2();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({ color: 0xffcc44, depthTest: false }),
  );
  line.frustumCulled = false;
  line.visible = false;
  line.userData.forgeInternal = true;
  line.renderOrder = 40;
  engine.scene.add(line);

  let dragging = false;
  let start: THREE.Vector3 | null = null;
  let orbitWas = true;

  const hit = (ev: PointerEvent): THREE.Vector3 | null => {
    ndc(ev, canvas, ndcV);
    ray.setFromCamera(ndcV, engine.activeCamera);
    const hits = ray.intersectObjects(engine.scene.children, true);
    const h = hits.find((x) => {
      const o = x.object;
      if ((o as THREE.Line).isLine) return false;
      if (o.userData?.forgeInternal) return false;
      if (o.type === "GridHelper" || o.type === "AxesHelper") return false;
      return true;
    });
    if (h) return h.point.clone();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const p = new THREE.Vector3();
    if (ray.ray.intersectPlane(plane, p)) return p;
    return null;
  };

  const attached = (): THREE.Object3D | null => {
    const obj = (engine.transform as unknown as { object?: THREE.Object3D }).object;
    return obj ?? null;
  };

  const onDown = (ev: PointerEvent) => {
    if (ev.button !== 0 || !ev.shiftKey || !ev.ctrlKey) return;
    ev.preventDefault();
    ev.stopPropagation();
    const p = hit(ev);
    if (!p) return;
    dragging = true;
    start = p;
    orbitWas = engine.controls.enabled;
    engine.controls.enabled = false;
    line.visible = true;
    const a = geo.getAttribute("position") as THREE.BufferAttribute;
    a.setXYZ(0, p.x, p.y, p.z);
    a.setXYZ(1, p.x, p.y, p.z);
    a.needsUpdate = true;
  };

  const onMove = (ev: PointerEvent) => {
    if (!dragging || !start) return;
    const p = hit(ev);
    if (!p) return;
    const a = geo.getAttribute("position") as THREE.BufferAttribute;
    a.setXYZ(1, p.x, p.y, p.z);
    a.needsUpdate = true;
  };

  const onUp = (ev: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    line.visible = false;
    engine.controls.enabled = orbitWas;
    const p = hit(ev);
    const root = attached();
    if (!start || !p || !root) {
      toast?.("Select a mesh, then Shift+Ctrl+LMB drag a 2 m span");
      return;
    }
    const d = start.distanceTo(p);
    if (!(d > 1e-4)) {
      toast?.("Span too short");
      return;
    }
    const k = SPAN_TARGET_M / d;
    root.scale.multiplyScalar(k);
    root.updateMatrixWorld(true);
    toast?.(`Span ${d.toFixed(3)} m → ${SPAN_TARGET_M.toFixed(1)} m (×${k.toFixed(3)})`);
  };

  canvas.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  return () => {
    canvas.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    line.parent?.remove(line);
    geo.dispose();
    (line.material as THREE.Material).dispose();
  };
}
