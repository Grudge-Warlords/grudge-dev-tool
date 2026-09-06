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
  coordinateContract: {
    upAxis: "+Y";
    forwardAxis: "+Z";
    origin: "ground-center";
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
  | "concept-image"
  | "geometry"
  | "texture"
  | "postprocess"
  | "validation"
  | "quarantine"
  | "complete"
  | "cancelled"
  | "failed";

export interface Prompt3DJobStatus {
  id: string;
  state: "queued" | "running" | "complete" | "cancelled" | "failed";
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
}

export interface Prompt3DStartRequest {
  spec: AssetSpecV1;
  consent: { providerId: Prompt3DProviderId; externalData?: string[]; estimatedCostUsd?: number; confirmed: boolean };
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
  grant: "prompt3d:grant",
  plan: "prompt3d:plan",
  chooseRoot: "prompt3d:choose-root",
  install: "prompt3d:install",
  cancelInstall: "prompt3d:cancel-install",
  start: "prompt3d:start",
  status: "prompt3d:status",
  cancel: "prompt3d:cancel",
  retry: "prompt3d:retry",
  reveal: "prompt3d:reveal",
  installProgress: "prompt3d:install-progress",
  jobProgress: "prompt3d:job-progress",
  runtime: "app:runtime",
} as const;
