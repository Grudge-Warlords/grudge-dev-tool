/**
 * Scene Completion AI Worker — shared types + catalog.
 *
 * Plans are JSON-only. Mesh ops run deterministically in the renderer.
 * AI only chooses order/params; it never invents geometry.
 *
 * Best practices (also returned on every plan):
 *  1. Prefer local Ollama when agentic, else Workers AI / Legion hub
 *  2. Low temperature (0.15–0.35) for structured JSON
 *  3. Cap tokens; require schema validation before execute
 *  4. Diagnose → repair → rig → frame (never skip diagnose on broken meshes)
 *  5. Weld before seal; ground before island-prep; fix-mesh before retarget
 *  6. Never drop user history — each op must be undoable in the UI layer
 *  7. Track provider + latency for observatory / status bar
 */

export const SCENE_COMPLETION_VERSION = 1;

/** Deterministic mesh / rig ops the executor understands. */
export type SceneCompletionOp =
  | "diagnose"
  | "fix-mesh"
  | "weld"
  | "seal"
  | "flip-normals"
  | "smooth"
  | "ground"
  | "fix-terrain"
  | "island-prep"
  | "inspect-rig"
  | "suggest-mixamo25"
  | "ensure-mixer"
  | "frame"
  | "note";

export interface SceneCompletionStep {
  id: string;
  op: SceneCompletionOp;
  /** Human reason for this step */
  reason: string;
  /** Lower runs first */
  priority: number;
  params?: {
    /** Weld distance (default 0.001–0.002) */
    weldThreshold?: number;
    /** Seal open backs with shell */
    addShell?: boolean;
    /** Free-form note text */
    message?: string;
  };
}

export interface SceneMeshStats {
  meshCount: number;
  triangleEstimate: number;
  hasSkinnedMesh: boolean;
  boneCount: number;
  skeletonType?: string;
  fingerprintLabel?: string | null;
  openBackRisk?: boolean;
  name: string;
}

export interface SceneCompletionRequest {
  /** Asset / scene name */
  name: string;
  stats: SceneMeshStats;
  /** Optional user goal, e.g. "prep for warlords character" */
  goal?: string;
  /** Force a preset pipeline without LLM */
  mode?: "auto" | "mesh-repair" | "island" | "character-rig" | "full";
  /** Prefer ollama / workers-ai / legion */
  providerHint?: string;
}

export interface SceneCompletionPlan {
  version: typeof SCENE_COMPLETION_VERSION;
  summary: string;
  confidence: number;
  steps: SceneCompletionStep[];
  risks: string[];
  bestPractices: string[];
  /** How the plan was produced */
  source: "heuristic" | "ai" | "hybrid";
  provider?: string;
  model?: string;
  latencyMs?: number;
}

export interface SceneCompletionStepResult {
  stepId: string;
  op: SceneCompletionOp;
  ok: boolean;
  detail?: string;
  error?: string;
}

export interface SceneCompletionRunResult {
  plan: SceneCompletionPlan;
  results: SceneCompletionStepResult[];
  ok: boolean;
}

/** Catalog of ops for prompts + UI. */
export const SCENE_COMPLETION_OPS: Record<
  SceneCompletionOp,
  { label: string; category: "mesh" | "rig" | "meta"; hint: string }
> = {
  diagnose: { label: "Diagnose", category: "meta", hint: "Inspect mesh/rig health" },
  "fix-mesh": { label: "Fix mesh", category: "mesh", hint: "Normals, NaN, bounds" },
  weld: { label: "Weld", category: "mesh", hint: "Weld open edge cracks" },
  seal: { label: "Seal / patch", category: "mesh", hint: "Close open backs / island shells" },
  "flip-normals": { label: "Flip normals", category: "mesh", hint: "Invert face winding" },
  smooth: { label: "Smooth", category: "mesh", hint: "Recompute smooth normals" },
  ground: { label: "Ground", category: "mesh", hint: "Snap lowest point to Y=0" },
  "fix-terrain": { label: "Fix terrain", category: "mesh", hint: "Flatten base / terrain fix" },
  "island-prep": { label: "Island prep", category: "mesh", hint: "Ground + weld + seal pipeline" },
  "inspect-rig": { label: "Inspect rig", category: "rig", hint: "Bone count, fingerprint, attachments" },
  "suggest-mixamo25": { label: "Mixamo-25 check", category: "rig", hint: "Compare to Studio Mixamo-25 set" },
  "ensure-mixer": { label: "Anim mixer", category: "rig", hint: "Ensure AnimationMixer ready for clips" },
  frame: { label: "Frame", category: "meta", hint: "Frame camera on asset" },
  note: { label: "Note", category: "meta", hint: "Advisory only" },
};

export const SCENE_COMPLETION_BEST_PRACTICES: string[] = [
  "Diagnose before destructive ops (weld/seal change topology).",
  "Weld cracks before sealing open backs — seal on broken seams multiplies holes.",
  "Fix mesh (normals/NaN) before skeleton retarget or animation bind.",
  "Ground props after topology so feet/base sit on Y=0 for game import.",
  "Island assets: prefer island-prep (ground → weld → seal) as a single pipeline.",
  "Character rigs: inspect-rig → suggest-mixamo25 → ensure-mixer before clip import.",
  "Use low temperature JSON plans; validate ops against the allowlist before execute.",
  "Prefer Ollama when GRUDACHAIN is agentic; fall back to Workers AI / Legion hub.",
  "Keep each step undoable; never auto-export or overwrite R2 without confirmation.",
  "Track provider + latency; surface failures without aborting the whole plan mid-way when possible.",
];

