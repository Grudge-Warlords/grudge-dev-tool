/**
 * Native Three Play runtime — kinematic TPS on SceneEngine.
 * One mixer. Orbit off while playing. No second physics engine (Rapier stays in live games).
 */

import * as THREE from "three";
import type { SceneEngine } from "./sceneEngine";
import { setPrimaryAction, type AnimLoopMode } from "./forgeAnimation";
import type { PlaySettings } from "../../../shared/playHotkeys";

export type PlayGait = "idle" | "walk" | "run" | "clip";

function clipByHint(clips: THREE.AnimationClip[], hints: string[]): THREE.AnimationClip | null {
  const lower = clips.map((c) => ({ c, n: c.name.toLowerCase() }));
  for (const h of hints) {
    const hit = lower.find((x) => x.n.includes(h));
    if (hit) return hit.c;
  }
  return null;
}

export class PlayRuntime {
  yaw = 0.4;
  pitch = -0.18;
  vy = 0;
  grounded = true;
  moving = false;
  sprinting = false;
  gait: PlayGait = "idle";
  locked = false;
  keys = new Set<string>();
  videoEl: HTMLVideoElement | null = null;
  videoMesh: THREE.Mesh | null = null;
  videoOn = true;
  private unTick: (() => void) | null = null;
  private unKey: (() => void) | null = null;
  private look = new THREE.Vector3();
  private right = new THREE.Vector3();
  private wish = new THREE.Vector3();
  private ray = new THREE.Raycaster();
  private down = new THREE.Vector3(0, -1, 0);
  private idleClip: THREE.AnimationClip | null = null;
  private walkClip: THREE.AnimationClip | null = null;
  private runClip: THREE.AnimationClip | null = null;
  private action: THREE.AnimationAction | null = null;

  constructor(
    public engine: SceneEngine,
    public player: THREE.Object3D,
    public mixer: THREE.AnimationMixer | null,
    public clips: THREE.AnimationClip[],
    public settings: PlaySettings,
  ) {
    this.idleClip = clipByHint(clips, ["idle", "stand", "wait"]);
    this.walkClip = clipByHint(clips, ["walk", "move"]);
    this.runClip = clipByHint(clips, ["run", "sprint"]);
    if (!this.idleClip && clips[0]) this.idleClip = clips[0];
  }

