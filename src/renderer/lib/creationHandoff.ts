import type { CreationBaseSource } from "../../shared/creationFlow";

export const CREATION_BASE_HANDOFF = "grudge.creation.pendingBase";
export function useAssetAsCreationBase(source: CreationBaseSource) {
  sessionStorage.setItem(CREATION_BASE_HANDOFF, JSON.stringify(source));
  return window.grudge.app.openRoute("/prompt3d");
}
