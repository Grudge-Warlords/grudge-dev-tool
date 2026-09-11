import Prompt3DNumberInput from "../components/Prompt3DNumberInput";
import { prompt3DSettingsError, parsePrompt3DOptionalNumber, prompt3DFinishSettingsError } from "../../shared/prompt3dInputValidation";
import { promptedMotionCapabilityError } from "../../shared/promptedMotionIntent";
import { classifyPrompt3DAnimationSubject, prompt3DHyMotionSubjectError } from "../../shared/prompt3dAnimationSubject";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Box, CheckCircle2, ChevronDown, ChevronUp, Cpu, Download, Film, FolderOpen, HardDrive, ImagePlus, Loader2, Palette, Play, RefreshCw, Save, ShieldCheck, Square, Trash2, WandSparkles, XCircle } from "lucide-react";
import { toast } from "sonner";
import Model3DViewer, { type Model3DViewerLoadState } from "../components/viewers/Model3DViewer";
import DeformationRegionEditor from "../components/DeformationRegionEditor";
import Prompt3DBatchPanel from "../components/Prompt3DBatchPanel";
import Prompt3DRulesPanel from "../components/Prompt3DRulesPanel";
import { loadPrompt3DDraft, savePrompt3DDraft } from "../lib/prompt3dDraft";
import {
  exactPrompt3DVisualApproval,
  exactPrompt3DFinishVisualRejection,
  prompt3dFreshRootBatchBinding,
  prompt3dGeometryCorrectionDecision,
  prompt3dGeometryCorrectionLineageFields,
  resolvePrompt3DFinishRecoverySource,
} from "../lib/prompt3dVisualRecovery";
import { applyPrompt3DEdit, compilePrompt3DPrompt, objectRulesContradictPrompt } from "../../shared/prompt3dRules";
import { PROMPTED_MOTION_MAX_CHARS } from "../../shared/promptedMotionIntent";
import { conceptBindingMatchesSpec } from "../../shared/conceptWorkflow";
import {
  finalizePrompt3DVisualInspection,
  prompt3DVisualInspectionRequirements,
  type Prompt3DVisualInspectionProgress,
} from "../../shared/prompt3dVisualInspection";
import {
  normalizePrompt3DTextureResolution,
  PROMPT3D_SPEC_VERSION,
  prompt3dTextureResolutionsFor,
  type AssetCategory,
  type AssetSpecV1,
  type LocalPrompt3DProviderId,
  type Prompt3DComplianceState,
  type Prompt3DConceptCriterionVerdict,
  type Prompt3DConceptInspectionChecks,
  type Prompt3DConceptRejectionClassification,
  type Prompt3DInstallStatus,
  type Prompt3DJobStatus,
  type Prompt3DOverview,
  type Prompt3DOrchestrationRecord,
  type Prompt3DPlanResult,
  type Prompt3DReferenceImageSelection,
  type Prompt3DReferenceImageSpec,
  type Prompt3DReferenceImageView,
  type Prompt3DAppRuntime,
  type Prompt3DHistory,
} from "../../shared/prompt3d";
import { prompt3DGuidedCreationSpec, type Prompt3DUnifiedContext, type Prompt3DUnifiedRoute } from "../../shared/prompt3dOrchestrator";
import {
  type Prompt3DAnimationOverrides,
  type Prompt3DAssetSource,
  type Prompt3DBatchStatus,
  type Prompt3DFinishHistory,
  type Prompt3DFinishJobStatus,
  type Prompt3DFinishOperation,
  type Prompt3DFinishVisualRejectionClassification,
  type Prompt3DVisualApproval,
  type Prompt3DWorkflowArtifactRequest,
  type Prompt3DWorkflowArtifactVerification,
  type Prompt3DWorkflowExportResult,
  type Prompt3DWorkflowLibraryAsset,
  type Prompt3DWorkflowPortableExportRecord,
  type Prompt3DWorkflowSaveResult,
} from "../../shared/prompt3dWorkflow";

const GiB = 1024 ** 3;
const stateLabel: Record<Prompt3DComplianceState, string> = {
  ready: "Ready", "setup-required": "Setup required", busy: "Busy", marginal: "Marginal", unsupported: "Unsupported", "cloud-only": "Cloud only",
};
const stateStyle: Record<Prompt3DComplianceState, string> = {
  ready: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  "setup-required": "border-sky-500/40 bg-sky-500/10 text-sky-300",
  busy: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  marginal: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  unsupported: "border-red-500/40 bg-red-500/10 text-red-300",
  "cloud-only": "border-violet-500/40 bg-violet-500/10 text-violet-300",
};
const card = "rounded-xl border border-line bg-bg-2/65";
const input = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-gold/60";
const CONCEPT_PREVIEW_MAX_RETRIES = 4;
const ACCEPTED_BASE_GEOMETRY_FOR_TEXTURE_KEY = "grudge.prompt3d.accepted-base-geometry-for-texture";
const ACCEPTED_TEXTURE_FOR_ANIMATION_KEY = "grudge.prompt3d.accepted-texture-for-animation";
type ConceptCheckDraft = Record<keyof Prompt3DConceptInspectionChecks, Prompt3DConceptCriterionVerdict | "unset">;
const emptyConceptChecks = (): ConceptCheckDraft => ({
  identityAndRequiredParts: "unset",
  subjectPresentation: "unset",
  framingBackgroundAndSupport: "unset",
});

function bytes(value: number) { return `${(value / GiB).toFixed(value >= 10 * GiB ? 0 : 1)} GiB`; }
function elapsed(value?: number) { return value == null ? "in progress" : value < 1_000 ? `${value} ms` : `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)} s`; }
function destination(root: string, id: string) { return `${root.replace(/[\\/]+$/, "")}\\${id}`; }

function upsertFinishJob(jobs: Prompt3DFinishJobStatus[], next: Prompt3DFinishJobStatus) {
  return [next, ...jobs.filter((candidate) => candidate.id !== next.id)];
}

function rootGenerationSource(job: Prompt3DFinishJobStatus, jobs: Map<string, Prompt3DFinishJobStatus>): Prompt3DAssetSource | null {
  let source = job.source;
  const visited = new Set<string>();
  while (source.kind === "finish") {
    if (visited.has(source.jobId)) return null;
    visited.add(source.jobId);
    const parent = jobs.get(source.jobId);
    if (!parent) return null;
    source = parent.source;
  }
  return source;
}

function finishLineageIds(job: Prompt3DFinishJobStatus, jobs: Map<string, Prompt3DFinishJobStatus>) {
  const ids = new Set<string>();
  let current: Prompt3DFinishJobStatus | undefined = job;
  while (current && !ids.has(current.id)) {
    ids.add(current.id);
    current = current.source.kind === "finish" ? jobs.get(current.source.jobId) : undefined;
  }
  return ids;
}

function motionRequirementRows(value: unknown): Array<{ requirement: string; representedBy: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const candidate = entry as { requirement?: unknown; representedBy?: unknown };
    return typeof candidate.requirement === "string" && typeof candidate.representedBy === "string"
      ? [{ requirement: candidate.requirement, representedBy: candidate.representedBy }]
      : [];
  });
}

function defaultSpec(): AssetSpecV1 {
  return {
    version: PROMPT3D_SPEC_VERSION,
    prompt: "",
    category: "prop",
    style: "stylized",
    route: "concept-image-to-3d",
    targetFormat: "glb",
    dimensions: { width: 1, height: 1, depth: 1, unit: "m" },
    budgets: { maxTriangles: 50_000, maxTextureResolution: 2048, maxTextureBytes: 32 * 1024 * 1024 },
    seed: 42,
    variants: 1,
    providerId: "hunyuan3d-2",
    generateTextures: false,
    generateCollision: false,
    generateLods: false,
    coordinateContract: { upAxis: "+Y", forwardAxis: "+Z", origin: "ground-center", stableRootName: "GrudgeAssetRoot" },
  };
}

function editableSpec(spec: AssetSpecV1): AssetSpecV1 {
  const providerId = spec.providerId === "trellis" ? "trellis" : "hunyuan3d-2";
  const hunyuanSpec: AssetSpecV1 = {
    ...spec,
    providerId,
    route: providerId === "trellis" ? "direct-text" : "concept-image-to-3d",
    variants: providerId === "hunyuan3d-2" ? 1 : Math.max(1, Math.min(4, spec.variants)),
    generateTextures: false,
    budgets: {
      ...spec.budgets,
      maxTextureResolution: normalizePrompt3DTextureResolution(providerId, spec.budgets.maxTextureResolution),
    },
  };
  return objectRulesContradictPrompt(hunyuanSpec) ? applyPrompt3DEdit(hunyuanSpec, hunyuanSpec.prompt) : hunyuanSpec;
}

function referenceSpec(value: Prompt3DReferenceImageSpec): Prompt3DReferenceImageSpec {
  return {
    version: 1,
    sha256: value.sha256,
    mediaType: value.mediaType,
    byteSize: value.byteSize,
    width: value.width,
    height: value.height,
    originalName: value.originalName,
    ...(value.view === undefined ? {} : { view: value.view }),
  };
}

function referenceMatches(
  left: Prompt3DReferenceImageSpec | null | undefined,
  right: Prompt3DReferenceImageSpec | null | undefined,
): boolean {
  return Boolean(left && right && JSON.stringify(referenceSpec(left)) === JSON.stringify(referenceSpec(right)));
}

function withoutReferenceImages(spec: AssetSpecV1): AssetSpecV1 {
  const { referenceImage: _referenceImage, referenceImages: _referenceImages, ...promptOnly } = spec;
  return promptOnly;
}

function referenceSetMatches(
  left: Prompt3DReferenceImageSpec[] | null | undefined,
  right: Prompt3DReferenceImageSpec[] | null | undefined,
): boolean {
  return Boolean(left && right && left.length === right.length
    && left.every((image, index) => referenceMatches(image, right[index])));
}

type InitialImageMode = "choose" | "generate" | "select";

function initialImageModeForSpec(value: AssetSpecV1): Exclude<InitialImageMode, "choose"> {
  return value.referenceImages?.length || value.referenceImage ? "select" : "generate";
}

export interface Prompt3DGuidedIntent {
  nonce: number;
  prompt: string;
  mode: Prompt3DUnifiedContext["mode"];
  category: AssetCategory;
  style: AssetSpecV1["style"];
  route: Prompt3DUnifiedRoute;
  stageRoutes: Prompt3DUnifiedRoute[];
  orchestration: Prompt3DOrchestrationRecord;
}

