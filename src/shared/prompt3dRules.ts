import type { AssetSpecV1 } from "./prompt3d";

export const OBJECT_TYPES = ["auto", "sword", "axe", "hammer", "spear", "staff", "bow", "shield", "grapple", "creature", "prop", "building", "road-fixture", "environment"] as const;
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
  creature: { label: "Creature", shape: "One complete isolated creature with a continuous body and every requested limb, fin, wing, tail or other anatomical feature fully visible", orientation: "Natural motion-ready full-body pose with the complete silhouette visible and the primary travel direction facing the viewer's right", anchor: "Lowest natural body contact", height: 0, parts: ["whole"], review: "One complete creature; count all requested limbs, wings, fins and tails; inspect anatomy, silhouette and motion-ready separation before approval." },
  prop: { label: "Other prop", shape: "One isolated solid prop", orientation: "Natural use orientation with the complete silhouette visible", anchor: "Support base", height: 0, parts: ["whole"], review: "One complete object in the requested orientation with no detached fragments." },
  building: { label: "Building", shape: "One freestanding building with a complete foundation, walls and roof", orientation: "Foundation at the bottom, roof above, front facade facing the viewer", anchor: "Foundation centre", height: 0, parts: ["whole"], review: "Complete foundation, walls and roof; no surrounding scene or separate buildings." },
  "road-fixture": { label: "Road / street fixture", shape: "One freestanding street fixture", orientation: "Upright working parts with their lowest structural end at the bottom and front visible", anchor: "Mounting base", height: 0, parts: ["whole"], review: "Complete mounting base and working parts; no street scene or ground slab." },
  environment: { label: "Environment piece", shape: "One isolated environment asset", orientation: "Natural game-ready orientation with a bounded silhouette and front facing the viewer", anchor: "Ground contact", height: 0, parts: ["whole"], review: "One bounded asset, complete silhouette and suitable ground contact." },
};

const COMPONENTS: Record<Exclude<Prompt3DComponent, "whole">, { shape: string; orientation: string; anchor: string; height: number }> = {
  blade: { shape: "One detached blade, continuous from its tang to its tip; no grip, guard or pommel", orientation: "Blade tang and mounting end at the bottom, blade tip pointing up", anchor: "Tang / blade mounting end", height: 0 },
  head: { shape: "One detached working head with a clear central mounting socket; no handle or shaft", orientation: "Mounting socket centred, working surfaces visible, socket axis vertical", anchor: "Mounting socket centre", height: 0.5 },
  hilt: { shape: "One hilt assembly containing a pommel, grip and guard; no blade", orientation: "Pommel at the bottom, grip vertical, guard and blade socket above", anchor: "Base of hilt / pommel", height: 0 },
  guard: { shape: "One crossguard with a central blade slot and complete arms; no blade, grip or pommel", orientation: "Guard arms horizontal, blade slot centred and facing up", anchor: "Blade slot centre", height: 0.5 },
  handle: { shape: "One continuous handle or shaft with both ends complete; no working head or blade", orientation: "Grip butt at the bottom, head attachment end at the top", anchor: "Base of handle", height: 0 },
  pommel: { shape: "One pommel cap with a clear mounting socket; no blade, guard or grip", orientation: "Pommel below its upward-facing mounting socket", anchor: "Top mounting socket", height: 1 },
};

const OBJECT_TYPE_TERMS: Record<Exclude<Prompt3DObjectType, "auto">, RegExp> = {
  sword: /\b((?:long|short|broad|great)?swords?|sabres?|sabers?|scimitars?|katanas?|rapiers?|daggers?|leafblades?|claymores?)\b/i,
  axe: /\b(ax|axes?|hatchets?|battleaxes?)\b/i,
  hammer: /\b(hammers?|maces?|warhammers?)\b/i,
  spear: /\b(spears?|polearms?|halberds?|pikes?)\b/i,
  staff: /\b(staff|staves|wands?)\b/i,
  bow: /\bbows?\b/i,
  shield: /\bshields?\b/i,
  grapple: /\b(grappl\w*|hooks?)\b/i,
  creature: /\b(creatures?|animals?|characters?)\b/i,
  prop: /\bprops?\b/i,
  building: /\bbuildings?\b/i,
  "road-fixture": /\b(?:road|street) (?:fixtures?|furniture)\b/i,
  environment: /\benvironments?(?: pieces?)?\b/i,
};
const INFERRED_OBJECT_TYPES = ["sword", "axe", "hammer", "spear", "staff", "bow", "shield", "grapple", "creature"] as const;

export function inferObjectType(spec: Pick<AssetSpecV1, "prompt" | "category">): Exclude<Prompt3DObjectType, "auto"> {
  if (spec.category === "character") return "creature";
  if (spec.category === "building") return "building";
  if (spec.category === "road-furniture") return "road-fixture";
  if (spec.category === "environment") return "environment";
  return INFERRED_OBJECT_TYPES
    .map((type) => ({ type, index: firstAffirmativeTypeMention(spec.prompt, type) }))
    .filter((value) => value.index >= 0)
    .sort((a, b) => a.index - b.index)[0]?.type ?? "prop";
}

