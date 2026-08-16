/**
 * File-kind classifier — ported from Grudge-Studio-Forge
 * `artifacts/game-forge/src/lib/fileKind.ts`
 *
 * Dependency-free so drop zones don't pull three.js just for extension checks.
 */

export type DroppedFileKind =
  | "glb"
  | "gltf"
  | "gltf-bin"
  | "vrm"
  | "obj"
  | "fbx"
  | "stl"
  | "ply"
  | "dae"
  | "3mf"
  | "css3d"
  | "image"
  | "audio"
  | "scene-json"
  | "zip";

export function classifyDroppedFile(file: { name: string }): DroppedFileKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".glb")) return "glb";
  if (name.endsWith(".gltf")) return "gltf";
  if (name.endsWith(".bin")) return "gltf-bin";
  if (name.endsWith(".vrm")) return "vrm";
  if (name.endsWith(".obj")) return "obj";
  if (name.endsWith(".fbx")) return "fbx";
  if (name.endsWith(".stl")) return "stl";
  if (name.endsWith(".ply")) return "ply";
  if (name.endsWith(".dae")) return "dae";
  if (name.endsWith(".3mf")) return "3mf";
  if (name.endsWith(".html") || name.endsWith(".htm")) return "css3d";
  if (/\.(png|jpe?g|webp|gif|bmp|tga|ktx2)$/.test(name)) return "image";
  if (/\.(mp3|wav|ogg|m4a|flac)$/.test(name)) return "audio";
  if (name.endsWith(".zip")) return "zip";
  if (
    name.endsWith(".json") ||
    name.endsWith(".gfscene") ||
    name.endsWith(".gfscene.json") ||
    name.endsWith(".scene.json") ||
    name.endsWith(".three.json") ||
    name.endsWith(".forge-scene.json") ||
    name.endsWith(".scene") ||
    name.endsWith(".three")
  ) {
    return "scene-json";
  }
  return null;
}

export function isModelKind(kind: DroppedFileKind | null): boolean {
  return (
    kind === "glb" ||
    kind === "gltf" ||
    kind === "gltf-bin" ||
    kind === "vrm" ||
    kind === "obj" ||
    kind === "fbx" ||
    kind === "stl" ||
    kind === "ply" ||
    kind === "dae" ||
    kind === "3mf" ||
    kind === "css3d" ||
    kind === "scene-json"
  );
}

/** Accept attribute for &lt;input type=file&gt; (models + scene JSON + zip + HTML CSS3D). */
export const FORGE_IMPORT_ACCEPT =
  ".glb,.gltf,.bin,.vrm,.obj,.fbx,.stl,.ply,.dae,.3mf,.zip,.json,.gfscene,.gfscene.json,.scene.json,.three.json,.forge-scene.json,.scene,.html,.htm,model/*,application/json,text/html";
