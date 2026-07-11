import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { ViewHelper } from "three/examples/jsm/helpers/ViewHelper.js";

export type GizmoMode = "translate" | "rotate" | "scale";
export type TransformSpace = "world" | "local";

export interface SceneEngineOptions {
  background?: number;
  showGrid?: boolean;
  showAxes?: boolean;
  hdri?: boolean;
  /** Camera near plane (default 0.01 — three.js editor uses similar). */
  near?: number;
  /** Camera far plane (default 100000 for large scenes / open-world assets). */
  far?: number;
  /** Grid size in world units (default 100). */
  gridSize?: number;
  gridDivisions?: number;
}

export interface ClipPlanes {
  near: number;
  far: number;
  fov: number;
}

export interface RenderStats {
  calls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
}

/**
 * Three.js scene/renderer/camera + studio lighting — Forge viewport engine.
 * Parity targets with three.js editor: clip distances, fog, pick, gizmo space/snap,
 * ViewHelper, wireframe, stats.
 */
export class SceneEngine {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly transform: TransformControls;
  private readonly transformHelper: THREE.Object3D;
  readonly clock = new THREE.Clock();
  readonly mixers: THREE.AnimationMixer[] = [];
  readonly raycaster = new THREE.Raycaster();
  readonly pointer = new THREE.Vector2();

  private grid: THREE.GridHelper | null = null;
  private axes: THREE.AxesHelper | null = null;
  private viewHelper: ViewHelper | null = null;
  private keyLight: THREE.DirectionalLight | null = null;
  private rafHandle = 0;
  private resizeObserver?: ResizeObserver;
  private disposed = false;
  private tickCallbacks: Array<(dt: number) => void> = [];
  private wireframe = false;
  private pickRoots: THREE.Object3D[] = [];
  private onPick: ((obj: THREE.Object3D | null, event: PointerEvent) => void) | null = null;

  constructor(private container: HTMLElement, opts: SceneEngineOptions = {}) {
    const bg = opts.background ?? 0x0a0e1a;
    this.scene.background = new THREE.Color(bg);

    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    const near = opts.near ?? 0.01;
    const far = opts.far ?? 100_000;
    this.camera = new THREE.PerspectiveCamera(50, w / h, near, far);
    this.camera.position.set(5, 4, 7);
    this.camera.lookAt(0, 0.5, 0);
    this.camera.name = "ForgeCamera";

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    container.style.position = container.style.position || "relative";
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.outline = "none";
    this.renderer.domElement.tabIndex = 0;

    // Lighting — warm key + cool fill + IBL (three.js editor default quality bar).
    const key = new THREE.DirectionalLight(0xfff1d6, 1.4);
    key.name = "KeyLight";
    key.position.set(8, 14, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 200;
    key.shadow.camera.left = -40;
    key.shadow.camera.right = 40;
    key.shadow.camera.top = 40;
    key.shadow.camera.bottom = -40;
    key.shadow.bias = -0.0002;
    this.keyLight = key;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x88aaff, 0.45);
    fill.name = "FillLight";
    fill.position.set(-6, 4, -4);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffeedd, 0.25);
    rim.name = "RimLight";
    rim.position.set(0, 3, -8);
    this.scene.add(rim);

    const ambient = new THREE.AmbientLight(0xffffff, 0.2);
    ambient.name = "Ambient";
    this.scene.add(ambient);

