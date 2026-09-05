import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { Prompt3DService } from "../src/main/prompt3d/service";
import { inspectWorkflowGlb, saveWorkflowAsset } from "../src/main/prompt3d/workflow";
import type {
  AssetSpecV1,
  Prompt3DApproveConceptRequest,
  Prompt3DJobStatus,
  Prompt3DStartRequest,
  Prompt3DValidationReport,
} from "../src/shared/prompt3d";
import type {
  Prompt3DAssetSource,
  Prompt3DBatchRequest,
  Prompt3DBatchStatus,
  Prompt3DFinishJobStatus,
  Prompt3DFinishRequest,
  Prompt3DVisualApproval,
  Prompt3DWorkflowSaveResult,
} from "../src/shared/prompt3dWorkflow";
import {
  PROMPT3D_MIN_BATCH_FINISH_PROMPTS,
  shouldRehydratePrompt3DBatch,
} from "../src/shared/prompt3dWorkflow";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=", "base64");

const spec: AssetSpecV1 = {
  version: "1.0.0",
  prompt: "an original isolated stone lantern with a complete silhouette",
  category: "prop",
  style: "stylized",
  route: "concept-image-to-3d",
  targetFormat: "glb",
  dimensions: { width: 1, height: 2, depth: 1, unit: "m" },
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

type ServiceInternals = {
  jobs: Map<string, Prompt3DJobStatus>;
  finishJobs: Map<string, Prompt3DFinishJobStatus>;
  batchRuntime: Map<string, Map<string, Prompt3DBatchStatus["runtime"][string]>>;
  batchJobLinks: Map<string, string>;
  batchesAdvancing: Set<string>;
  batchesAdvancePending: Set<string>;
  activeSidecarJobs: Map<string, string>;
  writeJsonAtomic(path: string, value: unknown): Promise<void>;
  publishBatch(batch: Prompt3DBatchStatus): Promise<void>;
  queueBatchAdvance(batchId: string): void;
  queueBatchAdvanceForJob(jobId: string): void;
  sidecarRequest(path: string, init?: RequestInit): Promise<unknown>;
  resolveWorkflowSource(source: Prompt3DAssetSource): Promise<unknown>;
  verifyFinishLineage(job: Prompt3DFinishJobStatus, requireComplete?: boolean): Promise<unknown>;
  saveFinishedWorkflowAsset(job: Prompt3DFinishJobStatus): Promise<Prompt3DWorkflowSaveResult>;
  retainBatchPortableExport(
    job: Prompt3DFinishJobStatus,
    destinationPath: string,
    inspection: Awaited<ReturnType<typeof inspectWorkflowGlb>>,
    exportedAt: string,
  ): Promise<{ portable: NonNullable<Prompt3DBatchStatus["items"][number]["portableExport"]>; recordPath: string }>;
  verifyRetainedBatchPortable(
    job: Prompt3DFinishJobStatus,
    portable: NonNullable<Prompt3DBatchStatus["items"][number]["portableExport"]>,
    directory: string,
  ): Promise<NonNullable<Prompt3DBatchStatus["items"][number]["portableExport"]> | null>;
};

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await pause(5);
  }
  assert.fail(`Timed out waiting for ${label}.`);
}

async function workflowFixture(path: string) {
  const document = new Document();
  const buffer = document.createBuffer("fixture");
  const positions = new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uv = new Float32Array([0, 0, 1, 0, 0.5, 1]);
  const primitive = document.createPrimitive()
    .setAttribute("POSITION", document.createAccessor().setType("VEC3").setArray(positions).setBuffer(buffer))
    .setAttribute("NORMAL", document.createAccessor().setType("VEC3").setArray(normals).setBuffer(buffer))
    .setAttribute("TEXCOORD_0", document.createAccessor().setType("VEC2").setArray(uv).setBuffer(buffer))
    .setIndices(document.createAccessor().setType("SCALAR").setArray(new Uint16Array([0, 1, 2])).setBuffer(buffer));
  primitive.setMaterial(document.createMaterial("fixture material").setBaseColorTexture(
    document.createTexture("fixture texture").setImage(PNG).setMimeType("image/png"),
  ));
  const node = document.createNode("GeneratedMesh").setMesh(document.createMesh("HunyuanMesh").addPrimitive(primitive));
  const rootNode = document.createNode("GrudgeAssetRoot").addChild(node);
  document.createScene("scene").addChild(rootNode);
  const times = document.createAccessor().setType("SCALAR").setArray(new Float32Array([0, 1])).setBuffer(buffer);
  const rotations = document.createAccessor().setType("VEC4").setArray(new Float32Array([0, 0, 0, 1, 0, 0.7071067, 0, 0.7071067])).setBuffer(buffer);
  const sampler = document.createAnimationSampler("fixture sampler").setInput(times).setOutput(rotations).setInterpolation("LINEAR");
  document.createAnimation("fixture motion").addSampler(sampler).addChannel(
    document.createAnimationChannel("fixture channel").setSampler(sampler).setTargetNode(rootNode).setTargetPath("rotation"),
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, await new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(document));
  return inspectWorkflowGlb(path);
}

function approval(jobId: string, assetId: string, stage: Prompt3DVisualApproval["stage"], assetPath: string): Prompt3DVisualApproval {
  const stageDigit = stage === "geometry" ? "1" : stage === "texture" ? "2" : "3";
  return {
    version: 1,
    approvalId: `approval-${jobId}`,
    stage,
    assetId,
    jobId,
    assetPath,
    assetSha256: stageDigit.repeat(64),
    geometryHash: "a".repeat(64),
    promptSha256: "b".repeat(64),
    specFingerprint: "c".repeat(64),
    bindingSha256: "d".repeat(64),
    approvedAt: new Date().toISOString(),
    source: "explicit-user-action",
  };
}

