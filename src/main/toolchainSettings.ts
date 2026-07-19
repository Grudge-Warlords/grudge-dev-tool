import { existsSync } from "node:fs";

interface Store {
  get<T>(key: string, defaultValue?: T): T;
  set<T>(key: string, value: T): void;
}

let cachedStore: Store | null = null;
let hydrated = false;

async function getStore(): Promise<Store> {
  if (cachedStore) return cachedStore;
  const mod: any = await import("electron-store");
  const StoreCtor = mod.default ?? mod;
  cachedStore = new StoreCtor({ name: "toolchain-settings" });
  return cachedStore as Store;
}

/** Load persisted toolchain paths into process.env (called once at startup). */
export async function hydrateToolchainSettings(): Promise<void> {
  if (hydrated) return;
  const store = await getStore();
  const blenderPath = store.get<string>("blenderPath", "") || process.env.BLENDER_PATH || "";
  const blenderKitPath = store.get<string>("blenderKitPath", "") || process.env.BLENDERKIT_PATH || "";
  if (blenderPath) process.env.BLENDER_PATH = blenderPath;
  if (blenderKitPath) process.env.BLENDERKIT_PATH = blenderKitPath;
  hydrated = true;
}

export async function getBlenderPath(): Promise<string> {
  await hydrateToolchainSettings();
  return process.env.BLENDER_PATH ?? "";
}

export async function setBlenderPath(path: string): Promise<void> {
  const store = await getStore();
  const trimmed = path.trim();
  if (trimmed) {
    store.set("blenderPath", trimmed);
    process.env.BLENDER_PATH = trimmed;
  } else {
    store.set("blenderPath", "");
    delete process.env.BLENDER_PATH;
  }
}

export async function getBlenderKitPath(): Promise<string> {
  await hydrateToolchainSettings();
  return process.env.BLENDERKIT_PATH ?? "";
}

export async function setBlenderKitPath(path: string): Promise<void> {
  const store = await getStore();
  const trimmed = path.trim();
  if (trimmed) {
    store.set("blenderKitPath", trimmed);
    process.env.BLENDERKIT_PATH = trimmed;
  } else {
    store.set("blenderKitPath", "");
    delete process.env.BLENDERKIT_PATH;
  }
}