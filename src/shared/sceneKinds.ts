/**
 * Scene kind SSOT — glTF multi-file packs (.gltf + .bin), Three.js ObjectLoader
 * scenes, and Forge multi-entity scene documents.
 *
 * Used by Elite open, loaders, and Local Files classification.
 */

export type JsonSceneKind =
  | "gltf-json"
  | "three-objectloader"
  | "forge-scene"
  | "unknown-json";

export type OpenSceneRole =
  | "gltf"
  | "glb"
  | "gltf-bin"
  | "three-scene"
  | "forge-scene"
  | "other";

/** File-name heuristics for Three.js / Forge scene documents. */
export function isThreeSceneFileName(name: string): boolean {
  const lower = name.toLowerCase().replace(/\\/g, "/");
  if (lower.endsWith(".scene.json")) return true;
  if (lower.endsWith(".three.json")) return true;
  if (lower.endsWith(".forge-scene.json")) return true;
  if (lower.endsWith(".gfscene.json")) return true;
  if (lower.endsWith(".gfscene")) return true;
  if (lower.endsWith(".scene")) return true;
  if (lower.endsWith(".three")) return true;
  if (lower.includes("/scenes/") && lower.endsWith(".json")) return true;
  return false;
}

/** glTF JSON / binary companion names (multi-file packs). */
export function isGltfSceneFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".gltf") || lower.endsWith(".glb") || lower.endsWith(".vrm");
}

/** Raw buffer companion next to scene.gltf (not a mesh by itself). */
export function isGltfBinFileName(name: string): boolean {
  return name.toLowerCase().endsWith(".bin");
}

/**
 * Classify JSON text as glTF / Three ObjectLoader / Forge scene / unknown.
 * Sample-based — safe for large files (first 64 KiB + light structure checks).
 */
export function classifyJsonSceneContent(text: string): JsonSceneKind {
  if (!text || typeof text !== "string") return "unknown-json";
  const sample = text.length > 64 * 1024 ? text.slice(0, 64 * 1024) : text;
  const trimmed = sample.replace(/^\uFEFF/, "").trimStart();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return "unknown-json";

  const hasAsset = /"asset"\s*:\s*\{/.test(sample);
  const hasMeshes = /"meshes"\s*:\s*\[/.test(sample);
  const hasNodes = /"nodes"\s*:\s*\[/.test(sample);
  const hasScenes = /"scenes"\s*:\s*\[/.test(sample);
  const hasBuffers = /"buffers"\s*:\s*\[/.test(sample);
  if (hasAsset && (hasMeshes || hasNodes || hasScenes || hasBuffers)) {
    return "gltf-json";
  }
  if ((hasMeshes && hasNodes) || (hasScenes && hasNodes && hasBuffers)) {
    return "gltf-json";
  }

  // Forge multi-entity document (sceneSerializer)
  const hasEntities = /"entities"\s*:\s*\[/.test(sample);
  const hasVersion = /"version"\s*:\s*\d+/.test(sample);
  const hasSettings = /"settings"\s*:\s*\{/.test(sample);
  if (hasEntities && (hasVersion || hasSettings)) {
    return "forge-scene";
  }

  // Three.js ObjectLoader / editor exports
  const hasMetadata = /"metadata"\s*:\s*\{/.test(sample);
  const hasObject = /"object"\s*:\s*\{/.test(sample);
  const hasGeometries = /"geometries"\s*:\s*\[/.test(sample);
  const hasMaterials = /"materials"\s*:\s*\[/.test(sample);
  if (hasObject && (hasMetadata || hasGeometries || hasMaterials)) {
    return "three-objectloader";
  }
  // Some exports only have object + children tree
  if (hasObject && /"type"\s*:\s*"Scene"/.test(sample)) {
    return "three-objectloader";
  }

  return "unknown-json";
}

/** Map filename (+ optional content) to open role for UI badges. */
export function openSceneRole(name: string, jsonKind?: JsonSceneKind | null): OpenSceneRole {
  const lower = name.toLowerCase();
  if (lower.endsWith(".bin")) return "gltf-bin";
  if (lower.endsWith(".glb") || lower.endsWith(".vrm")) return "glb";
  if (lower.endsWith(".gltf")) return "gltf";
  if (jsonKind === "forge-scene" || lower.endsWith(".forge-scene.json")) return "forge-scene";
  if (
    jsonKind === "three-objectloader" ||
    isThreeSceneFileName(name)
  ) {
    return "three-scene";
  }
  if (jsonKind === "gltf-json") return "gltf";
  return "other";
}
