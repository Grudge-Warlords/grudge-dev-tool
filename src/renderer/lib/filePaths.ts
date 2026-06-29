/** Directory URL for resolving relative texture paths next to a model file. */
export function resourceBaseFromModelLocation(loc: string): string {
  if (/^https?:\/\//i.test(loc)) {
    try {
      const u = new URL(loc);
      const dir = u.pathname.slice(0, u.pathname.lastIndexOf("/") + 1);
      return `${u.origin}${dir}`;
    } catch {
      return loc;
    }
  }
  const normalized = loc.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash + 1) : "";
  if (/^[a-zA-Z]:/.test(dir)) return `file:///${dir}`;
  if (dir.startsWith("/")) return `file://${dir}`;
  return `file:///${dir}`;
}

/** Resolve absolute paths from dropped files (sandbox-safe via preload webUtils). */
export function pathsFromFileList(files: FileList): string[] {
  const paths: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const p =
      (typeof window !== "undefined" && window.grudge?.files?.getPathForFile?.(f)) ||
      (f as File & { path?: string }).path;
    if (p) paths.push(p);
  }
  return paths;
}