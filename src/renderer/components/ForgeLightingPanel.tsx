import React from "react";
import type { StudioLightState } from "../lib/forge/sceneEngine";

interface Props {
  lights: StudioLightState;
  onChange: (next: StudioLightState) => void;
}

function hexInput(value: number, onChange: (hex: number) => void) {
  const css = `#${value.toString(16).padStart(6, "0")}`;
  return (
    <input
      type="color"
      value={css}
      onChange={(e) => onChange(parseInt(e.target.value.slice(1), 16))}
      className="w-8 h-6 p-0 border-0"
    />
  );
}

export default function ForgeLightingPanel({ lights, onChange }: Props) {
  const patch = (partial: Partial<StudioLightState>) => onChange({ ...lights, ...partial });

  return (
    <div className="space-y-3 text-[10px]">
      <div>
        <div className="text-gold font-semibold mb-1">Key light</div>
        <div className="flex items-center gap-2 mb-1">
          {hexInput(lights.key.color, (c) => patch({ key: { ...lights.key, color: c } }))}
          <input
            type="range" min={0} max={3} step={0.05}
            value={lights.key.intensity}
            onChange={(e) => patch({ key: { ...lights.key, intensity: Number(e.target.value) } })}
            className="flex-1"
          />
          <span className="font-mono w-8">{lights.key.intensity.toFixed(1)}</span>
        </div>
      </div>
      <div>
        <div className="text-gold font-semibold mb-1">Fill light</div>
        <div className="flex items-center gap-2 mb-1">
          {hexInput(lights.fill.color, (c) => patch({ fill: { ...lights.fill, color: c } }))}
          <input
            type="range" min={0} max={2} step={0.05}
            value={lights.fill.intensity}
            onChange={(e) => patch({ fill: { ...lights.fill, intensity: Number(e.target.value) } })}
            className="flex-1"
          />
          <span className="font-mono w-8">{lights.fill.intensity.toFixed(1)}</span>
        </div>
      </div>
      <div>
        <div className="text-gold font-semibold mb-1">Ambient</div>
        <div className="flex items-center gap-2">
          {hexInput(lights.ambient.color, (c) => patch({ ambient: { ...lights.ambient, color: c } }))}
          <input
            type="range" min={0} max={1} step={0.02}
            value={lights.ambient.intensity}
            onChange={(e) => patch({ ambient: { ...lights.ambient, intensity: Number(e.target.value) } })}
            className="flex-1"
          />
        </div>
      </div>
      <div>
        <div className="text-gold font-semibold mb-1">Exposure</div>
        <input
          type="range" min={0.2} max={2.5} step={0.05}
          value={lights.exposure}
          onChange={(e) => patch({ exposure: Number(e.target.value) })}
          className="w-full"
        />
        <span className="font-mono">{lights.exposure.toFixed(2)}</span>
      </div>
      <p className="text-muted">Studio IBL (RoomEnvironment) stays on for PBR preview.</p>
    </div>
  );
}