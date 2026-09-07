import type { AssetSpecV1 } from "./prompt3d";
import { hasAffirmativePromptMatch } from "./promptedMotionIntent";

export type Prompt3DAnimationSubject = "humanoid" | "non-humanoid" | "rigid-object" | "ambiguous";

const HUMANOID = /\b(?:human|humanoid|person|people|man|woman|boy|girl|warrior|soldier|knight|mage|wizard|rogue|pirate|dwarf|elf|orc|goblin|biped|two[- ]legged|android)\b/i;
// Animal bipeds still need creature deformation, not the human Mixamo rig.
// Keep the same evidence in the UI and CPU binder; category alone is not anatomy.
// Props can be held or worn by a character and do not establish its anatomy.
const NON_HUMANOID = /\b(?:non[- ]?humanoid|animal|mammal|marsupial|quadruped|four[- ]legged|kangaroo|wallaby|koala|wombat|platypus|rabbit|hare|dog|wolf|fox|cat|lion|tiger|bear|panda|horse|pony|donkey|zebra|deer|moose|elk|cow|bull|ox|sheep|goat|pig|boar|elephant|rhino(?:ceros)?|hippo(?:potamus)?|giraffe|camel|llama|alpaca|otter|beaver|squirrel|mouse|rat|bat|seal|penguin|ostrich|emu|fish|shark|whale|dolphin|bird|eagle|owl|parrot|duck|chicken|snake|serpent|lizard|crocodile|alligator|turtle|tortoise|frog|toad|dinosaur|dragon|spider|insect|crab|octopus|centaur|mermaid|worm|slug)\b/i;

export function classifyPrompt3DAnimationSubject(spec: Pick<AssetSpecV1, "category" | "prompt" | "objectRules">): {
  classification: Prompt3DAnimationSubject;
  rationale: string;
} {
  const combined = `${spec.prompt}\n${spec.objectRules?.shapeNotes ?? ""}`;
  const human = hasAffirmativePromptMatch(combined, HUMANOID);
  const animal = hasAffirmativePromptMatch(combined, NON_HUMANOID);
  if (spec.category !== "character") return { classification: "rigid-object", rationale: `The retained category is ${spec.category}; no anatomical skeleton is inferred.` };
  if (human && animal) return { classification: "ambiguous", rationale: "The retained character brief affirmatively describes both humanoid and non-humanoid anatomy; automatic bone placement stops for review." };
  if (animal) return { classification: "non-humanoid", rationale: "The retained character brief identifies an animal or non-humanoid body plan. Use local creature deformation; HY-Motion supports human skeletons only." };
  if (human) return { classification: "humanoid", rationale: "The retained character brief affirmatively identifies a human-compatible biped; mesh checks must still prove that deterministic placement is safe." };
  return { classification: "ambiguous", rationale: "The retained character metadata does not prove a human-compatible two-arm/two-leg body plan." };
}

/** Known incompatible subjects should be explained before provider installation or inference. */
export function prompt3DHyMotionSubjectError(spec: Pick<AssetSpecV1, "category" | "prompt" | "objectRules">): string | null {
  const subject = classifyPrompt3DAnimationSubject(spec);
  // A keyword anywhere in a detailed brief is only a CPU fitting hint: it may
  // describe an accessory (a baseball bat or fox scarf), not the subject. Let
  // HY-Motion's existing semantic planner resolve those briefs. A standalone
  // animal name and the retained non-character category are unambiguous here.
  const namedAnimal = new RegExp(`^(?:(?:a|an|one|the)\\s+)?(?:${NON_HUMANOID.source})[.!]?$`, "i").test(spec.prompt.trim());
  return (subject.classification === "non-humanoid" && namedAnimal) || subject.classification === "rigid-object"
    ? "HY-Motion supports human/humanoid skeletons only. Choose Automatic guided CPU route for this model."
    : null;
}
