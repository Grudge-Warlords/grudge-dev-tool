/**
 * MultiCanvasHub — one WebGLRenderer → many asset-viewer canvases.
 *
 * Pattern from three.js multi-canvas examples
 * (webgpu_multiple_canvas / webgl_multiple_elements):
 *   - Single GPU context (avoids N WebGL contexts = black/yellow thrash)
 *   - Per-view scene + camera + OrbitControls bound to the *display* canvas
 *   - Each frame: render → blit WebGL buffer into the view's 2D canvas
 *   - Skip off-screen views (IntersectionObserver)
 *
 * Use for grid / panel Model3DViewer previews.
 * Full pop-out ViewerWindow still uses dedicated SceneEngine (interactive tools).
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export type MultiCanvasQuality = "low" | "medium" | "high";

export interface MultiCanvasViewOpts {
  /** Quality budget for this slot (default medium) */
  quality?: MultiCanvasQuality;
  background?: number;
  showGrid?: boolean;
  hdri?: boolean;
}

export interface MultiCanvasView {
  id: string;
  /** Visible 2D canvas in the DOM */
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  root: THREE.Object3D | null;
  mixers: THREE.AnimationMixer[];
  timeScale: number;
  visible: boolean;
  disposed: boolean;
}

const QUALITY: Record<
  MultiCanvasQuality,
  { dpr: number; shadow: boolean; grid: boolean }
> = {
  low: { dpr: 1, shadow: false, grid: false },
  medium: { dpr: 1.25, shadow: true, grid: true },
  high: { dpr: 1.5, shadow: true, grid: true },
};

let hubSingleton: MultiCanvasHub | null = null;

export function getMultiCanvasHub(): MultiCanvasHub {
  if (!hubSingleton) hubSingleton = new MultiCanvasHub();
  return hubSingleton;
}

export class MultiCanvasHub {
  /** Hidden WebGL surface — never attached to React trees */
  private readonly glCanvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  private readonly pmrem: THREE.PMREMGenerator;
  private envMap: THREE.Texture | null = null;
  private views = new Map<string, MultiCanvasView>();
  private raf = 0;
  private clock = new THREE.Clock();
  private running = false;
  private nextId = 1;
  private io: IntersectionObserver | null = null;

