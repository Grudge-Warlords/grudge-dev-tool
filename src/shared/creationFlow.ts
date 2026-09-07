import type { AssetCategory, AssetStyle, Prompt3DOrchestrationRecord } from "./prompt3d";

export const CREATION_CATEGORIES: AssetCategory[] = ["prop", "character", "building", "road-furniture", "environment", "vehicle"];
export const CREATION_STYLES: AssetStyle[] = ["stylized", "low-poly", "realistic", "hand-painted", "industrial", "custom"];
export const CREATION_BUILD = "local-flow-2026-09-05.5";
export const CREATION_PRIMITIVES = ["box", "sphere", "cylinder", "cone", "plane", "torus"] as const;
export type CreationKind = "sword" | "game-gun" | "person" | typeof CREATION_PRIMITIVES[number] | "existing-asset";
export type CreationMethod = "original-procedural" | "existing-asset";
export type CreationBaseSource = { kind: "local-file"; path: string } | { kind: "objectstore"; key: string };
export interface CreationSourceRecord {
  source: CreationBaseSource;
  sha256: string;
  byteSize: number;
  identity: Record<string, unknown>;
}
export type CreationOperation = "create" | "reuse" | "texture" | "enhance" | "adjust" | "swipe" | "projectile" | "dance" | "turntable";
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
