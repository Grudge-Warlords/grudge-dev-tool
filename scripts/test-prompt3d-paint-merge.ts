import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { mergeHunyuanPaintResult } from "../src/main/prompt3d/hunyuanPaintMerge";
import { inspectWorkflowGlb, validateFinishedAsset } from "../src/main/prompt3d/workflow";

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function io(): NodeIO {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS);
}

async function writeSource(path: string): Promise<void> {
  const document = new Document();
  const buffer = document.createBuffer("source");
  const positions = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    0, 0, 0, 0, 1, 0, 0, 0, 1,
    0, 0, 0, 0, 0, 1, 1, 0, 0,
    1, 0, 0, 0, 0, 1, 0, 1, 0,
  ]);
  const primitive = document.createPrimitive().setAttribute("POSITION", document.createAccessor().setType("VEC3").setArray(positions).setBuffer(buffer));
  const mesh = document.createMesh("source-mesh").addPrimitive(primitive);
  const child = document.createNode("source-node").setMesh(mesh);
  const root = document.createNode("GrudgeAssetRoot").addChild(child);
  document.createScene().addChild(root);
  await io().write(path, document);
}

async function writePainted(path: string, changed = false, collapsed = false): Promise<void> {
  const document = new Document();
  const buffer = document.createBuffer("painted");
  const world = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0],
    [0, 0, 0], [0, 1, 0], [0, 0, 1],
    [0, 0, 0], [0, 0, 1], [1, 0, 0],
    [1, 0, 0], [0, 0, 1], [0, 1, 0],
  ];
  const translation = [0.25, -0.5, 0.75];
  const local = new Float32Array(world.flatMap((point, index) => {
    const paintedPoint = collapsed && index === 1 ? world[0] : point;
    return [
      paintedPoint[0] - translation[0] + (changed && index === 1 ? 0.001 : 4e-7),
      paintedPoint[1] - translation[1],
      paintedPoint[2] - translation[2],
    ];
  }));
  const uvs = new Float32Array(world.flatMap((_point, index) => [index % 3 === 1 ? 1 : 0, index % 3 === 2 ? 1 : 0]));
  const indices = new Uint16Array([2, 1, 0, 5, 4, 3, 8, 7, 6, 11, 10, 9]);
  const texture = document.createTexture("hunyuan-generated").setImage(PNG_1X1).setMimeType("image/png");
  const material = document.createMaterial("Hunyuan Paint").setBaseColorTexture(texture).setRoughnessFactor(0.8);
  const primitive = document.createPrimitive()
    .setAttribute("POSITION", document.createAccessor().setType("VEC3").setArray(local).setBuffer(buffer))
    .setAttribute("TEXCOORD_0", document.createAccessor().setType("VEC2").setArray(uvs).setBuffer(buffer))
    .setIndices(document.createAccessor().setType("SCALAR").setArray(indices).setBuffer(buffer))
    .setMaterial(material);
  const mesh = document.createMesh("painted-mesh").addPrimitive(primitive);
  document.createScene().addChild(document.createNode("painted-node").setMesh(mesh).setTranslation(translation));
  await io().write(path, document);
}

async function writeNearCoincidentTriangle(path: string, painted: boolean): Promise<void> {
  const document = new Document();
  const buffer = document.createBuffer(painted ? "painted-near" : "source-near");
  const positions = new Float32Array(painted
    ? [4e-7, 0, 0, 4e-7, 0, 0, 0, 1, 0]
    : [0, 0, 0, 1e-6, 0, 0, 0, 1, 0]);
  const primitive = document.createPrimitive()
    .setAttribute("POSITION", document.createAccessor().setType("VEC3").setArray(positions).setBuffer(buffer));
  if (painted) {
    const texture = document.createTexture("hunyuan-generated-near").setImage(PNG_1X1).setMimeType("image/png");
    const material = document.createMaterial("Hunyuan Paint near").setBaseColorTexture(texture);
    primitive
      .setAttribute("TEXCOORD_0", document.createAccessor().setType("VEC2").setArray(new Float32Array([0, 0, 1, 0, 0, 1])).setBuffer(buffer))
      .setMaterial(material);
  }
  const mesh = document.createMesh(painted ? "painted-near-mesh" : "source-near-mesh").addPrimitive(primitive);
  document.createScene().addChild(document.createNode(painted ? "painted-near-node" : "source-near-node").setMesh(mesh));
  await io().write(path, document);
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "prompt3d-paint-merge-"));
  try {
    const source = join(root, "source.glb");
    const painted = join(root, "painted.glb");
    const changed = join(root, "changed.glb");
    const collapsed = join(root, "collapsed.glb");
    const output = join(root, "output.glb");
    await writeSource(source);
    await writePainted(painted);
    await writePainted(changed, true);
    await writePainted(collapsed, false, true);
    const report = await mergeHunyuanPaintResult(source, painted, output);
    assert.equal(report.trianglesMatched, 4);
    assert.ok(report.maximumSurfaceDeviationMeters > 0 && report.maximumSurfaceDeviationMeters <= report.surfaceToleranceMeters);
    const sourceInspection = await inspectWorkflowGlb(source);
    const outputInspection = await inspectWorkflowGlb(output);
    assert.equal(outputInspection.geometryHash, sourceInspection.geometryHash, "paint transfer must retain the approved geometry hash");
    assert.equal(outputInspection.textures, 1);
    const validation = await validateFinishedAsset(source, output, "texture");
    assert.equal(validation.sourceGeometryPreserved, true);
    assert.equal(validation.textureChanged, true);
    await assert.rejects(mergeHunyuanPaintResult(source, changed, join(root, "rejected.glb")), /changed the approved surface/i);
    await assert.rejects(mergeHunyuanPaintResult(source, collapsed, join(root, "collapsed-rejected.glb")), /degenerate or collapsed triangle/i);

    const nearSource = join(root, "near-source.glb");
    const nearPainted = join(root, "near-painted.glb");
    const nearOutput = join(root, "near-output.glb");
    await writeNearCoincidentTriangle(nearSource, false);
    await writeNearCoincidentTriangle(nearPainted, true);
    const nearReport = await mergeHunyuanPaintResult(nearSource, nearPainted, nearOutput);
    assert.equal(nearReport.trianglesMatched, 1, "paint quantization inside the declared tolerance must retain a provable source triangle");
    assert.equal(
      (await inspectWorkflowGlb(nearOutput)).geometryHash,
      (await inspectWorkflowGlb(nearSource)).geometryHash,
      "quantization recovery must still preserve the exact source geometry hash",
    );
    console.log("prompt3d Hunyuan Paint surface-retention tests passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void main();
