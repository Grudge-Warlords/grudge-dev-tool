/**
 * ThreeFlow inside Dev Tool — live https://threeflow.vercel.app
 * Core scene editor plus a terrain starter that preserves the live editor handoff.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
 Box,
 Bug,
 ExternalLink,
 Eye,
 Hammer,
 Keyboard,
 Mountain,
 RefreshCw,
 Waves,
} from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { toast } from "sonner";
import { FLEET_URLS } from "../../shared/fleet";
import { asWebview, attachWebviewSession, embedUrlWithSession } from "../lib/webviewSession";

interface WebviewEl extends HTMLElement {
 src: string;
 reload(): void;
 loadURL(url: string): Promise<void>;
 openDevTools(): void;
 getURL(): string;
}

type StudioMode = "view" | "editor" | "terrain";

const HOME = FLEET_URLS.threeflow || "https://threeflow.vercel.app";
const DEFAULT_WATER_LEVEL = 0.8;
const HOTKEYS = [
 { keys: "WASD", action: "Move the third-person rig" },
 { keys: "Shift", action: "Sprint" },
 { keys: "Space", action: "Hop / quick jump" },
 { keys: "Mouse drag", action: "Orbit camera" },
 { keys: "F", action: "Focus selection" },
 { keys: "H", action: "Toggle HUD" },
 { keys: "Ctrl+S", action: "Save scene" },
];

function withEmbed(href: string): string {
 try {
   const u = new URL(href);
   u.searchParams.set("embed", "1");
   u.searchParams.set("from", "grudge-dev-tool");
   return u.toString();
 } catch {
   return href;
 }
}

export default function ThreeFlowStudio() {
 const wvRef = useRef<WebviewEl | null>(null);
 const terrainCanvasRef = useRef<HTMLCanvasElement | null>(null);
 const [mode, setMode] = useState<StudioMode>("editor");
 const [loading, setLoading] = useState(true);
 const [src, setSrc] = useState<string | null>(null);
 const [waterLevel, setWaterLevel] = useState(DEFAULT_WATER_LEVEL);
 const [sceneBaked, setSceneBaked] = useState(true);

 const target = mode === "view" ? `${HOME}/view` : `${HOME}/editor`;

 useEffect(() => {
   void (async () => {
     const stamped = await embedUrlWithSession(withEmbed(target));
     setSrc(stamped);
   })();
 }, [target]);

 useEffect(() => {
   const wv = wvRef.current;
   if (!wv || !src) return;
   const detachAuth = attachWebviewSession(asWebview(wv));
   const onStart = () => setLoading(true);
   const onStop = () => setLoading(false);
   const onFail = (e: Event) => {
     setLoading(false);
     const d = e as unknown as { errorCode?: number; errorDescription?: string };
     if (d.errorCode === -3) return;
     toast.error(`ThreeFlow load failed: ${d.errorDescription ?? d.errorCode ?? "unknown"}`);
   };
   wv.addEventListener("did-start-loading", onStart);
   wv.addEventListener("did-stop-loading", onStop);
   wv.addEventListener("did-fail-load", onFail);
   return () => {
     detachAuth();
     wv.removeEventListener("did-start-loading", onStart);
     wv.removeEventListener("did-stop-loading", onStop);
     wv.removeEventListener("did-fail-load", onFail);
   };
 }, [src]);

 useEffect(() => {
   if (!terrainCanvasRef.current || mode === "view") return;

   const canvas = terrainCanvasRef.current;
   THREE.ColorManagement.enabled = true;
   const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
   renderer.outputColorSpace = THREE.SRGBColorSpace;
   renderer.toneMapping = THREE.ACESFilmicToneMapping;
   renderer.setClearColor(0x0a0e1a, 1);
   renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
   renderer.shadowMap.enabled = true;
   renderer.shadowMap.type = THREE.PCFSoftShadowMap;

   const scene = new THREE.Scene();
   scene.background = new THREE.Color(0x0a0e1a);
   scene.fog = new THREE.Fog(0x0a0e1a, 28, 90);

   const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 200);
   camera.position.set(10, 8, 12);

   const controls = new OrbitControls(camera, canvas);
   controls.enableDamping = true;
   controls.enablePan = false;
   controls.minDistance = 7;
   controls.maxDistance = 18;
   controls.minPolarAngle = 0.55;
   controls.maxPolarAngle = 1.3;
   controls.target.set(0, 1.4, 0);

   const hemi = new THREE.HemisphereLight(0xdff2ff, 0x2d4033, 1.2);
   scene.add(hemi);

   const sun = new THREE.DirectionalLight(0xfff1d1, 1.6);
   sun.position.set(12, 18, 10);
   sun.castShadow = true;
   sun.shadow.mapSize.set(2048, 2048);
   sun.shadow.camera.left = -25;
   sun.shadow.camera.right = 25;
   sun.shadow.camera.top = 25;
   sun.shadow.camera.bottom = -25;
   scene.add(sun);

   const terrainGeometry = new THREE.PlaneGeometry(60, 60, 140, 140);
   const terrainPositions = terrainGeometry.attributes.position as THREE.BufferAttribute;
   for (let i = 0; i < terrainPositions.count; i += 1) {
     const x = terrainPositions.getX(i);
     const y = terrainPositions.getY(i);
     const height =
       Math.sin(x * 0.24) * 1.5 +
       Math.cos(y * 0.18) * 1.8 +
       Math.sin((x + y) * 0.15) * 1.2 +
       Math.abs(Math.sin((x - 8) * 0.32)) * 0.8;
     terrainPositions.setZ(i, height);
   }
   terrainGeometry.computeVertexNormals();

   const terrainMaterial = new THREE.MeshStandardMaterial({
     color: "#7f8b5d",
     roughness: 0.95,
     metalness: 0.05,
   });
   const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
   terrain.rotation.x = -Math.PI / 2;
   terrain.receiveShadow = true;
   scene.add(terrain);

   const rockMaterial = new THREE.MeshStandardMaterial({ color: "#7a6e5e", roughness: 0.9 });
   const rockGroup = new THREE.Group();
   for (let i = 0; i < 18; i += 1) {
     const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4 + (i % 3) * 0.25, 0), rockMaterial);
     rock.position.set(
       (Math.random() - 0.5) * 26,
       0.8 + Math.random() * 1.5,
       (Math.random() - 0.5) * 26,
     );
     rock.scale.setScalar(0.9 + Math.random() * 1.7);
     rock.castShadow = true;
     rock.receiveShadow = true;
     rockGroup.add(rock);
   }
   scene.add(rockGroup);

   const waterMesh = new THREE.Mesh(
     new THREE.PlaneGeometry(64, 64),
     new THREE.MeshPhysicalMaterial({
       color: "#4eb7ff",
       transparent: true,
       opacity: 0.72,
       roughness: 0.14,
       metalness: 0.1,
       transmission: 0.1,
     }),
   );
   waterMesh.rotation.x = -Math.PI / 2;
   waterMesh.position.y = waterLevel;
   waterMesh.receiveShadow = true;
   scene.add(waterMesh);

   const player = new THREE.Group();
   const capsule = new THREE.Mesh(
     new THREE.CapsuleGeometry(0.6, 1.4, 6, 12),
     new THREE.MeshStandardMaterial({ color: "#f2b56b", roughness: 0.6 }),
   );
   capsule.position.y = 1.2;
   capsule.castShadow = true;
   player.add(capsule);
   scene.add(player);

   const keys: Record<string, boolean> = {};
   const onKeyDown = (event: KeyboardEvent) => {
     if (["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight", "Space"].includes(event.code)) {
       keys[event.code] = true;
     }
     if (event.code === "KeyF") {
       controls.target.copy(player.position.clone().add(new THREE.Vector3(0, 1.4, 0)));
     }
     if (event.code === "KeyH") {
       setSceneBaked((value) => !value);
     }
   };
   const onKeyUp = (event: KeyboardEvent) => {
     keys[event.code] = false;
   };
   window.addEventListener("keydown", onKeyDown);
   window.addEventListener("keyup", onKeyUp);

   const timer = new THREE.Timer();
   timer.connect(document);
   let jumpVelocity = 0;
   const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
   const forward = new THREE.Vector3();
   const right = new THREE.Vector3();
   const moveVector = new THREE.Vector3();
   const up = new THREE.Vector3(0, 1, 0);
   const lookTarget = new THREE.Vector3();

   const resize = () => {
     const { clientWidth, clientHeight } = canvas;
     if (!clientWidth || !clientHeight) return;
     renderer.setSize(clientWidth, clientHeight, false);
     camera.aspect = clientWidth / clientHeight;
     camera.updateProjectionMatrix();
   };

   resize();
   const observer = new ResizeObserver(resize);
   observer.observe(canvas);

   const animate = () => {
     timer.update();
     const elapsed = Math.min(0.05, timer.getDelta());
     const moveX = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
     const moveZ = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);

     if (moveX !== 0 || moveZ !== 0) {
       camera.getWorldDirection(forward);
       forward.y = 0;
       forward.normalize();
       right.crossVectors(up, forward).normalize();
       moveVector.set(0, 0, 0);
       moveVector.addScaledVector(forward, moveZ);
       moveVector.addScaledVector(right, moveX);
       if (moveVector.lengthSq() > 0) {
         moveVector.normalize();
         const speed = keys.ShiftLeft || keys.ShiftRight ? 8 : 5;
         player.position.x += moveVector.x * speed * elapsed;
         player.position.z += moveVector.z * speed * elapsed;
         player.position.x = clamp(player.position.x, -24, 24);
         player.position.z = clamp(player.position.z, -24, 24);
       }
     }

     if (keys.Space && player.position.y <= 1.2) {
       jumpVelocity = 5.2;
     }
     jumpVelocity -= 11.5 * elapsed;
     player.position.y = Math.max(1.2, player.position.y + jumpVelocity * elapsed);
     if (player.position.y <= 1.2) {
       player.position.y = 1.2;
       jumpVelocity = 0;
     }

     lookTarget.copy(player.position).add(up.set(0, 1.3, 0));
     up.set(0, 1, 0);
     controls.target.lerp(lookTarget, 0.16);
     controls.update();
     renderer.render(scene, camera);
   };

   renderer.setAnimationLoop(animate);

   return () => {
     renderer.setAnimationLoop(null);
     observer.disconnect();
     window.removeEventListener("keydown", onKeyDown);
     window.removeEventListener("keyup", onKeyUp);
     timer.dispose();
     renderer.dispose();
   };
 }, [mode, waterLevel]);

 useEffect(() => {
   if (terrainCanvasRef.current) {
     const water = terrainCanvasRef.current;
     water.style.opacity = mode === "view" ? "0" : "1";
   }
 }, [mode]);

 const openExternal = useCallback(() => {
   void window.grudge?.os?.openExternal?.(target);
 }, [target]);

 return (
   <div className="flex h-full min-h-0 flex-col bg-[#0a0e1a]">
     <header className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2 shrink-0">
       <Box size={16} className="text-amber-400" />
       <div className="min-w-0">
         <strong className="text-sm text-amber-100">ThreeFlow</strong>
         <p className="text-[10px] text-white/45 truncate">
           {mode === "view" ? "ThreePipe viewer" : mode === "terrain" ? "Terrain starter" : "Scene editor"} · {HOME.replace(/^https?:\/\//, "")}
         </p>
       </div>
       <div className="ml-auto flex flex-wrap items-center gap-2">
         <button
           type="button"
           className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs ${
             mode === "view" ? "border-amber-400/70 text-amber-200" : "border-white/15"
           }`}
           onClick={() => setMode("view")}
         >
           <Eye size={12} /> View
         </button>
         <button
           type="button"
           className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs ${
             mode === "editor" ? "border-amber-400/70 text-amber-200" : "border-white/15"
           }`}
           onClick={() => setMode("editor")}
         >
           <Box size={12} /> Editor
         </button>
         <button
           type="button"
           className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs ${
             mode === "terrain" ? "border-amber-400/70 text-amber-200" : "border-white/15"
           }`}
           onClick={() => setMode("terrain")}
         >
           <Mountain size={12} /> Terrain
         </button>
         <button
           type="button"
           className="inline-flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-xs"
           onClick={() => {
             void wvRef.current?.reload?.();
           }}
         >
           <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Reload
         </button>
         <button
           type="button"
           className="inline-flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-xs"
           onClick={openExternal}
         >
           <ExternalLink size={12} /> Browser
         </button>
         <button
           type="button"
           className="inline-flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-xs"
           onClick={() => void window.grudge?.app?.openRoute?.("/forge")}
         >
           <Hammer size={12} /> Forge
         </button>
         <button
           type="button"
           className="p-1.5 rounded hover:bg-white/10"
           title="Webview DevTools"
           onClick={() => wvRef.current?.openDevTools?.()}
         >
           <Bug size={14} />
         </button>
       </div>
     </header>

     <div className="relative min-h-0 flex-1 overflow-hidden">
       <div className="absolute inset-0 bg-[#0c1321]" />
       {src && mode !== "terrain" ? (
         React.createElement("webview", {
           ref: wvRef as unknown as React.RefObject<HTMLElement>,
           src,
           className: "absolute inset-0 w-full h-full",
           partition: "persist:grudge-threeflow",
           allowpopups: "true",
           webpreferences: "allowRunningInsecureContent, nativeWindowOpen=yes",
         })
       ) : null}

       {(mode === "editor" || mode === "terrain") && (
         <div className="absolute inset-0">
           <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(122,162,255,0.18),_transparent_55%)]" />
           <canvas ref={terrainCanvasRef} className="absolute inset-0 h-full w-full" />
           <div className="pointer-events-none absolute left-4 top-4 rounded-xl border border-white/10 bg-slate-950/60 p-3 text-[11px] text-slate-100 shadow-lg backdrop-blur-sm">
             <div className="mb-2 flex items-center gap-2 font-semibold text-amber-200">
               <Keyboard size={12} /> Hotkeys
             </div>
             <div className="space-y-1.5">
               {HOTKEYS.map(({ keys, action }) => (
                 <div key={keys} className="flex items-center justify-between gap-4 whitespace-nowrap">
                   <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
                     {keys}
                   </span>
                   <span className="text-white/70">{action}</span>
                 </div>
               ))}
             </div>
           </div>

           <div className="pointer-events-auto absolute bottom-4 right-4 w-72 rounded-xl border border-white/10 bg-slate-950/65 p-3 text-[11px] text-slate-100 shadow-lg backdrop-blur-sm">
             <div className="mb-2 flex items-center gap-2 text-amber-200">
               <Waves size={12} /> Water level
             </div>
             <div className="mb-2 flex items-center justify-between text-white/70">
               <span>Level</span>
               <strong>{waterLevel.toFixed(1)}</strong>
             </div>
             <input
               type="range"
               min={-1}
               max={3}
               step={0.1}
               value={waterLevel}
               onChange={(event) => setWaterLevel(Number(event.target.value))}
               className="w-full accent-cyan-400"
             />
             <div className="mt-3 flex items-center justify-between">
               <span className="text-white/60">Scene</span>
               <span className={`rounded-full px-2 py-0.5 ${sceneBaked ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
                 {sceneBaked ? "Baked" : "Live"}
               </span>
             </div>
           </div>
         </div>
       )}

       {!src && mode !== "terrain" && <div className="p-6 text-white/40 text-sm">Loading ThreeFlow…</div>}
     </div>
   </div>
 );
}
