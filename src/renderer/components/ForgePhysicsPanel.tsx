import React, { useEffect, useState } from "react";
import { Play, Pause, RotateCcw, Zap } from "lucide-react";
import type { ForgeRapierWorld } from "../lib/forge/rapierWorld";

interface Props {
  physics: ForgeRapierWorld | null;
  ready: boolean;
  playing: boolean;
  bodyCount: number;
  onInit: () => void;
  onAddSelected: () => void;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
}

export default function ForgePhysicsPanel({
  physics, ready, playing, bodyCount, onInit, onAddSelected, onPlay, onPause, onReset,
}: Props) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready && !physics) setError(null);
  }, [ready, physics]);

  return (
    <div className="forge-physics-panel">
      <p className="text-[11px] text-muted leading-relaxed">
        Rapier physics preview — patterns from grudge-builder &amp; grudge-engine-web. Drop objects, add ground, simulate.
      </p>
      {!ready ? (
        <button type="button" className="engine-chip w-full justify-center" onClick={() => { setError(null); onInit(); }}>
          <Zap size={12} /> Initialize Rapier
        </button>
      ) : (
        <>
          <div className="forge-physics-stats">
            <span>Bodies: <strong className="text-gold">{bodyCount}</strong></span>
            <span>{playing ? "Simulating" : "Paused"}</span>
          </div>
          <button type="button" className="engine-chip w-full" onClick={onAddSelected}>
            Add selected to physics
          </button>
          <div className="forge-physics-controls">
            <button type="button" className="engine-chip" onClick={onPlay}><Play size={11} /> Play</button>
            <button type="button" className="engine-chip" onClick={onPause}><Pause size={11} /> Pause</button>
            <button type="button" className="engine-chip" onClick={onReset}><RotateCcw size={11} /> Reset</button>
          </div>
        </>
      )}
      {error && <div className="forge-panel-error">{error}</div>}
      <div className="text-[9px] text-muted mt-2">
        Tip: F5 play mode in grudge-engine-web · R3F preview via <code>npm run scaffold:r3f</code>
      </div>
    </div>
  );
}