import React, { useMemo } from "react";
import * as THREE from "three";
import { buildSceneGraph, nodeIcon } from "../lib/forge/sceneGraph";

interface Props {
  root: THREE.Object3D;
  selectedUuid: string | null;
  onSelect: (uuid: string, object: THREE.Object3D) => void;
}

export default function ForgeSceneTree({ root, selectedUuid, onSelect }: Props) {
  const nodes = useMemo(() => buildSceneGraph(root), [root, root.uuid]);

  return (
    <div className="text-[10px] font-mono max-h-48 overflow-auto border border-line rounded p-1">
      {nodes.map((n) => {
        const active = selectedUuid === n.uuid;
        return (
          <button
            key={n.uuid}
            type="button"
            className={"block w-full text-left truncate py-0.5 px-1 rounded hover:bg-gold/10 " + (active ? "bg-gold/15 text-gold" : "")}
            style={{ paddingLeft: 4 + n.depth * 10 }}
            title={n.type + " · " + n.uuid}
            onClick={() => onSelect(n.uuid, n.object)}
          >
            <span className="opacity-60 mr-1">{nodeIcon(n)}</span>
            {n.name}
          </button>
        );
      })}
    </div>
  );
}