import React from "react";
import { OrbitControls, Environment, ContactShadows, Grid, useGLTF } from "@react-three/drei";
import { useSceneStore } from "../hooks/useSceneStore";

useGLTF.preload("/models/demo.glb"); // optional: drop a .glb into public/models/ to test the loader

function DemoModel() {
  // Suspends until the GLB is available; safe because <App> wraps in <Suspense>.
  // If /models/demo.glb is missing, swap this for the primitive below.
  const gltf = useGLTF("/models/demo.glb", true);
  return <primitive object={gltf.scene} castShadow receiveShadow />;
}

function FallbackPrimitive() {
  return (
    <mesh castShadow receiveShadow position={[0, 0.5, 0]}>
      <icosahedronGeometry args={[0.6, 1]} />
      <meshStandardMaterial color="#ffc62a" metalness={0.6} roughness={0.25} />
    </mesh>
  );
}

export default function StageScene() {
  const showGltf = useSceneStore((s) => s.showGltf);
  return (
    <>
      <color attach="background" args={["#0a0e1a"]} />
      <fog attach="fog" args={["#0a0e1a", 8, 40]} />

      {/* IBL: cheap, looks great. Swap "city" for any drei preset, or a custom HDR. */}
      <Environment preset="city" />

      {/* Key light. Cast shadows from this one only. */}
      <directionalLight
        position={[6, 10, 4]}
        intensity={1.4}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0001}
      >
        <orthographicCamera attach="shadow-camera" args={[-10, 10, 10, -10, 0.1, 50]} />
      </directionalLight>
      <ambientLight intensity={0.15} />

      {/* Reference grid + soft contact shadow. */}
      <Grid args={[40, 40]} position={[0, 0.001, 0]} cellThickness={0.5} sectionSize={4} fadeDistance={30} infiniteGrid />
      <ContactShadows position={[0, 0.0, 0]} opacity={0.55} scale={20} blur={2.4} far={6} />

      {/* Demo content. */}
      <React.Suspense fallback={<FallbackPrimitive />}>
        {showGltf ? <DemoModel /> : <FallbackPrimitive />}
      </React.Suspense>

      <OrbitControls makeDefault enableDamping target={[0, 0.5, 0]} minDistance={2} maxDistance={30} />
    </>
  );
}
