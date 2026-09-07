import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyPrompt3DPlanProposal } from "../src/main/prompt3d/planning";
import { applyPrompt3DEdit, assertObjectRulesCompatibleWithPrompt, compilePrompt3DPrompt, estimateHunyuanClipTokens, HUNYUAN_CLIP_TOKEN_LIMIT, inferObjectType, objectRulesContradictPrompt, PROMPT3D_CLIP_SAFE_TOKEN_BUDGET, PROMPT3D_NEGATIVE_CLIP_SAFE_TOKEN_BUDGET, withObjectRules } from "../src/shared/prompt3dRules";
import { PROMPT3D_SPEC_VERSION, type AssetSpecV1 } from "../src/shared/prompt3d";

function spec(prompt: string, category: AssetSpecV1["category"]): AssetSpecV1 {
  return withObjectRules({
    version: PROMPT3D_SPEC_VERSION,
    prompt,
    category,
    style: "stylized",
    route: "concept-image-to-3d",
    targetFormat: "glb",
    dimensions: { width: 1, height: 1, depth: 1, unit: "m" },
    scaleMode: "exact",
    budgets: { maxTriangles: 50_000, maxTextureResolution: 2048, maxTextureBytes: 32 * 1024 ** 2 },
    seed: 77,
    variants: 1,
    providerId: "hunyuan3d-2",
    generateTextures: false,
    generateCollision: false,
    generateLods: false,
    coordinateContract: { upAxis: "+Y", forwardAxis: "+Z", origin: "ground-center", stableRootName: "GrudgeAssetRoot" },
  });
}

function installedBertTokenCount(text: string, vocab: Set<string>): number {
  const basicTokens = text.toLowerCase().match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];
  let exactTokens = 2;
  for (const token of basicTokens) {
      if (!/^[\p{L}\p{N}]+$/u.test(token)) {
        exactTokens += 1;
        continue;
      }
      let start = 0;
      let pieces = 0;
      while (start < token.length) {
        let end = token.length;
        while (end > start && !vocab.has(`${start > 0 ? "##" : ""}${token.slice(start, end)}`)) end -= 1;
        if (end === start) {
          pieces = 1;
          break;
        }
        pieces += 1;
        start = end;
      }
      exactTokens += pieces;
  }
  return exactTokens;
}

function assertClipHeadroom(plan: ReturnType<typeof compilePrompt3DPrompt>): void {
  assert.ok(
    estimateHunyuanClipTokens(plan.generationPrompt) <= PROMPT3D_CLIP_SAFE_TOKEN_BUDGET,
    `conditioning exceeded the conservative Hunyuan CLIP budget: ${plan.generationPrompt}`,
  );
  assert.ok(
    estimateHunyuanClipTokens(plan.negativePrompt) <= PROMPT3D_NEGATIVE_CLIP_SAFE_TOKEN_BUDGET,
    `negative conditioning exceeded the conservative Hunyuan CLIP budget: ${plan.negativePrompt}`,
  );
  const vocabPath = process.env.PROMPT3D_HUNYUAN_BERT_VOCAB;
  if (vocabPath) {
    const vocab = new Set(readFileSync(vocabPath, "utf8").split(/\r?\n/));
    for (const [label, text] of [["generation prompt", plan.generationPrompt], ["negative prompt", plan.negativePrompt]] as const) {
      const exactTokens = installedBertTokenCount(text, vocab);
      assert.ok(exactTokens <= HUNYUAN_CLIP_TOKEN_LIMIT, `installed Hunyuan BERT tokenizer would truncate the ${label} at ${exactTokens} tokens: ${text}`);
    }
  }
}

function assertCountedPartClause(
  plan: ReturnType<typeof compilePrompt3DPrompt>,
  quantityPattern: string,
  headPattern: string,
  label: string,
): void {
  assert.match(
    plan.generationPrompt,
    new RegExp(`\\b(?:${quantityPattern})\\b[^.;]*\\b(?:${headPattern})\\b`, "i"),
    `${label} quantity and counted-part head noun must remain in one grammatical clause`,
  );
}

