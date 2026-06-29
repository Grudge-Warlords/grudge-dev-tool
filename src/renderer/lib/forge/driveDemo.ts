/**
 * Grudge Drive Demo — minimal 3D racing/mount track for Grudge Studio Forge.
 * Demonstrates the over-shoulder camera, WASD vehicle movement, and basic
 * track geometry. Self-contained Three.js scene. Call `dispose()` to tear down.
 */
import * as THREE from "three";

const TRACK_RADIUS = 30;
const TRACK_WIDTH = 8;
const VEHICLE_SPEED = 12;
const TURN_SPEED = 2.5;
const CAM_OFFSET = new THREE.Vector3(0, 5, 10);

export class DriveDemo {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;

  private vehicle: THREE.Group;
  private velocity = 0;
  private heading = 0; // radians
  private keys = { w: false, a: false, s: false, d: false, shift: false };
  private lap = 0;
  private lastCheckZ = 0;

  onStats?: (s: { speed: number; lap: number }) => void;

  constructor(private container: HTMLElement) {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);

    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 500);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    // Scene
    this.scene.background = new THREE.Color(0x080e1e);
    this.scene.fog = new THREE.Fog(0x080e1e, 40, 120);

    // Lighting
    const sun = new THREE.DirectionalLight(0xffe8c8, 1.4);
    sun.position.set(20, 30, 10); sun.castShadow = true;
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0x445577, 0.6));

    this.buildTrack();
    this.vehicle = this.buildVehicle();
    this.vehicle.position.set(TRACK_RADIUS, 0.3, 0);
    this.scene.add(this.vehicle);

    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);
    window.addEventListener("resize", this.onResize);
    this.tick();
  }

  // ── Track ─────────────────────────────────────────────────────────────────
  private buildTrack() {
    // Ground plane
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshLambertMaterial({ color: 0x142030 }),
    );
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    this.scene.add(ground);

    // Oval track (torus-like ring)
    const segments = 64;
    const shape = new THREE.Shape();
    shape.moveTo(-TRACK_WIDTH / 2, -0.02);
    shape.lineTo(TRACK_WIDTH / 2, -0.02);
    shape.lineTo(TRACK_WIDTH / 2, 0.02);
    shape.lineTo(-TRACK_WIDTH / 2, 0.02);
    shape.closePath();

    const curve = new THREE.CatmullRomCurve3(
      Array.from({ length: segments }, (_, i) => {
        const a = (i / segments) * Math.PI * 2;
        return new THREE.Vector3(
          Math.cos(a) * TRACK_RADIUS,
          0.01,
          Math.sin(a) * TRACK_RADIUS,
        );
      }),
      true,
    );

    const trackGeo = new THREE.TubeGeometry(curve, segments, TRACK_WIDTH / 2, 4, true);
    const track = new THREE.Mesh(
      trackGeo,
      new THREE.MeshLambertMaterial({ color: 0x2a3a5c }),
    );
    track.receiveShadow = true;
    this.scene.add(track);

    // Track border markers
    for (let i = 0; i < segments; i += 4) {
      const a = (i / segments) * Math.PI * 2;
      for (const side of [-1, 1]) {
        const marker = new THREE.Mesh(
          new THREE.BoxGeometry(0.3, 0.6, 0.3),
          new THREE.MeshLambertMaterial({ color: i % 8 === 0 ? 0xfbbf24 : 0xef4444 }),
        );
        marker.position.set(
          Math.cos(a) * (TRACK_RADIUS + side * (TRACK_WIDTH / 2 + 0.3)),
          0.3,
          Math.sin(a) * (TRACK_RADIUS + side * (TRACK_WIDTH / 2 + 0.3)),
        );
        marker.castShadow = true;
        this.scene.add(marker);
      }
    }

    // Scenery trees around the track
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = TRACK_RADIUS + (Math.random() > 0.5 ? 1 : -1) * (TRACK_WIDTH / 2 + 3 + Math.random() * 15);
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.2, 1.5, 5),
        new THREE.MeshLambertMaterial({ color: 0x5c3a1e }),
      );
      trunk.position.y = 0.75; tree.add(trunk);
      const crown = new THREE.Mesh(
        new THREE.ConeGeometry(0.8 + Math.random() * 0.4, 2 + Math.random(), 6),
        new THREE.MeshLambertMaterial({ color: 0x1a5c2a }),
      );
      crown.position.y = 2.2; tree.add(crown);
      tree.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      tree.castShadow = true;
      this.scene.add(tree);
    }
  }

  // ── Vehicle ───────────────────────────────────────────────────────────────
  private buildVehicle(): THREE.Group {
    const group = new THREE.Group();
    // Body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.5, 2.4),
      new THREE.MeshLambertMaterial({ color: 0xfbbf24 }),
    );
    body.position.y = 0.4; body.castShadow = true; group.add(body);
    // Cabin
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.4, 1.2),
      new THREE.MeshLambertMaterial({ color: 0x334155 }),
    );
    cabin.position.set(0, 0.7, -0.2); group.add(cabin);
    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.15, 8);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1e1e1e });
    for (const [x, z] of [[-0.65, 0.7], [0.65, 0.7], [-0.65, -0.7], [0.65, -0.7]]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.25, z);
      group.add(wheel);
    }
    return group;
  }

  // ── Input ─────────────────────────────────────────────────────────────────
  private onKey = (e: KeyboardEvent) => {
    const down = e.type === "keydown";
    const k = e.key.toLowerCase();
    if (k === "w") this.keys.w = down;
    if (k === "a") this.keys.a = down;
    if (k === "s") this.keys.s = down;
    if (k === "d") this.keys.d = down;
    if (k === "shift") this.keys.shift = down;
  };

  // ── Game tick ─────────────────────────────────────────────────────────────
  private tick = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = this.clock.getDelta();

    // Acceleration
    const boost = this.keys.shift ? 1.6 : 1.0;
    if (this.keys.w) this.velocity = Math.min(VEHICLE_SPEED * boost, this.velocity + 15 * dt);
    else if (this.keys.s) this.velocity = Math.max(-VEHICLE_SPEED * 0.4, this.velocity - 12 * dt);
    else this.velocity *= 0.97; // friction

    // Steering (only at speed)
    if (Math.abs(this.velocity) > 0.5) {
      if (this.keys.a) this.heading += TURN_SPEED * dt * Math.sign(this.velocity);
      if (this.keys.d) this.heading -= TURN_SPEED * dt * Math.sign(this.velocity);
    }

    // Move vehicle
    const fwd = new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    this.vehicle.position.addScaledVector(fwd, this.velocity * dt);
    this.vehicle.rotation.y = this.heading;

    // Lap detection (crossing z=0 going forward from positive z)
    if (this.lastCheckZ > 0 && this.vehicle.position.z <= 0 && this.vehicle.position.x > TRACK_RADIUS * 0.5) {
      this.lap++;
    }
    this.lastCheckZ = this.vehicle.position.z;

    // Over-shoulder camera
    const camTarget = this.vehicle.position.clone();
    const camPos = camTarget.clone().add(
      CAM_OFFSET.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.heading),
    );
    this.camera.position.lerp(camPos, 5 * dt);
    this.camera.lookAt(camTarget.x, camTarget.y + 1, camTarget.z);

    this.renderer.render(this.scene, this.camera);

    this.onStats?.({
      speed: Math.round(Math.abs(this.velocity) * 3.6), // km/h-ish
      lap: this.lap,
    });
  };

  private onResize = () => {
    if (this.disposed) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKey);
    window.removeEventListener("resize", this.onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