const ALLOWED = new Set<string>(Object.keys(SCENE_COMPLETION_OPS));

export function isSceneCompletionOp(op: string): op is SceneCompletionOp {
  return ALLOWED.has(op);
}

/** Validate + normalize an AI/heuristic plan. */
export function normalizeSceneCompletionPlan(
  raw: unknown,
  fallback: SceneCompletionPlan,
): SceneCompletionPlan {
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  const stepsIn = Array.isArray(o.steps) ? o.steps : [];
  const steps: SceneCompletionStep[] = [];
  for (let i = 0; i < stepsIn.length; i++) {
    const s = stepsIn[i] as Record<string, unknown>;
    if (!s || typeof s.op !== "string" || !isSceneCompletionOp(s.op)) continue;
    steps.push({
      id: String(s.id ?? `step-${i + 1}`),
      op: s.op,
      reason: String(s.reason ?? SCENE_COMPLETION_OPS[s.op].hint),
      priority: Number.isFinite(Number(s.priority)) ? Number(s.priority) : (i + 1) * 10,
      params: (s.params as SceneCompletionStep["params"]) ?? undefined,
    });
  }
  if (!steps.length) return fallback;
  steps.sort((a, b) => a.priority - b.priority);
  return {
    version: SCENE_COMPLETION_VERSION,
    summary: String(o.summary ?? fallback.summary),
    confidence: Math.min(1, Math.max(0, Number(o.confidence) || fallback.confidence)),
    steps,
    risks: Array.isArray(o.risks) ? o.risks.map(String) : fallback.risks,
    bestPractices: Array.isArray(o.bestPractices)
      ? o.bestPractices.map(String)
      : SCENE_COMPLETION_BEST_PRACTICES.slice(0, 6),
    source: (o.source as SceneCompletionPlan["source"]) || "ai",
    provider: o.provider != null ? String(o.provider) : fallback.provider,
    model: o.model != null ? String(o.model) : fallback.model,
    latencyMs: o.latencyMs != null ? Number(o.latencyMs) : fallback.latencyMs,
  };
}

/**
 * Deterministic heuristic plan — always available offline.
 * AI can refine but must not invent ops outside the allowlist.
 */
export function buildHeuristicSceneCompletionPlan(
  req: SceneCompletionRequest,
): SceneCompletionPlan {
  const { stats, mode = "auto", goal } = req;
  const steps: SceneCompletionStep[] = [];
  const risks: string[] = [];
  let p = 10;

  const add = (op: SceneCompletionOp, reason: string, params?: SceneCompletionStep["params"]) => {
    steps.push({ id: `h-${op}-${p}`, op, reason, priority: p, params });
    p += 10;
  };

  add("diagnose", "Baseline mesh/rig health before repairs");

  const wantMesh =
    mode === "mesh-repair" ||
    mode === "full" ||
    mode === "island" ||
    mode === "auto";
  const wantIsland =
    mode === "island" ||
    /island|terrain|prop|building/i.test(goal ?? "") ||
    /island|terrain|prop/i.test(stats.name);
  const wantRig =
    mode === "character-rig" ||
    mode === "full" ||
    stats.hasSkinnedMesh ||
    stats.boneCount > 0 ||
    /character|hero|npc|rig|mixamo|skeleton/i.test(goal ?? stats.name);

  if (wantMesh) {
    add("fix-mesh", "Repair normals / NaN / degenerate bounds");
    if (wantIsland) {
      add("island-prep", "Island pipeline: ground → weld → seal patch", {
        weldThreshold: 0.002,
        addShell: true,
      });
    } else {
      add("weld", "Weld open edge cracks before patching", { weldThreshold: 0.0015 });
      if (stats.openBackRisk !== false) {
        add("seal", "Patch / seal open backs and thin shells", { addShell: true });
      }
      add("ground", "Snap lowest point to Y=0 for game import");
    }
    add("smooth", "Recompute smooth normals after topology ops");
  }

  if (wantRig) {
    if (stats.boneCount === 0 && !stats.hasSkinnedMesh) {
      risks.push("No skeleton detected — Mixamo-25 check will report missing bones; retarget needs a rigged source.");
    }
    add("inspect-rig", "Fingerprint skeleton type and attachment bones");
    add("suggest-mixamo25", "Compare joints to Grudge Studio Mixamo-25 catalog");
    if (stats.hasSkinnedMesh || stats.boneCount > 0) {
      add("ensure-mixer", "Ensure AnimationMixer is ready for clip bind/retarget");
    }
  }

  add("frame", "Frame camera on completed asset");

  const summaryParts = [
    wantIsland ? "island prep" : "mesh repair",
    wantRig ? "rig inspect" : null,
  ].filter(Boolean);

  return {
    version: SCENE_COMPLETION_VERSION,
    summary: `Scene completion (${summaryParts.join(" + ")})${goal ? `: ${goal}` : ""}`,
    confidence: 0.72,
    steps,
    risks,
    bestPractices: SCENE_COMPLETION_BEST_PRACTICES.slice(0, 7),
    source: "heuristic",
  };
}
