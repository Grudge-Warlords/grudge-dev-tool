import { createHash } from "node:crypto";
import type { AssetSpecV1 } from "../../shared/prompt3d";
import { sanitizeAssetSpec, stableJson } from "../../shared/conceptWorkflow";
import {
  PROMPT3D_STRICT_BATCH_ITEM_COUNT,
  type Prompt3DBatchAcceptanceEvidence,
  type Prompt3DBatchAcceptanceFinishEvidence,
  type Prompt3DBatchAcceptanceGenerationEvidence,
  type Prompt3DBatchAcceptanceReceipt,
  type Prompt3DWorkflowLibraryAsset,
} from "../../shared/prompt3dWorkflow";

const MAX_SEED = 0x7fffffff;
const SHA256 = /^[a-f0-9]{64}$/i;

function requireSha256(label: string, value: string): void {
  if (!SHA256.test(value)) throw new Error(`${label} must be a SHA-256 value.`);
}

function requireUnique<T extends string | number>(label: string, values: T[], expected = values.length): void {
  if (values.length !== expected || new Set(values).size !== expected) {
    throw new Error(`Strict final-run acceptance requires ${expected} distinct ${label}.`);
  }
}

export interface Prompt3DBatchWorkflowIntentInput {
  spec: AssetSpecV1;
  shapeRefinement: string;
  texturePrompts: string[];
  animationPlans: Array<Record<string, unknown>>;
}

export function prompt3DBatchWorkflowIntentSha256(input: Prompt3DBatchWorkflowIntentInput): string {
  const spec = sanitizeAssetSpec(input.spec);
  const animationPlans = input.animationPlans.map((plan) => {
    if (plan.provider === "hy-motion-1.0-lite") {
      return {
        version: plan.version,
        provider: plan.provider,
        instruction: typeof plan.instruction === "string" ? plan.instruction.trim().replace(/\s+/g, " ") : plan.instruction,
        duration: plan.duration,
        cfgScale: plan.cfgScale,
        mode: plan.mode,
        rig: plan.rig,
      };
    }
    const {
      seed: _seed,
      timingExponent: _timingExponent,
      clipId: _clipId,
      clipName: _clipName,
      instructionSha256: _instructionSha256,
      ...intent
    } = plan;
    return {
      ...intent,
      ...(typeof intent.instruction === "string" ? { instruction: intent.instruction.trim().replace(/\s+/g, " ") } : {}),
    };
  });
  const canonical = {
    spec: {
      ...spec,
      prompt: spec.prompt.trim().replace(/\s+/g, " "),
      seed: 0,
      variants: 1,
      generateTextures: false,
    },
    shapeRefinement: input.shapeRefinement.trim().replace(/\s+/g, " "),
    texturePrompts: input.texturePrompts.map((prompt) => prompt.trim().replace(/\s+/g, " ")),
    animationPlans,
  };
  return createHash("sha256").update(stableJson(canonical)).digest("hex");
}

export function reserveFreshPrompt3DBatchSeed(
  requestedSeed: number,
  unavailableSeeds: Set<number>,
  derivedOffsets: readonly number[],
): number {
  if (!Number.isSafeInteger(requestedSeed) || requestedSeed < 0 || requestedSeed > MAX_SEED) {
    throw new Error("Strict final-run requested seeds must be integers from 0 to 2,147,483,647.");
  }
  const offsets = [...new Set([0, ...derivedOffsets])];
  if (offsets.some((offset) => !Number.isSafeInteger(offset) || offset < 0 || offset > MAX_SEED)) {
    throw new Error("Strict final-run derived seed offsets are invalid.");
  }
  const maximumOffset = Math.max(...offsets);
  const candidateCount = MAX_SEED - maximumOffset + 1;
  // One unavailable derived seed can eliminate at most one candidate per offset.
  // Scanning this many candidates therefore proves that either a free range was
  // found or the bounded seed space is exhausted without iterating 2^31 values.
  const scanCount = Math.min(candidateCount, unavailableSeeds.size * offsets.length + 1);
  for (let step = 0; step < scanCount; step += 1) {
    const candidate = (requestedSeed + step) % candidateCount;
    const derived = offsets.map((offset) => candidate + offset);
    if (derived.every((seed) => !unavailableSeeds.has(seed))) {
      derived.forEach((seed) => unavailableSeeds.add(seed));
      return candidate;
    }
  }
  throw new Error("No unused seed range remains for this strict final-run item.");
}

