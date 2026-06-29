import React, { useEffect, useState } from "react";
import * as THREE from "three";
import {
  applyMaterialSettings,
  applyTextureToMesh,
  readMaterialSettings,
  DEFAULT_MATERIAL,
  type MaterialSettings,
} from "../lib/forge/materialUtils";
import { TEXTURE_PRESETS } from "../../shared/assetManifest";

interface Props {
  mesh: THREE.Mesh | null;
}

function SliderRow({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="forge-mat-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="forge-mat-val">{value.toFixed(2)}</span>
    </label>
  );
}

export default function ForgeMaterialPanel({ mesh }: Props) {
  const [settings, setSettings] = useState<MaterialSettings>(DEFAULT_MATERIAL);

  useEffect(() => {
    if (mesh) setSettings(readMaterialSettings(mesh));
    else setSettings(DEFAULT_MATERIAL);
  }, [mesh]);

  function patch(partial: Partial<MaterialSettings>) {
    if (!mesh) return;
    const next = { ...settings, ...partial };
    setSettings(next);
    applyMaterialSettings(mesh, next);
  }

  async function pickTexture(url: string) {
    if (!mesh) return;
    patch({ mapUrl: url });
    try {
      await applyTextureToMesh(mesh, url);
    } catch { /* ignore failed CDN texture */ }
  }

  if (!mesh) {
    return <div className="forge-panel-empty">Select a mesh in the hierarchy to edit materials.</div>;
  }

  return (
    <div className="forge-material-panel">
      <label className="forge-mat-row">
        <span>Color</span>
        <input type="color" value={settings.color} onChange={(e) => patch({ color: e.target.value })} />
      </label>
      <SliderRow label="Metalness" value={settings.metalness} min={0} max={1} step={0.01} onChange={(v) => patch({ metalness: v })} />
      <SliderRow label="Roughness" value={settings.roughness} min={0} max={1} step={0.01} onChange={(v) => patch({ roughness: v })} />
      <label className="forge-mat-row">
        <span>Emissive</span>
        <input type="color" value={settings.emissive} onChange={(e) => patch({ emissive: e.target.value })} />
      </label>
      <SliderRow label="Emissive" value={settings.emissiveIntensity} min={0} max={2} step={0.05} onChange={(v) => patch({ emissiveIntensity: v })} />
      <label className="forge-mat-row checkbox">
        <input type="checkbox" checked={settings.wireframe} onChange={(e) => patch({ wireframe: e.target.checked })} />
        <span>Wireframe</span>
      </label>
      <div className="forge-mat-textures">
        <div className="text-[10px] text-gold font-semibold mb-1">Quick textures</div>
        <div className="forge-asset-filters">
          {TEXTURE_PRESETS.map((t) => (
            <button key={t.id} type="button" className="engine-chip" onClick={() => void pickTexture(t.url)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}