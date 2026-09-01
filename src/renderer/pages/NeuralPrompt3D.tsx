import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Box, CheckCircle2, ChevronDown, ChevronUp, Cpu, Download, FolderOpen, HardDrive, Loader2, Play, RefreshCw, ShieldCheck, Square, Trash2, WandSparkles, XCircle } from "lucide-react";
import { toast } from "sonner";
import Model3DViewer from "../components/viewers/Model3DViewer";
import { loadPrompt3DDraft, savePrompt3DDraft } from "../lib/prompt3dDraft";
import { compilePrompt3DPrompt } from "../../shared/prompt3dRules";
import { conceptBindingMatchesSpec } from "../../shared/conceptWorkflow";
import {
  PROMPT3D_SPEC_VERSION,
  type AssetCategory,
  type AssetSpecV1,
  type LocalPrompt3DProviderId,
  type Prompt3DComplianceState,
  type Prompt3DInstallStatus,
  type Prompt3DJobStatus,
  type Prompt3DOverview,
  type Prompt3DPlanResult,
  type Prompt3DAppRuntime,
  type Prompt3DHistory,
} from "../../shared/prompt3d";

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

function bytes(value: number) { return `${(value / GiB).toFixed(value >= 10 * GiB ? 0 : 1)} GiB`; }
function elapsed(value?: number) { return value == null ? "in progress" : value < 1_000 ? `${value} ms` : `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)} s`; }
function destination(root: string, id: string) { return `${root.replace(/[\\/]+$/, "")}\\${id}`; }

function defaultSpec(): AssetSpecV1 {
  return {
    version: PROMPT3D_SPEC_VERSION,
    prompt: "A weathered cast-iron street lamp with a square stone base, clean silhouette, no lettering",
    category: "road-furniture",
    style: "stylized",
    route: "concept-image-to-3d",
    targetFormat: "glb",
    dimensions: { width: 0.65, height: 3.2, depth: 0.65, unit: "m" },
    budgets: { maxTriangles: 50_000, maxTextureResolution: 2048, maxTextureBytes: 32 * 1024 * 1024 },
    seed: 42,
    variants: 1,
    providerId: "hunyuan3d-2",
    generateTextures: true,
    generateCollision: false,
    generateLods: false,
    coordinateContract: { upAxis: "+Y", forwardAxis: "+Z", origin: "ground-center", stableRootName: "GrudgeAssetRoot" },
  };
}

