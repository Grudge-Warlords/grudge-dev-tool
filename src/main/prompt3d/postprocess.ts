import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AssetSpecV1 } from "../../shared/prompt3d";
import { resolveObjectRules } from "../../shared/prompt3dRules";

export async function postprocessPrompt3DGlb(input: string, output: string, spec: AssetSpecV1): Promise<void> {
  const { NodeIO, PropertyType } = require("@gltf-transform/core");
  const { ALL_EXTENSIONS } = require("@gltf-transform/extensions");
  const { clearNodeTransform, flatten, normals, simplify, weld } = require("@gltf-transform/functions");
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.read(input);
  const initialRoot = document.getRoot();
  if ((initialRoot.listAnimations?.() ?? []).length || (initialRoot.listSkins?.() ?? []).length) {
    throw new Error("Prompt-to-3D game-ready postprocessing does not accept animated or skinned provider output.");
  }
  await document.transform(flatten());
  const root = document.getRoot();
  for (const scene of root.listScenes?.() ?? []) {
    for (const node of scene.listChildren?.() ?? []) {
      const mesh = node.getMesh?.();
      if (!mesh) continue;
      const nodeParents = mesh.listParents?.().filter((parent: any) => parent.propertyType === PropertyType.NODE) ?? [];
      if (nodeParents.length > 1) node.setMesh(mesh.clone());
      clearNodeTransform(node);
    }
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const positions: any[] = [];
  const seenPositions = new Set<unknown>();
  const objectRule = spec.objectRules ? resolveObjectRules(spec) : undefined;
  for (const mesh of root.listMeshes?.() ?? []) {
    for (const primitive of mesh.listPrimitives?.() ?? []) {
      const accessor = primitive.getAttribute?.("POSITION");
      const array = accessor?.getArray?.();
      if (!accessor || !array) continue;
      if (seenPositions.has(accessor)) continue;
      seenPositions.add(accessor);
      // Deliberate user correction only; never infer a hilt from unlabelled geometry.
      if (objectRule?.flipVertical) for (let i = 0; i < array.length; i += 3) { array[i] = -array[i]; array[i + 1] = -array[i + 1]; }
      positions.push({ accessor, array });
      for (let i = 0; i < array.length; i += 3) {
        minX = Math.min(minX, Number(array[i])); maxX = Math.max(maxX, Number(array[i]));
        minY = Math.min(minY, Number(array[i + 1])); maxY = Math.max(maxY, Number(array[i + 1]));
        minZ = Math.min(minZ, Number(array[i + 2])); maxZ = Math.max(maxZ, Number(array[i + 2]));
      }
    }
  }
  if (!positions.length || ![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) throw new Error("Provider output contains no finite POSITION data.");
  const unit = spec.dimensions.unit === "cm" ? 0.01 : 1;
  const target = [spec.dimensions.width * unit, spec.dimensions.height * unit, spec.dimensions.depth * unit];
  const spans = [maxX - minX, maxY - minY, maxZ - minZ];
  if (spans.some((v) => v <= 0)) throw new Error("Provider output has a zero-sized geometry axis.");
  const scales = spec.scaleMode === "exact" ? target.map((v, i) => v / spans[i]) : spans.map(() => target[1] / spans[1]);
  const anchor = objectRule?.anchor ?? { x: 0.5, y: 0, z: 0.5 };
  const centerX = minX + spans[0] * anchor.x, anchorY = minY + spans[1] * anchor.y, centerZ = minZ + spans[2] * anchor.z;
  for (const { accessor, array } of positions) {
    const next = new (array.constructor as any)(array.length);
    for (let i = 0; i < array.length; i += 3) {
      next[i] = (Number(array[i]) - centerX) * scales[0];
      next[i + 1] = (Number(array[i + 1]) - anchorY) * scales[1];
      next[i + 2] = (Number(array[i + 2]) - centerZ) * scales[2];
    }
    accessor.setArray(next);
  }
  for (const mesh of root.listMeshes?.() ?? []) {
    for (const primitive of mesh.listPrimitives?.() ?? []) {
      primitive.setAttribute?.("NORMAL", null);
      primitive.setAttribute?.("TANGENT", null);
      if (!spec.generateTextures) {
        for (const semantic of primitive.listSemantics?.() ?? []) if (semantic !== "POSITION") primitive.setAttribute?.(semantic, null);
      }
    }
  }
  await document.transform(weld({ overwrite: true }));
  const cleanTriangles = () => {
    let triangles = 0;
    for (const mesh of root.listMeshes?.() ?? []) {
      for (const primitive of mesh.listPrimitives?.() ?? []) {
        if ((primitive.getMode?.() ?? 4) !== 4) continue;
        const position = primitive.getAttribute?.("POSITION");
        const positionsArray = position?.getArray?.() as ArrayLike<number> | undefined;
        const indices = primitive.getIndices?.();
        const indexArray = indices?.getArray?.() as ArrayLike<number> | undefined;
        if (!positionsArray || !indices || !indexArray) continue;
        const kept: number[] = [];
        for (let i = 0; i + 2 < indexArray.length; i += 3) {
          const ia = Number(indexArray[i]), ib = Number(indexArray[i + 1]), ic = Number(indexArray[i + 2]);
          const ax = Number(positionsArray[ia * 3]), ay = Number(positionsArray[ia * 3 + 1]), az = Number(positionsArray[ia * 3 + 2]);
          const abx = Number(positionsArray[ib * 3]) - ax, aby = Number(positionsArray[ib * 3 + 1]) - ay, abz = Number(positionsArray[ib * 3 + 2]) - az;
          const acx = Number(positionsArray[ic * 3]) - ax, acy = Number(positionsArray[ic * 3 + 1]) - ay, acz = Number(positionsArray[ic * 3 + 2]) - az;
          const cx = aby * acz - abz * acy, cy = abz * acx - abx * acz, cz = abx * acy - aby * acx;
          if (ia === ib || ib === ic || ia === ic || cx * cx + cy * cy + cz * cz <= 1e-24) continue;
          kept.push(ia, ib, ic);
        }
        const IndexArray = indexArray.constructor as { new(values: ArrayLike<number> | ArrayBufferLike): ArrayLike<number> };
        indices.setArray(new IndexArray(kept) as any);
        triangles += kept.length / 3;
      }
    }
    return triangles;
  };
  const sourceTriangles = cleanTriangles();
  if (sourceTriangles > spec.budgets.maxTriangles) {
    const { MeshoptSimplifier } = require("meshoptimizer");
    await MeshoptSimplifier.ready;
    // Do not destroy a thin blade or guard to force a budget. Validation can
    // request a larger budget when this silhouette-preserving pass cannot fit.
    await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio: spec.budgets.maxTriangles / sourceTriangles, error: 0.005 }));
    cleanTriangles();
  }
  await document.transform(normals({ overwrite: true }));
  const stableRoots: any[] = [];
  for (const scene of root.listScenes?.() ?? []) {
    const children = [...(scene.listChildren?.() ?? [])];
    const stableRoot = document.createNode(spec.coordinateContract.stableRootName);
    stableRoots.push(stableRoot);
    scene.addChild(stableRoot);
    for (const child of children) if (child !== stableRoot) stableRoot.addChild(child);
    if (objectRule) {
      const attachment = document.createNode("GrudgeAttachment");
      attachment.setExtras({ grudgeAttachment: { label: objectRule.anchorLabel, objectType: objectRule.type, component: objectRule.component, normalizedBounds: anchor, method: "user-bounds", semanticPositionVerified: false } });
      stableRoot.addChild(attachment);
    }
  }
  if (spec.generateCollision) {
    for (const stableRoot of stableRoots) {
      const collision = document.createNode("Collision_Box");
      collision.setExtras({
        grudgeCollision: {
          shape: "box",
          sizeMeters: { width: spans[0] * scales[0], height: spans[1] * scales[1], depth: spans[2] * scales[2] },
          centerMeters: { x: (0.5 - anchor.x) * spans[0] * scales[0], y: (0.5 - anchor.y) * spans[1] * scales[1], z: (0.5 - anchor.z) * spans[2] * scales[2] },
        },
      });
      stableRoot.addChild(collision);
    }
  }
  if (spec.generateLods) {
    const { MeshoptSimplifier } = require("meshoptimizer");
    await MeshoptSimplifier.ready;
    const buffer = root.listBuffers?.()[0] ?? document.createBuffer("Prompt3D-LOD");
    const sourceMeshes = [...(root.listMeshes?.() ?? [])];
    const lodMeshes: any[] = [];
    for (const sourceMesh of sourceMeshes) {
      const lodMesh = document.createMesh(`${sourceMesh.getName?.() || "Mesh"}_LOD1`);
      for (const primitive of sourceMesh.listPrimitives?.() ?? []) {
        const position = primitive.getAttribute?.("POSITION");
        const indices = primitive.getIndices?.();
        const positionArray = position?.getArray?.();
        const existingIndices = indices?.getArray?.();
        const indexArray = existingIndices ?? Uint32Array.from({ length: position?.getCount?.() ?? 0 }, (_value, index) => index);
        if (!positionArray || indexArray.length < 6 || (primitive.getMode?.() ?? 4) !== 4) continue;
        const targetIndexCount = Math.max(3, Math.floor(indexArray.length * 0.5 / 3) * 3);
        const [simplified] = MeshoptSimplifier.simplify(indexArray, positionArray, 3, targetIndexCount, 0.01);
        const lodPrimitive = document.createPrimitive().setMode(primitive.getMode?.() ?? 4).setMaterial(primitive.getMaterial?.());
        for (const semantic of primitive.listSemantics?.() ?? []) lodPrimitive.setAttribute(semantic, primitive.getAttribute(semantic));
        const IndexArray = position.getCount?.() > 65_535 ? Uint32Array : Uint16Array;
        const lodIndices = document.createAccessor().setType("SCALAR").setArray(new IndexArray(simplified)).setBuffer(buffer);
        lodPrimitive.setIndices(lodIndices);
        lodMesh.addPrimitive(lodPrimitive);
      }
      if ((lodMesh.listPrimitives?.() ?? []).length) lodMeshes.push(lodMesh);
      else lodMesh.dispose?.();
    }
    for (const lodMesh of lodMeshes) {
      const lodNode = document.createNode(`LOD1_${lodMesh.getName?.() || "Mesh"}`).setMesh(lodMesh);
      lodNode.setExtras({ grudgeLod: { level: 1, triangleRatio: 0.5, activateBelowScreenCoverage: 0.35, root: spec.coordinateContract.stableRootName } });
    }
  }
  const asset = root.getAsset?.() ?? {};
  Object.assign(asset, { generator: "Grudge Dev Tool Prompt-to-3D", extras: { ...(asset.extras ?? {}), grudgePrompt3D: { specVersion: spec.version, upAxis: "+Y", forwardAxis: "+Z", origin: objectRule ? "attachment-point" : "ground-center", objectType: objectRule?.type, component: objectRule?.component, attachment: objectRule ? { label: objectRule.anchorLabel, normalizedBounds: anchor, semanticPositionVerified: false } : undefined, flipVertical: objectRule?.flipVertical ?? false, unit: "meter", scaleMode: spec.scaleMode ?? "preserve", sourceSpans: spans, appliedScales: scales, visualReview: "required" } } });
  await mkdir(dirname(output), { recursive: true });
  await io.write(output, document);
}
