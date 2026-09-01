import type { AssetSpecV1 } from "./prompt3d";

export const OBJECT_TYPES = ["auto", "sword", "axe", "hammer", "spear", "staff", "bow", "shield", "grapple", "prop", "building", "road-fixture", "environment"] as const;
export type Prompt3DObjectType = typeof OBJECT_TYPES[number];
export const COMPONENT_LABELS = { whole: "Whole object", blade: "Blade only", head: "Head only", hilt: "Hilt assembly", guard: "Guard only", handle: "Handle / shaft only", pommel: "Pommel only" } as const;
export type Prompt3DComponent = keyof typeof COMPONENT_LABELS;
export interface Prompt3DObjectRules {
  type: Prompt3DObjectType;
  component: Prompt3DComponent;
  shapeNotes?: string;
  /** Fractions of the oriented bounds. These are explicit placement controls, not semantic detection. */
  anchor?: { x: number; y: number; z: number };
  flipVertical?: boolean;
}

type Profile = { label: string; shape: string; orientation: string; anchor: string; height: number; parts: Prompt3DComponent[]; review: string };
export const OBJECT_PROFILES: Record<Exclude<Prompt3DObjectType, "auto">, Profile> = {
  sword: { label: "Sword / dagger", shape: "One sword with one continuous tapered blade, one crossguard, one grip and one pommel", orientation: "Upright, pommel and hilt at the bottom, blade tip pointing up", anchor: "Base of hilt / pommel", height: 0, parts: ["whole", "blade", "hilt", "guard", "handle", "pommel"], review: "One complete blade, guard, grip and pommel; grip below blade; no scabbard." },
  axe: { label: "Axe", shape: "One axe with a solid cutting head securely joined to one long straight haft", orientation: "Upright, handle butt at the bottom, axe head at the top, broad blade faces visible", anchor: "Base of grip / haft", height: 0, parts: ["whole", "head", "handle", "pommel"], review: "One haft connected to one axe head; requested blade count on that same head; no duplicate axes." },
  hammer: { label: "Hammer / mace", shape: "One striking weapon with one solid head attached to one handle", orientation: "Upright, handle butt at the bottom and striking head at the top", anchor: "Base of grip", height: 0, parts: ["whole", "head", "handle", "pommel"], review: "Head connected to a single handle, no floating pieces." },
  spear: { label: "Spear / polearm", shape: "One polearm with one continuous straight shaft and one attached pointed head", orientation: "Upright, shaft butt at the bottom, pointed head facing up", anchor: "Shaft butt / lower grip end", height: 0, parts: ["whole", "head", "handle", "pommel"], review: "Entire shaft and tip visible, head connected to shaft." },
  staff: { label: "Staff / wand", shape: "One continuous staff with a clear lower grip and attached upper tip", orientation: "Upright, lower grip end at the bottom and decorative tip at the top", anchor: "Base of grip", height: 0, parts: ["whole", "head", "handle", "pommel"], review: "Continuous body and complete ends; no detached decorations." },
  bow: { label: "Bow", shape: "One bow with two limbs connected through one central grip and one continuous string", orientation: "Vertical limbs, central grip midway up, side profile showing the curve and string", anchor: "Central grip", height: 0.5, parts: ["whole"], review: "Two connected limbs, one central grip and a complete string; no arrows or extra bows." },
  shield: { label: "Shield", shape: "One solid shield with one continuous rim and a central mounting area", orientation: "Upright, outer front face visible, central mounting area midway up", anchor: "Central mounting point", height: 0.5, parts: ["whole"], review: "One complete shield, continuous rim; inspect the back mounting area separately." },
  grapple: { label: "Grapple / hook", shape: "One grappling hook with solid hooked prongs joined to one shank and one rope attachment eye", orientation: "Upright, rope attachment eye at the bottom and hook prongs above it", anchor: "Rope attachment end", height: 0, parts: ["whole", "head"], review: "One connected shank, open attachment eye and complete hook prongs; no rope coil." },
  prop: { label: "Other prop", shape: "One isolated solid prop", orientation: "Upright in its normal use orientation, support base at the bottom", anchor: "Support base", height: 0, parts: ["whole"], review: "One complete object, correct support face and no detached fragments." },
  building: { label: "Building", shape: "One freestanding building with a complete foundation, walls and roof", orientation: "Foundation at the bottom, roof above, front facade facing the viewer", anchor: "Foundation centre", height: 0, parts: ["whole"], review: "Complete foundation, walls and roof; no surrounding scene or separate buildings." },
  "road-fixture": { label: "Road / street fixture", shape: "One freestanding street fixture", orientation: "Support or mounting base at the bottom, upright working parts above", anchor: "Mounting base", height: 0, parts: ["whole"], review: "Complete mounting base and working parts; no street scene or ground slab." },
  environment: { label: "Environment piece", shape: "One isolated environment asset", orientation: "Natural support surface at the bottom, front facing the viewer", anchor: "Ground contact", height: 0, parts: ["whole"], review: "One bounded asset, complete silhouette and suitable ground contact." },
};

