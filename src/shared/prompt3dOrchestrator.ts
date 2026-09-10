import { normalizePrompt3DTextureResolution, type AssetCategory, type AssetSpecV1, type AssetStyle, type Prompt3DOrchestrationRecord } from "./prompt3d";
import { hasAffirmativePromptMatch } from "./promptedMotionIntent";

export const PROMPT3D_ORCHESTRATOR_VERSION = 1 as const;

export type Prompt3DUnifiedRoute =
  | "hunyuan3d-2"
  | "trellis"
  | "original-procedural"
  | "hunyuan-paint-refine"
  | "cpu-rig-animation"
  | "hy-motion-optional"
  | "skeleton-studio"
  | "forge-local"
  | "scene-completion"
  | "retain-reopen"
  | "validate-save";

export type Prompt3DUnifiedOverride = "automatic" | Prompt3DUnifiedRoute;
export type Prompt3DStageReadiness = "ready" | "blocked" | "review-required" | "unknown";

export interface Prompt3DProviderReadiness {
  id: "hunyuan3d-2" | "trellis" | "hy-motion-1";
  ready: boolean;
  reason: string;
}

export interface Prompt3DUnifiedContext {
  mode: "new" | "revise-current";
  category: AssetCategory;
  currentRevision?: {
    id: string;
    sha256?: string;
    path?: string;
    method: "hunyuan-workflow" | "original-procedural" | "existing-asset";
  };
  localControlsEnabled: boolean;
  localAnimationLibraries: number;
  providers: Prompt3DProviderReadiness[];
}

export interface Prompt3DUnifiedStage {
  id: string;
  route: Prompt3DUnifiedRoute;
  label: string;
  method: string;
  readiness: Prompt3DStageReadiness;
  readinessReason: string;
  resource: string;
  revisionEffect: "create-root" | "reuse-exact-parent" | "create-immutable-sibling" | "review-only" | "save-exact-revision";
  approval: string;
  executor:
    | "creation.submit"
    | "prompt3d.start"
    | "prompt3d.finishStart"
    | "skeleton.contextualReview"
    | "forge.contextualRefinement"
    | "sceneCompletion.existing"
    | "prompt3d.retainedGeneration"
    | "prompt3d.workflowValidateAndSave";
  enabled: boolean;
}

export interface Prompt3DUnifiedPlan {
  version: typeof PROMPT3D_ORCHESTRATOR_VERSION;
  prompt: string;
  context: Prompt3DUnifiedContext;
  planner: {
    policy: "grudge-local-schema-planning";
    preferredModel: "grudge-dev";
    endpoint: "loopback-ollama";
    routeCompiler: "deterministic-typed-compiler";
    contacted: false;
    fallback: "none";
  };
  automaticRecommendation: Prompt3DUnifiedRoute;
  selectedRoute: Prompt3DUnifiedRoute;
  override: Prompt3DUnifiedOverride;
  overrideApplied: boolean;
  strongestCapability: Prompt3DUnifiedRoute;
  strongestCapabilityBlockedReason?: string;
  nextBestEligible?: Prompt3DUnifiedRoute;
  summary: string;
  stages: Prompt3DUnifiedStage[];
  exactRevision: string;
  externalProviderContact: false;
}

const ROUTE_LABELS: Record<Prompt3DUnifiedRoute, string> = {
  "hunyuan3d-2": "Hunyuan 3D",
  trellis: "TRELLIS",
  "original-procedural": "Original procedural CPU creator",
  "hunyuan-paint-refine": "Hunyuan Paint / refinement",
  "cpu-rig-animation": "Deterministic CPU rig and animation",
  "hy-motion-optional": "Optional HY-Motion",
  "skeleton-studio": "Skeleton Studio",
  "forge-local": "Local Forge workbench",
  "scene-completion": "Existing Scene Completion",
  "retain-reopen": "Retain and reopen generated revision",
  "validate-save": "Validate and save exact revision",
};

export const PROMPT3D_UNIFIED_ROUTE_LABELS = ROUTE_LABELS;

