/**
 * Rapier physics preview for Forge Studio — Three.js sync (ported from grudge-engine-web / grudge-builder patterns).
 */
import * as THREE from "three";

type RapierModule = typeof import("@dimforge/rapier3d-compat");

let rapierMod: RapierModule | null = null;
let initPromise: Promise<void> | null = null;

export async function initForgeRapier(): Promise<boolean> {
  if (rapierMod) return true;
  if (initPromise) {
    await initPromise;
    return rapierMod != null;
  }
  initPromise = (async () => {
    try {
      const RAPIER = await import("@dimforge/rapier3d-compat");
      await RAPIER.init();
      rapierMod = RAPIER;
    } catch (e) {
      console.warn("[ForgeRapier] init failed", e);
      rapierMod = null;
    }
  })();
  await initPromise;
  return rapierMod != null;
}

export interface PhysicsBodyEntry {
  id: string;
  mesh: THREE.Object3D;
  body: InstanceType<RapierModule["RigidBody"]>;
}

export class ForgeRapierWorld {
  private world: InstanceType<RapierModule["World"]> | null = null;
  private bodies = new Map<string, PhysicsBodyEntry>();
  private playing = false;
  private accumulator = 0;
  private readonly fixedDt = 1 / 60;

  get isReady(): boolean {
    return this.world != null;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  async init(gravity = { x: 0, y: -9.81, z: 0 }): Promise<boolean> {
    const ok = await initForgeRapier();
    if (!ok || !rapierMod) return false;
    this.world = new rapierMod.World(new rapierMod.Vector3(gravity.x, gravity.y, gravity.z));
    return true;
  }

  addGround(size = 40): void {
    if (!this.world || !rapierMod) return;
    const body = this.world.createRigidBody(rapierMod.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0));
    this.world.createCollider(
      rapierMod.ColliderDesc.cuboid(size / 2, 0.05, size / 2).setFriction(0.8),
      body,
    );
  }

  addDynamicFromObject(id: string, object: THREE.Object3D, mass = 1): void {
    if (!this.world || !rapierMod) return;
    this.removeBody(id);

    const box = new THREE.Box3().setFromObject(object);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const worldPos = new THREE.Vector3();
    object.getWorldPosition(worldPos);

    const body = this.world.createRigidBody(
      rapierMod.RigidBodyDesc.dynamic()
        .setTranslation(worldPos.x, worldPos.y, worldPos.z)
        .setLinearDamping(0.1)
        .setAngularDamping(0.2),
    );
    const he = new rapierMod.Vector3(
      Math.max(size.x / 2, 0.05),
      Math.max(size.y / 2, 0.05),
      Math.max(size.z / 2, 0.05),
    );
    const collider = rapierMod.ColliderDesc.cuboid(he.x, he.y, he.z).setDensity(mass);
    this.world.createCollider(collider, body);

    this.bodies.set(id, { id, mesh: object, body });
  }

  removeBody(id: string): void {
    const entry = this.bodies.get(id);
    if (!entry || !this.world) return;
    this.world.removeRigidBody(entry.body);
    this.bodies.delete(id);
  }

  clearBodies(): void {
    for (const id of [...this.bodies.keys()]) this.removeBody(id);
  }

  play(): void {
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  reset(): void {
    this.playing = false;
    this.accumulator = 0;
    if (!this.world) return;
    for (const entry of this.bodies.values()) {
      const t = entry.body.translation();
      entry.mesh.position.set(t.x, t.y, t.z);
      const r = entry.body.rotation();
      entry.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      entry.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  step(dt: number): void {
    if (!this.playing || !this.world) return;
    this.accumulator += dt;
    while (this.accumulator >= this.fixedDt) {
      this.world.step();
      this.syncMeshes();
      this.accumulator -= this.fixedDt;
    }
  }

  private syncMeshes(): void {
    for (const entry of this.bodies.values()) {
      const t = entry.body.translation();
      const r = entry.body.rotation();
      entry.mesh.position.set(t.x, t.y, t.z);
      entry.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  dispose(): void {
    this.clearBodies();
    this.world?.free();
    this.world = null;
    this.playing = false;
  }
}