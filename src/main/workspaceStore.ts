import { session } from "electron";
import { resetR2Client } from "./cf/r2Direct";

/** Persisted UI + session memory — survives tray hide, restart, and page changes. */
export interface WorkspaceSnapshot {
  route: string;
  legionChat: Array<{ role: string; content: string; source?: string }>;
  grudachainChat: Array<{ role: string; content: string; source?: string; tools?: string[] }>;
  browserPrefix: string;
  searchQuery: string;
  forgeLastUrl: string;
  /** full = forge.grudge-studio.com webview; quick = in-process Forge3D */
  forgeMode: "full" | "quick";
  localAssetsRoot: string;
  coderRoot: string;
  coderProjectDir: string;
  coderPort: number;
  /** production = embed coder.grudge-studio.com; local = spawn GrudachainCode */
  coderMode: "production" | "local";
  engineRoot: string;
  enginePort: number;
  engineUseLocal: boolean;
  engineTab: "portal" | "characters" | "vfx";
  selectedCharacterId: string;
  gamesTab: "fleet" | "prototypes";
  uploadPrefix: string;
  updatedAt: number;
}

const DEFAULT: WorkspaceSnapshot = {
  route: "/home",
  legionChat: [],
  grudachainChat: [],
  browserPrefix: "",
  searchQuery: "",
  forgeLastUrl: "",
  forgeMode: "full",
  localAssetsRoot: "",
  coderRoot: "",
  coderProjectDir: "",
  coderPort: 5111,
  coderMode: "production",
  engineRoot: "",
  enginePort: 5000,
  engineUseLocal: false,
  engineTab: "characters",
  selectedCharacterId: "human_warrior",
  gamesTab: "fleet",
  uploadPrefix: "asset-packs/",
  updatedAt: 0,
};

interface Store {
  get<T>(key: string, defaultValue?: T): T;
  set<T>(key: string, value: T): void;
  clear(): void;
}

let cachedStore: Store | null = null;

async function getStore(): Promise<Store> {
  if (cachedStore) return cachedStore;
  const mod: any = await import("electron-store");
  const StoreCtor = mod.default ?? mod;
  cachedStore = new StoreCtor({ name: "grudge-workspace" });
  return cachedStore as Store;
}

export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  try {
    const store = await getStore();
    const saved = store.get<Partial<WorkspaceSnapshot>>("snapshot", {});
    return { ...DEFAULT, ...saved, updatedAt: saved.updatedAt ?? 0 };
  } catch {
    return { ...DEFAULT };
  }
}

export async function saveWorkspace(patch: Partial<WorkspaceSnapshot>): Promise<WorkspaceSnapshot> {
  const store = await getStore();
  const current = await loadWorkspace();
  const next: WorkspaceSnapshot = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  };
  store.set("snapshot", next);
  return next;
}

export async function exportWorkspaceJson(): Promise<string> {
  const snap = await loadWorkspace();
  return JSON.stringify(snap, null, 2);
}

export async function importWorkspaceJson(raw: string): Promise<WorkspaceSnapshot> {
  const parsed = JSON.parse(raw) as Partial<WorkspaceSnapshot>;
  return saveWorkspace(parsed);
}

export async function resetWorkspace(): Promise<void> {
  const store = await getStore();
  store.set("snapshot", { ...DEFAULT, updatedAt: Date.now() });
}

const WEBVIEW_PARTITIONS = [
  "persist:grudge-preview",
  "persist:grudge-coder",
  "persist:grudge-forge",
  "persist:grudge-playcanvas",
  "persist:grudge-engine-portal",
  "persist:grudge-character-viewer",
];

/** Clear HTTP cache, webview storage, and in-memory R2 client. */
export async function clearAppCaches(): Promise<string[]> {
  const cleared: string[] = [];
  try {
    await session.defaultSession.clearCache();
    cleared.push("default-http-cache");
    await session.defaultSession.clearStorageData({
      storages: ["cachestorage", "serviceworkers", "shadercache"],
    });
    cleared.push("default-storage");
  } catch { /* ignore */ }

  for (const part of WEBVIEW_PARTITIONS) {
    try {
      const partSession = session.fromPartition(part);
      await partSession.clearCache();
      await partSession.clearStorageData();
      cleared.push(part);
    } catch { /* ignore */ }
  }

  try {
    resetR2Client();
    cleared.push("r2-s3-client");
  } catch { /* ignore */ }

  return cleared;
}