function provider(context: Prompt3DUnifiedContext, id: Prompt3DProviderReadiness["id"]): Prompt3DProviderReadiness {
  return context.providers.find((entry) => entry.id === id) ?? { id, ready: false, reason: "Readiness has not been checked in the existing provider controls." };
}

function routeReadiness(route: Prompt3DUnifiedRoute, context: Prompt3DUnifiedContext): { readiness: Prompt3DStageReadiness; reason: string } {
  if (!["hunyuan3d-2", "trellis", "original-procedural"].includes(route) && !context.currentRevision) {
    return { readiness: "blocked", reason: "Choose an exact retained revision before using this route." };
  }
  if (route === "hunyuan3d-2" || route === "hunyuan-paint-refine") {
    const state = provider(context, "hunyuan3d-2");
    return { readiness: state.ready ? "ready" : "blocked", reason: state.reason };
  }
  if (route === "trellis") {
    const state = provider(context, "trellis");
    return { readiness: state.ready ? "ready" : "blocked", reason: state.reason };
  }
  if (route === "hy-motion-optional") {
    const state = provider(context, "hy-motion-1");
    return { readiness: state.ready ? "ready" : "blocked", reason: state.reason };
  }
  if (route === "original-procedural" || route === "cpu-rig-animation") {
    return context.localControlsEnabled
      ? { readiness: "ready", reason: "Uses the existing local CPU path; no GPU or model download is required." }
      : { readiness: "blocked", reason: "Local controls are disabled on this computer." };
  }
  if (route === "skeleton-studio") return { readiness: "review-required", reason: "Available as an explicit contextual correction handoff." };
  return { readiness: "ready", reason: "Uses an existing in-app service or editor handoff." };
}

function strongestNewRoute(prompt: string, _context: Prompt3DUnifiedContext): { strongest: Prompt3DUnifiedRoute; automatic: Prompt3DUnifiedRoute; blocked?: string; next?: Prompt3DUnifiedRoute } {
  const route: Prompt3DUnifiedRoute = hasAffirmativePromptMatch(prompt, /\bhunyuan\b/i) ? "hunyuan3d-2"
    : hasAffirmativePromptMatch(prompt, /\btrellis\b/i) ? "trellis" : "original-procedural";
  return { strongest: route, automatic: route };
}

function automaticExistingRoute(prompt: string): Prompt3DUnifiedRoute {
  if (/\b(scene|environment|level|populate|assembly|assemble|composition|complete)\b/i.test(prompt)) return "scene-completion";
  if (/\b(skeleton|bone|joint|retarget|marker|rig\s*(?:repair|correct|fix))\b/i.test(prompt)) return "skeleton-studio";
  if (hasAffirmativePromptMatch(prompt, /\bhunyuan\b/i)) return "hunyuan-paint-refine";
  if (/\b(textur(?:e|ed|ing)|material|paint|surface|colour|color|roughness|metallic)\b/i.test(prompt)) return "forge-local";
  if (requestsAnimation(prompt)) return "cpu-rig-animation";
  if (/\b(validate|verify|save|export|reopen|package)\b/i.test(prompt)) return "validate-save";
  return "forge-local";
}

function requestsAnimation(prompt: string): boolean {
  return hasAffirmativePromptMatch(prompt, /\b(?:rig|animat(?:e|ed|ing|ion)|walk(?:s|ing)?|run(?:s|ning)?|jump(?:s|ing)?|danc(?:e|es|ing)|fly|flies|flying|flap(?:s|ping)?|attack|idle|motion|mov(?:e|es|ing)|float(?:s|ing)?|hover(?:s|ing)?|bob(?:s|bing)?|spin(?:s|ning)?|rotat(?:e|es|ing|ion)|sway(?:s|ing)?|swing(?:s|ing)?|swim(?:s|ming)?|slither(?:s|ing)?)\b/i);
}

