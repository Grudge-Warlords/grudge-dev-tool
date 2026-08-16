/**
 * Elite viewer inspector — Scene / Object / Material / Rig / Anim.
 * Reuses sceneGraph, inspectSceneRig, editorTools, animApply, mixamo25 libraries.
 * Not a second Forge workbench.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { toast } from "sonner";
import type { SceneEngine, GizmoMode } from "../../lib/forge/sceneEngine";
import { buildSceneGraph, findObjectByUuid, nodeIcon } from "../../lib/forge/sceneGraph";
import { inspectSceneRig, type RigInspectResult } from "../../lib/forge/rigInspect";
import { groundSnap, fixMesh } from "../../lib/forge/editorTools";
import { fitHeightSi, formatSiMeters, type SiBounds } from "../../lib/forge/siMeasure";
import { applyAnimationsToTarget } from "../../lib/forge/animApply";
import { setPrimaryAction } from "../../lib/forge/forgeAnimation";
import { exportToGlb, downloadBlob } from "../../lib/forge/converters";
import { loadModel } from "../../lib/forge/loaders";
import type { AssetRef } from "./types";

type Tab = "scene" | "object" | "material" | "rig" | "anim";

const G = () => (window as unknown as { grudge?: any }).grudge;

const MAP_SLOTS: Array<{ key: keyof THREE.MeshStandardMaterial; label: string }> = [
  { key: "map", label: "Albedo" },
  { key: "normalMap", label: "Normal" },
  { key: "roughnessMap", label: "Rough" },
  { key: "metalnessMap", label: "Metal" },
  { key: "aoMap", label: "AO" },
  { key: "emissiveMap", label: "Emit" },
];

export interface ViewerItemRow {
  id: string;
  name: string;
  visible: boolean;
  bones: number;
}

export interface AssetStudioInspectorProps {
  engine: SceneEngine | null;
  root: THREE.Object3D | null;
  asset: AssetRef;
  clips: THREE.AnimationClip[];
  mixer: THREE.AnimationMixer | null;
  si: SiBounds | null;
  onSiChange: (si: SiBounds) => void;
  onTransformTick: () => void;
  onClipsChange: (clips: THREE.AnimationClip[]) => void;
  skeletonOn: boolean;
  onSkeleton: (on: boolean) => void;
  sceneItems?: ViewerItemRow[];
  selectedItemId?: string | null;
  onSelectItem?: (id: string) => void;
  onRemoveItem?: (id: string) => void;
  onDuplicateItem?: (id: string) => void;
  onToggleItemVisible?: (id: string) => void;
  onAddFiles?: () => void;
  gizmoSpace?: "world" | "local";
  onGizmoSpace?: (space: "world" | "local") => void;
}

export default function AssetStudioInspector(props: AssetStudioInspectorProps) {
  const {
    engine, root, asset, clips, mixer, si, onSiChange, onTransformTick, onClipsChange,
    sceneItems, selectedItemId, onSelectItem, onRemoveItem, onDuplicateItem,
    onToggleItemVisible, onAddFiles, gizmoSpace, onGizmoSpace,
  } = props;
  const [tab, setTab] = useState<Tab>("scene");
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [gizmo, setGizmo] = useState<GizmoMode>("translate");
  const [boneNamesOn, setBoneNamesOn] = useState(false);
  const [libs, setLibs] = useState<Array<{ packDir: string; name: string; clipCount: number }>>([]);
  const [libBusy, setLibBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

  const selected = useMemo(() => {
    if (!root || !selectedUuid) return root;
    return findObjectByUuid(root, selectedUuid) ?? root;
  }, [root, selectedUuid]);

  const nodes = useMemo(() => (root ? buildSceneGraph(root, 12) : []), [root]);
  const rig: RigInspectResult | null = useMemo(() => (root ? inspectSceneRig(root) : null), [root]);

  const material = useMemo(() => firstStandard(selected), [selected]);

  useEffect(() => {
    void (async () => {
      try {
        const list = await G()?.skeleton?.listLibraries?.();
        if (Array.isArray(list)) setLibs(list);
      } catch {
        setLibs([]);
      }
    })();
  }, []);

  const selectNode = useCallback((uuid: string, obj: THREE.Object3D) => {
    setSelectedUuid(uuid);
    engine?.attach(obj);
    engine?.pulseSelect(obj);
  }, [engine]);

  const setMode = useCallback((mode: GizmoMode) => {
    setGizmo(mode);
    engine?.setGizmoMode(mode);
    if (selected) engine?.attach(selected);
  }, [engine, selected]);

  const doGround = useCallback(() => {
    if (!root) return;
    groundSnap(root);
    onTransformTick();
    if (engine) onSiChange(engine.measureBounds(root));
    toast.success("Grounded to Y=0");
  }, [root, engine, onTransformTick, onSiChange]);

  const doFit18 = useCallback(() => {
    if (!root) return;
    const r = fitHeightSi(root, 1.8);
    if (!r.ok) {
      toast.message(r.reason === "static" ? "Static mesh — not forcing 1.8 m" : "Cannot fit height");
      return;
    }
    groundSnap(root);
    onTransformTick();
    if (engine) onSiChange(engine.measureBounds(root));
    toast.success(`Fit ${r.beforeH.toFixed(2)} m → ${r.afterH.toFixed(2)} m`);
  }, [root, engine, onTransformTick, onSiChange]);

  const doFixMesh = useCallback(() => {
    if (!root) return;
    const n = fixMesh(root).length;
    toast.success(`Fixed ${n} mesh(es)`);
  }, [root]);

  const applyLibrary = useCallback(async (packDir: string) => {
    if (!root || !engine) return;
    setLibBusy(true);
    try {
      const rest = `${packDir.replace(/[/\\]+$/, "")}/rest.glb`;
      const grudge = G();
      const fileRes = await grudge?.forge?.readFile?.(rest) ?? await grudge?.files?.read?.(rest);
      if (!fileRes?.bytes) throw new Error("Could not read rest.glb from library");
      const bytes = fileRes.bytes as Uint8Array;
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const file = new File([ab], "rest.glb", { type: "model/gltf-binary" });
      const loaded = await loadModel(file, { diskPath: rest, sanitize: { toonStyle: true } });
      const applied = applyAnimationsToTarget(loaded.animations, root, { dropRootChain: true });
      if (!applied.clips.length) throw new Error("Library produced no usable clips");
      const handleMixer = mixer ?? engine.buildMixer(root, applied.clips, { force: true });
      if (!handleMixer) throw new Error("No mixer");
      setPrimaryAction(handleMixer, applied.clips[0], "repeat");
      onClipsChange(applied.clips);
      toast.success(`Applied ${applied.clips.length} clip(s)`, {
        description: `${applied.mode}${applied.warnings[0] ? ` · ${applied.warnings[0]}` : ""}`,
      });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Library apply failed");
    } finally {
      setLibBusy(false);
    }
  }, [root, engine, mixer, onClipsChange]);

  const saveGlb = useCallback(async () => {
    if (!root) return;
    setSaveBusy(true);
    try {
      const base = (asset.name || "asset").replace(/\.[^.]+$/, "");
      const result = await exportToGlb(root, clips, base);
      downloadBlob(result.blob, result.filename);
      if (asset.localPath && rig?.hasSkinnedMesh) {
        const mapPath = asset.localPath.replace(/\.[^.]+$/, "") + ".skeleton-mapping.json";
        const mapping = {
          source: asset.localPath,
          fingerprint: rig.fingerprint,
          skeletonType: rig.skeletonType,
          bones: rig.boneNames,
          attachments: rig.attachments,
          savedAt: new Date().toISOString(),
        };
        try {
          await G()?.skeleton?.saveMapping?.({ path: mapPath, mapping });
          toast.success("Saved GLB + mapping", { description: mapPath.split(/[\\/]/).pop() });
        } catch {
          toast.success("Saved GLB (mapping write skipped)");
        }
      } else {
        toast.success(`Saved ${result.filename}`, { description: `${result.triangles} tris` });
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaveBusy(false);
    }
  }, [root, clips, asset, rig]);

  const openSkeletonStudio = useCallback(async () => {
    const path = asset.localPath;
    if (!path) {
      toast.error("Need a local file path for Skeleton Studio");
      return;
    }
    try {
      sessionStorage.setItem("grudge.skeleton.pendingPath", path);
      await G()?.app?.openRoute?.("/skeleton");
      toast.success("Opening Skeleton Studio");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not open Skeleton Studio");
    }
  }, [asset.localPath]);

  if (!root) {
    return <div style={muted}>Load a model to inspect.</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
        {(["scene", "object", "material", "rig", "anim"] as Tab[]).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            style={tabBtn(tab === id)}
          >
            {id}
          </button>
        ))}
      </div>

      {tab === "scene" && (
        <div>
          <div style={muted}>Objects in this viewer · click to select · gizmo on active</div>
          {sceneItems && sceneItems.length > 0 && (
            <div style={{ margin: "6px 0 8px", maxHeight: 120, overflow: "auto" }}>
              {sceneItems.map((it) => (
                <div
                  key={it.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 4px",
                    background: selectedItemId === it.id ? "rgba(255,198,42,0.14)" : "transparent",
                    borderRadius: 4,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onSelectItem?.(it.id)}
                    style={{
                      flex: 1, textAlign: "left", border: "none", background: "transparent",
                      color: selectedItemId === it.id ? "var(--gold)" : "var(--text)",
                      fontSize: 11, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis",
                      opacity: it.visible ? 1 : 0.45,
                    }}
                  >
                    {it.name}{it.bones ? ` · ${it.bones}b` : ""}
                  </button>
                  <button type="button" title="Hide" onClick={() => onToggleItemVisible?.(it.id)} style={miniBtn}>
                    {it.visible ? "●" : "○"}
                  </button>
                  <button type="button" title="Duplicate" onClick={() => onDuplicateItem?.(it.id)} style={miniBtn}>⧉</button>
                  <button type="button" title="Remove" onClick={() => onRemoveItem?.(it.id)} style={miniBtn}>×</button>
                </div>
              ))}
            </div>
          )}
          <Action onClick={() => onAddFiles?.()} label="Add model (Shift+A)" />
          <div style={{ ...muted, marginTop: 10 }}>Nodes of selected object</div>
          <div style={{ maxHeight: 140, overflow: "auto", marginTop: 6 }}>
            {nodes.map((n) => (
              <button
                key={n.uuid}
                type="button"
                onClick={() => selectNode(n.uuid, n.object)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "2px 4px",
                  paddingLeft: 4 + n.depth * 10,
                  background: selectedUuid === n.uuid ? "rgba(255,198,42,0.14)" : "transparent",
                  color: selectedUuid === n.uuid ? "var(--gold)" : "var(--text)",
                  border: "none",
                  fontSize: 10,
                  fontFamily: "ui-monospace, monospace",
                  cursor: "pointer",
                }}
              >
                {nodeIcon(n)} {n.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === "object" && (
        <div>
          <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
            {(["translate", "rotate", "scale"] as GizmoMode[]).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} style={tabBtn(gizmo === m)}>
                {m === "translate" ? "G/W Move" : m === "rotate" ? "R/E Rot" : "S Scale"}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onGizmoSpace?.(gizmoSpace === "local" ? "world" : "local")}
              style={tabBtn(gizmoSpace === "local")}
              title="Gizmo space"
            >
              {gizmoSpace === "local" ? "Local" : "World"}
            </button>
          </div>
          {si && (
            <div style={muted}>
              {si.source === "bones" ? "Bone box" : "Mesh AABB"} ·
              H {formatSiMeters(si.h)} · W {formatSiMeters(si.w)} · D {formatSiMeters(si.d)}
            </div>
          )}
          <Action onClick={doGround} label="Ground Y = 0" />
          <Action onClick={doFit18} label="Fit height 1.8 m" disabled={si?.source !== "bones"} />
          <Action onClick={doFixMesh} label="Fix mesh (normals / NaN)" />
          <Action onClick={() => void saveGlb()} label={saveBusy ? "Saving…" : "Save GLB (+ mapping)"} />
        </div>
      )}

      {tab === "material" && (
        <MaterialEditor mesh={selected} material={material} />
      )}

      {tab === "rig" && (
        <div>
          {!rig?.hasSkinnedMesh && <div style={muted}>No skinned mesh — static asset.</div>}
          {rig && (
            <>
              <Row label="Type" value={rig.skeletonType} />
              <Row label="Print" value={rig.fingerprintLabel ?? "unknown"} />
              <Row label="Bones" value={String(rig.boneCount)} />
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, margin: "8px 0" }}>
                <input
                  type="checkbox"
                  checked={props.skeletonOn}
                  onChange={(e) => props.onSkeleton(e.target.checked)}
                />
                Skeleton overlay
              </label>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={boneNamesOn}
                  onChange={(e) => {
                    setBoneNamesOn(e.target.checked);
                    if (root) engine?.setBoneLabelsVisible(root, e.target.checked);
                  }}
                />
                Bone names
              </label>
              <Action onClick={() => void openSkeletonStudio()} label="Open in Skeleton Studio" />
              <pre style={{
                fontSize: 9, maxHeight: 120, overflow: "auto",
                background: "var(--bg-2)", padding: 6, borderRadius: 4,
              }}>
                {rig.boneNames.slice(0, 48).join("\n")}
                {rig.boneNames.length > 48 ? `\n…+${rig.boneNames.length - 48}` : ""}
              </pre>
            </>
          )}
        </div>
      )}

      {tab === "anim" && (
        <div>
          <div style={muted}>
            {clips.length} clip(s) on this mixer. Apply a local library pack (rest.glb tracks).
          </div>
          {libs.length === 0 && <div style={{ ...muted, marginTop: 8 }}>No local libraries — export one from Skeleton Studio.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            {libs.map((lib) => (
              <button
                key={lib.packDir}
                type="button"
                disabled={libBusy}
                onClick={() => void applyLibrary(lib.packDir)}
                style={{
                  textAlign: "left",
                  fontSize: 11,
                  padding: "4px 8px",
                  background: "var(--bg-2)",
                  border: "1px solid var(--line)",
                  borderRadius: 4,
                  color: "var(--text)",
                  cursor: libBusy ? "default" : "pointer",
                }}
              >
                {lib.name} · {lib.clipCount} clips
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MaterialEditor({
  mesh,
  material,
}: {
  mesh: THREE.Object3D | null;
  material: THREE.MeshStandardMaterial | null;
}) {
  const [, bump] = useState(0);
  if (!material || !(mesh as THREE.Mesh)?.isMesh) {
    return <div style={muted}>Select a mesh in Scene.</div>;
  }
  const mat = material;

  function setNum(key: "metalness" | "roughness" | "opacity" | "emissiveIntensity", v: number) {
    (mat as unknown as Record<string, number>)[key] = v;
    if (key === "opacity") {
      mat.transparent = v < 0.999;
    }
    mat.needsUpdate = true;
    bump((n) => n + 1);
  }

  return (
    <div>
      <Row label="Name" value={mat.name || "(unnamed)"} />
      <label style={field}>
        Color
        <input
          type="color"
          value={`#${mat.color.getHexString()}`}
          onChange={(e) => {
            mat.color.set(e.target.value);
            mat.needsUpdate = true;
            bump((n) => n + 1);
          }}
        />
      </label>
      <Num label="Metal" value={mat.metalness} min={0} max={1} onChange={(v) => setNum("metalness", v)} />
      <Num label="Rough" value={mat.roughness} min={0} max={1} onChange={(v) => setNum("roughness", v)} />
      <Num label="Opacity" value={mat.opacity} min={0} max={1} onChange={(v) => setNum("opacity", v)} />
      <div style={{ ...muted, marginTop: 8 }}>Maps (bound)</div>
      {MAP_SLOTS.map((s) => {
        const tex = mat[s.key] as THREE.Texture | null;
        return (
          <div key={s.key} style={{ fontSize: 10, color: tex ? "var(--ok)" : "var(--muted)", marginTop: 2 }}>
            {s.label}: {tex ? (tex.name || "yes") : "—"}
          </div>
        );
      })}
    </div>
  );
}

function firstStandard(obj: THREE.Object3D | null): THREE.MeshStandardMaterial | null {
  if (!obj) return null;
  const mesh = obj as THREE.Mesh;
  if (!mesh.isMesh) return null;
  const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of list) {
    if (m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
      return m as THREE.MeshStandardMaterial;
    }
  }
  return null;
}

function Action({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        marginTop: 6,
        padding: "4px 8px",
        fontSize: 11,
        background: "var(--bg-2)",
        border: "1px solid var(--line)",
        borderRadius: 5,
        color: disabled ? "var(--muted)" : "var(--text)",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3, gap: 8 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
    </div>
  );
}

function Num({
  label, value, min, max, onChange,
}: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label style={field}>
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1 }}
      />
      <span style={{ width: 32, fontSize: 10 }}>{value.toFixed(2)}</span>
    </label>
  );
}

const muted: React.CSSProperties = { fontSize: 10, color: "var(--muted)", lineHeight: 1.35 };
const field: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--muted)", marginTop: 6,
};

const miniBtn: React.CSSProperties = {
  width: 20, height: 20, fontSize: 11, padding: 0,
  border: "1px solid var(--line)", borderRadius: 3,
  background: "var(--bg-2)", color: "var(--muted)", cursor: "pointer",
};

function tabBtn(active: boolean): React.CSSProperties {
  return {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    padding: "2px 6px",
    borderRadius: 4,
    border: `1px solid ${active ? "var(--gold)" : "var(--line)"}`,
    background: active ? "rgba(255,198,42,0.14)" : "var(--bg-2)",
    color: active ? "var(--gold)" : "var(--muted)",
    cursor: "pointer",
  };
}