function completeGeneration(job: Prompt3DJobStatus): Prompt3DJobStatus["variants"][number] {
  const assetPath = join(job.outputDirectory, "variant-1", "asset.glb");
  const report: Prompt3DValidationReport = {
    version: 1,
    deterministicId: "e".repeat(64),
    assetPath,
    gameReady: true,
    triangleCount: 12,
    checks: [],
    createdAt: new Date().toISOString(),
  };
  const variant: Prompt3DJobStatus["variants"][number] = {
    index: 0,
    glbPath: assetPath,
    report,
    provenancePath: join(job.outputDirectory, "variant-1", "provenance.json"),
    sha256: "1".repeat(64),
    geometryHash: "a".repeat(64),
    byteSize: 128,
    validationReportSha256: "2".repeat(64),
    provenanceSha256: "3".repeat(64),
  };
  Object.assign(job, {
    state: "complete",
    stage: "complete",
    progress: 100,
    message: "Deterministic geometry fixture completed.",
    variants: [variant],
    updatedAt: new Date().toISOString(),
  });
  return variant;
}

function statusView(batch: Prompt3DBatchStatus) {
  return {
    state: batch.state,
    first: { ...batch.items[0] },
    second: { ...batch.items[1] },
  };
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "grudge-batch-approval-test-"));
  const routedRoots: string[] = [];
  const service = new Prompt3DService({
    root,
    appRoot: join(__dirname, ".."),
    offlineLocalTest: true,
    onWorkflowLibraryRoot: (localAssetsRoot) => { routedRoots.push(localAssetsRoot); },
  });
  const realStart = service.start.bind(service);
  const realFinishStart = service.finishStart.bind(service);
  const realApproveConcept = service.approveConcept.bind(service);
  const internals = service as unknown as ServiceInternals;
  const mutableService = service as unknown as {
    start(token: string, request: Prompt3DStartRequest): Promise<Prompt3DJobStatus>;
    finishStart(token: string, request: Prompt3DFinishRequest): Promise<Prompt3DFinishJobStatus>;
  };
  const generationJobs: Prompt3DJobStatus[] = [];
  const finishingJobs: Prompt3DFinishJobStatus[] = [];
  const animationModes: Array<"append" | "replace" | undefined> = [];
  let generationSequence = 0;
  let finishSequence = 0;

  try {
    mutableService.start = async (_token, request) => {
      generationSequence += 1;
      const now = new Date().toISOString();
      const id = `fixture-generation-${generationSequence}`;
      const parent = request.parentConceptJobId ? internals.jobs.get(request.parentConceptJobId) : undefined;
      const job: Prompt3DJobStatus = {
        id,
        assetId: parent?.assetId ?? `fixture-asset-${generationSequence}`,
        parentJobId: request.parentConceptJobId,
        state: "awaiting-concept-approval",
        stage: "awaiting-concept-approval",
        progress: 35,
        providerId: "hunyuan3d-2",
        spec: request.spec,
        message: "Deterministic concept fixture awaits approval.",
        outputDirectory: join(root, "jobs", id),
        variants: [],
        createdAt: now,
        updatedAt: now,
      };
      generationJobs.push(job);
      internals.jobs.set(id, job);
      return job;
    };

    mutableService.finishStart = async (_token, request) => {
      if (request.operation === "animation") animationModes.push(request.animation?.mode);
      finishSequence += 1;
      const now = new Date().toISOString();
      const id = `fixture-${request.operation}-${finishSequence}`;
      const assetPath = join(root, "workflow-history", id, "asset.glb");
      const inspection = await workflowFixture(assetPath);
      const job = {
        version: 1,
        id,
        assetId: `fixture-asset-${request.batchItemId}`,
        source: request.source,
        sourceAssetPath: join(root, "fixtures", `${request.source.jobId}.glb`),
        sourceSha256: "1".repeat(64),
        sourceGeometryHash: "a".repeat(64),
        operation: request.operation,
        instruction: request.instruction,
        seed: request.seed ?? 0,
        state: "complete",
        stage: "complete",
        progress: 100,
        message: `Deterministic ${request.operation} fixture completed.`,
        outputDirectory: join(root, "workflow-history", id),
        assetPath,
        sha256: inspection.sha256,
        geometryHash: inspection.geometryHash,
        validation: {
          selfContained: true,
          sourceGeometryPreserved: true,
          sourceGeometryHash: "a".repeat(64),
          outputGeometryHash: "a".repeat(64),
          embeddedTextures: 1,
          sourceTextureFingerprint: "6".repeat(64),
          outputTextureFingerprint: "7".repeat(64),
          textureChanged: request.operation === "texture",
          outputAnimationFingerprint: request.operation === "animation" ? "8".repeat(64) : "6".repeat(64),
          animations: request.operation === "animation" ? [{ name: "fixture", duration: 1, channels: 1 }] : [],
          checks: [],
        },
        provider: request.operation === "texture" ? "hunyuan3d-paint-2.1" : "grudge-motion-graph-1",
        baseSpec: spec,
        batchId: request.batchId,
        batchItemId: request.batchItemId,
        createdAt: now,
        updatedAt: now,
      } as unknown as Prompt3DFinishJobStatus;
      finishingJobs.push(job);
      internals.finishJobs.set(id, job);
      return job;
    };

    // These stubs avoid GLB/provider work while retaining the production gate's exact-job check.
    internals.resolveWorkflowSource = async (source) => {
      assert.equal(source.kind, "generation");
      const job = internals.jobs.get(source.jobId);
      const variant = job?.variants[source.kind === "generation" ? source.variantIndex ?? 0 : 0];
      assert.equal(variant?.visualApproval?.jobId, job?.id, "geometry continuation requires approval for the current job");
      assert.equal(variant?.visualApproval?.stage, "geometry");
      return { source };
    };
    internals.verifyFinishLineage = async (job) => {
      assert.equal(job.visualApproval?.jobId, job.id, "finishing continuation requires approval for the current job");
      assert.equal(job.visualApproval?.stage, job.operation);
      const inspection = await inspectWorkflowGlb(job.assetPath!);
      return { job, path: job.assetPath, inspection };
    };
    const savedJobs: string[] = [];
    internals.saveFinishedWorkflowAsset = async (job) => {
      assert.equal(job.operation, "animation", "only the approved final animation may enter the managed library");
      assert.equal(job.visualApproval?.jobId, job.id, "managed save requires the exact final approval");
      const localAssetsRoot = join(root, "saved-assets", "models");
      const savedPath = join(localAssetsRoot, `${job.id}.glb`);
      await mkdir(localAssetsRoot, { recursive: true });
      await copyFile(job.assetPath!, savedPath);
      const inspection = await inspectWorkflowGlb(savedPath);
      savedJobs.push(job.id);
      return {
        alreadySaved: false,
        localAssetsRoot,
        asset: {
          version: 1,
          id: job.id,
          assetId: job.assetId,
          sourceJobId: job.id,
          name: `${job.id}.glb`,
          savedPath,
          savedAt: new Date().toISOString(),
          byteSize: inspection.byteSize,
          sha256: inspection.sha256,
          geometryHash: inspection.geometryHash,
          prompt: job.baseSpec.prompt,
          category: job.baseSpec.category,
          style: job.baseSpec.style,
          method: "hunyuan3d-workflow",
          provider: "hunyuan3d-2",
          textures: inspection.textures,
          animations: inspection.animations.length,
          rootGenerationJobId: "fixture-root-generation",
          lineagePath: join(root, "saved-assets", "workflow-lineage", `${job.id}.json`),
          lineageSha256: "9".repeat(64),
          finalVisualApprovalSha256: "8".repeat(64),
        },
      };
    };
    internals.retainBatchPortableExport = async (job, destinationPath, inspection, exportedAt) => {
      const recordId = randomUUID();
      return {
        recordPath: join(root, "fixture-export-records", `${recordId}.json`),
        portable: {
          version: 1,
          destinationPath,
          filename: destinationPath.split(/[\\/]/).at(-1)!,
          sha256: inspection.sha256,
          byteSize: inspection.byteSize,
          exportedAt,
          recordId,
          recordSha256: "f".repeat(64),
          reopenVerification: {
            version: 1,
            kind: "portable",
            id: recordId,
            sourceJobId: job.id,
            assetId: job.assetId,
            path: destinationPath,
            filename: destinationPath.split(/[\\/]/).at(-1)!,
            sha256: inspection.sha256,
            byteSize: inspection.byteSize,
            geometryHash: inspection.geometryHash,
            textures: inspection.textures,
            textureFingerprint: inspection.textureFingerprint,
            animations: inspection.animations,
            animationFingerprint: inspection.animationFingerprint,
            lineagePath: join(root, "fixture-lineage.json"),
            lineageSha256: "9".repeat(64),
            finalVisualApprovalSha256: "8".repeat(64),
            retainedGeometry: true,
            retainedTextures: true,
            retainedAnimations: true,
            verifiedAt: exportedAt,
          },
        },
      };
    };
    internals.verifyRetainedBatchPortable = async (job, portable, directory) => {
      assert.equal(portable.reopenVerification.sourceJobId, job.id, "retained portable evidence must stay bound to its final job");
      return dirname(portable.destinationPath) === directory ? portable : null;
    };

    const token = service.grant();
    const batchRequest: Prompt3DBatchRequest = {
      name: "Deterministic approval gates",
      items: [
        {
          id: "item-a",
          name: "Item A",
          spec,
          shapeRefinement: "make the roof wider while preserving the complete lantern",
          texturePrompts: ["weathered blue stone with gold details", "add pale edge wear while preserving the blue stone"],
          animationRevisions: [
            { prompt: "turn slowly once", mode: "replace" },
            { prompt: "bob gently once", mode: "append" },
          ],
        },
        {
          id: "item-b",
          name: "Item B",
          spec: { ...spec, prompt: "an original isolated carved stone arch", seed: 84 },
          shapeRefinement: "make the arch taller while preserving its complete silhouette",
          texturePrompts: ["warm sandstone with shallow engraved details", "add darker mineral seams while preserving the sandstone"],
          animationRevisions: [
            { prompt: "tilt forward and return", mode: "append" },
            { prompt: "rotate once while preserving the tilt clip", mode: "replace" },
          ],
        },
      ],
    };
    assert.equal(PROMPT3D_MIN_BATCH_FINISH_PROMPTS, 2, "batch finishing stages must retain an initial prompt plus a refinement");
    await assert.rejects(
      service.batchStart(token, {
        ...batchRequest,
        name: "Missing texture refinement",
        items: [{ ...batchRequest.items[0], texturePrompts: [batchRequest.items[0].texturePrompts[0]] }],
      }),
      /at least two texture prompts/i,
      "batch admission must reject an item without a texture refinement prompt",
    );
    await assert.rejects(
      service.batchStart(token, {
        ...batchRequest,
        name: "Missing animation refinement",
        items: [{ ...batchRequest.items[0], animationRevisions: [batchRequest.items[0].animationRevisions[0]] }],
      }),
      /at least two animation revisions/i,
      "batch admission must reject an item without an animation refinement prompt",
    );
    assert.equal(generationJobs.length, 0, "invalid batch prompt counts must fail before any generation dispatch");
    const originalWriteJsonAtomic = internals.writeJsonAtomic.bind(service);
    let reportBatchAdmission!: () => void;
    let releaseBatchAdmission!: () => void;
    const batchAdmissionReached = new Promise<void>((resolve) => { reportBatchAdmission = resolve; });
    const batchAdmissionReleased = new Promise<void>((resolve) => { releaseBatchAdmission = resolve; });
    let heldBatchRequest = false;
    internals.writeJsonAtomic = async (path, value) => {
      if (!heldBatchRequest && path.endsWith("request.json")) {
        heldBatchRequest = true;
        reportBatchAdmission();
        await batchAdmissionReleased;
      }
      await originalWriteJsonAtomic(path, value);
    };
    const batchPromise = service.batchStart(token, batchRequest);
    await batchAdmissionReached;
    try {
      await assert.rejects(
        realStart(token, {
          spec,
          consent: { providerId: "hunyuan3d-2", confirmed: false },
        }),
        /batch is being admitted/i,
        "a manual generation must not enter while batch admission is awaiting retained writes",
      );
    } finally {
      releaseBatchAdmission();
      internals.writeJsonAtomic = originalWriteJsonAtomic;
    }
    const batch = await batchPromise;

    const settled = () => !internals.batchesAdvancing.has(batch.id) && !internals.batchesAdvancePending.has(batch.id);
    const current = () => service.batchStatus(token, batch.id)!;
    const waitFor = async (predicate: (value: Prompt3DBatchStatus) => boolean, label: string) => {
      await waitUntil(() => predicate(current()) && settled(), label);
    };
    const wake = async (jobId: string, predicate: (value: Prompt3DBatchStatus) => boolean, label: string) => {
      internals.queueBatchAdvanceForJob(jobId);
      await waitFor(predicate, label);
    };
    let unrelatedSequence = 0;
    const assertUnrelatedWakeDoesNotAdvance = async (label: string) => {
      const before = statusView(current());
      const beforeStarts = generationJobs.length;
      const beforeFinishes = finishingJobs.length;
      const unrelatedId = `unrelated-approved-job-${++unrelatedSequence}`;
      internals.batchJobLinks.set(unrelatedId, batch.id);
      internals.queueBatchAdvanceForJob(unrelatedId);
      await waitUntil(settled, `${label} unrelated wake to settle`);
      internals.batchJobLinks.delete(unrelatedId);
      assert.deepEqual(statusView(current()), before, `${label} must ignore approval activity from a non-current job`);
      assert.equal(generationJobs.length, beforeStarts, `${label} must not start another generation for an unrelated approval`);
      assert.equal(finishingJobs.length, beforeFinishes, `${label} must not start finishing for an unrelated approval`);
      assert.equal(current().items[1].state, "queued", `${label} must not advance the next batch item`);
    };

    await waitFor((value) => value.items[0].state === "concept" && Boolean(value.items[0].currentJobId), "base concept fixture to start");
    const baseJob = generationJobs[0];
    await wake(baseJob.id, (value) => value.state === "awaiting-approval" && value.items[0].currentJobId === baseJob.id, "base concept approval gate");
    await assertUnrelatedWakeDoesNotAdvance("base concept gate");
    await assert.rejects(
      realStart(token, {
        spec: { ...spec, prompt: "an unrelated manual generation while the batch is paused" },
        consent: { providerId: "hunyuan3d-2", confirmed: false },
      }),
      /serial Prompt-to-3D batch is active/i,
      "a manual generation must not enter while a batch is paused for approval",
    );
    await assert.rejects(
      realFinishStart(token, {
        source: { kind: "generation", jobId: baseJob.id, variantIndex: 0 },
        operation: "texture",
        instruction: "an unrelated manual texture request",
      }),
      /serial Prompt-to-3D batch is active/i,
      "a manual finishing job must not enter while a batch is paused for approval",
    );
    Object.assign(baseJob, {
      state: "failed",
      stage: "concept-review",
      error: { code: "CONCEPT_SEMANTIC_REJECTED", message: "Explicit classified concept rejection fixture.", retryable: true },
    });
    await wake(baseJob.id, (value) => value.state === "awaiting-approval" && value.items[0].currentJobId === baseJob.id, "classified concept rejection gate");
    assert.match(current().items[0].message, /explicitly rejected.*edit the brief or regenerate/i, "a classified rejection must pause the serial batch on the exact concept rather than fail or skip the item");
    assert.equal(current().items[1].state, "queued", "classified concept rejection cannot advance a later serial item");
    Object.assign(baseJob, {
      state: "awaiting-concept-approval",
      stage: "awaiting-concept-approval",
      error: undefined,
    });
    await wake(baseJob.id, (value) => value.state === "awaiting-approval" && value.items[0].currentJobId === baseJob.id, "restored concept approval gate");
    await assert.rejects(
      realApproveConcept(token, {
        jobId: "unrelated-concept-job",
        binding: {} as Prompt3DApproveConceptRequest["binding"],
      }),
      /serial Prompt-to-3D batch is active/i,
      "an unrelated concept approval must not resume geometry during an active batch",
    );
    await assert.rejects(
      realApproveConcept(token, {
        jobId: baseJob.id,
        binding: {} as Prompt3DApproveConceptRequest["binding"],
      }),
      /not awaiting concept approval/i,
      "the matching batch concept must pass dispatch isolation and reach its own retained-binding validation",
    );
    const currentResolver = internals.resolveWorkflowSource;
    const finishingCountBeforeCapCheck = internals.finishJobs.size;
    internals.resolveWorkflowSource = async () => ({
      lineage: { revisions: Array.from({ length: 32 }, () => ({})) },
    });
    try {
      await assert.rejects(
        realFinishStart(token, {
          source: { kind: "generation", jobId: baseJob.id, variantIndex: 0 },
          operation: "texture",
          instruction: "must reject before creating a thirty-third retained revision",
          batchId: batch.id,
          batchItemId: "item-a",
        }, batch.id),
        /maximum 32 finishing revisions/i,
        "the service must reject a thirty-third revision before creating a job or invoking a provider",
      );
    } finally {
      internals.resolveWorkflowSource = currentResolver;
    }
    assert.equal(internals.finishJobs.size, finishingCountBeforeCapCheck, "revision-cap rejection must not create a finishing job");

    Object.assign(baseJob, { state: "running", stage: "geometry", progress: 60, message: "Approved concept resumed geometry." });
    await wake(baseJob.id, (value) => value.state === "running" && value.items[0].state === "geometry", "base concept approval resume");
    const baseVariant = completeGeneration(baseJob);
    await wake(baseJob.id, (value) => value.state === "awaiting-approval" && value.items[0].progress === 24, "base geometry approval gate");
    await assertUnrelatedWakeDoesNotAdvance("base geometry gate");

    baseVariant.visualApproval = approval(baseJob.id, baseJob.assetId ?? baseJob.id, "geometry", baseVariant.glbPath);
    await wake(baseJob.id, (value) => value.items[0].state === "concept" && value.items[0].currentJobId !== baseJob.id, "refined concept fixture to start");
    const shapeJob = generationJobs[1];
    await wake(shapeJob.id, (value) => value.state === "awaiting-approval" && value.items[0].currentJobId === shapeJob.id, "refined concept approval gate");

    Object.assign(shapeJob, { state: "running", stage: "geometry", progress: 60, message: "Approved refined concept resumed geometry." });
    await wake(shapeJob.id, (value) => value.state === "running" && value.items[0].state === "geometry", "refined concept approval resume");
    const shapeVariant = completeGeneration(shapeJob);
    await wake(shapeJob.id, (value) => value.state === "awaiting-approval" && value.items[0].progress === 49, "refined geometry approval gate");

    shapeVariant.visualApproval = approval(shapeJob.id, shapeJob.assetId ?? shapeJob.id, "geometry", shapeVariant.glbPath);
    await wake(shapeJob.id, (value) => value.items[0].state === "texture" && value.items[0].currentJobId?.startsWith("fixture-texture-") === true, "texture fixture to start");
    const firstTexture = finishingJobs[0];
    await wake(firstTexture.id, (value) => value.state === "awaiting-approval" && value.items[0].currentJobId === firstTexture.id, "first texture approval gate");
    await assertUnrelatedWakeDoesNotAdvance("first texture gate");

    firstTexture.visualApproval = approval(firstTexture.id, firstTexture.assetId, "texture", firstTexture.assetPath!);
    await wake(firstTexture.id, (value) => value.items[0].state === "texture" && value.items[0].currentJobId !== firstTexture.id, "second texture fixture to start");
    const secondTexture = finishingJobs[1];
    await wake(secondTexture.id, (value) => value.state === "awaiting-approval" && value.items[0].currentJobId === secondTexture.id, "second texture approval gate");
    await assertUnrelatedWakeDoesNotAdvance("second texture gate");

    secondTexture.visualApproval = approval(secondTexture.id, secondTexture.assetId, "texture", secondTexture.assetPath!);
    await wake(secondTexture.id, (value) => value.items[0].state === "animation" && value.items[0].currentJobId?.startsWith("fixture-animation-") === true, "first animation fixture to start");
    const firstAnimation = finishingJobs[2];
    await wake(firstAnimation.id, (value) => value.state === "awaiting-approval" && value.items[0].currentJobId === firstAnimation.id, "animation approval gate");
    await assertUnrelatedWakeDoesNotAdvance("animation gate");

    firstAnimation.visualApproval = approval(firstAnimation.id, firstAnimation.assetId, "animation", firstAnimation.assetPath!);
    await wake(firstAnimation.id, (value) => value.items[0].state === "animation" && value.items[0].currentJobId !== firstAnimation.id, "matching animation approval to resume");
    const finalAnimation = finishingJobs[3];
    await wake(finalAnimation.id, (value) => value.state === "awaiting-approval" && value.items[0].currentJobId === finalAnimation.id, "final animation approval gate");

    await assert.rejects(
      saveWorkflowAsset(root, finalAnimation),
      /hash-bound complete workflow lineage/i,
      "the real save path must reject a final revision without persisted approval lineage",
    );
    assert.equal(current().items[0].state, "awaiting-approval", "the unapproved final animation must remain paused");
    assert.equal(current().items[1].state, "queued", "the next item must remain queued behind the current approval gate");

    finalAnimation.visualApproval = approval(finalAnimation.id, finalAnimation.assetId, "animation", finalAnimation.assetPath!);
    await wake(finalAnimation.id, (value) => value.items[0].state === "complete" && value.items[1].state === "concept", "first item save and second item transition");
    assert.equal(savedJobs[0], finalAnimation.id, "the first item must save its exact approved final animation");
    assert.equal(current().items[0].savedAsset?.sourceJobId, finalAnimation.id, "the first durable managed record must be retained in batch status");

    const secondBase = generationJobs[2];
    await wake(secondBase.id, (value) => value.state === "awaiting-approval" && value.items[1].currentJobId === secondBase.id, "second base concept approval gate");
    Object.assign(secondBase, { state: "running", stage: "geometry", progress: 60, message: "Second approved concept resumed geometry." });
    await wake(secondBase.id, (value) => value.state === "running" && value.items[1].state === "geometry", "second base geometry resume");
    const secondBaseVariant = completeGeneration(secondBase);
    await wake(secondBase.id, (value) => value.state === "awaiting-approval" && value.items[1].progress === 24, "second base geometry approval gate");
    secondBaseVariant.visualApproval = approval(secondBase.id, secondBase.assetId ?? secondBase.id, "geometry", secondBaseVariant.glbPath);
    await wake(secondBase.id, (value) => value.items[1].state === "concept" && value.items[1].currentJobId !== secondBase.id, "second refined concept fixture to start");

    const secondShape = generationJobs[3];
    await wake(secondShape.id, (value) => value.state === "awaiting-approval" && value.items[1].currentJobId === secondShape.id, "second refined concept approval gate");
    Object.assign(secondShape, { state: "running", stage: "geometry", progress: 60, message: "Second approved refined concept resumed geometry." });
    await wake(secondShape.id, (value) => value.state === "running" && value.items[1].state === "geometry", "second refined geometry resume");
    const secondShapeVariant = completeGeneration(secondShape);
    await wake(secondShape.id, (value) => value.state === "awaiting-approval" && value.items[1].progress === 49, "second refined geometry approval gate");
    secondShapeVariant.visualApproval = approval(secondShape.id, secondShape.assetId ?? secondShape.id, "geometry", secondShapeVariant.glbPath);
    await wake(secondShape.id, (value) => value.items[1].state === "texture", "second item first texture fixture to start");

    const secondFirstTexture = finishingJobs[4];
    await wake(secondFirstTexture.id, (value) => value.state === "awaiting-approval" && value.items[1].currentJobId === secondFirstTexture.id, "second item first texture approval gate");
    secondFirstTexture.visualApproval = approval(secondFirstTexture.id, secondFirstTexture.assetId, "texture", secondFirstTexture.assetPath!);
    await wake(secondFirstTexture.id, (value) => value.items[1].state === "texture" && value.items[1].currentJobId !== secondFirstTexture.id, "second item second texture fixture to start");
    const secondSecondTexture = finishingJobs[5];
    await wake(secondSecondTexture.id, (value) => value.state === "awaiting-approval" && value.items[1].currentJobId === secondSecondTexture.id, "second item second texture approval gate");
    secondSecondTexture.visualApproval = approval(secondSecondTexture.id, secondSecondTexture.assetId, "texture", secondSecondTexture.assetPath!);
    await wake(secondSecondTexture.id, (value) => value.items[1].state === "animation", "second item first animation fixture to start");

    const secondFirstAnimation = finishingJobs[6];
    await wake(secondFirstAnimation.id, (value) => value.state === "awaiting-approval" && value.items[1].currentJobId === secondFirstAnimation.id, "second item first animation approval gate");
    secondFirstAnimation.visualApproval = approval(secondFirstAnimation.id, secondFirstAnimation.assetId, "animation", secondFirstAnimation.assetPath!);
    await wake(secondFirstAnimation.id, (value) => value.items[1].state === "animation" && value.items[1].currentJobId !== secondFirstAnimation.id, "second item second animation fixture to start");
    const secondFinalAnimation = finishingJobs[7];
    await wake(secondFinalAnimation.id, (value) => value.state === "awaiting-approval" && value.items[1].currentJobId === secondFinalAnimation.id, "second item final animation approval gate");
    secondFinalAnimation.visualApproval = approval(secondFinalAnimation.id, secondFinalAnimation.assetId, "animation", secondFinalAnimation.assetPath!);
    await wake(secondFinalAnimation.id, (value) => value.state === "complete", "complete two-item serial batch");

    const completed = current();
    assert.equal(completed.items.every((item) => item.state === "complete"), true, "every serial item must complete");
    assert.deepEqual(savedJobs, [finalAnimation.id, secondFinalAnimation.id], "both exact final animation revisions must be saved");
    assert.equal(routedRoots.length, 2, "each managed save must refresh Dev Portal workspace routing");
    assert.equal(new Set(routedRoots).size, 1, "all managed batch assets must route to one durable library root");
    assert.equal(completed.localAssetsRoot, routedRoots[0], "batch status must retain the routed managed library root");
    assert.equal(completed.items.every((item) => Boolean(item.savedAsset?.savedPath && item.savedAsset.sha256 && item.savedAsset.lineagePath)), true, "every completed item must expose durable save identity");
    assert.deepEqual(animationModes, ["replace", "append", "append", "replace"], "each animation revision must dispatch its own append/replace mode in item order");
    for (const state of ["complete", "failed", "cancelled"] as const) {
      assert.equal(shouldRehydratePrompt3DBatch({ ...completed, state }, completed.id), false, `a locally dismissed ${state} batch must stay dismissed during status rehydration`);
    }
    for (const state of ["running", "awaiting-approval"] as const) {
      assert.equal(shouldRehydratePrompt3DBatch({ ...completed, state }, completed.id), true, `a restarted ${state} batch with the same ID must be restored`);
    }
    assert.equal(shouldRehydratePrompt3DBatch(completed, "different-batch-id"), true, "a different retained terminal batch must remain discoverable");

    const exportDirectory = join(root, "portable-exports");
    await mkdir(exportDirectory, { recursive: true });
    const collisionPath = join(exportDirectory, completed.items[0].savedAsset!.name);
    await writeFile(collisionPath, "existing file must not be overwritten");
    const exported = await service.batchExport(token, batch.id, exportDirectory);
    assert.equal(exported.items.length, 2, "bulk export must include every completed batch item");
    assert.notEqual(exported.items[0].export.destinationPath, collisionPath, "bulk export must reserve a collision-safe filename");
    assert.equal((await readFile(collisionPath, "utf8")), "existing file must not be overwritten", "bulk export must preserve an existing collision");
    for (const exportedItem of exported.items) {
      const batchItem = current().items.find((item) => item.id === exportedItem.itemId)!;
      const inspection = await inspectWorkflowGlb(exportedItem.export.destinationPath);
      assert.equal(inspection.sha256, batchItem.savedAsset?.sha256, "portable bytes must match the durable managed asset hash");
      assert.equal(exportedItem.export.sha256, inspection.sha256, "bulk export result must report the verified destination hash");
      assert.equal(batchItem.portableExport?.destinationPath, exportedItem.export.destinationPath, "verified export evidence must persist in batch status");
    }
    const retainedPaths = exported.items.map((item) => item.export.destinationPath);
    const filesBeforeIdempotentExport = await readdir(exportDirectory);
    const repeatedExport = await service.batchExport(token, batch.id, exportDirectory);
    assert.deepEqual(repeatedExport.items.map((item) => item.export.destinationPath), retainedPaths, "repeating bulk export must reuse the exact reopened portable set");
    assert.deepEqual(await readdir(exportDirectory), filesBeforeIdempotentExport, "idempotent bulk export must not create extra files");

    const rollbackDirectory = join(root, "portable-exports-rollback");
    await mkdir(rollbackDirectory, { recursive: true });
    const retainedPortableWriter = internals.retainBatchPortableExport;
    let rollbackSequence = 0;
    internals.retainBatchPortableExport = async (...args) => {
      rollbackSequence += 1;
      if (rollbackSequence === 2) throw new Error("fixture record failure");
      return retainedPortableWriter(...args);
    };
    await assert.rejects(
      service.batchExport(token, batch.id, rollbackDirectory),
      /fixture record failure/,
      "bulk export must surface a durable-record failure",
    );
    internals.retainBatchPortableExport = retainedPortableWriter;
    assert.deepEqual(await readdir(rollbackDirectory), [], "failed bulk export must roll back every newly staged portable file");
    assert.deepEqual(current().items.map((item) => item.portableExport?.destinationPath), retainedPaths, "failed re-export must preserve the last committed portable set");

    const tamperedExportDirectory = join(root, "portable-exports-after-tamper");
    await mkdir(tamperedExportDirectory, { recursive: true });
    await writeFile(completed.items[0].savedAsset!.savedPath, "tampered managed bytes");
    await assert.rejects(
      service.batchExport(token, batch.id, tamperedExportDirectory),
      /GLB|glTF|hash verification|retained identity/i,
      "bulk export must fail closed when a durable managed asset no longer matches its retained hash",
    );

    const resilienceBatch = await service.batchStart(token, { ...batchRequest, name: "Cancellation and restart recovery" });
    const resilienceCurrent = () => service.batchStatus(token, resilienceBatch.id)!;
    const resilienceSettled = () => !internals.batchesAdvancing.has(resilienceBatch.id) && !internals.batchesAdvancePending.has(resilienceBatch.id);
    await waitUntil(
      () => resilienceCurrent().items[0].state === "concept" && Boolean(resilienceCurrent().items[0].currentJobId) && resilienceSettled(),
      "resilience batch base concept",
    );
    const cancelledGeneration = generationJobs.at(-1)!;
    Object.assign(cancelledGeneration, { state: "running", stage: "geometry", message: "Provider fixture running." });
    internals.activeSidecarJobs.set(cancelledGeneration.id, "fixture-provider-job");
    const providerCancellations: string[] = [];
    const realSidecarRequest = internals.sidecarRequest.bind(service);
    internals.sidecarRequest = async (path) => { providerCancellations.push(path); return {}; };
    const writeBeforeCancellationRace = internals.writeJsonAtomic.bind(service);
    let reportAdvanceManifestWrite!: () => void;
    let releaseAdvanceManifestWrite!: () => void;
    const advanceManifestWriteReached = new Promise<void>((resolve) => { reportAdvanceManifestWrite = resolve; });
    const advanceManifestWriteReleased = new Promise<void>((resolve) => { releaseAdvanceManifestWrite = resolve; });
    let heldAdvanceManifestWrite = false;
    internals.writeJsonAtomic = async (path, value) => {
      if (!heldAdvanceManifestWrite && path === resilienceBatch.manifestPath) {
        heldAdvanceManifestWrite = true;
        reportAdvanceManifestWrite();
        await advanceManifestWriteReleased;
      }
      await writeBeforeCancellationRace(path, value);
    };
    internals.queueBatchAdvance(resilienceBatch.id);
    await advanceManifestWriteReached;
    let cancelled: Prompt3DBatchStatus;
    try {
      const cancelPromise = service.batchCancel(token, resilienceBatch.id);
      releaseAdvanceManifestWrite();
      cancelled = await cancelPromise;
    } finally {
      releaseAdvanceManifestWrite();
      internals.writeJsonAtomic = writeBeforeCancellationRace;
      internals.sidecarRequest = realSidecarRequest;
    }
    assert.equal(cancelled.state, "cancelled", "batch cancellation must be terminal at the batch level");
    assert.equal(cancelled.items[0].state, "cancelled", "batch cancellation must stop the current item");
    assert.equal(cancelledGeneration.state, "cancelled", "batch cancellation must cancel an active generation job");
    assert.deepEqual(providerCancellations, ["/jobs/fixture-provider-job/cancel"], "batch cancellation must forward a safe provider-side cancellation when a sidecar job is active");
    const cancelledReloadService = new Prompt3DService({ root, appRoot: join(__dirname, ".."), offlineLocalTest: true });
    const cancelledReloadToken = cancelledReloadService.grant();
    try {
      const cancelledReload = cancelledReloadService.batchStatus(cancelledReloadToken, resilienceBatch.id)!;
      assert.equal(cancelledReload.state, "cancelled", "restart reload must retain cancellation after a concurrent advancement manifest write");
      assert.equal(cancelledReload.items[0].state, "cancelled", "the concurrent advancement snapshot must not overwrite the cancelled item state");
    } finally {
      cancelledReloadService.shutdown();
    }

    const generationCountBeforeRetry = generationJobs.length;
    await service.batchRetry(token, resilienceBatch.id, "item-a");
    await waitUntil(
      () => generationJobs.length === generationCountBeforeRetry + 1
        && resilienceCurrent().items[0].currentJobId === generationJobs.at(-1)?.id
        && ["concept", "awaiting-approval"].includes(resilienceCurrent().items[0].state)
        && resilienceSettled(),
      "cancelled batch item retry",
    );
    const retryGeneration = generationJobs.at(-1)!;
    assert.equal(retryGeneration.spec.seed, batchRequest.items[0].spec.seed, "retry must reuse the retained deterministic item seed");
    assert.deepEqual(resilienceCurrent().request.items[0].animationRevisions, batchRequest.items[0].animationRevisions, "retry must preserve per-revision animation modes");

    const firstRuntime = internals.batchRuntime.get(resilienceBatch.id)!.get("item-a")!;
    Object.assign(firstRuntime, {
      baseComplete: true,
      shapeComplete: true,
      nextTexture: batchRequest.items[0].texturePrompts.length,
      nextAnimation: batchRequest.items[0].animationRevisions.length,
      currentSource: completed.items[0].finalSource,
    });
    delete firstRuntime.currentKind;
    delete firstRuntime.currentJobId;
    internals.batchJobLinks.delete(retryGeneration.id);
    Object.assign(retryGeneration, { state: "cancelled", stage: "cancelled" });
    Object.assign(resilienceCurrent().items[0], {
      ...completed.items[0],
      id: "item-a",
      name: "Item A",
    });
    await internals.publishBatch(resilienceCurrent());
    internals.queueBatchAdvance(resilienceBatch.id);
    await waitUntil(
      () => resilienceCurrent().items[1].state === "concept" && Boolean(resilienceCurrent().items[1].currentJobId) && resilienceSettled(),
      "second resilience item before restart",
    );
    const interruptedGeneration = generationJobs.at(-1)!;
    Object.assign(interruptedGeneration, { state: "running", stage: "geometry", message: "Interrupted provider fixture." });
    await internals.publishBatch(resilienceCurrent());
    service.shutdown();

    const recoveredService = new Prompt3DService({ root, appRoot: join(__dirname, ".."), offlineLocalTest: true });
    const recoveredInternals = recoveredService as unknown as ServiceInternals;
    const recoveredMutable = recoveredService as unknown as {
      start(token: string, request: Prompt3DStartRequest): Promise<Prompt3DJobStatus>;
    };
    let recoveredDispatch: Prompt3DStartRequest | undefined;
    recoveredMutable.start = async (_token, request) => {
      recoveredDispatch = request;
      const now = new Date().toISOString();
      const job: Prompt3DJobStatus = {
        id: "fixture-recovered-generation",
        assetId: "fixture-recovered-asset",
        state: "awaiting-concept-approval",
        stage: "awaiting-concept-approval",
        progress: 35,
        providerId: "hunyuan3d-2",
        spec: request.spec,
        message: "Recovered deterministic concept fixture awaits approval.",
        outputDirectory: join(root, "jobs", "fixture-recovered-generation"),
        variants: [],
        createdAt: now,
        updatedAt: now,
      };
      recoveredInternals.jobs.set(job.id, job);
      return job;
    };
    const recoveredToken = recoveredService.grant();
    try {
      const recovered = recoveredService.batchStatus(recoveredToken, resilienceBatch.id)!;
      assert.equal(recovered.state, "failed", "a running manifest must restore as explicitly retryable, never auto-run provider work");
      assert.equal(recovered.items[0].state, "complete", "restart recovery must preserve a previously completed approved item");
      assert.equal(recovered.items[0].savedAsset?.sourceJobId, completed.items[0].savedAsset?.sourceJobId, "restart recovery must preserve the completed item's durable library identity");
      assert.equal(recovered.items[1].state, "failed", "only the interrupted current item must fail on restore");
      assert.equal(recoveredService.batchStatus(recoveredToken)?.id, resilienceBatch.id, "status without an ID must restore the latest retained manifest");
      await assert.rejects(
        recoveredService.batchRetry(recoveredToken, resilienceBatch.id, "item-a"),
        /current incomplete batch item/i,
        "retry must reject a completed or non-current item binding",
      );
      await recoveredService.batchRetry(recoveredToken, resilienceBatch.id, "item-b");
      await waitUntil(
        () => recoveredDispatch !== undefined && recoveredService.batchStatus(recoveredToken, resilienceBatch.id)!.items[1].state === "concept"
          && !recoveredInternals.batchesAdvancing.has(resilienceBatch.id),
        "recovered current item deterministic retry",
      );
      assert.equal(recoveredDispatch?.spec.seed, batchRequest.items[1].spec.seed, "restart retry must dispatch the retained current item with its original seed");
      assert.equal(recoveredService.batchStatus(recoveredToken, resilienceBatch.id)!.items[0].state, "complete", "retry after restart must not rewind a completed item");
    } finally {
      recoveredService.shutdown();
    }

    process.stdout.write("Prompt-to-3D batch covered exact approval gates, per-revision animation modes, provider-aware cancellation, deterministic retry, restart recovery, durable saves and verified bulk export.\n");
  } finally {
    service.shutdown();
    await rm(root, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
