import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import {
  NodeIO,
  type Animation,
  type AnimationSampler,
  type Document,
  type Mesh,
  type Node as GltfNode,
  type Primitive,
  type vec3,
  type vec4,
} from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import type { AssetSpecV1 } from "../../shared/prompt3d";
import { analyzePromptedMotionIntent, promptedMotionCapabilityError, PROMPTED_MOTION_MAX_CHARS, type PromptedMotionIntent } from "../../shared/promptedMotionIntent";

const MOTION_BUILD = "grudge-prompt-motion-2";
const MAX_SOURCE_BYTES = 1024 * 1024 * 1024;
const MAX_ROOT_TARGETS = 16;
const MAX_DEFORMATION_TARGET_NODES = 64;
const MAX_TOTAL_MORPH_TARGETS = 16;

export type RootPathOperator = "linear" | "out-and-back" | "hop-arc" | "vertical-hop" | "figure-eight" | "orbit" | "stationary";
export type RotationOperator = "swing" | "spin";
export type RotationScope = "whole" | "distal";
export type DeformationOperator = "axial-wave" | "rear-wave" | "bilateral-flap" | "squash-stretch" | "grounded-stride" | "synchronous-bound" | "rear-counterbalance" | "body-crouch" | "segmented-swing" | "segmented-spin" | "trail-pulse";
export type SkeletalAction = "wave" | "attack" | "dance";
export type MotionAxis = "x" | "y" | "z";
export type AnimationWriteMode = "append" | "replace";

export interface PromptedAnimationOverrides {
  mode?: AnimationWriteMode;
  clipName?: string;
  durationSeconds?: number;
  keyframes?: number;
  cycles?: number;
  rootPath?: RootPathOperator;
  rotations?: RotationOperator[];
  rotationScope?: RotationScope;
  orientToPath?: boolean;
  deformations?: DeformationOperator[];
  /** Bone-only actions used by the local canonical skeletal fallback. */
  skeletalActions?: SkeletalAction[];
  pathDirection?: [number, number, number];
  deformationAxis?: MotionAxis | "auto";
  travelMeters?: number;
  hopHeightMeters?: number;
  radiusMeters?: number;
  rotationDegrees?: number;
  deformationFraction?: number;
  spatialWaves?: number;
  deformationTargetNodes?: string[];
  /** Creature/character assets must visibly mutate; root translation alone is not an acceptable prompted animation. */
  requireBodyDeformation?: boolean;
  trail?: boolean | {
    enabled?: boolean;
    lengthMeters?: number;
    widthMeters?: number;
    color?: [number, number, number, number];
  };
}

export interface PromptedAnimationRequest {
  sourcePath: string;
  outputPath: string;
  instruction: string;
  /** Deterministically varies generic timing while retaining the compiled motion contract. */
  seed?: number;
  overrides?: PromptedAnimationOverrides;
  semanticAnalysis?: PromptedAnimationPlan["semanticAnalysis"];
}

export interface PromptedAnimationPlan {
  version: 1;
  clipId: string;
  clipName: string;
  instruction: string;
  instructionSha256: string;
  seed: number;
  timingExponent: number;
  mode: AnimationWriteMode;
  durationSeconds: number;
  keyframes: number;
  cycles: number;
  rootPath: RootPathOperator;
  placement: "in-place" | "vertical-in-place" | "directional-travel";
  rotations: RotationOperator[];
  rotationScope: RotationScope;
  orientToPath: boolean;
  deformations: DeformationOperator[];
  skeletalActions: SkeletalAction[];
  pathDirection: [number, number, number];
  deformationAxis: MotionAxis | "auto";
  travelMeters: number;
  hopHeightMeters: number;
  radiusMeters: number;
  rotationRadians: number;
  articulationRadians: number;
  gaitSynchronization: "alternating" | "together";
  deformationFraction: number;
  spatialWaves: number;
  deformationTargetNodes: string[];
  intent: PromptedMotionIntent;
  requiresBodyDeformation: boolean;
  trail: {
    enabled: boolean;
    lengthMeters: number;
    widthMeters: number;
    color: [number, number, number, number];
  };
  loopSuggested: boolean;
  operators: string[];
  /** Every material prompt requirement and the exact operator that represents it. */
  requirementCoverage: Array<{ requirement: string; representedBy: string }>;
  /** Optional local semantic-planner evidence, retained but never trusted as animation output. */
  semanticAnalysis?: {
    provider: "ollama";
    endpoint: "loopback";
    model: string;
    summary: string;
    acknowledgedRequirements: string[];
  };
}

export interface AnimationClipValidation {
  name: string;
  channels: number;
  durationSeconds: number;
  targetPaths: string[];
  targetNodes: string[];
}

export interface PromptedAnimationValidation {
  version: 1;
  embeddedGlb: boolean;
  externalAssetUris: string[];
  clips: AnimationClipValidation[];
  requestedClip: AnimationClipValidation;
  channels: number;
  durationSeconds: number;
  pathDisplacement: {
    maximumMeters: number;
    netMeters: number;
    sampledTravelMeters: number;
  };
  deformationTargets: Array<{
    node: string;
    mesh: string;
    operator: DeformationOperator;
    targetIndices: number[];
    maxVertexDisplacementMeters: number;
    maxVertexDisplacementRatio: number;
    maxAbsWeight: number;
    effective: boolean;
  }>;
  trailPresent: boolean;
  sourceGeometrySha256: string;
  outputGeometrySha256: string;
  sourceTexturesSha256: string;
  outputTexturesSha256: string;
  retainedSourceGeometry: boolean;
  retainedTextures: boolean;
}

export interface PromptedAnimationResult {
  outputPath: string;
  plan: PromptedAnimationPlan;
  operators: string[];
  pathDisplacementMeters: number;
  validation: PromptedAnimationValidation;
}

interface GlbJsonInfo {
  json: Record<string, unknown>;
  allUris: string[];
  externalUris: string[];
}

interface DocumentFingerprint {
  geometrySha256: string;
  texturesSha256: string;
}

interface MorphSlot {
  operator: DeformationOperator;
  phase: "sine" | "cosine" | "positive" | "negative" | "main";
  index: number;
}

interface MeshMorphBinding {
  mesh: Mesh;
  oldTargetCount: number;
  newTargetCount: number;
  slots: MorphSlot[];
  selectedNodes: GltfNode[];
}

const AXIS_INDEX: Record<MotionAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finiteNumber(name: string, value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a finite number from ${min} to ${max}.`);
  }
  return value;
}

function boundedInteger(name: string, value: number, min: number, max: number): number {
  finiteNumber(name, value, min, max);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer.`);
  return value;
}

function uniqueEnum<T extends string>(name: string, values: readonly T[], allowed: readonly T[], max: number): T[] {
  if (values.length > max) throw new Error(`${name} accepts at most ${max} values.`);
  const result: T[] = [];
  for (const value of values) {
    if (!allowed.includes(value)) throw new Error(`${name} contains unsupported operator '${String(value)}'.`);
    if (!result.includes(value)) result.push(value);
  }
  return result;
}