const COMPONENTS: Record<Exclude<Prompt3DComponent, "whole">, { shape: string; orientation: string; anchor: string; height: number }> = {
  blade: { shape: "One detached blade, continuous from its tang to its tip; no grip, guard or pommel", orientation: "Blade tang and mounting end at the bottom, blade tip pointing up", anchor: "Tang / blade mounting end", height: 0 },
  head: { shape: "One detached working head with a clear central mounting socket; no handle or shaft", orientation: "Mounting socket centred, working surfaces visible, socket axis vertical", anchor: "Mounting socket centre", height: 0.5 },
  hilt: { shape: "One hilt assembly containing a pommel, grip and guard; no blade", orientation: "Pommel at the bottom, grip vertical, guard and blade socket above", anchor: "Base of hilt / pommel", height: 0 },
  guard: { shape: "One crossguard with a central blade slot and complete arms; no blade, grip or pommel", orientation: "Guard arms horizontal, blade slot centred and facing up", anchor: "Blade slot centre", height: 0.5 },
  handle: { shape: "One continuous handle or shaft with both ends complete; no working head or blade", orientation: "Grip butt at the bottom, head attachment end at the top", anchor: "Base of handle", height: 0 },
  pommel: { shape: "One pommel cap with a clear mounting socket; no blade, guard or grip", orientation: "Pommel below its upward-facing mounting socket", anchor: "Top mounting socket", height: 1 },
};

export function inferObjectType(spec: Pick<AssetSpecV1, "prompt" | "category">): Exclude<Prompt3DObjectType, "auto"> {
  if (spec.category === "building") return "building";
  if (spec.category === "road-furniture") return "road-fixture";
  if (spec.category === "environment") return "environment";
  const patterns: Array<[Exclude<Prompt3DObjectType, "auto">, RegExp]> = [["sword", /\b((?:long|short|broad|great)?sword|sabre|saber|scimitar|katana|rapier|dagger|leafblade|claymore)\b/i], ["axe", /\b(axe|ax|hatchet|battleaxe)\b/i], ["hammer", /\b(hammer|mace|warhammer)\b/i], ["spear", /\b(spear|polearm|halberd|pike)\b/i], ["staff", /\b(staff|wand)\b/i], ["bow", /\bbow\b/i], ["shield", /\bshield\b/i], ["grapple", /\b(grappl\w*|hook)\b/i]];
  return patterns.map(([type, pattern]) => ({ type, index: spec.prompt.search(pattern) })).filter(v => v.index >= 0).sort((a, b) => a.index - b.index)[0]?.type ?? "prop";
}

