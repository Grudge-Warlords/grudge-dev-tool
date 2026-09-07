export const PROMPT3D_VISUAL_INSPECTION_VERSION = 1 as const;
export const PROMPT3D_MINIMUM_VIEWPOINTS = 4 as const;

export const PROMPT3D_CAMERA_PRESETS = [
  "front",
  "right",
  "back",
  "left",
  "top",
  "bottom",
] as const;

export type Prompt3DCameraPreset = typeof PROMPT3D_CAMERA_PRESETS[number];
export type Prompt3DVisualInspectionStage = "geometry" | "texture" | "animation";

export interface Prompt3DInspectionTimestamp {
  accepted: true;
  at: string;
}

export interface Prompt3DInspectionViewpoint {
  preset: Prompt3DCameraPreset;
  inspectedAt: string;
}

export interface Prompt3DInspectionClip {
  index: number;
  name: string;
  duration: number;
  playedSeconds: number;
  completedAt?: string;
}

export interface Prompt3DVisualInspectionProgress {
  version: typeof PROMPT3D_VISUAL_INSPECTION_VERSION;
  assetPath: string;
  assetSha256: string;
  stage: Prompt3DVisualInspectionStage;
  viewpoints: Prompt3DInspectionViewpoint[];
  attestations: {
    geometryIdentityAndCompleteness?: Prompt3DInspectionTimestamp;
    materialCoverageAndAppearance?: Prompt3DInspectionTimestamp;
    animationMotionMatchesPrompt?: Prompt3DInspectionTimestamp;
  };
  clips: Prompt3DInspectionClip[];
  updatedAt: string;
}

export interface Prompt3DVisualInspectionEvidence extends Prompt3DVisualInspectionProgress {
  completedAt: string;
}

export interface Prompt3DVisualInspectionRequirements {
  complete: boolean;
  missing: string[];
  inspectedViewpoints: number;
  requiredViewpoints: number;
  completedClips: number;
  requiredClips: number;
}

export type Prompt3DInspectionAttestation =
  | "geometryIdentityAndCompleteness"
  | "materialCoverageAndAppearance"
  | "animationMotionMatchesPrompt";

const CAMERA_PRESET_SET = new Set<string>(PROMPT3D_CAMERA_PRESETS);
const MAX_CLIP_DURATION_SECONDS = 60 * 60;
const SHA256 = /^[a-f0-9]{64}$/;

