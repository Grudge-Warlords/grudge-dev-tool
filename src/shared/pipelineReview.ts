/**
 * Pipeline Review AI Worker — shared types + catalog.
 *
 * Plans JSON-only. Convert / magic / R2 / D1 / CDN HEAD run in main.
 * Scene ops (laterality, strip-position, mixer) run in the renderer.
 * AI chooses order/params; it never invents meshes or a second editor.
 *
 * Closes the three 1.1.0 gaps that should already have been automated:
 *  1. Convert-before-upload + magic-byte + CDN HEAD after R2
 *  2. File-defaults / doctor play-kit smoke (main launch + fleet probes)
 *  3. This worker — diagnose SI / laterality / convert / optimize / index
 */

export const PIPELINE_REVIEW_VERSION = 1;

export type PipelineReviewOp =
  | "diagnose"
  | "convert"
  | "laterality"
  | "strip-position"
  | "measure-2m"
  | "ensure-mixer"
  | "optimize-web"
  | "upload-r2"
  | "seed-d1"
  | "head-cdn"
  | "send-threeflow"
  | "note";

export type PipelineReviewMode = "auto" | "convert-upload" | "character" | "si-only";

export interface PipelineReviewStep {
  id: string;
  op: PipelineReviewOp;
  reason: string;
  priority: number;
  params?: {
    message?: string;
    targetFormat?: "glb" | "gltf";
  };
}

export interface PipelineReviewStats {
  name: string;
  format: string;
  ext: string;
  localPath?: string | null;
  meshCount: number;
  triangles: number;
  vertices: number;
  bones: number;
  clips: number;
  hasSkinnedMesh: boolean;
  siHeightM: number;
  siWidthM: number;
  siSource: "bones" | "mesh" | "unknown";
  missingMaps: number;
  skeletonType?: string;
  rightHand?: string | null;
  leftHand?: string | null;
  sizeBytes?: number;
}

export interface PipelineReviewRequest {
  name: string;
  stats: PipelineReviewStats;
  goal?: string;
  mode?: PipelineReviewMode;
  providerHint?: string;
}

export interface PipelineReviewPlan {
  version: typeof PIPELINE_REVIEW_VERSION;
  summary: string;
  confidence: number;
  steps: PipelineReviewStep[];
  risks: string[];
  bestPractices: string[];
  source: "heuristic" | "ai" | "hybrid";
  provider?: string;
  model?: string;
  latencyMs?: number;
}

export interface PipelineReviewStepResult {
  stepId: string;
  op: PipelineReviewOp;
  ok: boolean;
  detail?: string;
  error?: string;
}

export const PIPELINE_REVIEW_OPS: Record<
  PipelineReviewOp,
  { label: string; category: "prep" | "scene" | "cdn" | "meta"; hint: string }
> = {
  diagnose: { label: "Diagnose", category: "meta", hint: "SI, clips, maps, skeleton" },
  convert: { label: "Convert → GLB", category: "prep", hint: "FBX/OBJ/… → production GLB before R2" },
  laterality: { label: "Laterality", category: "scene", hint: "L/R hand bones on the same skeleton" },
  "strip-position": { label: "Strip position tracks", category: "scene", hint: "Bones-only rematch; keep root/hips" },
  "measure-2m": { label: "SI 2 m", category: "scene", hint: "Shift+Ctrl+LMB span = 2 m if height is off" },
  "ensure-mixer": { label: "Anim mixer", category: "scene", hint: "One AnimationMixer on this root" },
  "optimize-web": { label: "Optimize web", category: "prep", hint: "grudge-web-v1 gltf-transform" },
  "upload-r2": { label: "Upload R2", category: "cdn", hint: "Signed PUT of converted GLB" },
  "seed-d1": { label: "Seed D1", category: "cdn", hint: "os.registerAsset index row (not player SSOT)" },
  "head-cdn": { label: "HEAD CDN", category: "cdn", hint: "HEAD + magic-byte on assets.grudge-studio.com" },
  "send-threeflow": { label: "ThreeFlow", category: "meta", hint: "Explicit scene-edit handoff" },
  note: { label: "Note", category: "meta", hint: "Advisory only" },
};

