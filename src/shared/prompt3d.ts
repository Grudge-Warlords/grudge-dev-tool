export const PROMPT3D_SPEC_VERSION = "1.0.0" as const;
export const PROMPT3D_MANIFEST_VERSION = 1 as const;

export type Prompt3DGeometryProviderId = "hunyuan3d-2" | "trellis" | "meshy" | "tripo";
export type Prompt3DMotionProviderId = "hy-motion-1";
export type Prompt3DProviderId = Prompt3DGeometryProviderId | Prompt3DMotionProviderId;
export type LocalPrompt3DProviderId = Extract<Prompt3DProviderId, "hunyuan3d-2" | "trellis" | "hy-motion-1">;
export const PROMPT3D_TEXTURE_RESOLUTIONS = [512, 1024, 2048, 4096] as const;
export type Prompt3DTextureResolution = typeof PROMPT3D_TEXTURE_RESOLUTIONS[number];
export const HUNYUAN_PAINT_TEXTURE_RESOLUTIONS = [1024, 2048] as const;

export function prompt3dTextureResolutionsFor(providerId: Prompt3DGeometryProviderId): readonly Prompt3DTextureResolution[] {
  return providerId === "hunyuan3d-2" ? HUNYUAN_PAINT_TEXTURE_RESOLUTIONS : PROMPT3D_TEXTURE_RESOLUTIONS;
}

export function isPrompt3DTextureResolutionSupported(providerId: Prompt3DGeometryProviderId, resolution: number): resolution is Prompt3DTextureResolution {
  return prompt3dTextureResolutionsFor(providerId).some((candidate) => candidate === resolution);
}

export function normalizePrompt3DTextureResolution(providerId: Prompt3DGeometryProviderId, resolution: Prompt3DTextureResolution): Prompt3DTextureResolution {
  // Normalize only values in the declared cross-provider contract. Malformed
  // IPC data must remain invalid so the service validator rejects it.
  if (!PROMPT3D_TEXTURE_RESOLUTIONS.some((candidate) => candidate === resolution)) return resolution;
  const supported = prompt3dTextureResolutionsFor(providerId);
  if (isPrompt3DTextureResolutionSupported(providerId, resolution)) return resolution;
  return supported.reduce((nearest, candidate) => Math.abs(candidate - resolution) < Math.abs(nearest - resolution) ? candidate : nearest);
}
export type Prompt3DComplianceState =
  | "ready"
  | "setup-required"
  | "busy"
  | "marginal"
  | "unsupported"
  | "cloud-only";

export type AssetCategory = "prop" | "building" | "road-furniture" | "environment" | "character" | "vehicle";
export type AssetStyle = "realistic" | "stylized" | "low-poly" | "hand-painted" | "industrial" | "custom";
export type Prompt3DRoute = "direct-text" | "concept-image-to-3d" | "image-to-3d";

export type Prompt3DReferenceImageMediaType = "image/png" | "image/jpeg" | "image/webp";
export type Prompt3DReferenceImageView = "front" | "left" | "back" | "right";

/** Immutable public identity for an optional local image-conditioning input. */
export interface Prompt3DReferenceImageSpec {
  version: 1;
  sha256: string;
  mediaType: Prompt3DReferenceImageMediaType;
  byteSize: number;
  width: number;
  height: number;
  originalName: string;
  /** Camera view consumed by the official Hunyuan3D-2mv conditioner. */
  view?: Prompt3DReferenceImageView;
}

/** Ephemeral picker result. sourcePath is never copied into AssetSpec or provenance. */
export interface Prompt3DReferenceImageSelection extends Prompt3DReferenceImageSpec {
  sourcePath: string;
}

/** Task-contained source bytes retained before any provider model can start. */
export interface Prompt3DRetainedReferenceImage extends Prompt3DReferenceImageSpec {
  path: string;
  copiedAt: string;
  use: "hunyuan-shape-concept-conditioning";
}

export interface Prompt3DOrchestrationRecord {
  version: 1;
  automaticRecommendation: string;
  selectedRoute: string;
  override: string;
  overrideApplied: boolean;
  exactRevision: string;
  enabledStageIds: string[];
  planner: {
    policy: "grudge-local-schema-planning";
    preferredModel: "grudge-dev";
    endpoint: "loopback-ollama";
    routeCompiler: "deterministic-typed-compiler";
    contacted: false;
    fallback: "none";
  };
  externalProviderContact: false;
}

