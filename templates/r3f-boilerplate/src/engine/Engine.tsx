import React, { Suspense, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr, AdaptiveEvents, Stats } from "@react-three/drei";
import * as THREE from "three";

/**
 * Production-grade Canvas wrapper. Choices:
 *
 * - `dpr={[1, 2]}`            — clamp DPR; avoids 4K/8K render explosions on hi-res monitors.
 * - `flat={false}`            — keep ACES filmic tone mapping (the modern default).
 * - `gl.outputColorSpace`     — explicitly sRGB; relies on Three's r152+ behaviour.
 * - `gl.toneMapping`          — ACESFilmicToneMapping; `toneMappingExposure` exposed via prop.
 * - `gl.powerPreference`      — high-perf GPU when available.
 * - `gl.antialias`            — MSAA in WebGL; for SMAA prefer post-processing instead.
 * - `shadows`                 — soft PCF shadows on by default; render PERFORMANCE-tier scenes
 *                               can override `shadows={false}`.
 * - `<AdaptiveDpr/Events>`    — drei helpers that drop DPR + throttle events under load.
 * - `<Suspense>`              — required for any GLTF/texture loaders inside the scene tree.
 */
export interface EngineProps {
  children: React.ReactNode;
  shadows?: boolean;
  exposure?: number;
  showStats?: boolean;
}

export default function Engine({ children, shadows = true, exposure = 1.0, showStats = false }: EngineProps) {
  return (
    <Canvas
      shadows={shadows ? "soft" : false}
      dpr={[1, 2]}
      gl={{
        antialias: true,
        powerPreference: "high-performance",
        outputColorSpace: THREE.SRGBColorSpace,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: exposure,
      }}
      camera={{ position: [4, 3, 6], fov: 45, near: 0.1, far: 200 }}
      frameloop="demand"
      onCreated={({ gl }) => {
        // Best-practice defaults that R3F doesn't always set.
        gl.shadowMap.enabled = !!shadows;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
      }}
    >
      <AdaptiveDpr pixelated />
      <AdaptiveEvents />
      {showStats && <Stats className="!top-2 !left-2" />}
      <Suspense fallback={null}>{children}</Suspense>
    </Canvas>
  );
}

/**
 * Hook that flips R3F into "render-on-change" mode for editors. Pair with
 * `frameloop="demand"` above — the canvas only re-renders when state-driven
 * effects request a frame via `invalidate()`.
 */
export function useDemandFrameloop(enabled = true) {
  // Placeholder hook for future invalidate-on-prop patterns; kept here so the
  // boilerplate has a single import point for editor scenes.
  useEffect(() => {
    /* no-op */
  }, [enabled]);
}