function normalizeInstruction(value: string): string {
  if (typeof value !== "string") throw new Error("Animation instruction must be text.");
  const instruction = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!instruction) throw new Error("Animation instruction cannot be empty.");
  if (instruction.length > PROMPTED_MOTION_MAX_CHARS) throw new Error(`Animation instruction is limited to ${PROMPTED_MOTION_MAX_CHARS} characters.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(instruction)) {
    throw new Error("Animation instruction contains control characters.");
  }
  const unsafe = /(?:https?:\/\/|file:\/\/|data:|\\\\[^\s]+|(?:^|\s)[a-z]:[\\/]|\.\.[\\/]|<\/?script\b|\b(?:powershell|cmd\.exe|bash\s+-c|sh\s+-c|rm\s+-rf|curl\s|wget\s|invoke-webrequest|require\s*\(|import\s*\())/iu;
  if (unsafe.test(instruction)) throw new Error("Animation instruction contains a path, URL, script, or command and was rejected.");
  return instruction;
}

function normalizeDirection(value: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error("pathDirection must contain exactly three components.");
  const components = value.map((component, index) => finiteNumber(`pathDirection[${index}]`, component, -1, 1));
  const length = Math.hypot(components[0], components[1], components[2]);
  if (length < 1e-6) throw new Error("pathDirection cannot be a zero vector.");
  return [components[0] / length, components[1] / length, components[2] / length];
}

function promptNumber(text: string, expression: RegExp): number | undefined {
  const match = expression.exec(text);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

/** Asset-relative defaults prevent a small subject from sliding or jumping by fixed multi-metre values. */
export function scaledPromptedAnimationOverrides(
  spec: AssetSpecV1,
  instructionValue: string,
  explicitDistance?: number,
): Pick<PromptedAnimationOverrides, "travelMeters" | "hopHeightMeters" | "radiusMeters" | "pathDirection" | "requireBodyDeformation"> {
  const text = String(instructionValue ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
  const intent = analyzePromptedMotionIntent(instructionValue);
  const width = finiteNumber("spec.dimensions.width", spec.dimensions.width, 0.001, 10_000);
  const height = finiteNumber("spec.dimensions.height", spec.dimensions.height, 0.001, 10_000);
  const depth = finiteNumber("spec.dimensions.depth", spec.dimensions.depth, 0.001, 10_000);
  const subjectLength = Math.max(width, depth, height * 0.5);
  const shortMotion = /\b(?:short|small|brief|subtle|slight|few)\b/u.test(text);
  const longMotion = /\b(?:long|far|extended|large|wide)\b/u.test(text);
  const lowMotion = /\b(?:low|small|subtle|slight)\b/u.test(text);
  const highMotion = /\b(?:high|large|powerful|dramatic)\b/u.test(text);
  const promptedMeters = /\b\d+(?:\.\d+)?\s*(?:m|metres?|meters?)\b/u.test(text);
  const distance = explicitDistance ?? (promptedMeters ? undefined : Math.max(0.01, subjectLength * (shortMotion ? 1.5 : longMotion ? 4 : 1.25)));
  const creatureLike = spec.objectRules?.type === "creature"
    || ((!spec.objectRules || spec.objectRules.type === "auto") && spec.category === "character");
  const hasExplicitFrontReference = spec.referenceImage?.view === "front"
    || spec.referenceImages?.some((reference) => reference.view === "front") === true;
  const usesRightFacingCreaturePose = creatureLike && !hasExplicitFrontReference;
  // The generic creature concept contract presents the subject facing the
  // viewer's right so anatomy is inspectable. Subject-relative words such as
  // forward/backward must therefore follow +/-X, while explicit world-space
  // left/right/up/down directions retain their canonical meaning.
  const usesCreatureFacingForRoot = intent.directionalTravel && intent.subjectRelativeDirection;
  const usesCreatureFacingForBody = !intent.directionalTravel && (
    intent.bodyRelativeDirection !== 0
    || intent.groundedGait
    || intent.limbSequence
    || intent.hopping
    || intent.crouching
  );
  const pathDirection: [number, number, number] | undefined = usesRightFacingCreaturePose
    && (usesCreatureFacingForRoot || usesCreatureFacingForBody)
    ? [intent.bodyRelativeDirection < 0 || (usesCreatureFacingForRoot && intent.direction[2] < 0) ? -1 : 1, 0, 0]
    : undefined;
  return {
    ...(distance !== undefined ? { travelMeters: distance } : {}),
    ...(pathDirection ? { pathDirection } : {}),
    requireBodyDeformation: creatureLike,
    hopHeightMeters: Math.max(0.01, Math.min(10, height * (lowMotion ? 0.18 : highMotion ? 0.7 : 0.35))),
    radiusMeters: explicitDistance ?? Math.max(0.01, Math.min(25, subjectLength * (shortMotion ? 1.25 : longMotion ? 4 : 2))),
  };
}

function inferCycles(text: string): number {
  const explicit = promptNumber(text, /\b(\d+(?:\.\d+)?)\s+(?:[a-z-]+\s+){0,3}(?:times|cycles|loops|flaps|swings|spins|rotations|hops|jumps|movements|waves|undulations)\b/u);
  if (explicit !== undefined) return finiteNumber("Prompted cycle count", explicit, 0.25, 12);
  const wordCount = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:[a-z-]+\s+){0,3}(?:times|cycles|loops|flaps|swings|spins|rotations|hops|jumps|movements|waves|undulations)\b/u.exec(text)?.[1];
  if (wordCount) {
    const value = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"].indexOf(wordCount) + 1;
    return finiteNumber("Prompted cycle count", value, 0.25, 12);
  }
  if (/\bseveral\b/u.test(text)) return 4;
  if (/\b(?:repeated|repeatedly)\b/u.test(text)) return 3;
  if (/\b(?:twice|double)\b/u.test(text)) return 2;
  if (/\b(?:once|single)\b/u.test(text)) return 1;
  return 2;
}

function planOperators(plan: Pick<PromptedAnimationPlan, "rootPath" | "rotations" | "rotationScope" | "orientToPath" | "deformations" | "trail" | "gaitSynchronization" | "articulationRadians">): string[] {
  return [
    `path:${plan.rootPath}`,
    ...plan.rotations.map((operator) => `rotation:${operator}`),
    ...(plan.rotations.length > 0 ? [`rotation-scope:${plan.rotationScope}`] : []),
    ...(plan.orientToPath ? ["orientation:path-tangent"] : []),
    ...plan.deformations.map((operator) => `deformation:${operator}`),
    ...(plan.deformations.some((operator) => operator === "grounded-stride" || operator === "synchronous-bound") ? [`coordination:${plan.gaitSynchronization}`] : []),
    ...(plan.articulationRadians > 0 ? [`constraint:articulation-angle:${(plan.articulationRadians * 180 / Math.PI).toFixed(3)}`] : []),
    ...(plan.trail.enabled ? ["effect:trail"] : []),
  ];
}

export function compilePromptedAnimation(instructionValue: string, overrides: PromptedAnimationOverrides = {}, seedValue = 0): PromptedAnimationPlan {
  const instruction = normalizeInstruction(instructionValue);
  const capabilityError = promptedMotionCapabilityError(instruction);
  if (capabilityError) throw new Error(capabilityError);
  const text = instruction.toLocaleLowerCase("en-US");
  const intent = analyzePromptedMotionIntent(instruction);
  const seed = boundedInteger("seed", seedValue, 0, 0x7fffffff);
  if (intent.synchronizedLimbs && intent.alternatingLimbs) {
    throw new Error("Animation instruction asks the paired limbs to move both together and alternately. Choose one coordination pattern.");
  }
  if (intent.articulationAngleDegrees !== null && (intent.articulationAngleDegrees < 1 || intent.articulationAngleDegrees > 150)) {
    throw new Error("Prompted lower-limb articulation angle must be from 1 to 150 degrees.");
  }
  const timingExponent = seed === 0
    ? 1
    : 0.9 + createHash("sha256").update(`prompt-motion-timing:${seed}:${instruction}`).digest().readUInt16LE(0) / 0xffff * 0.2;
  if (intent.stationaryRequested && intent.directionalTravel && overrides.rootPath === undefined) {
    throw new Error("Animation instruction requests both stationary and traveling root motion. Choose one path.");
  }
  const hopDrivesRoot = intent.hopping && !intent.groundedGait && !intent.verticalMotionSuppressed;
  const inferredPath: RootPathOperator = intent.explicitPath
    ?? (hopDrivesRoot
      ? intent.directionalTravel ? "hop-arc" : "vertical-hop"
      : intent.directionalTravel ? intent.returnToOrigin ? "out-and-back" : "linear" : "stationary");

  const inferredRotations: RotationOperator[] = [];
  if (intent.swinging) inferredRotations.push("swing");
  if (intent.spinning) inferredRotations.push("spin");

  const proximalAnchor = /\b(?:anchor|anchored|base|grip|handle|held|hinge|joint|root|steady|fixed|tether)\b/u.test(text);
  const distalSubject = /\b(?:attached|ball|chain|connected|distal|end|head|joint|link|linked|pendulum|tip|tethered)\b/u.test(text);
  const rotationScope = overrides.rotationScope ?? ((overrides.rotations ?? inferredRotations).length > 0 && proximalAnchor && distalSubject ? "distal" : "whole");
  if (rotationScope !== "whole" && rotationScope !== "distal") throw new Error("rotationScope is unsupported.");
  const orientToPath = overrides.orientToPath ?? ((intent.explicitPath !== null || intent.orientation) && inferredPath !== "stationary" && inferredPath !== "vertical-hop");
  if (typeof orientToPath !== "boolean") throw new Error("orientToPath must be boolean.");

  const inferredDeformations: DeformationOperator[] = [];
  const wholeBodyWave = intent.slithering || /\b(?:ripple|ripples|rippling)\b/u.test(text);
  if (wholeBodyWave) inferredDeformations.push("axial-wave");
  // Swimming propulsion is a travelling wave weighted toward the trailing end.
  // This is geometry- and direction-based; it does not depend on an object name or template.
  if (intent.swimming) inferredDeformations.push("rear-wave");
  if (!intent.flappingSuppressed && (intent.flapping || (intent.flying && !intent.gliding))) inferredDeformations.push("bilateral-flap");
  if (intent.groundedGait || intent.limbSequence) inferredDeformations.push(intent.synchronizedLimbs ? "synchronous-bound" : "grounded-stride");
  if (intent.counterbalance) inferredDeformations.push("rear-counterbalance");
  if (intent.crouching) inferredDeformations.push("body-crouch");
  if (intent.squashStretch || (intent.hopping && !intent.verticalMotionSuppressed)) inferredDeformations.push("squash-stretch");
  if (rotationScope === "distal" && inferredRotations.includes("swing")) inferredDeformations.push("segmented-swing");
  if (rotationScope === "distal" && inferredRotations.includes("spin")) inferredDeformations.push("segmented-spin");
  // "Trailing" often describes an anatomical tail or rear region and must not
  // by itself request a visible motion trail.
  const promptedTrail = intent.trail;

  const rootPath = overrides.rootPath ?? inferredPath;
  if (!["linear", "out-and-back", "hop-arc", "vertical-hop", "figure-eight", "orbit", "stationary"].includes(rootPath)) throw new Error("rootPath is unsupported.");
  if (orientToPath && (rootPath === "stationary" || rootPath === "vertical-hop")) {
    throw new Error("orientToPath requires a path with horizontal travel.");
  }
  const rotations = uniqueEnum("rotations", overrides.rotations ?? inferredRotations, ["swing", "spin"], 2);
  const scopedDeformations = [...(overrides.deformations ?? inferredDeformations)];
  if (rotationScope === "distal" && rotations.includes("swing") && !scopedDeformations.includes("segmented-swing")) scopedDeformations.push("segmented-swing");
  if (rotationScope === "distal" && rotations.includes("spin") && !scopedDeformations.includes("segmented-spin")) scopedDeformations.push("segmented-spin");

  const trailValue = overrides.trail;
  const trailRecord = typeof trailValue === "object" && trailValue !== null ? trailValue : {};
  const trailEnabled = typeof trailValue === "boolean" ? trailValue : trailRecord.enabled ?? promptedTrail;
  // A trail is a prompted viewport effect retained in clip metadata. Do not
  // infer mesh deformation from it: deformation remains opt-in through its
  // own prompt verbs or explicit advanced overrides.
  const deformations = uniqueEnum("deformations", scopedDeformations, ["axial-wave", "rear-wave", "bilateral-flap", "squash-stretch", "grounded-stride", "synchronous-bound", "rear-counterbalance", "body-crouch", "segmented-swing", "segmented-spin", "trail-pulse"], 11);
  const skeletalActions = uniqueEnum("skeletalActions", overrides.skeletalActions ?? [], ["wave", "attack", "dance"], 3);
  const requiresBodyDeformation = overrides.requireBodyDeformation === true;
  if (overrides.requireBodyDeformation !== undefined && typeof overrides.requireBodyDeformation !== "boolean") {
    throw new Error("requireBodyDeformation must be boolean.");
  }
  if (requiresBodyDeformation && deformations.length === 0) {
    throw new Error("This creature or character animation describes only whole-model travel or rotation. Add visible body motion such as a stride, hop, crouch, slither, swim wave, or wing flap.");
  }
  if (rootPath === "stationary" && rotations.length === 0 && deformations.length === 0 && skeletalActions.length === 0 && !trailEnabled) {
    throw new Error("Animation instruction did not contain a supported motion verb or operator.");
  }
  if (rootPath === "stationary" && rotations.length === 0 && deformations.length === 0 && trailEnabled) {
    throw new Error("A visible trail requires explicit directional travel or another animated motion operator.");
  }

  const promptDuration = promptNumber(text, /\b(\d+(?:\.\d+)?)\s*(?:seconds?|secs?)\b/u);
  const durationSeconds = finiteNumber("durationSeconds", overrides.durationSeconds ?? promptDuration ?? (/\bslow(?:ly)?\b/u.test(text) ? 6 : /\b(?:fast|quick|rapid)(?:ly)?\b/u.test(text) ? 2 : 4), 0.25, 30);
  const cycles = finiteNumber("cycles", overrides.cycles ?? inferCycles(text), 0.25, 12);
  const keyframes = boundedInteger("keyframes", overrides.keyframes ?? Math.min(241, Math.max(8, Math.ceil(durationSeconds * 30) + 1)), 4, 241);
  const promptedMeters = promptNumber(text, /\b(\d+(?:\.\d+)?)\s*(?:m|metres?|meters?)\b/u);
  const requestedTravelMeters = finiteNumber("travelMeters", overrides.travelMeters ?? promptedMeters ?? 3, 0, 50);
  const hopHeightMeters = finiteNumber("hopHeightMeters", overrides.hopHeightMeters ?? 0.75, 0.01, 10);
  const requestedRadiusMeters = finiteNumber("radiusMeters", overrides.radiusMeters ?? (promptedMeters !== undefined && (rootPath === "orbit" || rootPath === "figure-eight") ? promptedMeters : 2), 0.01, 25);
  const travelMeters = rootPath === "linear" || rootPath === "out-and-back" || rootPath === "hop-arc" ? requestedTravelMeters : 0;
  const radiusMeters = rootPath === "orbit" || rootPath === "figure-eight" ? requestedRadiusMeters : 0;
  const rotationDegrees = finiteNumber("rotationDegrees", overrides.rotationDegrees ?? 65, 1, 1080);
  const articulationDegrees = finiteNumber("articulationDegrees", intent.articulationAngleDegrees ?? (intent.limbFlexion ? 38 : 0), 0, 150);
  const deformationFraction = finiteNumber("deformationFraction", overrides.deformationFraction ?? 0.16, 0.005, 0.5);
  const spatialWaves = finiteNumber("spatialWaves", overrides.spatialWaves ?? 1.5, 0.25, 6);
  const pathDirection = normalizeDirection(overrides.pathDirection ?? intent.direction);
  const deformationAxis = overrides.deformationAxis ?? "auto";
  if (!["auto", "x", "y", "z"].includes(deformationAxis)) throw new Error("deformationAxis is unsupported.");

  const deformationTargetNodes = overrides.deformationTargetNodes ?? [];
  if (!Array.isArray(deformationTargetNodes) || deformationTargetNodes.length > MAX_DEFORMATION_TARGET_NODES) {
    throw new Error(`deformationTargetNodes accepts at most ${MAX_DEFORMATION_TARGET_NODES} names.`);
  }
  const normalizedTargets: string[] = [];
  for (const name of deformationTargetNodes) {
    if (typeof name !== "string" || !name.trim() || name.length > 120 || /[\u0000-\u001f\u007f]/u.test(name)) {
      throw new Error("Each deformation target must be a non-empty node name of at most 120 characters.");
    }
    const trimmed = name.trim();
    if (!normalizedTargets.includes(trimmed)) normalizedTargets.push(trimmed);
  }

  const color = trailRecord.color ?? [1, 0.48, 0.08, 0.62];
  if (!Array.isArray(color) || color.length !== 4) throw new Error("trail.color must contain four RGBA components.");
  const normalizedColor = color.map((component, index) => finiteNumber(`trail.color[${index}]`, component, 0, 1)) as [number, number, number, number];
  const trail = {
    enabled: Boolean(trailEnabled),
    lengthMeters: finiteNumber("trail.lengthMeters", trailRecord.lengthMeters ?? 1.5, 0.01, 20),
    widthMeters: finiteNumber("trail.widthMeters", trailRecord.widthMeters ?? 0.18, 0.002, 5),
    color: normalizedColor,
  };

  const mode = overrides.mode ?? "append";
  if (mode !== "append" && mode !== "replace") throw new Error("mode must be 'append' or 'replace'.");
  let clipName = overrides.clipName?.trim();
  if (clipName !== undefined && (!clipName || clipName.length > 80 || !/^[\p{L}\p{N} _.-]+$/u.test(clipName))) {
    throw new Error("clipName must contain only letters, numbers, spaces, periods, underscores, or hyphens and be at most 80 characters.");
  }

  const instructionSha256 = createHash("sha256").update(instruction).digest("hex");
  const identity = {
    instructionSha256,
    seed,
    timingExponent,
    mode,
    durationSeconds,
    keyframes,
    cycles,
    rootPath,
    placement: rootPath === "stationary" ? "in-place" : rootPath === "vertical-hop" ? "vertical-in-place" : "directional-travel",
    rotations,
    rotationScope,
    orientToPath,
    deformations,
    skeletalActions,
    pathDirection,
    deformationAxis,
    travelMeters,
    hopHeightMeters,
    radiusMeters,
    rotationDegrees,
    articulationDegrees,
    gaitSynchronization: intent.synchronizedLimbs ? "together" : "alternating",
    deformationFraction,
    spatialWaves,
    deformationTargetNodes: normalizedTargets,
    intent,
    requiresBodyDeformation,
    trail,
  };
  const clipId = createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 16);
  clipName ??= `Prompt Motion ${clipId.slice(0, 8)}`;
  const partialPlan = {
    rootPath,
    rotations,
    rotationScope,
    orientToPath,
    deformations,
    skeletalActions,
    gaitSynchronization: intent.synchronizedLimbs ? "together" as const : "alternating" as const,
    articulationRadians: articulationDegrees * Math.PI / 180,
    trail,
  };
  const requirementCoverage: PromptedAnimationPlan["requirementCoverage"] = [
    ...(intent.directionalTravel ? [{ requirement: "world-space travel", representedBy: `path:${rootPath}` }] : []),
    ...(intent.returnToOrigin ? [{ requirement: "return to the starting position", representedBy: `path:${rootPath}` }] : []),
    ...(intent.groundedGait ? [{ requirement: "grounded gait", representedBy: `deformation:${intent.synchronizedLimbs ? "synchronous-bound" : "grounded-stride"}` }] : []),
    ...(intent.synchronizedLimbs ? [{ requirement: "paired lower limbs move together", representedBy: "coordination:together" }] : []),
    ...(intent.alternatingLimbs ? [{ requirement: "paired lower limbs alternate", representedBy: "coordination:alternating" }] : []),
    ...(intent.limbFlexion ? [{ requirement: `${articulationDegrees || "prompted"} degree lower-limb bend`, representedBy: `constraint:articulation-angle:${articulationDegrees.toFixed(3)}` }] : []),
    ...(intent.counterbalance ? [{ requirement: "rear appendage provides counterbalance", representedBy: "deformation:rear-counterbalance" }] : []),
    ...(intent.groundContact ? [{ requirement: "lower limbs recover ground contact", representedBy: `deformation:${intent.synchronizedLimbs ? "synchronous-bound" : "grounded-stride"}` }] : []),
    ...(intent.slithering ? [{ requirement: "whole-body slither", representedBy: "deformation:axial-wave" }] : []),
    ...(intent.swimming ? [{ requirement: "swimming propulsion", representedBy: "deformation:rear-wave" }] : []),
    ...(!intent.flappingSuppressed && (intent.flapping || (intent.flying && !intent.gliding)) ? [{ requirement: "visible wing flaps", representedBy: "deformation:bilateral-flap" }] : []),
    ...(intent.crouching ? [{ requirement: "body crouch or bend", representedBy: "deformation:body-crouch" }] : []),
    ...(intent.squashStretch || (intent.hopping && !intent.verticalMotionSuppressed) ? [{ requirement: "squash and stretch", representedBy: "deformation:squash-stretch" }] : []),
    ...(intent.swinging ? [{ requirement: "swinging motion", representedBy: rotations.includes("swing") ? "rotation:swing" : "missing" }] : []),
    ...(intent.spinning ? [{ requirement: "rotating motion", representedBy: rotations.includes("spin") ? "rotation:spin" : "missing" }] : []),
    ...skeletalActions.map((action) => ({ requirement: `${action} skeletal action`, representedBy: `skeletal-action:${action}` })),
  ];
  if (requirementCoverage.some((entry) => entry.representedBy === "missing")) {
    throw new Error("At least one prompted motion requirement is not represented by the compiled animation plan.");
  }
  return {
    version: 1,
    clipId,
    clipName,
    instruction,
    instructionSha256,
    seed,
    timingExponent,
    mode,
    durationSeconds,
    keyframes,
    cycles,
    rootPath,
    placement: rootPath === "stationary" ? "in-place" : rootPath === "vertical-hop" ? "vertical-in-place" : "directional-travel",
    rotations,
    rotationScope,
    orientToPath,
    deformations,
    skeletalActions,
    pathDirection,
    deformationAxis,
    travelMeters,
    hopHeightMeters,
    radiusMeters,
    rotationRadians: rotationDegrees * Math.PI / 180,
    articulationRadians: articulationDegrees * Math.PI / 180,
    gaitSynchronization: intent.synchronizedLimbs ? "together" : "alternating",
    deformationFraction,
    spatialWaves,
    deformationTargetNodes: normalizedTargets,
    intent,
    requiresBodyDeformation,
    trail,
    loopSuggested: intent.returnToOrigin || rootPath === "stationary" || rootPath === "out-and-back" || rootPath === "vertical-hop" || rootPath === "figure-eight" || rootPath === "orbit",
    operators: [...planOperators(partialPlan), ...skeletalActions.map((action) => `skeletal-action:${action}`)],
    requirementCoverage,
  };
}

function parseGlbJson(bytes: Uint8Array): GlbJsonInfo {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 20 || buffer.toString("ascii", 0, 4) !== "glTF") throw new Error("Input must be a valid binary GLB file.");
  if (buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) throw new Error("GLB header version or declared byte length is invalid.");
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a || jsonLength < 2 || 20 + jsonLength > buffer.length) throw new Error("GLB JSON chunk is invalid.");
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength).replace(/[\u0000\u0020\t\r\n]+$/u, "")) as Record<string, unknown>;
  } catch {
    throw new Error("GLB JSON chunk cannot be parsed.");
  }
  const allUris: string[] = [];
  const collectUris = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) collectUris(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === "uri" && typeof item === "string") allUris.push(item);
      else collectUris(item);
    }
  };
  collectUris(json);
  const externalUris = allUris.filter((uri) => !uri.toLocaleLowerCase("en-US").startsWith("data:"));
  return { json, allUris, externalUris };
}

function isGeneratedEffect(value: { getExtras(): Record<string, unknown> }): boolean {
  if (value.getExtras().grudgeMotionTrail === true) return true;
  const effect = asRecord(value.getExtras().grudgePromptAnimationEffect);
  return effect.generator === MOTION_BUILD;
}

function typedArrayBytes(array: ArrayBufferView): Buffer {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function fingerprintDocument(document: Document): DocumentFingerprint {
  const geometry = createHash("sha256");
  const textures = createHash("sha256");
  const root = document.getRoot();
  const sourceMeshes = root.listMeshes().filter((mesh) => !isGeneratedEffect(mesh));
  geometry.update(`mesh-count:${sourceMeshes.length};`);
  for (const [meshIndex, mesh] of sourceMeshes.entries()) {
    geometry.update(`mesh:${meshIndex}:${mesh.getName()};`);
    for (const [primitiveIndex, primitive] of mesh.listPrimitives().entries()) {
      geometry.update(`primitive:${primitiveIndex}:${primitive.getMode()};`);
      for (const semantic of [...primitive.listSemantics()].sort()) {
        const accessor = primitive.getAttribute(semantic);
        const array = accessor?.getArray();
        geometry.update(`${semantic}:${accessor?.getType() ?? "none"}:${array?.byteLength ?? 0};`);
        if (array) geometry.update(typedArrayBytes(array));
      }
      const indices = primitive.getIndices()?.getArray();
      geometry.update(`indices:${indices?.byteLength ?? 0};`);
      if (indices) geometry.update(typedArrayBytes(indices));
    }
  }
  const meshIndex = new Map(sourceMeshes.map((mesh, index) => [mesh, index] as const));
  const sourceNodes = root.listNodes().filter((node) => !isGeneratedEffect(node));
  const nodeIndex = new Map(sourceNodes.map((node, index) => [node, index] as const));
  const stableNumber = (value: number) => Math.abs(value) < 1e-10 ? 0 : Number(value.toPrecision(12));
  geometry.update(`node-count:${sourceNodes.length};`);
  for (const [index, node] of sourceNodes.entries()) {
    const matrix = node.getMatrix().map(stableNumber).join(",");
    const children = node.listChildren().filter((child) => nodeIndex.has(child)).map((child) => nodeIndex.get(child)).join(",");
    geometry.update(`node:${index}:${node.getName()}:mesh=${meshIndex.get(node.getMesh()!) ?? -1}:matrix=${matrix}:children=${children};`);
  }
  for (const [index, scene] of root.listScenes().entries()) {
    const children = scene.listChildren().filter((child) => nodeIndex.has(child)).map((child) => nodeIndex.get(child)).join(",");
    geometry.update(`scene:${index}:${scene.getName()}:children=${children};`);
  }

  const sourceMaterials = root.listMaterials().filter((material) => !isGeneratedEffect(material));
  const textureIndex = new Map(root.listTextures().map((texture, index) => [texture, index] as const));
  textures.update(`texture-count:${root.listTextures().length};material-count:${sourceMaterials.length};`);
  for (const [index, texture] of root.listTextures().entries()) {
    const image = texture.getImage();
    textures.update(`texture:${index}:${texture.getName()}:${texture.getMimeType() ?? ""}:${image?.byteLength ?? 0};`);
    if (image) textures.update(Buffer.from(image));
  }
  for (const [index, material] of sourceMaterials.entries()) {
    const slots = [
      material.getBaseColorTexture(),
      material.getMetallicRoughnessTexture(),
      material.getNormalTexture(),
      material.getOcclusionTexture(),
      material.getEmissiveTexture(),
    ].map((texture) => texture ? textureIndex.get(texture) ?? -1 : -1);
    textures.update(`material:${index}:${material.getName()}:${slots.join(",")};`);
  }
  return { geometrySha256: geometry.digest("hex"), texturesSha256: textures.digest("hex") };
}

function sceneRootTargets(document: Document): GltfNode[] {
  const targets = new Set<GltfNode>();
  for (const scene of document.getRoot().listScenes()) for (const node of scene.listChildren()) targets.add(node);
  if (targets.size === 0) throw new Error("Source GLB has no scene root to animate.");
  if (targets.size > MAX_ROOT_TARGETS) throw new Error(`Source GLB has ${targets.size} scene roots; the safe limit is ${MAX_ROOT_TARGETS}.`);
  return [...targets];
}

function removeAnimations(document: Document): void {
  for (const animation of [...document.getRoot().listAnimations()]) animation.dispose();
}

function removeGeneratedTrails(document: Document): void {
  const nodes = document.getRoot().listNodes().filter((node) => isGeneratedEffect(node));
  const meshes = new Set(nodes.map((node) => node.getMesh()).filter((mesh): mesh is Mesh => Boolean(mesh)));
  const materials = new Set([...meshes].flatMap((mesh) => mesh.listPrimitives().map((primitive) => primitive.getMaterial())).filter((material): material is NonNullable<ReturnType<Primitive["getMaterial"]>> => Boolean(material) && isGeneratedEffect(material!)));
  for (const node of nodes) node.dispose();
  for (const mesh of meshes) mesh.dispose();
  for (const material of materials) material.dispose();
}

function removeGeneratedMorphTargets(document: Document): void {
  for (const mesh of document.getRoot().listMeshes().filter((candidate) => !isGeneratedEffect(candidate))) {
    const primitives = mesh.listPrimitives();
    if (primitives.length === 0) continue;
    const reference = primitives[0].listTargets();
    const removeIndices = reference
      .map((target, index) => target.getName().startsWith(`${MOTION_BUILD}:`) ? index : -1)
      .filter((index) => index >= 0);
    if (removeIndices.length === 0) continue;
    for (const primitive of primitives) {
      const targets = primitive.listTargets();
      if (targets.length !== reference.length || removeIndices.some((index) => !targets[index]?.getName().startsWith(`${MOTION_BUILD}:`))) {
        throw new Error(`Mesh '${mesh.getName() || "unnamed"}' has inconsistent generated morph targets.`);
      }
      for (const index of [...removeIndices].sort((a, b) => b - a)) {
        const target = targets[index];
        primitive.removeTarget(target);
        target.dispose();
      }
    }
    const removed = new Set(removeIndices);
    const meshWeights = mesh.getWeights();
    if (meshWeights.length > 0) mesh.setWeights(meshWeights.filter((_, index) => !removed.has(index)));
    for (const node of document.getRoot().listNodes().filter((candidate) => candidate.getMesh() === mesh)) {
      const nodeWeights = node.getWeights();
      if (nodeWeights.length > 0) node.setWeights(nodeWeights.filter((_, index) => !removed.has(index)));
    }
    const extras = mesh.getExtras();
    const targetNames = Array.isArray(extras.targetNames) ? extras.targetNames : [];
    if (targetNames.length === reference.length) mesh.setExtras({ ...extras, targetNames: targetNames.filter((_, index) => !removed.has(index)) });
  }
}

function timesFor(plan: PromptedAnimationPlan): Float32Array<ArrayBuffer> {
  return Float32Array.from({ length: plan.keyframes }, (_, index) => index * plan.durationSeconds / (plan.keyframes - 1));
}

function timedProgress(plan: PromptedAnimationPlan, progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  return Math.pow(progress, plan.timingExponent);
}

function rootOffset(plan: PromptedAnimationPlan, progress: number): [number, number, number] {
  progress = timedProgress(plan, progress);
  const [dx, dy, dz] = plan.pathDirection;
  const gaitLift = plan.intent.verticalMotionSuppressed
    ? 0
    : plan.deformations.includes("synchronous-bound")
      ? plan.hopHeightMeters * 0.18 * Math.pow(Math.sin(Math.PI * plan.cycles * progress), 2)
      : plan.deformations.includes("grounded-stride")
        ? plan.hopHeightMeters * 0.045 * Math.pow(Math.sin(Math.PI * plan.cycles * 2 * progress), 2)
        : 0;
  if (plan.rootPath === "stationary") return [0, 0, 0];
  if (plan.rootPath === "linear") return [dx * plan.travelMeters * progress, dy * plan.travelMeters * progress + gaitLift, dz * plan.travelMeters * progress];
  if (plan.rootPath === "out-and-back") {
    const outward = Math.sin(Math.PI * progress);
    return [dx * plan.travelMeters * outward, dy * plan.travelMeters * outward + gaitLift, dz * plan.travelMeters * outward];
  }
  if (plan.rootPath === "hop-arc" || plan.rootPath === "vertical-hop") {
    const forward = plan.travelMeters * (plan.intent.returnToOrigin ? Math.sin(Math.PI * progress) : progress);
    const lift = plan.hopHeightMeters * Math.abs(Math.sin(Math.PI * plan.cycles * progress));
    return plan.rootPath === "vertical-hop" ? [0, lift, 0] : [dx * forward, dy * forward + lift, dz * forward];
  }
  const angle = Math.PI * 2 * plan.cycles * progress;
  const reference: vec3 = Math.abs(dy) > 0.98 ? [1, 0, 0] : [0, 1, 0];
  const side: vec3 = [
    reference[1] * dz - reference[2] * dy,
    reference[2] * dx - reference[0] * dz,
    reference[0] * dy - reference[1] * dx,
  ];
  const sideLength = Math.hypot(...side) || 1;
  side[0] /= sideLength; side[1] /= sideLength; side[2] /= sideLength;
  const lateral = plan.rootPath === "orbit" ? plan.radiusMeters * (Math.cos(angle) - 1) : plan.radiusMeters * Math.sin(angle);
  const forward = plan.rootPath === "orbit" ? plan.radiusMeters * Math.sin(angle) : plan.radiusMeters * Math.sin(angle) * Math.cos(angle);
  return [side[0] * lateral + dx * forward, side[1] * lateral + dy * forward, side[2] * lateral + dz * forward];
}

function quaternionMultiply(a: readonly number[], b: readonly number[]): vec4 {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function quaternionAxisAngle(axis: readonly number[], angle: number): vec4 {
  const half = angle / 2;
  const sine = Math.sin(half);
  return [axis[0] * sine, axis[1] * sine, axis[2] * sine, Math.cos(half)];
}

function pathOrientationAt(plan: PromptedAnimationPlan, progress: number): vec4 {
  const step = 1 / Math.max(128, plan.keyframes * 2);
  const before = rootOffset(plan, Math.max(0, progress - step));
  const after = rootOffset(plan, Math.min(1, progress + step));
  const tangent: vec3 = [after[0] - before[0], after[1] - before[1], after[2] - before[2]];
  const tangentLength = Math.hypot(...tangent);
  if (tangentLength < 1e-8) return [0, 0, 0, 1];
  tangent[0] /= tangentLength; tangent[1] /= tangentLength; tangent[2] /= tangentLength;
  const dot = Math.max(-1, Math.min(1, tangent[2]));
  if (dot < -0.999999) return [0, 1, 0, 0];
  const result: vec4 = [-tangent[1], tangent[0], 0, 1 + dot];
  const length = Math.hypot(...result) || 1;
  return [result[0] / length, result[1] / length, result[2] / length, result[3] / length];
}

function rotationAt(plan: PromptedAnimationPlan, base: readonly number[], progress: number): vec4 {
  const rawProgress = progress;
  progress = timedProgress(plan, progress);
  let delta: vec4 = plan.orientToPath ? pathOrientationAt(plan, rawProgress) : [0, 0, 0, 1];
  if (plan.rotationScope === "whole" && plan.rotations.includes("swing")) {
    const angle = Math.sin(Math.PI * 2 * plan.cycles * progress) * plan.rotationRadians;
    delta = quaternionMultiply(delta, quaternionAxisAngle([1, 0, 0], angle));
  }
  if (plan.rotationScope === "whole" && plan.rotations.includes("spin")) {
    const angle = Math.PI * 2 * plan.cycles * progress;
    delta = quaternionMultiply(delta, quaternionAxisAngle([0, 1, 0], angle));
  }
  if (plan.deformations.includes("synchronous-bound")) {
    const horizontalLength = Math.hypot(plan.pathDirection[0], plan.pathDirection[2]) || 1;
    const lateral: vec3 = [-plan.pathDirection[2] / horizontalLength, 0, plan.pathDirection[0] / horizontalLength];
    const lean = Math.sin(Math.PI * 2 * plan.cycles * progress) * Math.max(6 * Math.PI / 180, plan.articulationRadians * 0.16);
    delta = quaternionMultiply(delta, quaternionAxisAngle(lateral, lean));
  }
  const result = quaternionMultiply(base, delta);
  const length = Math.hypot(result[0], result[1], result[2], result[3]) || 1;
  return [result[0] / length, result[1] / length, result[2] / length, result[3] / length];
}

function addTrack(
  document: Document,
  animation: Animation,
  input: ReturnType<Document["createAccessor"]>,
  target: GltfNode,
  path: "translation" | "rotation" | "scale" | "weights",
  values: Float32Array<ArrayBuffer>,
  type: "VEC3" | "VEC4" | "SCALAR",
  role: string,
  clipId: string,
): void {
  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer("Prompt motion buffer");
  const output = document.createAccessor(`${role} values`).setType(type).setArray(values).setBuffer(buffer);
  const sampler = document.createAnimationSampler(role).setInput(input).setOutput(output).setInterpolation("LINEAR");
  const channel = document.createAnimationChannel(role).setTargetNode(target).setTargetPath(path).setSampler(sampler).setExtras({
    grudgePromptAnimation: { version: 1, clipId, role },
  });
  animation.addSampler(sampler).addChannel(channel);
}

function meshBounds(mesh: Mesh): { min: vec3; max: vec3; span: vec3 } {
  const min: vec3 = [Infinity, Infinity, Infinity];
  const max: vec3 = [-Infinity, -Infinity, -Infinity];
  let vertices = 0;
  for (const primitive of mesh.listPrimitives()) {
    const positions = primitive.getAttribute("POSITION")?.getArray();
    if (!positions || positions.length < 3) throw new Error(`Mesh '${mesh.getName() || "unnamed"}' has no usable positions for deformation.`);
    for (let index = 0; index < positions.length; index += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = Number(positions[index + axis]);
        if (!Number.isFinite(value)) throw new Error(`Mesh '${mesh.getName() || "unnamed"}' contains non-finite positions.`);
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
      vertices += 1;
    }
  }
  if (vertices === 0) throw new Error(`Mesh '${mesh.getName() || "unnamed"}' is empty.`);
  return { min, max, span: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

function chooseAxis(plan: PromptedAnimationPlan, span: vec3, operator: DeformationOperator): 0 | 1 | 2 {
  if (operator === "trail-pulse") {
    const direction = plan.pathDirection.map(Math.abs) as vec3;
    return direction[0] >= direction[1] && direction[0] >= direction[2] ? 0 : direction[1] >= direction[2] ? 1 : 2;
  }
  if (plan.deformationAxis !== "auto") return AXIS_INDEX[plan.deformationAxis];
  // Canonical Prompt-to-3D assets are Y-up. Compression therefore acts on Y,
  // while a bilateral flap uses the horizontal axis most perpendicular to
  // travel instead of whichever object dimension happens to be longest.
  if (operator === "squash-stretch") return 1;
  if (operator === "grounded-stride") return 1;
  if (operator === "synchronous-bound") return 1;
  if (operator === "body-crouch") return 1;
  if (operator === "bilateral-flap") {
    const xTravel = Math.abs(plan.pathDirection[0]);
    const zTravel = Math.abs(plan.pathDirection[2]);
    if (Math.abs(xTravel - zTravel) > 1e-6) return xTravel < zTravel ? 0 : 2;
    return span[0] >= span[2] ? 0 : 2;
  }
  return span[0] >= span[1] && span[0] >= span[2] ? 0 : span[1] >= span[2] ? 1 : 2;
}

function morphDelta(
  operator: DeformationOperator,
  phase: MorphSlot["phase"],
  position: vec3,
  bounds: ReturnType<typeof meshBounds>,
  axis: 0 | 1 | 2,
  plan: PromptedAnimationPlan,
): vec3 {
  const result: vec3 = [0, 0, 0];
  const span = Math.max(bounds.span[axis], 1e-6);
  const center: vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  if (operator === "trail-pulse") {
    // Pulse the rear-most provider-authored vertices inward. Every animated
    // position remains a convex interpolation between its original position
    // and the existing mesh centre, so motion cannot invent geometry or
    // enlarge the Hunyuan-authored bounds.
    const forwardSign = plan.pathDirection[axis] < 0 ? -1 : 1;
    const normalizedForward = forwardSign > 0
      ? (position[axis] - bounds.min[axis]) / span
      : (bounds.max[axis] - position[axis]) / span;
    const rearWeight = Math.pow(Math.max(0, Math.min(1, (0.58 - normalizedForward) / 0.58)), 1.35);
    const contraction = Math.min(0.45, plan.deformationFraction * 2.25) * rearWeight;
    for (let current = 0; current < 3; current += 1) result[current] = (center[current] - position[current]) * contraction;
  } else if (operator === "axial-wave" || operator === "rear-wave") {
    const perpendicular = axis === 0 ? 2 : 0;
    const normalized = (position[axis] - bounds.min[axis]) / span;
    const angle = Math.PI * 2 * plan.spatialWaves * normalized;
    const rearWeight = operator === "rear-wave" ? Math.pow(Math.max(0, 1 - normalized), 1.45) : 1;
    const amplitude = Math.max(span * 0.25, bounds.span[perpendicular]) * plan.deformationFraction * rearWeight;
    result[perpendicular] = amplitude * (phase === "cosine" ? Math.cos(angle) : Math.sin(angle));
  } else if (operator === "bilateral-flap") {
    const liftAxis = axis === 1 ? 2 : 1;
    const lateral = Math.min(1, Math.abs(position[axis] - center[axis]) / Math.max(span / 2, 1e-6));
    const wingWeight = Math.pow(Math.max(0, (lateral - 0.18) / 0.82), 1.35);
    result[liftAxis] = span * plan.deformationFraction * wingWeight;
  } else if (operator === "grounded-stride") {
    // Generic, topology-independent gait: only the lower body participates.
    // Alternating, smoothly side-weighted spatial regions reach and recover
    // while the upper silhouette remains stable. No animal name, template or
    // skeleton is used, and no hard vertex boundary can tear long triangles.
    const height = Math.max(bounds.span[1], 1e-6);
    const lower = Math.pow(Math.max(0, Math.min(1, (0.62 - (position[1] - bounds.min[1]) / height) / 0.62)), 1.6);
    if (lower > 0) {
      const horizontalLength = Math.hypot(plan.pathDirection[0], plan.pathDirection[2]) || 1;
      const forward: vec3 = [plan.pathDirection[0] / horizontalLength, 0, plan.pathDirection[2] / horizontalLength];
      const lateral: vec3 = [-forward[2], 0, forward[0]];
      const across = (position[0] - center[0]) * lateral[0] + (position[2] - center[2]) * lateral[2];
      const lateralScale = Math.max(bounds.span[0], bounds.span[2], height * 0.2) * 0.12;
      const sideBlend = 0.5 + 0.5 * Math.tanh(across / Math.max(lateralScale, 1e-6));
      const activeWeight = phase === "positive" ? sideBlend : 1 - sideBlend;
      const strideScale = Math.min(
        Math.max(bounds.span[0], bounds.span[2]) * 0.35,
        height * 0.28,
      );
      const stride = strideScale * plan.deformationFraction * 2 * lower * activeWeight;
      result[0] = forward[0] * stride;
      result[2] = forward[2] * stride;
      result[1] = height * plan.deformationFraction * 0.22 * lower * activeWeight;
    }
  } else if (operator === "synchronous-bound") {
    // Paired lower regions move in phase. The positive target reaches forward;
    // the negative target flexes and tucks through the prompt-bound angle.
    // This remains topology-independent while producing a materially different
    // result from the alternating grounded-stride operator.
    const height = Math.max(bounds.span[1], 1e-6);
    const normalizedHeight = Math.max(0, Math.min(1, (position[1] - bounds.min[1]) / height));
    const lower = Math.pow(Math.max(0, Math.min(1, (0.64 - normalizedHeight) / 0.64)), 1.45);
    if (lower > 0) {
      const horizontalLength = Math.hypot(plan.pathDirection[0], plan.pathDirection[2]) || 1;
      const forward: vec3 = [plan.pathDirection[0] / horizontalLength, 0, plan.pathDirection[2] / horizontalLength];
      const radius = Math.min(Math.max(bounds.span[0], bounds.span[2]) * 0.42, height * 0.34);
      const angle = Math.max(8 * Math.PI / 180, plan.articulationRadians || 38 * Math.PI / 180);
      const reach = radius * Math.sin(angle) * plan.deformationFraction * 2.4 * lower;
      const lift = radius * (1 - Math.cos(angle)) * plan.deformationFraction * 3.2 * lower;
      const direction = phase === "negative" ? -0.72 : 1;
      result[0] = forward[0] * reach * direction;
      result[2] = forward[2] * reach * direction;
      result[1] = lift * (phase === "negative" ? 1.45 : 0.55);
    }
  } else if (operator === "rear-counterbalance") {
    // Weight the rear-most elevated region relative to the retained facing
    // direction. This gives a tail/rear appendage a counter-phase stabilising
    // sweep without relying on an animal name, bone name or template mesh.
    const horizontalLength = Math.hypot(plan.pathDirection[0], plan.pathDirection[2]) || 1;
    const forward: vec3 = [plan.pathDirection[0] / horizontalLength, 0, plan.pathDirection[2] / horizontalLength];
    const lateral: vec3 = [-forward[2], 0, forward[0]];
    const along = (position[0] - center[0]) * forward[0] + (position[2] - center[2]) * forward[2];
    const forwardSpan = Math.max(bounds.span[0], bounds.span[2], 1e-6);
    const rear = Math.pow(Math.max(0, Math.min(1, 0.5 - along / forwardSpan)), 1.55);
    const height = Math.max(bounds.span[1], 1e-6);
    const normalizedHeight = Math.max(0, Math.min(1, (position[1] - bounds.min[1]) / height));
    const elevated = Math.pow(Math.max(0, Math.min(1, normalizedHeight / 0.82)), 0.55);
    const amplitude = forwardSpan * plan.deformationFraction * 0.52 * rear * elevated;
    const direction = phase === "negative" ? -1 : 1;
    result[0] = lateral[0] * amplitude * direction - forward[0] * amplitude * 0.16;
    result[2] = lateral[2] * amplitude * direction - forward[2] * amplitude * 0.16;
    result[1] = height * plan.deformationFraction * 0.12 * rear * elevated;
  } else if (operator === "body-crouch") {
    // Anchor the lowest part of the provider-authored surface while lowering
    // and pitching the torso/head region in the requested facing direction.
    // The smooth weighting gives an actual bend/crouch silhouette without
    // assuming a skeleton, a named bone, or object-specific anatomy.
    const height = Math.max(bounds.span[1], 1e-6);
    const normalizedHeight = Math.max(0, Math.min(1, (position[1] - bounds.min[1]) / height));
    const anchoredUpper = Math.pow(Math.max(0, (normalizedHeight - 0.08) / 0.92), 1.15);
    const horizontalLength = Math.hypot(plan.pathDirection[0], plan.pathDirection[2]) || 1;
    const forward: vec3 = [plan.pathDirection[0] / horizontalLength, 0, plan.pathDirection[2] / horizontalLength];
    const pivotY = bounds.min[1] + height * 0.12;
    const vertical = position[1] - pivotY;
    const along = (position[0] - center[0]) * forward[0] + (position[2] - center[2]) * forward[2];
    const angle = Math.min(0.65, Math.max(0.08, plan.deformationFraction * 2.2));
    const rotatedAlong = Math.cos(angle) * along + Math.sin(angle) * vertical;
    const rotatedVertical = -Math.sin(angle) * along + Math.cos(angle) * vertical;
    const forwardDelta = (rotatedAlong - along) * anchoredUpper;
    result[0] = forward[0] * forwardDelta;
    result[2] = forward[2] * forwardDelta;
    result[1] = (rotatedVertical - vertical) * anchoredUpper
      - height * plan.deformationFraction * 0.45 * anchoredUpper;
  } else if (operator === "segmented-swing") {
    // Hold the lower 38% of the dominant axis steady, then smoothly rotate the
    // distal geometry. This supports connected handles, links, tips and heads
    // without relying on model names, templates, skeletons or object-specific code.
    const normalized = (position[axis] - bounds.min[axis]) / span;
    const regionWeight = Math.pow(Math.max(0, Math.min(1, (normalized - 0.38) / 0.62)), 1.25);
    if (regionWeight > 0) {
      const bendAxis: 0 | 1 | 2 = axis === 2 ? 1 : 2;
      const pivot = bounds.min[axis] + span * 0.38;
      const along = position[axis] - pivot;
      const across = position[bendAxis] - center[bendAxis];
      const signedAngle = (phase === "negative" ? -1 : 1) * plan.rotationRadians * regionWeight;
      const cosine = Math.cos(signedAngle);
      const sine = Math.sin(signedAngle);
      result[axis] = cosine * along - sine * across - along;
      result[bendAxis] = sine * along + cosine * across - across;
    }
  } else if (operator === "segmented-spin") {
    // A sine/cosine morph basis rotates the distal region continuously around
    // its dominant axis while leaving the proximal 38% exactly unchanged.
    // This is generic articulated motion: no node names, skeleton, template,
    // or object category is assumed.
    const normalized = (position[axis] - bounds.min[axis]) / span;
    const regionWeight = Math.pow(Math.max(0, Math.min(1, (normalized - 0.38) / 0.62)), 1.25);
    if (regionWeight > 0) {
      const first: 0 | 1 | 2 = axis === 0 ? 1 : 0;
      const second: 0 | 1 | 2 = axis === 2 ? 1 : 2;
      const a = position[first] - center[first];
      const b = position[second] - center[second];
      if (phase === "sine") {
        result[first] = -b * regionWeight;
        result[second] = a * regionWeight;
      } else {
        result[first] = a * regionWeight;
        result[second] = b * regionWeight;
      }
    }
  } else {
    result[axis] = (position[axis] - center[axis]) * plan.deformationFraction;
    for (let current = 0; current < 3; current += 1) {
      if (current !== axis) result[current] = -(position[current] - center[current]) * plan.deformationFraction * 0.45;
    }
  }
  return result;
}

function padExistingWeightAnimation(
  document: Document,
  additions: Map<Mesh, { oldCount: number; newCount: number }>,
): void {
  const padded = new Map<AnimationSampler, { oldCount: number; newCount: number }>();
  for (const animation of document.getRoot().listAnimations()) {
    for (const channel of animation.listChannels()) {
      if (channel.getTargetPath() !== "weights") continue;
      const mesh = channel.getTargetNode()?.getMesh();
      const counts = mesh ? additions.get(mesh) : undefined;
      if (!counts || counts.oldCount === counts.newCount) continue;
      const sampler = channel.getSampler();
      const input = sampler?.getInput();
      const output = sampler?.getOutput();
      const values = output?.getArray();
      if (!sampler || !input || !output || !values || counts.oldCount === 0) throw new Error("Existing morph animation cannot be safely extended.");
      const prior = padded.get(sampler);
      if (prior && (prior.oldCount !== counts.oldCount || prior.newCount !== counts.newCount)) {
        throw new Error("A shared existing morph sampler targets meshes with incompatible target counts.");
      }
      if (prior) continue;
      const multiplier = sampler.getInterpolation() === "CUBICSPLINE" ? 3 : 1;
      const frames = input.getCount() * multiplier;
      if (values.length !== frames * counts.oldCount) throw new Error("Existing morph animation has an invalid output length.");
      const next = new Float32Array(frames * counts.newCount);
      for (let frame = 0; frame < frames; frame += 1) {
        for (let target = 0; target < counts.oldCount; target += 1) next[frame * counts.newCount + target] = Number(values[frame * counts.oldCount + target]);
      }
      const replacement = document.createAccessor(`${output.getName() || "Morph weights"} extended`)
        .setType("SCALAR")
        .setArray(next)
        .setBuffer(output.getBuffer());
      sampler.setOutput(replacement);
      padded.set(sampler, counts);
    }
  }
}

function selectedDeformationNodes(document: Document, plan: PromptedAnimationPlan): GltfNode[] {
  const candidates = document.getRoot().listNodes().filter((node) => node.getMesh() && !isGeneratedEffect(node));
  if (plan.deformationTargetNodes.length === 0) {
    if (candidates.length > MAX_DEFORMATION_TARGET_NODES) {
      throw new Error(`Source has ${candidates.length} mesh nodes; select at most ${MAX_DEFORMATION_TARGET_NODES} deformation targets.`);
    }
    return candidates;
  }
  return plan.deformationTargetNodes.map((name) => {
    const matches = candidates.filter((node) => node.getName() === name);
    if (matches.length !== 1) throw new Error(`Deformation target '${name}' must identify exactly one mesh node.`);
    return matches[0];
  });
}

function addMorphTargets(document: Document, plan: PromptedAnimationPlan): MeshMorphBinding[] {
  if (plan.deformations.length === 0) return [];
  const selectedNodes = selectedDeformationNodes(document, plan);
  if (selectedNodes.length === 0) throw new Error("Source GLB has no mesh nodes available for deformation.");
  const nodesByMesh = new Map<Mesh, GltfNode[]>();
  for (const node of selectedNodes) {
    const mesh = node.getMesh()!;
    const nodes = nodesByMesh.get(mesh) ?? [];
    nodes.push(node);
    nodesByMesh.set(mesh, nodes);
  }

  const additions = new Map<Mesh, { oldCount: number; newCount: number }>();
  const slotCount = plan.deformations.reduce((count, operator) => count + (["axial-wave", "rear-wave", "grounded-stride", "synchronous-bound", "rear-counterbalance", "segmented-swing", "segmented-spin"].includes(operator) ? 2 : 1), 0);
  for (const mesh of nodesByMesh.keys()) {
    const primitives = mesh.listPrimitives();
    if (primitives.length === 0) throw new Error(`Mesh '${mesh.getName() || "unnamed"}' contains no primitives.`);
    const counts = primitives.map((primitive) => primitive.listTargets().length);
    if (!counts.every((count) => count === counts[0])) throw new Error(`Mesh '${mesh.getName() || "unnamed"}' has inconsistent morph target counts.`);
    if (counts[0] + slotCount > MAX_TOTAL_MORPH_TARGETS) {
      throw new Error(`Mesh '${mesh.getName() || "unnamed"}' would exceed the ${MAX_TOTAL_MORPH_TARGETS}-target safety limit.`);
    }
    additions.set(mesh, { oldCount: counts[0], newCount: counts[0] + slotCount });
  }
  if (plan.mode === "append") padExistingWeightAnimation(document, additions);

  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer("Prompt motion buffer");
  const bindings: MeshMorphBinding[] = [];
  for (const [mesh, nodes] of nodesByMesh.entries()) {
    const counts = additions.get(mesh)!;
    const bounds = meshBounds(mesh);
    const slots: MorphSlot[] = [];
    let targetIndex = counts.oldCount;
    for (const operator of plan.deformations) {
      const phases: MorphSlot["phase"][] = operator === "axial-wave" || operator === "rear-wave" || operator === "segmented-spin"
        ? ["sine", "cosine"]
        : operator === "segmented-swing" || operator === "grounded-stride" || operator === "synchronous-bound" || operator === "rear-counterbalance"
          ? ["positive", "negative"]
          : ["main"];
      for (const phase of phases) slots.push({ operator, phase, index: targetIndex++ });
    }
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute("POSITION")!.getArray()!;
      for (const slot of slots) {
        const deltas = new Float32Array(positions.length);
        for (let index = 0; index < positions.length; index += 3) {
          const position: vec3 = [Number(positions[index]), Number(positions[index + 1]), Number(positions[index + 2])];
          const axis = chooseAxis(plan, bounds.span, slot.operator);
          const delta = morphDelta(slot.operator, slot.phase, position, bounds, axis, plan);
          deltas[index] = delta[0]; deltas[index + 1] = delta[1]; deltas[index + 2] = delta[2];
        }
        const targetName = `${MOTION_BUILD}:${plan.clipId}:${slot.operator}:${slot.phase}`;
        primitive.addTarget(document.createPrimitiveTarget(targetName).setAttribute("POSITION", document.createAccessor(targetName).setType("VEC3").setArray(deltas).setBuffer(buffer)));
      }
    }
    const sourceWeights = mesh.getWeights();
    if (sourceWeights.length !== 0 && sourceWeights.length !== counts.oldCount) throw new Error(`Mesh '${mesh.getName() || "unnamed"}' has invalid default morph weights.`);
    mesh.setWeights([...Array.from({ length: counts.oldCount }, (_, index) => sourceWeights[index] ?? 0), ...slots.map(() => 0)]);
    const extras = mesh.getExtras();
    const existingNames = Array.isArray(extras.targetNames) && extras.targetNames.length === counts.oldCount
      ? extras.targetNames.map(String)
      : mesh.listPrimitives()[0].listTargets().slice(0, counts.oldCount).map((target, index) => target.getName() || `SourceTarget${index}`);
    mesh.setExtras({ ...extras, targetNames: [...existingNames, ...slots.map((slot) => `${plan.clipName} ${slot.operator} ${slot.phase}`)] });
    for (const node of document.getRoot().listNodes().filter((candidate) => candidate.getMesh() === mesh)) {
      const nodeWeights = node.getWeights();
      if (nodeWeights.length !== 0 && nodeWeights.length !== counts.oldCount) throw new Error(`Node '${node.getName() || "unnamed"}' has invalid morph weights.`);
      if (nodeWeights.length > 0) node.setWeights([...nodeWeights, ...slots.map(() => 0)]);
    }
    bindings.push({ mesh, oldTargetCount: counts.oldCount, newTargetCount: counts.newCount, slots, selectedNodes: nodes });
  }
  return bindings;
}

function morphWeight(slot: MorphSlot, progress: number, plan: PromptedAnimationPlan): number {
  const phase = Math.PI * 2 * plan.cycles * timedProgress(plan, progress);
  if (slot.operator === "trail-pulse") return 0.5 - 0.5 * Math.cos(phase);
  if (slot.operator === "body-crouch") return 0.5 - 0.5 * Math.cos(phase);
  if (slot.operator === "axial-wave" || slot.operator === "rear-wave") return slot.phase === "cosine" ? Math.cos(phase) : Math.sin(phase);
  if (slot.operator === "segmented-swing" || slot.operator === "grounded-stride" || slot.operator === "synchronous-bound") {
    const swing = Math.sin(phase);
    return slot.phase === "negative" ? Math.max(0, -swing) : Math.max(0, swing);
  }
  if (slot.operator === "rear-counterbalance") {
    const swing = -Math.sin(phase);
    return slot.phase === "negative" ? Math.max(0, -swing) : Math.max(0, swing);
  }
  if (slot.operator === "segmented-spin") return slot.phase === "sine" ? Math.sin(phase) : Math.cos(phase) - 1;
  if (slot.operator === "bilateral-flap") return Math.sin(phase);
  return Math.sin(phase);
}

function applyPlan(document: Document, plan: PromptedAnimationPlan): void {
  const root = document.getRoot();
  if (root.listMeshes().length === 0) throw new Error("Source GLB contains no meshes.");
  if (plan.mode === "replace") {
    removeAnimations(document);
    removeGeneratedTrails(document);
    removeGeneratedMorphTargets(document);
  }
  const roots = sceneRootTargets(document);
  const morphBindings = addMorphTargets(document, plan);
  const buffer = root.listBuffers()[0] ?? document.createBuffer("Prompt motion buffer");
  const times = timesFor(plan);
  const input = document.createAccessor(`${plan.clipName} times`).setType("SCALAR").setArray(times).setBuffer(buffer);
  const animation = document.createAnimation(plan.clipName).setExtras({
    grudgePromptAnimation: {
      version: 1,
      generator: MOTION_BUILD,
      clipId: plan.clipId,
      operators: plan.operators,
      durationSeconds: plan.durationSeconds,
      loopSuggested: plan.loopSuggested,
      plan,
    },
  });

  for (const [rootIndex, target] of roots.entries()) {
    const base = target.getTranslation();
    if (plan.rootPath !== "stationary") {
      const translations = new Float32Array(plan.keyframes * 3);
      for (let frame = 0; frame < plan.keyframes; frame += 1) {
        const offset = rootOffset(plan, frame / (plan.keyframes - 1));
        translations.set([base[0] + offset[0], base[1] + offset[1], base[2] + offset[2]], frame * 3);
      }
      addTrack(document, animation, input, target, "translation", translations, "VEC3", `root-path-${rootIndex + 1}`, plan.clipId);
    }
    if (plan.orientToPath || (plan.rotationScope === "whole" && plan.rotations.length > 0) || plan.deformations.includes("synchronous-bound")) {
      const baseRotation = target.getRotation();
      const rotations = new Float32Array(plan.keyframes * 4);
      for (let frame = 0; frame < plan.keyframes; frame += 1) {
        rotations.set(rotationAt(plan, baseRotation, frame / (plan.keyframes - 1)), frame * 4);
      }
      addTrack(document, animation, input, target, "rotation", rotations, "VEC4", `root-rotation-${rootIndex + 1}`, plan.clipId);
    }
  }

  for (const binding of morphBindings) {
    for (const node of binding.selectedNodes) {
      const defaults = node.getWeights().length > 0 ? node.getWeights() : binding.mesh.getWeights();
      const values = new Float32Array(plan.keyframes * binding.newTargetCount);
      for (let frame = 0; frame < plan.keyframes; frame += 1) {
        const offset = frame * binding.newTargetCount;
        for (let target = 0; target < binding.newTargetCount; target += 1) values[offset + target] = defaults[target] ?? 0;
        for (const slot of binding.slots) values[offset + slot.index] = morphWeight(slot, frame / (plan.keyframes - 1), plan);
      }
      addTrack(document, animation, input, node, "weights", values, "SCALAR", `morph-${node.getName() || "unnamed"}`, plan.clipId);
    }
  }
  const asset = root.getAsset();
  const assetExtras = asRecord(asset.extras);
  const prior = asRecord(assetExtras.grudgePromptAnimation);
  const priorHistory = Array.isArray(prior.history) ? prior.history.filter((entry) => typeof entry === "string").slice(-31) : [];
  asset.generator = asset.generator
    ? asset.generator.split("; ").includes(MOTION_BUILD) ? asset.generator : `${asset.generator}; ${MOTION_BUILD}`
    : MOTION_BUILD;
  asset.extras = {
    ...assetExtras,
    grudgePromptAnimation: {
      version: 1,
      generator: MOTION_BUILD,
      latestClipId: plan.clipId,
      history: [...priorHistory, plan.clipId],
      plan,
    },
  };
}

function clipValidation(animation: Animation): AnimationClipValidation {
  let durationSeconds = 0;
  const targetPaths = new Set<string>();
  const targetNodes = new Set<string>();
  for (const channel of animation.listChannels()) {
    const sampler = channel.getSampler();
    const times = sampler?.getInput()?.getArray();
    const values = sampler?.getOutput()?.getArray();
    if (!sampler || !times || times.length === 0 || !values || values.length === 0 || !channel.getTargetNode() || !channel.getTargetPath()) {
      throw new Error(`Animation '${animation.getName()}' contains an incomplete channel.`);
    }
    for (const value of times) {
      if (!Number.isFinite(Number(value))) throw new Error(`Animation '${animation.getName()}' contains non-finite keyframe times.`);
      durationSeconds = Math.max(durationSeconds, Number(value));
    }
    for (const value of values) if (!Number.isFinite(Number(value))) throw new Error(`Animation '${animation.getName()}' contains non-finite values.`);
    targetPaths.add(channel.getTargetPath()!);
    targetNodes.add(channel.getTargetNode()!.getName() || "unnamed");
  }
  return {
    name: animation.getName(),
    channels: animation.listChannels().length,
    durationSeconds,
    targetPaths: [...targetPaths].sort(),
    targetNodes: [...targetNodes].sort(),
  };
}

function measurePath(animation: Animation, plan: PromptedAnimationPlan): PromptedAnimationValidation["pathDisplacement"] {
  const channel = animation.listChannels().find((candidate) => {
    const metadata = asRecord(candidate.getExtras().grudgePromptAnimation);
    return candidate.getTargetPath() === "translation" && typeof metadata.role === "string" && metadata.role.startsWith("root-path-");
  });
  const values = channel?.getSampler()?.getOutput()?.getArray();
  if (plan.rootPath === "stationary") {
    if (values) throw new Error("An in-place animation unexpectedly contains generated root translation.");
    return { maximumMeters: 0, netMeters: 0, sampledTravelMeters: 0 };
  }
  if (!values || values.length < 3) throw new Error("Generated clip is missing its root path samples.");
  const first: vec3 = [Number(values[0]), Number(values[1]), Number(values[2])];
  let maximumMeters = 0;
  let sampledTravelMeters = 0;
  let previous = first;
  for (let index = 0; index < values.length; index += 3) {
    const current: vec3 = [Number(values[index]), Number(values[index + 1]), Number(values[index + 2])];
    maximumMeters = Math.max(maximumMeters, Math.hypot(current[0] - first[0], current[1] - first[1], current[2] - first[2]));
    if (index > 0) sampledTravelMeters += Math.hypot(current[0] - previous[0], current[1] - previous[1], current[2] - previous[2]);
    previous = current;
  }
  return {
    maximumMeters,
    netMeters: Math.hypot(previous[0] - first[0], previous[1] - first[1], previous[2] - first[2]),
    sampledTravelMeters,
  };
}

function deformationValidation(document: Document, animation: Animation, plan: PromptedAnimationPlan): PromptedAnimationValidation["deformationTargets"] {
  const result: PromptedAnimationValidation["deformationTargets"] = [];
  for (const channel of animation.listChannels()) {
    if (channel.getTargetPath() !== "weights") continue;
    const node = channel.getTargetNode()!;
    const mesh = node.getMesh();
    if (!mesh) throw new Error("Generated deformation channel targets a node without a mesh.");
    const targetNames = mesh.getExtras().targetNames;
    const names: string[] = Array.isArray(targetNames)
      ? targetNames.map(String)
      : mesh.listPrimitives()[0]?.listTargets().map((target) => target.getName()) ?? [];
    for (const operator of plan.deformations) {
      const marker = `${MOTION_BUILD}:${plan.clipId}:${operator}:`;
      const indices = names.map((name, index) => name.startsWith(marker) ? index : -1).filter((index) => index >= 0);
      if (indices.length === 0) throw new Error(`Generated ${operator} morph target is missing from '${mesh.getName() || "unnamed"}'.`);
      let maxVertexDisplacementMeters = 0;
      for (const primitive of mesh.listPrimitives()) {
        for (const index of indices) {
          const deltas = primitive.listTargets()[index]?.getAttribute("POSITION")?.getArray();
          if (!deltas) throw new Error(`Generated ${operator} morph target has no position deltas on '${mesh.getName() || "unnamed"}'.`);
          for (let cursor = 0; cursor < deltas.length; cursor += 3) {
            maxVertexDisplacementMeters = Math.max(maxVertexDisplacementMeters, Math.hypot(
              Number(deltas[cursor]),
              Number(deltas[cursor + 1]),
              Number(deltas[cursor + 2]),
            ));
          }
        }
      }
      const targetCount = mesh.listPrimitives()[0]?.listTargets().length ?? 0;
      const weights = channel.getSampler()?.getOutput()?.getArray();
      if (!weights || targetCount < 1 || weights.length % targetCount !== 0) {
        throw new Error(`Generated ${operator} weight samples are invalid on '${mesh.getName() || "unnamed"}'.`);
      }
      let maxAbsWeight = 0;
      for (const index of indices) {
        for (let cursor = index; cursor < weights.length; cursor += targetCount) {
          maxAbsWeight = Math.max(maxAbsWeight, Math.abs(Number(weights[cursor])));
        }
      }
      const bounds = meshBounds(mesh);
      const diagonal = Math.max(1e-6, Math.hypot(bounds.span[0], bounds.span[1], bounds.span[2]));
      const maxVertexDisplacementRatio = maxVertexDisplacementMeters / diagonal;
      const effective = maxVertexDisplacementRatio >= 0.0005 && maxAbsWeight >= 0.05;
      if (!effective) {
        throw new Error(`Generated ${operator} body mutation is not measurably active on '${mesh.getName() || "unnamed"}'.`);
      }
      result.push({
        node: node.getName() || "unnamed",
        mesh: mesh.getName() || "unnamed",
        operator,
        targetIndices: indices,
        maxVertexDisplacementMeters,
        maxVertexDisplacementRatio,
        maxAbsWeight,
        effective,
      });
    }
  }
  result.sort((a, b) => `${a.node}\u0000${a.mesh}\u0000${a.operator}`.localeCompare(`${b.node}\u0000${b.mesh}\u0000${b.operator}`));
  return result;
}

function validateOutput(
  document: Document,
  bytes: Uint8Array,
  plan: PromptedAnimationPlan,
  sourceFingerprint: DocumentFingerprint,
): PromptedAnimationValidation {
  const glbInfo = parseGlbJson(bytes);
  if (glbInfo.allUris.length > 0) throw new Error("Output GLB was not fully embedded.");
  const outputFingerprint = fingerprintDocument(document);
  if (outputFingerprint.geometrySha256 !== sourceFingerprint.geometrySha256) throw new Error("Source mesh geometry changed while animation was applied.");
  if (outputFingerprint.texturesSha256 !== sourceFingerprint.texturesSha256) throw new Error("Source textures or texture bindings changed while animation was applied.");
  const animations = document.getRoot().listAnimations();
  const requested = animations.find((animation) => asRecord(animation.getExtras().grudgePromptAnimation).clipId === plan.clipId);
  if (!requested) throw new Error("Generated animation metadata did not survive GLB serialization.");
  const clips = animations.map(clipValidation);
  const requestedClip = clipValidation(requested);
  if (requestedClip.channels === 0) throw new Error("Generated animation has no channels.");
  if (Math.abs(requestedClip.durationSeconds - plan.durationSeconds) > 1e-4) throw new Error("Generated animation duration differs from the compiled plan.");
  const pathDisplacement = measurePath(requested, plan);
  const expectedPlacement = plan.rootPath === "stationary"
    ? "in-place"
    : plan.rootPath === "vertical-hop"
      ? "vertical-in-place"
      : "directional-travel";
  if (plan.placement !== expectedPlacement) throw new Error("Generated animation placement differs from its root path.");
  if (plan.placement === "directional-travel" && pathDisplacement.maximumMeters <= 1e-5) {
    throw new Error("Directional animation has no measurable world-space travel.");
  }
  if (plan.intent.returnToOrigin && plan.rootPath !== "stationary"
    && pathDisplacement.netMeters > Math.max(1e-4, pathDisplacement.maximumMeters * 0.02)) {
    throw new Error("The prompt requests a return to the starting position, but the generated root path does not return.");
  }
  if (plan.placement === "vertical-in-place") {
    if (pathDisplacement.maximumMeters <= 1e-5) throw new Error("Vertical in-place animation has no measurable lift.");
    if (pathDisplacement.netMeters > Math.max(1e-4, pathDisplacement.maximumMeters * 0.02)) {
      throw new Error("Vertical in-place animation does not return to its starting position.");
    }
  }
  const deformationTargets = deformationValidation(document, requested, plan);
  if (plan.deformations.length > 0 && deformationTargets.length === 0) throw new Error("Generated animation has no deformation targets.");
  if (plan.requiresBodyDeformation && !deformationTargets.some((target) => target.effective)) {
    throw new Error("Creature or character animation has no effective body deformation.");
  }
  const persistedPlan = asRecord(asRecord(requested.getExtras().grudgePromptAnimation).plan);
  const trailPresent = asRecord(persistedPlan.trail).enabled === true;
  if (trailPresent !== plan.trail.enabled) throw new Error("Generated trail presence differs from the compiled plan.");
  return {
    version: 1,
    embeddedGlb: glbInfo.allUris.length === 0,
    externalAssetUris: glbInfo.externalUris,
    clips,
    requestedClip,
    channels: requestedClip.channels,
    durationSeconds: requestedClip.durationSeconds,
    pathDisplacement,
    deformationTargets,
    trailPresent,
    sourceGeometrySha256: sourceFingerprint.geometrySha256,
    outputGeometrySha256: outputFingerprint.geometrySha256,
    sourceTexturesSha256: sourceFingerprint.texturesSha256,
    outputTexturesSha256: outputFingerprint.texturesSha256,
    retainedSourceGeometry: true,
    retainedTextures: true,
  };
}

function io(): NodeIO {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS);
}

/**
 * Compiles a free-text motion request into generic operators and applies them to an existing GLB.
 * The source path is never overwritten. Geometry POSITION data and all existing textures remain
 * byte-identical inside the transformed document. Only animation, requested morph deltas, and
 * portable viewport-effect metadata are added; no substitute geometry is created.
 */
export async function authorPromptedAnimation(request: PromptedAnimationRequest): Promise<PromptedAnimationResult> {
  if (!isAbsolute(request.sourcePath) || !isAbsolute(request.outputPath)) throw new Error("sourcePath and outputPath must be absolute paths.");
  if (extname(request.sourcePath).toLocaleLowerCase("en-US") !== ".glb" || extname(request.outputPath).toLocaleLowerCase("en-US") !== ".glb") {
    throw new Error("sourcePath and outputPath must both use the .glb extension.");
  }
  const sourcePath = await realpath(request.sourcePath);
  const outputPath = resolve(request.outputPath);
  if (sourcePath.toLocaleLowerCase("en-US") === outputPath.toLocaleLowerCase("en-US")) throw new Error("The source GLB cannot be overwritten; choose a new output path.");
  const sourceStat = await stat(sourcePath);
  if (!sourceStat.isFile() || sourceStat.size < 20 || sourceStat.size > MAX_SOURCE_BYTES) throw new Error("Source GLB size is outside the supported range.");
  await stat(outputPath).then(() => { throw new Error("Output path already exists; revisions must use a new file."); }, () => undefined);

  const compiledPlan = compilePromptedAnimation(request.instruction, request.overrides, request.seed ?? 0);
  const plan: PromptedAnimationPlan = request.semanticAnalysis
    ? { ...compiledPlan, semanticAnalysis: request.semanticAnalysis }
    : compiledPlan;
  const sourceBytes = await readFile(sourcePath);
  const sourceInfo = parseGlbJson(sourceBytes);
  if (sourceInfo.externalUris.length > 0) throw new Error("Source GLB references external assets. Embed all buffers and images before animation.");
  const transformer = io();
  const document = await transformer.readBinary(sourceBytes);
  const sourceFingerprint = fingerprintDocument(document);
  applyPlan(document, plan);
  const outputBytes = await transformer.writeBinary(document);
  const reloaded = await io().readBinary(outputBytes);
  const validation = validateOutput(reloaded, outputBytes, plan, sourceFingerprint);

  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = resolve(dirname(outputPath), `.${randomUUID()}.prompt-motion.glb`);
  try {
    await writeFile(temporaryPath, outputBytes, { flag: "wx" });
    await rename(temporaryPath, outputPath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
  return {
    outputPath,
    plan,
    operators: [...plan.operators],
    pathDisplacementMeters: validation.pathDisplacement.maximumMeters,
    validation,
  };
}

export const animateGlbFromPrompt = authorPromptedAnimation;