export function validateObjectRules(value: Prompt3DObjectRules | undefined): void {
  if (value === undefined) return;
  if (!value || !OBJECT_TYPES.includes(value.type) || !Object.hasOwn(COMPONENT_LABELS, value.component)) throw new Error("Select a supported object type and component.");
  if (value.shapeNotes !== undefined && (typeof value.shapeNotes !== "string" || value.shapeNotes.length > 320)) throw new Error("Shape details must be at most 320 characters.");
  if (value.flipVertical !== undefined && typeof value.flipVertical !== "boolean") throw new Error("Invalid vertical orientation choice.");
  if (value.anchor && ![value.anchor.x, value.anchor.y, value.anchor.z].every(v => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error("Attachment coordinates must be between 0 and 100 percent of the oriented bounds.");
}

export function resolveObjectRules(spec: AssetSpecV1) {
  const choice = spec.objectRules;
  const type = choice?.type && choice.type !== "auto" && Object.hasOwn(OBJECT_PROFILES, choice.type) ? choice.type : inferObjectType(spec);
  const profile = OBJECT_PROFILES[type];
  const component = profile.parts.includes(choice?.component ?? "whole") ? choice?.component ?? "whole" : "whole";
  const rule = component === "whole" ? profile : COMPONENTS[component];
  return { type, component, profile, ...rule, anchorLabel: rule.anchor, anchor: choice?.anchor ?? { x: 0.5, y: rule.height, z: 0.5 }, flipVertical: choice?.flipVertical === true };
}

const presentation = /\b(background|lighting|light|shadow|cinematic|atmosphere|camera|view|perspective|focus|render|concept art|photograph|visible|watermark|frame|upside|sideways|horizontal|vertical|pointing|facing|ground level|origin|y\s*=)\b/i;
const decoration = /\b(engrav\w*|carv\w*|runes?|knotwork|inlays?|etched|etching|mythical|beasts?|patina|legendary|wear|ornate|intricate|vines?|patterns?)\b/i;
const cleanClauses = (text: string) => text.split(/[.!?;,\n]+/).map(s => s.trim()).filter(Boolean);

export interface Prompt3DPromptPlan {
  version: 1;
  objectType: Exclude<Prompt3DObjectType, "auto">;
  component: Prompt3DComponent;
  generationPrompt: string;
  negativePrompt: string;
  surfaceBrief: string;
  removedPresentation: string[];
  review: string;
}

/** Typed rules lead the prompt; original prose never gets appended after them. */
export function compilePrompt3DPrompt(spec: AssetSpecV1): Prompt3DPromptPlan {
  const rule = resolveObjectRules(spec);
  const clauses = cleanClauses(spec.prompt);
  const removedPresentation = clauses.filter(s => presentation.test(s));
  const notes = cleanClauses(spec.objectRules?.shapeNotes ?? "").filter(s => !presentation.test(s) && !decoration.test(s)).join("; ");
  const terms = spec.prompt.toLowerCase();
  const details: string[] = [];
  if (rule.type === "axe" && rule.component !== "handle" && rule.component !== "pommel") {
    details.push(/double[ -]headed|two.*blades|double[ -]bit/.test(terms) ? "Two opposing cutting blades on the same single axe head" : "One cutting blade on the axe head");
    if (/crescent/.test(terms)) details.push("Broad crescent-shaped cutting edges");
  }
  if (rule.type === "sword" && ["whole", "blade"].includes(rule.component)) {
    if (/sabre|saber|scimitar|katana|curved/.test(terms)) details.push("Clearly curved single blade");
    else if (/leafblade|leaf[ -]shaped/.test(terms)) details.push("Broad leaf-shaped blade with a sharp tip");
    else if (/rapier/.test(terms)) details.push("Long narrow straight blade");
    else details.push("Straight tapered blade");
  }
  if (["prop", "road-fixture", "environment", "building"].includes(rule.type) && !notes) {
    const nounClause = clauses.find(s => !presentation.test(s) && !decoration.test(s));
    if (nounClause) details.push(nounClause.split(/\s+/).slice(0, 22).join(" "));
  }
  const shape = rule.component === "whole" ? rule.shape : `${rule.shape}, for a ${rule.profile.label.toLowerCase()}`;
  let subject = rule.type.replaceAll("-", " ");
  if (rule.component !== "whole") subject += ` ${rule.component}`;
  else if (rule.type === "axe") subject = /double[ -]headed|two.*blades|double[ -]bit/.test(terms) ? "double-headed axe" : "single-bladed axe";
  else if (rule.type === "sword") subject = /sabre|saber|scimitar|katana|curved/.test(terms) ? "curved sword" : /leafblade|leaf[ -]shaped/.test(terms) ? "leaf-shaped sword" : "straight sword";
  else if (rule.type === "hammer" && /\bmace\b/.test(terms)) subject = "mace";
  const earlyOrientation = rule.component !== "whole" ? "detached component" : ["sword", "axe", "hammer", "spear", "staff", "grapple"].includes(rule.type) ? "grip end down, working end up" : "upright";
  const generationPrompt = [`One ${subject}, ${earlyOrientation}, plain white background, entire object visible.`, shape + ".", ...details.map(s => s + "."), rule.orientation + ".", "Single view, generous empty margins, even lighting.", notes ? `Shape details: ${notes}.` : "", spec.style !== "custom" ? `${spec.style.replaceAll("-", " ")} shape.` : "", "Clean solid silhouette. No extra objects, display stand, ground slab or text."].filter(Boolean).join(" ");
  return { version: 1, objectType: rule.type, component: rule.component, generationPrompt,
    negativePrompt: "cropped, cut off, close-up, out of frame, partial object, multiple objects, duplicate, contact sheet, split screen, multiple views, hands, person, text, watermark, scenery, shadow, dark background, display stand, ground slab, scabbard",
    surfaceBrief: spec.prompt, removedPresentation, review: rule.component === "whole" ? rule.profile.review : `${COMPONENT_LABELS[rule.component]} only. ${rule.orientation}. Check the ${rule.anchorLabel.toLowerCase()} before export.` };
}

export function conceptMatchesSpec(job: { spec: AssetSpecV1; promptPlan?: Prompt3DPromptPlan }, spec: AssetSpecV1): boolean {
  const plan = compilePrompt3DPrompt(spec);
  return Boolean(job.promptPlan && job.spec.seed === spec.seed && job.spec.prompt === spec.prompt && job.promptPlan.generationPrompt === plan.generationPrompt && job.promptPlan.negativePrompt === plan.negativePrompt);
}

export function withObjectRules(spec: AssetSpecV1): AssetSpecV1 {
  validateObjectRules(spec.objectRules);
  const rules = resolveObjectRules(spec);
  if (spec.objectRules && spec.objectRules.component !== rules.component) throw new Error("That component is not available for the selected object type.");
  return { ...spec, objectRules: { ...spec.objectRules, type: rules.type, component: rules.component }, coordinateContract: { ...spec.coordinateContract, origin: "attachment-point" } };
}

export function categoryForObjectType(type: Exclude<Prompt3DObjectType, "auto">): AssetSpecV1["category"] {
  return type === "building" ? "building" : type === "road-fixture" ? "road-furniture" : type === "environment" ? "environment" : "prop";
}
