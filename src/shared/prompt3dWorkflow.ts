import type { AssetCategory, AssetSpecV1, AssetStyle, Prompt3DValidationReport } from "./prompt3d";
import type { Prompt3DVisualInspectionEvidence, Prompt3DVisualInspectionStage } from "./prompt3dVisualInspection";
import type { BonePlacement } from "./mixamo25";

export const PROMPT3D_WORKFLOW_VERSION = 1 as const;
export const PROMPT3D_MIN_WORKFLOW_TEXTURE_REVISIONS = 1 as const;
export const PROMPT3D_MIN_WORKFLOW_ANIMATION_REVISIONS = 1 as const;
export const PROMPT3D_MIN_BATCH_FINISH_PROMPTS = 2 as const;
export const PROMPT3D_STRICT_BATCH_ITEM_COUNT = 6 as const;

export type Prompt3DAssetSource =
  | { kind: "generation"; jobId: string; variantIndex?: number }
  | { kind: "finish"; jobId: string };

export type Prompt3DFinishOperation = "texture" | "animation";

export type Prompt3DVisualApprovalStage = Prompt3DVisualInspectionStage;

/**
 * An explicit visual decision bound to the exact bytes that were inspected.
 * The renderer supplies completed same-panel inspection evidence; the main process
 * re-measures the bytes, validates that evidence, and persists every identity field.
 */
export interface Prompt3DVisualApproval {
  version: typeof PROMPT3D_WORKFLOW_VERSION;
  approvalId: string;
  stage: Prompt3DVisualApprovalStage;
  assetId: string;
  jobId: string;
  assetPath: string;
  assetSha256: string;
  geometryHash: string;
  promptSha256: string;
  specFingerprint: string;
  textureFingerprint?: string;
  animationFingerprint?: string;
  inspection: Prompt3DVisualInspectionEvidence;
  bindingSha256: string;
  approvedAt: string;
  source: "explicit-user-action";
}

/** The service derives identity fields and verifies this completed same-panel inspection against them. */
export interface Prompt3DApproveVisualRequest {
  source: Prompt3DAssetSource;
  inspection: Prompt3DVisualInspectionEvidence;
}

export type Prompt3DFinishVisualRejectionClassification =
  | "appearance-mismatch"
  | "motion-mismatch"
  | "placement-path-mismatch"
  | "deformation-artifact"
  | "prompt-negation-misunderstanding"
  | "playback-problem"
  | "other";

/** An explicit rejection bound to one exact unapproved texture or animation output. */
export interface Prompt3DFinishVisualRejection {
  version: typeof PROMPT3D_WORKFLOW_VERSION;
  rejectionId: string;
  stage: Prompt3DFinishOperation;
  assetId: string;
  jobId: string;
  assetPath: string;
  assetSha256: string;
  geometryHash: string;
  promptSha256: string;
  specFingerprint: string;
  textureFingerprint?: string;
  animationFingerprint?: string;
  animationPlanSha256?: string;
  classification: Prompt3DFinishVisualRejectionClassification;
  note: string;
  bindingSha256: string;
  rejectedAt: string;
  source: "explicit-user-action";
}

export interface Prompt3DRejectFinishVisualRequest {
  source: Extract<Prompt3DAssetSource, { kind: "finish" }>;
  classification: Prompt3DFinishVisualRejectionClassification;
  note?: string;
}

export interface Prompt3DWorkflowRootLineage {
  version: typeof PROMPT3D_WORKFLOW_VERSION;
  kind: "generation";
  assetId: string;
  jobId: string;
  variantIndex: number;
  method: "hunyuan3d-neural-generation";
  provider: "hunyuan3d-2";
  providerSourceRevision: string;
  providerVerification: import("./prompt3d").Prompt3DProviderVerification;
  /** Required on newly generated roots; optional only for retained pre-profile records. */
  executionProfile?: import("./prompt3d").Prompt3DSelectedExecutionProfile;
  specFingerprint: string;
  promptSha256: string;
  conceptSha256: string;
  conceptApprovalSha256: string;
  /** Present only when this generation used retained local image conditioning. */
  referenceSha256?: string;
  /** Ordered byte identities and camera roles for official Hunyuan3D-2mv conditioning. */
  referenceSha256s?: string[];
  referenceViews?: import("./prompt3d").Prompt3DReferenceImageView[];
  /** Exact three-check concept inspection; absent only on reopened legacy completed assets. */
  conceptInspectionSha256?: string;
  outputPath: string;
  outputSha256: string;
  geometryHash: string;
  byteSize: number;
  provenancePath: string;
  provenanceSha256: string;
  visualApproval: Prompt3DVisualApproval;
  visualApprovalPath: string;
  visualApprovalSha256: string;
  /** False only for the approved base mesh; every successor is a prompted Hunyuan shape refinement. */
  shapeRefinement: boolean;
  /** Exact preceding approved Hunyuan generation for a shape-refinement successor. */
  parentJobId?: string;
  parentPromptSha256?: string;
  parentOutputSha256?: string;
  parentGeometryHash?: string;
  parentProvenanceSha256?: string;
  parentVisualApprovalSha256?: string;
}

