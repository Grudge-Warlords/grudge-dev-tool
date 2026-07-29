/**
 * Scene Completion AI Worker (main process).
 *
 * Produces a validated JSON plan for weld / patch / skeleton / mesh pipelines.
 * Follows AI worker best practices: low temperature, schema allowlist,
 * heuristic fallback, telemetry-friendly metadata.
 */

import { aiChat } from "./aiWorkerManager";
import {
  SCENE_COMPLETION_BEST_PRACTICES,
  SCENE_COMPLETION_OPS,
  SCENE_COMPLETION_VERSION,
  buildHeuristicSceneCompletionPlan,
  normalizeSceneCompletionPlan,
  type SceneCompletionPlan,
  type SceneCompletionRequest,
} from "../../shared/sceneCompletion";

const SYSTEM_PROMPT = `You are the Grudge Studio Scene Completion AI Worker.
You plan mesh repair and skeleton prep for game assets. You do NOT invent geometry.

Return ONLY compact JSON (no markdown fences):
{
  "summary": "one line",
  "confidence": 0.0-1.0,
  "steps": [
    { "id": "1", "op": "fix-mesh", "reason": "...", "priority": 10, "params": {} }
  ],
  "risks": ["..."],
  "bestPractices": ["..."]
}

ALLOWED ops only: ${Object.keys(SCENE_COMPLETION_OPS).join(", ")}

Pipeline rules (best practices):
1. Always start with diagnose when mesh may be broken.
2. fix-mesh before weld/seal when normals/NaN likely.
3. weld before seal (patch open backs).
4. ground after topology for props; island-prep for islands (ground+weld+seal).
5. For characters: inspect-rig → suggest-mixamo25 → ensure-mixer.
6. End with frame when helpful.
7. Keep 3–12 steps. Prefer conservative weldThreshold 0.001–0.002.
8. Include 2–5 bestPractices strings relevant to this asset.`;

function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* continue */
  }
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("Scene completion AI returned non-JSON");
}

/**
 * Build a completion plan. Uses AI when available; always merges/falls back
 * to the deterministic heuristic so the UI can execute offline.
 */
export async function planSceneCompletion(
  req: SceneCompletionRequest,
): Promise<SceneCompletionPlan> {
  const heuristic = buildHeuristicSceneCompletionPlan(req);

  // Pure heuristic modes (no LLM cost). AI refine only for auto/full.
  if (req.mode === "mesh-repair" || req.mode === "island" || req.mode === "character-rig") {
    return { ...heuristic, source: "heuristic" };
  }

  const user = [
    `Asset: ${req.name}`,
    `mode: ${req.mode ?? "auto"}`,
    req.goal ? `goal: ${req.goal}` : null,
    `stats: ${JSON.stringify(req.stats)}`,
    "",
    "Heuristic draft (you may refine order/params, keep allowlisted ops only):",
    JSON.stringify({ summary: heuristic.summary, steps: heuristic.steps }, null, 0),
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await aiChat({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_tokens: 900,
      track: true,
      model: req.providerHint === "ollama" ? "ollama" : undefined,
      provider: req.providerHint as any,
    });

    const parsed = extractJson(res.text);
    const plan = normalizeSceneCompletionPlan(parsed, heuristic);
    return {
      ...plan,
      source: plan.steps.length ? "hybrid" : "heuristic",
      provider: res.provider,
      model: res.model,
      latencyMs: res.latencyMs,
      bestPractices:
        plan.bestPractices.length > 0
          ? plan.bestPractices
          : SCENE_COMPLETION_BEST_PRACTICES.slice(0, 6),
      version: SCENE_COMPLETION_VERSION,
    };
  } catch (err) {
    return {
      ...heuristic,
      source: "heuristic",
      risks: [
        ...heuristic.risks,
        `AI planner unavailable: ${err instanceof Error ? err.message : String(err)} — using heuristic pipeline`,
      ],
      bestPractices: SCENE_COMPLETION_BEST_PRACTICES.slice(0, 6),
    };
  }
}

/** Registry entry for fleet AI worker listings. */
export function sceneCompletionWorkerInfo() {
  return {
    id: "scene-completion",
    name: "Scene Completion",
    description:
      "Plans weld, seal/patch, mesh fix, island prep, and Mixamo-25 skeleton checks for Forge assets",
    ops: Object.keys(SCENE_COMPLETION_OPS),
    bestPractices: SCENE_COMPLETION_BEST_PRACTICES,
    version: SCENE_COMPLETION_VERSION,
  };
}