const flail = compilePrompt3DPrompt(spec(
  "One complete battle flail positioned diagonally from lower left to upper right with a wrapped handle; one connected articulated metal chain with clearly separated links; one heavy spiked ball attached to the chain; at least fifteen countable conical spikes protruding from the ball; every component fully visible and joined; no display stand or support base",
  "prop",
));
assert.match(flail.generationPrompt, /battle flail/i);
assert.match(flail.generationPrompt, /handle/i);
assert.match(flail.generationPrompt, /connected.*chain|chain.*connected/i);
assert.match(flail.generationPrompt, /spiked ball|ball.*spik/i);
assert.match(flail.generationPrompt, /fifteen|15/i);
assert.match(flail.generationPrompt, /attached|joined/i);
assert.match(flail.generationPrompt, /diagonal as requested/i);
assert.doesNotMatch(flail.generationPrompt, /\bupright\b|grip end down|support base at the bottom/i);
assert.doesNotMatch(flail.generationPrompt, /\b(?:no|without)\b[^.;]*(?:stand|pedestal|support base)/i);
for (const exclusion of ["display stand", "pedestal", "support base", "mounting base"]) assert.match(flail.negativePrompt, new RegExp(exclusion, "i"));
assert.doesNotMatch(flail.negativePrompt, /hanging cord|\brope\b|\bstring\b/i);
assertCountedPartClause(flail, "at least fifteen|fifteen", "spikes", "flail spike");
assertClipHeadroom(flail);

const promptOnlyAnimal = applyPrompt3DEdit(spec("", "prop"), "One complete animal character with recognizable anatomy and a balanced quadruped silhouette");
assert.equal(inferObjectType(promptOnlyAnimal), "creature", "a prompt-only animal brief must not require a manual category change");
assert.equal(compilePrompt3DPrompt(promptOnlyAnimal).objectType, "creature", "prompt-only animal wording must compile through the creature profile");

const floatingAsteroid = compilePrompt3DPrompt(spec(
  "A free-floating round meteorite asteroid shaped as one stone ball, with a nearly circular silhouette. Eighteen short thick rock spikes radiate evenly in every direction like a sea urchin, each spike fused into the same single ball. Dark charcoal rough meteorite stone. No pile, no mound, no ground, no base, no pedestal. Pure white outside, even neutral light, distant orthographic view.",
  "prop",
));
for (const exclusion of ["pile", "mound", "ground", "base", "pedestal"]) assert.match(floatingAsteroid.negativePrompt, new RegExp(`\\b${exclusion}\\b`, "i"));
assertClipHeadroom(floatingAsteroid);

const refinedFlail = compilePrompt3DPrompt(spec(
  "One medieval battle flail with a rigid leather grip, pivot eye, ten open interlocked chain links, one round striking ball, and sixteen sharp spikes. Shape refinement: Clarify the rigid grip, pivot eye, ten open chain links, round striking ball, and sixteen sharp spikes as distinct connected parts",
  "prop",
));
for (const requiredPart of [/rigid[^.;]*grip/i, /pivot[^.;]*eye/i, /ten[^.;]*chain[^.;]*links/i, /round[^.;]*ball/i, /sixteen[^.;]*spikes/i]) {
  assert.match(refinedFlail.generationPrompt, requiredPart, "a short required-part clause must survive generic refinement compaction");
}
assertClipHeadroom(refinedFlail);

const refinedRabbit = compilePrompt3DPrompt(spec(
  "One complete natural quadruped rabbit in a forward-ready crouch, viewed from a clear three-quarter angle. Compact furred torso, long upright ears, recognizable muzzle and eyes, short raised tail, two small forelegs and two powerful folded hind legs. All four paws are clearly separated and contacting the ground. Balanced realistic anatomy and a clean continuous game-ready silhouette. Shape refinement: strengthen the natural hopping posture, paw separation, hind-leg proportions and rabbit silhouette.",
  "character",
));
assert.match(refinedRabbit.generationPrompt, /quadruped rabbit/i, "a refined creature must retain its original species and body plan");
assert.match(refinedRabbit.generationPrompt, /(?:four[^.;]*paws|two[^.;]*forelegs[^.;]*two[^.;]*hind legs)/i, "a refined creature must retain counted limb anatomy from the base brief");
assert.match(refinedRabbit.generationPrompt, /Required refinement[^.;]*(?:hopping|hind-leg)/i, "a refined creature must retain its newest motion-ready shape correction");
assertClipHeadroom(refinedRabbit);