export interface Prompt3DWorkflowRevisionLineage {
  version: typeof PROMPT3D_WORKFLOW_VERSION;
  assetId: string;
  jobId: string;
  operation: Prompt3DFinishOperation;
  provider: "hunyuan3d-paint-2.1" | "grudge-motion-graph-1" | "hy-motion-1.0-lite";
  providerVerification?: import("./prompt3d").Prompt3DProviderVerification;
  executionProfile?: import("./prompt3d").Prompt3DSelectedExecutionProfile;
  sourceJobId: string;
  sourceSha256: string;
  sourceGeometryHash: string;
  outputPath: string;
  outputSha256: string;
  geometryHash: string;
  byteSize: number;
  specFingerprint: string;
  promptSha256: string;
  provenancePath: string;
  provenanceSha256: string;
  parentProvenanceSha256: string;
  visualApproval: Prompt3DVisualApproval;
  visualApprovalPath: string;
  visualApprovalSha256: string;
  sourceTextureFingerprint: string;
  outputTextureFingerprint: string;
  textureReferenceSha256?: string;
  animationFingerprint?: string;
  animationPlanSha256?: string;
  motionDataSha256?: string;
  clipIds?: string[];
  animationRoute?: Prompt3DAnimationRoute;
  rigPreparation?: Prompt3DRigPreparationEvidence;
}

export interface Prompt3DWorkflowLineage {
  version: typeof PROMPT3D_WORKFLOW_VERSION;
  assetId: string;
  /** Ordered approved Hunyuan generations: one base and any prompted refinements the user chose to make. */
  generationChain: Prompt3DWorkflowRootLineage[];
  /** Explicit, hash-bound user decision used only when the approved base generation goes straight to texture. */
  existingGeometryDecision?: Prompt3DExistingGeometryDecision;
  /** The final approved Hunyuan generation used as the immutable source of every finishing revision. */
  root: Prompt3DWorkflowRootLineage;
  revisions: Prompt3DWorkflowRevisionLineage[];
  finalJobId: string;
  finalSha256: string;
  finalGeometryHash: string;
  chainSha256: string;
}

export interface Prompt3DExistingGeometryDecision {
  version: typeof PROMPT3D_WORKFLOW_VERSION;
  decisionId: string;
  bindingSha256: string;
  source: "explicit-user-action";
  decidedAt: string;
  mode: "use-existing-generated-model";
  assetId: string;
  generationJobId: string;
  variantIndex: 0;
  assetSha256: string;
  geometryHash: string;
  visualApprovalSha256: string;
}

export type Prompt3DWorkflowEvidenceKind =
  | "lineage"
  | "generation-output"
  | "finish-output"
  | "provenance"
  | "concept-image"
  | "concept-source"
  | "concept-review"
  | "concept-attempt"
  | "concept-inspection"
  | "concept-approval"
  | "reference-image"
  | "geometry-rejection"
  | "visual-approval"
  | "texture-reference"
  | "spec"
  | "plan"
  | "validation"
  | "job-record"
  | "event"
  | "log"
  | "other";

/**
 * One immutable source path retained inside a managed evidence bundle. Bundle
 * paths are portable, slash-separated paths relative to the manifest folder.
 */
export interface Prompt3DWorkflowEvidenceBundleEntry {
  sourcePath: string;
  bundlePath: string;
  kind: Prompt3DWorkflowEvidenceKind;
  byteSize: number;
  sha256: string;
}

