import { hasAffirmativePromptMatch } from "./promptedMotionIntent";
import { literalAppSettings, requestedAppSettingNames, appSettingLabelMatches } from "./appActionSettings";
import { EMBEDDED_SURFACES, embeddedPromptScope, embeddedPlacementPrompt, embeddedPlacementConfirmed } from "./embeddedActions";
/** App-wide prompt actions operate the same controls as a person, never arbitrary code or IPC. */
export const APP_ACTION_CHANNELS = { plan: "appActions:plan" } as const;
export interface AppControl {
  id: string;
  label: string;
  kind: "click" | "text" | "select" | "toggle" | "drag" | "drop";
  context: string;
  disabled: boolean;
  value?: string;
  inputType?: string;
  options?: Array<{ value: string; label: string }>;
}
export interface AppActionSnapshot {
  route: string;
  controls: AppControl[];
  status: string[];
}
export interface AppActionRequest {
  prompt: string;
  snapshot: AppActionSnapshot;
  history: Array<{ action: string; result: string }>;
}
export interface AppActionDecision {
  action: "click" | "set" | "drag" | "wait" | "done" | "blocked";
  target: string;
  value: string;
  reason: string;
  model: string;
}

export function validateAppActionRequest(value: AppActionRequest): AppActionRequest {
  if (!value || typeof value.prompt !== "string" || !value.prompt.trim() || value.prompt.length > 2000 || !value.snapshot || typeof value.snapshot.route !== "string" || value.snapshot.route.length > 200 || !Array.isArray(value.snapshot.controls) || value.snapshot.controls.length > 300 || !Array.isArray(value.snapshot.status) || value.snapshot.status.length > 30 || value.snapshot.status.some(s => typeof s !== "string" || s.length > 600) || !Array.isArray(value.history) || value.history.length > 40) throw new Error("Invalid app action context.");
  for (const c of value.snapshot.controls) {
    if (!c || typeof c.id !== "string" || !/^(?:embedded-\d+-)?control-\d+$/.test(c.id) || typeof c.label !== "string" || !c.label || c.label.length > 220 || typeof c.context !== "string" || c.context.length > 220 || !["click", "text", "select", "toggle", "drag", "drop"].includes(c.kind) || typeof c.disabled !== "boolean" || (c.value !== undefined && (typeof c.value !== "string" || c.value.length > 2200))) throw new Error("Invalid app control.");
    if (c.options && (!Array.isArray(c.options) || c.options.length > 100 || c.options.some(o => !o || typeof o.value !== "string" || o.value.length > 500 || typeof o.label !== "string" || o.label.length > 220))) throw new Error("Invalid app choices.");
    if (c.inputType !== undefined && (typeof c.inputType !== "string" || c.inputType.length > 30)) throw new Error("Invalid input type.");
  }
  if (new Set(value.snapshot.controls.map(c => c.id)).size !== value.snapshot.controls.length) throw new Error("App controls must have unique identities.");
  for (const h of value.history) if (!h || typeof h.action !== "string" || h.action.length > 600 || typeof h.result !== "string" || h.result.length > 1200) throw new Error("Invalid app action history.");
  return value;
}

export function appControlValueMatches(control: AppControl, requested: string): boolean {
  if (control.value === requested) return true;
  if (["number", "range"].includes(control.inputType ?? "")) return Boolean(control.value?.trim() && requested.trim()) && Number.isFinite(Number(control.value)) && Number.isFinite(Number(requested)) && Number(control.value) === Number(requested);
  return control.inputType === "color" && control.value?.toLowerCase() === requested.toLowerCase();
}

/** Legacy boolean markers label visible text; explicit result markers retain exact paths. */
export function appActionStatusText(marker: string | null, text: string): string {
  return marker && marker !== "true" && marker !== "false" ? marker.slice(0, 600) : text.replace(/\s+/g, " ").trim().slice(0, 600);
}