export const PIPELINE_REVIEW_BEST_PRACTICES: string[] = [
  "Convert FBX/OBJ/STL to GLB before any R2 PUT — never upload DCC source as play mesh.",
  "Magic-byte the file: glTF magic, not HTML error pages or empty JSON stubs.",
  "HEAD assets.grudge-studio.com after PUT; reject HTML Content-Type even on HTTP 200.",
  "D1 is the asset INDEX only — seed r2_key + cdn_url; never bag/XP.",
  "SI: 1 unit = 1 m. Human ~1.8 m. If height > 8 m or < 0.3 m, use Shift+Ctrl+LMB 2 m span.",
  "One AnimationMixer. Strip bone position tracks (keep root/hips) before clip rematch.",
  "Laterality: right-hand bone on +X, left on −X. Do not swap names to 'fix' a mirrored bind.",
  "Play bodies stay Toon RTS {race}.glb via loadRaceKit — not Meshy, capsule, or raw FBX.",
  "JSON plans, low temperature, allowlisted ops, heuristic fallback if AI is down.",
  "Never auto-publish R2 unless the user chose Review + send. Explorer defaults are HKCU file-defaults.",
];

const ALLOWED = new Set<string>(Object.keys(PIPELINE_REVIEW_OPS));

export const CONVERT_EXTS = new Set([
  ".fbx",
  ".obj",
  ".stl",
  ".ply",
  ".dae",
  ".blend",
  ".3mf",
  ".gltf",
]);

export function isPipelineReviewOp(op: string): op is PipelineReviewOp {
  return ALLOWED.has(op);
}

export function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : "";
}

export function needsConvert(stats: PipelineReviewStats): boolean {
  const ext = (stats.ext || extOf(stats.name) || `.${stats.format}`).toLowerCase();
  const e = ext.startsWith(".") ? ext : `.${ext}`;
  return CONVERT_EXTS.has(e);
}

export function siLooksWrong(stats: PipelineReviewStats): boolean {
  if (!(stats.siHeightM > 0)) return false;
  if (stats.hasSkinnedMesh || stats.bones >= 8) {
    return stats.siHeightM > 8 || stats.siHeightM < 0.3;
  }
  return stats.siHeightM > 80;
}

/** Validate + normalize an AI/heuristic plan. */
export function normalizePipelineReviewPlan(
  raw: unknown,
  fallback: PipelineReviewPlan,
): PipelineReviewPlan {
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  const stepsIn = Array.isArray(o.steps) ? o.steps : [];
  const steps: PipelineReviewStep[] = [];
  for (let i = 0; i < stepsIn.length; i++) {
    const s = stepsIn[i] as Record<string, unknown>;
    if (!s || typeof s.op !== "string" || !isPipelineReviewOp(s.op)) continue;
    steps.push({
      id: String(s.id ?? `step-${i + 1}`),
      op: s.op,
      reason: String(s.reason ?? PIPELINE_REVIEW_OPS[s.op].hint),
      priority: Number.isFinite(Number(s.priority)) ? Number(s.priority) : (i + 1) * 10,
      params: (s.params as PipelineReviewStep["params"]) ?? undefined,
    });
  }
  if (!steps.length) return fallback;
  steps.sort((a, b) => a.priority - b.priority);
  return {
    version: PIPELINE_REVIEW_VERSION,
    summary: String(o.summary ?? fallback.summary),
    confidence: Math.min(1, Math.max(0, Number(o.confidence) || fallback.confidence)),
    steps,
    risks: Array.isArray(o.risks) ? o.risks.map(String) : fallback.risks,
    bestPractices: Array.isArray(o.bestPractices)
      ? o.bestPractices.map(String)
      : PIPELINE_REVIEW_BEST_PRACTICES.slice(0, 6),
    source: (o.source as PipelineReviewPlan["source"]) || "ai",
    provider: o.provider != null ? String(o.provider) : fallback.provider,
    model: o.model != null ? String(o.model) : fallback.model,
    latencyMs: o.latencyMs != null ? Number(o.latencyMs) : fallback.latencyMs,
  };
}