/** A new root must not inherit the last asset's anatomy, scale or reference bindings. */
export function prompt3DGuidedCreationSpec(defaults: AssetSpecV1, current: AssetSpecV1, intent: {
  mode: Prompt3DUnifiedContext["mode"];
  category: AssetCategory;
  style: AssetStyle;
  prompt: string;
  route: "hunyuan3d-2" | "trellis";
  orchestration: Prompt3DOrchestrationRecord;
}): AssetSpecV1 {
  const base = intent.mode === "new" ? defaults : current;
  const { referenceImage: _referenceImage, referenceImages: _referenceImages, objectRules: _objectRules, ...clean } = base;
  return {
    ...clean,
    prompt: intent.prompt,
    category: intent.mode === "new" ? intent.category : base.category,
    style: intent.mode === "new" ? intent.style : base.style,
    providerId: intent.route,
    route: intent.route === "trellis" ? "direct-text" : "concept-image-to-3d",
    variants: intent.route === "hunyuan3d-2" ? 1 : base.variants,
    generateTextures: false,
    orchestration: intent.orchestration,
    coordinateContract: { ...base.coordinateContract, origin: "ground-center" },
    budgets: { ...base.budgets, maxTextureResolution: normalizePrompt3DTextureResolution(intent.route, base.budgets.maxTextureResolution) },
  };
}

function stageFor(route: Prompt3DUnifiedRoute, context: Prompt3DUnifiedContext, index: number): Prompt3DUnifiedStage {
  const state = routeReadiness(route, context);
  const base = {
    id: `${index + 1}-${route}`,
    route,
    readiness: state.readiness,
    readinessReason: state.reason,
    enabled: true,
  } as const;
  switch (route) {
    case "hunyuan3d-2": return { ...base, label: "Create geometry", method: "Pinned Hunyuan3D concept/image-to-3D", resource: "Existing local Hunyuan installation and its verified resource profile", revisionEffect: "create-root", approval: "Concept and geometry visual approval", executor: "prompt3d.start" };
    case "trellis": return { ...base, label: "Create geometry", method: "Pinned TRELLIS text-to-3D", resource: "Existing local TRELLIS installation and its verified resource profile", revisionEffect: "create-root", approval: "Geometry visual approval", executor: "prompt3d.start" };
    case "original-procedural": return { ...base, label: "Create basic original asset", method: "Deterministic procedural CPU authoring", resource: "CPU only", revisionEffect: "create-root", approval: "Visual review before treating the result as semantically correct", executor: "creation.submit" };
    case "hunyuan-paint-refine": return { ...base, label: "Refine or texture", method: "Existing Hunyuan refinement / Hunyuan Paint", resource: "Installed local Hunyuan provider", revisionEffect: "create-immutable-sibling", approval: "Exact texture or geometry revision approval", executor: "prompt3d.finishStart" };
    case "cpu-rig-animation": return { ...base, label: "Prepare rig and animate", method: "Existing rig reuse, deterministic Mixamo-25 CPU bind, morph deformation, or rigid motion", resource: "CPU; optional installed local animation library", revisionEffect: "create-immutable-sibling", approval: "Skeleton correction only if classification or fit is unsafe; then full motion review", executor: "prompt3d.finishStart" };
    case "hy-motion-optional": return { ...base, label: "Animate with optional HY-Motion", method: "Pinned HY-Motion plus local skin binding", resource: "Existing HY-Motion installation and verified GPU profile", revisionEffect: "create-immutable-sibling", approval: "Explicit provider override and full motion review", executor: "prompt3d.finishStart" };
    case "skeleton-studio": return { ...base, label: "Correct skeleton", method: "Contextual Skeleton Studio marker and retarget tools", resource: "Existing Skeleton Studio and local animation libraries", revisionEffect: "review-only", approval: "All 22 canonical markers before returning a correction", executor: "skeleton.contextualReview" };
    case "forge-local": return { ...base, label: "Refine in Forge", method: "Contextual local Forge workbench handoff", resource: "Existing local Forge tools", revisionEffect: "review-only", approval: "Manual review; no automatic replacement of the retained revision", executor: "forge.contextualRefinement" };
    case "scene-completion": return { ...base, label: "Repair selected scene asset", method: "Existing mesh repair and rig preparation inside local Forge", resource: "Existing Scene Completion service and selected model", revisionEffect: "create-immutable-sibling", approval: "Mesh and rig review; this does not construct a world", executor: "sceneCompletion.existing" };
    case "retain-reopen": return { ...base, label: "Retain and reopen", method: "Immutable Prompt-to-3D generation history with exact preview, reveal and Forge handoff", resource: "Existing local generation store", revisionEffect: "save-exact-revision", approval: "Exact geometry visual approval before downstream use", executor: "prompt3d.retainedGeneration" };
    case "validate-save": return { ...base, label: "Validate and save", method: "Existing workflow validation, approval, managed save and portable export", resource: "Local workflow store", revisionEffect: "save-exact-revision", approval: "Exact-revision visual approval remains mandatory", executor: "prompt3d.workflowValidateAndSave" };
  }
}