const excludedSpearPrompt = "One complete articulated striking tool with a wrapped handle, connected chain and weighted head. No blade, spear, polearm or rigid shaft";
const editedSpearSpec = applyPrompt3DEdit(spec("One complete spear with a straight shaft and one pointed head", "prop"), excludedSpearPrompt);
assert.equal(editedSpearSpec.objectRules, undefined, "editing the prompt must clear stale derived or manual object rules");
assert.equal(editedSpearSpec.coordinateContract.origin, "ground-center", "clearing object rules must also clear their attachment-point origin");
assert.equal(inferObjectType(editedSpearSpec), "prop", "auto inference must ignore object-type names that occur only inside an explicit exclusion");
assert.equal(compilePrompt3DPrompt(editedSpearSpec).objectType, "prop", "the edited prompt must compile from fresh inference rather than the prior type");
const staleSpearSpec: AssetSpecV1 = {
  ...editedSpearSpec,
  objectRules: { type: "spear", component: "whole" },
  coordinateContract: { ...editedSpearSpec.coordinateContract, origin: "attachment-point" },
};
assert.equal(objectRulesContradictPrompt(staleSpearSpec), true, "a restored contradictory draft must be identifiable before rendering its manual controls");
assert.throws(
  () => assertObjectRulesCompatibleWithPrompt(staleSpearSpec),
  /explicitly excludes.*spear/i,
  "backend validation must reject a stale manual type that the edited prompt explicitly excludes",
);
assert.throws(
  () => compilePrompt3DPrompt(staleSpearSpec),
  /explicitly excludes.*spear/i,
  "the compiler must never emit a selected type contradicted by the prompt",
);
const plannedPromptEdit = applyPrompt3DPlanProposal(spec("One complete spear with a straight shaft and one pointed head", "prop"), {
  generationPrompt: excludedSpearPrompt,
});
assert.equal(plannedPromptEdit.spec.objectRules, undefined, "programmatic planner prompt edits must clear stale object rules at their source");
assert.equal(plannedPromptEdit.spec.coordinateContract.origin, "ground-center", "programmatic prompt edits must clear the stale attachment origin");

const staleShieldBase = spec("One complete oval clockwork dial with exposed gears, explicitly not a shield", "prop");
const staleShieldSpec: AssetSpecV1 = {
  ...staleShieldBase,
  objectRules: { type: "shield", component: "whole" },
  coordinateContract: { ...staleShieldBase.coordinateContract, origin: "attachment-point" },
};
assert.throws(() => compilePrompt3DPrompt(staleShieldSpec), /explicitly excludes.*shield/i, "type exclusion must be generic rather than tied to one object");

const affirmativeSpear = spec("One complete spear with one pointed head and no extra spears or duplicate objects", "prop");
assert.equal(affirmativeSpear.objectRules?.type, "spear", "excluding extra duplicates must not negate an affirmative primary object type");

const horizontalProp = compilePrompt3DPrompt(spec(
  "One complete asymmetric hand tool shown horizontally from left to right with both ends visible, without any pedestal or mounting base",
  "prop",
));
assert.match(horizontalProp.generationPrompt, /horizontal as requested/i);
assert.doesNotMatch(horizontalProp.generationPrompt, /\bupright\b|support base at the bottom/i);
assert.doesNotMatch(horizontalProp.generationPrompt, /pedestal|mounting base/i);
assert.match(horizontalProp.negativePrompt, /pedestal/i);
assert.match(horizontalProp.negativePrompt, /mounting base/i);
assertClipHeadroom(horizontalProp);

const articulatedHorizontalProp = compilePrompt3DPrompt(spec(
  "One complete fantasy impact tool arranged horizontally. One thick wrapped handle connects through exactly one short chain of eight large open iron links to one separate round spiked metal weight. Entire silhouette fully visible.",
  "prop",
));
assert.equal(articulatedHorizontalProp.objectType, "prop", "a custom linked asset must stay on the generic prop route rather than require an example-specific profile");
assert.match(articulatedHorizontalProp.generationPrompt, /handle[^.;]*connects[^.;]*chain[^.;]*links[^.;]*weight/i, "prompt compaction must preserve an articulated intermediate connector as a structural relationship");
assert.match(articulatedHorizontalProp.review, /separate articulated chain links and both connected end components/i, "the exact inspection gate must call out the generic articulated relationship");
assert.match(articulatedHorizontalProp.generationPrompt, /horizontal as requested/i);
assertClipHeadroom(articulatedHorizontalProp);

const typedHeadWithArticulatedConnector = compilePrompt3DPrompt(spec(
  "One mace whose solid head hangs from a short chain of open links below one wrapped handle",
  "prop",
));
assert.equal(typedHeadWithArticulatedConnector.objectType, "hammer", "the existing typed striking-head route must remain unchanged");
assert.match(typedHeadWithArticulatedConnector.generationPrompt, /(?:Open chain links connect both ends|head[^.;]*chain[^.;]*links[^.;]*handle)/i, "an intermediate connector omitted by a typed profile must remain an explicit relationship");
assertClipHeadroom(typedHeadWithArticulatedConnector);

