/**
 * Execute a Scene Completion plan against a Three.js root.
 * All geometry ops are deterministic; AI only planned them.
 */

import * as THREE from "three";
import {
  SCENE_COMPLETION_OPS,
  type SceneCompletionOp,
  type SceneCompletionPlan,
  type SceneCompletionStep,
  type SceneCompletionStepResult,
  type SceneMeshStats,
} from "../../../shared/sceneCompletion";
import { MIXAMO_25_CORE } from "../../../shared/mixamo25";
import {
  fixMesh,
  fixTerrain,
  groundSnap,
  smoothNormals,
  snapshotTransform,
} from "./editorTools";
import {
  weldVertices,
  sealOpenBacks,
  prepareIslandAsset,
} from "./paintBrush";
import { inspectSceneRig } from "./rigInspect";
import type { HistoryEntry } from "./history";

export interface SceneCompletionExecContext {
  root: THREE.Object3D;
  name: string;
  /** Push undo snapshots */
  pushHistory: (entries: HistoryEntry[]) => void;
  /** Frame camera */
  frame?: (obj: THREE.Object3D) => void;
  /** Ensure animation mixer exists for root */
  ensureMixer?: () => void;
  log?: (msg: string) => void;
}

export function collectSceneMeshStats(root: THREE.Object3D, name: string): SceneMeshStats {
  let meshCount = 0;
  let triangleEstimate = 0;
  let hasSkinnedMesh = false;
  let boneCount = 0;
  root.traverse((n) => {
    if ((n as THREE.Bone).isBone) boneCount++;
    const skinned = n as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) hasSkinnedMesh = true;
    const mesh = n as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      meshCount++;
      const g = mesh.geometry as THREE.BufferGeometry;
      const pos = g.getAttribute("position");
      if (pos) {
        triangleEstimate += g.index ? g.index.count / 3 : pos.count / 3;
      }
    }
  });
  const rig = inspectSceneRig(root);
  return {
    name,
    meshCount,
    triangleEstimate: Math.round(triangleEstimate),
    hasSkinnedMesh: hasSkinnedMesh || rig.hasSkinnedMesh,
    boneCount: Math.max(boneCount, rig.boneCount),
    skeletonType: rig.skeletonType,
    fingerprintLabel: rig.fingerprintLabel,
    openBackRisk: true,
  };
}