export function validateAppActionDecision(raw: unknown, request: AppActionRequest): Omit<AppActionDecision, "model"> {
  const d = raw as AppActionDecision;
  if (!d || !["click", "set", "drag", "wait", "done", "blocked"].includes(d.action) || typeof d.target !== "string" || typeof d.value !== "string" || d.value.length > 2200 || typeof d.reason !== "string" || !d.reason.trim() || d.reason.length > 600) throw new Error("Grudge returned an invalid app action.");
  const scope = embeddedPromptScope(request.prompt);
  const settingNames = requestedAppSettingNames(scope?.prompt ?? request.prompt);
  if (d.action === "click" || d.action === "set" || d.action === "drag") {
    const c = request.snapshot.controls.find(c => c.id === d.target);
    if (!c || c.disabled) throw new Error("The requested control is unavailable. Refresh the screen before acting.");
    if (settingNames && d.action === "set" && !settingNames.some(name => appSettingLabelMatches(name, c.label))) throw new Error("Only the named fields may receive the requested values.");
    if (settingNames && c.id.startsWith("embedded-") && (d.action === "drag" || d.action === "click" && c.value !== "false")) throw new Error("A field request may only change its named fields or open a closed panel.");
    if (d.action === "drag") {
      const destination = request.snapshot.controls.find(c => c.id === d.value);
      if (c.kind !== "drag" || !destination || destination.kind !== "drop" || destination.disabled || c.context.split(" · ")[0] !== destination.context.split(" · ")[0]) throw new Error("Drag needs an observed source and destination in the same embedded tool.");
    }
    if (d.action === "set" && !["text", "select", "toggle"].includes(c.kind)) throw new Error("That control does not accept a value.");
    if (d.action === "click" && c.kind !== "click") throw new Error("Use an explicit value to change an input.");
    if (d.action === "click" && d.value) throw new Error("A click cannot also enter a value.");
    if (c.kind === "select" && !c.options?.some(o => o.value === d.value)) throw new Error("The requested choice is not available.");
    if (c.kind === "toggle" && !["true", "false"].includes(d.value)) throw new Error("A toggle needs true or false.");
    // Normal app confirmations still apply. The planner cannot invent an approval
    // or turn a creation request into publishing, purchasing or signing in.
    const gates: Array<[RegExp, RegExp]> = [
      [/\b(approve|accept|attest|license|consent)\b/i, /\b(approve|accept|attest|agree|consent)\b/i],
      [/\b(publish|deploy|upload|send|share|purchase|buy|pay|mint)\b/i, /\b(publish|deploy|upload|send|share|purchase|buy|pay|mint)\b/i],
      [/\b(delete|purge|erase|uninstall|reset|remove|clear)\b/i, /\b(delete|purge|erase|uninstall|reset|remove|clear)\b/i],
      [/\b(install|download)\b/i, /\b(install|download)\b/i],
      [/\b(sign.?out|log.?out|quit|exit)\b/i, /\b(sign.?out|log.?out|quit|exit)\b/i],
    ];
    for (const [control, intent] of gates) if (control.test(c.label) && !hasAffirmativePromptMatch(request.prompt, intent)) throw new Error(`“${c.label}” needs an explicit request. No action was taken.`);
  } else if (d.target || d.value) throw new Error("Only a control action may contain a target or value.");
  const scopedControls = scope ? request.snapshot.controls.filter(c => c.context.startsWith(`Embedded ${EMBEDDED_SURFACES[scope.surface].name}`)) : request.snapshot.controls;
  const settings = d.action === "done" ? literalAppSettings(scope?.prompt ?? request.prompt, scopedControls) : null;
  if (d.action === "done" && settingNames && !settings) throw new Error("The requested fields and values have not been established.");
  const placement = request.snapshot.route === "/threeflow" ? embeddedPlacementPrompt(scope?.prompt ?? request.prompt) : null;
  if (d.action === "done" && placement) {
    const previous = request.history.find(h => h.result.toLowerCase().startsWith(`dragged ${placement.source.toLowerCase()} to `));
    if (!embeddedPlacementConfirmed(request.snapshot.status, placement.source, previous?.result)) throw new Error("The scene has not confirmed a newly placed object.");
  }
  if (d.action === "done" && scope && (request.snapshot.route !== EMBEDDED_SURFACES[scope.surface].route || !scopedControls.length)) throw new Error("The requested embedded app has not exposed its controls yet.");
  if (settings && settings.some(s => !appControlValueMatches(s.control, s.value))) throw new Error("Some requested settings have not reached their requested values.");
  if (d.action === "done" && !request.history.length && !settings) throw new Error("No app action has run yet; completion is not established.");
  if (d.action === "done" && request.snapshot.status.some(s => /An app action is running|Prompt did not complete|Attempt failed/i.test(s))) throw new Error("The app has not completed the requested operation.");
  if (d.action === "done" && request.history.some(h => h.result.startsWith("Set Creation prompt")) && !/\b(?:set|fill|draft|type)\b[^.;]{0,50}\bprompt\b/i.test(request.prompt)) {
    if (!request.history.some(h => h.result.startsWith("Activated Run prompt")) || !request.snapshot.status.some(s => /Saved revision/.test(s))) throw new Error("The creation prompt has not produced a saved revision.");
  }
  return { action: d.action, target: d.target, value: d.value, reason: d.reason };
}
