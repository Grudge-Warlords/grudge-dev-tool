/**
 * UI chrome icons SSOT — info.grudge-studio.com (verified PNG paths).
 * Do NOT rewrite these hosts to assets.* — skill chrome / crafting / Dev Tool.
 *
 * assets.grudge-studio.com = 3D / CDN binaries only.
 * info.grudge-studio.com   = catalog + pack/skill PNG icons for UI.
 */

export const INFO_ORIGIN = "https://info.grudge-studio.com";

/** Pack / skill paths that return image/png on info (live-checked). */
export const INFO_ICONS = {
  // Pack weapons / armor / misc
  sword: `${INFO_ORIGIN}/icons/pack/weapons/Sword_01.png`,
  hammer: `${INFO_ORIGIN}/icons/pack/weapons/Hammer_01.png`,
  axe: `${INFO_ORIGIN}/icons/pack/weapons/Axe_01.png`,
  bow: `${INFO_ORIGIN}/icons/pack/weapons/Bow_01.png`,
  crossbow: `${INFO_ORIGIN}/icons/pack/weapons/Crossbow_01.png`,
  dagger: `${INFO_ORIGIN}/icons/pack/weapons/Dagger_01.png`,
  spear: `${INFO_ORIGIN}/icons/pack/weapons/Spear_01.png`,
  chest: `${INFO_ORIGIN}/icons/pack/armor/Chest_01.png`,
  effect: `${INFO_ORIGIN}/icons/pack/misc/Effect.png`,
  // Skill class arts (skills only on info — assets 404)
  paladin: `${INFO_ORIGIN}/icons/skills/class/paladin/paladin_01.png`,
  engineer: `${INFO_ORIGIN}/icons/skills/class/engineer/engineer_01.png`,
  hunter: `${INFO_ORIGIN}/icons/skills/class/hunter/hunter_01.png`,
  bloodmage: `${INFO_ORIGIN}/icons/skills/class/bloodmage/bloodmage_01.png`,
  firemage: `${INFO_ORIGIN}/icons/skills/class/firemage/firemage_01.png`,
} as const;

export type InfoIconKey = keyof typeof INFO_ICONS;

/** Map elite / Local Files kinds → info icon URL. */
export function infoIconForKind(kind: string): string {
  const k = (kind || "").toLowerCase();
  if (k === "dir" || k === "folder") return INFO_ICONS.chest;
  if (k === "model3d" || k === "scene3d") return INFO_ICONS.sword;
  if (k === "image") return INFO_ICONS.effect;
  if (k === "audio") return INFO_ICONS.hunter;
  if (k === "video") return INFO_ICONS.firemage;
  if (k === "text" || k === "pdf") return INFO_ICONS.engineer;
  if (k === "font") return INFO_ICONS.paladin;
  if (k === "archive") return INFO_ICONS.axe;
  return INFO_ICONS.hammer;
}

/** Sidebar / settings chrome icons (info pack). */
export const INFO_NAV = {
  localFiles: INFO_ICONS.chest,
  assets: INFO_ICONS.effect,
  forge: INFO_ICONS.hammer,
  view: INFO_ICONS.sword,
  settings: INFO_ICONS.engineer,
  home: INFO_ICONS.paladin,
  defaults: INFO_ICONS.crossbow,
} as const;

/** Prefer info host; never rewrite to assets. */
export function resolveInfoIconUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return INFO_ICONS.effect;
  if (pathOrUrl.startsWith("https://info.grudge-studio.com")) return pathOrUrl;
  if (pathOrUrl.startsWith("/icons/")) return INFO_ORIGIN + pathOrUrl;
  if (pathOrUrl.startsWith("icons/")) return `${INFO_ORIGIN}/${pathOrUrl}`;
  // Strip accidental assets rewrite
  const stripped = pathOrUrl
    .replace(/^https?:\/\/assets\.grudge-studio\.com/i, "")
    .replace(/^https?:\/\/info\.grudge-studio\.com/i, "");
  if (stripped.startsWith("/icons/")) return INFO_ORIGIN + stripped;
  return pathOrUrl.startsWith("http") ? pathOrUrl : INFO_ICONS.effect;
}
