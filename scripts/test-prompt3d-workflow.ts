import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import type {
  AssetSpecV1,
  Prompt3DConceptAttempt,
  Prompt3DConceptDecision,
  Prompt3DConceptInspectionRecord,
  Prompt3DProviderVerification,
  Prompt3DValidationReport,
} from "../src/shared/prompt3d";
import type {
  Prompt3DFinishJobStatus,
  Prompt3DVisualApproval,
  Prompt3DWorkflowLineage,
  Prompt3DWorkflowRevisionLineage,
} from "../src/shared/prompt3dWorkflow";
import {
  PROMPT3D_MIN_WORKFLOW_ANIMATION_REVISIONS,
  PROMPT3D_MIN_WORKFLOW_TEXTURE_REVISIONS,
} from "../src/shared/prompt3dWorkflow";
import {
  createPrompt3DVisualInspection,
  finalizePrompt3DVisualInspection,
  recordPrompt3DClipPlayback,
  recordPrompt3DViewpoint,
  setPrompt3DInspectionAttestation,
} from "../src/shared/prompt3dVisualInspection";
import { authorPromptedAnimation } from "../src/main/prompt3d/promptedAnimation";
import { assertShapeRefinementConceptChain, createConceptApproval, createConceptBinding, sha256Hex } from "../src/main/prompt3d/conceptApproval";
import { createConceptInspectionEvidence } from "../src/main/prompt3d/conceptInspection";
import { stableJson } from "../src/shared/conceptWorkflow";
import { estimateHunyuanClipTokens, PROMPT3D_CLIP_SAFE_TOKEN_BUDGET } from "../src/shared/prompt3dRules";
import {
  recordWorkflowExport,
  verifyWorkflowArtifact,
  workflowExportHistory,
} from "../src/main/prompt3d/artifactVerification";
import {
  compileTextureReferencePrompt,
  normalizeTextureInstruction,
  containedWorkflowPath,
  createPrompt3DExistingGeometryDecision,
  createPrompt3DFinishVisualRejection,
  createPrompt3DVisualApproval,
  assertFinishVisualRejectionMatches,
  assertVisualApprovalMatches,
  inspectWorkflowGlb,
  prompt3DWorkflowUsesExistingGeneratedModel,
  readWorkflowJobs,
  recordWorkflowJob,
  saveWorkflowAsset,
  sealPrompt3DWorkflowLineage,
  sha256Bytes,
  stableWorkflowSha256,
  validateFinishedAsset,
  validatePrompt3DWorkflowLineage,
  verifyPrompt3DWorkflowEvidenceBundle,
  workflowLibrary,
  workflowPromptSha256,
  workflowSpecFingerprint,
} from "../src/main/prompt3d/workflow";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=", "base64");
const ASSET_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BASE_JOB_ID = "99999999-aaaa-4bbb-8ccc-dddddddddddd";
const FIRST_REFINEMENT_CONCEPT_JOB_ID = "12121212-3434-4567-8abc-121212121212";
const SECOND_REFINEMENT_CONCEPT_JOB_ID = "23232323-4545-4678-9bcd-232323232323";
const EARLIER_REJECTED_GEOMETRY_JOB_ID = "45454545-6767-489a-9def-454545454545";
const REJECTED_GEOMETRY_JOB_ID = "34343434-5656-4789-8cde-343434343434";
const ROOT_JOB_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const TEXTURE_JOB_ID = "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa";
const TEXTURE_REFINEMENT_JOB_ID = "22222222-3333-4444-8555-666666666666";
const ANIMATION_JOB_ID = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const FINAL_JOB_ID = "11111111-2222-4333-8444-555555555555";
const SKIP_TEXTURE_JOB_ID = "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb";
const NOW = "2026-08-31T01:02:03.000Z";

function io() {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS);
}

async function fixture(path: string, options: {
  texture?: boolean;
  textureVariant?: number;
  derived?: boolean;
  changed?: boolean;
  translated?: boolean;
  reparented?: boolean;
} = {}) {
  const document = new Document();
  const buffer = document.createBuffer("fixture");
  const offset = options.changed ? 0.2 : 0;
  const positions = new Float32Array([
    -0.5, 0, -0.5, 0.5 + offset, 0, -0.5, 0.5, 1, -0.5, -0.5, 1, -0.5,
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0.5, -0.5, 1, 0.5,
  ]);
  const normals = new Float32Array(positions.length).fill(0);
  for (let index = 1; index < normals.length; index += 3) normals[index] = 1;
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint16Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4]);
  const primitive = document.createPrimitive()
    .setAttribute("POSITION", document.createAccessor().setType("VEC3").setArray(positions).setBuffer(buffer))
    .setAttribute("NORMAL", document.createAccessor().setType("VEC3").setArray(normals).setBuffer(buffer))
    .setAttribute("TEXCOORD_0", document.createAccessor().setType("VEC2").setArray(uv).setBuffer(buffer))
    .setIndices(document.createAccessor().setType("SCALAR").setArray(indices).setBuffer(buffer));
  if (options.texture) {
    const materialName = `generated material ${options.textureVariant ?? 1}`;
    const texture = document.createTexture(materialName).setImage(PNG).setMimeType("image/png");
    primitive.setMaterial(document.createMaterial(materialName).setBaseColorTexture(texture));
  }
  const mesh = document.createMesh("HunyuanMesh").addPrimitive(primitive);
  const generated = document.createNode("GeneratedMesh").setMesh(mesh);
  if (options.translated) generated.setTranslation([0.25, 0, 0]);
  const stableRoot = document.createNode("GrudgeAssetRoot");
  if (options.reparented) stableRoot.addChild(document.createNode("IdentityPivot").addChild(generated));
  else stableRoot.addChild(generated);
  document.createScene("scene").addChild(stableRoot);
  if (options.derived) {
    const lodPrimitive = document.createPrimitive()
      .setAttribute("POSITION", document.createAccessor().setType("VEC3").setArray(positions.slice()).setBuffer(buffer))
      .setIndices(document.createAccessor().setType("SCALAR").setArray(indices.slice()).setBuffer(buffer));
    const lod = document.createMesh("HunyuanMesh_LOD1").addPrimitive(lodPrimitive);
    stableRoot.addChild(document.createNode("Derived LOD").setMesh(lod));
    const trailPrimitive = document.createPrimitive()
      .setAttribute("POSITION", document.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 0.1, 0, -1, -0.1, 0, -1])).setBuffer(buffer))
      .setIndices(document.createAccessor().setType("SCALAR").setArray(new Uint16Array([0, 1, 2])).setBuffer(buffer));
    const trail = document.createMesh("Generated trail").addPrimitive(trailPrimitive);
    stableRoot.addChild(document.createNode("Generated trail").setMesh(trail).setExtras({ grudgeMotionTrail: true, grudgeDerivedGeometry: true }));
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, await io().writeBinary(document));
}

const baseSpec: AssetSpecV1 = {
  version: "1.0.0",
  prompt: "an original isolated object with a coherent silhouette",
  category: "prop",
  style: "realistic",
  route: "concept-image-to-3d",
  targetFormat: "glb",
  dimensions: { width: 1, height: 1, depth: 1, unit: "m" },
  budgets: { maxTriangles: 50_000, maxTextureResolution: 1024, maxTextureBytes: 16 * 1024 ** 2 },
  seed: 42,
  variants: 1,
  providerId: "hunyuan3d-2",
  generateTextures: false,
  generateCollision: false,
  generateLods: false,
  scaleMode: "exact",
  coordinateContract: { upAxis: "+Y", forwardAxis: "+Z", origin: "ground-center", stableRootName: "GrudgeAssetRoot" },
};
const firstRefinementSpec: AssetSpecV1 = { ...baseSpec, prompt: `${baseSpec.prompt}\n\nShape refinement: make the silhouette taller and more asymmetric`, seed: 43 };
const secondRefinementSpec: AssetSpecV1 = { ...firstRefinementSpec, seed: 44 };
const rootSpec: AssetSpecV1 = { ...secondRefinementSpec, seed: 45 };
const textureSpec: AssetSpecV1 = { ...rootSpec, seed: 46, generateTextures: true };
const textureRefinementSpec: AssetSpecV1 = { ...textureSpec, seed: 47 };
const animationSpec: AssetSpecV1 = { ...textureRefinementSpec, seed: 48 };
const animationRefinementSpec: AssetSpecV1 = { ...animationSpec, seed: 49 };

const digest = (value: unknown) => stableWorkflowSha256(value);
const providerVerification: Prompt3DProviderVerification = {
  version: 1,
  providerId: "hunyuan3d-2",
  sourceRevision: "official-hunyuan-test-revision",
  verificationMode: "deep",
  verifiedAt: NOW,
  reason: "Test fixture binds a complete deep-verification evidence shape.",
  installManifestSha256: digest("manifest"),
  workerSha256: digest("worker"),
  modelSnapshots: [{ id: "tencent/Hunyuan3D-2", revision: "pinned-test-revision", treeSha256: digest("model-tree") }],
  runtimeLocks: { pipFreezeSha256: digest("pip-lock"), condaExplicitSha256: digest("conda-lock"), nativeArtifactsSha256: digest("native-lock") },
};
const generationProviderVerification = {
  ...providerVerification,
  // Generation records created before the Hunyuan Paint native extension was
  // installed remain authoritative. The Paint revisions below retain the full
  // current verification, including the native inventory.
  runtimeLocks: {
    pipFreezeSha256: providerVerification.runtimeLocks.pipFreezeSha256,
    condaExplicitSha256: providerVerification.runtimeLocks.condaExplicitSha256,
  },
} as Prompt3DProviderVerification;

async function writeJsonEvidence(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeFile(path, bytes);
  return { path, sha256: sha256Bytes(bytes) };
}