export function assertFreshPrompt3DBatchGeneration(
  acceptance: Prompt3DBatchAcceptanceEvidence,
  itemId: string,
  phase: "base" | "refined",
  candidate: Prompt3DBatchAcceptanceGenerationEvidence,
): void {
  const item = acceptance.items.find((entry) => entry.itemId === itemId);
  if (!item) throw new Error("Strict final-run generation does not match a retained batch item.");
  if (!Number.isSafeInteger(candidate.seed) || candidate.seed < 0 || candidate.seed > MAX_SEED) {
    throw new Error(`Strict final-run ${phase} generation seed is invalid.`);
  }
  if (!item.reservedSeeds.includes(candidate.seed)) {
    throw new Error(`Strict final-run ${phase} generation did not use a service-reserved unused seed.`);
  }
  requireSha256("Concept identity", candidate.conceptSha256);
  requireSha256("Generation output identity", candidate.outputSha256);
  requireSha256("Generation geometry identity", candidate.geometryHash);

  const otherGenerations = acceptance.items.flatMap((entry) => [entry.base, entry.refined])
    .filter((entry): entry is Prompt3DBatchAcceptanceGenerationEvidence => Boolean(entry) && entry!.jobId !== candidate.jobId);
  const baselineGenerations = acceptance.items.flatMap((entry) => entry.baseline.generationChain);
  const usedSeeds = baselineGenerations.map((entry) => entry.seed).concat(otherGenerations.map((entry) => entry.seed));
  const conceptHashes = baselineGenerations.map((entry) => entry.conceptSha256).concat(otherGenerations.map((entry) => entry.conceptSha256));
  const outputHashes = baselineGenerations.map((entry) => entry.outputSha256).concat(otherGenerations.map((entry) => entry.outputSha256));
  const geometryHashes = baselineGenerations.map((entry) => entry.geometryHash).concat(otherGenerations.map((entry) => entry.geometryHash));
  if (usedSeeds.includes(candidate.seed)) throw new Error(`Strict final-run ${phase} generation reuses an individual or earlier batch seed.`);
  if (conceptHashes.includes(candidate.conceptSha256)) throw new Error(`Strict final-run ${phase} concept bytes reuse an individual or earlier batch result.`);
  if (outputHashes.includes(candidate.outputSha256)) throw new Error(`Strict final-run ${phase} generated bytes reuse an individual or earlier batch result.`);
  if (geometryHashes.includes(candidate.geometryHash)) throw new Error(`Strict final-run ${phase} geometry reuses an individual or earlier batch result.`);
}

export function assertFreshPrompt3DBatchFinal(
  acceptance: Prompt3DBatchAcceptanceEvidence,
  itemId: string,
  finalSha256: string,
): void {
  requireSha256("Final workflow identity", finalSha256);
  const baselineHashes = acceptance.items.map((entry) => entry.baseline.finalSha256);
  const batchHashes = acceptance.items
    .filter((entry) => entry.itemId !== itemId && entry.managed)
    .map((entry) => entry.managed!.sha256);
  if (baselineHashes.includes(finalSha256) || batchHashes.includes(finalSha256)) {
    throw new Error("Strict final-run output reuses individual or earlier batch final bytes.");
  }
}