export default function Prompt3D({ guidedIntent }: { guidedIntent?: Prompt3DGuidedIntent }) {
  const [spec, setSpec] = useState<AssetSpecV1>(() => editableSpec(loadPrompt3DDraft(defaultSpec())));
  const [overview, setOverview] = useState<Prompt3DOverview | null>(null);
  const [controlsEnabled, setControlsEnabled] = useState(false);
  const [controlsReady, setControlsReady] = useState(false);
  const [controlsSaving, setControlsSaving] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [installStates, setInstallStates] = useState<Record<string, Prompt3DInstallStatus>>({});
  const [job, setJob] = useState<Prompt3DJobStatus | null>(null);
  const [previousResult, setPreviousResult] = useState<Prompt3DJobStatus | null>(null);
  const [loadedConceptPath, setLoadedConceptPath] = useState<string | null>(null);
  const [failedConceptPath, setFailedConceptPath] = useState<string | null>(null);
  const [conceptPreviewAttempt, setConceptPreviewAttempt] = useState(0);
  const conceptPreviewRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visualApprovalBusy, setVisualApprovalBusy] = useState(false);
  const [visualApprovalError, setVisualApprovalError] = useState<string | null>(null);
  const [finishRejectionBusy, setFinishRejectionBusy] = useState(false);
  const [finishRejectionClass, setFinishRejectionClass] = useState<Prompt3DFinishVisualRejectionClassification | "">("");
  const [finishRejectionNote, setFinishRejectionNote] = useState("");
  const [modelPreviewState, setModelPreviewState] = useState<Model3DViewerLoadState | null>(null);
  const [visualInspection, setVisualInspection] = useState<Prompt3DVisualInspectionProgress | null>(null);
  const [focusedFinishId, setFocusedFinishId] = useState<string | null>(null);
  const [regionEditing,setRegionEditing]=useState(false);
  const [fourViewInput,setFourViewInput]=useState(false);
  useEffect(()=>{if((spec.referenceImages?.length??0)>1)setFourViewInput(true);},[spec.referenceImages]);
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const initialSpec = useRef(spec);
  const currentSpec = useRef(spec);
  currentSpec.current = spec;
  const [busy, setBusy] = useState(false);
  const [plannerBusy, setPlannerBusy] = useState(false);
  const [plannerResult, setPlannerResult] = useState<Prompt3DPlanResult["planner"] | null>(null);
  const [initialImageMode, setInitialImageMode] = useState<InitialImageMode>("choose");
  const [referenceSelections, setReferenceSelections] = useState<Prompt3DReferenceImageSelection[]>([]);
  const [selectedVariant, setSelectedVariant] = useState(0);
  const [editedConceptParent, setEditedConceptParent] = useState<string | null>(null);
  const [conceptChecks, setConceptChecks] = useState<ConceptCheckDraft>(emptyConceptChecks);
  const [conceptRejectionClass, setConceptRejectionClass] = useState<Prompt3DConceptRejectionClassification | "">("");
  const [conceptRejectionNote, setConceptRejectionNote] = useState("");
  const [shapeRefinement, setShapeRefinement] = useState("");
  const [texturePrompt, setTexturePrompt] = useState("");
  const [textureSeed, setTextureSeed] = useState("");
  const [acceptedBaseGeometryForTextureId, setAcceptedBaseGeometryForTextureId] = useState<string | null>(() => localStorage.getItem(ACCEPTED_BASE_GEOMETRY_FOR_TEXTURE_KEY));
  const [acceptedTextureForAnimationId, setAcceptedTextureForAnimationId] = useState<string | null>(() => localStorage.getItem(ACCEPTED_TEXTURE_FOR_ANIMATION_KEY));
  const [animationPrompt, setAnimationPrompt] = useState("");
  const [animationSeed, setAnimationSeed] = useState("");
  const [animationDuration, setAnimationDuration] = useState("");
  const [animationMode, setAnimationMode] = useState<"replace" | "append">("append");
  const [animationProvider, setAnimationProvider] = useState<NonNullable<Prompt3DAnimationOverrides["provider"]>>("auto-cpu");
  const [animationLibraries, setAnimationLibraries] = useState<Array<{ packDir: string; name: string; clipCount: number }>>([]);
  const [animationLibraryPackDir, setAnimationLibraryPackDir] = useState("");
  const [rigCorrectionPlacements, setRigCorrectionPlacements] = useState<Prompt3DAnimationOverrides["rigPlacements"]>();
  const [rigCorrectionSourceSha256, setRigCorrectionSourceSha256] = useState<string>();
  const [animationEditingAfterApprovalId, setAnimationEditingAfterApprovalId] = useState<string | null>(null);
  const [finishJobs, setFinishJobs] = useState<Prompt3DFinishJobStatus[]>([]);
  const [finishBusy, setFinishBusy] = useState(false);
  const [libraryAssets, setLibraryAssets] = useState<Prompt3DWorkflowLibraryAsset[]>([]);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [exportedAssetPath, setExportedAssetPath] = useState<string | null>(null);
  const [portableExports, setPortableExports] = useState<Prompt3DWorkflowPortableExportRecord[]>([]);
  const [artifactBusy, setArtifactBusy] = useState(false);
  const [artifactVerification, setArtifactVerification] = useState<Prompt3DWorkflowArtifactVerification | null>(null);
  const [reopenedArtifact, setReopenedArtifact] = useState<Prompt3DWorkflowArtifactVerification | null>(null);
  const [batchStatus, setBatchStatus] = useState<Prompt3DBatchStatus | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const finishJobsRef = useRef(finishJobs);
  const automaticSaveAttempts = useRef(new Map<string, number>());
  const saveInFlight = useRef(false);
  const [workflowSaveError, setWorkflowSaveError] = useState<{ id: string; message: string } | null>(null);
  const readinessRequest = useRef(0);
  finishJobsRef.current = finishJobs;
  const savedBatchAssetKey = batchStatus?.items.map((item) => item.savedAsset?.sourceJobId ?? "").join("|") ?? "";

  const refresh = async (nextSpec = currentSpec.current) => {
    const requestId = ++readinessRequest.current;
    try {
      const data: Prompt3DOverview = await window.grudge.prompt3d.overview(nextSpec);
      if (requestId !== readinessRequest.current || nextSpec.providerId !== currentSpec.current.providerId || nextSpec.generateTextures !== currentSpec.current.generateTextures) return;
      setOverview(data);
      const next: Record<string, Prompt3DInstallStatus> = {};
      data.providers.forEach((p) => { if (p.install) next[p.manifest.id] = p.install; });
      setInstallStates((old) => ({ ...old, ...next }));
    } catch (error) { if (requestId === readinessRequest.current) toast.error("Could not inspect local generator readiness", { description: String(error) }); }
  };

  useEffect(() => {
    let active = true;
    let receivedProgress = false;
    void window.grudge.prompt3d.draft().then((saved: AssetSpecV1 | null) => {
      if (active && saved && currentSpec.current === initialSpec.current) {
        setSpec(editableSpec({
          ...saved,
          budgets: {
            ...saved.budgets,
            maxTextureResolution: normalizePrompt3DTextureResolution(saved.providerId, saved.budgets.maxTextureResolution),
          },
        }));
      }
    }).catch((error: unknown) => {
      if (active) setAutosaveError(`Could not restore saved brief: ${String(error)}`);
    }).finally(() => { if (active) setDraftReady(true); });
    void window.grudge?.appRuntime?.().then((runtime: Prompt3DAppRuntime) => {
      if (active) setControlsEnabled(runtime?.localControlsEnabled === true);
    }).catch((error: unknown) => {
      if (active) toast.error("Could not restore local controls", { description: String(error) });
    }).finally(() => { if (active) setControlsReady(true); });
    void window.grudge.prompt3d.history().then((history: Prompt3DHistory) => {
      if (!active) return;
      if (!receivedProgress) {
        setJob(history.latestJob);
        if (history.latestJob) setInitialImageMode(initialImageModeForSpec(history.latestJob.spec));
      }
      setPreviousResult((current) => current ?? history.previousResult);
    }).catch((error: unknown) => { if (active) toast.error("Could not restore saved results", { description: String(error) }); });
    const prompt3dApi = window.grudge.prompt3d;
    void window.grudge?.skeleton?.listLibraries?.().then((libraries: Array<{ packDir: string; name: string; clipCount: number }>) => {
      if (!active || !Array.isArray(libraries)) return;
      setAnimationLibraries(libraries);
      setAnimationLibraryPackDir((current) => current || libraries[0]?.packDir || "");
    }).catch(() => setAnimationLibraries([]));
    try {
      const pending = sessionStorage.getItem("grudge.prompt3d.pendingRigCorrection");
      if (pending) {
        const parsed = JSON.parse(pending) as { sourceSha256?: string; sourceJobId?: string; instruction?: string; placements?: Prompt3DAnimationOverrides["rigPlacements"]; animation?: Prompt3DAnimationOverrides; seed?: number };
        if (/^[a-f0-9]{64}$/i.test(parsed.sourceSha256 ?? "") && (parsed.placements === undefined || (Array.isArray(parsed.placements) && parsed.placements.length === 22))) {
          setRigCorrectionPlacements(parsed.placements);
          setRigCorrectionSourceSha256(parsed.sourceSha256);
          if (parsed.instruction) setAnimationPrompt(parsed.instruction);
          if (parsed.sourceJobId) {
            setFocusedFinishId(parsed.sourceJobId);
            setAcceptedTextureForAnimationId(parsed.sourceJobId);
            localStorage.setItem(ACCEPTED_TEXTURE_FOR_ANIMATION_KEY, parsed.sourceJobId);
          }
          setAnimationProvider(parsed.animation?.provider ?? "auto-cpu");
          setAnimationMode(parsed.animation?.mode ?? "append");
          setAnimationDuration(parsed.animation?.duration?.toString() ?? "");
          if (parsed.animation?.libraryPackDir) setAnimationLibraryPackDir(parsed.animation.libraryPackDir);
          setAnimationSeed(parsed.seed?.toString() ?? "");
          sessionStorage.removeItem("grudge.prompt3d.pendingRigCorrection");
        }
      }
    } catch { /* Invalid handoff data is ignored. */ }
    void refresh();
    const offInstall = window.grudge.prompt3d.onInstallProgress((value: Prompt3DInstallStatus) => { setInstallStates((old: Record<string, Prompt3DInstallStatus>) => ({ ...old, [value.providerId]: value })); void refresh(); });
    const offJob = window.grudge.prompt3d.onJobProgress((value: Prompt3DJobStatus) => {
      receivedProgress = true;
      setJob(value);
      setInitialImageMode(initialImageModeForSpec(value.spec));
      if (value.state === "complete" && value.variants.some(v => v.report.gameReady)) setPreviousResult(value);
    });
    const offFinish = typeof prompt3dApi.onFinishProgress === "function"
      ? prompt3dApi.onFinishProgress((value: Prompt3DFinishJobStatus) => {
        setFinishJobs((current) => upsertFinishJob(current, value));
      })
      : undefined;
    return () => { active = false; readinessRequest.current++; offInstall?.(); offJob?.(); offFinish?.(); };
  }, []);

  useEffect(() => {
    if (!controlsEnabled || typeof window.grudge.prompt3d.finishHistory !== "function") return;
    let active = true;
    void window.grudge.prompt3d.finishHistory().then((history: Prompt3DFinishHistory) => {
      if (!active) return;
      setFinishJobs((current) => {
        const merged = new Map(history.jobs.map((saved) => [saved.id, saved]));
        for (const live of current) {
          const saved = merged.get(live.id);
          if (!saved || live.updatedAt >= saved.updatedAt) merged.set(live.id, live);
        }
        return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
    }).catch((error: unknown) => { if (active) toast.error("Could not restore finishing history", { description: String(error) }); });
    return () => { active = false; };
  }, [controlsEnabled]);

  useEffect(() => {
    if (!controlsEnabled || typeof window.grudge.prompt3d.workflowLibrary !== "function") return;
    let active = true;
    void window.grudge.prompt3d.workflowLibrary().then((assets: Prompt3DWorkflowLibraryAsset[]) => {
      if (active) setLibraryAssets(assets);
    }).catch((error: unknown) => {
      if (active) toast.error("Could not read the local workflow library", { description: String(error) });
    });
    if (typeof window.grudge.prompt3d.workflowExportHistory === "function") {
      void window.grudge.prompt3d.workflowExportHistory().then((records: Prompt3DWorkflowPortableExportRecord[]) => {
        if (active) setPortableExports(records);
      }).catch((error: unknown) => {
        if (active) toast.error("Could not read retained portable exports", { description: String(error) });
      });
    }
    return () => { active = false; };
  }, [controlsEnabled, overview?.runtime.root]);

  useEffect(() => {
    if (!controlsEnabled || !savedBatchAssetKey || typeof window.grudge.prompt3d.workflowLibrary !== "function") return;
    let active = true;
    void window.grudge.prompt3d.workflowLibrary().then((assets: Prompt3DWorkflowLibraryAsset[]) => {
      if (active) setLibraryAssets(assets);
    }).catch((error: unknown) => {
      if (active) toast.error("Could not refresh the saved batch assets", { description: String(error) });
    });
    return () => { active = false; };
  }, [controlsEnabled, savedBatchAssetKey]);

  useEffect(() => {
    if (!draftReady) return;
    let active = true;
    try { savePrompt3DDraft(spec); } catch { /* Main-process persistence is authoritative. */ }
    setDraftSaving(true);
    void window.grudge.prompt3d.saveDraft(spec).then(() => {
      if (active) setAutosaveError(null);
    }).catch((error: unknown) => {
      if (active) setAutosaveError(String(error));
    }).finally(() => { if (active) setDraftSaving(false); });
    return () => { active = false; };
  }, [spec, draftReady]);

  useEffect(() => { const timer = setTimeout(() => void refresh(spec), 250); return () => clearTimeout(timer); }, [spec.providerId, spec.generateTextures]);
  useEffect(() => {
    const maxTextureResolution = normalizePrompt3DTextureResolution(spec.providerId, spec.budgets.maxTextureResolution);
    if (spec.providerId === "hunyuan3d-2" && (spec.variants !== 1 || spec.generateTextures || spec.budgets.maxTextureResolution !== maxTextureResolution)) {
      setSpec((current) => ({
        ...current,
        variants: 1,
        generateTextures: false,
        budgets: { ...current.budgets, maxTextureResolution: normalizePrompt3DTextureResolution(current.providerId, current.budgets.maxTextureResolution) },
      }));
    }
  }, [spec.providerId, spec.variants, spec.generateTextures, spec.budgets.maxTextureResolution]);

  useEffect(() => {
    if (!draftReady || !guidedIntent) return;
    const route = guidedIntent.route;
    const plannedRoutes = new Set(guidedIntent.stageRoutes);
    if (route === "hunyuan3d-2" || route === "trellis") {
      const providerId = route;
      setReferenceSelections([]);
      setSpec((current) => prompt3DGuidedCreationSpec(defaultSpec(), current, { ...guidedIntent, route: providerId }));
      setInitialImageMode("generate");setFourViewInput(false);
      setJob(null);
      setPreviousResult(null);
      setFocusedFinishId(null);
      if (plannedRoutes.has("hunyuan-paint-refine")) setTexturePrompt(guidedIntent.prompt);
      if (plannedRoutes.has("cpu-rig-animation") || plannedRoutes.has("hy-motion-optional")) {
        setAnimationPrompt(guidedIntent.prompt);
        setAnimationProvider(plannedRoutes.has("hy-motion-optional") ? "hy-motion-1.0-lite" : "auto-cpu");
      }
      return;
    }
    setSpec((current) => ({ ...current, orchestration: guidedIntent.orchestration }));
    if (route === "hunyuan-paint-refine") setTexturePrompt(guidedIntent.prompt);
    if (route === "cpu-rig-animation" || route === "hy-motion-optional") {
      setAnimationPrompt(guidedIntent.prompt);
      setAnimationProvider(route === "hy-motion-optional" ? "hy-motion-1.0-lite" : "auto-cpu");
    }
  }, [draftReady, guidedIntent?.nonce]);

  useEffect(() => {
    setConceptChecks(emptyConceptChecks());
    setConceptRejectionClass("");
    setConceptRejectionNote("");
  }, [job?.conceptAttempt?.binding.attemptId]);

  useEffect(() => {
    if (conceptPreviewRetryTimer.current) clearTimeout(conceptPreviewRetryTimer.current);
    conceptPreviewRetryTimer.current = null;
    setConceptPreviewAttempt(0);
    setLoadedConceptPath(null);
    setFailedConceptPath(null);
    return () => {
      if (conceptPreviewRetryTimer.current) clearTimeout(conceptPreviewRetryTimer.current);
      conceptPreviewRetryTimer.current = null;
    };
  }, [job?.conceptImagePath, job?.conceptAttempt?.binding.conceptSha256]);

  const handleConceptPreviewError = (conceptPath: string) => {
    setLoadedConceptPath(null);
    if (conceptPreviewAttempt < CONCEPT_PREVIEW_MAX_RETRIES) {
      if (conceptPreviewRetryTimer.current) clearTimeout(conceptPreviewRetryTimer.current);
      conceptPreviewRetryTimer.current = setTimeout(() => {
        conceptPreviewRetryTimer.current = null;
        setConceptPreviewAttempt((current) => current + 1);
      }, 250 * (conceptPreviewAttempt + 1));
      return;
    }
    setFailedConceptPath(conceptPath);
  };

  const providers = overview?.providers ?? [];
  const batchActive = batchStatus?.state === "running" || batchStatus?.state === "awaiting-approval";
  const selected = providers.find((p) => p.manifest.id === spec.providerId);
  const textureResolutions = prompt3dTextureResolutionsFor(spec.providerId);
  const localProviders = providers.filter((p) => p.manifest.kind === "local");
  const cloudProviders = providers.filter((p) => p.manifest.kind === "cloud");
  // The live preview belongs only to the current run. Retained history remains
  // on disk and in Local Files, but it must never bleed into a successor run.
  const resultJob = job?.state === "complete" && job.variants.length ? job : null;
  const result = resultJob?.variants[selectedVariant] ?? resultJob?.variants[0];
  const resultVariantIndex = resultJob && resultJob.variants[selectedVariant] ? selectedVariant : 0;
  const awaitingConcept = job?.state === "awaiting-concept-approval";
  const conceptTechnicalRejected = job?.error?.code === "CONCEPT_QUALITY_REJECTED";
  const conceptSemanticRejected = job?.error?.code === "CONCEPT_SEMANTIC_REJECTED";
  const conceptUpgradeRequired = job?.error?.code === "CONCEPT_INSPECTION_UPGRADE_REQUIRED";
  const conceptRejected = conceptTechnicalRejected || conceptSemanticRejected || conceptUpgradeRequired;
  const conceptReviewLocked = Boolean(job?.conceptAttempt && (awaitingConcept || conceptRejected) && editedConceptParent !== job.id);
  const reviewProvider = providers.find((candidate) => candidate.manifest.id === job?.providerId);
  const conceptChecksComplete = Object.values(conceptChecks).every((value) => value === "pass" || value === "fail");
  const conceptChecksAllPass = conceptChecksComplete && Object.values(conceptChecks).every((value) => value === "pass");
  const conceptChecksAnyFail = Object.values(conceptChecks).some((value) => value === "fail");
  const effectivePresentation = job?.conceptAttempt?.promptPlan.presentationContract;
  const conceptCheckRows: Array<{ key: keyof Prompt3DConceptInspectionChecks; title: string; detail: string }> = [
    { key: "identityAndRequiredParts", title: "Identity and required parts", detail: "The subject is recognizable and every prompt-required anatomical or constructed part is present." },
    { key: "subjectPresentation", title: "Subject presentation", detail: "One complete primary subject is shown; only explicitly requested supports, scenery, or companion presentation elements appear." },
    { key: "framingBackgroundAndSupport", title: "Framing, background and support", detail: "The full silhouette has broad margins and the backdrop, lighting, stand, and scenery match the effective contract below." },
  ];
  const stricterReview = spec.category === "vehicle";
  let promptCompileError: string | null = null;
  if (spec.providerId === "hunyuan3d-2" && spec.prompt.trim()) {
    try {
      compilePrompt3DPrompt(spec);
    } catch (error) {
      promptCompileError = error instanceof Error ? error.message : String(error);
    }
  }
  const availableRoutes = selected?.manifest.enabledRoutes ?? [];
  const bothLocalUnsupported = localProviders.length > 0 && localProviders.every((p) => p.compliance.state === "unsupported");
  const finishJobMap = new Map(finishJobs.map((candidate) => [candidate.id, candidate]));
  const relatedFinishJobs = resultJob
    ? finishJobs.filter((candidate) => {
      const root = rootGenerationSource(candidate, finishJobMap);
      return root?.kind === "generation"
        && root.jobId === resultJob.id
        && (root.variantIndex ?? 0) === resultVariantIndex;
    }).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    : [];
  const focusedFinish = focusedFinishId ? relatedFinishJobs.find((candidate) => candidate.id === focusedFinishId) ?? null : null;
  const latestFinishStatus = focusedFinish ?? relatedFinishJobs.at(-1) ?? null;
  const activeFinish = [...relatedFinishJobs].reverse().find((candidate) => candidate.state === "queued" || candidate.state === "running") ?? null;
  // A finishing run owns the visible progress state. Never relabel its waiting
  // screen with the retained generation job's stale "Complete · 100%" status.
  const currentRunStatus = activeFinish ?? (!finishBusy && latestFinishStatus?.state === "failed" ? latestFinishStatus : finishBusy ? null : job);
  const displayedFinish = focusedFinish?.state === "complete" && focusedFinish.assetPath
    ? focusedFinish
    : [...relatedFinishJobs].reverse().find((candidate) => candidate.state === "complete" && Boolean(candidate.assetPath)) ?? null;
  const displayedFinishRejected = Boolean(displayedFinish && exactPrompt3DFinishVisualRejection(displayedFinish.visualRejection, {
    assetId: displayedFinish.assetId,
    jobId: displayedFinish.id,
    stage: displayedFinish.operation,
    assetPath: displayedFinish.assetPath,
    assetSha256: displayedFinish.sha256,
    geometryHash: displayedFinish.geometryHash,
  }));
  const displayedLineageIds = displayedFinish ? finishLineageIds(displayedFinish, finishJobMap) : new Set<string>();
  const displayedLineage = relatedFinishJobs.filter((candidate) => displayedLineageIds.has(candidate.id));
  const lastTextureFinish = [...displayedLineage].reverse().find((candidate) => candidate.operation === "texture" && candidate.state === "complete") ?? null;
  const workflowAssetPath = displayedFinish?.assetPath ?? result?.glbPath;
  const workflowAssetSha256 = displayedFinish?.sha256 ?? result?.sha256;
  const activeReopenedArtifact = reopenedArtifact && displayedFinish?.id === reopenedArtifact.sourceJobId
    ? reopenedArtifact
    : null;
  const displayedAssetPath = finishBusy || activeFinish || displayedFinishRejected ? undefined : activeReopenedArtifact?.path ?? workflowAssetPath;
  const displayedPreviewReady = Boolean(displayedAssetPath
    && modelPreviewState?.assetPath === displayedAssetPath
    && modelPreviewState.status === "ready");
  const displayedPreviewError = displayedAssetPath && modelPreviewState?.assetPath === displayedAssetPath && modelPreviewState.status === "error"
    ? modelPreviewState.error ?? "The exact model could not be displayed."
    : null;
  const workflowSource: Prompt3DAssetSource | null = resultJob && result
    ? displayedFinish ? { kind: "finish", jobId: displayedFinish.id } : { kind: "generation", jobId: resultJob.id, variantIndex: resultVariantIndex }
    : null;
  const geometryVisualApproved = Boolean(resultJob && result && exactPrompt3DVisualApproval(result.visualApproval, {
    assetId: resultJob.assetId ?? resultJob.id,
    jobId: resultJob.id,
    stage: "geometry",
    assetPath: result.glbPath,
    assetSha256: result.sha256,
    geometryHash: result.geometryHash,
  }));
  const geometryCorrection = resultJob
    ? prompt3dGeometryCorrectionDecision(resultJob, resultVariantIndex)
    : { mode: "blocked" as const, reason: "No completed Hunyuan geometry is visible." };
  const geometryWasRejected = Boolean(resultJob?.geometryRejection || resultJob?.geometryRejectionPath || resultJob?.geometryRejectionSha256);
  const canCorrectRejectedGeometry = geometryCorrection.mode === "reject-refinement";
  const canStartFreshGeometryCorrection = geometryCorrection.mode === "fresh-root";
  const canPromptShapeRefinement = geometryCorrection.mode !== "blocked";
  const freshRootBatchBinding = canStartFreshGeometryCorrection && resultJob
    ? prompt3dFreshRootBatchBinding(batchStatus, resultJob.id)
    : null;
  const visualApproved = displayedFinish
    ? exactPrompt3DVisualApproval(displayedFinish.visualApproval, {
      assetId: displayedFinish.assetId,
      jobId: displayedFinish.id,
      stage: displayedFinish.operation,
      assetPath: displayedFinish.assetPath,
      assetSha256: displayedFinish.sha256,
      geometryHash: displayedFinish.geometryHash,
    })
    : geometryVisualApproved;
  const pendingVisualInspectionStage = !activeReopenedArtifact && !visualApproved && !displayedFinishRejected && result?.report.gameReady
    && !(geometryWasRejected && !displayedFinish)
    ? displayedFinish?.operation ?? "geometry"
    : undefined;
  const retainedMotionCompatibility = displayedFinish?.animationPlan?.compatibility as { subject?: string; rationale?: string; rootTranslation?: string } | undefined;
  const retainedCpuClassification = displayedFinish?.motionCompatibility as { classification?: string; rationale?: string } | undefined;
  const visualInspectionCurrent = Boolean(visualInspection
    && workflowAssetPath
    && workflowAssetSha256
    && pendingVisualInspectionStage
    && visualInspection.assetPath === workflowAssetPath
    && visualInspection.assetSha256 === workflowAssetSha256
    && visualInspection.stage === pendingVisualInspectionStage);
  const visualInspectionRequirements = visualInspectionCurrent && visualInspection
    ? prompt3DVisualInspectionRequirements(visualInspection)
    : null;
  const visualInspectionReady = Boolean(visualInspectionRequirements?.complete);
  const textureRecoveryNeeded = Boolean(displayedFinish?.operation === "texture" && displayedFinishRejected);
  const animationRecoveryNeeded = Boolean(displayedFinish?.operation === "animation" && displayedFinishRejected);
  const textureRecovery = textureRecoveryNeeded && displayedFinish && resultJob
    ? resolvePrompt3DFinishRecoverySource({
      rejected: displayedFinish,
      operation: "texture",
      finishJobs: finishJobMap,
      generationJob: resultJob,
      generationVariantIndex: resultVariantIndex,
    })
    : null;
  const animationRecovery = animationRecoveryNeeded && displayedFinish && resultJob
    ? resolvePrompt3DFinishRecoverySource({
      rejected: displayedFinish,
      operation: "animation",
      finishJobs: finishJobMap,
      generationJob: resultJob,
      generationVariantIndex: resultVariantIndex,
    })
    : null;
  const ordinaryTextureSource: Prompt3DAssetSource | null = workflowSource && displayedFinish?.operation === "animation" && lastTextureFinish
    ? { kind: "finish", jobId: lastTextureFinish.id }
    : workflowSource;
  const textureSource: Prompt3DAssetSource | null = textureRecovery?.ok ? textureRecovery.source : ordinaryTextureSource;
  const animationSource: Prompt3DAssetSource | null = animationRecovery?.ok ? animationRecovery.source : workflowSource;
  const sourceIsExactlyApproved = (source: Prompt3DAssetSource | null): boolean => {
    if (!source) return false;
    if (source.kind === "generation") {
      return Boolean(resultJob
        && source.jobId === resultJob.id
        && (source.variantIndex ?? 0) === resultVariantIndex
        && geometryVisualApproved);
    }
    const retained = finishJobMap.get(source.jobId);
    return Boolean(retained && exactPrompt3DVisualApproval(retained.visualApproval, {
      assetId: retained.assetId,
      jobId: retained.id,
      stage: retained.operation,
      assetPath: retained.assetPath,
      assetSha256: retained.sha256,
      geometryHash: retained.geometryHash,
    }));
  };
  const textureSourceApproved = sourceIsExactlyApproved(textureSource);
  const animationSourceApproved = sourceIsExactlyApproved(animationSource);
  const textureRecoveryAvailable = Boolean(textureRecovery?.ok);
  const animationRecoveryAvailable = Boolean(animationRecovery?.ok);
  const textureComplete = displayedLineage.some((candidate) => candidate.operation === "texture" && candidate.state === "complete");
  const approvedTextureComplete = displayedLineage.some((candidate) => candidate.operation === "texture" && exactPrompt3DVisualApproval(candidate.visualApproval, {
    assetId: candidate.assetId,
    jobId: candidate.id,
    stage: "texture",
    assetPath: candidate.assetPath,
    assetSha256: candidate.sha256,
    geometryHash: candidate.geometryHash,
  }));
  const animationComplete = displayedLineage.some((candidate) => candidate.operation === "animation" && candidate.state === "complete");
  const savedAsset = displayedFinish ? libraryAssets.find((asset) => asset.sourceJobId === displayedFinish.id) ?? null : null;
  const portableExport = displayedFinish ? portableExports.find((record) => record.sourceJobId === displayedFinish.id) ?? null : null;
  const finishing = finishBusy || Boolean(activeFinish);
  const guidedSceneCompletionPlanned = Boolean(spec.orchestration?.enabledStageIds.some((id) => id.endsWith("-scene-completion")));
  const workflowSourceKey = workflowSource
    ? `${workflowSource.kind}:${workflowSource.jobId}:${workflowSource.kind === "generation" ? workflowSource.variantIndex ?? 0 : ""}`
    : "";

  useEffect(() => {
    setVisualApprovalError(null);
    setFinishRejectionClass("");
    setFinishRejectionNote("");
    setVisualInspection(null);
    setArtifactVerification(null);
    setReopenedArtifact(null);
  }, [workflowSourceKey]);

  const patchSpec = <K extends keyof AssetSpecV1>(key: K, value: AssetSpecV1[K]) => setSpec((old) => ({ ...old, [key]: value }));
  const applyReferenceSelections = (selections: Prompt3DReferenceImageSelection[]) => {
    const ordered = (["front", "left", "back", "right"] as const)
      .map((view) => selections.find((selection) => selection.view === view))
      .filter((selection): selection is Prompt3DReferenceImageSelection => Boolean(selection));
    const front = ordered.find((selection) => selection.view === "front");
    if (!front) throw new Error("A front reference view is required.");
    setReferenceSelections(ordered);
    setSpec((current) => ({
      ...current,
      providerId: "hunyuan3d-2",
      route: "concept-image-to-3d",
      variants: 1,
      generateTextures: false,
      budgets: {
        ...current.budgets,
        maxTextureResolution: normalizePrompt3DTextureResolution("hunyuan3d-2", current.budgets.maxTextureResolution),
      },
      referenceImage: referenceSpec(front),
      referenceImages: ordered.map(referenceSpec),
    }));
  };
  const chooseBoundView=async(view:Prompt3DReferenceImageView,single=false)=>{
    if(!controlsEnabled||busy||batchActive||editedConceptParent)return;
    try{
      const image=await window.grudge.prompt3d.chooseReferenceImage();if(!image)return;
      const rest=single?[]:referenceSelections.filter(r=>r.view!==view);
      if(rest.some(r=>r.sha256===image.sha256))throw new Error("Each view must use a different image. This file is already assigned to another view.");
      applyReferenceSelections([...rest,{...image,view}]);setInitialImageMode("select");
      if(single)setFourViewInput(false);
    }catch(e){toast.error(`Could not use the ${view==="back"?"rear/back":view} image`,{description:String(e)});}
  };
  const beginFourViews=()=>{setFourViewInput(true);setReferenceSelections([]);setSpec(current=>withoutReferenceImages(current));setInitialImageMode("select");};
  const clearReferenceImages = () => {
    if (busy || batchActive || editedConceptParent) return;
    setReferenceSelections([]);
    setSpec((current) => withoutReferenceImages(current));
    setInitialImageMode("choose");
  };
  const beginGeneratedImage = () => {
    if (busy || finishing || batchActive) return;
    setReferenceSelections([]);
    setSpec((current) => withoutReferenceImages(current));
    setInitialImageMode("generate");setFourViewInput(false);
    requestAnimationFrame(() => promptRef.current?.focus());
  };
  const returnToInitialImageChoice = () => {
    if (busy || finishing || batchActive || editedConceptParent) return;
    setReferenceSelections([]);
    setSpec((current) => withoutReferenceImages(current));
    setInitialImageMode("choose");
  };
  const startNewRootWorkflow = () => {
    if (busy || finishing || batchActive) return;
    const baseline = defaultSpec();
    const nextSpec: AssetSpecV1 = {
      ...baseline,
      providerId: spec.providerId,
      route: spec.providerId === "trellis" ? "direct-text" : "concept-image-to-3d",
      seed: Math.max(1, Math.trunc(spec.seed) + 1),
      budgets: {
        ...baseline.budgets,
        maxTextureResolution: normalizePrompt3DTextureResolution(spec.providerId, baseline.budgets.maxTextureResolution),
      },
    };
    setSpec(nextSpec);
    setInitialImageMode("choose");
    setReferenceSelections([]);
    setSelectedVariant(0);
    setEditedConceptParent(null);
    setConceptChecks(emptyConceptChecks());
    setConceptRejectionClass("");
    setConceptRejectionNote("");
    setShapeRefinement("");
    setTexturePrompt("");
    setTextureSeed("");
    localStorage.removeItem(ACCEPTED_BASE_GEOMETRY_FOR_TEXTURE_KEY);
    setAcceptedBaseGeometryForTextureId(null);
    localStorage.removeItem(ACCEPTED_TEXTURE_FOR_ANIMATION_KEY);
    setAcceptedTextureForAnimationId(null);
    setAnimationPrompt("");
    setAnimationSeed("");
    setAnimationDuration("");
    setAnimationMode("append");
    setPlannerResult(null);
    setFocusedFinishId(null);
    setExportedAssetPath(null);
    setArtifactVerification(null);
    setReopenedArtifact(null);
    setModelPreviewState(null);
    setVisualInspection(null);
    setVisualApprovalError(null);
    setFinishRejectionClass("");
    setFinishRejectionNote("");
    setJob(null);
    setPreviousResult(null);
    toast.success("New root asset ready", {
      description: "Choose the next explicit local provider input. Existing jobs, saved assets, exports, and provenance remain retained.",
    });
  };
  const changeProvider = (providerId: AssetSpecV1["providerId"], route: AssetSpecV1["route"]) => {
    if (providerId !== "hunyuan3d-2") setReferenceSelections([]);
    setSpec((current) => {
      const base = providerId === "hunyuan3d-2" ? current : withoutReferenceImages(current);
      return {
        ...base,
        providerId,
        variants: providerId === "hunyuan3d-2" ? 1 : base.variants,
        route,
        budgets: {
          ...base.budgets,
          maxTextureResolution: normalizePrompt3DTextureResolution(providerId, base.budgets.maxTextureResolution),
        },
      };
    });
  };
  const changeControls = async (enabled: boolean) => {
    setControlsSaving(true);
    try {
      const result = await (enabled ? window.grudge.prompt3d.grant() : window.grudge.prompt3d.revoke());
      setControlsEnabled(result.enabled);
      toast.success(`Local controls ${result.enabled ? "enabled" : "disabled"}`, { description: "Choice saved on this computer." });
    } catch (error) { toast.error("Could not save local controls", { description: String(error) }); }
    finally { setControlsSaving(false); }
  };

  const install = async (providerId: LocalPrompt3DProviderId, action: "install" | "repair" | "remove") => {
    if (!controlsEnabled || !overview) return;
    const row = providers.find((p) => p.manifest.id === providerId)!;
    const target = destination(overview.runtime.root, providerId);
    if (action === "remove" && !confirm(`Move ${row.manifest.name} provider files and its isolated Linux environment to recoverable .removed storage?`)) return;
    setBusy(true);
    try {
      await window.grudge.prompt3d.install({
        providerId, destination: target, action,
        confirmation: { providerId, destination: target, downloadBytes: row.manifest.downloadBytes, licenseUrl: row.manifest.licenseUrl, acceptedForThisInstall: Boolean(accepted[providerId]) },
      });
      toast.success(action === "remove" ? "Generator moved to recoverable storage" : `${row.manifest.name} setup started`);
    } catch (error) { toast.error(`${row.manifest.name} ${action} did not start`, { description: String(error) }); }
    finally { setBusy(false); void refresh(); }
  };

  const generate = async () => {
    if (!controlsEnabled) return;
    setJob(null);
    setPreviousResult(null);
    setFocusedFinishId(null);
    setModelPreviewState(null);
    setVisualInspection(null);
    setBusy(true);
    try {
      const next: Prompt3DJobStatus = await window.grudge.prompt3d.start({
        spec,
        ...(selectedReferenceReady && referenceSelections.length > 0 ? {
          referenceImage: referenceSelections.find((selection) => selection.view === "front"),
          referenceImages: referenceSelections,
        } : {}),
        ...(editedConceptParent ? {
          parentConceptJobId: editedConceptParent,
          conceptChangeReason: "edited" as const,
          ...(job?.id === editedConceptParent && job.shapeRefinement === true ? { shapeRefinement: true } : {}),
        } : {}),
        consent: { providerId: spec.providerId, confirmed: true, externalData: [], estimatedCostUsd: 0 },
      });
      setEditedConceptParent(null);
      setFocusedFinishId(null);
      setArtifactVerification(null);
      setReopenedArtifact(null);
      setJob(next);
      toast.success(spec.providerId === "hunyuan3d-2" ? "Local concept generation started" : "Local generation started");
    } catch (error) { toast.error("Generation is not available yet", { description: String(error) }); }
    finally { setBusy(false); }
  };

  const refineShape = async () => {
    const instruction = shapeRefinement.trim();
    if (!controlsEnabled || !resultJob || !result || !workflowAssetPath || !instruction) return;
    if (resultJob.providerId !== "hunyuan3d-2") {
      toast.error("Shape refinement requires a completed Hunyuan generation");
      return;
    }
    if (geometryCorrection.mode === "blocked") {
      toast.error("This geometry cannot start a safe correction", { description: geometryCorrection.reason });
      return;
    }
    if (canStartFreshGeometryCorrection && batchActive && !freshRootBatchBinding) {
      toast.error("This batch geometry correction is not bound to the active item", {
        description: "Reopen the exact batch base geometry awaiting review before submitting its correction.",
      });
      return;
    }
    const correctionLabel = canStartFreshGeometryCorrection ? "Visual geometry correction" : "Shape refinement";
    const prompt = `${resultJob.spec.prompt.trim()}\n\n${correctionLabel}: ${instruction}`;
    if (prompt.length > 2_000) {
      toast.error("The combined shape prompt is longer than 2,000 characters");
      return;
    }
    const nextSpec: AssetSpecV1 = applyPrompt3DEdit({
      ...resultJob.spec,
      seed: resultJob.spec.seed + 1,
      variants: 1,
      providerId: "hunyuan3d-2",
      route: "concept-image-to-3d",
      generateTextures: false,
    }, prompt);
    const correctionLineage = prompt3dGeometryCorrectionLineageFields(geometryCorrection, resultJob.id);
    setJob(null);
    setPreviousResult(null);
    setFocusedFinishId(null);
    setModelPreviewState(null);
    setVisualInspection(null);
    setBusy(true);
    try {
      const next: Prompt3DJobStatus = await window.grudge.prompt3d.start({
        spec: nextSpec,
        ...correctionLineage,
        ...(freshRootBatchBinding ?? {}),
        consent: { providerId: "hunyuan3d-2", confirmed: true, externalData: [], estimatedCostUsd: 0 },
      });
      setSpec(nextSpec);
      setSelectedVariant(0);
      setEditedConceptParent(null);
      setFocusedFinishId(null);
      setArtifactVerification(null);
      setReopenedArtifact(null);
      setJob(next);
      setShapeRefinement("");
      toast.success(geometryCorrection.mode === "approved-successor" ? "Refined Hunyuan concept started" : "Corrected Hunyuan concept started", {
        description: geometryCorrection.mode === "approved-successor"
          ? "The successor requires exact concept approval. The accepted parent remains retained in lineage but is hidden from the live preview."
          : geometryCorrection.mode === "reject-refinement"
            ? "The rejected geometry remains preserved and unapproved; the correction branches from its last approved ancestor."
            : "The original base geometry remains preserved and unapproved. This is a separate Hunyuan root attempt and claims no accepted ancestry.",
      });
    } catch (error) {
      toast.error("Shape refinement did not start", { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const startFinish = async (operation: Prompt3DFinishOperation) => {
    if (!controlsEnabled || !workflowSource || !workflowAssetPath || finishing) return;
    if (resultJob?.providerId !== "hunyuan3d-2") {
      toast.error("Same-panel finishing requires a Hunyuan-generated source");
      return;
    }
    const instruction = (operation === "texture" ? texturePrompt : animationPrompt).trim();
    if (!instruction) {
      toast.error(`Describe the ${operation} you want first`);
      return;
    }
    const settingsError = prompt3DFinishSettingsError(operation === "texture" ? textureSeed : animationSeed, operation === "animation" ? animationDuration : undefined)
      ?? (operation === "animation" && animationProvider === "auto-cpu" ? promptedMotionCapabilityError(instruction) : null);
    if (settingsError) { toast.error(settingsError); return; }
    const seed = parsePrompt3DOptionalNumber(operation === "texture" ? textureSeed : animationSeed, "Seed");
    const recovery = operation === "texture" ? textureRecovery : animationRecovery;
    if (recovery && !recovery.ok) {
      toast.error(`This rejected ${operation} cannot start a safe sibling retry`, { description: recovery.reason });
      return;
    }
    const source = operation === "texture" ? textureSource : animationSource;
    if (!source || (operation === "texture" ? !textureSourceApproved : !animationSourceApproved)) {
      toast.error("Persist the exact source revision approval before continuing");
      return;
    }
    if (operation === "animation" && animationProvider === "hy-motion-1.0-lite") {
      const subjectError = prompt3DHyMotionSubjectError(displayedFinish?.baseSpec ?? resultJob.spec);
      if (subjectError) { toast.error(subjectError); return; }
    }
    if (operation === "animation" && rigCorrectionPlacements
      && (source.kind !== "finish" || finishJobMap.get(source.jobId)?.sha256 !== rigCorrectionSourceSha256)) {
      toast.error("These skeleton placements belong to another model revision. Return to that source or review this model's skeleton.");
      return;
    }
    const animation: Prompt3DAnimationOverrides = {
      // A correction must not carry the rejected clip forward. Keeping Append
      // here leaves the old result as the first/default clip and makes the
      // replacement appear unchanged.
      mode: operation === "animation" && recovery?.ok ? "replace" : animationMode,
      ...(operation === "animation" && animationDuration.trim() ? { duration: parsePrompt3DOptionalNumber(animationDuration, "Duration") } : {}),
      ...(operation === "animation" ? { provider: animationProvider } : {}),
      ...(operation === "animation" && animationProvider === "local-animation-library" ? { libraryPackDir: animationLibraryPackDir } : {}),
      ...(operation === "animation" && rigCorrectionPlacements ? { rigPlacements: rigCorrectionPlacements, rigCorrectionSourceSha256 } : {}),
    };
    setFinishBusy(true);
    try {
      const next: Prompt3DFinishJobStatus = await window.grudge.prompt3d.finishStart({
        source,
        operation,
        instruction,
        ...(operation === "texture"
          && source.kind === "generation"
          && resultJob?.shapeRefinement !== true
          && acceptedBaseGeometryForTexture
          ? { useExistingGeneratedModel: true as const }
          : {}),
        ...(recovery?.ok ? { rejectedFinishJobId: recovery.rejectedJobId } : {}),
        ...(seed !== undefined ? { seed } : {}),
        ...(operation === "animation" ? { animation } : {}),
      });
      setFinishJobs((current) => upsertFinishJob(current, next));
      setFocusedFinishId(null);
      setAnimationEditingAfterApprovalId(null);
      setExportedAssetPath(null);
      setArtifactVerification(null);
      setReopenedArtifact(null);
      if (operation === "animation" && rigCorrectionPlacements) {
        setRigCorrectionPlacements(undefined);
        setRigCorrectionSourceSha256(undefined);
      }
      const recoveryAncestorStage = recovery?.ok ? recovery.approvedAncestorStage : null;
      const correctingRejectedRevision = Boolean(recoveryAncestorStage);
      toast.success(correctingRejectedRevision
        ? `Corrected ${operation} sibling started`
        : operation === "texture" ? "Hunyuan Paint refinement started" : "Prompted animation started", {
        description: correctingRejectedRevision
          ? `The rejected ${operation} remains retained and unapproved. This retry starts from its exact approved ${recoveryAncestorStage} ancestor.`
          : operation === "texture" && displayedFinish?.operation === "animation"
          ? "This branches from the last texture revision. Recreate the animation after reviewing the new material result."
          : "The previous revision remains retained in lineage but is hidden while the new revision is built and validated.",
      });
    } catch (error) {
      toast.error(`${operation === "texture" ? "Texture" : "Animation"} refinement did not start`, { description: String(error) });
    } finally {
      setFinishBusy(false);
    }
  };

  const cancelFinish = async () => {
    if (!activeFinish || !controlsEnabled) return;
    try {
      const cancelled: Prompt3DFinishJobStatus = await window.grudge.prompt3d.finishCancel(activeFinish.id);
      setFinishJobs((current) => upsertFinishJob(current, cancelled));
      toast.message("Finishing job cancelled");
    } catch (error) {
      toast.error("Could not cancel finishing job", { description: String(error) });
    }
  };

  const refreshFinishStatus = async () => {
    if (!latestFinishStatus) return;
    try {
      const current: Prompt3DFinishJobStatus = await window.grudge.prompt3d.finishStatus(latestFinishStatus.id);
      setFinishJobs((jobs) => upsertFinishJob(jobs, current));
    } catch (error) {
      toast.error("Could not refresh finishing status", { description: String(error) });
    }
  };

  const saveWorkflow = async (automatic = false) => {
    if (!workflowSource || !displayedFinish || !workflowAssetPath || !visualApproved || saveInFlight.current) return;
    const savingId = displayedFinish.id;
    saveInFlight.current = true;
    setWorkflowSaveError(null);
    setLibraryBusy(true);
    try {
      const saved: Prompt3DWorkflowSaveResult = await window.grudge.prompt3d.workflowSave(workflowSource);
      setLibraryAssets((assets) => [saved.asset, ...assets.filter((asset) => asset.id !== saved.asset.id)]);
      toast.success(saved.alreadySaved ? "Validated revision is already saved" : automatic ? "Automatically saved to Local Files" : "Saved to Local Files", { description: saved.asset.savedPath });
    } catch (error) {
      setWorkflowSaveError({ id: savingId, message: `Local Files save failed: ${String(error)}` });
      toast.error("Could not save the workflow revision", { description: String(error) });
    } finally {
      saveInFlight.current = false;
      setLibraryBusy(false);
    }
  };

  useEffect(() => {
    const finishId = displayedFinish?.id;
    if (!controlsEnabled || !finishId || !visualApproved || !textureComplete || !animationComplete || savedAsset || libraryBusy) return;
    const attempts = automaticSaveAttempts.current.get(finishId) ?? 0;
    if (attempts >= 1) return;
    automaticSaveAttempts.current.set(finishId, attempts + 1);
    void saveWorkflow(true);
  }, [controlsEnabled, displayedFinish?.id, visualApproved, textureComplete, animationComplete, savedAsset?.id, libraryBusy]);

  const exportWorkflow = async () => {
    if (!workflowSource || !displayedFinish || !workflowAssetPath || !visualApproved) return;
    setLibraryBusy(true);
    try {
      const exported = await window.grudge.prompt3d.workflowExport(workflowSource);
      if ("canceled" in exported && exported.canceled) {
        toast.message("Export cancelled");
        return;
      }
      const completed = exported as Prompt3DWorkflowExportResult;
      setPortableExports((records) => [completed.record, ...records.filter((record) => record.id !== completed.record.id)]);
      setExportedAssetPath(completed.destinationPath);
      setArtifactVerification(null);
      toast.success("Validated animated model exported", { description: completed.destinationPath });
    } catch (error) {
      toast.error("Could not export the workflow revision", { description: String(error) });
    } finally {
      setLibraryBusy(false);
    }
  };

  const verifyArtifact = async (request: Prompt3DWorkflowArtifactRequest, reopen: boolean) => {
    if (!controlsEnabled || artifactBusy) return;
    setArtifactBusy(true);
    try {
      const verified = await window.grudge.prompt3d.workflowVerifyArtifact(request);
      setArtifactVerification(verified);
      if (reopen) setReopenedArtifact(verified);
      toast.success(reopen ? `Reopened verified ${verified.kind} copy` : `Verified ${verified.kind} copy`, {
        description: `${verified.textures} embedded texture set(s) and ${verified.animations.length} playable animation clip(s) retained.`,
      });
    } catch (error) {
      if (reopen) setReopenedArtifact(null);
      setArtifactVerification(null);
      toast.error(`Could not ${reopen ? "reopen" : "verify"} the retained copy`, { description: String(error) });
    } finally {
      setArtifactBusy(false);
    }
  };

  const approveVisibleRevision = async () => {
    if (!controlsEnabled || !workflowSource || visualApprovalBusy) return;
    if (!displayedPreviewReady) {
      const message = displayedPreviewError
        ? `The exact model preview failed: ${displayedPreviewError}`
        : "Wait for the exact model to finish loading in the 3D preview before approving it.";
      setVisualApprovalError(message);
      toast.error("Visual approval is blocked", { description: message });
      return;
    }
    if (!visualInspectionCurrent || !visualInspection || !visualInspectionReady) {
      const message = visualInspectionRequirements?.missing.join(" ")
        ?? "Complete the fixed-view visual inspection and every stage-specific attestation before approval.";
      setVisualApprovalError(message);
      toast.error("Visual approval is blocked", { description: message });
      return;
    }
    setVisualApprovalBusy(true);
    setVisualApprovalError(null);
    try {
      const inspection = finalizePrompt3DVisualInspection(visualInspection);
      const approval: Prompt3DVisualApproval = await window.grudge.prompt3d.workflowApproveVisual({ source: workflowSource, inspection });
      if (workflowSource.kind === "generation") {
        const current: Prompt3DJobStatus = await window.grudge.prompt3d.status(workflowSource.jobId);
        setJob(current);
        if (current.state === "complete" && current.variants.some((variant) => variant.report.gameReady)) setPreviousResult(current);
      } else {
        const current: Prompt3DFinishJobStatus = await window.grudge.prompt3d.finishStatus(workflowSource.jobId);
        setFinishJobs((jobs) => upsertFinishJob(jobs, current));
        setFocusedFinishId(current.id);
        if (current.operation === "animation") setAnimationEditingAfterApprovalId(null);
      }
      toast.success("Exact visual approval persisted", { description: `Approval ${approval.approvalId.slice(0, 12)} is bound to this retained revision and its hashes.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVisualApprovalError(message);
      toast.error("Visual approval was not persisted", { description: message });
    } finally {
      setVisualApprovalBusy(false);
    }
  };

  const rejectVisibleFinishRevision = async () => {
    if (!controlsEnabled || !displayedFinish || visualApproved || displayedFinishRejected || finishRejectionBusy) return;
    if (!finishRejectionClass) {
      toast.error("Choose why this revision is being rejected");
      return;
    }
    if (finishRejectionClass === "other" && !finishRejectionNote.trim()) {
      toast.error("Describe the problem before using Other");
      return;
    }
    setFinishRejectionBusy(true);
    setVisualApprovalError(null);
    try {
      await window.grudge.prompt3d.workflowRejectFinishVisual({
        source: { kind: "finish", jobId: displayedFinish.id },
        classification: finishRejectionClass,
        note: finishRejectionNote,
      });
      const current: Prompt3DFinishJobStatus = await window.grudge.prompt3d.finishStatus(displayedFinish.id);
      setFinishJobs((jobs) => upsertFinishJob(jobs, current));
      setFocusedFinishId(current.id);
      setModelPreviewState(null);
      setVisualInspection(null);
      setFinishRejectionClass("");
      setFinishRejectionNote("");
      if (displayedFinish.operation === "animation") {
        setAnimationMode("replace");
        setAnimationEditingAfterApprovalId(null);
      }
      toast.success(`${displayedFinish.operation === "animation" ? "Animation" : "Texture"} rejected`, {
        description: "The exact failed result and reason remain retained. Configure a replacement from its approved parent.",
      });
    } catch (error) {
      toast.error("The rejection was not retained", { description: String(error) });
    } finally {
      setFinishRejectionBusy(false);
    }
  };

  const approveConcept = async () => {
    if (!controlsEnabled || !job?.conceptAttempt || !conceptChecksAllPass) return;
    setBusy(true);
    try {
      const next: Prompt3DJobStatus = await window.grudge.prompt3d.approveConcept({
        jobId: job.id,
        binding: job.conceptAttempt.binding,
        inspection: { checks: conceptChecks as Prompt3DConceptInspectionChecks },
      });
      setJob(next);
      toast.success("Exact concept approval retained", { description: "Current GPU headroom is being rechecked before geometry." });
    } catch (error) { toast.error("Concept approval did not start geometry", { description: String(error) }); }
    finally { setBusy(false); }
  };

  const rejectConcept = async () => {
    if (!controlsEnabled || !job?.conceptAttempt || !conceptChecksComplete || !conceptChecksAnyFail || !conceptRejectionClass) return;
    if (conceptRejectionClass === "other" && !conceptRejectionNote.trim()) return;
    setBusy(true);
    try {
      const next: Prompt3DJobStatus = await window.grudge.prompt3d.rejectConcept({
        jobId: job.id,
        binding: job.conceptAttempt.binding,
        inspection: {
          checks: conceptChecks as Prompt3DConceptInspectionChecks,
          classification: conceptRejectionClass,
          ...(conceptRejectionNote.trim() ? { note: conceptRejectionNote.trim() } : {}),
        },
      });
      setJob(next);
      toast.message("Concept rejection retained", { description: "Choose a fresh seed or explicitly edit the brief; the rejected image and reason remain in lineage." });
    } catch (error) { toast.error("Concept rejection was not retained", { description: String(error) }); }
    finally { setBusy(false); }
  };

  const regenerateConcept = async () => {
    if (!controlsEnabled || !job) return;
    setBusy(true);
    try {
      const next: Prompt3DJobStatus = await window.grudge.prompt3d.regenerateConcept(job.id);
      setEditedConceptParent(null);
      setSpec(next.spec);
      setJob(next);
      toast.success(`One retained concept retry started · seed ${next.spec.seed}`);
    } catch (error) { toast.error("Concept retry did not start", { description: String(error) }); }
    finally { setBusy(false); }
  };

  const editPrompt = () => {
    if (!job?.conceptAttempt) return;
    const restoredSpec = editableSpec(job.spec);
    const clearedConflictingRules = restoredSpec !== job.spec;
    if (restoredSpec.seed >= 0x7fffffff) {
      toast.error("Choose a lower seed before editing this concept");
      return;
    }
    setSpec({ ...restoredSpec, seed: restoredSpec.seed + 1 });
    setInitialImageMode(initialImageModeForSpec(restoredSpec));
    setEditedConceptParent(job.id);
    setPlannerResult(null);
    requestAnimationFrame(() => {
      promptRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      promptRef.current?.focus();
    });
    toast.message(clearedConflictingRules ? "Conflicting object controls cleared" : "Retained brief restored", {
      description: clearedConflictingRules
        ? "The retained prompt excludes its saved object type. Review or re-enter manual controls, then generate a fresh-seed retained attempt."
        : "Approve the unchanged concept, or edit the brief and generate a fresh-seed retained attempt with explicit ancestry.",
    });
  };

  const cancelPromptEdit = () => {
    if (!job) return;
    setSpec(editableSpec(job.spec));
    setInitialImageMode(initialImageModeForSpec(job.spec));
    setEditedConceptParent(null);
    setPlannerResult(null);
  };

  const planFields = async () => {
    if (!controlsEnabled) return;
    setPlannerBusy(true);
    try {
      const planned: Prompt3DPlanResult = await window.grudge.prompt3d.plan({ currentSpec: spec });
      setSpec(planned.spec.prompt === spec.prompt ? planned.spec : applyPrompt3DEdit(planned.spec, planned.spec.prompt));
      setPlannerResult(planned.planner);
      toast.success("Local planning fields applied", { description: `Planner only · ${planned.planner.model}` });
    } catch (error) {
      toast.error("Local Ollama planner is unavailable", { description: String(error) });
    } finally {
      setPlannerBusy(false);
    }
  };

  const conceptMatchesCurrentDraft = Boolean(job?.conceptAttempt && conceptBindingMatchesSpec(job.conceptAttempt.binding, spec));
  const pendingConceptAllowsEditedAttempt = Boolean((awaitingConcept || conceptRejected) && editedConceptParent === job?.id && !conceptMatchesCurrentDraft);
  const freshSeedAllowsPreConceptRecovery = Boolean(conceptRejected && !job?.conceptAttempt && spec.seed !== job?.spec.seed);
  const specifiedReferences = spec.referenceImages ?? (spec.referenceImage ? [spec.referenceImage] : []);
  const selectedReferenceReady = referenceSetMatches(referenceSelections, specifiedReferences);
  const referenceCapability = selected?.manifest.referenceImages;
  const specifiedReferenceViews = specifiedReferences.map((reference, index) => reference.view ?? (index === 0 ? "front" : undefined));
  const referenceCapabilityError = initialImageMode === "select" && fourViewInput && specifiedReferences.length!==4 ? "Choose all four distinct views: front, left, right and rear/back." : specifiedReferences.length === 0
    ? null
    : !referenceCapability || spec.route !== referenceCapability.route
      ? "The selected provider route cannot consume every supplied image. Nothing will be discarded or substituted."
      : specifiedReferences.length < referenceCapability.minCount || specifiedReferences.length > referenceCapability.maxCount
        || specifiedReferenceViews.some((view) => !view || !referenceCapability.supportedViews.includes(view))
        || referenceCapability.requiredViews.some((view) => !specifiedReferenceViews.includes(view))
        ? `Choose ${referenceCapability.minCount}-${referenceCapability.maxCount} distinct ${referenceCapability.supportedViews.join("/")} views including ${referenceCapability.requiredViews.join("/")}.`
        : null;
  const inheritedReferenceReady = Boolean(editedConceptParent === job?.id
    && referenceSetMatches(job?.referenceImages ?? (job?.referenceImage ? [job.referenceImage] : []), specifiedReferences));
  const referenceReady = specifiedReferences.length === 0 || selectedReferenceReady || inheritedReferenceReady;
  const initialImageSourceReady = initialImageMode === "generate"
    ? specifiedReferences.length === 0
    : initialImageMode === "select" && specifiedReferences.length > 0 && referenceReady;
  const settingsError = prompt3DSettingsError(spec);
  const textureSettingsError = prompt3DFinishSettingsError(textureSeed);
  const animationSubject = classifyPrompt3DAnimationSubject(displayedFinish?.baseSpec ?? resultJob?.spec ?? spec);
  const hyMotionSubjectError = prompt3DHyMotionSubjectError(displayedFinish?.baseSpec ?? resultJob?.spec ?? spec);
  const animationSettingsError = prompt3DFinishSettingsError(animationSeed, animationDuration)
    ?? (animationProvider === "auto-cpu" ? promptedMotionCapabilityError(animationPrompt) : null)
    ?? (animationProvider === "hy-motion-1.0-lite" ? hyMotionSubjectError : null);
  const currentSaveError = workflowSaveError?.id === displayedFinish?.id ? workflowSaveError?.message : null;
  const canGenerate = Boolean(!settingsError && controlsEnabled && initialImageSourceReady && spec.prompt.trim() && !promptCompileError && referenceReady && !referenceCapabilityError && selected?.compliance.canRun && !busy && !plannerBusy && job?.state !== "running" && (!(awaitingConcept || conceptRejected) || pendingConceptAllowsEditedAttempt || freshSeedAllowsPreConceptRecovery) && !stricterReview);
  const requiredProviderIds: LocalPrompt3DProviderId[] = [spec.providerId === "trellis" ? "trellis" : "hunyuan3d-2"];
  const requiredProviders = requiredProviderIds.map((providerId) => providers.find((provider) => provider.manifest.id === providerId));
  const requiredProvidersInstalled = requiredProviders.every((provider) => provider?.install?.state === "installed"
    && provider.compliance.state !== "setup-required"
    && provider.compliance.state !== "unsupported");
  const motionProvider = providers.find((provider) => provider.manifest.id === "hy-motion-1");
  const motionProviderReady = motionProvider?.compliance.canRun === true && motionProvider.install?.state === "installed";
  const motionExecutionProfile = motionProvider?.compliance.executionProfile;
  const installOptionsRequired = !controlsReady || !controlsEnabled || !requiredProvidersInstalled;
  const existingBaseGeometryContinuationAvailable = Boolean(
    resultJob
      && result
      && resultJob.shapeRefinement !== true
      && geometryVisualApproved
      && resultVariantIndex === 0
      && !batchActive,
  );
  const acceptedBaseGeometryForTexture = Boolean(
    existingBaseGeometryContinuationAvailable
      && (acceptedBaseGeometryForTextureId === resultJob?.id
        || displayedFinish?.lineage.existingGeometryDecision?.generationJobId === resultJob?.id),
  );
  const useExistingGeneratedModelForTexture = () => {
    if (!resultJob || !existingBaseGeometryContinuationAvailable) return;
    localStorage.setItem(ACCEPTED_BASE_GEOMETRY_FOR_TEXTURE_KEY, resultJob.id);
    setAcceptedBaseGeometryForTextureId(resultJob.id);
    setTexturePrompt("");
    toast.success("Existing generated model selected", {
      description: "The exact approved Hunyuan geometry will be retained as the texture source. Shape refinement remains optional for this individual asset.",
    });
  };
  const approvedTextureRevisionCount = displayedLineage.filter((candidate) => candidate.operation === "texture" && exactPrompt3DVisualApproval(candidate.visualApproval, {
    assetId: candidate.assetId,
    jobId: candidate.id,
    stage: "texture",
    assetPath: candidate.assetPath,
    assetSha256: candidate.sha256,
    geometryHash: candidate.geometryHash,
  })).length;
  const approvedAnimationRevisionCount = displayedLineage.filter((candidate) => candidate.operation === "animation" && exactPrompt3DVisualApproval(candidate.visualApproval, {
    assetId: candidate.assetId,
    jobId: candidate.id,
    stage: "animation",
    assetPath: candidate.assetPath,
    assetSha256: candidate.sha256,
    geometryHash: candidate.geometryHash,
  })).length;
  const acceptedTextureForAnimation = Boolean(
    displayedFinish?.operation === "texture"
      && visualApproved
      && approvedTextureRevisionCount >= 1
      && acceptedTextureForAnimationId === displayedFinish.id,
  );
  const useApprovedTextureForAnimation = () => {
    if (!displayedFinish || displayedFinish.operation !== "texture" || !visualApproved || approvedTextureRevisionCount < 1) return;
    localStorage.setItem(ACCEPTED_TEXTURE_FOR_ANIMATION_KEY, displayedFinish.id);
    setAcceptedTextureForAnimationId(displayedFinish.id);
    setAnimationPrompt("");
    toast.success("Approved texture retained", {
      description: "The exact Hunyuan Paint GLB and its visual approval are already saved locally. Animation configuration is ready.",
    });
  };
  const returnToTextureRefinement = () => {
    localStorage.removeItem(ACCEPTED_TEXTURE_FOR_ANIMATION_KEY);
    setAcceptedTextureForAnimationId(null);
  };
  const continueEditingApprovedAnimation = () => {
    if (!displayedFinish || displayedFinish.operation !== "animation" || !visualApproved) return;
    setAnimationEditingAfterApprovalId(displayedFinish.id);
    setAnimationPrompt("");
  };
  const finishWithApprovedAnimation = () => {
    setAnimationEditingAfterApprovalId(null);
  };
  const rigReviewJob = latestFinishStatus?.rigReview ? latestFinishStatus : null;
  const openRigReview = async () => {
    if (!rigReviewJob?.rigReview) return;
    sessionStorage.setItem("grudge.skeleton.pendingPath", rigReviewJob.rigReview.sourcePath);
    sessionStorage.setItem("grudge.skeleton.prompt3dContext", JSON.stringify({
      sourcePath: rigReviewJob.rigReview.sourcePath,
      sourceSha256: rigReviewJob.rigReview.sourceSha256,
      finishJobId: rigReviewJob.id,
      sourceJobId: rigReviewJob.source.kind === "finish" ? rigReviewJob.source.jobId : undefined,
      spec: rigReviewJob.baseSpec,
      instruction: rigReviewJob.instruction,
      suggestedPlacements: rigReviewJob.rigReview.suggestedPlacements,
      seed: rigReviewJob.seed,
      animation: { provider: animationProvider, mode: animationMode, ...(animationProvider === "local-animation-library" ? { libraryPackDir: animationLibraryPackDir } : {}), ...(animationDuration.trim() && !prompt3DFinishSettingsError("", animationDuration) ? { duration: Number(animationDuration) } : {}) },
    }));
    await window.grudge.app.openRoute("/skeleton");
  };
  type CreationStage = "source" | "prompt" | "generating" | "concept-review" | "geometry-review" | "texture-prompt" | "texture-review" | "animation-prompt" | "animation-review" | "save";
  const creationStage: CreationStage = !job && busy
    ? "generating"
    : job?.state === "queued" || job?.state === "running"
      ? "generating"
      : editedConceptParent
        ? "prompt"
        : awaitingConcept || conceptRejected
        ? "concept-review"
        : !resultJob || !result
          ? !job && initialImageMode === "choose" ? "source" : "prompt"
          : activeFinish
            ? "generating"
            : !displayedFinish
              ? geometryVisualApproved && (resultJob.shapeRefinement === true || acceptedBaseGeometryForTexture) ? "texture-prompt" : "geometry-review"
               : displayedFinish.operation === "texture"
                ? displayedFinishRejected
                  ? "texture-prompt"
                  : visualApproved
                  ? approvedTextureRevisionCount >= 2 || acceptedTextureForAnimation ? "animation-prompt" : "texture-prompt"
                  : "texture-review"
                : displayedFinishRejected
                  ? "animation-prompt"
                  : visualApproved
                  ? animationEditingAfterApprovalId === displayedFinish.id ? "animation-prompt" : "save"
                  : "animation-review";
  const stageTitle: Record<CreationStage, string> = {
    source: "Choose the starting image source",
    prompt: "Prompt, dimensions and generation settings",
    generating: "Generating the current revision",
    "concept-review": "Review and approve the Hunyuan concept",
    "geometry-review": "Review, approve or refine the geometry",
    "texture-prompt": approvedTextureRevisionCount > 0 ? "Refine the texture prompt and seed" : "Texture prompt and seed",
    "texture-review": "Review and approve the texture",
    "animation-prompt": approvedAnimationRevisionCount > 0 ? "Refine or append animation" : "Animation prompt and settings",
    "animation-review": "Play, review and approve the animation",
    save: "Save, export and reopen",
  };
  const focusBatchApproval = useCallback((jobId: string | null) => {
    if (!jobId) return;
    void (async () => {
      try {
        const next: Prompt3DJobStatus = await window.grudge.prompt3d.status(jobId);
        setFocusedFinishId(null);
        setSelectedVariant(0);
        setJob(next);
        setSpec(editableSpec(next.spec));
        setInitialImageMode(initialImageModeForSpec(next.spec));
        if (next.state === "complete" && next.variants.some((variant) => variant.report.gameReady)) setPreviousResult(next);
        return;
      } catch {
        // A batch visual gate can point to a finishing revision instead.
      }

      try {
        const next: Prompt3DFinishJobStatus = await window.grudge.prompt3d.finishStatus(jobId);
        let jobs = upsertFinishJob(finishJobsRef.current, next);
        let root = rootGenerationSource(next, new Map(jobs.map((candidate) => [candidate.id, candidate])));
        if (!root) {
          const history: Prompt3DFinishHistory = await window.grudge.prompt3d.finishHistory();
          jobs = upsertFinishJob(history.jobs, next);
          root = rootGenerationSource(next, new Map(jobs.map((candidate) => [candidate.id, candidate])));
        }
        if (!root || root.kind !== "generation") throw new Error("The retained generation ancestor for this finishing approval is unavailable.");
        finishJobsRef.current = jobs;
        setFinishJobs(jobs);
        setFocusedFinishId(next.id);
        const generation: Prompt3DJobStatus = await window.grudge.prompt3d.status(root.jobId);
        setSelectedVariant(root.variantIndex ?? 0);
        setJob(generation);
        setSpec(editableSpec(generation.spec));
        setInitialImageMode(initialImageModeForSpec(generation.spec));
        if (generation.state === "complete" && generation.variants.some((variant) => variant.report.gameReady)) setPreviousResult(generation);
      } catch (error) {
        toast.error("Could not open the batch revision awaiting approval", { description: String(error) });
      }
    })();
  }, []);

  return (
    <div className="space-y-4 pb-5 text-fg">
      <header>
        <div className="flex items-center gap-2"><WandSparkles className="text-gold" size={22} /><h1 className="page-title mb-0">Prompt to 3D</h1></div>
        <p className="page-sub mb-0 mt-1 max-w-4xl text-sm">One retained workflow for local geometry, visual approval, refinement, texture, CPU-first animation, saving and export.</p>
      </header>

      {installOptionsRequired && <section data-panel="install-options" className={`${card} p-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-semibold"><Download className="mr-2 inline text-gold" size={17} />Install Options</h2><p className="mt-1 text-xs text-muted">This section disappears when the explicitly selected local generator and local controls are ready.</p></div>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 rounded border border-gold/40 bg-gold/5 px-3 py-2 text-xs text-gold"><input type="checkbox" checked={controlsEnabled} disabled={!controlsReady || controlsSaving} onChange={(event) => void changeControls(event.target.checked)} />Enable local controls</label>
            <button className="rounded border border-line px-3 py-2 text-xs" onClick={() => void refresh()}><RefreshCw className="mr-1 inline" size={13} />Recheck</button>
          </div>
        </div>
        {!overview && <p className="mt-3 text-xs text-muted"><Loader2 className="mr-2 inline animate-spin" size={13} />Checking the selected local generator…</p>}
        {overview && <div className="mt-3 grid gap-3">
          <div className="grid gap-2 rounded border border-line bg-bg p-3 text-[11px] text-muted sm:grid-cols-3">
            <div><b className="text-fg">GPU</b><br />{overview.hardware.gpu?.model ?? "Not detected"}<br />{bytes(overview.hardware.gpu?.freeVramBytes ?? 0)} free VRAM</div>
            <div><b className="text-fg">Generator storage</b><br /><span className="break-all font-mono">{overview.runtime.root}</span><br />{bytes(overview.hardware.disk.freeBytes)} free</div>
            <div><b className="text-fg">Local runtime</b><br />{overview.hardware.wsl.usableLinuxDistribution ?? "WSL setup required"}<br />GPU or genuine CPU fallback · no cloud</div>
          </div>
          {localProviders.filter((row) => requiredProviderIds.includes(row.manifest.id as LocalPrompt3DProviderId)).map((row) => {
            const manifest = row.manifest;
            const compliance = row.compliance;
            const providerId = manifest.id as LocalPrompt3DProviderId;
            const status = installStates[providerId] ?? row.install;
            const primaryAction = status?.state === "installed" || status?.state === "repair-needed" ? "repair" : "install";
            return <div key={providerId} className="rounded border border-line bg-bg p-3">
              <div className="flex items-start justify-between gap-2"><div><b>{manifest.name}</b><p className="mt-1 text-xs text-muted">{manifest.role === "motion" ? "Pinned official skeletal motion model and local Mixamo-25 compatible skin binding." : "Pinned local concept, geometry and Hunyuan Paint components."} Estimated download {bytes(manifest.downloadBytes)}.</p></div><span className={`rounded-full border px-2 py-1 text-[10px] ${stateStyle[compliance.state]}`}>{stateLabel[compliance.state]}</span></div>
              <p className="mt-2 text-[11px] text-muted">{compliance.reasons.join(" ")}</p>
              {compliance.executionProfile && <p className="mt-2 rounded border border-sky-500/30 bg-sky-500/5 p-2 text-[11px] text-sky-100"><b>Automatic hardware profile:</b> {compliance.executionProfile.label}<br /><span className="text-muted">{compliance.executionProfile.tradeoff}</span></p>}
              {status && <div className="mt-2 text-[11px] text-muted"><div className="flex justify-between"><span className="capitalize">{status.state.replace("-", " ")} · {status.stage}</span><span>{status.progress}%</span></div><div className="mt-1 h-1.5 rounded bg-line"><div className="h-full rounded bg-gold" style={{ width: `${status.progress}%` }} /></div></div>}
              <label className="mt-3 flex items-start gap-2 text-[11px] text-muted"><input type="checkbox" checked={Boolean(accepted[providerId])} onChange={(event) => setAccepted((current) => ({ ...current, [providerId]: event.target.checked }))} /><span>I reviewed the pinned source, destination, download and {manifest.licenseName} license.</span></label>
              <div className="mt-3 flex flex-wrap gap-2"><button disabled={!controlsEnabled || !accepted[providerId] || !compliance.canInstall || status?.state === "installing" || busy} className="rounded bg-gold px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-35" onClick={() => void install(providerId, primaryAction)}>{status?.state === "installed" ? "Repair / verify" : `Install ${manifest.name}`}</button>{status?.state === "installing" && <button className="rounded border border-line px-3 py-1.5 text-xs" onClick={() => window.grudge.prompt3d.cancelInstall(providerId)}>Cancel</button>}<button disabled={!controlsEnabled || batchActive} className="rounded border border-line px-3 py-1.5 text-xs disabled:opacity-35" onClick={async () => { if (await window.grudge.prompt3d.chooseRoot()) void refresh(); }}><FolderOpen className="mr-1 inline" size={13} />Choose default location</button></div>
            </div>;
          })}
        </div>}
      </section>}

      <section data-panel="creation" className={`${card} min-w-0 p-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
          <div><p className="text-[10px] uppercase tracking-widest text-gold">Current creation stage</p><h2 className="mt-1 font-semibold">{stageTitle[creationStage]}</h2><p className="mt-1 text-xs text-muted">{creationStage === "generating" ? "Working on the current stage" : `Stage ${(["source", "prompt", "concept-review", "geometry-review", "texture-prompt", "texture-review", "animation-prompt", "animation-review", "save"] as CreationStage[]).indexOf(creationStage) + 1} of 9`} · earlier results stay in lineage and Local Files, outside the live preview.</p></div>
          <button type="button" disabled={busy || finishing || batchActive} className="rounded border border-line px-3 py-2 text-xs disabled:opacity-35" onClick={startNewRootWorkflow}><RefreshCw className="mr-1 inline" size={12} />Start new asset</button>
        </div>

        {currentRunStatus && (creationStage === "generating" || currentRunStatus.state === "failed" || currentRunStatus.state === "cancelled") && <div className="mt-3">
          <div className="flex justify-between text-xs"><span className="capitalize">{currentRunStatus.stage} · {currentRunStatus.message}</span><span>{currentRunStatus.progress}%</span></div><div className="mt-2 h-2 rounded bg-line"><div className="h-full rounded bg-gold" style={{ width: `${currentRunStatus.progress}%` }} /></div>
          {currentRunStatus.executionProfile && <p className="mt-2 rounded border border-sky-500/30 bg-sky-500/5 p-2 text-[11px] text-sky-100"><b>Automatic hardware profile:</b> {currentRunStatus.executionProfile.label}<br /><span className="text-muted">{currentRunStatus.executionProfile.tradeoff}</span></p>}
          <div className="mt-3 flex gap-2">{activeFinish && <button className="rounded border border-line px-3 py-2 text-xs" onClick={() => void cancelFinish()}>Cancel finishing attempt</button>}{!activeFinish && job && (job.state === "queued" || job.state === "running") && <button className="rounded border border-line px-3 py-2 text-xs" onClick={() => window.grudge.prompt3d.cancel(job.id)}>Cancel</button>}{!activeFinish && job && (job.state === "failed" || job.state === "cancelled") && !conceptRejected && <button className="rounded border border-line px-3 py-2 text-xs" onClick={() => window.grudge.prompt3d.retry(job.id)}>Retry current attempt</button>}</div>
        </div>}
        {rigReviewJob?.rigReview && <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
          <b>Skeleton Studio correction required</b>
          <p className="mt-1 text-[11px] text-muted">{rigReviewJob.rigReview.reason}</p>
          <button type="button" className="mt-2 rounded border border-amber-300/50 px-3 py-2 font-semibold" onClick={() => void openRigReview()}>Review fitted skeleton and place markers</button>
        </div>}
        {!currentRunStatus && creationStage === "generating" && <p className="mt-3 text-sm text-muted"><Loader2 className="mr-2 inline animate-spin" size={16} />Submitting the current Hunyuan revision. The previous preview has been cleared.</p>}

        {creationStage === "source" && <div data-testid="prompt3d-initial-image-source" className="mt-4 space-y-4">
          <p className="text-sm text-muted">Choose a starting point. The next screen asks for your subject or images.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" disabled={busy || batchActive} className="rounded border border-gold/50 bg-gold/5 p-5 text-left transition hover:bg-gold/10 disabled:opacity-35" onClick={beginGeneratedImage}><WandSparkles className="mb-3 text-gold" size={26} /><b className="block text-base">Prompt only</b><span className="mt-2 block text-xs text-muted">Enter a subject prompt next. Local HunyuanDiT will generate the concept image before Hunyuan creates geometry.</span></button>
            <button type="button" disabled={!controlsEnabled || busy || batchActive} className="rounded border border-sky-500/50 bg-sky-500/5 p-5 text-left transition hover:bg-sky-500/10 disabled:opacity-35" onClick={() => void chooseBoundView("front",true)}><ImagePlus className="mb-3 text-sky-300" size={26} /><b className="block text-base">One image</b><span className="mt-2 block text-xs text-muted">Choose a front image for the local single-image model.</span></button>
            <button type="button" disabled={!controlsEnabled||busy||batchActive} className="rounded border border-sky-500/50 p-5 text-left disabled:opacity-35" onClick={beginFourViews}><ImagePlus className="mb-3 text-sky-300" size={26}/><b className="block text-base">Four views</b><span className="mt-2 block text-xs text-muted">Add front, left, right and rear/back individually. Each file stays bound to its labelled role.</span></button>
          </div>
          {!controlsEnabled && <p className="text-xs text-amber-200">Enable local controls in Install Options to select files from this computer.</p>}
        </div>}

        {creationStage === "prompt" && <div className="mt-4 space-y-3">
          {!editedConceptParent && <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-line bg-bg p-3 text-xs"><span><b>Starting image:</b> {initialImageMode === "select" ? `${specifiedReferences.length} selected local ${specifiedReferences.length === 1 ? "image" : "images"}` : "Generate with local HunyuanDiT"}</span><button type="button" disabled={busy || batchActive} className="rounded border border-line px-3 py-1.5" onClick={returnToInitialImageChoice}>Change starting image</button></div>}
          {autosaveError && <p role="alert" className="text-xs text-red-300">{autosaveError}</p>}
          <fieldset disabled={conceptReviewLocked} className="space-y-3 disabled:opacity-60">
            <label className="block text-xs text-muted">Subject prompt<textarea ref={promptRef} className={`${input} mt-1 min-h-28 resize-y`} value={spec.prompt} maxLength={2000} placeholder="Describe one complete subject and every part that should be present" onChange={(event) => { setSpec((current) => applyPrompt3DEdit({ ...current, orchestration: undefined }, event.target.value)); setPlannerResult(null); }} /></label>
            <div className="rounded border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-sky-100"><b>Standard game-asset baseline</b><p className="mt-1 text-sky-100/80">One complete subject, centered, broad margins, plain white background, neutral lighting, isolated game-ready form. Describe only features that should be present. Avoid “do not”, “without”, and negative object lists; the compiler supplies the absence rules separately so Hunyuan cannot mistake them for requested objects.</p></div>
            {promptCompileError && <p role="alert" data-testid="prompt3d-brief-compile-error" className="rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200">{promptCompileError}</p>}
            {initialImageMode === "select" && <div className="rounded border border-line bg-bg p-3 text-xs">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><b>{fourViewInput?"Four labelled Hunyuan views":"Supplied Hunyuan image"}</b><p className="mt-1 text-[11px] text-muted">PNG, JPEG and WebP. One image uses the single-image model; four distinct files use the official multiview checkpoint.</p></div>
                <div className="flex gap-2"><button type="button" disabled={busy || batchActive || Boolean(editedConceptParent)} className="rounded border border-line px-3 py-1.5" onClick={()=>fourViewInput?beginFourViews():void chooseBoundView("front",true)}><ImagePlus className="mr-1 inline" size={13} />Replace images</button>{specifiedReferences.length > 0 && <button type="button" className="rounded border border-line px-3 py-1.5" onClick={clearReferenceImages}>Clear</button>}</div>
              </div>
              {fourViewInput&&<div className="my-3 grid gap-2">{(["front","left","right","back"] as const).map((view,index,views)=>{const chosen=specifiedReferences.find(r=>r.view===view),next=views.find(v=>!specifiedReferences.some(r=>r.view===v));return <button key={view} disabled={busy||batchActive||(!chosen&&view!==next)} className="rounded border border-line px-3 py-2 text-left disabled:opacity-35" onClick={()=>void chooseBoundView(view)}>{chosen?"Replace":"Choose"} {view==="back"?"rear/back":view} image{chosen?` · ${chosen.originalName}`:""}</button>;})}</div>}
              {specifiedReferences.length > 0 && <div className="mt-2 grid gap-2 sm:grid-cols-2">{specifiedReferences.map((image, index) => {
                const selectedPreview = referenceSelections.find((selection) => selection.view === image.view && selection.sha256 === image.sha256);
                const retainedPreview = (job?.referenceImages ?? (job?.referenceImage ? [job.referenceImage] : []))
                  .find((reference) => reference.view === image.view && reference.sha256 === image.sha256);
                const previewPath = selectedPreview?.sourcePath ?? retainedPreview?.path;
                return <div key={`${image.view}:${image.sha256}`} className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-2 rounded border border-line/60 p-2 text-[10px] text-muted">
                  <div className="h-14 w-14 overflow-hidden rounded border border-line bg-white">{previewPath
                    ? <img className="h-full w-full object-contain" src={`grudge-media://local/?path=${encodeURIComponent(previewPath)}&sha=${encodeURIComponent(image.sha256)}`} alt={`${image.view ?? "front"} reference ${image.originalName}`} />
                    : <div className="flex h-full items-center justify-center text-[9px] uppercase text-bg">{image.view ?? "front"}</div>}</div>
                  <div className="min-w-0"><b className="uppercase text-fg">{image.view==="back"?"rear/back":image.view??"front"}</b><p className="mt-1 truncate" title={image.originalName}>{image.originalName} · {image.width} × {image.height}</p><p className="mt-0.5 font-mono" title={image.sha256}>SHA-256 {image.sha256.slice(0,12)}…</p></div>
                </div>;
              })}</div>}
              {specifiedReferences.length > 0 && referenceCapability && <p className="mt-2 text-[10px] text-sky-200">Automatic native route: one view uses {referenceCapability.singleViewModelId}; {referenceCapability.multiViewMinCount}-{referenceCapability.maxCount} views use {referenceCapability.multiViewModelId}. Unsupported sets fail closed.</p>}
              {referenceCapabilityError && <p role="alert" className="mt-2 text-[10px] text-red-300">{referenceCapabilityError}</p>}
            </div>}
            <p className="text-xs text-muted" data-testid="prompt3d-settings-summary">{spec.category} · {spec.style} · {spec.dimensions.width} × {spec.dimensions.height} × {spec.dimensions.depth} {spec.dimensions.unit} · seed {spec.seed}</p>
            <details className="rounded border border-line bg-bg p-3" data-testid="prompt3d-optional-settings"><summary className="cursor-pointer text-xs text-gold">Optional size, style and quality settings</summary><div className="mt-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-muted">Category<select className={`${input} mt-1`} value={spec.category} onChange={(event) => setSpec((current) => ({ ...current, category: event.target.value as AssetCategory, objectRules: undefined }))}><option value="prop">prop</option><option value="building">building</option><option value="road-furniture">road furniture</option><option value="environment">environment</option><option value="character" disabled={spec.providerId !== "hunyuan3d-2"}>character / creature</option></select></label><label className="text-xs text-muted">Style<select className={`${input} mt-1`} value={spec.style} onChange={(event) => patchSpec("style", event.target.value as AssetSpecV1["style"])}>{["realistic", "stylized", "low-poly", "hand-painted", "industrial", "custom"].map((value) => <option key={value}>{value}</option>)}</select></label></div>
            <div className="grid grid-cols-4 gap-2"><label className="text-xs text-muted">Width<Prompt3DNumberInput min="0.001" max="10000" step="any" className={`${input} mt-1`} value={spec.dimensions.width} onValueChange={(value) => patchSpec("dimensions", { ...spec.dimensions, width: value })} /></label><label className="text-xs text-muted">Height<Prompt3DNumberInput min="0.001" max="10000" step="any" className={`${input} mt-1`} value={spec.dimensions.height} onValueChange={(value) => patchSpec("dimensions", { ...spec.dimensions, height: value })} /></label><label className="text-xs text-muted">Depth<Prompt3DNumberInput min="0.001" max="10000" step="any" className={`${input} mt-1`} value={spec.dimensions.depth} onValueChange={(value) => patchSpec("dimensions", { ...spec.dimensions, depth: value })} /></label><label className="text-xs text-muted">Units<select className={`${input} mt-1`} value={spec.dimensions.unit} onChange={(event) => patchSpec("dimensions", { ...spec.dimensions, unit: event.target.value as "m" | "cm" })}><option value="m">metres</option><option value="cm">cm</option></select></label></div>
            <div className="grid gap-3 sm:grid-cols-3"><label className="text-xs text-muted">Seed<Prompt3DNumberInput min="0" max="2147483647" step="1" className={`${input} mt-1`} value={spec.seed} onValueChange={(value) => patchSpec("seed", value)} /></label><label className="text-xs text-muted">Triangle budget<Prompt3DNumberInput className={`${input} mt-1`} min={100} max={2_000_000} value={spec.budgets.maxTriangles} onValueChange={(value) => patchSpec("budgets", { ...spec.budgets, maxTriangles: value })} /></label><label className="text-xs text-muted">Texture maximum<select className={`${input} mt-1`} value={spec.budgets.maxTextureResolution} onChange={(event) => patchSpec("budgets", { ...spec.budgets, maxTextureResolution: Number(event.target.value) as AssetSpecV1["budgets"]["maxTextureResolution"] })}>{textureResolutions.map((value) => <option key={value} value={value}>{value} × {value}</option>)}</select></label></div>
            {spec.style === "custom" && <label className="block text-xs text-muted">Custom style<input className={`${input} mt-1`} maxLength={200} value={spec.customStyle ?? ""} onChange={(event) => patchSpec("customStyle", event.target.value)} /></label>}
            </div></details>
            {settingsError && <p role="alert" className="text-xs text-red-300">{settingsError} Open optional settings to correct it.</p>}
            <details className="rounded border border-line bg-bg p-3"><summary className="cursor-pointer text-xs text-gold">Optional advanced planning, shape, pivot and generation settings</summary><div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" disabled={!controlsEnabled || plannerBusy || !spec.prompt.trim()} className="rounded border border-line px-3 py-2 text-xs disabled:opacity-35" onClick={() => void planFields()}>{plannerBusy ? "Planning with Grudge AI…" : "Plan fields with Grudge AI"}</button><span className="text-[11px] text-muted">Explicit loopback-only schema planning with the existing grudge-dev preference; no start, pull, install or fallback.</span></div>{plannerResult && <p className="mt-2 text-[11px] text-sky-200">Applied {plannerResult.model} · {plannerResult.summary}</p>}<div className="mt-3"><Prompt3DRulesPanel spec={spec} onChange={(objectRules) => patchSpec("objectRules", objectRules)} /></div><div className="mt-3 flex flex-wrap gap-4 text-xs"><label><input type="checkbox" checked={spec.generateCollision} onChange={(event) => patchSpec("generateCollision", event.target.checked)} /> Collision</label><label><input type="checkbox" checked={spec.generateLods} onChange={(event) => patchSpec("generateLods", event.target.checked)} /> LODs</label></div></details>
            <button disabled={!canGenerate} className="w-full rounded bg-gold px-4 py-2 text-sm font-semibold text-black disabled:opacity-35" onClick={() => void generate()}><Play className="mr-2 inline" size={15} />{spec.providerId === "trellis" ? "Generate with TRELLIS" : specifiedReferences.length > 0 ? "Prepare reference-conditioned concept" : "Generate Hunyuan concept"}</button>
          </fieldset>
          <details className="border-t border-line pt-3"><summary className="cursor-pointer text-xs text-muted">Optional serial batch</summary><Prompt3DBatchPanel currentSpec={spec} disabled={!controlsEnabled || busy || finishing} onLoadQueuedSpec={setSpec} onAwaitingApprovalJobChange={focusBatchApproval} onBatchStatusChange={setBatchStatus} /></details>
        </div>}

        {creationStage === "concept-review" && job?.conceptAttempt && <div className="mt-4 space-y-3">
          <label className="flex items-start gap-2 rounded border border-line bg-bg p-3 text-xs"><input type="checkbox" checked={conceptChecksAllPass} disabled={!awaitingConcept || busy || loadedConceptPath !== job.conceptImagePath} onChange={(event) => setConceptChecks(event.target.checked ? Object.fromEntries(conceptCheckRows.map((row) => [row.key, "pass"])) as ConceptCheckDraft : emptyConceptChecks())} /><span>I inspected this concept: identity and required parts, subject presentation, framing and background all match the request.</span></label>
          <details className="rounded border border-line p-3"><summary className="cursor-pointer text-xs text-muted">Inspect individual checks or report a problem</summary>
          <div className="grid gap-2">{conceptCheckRows.map((row) => <div key={row.key} className="flex items-center justify-between gap-3 rounded border border-line bg-bg p-3"><span className="text-xs"><b>{row.title}</b><span className="mt-1 block text-[10px] text-muted">{row.detail}</span></span><span className="flex gap-1">{(["pass", "fail"] as const).map((verdict) => <button key={verdict} disabled={!awaitingConcept || busy} className={`rounded border px-2 py-1 text-[10px] uppercase disabled:opacity-35 ${conceptChecks[row.key] === verdict ? verdict === "pass" ? "border-emerald-400 bg-emerald-500/20 text-emerald-200" : "border-red-400 bg-red-500/20 text-red-200" : "border-line text-muted"}`} onClick={() => setConceptChecks((current) => ({ ...current, [row.key]: verdict }))}>{verdict}</button>)}</span></div>)}</div></details>
          {effectivePresentation && <p className="rounded border border-line bg-bg p-3 text-[11px] text-muted"><b className="text-fg">Effective presentation:</b> one complete primary subject · {effectivePresentation.background.mode} background · {effectivePresentation.support.mode} support · {effectivePresentation.scenery.mode} scenery · {effectivePresentation.framing}. Treat any extra stand, scenery, duplicate subject, missing required part, or negation inversion as a failure.</p>}
          {awaitingConcept && conceptChecksAnyFail && <div className="grid gap-2"><label className="text-xs text-muted">Failure classification<select className={`${input} mt-1`} value={conceptRejectionClass} onChange={(event) => setConceptRejectionClass(event.target.value as Prompt3DConceptRejectionClassification | "")}><option value="">Choose…</option><option value="presentation">Presentation or framing</option><option value="semantic-anatomy-parts">Identity, anatomy or required parts</option><option value="prompt-negation-misunderstanding">Hunyuan prompt or negation misunderstanding</option><option value="other">Other</option></select></label><label className="text-xs text-muted">Affirmative correction note<textarea className={`${input} mt-1 min-h-16`} value={conceptRejectionNote} maxLength={500} onChange={(event) => setConceptRejectionNote(event.target.value)} placeholder="State what the next concept should show; avoid repeating unwanted objects" /></label></div>}
          <div className="flex flex-wrap gap-2">{awaitingConcept && <button disabled={busy || !reviewProvider?.compliance.canRun || !conceptMatchesCurrentDraft || !conceptChecksAllPass || !effectivePresentation || job.conceptAttempt.technicalReview.status !== "pass" || loadedConceptPath !== job.conceptImagePath} className="rounded bg-gold px-3 py-2 text-xs font-semibold text-black disabled:opacity-35" onClick={() => void approveConcept()}>Approve concept for geometry</button>}{awaitingConcept && <button disabled={busy || !conceptChecksComplete || !conceptChecksAnyFail || !conceptRejectionClass || (conceptRejectionClass === "other" && !conceptRejectionNote.trim()) || loadedConceptPath !== job.conceptImagePath} className="rounded border border-red-500/50 px-3 py-2 text-xs text-red-200 disabled:opacity-35" onClick={() => void rejectConcept()}>Reject and retain reason</button>}{conceptRejected && <button disabled={busy || !reviewProvider?.compliance.canRun} className="rounded border border-line px-3 py-2 text-xs disabled:opacity-35" onClick={() => void regenerateConcept()}>Regenerate with fresh seed</button>}{conceptRejected && <button className="rounded border border-line px-3 py-2 text-xs" onClick={editPrompt}>Edit brief</button>}</div>
        </div>}

        {creationStage === "geometry-review" && result && resultJob && <div className="mt-4 space-y-3">
          <p className="text-xs text-muted">{resultJob.providerId === "trellis" ? "Inspect the exact TRELLIS geometry in the preview. Approval retains this generated revision for reopen or an explicit local Forge handoff; it does not silently switch to Hunyuan Paint." : "Inspect the current geometry in the preview. After approving a correct base result, either use it as-is for texturing or describe an affirmative shape refinement. If the geometry is wrong, leave it unapproved and generate a correction."}</p>
          {resultJob.providerId === "hunyuan3d-2" && geometryVisualApproved && resultJob.shapeRefinement !== true && <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-100">
            <p>The exact approved Hunyuan model can continue directly to texture. Refinement remains available, but is required only by the separate strict acceptance batch.</p>
            <button type="button" disabled={!existingBaseGeometryContinuationAvailable} className="mt-2 rounded border border-emerald-400/50 px-3 py-2 font-semibold disabled:opacity-35" onClick={useExistingGeneratedModelForTexture}><Palette className="mr-1 inline" size={13} />Use the existing generated model</button>
          </div>}
          {resultJob.providerId === "trellis" && geometryVisualApproved && <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-100"><b>Exact TRELLIS revision retained</b><p className="mt-1 text-[11px] text-muted">The local generation history can reopen this result. Forge can create a separate saved refinement; the source GLB remains immutable.</p><button type="button" className="mt-2 rounded border border-emerald-400/50 px-3 py-2 font-semibold" onClick={async () => { sessionStorage.setItem("grudge.forge.pendingLocalPath", result.glbPath); sessionStorage.setItem("grudge.prompt3d.contextualHandoff", JSON.stringify({ version: 1, route: "forge-local", prompt: spec.prompt, revision: `${resultJob.id} · SHA-256 ${result.sha256}`, orchestration: spec.orchestration })); await window.grudge.app.openRoute("/forge-local"); }}>Open exact TRELLIS result in Forge</button></div>}
          {resultJob.providerId === "hunyuan3d-2" && <><textarea className={`${input} min-h-24 resize-y`} maxLength={1500} value={shapeRefinement} onChange={(event) => setShapeRefinement(event.target.value)} placeholder="Describe the required silhouette, proportions, topology and parts in affirmative language" />
          <button disabled={busy || finishing || !result.report.gameReady || !canPromptShapeRefinement || !shapeRefinement.trim()} className="rounded bg-gold px-3 py-2 text-xs font-semibold text-black disabled:opacity-35" onClick={() => void refineShape()}><WandSparkles className="mr-1 inline" size={13} />{canStartFreshGeometryCorrection ? "Generate fresh corrected geometry" : canCorrectRejectedGeometry ? "Correct rejected refinement" : "Generate refined Hunyuan shape"}</button></>}
        </div>}

        {(creationStage === "texture-prompt" || creationStage === "texture-review") && <div className="mt-4 space-y-3">
          <p className="text-xs text-muted">{creationStage === "texture-review" ? "Inspect material coverage in the preview, then explicitly approve or reject this exact result." : displayedFinishRejected ? "The rejected texture is retained but hidden. Describe the corrected material result to generate from its exact approved parent." : approvedTextureRevisionCount ? "The approved Hunyuan Paint result is already saved locally. Refine it for strict acceptance, or retain it and continue to animation configuration." : "Describe any texture result you want. Every non-empty request is admitted to a best-effort Hunyuan Paint run; capability and technical output checks still apply."}</p>
          {creationStage === "texture-review" && displayedFinish && <div className="grid gap-2 rounded border border-red-500/30 bg-red-500/5 p-3"><label className="text-xs text-muted">Why is this texture wrong?<select className={`${input} mt-1`} value={finishRejectionClass} onChange={(event) => setFinishRejectionClass(event.target.value as Prompt3DFinishVisualRejectionClassification | "")}><option value="">Choose…</option><option value="appearance-mismatch">Material coverage or appearance</option><option value="prompt-negation-misunderstanding">Prompt or negation misunderstood</option><option value="other">Other</option></select></label><label className="text-xs text-muted">Optional rejection note<textarea className={`${input} mt-1 min-h-16`} maxLength={500} value={finishRejectionNote} onChange={(event) => setFinishRejectionNote(event.target.value)} placeholder="State what visibly failed; required when Other is selected" /></label><button disabled={finishRejectionBusy || !finishRejectionClass || (finishRejectionClass === "other" && !finishRejectionNote.trim())} className="w-fit rounded border border-red-500/60 px-3 py-2 text-xs font-semibold text-red-200 disabled:opacity-35" onClick={() => void rejectVisibleFinishRevision()}><XCircle className="mr-1 inline" size={13} />Reject texture and configure replacement</button></div>}
          {creationStage === "texture-prompt" && <>{textureSettingsError && <p role="alert" className="text-xs text-red-300">{textureSettingsError}</p>}<textarea aria-label="Texture prompt" className={`${input} min-h-24 resize-y`} maxLength={2000} value={texturePrompt} onChange={(event) => setTexturePrompt(event.target.value)} placeholder="Describe materials, colors, markings, wear and surface finish" /><div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><details className="rounded border border-line p-2"><summary className="cursor-pointer text-xs text-muted">Optional texture seed{textureSeed ? ` · ${textureSeed}` : " · automatic"}</summary><label className="text-xs text-muted">Texture seed<input type="text" inputMode="numeric" maxLength={32} className={`${input} mt-1`} value={textureSeed} onChange={(event) => setTextureSeed(event.target.value)} placeholder="Automatic" /></label></details><button disabled={Boolean(textureSettingsError) || finishing || !result?.report.gameReady || !textureSourceApproved || !texturePrompt.trim() || (textureRecoveryNeeded && !textureRecoveryAvailable)} className="self-end rounded bg-gold px-3 py-2 text-xs font-semibold text-black disabled:opacity-35" onClick={() => void startFinish("texture")}><Palette className="mr-1 inline" size={13} />{textureRecoveryAvailable ? "Generate corrected texture" : approvedTextureRevisionCount ? "Generate refined texture" : "Apply Hunyuan texture"}</button></div></>}
          {creationStage === "texture-prompt" && approvedTextureRevisionCount > 0 && <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-100">
            <p>The exact approved texture and provenance are retained. This manual continuation does not satisfy the separate strict batch requirement for a second texture prompt.</p>
            <button type="button" className="mt-2 rounded border border-emerald-400/50 px-3 py-2 font-semibold" onClick={useApprovedTextureForAnimation}><Film className="mr-1 inline" size={13} />Use approved texture and configure animation</button>
          </div>}
        </div>}

        {(creationStage === "animation-prompt" || creationStage === "animation-review") && <div className="mt-4 space-y-3">
          <p className="text-xs text-muted">{creationStage === "animation-review" ? "Play every clip through a full cycle and compare it with the prompt, then explicitly approve or reject this exact route and result." : displayedFinishRejected ? "The rejected animation is retained but hidden. Describe the replacement motion; generation will restart from its exact approved parent." : approvedAnimationRevisionCount ? "The approved motion remains retained. Refine it or append another explicitly routed clip, then validate it again." : "Describe the motion you want. Local animation is selected; optional settings let you choose another ready route."}</p>
          {creationStage === "animation-prompt" && acceptedTextureForAnimation && approvedAnimationRevisionCount === 0 && <button type="button" className="rounded border border-line px-3 py-2 text-xs" onClick={returnToTextureRefinement}><Palette className="mr-1 inline" size={13} />Return to optional texture refinement</button>}
          {creationStage === "animation-prompt" && animationEditingAfterApprovalId === displayedFinish?.id && visualApproved && <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-100"><p>The current approved animation remains the final saved result unless you generate and approve another revision.</p><button type="button" className="mt-2 rounded border border-emerald-400/50 px-3 py-2 font-semibold" onClick={finishWithApprovedAnimation}><Save className="mr-1 inline" size={13} />Keep approved animation and continue to save</button></div>}
          {creationStage === "animation-review" && displayedFinish && <div className="grid gap-2 rounded border border-red-500/30 bg-red-500/5 p-3"><label className="text-xs text-muted">Why is this animation wrong?<select className={`${input} mt-1`} value={finishRejectionClass} onChange={(event) => setFinishRejectionClass(event.target.value as Prompt3DFinishVisualRejectionClassification | "")}><option value="">Choose…</option><option value="motion-mismatch">Motion does not match the prompt</option><option value="placement-path-mismatch">Direction, distance or path is wrong</option><option value="deformation-artifact">Body deformation is unrealistic</option><option value="prompt-negation-misunderstanding">Prompt or negation misunderstood</option><option value="playback-problem">Playback or clip problem</option><option value="other">Other</option></select></label><label className="text-xs text-muted">Optional rejection note<textarea className={`${input} mt-1 min-h-16`} maxLength={500} value={finishRejectionNote} onChange={(event) => setFinishRejectionNote(event.target.value)} placeholder="State what visibly failed; required when Other is selected" /></label><button disabled={finishRejectionBusy || !finishRejectionClass || (finishRejectionClass === "other" && !finishRejectionNote.trim())} className="w-fit rounded border border-red-500/60 px-3 py-2 text-xs font-semibold text-red-200 disabled:opacity-35" onClick={() => void rejectVisibleFinishRevision()}><XCircle className="mr-1 inline" size={13} />Reject animation and configure replacement</button></div>}
          {creationStage === "animation-prompt" && <><textarea aria-label="Animation prompt" className={`${input} min-h-24 resize-y`} maxLength={PROMPTED_MOTION_MAX_CHARS} value={animationPrompt} onChange={(event) => setAnimationPrompt(event.target.value)} placeholder="Example: A humanoid walks naturally in place with alternating grounded steps and relaxed arm swings. Say ‘moves forward’ only when root travel is required." />
          <div className="rounded border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-sky-100">
            <b>Resolved method is explicit</b>
            <p className="mt-1 text-[11px] text-muted">The typed local router reads the full prompt and retained asset category. Walking, running and similar actions remain in place unless direction, path or distance is affirmative; negation never authorizes travel and return paths close.</p>
          </div>
          <details className="rounded border border-line bg-bg p-3" data-testid="prompt3d-motion-settings"><summary className="cursor-pointer text-xs text-gold">Optional animation settings · {animationProvider === "auto-cpu" ? "Local automatic" : animationProvider === "local-animation-library" ? "Local library" : "HY-Motion"} · {animationDuration || "Inferred"} seconds · {animationMode} · seed {animationSeed || "automatic"}</summary><div className="mt-3 space-y-3">
          <label className="text-xs text-muted">Animation route<select className={`${input} mt-1`} value={animationProvider} onChange={(event) => setAnimationProvider(event.target.value as NonNullable<Prompt3DAnimationOverrides["provider"]>)}><option value="auto-cpu">Automatic guided CPU route (recommended)</option><option value="local-animation-library" disabled={animationLibraries.length === 0}>Local Skeleton Studio animation library</option><option value="hy-motion-1.0-lite" disabled={!motionProviderReady || Boolean(hyMotionSubjectError)}>Optional HY-Motion 1.0 Lite</option></select></label>
          {animationSubject.classification === "non-humanoid" && <p role="status" className="rounded border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-sky-100">Animal body plan: local animation uses the existing creature deformation system. HY-Motion supports human skeletons only.</p>}
          {animationProvider === "auto-cpu" && <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-100"><b>No GPU/headroom dependency</b><p className="mt-1 text-[11px] text-muted">The app will show whether it reused an existing rig, created a deterministic CPU rig, used morph/deformation, or used rigid-object motion. Ambiguous humanoids stop for Skeleton Studio correction.</p>{rigCorrectionPlacements && <p className="mt-1 text-amber-100">22 corrected Skeleton Studio placements are ready for the next immutable retry.</p>}</div>}
          {animationProvider === "local-animation-library" && <label className="text-xs text-muted">Installed local library<select className={`${input} mt-1`} value={animationLibraryPackDir} onChange={(event) => setAnimationLibraryPackDir(event.target.value)}>{animationLibraries.map((library) => <option key={library.packDir} value={library.packDir}>{library.name} · {library.clipCount} clips</option>)}</select></label>}
          {animationProvider === "hy-motion-1.0-lite" && !motionProviderReady && <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100"><AlertTriangle className="mr-1 inline" size={13} /><b>Optional HY-Motion is not ready.</b><p className="mt-1 text-[11px] text-muted">{motionProvider?.compliance.reasons.join(" ") || "Install and validate the local HY-Motion provider in advanced install options."}</p></div>}
          {animationProvider === "hy-motion-1.0-lite" && motionProviderReady && motionExecutionProfile && <div className="rounded border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-sky-100"><b>{motionExecutionProfile.label}</b><p className="mt-1 text-[11px] text-muted">Explicit optional provider. {motionExecutionProfile.tradeoff}</p>{motionExecutionProfile.gpu?.uuid && <p className="mt-1 break-all font-mono text-[10px] text-muted">{motionExecutionProfile.gpu.model} · {motionExecutionProfile.gpu.uuid}</p>}</div>}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3"><label className="text-xs text-muted">Duration<input type="text" inputMode="decimal" maxLength={32} className={`${input} mt-1`} value={animationDuration} onChange={(event) => setAnimationDuration(event.target.value)} placeholder="Infer" /></label><label className="text-xs text-muted">Clips<select className={`${input} mt-1`} value={animationRecoveryNeeded ? "replace" : animationMode} disabled={animationRecoveryNeeded} onChange={(event) => setAnimationMode(event.target.value as "replace" | "append")}><option value="append">Append clip</option><option value="replace">{animationRecoveryNeeded ? "Replace rejected clip(s)" : "Replace clips"}</option></select></label><label className="text-xs text-muted">Animation seed<input type="text" inputMode="numeric" maxLength={32} className={`${input} mt-1`} value={animationSeed} onChange={(event) => setAnimationSeed(event.target.value)} placeholder="Optional" /></label></div>
          </div></details>
          {animationSettingsError && <p role="alert" className="text-xs text-red-300">{animationSettingsError}</p>}
          <button disabled={Boolean(animationSettingsError) || finishing || !approvedTextureComplete || !animationSourceApproved || !animationPrompt.trim() || (animationProvider === "hy-motion-1.0-lite" && !motionProviderReady) || (animationProvider === "local-animation-library" && !animationLibraryPackDir) || (animationRecoveryNeeded && !animationRecoveryAvailable)} className="rounded bg-gold px-3 py-2 text-xs font-semibold text-black disabled:opacity-35" onClick={() => void startFinish("animation")}><Film className="mr-1 inline" size={13} />{animationRecoveryAvailable ? "Generate corrected motion" : animationProvider === "hy-motion-1.0-lite" ? "Generate with optional HY-Motion" : animationProvider === "local-animation-library" ? "Apply local animation library" : "Prepare rig and animate locally"}</button></>}
        </div>}

        {creationStage === "save" && <div className="mt-4 space-y-3"><div className={`rounded border p-3 text-xs ${savedAsset && !currentSaveError ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-200" : "border-amber-500/30 bg-amber-500/5 text-amber-200"}`}>{currentSaveError ? <p role="alert">{currentSaveError} Use Retry save below; the approved revision is retained.</p> : savedAsset ? <><b>Automatically added to Local Files</b><p className="mt-1 break-all">{savedAsset.savedPath}</p></> : libraryBusy ? <><Loader2 className="mr-2 inline animate-spin" size={13} />Saving the approved animated revision to Local Files…</> : <p>The approved revision is ready to save to Local Files.</p>}</div><div className="flex flex-wrap gap-2"><button disabled={libraryBusy || !displayedFinish || !visualApproved} className={`${savedAsset ? "border border-line" : "bg-gold font-semibold text-black"} rounded px-3 py-2 text-xs disabled:opacity-35`} onClick={() => void saveWorkflow(false)}><Save className="mr-1 inline" size={13} />{currentSaveError ? "Retry save" : savedAsset ? "Validate saved copy again" : "Save final model to Local Files"}</button><button disabled={libraryBusy || artifactBusy || !displayedFinish || !visualApproved} className="rounded bg-gold px-3 py-2 text-xs font-semibold text-black disabled:opacity-35" onClick={() => void exportWorkflow()}><Download className="mr-1 inline" size={13} />Export portable GLB</button>{savedAsset && <button className="rounded border border-line px-3 py-2 text-xs" onClick={() => void verifyArtifact({ kind: "managed", id: savedAsset.id }, true)}><FolderOpen className="mr-1 inline" size={13} />Reopen saved result</button>}{portableExport && <button className="rounded border border-line px-3 py-2 text-xs" onClick={() => void verifyArtifact({ kind: "portable", id: portableExport.id }, true)}>Reopen export</button>}<button className="rounded border border-line px-3 py-2 text-xs" onClick={() => window.grudge.app.openRoute("/local")}>Open Local Files</button><button type="button" disabled={!displayedFinish || displayedFinish.operation !== "animation" || !visualApproved} className="rounded border border-line px-3 py-2 text-xs disabled:opacity-35" onClick={continueEditingApprovedAnimation}><Film className="mr-1 inline" size={13} />Add or refine animation</button>{guidedSceneCompletionPlanned && displayedFinish?.assetPath && visualApproved && <button type="button" className="rounded border border-gold/50 px-3 py-2 text-xs text-gold" onClick={async () => { sessionStorage.setItem("grudge.forge.pendingLocalPath", displayedFinish.assetPath!); sessionStorage.setItem("grudge.prompt3d.contextualHandoff", JSON.stringify({ version: 1, route: "scene-completion", prompt: spec.prompt, revision: `${displayedFinish.id} · SHA-256 ${displayedFinish.sha256}`, orchestration: spec.orchestration })); await window.grudge.app.openRoute("/forge-local"); }}>Continue to planned Scene Completion</button>}</div>{exportedAssetPath && <p className="break-all text-[11px] text-gold">Exported: {exportedAssetPath}</p>}{artifactVerification && <p className="break-all text-[11px] text-sky-200">Verified SHA-256 {artifactVerification.sha256} · geometry {artifactVerification.geometryHash} · {artifactVerification.textures} texture set(s) · {artifactVerification.animations.length} clip(s)</p>}</div>}
      </section>

      <section data-panel="preview" className={`${card} min-h-[520px] min-w-0 overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-line p-4"><div><h2 className="font-semibold">Preview</h2><p className="mt-1 text-xs text-muted">Only the current concept or current model revision appears here.</p></div>{currentRunStatus && <span className="text-xs capitalize text-muted">{currentRunStatus.stage} · {currentRunStatus.progress}%</span>}</div>
        {creationStage === "concept-review" && job?.conceptImagePath && <div className="space-y-3 p-4"><img key={`${job.conceptImagePath}:${job.conceptAttempt?.binding.conceptSha256 ?? "unbound"}:${conceptPreviewAttempt}`} className="max-h-[560px] w-full rounded border border-line bg-white object-contain" src={`grudge-media://local/?path=${encodeURIComponent(job.conceptImagePath)}&sha=${encodeURIComponent(job.conceptAttempt?.binding.conceptSha256 ?? "")}&attempt=${conceptPreviewAttempt}`} alt="Current retained Hunyuan concept" onLoad={() => { setLoadedConceptPath(job.conceptImagePath!); setFailedConceptPath(null); }} onError={() => handleConceptPreviewError(job.conceptImagePath!)} />{failedConceptPath === job.conceptImagePath && <p role="alert" className="text-xs text-red-300">The exact concept could not be displayed. Approval remains disabled.</p>}<div className="grid gap-2 text-[11px] md:grid-cols-2"><div className="rounded border border-line bg-bg p-2"><b>Exact prompt</b><p className="mt-1 whitespace-pre-wrap text-muted">{job.spec.prompt}</p></div><div className="rounded border border-line bg-bg p-2"><b>Bound provenance</b><p className="mt-1 break-all text-muted">Provider {job.providerId} · seed {job.spec.seed}<br />Concept SHA-256 {job.conceptAttempt?.binding.conceptSha256}<br />Reference {job.conceptAttempt?.binding.referenceSha256 ?? "prompt-only"}</p></div></div></div>}
        {(creationStage === "source" || creationStage === "prompt" || creationStage === "generating") && <div className="flex min-h-[440px] items-center justify-center p-8 text-center text-sm text-muted">{creationStage === "generating" ? <><Loader2 className="mr-2 animate-spin" size={18} />Waiting for the explicitly selected local provider output…</> : <div><Box size={48} className="mx-auto mb-3 opacity-30" />{creationStage === "source" ? "Choose the explicit local provider input and starting source." : "The current concept or model will appear here."}</div>}</div>}
        {displayedFinish?.operation === "animation" && Array.isArray(displayedFinish.animationPlan?.deformations) && !activeFinish && <div className="p-3">{regionEditing?<DeformationRegionEditor key={displayedFinish.id} job={displayedFinish} onClose={()=>setRegionEditing(false)} onSaved={next=>{setFinishJobs(current=>upsertFinishJob(current,next));setFocusedFinishId(null);setRegionEditing(false);setVisualInspection(null);toast.success("Adjusted animation started; review the new revision when ready.");}}/>:<button disabled={!controlsEnabled||finishBusy} className="rounded border border-gold/50 px-4 py-2 text-sm text-gold disabled:opacity-35" onClick={()=>setRegionEditing(true)}>Adjust moving areas{displayedFinishRejected?" · inspect retained rejected motion":""}</button>}</div>}        {!regionEditing && resultJob && result && displayedAssetPath && <div className="space-y-3 p-4">
          {displayedFinish?.operation === "animation" && displayedFinish.animationRoute && <div className="rounded border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-sky-100"><b>Animation route: {displayedFinish.animationRoute.replaceAll("-", " ")}</b><p className="mt-1 text-[11px] text-muted">This label is retained in provenance and is never silently changed to another provider or technique.</p></div>}
          <div className="min-h-[480px] overflow-hidden rounded border border-line"><Model3DViewer asset={{ name: "prompt3d-workflow.glb", url: `local://${encodeURIComponent(displayedAssetPath)}`, localPath: displayedAssetPath, contentType: "model/gltf-binary", size: 0 }} preserveAuthoredMaterials onLoadStateChange={setModelPreviewState} visualInspectionStage={pendingVisualInspectionStage} visualInspectionAssetSha256={pendingVisualInspectionStage ? workflowAssetSha256 : undefined} onVisualInspectionChange={setVisualInspection} /></div>
          <div className={`rounded border p-3 text-xs ${visualApproved ? "border-emerald-500/30 bg-emerald-500/5" : "border-gold/30 bg-gold/5"}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><b>{visualApproved ? "Exact revision approved" : "Visual approval required"}</b><p className="mt-1 text-[11px] text-muted">Inspect at least four fixed viewpoints. Animation approval also requires playing every retained clip for a full duration.</p></div>{!visualApproved && !(geometryWasRejected && !displayedFinish) && <button disabled={visualApprovalBusy || finishing || !result.report.gameReady || !displayedPreviewReady || !visualInspectionReady} className="rounded bg-gold px-3 py-2 text-xs font-semibold text-black disabled:opacity-35" onClick={() => void approveVisibleRevision()}><ShieldCheck className="mr-1 inline" size={13} />Approve exact revision</button>}</div>{!visualApproved && visualInspectionRequirements && !visualInspectionRequirements.complete && <p className="mt-2 text-amber-200">{visualInspectionRequirements.missing.join(" ")}</p>}{visualApprovalError && <p className="mt-2 text-red-300">{visualApprovalError}</p>}</div>
          <div className="flex flex-wrap gap-2"><button className="rounded border border-line px-3 py-2 text-xs" onClick={() => window.grudge.viewer.openLocal({ path: displayedAssetPath, contentType: "model/gltf-binary" })}>Open full preview</button><button className="rounded border border-line px-3 py-2 text-xs" onClick={() => window.grudge.prompt3d.reveal(displayedAssetPath)}>Reveal current files</button>{displayedFinish?.rigPreparation && <button className="rounded border border-line px-3 py-2 text-xs" onClick={async () => { sessionStorage.setItem("grudge.skeleton.pendingPath", displayedAssetPath); await window.grudge.app.openRoute("/skeleton"); }}>Review fitted rig in Skeleton Studio</button>}<button className="rounded border border-line px-3 py-2 text-xs" onClick={async () => { sessionStorage.setItem("grudge.forge.pendingLocalPath", displayedAssetPath); await window.grudge.app.openRoute("/forge-local"); }}>Optional manual editor</button></div>
          {displayedFinish?.operation === "animation" && retainedMotionCompatibility && displayedFinish.provider === "hy-motion-1.0-lite" && <div className="rounded border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-sky-100"><b>Generated HY-Motion skeletal motion</b><div className="mt-2 grid gap-1 text-[11px]"><p><CheckCircle2 className="mr-1 inline" size={12} />Subject: {retainedMotionCompatibility.subject ?? "human or humanoid"}</p><p><CheckCircle2 className="mr-1 inline" size={12} />Root movement: {retainedMotionCompatibility.rootTranslation ?? "stationary"}</p>{retainedMotionCompatibility.rationale && <p className="text-muted">{retainedMotionCompatibility.rationale}</p>}<p className="text-muted">HY-Motion 1.0 Lite joint output · existing Mixamo-25-compatible local rig</p></div></div>}
          {displayedFinish?.operation === "animation" && retainedCpuClassification && displayedFinish.provider === "grudge-motion-graph-1" && <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-100"><b>Explicit local CPU route</b><div className="mt-2 grid gap-1 text-[11px]"><p><CheckCircle2 className="mr-1 inline" size={12} />Route: {displayedFinish.animationRoute?.replaceAll("-", " ") ?? "local CPU motion"}</p><p><CheckCircle2 className="mr-1 inline" size={12} />Classification: {retainedCpuClassification.classification ?? "retained local route"}</p>{retainedCpuClassification.rationale && <p className="text-muted">{retainedCpuClassification.rationale}</p>}<p className="text-muted">This is the recorded deterministic or local-library route, not generated HY-Motion and not evidence for strict Hunyuan acceptance.</p></div></div>}
          <details className="text-[11px]"><summary className="cursor-pointer text-muted">Current revision proof</summary><div className="mt-2 grid gap-2 md:grid-cols-2"><p className="rounded border border-line p-2 text-muted">Provider {resultJob.providerId} · job <span className="break-all font-mono">{resultJob.id}</span><br />Seed {resultJob.spec.seed}<br />Geometry {result.geometryHash}<br />SHA-256 {workflowAssetSha256}</p><div className="rounded border border-line p-2 text-muted">{result.report.checks.map((check) => <p key={check.id}>{check.status.toUpperCase()} · {check.message}</p>)}</div></div></details>
        </div>}
        {resultJob && result && !displayedAssetPath && creationStage !== "generating" && <div className="flex min-h-[440px] items-center justify-center p-8 text-sm text-muted">{displayedFinishRejected ? "The rejected result is hidden. Configure and generate its replacement in the creation panel." : "The current revision has no displayable model output."}</div>}
      </section>
    </div>
  );
}