const typedHeadWithInterlockingMetalRings = compilePrompt3DPrompt(spec(
  "A single complete medieval impact weapon lying horizontally from left to right on a pure white background: one long thick wooden handgrip on the left, four large open interlocking metal rings in the middle, and one large round iron mace ball with many conical spikes on the right. All three sections are separate, connected and fully visible, centered with wide white margins. Game asset reference, neutral lighting.",
  "prop",
));
assert.equal(typedHeadWithInterlockingMetalRings.objectType, "hammer", "a solid striking head may still use the existing typed profile");
assert.match(typedHeadWithInterlockingMetalRings.generationPrompt, /(?:Open chain links connect both ends|open interlocking metal rings)/i, "interlocking metal ring wording must survive typed-profile prompt compaction");
assert.match(typedHeadWithInterlockingMetalRings.review, /separate articulated chain links and both connected end components/i, "interlocking metal rings must remain explicit at the visual gate");
assertClipHeadroom(typedHeadWithInterlockingMetalRings);

const exactRejectedTypedBrief = compilePrompt3DPrompt(spec(
  "A single complete medieval ball-and-chain flail weapon, isolated on plain white. One long brown wooden handle is joined to one short hanging chain made of four large open oval iron links, and that chain is joined to one large round black iron mace ball covered in long conical spikes. One weapon only, all connected, three-quarter view, broad blank margins, no person, no extra weapon, no spear, no blade, no stand.",
  "prop",
));
assert.equal(exactRejectedTypedBrief.objectType, "hammer", "the mace noun may select the broad typed striking-weapon guardrail");
assert.match(exactRejectedTypedBrief.generationPrompt, /ball-and-chain flail weapon/i, "a typed profile must retain the user's exact affirmative subject identity");
assert.match(exactRejectedTypedBrief.generationPrompt, /(?:brown )?wooden handle/i, "a typed profile must retain requested handle material and part identity");
assert.match(exactRejectedTypedBrief.generationPrompt, /four[^.;]*(?:open[^.;]*)?(?:iron )?links/i, "a typed profile must retain a quantified articulated connector");
assert.match(exactRejectedTypedBrief.generationPrompt, /ball[^.;]*conical[^.;]*spikes/i, "a typed profile must retain the prompted striking-ball identity and spikes");
assert.doesNotMatch(exactRejectedTypedBrief.generationPrompt, /one solid head|head attached to one handle/i, "an articulated whole-object brief must not inherit a contradictory rigid typed-profile shape");
assert.doesNotMatch(exactRejectedTypedBrief.generationPrompt, /\b(?:person|extra weapon|spear|blade|stand)\b/i, "explicit exclusions must remain out of positive conditioning");
for (const exclusion of ["person", "extra weapon", "spear", "blade", "stand"]) assert.match(exactRejectedTypedBrief.negativePrompt, new RegExp(`\\b${exclusion}\\b`, "i"));
assertClipHeadroom(exactRejectedTypedBrief);

const refinedTypedVariation = compilePrompt3DPrompt(spec(
  "One complete bronze warhammer with one rectangular head and one wrapped oak handle. Shape refinement: Keep the same warhammer but curve the rectangular head downward and add exactly three square studs to each broad face",
  "prop",
));
assert.equal(refinedTypedVariation.objectType, "hammer");
assert.match(refinedTypedVariation.generationPrompt, /bronze warhammer/i, "typed refinement must retain the original subject identity");
assert.match(refinedTypedVariation.generationPrompt, /Required refinement/i);
assert.match(refinedTypedVariation.generationPrompt, /curve[^.;]*head[^.;]*downward/i, "typed refinement must reach Hunyuan rather than stop at the UI lineage record");
assert.match(refinedTypedVariation.generationPrompt, /three[^.;]*square[^.;]*studs/i, "typed refinement must retain quantified correction detail");
assertClipHeadroom(refinedTypedVariation);

const subjectOnly = compilePrompt3DPrompt(spec(
  "One complete brass compass with a glass dial and one bright red needle",
  "prop",
));
const centralHalfBaseline = "One subject central half plain white background broad margins";
assert.ok(subjectOnly.generationPrompt.indexOf("brass compass") < subjectOnly.generationPrompt.indexOf(centralHalfBaseline), "the subject identity must lead the standardized presentation baseline in Hunyuan conditioning");
assert.match(subjectOnly.generationPrompt, /central half/i, "the baseline must define a central-half scale rather than rely on an ambiguous framing hint");
assert.match(subjectOnly.generationPrompt, /plain white background/i, "the default concept must use a plain seamless white presentation");
assert.match(subjectOnly.generationPrompt, /neutral light/i, "the default concept must use neutral lighting");
assert.match(subjectOnly.generationPrompt, /game-ready/i, "the default concept must use a game-ready presentation");
assert.doesNotMatch(subjectOnly.generationPrompt, /\b(?:stand|pedestal|plinth|scenery)\b/i, "presentation props must not be added to positive conditioning by default");
assert.match(subjectOnly.negativePrompt, /scenery.*display stand.*ground slab/i, "default subject-only exclusions must remain in negative conditioning");
assert.deepEqual(subjectOnly.presentationContract, {
  version: 1,
  subject: "one-complete-primary-subject",
  framing: "centered-with-broad-margin",
  background: { mode: "plain-white", clauses: [] },
  lighting: { mode: "neutral", clauses: [] },
  support: { mode: "none", clauses: [] },
  scenery: { mode: "none", clauses: [] },
}, "the effective inspection contract must record the default subject-only presentation without inventing exceptions");
assertClipHeadroom(subjectOnly);

