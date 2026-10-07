/** Explicit local paths use the same file/browser handlers as the visible UI. */
export function validateAppLocalPath(value: string): string {
  if (typeof value !== "string" || !/^[a-z]:[\\/]/i.test(value) || value.length > 500 || /[\x00-\x1f<>"|?*]/.test(value) || value.slice(2).includes(":")) {
    throw new Error("Use a full local drive path, such as E:\\Models\\asset.glb.");
  }
  return value;
}

export function appLocalPathRequest(prompt: string): { kind: "folder" | "model"; path: string } | null {
  const match = prompt.trim().match(/^(?:please\s+)?open\s+(?:the\s+)?(?:local\s+)?(folder|model)\s+(?:(?:at|from)\s+)?(.+)$/i);
  if (!match) return null;
  const kind = match[1].toLowerCase() as "folder" | "model";
  let tail = match[2];
  if (kind === "model") {
    if (!/\s+in\s+(?:local\s+)?Forge[.!]?$/i.test(tail)) return null;
    tail = tail.replace(/\s+in\s+(?:local\s+)?Forge[.!]?$/i, "");
  } else tail = tail.replace(/\s+in\s+Local Files[.!]?$/i, "");
  const quoted = tail.match(/^(?:"([^"]+)"|'([^']+)')[.!]?$/);
  const path = quoted ? quoted[1] ?? quoted[2] : tail;
  if (!quoted && !/^[a-z]:[\\/]/i.test(path)) return null;
  return { kind, path: validateAppLocalPath(path) };
}
