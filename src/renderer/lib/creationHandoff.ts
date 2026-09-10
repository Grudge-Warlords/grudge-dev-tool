import type { CreationBaseSource } from "../../shared/creationFlow";

export const CREATION_BASE_HANDOFF = "grudge.creation.pendingBase";
export const CREATION_REVISION_HANDOFF = "grudge.creation.pendingRevision";
export function useAssetAsCreationBase(source: CreationBaseSource) {
  sessionStorage.setItem(CREATION_BASE_HANDOFF, JSON.stringify(source));
  return window.grudge.app.openRoute("/prompt3d");
}