const identityWithPresentation = compilePrompt3DPrompt(spec("One complete clockwork beetle on a plain white background", "prop"));
assert.match(identityWithPresentation.generationPrompt, /clockwork beetle/i, "presentation wording in the same clause must not erase a generic subject identity");
assertClipHeadroom(identityWithPresentation);

const relationalCreature = compilePrompt3DPrompt(spec(
  "One compact fantasy companion shown in three-quarter view. A small fox is integrated through a thick hollow seed-pod shell. Its head and two ears emerge from the wide front opening. A complete rounded torso fills the pod. Hindquarters and a short tail emerge from the rear. Four short separated legs extend below the shell. Plain white background.",
  "character",
));
assert.match(relationalCreature.generationPrompt, /fox[^.;]*(?:integrated|through)[^.;]*seed-pod[^.;]*shell/i, "generic creature compaction must preserve the prompted subject-container relationship");
assert.match(relationalCreature.generationPrompt, /head[^.;]*two[^.;]*ears[^.;]*emerge[^.;]*front[^.;]*opening/i, "generic creature compaction must preserve anatomy-to-opening relationships");
assert.match(relationalCreature.generationPrompt, /four[^.;]*legs/i, "generic creature compaction must retain late counted anatomy");
assert.match(relationalCreature.generationPrompt, /hindquarters[^.;]*tail[^.;]*emerge[^.;]*rear/i, "generic creature compaction must preserve rear anatomy relationships");
assert.doesNotMatch(relationalCreature.negativePrompt, /partial body|multiple characters|duplicate character/i, "creature negative conditioning must not suppress broad body or character concepts");
assertClipHeadroom(relationalCreature);

const asteroidClauseTrim = compilePrompt3DPrompt(spec(
  "Airborne round stone asteroid with one compact spherical core. Twenty-four short thick triangular spikes fuse directly into all sides. Rough cratered rock. Entire silhouette centered in a three-quarter game-asset view.",
  "prop",
));
assert.doesNotMatch(asteroidClauseTrim.generationPrompt, /\b(?:a|an|the|and|or|with|of|its|that|which|having|has|have|in|on|for|from)\.$/i, "CLIP-budget pruning must not leave a dangling function word at the end of the Hunyuan prompt");
assert.doesNotMatch(asteroidClauseTrim.generationPrompt, /centered in a\./i, "CLIP-budget pruning must drop a complete trailing clause rather than emit malformed framing prose");
assert.match(asteroidClauseTrim.generationPrompt, /Weightless in empty space full silhouette/i, "the compiler-owned framing segment must retain complete airborne presentation after optional prose is trimmed");
assertClipHeadroom(asteroidClauseTrim);

const routedNegations = compilePrompt3DPrompt(spec(
  "One complete brass compass with a glass dial, without a wooden stand but with one bright red needle. Do not include forest scenery or a black backdrop. No loose coins",
  "prop",
));
assert.match(routedNegations.generationPrompt, /brass compass/i);
assert.match(routedNegations.generationPrompt, /bright red needle/i, "affirmative content after a negative clause must survive");
assert.doesNotMatch(routedNegations.generationPrompt, /wooden stand|forest scenery|black backdrop|loose coins/i, "forbidden nouns must not be emphasized in positive conditioning");
assert.match(routedNegations.negativePrompt, /wooden stand/i);
assert.match(routedNegations.negativePrompt, /forest scenery/i);
assert.match(routedNegations.negativePrompt, /black backdrop/i);
assert.match(routedNegations.negativePrompt, /loose coins/i);
const relationalNegation = compilePrompt3DPrompt(spec("One complete fantasy creature. No separate fruit or detached accessory", "character"));
assert.match(relationalNegation.negativePrompt, /separate fruit/i, "relationship-critical negative adjectives must remain in negative conditioning");
assert.doesNotMatch(relationalNegation.generationPrompt, /separate fruit|detached accessory/i, "relationship exclusions must never leak into positive conditioning");
assertClipHeadroom(routedNegations);

