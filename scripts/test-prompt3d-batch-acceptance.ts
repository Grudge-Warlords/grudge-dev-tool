import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertFreshPrompt3DBatchGeneration,
  createPrompt3DBatchAcceptanceReceipt,
  prompt3DBatchWorkflowIntentSha256,
  reserveFreshPrompt3DBatchSeed,
} from "../src/main/prompt3d/batchAcceptance";
import { Prompt3DService } from "../src/main/prompt3d/service";
import type { AssetSpecV1 } from "../src/shared/prompt3d";
import type {
  Prompt3DBatchAcceptanceEvidence,
  Prompt3DBatchItem,
  Prompt3DBatchRequest,
  Prompt3DWorkflowArtifactVerification,
  Prompt3DWorkflowLibraryAsset,
} from "../src/shared/prompt3dWorkflow";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

const baseSpec: AssetSpecV1 = {
  version: "1.0.0",
  prompt: "an isolated original mechanical creature with a complete readable silhouette",
  category: "character",
  style: "realistic",
  route: "concept-image-to-3d",
  targetFormat: "glb",
  dimensions: { width: 1, height: 1, depth: 1, unit: "m" },
  budgets: { maxTriangles: 60_000, maxTextureResolution: 1024, maxTextureBytes: 16 * 1024 ** 2 },
  seed: 1,
  variants: 1,
  providerId: "hunyuan3d-2",
  generateTextures: false,
  generateCollision: false,
  generateLods: false,
  scaleMode: "exact",
  coordinateContract: { upAxis: "+Y", forwardAxis: "+Z", origin: "ground-center", stableRootName: "GrudgeAssetRoot" },
};