export interface AssetSpecV1 {
  version: typeof PROMPT3D_SPEC_VERSION;
  prompt: string;
  category: AssetCategory;
  style: AssetStyle;
  customStyle?: string;
  route: Prompt3DRoute;
  targetFormat: "glb";
  dimensions: { width: number; height: number; depth: number; unit: "m" | "cm" };
  budgets: { maxTriangles: number; maxTextureResolution: Prompt3DTextureResolution; maxTextureBytes: number };
  seed: number;
  variants: number;
  providerId: Prompt3DGeometryProviderId;
  generateTextures: boolean;
  generateCollision: boolean;
  generateLods: boolean;
  /** Optional hash-bound local image input. Prompt-only generation remains the default. */
  referenceImage?: Prompt3DReferenceImageSpec;
  /** One to four unique Hunyuan multiview inputs. New image-conditioned jobs use this field. */
  referenceImages?: Prompt3DReferenceImageSpec[];
  /** Preserve silhouette by scaling uniformly to height unless explicitly overridden. */
  scaleMode?: "preserve" | "exact";
  objectRules?: import("./prompt3dRules").Prompt3DObjectRules;
  /** Typed allowlisted plan retained into job and workflow provenance. */
  orchestration?: Prompt3DOrchestrationRecord;
  coordinateContract: {
    upAxis: "+Y";
    forwardAxis: "+Z";
    origin: "ground-center" | "attachment-point";
    stableRootName: string;
  };
}

export interface Prompt3DProviderManifest {
  id: Prompt3DProviderId;
  role: "geometry" | "motion";
  name: string;
  kind: "local" | "cloud";
  summary: string;
  routes: Prompt3DRoute[];
  enabledRoutes: Prompt3DRoute[];
  /** Native image-conditioning boundary. Missing means the provider must reject
   * every supplied reference rather than silently reducing or substituting it. */
  referenceImages?: Prompt3DReferenceImageCapability;
  geometry: string;
  textures: string;
  outputFormats: string[];
  qualitySpeed: string;
  platform: string;
  sourceUrl: string;
  sourceRevision: string;
  modelSources: Array<{
    id: string;
    revision: string;
    estimatedDownloadBytes: number;
    purpose: string;
    allowPatterns?: string[];
  }>;
  sourceDependencies: Array<{
    id: string;
    sourceUrl: string;
    revision: string;
    purpose: string;
    licenseUrl: string;
    installSubpath?: string;
  }>;
  licenseName: string;
  licenseUrl: string;
  downloadBytes: number;
  installedBytes: number;
  requiredFreeDiskBytes: number;
  physicalVramBytes: number;
  minimumWindowsNvidiaDriver: string;
  runVramBytes: { geometry: number; textured: number; reducedGeometry?: number };
  systemRamBytes: number;
  safeReducedMemoryMode?: { label: string; tradeoff: string };
  /** Ordered provider-native execution choices. The first currently runnable
   * profile is selected; these never authorize a different model/provider. */
  executionProfiles?: Prompt3DExecutionProfile[];
  requiredComponents: string[];
  /** Native runtime files which are measured and signed after setup. */
  nativeArtifacts?: Array<{ id: string; pathPattern: string }>;
}

export interface Prompt3DReferenceImageCapability {
  route: Prompt3DRoute;
  minCount: number;
  maxCount: number;
  supportedViews: Prompt3DReferenceImageView[];
  requiredViews: Prompt3DReferenceImageView[];
  singleViewModelId: string;
  multiViewModelId: string;
  multiViewMinCount: number;
  selectionPolicy: "automatic-by-image-count";
  unsupportedPolicy: "fail-closed";
}

export interface Prompt3DExecutionProfile {
  id: string;
  label: string;
  device: "cuda" | "cpu";
  /** Provider stage(s) this profile can execute. Omission means the provider's
   * sole role, retained for existing motion-profile compatibility. */
  operations?: Array<"geometry" | "texture" | "motion">;
  qualityTier?: "standard" | "balanced" | "basic";
  minimumTotalVramBytes: number;
  minimumFreeVramBytes: number;
  minimumSystemRamBytes: number;
  minimumFreeSystemRamBytes: number;
  validationSteps?: number;
  tradeoff: string;
}

export interface Prompt3DGpuSnapshot {
  index?: number;
  uuid?: string;
  vendor: string;
  model: string;
  driver?: string;
  totalVramBytes: number;
  freeVramBytes: number;
  usedVramBytes: number;
  cudaComputeCapability?: string;
}