export function validateObjectRules(value: Prompt3DObjectRules | undefined): void {
  if (value === undefined) return;
  if (!value || !OBJECT_TYPES.includes(value.type) || !Object.hasOwn(COMPONENT_LABELS, value.component)) throw new Error("Select a supported object type and component.");
  if (value.shapeNotes !== undefined && (typeof value.shapeNotes !== "string" || value.shapeNotes.length > 320)) throw new Error("Shape details must be at most 320 characters.");
  if (value.flipVertical !== undefined && typeof value.flipVertical !== "boolean") throw new Error("Invalid vertical orientation choice.");
  if (value.anchor && ![value.anchor.x, value.anchor.y, value.anchor.z].every(v => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error("Attachment coordinates must be between 0 and 100 percent of the oriented bounds.");
}

export function applyPrompt3DEdit(spec: AssetSpecV1, prompt: string): AssetSpecV1 {
  return {
    ...spec,
    prompt,
    objectRules: undefined,
    coordinateContract: { ...spec.coordinateContract, origin: "ground-center" },
  };
}

export function resolveObjectRules(spec: AssetSpecV1) {
  const choice = spec.objectRules;
  const type = choice?.type && choice.type !== "auto" && Object.hasOwn(OBJECT_PROFILES, choice.type) ? choice.type : inferObjectType(spec);
  if (promptExplicitlyExcludesObjectType(spec.prompt, type)) throw objectTypeConflict(type);
  const profile = OBJECT_PROFILES[type];
  const component = profile.parts.includes(choice?.component ?? "whole") ? choice?.component ?? "whole" : "whole";
  const rule = component === "whole" ? profile : COMPONENTS[component];
  const floatingCentre = type === "prop" && component === "whole" && describesUnsupportedPose(spec.prompt);
  const inferredAnchor = floatingCentre ? { x: 0.5, y: 0.5, z: 0.5 } : { x: 0.5, y: rule.height, z: 0.5 };
  return { type, component, profile, ...rule, anchorLabel: floatingCentre ? "Object centre" : rule.anchor, anchor: choice?.anchor ?? inferredAnchor, flipVertical: choice?.flipVertical === true };
}

const standalonePresentation = /^(?:(?:plain|seamless|solid|clean|pure|bright|dark|black|white|gray|grey|transparent)\s+)*(?:background|backdrop)\b|^(?:(?:neutral|even|soft|hard|dramatic|studio|key|rim|fill)\s+)*(?:lighting|illumination)\b|^(?:camera\s+(?:angle|view|position|perspective)|cinematic\s+atmosphere|concept art|photographic\s+style|ground level|origin\b|y\s*=)/i;
const decoration = /\b(engrav\w*|carv\w*|runes?|knotwork|inlays?|etched|etching|mythical|beasts?|patina|legendary|wear|ornate|intricate|vines?|patterns?)\b/i;
const cleanClauses = (text: string) => text.split(/[.!?;,\n]+/).map(s => s.trim()).filter(Boolean);
const intentClauses = (text: string) => text.split(/[.!?;\n]+/).map(s => s.trim()).filter(Boolean);
const negativeCueSource = String.raw`\b(?:no|without|never|do\s+not|does\s+not|did\s+not|don['’]t|doesn['’]t|didn['’]t|must\s+not|should\s+not|mustn['’]t|shouldn['’]t|exclude(?:s|d|ing)?|excluding|omit(?:s|ted|ting)?|avoid(?:s|ed|ing)?|remove(?:s|d|ing)?|delete(?:s|d|ing)?)\b`;
const affirmativeResume = /\b(?:but|however|instead|yet)\b|,\s*(?=(?:and\s+)?(?:include|keep|retain|show|use|add|feature|with|having)\b)/i;
const supportPresentation = /\b(?:(?:(?:on|upon|with|using|featuring|includes?|supported\s+by)\s+(?:a|an|the)?\s*(?:[\w-]+\s+){0,3}(?:stand|support))|display\s+stand|pedestal|plinth|support\s+base|mounting\s+(?:base|fixture)|ground\s+(?:plane|slab))\b/i;
const sceneryPresentation = /\b(?:scenery|landscape|terrain|surroundings?|(?:forest|interior|exterior|street|battlefield|underwater)\s+scene)\b/i;
const backdropPresentation = /\b(?:backdrop|background)\b/i;
const lightingPresentation = /\b(?:lighting|illumination|(?:key|rim|fill|studio|dramatic|neutral|even|soft|hard)\s+light|shadows?)\b/i;
const standardWhitePresentation = /\b(?:plain|seamless|clean|solid)?\s*white\s+(?:background|backdrop)\b|\b(?:background|backdrop)\s+(?:is\s+)?(?:plain|seamless|clean|solid)?\s*white\b/i;
const standardNeutralLighting = /\b(?:neutral|even|soft\s+studio)\s+(?:lighting|illumination|light)\b/i;

interface PromptIntentPartition {
  positiveText: string;
  negativeTerms: string[];
}

function cleanPositiveIntent(value: string): string {
  return value
    .replace(/^[\s,:-]+|[\s,:-]+$/g, "")
    .replace(/^(?:and|but|however|instead|yet)\s+/i, "")
    .replace(/\b(?:and|or|with|but)\s*$/i, "")
    .trim();
}

function cleanNegativeIntent(value: string): string {
  let cleaned = value
    .replace(/^[\s,:-]+|[\s,:-]+$/g, "")
    .replace(/^(?:please\s+)?(?:add|include|show|create|have|use|place|render|generate|make|feature|contain|attach)\s+/i, "")
    .replace(/^(?:(?:a|an|any|the|all|added|visible|external)\s+)+/i, "")
    .replace(/\b(?:please|either)\s*$/i, "")
    .trim();
  while (/^(?:(?:a|an|any|the|all)\s+)/i.test(cleaned)) cleaned = cleaned.replace(/^(?:(?:a|an|any|the|all)\s+)/i, "");
  return cleaned;
}

function firstNegativeCue(value: string): RegExpMatchArray | undefined {
  const matcher = new RegExp(negativeCueSource, "ig");
  for (const match of value.matchAll(matcher)) {
    if (/^no$/i.test(match[0]) && /^\s+(?:more|less|fewer)\s+than\b/i.test(value.slice((match.index ?? 0) + match[0].length))) continue;
    return match;
  }
  return undefined;
}

function preservationFromNegative(cue: string, value: string): string | undefined {
  if (/^(?:remove|delete)/i.test(cue)) return undefined;
  const preservation = value.match(/^(?:change|changing|alter|altering|modify|modifying|remove|removing|delete|deleting|lose|losing|reduce|reducing)\s+(.+)$/i);
  return preservation ? cleanPositiveIntent(`preserve ${preservation[1]}`) : undefined;
}

/** Keep affirmative geometry separate from exclusions before any CLIP retention or type cues run. */
function partitionPromptIntent(text: string): PromptIntentPartition {
  const positive: string[] = [];
  const negativeTerms: string[] = [];
  const visit = (value: string): void => {
    const cue = firstNegativeCue(value);
    if (!cue || cue.index === undefined) {
      const retained = cleanPositiveIntent(value);
      if (retained) positive.push(retained);
      return;
    }
    const before = cleanPositiveIntent(value.slice(0, cue.index));
    if (before) positive.push(before);
    const afterCue = value.slice(cue.index + cue[0].length);
    const resume = afterCue.match(affirmativeResume);
    const excluded = cleanNegativeIntent(resume?.index === undefined ? afterCue : afterCue.slice(0, resume.index));
    const preservation = preservationFromNegative(cue[0], excluded);
    if (preservation) positive.push(preservation);
    else if (excluded) negativeTerms.push(excluded);
    if (resume?.index !== undefined) visit(afterCue.slice(resume.index + resume[0].length));
  };
  for (const clause of intentClauses(text)) visit(clause);
  return { positiveText: positive.join("; "), negativeTerms: [...new Set(negativeTerms)] };
}

function focusedPresentationText(clause: string): string {
  const words = clause.split(/\s+/).filter(Boolean);
  if (words.length <= 12) return clause;
  const keyIndex = words.findIndex((_, index) => supportPresentation.test(words.slice(index, index + 3).join(" "))
    || sceneryPresentation.test(words.slice(index, index + 3).join(" "))
    || backdropPresentation.test(words.slice(index, index + 3).join(" "))
    || lightingPresentation.test(words.slice(index, index + 3).join(" ")));
  const start = Math.max(0, keyIndex < 0 ? words.length - 12 : keyIndex - 3);
  return words.slice(start, start + 12).join(" ");
}
const structuralTerms = /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|at|least|exactly|minimum|maximum|complete|separate|separated|countable|emerg\w*|protrud\w*|integrat\w*|spik\w*|point\w*|attach\w*|connect\w*|join\w*|continuous|through|inside|within|around|front|rear|below|above|opening|shell|handle|grip|chain|link\w*|ball|head|body|core|trail\w*|plume\w*|leg\w*|ear\w*|eye\w*|mouth|fin\w*|wing\w*|tail\w*|beak|feather\w*|scale\w*|silhouette|profile|facing|upright|horizontal\w*|vertical\w*|diagonal\w*|sideways|tilt\w*|angle\w*|slant\w*|inverted|curved|straight|long|short|wide|narrow|thick|thin|open|closed)\b/i;
const lowInformationWord = /^(?:a|an|the|and|or|with|of|its|that|which|having|has|have|is|are|in|on|for|from)$/i;
const countedNumberWord = /^(?:\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:-(?:one|two|three|four|five|six|seven|eight|nine))?|thirty(?:-(?:one|two|three|four|five|six|seven|eight|nine))?|forty(?:-(?:one|two|three|four|five|six|seven|eight|nine))?|fifty(?:-(?:one|two|three|four|five|six|seven|eight|nine))?|sixty(?:-(?:one|two|three|four|five|six|seven|eight|nine))?|seventy(?:-(?:one|two|three|four|five|six|seven|eight|nine))?|eighty(?:-(?:one|two|three|four|five|six|seven|eight|nine))?|ninety(?:-(?:one|two|three|four|five|six|seven|eight|nine))?|hundred|dozen)$/i;
const countedHeadWord = /^(?:objects?|subjects?|assets?|pieces?|parts?|components?|masses?|bodies?|limbs?|legs?|paws?|feet|arms?|hands?|ears?|eyes?|mouths?|fins?|wings?|tails?|beaks?|feathers?|scales?|spikes?|points?|prongs?|protrusions?|cones?|links?|chains?|handles?|grips?|balls?|heads?|blades?|shafts?|tips?|bases?|branches?|roots?|wheels?|doors?|windows?|pillars?|supports?)$/i;
const countedAttachmentWord = /^(?:attach\w*|connect\w*|join\w*|protrud\w*|radiat\w*|extend\w*|emerg\w*|link\w*)$/i;
const countedModifierWord = /^(?:conical|pointed|sharp|rounded|spherical|curved|straight|separate|separated|countable|distinct|visible|attached|connected|joined|continuous|articulated|thick|thin|long|short|wide|narrow|broad|small|large|upper|lower|front|rear|left|right)$/i;
const semanticWord = (word: string) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}-]+$/gu, "");

