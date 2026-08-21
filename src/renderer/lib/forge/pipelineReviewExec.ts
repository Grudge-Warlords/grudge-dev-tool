/**
 * Execute a Pipeline Review plan against the Three Pipeline scene.
 * Convert / R2 / HEAD stay in main (callbacks). Geometry/clip ops are local.
 */

import * as THREE from "three";
import {
  type PipelineReviewOp,
  type PipelineReviewPlan,
  type PipelineReviewStats,
  type PipelineReviewStep,
  type PipelineReviewStepResult,
} from "../../../shared/pipelineReview";
import { measureObjectSi } from "./siMeasure";
import { inspectSceneRig } from "./rigInspect";

export interface PipelineReviewExecContext {
  root: THREE.Object3D;
  clips: THREE.AnimationClip[];
  name: string;
  stats: PipelineReviewStats;
  ensureMixer?: () => void;
  log?: (msg: string) => void;
  convert?: () => Promise<{ ok: boolean; detail?: string; error?: string }>;
  optimizeWeb?: () => Promise<{ ok: boolean; detail?: string; error?: string }>;
  uploadR2?: () => Promise<{ ok: boolean; detail?: string; error?: string }>;
  seedD1?: () => Promise<{ ok: boolean; detail?: string; error?: string }>;
  headCdn?: () => Promise<{ ok: boolean; detail?: string; error?: string }>;
  sendThreeFlow?: () => Promise<{ ok: boolean; detail?: string; error?: string }>;
}

export function collectPipelineReviewStats(args: {
  root: THREE.Object3D;
  name: string;
  format?: string;
  localPath?: string | null;
  clips?: THREE.AnimationClip[];
  missingMaps?: number;
  sizeBytes?: number;
}): PipelineReviewStats {
  const { root, name } = args;
  let meshCount = 0;
  let triangles = 0;
  let vertices = 0;
  let boneCount = 0;
  let hasSkinnedMesh = false;
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
        vertices += pos.count;
        triangles += g.index ? g.index.count / 3 : pos.count / 3;
      }
    }
  });
  const si = measureObjectSi(root);
  const rig = inspectSceneRig(root);
  const ext = (name.toLowerCase().match(/\.[a-z0-9]+$/) || [""])[0];
  return {
    name,
    format: (args.format || ext.replace(".", "") || "glb").toLowerCase(),
    ext,
    localPath: args.localPath ?? null,
    meshCount,
    triangles: Math.round(triangles),
    vertices: Math.round(vertices),
    bones: Math.max(boneCount, rig.boneCount),
    clips: args.clips?.length ?? 0,
    hasSkinnedMesh: hasSkinnedMesh || rig.hasSkinnedMesh,
    siHeightM: si.h,
    siWidthM: si.w,
    siSource: si.source,
    missingMaps: args.missingMaps ?? 0,
    skeletonType: rig.skeletonType,
    rightHand: rig.attachments.rightHand,
    leftHand: rig.attachments.leftHand,
    sizeBytes: args.sizeBytes,
  };
}

/** Strip bone `.position` tracks; keep root / hips / Bip001 translation. */
export function stripBonePositionTracks(clips: THREE.AnimationClip[]): number {
  let n = 0;
  for (const clip of clips) {
    const next = clip.tracks.filter((t) => {
      if (!/\.position$/.test(t.name)) return true;
      const bone = t.name.replace(/\.position$/, "").split("/").pop() || "";
      if (/^(hips|root|armature|bip001|scene)$/i.test(bone)) return true;
      n++;
      return false;
    });
    if (next.length !== clip.tracks.length) {
      clip.tracks = next;
    }
  }
  return n;
}

function lateralityDetail(stats: PipelineReviewStats): { ok: boolean; detail: string } {
  const r = stats.rightHand;
  const l = stats.leftHand;
  if (!r && !l) {
    return { ok: false, detail: "No L/R hand bones — weapon attach will miss" };
  }
  if (!r) return { ok: false, detail: `Left hand ${l}, missing right hand` };
  if (!l) return { ok: false, detail: `Right hand ${r}, missing left hand` };
  const swapped =
    /left|l_|_l\b|lhand/i.test(r) || /right|r_|_r\b|rhand/i.test(l);
  if (swapped) {
    return { ok: false, detail: `Hand names look swapped (R=${r} L=${l}) — do not retarget over a mirrored bind` };
  }
  return { ok: true, detail: `R=${r} · L=${l}` };
}

async function runOp(
  step: PipelineReviewStep,
  ctx: PipelineReviewExecContext,
): Promise<PipelineReviewStepResult> {
  const { log } = ctx;
  const fail = (error: string): PipelineReviewStepResult => ({
    stepId: step.id,
    op: step.op,
    ok: false,
    error,
  });
  const ok = (detail: string): PipelineReviewStepResult => ({
    stepId: step.id,
    op: step.op,
    ok: true,
    detail,
  });

  const runCb = async (
    fn: undefined | (() => Promise<{ ok: boolean; detail?: string; error?: string }>),
    missing: string,
  ) => {
    if (!fn) return fail(missing);
    const r = await fn();
    return r.ok ? ok(r.detail || step.reason) : fail(r.error || missing);
  };

  switch (step.op as PipelineReviewOp) {
    case "diagnose": {
      const s = ctx.stats;
      const detail = [
        `${s.meshCount} mesh`,
        `${s.triangles} tris`,
        `${s.bones} bones`,
        `${s.clips} clips`,
        `SI h=${s.siHeightM.toFixed(2)} m (${s.siSource})`,
        s.missingMaps ? `${s.missingMaps} missing maps` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      log?.(detail);
      return ok(detail);
    }
    case "laterality": {
      const r = lateralityDetail(ctx.stats);
      log?.(r.detail);
      return r.ok ? ok(r.detail) : fail(r.detail);
    }
    case "strip-position": {
      const n = stripBonePositionTracks(ctx.clips);
      const detail = n ? `stripped ${n} bone position track(s)` : "no extra position tracks";
      log?.(detail);
      return ok(detail);
    }
    case "measure-2m": {
      const msg =
        step.params?.message ||
        `SI height ${ctx.stats.siHeightM.toFixed(2)} m — Shift+Ctrl+LMB drag a span that should be 2 m`;
      log?.(msg);
      return ok(msg);
    }
    case "ensure-mixer": {
      ctx.ensureMixer?.();
      log?.("mixer ready");
      return ok("one mixer");
    }
    case "convert":
      return runCb(ctx.convert, "convert callback missing");
    case "optimize-web":
      return runCb(ctx.optimizeWeb, "optimize callback missing");
    case "upload-r2":
      return runCb(ctx.uploadR2, "upload callback missing");
    case "seed-d1":
      return runCb(ctx.seedD1, "seed callback missing");
    case "head-cdn":
      return runCb(ctx.headCdn, "HEAD callback missing");
    case "send-threeflow":
      return runCb(ctx.sendThreeFlow, "ThreeFlow callback missing");
    case "note": {
      const msg = step.params?.message || step.reason;
      log?.(msg);
      return ok(msg);
    }
    default:
      return fail(`unknown op ${step.op}`);
  }
}

export async function executePipelineReviewPlan(
  plan: PipelineReviewPlan,
  ctx: PipelineReviewExecContext,
): Promise<PipelineReviewStepResult[]> {
  const results: PipelineReviewStepResult[] = [];
  for (const step of plan.steps) {
    ctx.log?.(`${step.op}: ${step.reason}`);
    try {
      results.push(await runOp(step, ctx));
    } catch (e: unknown) {
      results.push({
        stepId: step.id,
        op: step.op,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}
