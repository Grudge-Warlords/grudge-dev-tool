export const PROMPTED_MOTION_MAX_CHARS = 800;

export interface PromptedMotionIntent {
  directionalTravel: boolean;
  explicitPath: "figure-eight" | "orbit" | null;
  returnToOrigin: boolean;
  direction: [number, number, number];
  /** True when forward/backward is relative to the generated subject's facing pose. */
  subjectRelativeDirection: boolean;
  /** Body-local forward/backward wording, without promoting it to root travel. */
  bodyRelativeDirection: -1 | 0 | 1;
  stationaryRequested: boolean;
  verticalMotionSuppressed: boolean;
  negatedDirectionalMotion: boolean;
  hopping: boolean;
  groundedGait: boolean;
  limbSequence: boolean;
  swimming: boolean;
  slithering: boolean;
  flying: boolean;
  flapping: boolean;
  flappingSuppressed: boolean;
  gliding: boolean;
  swinging: boolean;
  spinning: boolean;
  squashStretch: boolean;
  crouching: boolean;
  /** A paired lower-limb action explicitly asks both sides to move in phase. */
  synchronizedLimbs: boolean;
  /** A paired lower-limb action explicitly asks the sides to alternate. */
  alternatingLimbs: boolean;
  /** A lower-limb bend, tuck or raise is part of the requested action. */
  limbFlexion: boolean;
  /** Prompt-bound articulation angle. Null means no numeric angle was requested. */
  articulationAngleDegrees: number | null;
  /** A rear appendage or rear body region must visibly counterbalance the main action. */
  counterbalance: boolean;
  /** The moving lower region must visibly return to or retain ground contact. */
  groundContact: boolean;
  trail: boolean;
  orientation: boolean;
}

/** Human-readable preview of the body operators the main process will infer. */
export function promptedMotionBodyActions(intent: PromptedMotionIntent): string[] {
  const actions: string[] = [];
  if (intent.slithering) actions.push("whole-body slither wave");
  if (intent.swimming) actions.push("rear-body swimming wave");
  if (!intent.flappingSuppressed && (intent.flapping || (intent.flying && !intent.gliding))) actions.push("bilateral wing flaps");
  if (intent.groundedGait || intent.limbSequence) actions.push(intent.synchronizedLimbs ? "synchronized paired lower-limb motion" : "alternating grounded limb motion");
  if (intent.limbFlexion) actions.push(`${intent.articulationAngleDegrees ?? "prompted"}° lower-limb bend`);
  if (intent.counterbalance) actions.push("rear-region counterbalance");
  if (intent.groundContact) actions.push("ground-contact recovery");
  if (intent.squashStretch || (intent.hopping && !intent.verticalMotionSuppressed)) actions.push("squash and stretch");
  if (intent.crouching) actions.push("body crouch or bend");
  return actions;
}

const NEGATION_PREFIX = /\b(?:(?:do|does|should|must|will|can)\s+not|(?:do|does|should|must|will|ca)n['’]?t|not|never|without|avoid(?:ing)?|exclude(?:d|s|ing)?|omit(?:ted|s|ting)?|no)\b(?:[\s,-]+[\p{L}\p{N}_'-]+){0,6}[\s,-]*$/iu;

function matches(expression: RegExp, text: string): Array<{ index: number; value: string }> {
  const flags = expression.flags.includes("g") ? expression.flags : `${expression.flags}g`;
  return [...text.matchAll(new RegExp(expression.source, flags))].map((match) => ({ index: match.index, value: match[0] }));
}