/** A hash-sealed map that lets immutable lineage keep its original path bindings. */
export interface Prompt3DWorkflowEvidenceBundleManifest {
  version: typeof PROMPT3D_WORKFLOW_VERSION;
  bundleId: string;
  assetId: string;
  sourceJobId: string;
  createdAt: string;
  lineageSourcePath: string;
  lineageSha256: string;
  entries: Prompt3DWorkflowEvidenceBundleEntry[];
  sealSha256: string;
}

export interface Prompt3DAnimationOverrides {
  deformationEdit?: import("./deformationRegions").DeformationEdit;
  duration?: number;
  cycles?: number;
  intensity?: number;
  distance?: number;
  mode?: "replace" | "append";
  /** CPU is the default and never probes GPU/headroom or HY-Motion installation. */
  provider?: "auto-cpu" | "local-animation-library" | "hy-motion-1.0-lite";
  /** Exact installed Skeleton Studio library. The service resolves it from the local inventory. */
  libraryPackDir?: string;
  libraryClipName?: string;
  /** Complete explicit correction returned by Skeleton Studio; partial marker sets fail closed. */
  rigPlacements?: BonePlacement[];
  /** Exact painted parent bound to the correction handoff. Stale marker sets fail closed. */
  rigCorrectionSourceSha256?: string;
}

export type Prompt3DAnimationRoute =
  | "existing-rig"
  | "deterministic-cpu-rig"
  | "local-animation-library"
  | "deterministic-morph-deformation"
  | "rigid-object-motion"
  | "hy-motion-1.0-lite";

export interface Prompt3DRigPreparationEvidence {
  version: 1;
  route: "existing-rig" | "deterministic-cpu-rig";
  profile: "grudge-mixamo25-cpu-fit-v1";
  sourcePath: string;
  sourceSha256: string;
  outputPath: string;
  outputSha256: string;
  parentRevisionSha256: string;
  placementMethod: "retained-canonical-joints" | "canonical-proportion-fit" | "skeleton-studio-correction";
  weightsMethod: "retained-compatible-skin" | "nearest-bone-segment-four-weight-v1";
  placements: BonePlacement[];
  classification: Record<string, unknown>;
  inspection: Record<string, unknown>;
  sourceGeometryHash?: string;
  outputGeometryHash?: string;
  sourceTextureFingerprint?: string;
  outputTextureFingerprint?: string;
}

export interface Prompt3DRigReviewRequest {
  code: "SKELETON_STUDIO_REVIEW_REQUIRED";
  sourcePath: string;
  sourceSha256: string;
  reason: string;
  classification: Record<string, unknown>;
  checks: Array<{ id: string; status: "pass" | "review"; detail: string }>;
  suggestedPlacements?: BonePlacement[];
}

export interface Prompt3DFinishRequest {
  source: Prompt3DAssetSource;
  operation: Prompt3DFinishOperation;
  instruction: string;
  seed?: number;
  animation?: Prompt3DAnimationOverrides;
  /** Explicit Stage 4 decision to texture the exact approved base model without shape refinement. */
  useExistingGeneratedModel?: true;
  /** Exact explicitly rejected sibling whose approved parent is used for this correction. */
  rejectedFinishJobId?: string;
  batchId?: string;
  batchItemId?: string;
}

export interface Prompt3DFinishValidation {
  selfContained: boolean;
  sourceGeometryPreserved: boolean;
  sourceGeometryHash: string;
  outputGeometryHash: string;
  embeddedTextures: number;
  sourceTextureFingerprint: string;
  outputTextureFingerprint: string;
  textureChanged: boolean;
  outputAnimationFingerprint: string;
  animations: Array<{ name: string; duration: number; channels: number }>;
  motion?: {
    operators: string[];
    pathDisplacementMeters: number;
    morphTargets: number;
    trailNodes: number;
    effectiveDeformationTargets: number;
    maximumDeformationRatio: number;
    skins?: number;
    joints?: number;
    skinnedMeshNodes?: number;
    boneRotationChannels?: number;
  };
  checks: string[];
}

