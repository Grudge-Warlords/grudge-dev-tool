import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import sharp from "sharp";
import type { AssetSpecV1, Prompt3DValidationCheck, Prompt3DValidationReport } from "../../shared/prompt3d";

function check(id: string, status: Prompt3DValidationCheck["status"], message: string, measured?: string | number | boolean, required?: string | number | boolean): Prompt3DValidationCheck {
  return { id, status, message, measured, required };
}

export async function validatePrompt3DGlb(glbPath: string, spec: AssetSpecV1, quarantineRoot: string): Promise<Prompt3DValidationReport> {
  const checks: Prompt3DValidationCheck[] = [];
  let triangleCount = 0;
  let boundsMeters: Prompt3DValidationReport["boundsMeters"];
  try {
    if (extname(glbPath).toLowerCase() !== ".glb") throw new Error("Only binary GLB output is accepted.");
    const bytes = await readFile(glbPath);
    if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "glTF") throw new Error("Invalid GLB magic/header.");
    if (bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error("GLB version, declared length or JSON chunk is invalid.");
    const jsonChunkLength = bytes.readUInt32LE(12);
    if (jsonChunkLength <= 0 || 20 + jsonChunkLength > bytes.length) throw new Error("GLB JSON chunk length is invalid.");
    const gltfJson = JSON.parse(bytes.toString("utf8", 20, 20 + jsonChunkLength).trim());
    const externalUris = [...(gltfJson.buffers ?? []), ...(gltfJson.images ?? [])]
      .map((entry: { uri?: unknown }) => entry?.uri)
      .filter((uri: unknown): uri is string => typeof uri === "string" && !uri.startsWith("data:"));
    if (externalUris.length > 0) throw new Error("Game-ready GLB output must be self-contained and may not reference external files or URLs.");
    const { NodeIO } = require("@gltf-transform/core");
    const { ALL_EXTENSIONS } = require("@gltf-transform/extensions");
    const document = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(glbPath);
    const root = document.getRoot();
    const nodes = root.listNodes?.() ?? [];
    const meshes = root.listMeshes?.() ?? [];
    checks.push(check("structure", meshes.length > 0 ? "pass" : "fail", meshes.length > 0 ? "GLB contains mesh geometry." : "GLB has no meshes.", meshes.length, ">0"));
    const scenes = root.listScenes?.() ?? [];
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const rootContract = scenes.length > 0 && scenes.every((scene: any) => {
      const children = scene.listChildren?.() ?? [];
      return children.length === 1
        && children[0].getName?.() === spec.coordinateContract.stableRootName
        && children[0].getMatrix?.().every((value: number, index: number) => Math.abs(value - identity[index]) <= 1e-8);
    });
    checks.push(check("stable-root", rootContract ? "pass" : "fail", rootContract ? "Each scene has one identity-transform stable root at the canonical pivot." : `Each scene must have one identity-transform root named '${spec.coordinateContract.stableRootName}'.`, rootContract, true));

    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let finite = true, attributesFinite = true, normals = true, uvs = true, tangents = true, materials = true, normalMapPresent = false, indicesValid = true, triangleMode = true, degenerateTriangles = 0, primitiveCount = 0;
    for (const mesh of meshes) {
      const countsTowardBudget = !/_LOD1$/i.test(mesh.getName?.() || "");
      for (const primitive of mesh.listPrimitives?.() ?? []) {
        primitiveCount += 1;
        const position = primitive.getAttribute?.("POSITION");
        const array = position?.getArray?.() as ArrayLike<number> | undefined;
        if (!array || array.length < 3) { finite = false; continue; }
        for (let i = 0; i < array.length; i += 3) {
          const x = Number(array[i]), y = Number(array[i + 1]), z = Number(array[i + 2]);
          if (![x, y, z].every(Number.isFinite)) { finite = false; break; }
          minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
        }
        const indices = primitive.getIndices?.();
        const indexArray = indices?.getArray?.() as ArrayLike<number> | undefined;
        const mode = primitive.getMode?.() ?? 4;
        const elementCount = indices?.getCount?.() ?? position?.getCount?.() ?? 0;
        if (mode !== 4 || elementCount % 3 !== 0) triangleMode = false;
        if (indexArray) {
          const vertexCount = position?.getCount?.() ?? 0;
          for (let i = 0; i < indexArray.length; i += 1) {
            const value = Number(indexArray[i]);
            if (!Number.isInteger(value) || value < 0 || value >= vertexCount) { indicesValid = false; break; }
          }
        }
        if (mode === 4 && elementCount % 3 === 0 && indicesValid) {
          for (let i = 0; i < elementCount; i += 3) {
            const ia = Number(indexArray ? indexArray[i] : i), ib = Number(indexArray ? indexArray[i + 1] : i + 1), ic = Number(indexArray ? indexArray[i + 2] : i + 2);
            if ([ia, ib, ic].some((index) => !Number.isInteger(index) || index < 0 || index >= (position?.getCount?.() ?? 0))) continue;
            const ax = Number(array[ia * 3]), ay = Number(array[ia * 3 + 1]), az = Number(array[ia * 3 + 2]);
            const abx = Number(array[ib * 3]) - ax, aby = Number(array[ib * 3 + 1]) - ay, abz = Number(array[ib * 3 + 2]) - az;
            const acx = Number(array[ic * 3]) - ax, acy = Number(array[ic * 3 + 1]) - ay, acz = Number(array[ic * 3 + 2]) - az;
            const cx = aby * acz - abz * acy, cy = abz * acx - abx * acz, cz = abx * acy - aby * acx;
            if (ia === ib || ib === ic || ia === ic || cx * cx + cy * cy + cz * cz <= 1e-24) degenerateTriangles += 1;
          }
        }
        if (countsTowardBudget) triangleCount += Math.floor(elementCount / 3);
        normals &&= Boolean(primitive.getAttribute?.("NORMAL"));
        uvs &&= Boolean(primitive.getAttribute?.("TEXCOORD_0"));
        tangents &&= Boolean(primitive.getAttribute?.("TANGENT"));
        for (const semantic of ["NORMAL", "TANGENT", "TEXCOORD_0"]) {
          const attribute = primitive.getAttribute?.(semantic)?.getArray?.() as ArrayLike<number> | undefined;
          if (attribute) for (let i = 0; i < attribute.length; i += 1) if (!Number.isFinite(Number(attribute[i]))) { attributesFinite = false; break; }
        }
        const material = primitive.getMaterial?.();
        normalMapPresent ||= Boolean(material?.getNormalTexture?.());
        materials &&= !spec.generateTextures || Boolean(material?.getBaseColorTexture?.());
      }
    }
    const geometryFinite = finite && primitiveCount > 0 && [minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite);
    checks.push(check("mesh-primitives", primitiveCount > 0 ? "pass" : "fail", primitiveCount > 0 ? "GLB contains mesh primitives." : "GLB meshes contain no primitives.", primitiveCount, ">0"));
    checks.push(check("finite-geometry", geometryFinite ? "pass" : "fail", geometryFinite ? "All inspected positions are finite." : "Geometry contains no usable positions, or contains NaN/infinite positions."));
    checks.push(check("topology-indices", indicesValid ? "pass" : "fail", indicesValid ? "All inspected indices address valid vertices." : "One or more primitives contain invalid indices."));
    checks.push(check("triangle-topology", triangleMode && degenerateTriangles === 0 ? "pass" : "fail", triangleMode && degenerateTriangles === 0 ? "All primitives are non-degenerate indexed or implicit triangles." : "Provider output contains a non-triangle primitive, incomplete triangle, or degenerate triangle.", degenerateTriangles, 0));
    checks.push(check("finite-attributes", attributesFinite ? "pass" : "fail", attributesFinite ? "Normals, tangents and UV values are finite where present." : "A normal, tangent or UV accessor contains NaN/infinite values."));
    checks.push(check("triangle-budget", triangleCount <= spec.budgets.maxTriangles ? "pass" : "fail", `${triangleCount.toLocaleString()} triangles.`, triangleCount, spec.budgets.maxTriangles));
    checks.push(check("normals", normals ? "pass" : "fail", normals ? "Every primitive declares normals." : "One or more primitives lack normals."));
    checks.push(check("uv0", spec.generateTextures && !uvs ? "fail" : uvs ? "pass" : "warning", uvs ? "UV0 is present." : "UV0 is absent; acceptable only for untextured output."));
    checks.push(check("tangents", tangents ? "pass" : normalMapPresent ? "fail" : "warning", tangents ? "Tangents are present." : normalMapPresent ? "Tangents are required because a normal texture is referenced." : "Tangents are absent; acceptable because no normal texture is referenced."));
    checks.push(check("materials", materials ? "pass" : "fail", materials ? "Primitive material references satisfy the requested texture mode." : "A textured primitive lacks a material or base-color texture reference."));
    if (geometryFinite) {
      const unitScale = spec.dimensions.unit === "cm" ? 0.01 : 1;
      boundsMeters = { width: maxX - minX, height: maxY - minY, depth: maxZ - minZ, minY };
      const target = { width: spec.dimensions.width * unitScale, height: spec.dimensions.height * unitScale, depth: spec.dimensions.depth * unitScale };
      const tolerance = 0.08;
      const sizePass = Math.abs(boundsMeters.width - target.width) <= Math.max(target.width * tolerance, 0.01)
        && Math.abs(boundsMeters.height - target.height) <= Math.max(target.height * tolerance, 0.01)
        && Math.abs(boundsMeters.depth - target.depth) <= Math.max(target.depth * tolerance, 0.01);
      checks.push(check("units-and-size", sizePass ? "pass" : "fail", sizePass ? "Bounds match requested meter scale." : "Bounds do not match requested size within 8% tolerance.", JSON.stringify(boundsMeters), JSON.stringify(target)));
      const grounded = Math.abs(minY) <= 0.005;
      checks.push(check("ground-contact", grounded ? "pass" : "fail", grounded ? "Contact plane is grounded at Y=0." : "Lowest geometry point is not grounded at Y=0.", minY, 0));
    } else {
      checks.push(check("units-and-size", "fail", "Bounds cannot be measured without finite geometry."));
      checks.push(check("ground-contact", "fail", "Ground contact cannot be measured without finite geometry."));
    }
    const extras = root.getAsset?.()?.extras ?? {};
    checks.push(check("coordinate-contract", extras?.grudgePrompt3D?.upAxis === "+Y" && extras?.grudgePrompt3D?.forwardAxis === "+Z" ? "pass" : "fail", "Asset must declare +Y up and +Z forward in glTF asset extras."));
    const collisionNode = nodes.find((n: any) => /^collision/i.test(n.getName?.() || "") && n.getExtras?.()?.grudgeCollision?.shape === "box");
    const lodNode = nodes.find((n: any) => /^lod[_-]?1/i.test(n.getName?.() || "") && n.getExtras?.()?.grudgeLod?.level === 1 && n.getMesh?.());
    checks.push(check("collision", spec.generateCollision ? (collisionNode ? "pass" : "fail") : "warning", spec.generateCollision ? "Requested typed collision node is required." : "Collision generation was not requested."));
    checks.push(check("lods", spec.generateLods ? (lodNode ? "pass" : "fail") : "warning", spec.generateLods ? "Requested simplified LOD1 mesh is required." : "LOD generation was not requested."));

    let textureBytes = 0, textureBoundsPass = true;
    const textures = root.listTextures?.() ?? [];
    for (const texture of textures) {
      const image = texture.getImage?.();
      if (!image) { textureBoundsPass = false; continue; }
      textureBytes += image.byteLength;
      const metadata = await sharp(Buffer.from(image)).metadata().catch(() => null);
      if (!metadata?.width || !metadata.height || metadata.width > spec.budgets.maxTextureResolution || metadata.height > spec.budgets.maxTextureResolution) textureBoundsPass = false;
    }
    const texturePass = textureBoundsPass && textureBytes <= spec.budgets.maxTextureBytes && (!spec.generateTextures || textures.length > 0);
    checks.push(check("texture-budget", texturePass ? "pass" : "fail", texturePass ? "Texture dimensions and byte budget pass." : "Texture dimensions, references or bytes exceed the declared budget.", textureBytes, spec.budgets.maxTextureBytes));
  } catch (error) {
    checks.push(check("parse", "fail", error instanceof Error ? error.message : String(error)));
  }

  const gameReady = !checks.some((c) => c.status === "fail");
  const sourceHash = createHash("sha256").update(await readFile(glbPath).catch(() => Buffer.alloc(0))).digest("hex");
  const deterministicId = createHash("sha256").update(JSON.stringify({ sourceHash, spec, checks })).digest("hex");
  let quarantinedPath: string | undefined;
  if (!gameReady) {
    await mkdir(quarantineRoot, { recursive: true });
    quarantinedPath = join(quarantineRoot, `${deterministicId.slice(0, 12)}-${basename(glbPath)}`);
    await rename(glbPath, quarantinedPath).catch(async () => {
      const { copyFile, unlink } = await import("node:fs/promises");
      await copyFile(glbPath, quarantinedPath!); await unlink(glbPath);
    });
  }
  const report: Prompt3DValidationReport = { version: 1, deterministicId, assetPath: glbPath, quarantinedPath, gameReady, triangleCount, boundsMeters, checks, createdAt: new Date().toISOString() };
  const reportPath = join(dirname(quarantinedPath ?? glbPath), `${basename(glbPath, extname(glbPath))}.validation.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
