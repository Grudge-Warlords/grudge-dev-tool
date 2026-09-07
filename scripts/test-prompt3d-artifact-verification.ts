import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import type { AssetSpecV1 } from "../src/shared/prompt3d";
import type {
  Prompt3DFinishJobStatus,
  Prompt3DWorkflowRevisionLineage,
  Prompt3DWorkflowRootLineage,
} from "../src/shared/prompt3dWorkflow";
import {
  recordWorkflowExport,
  workflowExportHistory,
} from "../src/main/prompt3d/artifactVerification";
import {
  inspectWorkflowGlb,
  sealPrompt3DWorkflowLineage,
  sha256Bytes,
  stableWorkflowSha256,
} from "../src/main/prompt3d/workflow";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=", "base64");
const ASSET_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ROOT_JOB_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const PARENT_JOB_ID = "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa";
const FINAL_JOB_ID = "11111111-2222-4333-8444-555555555555";
const NOW = "2026-09-03T00:01:02.000Z";

const spec: AssetSpecV1 = {
  version: "1.0.0",
  prompt: "an original Hunyuan-generated animated object",
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

function io() {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS);
}

async function animatedFixture(path: string) {
  const document = new Document();
  const buffer = document.createBuffer("fixture");
  const positions = new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
  const primitive = document.createPrimitive()
    .setAttribute("POSITION", document.createAccessor().setType("VEC3").setArray(positions).setBuffer(buffer))
    .setAttribute("NORMAL", document.createAccessor().setType("VEC3").setArray(normals).setBuffer(buffer))
    .setAttribute("TEXCOORD_0", document.createAccessor().setType("VEC2").setArray(uvs).setBuffer(buffer))
    .setIndices(document.createAccessor().setType("SCALAR").setArray(new Uint16Array([0, 1, 2])).setBuffer(buffer));
  const texture = document.createTexture("Hunyuan Paint fixture").setImage(PNG).setMimeType("image/png");
  primitive.setMaterial(document.createMaterial("Hunyuan Paint fixture").setBaseColorTexture(texture));
  const generated = document.createNode("GeneratedMesh").setMesh(document.createMesh("HunyuanMesh").addPrimitive(primitive));
  const root = document.createNode("GrudgeAssetRoot").addChild(generated);
  document.createScene("scene").addChild(root);
  const times = document.createAccessor().setType("SCALAR").setArray(new Float32Array([0, 1])).setBuffer(buffer);
  const translations = document.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 0.5, 0, 0])).setBuffer(buffer);
  const sampler = document.createAnimationSampler("movement sampler").setInput(times).setOutput(translations).setInterpolation("LINEAR");
  document.createAnimation("Prompted movement")
    .addSampler(sampler)
    .addChannel(document.createAnimationChannel("movement channel").setSampler(sampler).setTargetNode(root).setTargetPath("translation"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, await io().writeBinary(document));
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "grudge-artifact-verification-"));
  try {
    const finalPath = join(root, "workflow-history", FINAL_JOB_ID, "asset.glb");
    const portablePath = join(root, "portable-output.glb");
    await animatedFixture(finalPath);
    await copyFile(finalPath, portablePath);

    const inspection = await inspectWorkflowGlb(finalPath);
    assert.equal(inspection.textures, 1);
    assert.equal(inspection.animations.length, 1);
    const approvalSha256 = stableWorkflowSha256("final animation visual approval");
    const rootLineage = { jobId: ROOT_JOB_ID } as Prompt3DWorkflowRootLineage;
    const revision = { jobId: FINAL_JOB_ID, visualApprovalSha256: approvalSha256 } as Prompt3DWorkflowRevisionLineage;
    const lineage = sealPrompt3DWorkflowLineage({
      version: 1,
      assetId: ASSET_ID,
      generationChain: [rootLineage],
      root: rootLineage,
      revisions: [revision],
      finalJobId: FINAL_JOB_ID,
      finalSha256: inspection.sha256,
      finalGeometryHash: inspection.geometryHash,
    });
    const lineageBytes = Buffer.from(`${JSON.stringify(lineage, null, 2)}\n`, "utf8");
    const lineagePath = join(root, "workflow-history", FINAL_JOB_ID, "lineage.json");
    await writeFile(lineagePath, lineageBytes);
    const lineageSha256 = sha256Bytes(lineageBytes);

    const job: Prompt3DFinishJobStatus = {
      version: 1,
      id: FINAL_JOB_ID,
      assetId: ASSET_ID,
      source: { kind: "finish", jobId: PARENT_JOB_ID },
      sourceAssetPath: finalPath,
      sourceSha256: inspection.sha256,
      sourceGeometryHash: inspection.geometryHash,
      operation: "animation",
      instruction: "move visibly through space",
      seed: 44,
      state: "complete",
      stage: "complete",
      progress: 100,
      message: "complete",
      outputDirectory: dirname(finalPath),
      assetPath: finalPath,
      sha256: inspection.sha256,
      geometryHash: inspection.geometryHash,
      validation: {
        selfContained: true,
        sourceGeometryPreserved: true,
        sourceGeometryHash: inspection.geometryHash,
        outputGeometryHash: inspection.geometryHash,
        embeddedTextures: inspection.textures,
        sourceTextureFingerprint: inspection.textureFingerprint,
        outputTextureFingerprint: inspection.textureFingerprint,
        textureChanged: false,
        outputAnimationFingerprint: inspection.animationFingerprint,
        animations: inspection.animations,
        checks: [],
      },
      visualApprovalSha256: approvalSha256,
      lineage,
      lineagePath,
      lineageSha256,
      provider: "grudge-motion-graph-1",
      baseSpec: spec,
      createdAt: NOW,
      updatedAt: NOW,
    };

    await assert.rejects(
      recordWorkflowExport(root, job, {
        destinationPath: portablePath,
        filename: "portable-output.glb",
        sha256: inspection.sha256,
        byteSize: inspection.byteSize,
      }, NOW),
      /approved base Hunyuan generation followed by at least one prompted refined Hunyuan generation/i,
      "portable export metadata must never be issued for a sealed but incomplete workflow lineage",
    );
    assert.deepEqual(await workflowExportHistory(root), [], "rejected export metadata must not leave a usable receipt");

    console.log("Prompt-to-3D artifact issuance rejects incomplete workflow lineage.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