export interface Prompt3DFinishJobStatus {
  version: typeof PROMPT3D_WORKFLOW_VERSION;
  id: string;
  assetId: string;
  source: Prompt3DAssetSource;
  sourceAssetPath: string;
  sourceSha256: string;
  sourceGeometryHash: string;
  operation: Prompt3DFinishOperation;
  instruction: string;
  seed: number;
  state: "queued" | "running" | "complete" | "cancelled" | "failed";
  stage: "queued" | "compliance" | "reference-image" | "texture" | "animation" | "validation" | "complete" | "cancelled" | "failed";
  progress: number;
  message: string;
  outputDirectory: string;
  assetPath?: string;
  sha256?: string;
  geometryHash?: string;
  provenancePath?: string;
  validation?: Prompt3DFinishValidation;
  technicalValidation?: Prompt3DValidationReport;
  animationPlan?: Record<string, unknown>;
  motionCompatibility?: Record<string, unknown>;
  animationRoute?: Prompt3DAnimationRoute;
  rigPreparation?: Prompt3DRigPreparationEvidence;
  rigReview?: Prompt3DRigReviewRequest;
  visualApproval?: Prompt3DVisualApproval;
  visualApprovalPath?: string;
  visualApprovalSha256?: string;
  visualRejection?: Prompt3DFinishVisualRejection;
  visualRejectionPath?: string;
  visualRejectionSha256?: string;
  /** Exact rejected sibling from which this corrective prompt was launched. */
  rejectedFinishJobId?: string;
  /** Retained only on the first texture revision created from an approved, unrefined base generation. */
  usedExistingGeneratedModel?: true;
  lineage: Prompt3DWorkflowLineage;
  lineagePath?: string;
  lineageSha256?: string;
  providerVerification?: import("./prompt3d").Prompt3DProviderVerification;
  /** Exact automatically selected hardware-capability profile for this stage. */
  executionProfile?: import("./prompt3d").Prompt3DSelectedExecutionProfile;
  provider: "hunyuan3d-paint-2.1" | "grudge-motion-graph-1" | "hy-motion-1.0-lite";
  baseSpec: AssetSpecV1;
  batchId?: string;
  batchItemId?: string;
  error?: { code: string; message: string; retryable: boolean };
  createdAt: string;
  updatedAt: string;
}

export interface Prompt3DFinishHistory {
  jobs: Prompt3DFinishJobStatus[];
  latest: Prompt3DFinishJobStatus | null;
}

export interface Prompt3DWorkflowLibraryAsset {
  version: 1;
  id: string;
  assetId: string;
  sourceJobId: string;
  name: string;
  savedPath: string;
  savedAt: string;
  byteSize: number;
  sha256: string;
  geometryHash: string;
  prompt: string;
  category: AssetCategory;
  style: AssetStyle;
  method: "hunyuan3d-workflow";
  provider: "hunyuan3d-2";
  textures: number;
  animations: number;
  rootGenerationJobId: string;
  lineagePath: string;
  lineageSha256: string;
  evidenceBundleManifestPath: string;
  evidenceBundleManifestSha256: string;
  finalVisualApprovalSha256: string;
}

export interface Prompt3DWorkflowSaveResult {
  asset: Prompt3DWorkflowLibraryAsset;
  alreadySaved: boolean;
  localAssetsRoot: string;
}

export interface Prompt3DWorkflowExportReceipt {
  destinationPath: string;
  filename: string;
  sha256: string;
  byteSize: number;
}

export interface Prompt3DWorkflowPortableExportRecord extends Prompt3DWorkflowExportReceipt {
  version: 1;
  id: string;
  source: Prompt3DAssetSource;
  assetId: string;
  sourceJobId: string;
  rootGenerationJobId: string;
  exportedAt: string;
  geometryHash: string;
  textures: number;
  textureFingerprint: string;
  animations: Array<{ name: string; duration: number; channels: number }>;
  animationFingerprint: string;
  lineagePath: string;
  lineageSha256: string;
  evidenceBundleManifestPath: string;
  evidenceBundleManifestSha256: string;
  finalVisualApprovalSha256: string;
  recordSha256: string;
}

export interface Prompt3DWorkflowExportResult extends Prompt3DWorkflowExportReceipt {
  record: Prompt3DWorkflowPortableExportRecord;
}

export type Prompt3DWorkflowArtifactRequest =
  | { kind: "managed"; id: string }
  | { kind: "portable"; id: string };