const requestedPedestal = compilePrompt3DPrompt(spec("One brass compass on a carved red pedestal", "prop"));
assert.match(requestedPedestal.generationPrompt, /carved red pedestal/i, "an affirmatively requested stand must be preserved");
assert.doesNotMatch(requestedPedestal.negativePrompt, /\b(?:pedestal|display stand|ground slab)\b/i, "an affirmatively requested stand must not be contradicted by default negatives");
assert.equal(requestedPedestal.presentationContract.support.mode, "requested", "an affirmative stand request must become an explicit inspection exception");
assert.match(requestedPedestal.presentationContract.support.clauses.join(" "), /carved red pedestal/i);
assertClipHeadroom(requestedPedestal);

const requestedScenery = compilePrompt3DPrompt(spec("One brass compass with forest scenery in the background", "prop"));
assert.match(requestedScenery.generationPrompt, /forest scenery/i, "affirmatively requested scenery must be preserved");
assert.doesNotMatch(requestedScenery.generationPrompt, /plain white background/i, "a deliberate scenery request must replace the default white backdrop rather than conflict with it");
assert.doesNotMatch(requestedScenery.negativePrompt, /\bscenery\b/i, "affirmatively requested scenery must not remain in negative conditioning");
assert.equal(requestedScenery.presentationContract.scenery.mode, "requested", "affirmative scenery must be explicit in concept inspection evidence");
assert.equal(requestedScenery.presentationContract.background.mode, "requested", "affirmative scenery replaces the default white-background contract");
assert.match(requestedScenery.presentationContract.scenery.clauses.join(" "), /forest scenery/i);
assertClipHeadroom(requestedScenery);

const requestedBackdrop = compilePrompt3DPrompt(spec("One brass compass against a solid blue background", "prop"));
assert.match(requestedBackdrop.generationPrompt, /solid blue background/i, "an affirmative custom backdrop must be preserved");
assert.match(requestedBackdrop.negativePrompt, /\bscenery\b/i, "requesting a backdrop must not implicitly authorize unrequested scenery");
assert.equal(requestedBackdrop.presentationContract.background.mode, "requested", "a custom backdrop must replace only the effective background contract");
assert.equal(requestedBackdrop.presentationContract.scenery.mode, "none", "a custom backdrop must not silently authorize scenery");
assert.match(requestedBackdrop.presentationContract.background.clauses.join(" "), /solid blue background/i);
assertClipHeadroom(requestedBackdrop);

const genericRoadFixture = compilePrompt3DPrompt(spec("One complete street lamp with one enclosed lantern", "road-furniture"));
assert.doesNotMatch(genericRoadFixture.generationPrompt, /\b(?:support|display stand|pedestal|plinth|ground slab)\b/i, "generic category rules must not invent presentation supports");
assertClipHeadroom(genericRoadFixture);

const wholeSword = spec("One complete straight sword with a tapered blade", "prop");
const bladeOnly = compilePrompt3DPrompt({ ...wholeSword, objectRules: { type: "sword", component: "blade" } });
assert.doesNotMatch(bladeOnly.generationPrompt, /\bno\s+(?:grip|guard|pommel)/i, "built-in component exclusions must not leak into positive conditioning");
for (const exclusion of ["grip", "guard", "pommel"]) assert.match(bladeOnly.negativePrompt, new RegExp(`\\b${exclusion}\\b`, "i"));
assertClipHeadroom(bladeOnly);

const rabbit = compilePrompt3DPrompt(spec(
  "One complete adult rabbit in a motion-ready side profile facing right; compact furry body and short round tail; two long upright ears and two clear eyes; four separated legs with visible paws; closed mouth and no missing anatomy",
  "character",
));
assert.match(rabbit.generationPrompt, /adult rabbit/i);
assert.match(rabbit.generationPrompt, /two.*ears|ears.*two/i);
assert.match(rabbit.generationPrompt, /four.*legs|legs.*four/i);
assert.match(rabbit.generationPrompt, /tail/i);
assert.match(rabbit.generationPrompt, /small centered full-body subject/i, "a natural creature prompt must positively request a complete, small subject");
assert.match(rabbit.generationPrompt, /plain white background[^.;]*broad margins/i, "a natural creature prompt must keep explicit clearance around ears, feet and tails");
assert.doesNotMatch(rabbit.generationPrompt, /all requested limbs, fins, wings and tail/i);
assertCountedPartClause(rabbit, "four", "legs", "creature leg");
assertCountedPartClause(rabbit, "two", "ears", "creature ear");
assertClipHeadroom(rabbit);

