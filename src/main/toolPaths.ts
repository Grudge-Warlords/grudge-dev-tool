import { existsSync } from "node:fs";

interface Store {
  get<T>(key: string, defaultValue?: T): T;
  set<T>(key: string, value: T): void;
}

let cachedStore: Store | null = null;

async function getStore(): Promise<Store | null> {
  if (cachedStore) return cachedStore;
  try {
    const mod = (await import("electron-store")) as unknown as {
      default: new (opts: { name: string; projectName?: string; cwd?: string }) => Store;
    };
    const StoreCtor = mod.default;
    // projectName required when not running inside Electron (CLI probe / tsx)
    cachedStore = new StoreCtor({
      name: "grudge-tool-paths",
      projectName: "grudge-dev-tool",
      cwd: process.env.APPDATA
        ? `${process.env.APPDATA}\\grudge-dev-tool`
        : undefined,
    });
    return cachedStore;
  } catch {
    return null;
  }
}

export type ToolPathKey = "blender" | "ffmpeg" | "blenderkit" | "fbx2gltf";

export async function getToolPath(key: ToolPathKey): Promise<string | null> {
  try {
    const store = await getStore();
    if (!store) return null;
    const v = store.get<string | null>(key, null);
    return v && existsSync(v) ? v : null;
  } catch {
    return null;
  }
}

export async function setToolPath(key: ToolPathKey, path: string | null): Promise<void> {
  const store = await getStore();
  if (!store) return;
  if (!path?.trim()) store.set(key, null);
  else store.set(key, path.trim());
}

export async function getAllToolPaths(): Promise<Record<ToolPathKey, string | null>> {
  const [blender, ffmpeg, blenderkit, fbx2gltf] = await Promise.all([
    getToolPath("blender"),
    getToolPath("ffmpeg"),
    getToolPath("blenderkit"),
    getToolPath("fbx2gltf"),
  ]);
  return { blender, ffmpeg, blenderkit, fbx2gltf };
}