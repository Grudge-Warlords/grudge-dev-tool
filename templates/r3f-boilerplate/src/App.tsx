import React from "react";
import Engine from "./engine/Engine";
import StageScene from "./scenes/StageScene";
import EffectsPipeline from "./engine/EffectsPipeline";
import { useDevControls } from "./hooks/useDevControls";

export default function App() {
  const { exposure, postFx, stats } = useDevControls();

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Engine exposure={exposure} showStats={stats}>
        <StageScene />
        {postFx && <EffectsPipeline />}
      </Engine>
    </div>
  );
}