  start(): void {
    this.engine.setPlayDrive(true);
    this.unTick = this.engine.onTick((dt) => this.tick(dt));
    const onDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/i.test(el.tagName)) return;
      if (e.repeat) return;
      if (e.code === "Space" && this.locked) {
        e.preventDefault();
        this.jump();
      }
      this.keys.add(e.code);
    };
    const onUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    this.unKey = () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
    this.playGait("idle");
  }

  stop(): void {
    this.unlock();
    this.unTick?.();
    this.unTick = null;
    this.unKey?.();
    this.unKey = null;
    this.engine.setPlayDrive(false);
    this.disposeVideo();
  }

  lock(canvas: HTMLElement): void {
    void canvas.requestPointerLock();
    this.locked = true;
  }

  unlock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
    this.locked = false;
  }

  onMouse(dx: number, dy: number): void {
    if (!this.locked) return;
    const s = this.settings.mouseSens;
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    this.pitch = Math.max(-1.2, Math.min(0.35, this.pitch));
  }

  jump(): void {
    if (!this.grounded) return;
    this.vy = this.settings.jumpSpeed;
    this.grounded = false;
  }

  playClipIndex(i: number): string | null {
    if (i <= 0) {
      this.playGait("idle");
      return this.idleClip?.name ?? "idle";
    }
    const clip = this.clips[i - 1];
    if (!clip || !this.mixer) return null;
    this.gait = "clip";
    this.action = setPrimaryAction(this.mixer, clip, "repeat");
    return clip.name;
  }

  playGait(g: PlayGait): void {
    if (!this.mixer) return;
    const clip =
      g === "run"
        ? this.runClip || this.walkClip || this.idleClip
        : g === "walk"
          ? this.walkClip || this.idleClip
          : this.idleClip;
    if (!clip) return;
    if (this.gait === g && this.action) return;
    this.gait = g;
    const loop: AnimLoopMode = "repeat";
    this.action = setPrimaryAction(this.mixer, clip, loop);
  }

  attachVideo(src: string): void {
    this.disposeVideo();
    const video = document.createElement("video");
    video.src = src;
    video.crossOrigin = "anonymous";
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.play().catch(() => undefined);
    this.videoEl = video;
    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(3.2, 1.8);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 1.1, -4);
    mesh.name = "PlayVideoPlane";
    this.engine.scene.add(mesh);
    this.videoMesh = mesh;
    this.videoOn = true;
  }

  toggleVideo(): boolean {
    if (!this.videoMesh) return false;
    this.videoOn = !this.videoOn;
    this.videoMesh.visible = this.videoOn;
    if (this.videoEl) {
      if (this.videoOn) void this.videoEl.play().catch(() => undefined);
      else this.videoEl.pause();
    }
    return this.videoOn;
  }

  disposeVideo(): void {
    if (this.videoMesh) {
      this.engine.scene.remove(this.videoMesh);
      const mat = this.videoMesh.material as THREE.MeshBasicMaterial;
      (mat.map as THREE.VideoTexture | null)?.dispose();
      mat.dispose();
      this.videoMesh.geometry.dispose();
      this.videoMesh = null;
    }
    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.src = "";
      this.videoEl = null;
    }
  }

  private sampleGroundY(x: number, z: number, fromY: number): number {
    this.ray.set(new THREE.Vector3(x, fromY + 4, z), this.down);
    const hits = this.ray.intersectObjects(this.engine.scene.children, true);
    const hit = hits.find((h) => {
      const o = h.object;
      if (o.userData?.forgeInternal) return true;
      if ((o as THREE.Mesh).isMesh) return o !== this.videoMesh;
      return false;
    });
    return hit ? hit.point.y : 0;
  }

  tick(dt: number): void {
    this.locked = document.pointerLockElement === this.engine.renderer.domElement;
    const sprint = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    this.sprinting = sprint;
    const speed = this.settings.moveSpeed * (sprint ? this.settings.sprintMul : 1);

    this.look.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right.set(this.look.z, 0, -this.look.x);
    this.wish.set(0, 0, 0);
    if (this.keys.has("KeyW")) this.wish.add(this.look);
    if (this.keys.has("KeyS")) this.wish.sub(this.look);
    if (this.keys.has("KeyA")) this.wish.add(this.right);
    if (this.keys.has("KeyD")) this.wish.sub(this.right);
    const moving = this.wish.lengthSq() > 0.0001;
    this.moving = moving;
    if (moving) {
      this.wish.normalize();
      this.player.position.addScaledVector(this.wish, speed * dt);
      this.player.rotation.y = this.yaw;
    }

    const gy = this.sampleGroundY(this.player.position.x, this.player.position.z, this.player.position.y);
    this.vy -= this.settings.gravity * dt;
    this.player.position.y += this.vy * dt;
    if (this.player.position.y <= gy) {
      this.player.position.y = gy;
      this.vy = 0;
      this.grounded = true;
    }

    if (this.gait !== "clip") {
      const want: PlayGait = moving ? (sprint ? "run" : "walk") : "idle";
      this.playGait(want);
    }

    const eye = this.settings.eyeHeight;
    const dist = this.settings.cameraDistance;
    const cam = this.engine.camera;
    const px = this.player.position.x;
    const py = this.player.position.y + eye;
    const pz = this.player.position.z;
    const cp = Math.cos(this.pitch);
    cam.position.set(
      px - Math.sin(this.yaw) * dist * cp,
      py - Math.sin(this.pitch) * dist,
      pz - Math.cos(this.yaw) * dist * cp,
    );
    cam.lookAt(px, py, pz);
    this.engine.activeCamera = cam;
  }
}
