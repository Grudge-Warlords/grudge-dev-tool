import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const SURFACE_TOLERANCE_METERS = 2e-6;

export interface HunyuanPaintMergeReport {
  method: "approved-hunyuan-source-topology-plus-hunyuan-paint-uv-material";
  surfaceToleranceMeters: number;
  maximumSurfaceDeviationMeters: number;
  sourceUniquePositions: number;
  paintedUniquePositions: number;
  trianglesMatched: number;
  paintedMaterials: number;
  embeddedTextures: number;
}

interface Point3 {
  x: number;
  y: number;
  z: number;
}

interface SourcePointCandidate {
  id: number;
  distance: number;
}

interface PaintedTriangle {
  corners: Array<{ pointId: number; uv: [number, number] }>;
}

interface SourcePrimitivePlan {
  primitive: any;
  vertexIndices: number[];
  pointIds: number[];
  uvs: number[];
}

function transformPoint(matrix: ArrayLike<number>, array: ArrayLike<number>, index: number): Point3 {
  const x = Number(array[index * 3]);
  const y = Number(array[index * 3 + 1]);
  const z = Number(array[index * 3 + 2]);
  const w = Number(matrix[3]) * x + Number(matrix[7]) * y + Number(matrix[11]) * z + Number(matrix[15]);
  const divisor = Number.isFinite(w) && Math.abs(w) > 1e-12 ? w : 1;
  return {
    x: (Number(matrix[0]) * x + Number(matrix[4]) * y + Number(matrix[8]) * z + Number(matrix[12])) / divisor,
    y: (Number(matrix[1]) * x + Number(matrix[5]) * y + Number(matrix[9]) * z + Number(matrix[13])) / divisor,
    z: (Number(matrix[2]) * x + Number(matrix[6]) * y + Number(matrix[10]) * z + Number(matrix[14])) / divisor,
  };
}

function exactPointKey(point: Point3): string {
  return `${point.x},${point.y},${point.z}`;
}

function bucketKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function triangleKey(pointIds: number[]): string {
  return [...pointIds].sort((a, b) => a - b).join(",");
}

function isDerivedNode(node: any): boolean {
  const extras = node.getExtras?.() ?? {};
  const meshName = node.getMesh?.()?.getName?.() ?? "";
  return extras.grudgeMotionTrail === true
    || extras.grudgeDerivedGeometry === true
    || /(?:^|[_-])LOD\d+$/i.test(meshName);
}

/**
 * Hunyuan Paint is allowed to unwrap, reindex and orient its temporary mesh,
 * but it is not allowed to replace the approved Hunyuan surface. This merge
 * proves that every painted triangle corresponds to the approved surface,
 * then writes Hunyuan's UVs and material onto exact source position values.
 */