function runOp(
  step: SceneCompletionStep,
  ctx: SceneCompletionExecContext,
): SceneCompletionStepResult {
  const { root, pushHistory, frame, ensureMixer, log } = ctx;
  const op = step.op;
  try {
    switch (op) {
      case "diagnose": {
        const stats = collectSceneMeshStats(root, ctx.name);
        const detail = `${stats.meshCount} meshes · ~${stats.triangleEstimate} tris · bones ${stats.boneCount} · skinned ${stats.hasSkinnedMesh ? "yes" : "no"}${stats.fingerprintLabel ? ` · ${stats.fingerprintLabel}` : ""}`;
        log?.(detail);
        return { stepId: step.id, op, ok: true, detail };
      }
      case "fix-mesh": {
        const undos = fixMesh(root);
        pushHistory(undos);
        return { stepId: step.id, op, ok: true, detail: `fixed ${undos.length} mesh(es)` };
      }
      case "weld": {
        const th = step.params?.weldThreshold ?? 0.0015;
        const undos = weldVertices(root, th);
        pushHistory(undos);
        return { stepId: step.id, op, ok: true, detail: `weld thr=${th} · ${undos.length} geo` };
      }
      case "seal": {
        const result = sealOpenBacks(root, { addShell: step.params?.addShell !== false });
        return {
          stepId: step.id,
          op,
          ok: true,
          detail: `shells +${result.shellsAdded} · doubleSide ${result.doubleSided}`,
        };
      }
      case "flip-normals": {
        // use paintBrush flip via dynamic import pattern — call from editorTools if available
        const undos: HistoryEntry[] = [];
        root.traverse((n) => {
          const mesh = n as THREE.Mesh;
          if (!mesh.isMesh || !mesh.geometry) return;
          const g = mesh.geometry as THREE.BufferGeometry;
          const idx = g.getIndex();
          if (idx) {
            const arr = idx.array as Uint16Array | Uint32Array;
            for (let i = 0; i + 2 < arr.length; i += 3) {
              const a = arr[i];
              arr[i] = arr[i + 2];
              arr[i + 2] = a;
            }
            idx.needsUpdate = true;
          }
          const nrm = g.getAttribute("normal") as THREE.BufferAttribute | undefined;
          if (nrm) {
            for (let i = 0; i < nrm.count; i++) {
              nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
            }
            nrm.needsUpdate = true;
          } else {
            g.computeVertexNormals();
          }
        });
        if (undos.length) pushHistory(undos);
        return { stepId: step.id, op, ok: true, detail: "flipped face winding + normals" };
      }
      case "smooth": {
        const undos = smoothNormals(root);
        pushHistory(undos);
        return { stepId: step.id, op, ok: true, detail: `smoothed ${undos.length}` };
      }
      case "ground": {
        pushHistory([snapshotTransform(root)]);
        groundSnap(root);
        return { stepId: step.id, op, ok: true, detail: "grounded Y=0" };
      }
      case "fix-terrain": {
        const undos = fixTerrain(root);
        const hist: HistoryEntry[] = [...undos.geometry];
        if (undos.transform) hist.push(undos.transform);
        pushHistory(hist);
        return { stepId: step.id, op, ok: true, detail: `terrain geo ${undos.geometry.length}` };
      }
      case "island-prep": {
        pushHistory([snapshotTransform(root)]);
        const result = prepareIslandAsset(root);
        if (result.geometry?.length) pushHistory(result.geometry);
        return {
          stepId: step.id,
          op,
          ok: true,
          detail: `welded ${result.welded} · seals ${result.shellsAdded} · ds ${result.doubleSided}`,
        };
      }
      case "inspect-rig": {
        const rig = inspectSceneRig(root);
        const detail = `${rig.skeletonType} · ${rig.boneCount} bones · skinned ${rig.hasSkinnedMesh ? "yes" : "no"}${rig.fingerprintLabel ? ` · ${rig.fingerprintLabel}` : ""} · RH ${rig.attachments.rightHand ?? "—"} · hips ${rig.attachments.hips ?? "—"}`;
        log?.(detail);
        return { stepId: step.id, op, ok: true, detail };
      }
      case "suggest-mixamo25": {
        const rig = inspectSceneRig(root);
        const have = new Set(rig.boneNames.map((b) => b.replace(/^mixamorig:/, "").replace(/:/g, "")));
        const missing = MIXAMO_25_CORE.filter((b) => {
          if (have.has(b)) return false;
          // loose match
          for (const n of have) {
            if (n.toLowerCase() === b.toLowerCase()) return false;
          }
          return true;
        });
        const detail =
          missing.length === 0
            ? `Mixamo-25 core complete (${MIXAMO_25_CORE.length} targets matched)`
            : `Missing ${missing.length}/${MIXAMO_25_CORE.length}: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? "…" : ""}`;
        log?.(detail);
        return {
          stepId: step.id,
          op,
          ok: true,
          detail,
        };
      }
      case "ensure-mixer": {
        ensureMixer?.();
        return { stepId: step.id, op, ok: true, detail: "mixer ready for clip bind/retarget" };
      }
      case "frame": {
        frame?.(root);
        return { stepId: step.id, op, ok: true, detail: "framed" };
      }
      case "note": {
        const msg = step.params?.message ?? step.reason;
        log?.(msg);
        return { stepId: step.id, op, ok: true, detail: msg };
      }
      default:
        return { stepId: step.id, op, ok: false, error: `unknown op: ${String(op)}` };
    }
  } catch (e: unknown) {
    return {
      stepId: step.id,
      op,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function executeSceneCompletionPlan(
  plan: SceneCompletionPlan,
  ctx: SceneCompletionExecContext,
): SceneCompletionStepResult[] {
  const ordered = [...plan.steps].sort((a, b) => a.priority - b.priority);
  const results: SceneCompletionStepResult[] = [];
  for (const step of ordered) {
    if (!SCENE_COMPLETION_OPS[step.op as SceneCompletionOp]) {
      results.push({
        stepId: step.id,
        op: step.op,
        ok: false,
        error: `op not allowlisted: ${step.op}`,
      });
      continue;
    }
    const r = runOp(step, ctx);
    results.push(r);
    ctx.log?.(`${r.ok ? "✓" : "✗"} ${step.op}: ${r.detail ?? r.error ?? ""}`);
  }
  return results;
}
