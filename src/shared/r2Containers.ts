/**
 * Browseable R2 / CDN container prefixes for GrudgeLoader + Assets.
 * Extends STORE_CATEGORIES — do not invent a parallel catalog.
 */
import { STORE_CATEGORIES } from "./fleetGames";

/** Core prefixes always pinned (upload + packs + shared). */
export const R2_CORE_CONTAINERS = [
  "asset-packs/",
  "user-uploads/",
  "shared/",
  "prod/gltf/",
  "models/",
  "textures/",
  "manifests/",
  "audio/",
  "icons/",
  "ui/",
  "vfx/",
  "sprites/",
  "effects/",
  "scenes/",
] as const;

export interface R2Container {
  id: string;
  label: string;
  prefix: string;
}

/** Deduped container list for GrudgeLoader pinned / Containers tab. */
export function listR2Containers(): R2Container[] {
  const seen = new Set<string>();
  const out: R2Container[] = [];

  const push = (id: string, label: string, prefix: string) => {
    const p = prefix.endsWith("/") ? prefix : `${prefix}/`;
    if (seen.has(p)) return;
    seen.add(p);
    out.push({ id, label, prefix: p });
  };

  for (const p of R2_CORE_CONTAINERS) {
    push(p.replace(/\/$/, ""), p.replace(/\/$/, ""), p);
  }
  for (const c of STORE_CATEGORIES) {
    push(c.id, c.label, c.prefix);
  }
  return out;
}

/** Default pinned prefixes for first-run GrudgeLoader. */
export function defaultPinnedPrefixes(): string[] {
  return [
    "asset-packs/",
    "user-uploads/",
    "shared/",
    "prod/gltf/",
    "models/",
    "models/grudge6/",
    "textures/",
    "textures/pbr/ground/",
    "audio/",
    "icons/",
    "ui/",
    "vfx/",
  ];
}
