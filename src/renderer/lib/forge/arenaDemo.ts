/**
 * Arena Skirmish Demo — third-person combat sandbox for Forge play modes.
 * WASD move, mouse look (drag), Space / click to strike. Dummy enemies spawn in waves.
 */
import * as THREE from "three";

const ARENA_R = 18;
const PLAYER_SPEED = 8;
const ATTACK_RANGE = 2.4;
const ATTACK_CD = 0.45;
const ATTACK_DAMAGE = 35;

interface Dummy {
  mesh: THREE.Group;
  hp: number;
  maxHp: number;
  hpBar: THREE.Mesh;
  dead: boolean;
  hitFlash: number;
}

export class ArenaDemo {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;

  private player: THREE.Group;
  private dummies: Dummy[] = [];
  private keys = { w: false, a: false, s: false, d: false };
  private yaw = 0;
  private pitch = 0.35;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private attackCd = 0;
  private wave = 0;
  private kills = 0;
  private slashMesh: THREE.Mesh | null = null;
  private slashT = 0;

  onStats?: (s: { hp: number; kills: number; wave: number; enemies: number }) => void;
  private playerHp = 100;

  constructor(private container: HTMLElement) {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);

    this.camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 200);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0a0c14);
    this.scene.fog = new THREE.Fog(0x0a0c14, 25, 70);

    const sun = new THREE.DirectionalLight(0xffe8c8, 1.3);
    sun.position.set(12, 22, 8);
    sun.castShadow = true;
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0x556688, 0.55));
    this.scene.add(new THREE.HemisphereLight(0x8899bb, 0x223344, 0.35));

    this.buildArena();
    this.player = this.buildFighter(0xfbbf24);
    this.player.position.set(0, 0, 4);
    this.scene.add(this.player);

    const slashGeo = new THREE.RingGeometry(0.6, 1.4, 16, 1, 0, Math.PI * 0.7);
    this.slashMesh = new THREE.Mesh(
      slashGeo,
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    this.slashMesh.rotation.x = -Math.PI / 2;
    this.slashMesh.visible = false;
    this.scene.add(this.slashMesh);

    this.startWave();

    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);
    window.addEventListener("resize", this.onResize);
    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.addEventListener("click", this.onClick);

    this.tick();
  }

  private buildArena() {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA_R, 48),
      new THREE.MeshLambertMaterial({ color: 0x1a2438 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(ARENA_R - 0.2, 0.18, 8, 64),
      new THREE.MeshLambertMaterial({ color: 0xc9a227 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.15;
    this.scene.add(ring);

    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.45, 3.2, 8),
        new THREE.MeshLambertMaterial({ color: 0x2a3548 }),
      );
      pillar.position.set(Math.cos(a) * (ARENA_R - 1.2), 1.6, Math.sin(a) * (ARENA_R - 1.2));
      pillar.castShadow = true;
      this.scene.add(pillar);
    }
  }

  private buildFighter(color: number): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 0.7, 4, 8),
      new THREE.MeshLambertMaterial({ color }),
    );
    body.position.y = 0.85;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 10),
      new THREE.MeshLambertMaterial({ color: 0xf5d0a9 }),
    );
    head.position.y = 1.55;
    g.add(head);
    return g;
  }

  private startWave() {
    this.wave++;
    const count = 2 + this.wave;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const r = 6 + Math.random() * 6;
      this.spawnDummy(Math.cos(a) * r, Math.sin(a) * r);
    }
  }

  private spawnDummy(x: number, z: number) {
    const mesh = this.buildFighter(0xef4444);
    mesh.position.set(x, 0, z);
    const hpBar = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x22c55e, side: THREE.DoubleSide }),
    );
    hpBar.position.set(0, 2.0, 0);
    mesh.add(hpBar);
    this.scene.add(mesh);
    const maxHp = 80 + this.wave * 15;
    this.dummies.push({ mesh, hp: maxHp, maxHp, hpBar, dead: false, hitFlash: 0 });
  }

  private tryAttack() {
    if (this.attackCd > 0) return;
    this.attackCd = ATTACK_CD;
    const px = this.player.position.x;
    const pz = this.player.position.z;
    const facing = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));

    if (this.slashMesh) {
      this.slashMesh.position.set(px + facing.x * 1.1, 0.9, pz + facing.z * 1.1);
      this.slashMesh.rotation.z = this.yaw;
      this.slashMesh.visible = true;
      this.slashT = 0.2;
      (this.slashMesh.material as THREE.MeshBasicMaterial).opacity = 0.85;
    }

    for (const d of this.dummies) {
      if (d.dead) continue;
      const dx = d.mesh.position.x - px;
      const dz = d.mesh.position.z - pz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > ATTACK_RANGE) continue;
      const toEnemy = new THREE.Vector3(dx, 0, dz).normalize();
      if (facing.dot(toEnemy) < 0.15 && dist > 1.0) continue;
      d.hp -= ATTACK_DAMAGE;
      d.hitFlash = 0.15;
      if (d.hp <= 0) {
        d.dead = true;
        this.kills++;
        this.scene.remove(d.mesh);
      } else {
        d.hpBar.scale.x = Math.max(0.05, d.hp / d.maxHp);
      }
    }
  }

  private onKey = (e: KeyboardEvent) => {
    const down = e.type === "keydown";
    const k = e.key.toLowerCase();
    if (k === "w") this.keys.w = down;
    if (k === "a") this.keys.a = down;
    if (k === "s") this.keys.s = down;
    if (k === "d") this.keys.d = down;
    if (down && (k === " " || k === "f")) {
      e.preventDefault();
      this.tryAttack();
    }
  };

  private onPointerDown = (e: PointerEvent) => {
    if (e.button === 2 || e.button === 1 || e.shiftKey) {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
  };
  private onPointerUp = () => { this.dragging = false; };
  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.yaw -= dx * 0.005;
    this.pitch = Math.max(0.15, Math.min(1.2, this.pitch + dy * 0.004));
  };
  private onClick = (e: MouseEvent) => {
    if (e.button === 0 && !e.shiftKey) this.tryAttack();
  };

  private tick = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.attackCd = Math.max(0, this.attackCd - dt);

    if (this.slashMesh && this.slashT > 0) {
      this.slashT -= dt;
      (this.slashMesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, this.slashT / 0.2);
      if (this.slashT <= 0) this.slashMesh.visible = false;
    }

    // Player move relative to camera yaw
    const input = new THREE.Vector3(
      (this.keys.d ? 1 : 0) - (this.keys.a ? 1 : 0),
      0,
      (this.keys.s ? 1 : 0) - (this.keys.w ? 1 : 0),
    );
    if (input.lengthSq() > 0) {
      input.normalize();
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      const mx = input.x * cos - input.z * sin;
      const mz = input.x * sin + input.z * cos;
      this.player.position.x += mx * PLAYER_SPEED * dt;
      this.player.position.z += mz * PLAYER_SPEED * dt;
      this.player.rotation.y = Math.atan2(mx, mz);
    }

    // Clamp to arena
    const pr = Math.hypot(this.player.position.x, this.player.position.z);
    if (pr > ARENA_R - 1) {
      this.player.position.x *= (ARENA_R - 1) / pr;
      this.player.position.z *= (ARENA_R - 1) / pr;
    }

    // Dummies chase + touch damage
    for (const d of this.dummies) {
      if (d.dead) continue;
      if (d.hitFlash > 0) d.hitFlash -= dt;
      const dx = this.player.position.x - d.mesh.position.x;
      const dz = this.player.position.z - d.mesh.position.z;
      const dist = Math.hypot(dx, dz) || 1;
      const speed = 2.2 + this.wave * 0.15;
      if (dist > 1.1) {
        d.mesh.position.x += (dx / dist) * speed * dt;
        d.mesh.position.z += (dz / dist) * speed * dt;
      } else {
        this.playerHp = Math.max(0, this.playerHp - 12 * dt);
      }
      d.mesh.lookAt(this.player.position.x, 0, this.player.position.z);
      d.hpBar.lookAt(this.camera.position);
    }

    if (this.dummies.every((d) => d.dead) && this.playerHp > 0) {
      this.startWave();
    }

    // Camera over-shoulder
    const camDist = 7;
    const camH = 3.2;
    const cx = this.player.position.x + Math.sin(this.yaw) * camDist;
    const cz = this.player.position.z + Math.cos(this.yaw) * camDist;
    const cy = this.player.position.y + camH + Math.sin(this.pitch) * 2;
    this.camera.position.lerp(new THREE.Vector3(cx, cy, cz), 1 - Math.exp(-8 * dt));
    this.camera.lookAt(this.player.position.x, 1.2, this.player.position.z);

    this.renderer.render(this.scene, this.camera);
    this.onStats?.({
      hp: Math.round(this.playerHp),
      kills: this.kills,
      wave: this.wave,
      enemies: this.dummies.filter((d) => !d.dead).length,
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
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.removeEventListener("click", this.onClick);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
