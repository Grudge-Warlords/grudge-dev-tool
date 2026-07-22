const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  fbx: "application/octet-stream",
  obj: "model/obj",
  stl: "model/stl",
  ply: "application/octet-stream",
  dae: "model/vnd.collada+xml",
  "3mf": "model/3mf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "video/webm",
  json: "application/json",
  txt: "text/plain",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  zip: "application/zip",
  /** Three.js ObjectLoader / scene exports are commonly stored as .json / .scene.json */
  scene: "application/json",
};

export function inferContentType(name: string, fallback = "application/octet-stream"): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_MIME[ext] ?? fallback;
}

export function isImagePath(name: string): boolean {
  return inferContentType(name).startsWith("image/");
}

export function isModelPath(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ["glb", "gltf", "fbx", "obj", "stl", "ply", "dae", "3mf"].includes(ext);
}

/** Audio / sound assets the Asset Viewer can play inline. */
export function isAudioPath(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"].includes(ext);
}

/** Heuristic for Three.js scene files (ObjectLoader JSON) stored in object storage. */
export function isThreeScenePath(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith(".scene.json") || lower.endsWith(".three.json")) return true;
  if (lower.includes("/scenes/") && lower.endsWith(".json")) return true;
  return false;
}