function makeAcceptance(root: string): { acceptance: Prompt3DBatchAcceptanceEvidence; request: Prompt3DBatchRequest } {
  const items: Prompt3DBatchAcceptanceEvidence["items"] = [];
  const requestItems: Prompt3DBatchItem[] = [];
  for (let index = 0; index < 6; index += 1) {
    const assignedSeed = 10_000 + index * 1_000;
    const baselineId = `baseline-${index}`;
    const baselineSourceJob = randomUUID();
    const baselineBaseJob = randomUUID();
    const baselineRefinedJob = randomUUID();
    const baseJob = randomUUID();
    const refinedJob = randomUUID();
    const managedHash = hash(`managed-${index}`);
    const intentHash = hash(`intent-${index}`);
    const managed: Prompt3DWorkflowLibraryAsset = {
      version: 1,
      id: randomUUID(),
      assetId: randomUUID(),
      sourceJobId: randomUUID(),
      name: `strict-${index}.glb`,
      savedPath: join(root, "saved-assets", `strict-${index}.glb`),
      savedAt: new Date().toISOString(),
      byteSize: 512 + index,
      sha256: managedHash,
      geometryHash: hash(`refined-geometry-${index}`),
      prompt: `${baseSpec.prompt} ${index}`,
      category: baseSpec.category,
      style: baseSpec.style,
      method: "hunyuan3d-workflow",
      provider: "hunyuan3d-2",
      textures: 1,
      animations: 2,
      rootGenerationJobId: baseJob,
      lineagePath: join(root, "lineage", `strict-${index}.json`),
      lineageSha256: hash(`lineage-${index}`),
      evidenceBundleManifestPath: join(root, "saved-assets", "evidence-bundles", `strict-${index}`, "manifest.json"),
      evidenceBundleManifestSha256: hash(`evidence-bundle-${index}`),
      finalVisualApprovalSha256: hash(`approval-${index}`),
    };
    const recordId = randomUUID();
    const destinationPath = join(root, "portable", `strict-${index}.glb`);
    const reopened: Prompt3DWorkflowArtifactVerification = {
      version: 1,
      kind: "portable",
      id: recordId,
      sourceJobId: managed.sourceJobId,
      assetId: managed.assetId,
      path: destinationPath,
      filename: `strict-${index}.glb`,
      sha256: managed.sha256,
      byteSize: managed.byteSize,
      geometryHash: managed.geometryHash,
      textures: 1,
      textureFingerprint: hash(`texture-${index}`),
      animations: [{ name: `motion-${index}`, duration: 2, channels: 3 }],
      animationFingerprint: hash(`animation-${index}`),
      lineagePath: managed.lineagePath,
      lineageSha256: managed.lineageSha256,
      evidenceBundleManifestPath: managed.evidenceBundleManifestPath,
      evidenceBundleManifestSha256: managed.evidenceBundleManifestSha256,
      finalVisualApprovalSha256: managed.finalVisualApprovalSha256,
      retainedGeometry: true,
      retainedTextures: true,
      retainedAnimations: true,
      verifiedAt: new Date().toISOString(),
    };
    const reservedSeeds = [assignedSeed, assignedSeed + 1, assignedSeed + 100, assignedSeed + 101, assignedSeed + 200, assignedSeed + 201];
    items.push({
      itemId: `item-${index}`,
      requestedSeed: index + 1,
      assignedSeed,
      reservedSeeds,
      baselineIntentSha256: intentHash,
      requestIntentSha256: intentHash,
      baseline: {
        managedAssetId: baselineId,
        sourceJobId: baselineSourceJob,
        finalSha256: hash(`baseline-final-${index}`),
        jobId: baselineRefinedJob,
        seed: 101 + index * 10,
        conceptSha256: hash(`baseline-refined-concept-${index}`),
        outputSha256: hash(`baseline-refined-output-${index}`),
        geometryHash: hash(`baseline-refined-geometry-${index}`),
        generationChain: [
          { jobId: baselineBaseJob, seed: 100 + index * 10, conceptSha256: hash(`baseline-base-concept-${index}`), outputSha256: hash(`baseline-base-output-${index}`), geometryHash: hash(`baseline-base-geometry-${index}`) },
          { jobId: baselineRefinedJob, seed: 101 + index * 10, conceptSha256: hash(`baseline-refined-concept-${index}`), outputSha256: hash(`baseline-refined-output-${index}`), geometryHash: hash(`baseline-refined-geometry-${index}`) },
        ],
      },
      base: { jobId: baseJob, seed: assignedSeed, conceptSha256: hash(`base-concept-${index}`), outputSha256: hash(`base-output-${index}`), geometryHash: hash(`base-geometry-${index}`) },
      refined: { jobId: refinedJob, seed: assignedSeed + 1, conceptSha256: hash(`refined-concept-${index}`), outputSha256: hash(`refined-output-${index}`), geometryHash: managed.geometryHash },
      finishing: [
        { jobId: randomUUID(), operation: "texture", revisionIndex: 0, seed: assignedSeed + 100, promptSha256: hash(`texture-prompt-0-${index}`), outputSha256: hash(`texture-output-0-${index}`) },
        { jobId: randomUUID(), operation: "texture", revisionIndex: 1, seed: assignedSeed + 101, promptSha256: hash(`texture-prompt-1-${index}`), outputSha256: hash(`texture-output-1-${index}`) },
        { jobId: randomUUID(), operation: "animation", revisionIndex: 0, seed: assignedSeed + 200, promptSha256: hash(`animation-prompt-0-${index}`), outputSha256: hash(`animation-output-0-${index}`) },
        { jobId: managed.sourceJobId, operation: "animation", revisionIndex: 1, seed: assignedSeed + 201, promptSha256: hash(`animation-prompt-1-${index}`), outputSha256: managed.sha256 },
      ],
      managed,
      portable: {
        version: 1,
        destinationPath,
        filename: `strict-${index}.glb`,
        sha256: managed.sha256,
        byteSize: managed.byteSize,
        exportedAt: reopened.verifiedAt,
        recordId,
        recordSha256: hash(`record-${index}`),
        reopenVerification: reopened,
      },
    });
    requestItems.push({
      id: `item-${index}`,
      name: `Item ${index}`,
      spec: { ...baseSpec, prompt: `${baseSpec.prompt} ${index}`, seed: assignedSeed },
      shapeRefinement: "make the approved silhouette more distinctive",
      texturePrompts: ["apply complete material coverage", "refine the material details"],
      animationRevisions: [{ prompt: "move forward visibly", mode: "replace" }, { prompt: "refine the motion timing", mode: "append" }],
      baselineManagedAssetId: baselineId,
    });
  }
  return {
    acceptance: {
      version: 1,
      profile: "strict-final-run-v1",
      expectedItemCount: 6,
      eligible: true,
      serviceRunId: randomUUID(),
      restoreCount: 0,
      retryCount: 0,
      exportAttemptCount: 1,
      admittedAt: new Date().toISOString(),
      items,
    },
    request: { name: "Strict acceptance fixture", items: requestItems, acceptance: { profile: "strict-final-run-v1", expectedItemCount: 6 } },
  };
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "grudge-strict-batch-test-"));
  try {
    const used = new Set([50, 51, 52, 53]);
    const assigned = reserveFreshPrompt3DBatchSeed(50, used, [0, 1]);
    assert.equal(assigned, 54, "seed allocation must scan past every overlapping derived range");
    assert.equal(used.has(54) && used.has(55), true, "seed allocation must atomically reserve every derived seed");

    const animationPlan = { instruction: "swing forward", mode: "append", seed: 9, timingExponent: 1.1, clipId: "old", clipName: "old", instructionSha256: hash("old"), cycles: 2 };
    const baselineIntent = prompt3DBatchWorkflowIntentSha256({
      spec: { ...baseSpec, seed: 7 },
      shapeRefinement: "make the silhouette sharper",
      texturePrompts: ["dark iron", "refine edge wear"],
      animationPlans: [animationPlan],
    });
    const freshSeedIntent = prompt3DBatchWorkflowIntentSha256({
      spec: { ...baseSpec, seed: 999 },
      shapeRefinement: " make   the silhouette sharper ",
      texturePrompts: ["dark iron", "refine edge wear"],
      animationPlans: [{ ...animationPlan, seed: 123, timingExponent: 0.9, clipId: "new", clipName: "new" }],
    });
    assert.equal(freshSeedIntent, baselineIntent, "intent binding must ignore fresh generation and animation seed identities");
    assert.notEqual(prompt3DBatchWorkflowIntentSha256({
      spec: { ...baseSpec, seed: 999 },
      shapeRefinement: "make the silhouette unrelated",
      texturePrompts: ["dark iron", "refine edge wear"],
      animationPlans: [{ ...animationPlan, mode: "replace" }],
    }), baselineIntent, "unrelated queued shape or animation intent must not match a selected baseline");

    const { acceptance, request } = makeAcceptance(root);
    const receipt = createPrompt3DBatchAcceptanceReceipt(randomUUID(), acceptance, new Date().toISOString());
    assert.equal(receipt.managedCount, 6);
    assert.equal(receipt.portableCount, 6);
    assert.equal(receipt.items.every((item) => item.baselineIntentSha256 === item.requestIntentSha256), true, "receipt must bind both workflow-intent hashes");
    assert.equal(receipt.items.every((item) => item.finishing.length === 4), true, "receipt must retain every ordered finishing revision");

    const wrongIntent = structuredClone(acceptance);
    wrongIntent.items[0].requestIntentSha256 = hash("wrong-intent");
    assert.throws(() => createPrompt3DBatchAcceptanceReceipt(randomUUID(), wrongIntent, new Date().toISOString()), /intent does not match/i);

    const reusedGeometry = structuredClone(acceptance);
    reusedGeometry.items[0].base!.geometryHash = reusedGeometry.items[1].baseline.generationChain[0].geometryHash;
    assert.throws(() => assertFreshPrompt3DBatchGeneration(reusedGeometry, "item-0", "base", reusedGeometry.items[0].base!), /geometry reuses/i);

    const badFinishOrder = structuredClone(acceptance);
    [badFinishOrder.items[0].finishing[0], badFinishOrder.items[0].finishing[2]] = [badFinishOrder.items[0].finishing[2], badFinishOrder.items[0].finishing[0]];
    assert.throws(() => createPrompt3DBatchAcceptanceReceipt(randomUUID(), badFinishOrder, new Date().toISOString()), /finishing evidence/i);

    const badReopen = structuredClone(acceptance);
    badReopen.items[0].portable!.reopenVerification.retainedAnimations = false as true;
    assert.throws(() => createPrompt3DBatchAcceptanceReceipt(randomUUID(), badReopen, new Date().toISOString()), /portable output/i);

    for (const field of ["restoreCount", "retryCount"] as const) {
      const interrupted = structuredClone(acceptance);
      interrupted[field] = 1;
      interrupted.eligible = false;
      assert.throws(() => createPrompt3DBatchAcceptanceReceipt(randomUUID(), interrupted, new Date().toISOString()), /ineligible for sealing/i);
    }
    const retriedExport = structuredClone(acceptance);
    retriedExport.exportAttemptCount = 2;
    retriedExport.eligible = false;
    assert.throws(() => createPrompt3DBatchAcceptanceReceipt(randomUUID(), retriedExport, new Date().toISOString()), /ineligible for sealing/i);

    const service = new Prompt3DService({ root, appRoot: join(__dirname, ".."), offlineLocalTest: true });
    const internals = service as unknown as { normalizeBatchRequest(value: Prompt3DBatchRequest): Prompt3DBatchRequest };
    assert.throws(() => internals.normalizeBatchRequest({ ...request, items: request.items.slice(0, 5) }), /exactly 6/i);
    assert.throws(() => internals.normalizeBatchRequest({
      ...request,
      items: request.items.map((item, index) => index === 1 ? { ...item, baselineManagedAssetId: request.items[0].baselineManagedAssetId } : item),
    }), /distinct individual managed baselines/i);

    const batchId = randomUUID();
    const directory = join(root, "workflow-batches", batchId);
    await mkdir(directory, { recursive: true });
    const partialAcceptance = structuredClone(acceptance);
    partialAcceptance.exportAttemptCount = 0;
    partialAcceptance.items = partialAcceptance.items.map((item) => ({
      itemId: item.itemId,
      requestedSeed: item.requestedSeed,
      assignedSeed: item.assignedSeed,
      reservedSeeds: item.reservedSeeds,
      baselineIntentSha256: item.baselineIntentSha256,
      requestIntentSha256: item.requestIntentSha256,
      baseline: item.baseline,
      finishing: [],
    }));
    const manifestPath = join(directory, "manifest.json");
    const manifest = {
      version: 1,
      id: batchId,
      name: request.name,
      state: "failed",
      request,
      runtime: Object.fromEntries(request.items.map((item) => [item.id, { baseComplete: false, shapeComplete: false, nextTexture: 0, nextAnimation: 0 }])),
      items: request.items.map((item, index) => ({ id: item.id, name: item.name, state: index === 0 ? "failed" : "queued", progress: 0, message: "retained fixture" })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      manifestPath,
      acceptance: partialAcceptance,
      message: "retained fixture",
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const restoredService = new Prompt3DService({ root, appRoot: join(__dirname, ".."), offlineLocalTest: true });
    const restored = restoredService.batchStatus(restoredService.grant(), batchId)!;
    assert.equal(restored.acceptance?.eligible, false, "any pre-seal process restore must disqualify strict continuity");
    assert.equal(restored.acceptance?.restoreCount, 1, "pre-seal restore must be counted exactly once in the service instance");

    console.log("Strict Prompt-to-3D batch acceptance covered intent binding, fresh seed reservation, duplicate rejection, continuity, ordered finishing evidence, reopened portable proof and receipt sealing.");
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 25));
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