export interface Prompt3DSelectedExecutionProfile extends Prompt3DExecutionProfile {
  gpu?: Pick<Prompt3DGpuSnapshot, "index" | "uuid" | "model" | "totalVramBytes" | "freeVramBytes">;
}

export interface Prompt3DHardwareSnapshot {
  checkedAt: string;
  os: { platform: string; release: string; version: string; windowsBuild?: string };
  /** Preferred compute GPU, retained for compatibility with existing callers. */
  gpu: Prompt3DGpuSnapshot | null;
  /** Every measured NVIDIA adapter. Multi-GPU selection must not rely on index 0. */
  gpus?: Prompt3DGpuSnapshot[];
  systemRam: { totalBytes: number; freeBytes: number };
  disk: { path: string; totalBytes: number; freeBytes: number };
  python: Array<{ command: string; version: string }>;
  cudaToolkit: { available: boolean; version?: string };
  conda: { available: boolean; command?: string; version?: string };
  wsl: {
    available: boolean;
    version?: string;
    distributions: string[];
    distributionVersions: Record<string, number>;
    requestedDistribution?: string;
    usableLinuxDistribution: string | null;
    runtimeProbe?: {
      distribution: string;
      nonRoot: boolean;
      homeWritable: boolean;
      osId?: string;
      osVersion?: string;
      python?: string;
      cudaVisible: boolean;
      measuredAt: string;
      elapsedMs: number;
    };
  };
}

export interface Prompt3DComplianceCheck {
  providerId: Prompt3DProviderId;
  state: Prompt3DComplianceState;
  measuredAt: string;
  phase: "display" | "pre-download" | "pre-run";
  installed: boolean;
  modelInstalled: boolean;
  physicalHardwarePass: boolean;
  platformPass: boolean;
  softwarePass: boolean;
  diskPass: boolean;
  headroomPass: boolean;
  canInstall: boolean;
  canRun: boolean;
  reasons: string[];
  required: { physicalVramBytes: number; runVramBytes: number; freeDiskBytes: number; systemRamBytes: number };
  measured: { physicalVramBytes: number; freeVramBytes: number; freeDiskBytes: number; systemRamBytes: number };
  reducedMemoryMode?: { allowed: boolean; label: string; tradeoff: string };
  executionProfile?: Prompt3DSelectedExecutionProfile;
}

export interface Prompt3DInstallStatus {
  providerId: LocalPrompt3DProviderId;
  state: "not-installed" | "installing" | "installed" | "repair-needed" | "cancelled" | "failed";
  stage: string;
  progress: number;
  destination: string;
  sourceRevision: string;
  modelRevisions: string[];
  bytesCompleted: number;
  bytesTotal: number;
  resumable: boolean;
  message?: string;
  manifestPath?: string;
  updatedAt: string;
}

export interface Prompt3DInstallRequest {
  providerId: LocalPrompt3DProviderId;
  destination: string;
  action: "install" | "repair" | "remove";
  confirmation: {
    providerId: LocalPrompt3DProviderId;
    destination: string;
    downloadBytes: number;
    licenseUrl: string;
    acceptedForThisInstall: boolean;
  };
}

export interface Prompt3DValidationCheck {
  id: string;
  status: "pass" | "warning" | "fail";
  message: string;
  measured?: string | number | boolean;
  required?: string | number | boolean;
}

export interface Prompt3DValidationReport {
  version: 1;
  deterministicId: string;
  assetPath: string;
  quarantinedPath?: string;
  gameReady: boolean;
  triangleCount: number;
  boundsMeters?: { width: number; height: number; depth: number; minY: number };
  checks: Prompt3DValidationCheck[];
  createdAt: string;
}

export type Prompt3DJobStage =
  | "queued"
  | "compliance"
  | "planning"
  | "warmup"
  | "concept-image"
  | "concept-review"
  | "awaiting-concept-approval"
  | "geometry"
  | "texture"
  | "postprocess"
  | "validation"
  | "quarantine"
  | "complete"
  | "cancelled"
  | "failed";

export interface Prompt3DStageTiming {
  stage: string;
  status: "running" | "complete" | "failed";
  startedAt: string;
  completedAt?: string;
  elapsedMs?: number;
  message: string;
}

