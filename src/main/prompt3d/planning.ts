import type { AssetCategory, AssetSpecV1, AssetStyle } from "../../shared/prompt3d";

const CATEGORIES: AssetCategory[] = ["prop", "building", "road-furniture", "environment"];
const STYLES: AssetStyle[] = ["realistic", "stylized", "low-poly", "hand-painted", "industrial", "custom"];
const TOP_LEVEL_FIELDS = new Set([
  "generationPrompt",
  "category",
  "style",
  "customStyle",
  "dimensions",
  "budgets",
  "generateTextures",
  "generateCollision",
  "generateLods",
  "summary",
]);

type PlannedFields = {
  generationPrompt?: unknown;
  category?: unknown;
  style?: unknown;
  customStyle?: unknown;
  dimensions?: unknown;
  budgets?: unknown;
  generateTextures?: unknown;
  generateCollision?: unknown;
  generateLods?: unknown;
  summary?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maximum ? trimmed : null;
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

/**
 * Applies only allowlisted, typed planner fields. Provider, route, seed,
 * variants, target format and coordinate contract always remain user-owned.
 */
export function applyPrompt3DPlanProposal(
  current: AssetSpecV1,
  value: unknown,
): { spec: AssetSpecV1; summary: string; warnings: string[] } {
  if (!isRecord(value)) throw new Error("The local planner did not return a JSON object.");
  const proposal = value as PlannedFields;
  const warnings = Object.keys(value)
    .filter((key) => !TOP_LEVEL_FIELDS.has(key))
    .map((key) => `Ignored non-allowlisted planner field: ${key}`);
  const next = structuredClone(current);

  const generationPrompt = boundedString(proposal.generationPrompt, 2_000);
  if (generationPrompt) next.prompt = generationPrompt;
  else if (proposal.generationPrompt !== undefined) warnings.push("Ignored invalid generationPrompt.");

  if (CATEGORIES.includes(proposal.category as AssetCategory)) next.category = proposal.category as AssetCategory;
  else if (proposal.category !== undefined) warnings.push("Ignored unsupported asset category.");

  if (STYLES.includes(proposal.style as AssetStyle)) next.style = proposal.style as AssetStyle;
  else if (proposal.style !== undefined) warnings.push("Ignored unsupported style.");

  if (next.style === "custom") {
    const customStyle = boundedString(proposal.customStyle, 200);
    if (customStyle) next.customStyle = customStyle;
    else if (proposal.customStyle !== undefined) warnings.push("Ignored invalid custom style.");
  } else {
    delete next.customStyle;
  }

  if (proposal.dimensions !== undefined) {
    if (isRecord(proposal.dimensions)
      && finiteInRange(proposal.dimensions.width, 0.001, 10_000)
      && finiteInRange(proposal.dimensions.height, 0.001, 10_000)
      && finiteInRange(proposal.dimensions.depth, 0.001, 10_000)
      && (proposal.dimensions.unit === "m" || proposal.dimensions.unit === "cm")) {
      next.dimensions = {
        width: proposal.dimensions.width,
        height: proposal.dimensions.height,
        depth: proposal.dimensions.depth,
        unit: proposal.dimensions.unit,
      };
    } else warnings.push("Ignored invalid dimensions.");
  }

  if (proposal.budgets !== undefined) {
    if (isRecord(proposal.budgets)
      && Number.isInteger(proposal.budgets.maxTriangles)
      && finiteInRange(proposal.budgets.maxTriangles, 100, 2_000_000)
      && [512, 1024, 2048, 4096].includes(proposal.budgets.maxTextureResolution as number)
      && Number.isSafeInteger(proposal.budgets.maxTextureBytes)
      && finiteInRange(proposal.budgets.maxTextureBytes, 1, 512 * 1024 ** 2)) {
      next.budgets = {
        maxTriangles: proposal.budgets.maxTriangles,
        maxTextureResolution: proposal.budgets.maxTextureResolution as 512 | 1024 | 2048 | 4096,
        maxTextureBytes: proposal.budgets.maxTextureBytes,
      };
    } else warnings.push("Ignored invalid generation budgets.");
  }

  for (const field of ["generateTextures", "generateCollision", "generateLods"] as const) {
    if (typeof proposal[field] === "boolean") next[field] = proposal[field];
    else if (proposal[field] !== undefined) warnings.push(`Ignored invalid ${field}.`);
  }

  return {
    spec: next,
    summary: boundedString(proposal.summary, 500) ?? "Local Ollama proposed allowlisted AssetSpec fields.",
    warnings,
  };
}