export interface Prompt3DWorkflowArtifactVerification {
  version: 1;
  kind: Prompt3DWorkflowArtifactRequest["kind"];
  id: string;
  sourceJobId: string;
  assetId: string;
  path: string;
  filename: string;
  sha256: string;
  byteSize: number;
  geometryHash: string;
  textures: number;
  textureFingerprint: string;
  animations: Array<{ name: string; duration: number; channels: number }>;
  animationFingerprint: string;
  lineagePath: string;
  lineageSha256: string;
  evidenceBundleManifestPath: string;
  evidenceBundleManifestSha256: string;
  finalVisualApprovalSha256: string;
  retainedGeometry: true;
  retainedTextures: true;
  retainedAnimations: true;
  verifiedAt: string;
}

export interface Prompt3DBatchItem {
  id: string;
  name: string;
  spec: AssetSpecV1;
  shapeRefinement: string;
  texturePrompts: string[];
  animationRevisions: Prompt3DBatchAnimationRevision[];
  animation?: Prompt3DAnimationOverrides;
  /** Required only by the opt-in strict final-run profile. */
  baselineManagedAssetId?: string;
}

export interface Prompt3DBatchAnimationRevision {
  prompt: string;
  mode: "replace" | "append";
}

export interface Prompt3DBatchRequest {
  name: string;
  items: Prompt3DBatchItem[];
  acceptance?: Prompt3DBatchAcceptancePolicy;
}

export interface Prompt3DBatchAcceptancePolicy {
  profile: "strict-final-run-v1";
  expectedItemCount: typeof PROMPT3D_STRICT_BATCH_ITEM_COUNT;
}

export interface Prompt3DBatchItemStatus {
  id: string;
  name: string;
  state: "queued" | "concept" | "awaiting-approval" | "geometry" | "texture" | "animation" | "complete" | "failed" | "cancelled";
  progress: number;
  currentJobId?: string;
  finalSource?: Prompt3DAssetSource;
  finalAssetPath?: string;
  savedAsset?: Prompt3DWorkflowLibraryAsset;
  portableExport?: Prompt3DBatchPortableExport;
  message: string;
}

export interface Prompt3DBatchRuntimeItem {
  baseComplete: boolean;
  shapeComplete: boolean;
  nextTexture: number;
  nextAnimation: number;
  currentKind?: "base" | "shape" | "texture" | "animation";
  currentJobId?: string;
  currentSource?: Prompt3DAssetSource;
  retryFinish?: {
    operation: Prompt3DFinishOperation;
    revisionIndex: number;
    request: Prompt3DFinishRequest;
  };
}

export interface Prompt3DBatchPortableExport {
  version: typeof PROMPT3D_WORKFLOW_VERSION;
  destinationPath: string;
  filename: string;
  sha256: string;
  byteSize: number;
  exportedAt: string;
  recordId: string;
  recordSha256: string;
  reopenVerification: Prompt3DWorkflowArtifactVerification;
}

export interface Prompt3DBatchAcceptanceGenerationEvidence {
  jobId: string;
  seed: number;
  conceptSha256: string;
  outputSha256: string;
  geometryHash: string;
}

export interface Prompt3DBatchAcceptanceFinishEvidence {
  jobId: string;
  operation: Prompt3DFinishOperation;
  revisionIndex: number;
  seed: number;
  promptSha256: string;
  outputSha256: string;
}

export interface Prompt3DBatchAcceptanceBaselineEvidence extends Prompt3DBatchAcceptanceGenerationEvidence {
  managedAssetId: string;
  sourceJobId: string;
  finalSha256: string;
  /** Every approved Hunyuan generation retained by the individual workflow, in lineage order. */
  generationChain: Prompt3DBatchAcceptanceGenerationEvidence[];
}

export interface Prompt3DBatchAcceptanceItemEvidence {
  itemId: string;
  requestedSeed: number;
  assignedSeed: number;
  /** Globally unused seeds reserved atomically at strict-batch admission for generations and finishing revisions. */
  reservedSeeds: number[];
  baselineIntentSha256: string;
  requestIntentSha256: string;
  baseline: Prompt3DBatchAcceptanceBaselineEvidence;
  base?: Prompt3DBatchAcceptanceGenerationEvidence;
  refined?: Prompt3DBatchAcceptanceGenerationEvidence;
  finishing: Prompt3DBatchAcceptanceFinishEvidence[];
  managed?: Prompt3DWorkflowLibraryAsset;
  portable?: Prompt3DBatchPortableExport;
}