export interface Prompt3DConceptBinding {
  version: 1;
  workflowVersion: number;
  jobId: string;
  attemptId: string;
  conceptSha256: string;
  prompt: string;
  seed: number;
  providerId: Prompt3DProviderId;
  specVersion: typeof PROMPT3D_SPEC_VERSION;
  specCanonical: string;
  specFingerprint: string;
  referenceSha256: string | null;
  /** Ordered view/hash binding for genuine Hunyuan multiview conditioning. */
  referenceImageBindings?: Array<{ view: Prompt3DReferenceImageView; sha256: string }>;
}

export interface Prompt3DConceptTechnicalReview {
  status: "pass" | "needs-regeneration";
  method: string;
  message: string;
  reportPath: string;
  /** Exact retained report bytes; mandatory for concepts produced by the structured-inspection workflow. */
  reportSha256?: string;
  /** Binds the technical review to the same effective presentation contract shown to the reviewer. */
  presentationContractSha256?: string;
  reportVersion?: 1;
  semanticResemblanceChecked?: false;
  visualReviewRequired?: true;
  failureCode?: "background-isolation" | "foreground-missing" | "edge-clearance";
  checkedAt: string;
}

/** Untouched local provider pixels retained separately from the prepared conditioning canvas. */
export interface Prompt3DProviderConceptSource {
  path: string;
  sha256: string;
  role: "untouched-provider-render";
}

/** Generic, deterministic presentation preparation; never geometry generation. */
export interface Prompt3DConceptNormalization {
  mode: "isolated-provider-pixels-centered";
  sourceForegroundBounds: [number, number, number, number];
  sourceMarginPixels: number;
  maximumCanvasFraction: 0.5;
  scale: number;
  offset: [number, number];
}

/** Pinned upstream Hunyuan subject isolation used before shape conditioning. */
export interface Prompt3DConceptIsolation {
  method: "hunyuan-upstream-rembg-u2net";
  modelPath: "models/rembg/u2net.onnx";
  modelSha256: "8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491";
  providerSourceRevision: "82920d643c0dc2f7bfd7255f45f62d386edfe60c";
}

export type Prompt3DConceptCriterionVerdict = "pass" | "fail";
export type Prompt3DConceptRejectionClassification =
  | "presentation"
  | "semantic-anatomy-parts"
  | "prompt-negation-misunderstanding"
  | "other";

export interface Prompt3DConceptInspectionChecks {
  identityAndRequiredParts: Prompt3DConceptCriterionVerdict;
  subjectPresentation: Prompt3DConceptCriterionVerdict;
  framingBackgroundAndSupport: Prompt3DConceptCriterionVerdict;
}

/** Exact main-process-derived record of the user's three-check concept decision. */
export interface Prompt3DConceptInspectionEvidence {
  version: 1;
  inspectionId: string;
  source: "explicit-user-action";
  decision: "approved" | "rejected";
  jobId: string;
  attemptId: string;
  conceptSha256: string;
  promptSha256: string;
  promptPlanSha256: string;
  presentationContractSha256: string;
  technicalReviewSha256: string;
  seed: number;
  providerId: Prompt3DProviderId;
  specFingerprint: string;
  checks: Prompt3DConceptInspectionChecks;
  rejection?: { classification: Prompt3DConceptRejectionClassification; note?: string };
  inspectedAt: string;
  bindingSha256: string;
}

export interface Prompt3DConceptInspectionRecord {
  evidence: Prompt3DConceptInspectionEvidence;
  path: string;
  sha256: string;
}

/** Immutable facts for one retained concept generation attempt. */
export interface Prompt3DConceptAttempt {
  attemptNumber: number;
  binding: Prompt3DConceptBinding;
  conceptImagePath: string;
  promptPlan: import("./prompt3dRules").Prompt3DPromptPlan;
  technicalReview: Prompt3DConceptTechnicalReview;
  /** Mandatory on new provider attempts; optional only for retained pre-protocol records. */
  providerConceptSource?: Prompt3DProviderConceptSource;
  normalization?: Prompt3DConceptNormalization;
  conditioningIsolation?: Prompt3DConceptIsolation;
  referenceImage?: Prompt3DRetainedReferenceImage;
  referenceImages?: Prompt3DRetainedReferenceImage[];
  createdAt: string;
}

/** Append-only record of explicit user choices between retained attempts. */
export interface Prompt3DConceptDecision {
  kind: "approved" | "rejected" | "regenerated" | "edited";
  source: "explicit-user-action";
  at: string;
  jobId: string;
  attemptId: string;
  nextJobId?: string;
  inspectionSha256?: string;
  inspectionPath?: string;
  rejectionClassification?: Prompt3DConceptRejectionClassification;
  nextPrompt?: string;
  nextPromptSha256?: string;
  nextPromptPlanSha256?: string;
  nextPresentationContractSha256?: string;
  nextSeed?: number;
  nextSpecFingerprint?: string;
}

