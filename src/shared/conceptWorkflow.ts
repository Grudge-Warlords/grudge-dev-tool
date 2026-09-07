import { normalizePrompt3DTextureResolution, type AssetSpecV1, type Prompt3DConceptBinding } from "./prompt3d";
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
    budgets: {
      ...value.budgets,
      maxTextureResolution: normalizePrompt3DTextureResolution(value.providerId, value.budgets.maxTextureResolution),
    },
    seed: value.seed,
    variants: value.variants,
    providerId: value.providerId,
    generateTextures: value.generateTextures,
    generateCollision: value.generateCollision,
    generateLods: value.generateLods,
    ...(value.referenceImage === undefined ? {} : { referenceImage: { ...value.referenceImage } }),
    ...(value.referenceImages === undefined ? {} : { referenceImages: value.referenceImages.map((image) => ({ ...image })) }),
    ...(value.scaleMode === undefined ? {} : { scaleMode: value.scaleMode }),
    ...(value.objectRules === undefined ? {} : {
      objectRules: {
        ...value.objectRules,
        ...(value.objectRules.anchor === undefined ? {} : { anchor: { ...value.objectRules.anchor } }),
      },
    }),
    ...(value.orchestration === undefined ? {} : {
      orchestration: {
        ...value.orchestration,
        enabledStageIds: [...value.orchestration.enabledStageIds],
        planner: { ...value.orchestration.planner },
      },
    }),
    coordinateContract: { ...value.coordinateContract },
  };
}

export function conceptReferenceImageBindings(spec: AssetSpecV1) {
  const images = spec.referenceImages ?? (spec.referenceImage ? [spec.referenceImage] : []);
  return images.map((image) => ({ view: image.view ?? "front" as const, sha256: image.sha256 }));
}

export function conceptWorkflowInput(spec: AssetSpecV1) {
  const normalized = withObjectRules(sanitizeAssetSpec(spec));
  return {
    workflowVersion: CONCEPT_WORKFLOW_VERSION,
    spec: normalized,
    promptPlan: compilePrompt3DPrompt(normalized),
    referenceSha256: normalized.referenceImage?.sha256 ?? null,
    referenceImageBindings: conceptReferenceImageBindings(normalized),
  };
}

export function conceptSpecCanonical(spec: AssetSpecV1): string {
  return stableJson(conceptWorkflowInput(spec));
}

export function retainedConceptWorkflowInput(binding: Prompt3DConceptBinding): ReturnType<typeof conceptWorkflowInput> | null {
  try {
    const parsed = JSON.parse(binding.specCanonical) as Partial<ReturnType<typeof conceptWorkflowInput>>;
    if (!parsed || typeof parsed !== "object" || !parsed.spec || !parsed.promptPlan) return null;
    if (binding.specCanonical !== stableJson(parsed)) return null;
    return parsed as ReturnType<typeof conceptWorkflowInput>;
  } catch {
    return null;
  }
}

export function conceptBindingMatchesSpec(binding: Prompt3DConceptBinding, spec: AssetSpecV1): boolean {
  const retained = retainedConceptWorkflowInput(binding);
  return binding.workflowVersion === CONCEPT_WORKFLOW_VERSION
    && binding.version === 1
    && binding.prompt === spec.prompt
    && binding.seed === spec.seed
    && binding.providerId === spec.providerId
    && binding.specVersion === spec.version
    && binding.referenceSha256 === (spec.referenceImage?.sha256 ?? null)
    && stableJson(binding.referenceImageBindings ?? (binding.referenceSha256 ? [{ view: "front", sha256: binding.referenceSha256 }] : []))
      === stableJson(conceptReferenceImageBindings(spec))
    && retained?.workflowVersion === binding.workflowVersion
    && retained.referenceSha256 === binding.referenceSha256
    && stableJson(retained.referenceImageBindings ?? (retained.referenceSha256 ? [{ view: "front", sha256: retained.referenceSha256 }] : []))
      === stableJson(conceptReferenceImageBindings(spec))
    // The retained canonical record contains both the exact AssetSpec and the
    // exact compiler output that produced the concept. Match the editable
    // fields against its stored spec; recompiling here would make an unchanged
    // retained concept stale whenever prompt-compaction code evolves.
    && stableJson(retained.spec) === stableJson(withObjectRules(sanitizeAssetSpec(spec)));
}

export function supportsConceptWorkflow(spec: AssetSpecV1): boolean {
  return spec.providerId === "hunyuan3d-2" && spec.route === "concept-image-to-3d";
}
