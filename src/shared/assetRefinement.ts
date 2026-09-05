export interface AssetRefinementRecipe {
  summary: string;
  sword?: { kind: "longsword" | "sabre" | "leafblade" | "rapier"; length: number; width: number; curvature: number; gripLength: number; guardWidth: number };
  material?: {
    color: string;
    metalness: number;
    roughness: number;
    pattern: "solid" | "brushed-metal" | "leather" | "wood";
    region: { min: number; max: number };
  };
  motion?: { kind: "turntable" | "swing" | "thrust"; duration: number; amount: number; pivotHeight?: number };
}

export interface AssetRefinementRequest {
  instruction: string;
  assetName: string;
  previous?: AssetRefinementRecipe;
}

export interface AssetRefinementPlan {
  recipe: AssetRefinementRecipe;
  model: string;
}

export const PRECISION_SWORD_PRESETS: Record<NonNullable<AssetRefinementRecipe["sword"]>["kind"], NonNullable<AssetRefinementRecipe["sword"]>> = {
  longsword: {kind:"longsword",length:1.2,width:.065,curvature:0,gripLength:.25,guardWidth:.25},
  sabre: {kind:"sabre",length:1,width:.075,curvature:.22,gripLength:.18,guardWidth:.17},
  leafblade: {kind:"leafblade",length:.78,width:.155,curvature:0,gripLength:.16,guardWidth:.20},
  rapier: {kind:"rapier",length:1.1,width:.025,curvature:0,gripLength:.16,guardWidth:.25},
};

export interface AssetRefinementRevision {
  id: string;
  path: string;
  createdAt: string;
  recipe: AssetRefinementRecipe;
}

export const REFINEMENT_JSON_SCHEMA = {
  type: "object", additionalProperties: false, required: ["summary"],
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 600 },
    sword: { type: "object", additionalProperties: false, required: ["kind", "length", "width", "curvature", "gripLength", "guardWidth"], properties: {
      kind: { type: "string", enum: ["longsword", "sabre", "leafblade", "rapier"] }, length: { type: "number", minimum: .3, maximum: 2 }, width: { type: "number", minimum: .02, maximum: .3 }, curvature: { type: "number", minimum: -.5, maximum: .5 }, gripLength: { type: "number", minimum: .08, maximum: .45 }, guardWidth: { type: "number", minimum: .06, maximum: .5 },
    } },
    material: { type: "object", additionalProperties: false, required: ["color", "metalness", "roughness", "pattern", "region"], properties: {
      color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
      metalness: { type: "number", minimum: 0, maximum: 1 }, roughness: { type: "number", minimum: 0, maximum: 1 },
      pattern: { type: "string", enum: ["solid", "brushed-metal", "leather", "wood"] },
      region: { type: "object", additionalProperties: false, required: ["min", "max"], properties: { min: { type: "number", minimum: 0, maximum: .99 }, max: { type: "number", minimum: .01, maximum: 1 } } },
    } },
    motion: { type: "object", additionalProperties: false, required: ["kind", "duration", "amount", "pivotHeight"], properties: {
      kind: { type: "string", enum: ["turntable", "swing", "thrust"] }, duration: { type: "number", minimum: .5, maximum: 20 }, amount: { type: "number", minimum: .01, maximum: 360 }, pivotHeight: { type: "number", minimum: 0, maximum: 1 },
    } },
  },
} as const;

export function validateRefinementRecipe(value: unknown): AssetRefinementRecipe {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a refinement recipe.");
  const v = value as Record<string, any>;
  if (Object.keys(v).some(k => !["summary", "sword", "material", "motion"].includes(k))) throw new Error("The planner proposed an unsupported operation.");
  if (typeof v.summary !== "string" || !v.summary.trim() || v.summary.length > 600) throw new Error("Invalid refinement summary.");
  const recipe: AssetRefinementRecipe = { summary: v.summary };
  const range = (n: unknown, a: number, b: number) => typeof n === "number" && Number.isFinite(n) && n >= a && n <= b;
  if (v.sword) {
    const s=v.sword;
    if(!["longsword","sabre","leafblade","rapier"].includes(s.kind)||!range(s.length,.3,2)||!range(s.width,.02,.3)||!range(s.curvature,-.5,.5)||!range(s.gripLength,.08,.45)||!range(s.guardWidth,.06,.5)||s.length <= s.gripLength+.15)throw new Error("Invalid precision sword dimensions.");
    recipe.sword={kind:s.kind,length:s.length,width:s.width,curvature:s.curvature,gripLength:s.gripLength,guardWidth:s.guardWidth};
  }
  if (v.material) {
    const m = v.material;
    if (!/^#[0-9a-f]{6}$/i.test(m.color) || !range(m.metalness, 0, 1) || !range(m.roughness, 0, 1)
      || !["solid", "brushed-metal", "leather", "wood"].includes(m.pattern)
      || !range(m.region?.min, 0, 1) || !range(m.region?.max, 0, 1) || m.region.min >= m.region.max) throw new Error("Invalid material or height region.");
    recipe.material = { color: m.color, metalness: m.metalness, roughness: m.roughness, pattern: m.pattern, region: { min: m.region.min, max: m.region.max } };
  }
  if (v.motion) {
    const m = v.motion;
    if (!["turntable", "swing", "thrust"].includes(m.kind) || !range(m.duration, .5, 20) || !range(m.amount, .01, m.kind === "thrust" ? 2 : 360)) throw new Error("Invalid motion. Use a 0.5–20 second rigid-object clip.");
    if (m.pivotHeight !== undefined && !range(m.pivotHeight, 0, 1)) throw new Error("Pivot height must be from 0 to 1.");
    recipe.motion = { kind: m.kind, duration: m.duration, amount: m.amount, pivotHeight: m.pivotHeight ?? .5 };
  }
  if (!recipe.sword && !recipe.material && !recipe.motion) throw new Error("Ask for a precision sword, material/texture change or a turntable, swing or thrust animation.");
  return recipe;
}