function isNegated(text: string, index: number): boolean {
  // A contrasting clause starts a new instruction: "do not travel but unfold".
  // Keep "and/or" within the clause so "do not unfold or shatter" stays negative.
  const prefix = text.slice(Math.max(0, index - 120), index).split(/\b(?:but|however|instead)\b/u).at(-1) ?? "";
  return NEGATION_PREFIX.test(prefix) || /(?:^|[\s,;(])non[-\s]*$/iu.test(prefix);
}

function firstUnnegatedIndex(text: string, expression: RegExp): number {
  return matches(expression, text).find((match) => !isNegated(text, match.index))?.index ?? -1;
}

function hasUnnegated(text: string, expression: RegExp): boolean {
  return firstUnnegatedIndex(text, expression) >= 0;
}

/**
 * Shared fail-closed keyword gate for local prompt interpreters. Raw regular
 * expression tests must not turn "do not", "without" or "non-" clauses into
 * affirmative anatomy or motion instructions.
 */
export function hasAffirmativePromptMatch(value: string, expression: RegExp): boolean {
  const text = String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
  return hasUnnegated(text, expression);
}

/** Known unsupported transformations must not disappear behind a supported spin/path. */
export function promptedMotionCapabilityError(value: string): string | null {
  const transformation = /\b(?:bloom(?:s|ing)?|unfold(?:s|ing)?|fold(?:s|ing)?|melt(?:s|ing)?|shatter(?:s|ing)?|explod(?:e|es|ing)|dissolv(?:e|es|ing)|split(?:s|ting)?|sprout(?:s|ing)?|grow(?:s|ing)?|transform(?:s|ing)?\s+into|spread(?:s|ing)?\s+(?:out|apart)|open(?:s|ing)?\s+(?:up|out|like))\b/iu;
  if (hasAffirmativePromptMatch(value, transformation)) {
    return "This local motion route cannot create, unfold or separate model parts. Refine the geometry first, or describe supported rotation, travel, swing or body motion. The requested transformation will not be silently skipped.";
  }
  return null;
}

function hasNegated(text: string, expression: RegExp): boolean {
  return matches(expression, text).some((match) => isNegated(text, match.index));
}

const BODY_PART = String.raw`(?:body|torso|chest|core|head|neck|tail|wings?|forelegs?|front legs?|hind legs?|rear legs?|legs?|limbs?|paws?|feet|foot|arms?|hands?)`;

/** A local body-part direction must not be promoted into whole-model travel. */
function isBodyLocalMotion(text: string, index: number): boolean {
  const clause = text.slice(Math.max(0, index - 96), index).split(/[.;!?]/u).at(-1) ?? "";
  return new RegExp(String.raw`\b${BODY_PART}\b(?:[\s/,-]+[\p{L}\p{N}_'-]+){0,6}[\s/,-]*$`, "iu").test(clause);
}

function firstUnnegatedRootIndex(text: string, expression: RegExp): number {
  return matches(expression, text).find((match) => !isNegated(text, match.index) && !isBodyLocalMotion(text, match.index))?.index ?? -1;
}

function hasUnnegatedRoot(text: string, expression: RegExp): boolean {
  return firstUnnegatedRootIndex(text, expression) >= 0;
}

function hasUnnegatedBodyLocal(text: string, expression: RegExp): boolean {
  return matches(expression, text).some((match) => !isNegated(text, match.index) && isBodyLocalMotion(text, match.index));
}

/**
 * Extracts only placement and generic body-motion intent. Activity words such
 * as walk, swim, fly and slither never imply world-space travel by themselves.
 */
export function analyzePromptedMotionIntent(value: string): PromptedMotionIntent {
  const text = String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
  const figureEight = hasUnnegated(text, /\b(?:figure[ -]?(?:8|eight)|lemniscate)\b/u);
  const orbit = hasUnnegated(text, /\b(?:orbit|circle|circular|loop around)\b/u);
  const returnToOrigin = hasUnnegated(text, /\b(?:return|returns|returning|come|comes|coming|move|moves|moving|travel|travels|traveling|travelling)\s+(?:back\s+)?to\s+(?:the\s+)?(?:start|starting point|starting position|origin|original place|original point|original position)\b/u);
  const stationaryRequested = hasUnnegated(text, /\b(?:stationary|idle|in place|stay still|remain still|on the spot)\b/u);
  const hoppingExpression = /\b(?:hop|hops|hopped|hopping|jump|jumps|jumped|jumping|leap|leaps|leaping|bounce|bounces|bouncing|bound|bounding)\b/u;
  const gaitExpression = /\b(?:walk|walks|walking|run|runs|running|jog|jogs|jogging|march|marches|marching|stepping|stride|strides|striding|trot|trots|trotting|gallop|gallops|galloping|crawl|crawls|crawling)\b/u;
  const hopping = hasUnnegated(text, hoppingExpression);
  const groundedGait = hasUnnegated(text, gaitExpression);
  const limbSequence = hasUnnegated(text, /\b(?:forelegs?|front legs?|hind legs?|rear legs?|limbs?|paws?|feet)\b/u);
  const swimming = hasUnnegated(text, /\b(?:swim|swims|swimming)\b/u);
  const slithering = hasUnnegated(text, /\b(?:slither|slithers|slithering|undulate|undulates|undulating|wriggle|wriggles|wriggling)\b/u);
  const flying = hasUnnegated(text, /\b(?:fly|flies|flying|flight|soar|soars|soaring)\b/u);
  const flapExpression = /\b(?:flap|flaps|flapping|flutter|flutters|fluttering)\b/u;
  const flapping = hasUnnegated(text, flapExpression);
  const flappingSuppressed = hasNegated(text, flapExpression);
  const gliding = hasUnnegated(text, /\b(?:glide|glides|gliding|coast|coasts|coasting)\b/u);
  const swinging = hasUnnegated(text, /\b(?:swing|swings|swinging|sway|sways|swaying|pendulum)\b/u);
  const spinning = hasUnnegated(text, /\b(?:spin|spins|spinning|rotate|rotates|rotating|rotation|twirl|twirls|twirling)\b/u);
  const squashStretch = hasUnnegated(text, /\b(?:squash|squashes|squashing|stretch|stretches|stretching|compress|compresses|compressing|pulse|pulses|pulsing)\b/u);
  const crouching = hasUnnegated(text, /\b(?:crouch|crouches|crouching|kneel|kneels|kneeling|duck|ducks|ducking)\b/u)
    || hasUnnegated(text, /\b(?:body|torso|chest|core)\b(?:[\s,-]+[\p{L}\p{N}_'-]+){0,5}[\s,-]+(?:bend|bends|bending|lower|lowers|lowering|dip|dips|dipping)(?:\s+down)?\b/u);
  const synchronizedLimbs = hasUnnegated(text, /\b(?:feet|foot|paws?|legs?|limbs?)\b(?:[\s,-]+[\p{L}\p{N}_'-]+){0,6}[\s,-]+(?:together|simultaneously|synchronously|in unison)\b/u)
    || hasUnnegated(text, /\b(?:both|paired)\s+(?:feet|paws?|legs?|limbs?)\b/u);
  const alternatingLimbs = hasUnnegated(text, /\b(?:alternate|alternates|alternating|alternately|opposite|opposing)\b(?:[\s,-]+[\p{L}\p{N}_'-]+){0,5}[\s,-]+(?:feet|paws?|legs?|limbs?|steps?|strides?)\b/u)
    || hasUnnegated(text, /\b(?:feet|paws?|legs?|limbs?|steps?|strides?)\b(?:[\s,-]+[\p{L}\p{N}_'-]+){0,5}[\s,-]+(?:alternate|alternates|alternating|alternately|opposite|opposing)\b/u);
  const limbFlexionExpression = /\b(?:feet|foot|paws?|legs?|limbs?|knees?|ankles?)\b(?:[\s,-]+[\p{L}\p{N}_'°.-]+){0,9}[\s,-]+(?:bend|bends|bending|bent|flex|flexes|flexing|tuck|tucks|tucking|raise|raises|raising|lift|lifts|lifting)\b|\b(?:bend|bends|bending|bent|flex|flexes|flexing|tuck|tucks|tucking|raise|raises|raising|lift|lifts|lifting)\b(?:[\s,-]+[\p{L}\p{N}_'°.-]+){0,9}[\s,-]+(?:feet|foot|paws?|legs?|limbs?|knees?|ankles?)\b/u;
  const limbFlexion = hasUnnegated(text, limbFlexionExpression)
    || (synchronizedLimbs && hasUnnegated(text, /\b(?:bend|bends|bending|bent|flex|flexes|flexing|tuck|tucks|tucking|raise|raises|raising|lift|lifts|lifting)\b/u));
  const articulationMatch = limbFlexion
    ? /\b(\d+(?:\.\d+)?)\s*(?:°|degrees?|deg)\b/u.exec(text)
    : null;
  const articulationAngleDegrees = articulationMatch ? Number(articulationMatch[1]) : null;
  const counterbalance = hasUnnegated(text, /\b(?:tail|rear appendage|rear body|hindquarters?)\b(?:[\s,-]+[\p{L}\p{N}_'-]+){0,8}[\s,-]+(?:balance|balances|balancing|counterbalance|counterbalances|counterbalancing|stabilize|stabilizes|stabilizing|stability)\b/u)
    || hasUnnegated(text, /\b(?:balance|balances|balancing|counterbalance|counterbalances|counterbalancing|stabilize|stabilizes|stabilizing)\b(?:[\s,-]+[\p{L}\p{N}_'-]+){0,8}[\s,-]+(?:tail|rear appendage|rear body|hindquarters?)\b/u);
  const groundContact = hasUnnegated(text, /\b(?:feet|foot|paws?|legs?|limbs?)\b(?:[\s,-]+[\p{L}\p{N}_'-]+){0,7}[\s,-]+(?:touch|touches|touching|contact|contacts|contacting|plant|plants|planting|land|lands|landing)(?:\s+(?:on|upon))?\s+(?:the\s+)?ground\b/u)
    || hasUnnegated(text, /\b(?:grounded|ground contact|foot plant|feet planted|paws planted)\b/u);
  const trail = hasUnnegated(text, /\b(?:trail|trails|streak|streaks|streaking|afterglow)\b/u);
  const orientation = hasUnnegated(text, /\b(?:face|facing|follow|following|orient|oriented|steer|steering|turn|turning)\b/u);

  // A direction or a named path authorizes root travel. Locomotion style alone
  // stays in place, even when a distance field was left populated in the UI.
  const directionExpression = /\b(?:forward(?![- ]?facing)|forwards|ahead|backward|backwards|leftward|rightward|upward|downward|toward|towards|away|across|along|through|into|outward)\b/u;
  const intrinsicallyDirectionalExpression = /\b(?:advance|advances|advancing|retreat|retreats|retreating|ascend|ascends|ascending|descend|descends|descending|dive|dives|diving|launch|launches|launching|shoot|shoots|shooting|charge|charges|charging)\b/u;
  const explicitDirection = hasUnnegatedRoot(text, directionExpression);
  const intrinsicallyDirectional = hasUnnegatedRoot(text, intrinsicallyDirectionalExpression);
  const promptedDistance = /\b\d+(?:\.\d+)?\s*(?:m|metres?|meters?)\b/u.test(text);
  const displacementVerb = hasUnnegatedRoot(text, /\b(?:move|moves|moving|travel|travels|traveling|travelling|glide|glides|gliding|walk|walks|walking|run|runs|running|hop|hops|hopping|swim|swims|swimming|slither|slithers|slithering|fly|flies|flying)\b/u);
  const directionalTravel = figureEight || orbit || explicitDirection || intrinsicallyDirectional || (promptedDistance && displacementVerb);
  const negatedDirectionalMotion = hasNegated(text, directionExpression) || hasNegated(text, intrinsicallyDirectionalExpression);
  const verticalMotionSuppressed = hasNegated(text, /\b(?:vertical|elevation|lift|height|rise|rising|hop|hopping|jump|jumping)\b/u)
    || hasUnnegated(text, /\b(?:grounded|level path|level movement|flat path|flat movement)\b/u);

  const unnegatedDirection = (expression: RegExp): boolean => hasUnnegatedRoot(text, expression);
  const upward = unnegatedDirection(/\b(?:up|upward|ascend|ascends|ascending|rise|rising)\b/u);
  const downward = unnegatedDirection(/\b(?:down|downward|descend|descends|descending|dive|dives|diving)\b/u);
  const leftward = unnegatedDirection(/\b(?:left|leftward)\b/u);
  const rightward = unnegatedDirection(/\b(?:right|rightward)\b/u);
  const backward = unnegatedDirection(/\b(?:back|backward|backwards|reverse|retreat|retreats|retreating)\b/u);
  const forward = unnegatedDirection(/\b(?:forward|forwards|ahead|advance|advances|advancing|launch|launches|launching|shoot|shoots|shooting|charge|charges|charging)\b/u);
  const bodyLocalBackward = hasUnnegatedBodyLocal(text, /\b(?:back|backward|backwards|reverse)\b/u);
  const bodyLocalForward = hasUnnegatedBodyLocal(text, /\b(?:forward|forwards|ahead)\b/u);
  const bodyRelativeDirection: -1 | 0 | 1 = bodyLocalBackward ? -1 : bodyLocalForward ? 1 : 0;
  const absoluteDirection = upward || downward || leftward || rightward;
  const subjectRelativeDirection = !absoluteDirection
    && (forward || backward || (promptedDistance && displacementVerb && !explicitDirection && !intrinsicallyDirectional));
  const direction: [number, number, number] = upward
    ? [0, 1, 0]
    : downward
      ? [0, -1, 0]
      : leftward
        ? [-1, 0, 0]
        : rightward
          ? [1, 0, 0]
          : backward
            ? [0, 0, -1]
            : [0, 0, 1];

  return {
    directionalTravel,
    explicitPath: figureEight ? "figure-eight" : orbit ? "orbit" : null,
    returnToOrigin,
    direction,
    subjectRelativeDirection,
    bodyRelativeDirection,
    stationaryRequested,
    verticalMotionSuppressed,
    negatedDirectionalMotion,
    hopping,
    groundedGait,
    limbSequence,
    swimming,
    slithering,
    flying,
    flapping,
    flappingSuppressed,
    gliding,
    swinging,
    spinning,
    squashStretch,
    crouching,
    synchronizedLimbs,
    alternatingLimbs,
    limbFlexion,
    articulationAngleDegrees: Number.isFinite(articulationAngleDegrees) ? articulationAngleDegrees : null,
    counterbalance,
    groundContact,
    trail,
    orientation,
  };
}
