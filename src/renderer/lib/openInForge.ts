/**
 * Bridge Browser / Engine / Upload → 3D Studio (viewer) or Forge Quick 3D.
 */

import { writeMirror } from "./workspace";

const MODEL_RE = /\.(glb|gltf|fbx|obj|stl|ply|dae|3mf)$/i;

export function is3dAssetPath(nameOrUrl: string): boolean {
  try {
    const path = nameOrUrl.includes("://")
      ? new URL(nameOrUrl).pathname
      : nameOrUrl;
    return MODEL_RE.test(path);
  } catch {
    return MODEL_RE.test(nameOrUrl);
  }
}

/** Notify 3D Studio if already mounted (useWorkspaceField won't re-read mirror). */
function emitAssetStudioOpen(detail: { url?: string; path?: string }): void {
  try {
    window.dispatchEvent(new CustomEvent("grudge:asset-studio-open", { detail }));
  } catch {
    /* ignore */
  }
}

/**
 * Open local disk model in 3D Studio.
 * Delivery is single-path: pending workspace fields + event → AssetStudio loads once.
 * (Avoid calling forge.openPath here or the model loads twice when Studio is already open.)
 */
export async function openInForge(localPath: string): Promise<void> {
  writeMirror({ forgeMode: "quick", assetStudioPendingPath: localPath });
  await window.grudge.workspace?.patch?.({ forgeMode: "quick", assetStudioPendingPath: localPath });
  emitAssetStudioOpen({ path: localPath });
  await window.grudge.app.openRoute("/assets-3d");
}

/**
 * Open remote CDN model in Assets → 3D Studio.
 * Same single-path delivery as openInForge.
 */
export async function openRemoteInForge(url: string): Promise<void> {
  writeMirror({ forgeMode: "quick", assetStudioPendingUrl: url });
  await window.grudge.workspace?.patch?.({ forgeMode: "quick", assetStudioPendingUrl: url });
  emitAssetStudioOpen({ url });
  await window.grudge.app.openRoute("/assets-3d");
}

/** Browser helper: open R2 key on public CDN in 3D Studio. */
export async function openBrowserAssetIn3d(
  objectKey: string,
  cdnBase = "https://assets.grudge-studio.com",
): Promise<void> {
  const key = objectKey.replace(/^\/+/, "");
  const url = `${cdnBase.replace(/\/$/, "")}/${key}`;
  await openRemoteInForge(url);
}
