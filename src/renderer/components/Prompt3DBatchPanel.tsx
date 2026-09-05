import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CopyPlus,
  Download,
  ListPlus,
  Loader2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { AssetSpecV1 } from "../../shared/prompt3d";
import {
  PROMPT3D_MIN_BATCH_FINISH_PROMPTS,
  PROMPT3D_STRICT_BATCH_ITEM_COUNT,
  shouldRehydratePrompt3DBatch,
} from "../../shared/prompt3dWorkflow";
import type {
  Prompt3DAnimationOverrides,
  Prompt3DBatchAnimationRevision,
  Prompt3DBatchExportResult,
  Prompt3DBatchItem,
  Prompt3DBatchRequest,
  Prompt3DBatchStatus,
  Prompt3DFinishHistory,
  Prompt3DWorkflowLibraryAsset,
} from "../../shared/prompt3dWorkflow";

const card = "rounded-xl border border-line bg-bg-2/65";
const input = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-gold/60 disabled:cursor-not-allowed disabled:opacity-50";
const MAX_ITEMS = 24;
const MAX_REVISIONS = 8;

type OptionalNumberKey = "duration";
type NumberDraft = Record<OptionalNumberKey, string>;

interface BatchDraft {
  name: string;
  baselineManagedAssetId: string;
  shapeRefinement: string;
  texturePrompts: string[];
  animationRevisions: Prompt3DBatchAnimationRevision[];
  numbers: NumberDraft;
}

interface Prompt3DBatchAPI {
  finishHistory(): Promise<Prompt3DFinishHistory>;
  workflowLibrary(): Promise<Prompt3DWorkflowLibraryAsset[]>;
  batchStart(request: Prompt3DBatchRequest): Promise<Prompt3DBatchStatus>;
  batchStatus(id?: string): Promise<Prompt3DBatchStatus | null>;
  batchCancel(id: string): Promise<Prompt3DBatchStatus>;
  batchRetry(id: string, itemId?: string): Promise<Prompt3DBatchStatus>;
  batchExport(id: string): Promise<{ canceled: true } | Prompt3DBatchExportResult>;
  onBatchProgress(callback: (status: Prompt3DBatchStatus) => void): () => void;
}

export interface Prompt3DBatchPanelProps {
  currentSpec: AssetSpecV1;
  disabled?: boolean;
  onLoadQueuedSpec?: (spec: AssetSpecV1) => void;
  onAwaitingApprovalJobChange?: (jobId: string | null) => void;
  onBatchStatusChange?: (status: Prompt3DBatchStatus | null) => void;
}

function blankDraft(): BatchDraft {
  return {
    name: "",
    baselineManagedAssetId: "",
    shapeRefinement: "",
    texturePrompts: ["", ""],
    animationRevisions: [
      { prompt: "", mode: "replace" },
      { prompt: "", mode: "append" },
    ],
    numbers: { duration: "" },
  };
}

function cloneSpec(spec: AssetSpecV1): AssetSpecV1 {
  return structuredClone(spec);
}

function newItemId(): string {
  return `item-${crypto.randomUUID()}`;
}

function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function animationOverrides(draft: BatchDraft): Prompt3DAnimationOverrides | undefined {
  const result: Prompt3DAnimationOverrides = {
    duration: parseOptionalNumber(draft.numbers.duration),
  };
  return Object.values(result).some((value) => value !== undefined) ? result : undefined;
}

function draftFromItem(item: Prompt3DBatchItem): BatchDraft {
  return {
    name: item.name,
    baselineManagedAssetId: item.baselineManagedAssetId ?? "",
    shapeRefinement: item.shapeRefinement,
    texturePrompts: [...item.texturePrompts],
    animationRevisions: item.animationRevisions.map((revision) => ({ ...revision })),
    numbers: {
      duration: item.animation?.duration?.toString() ?? "",
    },
  };
}

