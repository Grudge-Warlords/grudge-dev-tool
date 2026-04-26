import { BrowserWindow, screen, Rectangle } from "electron";

interface State {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

const DEFAULT: State = { width: 1100, height: 720 };

interface Store {
  get<T>(key: string, defaultValue?: T): T;
  set<T>(key: string, value: T): void;
}

let cachedStore: Store | null = null;
async function getStore(): Promise<Store> {
  if (cachedStore) return cachedStore;
  // electron-store v10 is ESM-only; load via dynamic import.
  const mod: any = await import("electron-store");
  const StoreCtor = mod.default ?? mod;
  cachedStore = new StoreCtor({ name: "window-state" });
  return cachedStore as Store;
}

/** Snap the rectangle to the nearest visible display so the window can never
 *  spawn off-screen (after monitor disconnect, resolution change, etc). */
function clampToDisplay(state: State): State {
  const displays = screen.getAllDisplays();
  const candidate: Rectangle = {
    x: state.x ?? 0,
    y: state.y ?? 0,
    width: state.width,
    height: state.height,
  };
  const onScreen = displays.some((d) => {
    const a = d.workArea;
    return (
      candidate.x + candidate.width  > a.x &&
      candidate.y + candidate.height > a.y &&
      candidate.x < a.x + a.width &&
      candidate.y < a.y + a.height
    );
  });
  if (onScreen) return state;
  const primary = screen.getPrimaryDisplay().workArea;
  return {
    width: Math.min(state.width, primary.width),
    height: Math.min(state.height, primary.height),
    x: primary.x + Math.max(0, Math.round((primary.width  - state.width)  / 2)),
    y: primary.y + Math.max(0, Math.round((primary.height - state.height) / 2)),
    maximized: state.maximized,
  };
}

export async function loadWindowState(): Promise<State> {
  try {
    const store = await getStore();
    const saved = store.get<Partial<State>>("main", {});
    const merged: State = { ...DEFAULT, ...saved };
    return clampToDisplay(merged);
  } catch {
    return DEFAULT;
  }
}

/** Attach save-on-change handlers to a BrowserWindow. */
export function track(win: BrowserWindow): void {
  let pendingSave: NodeJS.Timeout | null = null;
  const save = () => {
    if (win.isDestroyed()) return;
    if (pendingSave) clearTimeout(pendingSave);
    pendingSave = setTimeout(async () => {
      try {
        const store = await getStore();
        const bounds = win.getNormalBounds();  // ignores maximize/minimize
        store.set<State>("main", {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          maximized: win.isMaximized(),
        });
      } catch { /* ignore */ }
    }, 400);  // debounce so we don't hammer disk during a drag-resize
  };
  win.on("resize", save);
  win.on("move", save);
  win.on("maximize", save);
  win.on("unmaximize", save);
  win.on("close", () => { if (pendingSave) clearTimeout(pendingSave); save(); });
}