async function writeConceptEvidence(
  directory: string,
  jobId: string,
  attemptNumber: number,
  spec: AssetSpecV1,
  decision: "approved" | "rejected" = "approved",
): Promise<{ attempt: Prompt3DConceptAttempt; approval: ReturnType<typeof createConceptApproval> | undefined; inspection: Prompt3DConceptInspectionRecord }> {
  await mkdir(directory, { recursive: true });
  const conceptImagePath = join(directory, "concept.png");
  const conceptBytes = Buffer.concat([PNG, Buffer.from(jobId, "utf8")]);
  await writeFile(conceptImagePath, conceptBytes);
  const reportPath = join(directory, "concept-review.json");
  const reportEvidence = await writeJsonEvidence(reportPath, {
    version: 1,
    method: "border-connected-white",
    technicalStatus: "pass",
    semanticResemblanceChecked: false,
    visualReviewRequired: true,
  });
  const binding = createConceptBinding(jobId, attemptNumber, spec, sha256Bytes(conceptBytes));
  const canonical = JSON.parse(binding.specCanonical) as { promptPlan: Prompt3DConceptAttempt["promptPlan"] };
  const attempt: Prompt3DConceptAttempt = {
    attemptNumber,
    binding,
    conceptImagePath,
    promptPlan: canonical.promptPlan,
    technicalReview: {
      status: "pass",
      method: "border-connected-white",
      message: "Technical framing passed; explicit semantic review remains required.",
      reportPath,
      reportSha256: reportEvidence.sha256,
      presentationContractSha256: digest(canonical.promptPlan.presentationContract),
      reportVersion: 1,
      semanticResemblanceChecked: false,
      visualReviewRequired: true,
      checkedAt: NOW,
    },
    createdAt: NOW,
  };
  const inspectionEvidence = createConceptInspectionEvidence(spec, attempt, decision, {
    identityAndRequiredParts: decision === "approved" ? "pass" : "fail",
    subjectPresentation: "pass",
    framingBackgroundAndSupport: "pass",
  }, {
    ...(decision === "rejected" ? { classification: "semantic-anatomy-parts" as const, note: "The retained concept omits a required silhouette feature." } : {}),
    inspectionId: jobId,
    inspectedAt: NOW,
  });
  const inspection: Prompt3DConceptInspectionRecord = {
    evidence: inspectionEvidence,
    path: join(directory, "concept-inspection.json"),
    sha256: digest(inspectionEvidence),
  };
  const approval = decision === "approved" ? createConceptApproval(binding, NOW, inspection.sha256) : undefined;
  await writeJsonEvidence(join(directory, "concept-attempt.json"), attempt);
  await writeJsonEvidence(inspection.path, inspection.evidence);
  if (approval) await writeJsonEvidence(join(directory, "concept-approval.json"), approval);
  await writeJsonEvidence(join(directory, "asset-spec.json"), {
    ...spec,
    conceptAttempt: attempt,
    conceptInspection: inspection,
    ...(approval ? { conceptApproval: approval } : {}),
  });
  return { attempt, approval, inspection };
}

async function writeTechnicallyRejectedConceptEvidence(
  directory: string,
  jobId: string,
  attemptNumber: number,
  spec: AssetSpecV1,
): Promise<Prompt3DConceptAttempt> {
  await mkdir(directory, { recursive: true });
  const conceptImagePath = join(directory, "concept.png");
  const conceptBytes = Buffer.concat([PNG, Buffer.from(jobId, "utf8")]);
  await writeFile(conceptImagePath, conceptBytes);
  const reportPath = join(directory, "concept-review.json");
  const reportEvidence = await writeJsonEvidence(reportPath, {
    version: 1,
    method: "border-connected-white",
    technicalStatus: "needs-regeneration",
    semanticResemblanceChecked: false,
    visualReviewRequired: true,
    failureCode: "edge-clearance",
  });
  const binding = createConceptBinding(jobId, attemptNumber, spec, sha256Bytes(conceptBytes));
  const canonical = JSON.parse(binding.specCanonical) as { promptPlan: Prompt3DConceptAttempt["promptPlan"] };
  const attempt: Prompt3DConceptAttempt = {
    attemptNumber,
    binding,
    conceptImagePath,
    promptPlan: canonical.promptPlan,
    technicalReview: {
      status: "needs-regeneration",
      method: "border-connected-white",
      message: "Technical edge clearance failed; geometry was not loaded.",
      reportPath,
      reportSha256: reportEvidence.sha256,
      presentationContractSha256: digest(canonical.promptPlan.presentationContract),
      reportVersion: 1,
      semanticResemblanceChecked: false,
      visualReviewRequired: true,
      failureCode: "edge-clearance",
      checkedAt: NOW,
    },
    createdAt: NOW,
  };
  await writeJsonEvidence(join(directory, "concept-attempt.json"), attempt);
  await writeJsonEvidence(join(directory, "asset-spec.json"), { ...spec, conceptAttempt: attempt });
  return attempt;
}

function approvedConceptDecision(attempt: Prompt3DConceptAttempt, inspection: Prompt3DConceptInspectionRecord): Prompt3DConceptDecision {
  return {
    kind: "approved",
    source: "explicit-user-action",
    at: NOW,
    jobId: attempt.binding.jobId,
    attemptId: attempt.binding.attemptId,
    inspectionSha256: inspection.sha256,
    inspectionPath: inspection.path,
  };
}

function rejectedConceptDecision(attempt: Prompt3DConceptAttempt, inspection: Prompt3DConceptInspectionRecord): Prompt3DConceptDecision {
  return {
    kind: "rejected",
    source: "explicit-user-action",
    at: NOW,
    jobId: attempt.binding.jobId,
    attemptId: attempt.binding.attemptId,
    inspectionSha256: inspection.sha256,
    inspectionPath: inspection.path,
    rejectionClassification: inspection.evidence.rejection!.classification,
  };
}

function conceptSuccessorDecision(
  kind: "edited" | "regenerated",
  current: Prompt3DConceptAttempt,
  inspection: Prompt3DConceptInspectionRecord,
  next: Prompt3DConceptAttempt,
): Prompt3DConceptDecision {
  return {
    kind,
    source: "explicit-user-action",
    at: NOW,
    jobId: current.binding.jobId,
    attemptId: current.binding.attemptId,
    nextJobId: next.binding.jobId,
    inspectionSha256: inspection.sha256,
    inspectionPath: inspection.path,
    nextPrompt: next.binding.prompt,
    nextPromptSha256: sha256Hex(next.binding.prompt),
    nextPromptPlanSha256: digest(next.promptPlan),
    nextPresentationContractSha256: digest(next.promptPlan.presentationContract),
    nextSeed: next.binding.seed,
    nextSpecFingerprint: next.binding.specFingerprint,
  };
}

function technicalConceptSuccessorDecision(
  current: Prompt3DConceptAttempt,
  next: Prompt3DConceptAttempt,
): Prompt3DConceptDecision {
  return {
    kind: "regenerated",
    source: "explicit-user-action",
    at: NOW,
    jobId: current.binding.jobId,
    attemptId: current.binding.attemptId,
    nextJobId: next.binding.jobId,
    inspectionSha256: current.technicalReview.reportSha256,
    inspectionPath: current.technicalReview.reportPath,
    nextPrompt: next.binding.prompt,
    nextPromptSha256: sha256Hex(next.binding.prompt),
    nextPromptPlanSha256: digest(next.promptPlan),
    nextPresentationContractSha256: digest(next.promptPlan.presentationContract),
    nextSeed: next.binding.seed,
    nextSpecFingerprint: next.binding.specFingerprint,
  };
}

async function writeApproval(
  path: string,
  binding: Omit<Prompt3DVisualApproval, "approvalId" | "bindingSha256" | "approvedAt" | "source" | "inspection">,
) {
  const output = await inspectWorkflowGlb(binding.assetPath);
  let progress = createPrompt3DVisualInspection(
    binding.assetPath,
    binding.assetSha256,
    binding.stage,
    binding.stage === "animation" ? output.animations : [],
    NOW,
  );
  for (const preset of ["front", "right", "back", "left"] as const) progress = recordPrompt3DViewpoint(progress, preset, NOW);
  progress = setPrompt3DInspectionAttestation(progress, "geometryIdentityAndCompleteness", true, NOW);
  if (binding.stage === "texture") progress = setPrompt3DInspectionAttestation(progress, "materialCoverageAndAppearance", true, NOW);
  if (binding.stage === "animation") {
    progress = setPrompt3DInspectionAttestation(progress, "animationMotionMatchesPrompt", true, NOW);
    for (const clip of progress.clips) {
      while (!progress.clips[clip.index].completedAt) progress = recordPrompt3DClipPlayback(progress, clip.index, 0.25, NOW);
    }
  }
  const approval = createPrompt3DVisualApproval({ ...binding, inspection: finalizePrompt3DVisualInspection(progress, NOW) }, NOW);
  const evidence = await writeJsonEvidence(path, approval);
  return { approval, ...evidence };
}

function reseal(lineage: Prompt3DWorkflowLineage): Prompt3DWorkflowLineage {
  const clone = JSON.parse(JSON.stringify(lineage)) as Prompt3DWorkflowLineage;
  const { chainSha256: _chainSha256, ...unsealed } = clone;
  return sealPrompt3DWorkflowLineage(unsealed);
}

