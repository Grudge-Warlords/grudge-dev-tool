/**
 * Native Three Play hotkeys — Preview /play harness.
 * Not combat residuals. Not Forge edit QWER. WASD is locomotion only.
 */

export interface PlayHotkeyDef {
  keys: string;
  action: string;
  group: "move" | "look" | "anim" | "media" | "meta";
}

export const PLAY_HOTKEYS: PlayHotkeyDef[] = [
  { keys: "WASD", action: "Move (SI metres / s)", group: "move" },
  { keys: "Shift", action: "Sprint", group: "move" },
  { keys: "Space", action: "Jump", group: "move" },
  { keys: "LMB click canvas", action: "Pointer-lock look", group: "look" },
  { keys: "Esc", action: "Unlock mouse / pause move", group: "look" },
  { keys: "1–9", action: "Play clip index (one mixer)", group: "anim" },
  { keys: "0", action: "Idle / stop clip", group: "anim" },
  { keys: "V", action: "Toggle video plane", group: "media" },
  { keys: "H", action: "Toggle HUD", group: "meta" },
  { keys: "?", action: "Hotkey help", group: "meta" },
  { keys: "F5", action: "Reload default Toon kit", group: "meta" },
];

export const DEFAULT_PLAY_SETTINGS = {
  moveSpeed: 4,
  sprintMul: 1.7,
  mouseSens: 0.0022,
  jumpSpeed: 5.2,
  gravity: 18,
  eyeHeight: 1.55,
  cameraDistance: 3.6,
};

export type PlaySettings = typeof DEFAULT_PLAY_SETTINGS;

export function loadPlaySettings(): PlaySettings {
  try {
    const raw = localStorage.getItem("grudge-play-settings");
    if (!raw) return { ...DEFAULT_PLAY_SETTINGS };
    const o = JSON.parse(raw) as Partial<PlaySettings>;
    return { ...DEFAULT_PLAY_SETTINGS, ...o };
  } catch {
    return { ...DEFAULT_PLAY_SETTINGS };
  }
}

export function savePlaySettings(s: PlaySettings): void {
  try {
    localStorage.setItem("grudge-play-settings", JSON.stringify(s));
  } catch {
    /* ignore quota */
  }
}
