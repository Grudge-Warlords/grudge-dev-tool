import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export type GizmoMode = "translate" | "rotate" | "scale";

export interface StudioLightState {
  key: { color: number; intensity: number; position: [number, number, number] };
  fill: { color: number; intensity: number; position: [number, number, number] };
  ambient: { color: number; intensity: number };
  exposure: number;
}

export const DEFAULT_STUDIO_LIGHTS: StudioLightState = {
  key: { color: 0xfff1d6, intensity: 1.4, position: [5, 8, 4] },
  fill: { color: 0x88aaff, intensity: 0.4, position: [-4, 3, -2] },
  ambient: { color: 0xffffff, intensity: 0.18 },
  exposure: 1.0,
};

export interface SceneEngineOptions {
  background?: number;
  showGrid?: boolean;
  showAxes?: boolean;
  hdri?: boolean;
}

/**
 * A reusable Three.js scene/renderer/camera + studio lighting setup.
 * Owns its own animation loop. Deterministic, easy to dispose. No React.
 */
export class SceneEngine {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly transform: TransformControls;
  /**
   * Three.js r169 split TransformControls: the controller no longer IS an
   * Object3D, it owns one (`getHelper()`). The visual gizmo lives on this
   * helper; we add it to the scene instead of the controller itself.
   * Keeping the helper as a separate field so `dispose()` can remove it.
   */
  private readonly transformHelper: THREE.Object3D;
  readonly clock = new THREE.Clock();
  readonly mixers: THREE.AnimationMixer[] = [];
  readonly studioLights: {
    key: THREE.DirectionalLight;
    fill: THREE.DirectionalLight;
    ambient: THREE.AmbientLight;
  };
  timeScale = 1;
  private transformListeners = new Set<() => void>();
  private dragListeners = new Set<(dragging: boolean) => void>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();

  private grid: THREE.GridHelper | null = null;
  private skeletonHelpers = new Map<THREE.Object3D, THREE.SkeletonHelper>();
  private axes: THREE.AxesHelper | null = null;
  private rafHandle = 0;
  private resizeObserver?: ResizeObserver;
  private disposed = false;

  constructor(private container: HTMLElement, opts: SceneEngineOptions = {}) {
    const bg = opts.background ?? 0x0a0e1a;
    this.scene.background = new THREE.Color(bg);

    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.01, 5000);
    this.camera.position.set(3, 2.5, 4);
    this.camera.lookAt(0, 0.5, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // Lighting — warm key + cool fill, plus IBL from RoomEnvironment for PBR materials.
    const key = new THREE.DirectionalLight(0xfff1d6, 1.4);
    key.name = "ForgeKeyLight";
    key.position.set(5, 8, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 50;
    key.shadow.camera.left = -10;
    key.shadow.camera.right = 10;
    key.shadow.camera.top = 10;
    key.shadow.camera.bottom = -10;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x88aaff, 0.4);
    fill.name = "ForgeFillLight";
    fill.position.set(-4, 3, -2);
    this.scene.add(fill);

    const ambient = new THREE.AmbientLight(0xffffff, 0.18);
    ambient.name = "ForgeAmbientLight";
    this.scene.add(ambient);
    this.studioLights = { key, fill, ambient };

    if (opts.hdri !== false) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    }

