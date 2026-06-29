import React, { useEffect, useState } from "react";
import * as THREE from "three";

interface Props {
  object: THREE.Object3D | null;
  onChange: () => void;
}

type Axis = "x" | "y" | "z";
type Mode = "position" | "rotation" | "scale";

function Vec3Input({
  label,
  values,
  onChange,
  step = 0.01,
}: {
  label: string;
  values: [number, number, number];
  onChange: (axis: Axis, v: number) => void;
  step?: number;
}) {
  const axes: Axis[] = ["x", "y", "z"];
  const colors = ["#ff6b6b", "#6bff6b", "#6b9eff"];
  return (
    <div className="flex items-center gap-1 mb-1">
      <span className="text-muted w-8">{label}</span>
      {axes.map((a, i) => (
        <input
          key={a}
          type="number"
          step={step}
          value={Number(values[i].toFixed(4))}
          onChange={(e) => onChange(a, Number(e.target.value))}
          className="w-16 text-[10px] font-mono px-1 py-0.5 rounded"
          style={{ color: colors[i] }}
        />
      ))}
    </div>
  );
}

export default function ForgeTransformPanel({ object, onChange }: Props) {
  const [, tick] = useState(0);

  useEffect(() => {
    tick((n) => n + 1);
  }, [object?.uuid, object?.position.x, object?.position.y, object?.position.z]);

  if (!object) {
    return <p className="text-muted text-[10px]">Select an object or node in the scene tree.</p>;
  }

  function patch(mode: Mode, axis: Axis, value: number) {
    if (mode === "position") object!.position[axis] = value;
    else if (mode === "rotation") object!.rotation[axis] = THREE.MathUtils.degToRad(value);
    else object!.scale[axis] = value;
    object!.updateMatrixWorld(true);
    onChange();
    tick((n) => n + 1);
  }

  const rotDeg: [number, number, number] = [
    THREE.MathUtils.radToDeg(object.rotation.x),
    THREE.MathUtils.radToDeg(object.rotation.y),
    THREE.MathUtils.radToDeg(object.rotation.z),
  ];

  return (
    <div className="space-y-1">
      <div className="text-gold font-semibold text-[10px] truncate" title={object.name}>
        {object.name || object.type}
      </div>
      <Vec3Input
        label="Pos"
        values={[object.position.x, object.position.y, object.position.z]}
        onChange={(a, v) => patch("position", a, v)}
      />
      <Vec3Input
        label="Rot°"
        values={rotDeg}
        step={1}
        onChange={(a, v) => patch("rotation", a, v)}
      />
      <Vec3Input
        label="Scl"
        values={[object.scale.x, object.scale.y, object.scale.z]}
        onChange={(a, v) => patch("scale", a, v)}
      />
      <label className="flex items-center gap-2 text-[10px] mt-2">
        <input
          type="checkbox"
          checked={object.visible}
          onChange={(e) => { object.visible = e.target.checked; onChange(); tick((n) => n + 1); }}
        />
        Visible
      </label>
    </div>
  );
}