const LS_MIRROR = "grudge:workspace-mirror";

export interface WorkspaceMirror {
  route?: string;
  legionChat?: Array<{ role: string; content: string; source?: string }>;
  browserPrefix?: string;
  searchQuery?: string;
  forgeLastUrl?: string;
  localAssetsRoot?: string;
}

/** Fast localStorage mirror — hydrates before electron-store IPC returns. */
export function readMirror(): WorkspaceMirror {
  try {
    const raw = localStorage.getItem(LS_MIRROR);
    return raw ? (JSON.parse(raw) as WorkspaceMirror) : {};
  } catch {
    return {};
  }
}

export function writeMirror(patch: WorkspaceMirror): void {
  try {
    const next = { ...readMirror(), ...patch };
    localStorage.setItem(LS_MIRROR, JSON.stringify(next));
  } catch { /* private mode */ }
}

export function clearMirror(): void {
  try { localStorage.removeItem(LS_MIRROR); } catch { /* ignore */ }
}

export async function hydrateFromMain(): Promise<WorkspaceMirror | null> {
  try {
    const snap = await window.grudge?.workspace?.get?.();
    if (!snap) return null;
    writeMirror(snap);
    return snap;
  } catch {
    return null;
  }
}

export async function persistRoute(route: string): Promise<void> {
  writeMirror({ route });
  try { await window.grudge?.workspace?.patch?.({ route }); } catch { /* offline */ }
}

export async function persistLegionChat(
  legionChat: Array<{ role: string; content: string; source?: string }>,
): Promise<void> {
  writeMirror({ legionChat });
  try { await window.grudge?.workspace?.patch?.({ legionChat }); } catch { /* offline */ }
}