export interface Prompt3DConceptApproval extends Prompt3DConceptBinding {
  approvedAt: string;
  source: "explicit-user-action";
  /** Optional only for completed assets retained before the structured inspection protocol. */
  inspectionSha256?: string;
}

/** Fresh deep-verification evidence measured immediately before provider use. */
export interface Prompt3DProviderVerification {
  version: 1;
  providerId: LocalPrompt3DProviderId;
  sourceRevision: string;
  verificationMode: "deep";
  verifiedAt: string;
  reason: string;
  installManifestSha256: string;
  workerSha256: string;
  modelSnapshots: Array<{ id: string; revision: string; treeSha256: string }>;
  runtimeLocks: { pipFreezeSha256: string; condaExplicitSha256: string; nativeArtifactsSha256: string };
}

/** Immutable evidence that a technically valid generated mesh was rejected visually in favour of a prompted successor. */
export interface Prompt3DGeometryRejection {
  version: 1;
  source: "explicit-user-action";
  replacementKind: "approved-ancestor-refinement" | "fresh-root-regeneration";
  rejectedAt: string;
  jobId: string;
  assetId: string;
  variantIndex: number;
  assetPath: string;
  assetSha256: string;
  geometryHash: string;
  approvedAncestorJobId?: string;
  successorJobId: string;
  correctivePrompt: string;
  correctivePromptSha256: string;
  successorSpecFingerprint: string;
  /** Exact retained chain from rejected geometry through failed/concept-only attempts to the approved ancestor. */
  retainedAncestry: Array<{
    jobId: string;
    parentJobId?: string;
    state: Prompt3DJobStatus["state"];
    attemptId: string;
    conceptSha256: string;
    specFingerprint: string;
  }>;
}

export interface Prompt3DJobStatus {
  id: string;
  /** Stable identity shared by Hunyuan shape-refinement descendants. */
  assetId?: string;
  /** Exact prior Hunyuan job used as the refinement ancestor. */
  parentJobId?: string;
  /** Immediate prior concept attempt when it differs from the approved geometry parent. */
  conceptParentJobId?: string;
  /** This generation was created through the prompt-only shape-refinement path. */
  shapeRefinement?: boolean;
  state: "queued" | "running" | "awaiting-concept-approval" | "complete" | "cancelled" | "failed";
  stage: Prompt3DJobStage;
  progress: number;
  providerId: Prompt3DProviderId;
  spec: AssetSpecV1;
  message: string;
  outputDirectory: string;
  variants: Array<{
    index: number;
    glbPath: string;
    previewUrl?: string;
    report: Prompt3DValidationReport;
    provenancePath: string;
    /** Immutable byte and geometry identity measured after canonical validation. */
    sha256: string;
    geometryHash: string;
    byteSize: number;
    validationReportSha256: string;
    provenanceSha256: string;
    /** Explicit visual acceptance bound to this exact generated GLB. */
    visualApproval?: import("./prompt3dWorkflow").Prompt3DVisualApproval;
    visualApprovalPath?: string;
    visualApprovalSha256?: string;
  }>;
  error?: { code: string; message: string; retryable: boolean };
  createdAt: string;
  updatedAt: string;
  autosaveError?: string;
  conceptOnly?: boolean;
  approvedConcept?: boolean;
  approvedConceptJobId?: string;
  conceptImagePath?: string;
  conceptAttempt?: Prompt3DConceptAttempt;
  conceptAttempts?: Prompt3DConceptAttempt[];
  conceptDecisions?: Prompt3DConceptDecision[];
  conceptInspection?: Prompt3DConceptInspectionRecord;
  conceptInspections?: Prompt3DConceptInspectionRecord[];
  conceptApproval?: Prompt3DConceptApproval;
  promptPlan?: import("./prompt3dRules").Prompt3DPromptPlan;
  referenceImage?: Prompt3DRetainedReferenceImage;
  referenceImages?: Prompt3DRetainedReferenceImage[];
  timings?: Prompt3DStageTiming[];
  providerVerification?: Prompt3DProviderVerification;
  /** Exact automatically selected local execution profile used by the current
   * Hunyuan attempt. It is persisted into the task spec and provenance. */
  executionProfile?: Prompt3DSelectedExecutionProfile;
  /** Set only on a visually rejected generated mesh after its corrective successor is retained. */
  geometryRejection?: Prompt3DGeometryRejection;
  geometryRejectionPath?: string;
  geometryRejectionSha256?: string;
  /** Set on the corrective successor; its parentJobId remains the last approved geometry ancestor. */
  rejectedGeometryJobId?: string;
}