interface CountedWordGroup {
  start: number;
  numberIndex: number;
  headIndex: number;
  modifierIndices: number[];
  attachmentIndex?: number;
  emphatic: boolean;
}

function countedWordGroups(words: string[]): CountedWordGroup[] {
  const normalized = words.map(semanticWord);
  const groups: CountedWordGroup[] = [];
  for (let numberIndex = 0; numberIndex < normalized.length; numberIndex += 1) {
    if (!countedNumberWord.test(normalized[numberIndex])) continue;
    let start = numberIndex;
    if (numberIndex >= 1 && /^(?:exactly|minimum|maximum)$/i.test(normalized[numberIndex - 1])) start = numberIndex - 1;
    else if (numberIndex >= 2 && /^at$/i.test(normalized[numberIndex - 2]) && /^least$/i.test(normalized[numberIndex - 1])) start = numberIndex - 2;
    const nextNumber = normalized.findIndex((word, index) => index > numberIndex && countedNumberWord.test(word));
    const searchEnd = Math.min(normalized.length, nextNumber >= 0 ? nextNumber : numberIndex + 10);
    let headIndex = -1;
    for (let index = numberIndex + 1; index < searchEnd; index += 1) {
      if (countedHeadWord.test(normalized[index])) {
        headIndex = index;
        break;
      }
    }
    if (headIndex < 0) continue;
    const modifierIndices = normalized
      .map((word, index) => ({ word, index }))
      .filter(({ word, index }) => index > numberIndex && index < headIndex && countedModifierWord.test(word))
      .map(({ index }) => index);
    const attachmentIndex = normalized.findIndex((word, index) => index > headIndex && index < searchEnd && countedAttachmentWord.test(word));
    groups.push({
      start,
      numberIndex,
      headIndex,
      modifierIndices,
      ...(attachmentIndex >= 0 ? { attachmentIndex } : {}),
      emphatic: start < numberIndex || !/^one$/i.test(normalized[numberIndex]),
    });
  }
  return groups;
}

function compactCountedPhrase(words: string[], maximum: number): string[] | undefined {
  const normalized = words.map(semanticWord);
  const candidates = countedWordGroups(words).filter((group) => group.emphatic);
  const group = candidates.sort((left, right) => {
    const leftScore = (!/^one$/i.test(normalized[left.numberIndex]) ? 1_000 : 0) + left.modifierIndices.length * 20 + (left.attachmentIndex !== undefined ? 50 : 0) + left.numberIndex;
    const rightScore = (!/^one$/i.test(normalized[right.numberIndex]) ? 1_000 : 0) + right.modifierIndices.length * 20 + (right.attachmentIndex !== undefined ? 50 : 0) + right.numberIndex;
    return rightScore - leftScore;
  })[0];
  if (!group) return undefined;
  const quantityIndices = Array.from({ length: group.numberIndex - group.start + 1 }, (_, index) => group.start + index);
  const attachmentIndices = group.attachmentIndex === undefined ? [] : [group.attachmentIndex];
  const fixed = [...quantityIndices, group.headIndex, ...attachmentIndices];
  if (fixed.length > maximum) return undefined;
  const modifierCapacity = maximum - fixed.length;
  const chosenModifiers = [...group.modifierIndices]
    .sort((left, right) => {
      const score = (index: number) => /^(?:conical|pointed|sharp|spherical|curved|straight|attach\w*|connect\w*|join\w*)$/i.test(normalized[index])
        ? 300
        : /^(?:separate|separated|countable|distinct|continuous|articulated)$/i.test(normalized[index]) ? 200 : 100;
      return score(right) - score(left) || left - right;
    })
    .slice(0, modifierCapacity);
  const phraseIndices = [...new Set([...fixed, ...chosenModifiers])].sort((left, right) => left - right);
  const remaining = maximum - phraseIndices.length;
  if (remaining <= 0) return phraseIndices.map((index) => words[index]);
  const contextHeads = normalized
    .map((word, index) => ({ word, index }))
    .filter(({ word, index }) => countedHeadWord.test(word) && !phraseIndices.includes(index))
    .sort((left, right) => left.index - right.index);
  if (contextHeads.length === 0) return phraseIndices.map((index) => words[index]);
  // Preserve the other structural heads in a quantified relationship before
  // spending remaining words on adjectives. Otherwise a phrase such as
  // "wooden handle joined to chain made of four links" can collapse to only
  // "hanging chain; four links" and erase one connected endpoint.
  const chosenHeads = contextHeads.slice(0, remaining);
  const contextIndices = chosenHeads.map(({ index }) => index);
  let contextCapacity = remaining - contextIndices.length;
  for (const contextHead of chosenHeads) {
    if (contextCapacity <= 0) break;
    const preceding = contextHead.index - 1;
    if (preceding >= 0
      && !countedNumberWord.test(normalized[preceding])
      && !/^(?:exactly|minimum|maximum|at|least)$/i.test(normalized[preceding])
      && !lowInformationWord.test(normalized[preceding])) {
      contextIndices.push(preceding);
      contextCapacity -= 1;
    }
  }
  const selected = [...new Set([...phraseIndices, ...contextIndices])].sort((left, right) => left - right);
  const contextBeforePhrase = Math.max(...contextIndices) < Math.min(...phraseIndices);
  const boundaryIndex = contextBeforePhrase ? Math.max(...contextIndices) : Math.max(...phraseIndices);
  return selected.map((index) => index === boundaryIndex ? `${words[index].replace(/[;,:]+$/g, "")};` : words[index]);
}