    if (opts.showGrid !== false) {
      this.grid = new THREE.GridHelper(20, 20, 0xffc62a, 0x1c2a55);
      this.grid.userData.forgeInternal = true;
      (this.grid.material as THREE.Material).transparent = true;
      (this.grid.material as THREE.Material).opacity = 0.6;
      this.scene.add(this.grid);
    }
    if (opts.showAxes !== false) {
      this.axes = new THREE.AxesHelper(0.75);
      this.axes.userData.forgeInternal = true;
      this.scene.add(this.axes);
    }

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0.5, 0);

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.addEventListener("dragging-changed", (e: any) => {
      this.controls.enabled = !e.value;
      for (const cb of this.dragListeners) cb(!!e.value);
    });
    this.transform.addEventListener("objectChange", () => {
      for (const cb of this.transformListeners) cb();
    });
    // r169+: TransformControls is NOT an Object3D — add its helper instead.
    // Older code paths that did `scene.add(transformControls)` would land a
    // non-Object3D in scene.children, so any later scene.traverse() / Box3.
    // setFromObject() crashed with "this.traverse is not a function".
    // getHelper() returns the actual visual gizmo (Object3D) we want rendered.
    const getHelper = (this.transform as unknown as { getHelper?: () => THREE.Object3D }).getHelper;
    this.transformHelper = typeof getHelper === "function"
      ? getHelper.call(this.transform)
      : (this.transform as unknown as THREE.Object3D); // legacy fallback for pre-r169 stubs
    this.scene.add(this.transformHelper);

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.onResize());
      this.resizeObserver.observe(container);
    } else {
      window.addEventListener("resize", this.onResize);
    }

    this.tick();
  }

  /** Toggle helpers (grid + axes). */
  setHelpers(enabled: boolean): void {
    if (this.grid) this.grid.visible = enabled;
    if (this.axes) this.axes.visible = enabled;
  }

  setGizmoMode(mode: GizmoMode): void {
    this.transform.setMode(mode);
  }

  attach(object: THREE.Object3D): void {
    this.transform.attach(object);
  }

  detach(): void {
    this.transform.detach();
  }

  onTransformChange(cb: () => void): () => void {
    this.transformListeners.add(cb);
    return () => this.transformListeners.delete(cb);
  }

  /** Subscribe to gizmo drag start (true) / end (false). */
  onDragChanged(cb: (dragging: boolean) => void): () => void {
    this.dragListeners.add(cb);
    return () => this.dragListeners.delete(cb);
  }

  /**
   * Raycast from client coordinates against scene meshes (skips forge helpers).
   */
  pick(clientX: number, clientY: number, roots?: THREE.Object3D[]): THREE.Intersection | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = roots?.length
      ? roots
      : this.scene.children.filter((c) => !c.userData?.forgeInternal && c !== this.transformHelper);
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const hit of hits) {
      // Skip gizmo / helpers
      let p: THREE.Object3D | null = hit.object;
      let skip = false;
      while (p) {
        if (p.userData?.forgeInternal || p === this.transformHelper) {
          skip = true;
          break;
        }
        p = p.parent;
      }
      if (!skip) return hit;
    }
    return null;
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  getBackgroundColor(): number {
    const bg = this.scene.background;
    return bg instanceof THREE.Color ? bg.getHex() : 0x0a0e1a;
  }

  setBackgroundColor(hex: number): void {
    this.scene.background = new THREE.Color(hex);
  }

  getStudioLightState(): StudioLightState {
    const { key, fill, ambient } = this.studioLights;
    return {
      key: {
        color: key.color.getHex(),
        intensity: key.intensity,
        position: key.position.toArray() as [number, number, number],
      },
      fill: {
        color: fill.color.getHex(),
        intensity: fill.intensity,
        position: fill.position.toArray() as [number, number, number],
      },
      ambient: { color: ambient.color.getHex(), intensity: ambient.intensity },
      exposure: this.renderer.toneMappingExposure,
    };
  }

  applyStudioLightState(state: StudioLightState): void {
    const { key, fill, ambient } = this.studioLights;
    key.color.setHex(state.key.color);
    key.intensity = state.key.intensity;
    key.position.fromArray(state.key.position);
    fill.color.setHex(state.fill.color);
    fill.intensity = state.fill.intensity;
    fill.position.fromArray(state.fill.position);
    ambient.color.setHex(state.ambient.color);
    ambient.intensity = state.ambient.intensity;
    this.renderer.toneMappingExposure = state.exposure;
  }

  addPrimitive(kind: "box" | "sphere" | "plane"): THREE.Mesh {
    let geometry: THREE.BufferGeometry;
    if (kind === "sphere") geometry = new THREE.SphereGeometry(0.5, 32, 16);
    else if (kind === "plane") geometry = new THREE.PlaneGeometry(2, 2);
    else geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x8899bb, metalness: 0.1, roughness: 0.75 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Primitive_${kind}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.y = kind === "plane" ? 0 : 0.5;
    this.scene.add(mesh);
    return mesh;
  }

  /** Frame an Object3D — center on its bounding box and fit camera to it. */
  frame(object: THREE.Object3D, paddingFactor = 1.4): void {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = (maxDim / 2 / Math.tan(fov / 2)) * paddingFactor;
    const dir = new THREE.Vector3(1, 0.6, 1).normalize();
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.001, maxDim / 1000);
    this.camera.far = dist * 10;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
  }

  /** Build an AnimationMixer for the given root and register the clips. */
  buildMixer(root: THREE.Object3D, clips: THREE.AnimationClip[]): THREE.AnimationMixer | null {
    if (clips.length === 0) return null;
    const mixer = new THREE.AnimationMixer(root);
    this.mixers.push(mixer);
    return mixer;
  }

  removeMixer(mixer: THREE.AnimationMixer): void {
    const i = this.mixers.indexOf(mixer);
    if (i >= 0) this.mixers.splice(i, 1);
    mixer.stopAllAction();
  }

  private onResize = (): void => {
    if (this.disposed) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  private tick = (): void => {
    if (this.disposed) return;
    this.rafHandle = requestAnimationFrame(this.tick);
    const dt = this.clock.getDelta();
    for (const m of this.mixers) m.update(dt * this.timeScale);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  setSkeletonHelper(root: THREE.Object3D, visible: boolean): void {
    let helper = this.skeletonHelpers.get(root);
    if (visible) {
      if (!helper) {
        helper = new THREE.SkeletonHelper(root);
        (helper.material as THREE.LineBasicMaterial).linewidth = 1;
        this.scene.add(helper);
        this.skeletonHelpers.set(root, helper);
      }
      helper.visible = true;
    } else if (helper) {
      helper.visible = false;
    }
  }

  removeSkeletonHelper(root: THREE.Object3D): void {
    const helper = this.skeletonHelpers.get(root);
    if (helper) {
      this.scene.remove(helper);
      helper.dispose?.();
      this.skeletonHelpers.delete(root);
    }
  }

  /** Take a PNG screenshot of the current frame (data URL). */
  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafHandle);
    this.resizeObserver?.disconnect();
    window.removeEventListener("resize", this.onResize);
    // Detach + remove the helper BEFORE traversing the scene, so the
    // graph contains only Object3D nodes when we walk it for resource
    // cleanup.
    try { this.transform.detach(); } catch { /* ignore */ }
    try {
      const removeHelper = (this.transform as unknown as { dispose?: () => void; getHelper?: () => THREE.Object3D });
      if (this.transformHelper.parent) {
        this.transformHelper.parent.remove(this.transformHelper);
      }
      removeHelper.dispose?.();
    } catch { /* ignore */ }
    this.controls.dispose();
    this.scene.traverse((node) => {
      const m = node as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
        else mat?.dispose();
      }
    });
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