  constructor() {
    this.glCanvas = document.createElement("canvas");
    this.glCanvas.width = 4;
    this.glCanvas.height = 4;
    this.glCanvas.style.cssText = "position:fixed;left:-9999px;top:0;width:4px;height:4px;opacity:0;pointer-events:none";
    document.body.appendChild(this.glCanvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.glCanvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true, // required for 2D blit + screenshots
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    try {
      this.envMap = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    } catch {
      this.envMap = null;
    }

    if (typeof IntersectionObserver !== "undefined") {
      this.io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const id = (e.target as HTMLElement).dataset.mcViewId;
            if (!id) continue;
            const v = this.views.get(id);
            if (v) v.visible = e.isIntersecting && e.intersectionRatio > 0.02;
          }
        },
        { root: null, threshold: [0, 0.02, 0.1] },
      );
    }
  }

  /** Register a display canvas; returns view handle. */
  createView(displayCanvas: HTMLCanvasElement, opts: MultiCanvasViewOpts = {}): MultiCanvasView {
    const id = `mcv_${this.nextId++}`;
    displayCanvas.dataset.mcViewId = id;
    // CSS size owns layout; buffer size set each frame
    if (!displayCanvas.style.width) displayCanvas.style.width = "100%";
    if (!displayCanvas.style.height) displayCanvas.style.height = "100%";
    displayCanvas.style.display = "block";
    displayCanvas.style.touchAction = "none";

    const q = QUALITY[opts.quality ?? "medium"];
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(opts.background ?? 0x0a0e1a);
    if (opts.hdri !== false && this.envMap) {
      scene.environment = this.envMap;
    }

    // Studio lights (shared recipe with SceneEngine)
    const key = new THREE.DirectionalLight(0xfff1d6, 1.35);
    key.position.set(5, 8, 4);
    key.castShadow = q.shadow;
    if (q.shadow) {
      key.shadow.mapSize.set(512, 512);
      key.shadow.camera.near = 0.1;
      key.shadow.camera.far = 40;
      const s = 8;
      key.shadow.camera.left = -s;
      key.shadow.camera.right = s;
      key.shadow.camera.top = s;
      key.shadow.camera.bottom = -s;
    }
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.45);
    fill.position.set(-4, 3, -2);
    scene.add(fill);
    scene.add(new THREE.AmbientLight(0xffffff, 0.28));

    if (opts.showGrid !== false && q.grid) {
      const grid = new THREE.GridHelper(12, 12, 0xffc62a, 0x1c2a55);
      (grid.material as THREE.Material).transparent = true;
      (grid.material as THREE.Material).opacity = 0.55;
      scene.add(grid);
    }

    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 2000);
    camera.position.set(2.4, 1.8, 3.2);
    camera.lookAt(0, 0.4, 0);

    // Controls on the *display* canvas (pointer events), not the hidden GL canvas
    const controls = new OrbitControls(camera, displayCanvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.target.set(0, 0.4, 0);

    const view: MultiCanvasView = {
      id,
      canvas: displayCanvas,
      scene,
      camera,
      controls,
      root: null,
      mixers: [],
      timeScale: 1,
      visible: true,
      disposed: false,
    };
    this.views.set(id, view);
    this.io?.observe(displayCanvas);
    this.ensureLoop();
    return view;
  }

  setRoot(view: MultiCanvasView, root: THREE.Object3D | null): void {
    if (view.disposed) return;
    if (view.root) {
      view.scene.remove(view.root);
    }
    view.root = root;
    if (root) {
      root.traverse((n) => {
        const m = n as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
        const sm = n as THREE.SkinnedMesh;
        if (sm.isSkinnedMesh) sm.frustumCulled = false;
      });
      view.scene.add(root);
      this.frame(view, root);
    }
  }

  frame(view: MultiCanvasView, object: THREE.Object3D, pad = 1.4): void {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z, 0.05);
    const fov = THREE.MathUtils.degToRad(view.camera.fov);
    const dist = (maxDim / (2 * Math.tan(fov / 2))) * pad;
    const dir = new THREE.Vector3(1, 0.65, 1).normalize();
    view.camera.position.copy(center).addScaledVector(dir, dist);
    view.camera.near = Math.max(0.001, maxDim / 400);
    view.camera.far = Math.max(50, dist * 12 + maxDim * 8);
    view.camera.updateProjectionMatrix();
    view.controls.target.copy(center);
    view.controls.update();
  }

  disposeView(view: MultiCanvasView): void {
    if (view.disposed) return;
    view.disposed = true;
    this.io?.unobserve(view.canvas);
    view.controls.dispose();
    for (const m of view.mixers) {
      m.stopAllAction();
    }
    view.mixers.length = 0;
    if (view.root) {
      view.scene.remove(view.root);
      disposeObjectTree(view.root);
      view.root = null;
    }
    // dispose lights/grid in scene
    view.scene.traverse((n) => {
      const mesh = n as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
        else mat?.dispose();
      }
    });
    this.views.delete(view.id);
    if (this.views.size === 0) this.stopLoop();
  }

  private ensureLoop(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const tick = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      this.renderAll();
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private renderAll(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    for (const view of this.views.values()) {
      if (view.disposed || !view.visible) continue;
      try {
        this.renderView(view, dt);
      } catch (e) {
        // One view must not kill the hub
        if (!(view as unknown as { _errLogged?: boolean })._errLogged) {
          console.warn("[MultiCanvasHub] view render fail", view.id, e);
          (view as unknown as { _errLogged?: boolean })._errLogged = true;
        }
      }
    }
  }

  private renderView(view: MultiCanvasView, dt: number): void {
    const rect = view.canvas.getBoundingClientRect();
    const cssW = Math.max(2, Math.floor(rect.width));
    const cssH = Math.max(2, Math.floor(rect.height));
    if (cssW < 2 || cssH < 2) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const bw = Math.max(2, Math.floor(cssW * dpr));
    const bh = Math.max(2, Math.floor(cssH * dpr));

    if (view.canvas.width !== bw || view.canvas.height !== bh) {
      view.canvas.width = bw;
      view.canvas.height = bh;
    }

    for (const m of view.mixers) m.update(dt * view.timeScale);
    view.controls.update();
    view.camera.aspect = cssW / cssH;
    view.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(1); // we already scaled buffer
    this.renderer.setSize(bw, bh, false);
    this.renderer.setClearColor(
      view.scene.background instanceof THREE.Color
        ? view.scene.background
        : new THREE.Color(0x0a0e1a),
      1,
    );
    this.renderer.render(view.scene, view.camera);

    const ctx = view.canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bw, bh);
    // Blit WebGL → display canvas (multi-canvas present)
    ctx.drawImage(this.renderer.domElement, 0, 0, bw, bh);
  }

  /** Tear down entire hub (app shutdown). */
  dispose(): void {
    this.stopLoop();
    for (const v of [...this.views.values()]) this.disposeView(v);
    this.envMap?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
    this.glCanvas.remove();
    this.io?.disconnect();
    if (hubSingleton === this) hubSingleton = null;
  }
}

function disposeObjectTree(root: THREE.Object3D): void {
  root.traverse((node) => {
    const m = node as THREE.Mesh;
    if (m.isMesh) {
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
      else mat?.dispose();
    }
  });
}