const compactWords = (clause: string) => {
  const words = clause.split(/\s+/).filter(Boolean);
  if (words.length <= 6) return words;
  const compact = words.filter((word) => !lowInformationWord.test(word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")));
  return compact.length >= 3 ? compact : words;
};
const selectClauseWords = (words: string[], maximum: number, preserveIdentity = false) => {
  if (words.length <= maximum) return words;
  const countedPhrase = compactCountedPhrase(words, maximum);
  if (countedPhrase) return countedPhrase;
  const identityIndices = preserveIdentity ? new Set(words.slice(0, Math.min(4, maximum)).map((_, index) => index)) : new Set<number>();
  const selected = words
    .map((word, index) => ({
      word,
      index,
      score: (identityIndices.has(index) ? 1_000 : 0) + (structuralTerms.test(word) ? 100 : 0) + (index < 4 ? 60 - index : 0) + (index >= words.length - 2 ? 10 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maximum)
    .sort((a, b) => a.index - b.index);
  return selected.map((entry) => entry.word);
};

/** Preserve identity plus late structural/quantified clauses inside the CLIP budget. */
function retainedDefiningText(value: string, maximum: number, wordsPerClause = 4): string {
  const clauses = cleanClauses(value).filter(s => !standalonePresentation.test(s) && !decoration.test(s));
  if (clauses.length === 0) return "";
  const entries = clauses.map((clause, index) => ({
    clause,
    index,
    words: compactWords(clause),
    priority: (index === 0 ? 6 : 0) + (structuralTerms.test(clause) ? 5 : 0) + (/\b(?:must|required|preserve|remain|without|no)\b/i.test(clause) ? 3 : 0),
  }));
  const originalWordCount = clauses.reduce((count, clause) => count + clause.split(/\s+/).filter(Boolean).length, 0);
  if (originalWordCount <= maximum) return clauses.join("; ");
  if (entries.reduce((count, entry) => count + entry.words.length, 0) <= maximum) return entries.map((entry) => entry.words.join(" ")).join("; ");

  const selected = [...entries]
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
    .slice(0, Math.max(1, Math.min(entries.length, Math.floor(maximum / wordsPerClause))));
  const clauseMinimumWords = Math.max(1, Math.min(4, wordsPerClause));
  const allocations = new Map(selected.map((entry) => [entry.index, Math.min(clauseMinimumWords, entry.words.length)]));
  let remaining = maximum - [...allocations.values()].reduce((sum, value) => sum + value, 0);
  while (remaining > 0) {
    let advanced = false;
    for (const entry of selected) {
      const current = allocations.get(entry.index)!;
      if (current >= entry.words.length || remaining <= 0) continue;
      allocations.set(entry.index, current + 1);
      remaining -= 1;
      advanced = true;
    }
    if (!advanced) break;
  }
  return selected
    .sort((a, b) => a.index - b.index)
    .map((entry) => selectClauseWords(entry.words, allocations.get(entry.index)!, entry.index === 0).join(" "))
    .join("; ");
}

/** Preserve quantified anatomy/parts from the base brief unless the newest
 * refinement already repeats that exact quantity and head noun. */
function retainedBaseCountedRequirements(value: string, newestRefinement: string): string[] {
  const splitCounts = value.replace(/\s+and\s+(?=(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b)/gi, "; ");
  const newestWords = newestRefinement.toLowerCase().split(/\s+/).map(semanticWord);
  const newestCountedHeads = new Set(
    countedWordGroups(compactWords(newestRefinement))
      .filter((candidate) => candidate.emphatic)
      .map((candidate) => semanticWord(compactWords(newestRefinement)[candidate.headIndex])),
  );
  const retained: string[] = [];
  for (const clause of cleanClauses(splitCounts)) {
    const words = compactWords(clause);
    const group = countedWordGroups(words).find((candidate) => candidate.emphatic);
    if (!group) continue;
    const quantity = semanticWord(words[group.numberIndex]);
    const head = semanticWord(words[group.headIndex]);
    // A newer emphatic count for the same part replaces the older quantity.
    // Retaining both (for example twenty and twenty-four spikes) wastes the
    // CLIP window and gives the image model contradictory counting signals.
    if (newestCountedHeads.has(head) || (newestWords.includes(quantity) && newestWords.includes(head))) continue;
    const compact = compactCountedPhrase(words, 6);
    if (compact?.length) retained.push(compact.join(" "));
  }
  return [...new Set(retained)].slice(0, 4);
}

/** Preserve the most important front/rear creature-part relationships as
 * coherent clauses. These are generic anatomy-layout constraints, not an
 * object generator: they apply to any prompted creature whose parts emerge,
 * protrude or extend through a named body region/opening. */
function retainedCreatureSpatialRequirements(value: string): string[] {
  const anatomy = /\b(?:head|ears?|torso|body|hindquarters|tail|legs?|paws?|wings?|fins?|beak)\b/i;
  const enclosingForm = /\b(?:shell|pod|case|casing|costume|opening|hollow|body)\b/i;
  const relationship = /\b(?:emerg\w*|protrud\w*|extend\w*|pass\w*|integrat\w*|fill\w*|attach\w*|connect\w*|join\w*|grow\w*|fus\w*|wear\w*|encas\w*|cover\w*|form\w*|replac\w*|becom\w*|through|inside|within|around|front|rear|behind|below|above|opening|shell)\b/i;
  const selectSpatialWords = (clause: string): string => {
    const words = compactWords(clause);
    const maximum = countedWordGroups(words).some((candidate) => candidate.emphatic) ? 7 : 6;
    if (words.length <= maximum) return words.join(" ");
    const normalized = words.map(semanticWord);
    const relationshipIndices = new Set<number>();
    const anatomyIndices = new Set<number>();
    const enclosingFormIndices = new Set<number>();
    normalized.forEach((word, index) => {
      if (relationship.test(word)) relationshipIndices.add(index);
      if (anatomy.test(word)) anatomyIndices.add(index);
      if (enclosingForm.test(word)) enclosingFormIndices.add(index);
    });
    const countedAnatomyIndices = new Set<number>();
    normalized.forEach((word, index) => {
      if (!countedNumberWord.test(word)) return;
      if ([1, 2, 3].some((offset) => anatomyIndices.has(index + offset))) countedAnatomyIndices.add(index);
    });
    const anatomyModifierIndices = new Set(
      [...anatomyIndices]
        .flatMap((index) => [index - 1, index - 2])
        .filter((index) => index >= 0 && !countedNumberWord.test(normalized[index]) && !anatomy.test(normalized[index])),
    );
    const firstRelationship = Math.min(...relationshipIndices);
    const beforeRelationship = Number.isFinite(firstRelationship) ? firstRelationship - 1 : -1;
    return words
      .map((word, index) => ({
        word,
        index,
        score: relationshipIndices.has(index) ? 1_000
          : anatomyIndices.has(index) || enclosingFormIndices.has(index) ? 900
            : countedAnatomyIndices.has(index) ? 800
              : anatomyModifierIndices.has(index) ? 700
                : index === beforeRelationship ? 650
                  : index >= words.length - 3 ? 600
                    : structuralTerms.test(word) ? 100
                      : index < 4 ? 60 - index
                        : 0,
      }))
      .sort((left, right) => right.score - left.score || right.index - left.index)
      .slice(0, maximum)
      .sort((left, right) => left.index - right.index)
      .map(({ word }) => word)
      .join(" ");
  };
  return cleanClauses(value)
    .map((clause, index) => ({
      clause,
      index,
      hasAnatomyPair: (clause.match(new RegExp(anatomy.source, "gi")) ?? []).length >= 2,
      score: (/\b(?:front|rear|opening)\b/i.test(clause) ? 8 : 0)
        + (/\b(?:hindquarters|tail)\b/i.test(clause) ? 6 : 0)
        + (/\b(?:head|ears?)\b/i.test(clause) ? 5 : 0)
        + (/\b(?:through|inside|within|around|shell)\b/i.test(clause) ? 3 : 0),
    }))
    .filter(({ clause, hasAnatomyPair }) => ((anatomy.test(clause) || enclosingForm.test(clause)) && relationship.test(clause)) || hasAnatomyPair)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 3)
    .sort((left, right) => left.index - right.index)
    .map(({ clause }) => selectSpatialWords(clause))
    .filter(Boolean);
}

function retainedCreatureIdentityAnchor(value: string): string {
  const firstClause = cleanClauses(value).find((clause) => !standalonePresentation.test(clause)) ?? value;
  // Identity anchors are leading noun phrases. Count-aware compaction is
  // intentionally avoided here because a later "one shell" must not replace
  // the creature name at the front of the same clause.
  const maximum = /[^\x00-\x7f]/.test(firstClause) ? 8 : 6;
  return compactWords(firstClause).slice(0, maximum).join(" ");
}

const floatingPose = /\b(?:airborne|free[- ]?floating|floating(?:\s+freely)?|freely suspended|zero[- ]gravity|weightless|omnidirectional|in all directions)\b/i;
const noSupportPose = /\b(?:(?:no|without)(?:\s+(?:a|an|any|the|added|visible|external|separate))*\s+(?:(?:display|mounting)\s+)?(?:stand|pedestal|plinth|support(?:\s+(?:base|fixture))?|base|ground(?:\s+(?:plane|slab))?)|(?:must|should|do(?:es)?)\s+not\s+(?:add|include|use|show|create|have)(?:\s+(?:a|an|any|the|added|visible|external|separate))*\s+(?:(?:display|mounting)\s+)?(?:stand|pedestal|plinth|support(?:\s+(?:base|fixture))?|base|ground(?:\s+(?:plane|slab))?))\b/i;
const refinementMarker = /\b(?:shape refinement|refinement request)\s*:\s*/i;

function objectTypeConflict(type: Exclude<Prompt3DObjectType, "auto">): Error {
  return new Error(`The prompt explicitly excludes the selected ${type.replaceAll("-", " ")} object type. Clear or re-enter the manual object controls for this edited prompt.`);
}

function typeMentions(text: string, type: Exclude<Prompt3DObjectType, "auto">): Array<{ index: number; excluded: boolean }> {
  const pattern = OBJECT_TYPE_TERMS[type];
  const matcher = new RegExp(pattern.source, `${pattern.flags.replaceAll("g", "")}g`);
  return [...text.matchAll(matcher)].map((match) => ({
    index: match.index,
    excluded: typeMentionIsExcluded(text, match.index, match[0].length),
  }));
}

function typeMentionIsExcluded(text: string, index: number, length: number): boolean {
  const segmentStart = Math.max(text.lastIndexOf(".", index - 1), text.lastIndexOf("!", index - 1), text.lastIndexOf("?", index - 1), text.lastIndexOf(";", index - 1), text.lastIndexOf("\n", index - 1)) + 1;
  const prefix = text.slice(segmentStart, index);
  const suffix = text.slice(index + length, index + length + 40);
  const scoped = prefix.match(/\b(?:no|not|without|never|exclude(?:s|d|ing)?|excluding|omit(?:s|ted|ting)?|avoid(?:s|ed|ing)?|anything\s+but|rather\s+than)\b([^.!?;\n]{0,80})$/i);
  if (scoped) {
    if (/\b(?:but|instead)\b/i.test(scoped[1])) return false;
    if (/\b(?:extra|additional|another|other|duplicate|second|surrounding|background)\b/i.test(scoped[1])) return false;
    return true;
  }
  return /^\s*[- ]free\b/i.test(suffix) || /^\s+(?:is|are)\s+(?:excluded|forbidden|not allowed)\b/i.test(suffix);
}

function firstAffirmativeTypeMention(text: string, type: Exclude<Prompt3DObjectType, "auto">): number {
  return typeMentions(text, type).find((mention) => !mention.excluded)?.index ?? -1;
}

export function promptExplicitlyExcludesObjectType(text: string, type: Exclude<Prompt3DObjectType, "auto">): boolean {
  const mentions = typeMentions(text, type);
  return mentions.some((mention) => mention.excluded) && !mentions.some((mention) => !mention.excluded);
}

export function objectRulesContradictPrompt(spec: Pick<AssetSpecV1, "prompt" | "objectRules">): boolean {
  const type = spec.objectRules?.type;
  return Boolean(type && type !== "auto" && promptExplicitlyExcludesObjectType(spec.prompt, type));
}

export function assertObjectRulesCompatibleWithPrompt(spec: Pick<AssetSpecV1, "prompt" | "objectRules">): void {
  const type = spec.objectRules?.type;
  if (type && type !== "auto" && objectRulesContradictPrompt(spec)) throw objectTypeConflict(type);
}

export const HUNYUAN_CLIP_TOKEN_LIMIT = 77;
export const PROMPT3D_CLIP_SAFE_TOKEN_BUDGET = 75;
// The generic negative vocabulary contains several compounds whose exact
// Hunyuan BERT WordPiece count can exceed the portable estimator. Keep a
// larger measured margin here so a valid user exclusion never reaches the
// provider only to fail at model warm-up.
export const PROMPT3D_NEGATIVE_CLIP_SAFE_TOKEN_BUDGET = 70;

/**
 * Conservative local surrogate for HunyuanDiT's lower-cased BERT WordPiece
 * tokenizer. Punctuation and likely long-word splits count independently, and
 * the compiler retains headroom below the model's hard limit.
 */
export function estimateHunyuanClipTokens(text: string): number {
  const units = text.normalize("NFKC").match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];
  return 2 + units.reduce((count, unit) => {
    if (!/^[\p{L}\p{N}]+$/u.test(unit)) return count + 1;
    if (/[^\x00-\x7f]/.test(unit)) return count + [...unit].length;
    const length = unit.length;
    let pieces = 1 + (length > 9 ? Math.ceil((length - 9) / 4) : 0);
    if (length >= 8 && /(?:able|less|ment|tion|sion|ed|ing|ically|ously)$/i.test(unit)) pieces += 1;
    return count + pieces;
  }, 0);
}

export interface HunyuanConditioningSegment {
  text: string;
  minimumWords: number;
  trimRank?: number;
}

function renderConditioningSegments(segments: HunyuanConditioningSegment[]): string {
  return segments
    .map(({ text }) => text.trim())
    .filter(Boolean)
    .map((text) => `${text.replace(/[.!?;,:]+$/g, "")}.`)
    .join(" ");
}

function trimConditioningWords(words: string[], minimumWords: number): string[] | undefined {
  if (words.length <= minimumWords) return undefined;
  if (minimumWords === 0) return [];
  const lastIndex = words.length - 1;
  const endingCountedGroup = countedWordGroups(words).find((group) => group.headIndex === lastIndex);
  if (endingCountedGroup) {
    return endingCountedGroup.start >= minimumWords ? words.slice(0, endingCountedGroup.start) : undefined;
  }
  // Prefer dropping a complete trailing clause. Word-by-word truncation can
  // otherwise leave malformed conditioning such as "centered in a.", which
  // Hunyuan can interpret as an incomplete framing instruction.
  for (let index = words.length - 1; index >= minimumWords; index -= 1) {
    if (/[.!?;]$/.test(words[index - 1] ?? "")) return words.slice(0, index);
  }
  const trimmed = words.slice(0, -1);
  while (trimmed.length > minimumWords && lowInformationWord.test(semanticWord(trimmed.at(-1) ?? ""))) trimmed.pop();
  return trimmed;
}

export function fitHunyuanClipBudget(segments: HunyuanConditioningSegment[]): string {
  const working = segments.map((segment) => ({ ...segment, words: segment.text.trim().split(/\s+/).filter(Boolean) }));
  const trimmable = working
    .filter((segment) => segment.trimRank !== undefined)
    .sort((a, b) => b.trimRank! - a.trimRank!);
  let prompt = renderConditioningSegments(working);
  while (estimateHunyuanClipTokens(prompt) > PROMPT3D_CLIP_SAFE_TOKEN_BUDGET) {
    const candidate = trimmable
      .map((segment) => ({ segment, words: trimConditioningWords(segment.words, segment.minimumWords) }))
      .find((entry) => entry.words !== undefined);
    if (!candidate) throw new Error("The required object identity, refinement and pose cannot fit HunyuanDiT's safe CLIP token budget.");
    const segment = candidate.segment;
    segment.words = candidate.words!;
    segment.text = segment.words.join(" ");
    prompt = renderConditioningSegments(working);
  }
  return prompt;
}

function expandedNegativeTerms(values: string[]): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const value of values) {
    for (const part of value.split(/\s*(?:,|\bor\b)\s*/i)) {
      const term = cleanNegativeIntent(part);
      const key = term.toLowerCase();
      if (!term || seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
    }
  }
  return terms;
}

/** User exclusions are mandatory; redundant generic guardrails fill only the remaining negative-token budget. */
function fitNegativePrompt(requiredValues: string[], defaultValues: string[]): string {
  const required = expandedNegativeTerms(requiredValues);
  const render = (values: string[]) => values.join(", ");
  if (estimateHunyuanClipTokens(render(required)) > PROMPT3D_NEGATIVE_CLIP_SAFE_TOKEN_BUDGET) {
    throw new Error("The requested exclusions cannot fit HunyuanDiT's safe negative-prompt token budget.");
  }
  const retained = [...required];
  const seen = new Set(required.map((value) => value.toLowerCase()));
  for (const value of expandedNegativeTerms(defaultValues)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    const candidate = [...retained, value];
    if (estimateHunyuanClipTokens(render(candidate)) > PROMPT3D_NEGATIVE_CLIP_SAFE_TOKEN_BUDGET) continue;
    retained.push(value);
    seen.add(key);
  }
  return render(retained);
}

function describesUnsupportedPose(text: string): boolean {
  return floatingPose.test(text) || noSupportPose.test(text);
}

function requestedNonUprightOrientation(text: string): string | undefined {
  if (/\b(?:upside[- ]down|inverted)\b/i.test(text)) return "inverted as requested";
  if (/\b(?:diagonal(?:ly)?|slant(?:ed|ing)?|from (?:the )?(?:lower|upper) (?:left|right) to (?:the )?(?:lower|upper) (?:left|right))\b/i.test(text)) return "diagonal as requested";
  if (/\b(?:horizontal(?:ly)?|sideways|on (?:its|the) side)\b/i.test(text)) return "horizontal as requested";
  if (/\b(?:laid|lying|resting) flat\b/i.test(text)) return "laid flat as requested";
  if (/\b(?:non[- ]upright|not upright|tilt(?:ed|ing)?|angled|at (?:an? )?angle)\b/i.test(text)) return "at the requested non-vertical angle";
  return undefined;
}

/**
 * Preserve an explicitly requested articulated connector as a first-class
 * relationship instead of relying on a long free-form noun list to survive
 * CLIP-budget compaction. This is deliberately connector-generic: it applies
 * to any prompted asset whose visible structure contains a chain or linked
 * articulation, without introducing an example-specific object generator.
 */
function articulatedConnectorRequirement(text: string): string | undefined {
  if (!/\b(?:chains?|chain[- ]links?|interlock(?:ed|ing)?(?:\s+[a-z-]+){0,2}\s+(?:links?|rings?)|linked\s+rings?|open(?:\s+[a-z-]+){0,2}\s+rings?)\b/i.test(text)) return undefined;
  return "Open chain links connect both ends";
}

export interface Prompt3DConceptPresentationContract {
  version: 1;
  subject: "one-complete-primary-subject";
  framing: "centered-with-broad-margin";
  background: { mode: "plain-white" | "requested"; clauses: string[] };
  lighting: { mode: "neutral" | "requested"; clauses: string[] };
  support: { mode: "none" | "requested"; clauses: string[] };
  scenery: { mode: "none" | "requested"; clauses: string[] };
}

export interface Prompt3DPromptPlan {
  version: 1;
  objectType: Exclude<Prompt3DObjectType, "auto">;
  component: Prompt3DComponent;
  generationPrompt: string;
  negativePrompt: string;
  surfaceBrief: string;
  removedPresentation: string[];
  /** The effective review contract, including every affirmative presentation exception. */
  presentationContract: Prompt3DConceptPresentationContract;
  review: string;
}

/**
 * Compile a tokenizer-bounded Hunyuan prompt while retaining the user's
 * affirmative subject brief. Typed profiles are structural guardrails, not a
 * replacement for prompted identity, materials, counts or connected parts.
 */
export function compilePrompt3DPrompt(spec: AssetSpecV1): Prompt3DPromptPlan {
  const rule = resolveObjectRules(spec);
  const clauses = cleanClauses(spec.prompt);
  const promptIntent = partitionPromptIntent(spec.prompt);
  const noteIntent = partitionPromptIntent(spec.objectRules?.shapeNotes ?? "");
  const rawRefinementSections = spec.prompt.split(refinementMarker);
  const refinementSections = rawRefinementSections.map((section) => partitionPromptIntent(section).positiveText);
  const hasRefinement = refinementSections.length > 1;
  const basePrompt = refinementSections[0];
  const latestRefinement = hasRefinement ? refinementSections.at(-1) ?? "" : "";
  const earlierRefinements = hasRefinement ? refinementSections.slice(1, -1).join("; ") : "";
  const removedPresentation = clauses.filter(s => standalonePresentation.test(s));
  const notes = cleanClauses(noteIntent.positiveText).filter(s => !standalonePresentation.test(s) && !decoration.test(s)).join("; ");
  const terms = promptIntent.positiveText.toLowerCase();
  const typedDetails: string[] = [];
  const identityDetails: string[] = [];
  const requiredIdentityDetails: string[] = [];
  const requiredDetails: string[] = [];
  const baseRequirementDetails: string[] = [];
  const earlierDetails: string[] = [];
  let requiresConnectedAnatomy = false;
  if (rule.type === "axe" && rule.component !== "handle" && rule.component !== "pommel") {
    typedDetails.push(/double[ -]headed|two.*blades|double[ -]bit/.test(terms) ? "Two opposing cutting blades on the same single axe head" : "One cutting blade on the axe head");
    if (/crescent/.test(terms)) typedDetails.push("Broad crescent-shaped cutting edges");
  }
  if (rule.type === "sword" && ["whole", "blade"].includes(rule.component)) {
    if (/sabre|saber|scimitar|katana|curved/.test(terms)) typedDetails.push("Clearly curved single blade");
    else if (/leafblade|leaf[ -]shaped/.test(terms)) typedDetails.push("Broad leaf-shaped blade with a sharp tip");
    else if (/rapier/.test(terms)) typedDetails.push("Long narrow straight blade");
    else typedDetails.push("Straight tapered blade");
  }
  if (hasRefinement) {
    // Refinements still need enough of the original affirmative subject brief
    // to identify anatomy and connected parts. A six-word prefix preserved the
    // noun but discarded late essentials such as a rabbit's four paws or a
    // flail's handle-chain-ball relationship, leaving Hunyuan to guess.
    const firstBaseClause = cleanClauses(basePrompt)[0] ?? basePrompt;
    // Keep the subject noun phrase independent from its later attributes.
    // Otherwise the counted-phrase compactor can replace "spherical rocky
    // asteroid" with an obsolete count from the same long clause.
    const baseIdentityClause = firstBaseClause.split(/\bwith\b/i)[0]?.trim() || firstBaseClause;
    const retainedIdentity = retainedDefiningText(baseIdentityClause, rule.type === "creature" ? 7 : 9, 3);
    const requestedChange = retainedDefiningText(latestRefinement, rule.type === "creature" ? 12 : 18, 3);
    const priorRequirements = retainedDefiningText(earlierRefinements, 6);
    if (retainedIdentity) identityDetails.push(retainedIdentity);
    baseRequirementDetails.push(...retainedBaseCountedRequirements(basePrompt, latestRefinement));
    if (requestedChange) requiredDetails.push(`Required refinement: ${requestedChange}`);
    if (priorRequirements) earlierDetails.push(`Retain earlier refinement: ${priorRequirements}`);
  } else {
    // Every subject carries its requested identity in the user's affirmative
    // prose. A typed profile may add useful topology/orientation constraints,
    // but must not collapse a prompted variation (for example an articulated
    // or unusual member of that broad type) back to the profile template.
    // Leave enough room for late counted attachments to keep their shape,
    // body-region and direction words; the tokenizer-aware fitter below is
    // still the final authority on the 77-token Hunyuan limit.
    // Creature identity is frequently expressed as relationships between body
    // regions and another prompted form (inside a shell, emerging through an
    // opening, attached behind a body). Four-word clause fragments kept the
    // nouns but discarded those relationships, so Hunyuan received a bag of
    // anatomy words rather than the requested subject. Give creature clauses
    // enough contiguous context to retain their verbs and attachment nouns;
    // fitHunyuanClipBudget still trims optional profile/style prose first and
    // remains the final 77-token guard.
    const retained = retainedDefiningText(basePrompt, rule.type === "creature" ? 42 : 38, rule.type === "creature" ? 8 : 4);
    if (retained) identityDetails.push(retained);
    // Counts are acceptance-critical even when the source clause is late in a
    // long first-pass brief. Bind them as mandatory conditioning instead of
    // relying on the optional identity segment to survive token fitting.
    if (rule.type === "creature") {
      const identityAnchor = retainedCreatureIdentityAnchor(basePrompt);
      if (identityAnchor) requiredIdentityDetails.push(`Subject identity: ${identityAnchor}`);
      const spatialRequirements = retainedCreatureSpatialRequirements(basePrompt);
      if (spatialRequirements.length) {
        // One heading keeps every relationship mandatory without spending the
        // short CLIP window on a repeated compiler label for each clause.
        requiresConnectedAnatomy = true;
        requiredDetails.push(`Single connected anatomy: ${spatialRequirements.join("; ")}`);
      }
      baseRequirementDetails.push(...retainedBaseCountedRequirements(basePrompt, spatialRequirements.join("; ")));
    }
  }
  const wholeShape = rule.type === "creature"
    ? "One complete isolated creature with only the requested anatomy attached and fully visible"
    : rule.shape;
  const shapeIntent = partitionPromptIntent(rule.component === "whole" ? wholeShape : rule.shape);
  const shape = rule.component === "whole" ? shapeIntent.positiveText : `${shapeIntent.positiveText}, for a ${rule.profile.label.toLowerCase()}`;
  const affirmativePoseText = `${promptIntent.positiveText}\n${noteIntent.positiveText}`;
  const rawPoseText = `${spec.prompt}\n${spec.objectRules?.shapeNotes ?? ""}`;
  const hasFloatingPose = floatingPose.test(affirmativePoseText);
  const hasNoSupportPose = noSupportPose.test(rawPoseText);
  const requestedOrientation = requestedNonUprightOrientation(affirmativePoseText);
  const articulatedConnector = articulatedConnectorRequirement(affirmativePoseText);
  // A whole-object prompt that explicitly asks for an articulated connector
  // owns its topology. Broad typed profiles such as "solid head attached to one
  // handle" describe the common rigid member of the type and can directly
  // contradict a linked, jointed or flexible variation. Retain the user's
  // affirmative brief and connector review contract without injecting that
  // rigid profile shape into Hunyuan conditioning.
  const useTypedProfileShape = !(rule.component === "whole" && articulatedConnector);
  const hasUnsupportedPose = rule.type === "prop" && rule.component === "whole" && (hasFloatingPose || hasNoSupportPose);
  const orientation = requestedOrientation
    ? `${rule.component === "whole" ? "" : "Detached component "}${requestedOrientation}${hasFloatingPose ? " in empty space" : ""} full silhouette`
    : hasFloatingPose
      ? "Weightless in empty space full silhouette"
      : hasNoSupportPose
        ? `${rule.component === "whole" ? "Isolated subject" : "Detached component"} full silhouette`
        : rule.component !== "whole"
          ? `Detached component; ${rule.orientation}`
          : rule.type === "creature"
            ? hasRefinement
              ? "Full-body pose facing right"
              : "Natural motion-ready full-body pose with primary travel direction right"
            : rule.orientation;
  const genericRule = ["prop", "road-fixture", "environment", "building", "creature"].includes(rule.type);
  const affirmativeClauses = cleanClauses(promptIntent.positiveText);
  const supportClauses = affirmativeClauses.filter((clause) => supportPresentation.test(clause));
  const sceneryClauses = affirmativeClauses.filter((clause) => sceneryPresentation.test(clause) && !standardWhitePresentation.test(clause));
  const customBackgroundClauses = affirmativeClauses.filter((clause) => backdropPresentation.test(clause) && !standardWhitePresentation.test(clause));
  const customLightingClauses = affirmativeClauses.filter((clause) => lightingPresentation.test(clause) && !standardNeutralLighting.test(clause));
  const focusedClauses = (values: string[]) => [...new Set(values.map(focusedPresentationText).filter(Boolean))];
  const requestedSupportClauses = focusedClauses(supportClauses);
  const requestedSceneryClauses = focusedClauses(sceneryClauses);
  const requestedBackgroundClauses = focusedClauses(customBackgroundClauses);
  const requestedLightingClauses = focusedClauses(customLightingClauses);
  const requestedPresentation = [...new Set([
    ...requestedSupportClauses,
    ...requestedSceneryClauses,
    ...requestedBackgroundClauses,
    ...requestedLightingClauses,
  ])];
  const usesRequestedBackdrop = sceneryClauses.length > 0 || customBackgroundClauses.length > 0;
  const usesRequestedLighting = customLightingClauses.length > 0;
  const presentationPrompt = [
    "One subject central half",
    ...(!usesRequestedBackdrop ? ["plain white background"] : []),
    "broad margins",
    ...(!usesRequestedLighting ? ["neutral light"] : []),
    "game-ready",
  ].join(" ");
  const presentationContract: Prompt3DConceptPresentationContract = {
    version: 1,
    subject: "one-complete-primary-subject",
    framing: "centered-with-broad-margin",
    background: { mode: usesRequestedBackdrop ? "requested" : "plain-white", clauses: requestedBackgroundClauses },
    lighting: { mode: usesRequestedLighting ? "requested" : "neutral", clauses: requestedLightingClauses },
    support: { mode: requestedSupportClauses.length ? "requested" : "none", clauses: requestedSupportClauses },
    scenery: { mode: requestedSceneryClauses.length ? "requested" : "none", clauses: requestedSceneryClauses },
  };
  const compactedGenerationSegments: HunyuanConditioningSegment[] = [
    // Hunyuan attends most reliably to the leading subject tokens. Keep the
    // requested identity and mandatory part relationships ahead of the
    // standardized presentation baseline so framing cannot become the model's
    // dominant interpretation.
    ...requiredIdentityDetails.map((text) => ({ text, minimumWords: text.split(/\s+/).length })),
    ...identityDetails.map((text) => ({
      text,
      // Creature anatomy relationships and emphatic counts are repeated below
      // as mandatory segments. Let this descriptive copy trim far enough to
      // keep the subject/container identity without exhausting Hunyuan's CLIP
      // window on duplicate anatomy wording.
      minimumWords: Math.min(text.split(/\s+/).length, hasRefinement ? 6 : rule.type === "creature" ? 0 : 26),
      trimRank: 25,
    })),
    ...(useTypedProfileShape ? [{ text: shape, minimumWords: genericRule ? 0 : Math.min(5, shape.split(/\s+/).length), trimRank: genericRule ? 80 : 35 }] : []),
    ...typedDetails.map((text) => ({ text, minimumWords: Math.min(3, text.split(/\s+/).length), trimRank: 45 })),
    ...(articulatedConnector ? [{ text: articulatedConnector, minimumWords: 0, trimRank: 30 }] : []),
    ...(baseRequirementDetails.length ? [{
      text: `Base requirements: ${baseRequirementDetails.join("; ")}`,
      minimumWords: `Base requirements: ${baseRequirementDetails.join("; ")}`.split(/\s+/).length,
    }] : []),
    ...requiredDetails.map((text) => ({ text, minimumWords: text.split(/\s+/).length })),
    { text: presentationPrompt, minimumWords: presentationPrompt.split(/\s+/).length },
    ...earlierDetails.map((text) => ({ text, minimumWords: 0, trimRank: 70 })),
    {
      text: orientation,
      // A creature prompt with explicit counted anatomy and relational identity
      // is more important than the compiler's generic travel direction. The
      // visual brief still owns any explicit pose/orientation wording.
      minimumWords: rule.type === "creature" && !requestedOrientation && !hasFloatingPose && !hasNoSupportPose ? 0 : orientation.split(/\s+/).length,
      ...(rule.type === "creature" && !requestedOrientation && !hasFloatingPose && !hasNoSupportPose ? { trimRank: 75 } : {}),
    },
    ...requestedPresentation.map((text) => ({ text: `Requested presentation: ${text}`, minimumWords: `Requested presentation: ${text}`.split(/\s+/).length })),
    ...(notes ? [{ text: `Shape details: ${notes}`, minimumWords: 0, trimRank: 90 }] : []),
    ...(spec.style !== "custom" ? [{ text: `${spec.style.replaceAll("-", " ")} shape`, minimumWords: 0, trimRank: 100 }] : []),
    ...(!hasRefinement ? [{ text: "Clean unobstructed silhouette", minimumWords: 0, trimRank: 110 }] : []),
  ];
  const naturalCreatureBrief = cleanClauses(promptIntent.positiveText)
    .filter((clause) => !standalonePresentation.test(clause) && !decoration.test(clause))
    .join("; ");
  const naturalCreatureFraming = [
    "Small centered full-body subject",
    ...(!usesRequestedBackdrop ? ["plain white background"] : []),
    "broad margins",
    ...(!usesRequestedLighting ? ["neutral light"] : []),
  ].join(" ");
  const naturalCreaturePrompt = rule.type === "creature" && !hasRefinement && naturalCreatureBrief
    ? renderConditioningSegments([
      { text: naturalCreatureBrief, minimumWords: naturalCreatureBrief.split(/\s+/).length },
      // Positive scale and margin wording materially reduces clipped ears,
      // feet and tails before the retained isolation check can assess them.
      { text: naturalCreatureFraming, minimumWords: naturalCreatureFraming.split(/\s+/).length },
      ...requestedPresentation.map((text) => ({
        text: `Requested presentation: ${text}`,
        minimumWords: `Requested presentation: ${text}`.split(/\s+/).length,
      })),
    ])
    : "";
  const generationPrompt = naturalCreaturePrompt
    && estimateHunyuanClipTokens(naturalCreaturePrompt) <= PROMPT3D_CLIP_SAFE_TOKEN_BUDGET
    ? naturalCreaturePrompt
    : fitHunyuanClipBudget(compactedGenerationSegments);
  const subjectNegatives = rule.type === "creature"
    // Negative prompts are not reliably phrase-compositional. Terms such as
    // "partial body" and "multiple characters" can suppress the wanted body
    // or character concept itself, so creature exclusions avoid those broad
    // subject nouns and use framing/duplication terms instead.
    ? ["multiple subjects", "duplicate subject", ...(!naturalCreaturePrompt ? ["crowd"] : []), ...(requiresConnectedAnatomy ? ["detached requested parts", "separate accessory"] : [])]
    : ["partial object", "multiple objects", "duplicate", "hands", "person", "scabbard"];
  const requestedSupport = supportClauses.length > 0;
  const requestedScenery = sceneryClauses.length > 0;
  const requestedShadow = customLightingClauses.some((clause) => /\bshadows?\b/i.test(clause));
  const requestedDarkBackground = customBackgroundClauses.some((clause) => /\b(?:dark|black|night)\b/i.test(clause));
  const negativePrompt = fitNegativePrompt([
    ...promptIntent.negativeTerms,
    ...noteIntent.negativeTerms,
    ...shapeIntent.negativeTerms,
  ], [
    "cropped", "cut off", "close-up", "out of frame",
    ...subjectNegatives,
    ...(hasNoSupportPose ? ["pedestal", "support base", "mounting base"] : []),
    ...(hasFloatingPose ? [
      ...(!/\bcords?\b/i.test(promptIntent.positiveText) ? ["hanging cord"] : []),
      ...(!/\brope\b/i.test(promptIntent.positiveText) ? ["rope"] : []),
      ...(!/\bstrings?\b/i.test(promptIntent.positiveText) ? ["string"] : []),
      ...(!/\bfixtures?\b/i.test(promptIntent.positiveText) ? ["fixture"] : []),
    ] : []),
    ...(!naturalCreaturePrompt ? ["contact sheet", "split screen", "multiple views"] : []),
    "text", "watermark",
    ...(!requestedScenery ? ["scenery"] : []),
    ...(!naturalCreaturePrompt && !requestedShadow ? ["shadow"] : []),
    ...(!naturalCreaturePrompt && !requestedDarkBackground ? ["dark background"] : []),
    ...(!requestedSupport ? ["display stand", ...(!naturalCreaturePrompt ? ["ground slab"] : [])] : []),
  ]);
  const connectorReview = articulatedConnector
    ? " Inspect the separate articulated chain links and both connected end components."
    : "";
  return { version: 1, objectType: rule.type, component: rule.component, generationPrompt,
    negativePrompt,
    surfaceBrief: spec.prompt, removedPresentation, presentationContract, review: hasUnsupportedPose ? "One complete unsupported object, centred without cords or fixtures; inspect every protrusion and the full silhouette." : rule.component === "whole" ? `${rule.profile.review}${connectorReview}` : `${COMPONENT_LABELS[rule.component]} only. ${rule.orientation}. Check the ${rule.anchorLabel.toLowerCase()} before export.${connectorReview}` };
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
  return type === "building" ? "building" : type === "road-fixture" ? "road-furniture" : type === "environment" ? "environment" : type === "creature" ? "character" : "prop";
}
