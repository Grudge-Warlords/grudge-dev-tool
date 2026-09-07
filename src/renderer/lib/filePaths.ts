/** Resolve absolute paths from dropped files (sandbox-safe via preload webUtils). */
export function diskPathFromFile(file: File): string | undefined {
  try {
    const fromPreload = typeof window !== "undefined" && window.grudge?.files?.getPathForFile?.(file);
    if (fromPreload) return fromPreload;
  } catch {
    /* sandbox */
  }
  return (file as File & { path?: string }).path;
}

export function pathsFromFileList(files: FileList): string[] {
  const paths: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const p = diskPathFromFile(files[i]);
    if (p) paths.push(p);
  }
  return paths;
}