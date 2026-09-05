import { normalizePrompt3DTextureResolution, type AssetSpecV1 } from "../../shared/prompt3d";

const DRAFT_KEY = "grudge:prompt3d-draft:v1";

export function loadPrompt3DDraft(fallback: AssetSpecV1): AssetSpecV1 {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null") as AssetSpecV1 | null;
    if (!value || value.version !== fallback.version || typeof value.prompt !== "string"
      || !value.dimensions || !value.budgets || !value.coordinateContract) return fallback;
    // Drafts may contain unfinished inputs; the main process validates before a run.
    const merged = { ...fallback, ...value, prompt: value.prompt.slice(0, 2000),
      dimensions: { ...fallback.dimensions, ...value.dimensions },
      budgets: { ...fallback.budgets, ...value.budgets },
      coordinateContract: { ...fallback.coordinateContract, ...value.coordinateContract } };
    return {
      ...merged,
      budgets: {
        ...merged.budgets,
        maxTextureResolution: normalizePrompt3DTextureResolution(merged.providerId, merged.budgets.maxTextureResolution),
      },
    };
  } catch { return fallback; }
}

export function savePrompt3DDraft(spec: AssetSpecV1): void {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(spec));
}
