import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
// Official three.js editor view cube (no extra npm). JS addon — local type.
import { ViewHelper as ViewHelperImpl } from "three/addons/helpers/ViewHelper.js";

type ViewHelperApi = {
  animating: boolean;
  center: THREE.Vector3;
  setLabels: (x: string, y: string, z: string) => void;
  handleClick: (event: PointerEvent) => boolean;
  update: (delta: number) => void;
  render: (renderer: THREE.WebGLRenderer) => void;
  dispose: () => void;
};
const ViewHelper = ViewHelperImpl as unknown as new (
  camera: THREE.Camera,
  dom: HTMLElement,
) => ViewHelperApi;
import { createInfiniteGrid } from "./infiniteGrid";
import { attachBoneNameLabels, disposeBoneLabelGroup } from "./skeletonOverlay";
import { measureObjectSi, type SiBounds } from "./siMeasure";

export type GizmoMode = "translate" | "rotate" | "scale";
export type StudioView = "persp" | "front" | "right" | "top";

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
  /** Camera used for render / pick / orbit (persp or ortho). */
  activeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
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

  private grid: THREE.Object3D | null = null;
  private skeletonHelpers = new Map<THREE.Object3D, THREE.SkeletonHelper>();
  private boneLabelGroups = new Map<THREE.Object3D, THREE.Group>();
  private boundsHelpers = new Map<THREE.Object3D, THREE.Box3Helper>();
  private axes: THREE.AxesHelper | null = null;
  private viewHelper: ViewHelperApi | null = null;
  private orthoCam: THREE.OrthographicCamera | null = null;
  private viewKind: StudioView = "persp";
  private shiftPanBound = false;
  private rafHandle = 0;
  private resizeObserver?: ResizeObserver;
  private disposed = false;

  constructor(private container: HTMLElement, opts: SceneEngineOptions = {}) {
    const bg = opts.background ?? 0x0a0e1a;
    this.scene.background = new THREE.Color(bg);

    // Min 2×2 — avoids black frames / SMAA issues at 0 size (multi-canvas best practice)
    const w = Math.max(2, container.clientWidth || 2);
    const h = Math.max(2, container.clientHeight || 2);
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.01, 5000);
    this.camera.position.set(3, 2.5, 4);
    this.camera.lookAt(0, 0.5, 0);
    this.activeCamera = this.camera;

    // Full pop-out viewer: dedicated context OK (one window).
    // Grid previews use MultiCanvasHub instead (see multiCanvasHub.ts).
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(w, h, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.cssText = "width:100%;height:100%;display:block;outline:none";
    container.appendChild(this.renderer.domElement);
    // KTX2Loader.detectSupport (gltfProdLoader) reuses the live Elite/Forge GL context
    try {
      (window as unknown as { __grudgeWebGLRenderer?: THREE.WebGLRenderer }).__grudgeWebGLRenderer =
        this.renderer;
    } catch {
      /* non-browser */
    }
    void import("./gltfProdLoader").then((m) => m.bindProductionKtx2(this.renderer));

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
      this.grid = createInfiniteGrid();
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
    // Chrome 3D Viewer + Blender: LMB orbit, RMB/MMB pan, Shift+LMB pan, scroll zoom
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.bindShiftPan();
    this.bindViewHelper();

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

  setGridVisible(enabled: boolean): void {
    if (this.grid) this.grid.visible = enabled;
  }

  setAxesVisible(enabled: boolean): void {
    if (!this.axes && enabled) {
      this.axes = new THREE.AxesHelper(0.75);
      this.axes.userData.forgeInternal = true;
      this.scene.add(this.axes);
    }
    if (this.axes) this.axes.visible = enabled;
  }

  getViewKind(): StudioView {
    return this.viewKind;
  }

  isOrtho(): boolean {
    return this.activeCamera !== this.camera;
  }

  /** Numpad-style views: 1 front · 3 right · 7 top · persp. */
  setView(kind: StudioView, frameTarget?: THREE.Object3D | null): void {
    this.viewKind = kind;
    if (kind === "persp") {
      this.activeCamera = this.camera;
      this.controls.enableRotate = true;
    } else {
      this.ensureOrtho();
      this.activeCamera = this.orthoCam!;
      this.placeAxisView(kind);
    }
    this.controls.object = this.activeCamera;
    try {
      (this.transform as unknown as { camera: THREE.Camera }).camera = this.activeCamera;
    } catch {
      /* r169 camera is ctor-only on some builds */
    }
    this.bindViewHelper();
    if (frameTarget) this.frame(frameTarget);
    else this.controls.update();
  }

  /** Blender 5: toggle perspective / ortho keeping the current look. */
  togglePerspOrtho(frameTarget?: THREE.Object3D | null): void {
    if (this.activeCamera === this.camera) {
      this.ensureOrtho();
      const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
      const dist = Math.max(0.5, dir.length());
      this.orthoCam!.position.copy(this.controls.target).addScaledVector(dir.normalize(), dist);
      this.orthoCam!.quaternion.copy(this.camera.quaternion);
      this.orthoCam!.up.copy(this.camera.up);
      this.syncOrthoFrustum(Math.max(2, dist * 0.6), 1);
      this.activeCamera = this.orthoCam!;
      this.viewKind = this.guessViewFromDir(dir);
    } else {
      this.camera.position.copy(this.activeCamera.position);
      this.camera.quaternion.copy(this.activeCamera.quaternion);
      this.camera.up.copy(this.activeCamera.up);
      this.activeCamera = this.camera;
      this.viewKind = "persp";
    }
    this.controls.object = this.activeCamera;
    try {
      (this.transform as unknown as { camera: THREE.Camera }).camera = this.activeCamera;
    } catch {
      /* ignore */
    }
    this.bindViewHelper();
    if (frameTarget) this.frame(frameTarget);
    else this.controls.update();
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
    this.raycaster.setFromCamera(this.pointer, this.activeCamera);
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

  /**
   * Frame an Object3D — center on its bounding box and fit the camera.
   * Uses perspective aspect so tall/wide models don't clip.
   */
  frame(object: THREE.Object3D, paddingFactor = 1.35): void {
    const box = new THREE.Box3().setFromObject(object);
    this.frameBox(box, paddingFactor);
  }

  /** Frame several roots as one selection bounds. */
  frameMany(objects: THREE.Object3D[], paddingFactor = 1.35): void {
    if (!objects.length) return;
    const box = new THREE.Box3();
    for (const o of objects) {
      if (!o.visible) continue;
      box.expandByObject(o);
    }
    this.frameBox(box, paddingFactor);
  }

  /** Frame the whole scene (skips forge helpers + transform gizmo). */
  frameAll(paddingFactor = 1.4): void {
    const roots = this.scene.children.filter(
      (c) => !c.userData?.forgeInternal && c !== this.transformHelper && c.visible,
    );
    this.frameMany(roots, paddingFactor);
  }

  /** Reset camera to default studio home (origin look). */
  focusHome(): void {
    this.setView("persp");
    this.camera.position.set(3, 2.5, 4);
    this.camera.near = 0.01;
    this.camera.far = 5000;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 0.5, 0);
    this.controls.update();
  }

  /** Core framing from a world-space AABB. */
  frameBox(box: THREE.Box3, paddingFactor = 1.35): void {
    if (box.isEmpty()) return;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    // Guard zero-size (single point / empty mesh)
    const maxDim = Math.max(size.x, size.y, size.z, 0.05);
    const aspect = Math.max(0.1, this.camera.aspect);
    const dir = new THREE.Vector3().subVectors(this.activeCamera.position, this.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0.65, 1);
    dir.normalize();

    if (this.activeCamera instanceof THREE.OrthographicCamera) {
      const dist = Math.max(2, maxDim * paddingFactor);
      this.activeCamera.position.copy(center).addScaledVector(dir, dist);
      this.syncOrthoFrustum(maxDim, paddingFactor);
      this.controls.target.copy(center);
      this.controls.minDistance = Math.max(0.01, maxDim * 0.05);
      this.controls.maxDistance = Math.max(50, dist * 8);
      this.controls.update();
      return;
    }

    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fitH = maxDim / (2 * Math.tan(fov / 2));
    const fitW = maxDim / (2 * Math.tan(fov / 2) * aspect);
    const dist = Math.max(fitH, fitW) * paddingFactor;
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.001, maxDim / 500);
    this.camera.far = Math.max(this.camera.near * 100, dist * 20 + maxDim * 10);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.minDistance = Math.max(0.01, maxDim * 0.05);
    this.controls.maxDistance = Math.max(50, dist * 8);
    this.controls.update();
  }

  /**
   * Soft selection outline via brief emissive flash.
   * Always restores previous emissive so assets don't stay gold/yellow.
   */
  pulseSelect(root: THREE.Object3D | null, hex = 0xffc62a): void {
    // Clear previous pulse tags (full scene)
    this.scene.traverse((n) => {
      const m = n as THREE.Mesh;
      if (!m.isMesh || !m.userData?.forgePulse) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const raw of mats) {
        const mat = raw as THREE.MeshStandardMaterial;
        if (mat?.isMeshStandardMaterial && m.userData.forgePulseEmissive != null) {
          mat.emissive.setHex(m.userData.forgePulseEmissive as number);
          mat.emissiveIntensity = (m.userData.forgePulseIntensity as number) ?? 0;
          mat.needsUpdate = true;
        }
      }
      delete m.userData.forgePulse;
      delete m.userData.forgePulseEmissive;
      delete m.userData.forgePulseIntensity;
    });
    if (!root) return;
    root.traverse((n) => {
      const m = n as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const raw of mats) {
        const mat = raw as THREE.MeshStandardMaterial;
        if (!mat?.isMeshStandardMaterial) continue;
        // Don't paint selection onto materials that already have textured albedo identity
        m.userData.forgePulse = true;
        m.userData.forgePulseEmissive = mat.emissive.getHex();
        m.userData.forgePulseIntensity = mat.emissiveIntensity;
        mat.emissive.setHex(hex);
        mat.emissiveIntensity = Math.min(0.25, Math.max(mat.emissiveIntensity, 0.18));
        mat.needsUpdate = true;
      }
    });
  }

  /**
   * Build / register an AnimationMixer for an asset root.
   * Always creates a mixer when `force` is true (skinned assets with 0 clips
   * still need a mixer so external packs can be attached later).
   */
  buildMixer(
    root: THREE.Object3D,
    clips: THREE.AnimationClip[],
    opts?: { force?: boolean },
  ): THREE.AnimationMixer | null {
    if (clips.length === 0 && !opts?.force) return null;
    const prev = root.userData.grudgeMixer as THREE.AnimationMixer | undefined;
    if (prev) this.removeMixer(prev);
    const mixer = new THREE.AnimationMixer(root);
    root.userData.grudgeMixer = mixer;
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
    const w = Math.max(2, this.container.clientWidth || 2);
    const h = Math.max(2, this.container.clientHeight || 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.orthoCam) {
      const halfH = (this.orthoCam.top - this.orthoCam.bottom) / 2;
      this.orthoCam.left = -halfH * this.camera.aspect;
      this.orthoCam.right = halfH * this.camera.aspect;
      this.orthoCam.updateProjectionMatrix();
    }
    this.renderer.setSize(w, h, false);
  };

  private tick = (): void => {
    if (this.disposed) return;
    this.rafHandle = requestAnimationFrame(this.tick);
    try {
      const dt = Math.min(0.05, this.clock.getDelta());
      for (const m of this.mixers) m.update(dt * this.timeScale);
      this.controls.update();
      if (this.viewHelper) {
        this.viewHelper.center.copy(this.controls.target);
        if (this.viewHelper.animating) this.viewHelper.update(dt);
      }
      // Skip zero-size paints (host hidden / tab background)
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (w < 2 || h < 2) return;
      this.renderer.render(this.scene, this.activeCamera);
      this.viewHelper?.render(this.renderer);
    } catch (e) {
      // Prevent uncaught rAF flood (same class of bug as cinema tick)
      console.warn("[SceneEngine] tick error", e);
    }
  };

  /**
   * Toggle SkeletonHelper for an asset. Uses armature / hips when possible
   * (see findSkeletonRoot in forgeAnimation.ts).
   */
  setSkeletonHelper(root: THREE.Object3D, visible: boolean): void {
    let helper = this.skeletonHelpers.get(root);
    if (visible) {
      if (!helper) {
        // Prefer userData skeleton root (set by attachAnimationMixer)
        let skelTarget: THREE.Object3D = root;
        if (root.userData.grudgeSkeletonRoot instanceof THREE.Object3D) {
          skelTarget = root.userData.grudgeSkeletonRoot;
        } else {
          // Lazy resolve: first skinned mesh
          root.traverse((o) => {
            if (
              skelTarget === root &&
              (o as THREE.SkinnedMesh).isSkinnedMesh &&
              (o as THREE.SkinnedMesh).skeleton?.bones?.length
            ) {
              skelTarget = o;
            }
          });
        }
        helper = new THREE.SkeletonHelper(skelTarget);
        helper.name = "GrudgeSkeletonHelper";
        helper.userData.forgeInternal = true;
        const line = helper.material as THREE.LineBasicMaterial;
        line.depthTest = false;
        line.linewidth = 2;
        line.color.setHex(0xffc62a);
        line.transparent = true;
        line.opacity = 0.92;
        this.scene.add(helper);
        this.skeletonHelpers.set(root, helper);
        root.userData.grudgeSkeletonHelper = helper;
      }
      helper.visible = true;
    } else if (helper) {
      helper.visible = false;
      const labels = this.boneLabelGroups.get(root);
      if (labels) labels.visible = false;
    }
  }

  setBoneLabelsVisible(root: THREE.Object3D, visible: boolean): void {
    let labels = this.boneLabelGroups.get(root);
    if (visible && !labels) {
      labels = attachBoneNameLabels(root, this.scene);
      this.boneLabelGroups.set(root, labels);
    }
    if (labels) labels.visible = visible;
  }

  setBoundsHelper(root: THREE.Object3D, visible: boolean): void {
    let helper = this.boundsHelpers.get(root);
    if (visible) {
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) return;
      if (!helper) {
        helper = new THREE.Box3Helper(box, 0x67e8f9);
        helper.name = "GrudgeBoundsHelper";
        helper.userData.forgeInternal = true;
        this.scene.add(helper);
        this.boundsHelpers.set(root, helper);
      } else {
        helper.box.copy(box);
      }
      helper.visible = true;
    } else if (helper) {
      helper.visible = false;
    }
  }

  measureBounds(root: THREE.Object3D): SiBounds {
    return measureObjectSi(root);
  }

  removeSkeletonHelper(root: THREE.Object3D): void {
    const helper = this.skeletonHelpers.get(root);
    if (helper) {
      this.scene.remove(helper);
      (helper as THREE.SkeletonHelper).geometry?.dispose();
      const mat = helper.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
      this.skeletonHelpers.delete(root);
      delete root.userData.grudgeSkeletonHelper;
    }
    const labels = this.boneLabelGroups.get(root);
    if (labels) {
      disposeBoneLabelGroup(labels);
      this.boneLabelGroups.delete(root);
    }
    const bounds = this.boundsHelpers.get(root);
    if (bounds) {
      this.scene.remove(bounds);
      (bounds.material as THREE.Material)?.dispose?.();
      this.boundsHelpers.delete(root);
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
    this.unbindShiftPan();
    this.renderer.domElement.removeEventListener("pointerdown", this.onViewHelperPointer);
    this.viewHelper?.dispose();
    this.viewHelper = null;
    for (const g of this.boneLabelGroups.values()) disposeBoneLabelGroup(g);
    this.boneLabelGroups.clear();
    for (const h of this.boundsHelpers.values()) {
      this.scene.remove(h);
      (h.material as THREE.Material)?.dispose?.();
    }
    this.boundsHelpers.clear();
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

  private bindViewHelper(): void {
    this.renderer.domElement.removeEventListener("pointerdown", this.onViewHelperPointer);
    this.viewHelper?.dispose();
    this.viewHelper = new ViewHelper(this.activeCamera, this.renderer.domElement);
    this.viewHelper.setLabels("X", "Y", "Z");
    this.viewHelper.center.copy(this.controls.target);
    this.renderer.domElement.addEventListener("pointerdown", this.onViewHelperPointer);
  }

  private onViewHelperPointer = (event: PointerEvent): void => {
    if (!this.viewHelper) return;
    const handled = this.viewHelper.handleClick(event);
    if (handled) {
      event.stopPropagation();
      this.viewHelper.center.copy(this.controls.target);
    }
  };

  private bindShiftPan(): void {
    if (this.shiftPanBound) return;
    this.shiftPanBound = true;
    window.addEventListener("keydown", this.onShiftPanKey);
    window.addEventListener("keyup", this.onShiftPanKey);
    window.addEventListener("blur", this.onShiftPanBlur);
  }

  private unbindShiftPan(): void {
    if (!this.shiftPanBound) return;
    this.shiftPanBound = false;
    window.removeEventListener("keydown", this.onShiftPanKey);
    window.removeEventListener("keyup", this.onShiftPanKey);
    window.removeEventListener("blur", this.onShiftPanBlur);
  }

  private onShiftPanKey = (e: KeyboardEvent): void => {
    if (e.key !== "Shift") return;
    this.controls.mouseButtons.LEFT = e.type === "keydown" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  };

  private onShiftPanBlur = (): void => {
    this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  };

  private ensureOrtho(): void {
    if (this.orthoCam) return;
    const aspect = Math.max(0.1, this.camera.aspect);
    this.orthoCam = new THREE.OrthographicCamera(-4 * aspect, 4 * aspect, 4, -4, 0.01, 5000);
  }

  private syncOrthoFrustum(maxDim: number, paddingFactor: number): void {
    if (!this.orthoCam) return;
    const aspect = Math.max(0.1, this.camera.aspect);
    const half = Math.max(0.25, (maxDim * paddingFactor) / 2);
    this.orthoCam.left = -half * aspect;
    this.orthoCam.right = half * aspect;
    this.orthoCam.top = half;
    this.orthoCam.bottom = -half;
    this.orthoCam.near = 0.01;
    this.orthoCam.far = Math.max(100, maxDim * 40);
    this.orthoCam.updateProjectionMatrix();
  }

  private placeAxisView(kind: Exclude<StudioView, "persp">): void {
    this.ensureOrtho();
    const target = this.controls.target.clone();
    const dist = Math.max(2, this.camera.position.distanceTo(target));
    const cam = this.orthoCam!;
    if (kind === "front") cam.position.set(target.x, target.y, target.z + dist);
    else if (kind === "right") cam.position.set(target.x + dist, target.y, target.z);
    else cam.position.set(target.x, target.y + dist, target.z);
    cam.up.set(0, kind === "top" ? 0 : 1, kind === "top" ? -1 : 0);
    cam.lookAt(target);
    this.syncOrthoFrustum(dist * 0.55, 1);
  }

  private guessViewFromDir(dir: THREE.Vector3): StudioView {
    const ax = Math.abs(dir.x);
    const ay = Math.abs(dir.y);
    const az = Math.abs(dir.z);
    if (ay > ax && ay > az) return "top";
    if (ax > az) return "right";
    return "front";
  }
}
