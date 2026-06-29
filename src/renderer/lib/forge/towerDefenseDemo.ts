/**
 * Tower Defense Demo — standalone Three.js scene for the Grudge Studio Forge.
 * Ported from GrudgeBuilder tower-wars.tsx. Self-contained: creates its own
 * renderer, scene, camera, and game loop. Call `dispose()` to tear down.
 *
 * Uses programmatic meshes (no external assets required). Targets craftpix
 * voxel tower GLBs from R2 once available — for now, towers are built from
 * simple geometry (cylinders, cones, octahedrons) with level-up gold rings.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// ── Tower definitions ─────────────────────────────────────────────────────────
const TOWER_DEFS = {
  arrow:   { name: "Arrow",   cost: 50,  dmg: 12, range: 3.5, rate: 1.2, color: 0xfbbf24 },
  magic:   { name: "Magic",   cost: 80,  dmg: 20, range: 4.0, rate: 0.8, color: 0xa78bfa },
  cannon:  { name: "Cannon",  cost: 100, dmg: 40, range: 3.0, rate: 0.5, color: 0x94a3b8 },
  fire:    { name: "Fire",    cost: 90,  dmg: 28, range: 2.5, rate: 1.0, color: 0xef4444 },
} as const;
type TowerKey = keyof typeof TOWER_DEFS;

// ── Enemy wave templates ──────────────────────────────────────────────────────
const ENEMY_TYPES = [
  { name: "Scout",   hp: 60,   speed: 2.0, size: 0.28, color: 0x86efac, reward: 15 },
  { name: "Soldier", hp: 150,  speed: 1.2, size: 0.35, color: 0xfca5a5, reward: 25 },
  { name: "Knight",  hp: 350,  speed: 0.9, size: 0.45, color: 0x93c5fd, reward: 50 },
  { name: "Giant",   hp: 700,  speed: 0.6, size: 0.60, color: 0xfcd34d, reward: 90 },
];

interface Enemy {
  mesh: THREE.Group;
  hp: number; maxHp: number; speed: number; reward: number;
  pathIdx: number; dead: boolean;
  hpBar: THREE.Mesh;
}
interface Tower {
  mesh: THREE.Group;
  type: TowerKey; gx: number; gz: number;
  range: number; rate: number; dmg: number;
  lastFired: number;
}
interface Projectile {
  mesh: THREE.Mesh;
  start: THREE.Vector3; end: THREE.Vector3;
  dmg: number; splash: number;
  born: number; duration: number;
}

const GRID_W = 16, GRID_H = 12;

export class TowerDefenseDemo {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;

  private path: THREE.Vector3[] = [];
  private towers: Tower[] = [];
  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private gold = 200;
  private wave = 0;
  private lives = 20;
  private spawnTimer = 0;
  private spawnQueue: number[] = [];

  /** Callbacks for the UI */
  onStats?: (s: { gold: number; wave: number; lives: number; enemies: number }) => void;

  constructor(private container: HTMLElement) {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);

    this.camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 500);
    this.camera.position.set(GRID_W / 2, 14, GRID_H + 6);
    this.camera.lookAt(GRID_W / 2, 0, GRID_H / 2);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(GRID_W / 2, 0, GRID_H / 2);

    // Lighting
    this.scene.background = new THREE.Color(0x0c1024);
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
    sun.position.set(8, 12, 6); sun.castShadow = true;
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0x667799, 0.5));

    this.buildMap();
    this.startWave();
    this.tick();

    window.addEventListener("resize", this.onResize);
  }

  // ── Map ───────────────────────────────────────────────────────────────────
  private buildMap() {
    // Ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GRID_W + 2, GRID_H + 2),
      new THREE.MeshLambertMaterial({ color: 0x1a2744 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(GRID_W / 2, -0.01, GRID_H / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Generate path (left to right with random bends)
    let x = 0, z = Math.floor(GRID_H / 2);
    this.path.push(new THREE.Vector3(x, 0, z));
    const visited = new Set<string>();
    visited.add(`${x},${z}`);
    while (x < GRID_W - 1) {
      if (Math.random() < 0.6) { x++; }
      else { z = Math.max(1, Math.min(GRID_H - 2, z + (Math.random() < 0.5 ? 1 : -1))); }
      const key = `${x},${z}`;
      if (!visited.has(key)) {
        this.path.push(new THREE.Vector3(x, 0, z));
        visited.add(key);
      } else { x = Math.min(GRID_W - 1, x + 1); this.path.push(new THREE.Vector3(x, 0, z)); }
    }

    // Draw path tiles
    for (const p of this.path) {
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 0.05, 0.95),
        new THREE.MeshLambertMaterial({ color: 0x2a3a5c }),
      );
      tile.position.set(p.x + 0.5, 0.025, p.z + 0.5);
      this.scene.add(tile);
    }

    // Auto-place towers on non-path cells near the path
    const pathSet = new Set(this.path.map(p => `${p.x},${p.z}`));
    const towerKeys = Object.keys(TOWER_DEFS) as TowerKey[];
    let placed = 0;
    for (let gx = 0; gx < GRID_W && placed < 8; gx++) {
      for (let gz = 0; gz < GRID_H && placed < 8; gz++) {
        if (pathSet.has(`${gx},${gz}`)) continue;
        // Only near the path
        const nearPath = this.path.some(p => Math.abs(p.x - gx) <= 1 && Math.abs(p.z - gz) <= 1);
        if (!nearPath) continue;
        if (Math.random() > 0.35) continue;
        const tk = towerKeys[placed % towerKeys.length];
        this.placeTower(tk, gx, gz);
        placed++;
      }
    }
  }

  placeTower(type: TowerKey, gx: number, gz: number) {
    const def = TOWER_DEFS[type];
    if (this.gold < def.cost) return;
    this.gold -= def.cost;

    const group = new THREE.Group();
    const h = 1.2;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.34, h, 8),
      new THREE.MeshLambertMaterial({ color: def.color }),
    );
    body.position.y = h / 2; body.castShadow = true;
    group.add(body);
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.42, 6),
      new THREE.MeshLambertMaterial({ color: def.color }),
    );
    cap.position.y = h + 0.2; group.add(cap);
    // Range ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(def.range - 0.05, def.range + 0.05, 24),
      new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.1, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
    group.add(ring);

    group.position.set(gx + 0.5, 0, gz + 0.5);
    this.scene.add(group);
    this.towers.push({ mesh: group, type, gx, gz, range: def.range, rate: def.rate, dmg: def.dmg, lastFired: 0 });
  }

  // ── Waves ─────────────────────────────────────────────────────────────────
  private startWave() {
    this.wave++;
    const typeIdx = Math.min(this.wave - 1, ENEMY_TYPES.length - 1);
    const count = 4 + this.wave * 2;
    this.spawnQueue = Array.from({ length: count }, () => typeIdx);
    this.spawnTimer = 0;
  }

  private spawnEnemy(typeIdx: number) {
    const def = ENEMY_TYPES[typeIdx];
    const group = new THREE.Group();
    const s = def.size;
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(s * 0.48, s * 0.7, 4, 8),
      new THREE.MeshLambertMaterial({ color: def.color }),
    );
    body.position.y = s * 0.85; body.castShadow = true; group.add(body);
    // HP bar
    const hpBar = new THREE.Mesh(
      new THREE.PlaneGeometry(s * 1.5, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x22c55e, side: THREE.DoubleSide }),
    );
    hpBar.position.set(0, s * 2.1, 0); group.add(hpBar);

    const start = this.path[0];
    group.position.set(start.x + 0.5, 0, start.z + 0.5);
    this.scene.add(group);
    const hp = def.hp * (1 + this.wave * 0.15);
    this.enemies.push({ mesh: group, hp, maxHp: hp, speed: def.speed, reward: def.reward, pathIdx: 0, dead: false, hpBar });
  }

  // ── Game tick ─────────────────────────────────────────────────────────────
  private tick = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = this.clock.getDelta();

    // Spawn
    if (this.spawnQueue.length > 0) {
      this.spawnTimer += dt;
      if (this.spawnTimer >= 0.6) {
        this.spawnTimer = 0;
        this.spawnEnemy(this.spawnQueue.shift()!);
      }
    } else if (this.enemies.every(e => e.dead) && this.lives > 0) {
      this.startWave();
    }

    // Move enemies
    for (const e of this.enemies) {
      if (e.dead) continue;
      const target = this.path[e.pathIdx + 1];
      if (!target) { e.dead = true; this.lives--; this.scene.remove(e.mesh); continue; }
      const tx = target.x + 0.5, tz = target.z + 0.5;
      const dx = tx - e.mesh.position.x, dz = tz - e.mesh.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const step = e.speed * dt;
      if (dist <= step) { e.mesh.position.set(tx, 0, tz); e.pathIdx++; }
      else { e.mesh.position.x += (dx / dist) * step; e.mesh.position.z += (dz / dist) * step; }
      // HP bar
      const ratio = Math.max(0, e.hp / e.maxHp);
      e.hpBar.scale.x = ratio;
    }

    // Tower targeting + firing
    const now = performance.now();
    for (const t of this.towers) {
      const cooldown = 1000 / t.rate;
      if (now - t.lastFired < cooldown) continue;
      // Find closest enemy in range
      let best: Enemy | null = null, bestDist = Infinity;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const dx = e.mesh.position.x - t.mesh.position.x;
        const dz = e.mesh.position.z - t.mesh.position.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d <= t.range && d < bestDist) { best = e; bestDist = d; }
      }
      if (!best) continue;
      t.lastFired = now;
      // Spawn projectile
      const proj = new THREE.Mesh(
        new THREE.SphereGeometry(0.08), new THREE.MeshBasicMaterial({ color: TOWER_DEFS[t.type].color }),
      );
      proj.position.copy(t.mesh.position).setY(1);
      this.scene.add(proj);
      this.projectiles.push({
        mesh: proj,
        start: proj.position.clone(),
        end: best.mesh.position.clone().setY(0.5),
        dmg: t.dmg, splash: 0, born: now, duration: 300,
      });
    }

    // Move projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const t = Math.min(1, (now - p.born) / p.duration);
      p.mesh.position.lerpVectors(p.start, p.end, t);
      if (t >= 1) {
        // Impact — damage nearest enemy
        for (const e of this.enemies) {
          if (e.dead) continue;
          const dx = e.mesh.position.x - p.end.x, dz = e.mesh.position.z - p.end.z;
          if (Math.sqrt(dx * dx + dz * dz) < 0.8) {
            e.hp -= p.dmg;
            if (e.hp <= 0) { e.dead = true; this.gold += e.reward; this.scene.remove(e.mesh); }
            break;
          }
        }
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    this.onStats?.({
      gold: this.gold, wave: this.wave, lives: this.lives,
      enemies: this.enemies.filter(e => !e.dead).length,
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
    window.removeEventListener("resize", this.onResize);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
