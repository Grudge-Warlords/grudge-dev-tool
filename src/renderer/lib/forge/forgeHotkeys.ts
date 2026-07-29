/**
 * Central Forge hotkey map — UI help + consistent binding docs.
 */

export interface HotkeyDef {
  keys: string;
  action: string;
  group: "viewport" | "tools" | "edit" | "anim" | "file";
}

export const FORGE_HOTKEYS: HotkeyDef[] = [
  // Viewport / frame
  { keys: "F", action: "Frame selection", group: "viewport" },
  { keys: "Shift+F", action: "Frame all scene objects", group: "viewport" },
  { keys: "Home", action: "Camera home (default studio view)", group: "viewport" },
  { keys: "H", action: "Toggle grid / axes helpers", group: "viewport" },
  { keys: "Space", action: "Pause / resume active animation", group: "anim" },
  { keys: "1–9", action: "Play clip index on selection", group: "anim" },
  { keys: "0", action: "Stop animation", group: "anim" },
  { keys: "Shift+A", action: "Add procedural spin (unrigged-friendly)", group: "anim" },
  // Tools
  { keys: "Q", action: "Select", group: "tools" },
  { keys: "W", action: "Move", group: "tools" },
  { keys: "E", action: "Rotate", group: "tools" },
  { keys: "R", action: "Scale", group: "tools" },
  { keys: "B", action: "3D paint brush", group: "tools" },
  { keys: "V", action: "Blend paint", group: "tools" },
  { keys: "G", action: "Fill color", group: "tools" },
  { keys: "M", action: "Fix mesh", group: "tools" },
  { keys: "T", action: "Fix terrain", group: "tools" },
  { keys: "K", action: "Seal back", group: "tools" },
  { keys: "N", action: "Flip normals", group: "tools" },
  { keys: "J", action: "Weld", group: "tools" },
  { keys: "I", action: "Island prep", group: "tools" },
  { keys: "Shift+S", action: "Smooth normals", group: "tools" },
  { keys: "End", action: "Ground snap Y=0", group: "tools" },
  { keys: "[ ]", action: "Brush radius down / up", group: "tools" },
  { keys: "; '", action: "Brush strength down / up", group: "tools" },
  // Edit
  { keys: "Ctrl+Z", action: "Undo", group: "edit" },
  { keys: "Ctrl+Y / Ctrl+Shift+Z", action: "Redo", group: "edit" },
  { keys: "Ctrl+C / X / V", action: "Copy / Cut / Paste", group: "edit" },
  { keys: "Ctrl+D", action: "Duplicate", group: "edit" },
  { keys: "Delete", action: "Remove selection", group: "edit" },
  // File
  { keys: "Ctrl+S", action: "Save scene JSON", group: "file" },
  { keys: "Ctrl+O", action: "Open model file", group: "file" },
  { keys: "?", action: "Toggle hotkey help", group: "viewport" },
];

export function hotkeysByGroup(): Record<string, HotkeyDef[]> {
  const out: Record<string, HotkeyDef[]> = {};
  for (const h of FORGE_HOTKEYS) {
    (out[h.group] ??= []).push(h);
  }
  return out;
}
