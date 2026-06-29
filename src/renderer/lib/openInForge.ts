/** Navigate to Forge 3D and open a local model path (disk). */
export async function openInForge(localPath: string): Promise<void> {
  await window.grudge.app.openRoute("/forge");
  await window.grudge.forge.openPath(localPath);
}

/** Navigate to Forge 3D and open a remote CDN model URL. */
export async function openRemoteInForge(url: string): Promise<void> {
  await window.grudge.app.openRoute("/forge");
  await window.grudge.forge.openRemote(url);
}