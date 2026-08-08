/**
 * Shared MIME / extension maps for Upload, Viewer, Browser, and Forge.
 * Keep in sync with viewers/types.ts AssetKind lists.
 */

const EXT_TO_MIME: Record<string, string> = {
  // Images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  tga: "image/x-tga",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
  apng: "image/apng",
  jxl: "image/jxl",
  jp2: "image/jp2",
  // 3D
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  fbx: "application/octet-stream",
  obj: "model/obj",
  stl: "model/stl",
  ply: "application/octet-stream",
  dae: "model/vnd.collada+xml",
  "3mf": "model/3mf",
  blend: "application/x-blender",
  vrm: "model/gltf-binary",
  usdz: "model/vnd.usdz+zip",
  abc: "application/octet-stream",
  usd: "model/vnd.usd",
  usda: "model/vnd.usd+usda",
  usdc: "model/vnd.usd+usdc",
  // Design / DCC
  psd: "image/vnd.adobe.photoshop",
  psb: "image/vnd.adobe.photoshop",
  xcf: "image/x-xcf",
  kra: "application/x-krita",
  clip: "application/octet-stream",
  // GPU textures
  ktx: "image/ktx",
  ktx2: "image/ktx2",
  basis: "image/basis",
  dds: "image/vnd-ms.dds",
  hdr: "image/vnd.radiance",
  exr: "image/x-exr",
  // Game data (note: .tsx stays TypeScript below — Tiled tilesets open as text/xml via path heuristics)
  tmx: "application/xml",
  atlas: "text/plain",
  ase: "application/octet-stream",
  aseprite: "application/octet-stream",
  // Audio
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  opus: "audio/opus",
  // Video
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  ogv: "video/ogg",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  // Docs / code
  json: "application/json",
  txt: "text/plain",
  md: "text/markdown",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  ts: "text/typescript",
  tsx: "text/tsx",
  pdf: "application/pdf",
  // Fonts
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  // Archives
  zip: "application/zip",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  /** Three.js ObjectLoader / scene exports */
  scene: "application/json",
};

export function inferContentType(name: string, fallback = "application/octet-stream"): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_MIME[ext] ?? fallback;
}

export function isImagePath(name: string): boolean {
  const ct = inferContentType(name);
  if (ct.startsWith("image/")) return true;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ["tga", "bmp", "tif", "tiff", "heic", "heif", "jxl", "jp2", "psd", "psb"].includes(ext);
}

export function isModelPath(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return [
    "glb", "gltf", "fbx", "obj", "stl", "ply", "dae", "3mf", "blend", "vrm",
    "html", "htm", // CSS3D quick view
  ].includes(ext);
}

/** Design / DCC sources that need prepare or system app (PSD, Blender, GPU tex, maps). */
export function isDesignPath(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return [
    "psd", "psb", "blend", "xcf", "kra", "clip",
    "ktx", "ktx2", "basis", "dds", "hdr", "exr",
    "tmx", "tsx", "atlas", "ase", "aseprite",
    "vrm", "usdz", "abc", "usd", "usda", "usdc",
  ].includes(ext);
}

/** Audio / sound assets the Asset Viewer can play inline. */
export function isAudioPath(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"].includes(ext);
}

export function isVideoPath(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ["mp4", "webm", "mov", "m4v", "ogv", "mkv", "avi"].includes(ext);
}

/** Heuristic for Three.js scene files (ObjectLoader JSON) stored in object storage. */
export function isThreeScenePath(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith(".scene.json") || lower.endsWith(".three.json")) return true;
  if (lower.includes("/scenes/") && lower.endsWith(".json")) return true;
  return false;
}

/** File picker accept string for Upload / importers. */
export const UPLOAD_ACCEPT =
  ".png,.jpg,.jpeg,.webp,.gif,.avif,.tga,.bmp,.tif,.tiff,.heic,.svg,.psd,.psb," +
  ".glb,.gltf,.fbx,.obj,.stl,.ply,.dae,.3mf,.blend,.vrm,.usdz," +
  ".ktx,.ktx2,.dds,.hdr,.exr," +
  ".mp3,.wav,.ogg,.flac,.mp4,.webm,.mov," +
  ".json,.zip,.pdf,.ttf,.otf,.woff,.woff2,.tmx,.tsx,.atlas,.aseprite";

export const IMAGE_CONVERT_FORMATS = ["png", "webp", "jpeg", "avif"] as const;

/** True when the elite desktop viewer should accept this path from Explorer / Open with. */
export function isViewerOpenablePath(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (!ext) return false;
  if (EXT_TO_MIME[ext]) return true;
  if (["psd", "psb", "gfscene", "blend", "scene", "aseprite", "ase"].includes(ext)) return true;
  if (isDesignPath(name)) return true;
  return isThreeScenePath(name);
}