async function main() {
  const finishRejection = createPrompt3DFinishVisualRejection({
    version: 1,
    stage: "animation",
    assetId: ASSET_ID,
    jobId: ANIMATION_JOB_ID,
    assetPath: "E:\\Prompt3D\\animation.glb",
    assetSha256: "1".repeat(64),
    geometryHash: "2".repeat(64),
    promptSha256: "3".repeat(64),
    specFingerprint: "4".repeat(64),
    animationFingerprint: "5".repeat(64),
    animationPlanSha256: "6".repeat(64),
    classification: "motion-mismatch",
    note: "The visible gait does not match the requested motion.",
  }, NOW);
  assertFinishVisualRejectionMatches(finishRejection, { jobId: ANIMATION_JOB_ID, stage: "animation" });
  assert.throws(() => assertFinishVisualRejectionMatches({ ...finishRejection, note: "changed" }), /binding hash/i, "rejection evidence must be hash-bound to the exact decision");
  assert.equal(PROMPT3D_MIN_WORKFLOW_TEXTURE_REVISIONS, 1, "a manually approved texture may continue to animation without forcing an unwanted repaint");
  assert.equal(PROMPT3D_MIN_WORKFLOW_ANIMATION_REVISIONS, 1, "a manually approved first animation must be saveable while optional refinement remains available");
  const root = await mkdtemp(join(tmpdir(), "grudge-workflow-test-"));
  try {
    const baseDirectory = join(root, "jobs", BASE_JOB_ID, "variant-1");
    const baseSource = join(baseDirectory, "asset.glb");
    const firstRefinementConceptDirectory = join(root, "jobs", FIRST_REFINEMENT_CONCEPT_JOB_ID, "variant-1");
    const secondRefinementConceptDirectory = join(root, "jobs", SECOND_REFINEMENT_CONCEPT_JOB_ID, "variant-1");
    const rootDirectory = join(root, "jobs", ROOT_JOB_ID, "variant-1");
    const source = join(rootDirectory, "asset.glb");
    const earlierRejectedDirectory = join(root, "jobs", EARLIER_REJECTED_GEOMETRY_JOB_ID, "variant-1");
    const earlierRejectedSource = join(earlierRejectedDirectory, "asset.glb");
    const rejectedDirectory = join(root, "jobs", REJECTED_GEOMETRY_JOB_ID, "variant-1");
    const rejectedSource = join(rejectedDirectory, "asset.glb");
    const derived = join(root, "derived.glb");
    const changed = join(root, "changed.glb");
    const translated = join(root, "translated.glb");
    const reparented = join(root, "reparented.glb");
    await fixture(baseSource);
    await fixture(source, { changed: true });
    await fixture(earlierRejectedSource, { changed: true, reparented: true });
    await fixture(rejectedSource, { translated: true });
    await fixture(derived, { derived: true, changed: true });
    await fixture(changed);
    await fixture(translated, { translated: true });
    await fixture(reparented, { reparented: true });

    const baseInfo = await inspectWorkflowGlb(baseSource);
    const sourceInfo = await inspectWorkflowGlb(source);
    const earlierRejectedInfo = await inspectWorkflowGlb(earlierRejectedSource);
    const rejectedInfo = await inspectWorkflowGlb(rejectedSource);
    const earlierRejectedAttemptMarker = join(earlierRejectedDirectory, "attempt-tree", "retained-attempt.json");
    const rejectedAttemptMarker = join(rejectedDirectory, "attempt-tree", "retained-attempt.json");
    await writeJsonEvidence(earlierRejectedAttemptMarker, { jobId: EARLIER_REJECTED_GEOMETRY_JOB_ID, retained: true });
    await writeJsonEvidence(rejectedAttemptMarker, { jobId: REJECTED_GEOMETRY_JOB_ID, retained: true });
    await writeJsonEvidence(join(earlierRejectedDirectory, "asset-spec.json"), rootSpec);
    await writeJsonEvidence(join(earlierRejectedDirectory, "visual-rejection.json"), {
      version: 1,
      source: "explicit-user-action",
      replacementKind: "approved-ancestor-refinement",
      rejectedAt: NOW,
      jobId: EARLIER_REJECTED_GEOMETRY_JOB_ID,
      assetId: ASSET_ID,
      variantIndex: 0,
      assetPath: earlierRejectedSource,
      assetSha256: earlierRejectedInfo.sha256,
      geometryHash: earlierRejectedInfo.geometryHash,
      approvedAncestorJobId: BASE_JOB_ID,
      successorJobId: REJECTED_GEOMETRY_JOB_ID,
      correctivePrompt: "make the corrected silhouette broader without losing the required parts",
      correctivePromptSha256: workflowPromptSha256("make the corrected silhouette broader without losing the required parts"),
      successorSpecFingerprint: workflowSpecFingerprint(rootSpec),
      retainedAncestry: [{ jobId: EARLIER_REJECTED_GEOMETRY_JOB_ID }, { jobId: BASE_JOB_ID }],
    });
    await writeJsonEvidence(join(rejectedDirectory, "asset-spec.json"), rootSpec);
    await writeJsonEvidence(join(rejectedDirectory, "visual-rejection.json"), {
      version: 1,
      source: "explicit-user-action",
      replacementKind: "approved-ancestor-refinement",
      rejectedAt: NOW,
      jobId: REJECTED_GEOMETRY_JOB_ID,
      assetId: ASSET_ID,
      variantIndex: 0,
      assetPath: rejectedSource,
      assetSha256: rejectedInfo.sha256,
      geometryHash: rejectedInfo.geometryHash,
      approvedAncestorJobId: BASE_JOB_ID,
      successorJobId: ROOT_JOB_ID,
      correctivePrompt: "make the silhouette taller and more asymmetric",
      correctivePromptSha256: digest("make the silhouette taller and more asymmetric"),
      successorSpecFingerprint: workflowSpecFingerprint(rootSpec),
      retainedAncestry: [{ jobId: REJECTED_GEOMETRY_JOB_ID }, { jobId: BASE_JOB_ID }],
    });
    assert.notEqual(baseInfo.geometryHash, sourceInfo.geometryHash, "prompted refinement must retain fresh Hunyuan geometry");
    assert.equal(sourceInfo.selfContained, true);
    assert.equal(sourceInfo.textures, 0);
    assert.equal(sourceInfo.byteSize, (await readFile(source)).byteLength);
    assert.equal((await inspectWorkflowGlb(derived)).geometryHash, sourceInfo.geometryHash, "derived LOD and trail must not alter base identity");
    assert.notEqual((await inspectWorkflowGlb(changed)).geometryHash, sourceInfo.geometryHash, "base topology changes must alter identity");
    assert.notEqual((await inspectWorkflowGlb(translated)).geometryHash, sourceInfo.geometryHash, "base world-transform changes must alter identity");
    assert.notEqual((await inspectWorkflowGlb(reparented)).geometryHash, sourceInfo.geometryHash, "base hierarchy changes must alter identity");

    const texturePrompt = compileTextureReferencePrompt(textureSpec, "weathered blue ceramic with fine gold cracks");
    assert.match(texturePrompt, /weathered blue ceramic/i);
    assert.match(texturePrompt, /one complete isolated subject/i);
    assert.doesNotMatch(texturePrompt, /\b(?:no|not|without)\b/i, "texture reference positive conditioning must remain affirmative");
    assert.ok(estimateHunyuanClipTokens(texturePrompt) <= PROMPT3D_CLIP_SAFE_TOKEN_BUDGET, "texture reference prompt must fit the HunyuanDiT token budget");
    const longTexturePrompt = compileTextureReferencePrompt(textureSpec, "Dark charcoal meteorite stone with ash-gray crater rims, subtle iron flecks, rough porous matte surface, high-contrast spike tips, seamless coverage across every recessed and protruding surface of the entire asteroid");
    assert.match(longTexturePrompt, /dark charcoal meteorite/i);
    assert.ok(estimateHunyuanClipTokens(longTexturePrompt) <= PROMPT3D_CLIP_SAFE_TOKEN_BUDGET, "long texture refinements must be trimmed before provider dispatch");
    assert.equal(
      normalizeTextureInstruction("  intentionally poor / unsupported-looking result ???  "),
      "intentionally poor / unsupported-looking result ???",
      "texture admission must normalize arbitrary user content without semantic or quality refusal",
    );
    assert.throws(() => compileTextureReferencePrompt(textureSpec, " "), /1–2,000/);
    assert.throws(() => containedWorkflowPath(root, join(root, "..", "escape.glb")), /escapes/i);

    const { attempt: baseConceptAttempt, approval: baseConceptApproval, inspection: baseConceptInspection } = await writeConceptEvidence(
      baseDirectory, BASE_JOB_ID, 1, baseSpec,
    );
    if (!baseConceptApproval) throw new Error("Base concept fixture approval is missing.");
    const baseApproval = await writeApproval(join(baseDirectory, "visual-approval.json"), {
      version: 1,
      stage: "geometry",
      assetId: ASSET_ID,
      jobId: BASE_JOB_ID,
      assetPath: baseSource,
      assetSha256: baseInfo.sha256,
      geometryHash: baseInfo.geometryHash,
      promptSha256: workflowPromptSha256(baseSpec.prompt),
      specFingerprint: workflowSpecFingerprint(baseSpec),
    });
    const tamperedInspectionApproval = JSON.parse(JSON.stringify(baseApproval.approval)) as Prompt3DVisualApproval;
    tamperedInspectionApproval.inspection.viewpoints[0].inspectedAt = "2026-09-03T00:00:00.000Z";
    assert.throws(
      () => assertVisualApprovalMatches(tamperedInspectionApproval),
      /binding hash/i,
      "changing retained inspection evidence must invalidate the approval binding hash",
    );
    const baseProvenance = await writeJsonEvidence(join(baseDirectory, "provenance.json"), {
      version: 1,
      assetId: ASSET_ID,
      method: "hunyuan3d-neural-generation",
      provider: { id: "hunyuan3d-2", sourceRevision: generationProviderVerification.sourceRevision },
      providerVerification: generationProviderVerification,
      prompt: baseSpec.prompt,
      seed: baseSpec.seed,
      specFingerprint: workflowSpecFingerprint(baseSpec),
      approvedConcept: true,
      conceptApproval: baseConceptApproval,
      conceptAttempt: baseConceptAttempt,
      conceptInspection: baseConceptInspection,
      conceptInspections: [baseConceptInspection],
      conceptAttempts: [baseConceptAttempt],
      conceptDecisions: [approvedConceptDecision(baseConceptAttempt, baseConceptInspection)],
      shapeRefinement: false,
      output: { path: baseSource, sha256: baseInfo.sha256, geometryHash: baseInfo.geometryHash, byteSize: baseInfo.byteSize },
      sourceAssets: [],
    });
    const baseLineage: Prompt3DWorkflowLineage["root"] = {
      version: 1,
      kind: "generation",
      assetId: ASSET_ID,
      jobId: BASE_JOB_ID,
      variantIndex: 0,
      method: "hunyuan3d-neural-generation",
      provider: "hunyuan3d-2",
      providerSourceRevision: generationProviderVerification.sourceRevision,
      providerVerification: generationProviderVerification,
      specFingerprint: workflowSpecFingerprint(baseSpec),
      promptSha256: workflowPromptSha256(baseSpec.prompt),
      conceptSha256: baseConceptApproval.conceptSha256,
      conceptApprovalSha256: stableWorkflowSha256(baseConceptApproval),
      conceptInspectionSha256: baseConceptInspection.sha256,
      outputPath: baseSource,
      outputSha256: baseInfo.sha256,
      geometryHash: baseInfo.geometryHash,
      byteSize: baseInfo.byteSize,
      provenancePath: baseProvenance.path,
      provenanceSha256: baseProvenance.sha256,
      visualApproval: baseApproval.approval,
      visualApprovalPath: baseApproval.path,
      visualApprovalSha256: baseApproval.sha256,
      shapeRefinement: false,
    };
    const existingGeometryDecision = createPrompt3DExistingGeometryDecision({
      version: 1,
      mode: "use-existing-generated-model",
      assetId: ASSET_ID,
      generationJobId: BASE_JOB_ID,
      variantIndex: 0,
      assetSha256: baseLineage.outputSha256,
      geometryHash: baseLineage.geometryHash,
      visualApprovalSha256: baseLineage.visualApprovalSha256,
    }, NOW);
    const baseOnlyAwaitingFinish = sealPrompt3DWorkflowLineage({
      version: 1,
      assetId: ASSET_ID,
      generationChain: [baseLineage],
      existingGeometryDecision,
      root: baseLineage,
      revisions: [],
      finalJobId: BASE_JOB_ID,
      finalSha256: baseLineage.outputSha256,
      finalGeometryHash: baseLineage.geometryHash,
    });
    assert.equal(prompt3DWorkflowUsesExistingGeneratedModel(baseOnlyAwaitingFinish), true);
    await assert.rejects(
      validatePrompt3DWorkflowLineage(root, baseOnlyAwaitingFinish),
      /finishing revisions/i,
      "an explicitly accepted base geometry must pass generation-lineage admission and proceed to finishing",
    );
    const forgedExistingDecision = JSON.parse(JSON.stringify(baseOnlyAwaitingFinish)) as Prompt3DWorkflowLineage;
    forgedExistingDecision.existingGeometryDecision!.assetSha256 = digest("forged existing geometry");
    assert.throws(
      () => prompt3DWorkflowUsesExistingGeneratedModel(reseal(forgedExistingDecision)),
      /binding hash/i,
      "the base-model continuation must remain bound to the exact approved Hunyuan output",
    );

    await mkdir(firstRefinementConceptDirectory, { recursive: true });
    await mkdir(secondRefinementConceptDirectory, { recursive: true });
    const { attempt: firstRefinementConcept, inspection: firstRefinementInspection } = await writeConceptEvidence(
      firstRefinementConceptDirectory, FIRST_REFINEMENT_CONCEPT_JOB_ID, 2, firstRefinementSpec, "rejected",
    );
    const secondRefinementConcept = await writeTechnicallyRejectedConceptEvidence(
      secondRefinementConceptDirectory, SECOND_REFINEMENT_CONCEPT_JOB_ID, 3, secondRefinementSpec,
    );
    const { attempt: refinedConceptAttempt, approval: conceptApproval, inspection: refinedConceptInspection } = await writeConceptEvidence(
      rootDirectory, ROOT_JOB_ID, 4, rootSpec,
    );
    if (!conceptApproval) throw new Error("Refined concept fixture approval is missing.");
    const rootApproval = await writeApproval(join(rootDirectory, "visual-approval.json"), {
      version: 1,
      stage: "geometry",
      assetId: ASSET_ID,
      jobId: ROOT_JOB_ID,
      assetPath: source,
      assetSha256: sourceInfo.sha256,
      geometryHash: sourceInfo.geometryHash,
      promptSha256: workflowPromptSha256(rootSpec.prompt),
      specFingerprint: workflowSpecFingerprint(rootSpec),
    });
    const rootProvenance = await writeJsonEvidence(join(rootDirectory, "provenance.json"), {
      version: 1,
      assetId: ASSET_ID,
      method: "hunyuan3d-neural-generation",
      provider: { id: "hunyuan3d-2", sourceRevision: generationProviderVerification.sourceRevision },
      providerVerification: generationProviderVerification,
      prompt: rootSpec.prompt,
      seed: rootSpec.seed,
      specFingerprint: workflowSpecFingerprint(rootSpec),
      approvedConcept: true,
      conceptApproval,
      conceptAttempt: refinedConceptAttempt,
      conceptInspection: refinedConceptInspection,
      conceptInspections: [baseConceptInspection, firstRefinementInspection, refinedConceptInspection],
      parentJobId: BASE_JOB_ID,
      conceptParentJobId: SECOND_REFINEMENT_CONCEPT_JOB_ID,
      shapeRefinement: true,
      parentGeneration: {
        jobId: BASE_JOB_ID,
        promptSha256: baseLineage.promptSha256,
        outputSha256: baseLineage.outputSha256,
        geometryHash: baseLineage.geometryHash,
        provenanceSha256: baseLineage.provenanceSha256,
        visualApprovalSha256: baseLineage.visualApprovalSha256,
      },
      conceptAttempts: [baseConceptAttempt, firstRefinementConcept, secondRefinementConcept, refinedConceptAttempt],
      conceptDecisions: [
        conceptSuccessorDecision("edited", baseConceptAttempt, baseConceptInspection, firstRefinementConcept),
        rejectedConceptDecision(firstRefinementConcept, firstRefinementInspection),
        conceptSuccessorDecision("regenerated", firstRefinementConcept, firstRefinementInspection, secondRefinementConcept),
        technicalConceptSuccessorDecision(secondRefinementConcept, refinedConceptAttempt),
        approvedConceptDecision(refinedConceptAttempt, refinedConceptInspection),
      ],
      output: { path: source, sha256: sourceInfo.sha256, geometryHash: sourceInfo.geometryHash, byteSize: sourceInfo.byteSize },
      sourceAssets: [],
    });
    const rootLineage: Prompt3DWorkflowLineage["root"] = {
      version: 1,
      kind: "generation",
      assetId: ASSET_ID,
      jobId: ROOT_JOB_ID,
      variantIndex: 0,
      method: "hunyuan3d-neural-generation",
      provider: "hunyuan3d-2",
      providerSourceRevision: generationProviderVerification.sourceRevision,
      providerVerification: generationProviderVerification,
      specFingerprint: workflowSpecFingerprint(rootSpec),
      promptSha256: workflowPromptSha256(rootSpec.prompt),
      conceptSha256: conceptApproval.conceptSha256,
      conceptApprovalSha256: stableWorkflowSha256(conceptApproval),
      conceptInspectionSha256: refinedConceptInspection.sha256,
      outputPath: source,
      outputSha256: sourceInfo.sha256,
      geometryHash: sourceInfo.geometryHash,
      byteSize: sourceInfo.byteSize,
      provenancePath: rootProvenance.path,
      provenanceSha256: rootProvenance.sha256,
      visualApproval: rootApproval.approval,
      visualApprovalPath: rootApproval.path,
      visualApprovalSha256: rootApproval.sha256,
      shapeRefinement: true,
      parentJobId: BASE_JOB_ID,
      parentPromptSha256: baseLineage.promptSha256,
      parentOutputSha256: baseLineage.outputSha256,
      parentGeometryHash: baseLineage.geometryHash,
      parentProvenanceSha256: baseLineage.provenanceSha256,
      parentVisualApprovalSha256: baseLineage.visualApprovalSha256,
    };

    const textureDirectory = join(root, "workflow-history", TEXTURE_JOB_ID);
    const textured = join(textureDirectory, "asset.glb");
    await fixture(textured, { texture: true, changed: true });
    const textureInfo = await inspectWorkflowGlb(textured);
    const textureValidation = await validateFinishedAsset(source, textured, "texture");
    assert.equal(textureValidation.sourceGeometryPreserved, true);
    assert.equal(textureValidation.embeddedTextures, 1);
    assert.equal(textureValidation.textureChanged, true);
    const textureReferencePath = join(textureDirectory, "texture-reference.png");
    await writeFile(textureReferencePath, PNG);
    const textureReferenceSha256 = sha256Bytes(PNG);
    const texturePromptInstruction = "weathered blue ceramic with fine gold cracks";
    const textureProvenance = await writeJsonEvidence(join(textureDirectory, "provenance.json"), {
      version: 1,
      assetId: ASSET_ID,
      revisionJobId: TEXTURE_JOB_ID,
      operation: "texture",
      method: "hunyuan-dit-reference-plus-official-hunyuan3d-paint",
      provider: { id: "hunyuan3d-2", sourceRevision: providerVerification.sourceRevision, paint: "hunyuan3d-paintpbr-v2-1" },
      providerVerification,
      prompt: texturePromptInstruction,
      specFingerprint: workflowSpecFingerprint(textureSpec),
      parentProvenanceSha256: rootProvenance.sha256,
      source: { jobId: ROOT_JOB_ID, sha256: sourceInfo.sha256, geometryHash: sourceInfo.geometryHash, textureFingerprint: sourceInfo.textureFingerprint },
      textureReference: { path: textureReferencePath, sha256: textureReferenceSha256 },
      output: { path: textured, sha256: textureInfo.sha256, geometryHash: textureInfo.geometryHash, byteSize: textureInfo.byteSize, textureFingerprint: textureInfo.textureFingerprint },
    });
    const textureApproval = await writeApproval(join(textureDirectory, "visual-approval.json"), {
      version: 1,
      stage: "texture",
      assetId: ASSET_ID,
      jobId: TEXTURE_JOB_ID,
      assetPath: textured,
      assetSha256: textureInfo.sha256,
      geometryHash: textureInfo.geometryHash,
      promptSha256: workflowPromptSha256(texturePromptInstruction),
      specFingerprint: workflowSpecFingerprint(textureSpec),
      textureFingerprint: textureInfo.textureFingerprint,
    });
    const textureRevision: Prompt3DWorkflowRevisionLineage = {
      version: 1,
      assetId: ASSET_ID,
      jobId: TEXTURE_JOB_ID,
      operation: "texture",
      provider: "hunyuan3d-paint-2.1",
      providerVerification,
      sourceJobId: ROOT_JOB_ID,
      sourceSha256: sourceInfo.sha256,
      sourceGeometryHash: sourceInfo.geometryHash,
      outputPath: textured,
      outputSha256: textureInfo.sha256,
      geometryHash: textureInfo.geometryHash,
      byteSize: textureInfo.byteSize,
      specFingerprint: workflowSpecFingerprint(textureSpec),
      promptSha256: workflowPromptSha256(texturePromptInstruction),
      provenancePath: textureProvenance.path,
      provenanceSha256: textureProvenance.sha256,
      parentProvenanceSha256: rootProvenance.sha256,
      visualApproval: textureApproval.approval,
      visualApprovalPath: textureApproval.path,
      visualApprovalSha256: textureApproval.sha256,
      sourceTextureFingerprint: sourceInfo.textureFingerprint,
      outputTextureFingerprint: textureInfo.textureFingerprint,
      textureReferenceSha256,
    };

    const textureRefinementDirectory = join(root, "workflow-history", TEXTURE_REFINEMENT_JOB_ID);
    const refinedTextured = join(textureRefinementDirectory, "asset.glb");
    await fixture(refinedTextured, { texture: true, textureVariant: 2, changed: true });
    const refinedTextureInfo = await inspectWorkflowGlb(refinedTextured);
    const refinedTextureValidation = await validateFinishedAsset(textured, refinedTextured, "texture");
    assert.equal(refinedTextureValidation.sourceGeometryPreserved, true);
    assert.equal(refinedTextureValidation.embeddedTextures, 1);
    assert.equal(refinedTextureValidation.textureChanged, true);
    const textureRefinementReferencePath = join(textureRefinementDirectory, "texture-reference.png");
    await writeFile(textureRefinementReferencePath, PNG);
    const textureRefinementReferenceSha256 = sha256Bytes(PNG);
    const textureRefinementInstruction = "refine the ceramic into deeper blue with narrower gold cracks and uniform coverage";
    const textureRefinementProvenance = await writeJsonEvidence(join(textureRefinementDirectory, "provenance.json"), {
      version: 1,
      assetId: ASSET_ID,
      revisionJobId: TEXTURE_REFINEMENT_JOB_ID,
      operation: "texture",
      method: "hunyuan-dit-reference-plus-official-hunyuan3d-paint",
      provider: { id: "hunyuan3d-2", sourceRevision: providerVerification.sourceRevision, paint: "hunyuan3d-paintpbr-v2-1" },
      providerVerification,
      prompt: textureRefinementInstruction,
      specFingerprint: workflowSpecFingerprint(textureRefinementSpec),
      parentProvenanceSha256: textureProvenance.sha256,
      source: { jobId: TEXTURE_JOB_ID, sha256: textureInfo.sha256, geometryHash: textureInfo.geometryHash, textureFingerprint: textureInfo.textureFingerprint },
      textureReference: { path: textureRefinementReferencePath, sha256: textureRefinementReferenceSha256 },
      output: { path: refinedTextured, sha256: refinedTextureInfo.sha256, geometryHash: refinedTextureInfo.geometryHash, byteSize: refinedTextureInfo.byteSize, textureFingerprint: refinedTextureInfo.textureFingerprint },
    });
    const textureRefinementApproval = await writeApproval(join(textureRefinementDirectory, "visual-approval.json"), {
      version: 1,
      stage: "texture",
      assetId: ASSET_ID,
      jobId: TEXTURE_REFINEMENT_JOB_ID,
      assetPath: refinedTextured,
      assetSha256: refinedTextureInfo.sha256,
      geometryHash: refinedTextureInfo.geometryHash,
      promptSha256: workflowPromptSha256(textureRefinementInstruction),
      specFingerprint: workflowSpecFingerprint(textureRefinementSpec),
      textureFingerprint: refinedTextureInfo.textureFingerprint,
    });
    const textureRefinementRevision: Prompt3DWorkflowRevisionLineage = {
      version: 1,
      assetId: ASSET_ID,
      jobId: TEXTURE_REFINEMENT_JOB_ID,
      operation: "texture",
      provider: "hunyuan3d-paint-2.1",
      providerVerification,
      sourceJobId: TEXTURE_JOB_ID,
      sourceSha256: textureInfo.sha256,
      sourceGeometryHash: textureInfo.geometryHash,
      outputPath: refinedTextured,
      outputSha256: refinedTextureInfo.sha256,
      geometryHash: refinedTextureInfo.geometryHash,
      byteSize: refinedTextureInfo.byteSize,
      specFingerprint: workflowSpecFingerprint(textureRefinementSpec),
      promptSha256: workflowPromptSha256(textureRefinementInstruction),
      provenancePath: textureRefinementProvenance.path,
      provenanceSha256: textureRefinementProvenance.sha256,
      parentProvenanceSha256: textureProvenance.sha256,
      visualApproval: textureRefinementApproval.approval,
      visualApprovalPath: textureRefinementApproval.path,
      visualApprovalSha256: textureRefinementApproval.sha256,
      sourceTextureFingerprint: textureInfo.textureFingerprint,
      outputTextureFingerprint: refinedTextureInfo.textureFingerprint,
      textureReferenceSha256: textureRefinementReferenceSha256,
    };

    const animationDirectory = join(root, "workflow-history", ANIMATION_JOB_ID);
    const animated = join(animationDirectory, "asset.glb");
    const animationInstruction = "move in a figure eight, undulate several times, and leave an animated trail";
    const authored = await authorPromptedAnimation({ sourcePath: refinedTextured, outputPath: animated, instruction: animationInstruction, overrides: { durationSeconds: 2, cycles: 3, radiusMeters: 0.8 } });
    const animationInfo = await inspectWorkflowGlb(animated);
    const animationValidation = await validateFinishedAsset(refinedTextured, animated, "animation", { operators: authored.operators, pathDisplacementMeters: authored.pathDisplacementMeters });
    assert.equal(animationValidation.sourceGeometryPreserved, true);
    assert.equal(animationValidation.animations.length, 1);
    assert.equal(animationValidation.sourceTextureFingerprint, animationValidation.outputTextureFingerprint, "animation must preserve exact texture/material identity");
    assert.ok(animationValidation.motion?.morphTargets);
    assert.ok(animationValidation.motion?.operators.includes("deformation:axial-wave"));
    assert.ok(!animationValidation.motion?.operators.includes("deformation:trail-pulse"), "a visual trail must not implicitly deform the retained Hunyuan geometry");
    const animationProvenance = await writeJsonEvidence(join(animationDirectory, "provenance.json"), {
      version: 1,
      assetId: ASSET_ID,
      revisionJobId: ANIMATION_JOB_ID,
      operation: "animation",
      method: "generic-prompted-motion-graph",
      provider: "grudge-motion-graph-1",
      prompt: animationInstruction,
      specFingerprint: workflowSpecFingerprint(animationSpec),
      plan: authored.plan,
      parentProvenanceSha256: textureRefinementProvenance.sha256,
      source: { jobId: TEXTURE_REFINEMENT_JOB_ID, sha256: refinedTextureInfo.sha256, geometryHash: refinedTextureInfo.geometryHash, textureFingerprint: refinedTextureInfo.textureFingerprint },
      output: { path: animated, sha256: animationInfo.sha256, geometryHash: animationInfo.geometryHash, byteSize: animationInfo.byteSize, textureFingerprint: animationInfo.textureFingerprint, animationFingerprint: animationInfo.animationFingerprint, clipIds: animationInfo.clipIds },
    });
    const animationApproval = await writeApproval(join(animationDirectory, "visual-approval.json"), {
      version: 1,
      stage: "animation",
      assetId: ASSET_ID,
      jobId: ANIMATION_JOB_ID,
      assetPath: animated,
      assetSha256: animationInfo.sha256,
      geometryHash: animationInfo.geometryHash,
      promptSha256: workflowPromptSha256(animationInstruction),
      specFingerprint: workflowSpecFingerprint(animationSpec),
      animationFingerprint: animationInfo.animationFingerprint,
    });
    const animationRevision: Prompt3DWorkflowRevisionLineage = {
      version: 1,
      assetId: ASSET_ID,
      jobId: ANIMATION_JOB_ID,
      operation: "animation",
      provider: "grudge-motion-graph-1",
      sourceJobId: TEXTURE_REFINEMENT_JOB_ID,
      sourceSha256: refinedTextureInfo.sha256,
      sourceGeometryHash: refinedTextureInfo.geometryHash,
      outputPath: animated,
      outputSha256: animationInfo.sha256,
      geometryHash: animationInfo.geometryHash,
      byteSize: animationInfo.byteSize,
      specFingerprint: workflowSpecFingerprint(animationSpec),
      promptSha256: workflowPromptSha256(animationInstruction),
      provenancePath: animationProvenance.path,
      provenanceSha256: animationProvenance.sha256,
      parentProvenanceSha256: textureRefinementProvenance.sha256,
      visualApproval: animationApproval.approval,
      visualApprovalPath: animationApproval.path,
      visualApprovalSha256: animationApproval.sha256,
      sourceTextureFingerprint: refinedTextureInfo.textureFingerprint,
      outputTextureFingerprint: animationInfo.textureFingerprint,
      animationFingerprint: animationInfo.animationFingerprint,
      animationPlanSha256: stableWorkflowSha256(authored.plan),
      clipIds: animationInfo.clipIds,
    };

    const animationRefinementDirectory = join(root, "workflow-history", FINAL_JOB_ID);
    const refinedAnimated = join(animationRefinementDirectory, "asset.glb");
    const animationRefinementInstruction = "append a second tighter figure-eight swimming pass with quicker side-to-side undulation";
    const refinedAuthored = await authorPromptedAnimation({
      sourcePath: animated,
      outputPath: refinedAnimated,
      instruction: animationRefinementInstruction,
      overrides: { mode: "append", durationSeconds: 1.5, cycles: 4, radiusMeters: 0.55 },
    });
    const refinedAnimationInfo = await inspectWorkflowGlb(refinedAnimated);
    const refinedAnimationValidation = await validateFinishedAsset(animated, refinedAnimated, "animation", {
      operators: refinedAuthored.operators,
      pathDisplacementMeters: refinedAuthored.pathDisplacementMeters,
    });
    assert.equal(refinedAnimationValidation.sourceGeometryPreserved, true);
    assert.equal(refinedAnimationValidation.animations.length, 2, "append refinement must retain the initial prompted clip");
    assert.equal(refinedAnimationValidation.sourceTextureFingerprint, refinedAnimationValidation.outputTextureFingerprint, "animation refinement must preserve exact Hunyuan texture/material identity");
    const animationRefinementProvenance = await writeJsonEvidence(join(animationRefinementDirectory, "provenance.json"), {
      version: 1,
      assetId: ASSET_ID,
      revisionJobId: FINAL_JOB_ID,
      operation: "animation",
      method: "generic-prompted-motion-graph",
      provider: "grudge-motion-graph-1",
      prompt: animationRefinementInstruction,
      specFingerprint: workflowSpecFingerprint(animationRefinementSpec),
      plan: refinedAuthored.plan,
      parentProvenanceSha256: animationProvenance.sha256,
      source: { jobId: ANIMATION_JOB_ID, sha256: animationInfo.sha256, geometryHash: animationInfo.geometryHash, textureFingerprint: animationInfo.textureFingerprint },
      output: { path: refinedAnimated, sha256: refinedAnimationInfo.sha256, geometryHash: refinedAnimationInfo.geometryHash, byteSize: refinedAnimationInfo.byteSize, textureFingerprint: refinedAnimationInfo.textureFingerprint, animationFingerprint: refinedAnimationInfo.animationFingerprint, clipIds: refinedAnimationInfo.clipIds },
    });
    const animationRefinementApproval = await writeApproval(join(animationRefinementDirectory, "visual-approval.json"), {
      version: 1,
      stage: "animation",
      assetId: ASSET_ID,
      jobId: FINAL_JOB_ID,
      assetPath: refinedAnimated,
      assetSha256: refinedAnimationInfo.sha256,
      geometryHash: refinedAnimationInfo.geometryHash,
      promptSha256: workflowPromptSha256(animationRefinementInstruction),
      specFingerprint: workflowSpecFingerprint(animationRefinementSpec),
      animationFingerprint: refinedAnimationInfo.animationFingerprint,
    });
    const animationRefinementRevision: Prompt3DWorkflowRevisionLineage = {
      version: 1,
      assetId: ASSET_ID,
      jobId: FINAL_JOB_ID,
      operation: "animation",
      provider: "grudge-motion-graph-1",
      sourceJobId: ANIMATION_JOB_ID,
      sourceSha256: animationInfo.sha256,
      sourceGeometryHash: animationInfo.geometryHash,
      outputPath: refinedAnimated,
      outputSha256: refinedAnimationInfo.sha256,
      geometryHash: refinedAnimationInfo.geometryHash,
      byteSize: refinedAnimationInfo.byteSize,
      specFingerprint: workflowSpecFingerprint(animationRefinementSpec),
      promptSha256: workflowPromptSha256(animationRefinementInstruction),
      provenancePath: animationRefinementProvenance.path,
      provenanceSha256: animationRefinementProvenance.sha256,
      parentProvenanceSha256: animationProvenance.sha256,
      visualApproval: animationRefinementApproval.approval,
      visualApprovalPath: animationRefinementApproval.path,
      visualApprovalSha256: animationRefinementApproval.sha256,
      sourceTextureFingerprint: animationInfo.textureFingerprint,
      outputTextureFingerprint: refinedAnimationInfo.textureFingerprint,
      animationFingerprint: refinedAnimationInfo.animationFingerprint,
      animationPlanSha256: stableWorkflowSha256(refinedAuthored.plan),
      clipIds: refinedAnimationInfo.clipIds,
    };
    const lineage = sealPrompt3DWorkflowLineage({
      version: 1,
      assetId: ASSET_ID,
      generationChain: [baseLineage, rootLineage],
      root: rootLineage,
      revisions: [textureRevision, textureRefinementRevision, animationRevision, animationRefinementRevision],
      finalJobId: FINAL_JOB_ID,
      finalSha256: refinedAnimationInfo.sha256,
      finalGeometryHash: refinedAnimationInfo.geometryHash,
    });
    const lineageEvidence = await writeJsonEvidence(join(animationRefinementDirectory, "lineage.json"), lineage);

    const technicalValidation: Prompt3DValidationReport = {
      version: 1,
      deterministicId: digest("technical-validation"),
      assetPath: refinedAnimated,
      gameReady: true,
      triangleCount: 6,
      checks: [],
      createdAt: NOW,
    };
    const job: Prompt3DFinishJobStatus = {
      version: 1,
      id: FINAL_JOB_ID,
      assetId: ASSET_ID,
      source: { kind: "finish", jobId: ANIMATION_JOB_ID },
      sourceAssetPath: animated,
      sourceSha256: animationInfo.sha256,
      sourceGeometryHash: animationInfo.geometryHash,
      operation: "animation",
      instruction: animationRefinementInstruction,
      seed: animationRefinementSpec.seed,
      state: "complete",
      stage: "complete",
      progress: 100,
      message: "fixture complete",
      outputDirectory: animationRefinementDirectory,
      assetPath: refinedAnimated,
      sha256: refinedAnimationInfo.sha256,
      geometryHash: refinedAnimationInfo.geometryHash,
      provenancePath: animationRefinementProvenance.path,
      validation: refinedAnimationValidation,
      technicalValidation,
      animationPlan: refinedAuthored.plan,
      visualApproval: animationRefinementApproval.approval,
      visualApprovalPath: animationRefinementApproval.path,
      visualApprovalSha256: animationRefinementApproval.sha256,
      lineage,
      lineagePath: lineageEvidence.path,
      lineageSha256: lineageEvidence.sha256,
      provider: "grudge-motion-graph-1",
      baseSpec: animationRefinementSpec,
      createdAt: NOW,
      updatedAt: NOW,
    };

    const validated = await validatePrompt3DWorkflowLineage(root, lineage, job);
    assert.equal(validated.textureRevisions, 2);
    assert.equal(validated.animationRevisions, 2);
    assert.equal(validated.finalInspection.sha256, refinedAnimationInfo.sha256);

    const paintWithoutNativeInventory = JSON.parse(JSON.stringify(lineage)) as Prompt3DWorkflowLineage;
    delete (paintWithoutNativeInventory.revisions[0].providerVerification?.runtimeLocks as Partial<Prompt3DProviderVerification["runtimeLocks"]>).nativeArtifactsSha256;
    await assert.rejects(
      validatePrompt3DWorkflowLineage(root, reseal(paintWithoutNativeInventory)),
      /native runtime inventory hash/i,
      "Hunyuan Paint must retain its signed native-extension inventory even when older shape generations predate that Paint-only evidence",
    );

    const rejectedTechnicalReportPath = secondRefinementConcept.technicalReview.reportPath;
    const rejectedTechnicalReportBytes = await readFile(rejectedTechnicalReportPath);
    await writeFile(rejectedTechnicalReportPath, Buffer.concat([rejectedTechnicalReportBytes, Buffer.from("tamper")]));
    try {
      await assert.rejects(
        validatePrompt3DWorkflowLineage(root, lineage),
        /retained concept technical review.*hash/i,
        "final lineage must byte-verify every historical technically rejected concept report",
      );
    } finally {
      await writeFile(rejectedTechnicalReportPath, rejectedTechnicalReportBytes);
    }

    const retainedRootProvenance = JSON.parse(await readFile(rootProvenance.path, "utf8")) as {
      conceptAttempts: Prompt3DConceptAttempt[];
      conceptDecisions: Prompt3DConceptDecision[];
    };
    const indirectConceptChain = assertShapeRefinementConceptChain(
      retainedRootProvenance.conceptAttempts,
      retainedRootProvenance.conceptDecisions,
      baseConceptApproval,
      conceptApproval,
    );
    assert.equal(indirectConceptChain.firstRefinementJobId, FIRST_REFINEMENT_CONCEPT_JOB_ID);
    assert.equal(indirectConceptChain.immediateConceptParentJobId, SECOND_REFINEMENT_CONCEPT_JOB_ID);
    assert.equal(indirectConceptChain.regenerationCount, 2);

    const directConceptJobId = "45454545-6767-489a-8def-454545454545";
    const directConceptEvidence = await writeConceptEvidence(
      join(root, "jobs", directConceptJobId, "variant-1"), directConceptJobId, 2, firstRefinementSpec,
    );
    if (!directConceptEvidence.approval) throw new Error("Direct refinement concept fixture approval is missing.");
    const directConceptChain = assertShapeRefinementConceptChain(
      [baseConceptAttempt, directConceptEvidence.attempt],
      [conceptSuccessorDecision("edited", baseConceptAttempt, baseConceptInspection, directConceptEvidence.attempt)],
      baseConceptApproval,
      directConceptEvidence.approval,
    );
    assert.equal(directConceptChain.immediateConceptParentJobId, BASE_JOB_ID);
    assert.equal(directConceptChain.regenerationCount, 0);

    const legacyEditedConceptJobId = "56565656-7878-49ab-8def-565656565656";
    const legacyEditedSpec: AssetSpecV1 = {
      ...firstRefinementSpec,
      prompt: `${firstRefinementSpec.prompt}; keep all defining parts clearly separated`,
    };
    const legacyEditedConceptEvidence = await writeConceptEvidence(
      join(root, "jobs", legacyEditedConceptJobId, "variant-1"), legacyEditedConceptJobId, 3, legacyEditedSpec,
    );
    if (!legacyEditedConceptEvidence.approval) throw new Error("Legacy edited refinement concept fixture approval is missing.");
    const legacyEditedConceptChain = assertShapeRefinementConceptChain(
      [baseConceptAttempt, firstRefinementConcept, legacyEditedConceptEvidence.attempt],
      [
        conceptSuccessorDecision("edited", baseConceptAttempt, baseConceptInspection, firstRefinementConcept),
        rejectedConceptDecision(firstRefinementConcept, firstRefinementInspection),
        conceptSuccessorDecision("edited", firstRefinementConcept, firstRefinementInspection, legacyEditedConceptEvidence.attempt),
      ],
      baseConceptApproval,
      legacyEditedConceptEvidence.approval,
    );
    assert.equal(legacyEditedConceptChain.firstRefinementJobId, FIRST_REFINEMENT_CONCEPT_JOB_ID);
    assert.equal(legacyEditedConceptChain.immediateConceptParentJobId, FIRST_REFINEMENT_CONCEPT_JOB_ID);
    assert.equal(legacyEditedConceptChain.regenerationCount, 0, "retained same-seed prompt edits are edits, not regenerations");

    const freshEditedConceptJobId = "67676767-8989-4abc-8def-676767676767";
    const freshEditedSpec: AssetSpecV1 = { ...legacyEditedSpec, seed: firstRefinementSpec.seed + 1 };
    const freshEditedConceptEvidence = await writeConceptEvidence(
      join(root, "jobs", freshEditedConceptJobId, "variant-1"), freshEditedConceptJobId, 3, freshEditedSpec,
    );
    if (!freshEditedConceptEvidence.approval) throw new Error("Fresh-seed edited refinement concept fixture approval is missing.");
    const freshEditedDecision = conceptSuccessorDecision("edited", firstRefinementConcept, firstRefinementInspection, freshEditedConceptEvidence.attempt);
    assert.doesNotThrow(() => assertShapeRefinementConceptChain(
      [baseConceptAttempt, firstRefinementConcept, freshEditedConceptEvidence.attempt],
      [
        conceptSuccessorDecision("edited", baseConceptAttempt, baseConceptInspection, firstRefinementConcept),
        rejectedConceptDecision(firstRefinementConcept, firstRefinementInspection),
        freshEditedDecision,
      ],
      baseConceptApproval,
      freshEditedConceptEvidence.approval,
    ));
    assert.throws(
      () => assertShapeRefinementConceptChain(
        [baseConceptAttempt, firstRefinementConcept, freshEditedConceptEvidence.attempt],
        [
          conceptSuccessorDecision("edited", baseConceptAttempt, baseConceptInspection, firstRefinementConcept),
          rejectedConceptDecision(firstRefinementConcept, firstRefinementInspection),
          { ...freshEditedDecision, kind: "regenerated" },
        ],
        baseConceptApproval,
        freshEditedConceptEvidence.approval,
      ),
      /regeneration changed more than the retained seed/i,
      "a prompt change must never masquerade as seed-only regeneration",
    );

    const forgedTechnicalDecisionHistory = JSON.parse(JSON.stringify(retainedRootProvenance)) as typeof retainedRootProvenance;
    const forgedTechnicalDecision = forgedTechnicalDecisionHistory.conceptDecisions.find((decision) => decision.jobId === SECOND_REFINEMENT_CONCEPT_JOB_ID && decision.nextJobId === ROOT_JOB_ID);
    if (!forgedTechnicalDecision) throw new Error("Technical concept-successor fixture is missing.");
    forgedTechnicalDecision.inspectionSha256 = digest("forged technical report binding");
    assert.throws(
      () => assertShapeRefinementConceptChain(
        forgedTechnicalDecisionHistory.conceptAttempts,
        forgedTechnicalDecisionHistory.conceptDecisions,
        baseConceptApproval,
        conceptApproval,
      ),
      /technical-review report/i,
      "a technically rejected concept successor must bind the exact retained report rather than any well-formed hash",
    );

    const forgedInspectionProvenance = JSON.parse(await readFile(rootProvenance.path, "utf8"));
    forgedInspectionProvenance.conceptInspection.evidence.checks.identityAndRequiredParts = "fail";
    const forgedInspectionProvenanceEvidence = await writeJsonEvidence(
      join(root, "forged-concept-inspection-provenance.json"),
      forgedInspectionProvenance,
    );
    const forgedInspectionGeneration = {
      ...rootLineage,
      provenancePath: forgedInspectionProvenanceEvidence.path,
      provenanceSha256: forgedInspectionProvenanceEvidence.sha256,
    };
    await assert.rejects(
      validatePrompt3DWorkflowLineage(root, reseal({
        ...lineage,
        generationChain: [baseLineage, forgedInspectionGeneration],
        root: forgedInspectionGeneration,
      })),
      /concept inspection|all three/i,
      "workflow lineage must fail closed when an approved inspection no longer records three explicit passes",
    );

    const forgedConceptProvenance = JSON.parse(JSON.stringify(retainedRootProvenance)) as typeof retainedRootProvenance;
    const forgedRegeneration = forgedConceptProvenance.conceptDecisions.find((decision) => decision.jobId === FIRST_REFINEMENT_CONCEPT_JOB_ID && decision.nextJobId === SECOND_REFINEMENT_CONCEPT_JOB_ID);
    if (!forgedRegeneration) throw new Error("Regenerated concept-decision fixture is missing.");
    forgedRegeneration.kind = "edited";
    const forgedConceptProvenanceEvidence = await writeJsonEvidence(
      join(root, "forged-refinement-concept-provenance.json"),
      forgedConceptProvenance,
    );
    const forgedConceptGeneration = {
      ...rootLineage,
      provenancePath: forgedConceptProvenanceEvidence.path,
      provenanceSha256: forgedConceptProvenanceEvidence.sha256,
    };
    const forgedConceptLineage = reseal({
      ...lineage,
      generationChain: [baseLineage, forgedConceptGeneration],
      root: forgedConceptGeneration,
    });
    await assert.rejects(
      validatePrompt3DWorkflowLineage(root, forgedConceptLineage),
      /missing its explicit edited prompt/i,
      "an edited decision must bind a genuine prompt change",
    );

    await recordWorkflowJob(root, job);
    const portablePath = join(root, "portable", "finished-workflow.glb");
    await mkdir(dirname(portablePath), { recursive: true });
    await copyFile(refinedAnimated, portablePath);
    const portableReceipt = {
      destinationPath: portablePath,
      filename: "finished-workflow.glb",
      sha256: refinedAnimationInfo.sha256,
      byteSize: refinedAnimationInfo.byteSize,
    };
    const cyclicRejectionPath = join(rootDirectory, "visual-rejection.json");
    await writeJsonEvidence(cyclicRejectionPath, {
      version: 1,
      source: "explicit-user-action",
      replacementKind: "approved-ancestor-refinement",
      rejectedAt: NOW,
      jobId: ROOT_JOB_ID,
      assetId: ASSET_ID,
      variantIndex: 0,
      assetPath: source,
      assetSha256: sourceInfo.sha256,
      geometryHash: sourceInfo.geometryHash,
      approvedAncestorJobId: BASE_JOB_ID,
      successorJobId: EARLIER_REJECTED_GEOMETRY_JOB_ID,
      correctivePrompt: "malformed cycle fixture",
      correctivePromptSha256: workflowPromptSha256("malformed cycle fixture"),
      successorSpecFingerprint: workflowSpecFingerprint(rootSpec),
      retainedAncestry: [{ jobId: ROOT_JOB_ID }],
    });
    await assert.rejects(
      recordWorkflowExport(root, job, portableReceipt, NOW),
      /cycle|accepted generation/i,
      "a reachable cycle in transitive rejected-geometry ancestry must fail closed",
    );
    await rm(cyclicRejectionPath);
    const retainedConceptApprovalPath = join(rootDirectory, "concept-approval.json");
    const heldConceptApprovalPath = `${retainedConceptApprovalPath}.held`;
    await rename(retainedConceptApprovalPath, heldConceptApprovalPath);
    await assert.rejects(
      recordWorkflowExport(root, job, portableReceipt, NOW),
      /concept|evidence/i,
      "portable evidence retention must fail closed when an explicit concept approval file is missing",
    );
    await rename(heldConceptApprovalPath, retainedConceptApprovalPath);
    assert.deepEqual(await workflowExportHistory(root), []);
    const exported = await recordWorkflowExport(root, job, portableReceipt, NOW);
    assert.equal(exported.record.rootGenerationJobId, BASE_JOB_ID);
    assert.equal((await workflowExportHistory(root))[0]?.id, exported.record.id);
    const reopenedPortable = await verifyWorkflowArtifact(root, { kind: "portable", id: exported.record.id }, [], NOW);
    assert.equal(reopenedPortable.sha256, refinedAnimationInfo.sha256);
    assert.equal(reopenedPortable.retainedGeometry, true);
    assert.equal(reopenedPortable.retainedTextures, true);
    assert.equal(reopenedPortable.retainedAnimations, true);

    const portableBytes = await readFile(portablePath);
    await writeFile(portablePath, await readFile(source));
    await assert.rejects(
      verifyWorkflowArtifact(root, { kind: "portable", id: exported.record.id }, [], NOW),
      /no longer retains/i,
      "a changed portable artifact must never reopen as verified",
    );
    await writeFile(portablePath, portableBytes);
    const exportRecordPath = join(root, "workflow-exports", "individual", `${exported.record.id}.json`);
    const exportRecordBytes = await readFile(exportRecordPath);
    const forgedExportRecord = JSON.parse(exportRecordBytes.toString("utf8"));
    forgedExportRecord.byteSize += 1;
    await writeFile(exportRecordPath, `${JSON.stringify(forgedExportRecord, null, 2)}\n`);
    assert.equal((await workflowExportHistory(root)).length, 0, "a changed export receipt must remain retained but unusable");
    await assert.rejects(
      verifyWorkflowArtifact(root, { kind: "portable", id: exported.record.id }, [], NOW),
      /record seal is invalid/i,
      "a changed export receipt must fail closed",
    );
    await writeFile(exportRecordPath, exportRecordBytes);

    const noOpTexture = join(root, "noop-texture.glb");
    await copyFile(textured, noOpTexture);
    await assert.rejects(validateFinishedAsset(textured, noOpTexture, "texture"), /same retained texture\/material fingerprint/i);

    const textureOnly = reseal({ ...lineage, revisions: [textureRevision], finalJobId: TEXTURE_JOB_ID, finalSha256: textureInfo.sha256, finalGeometryHash: textureInfo.geometryHash });
    await assert.rejects(validatePrompt3DWorkflowLineage(root, textureOnly), /at least 1 approved prompted animation revision/i);

    const oneAnimation = reseal({
      ...lineage,
      revisions: [textureRevision, textureRefinementRevision, animationRevision],
      finalJobId: ANIMATION_JOB_ID,
      finalSha256: animationInfo.sha256,
      finalGeometryHash: animationInfo.geometryHash,
    });
    const oneAnimationValidation = await validatePrompt3DWorkflowLineage(root, oneAnimation);
    assert.equal(oneAnimationValidation.textureRevisions, 2);
    assert.equal(oneAnimationValidation.animationRevisions, 1, "one exact approved animation must form a complete saveable individual workflow");

    const reordered = reseal({ ...lineage, revisions: [animationRevision, textureRevision] });
    await assert.rejects(validatePrompt3DWorkflowLineage(root, reordered), /reordered|preceding output/i);

    const forged = JSON.parse(JSON.stringify(lineage)) as Prompt3DWorkflowLineage;
    forged.revisions[0].outputSha256 = digest("forged output identity");
    await assert.rejects(validatePrompt3DWorkflowLineage(root, reseal(forged)), /output no longer matches|texture fingerprints/i);

    const omittedBase = reseal({ ...lineage, generationChain: [rootLineage] });
    await assert.rejects(validatePrompt3DWorkflowLineage(root, omittedBase), /use-existing-generated-model/i);
    const omittedBaseEvidence = await writeJsonEvidence(join(animationDirectory, "lineage-omitted-base.json"), omittedBase);
    await assert.rejects(saveWorkflowAsset(root, {
      ...job,
      lineage: omittedBase,
      lineagePath: omittedBaseEvidence.path,
      lineageSha256: omittedBaseEvidence.sha256,
    }), /use-existing-generated-model/i, "managed save must fail closed when a single generation lacks an explicit existing-model decision");

    const forgedGenerationParent = JSON.parse(JSON.stringify(lineage)) as Prompt3DWorkflowLineage;
    forgedGenerationParent.generationChain[1].parentOutputSha256 = digest("forged parent output");
    forgedGenerationParent.root = forgedGenerationParent.generationChain[1];
    await assert.rejects(validatePrompt3DWorkflowLineage(root, reseal(forgedGenerationParent)), /exact approved Hunyuan parent|prompted geometry correction/i);

    const unmarkedRefinement = JSON.parse(JSON.stringify(lineage)) as Prompt3DWorkflowLineage;
    unmarkedRefinement.generationChain[1].shapeRefinement = false;
    unmarkedRefinement.root = unmarkedRefinement.generationChain[1];
    await assert.rejects(validatePrompt3DWorkflowLineage(root, reseal(unmarkedRefinement)), /prompted geometry correction/i);

    const unapproved = JSON.parse(JSON.stringify(lineage)) as Prompt3DWorkflowLineage;
    delete (unapproved.generationChain[1] as Partial<typeof unapproved.root>).visualApproval;
    delete (unapproved.root as Partial<typeof unapproved.root>).visualApproval;
    await assert.rejects(validatePrompt3DWorkflowLineage(root, reseal(unapproved)), /visual approval/i);

    const skipDirectory = join(root, "workflow-history", SKIP_TEXTURE_JOB_ID);
    const skipAnimated = join(skipDirectory, "asset.glb");
    const skipPrompt = "rotate in a battle-ready arc";
    const skipAuthored = await authorPromptedAnimation({ sourcePath: source, outputPath: skipAnimated, instruction: skipPrompt });
    const skipInfo = await inspectWorkflowGlb(skipAnimated);
    const skipProvenance = await writeJsonEvidence(join(skipDirectory, "provenance.json"), {
      version: 1,
      assetId: ASSET_ID,
      revisionJobId: SKIP_TEXTURE_JOB_ID,
      operation: "animation",
      method: "generic-prompted-motion-graph",
      provider: "grudge-motion-graph-1",
      prompt: skipPrompt,
      specFingerprint: workflowSpecFingerprint(animationSpec),
      plan: skipAuthored.plan,
      parentProvenanceSha256: rootProvenance.sha256,
      source: { jobId: ROOT_JOB_ID, sha256: sourceInfo.sha256, geometryHash: sourceInfo.geometryHash, textureFingerprint: sourceInfo.textureFingerprint },
      output: { path: skipAnimated, sha256: skipInfo.sha256, geometryHash: skipInfo.geometryHash, byteSize: skipInfo.byteSize, textureFingerprint: skipInfo.textureFingerprint, animationFingerprint: skipInfo.animationFingerprint, clipIds: skipInfo.clipIds },
    });
    const skipApproval = await writeApproval(join(skipDirectory, "visual-approval.json"), {
      version: 1,
      stage: "animation",
      assetId: ASSET_ID,
      jobId: SKIP_TEXTURE_JOB_ID,
      assetPath: skipAnimated,
      assetSha256: skipInfo.sha256,
      geometryHash: skipInfo.geometryHash,
      promptSha256: workflowPromptSha256(skipPrompt),
      specFingerprint: workflowSpecFingerprint(animationSpec),
      animationFingerprint: skipInfo.animationFingerprint,
    });
    const skippedTextureRevision: Prompt3DWorkflowRevisionLineage = {
      version: 1,
      assetId: ASSET_ID,
      jobId: SKIP_TEXTURE_JOB_ID,
      operation: "animation",
      provider: "grudge-motion-graph-1",
      sourceJobId: ROOT_JOB_ID,
      sourceSha256: sourceInfo.sha256,
      sourceGeometryHash: sourceInfo.geometryHash,
      outputPath: skipAnimated,
      outputSha256: skipInfo.sha256,
      geometryHash: skipInfo.geometryHash,
      byteSize: skipInfo.byteSize,
      specFingerprint: workflowSpecFingerprint(animationSpec),
      promptSha256: workflowPromptSha256(skipPrompt),
      provenancePath: skipProvenance.path,
      provenanceSha256: skipProvenance.sha256,
      parentProvenanceSha256: rootProvenance.sha256,
      visualApproval: skipApproval.approval,
      visualApprovalPath: skipApproval.path,
      visualApprovalSha256: skipApproval.sha256,
      sourceTextureFingerprint: sourceInfo.textureFingerprint,
      outputTextureFingerprint: skipInfo.textureFingerprint,
      animationFingerprint: skipInfo.animationFingerprint,
      animationPlanSha256: stableWorkflowSha256(skipAuthored.plan),
      clipIds: skipInfo.clipIds,
    };
    const skippedTexture = sealPrompt3DWorkflowLineage({ version: 1, assetId: ASSET_ID, generationChain: [baseLineage, rootLineage], root: rootLineage, revisions: [skippedTextureRevision], finalJobId: SKIP_TEXTURE_JOB_ID, finalSha256: skipInfo.sha256, finalGeometryHash: skipInfo.geometryHash });
    await assert.rejects(validatePrompt3DWorkflowLineage(root, skippedTexture), /Animation cannot precede Hunyuan Paint/i);

    await assert.rejects(saveWorkflowAsset(root, { ...job, visualApproval: undefined }), /visual approval/i);
    const saved = await saveWorkflowAsset(root, job);
    assert.equal(saved.asset.sha256, refinedAnimationInfo.sha256);
    assert.equal(saved.asset.method, "hunyuan3d-workflow");
    assert.equal(saved.asset.evidenceBundleManifestSha256, exported.record.evidenceBundleManifestSha256);
    assert.ok(saved.asset.evidenceBundleManifestPath.startsWith(join(root, "saved-assets", "evidence-bundles")));
    assert.equal((await workflowLibrary(root)).length, 1);
    const loaded = await readWorkflowJobs(root);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].state, "complete");
    assert.deepEqual(await readFile(saved.asset.savedPath), await readFile(refinedAnimated));
    const reopenedManaged = await verifyWorkflowArtifact(root, { kind: "managed", id: saved.asset.id }, [saved.asset], NOW);
    assert.equal(reopenedManaged.sha256, refinedAnimationInfo.sha256);
    assert.equal(reopenedManaged.retainedGeometry, true);
    assert.equal(reopenedManaged.retainedTextures, true);
    assert.equal(reopenedManaged.retainedAnimations, true);

    const savedBytes = await readFile(saved.asset.savedPath);
    await writeFile(saved.asset.savedPath, await readFile(source));
    assert.equal((await workflowLibrary(root)).length, 0, "a changed saved artifact must never be reported as usable");
    await assert.rejects(saveWorkflowAsset(root, job), /conflicts with this immutable revision/i);
    await writeFile(saved.asset.savedPath, savedBytes);
    const idempotent = await saveWorkflowAsset(root, job);
    assert.equal(idempotent.alreadySaved, true);

    const bundleManifestBytes = await readFile(saved.asset.evidenceBundleManifestPath);
    const bundleManifest = JSON.parse(bundleManifestBytes.toString("utf8"));
    assert.equal(sha256Bytes(bundleManifestBytes), saved.asset.evidenceBundleManifestSha256);
    assert.ok(bundleManifest.entries.some((entry: any) => entry.kind === "concept-image"));
    assert.ok(bundleManifest.entries.some((entry: any) => entry.kind === "concept-review"));
    assert.ok(bundleManifest.entries.some((entry: any) => entry.kind === "concept-attempt"));
    assert.ok(bundleManifest.entries.some((entry: any) => entry.kind === "concept-approval"));
    const rejectionEntries = bundleManifest.entries.filter((entry: any) => entry.kind === "geometry-rejection");
    assert.equal(rejectionEntries.length, 2, "every consecutive rejected-geometry record must be retained");
    for (const [jobId, assetPath, attemptMarker] of [
      [EARLIER_REJECTED_GEOMETRY_JOB_ID, earlierRejectedSource, earlierRejectedAttemptMarker],
      [REJECTED_GEOMETRY_JOB_ID, rejectedSource, rejectedAttemptMarker],
    ] as const) {
      assert.ok(rejectionEntries.some((entry: any) => entry.sourcePath === join(root, "jobs", jobId, "variant-1", "visual-rejection.json")), `rejection record ${jobId} must be retained`);
      assert.ok(bundleManifest.entries.some((entry: any) => entry.kind === "generation-output" && entry.sourcePath === assetPath), `rejected GLB ${jobId} must be retained`);
      assert.ok(bundleManifest.entries.some((entry: any) => entry.sourcePath === attemptMarker), `rejected attempt tree ${jobId} must be retained`);
    }
    assert.ok(bundleManifest.entries.some((entry: any) => entry.kind === "visual-approval"));
    assert.ok(bundleManifest.entries.some((entry: any) => entry.kind === "texture-reference"));
    assert.ok(bundleManifest.entries.some((entry: any) => entry.kind === "job-record"));
    assert.ok(bundleManifest.entries.some((entry: any) => entry.kind === "event"));
    assert.ok(bundleManifest.entries.some((entry: any) => entry.kind === "concept-image" && String(entry.sourcePath).includes(FIRST_REFINEMENT_CONCEPT_JOB_ID)));
    assert.ok(bundleManifest.entries.some((entry: any) => entry.kind === "concept-image" && String(entry.sourcePath).includes(SECOND_REFINEMENT_CONCEPT_JOB_ID)));
    for (const entry of bundleManifest.entries) {
      const retainedPath = join(dirname(saved.asset.evidenceBundleManifestPath), ...String(entry.bundlePath).split("/"));
      assert.deepEqual(await readFile(retainedPath), await readFile(entry.sourcePath), "bundle evidence must be a byte-identical snapshot");
    }

    const firstEvidence = bundleManifest.entries.find((entry: any) => entry.kind === "visual-approval");
    assert.ok(firstEvidence);
    const firstEvidencePath = join(dirname(saved.asset.evidenceBundleManifestPath), ...String(firstEvidence.bundlePath).split("/"));
    const firstEvidenceBytes = await readFile(firstEvidencePath);
    await writeFile(firstEvidencePath, Buffer.concat([firstEvidenceBytes, Buffer.from("tamper")]));
    await assert.rejects(
      verifyWorkflowArtifact(root, { kind: "managed", id: saved.asset.id }, [saved.asset], NOW),
      /hash verification|byte-size/i,
      "changed evidence bytes must invalidate managed reopen",
    );
    assert.equal((await workflowExportHistory(root)).length, 0, "portable history must hide records with changed evidence bytes");
    await writeFile(firstEvidencePath, firstEvidenceBytes);
    assert.equal((await workflowExportHistory(root)).length, 1);

    const traversalManifest = JSON.parse(bundleManifestBytes.toString("utf8"));
    traversalManifest.entries[0].bundlePath = "files/../outside.json";
    const { sealSha256: _traversalSeal, ...traversalUnsigned } = traversalManifest;
    traversalManifest.sealSha256 = stableWorkflowSha256(traversalUnsigned);
    const traversalBytes = Buffer.from(`${JSON.stringify(traversalManifest, null, 2)}\n`, "utf8");
    await writeFile(saved.asset.evidenceBundleManifestPath, traversalBytes);
    await assert.rejects(
      verifyPrompt3DWorkflowEvidenceBundle(root, saved.asset.evidenceBundleManifestPath, sha256Bytes(traversalBytes)),
      /traversal|outside files/i,
      "a correctly resealed traversal mapping must still fail closed",
    );
    await writeFile(saved.asset.evidenceBundleManifestPath, bundleManifestBytes);

    const incompleteManifest = JSON.parse(bundleManifestBytes.toString("utf8"));
    incompleteManifest.entries = incompleteManifest.entries.filter((entry: any) => entry.kind !== "concept-image");
    const { sealSha256: _incompleteSeal, ...incompleteUnsigned } = incompleteManifest;
    incompleteManifest.sealSha256 = stableWorkflowSha256(incompleteUnsigned);
    const incompleteBytes = Buffer.from(`${JSON.stringify(incompleteManifest, null, 2)}\n`, "utf8");
    await writeFile(saved.asset.evidenceBundleManifestPath, incompleteBytes);
    await assert.rejects(
      verifyPrompt3DWorkflowEvidenceBundle(root, saved.asset.evidenceBundleManifestPath, sha256Bytes(incompleteBytes)),
      /incomplete|missing required concept/i,
      "a correctly resealed incomplete mapping must still fail closed",
    );
    await writeFile(saved.asset.evidenceBundleManifestPath, bundleManifestBytes);

    const symlinkTarget = join(root, "bundle-symlink-target.json");
    await writeFile(symlinkTarget, firstEvidenceBytes);
    await rm(firstEvidencePath);
    let symlinkCreated = false;
    try {
      await symlink(symlinkTarget, firstEvidencePath, "file");
      symlinkCreated = true;
      await assert.rejects(
        verifyPrompt3DWorkflowEvidenceBundle(root, saved.asset.evidenceBundleManifestPath, saved.asset.evidenceBundleManifestSha256),
        /symbolic link/i,
        "symlinked evidence must fail closed",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    } finally {
      if (symlinkCreated) await rm(firstEvidencePath);
      await writeFile(firstEvidencePath, firstEvidenceBytes);
    }

    await rm(join(root, "jobs"), { recursive: true, force: true });
    await rm(join(root, "workflow-history"), { recursive: true, force: true });
    const independentLibrary = await workflowLibrary(root);
    assert.equal(independentLibrary.length, 1, "managed library must reopen without source job directories");
    assert.equal((await verifyWorkflowArtifact(root, { kind: "managed", id: saved.asset.id }, independentLibrary, NOW)).sha256, refinedAnimationInfo.sha256);
    assert.equal((await verifyWorkflowArtifact(root, { kind: "portable", id: exported.record.id }, [], NOW)).sha256, refinedAnimationInfo.sha256);
    assert.equal((await saveWorkflowAsset(root, job)).alreadySaved, true, "idempotent managed save must use retained evidence only");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log("Prompt-to-3D authoritative workflow identity, approval, lineage and save checks passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
