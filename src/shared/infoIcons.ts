/**
 * UI chrome icons.
 *
 * Catalog SSOT: https://info.grudge-studio.com/api/v1/icon-registry.json
 * PNG bytes:    registry.cdnBase = https://assets.grudge-studio.com
 *
 * Do NOT put img src on info.grudge-studio.com/icons/… — that host is the
 * objectstore-grudge SPA and returns text/html (200) for missing files.
 * Pack / skill PNGs live on the assets CDN (R2). Never rewrite 3D meshes
 * onto info; never serve chrome icons from the HTML fallback.
 */

export const INFO_ORIGIN = "https://info.grudge-studio.com";
export const INFO_CATALOG = `${INFO_ORIGIN}/api/v1/icon-registry.json`;
/** icon-registry.json `cdnBase` — PNG binaries. */
export const ICON_CDN = "https://assets.grudge-studio.com";

function png(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${ICON_CDN}${p}`;
}

/** Pack / skill paths that return image/png on the assets CDN (live-checked). */
export const INFO_ICONS = {
  sword: png("/icons/pack/weapons/Sword_01.png"),
  hammer: png("/icons/pack/weapons/Hammer_01.png"),
  axe: png("/icons/pack/weapons/Axe_01.png"),
  bow: png("/icons/pack/weapons/Bow_01.png"),
  crossbow: png("/icons/pack/weapons/Crossbow_01.png"),
  dagger: png("/icons/pack/weapons/Dagger_01.png"),
  spear: png("/icons/pack/weapons/Spear_01.png"),
  chest: png("/icons/pack/armor/Chest_01.png"),
  effect: png("/icons/pack/misc/Effect.png"),
  paladin: png("/icons/skills/class/paladin/paladin_01.png"),
  /** engineer_01 is missing on R2 — paladin is a live class PNG. */
  engineer: png("/icons/skills/class/paladin/paladin_01.png"),
  hunter: png("/icons/skills/class/hunter/hunter_01.png"),
  bloodmage: png("/icons/skills/class/bloodmage/bloodmage_01.png"),
  firemage: png("/icons/skills/class/firemage/firemage_01.png"),
} as const;

export type InfoIconKey = keyof typeof INFO_ICONS;

/** Map elite / Local Files kinds → pack/skill PNG on the assets CDN. */
export function infoIconForKind(kind: string): string {
  const k = (kind || "").toLowerCase();
  if (k === "dir" || k === "folder") return INFO_ICONS.chest;
  if (k === "model3d" || k === "scene3d") return INFO_ICONS.sword;
  if (k === "image") return INFO_ICONS.effect;
  if (k === "audio") return INFO_ICONS.hunter;
  if (k === "video") return INFO_ICONS.firemage;
  if (k === "text" || k === "pdf") return INFO_ICONS.hammer;
  if (k === "font") return INFO_ICONS.paladin;
  if (k === "archive") return INFO_ICONS.axe;
  return INFO_ICONS.hammer;
}

/** Sidebar / settings chrome icons (pack PNGs). */
export const INFO_NAV = {
  localFiles: INFO_ICONS.chest,
  assets: INFO_ICONS.effect,
  forge: INFO_ICONS.hammer,
  view: INFO_ICONS.sword,
  settings: INFO_ICONS.crossbow,
  home: INFO_ICONS.paladin,
  defaults: INFO_ICONS.crossbow,
} as const;

/** Resolve a catalog path or URL to a fetchable PNG. */
export function resolveInfoIconUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return INFO_ICONS.effect;
  let raw = pathOrUrl.trim();
  // info SPA HTML fallback — rewrite /icons to assets CDN
  raw = raw.replace(/^https?:\/\/info\.grudge-studio\.com(?=\/icons\/)/i, ICON_CDN);
  if (raw.startsWith("https://assets.grudge-studio.com")) return raw;
  if (raw.startsWith("/icons/")) return ICON_CDN + raw;
  if (raw.startsWith("icons/")) return `${ICON_CDN}/${raw}`;
  const stripped = raw.replace(/^https?:\/\/assets\.grudge-studio\.com/i, "");
  if (stripped.startsWith("/icons/")) return ICON_CDN + stripped;
  return raw.startsWith("http") ? raw : INFO_ICONS.effect;
}
