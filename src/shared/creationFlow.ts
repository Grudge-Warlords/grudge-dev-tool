import type { AssetCategory, AssetStyle, Prompt3DOrchestrationRecord } from "./prompt3d";

export const CREATION_CATEGORIES: AssetCategory[] = ["prop", "character", "building", "road-furniture", "environment", "vehicle"];
export const CREATION_STYLES: AssetStyle[] = ["stylized", "low-poly", "realistic", "hand-painted", "industrial", "custom"];
export const CREATION_BUILD = "local-flow-2026-09-09.3";
export const CREATION_PRIMITIVES = ["box", "sphere", "cylinder", "cone", "plane", "torus"] as const;
export type CreationKind = "sword" | "game-gun" | "person" | typeof CREATION_PRIMITIVES[number] | "existing-asset" | "assembly";
export interface CreationComponent {
  name: string;
  shape: typeof CREATION_PRIMITIVES[number];
  position: [number, number, number];
  size: [number, number, number];
  color: string;
}
export function validateCreationComponent(raw: unknown): CreationComponent {
  const c = raw as CreationComponent;
  if (!c || typeof c.name !== "string" || !c.name.trim() || c.name.length > 80 || !CREATION_PRIMITIVES.includes(c.shape) || typeof c.color !== "string" || !/^#[0-9a-f]{6}$/i.test(c.color)) throw new Error("Invalid assembly component.");
  for (const field of ["position", "size"] as const) if (!Array.isArray(c[field]) || c[field].length !== 3 || c[field].some(n => typeof n !== "number" || !Number.isFinite(n) || (field === "size" ? n < .01 || n > 200 : Math.abs(n) > 500))) throw new Error(`Invalid component ${field}.`);
  return { name: c.name.trim(), shape: c.shape, color: c.color, position: [...c.position], size: [...c.size] };
}
export type CreationMethod = "original-procedural" | "existing-asset";
export type CreationBaseSource = { kind: "local-file"; path: string } | { kind: "objectstore"; key: string };
export interface CreationSourceRecord {
  source: CreationBaseSource;
  sha256: string;
  byteSize: number;
  identity: Record<string, unknown>;
}
export type CreationOperation = "create" | "reuse" | "texture" | "enhance" | "adjust" | "swipe" | "projectile" | "dance" | "turntable" | "edit";
export interface CreationEdit {
  action: "move" | "rotate" | "scale" | "color" | "clear-animation" | "duplicate" | "rename" | "remove" | "add";
  /** Exact, unique node names, or $asset for the entire scene. */
  targets: string[];
  /** Relative XYZ translation in metres, local Euler degrees, or scale multipliers. */
  value?: [number, number, number];
  color?: string;
  name?: string;
  parts?: CreationComponent[];
}
export interface CreationAdjustments {
  cosmeticDetail?: boolean;
  bladeLength?: number;
  bladeWidth?: number;
  curveDelta?: number;
  guardWidth?: number;
  propLength?: number;
  propBulk?: number;
  muzzleSize?: number;
  personHeight?: number;
  personWidth?: number;
  headSize?: number;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
}
export interface CreationRequest {
  prompt: string;
  category: AssetCategory;
  style: AssetStyle;
  usePlanner: boolean;
  parentId?: string;
  baseSource?: CreationBaseSource;
  orchestration?: Prompt3DOrchestrationRecord;
}
export interface CreationPlan {
  kind: CreationKind;
  operation: CreationOperation;
  curved?: boolean;
  adjustments?: CreationAdjustments;
  changes?: string[];
  summary: string;
  constraints: string[];
  planner: string;
  components?: CreationComponent[];
  edit?: CreationEdit;
  promptBuild?: { id: string; prompt: string; model: string; step: number; totalSteps: number };
}
export interface CreationAttempt {
  version: 1;
  id: string;
  assetId: string;
  parentId?: string;
  createdAt: string;
  updatedAt: string;
  request: CreationRequest;
  state: "running" | "complete" | "failed";
  method: CreationMethod;
  sourceAssets?: CreationSourceRecord[];
  build: string;
  sourceRevision: string;
  plan?: CreationPlan;
  assetPath?: string;
  sha256?: string;
  parentSha256?: string;
  geometryHash?: string;
  previousGeometryHash?: string;
  sceneHash?: string;
  previousSceneHash?: string;
  partNames?: string[];
  validation?: { triangles: number; textures: number; clips: string[]; articulatedNodes: number; detailNodes: number; selfContained: boolean; geometryPreserved: boolean; geometryChanged: boolean; checks: string[] };
  message: string;
}
export interface CreationLibraryAsset {
  version: 1;
  id: string;
  attemptId: string;
  assetId: string;
  name: string;
  savedPath: string;
  savedAt: string;
  byteSize: number;
  sha256: string;
  geometryHash?: string;
  kind?: CreationKind;
  prompt: string;
  category: AssetCategory;
  style: AssetStyle;
  build: string;
  method: CreationMethod;
  sourceAssets?: CreationSourceRecord[];
}
export interface CreationSaveResult {
  asset: CreationLibraryAsset;
  alreadySaved: boolean;
  localAssetsRoot: string;
}
export const CREATION_CHANNELS = {
  submit: "creation:submit", history: "creation:history", reopen: "creation:reopen",
  save: "creation:save", library: "creation:library",
} as const;
