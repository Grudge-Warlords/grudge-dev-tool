import type { AppControl, AppActionRequest } from "./appActions";
import type { NativePointer } from "./appNative";

/** Literal navigation goes to the existing viewport, never a brush or generator. */
export function appNativeIntent(request: AppActionRequest): { control: AppControl; action: "pointer" | "keys"; value: string; completed: boolean; saving: boolean } | null {
  const scroll = request.prompt.trim().match(/^scroll\s+(?:the\s+)?(.+?)\s+(up|down|left|right)[.!]?$/i);
  if (scroll) {
    const normalize = (text: string) => text.toLowerCase().replace(/^scroll\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
    const matches = request.snapshot.controls.filter(c => !c.disabled && c.inputType === "scroll" && normalize(c.label) === normalize(scroll[1]));
    if (matches.length === 1) {
      const control = matches[0], direction = scroll[2].toLowerCase();
      const value = JSON.stringify({ gesture: "wheel", x: .5, y: .5, ...(["up", "down"].includes(direction) ? { deltaY: direction === "up" ? 360 : -360 } : { deltaX: direction === "left" ? 360 : -360 }) });
      const before = request.history.find(h => h.action === `pointer ${control.id} ${value}`)?.result.match(/\[Before input: ([^\]]+)\]/)?.[1];
      return { control, action: "pointer", value, completed: Boolean(before && control.value && before !== control.value), saving: false };
    }
  }
  const canvases = request.snapshot.controls.filter(c => !c.disabled && c.inputType === "canvas");
  if (canvases.length !== 1) return null;
  const control = canvases[0], prompt = request.prompt.trim();
  const shortcut = prompt.match(/^(?:please\s+)?press\s+(?:the\s+)?((?:(?:ctrl|control|shift|alt|meta)\+)*(?:[a-z0-9]|F\d{1,2}|Enter|Escape|Tab|Home|End|Delete|Backspace|Up|Down|Left|Right))(?:\s+key)?(?:\s+in\s+(?:the\s+)?(?:scene\s+)?(?:canvas|viewport))?[.!]?$/i)?.[1];
  const saving = /^save\b/i.test(prompt) && /\busing\s+ctrl\+s\b/i.test(prompt);
  if (shortcut || saving) {
    const value = saving ? "Ctrl+S" : shortcut!;
    return { control, action: "keys", value, completed: request.history.some(h => h.action === `keys ${control.id} ${value}`), saving };
  }
  if (!/^(?:please\s+)?(?:orbit|pan|zoom)\b/i.test(prompt) || /\b(?:then|and|save|export)\b/i.test(prompt)) return null;
  const direction = prompt.match(/\b(left|right|up|down|in|out)\b/i)?.[1]?.toLowerCase();
  if (!direction) return null;
  const orbit = /\borbit\b/i.test(prompt), zoom = /\bzoom\b/i.test(prompt);
  const rightOrbits = /right drag: orbit/i.test(control.hint ?? "");
  // A foreign editor supplies its own hint. Do not assume our mouse map there.
  if (!zoom && !rightOrbits) return null;
  const gesture: NativePointer = zoom ? { gesture: "wheel", x: .5, y: .5, deltaY: direction === "in" ? 120 : -120 } : {
    gesture: "drag", button: orbit ? "right" : "left", x: .55, y: .45,
    toX: direction === "left" ? .4 : direction === "right" ? .7 : .55,
    toY: direction === "up" ? .3 : direction === "down" ? .6 : .45,
  };
  const value = JSON.stringify(gesture);
  const action = request.history.find(h => h.action === `pointer ${control.id} ${value}`);
  const before = action?.result.match(/\[Before input: ([^\]]+)\]/)?.[1];
  const camera = request.snapshot.status.find(s => /Camera position:/.test(s));
  return { control, action: "pointer", value, completed: Boolean(before && camera && !camera.includes(before)), saving: false };
}
