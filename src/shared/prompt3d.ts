export const PROMPT3D_SPEC_VERSION = "1.0.0" as const;
export const PROMPT3D_MANIFEST_VERSION = 1 as const;

export type Prompt3DProviderId = "hunyuan3d-2" | "trellis" | "meshy" | "tripo";
export type LocalPrompt3DProviderId = Extract<Prompt3DProviderId, "hunyuan3d-2" | "trellis">;
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

export interface AssetSpecV1 {
  version: typeof PROMPT3D_SPEC_VERSION;
  prompt: string;
  category: AssetCategory;
  style: AssetStyle;
  customStyle?: string;
  route: Prompt3DRoute;
  targetFormat: "glb";
  dimensions: { width: number; height: number; depth: number; unit: "m" | "cm" };
  budgets: { maxTriangles: number; maxTextureResolution: 512 | 1024 | 2048 | 4096; maxTextureBytes: number };
  seed: number;
  variants: number;
  providerId: Prompt3DProviderId;
  generateTextures: boolean;
  generateCollision: boolean;
  generateLods: boolean;
  /** Preserve silhouette by scaling uniformly to height unless explicitly overridden. */
  scaleMode?: "preserve" | "exact";
  objectRules?: import("./prompt3dRules").Prompt3DObjectRules;
  coordinateContract: {
    upAxis: "+Y";
    forwardAxis: "+Z";
    origin: "ground-center" | "attachment-point";
    stableRootName: string;
  };
}

export interface Prompt3DProviderManifest {
  id: Prompt3DProviderId;
  name: string;
  kind: "local" | "cloud";
  summary: string;
  routes: Prompt3DRoute[];
  enabledRoutes: Prompt3DRoute[];
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
  requiredComponents: string[];
}

export interface Prompt3DHardwareSnapshot {
  checkedAt: string;
  os: { platform: string; release: string; version: string; windowsBuild?: string };
  gpu: { vendor: string; model: string; driver?: string; totalVramBytes: number; freeVramBytes: number; usedVramBytes: number; cudaComputeCapability?: string } | null;
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
}

export interface Prompt3DConceptTechnicalReview {
  status: "pass" | "needs-regeneration";
  method: string;
  message: string;
  reportPath: string;
  checkedAt: string;
}

/** Immutable facts for one retained concept generation attempt. */
export interface Prompt3DConceptAttempt {
  attemptNumber: number;
  binding: Prompt3DConceptBinding;
  conceptImagePath: string;
  promptPlan: import("./prompt3dRules").Prompt3DPromptPlan;
  technicalReview: Prompt3DConceptTechnicalReview;
  createdAt: string;
}

/** Append-only record of explicit user choices between retained attempts. */
export interface Prompt3DConceptDecision {
  kind: "approved" | "regenerated" | "edited";
  source: "explicit-user-action";
  at: string;
  jobId: string;
  attemptId: string;
  nextJobId?: string;
}

export interface Prompt3DConceptApproval extends Prompt3DConceptBinding {
  approvedAt: string;
  source: "explicit-user-action";
}

export interface Prompt3DJobStatus {
  id: string;
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
  conceptApproval?: Prompt3DConceptApproval;
  promptPlan?: import("./prompt3dRules").Prompt3DPromptPlan;
  timings?: Prompt3DStageTiming[];
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
  conceptOnly?: boolean;
  /** Deprecated legacy geometry-start seam. Exact approval uses approveConcept. */
  approvedConceptJobId?: string;
  parentConceptJobId?: string;
  conceptChangeReason?: "edited" | "regenerated";
  consent: { providerId: Prompt3DProviderId; externalData?: string[]; estimatedCostUsd?: number; confirmed: boolean };
}

export interface Prompt3DApproveConceptRequest {
  jobId: string;
  binding: Prompt3DConceptBinding;
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
  install: "prompt3d:install",
  cancelInstall: "prompt3d:cancel-install",
  start: "prompt3d:start",
  approveConcept: "prompt3d:approve-concept",
  regenerateConcept: "prompt3d:regenerate-concept",
  status: "prompt3d:status",
  cancel: "prompt3d:cancel",
  retry: "prompt3d:retry",
  reveal: "prompt3d:reveal",
  installProgress: "prompt3d:install-progress",
  jobProgress: "prompt3d:job-progress",
  runtime: "app:runtime",
} as const;