export interface Prompt3DBatchAcceptanceReceiptItem {
  itemId: string;
  requestedSeed: number;
  assignedSeed: number;
  reservedSeeds: number[];
  baselineIntentSha256: string;
  requestIntentSha256: string;
  baseline: Prompt3DBatchAcceptanceBaselineEvidence;
  base: Prompt3DBatchAcceptanceGenerationEvidence;
  refined: Prompt3DBatchAcceptanceGenerationEvidence;
  finishing: Prompt3DBatchAcceptanceFinishEvidence[];
  managed: Prompt3DWorkflowLibraryAsset;
  portable: Prompt3DBatchPortableExport;
}

export interface Prompt3DBatchAcceptanceReceipt {
  version: typeof PROMPT3D_WORKFLOW_VERSION;
  batchId: string;
  profile: Prompt3DBatchAcceptancePolicy["profile"];
  expectedItemCount: typeof PROMPT3D_STRICT_BATCH_ITEM_COUNT;
  eligible: true;
  serviceRunId: string;
  restoreCount: 0;
  retryCount: 0;
  exportAttemptCount: 1;
  managedCount: typeof PROMPT3D_STRICT_BATCH_ITEM_COUNT;
  portableCount: typeof PROMPT3D_STRICT_BATCH_ITEM_COUNT;
  items: Prompt3DBatchAcceptanceReceiptItem[];
  sealedAt: string;
}

export interface Prompt3DBatchAcceptanceEvidence {
  version: typeof PROMPT3D_WORKFLOW_VERSION;
  profile: Prompt3DBatchAcceptancePolicy["profile"];
  expectedItemCount: typeof PROMPT3D_STRICT_BATCH_ITEM_COUNT;
  eligible: boolean;
  serviceRunId: string;
  restoreCount: number;
  retryCount: number;
  exportAttemptCount: number;
  admittedAt: string;
  items: Prompt3DBatchAcceptanceItemEvidence[];
  receiptPath?: string;
  receiptSha256?: string;
  sealedAt?: string;
}

export interface Prompt3DBatchExportResult {
  version: typeof PROMPT3D_WORKFLOW_VERSION;
  batchId: string;
  destinationDirectory: string;
  items: Array<{
    itemId: string;
    name: string;
    source: Prompt3DAssetSource;
    export: Prompt3DBatchPortableExport;
  }>;
  exportedAt: string;
}

export interface Prompt3DBatchStatus {
  version: 1;
  id: string;
  name: string;
  state: "running" | "awaiting-approval" | "complete" | "failed" | "cancelled";
  request: Prompt3DBatchRequest;
  runtime: Record<string, Prompt3DBatchRuntimeItem>;
  items: Prompt3DBatchItemStatus[];
  createdAt: string;
  updatedAt: string;
  manifestPath: string;
  localAssetsRoot?: string;
  acceptance?: Prompt3DBatchAcceptanceEvidence;
  message: string;
}

export function shouldRehydratePrompt3DBatch(
  status: Prompt3DBatchStatus | null,
  dismissedTerminalBatchId: string | null,
): status is Prompt3DBatchStatus {
  if (!status) return false;
  if (status.id !== dismissedTerminalBatchId) return true;
  return status.state === "running" || status.state === "awaiting-approval";
}

export const PROMPT3D_WORKFLOW_CHANNELS = {
  finishStart: "prompt3d:finish-start",
  finishHistory: "prompt3d:finish-history",
  finishStatus: "prompt3d:finish-status",
  finishCancel: "prompt3d:finish-cancel",
  finishProgress: "prompt3d:finish-progress",
  approveVisual: "prompt3d:approve-visual",
  rejectFinishVisual: "prompt3d:reject-finish-visual",
  save: "prompt3d:workflow-save",
  library: "prompt3d:workflow-library",
  export: "prompt3d:workflow-export",
  exportHistory: "prompt3d:workflow-export-history",
  verifyArtifact: "prompt3d:workflow-verify-artifact",
  batchStart: "prompt3d:batch-start",
  batchStatus: "prompt3d:batch-status",
  batchCancel: "prompt3d:batch-cancel",
  batchRetry: "prompt3d:batch-retry",
  batchExport: "prompt3d:batch-export",
  batchProgress: "prompt3d:batch-progress",
} as const;