function validateDraft(draft: BatchDraft): string | null {
  if (!draft.name.trim()) return "Give this queued asset a name.";
  if (!draft.shapeRefinement.trim()) return "Describe the Hunyuan shape refinement for this asset.";
  if (draft.texturePrompts.length < PROMPT3D_MIN_BATCH_FINISH_PROMPTS) {
    return "Add an initial texture prompt and at least one texture refinement prompt.";
  }
  if (draft.animationRevisions.length < PROMPT3D_MIN_BATCH_FINISH_PROMPTS) {
    return "Add an initial animation prompt and at least one animation refinement prompt.";
  }
  if (draft.texturePrompts.some((prompt) => !prompt.trim())) return "Every texture revision needs a prompt.";
  if (draft.animationRevisions.some((revision) => !revision.prompt.trim())) return "Every animation revision needs a prompt.";
  const values: Array<[string, string, number, number]> = [
    ["Duration", draft.numbers.duration, 0.5, 5],
  ];
  for (const [label, raw, minimum, maximum] of values) {
    if (!raw.trim()) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      return `${label} must be between ${minimum} and ${maximum}, or left blank for prompt inference.`;
    }
  }
  return null;
}

function statusTone(state: Prompt3DBatchStatus["state"]): string {
  if (state === "complete") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (state === "failed") return "border-red-500/40 bg-red-500/10 text-red-300";
  if (state === "cancelled") return "border-zinc-500/40 bg-zinc-500/10 text-zinc-300";
  if (state === "awaiting-approval") return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  return "border-sky-500/40 bg-sky-500/10 text-sky-200";
}

function revisionList(
  label: string,
  values: string[],
  setValues: (next: string[]) => void,
  disabled: boolean,
) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-fg">{label}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-muted hover:border-gold/50 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          disabled={disabled || values.length >= MAX_REVISIONS}
          onClick={() => setValues([...values, ""])}
        >
          <Plus size={12} /> Add revision
        </button>
      </div>
      {values.map((value, index) => (
        <div key={`${label}-${index}`} className="flex items-start gap-2">
          <textarea
            className={`${input} min-h-20 resize-y`}
            disabled={disabled}
            value={value}
            maxLength={2_000}
            placeholder={`${label.replace(/ prompts?$/i, "")} prompt ${index + 1}`}
            aria-label={`${label} ${index + 1}`}
            onChange={(event) => setValues(values.map((candidate, candidateIndex) => candidateIndex === index ? event.target.value : candidate))}
          />
          <button
            type="button"
            title={`Remove ${label.toLowerCase()} ${index + 1}`}
            aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
            className="mt-1 rounded-md border border-line p-2 text-muted hover:border-red-500/50 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
            disabled={disabled || values.length <= PROMPT3D_MIN_BATCH_FINISH_PROMPTS}
            onClick={() => setValues(values.filter((_, candidateIndex) => candidateIndex !== index))}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <p className="text-[10px] leading-4 text-muted">Two prompts are required: the initial texture treatment and at least one prompted refinement.</p>
    </div>
  );
}

function animationRevisionList(
  values: Prompt3DBatchAnimationRevision[],
  setValues: (next: Prompt3DBatchAnimationRevision[]) => void,
  disabled: boolean,
) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-fg">Animation revisions</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-muted hover:border-gold/50 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          disabled={disabled || values.length >= MAX_REVISIONS}
          onClick={() => setValues([...values, { prompt: "", mode: "append" }])}
        >
          <Plus size={12} /> Add revision
        </button>
      </div>
      {values.map((value, index) => (
        <div key={`animation-${index}`} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
          <textarea
            className={`${input} min-h-20 resize-y`}
            disabled={disabled}
            value={value.prompt}
            maxLength={2_000}
            placeholder={`Animation prompt ${index + 1}`}
            aria-label={`Animation prompt ${index + 1}`}
            onChange={(event) => setValues(values.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, prompt: event.target.value } : candidate))}
          />
          <label className="text-[11px] text-muted">
            Clip mode
            <select
              className={`${input} mt-1`}
              value={value.mode}
              disabled={disabled}
              aria-label={`Animation clip mode ${index + 1}`}
              onChange={(event) => setValues(values.map((candidate, candidateIndex) => candidateIndex === index
                ? { ...candidate, mode: event.target.value as Prompt3DBatchAnimationRevision["mode"] }
                : candidate))}
            >
              <option value="replace">Replace clips</option>
              <option value="append">Append clip</option>
            </select>
          </label>
          <button
            type="button"
            title={`Remove animation revision ${index + 1}`}
            aria-label={`Remove animation revision ${index + 1}`}
            className="mt-1 self-start rounded-md border border-line p-2 text-muted hover:border-red-500/50 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
            disabled={disabled || values.length <= PROMPT3D_MIN_BATCH_FINISH_PROMPTS}
            onClick={() => setValues(values.filter((_, candidateIndex) => candidateIndex !== index))}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <p className="text-[10px] leading-4 text-muted">Two prompts are required: the initial motion and at least one prompted refinement. Replace removes earlier clips for that revision; append preserves approved clips and adds the new one.</p>
    </div>
  );
}

