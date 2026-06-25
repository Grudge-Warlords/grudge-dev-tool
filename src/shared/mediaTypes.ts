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
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  json: "application/json",
  txt: "text/plain",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  zip: "application/zip",
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