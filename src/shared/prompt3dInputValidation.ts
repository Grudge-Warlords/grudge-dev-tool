import type { AssetSpecV1 } from "./prompt3d";

export const PROMPT3D_MAX_SEED = 0x7fffffff;

/** Shared by the page and trusted service: never round or omit invalid input. */
export function prompt3DSettingsError(spec: AssetSpecV1): string | null {
  if (!Number.isSafeInteger(spec.seed) || spec.seed < 0 || spec.seed > PROMPT3D_MAX_SEED) return "Seed must be a whole number from 0 to 2,147,483,647.";
  const dimensions = spec.dimensions;
  if (!dimensions || ![dimensions.width, dimensions.height, dimensions.depth].every((value) => Number.isFinite(value) && value > 0 && value <= 10_000)) return "Width, height and depth must each be greater than 0 and at most 10,000.";
  if (!["m", "cm"].includes(dimensions.unit)) return "Choose metres or centimetres.";
  const budgets = spec.budgets;
  if (!budgets || !Number.isInteger(budgets.maxTriangles) || budgets.maxTriangles < 100 || budgets.maxTriangles > 2_000_000) return "Triangle budget must be a whole number from 100 to 2,000,000.";
  if (![512, 1024, 2048, 4096].includes(budgets.maxTextureResolution) || !Number.isSafeInteger(budgets.maxTextureBytes) || budgets.maxTextureBytes < 1 || budgets.maxTextureBytes > 512 * 1024 ** 2) return "Choose a supported texture budget.";
  if (spec.providerId === "hunyuan3d-2" && ![1024, 2048].includes(budgets.maxTextureResolution)) return "Hunyuan Paint texture resolution must be 1024 or 2048.";
  if (spec.style === "custom" && (typeof spec.customStyle !== "string" || !spec.customStyle.trim() || spec.customStyle.length > 200)) return "Describe your custom style in 1–200 characters.";
  if (spec.category === "character" && spec.providerId !== "hunyuan3d-2") return "Creature generation requires Hunyuan. Choose Hunyuan or change the category.";
  if (spec.category === "vehicle") return "Vehicle generation is not configured in this build.";
  return null;
}

export function parsePrompt3DOptionalNumber(value: string, name: "Seed" | "Duration"): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  const valid = name === "Seed"
    ? Number.isSafeInteger(number) && number >= 0 && number <= PROMPT3D_MAX_SEED
    : Number.isFinite(number) && number >= 0.5 && number <= 5;
  if (!valid) throw new Error(name === "Seed" ? "Seed must be a whole number from 0 to 2,147,483,647, or left blank." : "Duration must be from 0.5 to 5 seconds, or left blank to infer it.");
  return number;
}

export function prompt3DFinishSettingsError(seed: string, duration?: string): string | null {
  try {
    parsePrompt3DOptionalNumber(seed, "Seed");
    if (duration !== undefined) parsePrompt3DOptionalNumber(duration, "Duration");
    return null;
  } catch (error) { return (error as Error).message; }
}
