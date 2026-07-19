/** Asset metadata passed into every viewer. The url is a fully-qualified
 *  CDN URL (e.g. https://assets.grudge-studio.com/path/to/file.glb). */
export interface AssetRef {
  /** Object-storage key (path inside the bucket, no leading slash). */
  name: string;
  /** Resolved CDN URL — the source the viewers fetch from. */
  url: string;
  /** Reported content-type from the listing. May be inaccurate; we also
   *  sniff by extension. */
  contentType: string;
  /** Size in bytes (from the listing). */
  size: number;
}

/** Coarse asset category used to pick which viewer component to mount. */
export type AssetKind =
  | "image" | "video" | "audio" | "model3d"
  | "text"  | "pdf"   | "font"  | "unknown";

const EXT: Record<AssetKind, string[]> = {
  image:  ["png", "jpg", "jpeg", "webp", "avif", "gif", "svg", "bmp", "ico", "apng"],
  video:  ["mp4", "webm", "mov", "m4v", "ogv"],
  audio:  ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"],
  model3d:["glb", "gltf", "fbx", "obj", "stl", "ply", "dae", "3mf"],
  text:   ["txt", "json", "md", "markdown", "yml", "yaml", "ts", "tsx", "js", "jsx",
           "mjs", "cjs", "css", "scss", "html", "htm", "xml", "csv", "tsv", "log",
           "ini", "toml", "env", "gitignore", "rs", "go", "py", "sh", "ps1"],
  pdf:    ["pdf"],
  font:   ["ttf", "otf", "woff", "woff2"],
  unknown:[],
};

/** Look at extension first (more reliable than R2's contentType which often
 *  returns application/octet-stream), then fall back to MIME-prefix sniffing. */
export function classify(ref: AssetRef): AssetKind {
  const dotIdx = ref.name.lastIndexOf(".");
  const ext = dotIdx !== -1 ? ref.name.slice(dotIdx + 1).toLowerCase() : "";
  for (const [kind, list] of Object.entries(EXT) as [AssetKind, string[]][]) {
    if (list.includes(ext)) return kind;
  }
  const ct = (ref.contentType ?? "").toLowerCase();
  if (ct.startsWith("image/"))  return "image";
  if (ct.startsWith("video/"))  return "video";
  if (ct.startsWith("audio/"))  return "audio";
  if (ct === "application/pdf") return "pdf";
  if (ct.startsWith("text/") || ct.includes("json") || ct.includes("xml")) return "text";
  if (ct.includes("gltf") || ct.includes("model/")) return "model3d";
  return "unknown";
}

export function basename(path: string): string {
  const trimmed = path.replace(/\/$/, "");
  const i = trimmed.lastIndexOf("/");
  return i >= 0 ? trimmed.slice(i + 1) : trimmed;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