export interface Prompt3DHistory {
  latestJob: Prompt3DJobStatus | null;
  previousResult: Prompt3DJobStatus | null;
}

export interface Prompt3DAppRuntime {
  offlineLocalTest: boolean;
  prompt3dRoot: string;
  localControlsEnabled: boolean;
  plannerHost?: string;
}

export interface Prompt3DStartRequest {
  spec: AssetSpecV1;
  /** Exact local picker result. The service re-reads, verifies and copies it before preflight. */
  referenceImage?: Prompt3DReferenceImageSelection;
  /** Exact ordered picker results for official Hunyuan3D-2mv conditioning. */
  referenceImages?: Prompt3DReferenceImageSelection[];
  /** Explicit binding for a corrective generation inside the sole active serial batch. */
  batchId?: string;
  batchItemId?: string;
  conceptOnly?: boolean;
  /** Deprecated legacy geometry-start seam. Exact approval uses approveConcept. */
  approvedConceptJobId?: string;
  parentConceptJobId?: string;
  conceptChangeReason?: "edited" | "regenerated";
  /** Permits a prompt-edited successor after a completed Hunyuan mesh review. */
  shapeRefinement?: boolean;
  /** Explicitly rejects this technically valid, unapproved geometry while branching from its approved parent. */
  rejectedGeometryJobId?: string;
  /** Starts a new root after explicitly rejecting the active batch's first geometry revision. */
  freshRootCorrection?: true;
  consent: { providerId: Prompt3DProviderId; externalData?: string[]; estimatedCostUsd?: number; confirmed: boolean };
}

export interface Prompt3DApproveConceptRequest {
  jobId: string;
  binding: Prompt3DConceptBinding;
  inspection: { checks: Prompt3DConceptInspectionChecks };
}

export interface Prompt3DRejectConceptRequest {
  jobId: string;
  binding: Prompt3DConceptBinding;
  inspection: {
    checks: Prompt3DConceptInspectionChecks;
    classification: Prompt3DConceptRejectionClassification;
    note?: string;
  };
}

export interface Prompt3DPlanRequest {
  currentSpec: AssetSpecV1;
}

export interface Prompt3DPlanResult {
  spec: AssetSpecV1;
  planner: {
    provider: "ollama";
    endpoint: "loopback";
    model: string;
    summary: string;
    warnings: string[];
  };
}

export interface Prompt3DOverview {
  runtime: { offlineLocalTest: boolean; cloudDisabled: boolean; root: string };
  hardware: Prompt3DHardwareSnapshot;
  providers: Array<{
    manifest: Prompt3DProviderManifest;
    compliance: Prompt3DComplianceCheck;
    install: Prompt3DInstallStatus | null;
    cloudConfigured: boolean;
  }>;
}

export const PROMPT3D_CHANNELS = {
  overview: "prompt3d:overview",
  history: "prompt3d:history",
  draft: "prompt3d:draft",
  saveDraft: "prompt3d:save-draft",
  grant: "prompt3d:grant",
  revoke: "prompt3d:revoke",
  plan: "prompt3d:plan",
  refine: "prompt3d:refine",
  saveRevision: "prompt3d:save-revision",
  plannerHost: "prompt3d:planner-host",
  startPlanner: "prompt3d:start-planner",
  chooseRoot: "prompt3d:choose-root",
  chooseReferenceImage: "prompt3d:choose-reference-image",
  chooseReferenceImages: "prompt3d:choose-reference-images",
  inspectDeformation: "prompt3d:inspect-deformation",
  previewDeformation: "prompt3d:preview-deformation",
  install: "prompt3d:install",
  cancelInstall: "prompt3d:cancel-install",
  start: "prompt3d:start",
  approveConcept: "prompt3d:approve-concept",
  rejectConcept: "prompt3d:reject-concept",
  regenerateConcept: "prompt3d:regenerate-concept",
  status: "prompt3d:status",
  cancel: "prompt3d:cancel",
  retry: "prompt3d:retry",
  reveal: "prompt3d:reveal",
  installProgress: "prompt3d:install-progress",
  jobProgress: "prompt3d:job-progress",
  runtime: "app:runtime",
} as const;