const bird = compilePrompt3DPrompt(spec(
  "One complete bird in a flight-ready side profile facing right; two broad separated wings with layered flight feathers; distinct head and closed beak; spread tail fan and two legs tucked against the body; entire silhouette visible",
  "character",
));
assert.match(bird.generationPrompt, /bird/i);
assert.match(bird.generationPrompt, /two.*wings|wings.*two/i);
assert.match(bird.generationPrompt, /tail/i);
assert.match(bird.generationPrompt, /beak/i);
assertCountedPartClause(bird, "two", "wings", "creature wing");
assertClipHeadroom(bird);

const fish = compilePrompt3DPrompt(spec(
  "One complete streamlined fish in side profile facing right with one continuous body; exactly six broad separated fins attached to the body; two clear eyes and one closed mouth; complete tail fully visible",
  "character",
));
assertCountedPartClause(fish, "exactly six|six", "fins", "creature fin");
assert.match(fish.generationPrompt, /six[^.;]*broad[^.;]*separated[^.;]*fins[^.;]*attached/i);
assertClipHeadroom(fish);

const liveAsteroid = compilePrompt3DPrompt(spec(
  "One compact spherical rocky asteroid floating weightlessly, completely visible and small in the center of a white frame with broad empty margin on every side. Exactly one central mass with twenty-four thick long separate conical spikes evenly attached across every hemisphere, each spike with a wide base and sharp tip. No second mass, neck, stand, pedestal, ground slab, cord, fragments or scenery.",
  "prop",
));
assertCountedPartClause(liveAsteroid, "twenty-four", "spikes", "asteroid spike");
assert.match(liveAsteroid.generationPrompt, /twenty-four[^.;]*conical[^.;]*spikes/i, "the counted spike shape must remain coupled to its head noun");
assert.match(liveAsteroid.generationPrompt, /twenty-four[^.;]*spikes[^.;]*attached/i, "the counted spike attachment cue must remain when the safe budget permits it");
assert.doesNotMatch(liveAsteroid.generationPrompt, /\bexactly one twenty-four\b/i, "independent quantified groups must never collapse into one malformed phrase");
assert.doesNotMatch(
  liveAsteroid.generationPrompt,
  /\btwenty-four(?:\s+(?:thick|long|separate|separated|countable|conical|evenly|attached)){0,8}[.;]/i,
  "a quantity plus modifiers must never survive without its counted-part head noun",
);
assertClipHeadroom(liveAsteroid);

const shootingStarTrail = compilePrompt3DPrompt(spec(
  "One compact sphere-shaped shooting-star asteroid with a rough stone core. Exactly twenty-four thick conical spikes cover all hemispheres; each has a wide fused base and sharp tip. A long solid tapered rocky trail points rearward. Small centered three-quarter view.",
  "prop",
));
assert.match(shootingStarTrail.generationPrompt, /\btrail\b/i, "a requested motion-effect structure must retain its head noun inside the CLIP window");
assertClipHeadroom(shootingStarTrail);

const directionalAttachmentRetention = compilePrompt3DPrompt(spec(
  "Wide horizontal spiked asteroid. Dark round cratered rock sphere on right. Eighteen short thick stone spikes radiate around sphere. Five extra-long tapered stone fins grow from left hemisphere and extend far left as one attached tail. Side profile.",
  "prop",
));
assert.match(directionalAttachmentRetention.generationPrompt, /five[^.;]*tapered[^.;]*stone[^.;]*fins/i, "a late counted structure must retain its defining shape and material modifiers");
assert.match(directionalAttachmentRetention.generationPrompt, /fins[^.;]*(?:grow|extend)[^.;]*left[^.;]*hemisphere/i, "a counted structure must retain the body region it grows from");
assert.match(directionalAttachmentRetention.generationPrompt, /fins[^.;]*extend[^.;]*far[^.;]*left/i, "a counted structure must retain its requested extent and direction");
assert.match(directionalAttachmentRetention.generationPrompt, /attached[^.;]*tail/i, "a counted structure must retain its requested attachment relationship");
assertClipHeadroom(directionalAttachmentRetention);

const regionNounRetention = compilePrompt3DPrompt(spec(
  "A cartoon shooting-star meteor. Large round cratered rock sphere leading right. Twenty-four thick sharp stone spikes radiate from the sphere. Broad orange flame mass attached behind the sphere. Five long flame tongues streaming left. Horizontal side view.",
  "prop",
));
assert.match(regionNounRetention.generationPrompt, /round cratered rock sphere/i, "generic CLIP compaction must keep the dominant body noun");
assert.match(regionNounRetention.generationPrompt, /orange flame mass attached/i, "generic CLIP compaction must keep the attachment region noun");
assert.match(regionNounRetention.generationPrompt, /five long flame tongues/i, "generic CLIP compaction must keep the late effect-part noun");
assert.doesNotMatch(regionNounRetention.generationPrompt, /round cratered (?:charcoal )?leads|attached five long/i, "generic CLIP compaction must not collapse visual regions into nounless fragments");
assertClipHeadroom(regionNounRetention);

