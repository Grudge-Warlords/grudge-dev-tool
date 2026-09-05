import assert from "node:assert/strict";
import vm from "node:vm";
import * as THREE from "three";
import { buildProceduralClip } from "../src/renderer/lib/forge/animApply";
import { exportToGlb } from "../src/renderer/lib/forge/converters";
import { measureObjectSi } from "../src/renderer/lib/forge/siMeasure";
import { normalizeForgeExportBytes } from "../src/shared/forgeExportBytes";

class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: null | (() => void) = null;

  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((value) => {
      this.result = value;
      this.onloadend?.();
    });
  }
}

Object.assign(globalThis, { FileReader: NodeFileReader });

async function main() {
  const foreignBytes = vm.runInNewContext("new Uint8Array([7, 8, 9])") as Uint8Array;
  assert.equal(foreignBytes instanceof Uint8Array, false, "fixture must use a foreign Uint8Array realm");
  assert.deepEqual(
    [...(normalizeForgeExportBytes(foreignBytes) ?? [])],
    [7, 8, 9],
    "Forge exports must accept Uint8Array values delivered from another Electron realm",
  );

  const root = new THREE.Group();
  root.name = "asset.glb";
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));

  const morphGeometry = new THREE.BoxGeometry(1, 1, 1);
  morphGeometry.morphTargetsRelative = true;
  const exaggeratedDelta = new Float32Array(morphGeometry.attributes.position.count * 3);
  exaggeratedDelta.fill(2);
  morphGeometry.morphAttributes.position = [new THREE.BufferAttribute(exaggeratedDelta, 3)];
  const morphMesh = new THREE.Mesh(morphGeometry, new THREE.MeshStandardMaterial());
  morphMesh.morphTargetInfluences = [0];
  const morphRoot = new THREE.Group();
  morphRoot.add(morphMesh);
  assert.equal(measureObjectSi(morphRoot).h, 1, "SI display must measure the visible pose, not an inactive morph envelope");

  const clip = buildProceduralClip(root, "float");
  const result = await exportToGlb(root, [clip], "animation-regression");
  const bytes = Buffer.from(result.bytes);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, "export must be GLB");

  let offset = 12;
  let json: any = null;
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    if (type === 0x4e4f534a) {
      json = JSON.parse(bytes.subarray(offset + 8, offset + 8 + length).toString("utf8").replace(/\0+$/, ""));
    }
    offset += 8 + length;
  }

  assert.ok(json, "GLB JSON chunk must exist");
  assert.equal(json.animations?.length, 1, "one animation must be exported");
  assert.equal(json.animations[0].name, "proc:float");
  assert.equal(json.animations[0].channels?.length, 1, "animation channel must not be empty");
  assert.equal(json.animations[0].samplers?.length, 1, "animation sampler must not be empty");
  assert.equal(json.animations[0].channels[0].target.path, "translation");
  console.log("Forge animation export regression passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