export default function Prompt3DBatchPanel({
  currentSpec,
  disabled = false,
  onLoadQueuedSpec,
  onAwaitingApprovalJobChange,
  onBatchStatusChange,
}: Prompt3DBatchPanelProps) {
  const [open, setOpen] = useState(false);
  const [batchName, setBatchName] = useState("");
  const [strictAcceptance, setStrictAcceptance] = useState(false);
  const [eligibleBaselines, setEligibleBaselines] = useState<Prompt3DWorkflowLibraryAsset[]>([]);
  const [items, setItems] = useState<Prompt3DBatchItem[]>([]);
  const [draft, setDraft] = useState<BatchDraft>(() => blankDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSpec, setEditingSpec] = useState<AssetSpecV1 | null>(null);
  const [batch, setBatch] = useState<Prompt3DBatchStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dismissedTerminalBatchId = useRef<string | null>(null);

  const api = window.grudge.prompt3d as typeof window.grudge.prompt3d & Prompt3DBatchAPI;
  const active = batch?.state === "running" || batch?.state === "awaiting-approval";
  const queueLocked = disabled || starting || cancelling || retrying || exporting || active || Boolean(batch);
  const exactHunyuanBrief = currentSpec.providerId === "hunyuan3d-2"
    && currentSpec.route === "concept-image-to-3d"
    && currentSpec.referenceImage === undefined
    && currentSpec.referenceImages === undefined;
  const queueLimit = strictAcceptance ? PROMPT3D_STRICT_BATCH_ITEM_COUNT : MAX_ITEMS;
  const strictBaselineIds = items.map((item) => item.baselineManagedAssetId).filter((value): value is string => Boolean(value));
  const strictReady = !strictAcceptance || (
    items.length === PROMPT3D_STRICT_BATCH_ITEM_COUNT
    && strictBaselineIds.length === PROMPT3D_STRICT_BATCH_ITEM_COUNT
    && new Set(strictBaselineIds).size === PROMPT3D_STRICT_BATCH_ITEM_COUNT
  );
  const awaitingApprovalJobId = useMemo(
    () => batch?.items.find((item) => item.state === "awaiting-approval")?.currentJobId ?? null,
    [batch],
  );

  useEffect(() => {
    if (!open || disabled || batch || !strictAcceptance) return;
    let disposed = false;
    void Promise.all([
      api.workflowLibrary() as Promise<Prompt3DWorkflowLibraryAsset[]>,
      api.finishHistory() as Promise<Prompt3DFinishHistory>,
    ]).then(([assets, history]) => {
      if (disposed) return;
      const jobs = new Map(history.jobs.map((job) => [job.id, job]));
      setEligibleBaselines(assets.filter((asset) => {
        const job = jobs.get(asset.sourceJobId);
        return job?.state === "complete" && job.batchId === undefined;
      }));
    }).catch((caught: unknown) => {
      if (!disposed) setError(caught instanceof Error ? caught.message : String(caught));
    });
    return () => { disposed = true; };
  }, [api, batch, disabled, open, strictAcceptance]);

  useEffect(() => {
    let disposed = false;
    const retain = (next: Prompt3DBatchStatus) => {
      if (disposed || !shouldRehydratePrompt3DBatch(next, dismissedTerminalBatchId.current)) return;
      setStrictAcceptance(Boolean(next.request.acceptance));
      setBatch(next);
      setBatchName(next.name);
      setItems(next.request.items.map((item) => ({ ...item, spec: cloneSpec(item.spec), texturePrompts: [...item.texturePrompts], animationRevisions: item.animationRevisions.map((revision) => ({ ...revision })) })));
      setError(next.state === "failed" ? next.message : null);
    };
    const unsubscribe = typeof api.onBatchProgress === "function" ? api.onBatchProgress(retain) : undefined;
    return () => { disposed = true; unsubscribe?.(); };
  }, []);

  useEffect(() => {
    if (disabled || batch) return;
    let disposed = false;
    void api.batchStatus().then((next: Prompt3DBatchStatus | null) => {
      if (disposed || !shouldRehydratePrompt3DBatch(next, dismissedTerminalBatchId.current)) return;
      setStrictAcceptance(Boolean(next.request.acceptance));
      setBatch(next);
      setBatchName(next.name);
      setItems(next.request.items.map((item) => ({ ...item, spec: cloneSpec(item.spec), texturePrompts: [...item.texturePrompts], animationRevisions: item.animationRevisions.map((revision) => ({ ...revision })) })));
      setError(next.state === "failed" ? next.message : null);
    }).catch((caught: unknown) => {
      if (!disposed) setError(caught instanceof Error ? caught.message : String(caught));
    });
    return () => { disposed = true; };
  }, [disabled, batch]);

  useEffect(() => {
    onAwaitingApprovalJobChange?.(awaitingApprovalJobId);
  }, [awaitingApprovalJobId, onAwaitingApprovalJobChange]);

  useEffect(() => {
    onBatchStatusChange?.(batch);
  }, [batch, onBatchStatusChange]);

  const updateTexturePrompts = (next: string[]) => {
    setDraft((old) => ({ ...old, texturePrompts: next }));
  };

  const updateNumber = (key: OptionalNumberKey, value: string) => {
    setDraft((old) => ({ ...old, numbers: { ...old.numbers, [key]: value } }));
  };

  const addOrUpdate = () => {
    setError(null);
    if ((editingSpec ?? currentSpec).referenceImage !== undefined || (editingSpec ?? currentSpec).referenceImages !== undefined) {
      setError("Serial workflow batches are prompt-only. Clear the optional local reference images before queueing this brief.");
      return;
    }
    if (!exactHunyuanBrief && !editingSpec) {
      setError("Select the prompt-only Hunyuan concept-image route in the brief before queueing it.");
      return;
    }
    const draftError = validateDraft(draft);
    if (draftError) {
      setError(draftError);
      return;
    }
    if (strictAcceptance && !draft.baselineManagedAssetId) {
      setError("Choose the separately completed managed baseline for this strict final-run item.");
      return;
    }
    if (strictAcceptance && items.some((item) => item.id !== editingId && item.baselineManagedAssetId === draft.baselineManagedAssetId)) {
      setError("Each strict final-run item needs a distinct individual managed baseline.");
      return;
    }
    const id = editingId ?? newItemId();
    const spec = cloneSpec(editingSpec ?? currentSpec);
    const next: Prompt3DBatchItem = {
      id,
      name: draft.name.trim(),
      spec,
      shapeRefinement: draft.shapeRefinement.trim(),
      texturePrompts: draft.texturePrompts.map((prompt) => prompt.trim()),
      animationRevisions: draft.animationRevisions.map((revision) => ({ ...revision, prompt: revision.prompt.trim() })),
      animation: animationOverrides(draft),
      ...(draft.baselineManagedAssetId ? { baselineManagedAssetId: draft.baselineManagedAssetId } : {}),
    };
    setItems((old) => editingId
      ? old.map((candidate) => candidate.id === editingId ? next : candidate)
      : [...old, next]);
    setDraft(blankDraft());
    setEditingId(null);
    setEditingSpec(null);
  };

  const edit = (item: Prompt3DBatchItem) => {
    setEditingId(item.id);
    setEditingSpec(cloneSpec(item.spec));
    setDraft(draftFromItem(item));
    onLoadQueuedSpec?.(cloneSpec(item.spec));
    setError(null);
  };

  const useCurrentBrief = () => {
    if (!exactHunyuanBrief) {
      setError("The current brief must use Hunyuan's prompt-only concept-image-to-3D route; clear any optional reference image first.");
      return;
    }
    setEditingSpec(cloneSpec(currentSpec));
    setError(null);
  };

  const startBatch = async () => {
    if (!batchName.trim()) {
      setError("Give this serial batch a name.");
      return;
    }
    if (items.length < 1) {
      setError("Add at least one complete prompted asset to the queue.");
      return;
    }
    if (strictAcceptance && items.length !== PROMPT3D_STRICT_BATCH_ITEM_COUNT) {
      setError(`Strict final-run acceptance requires exactly ${PROMPT3D_STRICT_BATCH_ITEM_COUNT} queued assets.`);
      return;
    }
    if (strictAcceptance && (strictBaselineIds.length !== PROMPT3D_STRICT_BATCH_ITEM_COUNT
      || new Set(strictBaselineIds).size !== PROMPT3D_STRICT_BATCH_ITEM_COUNT)) {
      setError("Strict final-run acceptance requires six distinct verified individual managed baselines.");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const next = await api.batchStart({
        name: batchName.trim(),
        items,
        ...(strictAcceptance ? {
          acceptance: {
            profile: "strict-final-run-v1" as const,
            expectedItemCount: PROMPT3D_STRICT_BATCH_ITEM_COUNT,
          },
        } : {}),
      });
      dismissedTerminalBatchId.current = null;
      setBatch(next);
      toast.success("Serial Hunyuan workflow batch started", { description: `${items.length} prompted asset${items.length === 1 ? "" : "s"} queued.` });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      toast.error("Could not start the workflow batch", { description: message });
    } finally {
      setStarting(false);
    }
  };

  const exportAll = async () => {
    if (!batch || batch.state !== "complete" || exporting) return;
    setExporting(true);
    setError(null);
    try {
      const result = await api.batchExport(batch.id);
      if ("canceled" in result && result.canceled) {
        toast.message("Batch export cancelled");
        return;
      }
      const refreshed = await api.batchStatus(batch.id);
      if (!refreshed) throw new Error("The retained batch manifest is no longer available.");
      setBatch(refreshed);
      toast.success("All portable GLBs exported", { description: `${result.items.length} verified file${result.items.length === 1 ? "" : "s"} copied without overwriting existing files.` });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      toast.error("Could not export the completed batch", { description: message });
    } finally {
      setExporting(false);
    }
  };

  const cancelBatch = async () => {
    if (!batch || !active || cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      const next = await api.batchCancel(batch.id);
      setBatch(next);
      setItems(next.request.items);
      toast.message("Serial batch cancelled", { description: "Completed approved items and retained partial output were preserved." });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      toast.error("Could not cancel the workflow batch", { description: message });
    } finally {
      setCancelling(false);
    }
  };

  const retryBatch = async () => {
    if (!batch || (batch.state !== "failed" && batch.state !== "cancelled") || retrying) return;
    const currentItem = batch.items.find((item) => item.state !== "complete");
    if (!currentItem) return;
    setRetrying(true);
    setError(null);
    try {
      const next = await api.batchRetry(batch.id, currentItem.id);
      setBatch(next);
      setItems(next.request.items);
      toast.success("Batch item retry started", { description: `${currentItem.name} is continuing from its retained cursor.` });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      toast.error("Could not retry the workflow batch", { description: message });
    } finally {
      setRetrying(false);
    }
  };

  const resetCompletedBatch = () => {
    if (active || !batch) return;
    dismissedTerminalBatchId.current = batch.id;
    setBatch(null);
    setBatchName("");
    setStrictAcceptance(false);
    setItems([]);
    setDraft(blankDraft());
    setEditingId(null);
    setEditingSpec(null);
    setError(null);
  };

  return (
    <section className={`${card} overflow-hidden`} aria-label="Serial Prompt-to-3D batch">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-fg">
          <ListPlus size={17} className="text-gold" /> Serial custom-asset batch
          {items.length > 0 && <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-normal text-muted">{items.length}/{queueLimit}</span>}
        </span>
        {open ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
      </button>

      {open && (
        <div className="space-y-4 border-t border-line p-4">
          <p className="text-xs leading-5 text-muted">
            Queue snapshots of the fully typed Hunyuan brief above. Each asset is generated fresh, concept-approved, shape-refined, textured and animated in order. Every visual gate—base geometry, refined geometry, each texture revision and each animation revision—requires exact persisted approval before the serial run resumes. This queue stores prompts and settings only; it does not create or reuse templates.
          </p>

          <label className="block text-xs text-muted">
            Batch name
            <input
              className={`${input} mt-1`}
              value={batchName}
              maxLength={120}
              disabled={queueLocked}
              placeholder="Name this run"
              onChange={(event) => setBatchName(event.target.value)}
            />
          </label>

          <label className={`flex items-start gap-3 rounded-lg border p-3 ${strictAcceptance ? "border-gold/45 bg-gold/5" : "border-line bg-bg/35"}`}>
            <input
              type="checkbox"
              className="mt-0.5"
              checked={strictAcceptance}
              disabled={queueLocked}
              onChange={(event) => { setStrictAcceptance(event.target.checked); setError(null); }}
            />
            <span>
              <span className="block text-xs font-semibold text-fg">Strict final-run acceptance</span>
              <span className="mt-1 block text-[11px] leading-5 text-muted">
                Opt in only for the final uninterrupted run. It requires exactly six distinct verified individual managed baselines. The service assigns unused seeds and rejects reused concept, geometry or final bytes. A process restore or batch retry permanently disqualifies this run from receiving a sealed acceptance receipt; ordinary batches remain recoverable.
              </span>
            </span>
          </label>

          {!batch && (
            <div className="space-y-4 rounded-lg border border-line bg-bg/45 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-fg">{editingId ? "Edit queued asset" : "Add the current brief"}</div>
                  <div className="mt-1 max-w-3xl text-[11px] leading-5 text-muted">
                    {editingId
                      ? "The saved brief snapshot remains attached until you replace it with the current brief. Edit the full brief in the parent panel, then use the replacement action here."
                      : "The current prompt, dimensions, budgets, style, seed and object rules are copied as one Hunyuan brief when this item is added."}
                  </div>
                </div>
                {editingId && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs text-muted hover:border-gold/50 hover:text-fg disabled:opacity-40"
                    disabled={disabled}
                    onClick={useCurrentBrief}
                  >
                    <CopyPlus size={13} /> Replace with current brief
                  </button>
                )}
              </div>

              {!exactHunyuanBrief && !editingSpec && (
                <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  Choose Hunyuan with the concept-image-to-3D route in the parent brief before adding it.
                </div>
              )}

              <label className="block text-xs text-muted">
                Queue item name
                <input className={`${input} mt-1`} value={draft.name} maxLength={120} disabled={disabled} placeholder="Identify this custom asset" onChange={(event) => setDraft((old) => ({ ...old, name: event.target.value }))} />
              </label>
              {strictAcceptance && (
                <label className="block text-xs text-muted">
                  Verified individual managed baseline
                  <select
                    className={`${input} mt-1`}
                    value={draft.baselineManagedAssetId}
                    disabled={disabled}
                    onChange={(event) => setDraft((old) => ({ ...old, baselineManagedAssetId: event.target.value }))}
                  >
                    <option value="">Choose the separately completed first copy</option>
                    {eligibleBaselines.map((asset) => {
                      const alreadyQueued = items.some((item) => item.id !== editingId && item.baselineManagedAssetId === asset.id);
                      return <option key={asset.id} value={asset.id} disabled={alreadyQueued}>{asset.prompt.slice(0, 90)} · {asset.id.slice(0, 8)}{alreadyQueued ? " · already queued" : ""}</option>;
                    })}
                  </select>
                  <span className="mt-1 block text-[10px]">Only validated managed workflows with no batch binding are eligible. The strict run retains the exact baseline identity and proves its new seed and results differ.</span>
                </label>
              )}
              <label className="block text-xs text-muted">
                Hunyuan shape-refinement prompt
                <textarea className={`${input} mt-1 min-h-24 resize-y`} value={draft.shapeRefinement} maxLength={1_000} disabled={disabled} placeholder="Describe the changes to make after reviewing the fresh base model" onChange={(event) => setDraft((old) => ({ ...old, shapeRefinement: event.target.value }))} />
              </label>

              {revisionList("Texture prompts", draft.texturePrompts, updateTexturePrompts, disabled)}
              {animationRevisionList(draft.animationRevisions, (next) => setDraft((old) => ({ ...old, animationRevisions: next })), disabled)}

              <div>
                <div className="mb-2 text-xs font-semibold text-fg">Optional generic motion controls</div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="text-[11px] text-muted">Duration (0.5–5 s)<input className={`${input} mt-1`} type="number" min="0.5" max="5" step="0.25" value={draft.numbers.duration} disabled={disabled} placeholder="Default: 4 s" onChange={(event) => updateNumber("duration", event.target.value)} /></label>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg bg-gold px-3 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={disabled || (!editingSpec && !exactHunyuanBrief) || (!editingId && items.length >= queueLimit)}
                  onClick={addOrUpdate}
                >
                  {editingId ? <Pencil size={15} /> : <Plus size={15} />}{editingId ? "Update queued asset" : "Add current brief to queue"}
                </button>
                {editingId && (
                  <button type="button" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-fg" onClick={() => { setDraft(blankDraft()); setEditingId(null); setEditingSpec(null); setError(null); }}>
                    Cancel edit
                  </button>
                )}
              </div>
            </div>
          )}

          {items.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-fg">Queued Hunyuan briefs</div>
              {items.map((item, index) => {
                const live = batch?.items.find((candidate) => candidate.id === item.id);
                const acceptanceItem = batch?.acceptance?.items.find((candidate) => candidate.itemId === item.id);
                return (
                  <div key={item.id} className={`rounded-lg border p-3 ${editingId === item.id ? "border-gold/60 bg-gold/5" : "border-line bg-bg/35"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-muted">{index + 1}.</span>
                          <span className="font-semibold text-fg">{item.name}</span>
                          {live && <span className="rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">{live.state.replaceAll("-", " ")}</span>}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-muted">{item.spec.prompt}</p>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted">
                          <span>{acceptanceItem ? `Seed ${acceptanceItem.requestedSeed} → service-assigned ${acceptanceItem.assignedSeed}` : `Seed ${item.spec.seed}`}</span>
                          <span>{item.spec.dimensions.width} × {item.spec.dimensions.height} × {item.spec.dimensions.depth} {item.spec.dimensions.unit}</span>
                          <span>{item.texturePrompts.length} texture prompt{item.texturePrompts.length === 1 ? "" : "s"}</span>
                          <span>{item.animationRevisions.length} animation revision{item.animationRevisions.length === 1 ? "" : "s"}</span>
                        </div>
                        {item.baselineManagedAssetId && <div className="mt-1 break-all font-mono text-[10px] text-muted">Individual baseline {item.baselineManagedAssetId}</div>}
                      </div>
                      {!queueLocked && (
                        <div className="flex gap-1">
                          <button type="button" className="rounded-md border border-line p-2 text-muted hover:border-gold/50 hover:text-fg" title="Edit queued asset" aria-label={`Edit ${item.name}`} onClick={() => edit(item)}><Pencil size={14} /></button>
                          <button type="button" className="rounded-md border border-line p-2 text-muted hover:border-red-500/50 hover:text-red-300" title="Remove queued asset" aria-label={`Remove ${item.name}`} onClick={() => { setItems((old) => old.filter((candidate) => candidate.id !== item.id)); if (editingId === item.id) { setEditingId(null); setEditingSpec(null); setDraft(blankDraft()); } }}><Trash2 size={14} /></button>
                        </div>
                      )}
                    </div>
                    {live && (
                      <div className="mt-3">
                        <div className="mb-1 flex justify-between gap-3 text-[11px] text-muted"><span>{live.message}</span><span>{Math.round(live.progress)}%</span></div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-bg"><div className={`h-full rounded-full transition-[width] ${live.state === "failed" ? "bg-red-400" : live.state === "complete" ? "bg-emerald-400" : "bg-gold"}`} style={{ width: `${Math.max(0, Math.min(100, live.progress))}%` }} /></div>
                        {live.currentJobId && <div className="mt-1 break-all font-mono text-[10px] text-muted">Job {live.currentJobId}</div>}
                        {live.finalAssetPath && <div className="mt-1 break-all font-mono text-[10px] text-muted">Workflow output {live.finalAssetPath}</div>}
                        {live.savedAsset && <div className="mt-1 break-all font-mono text-[10px] text-emerald-300">Dev Portal asset {live.savedAsset.savedPath}<br />SHA-256 {live.savedAsset.sha256}<br />Lineage {live.savedAsset.lineagePath}</div>}
                        {live.portableExport && <div className="mt-1 break-all font-mono text-[10px] text-gold">Portable export {live.portableExport.destinationPath}<br />SHA-256 {live.portableExport.sha256}</div>}
                        {live.finalSource && <button type="button" className="mt-2 rounded-md border border-gold/40 px-2 py-1 text-[11px] text-gold hover:border-gold" onClick={() => onAwaitingApprovalJobChange?.(live.finalSource!.jobId)}>Open final revision</button>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {batch && (
            <div className={`rounded-lg border p-3 ${statusTone(batch.state)}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {batch.state === "complete" ? <CheckCircle2 size={16} /> : batch.state === "failed" ? <XCircle size={16} /> : <Loader2 size={16} className={active && batch.state !== "awaiting-approval" ? "animate-spin" : ""} />}
                  {batch.state.replaceAll("-", " ")}
                </span>
                <span className="font-mono text-[10px] opacity-80">Batch {batch.id}</span>
              </div>
              <p className="mt-2 text-xs leading-5">{batch.message}</p>
              {batch.acceptance && (
                <div className={`mt-3 rounded-md border p-3 ${batch.acceptance.eligible ? "border-emerald-300/40 bg-black/20" : "border-red-300/40 bg-black/20"}`}>
                  <div className="text-xs font-bold">Strict acceptance {batch.acceptance.eligible ? "eligible" : "disqualified"}</div>
                  <div className="mt-1 text-[11px]">Six-item profile · restores {batch.acceptance.restoreCount} · retries {batch.acceptance.retryCount} · service run {batch.acceptance.serviceRunId}</div>
                  {batch.acceptance.receiptPath
                    ? <div className="mt-2 break-all font-mono text-[10px]">Sealed receipt {batch.acceptance.receiptPath}<br />SHA-256 {batch.acceptance.receiptSha256}</div>
                    : <div className="mt-1 text-[10px]">The receipt is sealed only after six unique batch-bound managed assets and six verified portable outputs exist.</div>}
                </div>
              )}
              {awaitingApprovalJobId && (
                <div className="mt-3 rounded-md border border-amber-300/45 bg-black/20 p-3">
                  <div className="text-xs font-bold">Exact visual approval required in the parent panel</div>
                  <div className="mt-1 break-all font-mono text-xs">Job {awaitingApprovalJobId}</div>
                  <div className="mt-1 text-[11px]">Open the retained concept, geometry, texture or animation revision identified by this job, inspect it, and persist its exact approval. The serial run resumes automatically.</div>
                  <button type="button" className="mt-2 rounded border border-amber-300/50 px-2 py-1 text-[11px] font-semibold" onClick={() => onAwaitingApprovalJobChange?.(awaitingApprovalJobId)}>Open exact revision</button>
                </div>
              )}
              <div className="mt-2 break-all text-[10px] opacity-75">Manifest: {batch.manifestPath}</div>
            </div>
          )}

          {error && <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-200">{error}</div>}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
              disabled={queueLocked || Boolean(batch) || items.length === 0 || !batchName.trim() || !strictReady}
              onClick={() => void startBatch()}
            >
              {starting ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Start one serial batch
            </button>
            {batch && active && (
              <button type="button" disabled={cancelling} className="inline-flex items-center gap-2 rounded-lg border border-red-500/50 px-3 py-2 text-sm text-red-300 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void cancelBatch()}>
                {cancelling ? <Loader2 size={15} className="animate-spin" /> : <XCircle size={15} />} Cancel batch
              </button>
            )}
            {batch && (batch.state === "failed" || batch.state === "cancelled") && (
              <button type="button" disabled={retrying || cancelling} className="inline-flex items-center gap-2 rounded-lg border border-gold/50 px-3 py-2 text-sm text-gold disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void retryBatch()}>
                {retrying ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={14} />} Retry current item
              </button>
            )}
            {batch && !active && (
              <button type="button" disabled={exporting || retrying || cancelling} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40" onClick={resetCompletedBatch}>
                <RotateCcw size={14} /> Clear retained run
              </button>
            )}
            {batch?.state === "complete" && (
              <button type="button" disabled={exporting || batch.items.some((item) => !item.savedAsset)} className="inline-flex items-center gap-2 rounded-lg border border-gold/50 px-3 py-2 text-sm text-gold disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void exportAll()}>
                {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Export all portable GLBs
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