export function compilePrompt3DUnifiedPlan(input: {
  prompt: string;
  context: Prompt3DUnifiedContext;
  override?: Prompt3DUnifiedOverride;
}): Prompt3DUnifiedPlan {
  const prompt = input.prompt.trim().replace(/\s+/g, " ");
  if (!prompt || prompt.length > 2_000) throw new Error("A unified Prompt-to-3D request must contain 1–2,000 characters.");
  const override = input.override ?? "automatic";
  const existing = input.context.mode === "revise-current" && input.context.currentRevision;
  const localExisting = Boolean(existing && input.context.currentRevision?.method!=="hunyuan-workflow");
  const localRoute: Prompt3DUnifiedRoute = /\b(skeleton|bone|joint|retarget|marker)\b/i.test(prompt)?"skeleton-studio":/\b(scene|assembly|populate)\b/i.test(prompt)?"scene-completion":"original-procedural";
  const automaticResult = localExisting ? {strongest:localRoute,automatic:localRoute} : existing
    ? { strongest: automaticExistingRoute(prompt), automatic: automaticExistingRoute(prompt) }
    : strongestNewRoute(prompt, input.context);
  const selectedRoute = override === "automatic" ? automaticResult.automatic : override;
  const overrideApplied = override !== "automatic" && override !== automaticResult.automatic;
  const selectedReadiness = routeReadiness(selectedRoute, input.context);
  const exactRevision = existing
    ? `${input.context.currentRevision!.id}${input.context.currentRevision!.sha256 ? ` · SHA-256 ${input.context.currentRevision!.sha256}` : " · retained hash resolved by executor"}`
    : "new root revision";
  const wantsTexture = /\b(textur(?:e|ed|ing)|material|paint|surface|colour|color|roughness|metallic|hand[- ]painted)\b/i.test(prompt);
  const wantsAnimation = requestsAnimation(prompt);
  const wantsSkeletonCorrection = /\b(skeleton|bone|joint|retarget|marker|rig\s*(?:repair|correct|fix))\b/i.test(prompt);
  const wantsScene = /\b(scene|environment|level|populate|assembly|assemble|composition|complete\s+the\s+scene)\b/i.test(prompt);
  const routes: Prompt3DUnifiedRoute[] = [selectedRoute];
  const add = (route: Prompt3DUnifiedRoute) => { if (!routes.includes(route)) routes.push(route); };
  if (selectedRoute === "hunyuan3d-2") {
    if (wantsTexture) add("hunyuan-paint-refine");
    if (wantsSkeletonCorrection) add("skeleton-studio");
    if (wantsAnimation) add("cpu-rig-animation");
    if (wantsScene) add("scene-completion");
  } else if (selectedRoute === "trellis") {
    // TRELLIS remains an explicit geometry provider. Do not silently route its
    // material work through Hunyuan Paint; use the existing local Forge handoff.
    if (wantsTexture) add("forge-local");
    if (wantsSkeletonCorrection) add("skeleton-studio");
    if (wantsAnimation) add("cpu-rig-animation");
    if (wantsScene) add("scene-completion");
    add("retain-reopen");
  } else if (existing && selectedRoute!=="original-procedural") {
    if (wantsTexture) add(selectedRoute === "hunyuan-paint-refine" ? "hunyuan-paint-refine" : "forge-local");
    if (wantsSkeletonCorrection) add("skeleton-studio");
    if (wantsAnimation) add(selectedRoute === "hy-motion-optional" ? "hy-motion-optional" : "cpu-rig-animation");
    if (wantsScene) add("scene-completion");
  }
  if (!["trellis", "retain-reopen", "skeleton-studio", "forge-local", "scene-completion"].includes(selectedRoute) || (routes.length > 1 && selectedRoute !== "trellis")) add("validate-save");
  let stages = routes.map((route, index) => stageFor(route, input.context, index));
  // A downstream stage for a newly created root becomes ready only after the
  // preceding exact revision is produced and approved; do not call that a
  // current blocker or pretend it can execute early.
  if (!existing) stages = stages.map((stage, index) => index > 0 && stage.readiness === "blocked" && /exact retained revision/i.test(stage.readinessReason)
    ? { ...stage, readiness: "unknown" as const, readinessReason: "Becomes eligible after the preceding exact revision is created and approved." }
    : stage);
  if (selectedRoute === "original-procedural") {
    const additions: Prompt3DUnifiedStage[] = [];
    if (wantsTexture) additions.push({ ...stageFor("original-procedural", input.context, stages.length + additions.length), label: "Texture the basic original asset", method: "Existing procedural embedded-surface author", revisionEffect: "create-immutable-sibling", approval: "Visual material review" });
    if (wantsAnimation) additions.push({ ...stageFor("original-procedural", input.context, stages.length + additions.length), label: "Animate the basic original asset", method: "Existing authored segmented/object animation", revisionEffect: "create-immutable-sibling", approval: "Full-cycle motion review" });
    if (additions.length) stages.splice(Math.max(1, stages.length - 1), 0, ...additions);
  }
  if (selectedRoute === "original-procedural") stages=stages.map(stage=>stage.route==="validate-save"?{...stage,method:"Exact local working revision and managed library copy",executor:"creation.submit",approval:"Visual review of the actual model; no Hunyuan concept or paint gate",readiness:input.context.localControlsEnabled?"ready":"blocked",readinessReason:"Uses the existing local creation store."}:stage);
  const summary = `${ROUTE_LABELS[selectedRoute]} · ${selectedReadiness.readiness}. ${overrideApplied ? `User override recorded; automatic recommendation was ${ROUTE_LABELS[automaticResult.automatic]}.` : `Automatic existing-tool recommendation; neural enhancement is opt-in.`}`;
  return {
    version: PROMPT3D_ORCHESTRATOR_VERSION,
    prompt,
    context: input.context,
    planner: {
      policy: "grudge-local-schema-planning",
      preferredModel: "grudge-dev",
      endpoint: "loopback-ollama",
      routeCompiler: "deterministic-typed-compiler",
      contacted: false,
      fallback: "none",
    },
    automaticRecommendation: automaticResult.automatic,
    selectedRoute,
    override,
    overrideApplied,
    strongestCapability: automaticResult.strongest,
    ...(automaticResult.blocked ? { strongestCapabilityBlockedReason: automaticResult.blocked } : {}),
    ...(automaticResult.next ? { nextBestEligible: automaticResult.next } : {}),
    summary,
    stages,
    exactRevision,
    externalProviderContact: false,
  };
}

export function prompt3DOrchestrationRecord(plan: Prompt3DUnifiedPlan, enabledStageIds: string[]): Prompt3DOrchestrationRecord {
  const allowed = new Set(plan.stages.map((stage) => stage.id));
  return {
    version: 1,
    automaticRecommendation: plan.automaticRecommendation,
    selectedRoute: plan.selectedRoute,
    override: plan.override,
    overrideApplied: plan.overrideApplied,
    exactRevision: plan.exactRevision,
    enabledStageIds: enabledStageIds.filter((id) => allowed.has(id)),
    planner: { ...plan.planner },
    externalProviderContact: false,
  };
}