/**
 * Deterministic heuristic — always available offline.
 * AI may refine order/params; must not invent ops outside the allowlist.
 */
export function buildHeuristicPipelineReviewPlan(
  req: PipelineReviewRequest,
): PipelineReviewPlan {
  const { stats, mode = "auto", goal } = req;
  const steps: PipelineReviewStep[] = [];
  const risks: string[] = [];
  let p = 10;

  const add = (op: PipelineReviewOp, reason: string, params?: PipelineReviewStep["params"]) => {
    steps.push({ id: `h-${op}-${p}`, op, reason, priority: p, params });
    p += 10;
  };

  const wantUpload =
    mode === "convert-upload" ||
    /upload|r2|cdn|d1|publish|index/i.test(goal ?? "");
  const wantCharacter =
    mode === "character" ||
    stats.hasSkinnedMesh ||
    stats.bones > 0 ||
    /character|hero|npc|rig|mixamo|skeleton|toon/i.test(goal ?? stats.name);
  const wantSi = mode === "si-only" || mode === "auto" || mode === "character" || wantCharacter;

  add("diagnose", "Baseline SI / clips / maps / skeleton before convert or CDN");

  if (mode !== "si-only" && needsConvert(stats)) {
    add("convert", `Convert ${stats.ext || stats.format} → GLB before R2 (FBX2glTF / Blender)`, {
      targetFormat: "glb",
    });
  } else if (wantUpload && !/\.glb$/i.test(stats.name) && stats.format !== "glb") {
    risks.push("Upload target is not GLB — convert first or the CDN will serve a DCC file.");
    add("convert", "Force GLB for CDN play mesh", { targetFormat: "glb" });
  }

  if (wantSi && siLooksWrong(stats)) {
    risks.push(
      `SI height ${stats.siHeightM.toFixed(2)} m (${stats.siSource}) — likely cm-as-m or 100×. Use Shift+Ctrl+LMB 2 m span.`,
    );
    add("measure-2m", "Height off human/orc yardstick — set a 2 m span, do not guess a scale");
  }

  if (wantCharacter && mode !== "si-only") {
    if (!stats.rightHand || !stats.leftHand) {
      risks.push("Missing left or right hand bone — laterality / weapon attach will fail.");
    }
    add("laterality", "Check L/R hand bones on this skeleton (do not invent a second mixer)");
    if (stats.clips > 0) {
      add("strip-position", "Strip bone position tracks; keep root/hips translation");
      add("ensure-mixer", "Ensure one AnimationMixer on this root");
    }
  }

  if (stats.missingMaps > 0) {
    risks.push(`${stats.missingMaps} material(s) have no map — convert with sibling textures, not a lone .gltf.`);
  }

  if (wantUpload) {
    if ((stats.sizeBytes ?? 0) > 4 * 1024 * 1024 || stats.triangles > 80_000) {
      add("optimize-web", "gltf-transform grudge-web-v1 before PUT");
    }
    add("upload-r2", "Signed PUT of converted GLB to models/pipeline/…");
    add("seed-d1", "Index r2_key on D1/ObjectStore — not player bag");
    add("head-cdn", "HEAD + magic-byte on assets.grudge-studio.com after PUT");
  } else if (mode === "auto") {
    add(
      "note",
      "Send to R2 + D1 now converts, magic-bytes, and HEADs. Use Review + send to run that from this worker.",
    );
  }

  if (/threeflow|edit scene/i.test(goal ?? "")) {
    add("send-threeflow", "Explicit ThreeFlow handoff (no iframe)");
  }

  const parts = [
    needsConvert(stats) ? "convert" : null,
    wantCharacter ? "character" : null,
    siLooksWrong(stats) ? "SI" : null,
    wantUpload ? "R2+HEAD" : null,
  ].filter(Boolean);

  return {
    version: PIPELINE_REVIEW_VERSION,
    summary: `Pipeline review (${parts.join(" + ") || "diagnose"})${goal ? `: ${goal}` : ""}`,
    confidence: 0.74,
    steps,
    risks,
    bestPractices: PIPELINE_REVIEW_BEST_PRACTICES.slice(0, 8),
    source: "heuristic",
  };
}
