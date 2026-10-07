export const APP_NATIVE_CHANNELS = { syncText: "appActions:native:syncText", begin: "appActions:native:begin", end: "appActions:native:end", dialog: "appActions:native:dialog", browse: "appActions:native:browse", answer: "appActions:native:answer", request: "appActions:native:request", status: "appActions:native:status", mkdir: "appActions:native:mkdir" } as const;
export interface AppDialog {
  id: string;
  kind: "open" | "save" | "message" | "text";
  title: string;
  message: string;
  defaultPath: string;
  buttons: string[];
  cancelId: number;
  directory: boolean;
  multiple: boolean;
  createDirectory?: boolean;
  filters: Array<{ name: string; extensions: string[] }>;
  checkboxLabel?: string;
  checkboxChecked?: boolean;
}
export interface AppDialogAnswer { id: string; response: number; paths?: string[]; text?: string; checkboxChecked?: boolean; overwrite?: boolean }
export interface AppDialogListing { path: string; parent: string; entries: Array<{ name: string; path: string; directory: boolean }>; more: boolean }
export interface AppNativeAPI {
  begin(): Promise<void>;
  end(): Promise<void>;
  dialog(): Promise<AppDialog | null>;
  browse(id: string, path: string, offset?: number): Promise<AppDialogListing>;
  mkdir(id: string, path: string, name: string): Promise<AppDialogListing>;
  status(): Promise<string[]>;
  answer(answer: AppDialogAnswer): Promise<void>;
  request(kind: "confirm" | "text", message: string, value?: string): Promise<string | boolean | null>;
}
export type InputModifier = "control" | "shift" | "alt" | "meta";
export type NativePointer = { gesture: "click" | "double-click" | "drag" | "wheel" | "move"; x: number; y: number; toX?: number; toY?: number; button?: "left" | "middle" | "right"; deltaX?: number; deltaY?: number; modifiers?: InputModifier[] };
export function parsePointer(value: string): NativePointer {
  let p: NativePointer;
  try { p = JSON.parse(value); } catch { throw new Error("Pointer input needs a JSON gesture."); }
  const unit = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
  if (!p || !["click", "double-click", "drag", "wheel", "move"].includes(p.gesture) || !unit(p.x) || !unit(p.y) || p.gesture === "drag" && (!unit(p.toX) || !unit(p.toY)) || p.button && !["left", "middle", "right"].includes(p.button) || [p.deltaX, p.deltaY].some(v => v !== undefined && (!Number.isFinite(v) || Math.abs(v) > 2000)) || p.modifiers && (!Array.isArray(p.modifiers) || p.modifiers.length > 4 || p.modifiers.some(v => !["control", "shift", "alt", "meta"].includes(v)))) throw new Error("Invalid bounded pointer gesture.");
  return p;
}
export function parseKeys(value: string): { keyCode: string; modifiers: InputModifier[] } {
  const parts = value.split("+");
  const keyCode = parts.pop() ?? "";
  const aliases: Record<string, InputModifier> = { ctrl: "control", control: "control", shift: "shift", alt: "alt", meta: "meta", cmd: "meta", command: "meta" };
  if (parts.some(p => !aliases[p.toLowerCase()]) || !/^(?:[a-z0-9]|F(?:[1-9]|1[0-2])|Enter|Tab|Escape|Space|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Plus|Minus|Comma|Period|Slash|Backslash|Semicolon|Quote|BracketLeft|BracketRight)$/i.test(keyCode)) throw new Error("Invalid app keyboard shortcut.");
  return { keyCode, modifiers: parts.map(p => aliases[p.toLowerCase()]) };
}
