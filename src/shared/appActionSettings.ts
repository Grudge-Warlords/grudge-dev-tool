import type { AppControl } from "./appActions";

/** Retain literal field identities even before their panel is open. */
export function requestedAppSettingNames(prompt: string): string[] | null {
  if (!/^(?:please\s+)?(?:set|change)\s+/i.test(prompt.trim())) return null;
  const clauses = appPromptClauses(prompt.trim());
  if (!clauses.length || clauses.length > 12) return null;
  const names = clauses.map(clause => clause.match(/^(?:(?:please\s+)?(?:set|change)\s+)?(?:the\s+)?(.+?)\s+(?:to|as)\s+[\s\S]+$/i)?.[1].trim());
  return names.every(Boolean) ? names as string[] : null;
}
export const appSettingLabelMatches = (a: string, b: string) => a.toLowerCase().replace(/[-_\s]+/g, " ").trim() === b.toLowerCase().replace(/[-_\s]+/g, " ").trim();

export function appPromptClauses(prompt: string): string[] {
  const clauses: string[] = [];
  let start = 0, quote = "";
  for (let i = 0; i < prompt.length; i++) {
    const char = prompt[i];
    if (quote) { if (char === quote) quote = ""; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    const separator = prompt.slice(i).match(/^(?:\s+(?:and(?:\s+then)?|then)\s+|;\s*|,\s*(?:(?:and\s+)?then\s+|and\s+)?)/i);
    if (separator) { clauses.push(prompt.slice(start, i).trim()); i += separator[0].length - 1; start = i + 1; }
  }
  clauses.push(prompt.slice(start).trim());
  return clauses;
}

/** Bind only completely understood literal assignments; never omit a clause. */
export function literalAppSettings(prompt: string, controls: AppControl[]): Array<{ control: AppControl; value: string }> | null {
  if (!/^(?:please\s+)?(?:set|change)\s+/i.test(prompt.trim())) return null;
  const clauses = appPromptClauses(prompt.trim());
  if (clauses.length > 12) return null;
  const settings: Array<{ control: AppControl; value: string }> = [];
  const normalize = (s: string) => s.toLowerCase().replace(/[-_\s]+/g, " ").trim();
  for (const clause of clauses) {
    const candidates = controls.filter(c => !c.disabled && c.kind !== "click").flatMap(control => {
      const name = control.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      const match = clause.match(new RegExp(`^(?:(?:please\\s+)?(?:set|change)\\s+)?(?:the\\s+)?${name}\\s+(?:to|as)\\s+([\\s\\S]+)$`, "i"));
      return match ? [{ control, raw: match[1].trim() }] : [];
    });
    if (candidates.length !== 1) return null;
    const { control, raw } = candidates[0];
    const quoted = raw.match(/^(?:"([\s\S]*)"|'([\s\S]*)')[.!]?$/);
    const value = quoted ? quoted[1] ?? quoted[2] : raw.replace(/[.!]$/, "");
    if (control.kind === "select") {
      const choices = control.options?.filter(o => normalize(o.value) === normalize(value) || normalize(o.label) === normalize(value));
      if (choices?.length !== 1) return null;
      settings.push({ control, value: choices[0].value });
    } else if (control.kind === "toggle") {
      if (!/^(?:true|false|on|off|enabled|disabled)$/i.test(value)) return null;
      settings.push({ control, value: /^(?:true|on|enabled)$/i.test(value) ? "true" : "false" });
    } else if (["number", "range"].includes(control.inputType ?? "")) {
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(Number(value))) return null;
      settings.push({ control, value });
    } else if (control.inputType === "color" && /^#[a-f\d]{6}$/i.test(value)) settings.push({ control, value: value.toLowerCase() });
    else if (quoted) settings.push({ control, value });
    else return null;
  }
  // Conflicting assignments to one field require a real sequence, not a final-value check.
  if (new Set(settings.map(s => s.control.id)).size !== settings.length) return null;
  return settings;
}
