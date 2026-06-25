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