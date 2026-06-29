const LS_MIRROR = "grudge:workspace-mirror";

export interface WorkspaceMirror {
  route?: string;
  legionChat?: Array<{ role: string; content: string; source?: string }>;
  grudachainChat?: Array<{ role: string; content: string; source?: string; tools?: string[] }>;
  browserPrefix?: string;
  searchQuery?: string;
  forgeLastUrl?: string;
  localAssetsRoot?: string;
  coderRoot?: string;
  coderProjectDir?: string;
  coderPort?: number;
  engineRoot?: string;
  enginePort?: number;
  engineUseLocal?: boolean;
  engineTab?: "portal" | "characters" | "vfx";
  selectedCharacterId?: string;
  gamesTab?: "fleet" | "prototypes";
  uploadPrefix?: string;
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

export async function persistGrudachainChat(
  grudachainChat: Array<{ role: string; content: string; source?: string; tools?: string[] }>,
): Promise<void> {
  writeMirror({ grudachainChat });
  try { await window.grudge?.workspace?.patch?.({ grudachainChat }); } catch { /* offline */ }
}

export async function persistWorkspaceField<K extends keyof WorkspaceMirror>(
  field: K,
  value: WorkspaceMirror[K],
): Promise<void> {
  writeMirror({ [field]: value } as WorkspaceMirror);
  try { await window.grudge?.workspace?.patch?.({ [field]: value }); } catch { /* offline */ }
}