export async function mergeHunyuanPaintResult(
  approvedSourcePath: string,
  rawPaintedPath: string,
  outputPath: string,
): Promise<HunyuanPaintMergeReport> {
  const { NodeIO } = require("@gltf-transform/core");
  const { ALL_EXTENSIONS } = require("@gltf-transform/extensions");
  const { copyToDocument } = require("@gltf-transform/functions");
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const sourceDocument = await io.read(approvedSourcePath);
  const paintedDocument = await io.read(rawPaintedPath);
  const sourceRoot = sourceDocument.getRoot();
  const paintedRoot = paintedDocument.getRoot();

  if (paintedRoot.listAnimations().length || paintedRoot.listSkins().length) {
    throw new Error("Hunyuan Paint returned unexpected animation or skin data.");
  }
  if (sourceRoot.listSkins().length || sourceRoot.listMeshes().some((mesh: any) => mesh.listPrimitives().some((primitive: any) => primitive.listTargets().length))) {
    throw new Error("Hunyuan Paint texture transfer must occur before skin or morph animation authoring.");
  }

  const sourceBindings = new Map<any, any[]>();
  for (const node of sourceRoot.listNodes()) {
    const mesh = node.getMesh?.();
    if (!mesh || isDerivedNode(node)) continue;
    const nodes = sourceBindings.get(mesh) ?? [];
    nodes.push(node);
    sourceBindings.set(mesh, nodes);
  }
  if (!sourceBindings.size) throw new Error("Approved Hunyuan source contains no base mesh node.");
  for (const nodes of sourceBindings.values()) {
    if (nodes.length !== 1) throw new Error("Approved Hunyuan source contains instanced base geometry that cannot receive an unambiguous painted UV map.");
  }

  const sourcePoints: Point3[] = [];
  const sourceExactIds = new Map<string, number>();
  const sourceBuckets = new Map<string, number[]>();
  const registerSourcePoint = (point: Point3): number => {
    const exact = exactPointKey(point);
    const existing = sourceExactIds.get(exact);
    if (existing !== undefined) return existing;
    const id = sourcePoints.length;
    sourcePoints.push(point);
    sourceExactIds.set(exact, id);
    const bx = Math.floor(point.x / SURFACE_TOLERANCE_METERS);
    const by = Math.floor(point.y / SURFACE_TOLERANCE_METERS);
    const bz = Math.floor(point.z / SURFACE_TOLERANCE_METERS);
    const key = bucketKey(bx, by, bz);
    const ids = sourceBuckets.get(key) ?? [];
    ids.push(id);
    sourceBuckets.set(key, ids);
    return id;
  };

  const sourcePlans: SourcePrimitivePlan[] = [];
  let sourceTriangleCount = 0;
  for (const [mesh, nodes] of sourceBindings) {
    const matrix = nodes[0].getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      if ((primitive.getMode?.() ?? 4) !== 4) throw new Error("Approved Hunyuan source contains a non-triangle base primitive.");
      const position = primitive.getAttribute("POSITION");
      const array = position?.getArray?.() as ArrayLike<number> | undefined;
      if (!position || !array) throw new Error("Approved Hunyuan source primitive has no POSITION data.");
      const indexArray = primitive.getIndices()?.getArray?.() as ArrayLike<number> | undefined;
      const vertexIndices = Array.from({ length: indexArray?.length ?? position.getCount() }, (_value, index) => Number(indexArray ? indexArray[index] : index));
      if (!vertexIndices.length || vertexIndices.length % 3 !== 0) throw new Error("Approved Hunyuan source has an incomplete triangle index stream.");
      const pointIds = vertexIndices.map((vertexIndex) => registerSourcePoint(transformPoint(matrix, array, vertexIndex)));
      for (let index = 0; index < pointIds.length; index += 3) {
        if (new Set(pointIds.slice(index, index + 3)).size !== 3) throw new Error("Approved Hunyuan source contains a degenerate triangle.");
      }
      sourceTriangleCount += pointIds.length / 3;
      sourcePlans.push({ primitive, vertexIndices, pointIds, uvs: [] });
    }
  }
  if (!sourceTriangleCount) throw new Error("Approved Hunyuan source contains no base triangles.");

  const sourceTriangleKeys = new Set<string>();
  for (const plan of sourcePlans) {
    for (let index = 0; index < plan.pointIds.length; index += 3) {
      sourceTriangleKeys.add(triangleKey(plan.pointIds.slice(index, index + 3)));
    }
  }

  let maximumSurfaceDeviationMeters = 0;
  const paintedMappedPointIds = new Set<number>();
  const paintedExactPoints = new Set<string>();
  const sourcePointCandidates = (point: Point3): SourcePointCandidate[] => {
    const bx = Math.floor(point.x / SURFACE_TOLERANCE_METERS);
    const by = Math.floor(point.y / SURFACE_TOLERANCE_METERS);
    const bz = Math.floor(point.z / SURFACE_TOLERANCE_METERS);
    const candidates: SourcePointCandidate[] = [];
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
      for (const id of sourceBuckets.get(bucketKey(bx + dx, by + dy, bz + dz)) ?? []) {
        const source = sourcePoints[id];
        const distanceSquared = (source.x - point.x) ** 2 + (source.y - point.y) ** 2 + (source.z - point.z) ** 2;
        if (distanceSquared <= SURFACE_TOLERANCE_METERS ** 2) candidates.push({ id, distance: Math.sqrt(distanceSquared) });
      }
    }
    candidates.sort((left, right) => left.distance - right.distance || left.id - right.id);
    if (!candidates.length) {
      throw new Error(`Hunyuan Paint changed the approved surface by more than ${SURFACE_TOLERANCE_METERS} meters.`);
    }
    return candidates;
  };

  const paintedTriangles = new Map<string, { records: PaintedTriangle[]; cursor: number }>();
  const paintedMaterials = new Set<any>();
  let paintedTriangleCount = 0;
  for (const node of paintedRoot.listNodes()) {
    const mesh = node.getMesh?.();
    if (!mesh || isDerivedNode(node)) continue;
    const matrix = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      if ((primitive.getMode?.() ?? 4) !== 4) throw new Error("Hunyuan Paint returned a non-triangle primitive.");
      const position = primitive.getAttribute("POSITION");
      const texcoord = primitive.getAttribute("TEXCOORD_0");
      const positions = position?.getArray?.() as ArrayLike<number> | undefined;
      const texcoords = texcoord?.getArray?.() as ArrayLike<number> | undefined;
      const material = primitive.getMaterial?.();
      if (!position || !positions || !texcoord || !texcoords || !material) throw new Error("Hunyuan Paint output must contain POSITION, TEXCOORD_0 and material data.");
      paintedMaterials.add(material);
      const indexArray = primitive.getIndices()?.getArray?.() as ArrayLike<number> | undefined;
      const vertexIndices = Array.from({ length: indexArray?.length ?? position.getCount() }, (_value, index) => Number(indexArray ? indexArray[index] : index));
      if (!vertexIndices.length || vertexIndices.length % 3 !== 0) throw new Error("Hunyuan Paint returned an incomplete triangle index stream.");
      const mappedByVertex = new Map<number, SourcePointCandidate>();
      const candidatesForVertex = (vertexIndex: number): SourcePointCandidate[] => {
        const cached = mappedByVertex.get(vertexIndex);
        if (cached) return [cached];
        const point = transformPoint(matrix, positions, vertexIndex);
        paintedExactPoints.add(exactPointKey(point));
        return sourcePointCandidates(point);
      };
      for (let index = 0; index < vertexIndices.length; index += 3) {
        const triangleVertexIndices = vertexIndices.slice(index, index + 3);
        const candidateSets = triangleVertexIndices.map(candidatesForVertex);
        let selected: SourcePointCandidate[] | undefined;
        let selectedDistance = Infinity;
        for (const first of candidateSets[0]) for (const second of candidateSets[1]) for (const third of candidateSets[2]) {
          const combination = [first, second, third];
          const pointIds = combination.map((candidate) => candidate.id);
          if (new Set(pointIds).size !== 3 || !sourceTriangleKeys.has(triangleKey(pointIds))) continue;
          const distance = combination.reduce((sum, candidate) => sum + candidate.distance, 0);
          if (distance < selectedDistance) {
            selected = combination;
            selectedDistance = distance;
          }
        }
        if (!selected) {
          const nearestIds = candidateSets.map((candidates) => candidates[0].id);
          if (new Set(nearestIds).size !== 3) throw new Error("Hunyuan Paint returned a degenerate or collapsed triangle.");
          throw new Error("Hunyuan Paint changed the approved triangle connectivity.");
        }
        selected.forEach((candidate, cornerIndex) => {
          mappedByVertex.set(triangleVertexIndices[cornerIndex], candidate);
          paintedMappedPointIds.add(candidate.id);
          maximumSurfaceDeviationMeters = Math.max(maximumSurfaceDeviationMeters, candidate.distance);
        });
        const pointIds = selected.map((candidate) => candidate.id);
        const record: PaintedTriangle = {
          corners: triangleVertexIndices.map((vertexIndex, cornerIndex) => ({
            pointId: pointIds[cornerIndex],
            uv: [Number(texcoords[vertexIndex * 2]), Number(texcoords[vertexIndex * 2 + 1])],
          })),
        };
        if (record.corners.some((corner) => !corner.uv.every(Number.isFinite))) throw new Error("Hunyuan Paint returned non-finite UV coordinates.");
        const key = triangleKey(pointIds);
        const queue = paintedTriangles.get(key) ?? { records: [], cursor: 0 };
        queue.records.push(record);
        paintedTriangles.set(key, queue);
        paintedTriangleCount += 1;
      }
    }
  }
  if (paintedMaterials.size !== 1) throw new Error("Hunyuan Paint must return exactly one unambiguous material for the approved surface.");
  if (paintedTriangleCount !== sourceTriangleCount) throw new Error("Hunyuan Paint changed the approved triangle count.");
  if (paintedMappedPointIds.size !== sourcePoints.length) throw new Error("Hunyuan Paint omitted part of the approved surface.");

  let trianglesMatched = 0;
  for (const plan of sourcePlans) {
    for (let index = 0; index < plan.pointIds.length; index += 3) {
      const sourcePointIds = plan.pointIds.slice(index, index + 3);
      const queue = paintedTriangles.get(triangleKey(sourcePointIds));
      const record = queue?.records[queue.cursor];
      if (!queue || !record) throw new Error("Hunyuan Paint changed the approved triangle connectivity.");
      queue.cursor += 1;
      const usedCorners = new Set<number>();
      for (const pointId of sourcePointIds) {
        const paintedCornerIndex = record.corners.findIndex((corner, cornerIndex) => corner.pointId === pointId && !usedCorners.has(cornerIndex));
        if (paintedCornerIndex < 0) throw new Error("Hunyuan Paint changed a triangle corner on the approved surface.");
        usedCorners.add(paintedCornerIndex);
        plan.uvs.push(...record.corners[paintedCornerIndex].uv);
      }
      trianglesMatched += 1;
    }
  }
  if ([...paintedTriangles.values()].some((queue) => queue.cursor !== queue.records.length)) throw new Error("Hunyuan Paint returned extra or duplicated surface triangles.");

  for (const sourceExtension of paintedRoot.listExtensionsUsed()) {
    const targetExtension = sourceDocument.createExtension(sourceExtension.constructor as any);
    if (sourceExtension.isRequired()) targetExtension.setRequired(true);
  }
  const paintedMaterial = [...paintedMaterials][0];
  const copied = copyToDocument(sourceDocument, paintedDocument, [paintedMaterial]);
  const targetMaterial = copied.get(paintedMaterial);
  if (!targetMaterial) throw new Error("Hunyuan Paint material transfer failed.");
  const buffer = sourceRoot.listBuffers()[0] ?? sourceDocument.createBuffer("Prompt3D-Hunyuan-Paint");

  for (const plan of sourcePlans) {
    const semantics = plan.primitive.listSemantics() as string[];
    for (const semantic of semantics) {
      if (semantic === "TEXCOORD_0" || semantic === "TANGENT") continue;
      const sourceAccessor = plan.primitive.getAttribute(semantic);
      const sourceArray = sourceAccessor?.getArray?.() as any;
      if (!sourceAccessor || !sourceArray) continue;
      const elementSize = sourceAccessor.getElementSize();
      const TypedArray = sourceArray.constructor as new(length: number) => any;
      const expanded = new TypedArray(plan.vertexIndices.length * elementSize);
      for (let corner = 0; corner < plan.vertexIndices.length; corner += 1) {
        const sourceOffset = plan.vertexIndices[corner] * elementSize;
        const targetOffset = corner * elementSize;
        for (let component = 0; component < elementSize; component += 1) expanded[targetOffset + component] = sourceArray[sourceOffset + component];
      }
      const accessor = sourceDocument.createAccessor(sourceAccessor.getName?.() ?? "")
        .setType(sourceAccessor.getType())
        .setArray(expanded)
        .setNormalized(sourceAccessor.getNormalized())
        .setBuffer(buffer);
      plan.primitive.setAttribute(semantic, accessor);
    }
    const uvAccessor = sourceDocument.createAccessor("Hunyuan Paint UV")
      .setType("VEC2")
      .setArray(new Float32Array(plan.uvs))
      .setBuffer(buffer);
    plan.primitive.setAttribute("TEXCOORD_0", uvAccessor);
    plan.primitive.setAttribute("TANGENT", null);
    plan.primitive.setIndices(null);
    plan.primitive.setMaterial(targetMaterial);
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await io.write(outputPath, sourceDocument);
  return {
    method: "approved-hunyuan-source-topology-plus-hunyuan-paint-uv-material",
    surfaceToleranceMeters: SURFACE_TOLERANCE_METERS,
    maximumSurfaceDeviationMeters,
    sourceUniquePositions: sourcePoints.length,
    paintedUniquePositions: paintedExactPoints.size,
    trianglesMatched,
    paintedMaterials: paintedMaterials.size,
    embeddedTextures: paintedRoot.listTextures().filter((texture: any) => Boolean(texture.getImage?.()?.byteLength)).length,
  };
}