const refined = compilePrompt3DPrompt(spec(
  "One irregular spiky stone asteroid with a dense central mass and fully visible silhouette. Shape refinement: preserve the central mass while making at least twenty separate countable points protrude with wide attached bases",
  "prop",
));
assert.match(refined.generationPrompt, /spiky stone asteroid/i);
assert.match(refined.generationPrompt, /Required refinement/i);
assert.match(refined.generationPrompt, /twenty|20/i);
assert.match(refined.generationPrompt, /protrude/i);
assertClipHeadroom(refined);

const retainedAsteroidChain = compilePrompt3DPrompt(spec(
  "One spherical rocky asteroid with exactly twenty thick long separate conical spikes radiating evenly in all directions from one central mass; every spike has a countable wide base and sharp tip; floating weightlessly; no stand, cord or fragments.\n\nShape refinement: Make the central mass compact and near-spherical, retain at least twenty separate countable spikes but make the spikes thicker, longer and evenly distributed over every side of the full asteroid surface; each spike needs a wide base and sharp tip; remove any bald hemisphere, pedestal, string or detached fragment.\n\nShape refinement: Delete the whole smooth lower sphere and neck. Exactly one isolated compact sphere-shaped rocky asteroid remains. Its single central mass carries twenty-four thick long countable conical spikes evenly spaced across every hemisphere, each with a wide attached base and sharp tip. No second mass, pedestal, ground, cord, duplicate or fragment.",
  "prop",
));
assert.match(retainedAsteroidChain.generationPrompt, /spherical rocky asteroid/i, "the retained base identity must remain inside the CLIP window");
assert.doesNotMatch(retainedAsteroidChain.generationPrompt, /smooth lower sphere|\bneck\b/i, "removed geometry must not be reinforced in positive conditioning");
assert.match(retainedAsteroidChain.negativePrompt, /whole smooth lower sphere and neck/i, "the newest corrective exclusion must move to dedicated negative conditioning");
assert.match(retainedAsteroidChain.generationPrompt, /twenty-four/i, "the newest required count must remain inside the CLIP window");
assert.match(retainedAsteroidChain.generationPrompt, /wide attached base/i, "the newest spike attachment cue must remain inside the CLIP window");
assert.doesNotMatch(retainedAsteroidChain.generationPrompt, /\b(?:no|without)\b[^.;]*(?:stand|pedestal|ground|cord)/i, "support exclusions must not consume positive CLIP conditioning");
assertClipHeadroom(retainedAsteroidChain);

const providerWorker = readFileSync(join(__dirname, "..", "tools", "prompt3d", "provider_worker.py"), "utf8");
const textureRevisionStart = providerWorker.indexOf("def hunyuan_texture_revision(");
const textureRevisionEnd = providerWorker.indexOf("\ndef ", textureRevisionStart + 1);
assert.ok(textureRevisionStart >= 0 && textureRevisionEnd > textureRevisionStart, "the retained provider worker must expose the texture-reference route");
const textureRevision = providerWorker.slice(textureRevisionStart, textureRevisionEnd);
const textureBudgetGate = textureRevision.indexOf("verify_hunyuan_text_budget(concept_model, prompt, negative)");
const texturePipelineImport = textureRevision.indexOf("from diffusers import HunyuanDiTPipeline");
const texturePipelineLoad = textureRevision.indexOf("HunyuanDiTPipeline.from_pretrained");
assert.ok(textureBudgetGate >= 0, "texture-reference generation must run the exact installed-tokenizer budget gate");
assert.ok(
  textureBudgetGate < texturePipelineImport && textureBudgetGate < texturePipelineLoad,
  "texture-reference prompt and negative text must fail closed before importing or loading HunyuanDiT",
);
assert.match(providerWorker, /from transformers import BertTokenizer, T5Tokenizer/);
assert.match(providerWorker, /if bert_tokens > 77:[\s\S]*if t5_tokens > 256:/);
assert.match(providerWorker, /"canvas": canvas/, "concept prompt provenance must retain the actual selected canvas");
assert.match(providerWorker, /height=canvas\["height"\][\s\S]*width=canvas\["width"\]/, "HunyuanDiT must receive the provenance-bound canvas dimensions");

console.log("Prompt-to-3D structural prompt-retention tests passed.");