function requireIso(label: string, value: string): void {
  if (!value || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid.`);
}

function cleanClipName(name: string, index: number): string {
  const normalized = name.trim();
  return normalized || `Clip ${index + 1}`;
}

function normalizeDuration(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_CLIP_DURATION_SECONDS) {
    throw new Error("Visual inspection requires positive, finite animation clip durations.");
  }
  return Number(duration.toFixed(6));
}

export function createPrompt3DVisualInspection(
  assetPath: string,
  assetSha256: string,
  stage: Prompt3DVisualInspectionStage,
  clips: Array<{ name: string; duration: number }> = [],
  now = new Date().toISOString(),
): Prompt3DVisualInspectionProgress {
  if (!assetPath.trim()) throw new Error("Visual inspection requires the exact displayed asset path.");
  if (!SHA256.test(assetSha256)) throw new Error("Visual inspection requires the exact displayed asset SHA-256.");
  requireIso("Visual inspection start time", now);
  if (stage !== "animation" && clips.length) throw new Error("Only animation inspection may retain clip playback evidence.");
  if (stage === "animation" && clips.length < 1) throw new Error("Animation inspection requires at least one retained clip.");
  return {
    version: PROMPT3D_VISUAL_INSPECTION_VERSION,
    assetPath,
    assetSha256,
    stage,
    viewpoints: [],
    attestations: {},
    clips: clips.map((clip, index) => ({
      index,
      name: cleanClipName(clip.name, index),
      duration: normalizeDuration(clip.duration),
      playedSeconds: 0,
    })),
    updatedAt: now,
  };
}

export function recordPrompt3DViewpoint(
  progress: Prompt3DVisualInspectionProgress,
  preset: Prompt3DCameraPreset,
  inspectedAt = new Date().toISOString(),
): Prompt3DVisualInspectionProgress {
  if (!CAMERA_PRESET_SET.has(preset)) throw new Error("Visual inspection camera preset is invalid.");
  requireIso("Viewpoint inspection time", inspectedAt);
  return {
    ...progress,
    viewpoints: [
      ...progress.viewpoints.filter((viewpoint) => viewpoint.preset !== preset),
      { preset, inspectedAt },
    ],
    updatedAt: inspectedAt,
  };
}

export function setPrompt3DInspectionAttestation(
  progress: Prompt3DVisualInspectionProgress,
  attestation: Prompt3DInspectionAttestation,
  accepted: boolean,
  at = new Date().toISOString(),
): Prompt3DVisualInspectionProgress {
  requireIso("Visual attestation time", at);
  const attestations = { ...progress.attestations };
  if (accepted) attestations[attestation] = { accepted: true, at };
  else delete attestations[attestation];
  return { ...progress, attestations, updatedAt: at };
}

export function recordPrompt3DClipPlayback(
  progress: Prompt3DVisualInspectionProgress,
  clipIndex: number,
  elapsedSeconds: number,
  at = new Date().toISOString(),
): Prompt3DVisualInspectionProgress {
  if (progress.stage !== "animation") return progress;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return progress;
  const target = progress.clips.find((clip) => clip.index === clipIndex);
  if (!target || target.completedAt) return progress;
  requireIso("Animation playback time", at);
  const playedSeconds = Math.min(target.duration, target.playedSeconds + Math.min(elapsedSeconds, 0.25));
  const complete = playedSeconds + 1e-6 >= target.duration;
  return {
    ...progress,
    clips: progress.clips.map((clip) => clip.index === clipIndex
      ? {
        ...clip,
        playedSeconds: Number(playedSeconds.toFixed(6)),
        ...(complete ? { completedAt: at } : {}),
      }
      : clip),
    updatedAt: at,
  };
}

export function prompt3DVisualInspectionRequirements(
  progress: Prompt3DVisualInspectionProgress,
): Prompt3DVisualInspectionRequirements {
  const distinctViewpoints = new Set(progress.viewpoints.map((viewpoint) => viewpoint.preset)).size;
  const completedClips = progress.clips.filter((clip) => Boolean(clip.completedAt) && clip.playedSeconds + 1e-6 >= clip.duration).length;
  const missing: string[] = [];
  if (distinctViewpoints < PROMPT3D_MINIMUM_VIEWPOINTS) missing.push(`Inspect ${PROMPT3D_MINIMUM_VIEWPOINTS - distinctViewpoints} more distinct camera viewpoint${PROMPT3D_MINIMUM_VIEWPOINTS - distinctViewpoints === 1 ? "" : "s"}.`);
  if (!progress.attestations.geometryIdentityAndCompleteness) missing.push("Attest that the model identity, required parts and overall completeness are visually correct.");
  if (progress.stage === "texture" && !progress.attestations.materialCoverageAndAppearance) missing.push("Attest that material coverage and appearance are visually correct.");
  if (progress.stage === "animation") {
    if (!progress.attestations.animationMotionMatchesPrompt) missing.push("Attest that the visible motion matches the animation prompt.");
    if (progress.clips.length < 1) missing.push("Load at least one retained animation clip.");
    else if (completedClips < progress.clips.length) missing.push(`Play ${progress.clips.length - completedClips} more retained clip${progress.clips.length - completedClips === 1 ? "" : "s"} for a full duration.`);
  }
  return {
    complete: missing.length === 0,
    missing,
    inspectedViewpoints: distinctViewpoints,
    requiredViewpoints: PROMPT3D_MINIMUM_VIEWPOINTS,
    completedClips,
    requiredClips: progress.clips.length,
  };
}

export function finalizePrompt3DVisualInspection(
  progress: Prompt3DVisualInspectionProgress,
  completedAt = new Date().toISOString(),
): Prompt3DVisualInspectionEvidence {
  requireIso("Visual inspection completion time", completedAt);
  const requirements = prompt3DVisualInspectionRequirements(progress);
  if (!requirements.complete) throw new Error(`Visual inspection is incomplete: ${requirements.missing.join(" ")}`);
  return { ...progress, completedAt };
}

export function assertPrompt3DVisualInspectionEvidence(
  evidence: Prompt3DVisualInspectionEvidence | undefined,
  expected: {
    assetPath: string;
    assetSha256: string;
    stage: Prompt3DVisualInspectionStage;
    animations?: Array<{ name: string; duration: number }>;
  },
): asserts evidence is Prompt3DVisualInspectionEvidence {
  if (!evidence || evidence.version !== PROMPT3D_VISUAL_INSPECTION_VERSION) throw new Error("Complete retained visual-inspection evidence is required.");
  if (evidence.assetPath !== expected.assetPath || evidence.assetSha256 !== expected.assetSha256 || evidence.stage !== expected.stage) {
    throw new Error("Visual-inspection evidence does not match the exact retained asset bytes and stage.");
  }
  if (!SHA256.test(evidence.assetSha256)) throw new Error("Visual-inspection asset SHA-256 is invalid.");
  requireIso("Visual inspection update time", evidence.updatedAt);
  requireIso("Visual inspection completion time", evidence.completedAt);
  for (const viewpoint of evidence.viewpoints) {
    if (!CAMERA_PRESET_SET.has(viewpoint.preset)) throw new Error("Visual-inspection evidence contains an invalid camera preset.");
    requireIso("Viewpoint inspection time", viewpoint.inspectedAt);
  }
  if (evidence.viewpoints.length !== new Set(evidence.viewpoints.map((viewpoint) => viewpoint.preset)).size) {
    throw new Error("Visual-inspection evidence contains duplicate camera presets.");
  }
  for (const attestation of Object.values(evidence.attestations)) {
    if (attestation?.accepted !== true) throw new Error("Visual-inspection evidence contains an invalid attestation.");
    requireIso("Visual attestation time", attestation.at);
  }
  if (expected.stage === "geometry" && (evidence.attestations.materialCoverageAndAppearance || evidence.attestations.animationMotionMatchesPrompt)) {
    throw new Error("Geometry inspection contains unrelated finishing attestations.");
  }
  if (expected.stage === "texture" && evidence.attestations.animationMotionMatchesPrompt) {
    throw new Error("Texture inspection contains an unrelated animation attestation.");
  }
  if (expected.stage === "animation" && evidence.attestations.materialCoverageAndAppearance) {
    throw new Error("Animation inspection contains an unrelated texture attestation.");
  }
  const expectedAnimations = expected.animations ?? [];
  if (expected.stage === "animation") {
    if (evidence.clips.length !== expectedAnimations.length) throw new Error("Visual-inspection playback evidence does not cover every retained animation clip.");
    expectedAnimations.forEach((expectedClip, index) => {
      const clip = evidence.clips[index];
      const expectedName = cleanClipName(expectedClip.name, index);
      const expectedDuration = normalizeDuration(expectedClip.duration);
      if (!clip || clip.index !== index || clip.name !== expectedName || Math.abs(clip.duration - expectedDuration) > 1e-4) {
        throw new Error("Visual-inspection playback evidence does not match the retained animation clips.");
      }
      if (!Number.isFinite(clip.playedSeconds) || clip.playedSeconds + 1e-6 < clip.duration || clip.playedSeconds > clip.duration + 1e-4 || !clip.completedAt) {
        throw new Error("Every retained animation clip must be played for at least one full duration.");
      }
      requireIso("Animation playback completion time", clip.completedAt);
    });
  } else if (evidence.clips.length) {
    throw new Error("Non-animation visual inspection contains unrelated clip playback evidence.");
  }
  const requirements = prompt3DVisualInspectionRequirements(evidence);
  if (!requirements.complete) throw new Error(`Visual-inspection evidence is incomplete: ${requirements.missing.join(" ")}`);
}