    if (opts.hdri !== false) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }

    const gridSize = opts.gridSize ?? 100;
    const gridDiv = opts.gridDivisions ?? 100;
    if (opts.showGrid !== false) {
      this.grid = new THREE.GridHelper(gridSize, gridDiv, 0xffc62a, 0x1c2a55);
      this.grid.name = "Grid";
      const mats = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
      for (const m of mats) {
        m.transparent = true;
        m.opacity = 0.55;
        m.depthWrite = false;
      }
      this.scene.add(this.grid);
    }
    if (opts.showAxes !== false) {
      this.axes = new THREE.AxesHelper(1.25);
      this.axes.name = "Axes";
      this.scene.add(this.axes);
    }

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0.5, 0);
    this.controls.maxDistance = far * 0.9;
    this.controls.minDistance = 0.01;
    this.controls.screenSpacePanning = true;

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setSize(0.9);
    this.transform.addEventListener("dragging-changed", (e) => {
      this.controls.enabled = !(e as { value?: boolean }).value;
    });
    const getHelper = (this.transform as unknown as { getHelper?: () => THREE.Object3D }).getHelper;
    this.transformHelper = typeof getHelper === "function"
      ? getHelper.call(this.transform)
      : (this.transform as unknown as THREE.Object3D);
    this.scene.add(this.transformHelper);

    // ViewHelper (three.js editor axis gizmo — bottom-right of canvas)
    try {
      this.viewHelper = new ViewHelper(this.camera, this.renderer.domElement);
    } catch {
      this.viewHelper = null;
    }

    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.onResize());
      this.resizeObserver.observe(container);
    } else {
      window.addEventListener("resize", this.onResize);
    }

    this.tick();
  }

  setHelpers(enabled: boolean): void {
    if (this.grid) this.grid.visible = enabled;
    if (this.axes) this.axes.visible = enabled;
  }

  setGizmoMode(mode: GizmoMode): void {
    this.transform.setMode(mode);
  }

  setTransformSpace(space: TransformSpace): void {
    this.transform.setSpace(space);
  }

  setSnap(translate: number, rotateDeg: number, scale: number): void {
    this.transform.setTranslationSnap(translate > 0 ? translate : null);
    this.transform.setRotationSnap(rotateDeg > 0 ? THREE.MathUtils.degToRad(rotateDeg) : null);
    this.transform.setScaleSnap(scale > 0 ? scale : null);
  }

  getClipPlanes(): ClipPlanes {
    return { near: this.camera.near, far: this.camera.far, fov: this.camera.fov };
  }

  setClipPlanes(near: number, far: number, fov?: number): void {
    const n = Math.max(0.0001, near);
    const f = Math.max(n + 1, far);
    this.camera.near = n;
    this.camera.far = f;
    if (fov != null && fov > 1 && fov < 170) this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.controls.maxDistance = f * 0.9;
  }

  /** Linear fog — matches three.js editor Fog panel. */
  setFog(kind: "none" | "linear" | "exp2", color = 0x0a0e1a, near = 10, far = 200, density = 0.02): void {
    if (kind === "none") {
      this.scene.fog = null;
      return;
    }
    if (kind === "exp2") {
      this.scene.fog = new THREE.FogExp2(color, density);
      return;
    }
    this.scene.fog = new THREE.Fog(color, near, far);
  }

  setWireframe(enabled: boolean): void {
    this.wireframe = enabled;
    this.scene.traverse((n) => {
      const m = n as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (mat && "wireframe" in mat) (mat as THREE.MeshStandardMaterial).wireframe = enabled;
      }
    });
  }

  getWireframe(): boolean {
    return this.wireframe;
  }

  /** Roots eligible for click-to-select (loaded scene items). */
  setPickRoots(roots: THREE.Object3D[]): void {
    this.pickRoots = roots;
  }

  setPickHandler(handler: ((obj: THREE.Object3D | null, event: PointerEvent) => void) | null): void {
    this.onPick = handler;
  }

  private onPointerDown = (ev: PointerEvent): void => {
    if (!this.onPick || this.pickRoots.length === 0) return;
    if (ev.button !== 0) return;
    // Ignore if transform gizmo is being used
    if ((this.transform as unknown as { dragging?: boolean }).dragging) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickRoots, true);
    if (hits.length === 0) {
      this.onPick(null, ev);
      return;
    }
    // Prefer mesh hit; walk up to nearest named node with userData.itemId if present
    let obj: THREE.Object3D | null = hits[0]!.object;
    this.onPick(obj, ev);
  };

  attach(object: THREE.Object3D): void {
    this.transform.attach(object);
  }

  detach(): void {
    this.transform.detach();
  }

  /**
   * Frame object — auto-scales near/far so large worlds and tiny props both work
   * (three.js editor focus behavior).
   */
  frame(object: THREE.Object3D, paddingFactor = 1.5): void {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z, 0.01);
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = (maxDim / 2 / Math.tan(fov / 2)) * paddingFactor;
    const dir = new THREE.Vector3(1, 0.65, 1).normalize();
    this.camera.position.copy(center).addScaledVector(dir, Math.max(dist, maxDim * 0.5));

    // Dynamic clip planes from object scale — critical for distant LOD / large maps
    this.camera.near = Math.max(0.001, maxDim / 10_000);
    this.camera.far = Math.max(this.camera.near * 100, dist * 50, maxDim * 100, 10_000);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.maxDistance = this.camera.far * 0.9;
    this.controls.update();

    // Expand key light shadow frustum for large framed objects
    if (this.keyLight) {
      const sc = Math.max(20, maxDim * 2);
      const cam = this.keyLight.shadow.camera;
      cam.left = -sc;
      cam.right = sc;
      cam.top = sc;
      cam.bottom = -sc;
      cam.far = Math.max(50, maxDim * 4);
      cam.updateProjectionMatrix();
    }
  }

  /** Frame entire scene contents (excluding helpers). */
  frameAll(exclude: THREE.Object3D[] = []): void {
    const box = new THREE.Box3();
    const skip = new Set(exclude);
    if (this.grid) skip.add(this.grid);
    if (this.axes) skip.add(this.axes);
    skip.add(this.transformHelper);
    this.scene.traverse((n) => {
      if (skip.has(n)) return;
      if ((n as THREE.Mesh).isMesh || (n as THREE.Group).isGroup) {
        if (n === this.scene) return;
        const b = new THREE.Box3().setFromObject(n);
        if (!b.isEmpty()) box.union(b);
      }
    });
    if (box.isEmpty()) return;
    const dummy = new THREE.Object3D();
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    dummy.position.copy(center);
    // fake bounds via a mesh box
    const helper = new THREE.Mesh(new THREE.BoxGeometry(size.x || 1, size.y || 1, size.z || 1));
    helper.position.copy(center);
    helper.updateMatrixWorld(true);
    this.frame(helper, 1.6);
    helper.geometry.dispose();
  }

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

  onTick(cb: (dt: number) => void): () => void {
    this.tickCallbacks.push(cb);
    return () => {
      const i = this.tickCallbacks.indexOf(cb);
      if (i >= 0) this.tickCallbacks.splice(i, 1);
    };
  }

  getRenderStats(): RenderStats {
    const info = this.renderer.info;
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      points: info.render.points,
      lines: info.render.lines,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    };
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
    for (const m of this.mixers) m.update(dt);
    for (const cb of this.tickCallbacks) cb(dt);
    this.controls.update();
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.viewHelper) {
      this.viewHelper.render(this.renderer);
    }
  };

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
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    try {
      this.transform.detach();
    } catch { /* ignore */ }
    try {
      if (this.transformHelper.parent) this.transformHelper.parent.remove(this.transformHelper);
      (this.transform as unknown as { dispose?: () => void }).dispose?.();
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
