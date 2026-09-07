import assert from "node:assert/strict";
import * as THREE from "three";
import { finishModel, shouldApplySiblingMaterialRecovery } from "../src/renderer/lib/forge/loaders";

function main() {
  const baseColorMap = new THREE.Texture();
  baseColorMap.name = "authored-base-color";
  baseColorMap.colorSpace = THREE.SRGBColorSpace;
  baseColorMap.flipY = false;
  const normalMap = new THREE.Texture();
  normalMap.name = "authored-normal";
  const roughnessMap = new THREE.Texture();
  roughnessMap.name = "authored-roughness";
  const metalnessMap = new THREE.Texture();
  metalnessMap.name = "authored-metalness";
  const material = new THREE.MeshPhysicalMaterial({
    name: "painted-steel",
    color: 0x5a321c,
    map: baseColorMap,
    normalMap,
    roughnessMap,
    metalnessMap,
    metalness: 0.93,
    roughness: 0.08,
    clearcoat: 0.71,
    clearcoatRoughness: 0.13,
    emissive: 0x120904,
    emissiveIntensity: 0.42,
  });
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.Mesh(geometry, material);
  const root = new THREE.Group();
  root.add(mesh);
  const clip = new THREE.AnimationClip("authored-swing", 1.25, []);
  const before = {
    color: material.color.getHex(),
    emissive: material.emissive.getHex(),
    emissiveIntensity: material.emissiveIntensity,
    metalness: material.metalness,
    roughness: material.roughness,
    clearcoat: material.clearcoat,
    clearcoatRoughness: material.clearcoatRoughness,
    mapColorSpace: baseColorMap.colorSpace,
    mapFlipY: baseColorMap.flipY,
  };

  const loaded = finishModel(root, [clip], null, "glb", {
    toonStyle: true,
    fixDefaultYellow: true,
    whiteWhenMapped: true,
  }, "preserve-authored");

  assert.equal(loaded.materials, undefined, "approval mode must not run the material sanitizer");
  assert.strictEqual(mesh.material, material, "approval mode must retain the authored material object");
  assert.strictEqual(material.map, baseColorMap, "base-color map binding must remain exact");
  assert.strictEqual(material.normalMap, normalMap, "normal-map binding must remain exact");
  assert.strictEqual(material.roughnessMap, roughnessMap, "roughness-map binding must remain exact");
  assert.strictEqual(material.metalnessMap, metalnessMap, "metalness-map binding must remain exact");
  assert.deepEqual({
    color: material.color.getHex(),
    emissive: material.emissive.getHex(),
    emissiveIntensity: material.emissiveIntensity,
    metalness: material.metalness,
    roughness: material.roughness,
    clearcoat: material.clearcoat,
    clearcoatRoughness: material.clearcoatRoughness,
    mapColorSpace: baseColorMap.colorSpace,
    mapFlipY: baseColorMap.flipY,
  }, before, "authored PBR factors, colors and texture orientation must remain byte-semantically unchanged");
  assert.strictEqual(loaded.animations[0], clip, "material preservation must retain decoded animation clips");
  assert.equal(loaded.triangles, 12, "material preservation must retain normal geometry/stat preparation");

  assert.equal(shouldApplySiblingMaterialRecovery(root, {
    diskPath: "E:\\prompt3d\\approved.glb",
    materialPolicy: "preserve-authored",
  }), false, "approval mode must not search for or bind sibling maps");
  assert.equal(shouldApplySiblingMaterialRecovery(root, {
    diskPath: "E:\\prompt3d\\ordinary.glb",
    materialPolicy: "normalize",
  }), true, "ordinary preview mode keeps its existing missing-map recovery");

  geometry.dispose();
  material.dispose();
  baseColorMap.dispose();
  normalMap.dispose();
  roughnessMap.dispose();
  metalnessMap.dispose();
  console.log("Prompt-to-3D authored-material fidelity tests passed.");
}

main();
