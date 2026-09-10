import { FLEET_URLS } from "./fleet";
import type { AppActionDecision, AppActionSnapshot } from "./appActions";

export const EMBEDDED_ACTION_CHANNELS = { observe: "appActions:embedded:observe", execute: "appActions:embedded:execute", windows: "appActions:windows" } as const;
export const EMBEDDED_SURFACES = {
  builder: { route: "/builder", name: "Builder", navLabel: "Grok Builder (lab)", origins: [FLEET_URLS.grokBuilder, "http://localhost:5190", "http://127.0.0.1:5190"] },
  forge: { route: "/forge", name: "Forge", origins: [FLEET_URLS.forge] },
  coder: { route: "/coder", name: "Coder", origins: [FLEET_URLS.coder] },
  threeflow: { route: "/threeflow", name: "ThreeFlow", origins: [FLEET_URLS.threeflow] },
  preview: { route: "/preview", name: "Preview", origins: [FLEET_URLS.open, FLEET_URLS.client, FLEET_URLS.water, FLEET_URLS.grudox, FLEET_URLS.multiverse, FLEET_URLS.warlords, FLEET_URLS.characterFoundry, FLEET_URLS.forge, FLEET_URLS.velocity, FLEET_URLS.avernus, FLEET_URLS.voxelStudio] },
} as const;
export type EmbeddedSurface = keyof typeof EMBEDDED_SURFACES;
export interface EmbeddedObserveRequest { surface: EmbeddedSurface | "app" | "window"; webContentsId: number }
export interface EmbeddedObservation { token: string; documentId: string; snapshot: AppActionSnapshot }
export interface EmbeddedExecuteRequest { token: string; prompt: string; decision: AppActionDecision }
export interface EmbeddedActionAPI {
  windows(): Promise<Array<{ id: number; title: string }>>;
  observe(request: EmbeddedObserveRequest): Promise<EmbeddedObservation>;
  execute(request: EmbeddedExecuteRequest): Promise<string>;
}

/** Preserve every instruction after an explicit embedded-app destination. */
export function embeddedPromptScope(prompt: string): { surface: EmbeddedSurface; prompt: string } | null {
  const match = prompt.trim().match(/^(?:(?:please\s+)?(?:open|go to)\s+(?:the\s+)?(?:embedded\s+)?(builder|forge|coder|threeflow|preview)(?:\s*[,;]\s*|\s+and\s+)|(?:in|inside|using)\s+(?:the\s+)?(?:embedded\s+)?(builder|forge|coder|threeflow|preview)\s*[,;:]\s*)(?:then\s+)?([\s\S]+)$/i);
  return match ? { surface: (match[1] || match[2]).toLowerCase() as EmbeddedSurface, prompt: match[3] } : null;
}

export function embeddedPlacementPrompt(prompt: string): { tab?: string; source: string; destination: string } | null {
  const match = prompt.trim().match(/^(?:(?:open|show)\s+([^,;]+?)(?:\s*[,;]\s*(?:then\s+)?|\s+and\s+(?:then\s+)?))?(?:drag|place)\s+(.+?)\s+(?:to|into)\s+(.+?)[.!]?$/i);
  if (match) return { tab: match[1]?.trim(), source: match[2].trim(), destination: match[3].trim() };
  const primitive = prompt.trim().match(/^(?:add|create|place)\s+(?:a|an)\s+(box|sphere|cone|cylinder|plane|torus|capsule)(?:\s+(?:to|in)\s+(?:the\s+)?scene)?[.!]?$/i);
  return primitive ? { tab: "Place", source: primitive[1], destination: "Scene viewport" } : null;
}
export function embeddedPlacementCount(status: string[], name: string): number {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hierarchy = status.find(s => /Scene hierarchy:/.test(s)) ?? "";
  return [...hierarchy.matchAll(new RegExp(`\\b${escaped}(?:Geometry)?\\b`, "gi"))].length;
}

export function embeddedSelectedObject(status: string[]): string | null {
  const value = status.find(s => s.includes("Selected object: "));
  return value ? value.slice(value.indexOf("Selected object: ") + "Selected object: ".length) : null;
}
export function embeddedSelectionMatches(value: string | null, name: string): boolean {
  const label = value?.split(" · ")[0].toLowerCase();
  return label === name.toLowerCase() || label === `${name.toLowerCase()}geometry`;
}
/** An applied drag needs changed editor evidence, never its dispatch alone.
 * ThreeFlow's live primitive handler currently leaves its hierarchy stale;
 * its public selected-object HUD does update and can establish the new result. */
export function embeddedPlacementConfirmed(status: string[], name: string, result?: string): boolean {
  if (!result || !result.toLowerCase().startsWith(`dragged ${name.toLowerCase()} to `)) return false;
  const beforeCount = Number(result.match(/Before placement count: (\d+)/)?.[1] ?? NaN);
  if (embeddedPlacementCount(status, name) > beforeCount) return true;
  const encoded = result.match(/Before selection: ("(?:\\.|[^"\\])*"|null)/)?.[1];
  if (!encoded) return false;
  try {
    const before: string | null = JSON.parse(encoded), after = embeddedSelectedObject(status);
    return before !== null && after !== before && embeddedSelectionMatches(after, name);
  } catch { return false; }
}

export function embeddedUrlAllowed(surface: EmbeddedSurface, url: string, localCoderUrl?: string | null): boolean {
  try {
    const target = new URL(url);
    if (target.username || target.password || !["https:", "http:"].includes(target.protocol)) return false;
    const config = EMBEDDED_SURFACES[surface];
    if (!config) return false;
    const origins: readonly string[] = config.origins;
    return origins.includes(target.origin) || surface === "coder" && Boolean(localCoderUrl && target.origin === new URL(localCoderUrl).origin);
  } catch { return false; }
}
