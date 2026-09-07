interface ControlsStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

import type { AssetSpecV1 } from "../../shared/prompt3d";
import { PROMPT3D_SPEC_VERSION } from "../../shared/prompt3d";

let storePromise: Promise<ControlsStore> | null = null;

function getStore(): Promise<ControlsStore> {
  if (!storePromise) {
    storePromise = import("electron-store").then((module) => {
      const Store = module.default;
      return new Store({
        name: "prompt3d-preferences",
        defaults: { localControlsEnabled: false },
      }) as unknown as ControlsStore;
    }).catch((error) => {
      storePromise = null;
      throw error;
    });
  }
  return storePromise;
}

/** Store the user's choice only; window capability secrets stay in memory. */
export async function localControlsEnabled(): Promise<boolean> {
  return (await getStore()).get("localControlsEnabled") === true;
}

export async function saveLocalControlsEnabled(enabled: boolean): Promise<void> {
  (await getStore()).set("localControlsEnabled", enabled);
}

export async function loadPlannerHost(): Promise<string | undefined> {
  const value = (await getStore()).get("plannerHost");
  return typeof value === "string" ? value : undefined;
}

export async function savePlannerHost(value: string): Promise<string> {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Use an uncredentialed loopback Ollama URL.");
  (await getStore()).set("plannerHost", url.origin);
  return url.origin;
}

function assertDraft(value: unknown): asserts value is AssetSpecV1 {
  const draft = value as AssetSpecV1 | null;
  if (!draft || draft.version !== PROMPT3D_SPEC_VERSION || typeof draft.prompt !== "string" || draft.prompt.length > 2000
    || !draft.dimensions || !draft.budgets || !draft.coordinateContract || JSON.stringify(draft).length > 16000) {
    throw new Error("Invalid Prompt-to-3D draft.");
  }
}

export async function loadPrompt3DDraft(): Promise<AssetSpecV1 | null> {
  const value = (await getStore()).get("assetBrief");
  if (value == null) return null;
  assertDraft(value);
  return value;
}

export async function savePrompt3DDraft(draft: AssetSpecV1): Promise<void> {
  assertDraft(draft);
  (await getStore()).set("assetBrief", draft);
}
