import type { AssetSpecV1, Prompt3DConceptBinding } from "./prompt3d";
import { compilePrompt3DPrompt, withObjectRules } from "./prompt3dRules";

export const CONCEPT_WORKFLOW_VERSION = 3;

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Copy only AssetSpec fields understood by this build. Legacy workflow fields
 * such as originalPrompt/approvedConcept can never leak back into a new job.
 */
export function sanitizeAssetSpec(value: AssetSpecV1): AssetSpecV1 {
  return {
    version: value.version,
    prompt: value.prompt,
    category: value.category,
    style: value.style,
    ...(value.customStyle === undefined ? {} : { customStyle: value.customStyle }),
    route: value.route,
    targetFormat: value.targetFormat,
    dimensions: { ...value.dimensions },
    budgets: { ...value.budgets },
    seed: value.seed,
    variants: value.variants,
    providerId: value.providerId,
    generateTextures: value.generateTextures,
    generateCollision: value.generateCollision,
    generateLods: value.generateLods,
    ...(value.scaleMode === undefined ? {} : { scaleMode: value.scaleMode }),
    ...(value.objectRules === undefined ? {} : {
      objectRules: {
        ...value.objectRules,
        ...(value.objectRules.anchor === undefined ? {} : { anchor: { ...value.objectRules.anchor } }),
      },
    }),
    coordinateContract: { ...value.coordinateContract },
  };
}

export function conceptWorkflowInput(spec: AssetSpecV1) {
  const normalized = withObjectRules(sanitizeAssetSpec(spec));
  return {
    workflowVersion: CONCEPT_WORKFLOW_VERSION,
    spec: normalized,
    promptPlan: compilePrompt3DPrompt(normalized),
    referenceSha256: null,
  };
}

export function conceptSpecCanonical(spec: AssetSpecV1): string {
  return stableJson(conceptWorkflowInput(spec));
}

export function conceptBindingMatchesSpec(binding: Prompt3DConceptBinding, spec: AssetSpecV1): boolean {
  return binding.workflowVersion === CONCEPT_WORKFLOW_VERSION
    && binding.prompt === spec.prompt
    && binding.seed === spec.seed
    && binding.providerId === spec.providerId
    && binding.specVersion === spec.version
    && binding.referenceSha256 === null
    && binding.specCanonical === conceptSpecCanonical(spec);
}

export function supportsConceptWorkflow(spec: AssetSpecV1): boolean {
  return spec.providerId === "hunyuan3d-2" && spec.route === "concept-image-to-3d";
}