export function createPrompt3DBatchAcceptanceReceipt(
  batchId: string,
  acceptance: Prompt3DBatchAcceptanceEvidence,
  sealedAt: string,
): Prompt3DBatchAcceptanceReceipt {
  if (acceptance.profile !== "strict-final-run-v1"
    || acceptance.expectedItemCount !== PROMPT3D_STRICT_BATCH_ITEM_COUNT
    || !acceptance.eligible
    || acceptance.restoreCount !== 0
    || acceptance.retryCount !== 0
    || acceptance.exportAttemptCount !== 1
    || acceptance.items.length !== PROMPT3D_STRICT_BATCH_ITEM_COUNT
    || !Number.isFinite(Date.parse(sealedAt))) {
    throw new Error("Strict final-run continuity or item-count evidence is ineligible for sealing.");
  }
  requireUnique("batch item IDs", acceptance.items.map((item) => item.itemId), PROMPT3D_STRICT_BATCH_ITEM_COUNT);
  requireUnique("individual managed baselines", acceptance.items.map((item) => item.baseline.managedAssetId), PROMPT3D_STRICT_BATCH_ITEM_COUNT);
  requireUnique("individual baseline source jobs", acceptance.items.map((item) => item.baseline.sourceJobId), PROMPT3D_STRICT_BATCH_ITEM_COUNT);
  requireUnique("service-assigned seeds", acceptance.items.map((item) => item.assignedSeed), PROMPT3D_STRICT_BATCH_ITEM_COUNT);
  if (acceptance.items.some((item) => !SHA256.test(item.baselineIntentSha256)
    || !SHA256.test(item.requestIntentSha256)
    || item.baselineIntentSha256 !== item.requestIntentSha256)) {
    throw new Error("Strict final-run queued workflow intent does not match its selected individual baseline.");
  }
  const reservedSeeds = acceptance.items.flatMap((item) => item.reservedSeeds);
  if (acceptance.items.some((item) => item.reservedSeeds[0] !== item.assignedSeed
    || item.reservedSeeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0 || seed > MAX_SEED))) {
    throw new Error("Strict final-run seed reservations are malformed.");
  }
  requireUnique("service-reserved seeds", reservedSeeds);
  const baselineSeeds = new Set(acceptance.items.flatMap((item) => item.baseline.generationChain.map((entry) => entry.seed)));
  if (acceptance.items.some((item) => baselineSeeds.has(item.assignedSeed))) {
    throw new Error("Strict final-run service-assigned seeds must differ from their individual baselines.");
  }

  const completeItems = acceptance.items.map((item) => {
    if (!item.base || !item.refined || !item.managed || !item.portable) {
      throw new Error("Strict final-run receipt requires base, refinement, managed and portable evidence for every item.");
    }
    assertFreshPrompt3DBatchGeneration(acceptance, item.itemId, "base", item.base);
    assertFreshPrompt3DBatchGeneration(acceptance, item.itemId, "refined", item.refined);
    assertFreshPrompt3DBatchFinal(acceptance, item.itemId, item.managed.sha256);
    const textures = item.finishing.filter((entry) => entry.operation === "texture");
    const animations = item.finishing.filter((entry) => entry.operation === "animation");
    const validFinish = (entry: Prompt3DBatchAcceptanceFinishEvidence) => Number.isSafeInteger(entry.revisionIndex)
      && entry.revisionIndex >= 0 && item.reservedSeeds.includes(entry.seed)
      && SHA256.test(entry.promptSha256) && SHA256.test(entry.outputSha256);
    if (textures.length < 2 || animations.length < 2
      || item.finishing.length !== textures.length + animations.length
      || stableJson(item.finishing) !== stableJson([...textures, ...animations])
      || textures.some((entry, index) => entry.revisionIndex !== index || !validFinish(entry))
      || animations.some((entry, index) => entry.revisionIndex !== index || !validFinish(entry))
      || item.finishing.at(-1)?.outputSha256 !== item.managed.sha256) {
      throw new Error("Strict final-run finishing evidence is incomplete, unordered or outside its service-reserved seed ledger.");
    }
    if (item.portable.sha256 !== item.managed.sha256 || item.portable.byteSize !== item.managed.byteSize
      || !SHA256.test(item.portable.recordSha256)
      || item.portable.reopenVerification.kind !== "portable"
      || item.portable.reopenVerification.id !== item.portable.recordId
      || item.portable.reopenVerification.path !== item.portable.destinationPath
      || item.portable.reopenVerification.sha256 !== item.portable.sha256
      || item.portable.reopenVerification.byteSize !== item.portable.byteSize
      || !item.portable.reopenVerification.retainedGeometry
      || !item.portable.reopenVerification.retainedTextures
      || !item.portable.reopenVerification.retainedAnimations) {
      throw new Error("Strict final-run portable output does not match its managed asset bytes.");
    }
    return {
      itemId: item.itemId,
      requestedSeed: item.requestedSeed,
      assignedSeed: item.assignedSeed,
      reservedSeeds: item.reservedSeeds,
      baselineIntentSha256: item.baselineIntentSha256,
      requestIntentSha256: item.requestIntentSha256,
      baseline: item.baseline,
      base: item.base,
      refined: item.refined,
      finishing: item.finishing,
      managed: item.managed,
      portable: item.portable,
    };
  });

  const managed = completeItems.map((item) => item.managed);
  requireUnique("batch-bound managed source jobs", managed.map((item) => item.sourceJobId), PROMPT3D_STRICT_BATCH_ITEM_COUNT);
  requireUnique("managed root generation jobs", managed.map((item) => item.rootGenerationJobId), PROMPT3D_STRICT_BATCH_ITEM_COUNT);
  requireUnique("managed paths", managed.map((item) => item.savedPath), PROMPT3D_STRICT_BATCH_ITEM_COUNT);
  requireUnique("managed output hashes", managed.map((item) => item.sha256), PROMPT3D_STRICT_BATCH_ITEM_COUNT);
  requireUnique("portable paths", completeItems.map((item) => item.portable.destinationPath), PROMPT3D_STRICT_BATCH_ITEM_COUNT);
  requireUnique("portable record IDs", completeItems.map((item) => item.portable.recordId), PROMPT3D_STRICT_BATCH_ITEM_COUNT);
  requireUnique("finishing job IDs", completeItems.flatMap((item) => item.finishing.map((entry) => entry.jobId)));

  return {
    version: 1,
    batchId,
    profile: acceptance.profile,
    expectedItemCount: PROMPT3D_STRICT_BATCH_ITEM_COUNT,
    eligible: true,
    serviceRunId: acceptance.serviceRunId,
    restoreCount: 0,
    retryCount: 0,
    exportAttemptCount: 1,
    managedCount: PROMPT3D_STRICT_BATCH_ITEM_COUNT,
    portableCount: PROMPT3D_STRICT_BATCH_ITEM_COUNT,
    items: completeItems,
    sealedAt,
  };
}

export function managedAssetEvidence(value: Prompt3DWorkflowLibraryAsset): Prompt3DWorkflowLibraryAsset {
  return structuredClone(value);
}