export default function Prompt3D() {
  const [spec, setSpec] = useState<AssetSpecV1>(() => loadPrompt3DDraft(defaultSpec()));
  const [overview, setOverview] = useState<Prompt3DOverview | null>(null);
  const [controlsEnabled, setControlsEnabled] = useState(false);
  const [controlsReady, setControlsReady] = useState(false);
  const [controlsSaving, setControlsSaving] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [installStates, setInstallStates] = useState<Record<string, Prompt3DInstallStatus>>({});
  const [job, setJob] = useState<Prompt3DJobStatus | null>(null);
  const [previousResult, setPreviousResult] = useState<Prompt3DJobStatus | null>(null);
  const [visualAccepted, setVisualAccepted] = useState<Record<string, boolean>>({});
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const initialSpec = useRef(spec);
  const currentSpec = useRef(spec);
  currentSpec.current = spec;
  const [busy, setBusy] = useState(false);
  const [plannerBusy, setPlannerBusy] = useState(false);
  const [plannerResult, setPlannerResult] = useState<Prompt3DPlanResult["planner"] | null>(null);
  const [selectedVariant, setSelectedVariant] = useState(0);
  const [editedConceptParent, setEditedConceptParent] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  const refresh = async (nextSpec = spec) => {
    try {
      const data: Prompt3DOverview = await window.grudge.prompt3d.overview(nextSpec);
      setOverview(data);
      const next: Record<string, Prompt3DInstallStatus> = {};
      data.providers.forEach((p) => { if (p.install) next[p.manifest.id] = p.install; });
      setInstallStates((old) => ({ ...old, ...next }));
    } catch (error) { toast.error("Could not inspect local generator readiness", { description: String(error) }); }
  };

  useEffect(() => {
    let active = true;
    let receivedProgress = false;
    void window.grudge.prompt3d.draft().then((saved: AssetSpecV1 | null) => {
      if (active && saved && currentSpec.current === initialSpec.current) setSpec(saved);
    }).catch((error: unknown) => {
      if (active) setAutosaveError(`Could not restore saved brief: ${String(error)}`);
    }).finally(() => { if (active) setDraftReady(true); });
    void window.grudge.appRuntime().then((runtime: Prompt3DAppRuntime) => {
      if (active) setControlsEnabled(runtime.localControlsEnabled === true);
    }).catch((error: unknown) => {
      if (active) toast.error("Could not restore local controls", { description: String(error) });
    }).finally(() => { if (active) setControlsReady(true); });
    void window.grudge.prompt3d.history().then((history: Prompt3DHistory) => {
      if (!active) return;
      if (!receivedProgress) setJob(history.latestJob);
      setPreviousResult((current) => current ?? history.previousResult);
    }).catch((error: unknown) => { if (active) toast.error("Could not restore saved results", { description: String(error) }); });
    void refresh();
    const offInstall = window.grudge.prompt3d.onInstallProgress((value: Prompt3DInstallStatus) => { setInstallStates((old: Record<string, Prompt3DInstallStatus>) => ({ ...old, [value.providerId]: value })); void refresh(); });
    const offJob = window.grudge.prompt3d.onJobProgress((value: Prompt3DJobStatus) => {
      receivedProgress = true;
      setJob(value);
      if (value.state === "complete" && value.variants.some(v => v.report.gameReady)) setPreviousResult(value);
    });
    return () => { active = false; offInstall?.(); offJob?.(); };
  }, []);

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
  useEffect(() => { if (spec.providerId === "hunyuan3d-2" && spec.variants !== 1) setSpec((current) => ({ ...current, variants: 1 })); }, [spec.providerId, spec.variants]);

  const providers = overview?.providers ?? [];
  const selected = providers.find((p) => p.manifest.id === spec.providerId);
  const localProviders = providers.filter((p) => p.manifest.kind === "local");
  const cloudProviders = providers.filter((p) => p.manifest.kind === "cloud");
  const resultJob = job?.state === "complete" && job.variants.length
    ? job : previousResult ?? (job?.variants.length ? job : null);
  const result = resultJob?.variants[selectedVariant] ?? resultJob?.variants[0];
  const conceptRejected = job?.error?.code === "CONCEPT_QUALITY_REJECTED";
  const stricterReview = spec.category === "character" || spec.category === "vehicle";
  const availableRoutes = selected?.manifest.enabledRoutes ?? [];
  const bothLocalUnsupported = localProviders.length > 0 && localProviders.every((p) => p.compliance.state === "unsupported");

  const patchSpec = <K extends keyof AssetSpecV1>(key: K, value: AssetSpecV1[K]) => setSpec((old) => ({ ...old, [key]: value }));
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
    setBusy(true);
    try {
      const next: Prompt3DJobStatus = await window.grudge.prompt3d.start({
        spec,
        ...(editedConceptParent ? { parentConceptJobId: editedConceptParent, conceptChangeReason: "edited" as const } : {}),
        consent: { providerId: spec.providerId, confirmed: true, externalData: [], estimatedCostUsd: 0 },
      });
      setEditedConceptParent(null);
      setJob(next);
      toast.success(spec.providerId === "hunyuan3d-2" ? "Local concept generation started" : "Local generation started");
    } catch (error) { toast.error("Generation is not available yet", { description: String(error) }); }
    finally { setBusy(false); }
  };

  const approveConcept = async () => {
    if (!controlsEnabled || !job?.conceptAttempt) return;
    setBusy(true);
    try {
      const next: Prompt3DJobStatus = await window.grudge.prompt3d.approveConcept({ jobId: job.id, binding: job.conceptAttempt.binding });
      setJob(next);
      toast.success("Exact concept approval retained", { description: "Current GPU headroom is being rechecked before geometry." });
    } catch (error) { toast.error("Concept approval did not start geometry", { description: String(error) }); }
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
    setSpec(job.spec);
    setEditedConceptParent(job.id);
    setPlannerResult(null);
    requestAnimationFrame(() => {
      promptRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      promptRef.current?.focus();
    });
    toast.message("Editing a new retained attempt", { description: "The previous concept and its exact prompt remain unchanged in history." });
  };

  const planFields = async () => {
    if (!controlsEnabled) return;
    setPlannerBusy(true);
    try {
      const planned: Prompt3DPlanResult = await window.grudge.prompt3d.plan({ currentSpec: spec });
      setSpec(planned.spec);
      setPlannerResult(planned.planner);
      toast.success("Local planning fields applied", { description: `Planner only · ${planned.planner.model}` });
    } catch (error) {
      toast.error("Local Ollama planner is unavailable", { description: String(error) });
    } finally {
      setPlannerBusy(false);
    }
  };

  const awaitingConcept = job?.state === "awaiting-concept-approval";
  const conceptMatchesCurrentDraft = Boolean(job?.conceptAttempt && conceptBindingMatchesSpec(job.conceptAttempt.binding, spec));
  const pendingConceptAllowsEditedAttempt = Boolean(awaitingConcept && editedConceptParent === job?.id && !conceptMatchesCurrentDraft);
  const canGenerate = Boolean(controlsEnabled && selected?.compliance.canRun && !busy && !plannerBusy && job?.state !== "running" && (!awaitingConcept || pendingConceptAllowsEditedAttempt) && !stricterReview);

  return (
    <div className="space-y-4 pb-5 text-fg">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><WandSparkles className="text-gold" size={22} /><h1 className="page-title mb-0">Prompt to 3D</h1></div>
            <p className="page-sub mb-0 mt-1 max-w-4xl text-sm">Describe a prop or environment piece, generate it with an honest local 3D provider, then validate and quarantine before it can enter the asset pipeline.</p>
          </div>
          <div className="flex gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-gold/50 bg-gold/10 px-3 py-2 text-sm text-gold" title="Remembered on this computer, including after restarting the app.">
              <input type="checkbox" checked={controlsEnabled} disabled={!controlsReady || controlsSaving} onChange={(event) => void changeControls(event.target.checked)} />
              <span>Enable local controls<span className="block text-[10px] text-muted">{controlsSaving ? "Saving…" : "Remembered on this computer"}</span></span>
            </label>
            <button className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-fg" onClick={() => void refresh()}><RefreshCw className="mr-2 inline" size={14} />Recheck hardware</button>
          </div>
        </header>

        {overview?.runtime.offlineLocalTest && <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200"><ShieldCheck className="mr-2 inline" size={16} />Offline local-test mode: fleet probes, updater, Docker/Ollama management, remote webviews, cloud fallback and production contact are disabled.</div>}

        <section className={card}>
          <button className="flex w-full items-center justify-between p-4 text-left" onClick={() => setSetupOpen((v) => !v)}>
            <div><div className="font-semibold"><Download className="mr-2 inline text-gold" size={17} />Install local 3D generators</div><div className="mt-1 text-xs text-muted">Nothing installs on startup. Each provider is isolated, pinned, cancellable and separately licensed.</div></div>
            {setupOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </button>
          {setupOpen && <div className="space-y-3 border-t border-line p-4">
            {overview && <div className="grid min-w-0 grid-cols-1 gap-2 rounded-lg border border-line bg-bg p-3 text-[11px] text-muted sm:grid-cols-2 xl:grid-cols-5">
              <div><b className="text-fg">GPU</b><br />{overview.hardware.gpu?.model ?? "Not detected"}<br />{bytes(overview.hardware.gpu?.totalVramBytes ?? 0)} total · {bytes(overview.hardware.gpu?.freeVramBytes ?? 0)} free</div>
              <div><b className="text-fg">System RAM</b><br />{bytes(overview.hardware.systemRam.totalBytes)} total<br />{bytes(overview.hardware.systemRam.freeBytes)} free</div>
              <div><b className="text-fg">Generator disk</b><br /><span className="break-all font-mono">{overview.hardware.disk.path}</span><br />{bytes(overview.hardware.disk.freeBytes)} free</div>
              <div><b className="text-fg">Platform</b><br />{overview.hardware.os.version}<br />{overview.hardware.wsl.usableLinuxDistribution ? `${overview.hardware.wsl.usableLinuxDistribution} · WSL ${overview.hardware.wsl.distributionVersions[overview.hardware.wsl.usableLinuxDistribution] ?? "?"}` : `WSL ${overview.hardware.wsl.version ?? "not detected"} · normal user setup needed`}</div>
              <div><b className="text-fg">CUDA / Python</b><br />Toolkit {overview.hardware.cudaToolkit.available ? overview.hardware.cudaToolkit.version ?? "detected" : "not on Windows PATH"}<br />{overview.hardware.python.map((item) => item.version).join(" · ") || "isolated runtime will be installed"}</div>
            </div>}
            <div className="flex w-full min-w-0 flex-col gap-3">{localProviders.map((row) => {
              const manifest = row.manifest, compliance = row.compliance, status = installStates[manifest.id] ?? row.install;
              const providerId = manifest.id as LocalPrompt3DProviderId;
              const primaryAction = status?.state === "installed" || status?.state === "repair-needed" ? "repair" : "install";
              return <article key={manifest.id} className="w-full min-w-0 rounded-lg border border-line bg-bg p-4">
                <div className="flex items-start justify-between gap-2"><div><h2 className="font-semibold">{manifest.name}</h2><p className="mt-1 text-xs text-muted">{manifest.summary}</p></div><span className={`whitespace-nowrap rounded-full border px-2 py-1 text-[11px] ${stateStyle[compliance.state]}`}>{stateLabel[compliance.state]}</span></div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded bg-bg-2 p-2"><HardDrive className="mr-1 inline" size={13} />Download estimate <b>{bytes(manifest.downloadBytes)}</b><br />Installed estimate <b>{bytes(manifest.installedBytes)}</b><br />Free disk required <b>{bytes(manifest.requiredFreeDiskBytes)}</b></div><div className="rounded bg-bg-2 p-2"><Cpu className="mr-1 inline" size={13} />Physical VRAM <b>{bytes(manifest.physicalVramBytes)}</b><br />Run headroom <b>{bytes(manifest.runVramBytes.textured)}</b><br />System RAM <b>{bytes(manifest.systemRamBytes)}</b></div></div>
                <div className="mt-2 text-[11px] text-muted">Provider source, models, and jobs: <span className="font-mono text-fg">{overview ? destination(overview.runtime.root, manifest.id) : "…"}</span><br />Compatibility interpreter: <span className="font-mono text-fg">normal-user {overview?.hardware.wsl.usableLinuxDistribution ?? "Ubuntu-24.04"} · provider execution remains rooted on the selected drive</span></div>
                <div className="mt-2 break-all text-[11px] text-muted">Official source: <span className="text-fg">{manifest.sourceUrl}</span><br />Revision <span className="font-mono text-fg">{manifest.sourceRevision}</span></div>
                <div className="mt-2 text-[11px] text-muted">License: <span className="text-fg">{manifest.licenseName}</span><br /><span className="break-all">{manifest.licenseUrl}</span></div>
                <ul className="mt-2 space-y-1 text-[11px] text-muted">{compliance.reasons.map((reason, i) => <li key={i}>• {reason}</li>)}</ul>
                <details className="mt-2 text-xs"><summary className="cursor-pointer text-muted">Pinned models, components and tradeoffs</summary><div className="mt-2 space-y-1 text-[11px] text-muted">{manifest.modelSources.map((model) => <div key={model.id} className="break-all">• {model.id} @ <span className="font-mono">{model.revision}</span> · {bytes(model.estimatedDownloadBytes)} — {model.purpose}</div>)}{manifest.sourceDependencies.map((dependency) => <div key={dependency.id} className="break-all">• {dependency.id} @ <span className="font-mono">{dependency.revision}</span> — {dependency.purpose}</div>)}</div><ul className="mt-2 space-y-1 text-muted">{manifest.requiredComponents.map((item) => <li key={item}>• {item}</li>)}</ul><p className="mt-2">{manifest.qualitySpeed}</p><p className="mt-1">{manifest.platform}</p></details>
                {status && <div className="mt-3"><div className="flex justify-between text-[11px]"><span className="capitalize">{status.state.replace("-", " ")} · {status.stage}</span><span>{status.progress}%</span></div><div className="mt-1 h-1.5 rounded bg-line"><div className="h-full rounded bg-gold transition-all" style={{ width: `${status.progress}%` }} /></div><p className="mt-1 text-[11px] text-muted">Measured provider footprint {bytes(status.bytesCompleted)} · declared download estimate {bytes(status.bytesTotal)}</p>{status.message && <p className="mt-1 text-[11px] text-muted">{status.message}</p>}</div>}
                <label className="mt-3 flex items-start gap-2 text-[11px] text-muted"><input type="checkbox" checked={Boolean(accepted[providerId])} onChange={(e) => setAccepted((old) => ({ ...old, [providerId]: e.target.checked }))} /><span>I reviewed the official source, pinned revisions, download size, provider destination, normal-user WSL requirement, and <b className="text-fg">{manifest.licenseName}</b> for this installation.</span></label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button disabled={!controlsEnabled || !accepted[providerId] || !compliance.canInstall || status?.state === "installing" || busy} className="rounded bg-gold px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-35" onClick={() => void install(providerId, primaryAction)}>{status?.state === "installed" ? "Repair / verify" : status?.state === "repair-needed" ? "Repair / resume" : "Install"}</button>
                  {status?.state === "installing" && <button className="rounded border border-line px-3 py-1.5 text-xs" onClick={() => controlsEnabled && window.grudge.prompt3d.cancelInstall(providerId)}><Square className="mr-1 inline" size={11} />Cancel</button>}
                  {status?.state === "installed" && <button className="rounded border border-line px-3 py-1.5 text-xs text-red-300" onClick={() => void install(providerId, "remove")}><Trash2 className="mr-1 inline" size={11} />Remove</button>}
                </div>
              </article>;
            })}</div>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-bg px-3 py-2 text-xs"><span className="min-w-0 break-all text-muted">Generator storage: <span className="font-mono text-fg">{overview?.runtime.root ?? "measuring…"}</span></span><button disabled={!controlsEnabled} className="shrink-0 rounded border border-line px-2 py-1 disabled:opacity-35" onClick={async () => { if (controlsEnabled && await window.grudge.prompt3d.chooseRoot()) void refresh(); }}><FolderOpen className="mr-1 inline" size={13} />Choose destination</button></div>
          </div>}
        </section>

        <div className="min-w-0 space-y-4">
          <section className={`${card} min-w-0 p-4 space-y-3`}>
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Asset brief</h2><span className="text-[11px] text-muted">Autosave on · {draftSaving ? "Saving…" : draftReady && !autosaveError ? "Saved" : "Loading…"} · Retain previous result on</span></div>
            {autosaveError && <p role="alert" className="text-xs text-red-300">Could not autosave this brief: {autosaveError}</p>}
            <label className="block text-xs text-muted">Prompt<textarea ref={promptRef} className={`${input} mt-1 min-h-24 resize-y`} value={spec.prompt} maxLength={2000} onChange={(e) => { patchSpec("prompt", e.target.value); setPlannerResult(null); }} /></label>
            {editedConceptParent && <p className="rounded border border-sky-500/30 bg-sky-500/10 p-2 text-xs text-sky-200">Editing a new attempt from retained job <span className="font-mono">{editedConceptParent.slice(0, 8)}</span>. Generating will preserve the previous concept and append explicit ancestry.</p>}
            <p className="text-xs text-muted">Object and attachment constraints are inferred internally from the prompt and Category. The optional local planner can refine the brief; no separate Object/Component selector is required.</p>
            <div className="rounded-lg border border-line bg-bg p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2"><div><b>Optional local planner</b><p className="mt-1 text-[11px] text-muted">Ollama can propose typed brief fields only. It does not generate meshes, start a service, pull models, run code, or contact a non-loopback host.</p></div><button disabled={!controlsEnabled || plannerBusy || busy} className="rounded border border-line px-3 py-2 disabled:opacity-35" onClick={() => void planFields()}>{plannerBusy ? <Loader2 className="mr-1 inline animate-spin" size={13} /> : <WandSparkles className="mr-1 inline" size={13} />}Plan fields with local Ollama</button></div>
              {plannerResult && <div className="mt-2 rounded border border-emerald-500/20 bg-emerald-500/5 p-2 text-[11px]"><span className="text-emerald-300">Planner only · {plannerResult.model} · loopback</span><p className="mt-1 text-muted">{plannerResult.summary}</p>{plannerResult.warnings.length > 0 && <ul className="mt-1 text-amber-300">{plannerResult.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul>}</div>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-muted">Category<select className={`${input} mt-1`} value={spec.category} onChange={(e) => patchSpec("category", e.target.value as AssetCategory)}>{["prop", "building", "road-furniture", "environment", "character", "vehicle"].map((v) => <option key={v}>{v}</option>)}</select></label>
              <label className="text-xs text-muted">Style<select className={`${input} mt-1`} value={spec.style} onChange={(e) => patchSpec("style", e.target.value as any)}>{["realistic", "stylized", "low-poly", "hand-painted", "industrial", "custom"].map((v) => <option key={v}>{v}</option>)}</select></label>
            </div>
            {spec.style === "custom" && <label className="block text-xs text-muted">Custom style<input className={`${input} mt-1`} value={spec.customStyle ?? ""} maxLength={200} onChange={(e) => patchSpec("customStyle", e.target.value)} placeholder="Describe materials, era, palette and surface treatment" /></label>}
            <label className="block text-xs text-muted">Generation route<select className={`${input} mt-1`} value={spec.route} onChange={(e) => patchSpec("route", e.target.value as AssetSpecV1["route"])}>{availableRoutes.map((route) => <option key={route} value={route}>{route === "direct-text" ? "Direct text to structured 3D (TRELLIS)" : "Prompt to concept image to 3D (Hunyuan)"}</option>)}</select><span className="mt-1 block text-[11px]">TRELLIS image conditioning is an upstream capability but remains disabled until typed reference-image intake is present; the enabled prompt-only route uses its official direct-text model. Hunyuan makes the stronger concept-image stage visible.</span></label>
            {stricterReview && <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200"><AlertTriangle className="mr-1 inline" size={14} />This neural integration does not support character rigs or vehicles. Original procedural creation supports a new segmented Character and articulated dance. Select that method explicitly; no engine substitution occurs.</div>}
            <div className="grid grid-cols-4 gap-2"><label className="text-xs text-muted">Width<input type="number" className={`${input} mt-1`} value={spec.dimensions.width} onChange={(e) => patchSpec("dimensions", { ...spec.dimensions, width: Number(e.target.value) })} /></label><label className="text-xs text-muted">Height<input type="number" className={`${input} mt-1`} value={spec.dimensions.height} onChange={(e) => patchSpec("dimensions", { ...spec.dimensions, height: Number(e.target.value) })} /></label><label className="text-xs text-muted">Depth<input type="number" className={`${input} mt-1`} value={spec.dimensions.depth} onChange={(e) => patchSpec("dimensions", { ...spec.dimensions, depth: Number(e.target.value) })} /></label><label className="text-xs text-muted">Units<select className={`${input} mt-1`} value={spec.dimensions.unit} onChange={(e) => patchSpec("dimensions", { ...spec.dimensions, unit: e.target.value as "m" | "cm" })}><option value="m">metres</option><option value="cm">cm</option></select></label></div>
            <div className="grid grid-cols-3 gap-3"><label className="text-xs text-muted">Target format<select className={`${input} mt-1`} value={spec.targetFormat} disabled><option value="glb">GLB</option></select></label><label className="text-xs text-muted">Triangle budget<input type="number" className={`${input} mt-1`} min={100} max={2_000_000} value={spec.budgets.maxTriangles} onChange={(e) => patchSpec("budgets", { ...spec.budgets, maxTriangles: Number(e.target.value) })} /></label><label className="text-xs text-muted">Texture resolution<select className={`${input} mt-1`} value={spec.budgets.maxTextureResolution} onChange={(e) => patchSpec("budgets", { ...spec.budgets, maxTextureResolution: Number(e.target.value) as AssetSpecV1["budgets"]["maxTextureResolution"] })}>{[512,1024,2048,4096].map((v) => <option key={v} value={v}>{v} × {v}</option>)}</select></label></div>
            <label className="block text-xs text-muted">Texture file budget (MiB)<input type="number" className={`${input} mt-1`} min={1} max={512} value={Math.round(spec.budgets.maxTextureBytes / 1024 ** 2)} onChange={(e) => patchSpec("budgets", { ...spec.budgets, maxTextureBytes: Math.round(Number(e.target.value) * 1024 ** 2) })} /></label>
            {spec.providerId === "hunyuan3d-2" && <div className="rounded border border-gold/30 bg-gold/5 p-3 text-xs text-gold"><b>Mandatory concept approval:</b> Generate creates and retains one concept only. Geometry cannot load until you inspect that exact image and click Approve for 3D.</div>}
            <label className="block text-xs text-muted">Proportions<select className={`${input} mt-1`} value={spec.scaleMode ?? "preserve"} onChange={e=>patchSpec("scaleMode",e.target.value as "preserve"|"exact")}><option value="preserve">Preserve shape · scale uniformly to height</option><option value="exact">Stretch to exact width, height and depth</option></select></label>
            <p className="text-xs text-muted">Width is left–right (X), height is up–down (Y), depth is front–back (Z). Review a complete concept before spending GPU time on geometry.</p>
            <div className="grid grid-cols-2 gap-3"><label className="text-xs text-muted">Seed<input type="number" className={`${input} mt-1`} value={spec.seed} onChange={(e) => patchSpec("seed", Number(e.target.value))} /></label><label className="text-xs text-muted">Variants<select className={`${input} mt-1`} value={spec.providerId === "hunyuan3d-2" ? 1 : spec.variants} disabled={spec.providerId === "hunyuan3d-2"} onChange={(e) => patchSpec("variants", Number(e.target.value))}>{[1,2,3,4].map((v) => <option key={v}>{v}</option>)}</select><span className="mt-1 block text-[10px]">{spec.providerId === "hunyuan3d-2" ? "One concept per explicit approval." : "Direct provider variants."}</span></label></div>
            <div className="flex flex-wrap gap-4 text-xs"><label><input type="checkbox" checked={spec.generateTextures} onChange={(e) => patchSpec("generateTextures", e.target.checked)} /> <span className="ml-1">Textures</span></label><label><input type="checkbox" checked={spec.generateCollision} onChange={(e) => patchSpec("generateCollision", e.target.checked)} /> <span className="ml-1">Collision</span></label><label><input type="checkbox" checked={spec.generateLods} onChange={(e) => patchSpec("generateLods", e.target.checked)} /> <span className="ml-1">LODs</span></label></div>

            <div className="border-t border-line pt-3"><h2 className="mb-2 font-semibold">Provider and privacy</h2><div className="space-y-2">{providers.map((row) => <label key={row.manifest.id} className={`flex gap-3 rounded-lg border p-3 ${spec.providerId === row.manifest.id ? "border-gold/50 bg-gold/5" : "border-line"} ${!row.compliance.canRun ? "opacity-70" : "cursor-pointer"}`}><input type="radio" name="provider" checked={spec.providerId === row.manifest.id} disabled={row.compliance.state === "unsupported" || (row.manifest.kind === "cloud" && !row.cloudConfigured)} onChange={() => setSpec((old) => ({ ...old, providerId: row.manifest.id, variants: row.manifest.id === "hunyuan3d-2" ? 1 : old.variants, route: row.manifest.id === "trellis" ? "direct-text" : row.manifest.kind === "local" ? "concept-image-to-3d" : row.manifest.routes[0] }))} /><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><span className="text-sm font-medium">{row.manifest.name}</span><span className={`rounded-full border px-2 py-0.5 text-[10px] ${stateStyle[row.compliance.state]}`}>{stateLabel[row.compliance.state]}</span></div><div className="mt-1 text-[11px] text-muted">{row.manifest.routes.join(" · ")} · {row.manifest.kind === "local" ? "stays on this computer · estimated provider cost $0" : "sends prompt/reference data externally and may incur cost"}</div></div></label>)}</div></div>
            {cloudProviders.every((p) => !p.cloudConfigured) && localProviders.every((p) => !p.compliance.canRun) && (bothLocalUnsupported
              ? <div className="rounded border border-violet-500/30 bg-violet-500/10 p-3 text-xs text-violet-200"><b>Cloud only:</b> neither local backend can satisfy its physical/platform contract on this host. Cloud providers remain disabled until credentials are deliberately configured; a cloud run sends the prompt/reference data externally and may incur the displayed cost.</div>
              : <div className="rounded border border-line bg-bg p-3 text-xs text-muted">No generator can run yet. At least one local backend is physically/platform capable, so this is <b className="text-fg">not Cloud only</b>: finish local setup or wait for free VRAM. Cloud providers remain disabled because no credentials or cost/data consent are configured.</div>)}
            {selected && <div className="rounded-lg border border-line bg-bg p-3 text-xs"><div className="font-medium">{selected.manifest.geometry}</div><div className="mt-1 text-muted">{selected.manifest.textures}</div><div className="mt-2 text-muted">Required now: {bytes(selected.compliance.required.runVramBytes)} free VRAM · measured {bytes(selected.compliance.measured.freeVramBytes)}.</div></div>}
            <div className="flex gap-2"><button disabled={!canGenerate} className="flex-1 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-black disabled:opacity-35" onClick={() => void generate()}>{busy || job?.state === "running" ? <Loader2 className="mr-2 inline animate-spin" size={15} /> : <Play className="mr-2 inline" size={15} />}{spec.providerId === "hunyuan3d-2" ? "Generate concept for review" : "Generate locally"}</button>{job?.state === "running" && <button className="rounded-lg border border-line px-3" onClick={() => controlsEnabled && window.grudge.prompt3d.cancel(job.id)}><Square size={15} /></button>}{job && ["failed","cancelled"].includes(job.state) && !conceptRejected && <button className="rounded-lg border border-line px-3 text-xs" onClick={() => controlsEnabled && window.grudge.prompt3d.retry(job.id)}>Retry</button>}</div>
          </section>

          <section className={`${card} min-w-0 flex min-h-[700px] flex-col overflow-hidden`}>
            <div className="border-b border-line p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">Generation and validation</h2>{job && <span className="text-xs capitalize text-muted">{job.stage} · {job.progress}%</span>}</div>{job && <><div className="mt-2 h-2 rounded bg-line"><div className="h-full rounded bg-gold transition-all" style={{ width: `${job.progress}%` }} /></div><p className="mt-2 text-xs text-muted">{job.message}</p>{Boolean(job.timings?.length) && <div className="mt-3 grid gap-1 rounded border border-line bg-bg p-2">{job.timings!.map((timing, index) => <div key={`${timing.stage}-${timing.startedAt}-${index}`} className="flex items-start justify-between gap-3 text-[10px]"><span className={timing.status === "failed" ? "text-red-300" : timing.status === "running" ? "text-gold" : "text-muted"}>{timing.stage.replace(/-/g, " ")} · {timing.message}</span><span className="shrink-0 font-mono text-fg">{elapsed(timing.elapsedMs)}</span></div>)}</div>}</>}</div>
            {job?.autosaveError && <p role="alert" className="px-4 pt-3 text-xs text-red-300">Could not autosave job status: {job.autosaveError}. Generated files remain in the output folder.</p>}
            {job?.conceptImagePath && <div className="space-y-3 border-b border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">Saved concept review</b><span className={`rounded-full border px-2 py-1 text-[10px] ${awaitingConcept ? "border-amber-500/40 bg-amber-500/10 text-amber-200" : conceptRejected ? "border-red-500/40 bg-red-500/10 text-red-200" : job.conceptApproval ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-line text-muted"}`}>{awaitingConcept ? "Awaiting explicit approval" : conceptRejected ? "Technical regeneration required" : job.conceptApproval ? "Explicitly approved" : "Retained"}</span></div>
              <img key={job.conceptImagePath} className="max-h-72 w-full rounded border border-line bg-white object-contain" src={`local://${encodeURIComponent(job.conceptImagePath)}`} alt="Actual retained local generation concept" onError={e=>{e.currentTarget.style.display="none";}} />
              <div className="grid gap-2 text-[11px] md:grid-cols-2">
                <div className="rounded border border-line bg-bg p-2"><b>Exact current prompt</b><p className="mt-1 whitespace-pre-wrap text-muted">{job.spec.prompt}</p></div>
                <div className="rounded border border-line bg-bg p-2"><b>Bound generation identity</b><p className="mt-1 text-muted">Provider {job.providerId}<br />Seed {job.spec.seed}<br />AssetSpec {job.spec.version}<br />Concept SHA-256 <span className="font-mono">{job.conceptAttempt?.binding.conceptSha256.slice(0, 16) ?? "unavailable"}…</span></p></div>
              </div>
              <details open className="rounded border border-line bg-bg p-2 text-[11px]"><summary className="cursor-pointer font-medium">Prompt plan used for this exact concept</summary><p className="mt-2 text-muted"><b className="text-fg">Generation:</b> {job.promptPlan?.generationPrompt ?? compilePrompt3DPrompt(job.spec).generationPrompt}</p><p className="mt-1 text-muted"><b className="text-fg">Negative:</b> {job.promptPlan?.negativePrompt ?? compilePrompt3DPrompt(job.spec).negativePrompt}</p></details>
              <div className={`rounded border p-3 text-xs ${conceptRejected ? "border-red-500/30 bg-red-500/10 text-red-200" : "border-sky-500/30 bg-sky-500/10 text-sky-200"}`}><b>Deterministic technical review</b><p className="mt-1">{job.conceptAttempt?.technicalReview.message ?? (conceptRejected ? "Framing/background checks require regeneration." : "Technical review metadata is unavailable; approval fails closed.")}</p><p className="mt-1 text-[10px] opacity-80">Method: {job.conceptAttempt?.technicalReview.method ?? "unknown"}. These checks do not identify the object or its required parts.</p></div>
              <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200"><b>Manual semantic checklist — not checked automatically</b><p className="mt-1">{job.promptPlan?.review ?? compilePrompt3DPrompt(job.spec).review}</p><p className="mt-1">Compare the image with the exact prompt. Approval means you personally accept its identity, required parts, silhouette and completeness for 3D conditioning.</p></div>
              {awaitingConcept && !conceptMatchesCurrentDraft && <p className="rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200">The editable brief no longer matches this concept. Approval is disabled. Use Edit prompt to restore the retained brief, or generate a new concept after making your change.</p>}
              {(awaitingConcept || conceptRejected) && <div className="flex flex-wrap gap-2">
                {awaitingConcept && <button disabled={!controlsEnabled || busy || !selected?.compliance.canRun || !conceptMatchesCurrentDraft || !job.conceptAttempt} className="rounded bg-gold px-3 py-2 text-xs font-semibold text-black disabled:opacity-35" onClick={() => void approveConcept()}>Approve for 3D</button>}
                <button disabled={!controlsEnabled || busy || !selected?.compliance.canRun || !job.conceptAttempt} className="rounded border border-line px-3 py-2 text-xs disabled:opacity-35" onClick={() => void regenerateConcept()}>Regenerate concept with new seed</button>
                <button disabled={busy || !job.conceptAttempt} className="rounded border border-line px-3 py-2 text-xs disabled:opacity-35" onClick={editPrompt}>Edit prompt</button>
              </div>}
              {Boolean(job.conceptAttempts?.length) && <details className="rounded border border-line bg-bg p-2 text-[11px]"><summary className="cursor-pointer">Immutable concept attempt history ({job.conceptAttempts!.length})</summary><div className="mt-2 space-y-2">{job.conceptAttempts!.map((attempt) => <div key={attempt.binding.attemptId} className="rounded border border-line/70 p-2"><b>Attempt {attempt.attemptNumber} · seed {attempt.binding.seed}</b><p className="mt-1 text-muted">{attempt.binding.prompt}</p><p className="mt-1 font-mono text-[10px] text-muted">{attempt.binding.conceptSha256}</p></div>)}</div></details>}
            </div>}
            {!job && !result && <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-muted"><Box size={52} className="mb-3 opacity-30" /><p className="text-sm">A preview will appear here.</p><p className="mt-1 max-w-md text-xs">Technical checks inspect the GLB and budgets. You still need to approve the resemblance and completeness.</p></div>}
            {resultJob && result && <div className="flex flex-1 flex-col overflow-auto p-4">
              {resultJob.id !== job?.id && <p className="mb-3 text-xs text-gold">Previous result retained while the next generation is pending or unavailable.</p>}
              {resultJob.variants.length > 1 && <div className="mb-3 flex gap-2">{resultJob.variants.map((v, i) => <button key={i} className={`rounded border px-3 py-1 text-xs ${selectedVariant === i ? "border-gold text-gold" : "border-line"}`} onClick={() => setSelectedVariant(i)}>Variant {i + 1}</button>)}</div>}
              {result.report.gameReady ? <div className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200"><AlertTriangle className="mr-2 inline" size={16} />Technical checks passed · visual approval required</div> : <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"><XCircle className="mr-2 inline" size={16} />Quarantined: failed assets cannot publish or upload</div>}
              <div className="min-h-[360px] overflow-hidden rounded-lg border border-line"><Model3DViewer asset={{ name: "prompt3d-asset.glb", url: `local://${encodeURIComponent(result.glbPath)}`, localPath: result.glbPath, contentType: "model/gltf-binary", size: 0 }} /></div>
              <div className="mt-3 grid gap-3 md:grid-cols-2"><div className="rounded-lg border border-line bg-bg p-3"><h3 className="text-sm font-medium">Validation report</h3><div className="mt-2 max-h-52 space-y-1 overflow-auto">{result.report.checks.map((c) => <div key={c.id} className="flex items-start gap-2 text-[11px]">{c.status === "pass" ? <CheckCircle2 size={13} className="mt-0.5 text-emerald-400" /> : c.status === "warning" ? <AlertTriangle size={13} className="mt-0.5 text-amber-400" /> : <XCircle size={13} className="mt-0.5 text-red-400" />}<span><b>{c.id}</b> — {c.message}</span></div>)}</div></div><div className="rounded-lg border border-line bg-bg p-3 text-xs"><h3 className="text-sm font-medium">Provenance</h3><p className="mt-2 text-muted">Provider: {resultJob.providerId}<br />AssetSpec: {resultJob.spec.version}<br />Seed: {resultJob.spec.seed}<br />Validation ID: <span className="font-mono">{result.report.deterministicId.slice(0,16)}…</span><br />License/source metadata: saved beside output</p></div></div>
              <label className="mt-3 text-xs"><input type="checkbox" checked={Boolean(visualAccepted[result.glbPath])} onChange={e=>setVisualAccepted({...visualAccepted,[result.glbPath]:e.target.checked})} /> I inspected every side and accept the shape and completeness.</label>
              <div className="mt-3 flex flex-wrap gap-2"><button className="rounded border border-line px-3 py-2 text-xs" onClick={() => window.grudge.viewer.openLocal({ path: result.glbPath, contentType: "model/gltf-binary" })}>Open full preview</button><button className="rounded border border-gold/50 px-3 py-2 text-xs text-gold" onClick={async()=>{sessionStorage.setItem("grudge.forge.pendingLocalPath",result.glbPath);await window.grudge.app.openRoute("/forge-local");}}>Texture & animate in local Forge</button><button disabled={!controlsEnabled} className="rounded border border-line px-3 py-2 text-xs disabled:opacity-35" onClick={() => controlsEnabled && window.grudge.prompt3d.reveal(result.glbPath)}>Reveal files</button><button disabled={!result.report.gameReady || !visualAccepted[result.glbPath]} className="rounded bg-gold px-3 py-2 text-xs font-semibold text-black disabled:opacity-35" onClick={async () => { const converted = await window.grudge.ingest.convert(result.glbPath); toast.success("Sent through the existing asset conversion pipeline", { description: converted?.path ?? result.glbPath }); }}>Import into asset pipeline</button></div>
            </div>}
            {job && !result && <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-muted">{job.state === "running" || job.state === "queued" ? <><Loader2 className="mr-2 animate-spin" size={18} />Waiting for retained provider output…</> : job.state === "awaiting-concept-approval" ? "Concept generation is finished. Geometry is deliberately paused until you approve this exact retained image." : "No mesh output for this attempt. The brief, concept and history remain saved."}</div>}
          </section>
        </div>
    </div>
  );
}
