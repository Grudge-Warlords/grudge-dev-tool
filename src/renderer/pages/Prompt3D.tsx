import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Box, CheckCircle2, ChevronDown, ChevronUp, Cpu, Download, FolderOpen, HardDrive, Loader2, Play, RefreshCw, ShieldCheck, Square, Trash2, WandSparkles, XCircle } from "lucide-react";
import { toast } from "sonner";
import Model3DViewer from "../components/viewers/Model3DViewer";
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
  const [spec, setSpec] = useState<AssetSpecV1>(defaultSpec);
  const [overview, setOverview] = useState<Prompt3DOverview | null>(null);
  const [controlsEnabled, setControlsEnabled] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [installStates, setInstallStates] = useState<Record<string, Prompt3DInstallStatus>>({});
  const [job, setJob] = useState<Prompt3DJobStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [plannerBusy, setPlannerBusy] = useState(false);
  const [plannerResult, setPlannerResult] = useState<Prompt3DPlanResult["planner"] | null>(null);
  const [selectedVariant, setSelectedVariant] = useState(0);

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
    void refresh();
    const offInstall = window.grudge.prompt3d.onInstallProgress((value: Prompt3DInstallStatus) => { setInstallStates((old: Record<string, Prompt3DInstallStatus>) => ({ ...old, [value.providerId]: value })); void refresh(); });
    const offJob = window.grudge.prompt3d.onJobProgress((value: Prompt3DJobStatus) => setJob(value));
    return () => { offInstall?.(); offJob?.(); };
  }, []);

  useEffect(() => { const timer = setTimeout(() => void refresh(spec), 250); return () => clearTimeout(timer); }, [spec.providerId, spec.generateTextures]);

  const providers = overview?.providers ?? [];
  const selected = providers.find((p) => p.manifest.id === spec.providerId);
  const localProviders = providers.filter((p) => p.manifest.kind === "local");
  const cloudProviders = providers.filter((p) => p.manifest.kind === "cloud");
  const result = job?.variants[selectedVariant];
  const stricterReview = spec.category === "character" || spec.category === "vehicle";
  const availableRoutes = selected?.manifest.enabledRoutes ?? [];
  const bothLocalUnsupported = localProviders.length > 0 && localProviders.every((p) => p.compliance.state === "unsupported");

  const patchSpec = <K extends keyof AssetSpecV1>(key: K, value: AssetSpecV1[K]) => setSpec((old) => ({ ...old, [key]: value }));
  const enableControls = async () => {
    try { const result = await window.grudge.prompt3d.grant(); setControlsEnabled(result.enabled); toast.success("Local generation controls enabled for this window"); }
    catch (error) { toast.error("Could not enable controls", { description: String(error) }); }
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
      const next: Prompt3DJobStatus = await window.grudge.prompt3d.start({ spec, consent: { providerId: spec.providerId, confirmed: true, externalData: [], estimatedCostUsd: 0 } });
      setJob(next); toast.success("Local generation started");
    } catch (error) { toast.error("Generation is not available yet", { description: String(error) }); }
    finally { setBusy(false); }
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

  const canGenerate = Boolean(controlsEnabled && selected?.compliance.canRun && !busy && !plannerBusy && job?.state !== "running" && !stricterReview);

  return (
    <div className="h-full overflow-auto bg-bg p-5 text-fg">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><WandSparkles className="text-gold" size={24} /><h1 className="text-xl font-semibold">Prompt to 3D</h1></div>
            <p className="mt-1 max-w-3xl text-sm text-muted">Describe a prop or environment piece, generate it with an honest local 3D provider, then validate and quarantine before it can enter the asset pipeline.</p>
          </div>
          <div className="flex gap-2">
            {!controlsEnabled ? <button className="rounded-lg border border-gold/50 bg-gold/10 px-3 py-2 text-sm text-gold" onClick={enableControls}><ShieldCheck className="mr-2 inline" size={15} />Enable local controls</button> : <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300"><ShieldCheck className="mr-1 inline" size={14} />Window-scoped controls enabled</span>}
            <button className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-fg" onClick={() => void refresh()}><RefreshCw className="mr-2 inline" size={14} />Recheck hardware</button>
          </div>
        </header>

        {overview?.runtime.offlineLocalTest && <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200"><ShieldCheck className="mr-2 inline" size={16} />Offline local-test mode: fleet probes, updater, Docker/Ollama management, remote webviews, cloud fallback and production contact are disabled.</div>}

        <section className={card}>
          <button className="flex w-full items-center justify-between p-4 text-left" onClick={() => setSetupOpen((v) => !v)}>
            <div><div className="font-semibold"><Download className="mr-2 inline text-gold" size={17} />Install local 3D generators</div><div className="mt-1 text-xs text-muted">Nothing installs on startup. Each provider is isolated, pinned, cancellable and separately licensed.</div></div>
            {setupOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </button>
          {setupOpen && <div className="grid gap-3 border-t border-line p-4 xl:grid-cols-2">
            {overview && <div className="grid gap-2 rounded-lg border border-line bg-bg p-3 text-[11px] text-muted xl:col-span-2 md:grid-cols-5">
              <div><b className="text-fg">GPU</b><br />{overview.hardware.gpu?.model ?? "Not detected"}<br />{bytes(overview.hardware.gpu?.totalVramBytes ?? 0)} total · {bytes(overview.hardware.gpu?.freeVramBytes ?? 0)} free</div>
              <div><b className="text-fg">System RAM</b><br />{bytes(overview.hardware.systemRam.totalBytes)} total<br />{bytes(overview.hardware.systemRam.freeBytes)} free</div>
              <div><b className="text-fg">Generator disk</b><br /><span className="break-all font-mono">{overview.hardware.disk.path}</span><br />{bytes(overview.hardware.disk.freeBytes)} free</div>
              <div><b className="text-fg">Platform</b><br />{overview.hardware.os.version}<br />{overview.hardware.wsl.usableLinuxDistribution ? `${overview.hardware.wsl.usableLinuxDistribution} · WSL ${overview.hardware.wsl.distributionVersions[overview.hardware.wsl.usableLinuxDistribution] ?? "?"}` : `WSL ${overview.hardware.wsl.version ?? "not detected"} · normal user setup needed`}</div>
              <div><b className="text-fg">CUDA / Python</b><br />Toolkit {overview.hardware.cudaToolkit.available ? overview.hardware.cudaToolkit.version ?? "detected" : "not on Windows PATH"}<br />{overview.hardware.python.map((item) => item.version).join(" · ") || "isolated runtime will be installed"}</div>
            </div>}
            {localProviders.map((row) => {
              const manifest = row.manifest, compliance = row.compliance, status = installStates[manifest.id] ?? row.install;
              const providerId = manifest.id as LocalPrompt3DProviderId;
              const primaryAction = status?.state === "installed" || status?.state === "repair-needed" ? "repair" : "install";
              return <article key={manifest.id} className="rounded-lg border border-line bg-bg p-4">
                <div className="flex items-start justify-between gap-2"><div><h2 className="font-semibold">{manifest.name}</h2><p className="mt-1 text-xs text-muted">{manifest.summary}</p></div><span className={`whitespace-nowrap rounded-full border px-2 py-1 text-[11px] ${stateStyle[compliance.state]}`}>{stateLabel[compliance.state]}</span></div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded bg-bg-2 p-2"><HardDrive className="mr-1 inline" size={13} />Download estimate <b>{bytes(manifest.downloadBytes)}</b><br />Installed estimate <b>{bytes(manifest.installedBytes)}</b><br />Free disk required <b>{bytes(manifest.requiredFreeDiskBytes)}</b></div><div className="rounded bg-bg-2 p-2"><Cpu className="mr-1 inline" size={13} />Physical VRAM <b>{bytes(manifest.physicalVramBytes)}</b><br />Run headroom <b>{bytes(manifest.runVramBytes.textured)}</b><br />System RAM <b>{bytes(manifest.systemRamBytes)}</b></div></div>
                <div className="mt-2 text-[11px] text-muted">Provider files: <span className="font-mono text-fg">{overview ? destination(overview.runtime.root, manifest.id) : "…"}</span><br />Linux environment: <span className="font-mono text-fg">normal-user {overview?.hardware.wsl.usableLinuxDistribution ?? "Ubuntu-24.04"} · distribution storage is managed outside this installer</span></div>
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
            })}
            <div className="xl:col-span-2 flex items-center justify-between rounded-lg border border-line bg-bg px-3 py-2 text-xs"><span className="text-muted">Generator storage: <span className="font-mono text-fg">{overview?.runtime.root ?? "measuring…"}</span></span><button disabled={!controlsEnabled} className="rounded border border-line px-2 py-1 disabled:opacity-35" onClick={async () => { if (controlsEnabled && await window.grudge.prompt3d.chooseRoot()) void refresh(); }}><FolderOpen className="mr-1 inline" size={13} />Choose destination</button></div>
          </div>}
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(440px,0.9fr)_minmax(520px,1.1fr)]">
          <section className={`${card} p-4 space-y-3`}>
            <h2 className="font-semibold">Asset brief</h2>
            <label className="block text-xs text-muted">Prompt<textarea className={`${input} mt-1 min-h-24 resize-y`} value={spec.prompt} maxLength={2000} onChange={(e) => { patchSpec("prompt", e.target.value); setPlannerResult(null); }} /></label>
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
            {stricterReview && <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200"><AlertTriangle className="mr-1 inline" size={14} />Character and vehicle generation is disabled. Rig, topology and vehicle/character-facing contracts remain pending in their owning workflows.</div>}
            <div className="grid grid-cols-4 gap-2"><label className="text-xs text-muted">Width<input type="number" className={`${input} mt-1`} value={spec.dimensions.width} onChange={(e) => patchSpec("dimensions", { ...spec.dimensions, width: Number(e.target.value) })} /></label><label className="text-xs text-muted">Height<input type="number" className={`${input} mt-1`} value={spec.dimensions.height} onChange={(e) => patchSpec("dimensions", { ...spec.dimensions, height: Number(e.target.value) })} /></label><label className="text-xs text-muted">Depth<input type="number" className={`${input} mt-1`} value={spec.dimensions.depth} onChange={(e) => patchSpec("dimensions", { ...spec.dimensions, depth: Number(e.target.value) })} /></label><label className="text-xs text-muted">Units<select className={`${input} mt-1`} value={spec.dimensions.unit} onChange={(e) => patchSpec("dimensions", { ...spec.dimensions, unit: e.target.value as "m" | "cm" })}><option value="m">metres</option><option value="cm">cm</option></select></label></div>
            <div className="grid grid-cols-3 gap-3"><label className="text-xs text-muted">Target format<select className={`${input} mt-1`} value={spec.targetFormat} disabled><option value="glb">GLB</option></select></label><label className="text-xs text-muted">Triangle budget<input type="number" className={`${input} mt-1`} min={100} max={2_000_000} value={spec.budgets.maxTriangles} onChange={(e) => patchSpec("budgets", { ...spec.budgets, maxTriangles: Number(e.target.value) })} /></label><label className="text-xs text-muted">Texture resolution<select className={`${input} mt-1`} value={spec.budgets.maxTextureResolution} onChange={(e) => patchSpec("budgets", { ...spec.budgets, maxTextureResolution: Number(e.target.value) as AssetSpecV1["budgets"]["maxTextureResolution"] })}>{[512,1024,2048,4096].map((v) => <option key={v} value={v}>{v} × {v}</option>)}</select></label></div>
            <label className="block text-xs text-muted">Texture file budget (MiB)<input type="number" className={`${input} mt-1`} min={1} max={512} value={Math.round(spec.budgets.maxTextureBytes / 1024 ** 2)} onChange={(e) => patchSpec("budgets", { ...spec.budgets, maxTextureBytes: Math.round(Number(e.target.value) * 1024 ** 2) })} /></label>
            <div className="grid grid-cols-2 gap-3"><label className="text-xs text-muted">Seed<input type="number" className={`${input} mt-1`} value={spec.seed} onChange={(e) => patchSpec("seed", Number(e.target.value))} /></label><label className="text-xs text-muted">Variants<select className={`${input} mt-1`} value={spec.variants} onChange={(e) => patchSpec("variants", Number(e.target.value))}>{[1,2,3,4].map((v) => <option key={v}>{v}</option>)}</select></label></div>
            <div className="flex flex-wrap gap-4 text-xs"><label><input type="checkbox" checked={spec.generateTextures} onChange={(e) => patchSpec("generateTextures", e.target.checked)} /> <span className="ml-1">Textures</span></label><label><input type="checkbox" checked={spec.generateCollision} onChange={(e) => patchSpec("generateCollision", e.target.checked)} /> <span className="ml-1">Collision</span></label><label><input type="checkbox" checked={spec.generateLods} onChange={(e) => patchSpec("generateLods", e.target.checked)} /> <span className="ml-1">LODs</span></label></div>

            <div className="border-t border-line pt-3"><h2 className="mb-2 font-semibold">Provider and privacy</h2><div className="space-y-2">{providers.map((row) => <label key={row.manifest.id} className={`flex gap-3 rounded-lg border p-3 ${spec.providerId === row.manifest.id ? "border-gold/50 bg-gold/5" : "border-line"} ${!row.compliance.canRun ? "opacity-70" : "cursor-pointer"}`}><input type="radio" name="provider" checked={spec.providerId === row.manifest.id} disabled={row.compliance.state === "unsupported" || (row.manifest.kind === "cloud" && !row.cloudConfigured)} onChange={() => setSpec((old) => ({ ...old, providerId: row.manifest.id, route: row.manifest.id === "trellis" ? "direct-text" : row.manifest.kind === "local" ? "concept-image-to-3d" : row.manifest.routes[0] }))} /><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><span className="text-sm font-medium">{row.manifest.name}</span><span className={`rounded-full border px-2 py-0.5 text-[10px] ${stateStyle[row.compliance.state]}`}>{stateLabel[row.compliance.state]}</span></div><div className="mt-1 text-[11px] text-muted">{row.manifest.routes.join(" · ")} · {row.manifest.kind === "local" ? "stays on this computer · estimated provider cost $0" : "sends prompt/reference data externally and may incur cost"}</div></div></label>)}</div></div>
            {cloudProviders.every((p) => !p.cloudConfigured) && localProviders.every((p) => !p.compliance.canRun) && (bothLocalUnsupported
              ? <div className="rounded border border-violet-500/30 bg-violet-500/10 p-3 text-xs text-violet-200"><b>Cloud only:</b> neither local backend can satisfy its physical/platform contract on this host. Cloud providers remain disabled until credentials are deliberately configured; a cloud run sends the prompt/reference data externally and may incur the displayed cost.</div>
              : <div className="rounded border border-line bg-bg p-3 text-xs text-muted">No generator can run yet. At least one local backend is physically/platform capable, so this is <b className="text-fg">not Cloud only</b>: finish local setup or wait for free VRAM. Cloud providers remain disabled because no credentials or cost/data consent are configured.</div>)}
            {selected && <div className="rounded-lg border border-line bg-bg p-3 text-xs"><div className="font-medium">{selected.manifest.geometry}</div><div className="mt-1 text-muted">{selected.manifest.textures}</div><div className="mt-2 text-muted">Required now: {bytes(selected.compliance.required.runVramBytes)} free VRAM · measured {bytes(selected.compliance.measured.freeVramBytes)}.</div></div>}
            <div className="flex gap-2"><button disabled={!canGenerate} className="flex-1 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-black disabled:opacity-35" onClick={() => void generate()}>{busy || job?.state === "running" ? <Loader2 className="mr-2 inline animate-spin" size={15} /> : <Play className="mr-2 inline" size={15} />}Generate locally</button>{job?.state === "running" && <button className="rounded-lg border border-line px-3" onClick={() => controlsEnabled && window.grudge.prompt3d.cancel(job.id)}><Square size={15} /></button>}{job && ["failed","cancelled"].includes(job.state) && <button className="rounded-lg border border-line px-3 text-xs" onClick={() => controlsEnabled && window.grudge.prompt3d.retry(job.id)}>Retry</button>}</div>
          </section>

          <section className={`${card} flex min-h-[700px] flex-col overflow-hidden`}>
            <div className="border-b border-line p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">Generation and validation</h2>{job && <span className="text-xs capitalize text-muted">{job.stage} · {job.progress}%</span>}</div>{job && <><div className="mt-2 h-2 rounded bg-line"><div className="h-full rounded bg-gold transition-all" style={{ width: `${job.progress}%` }} /></div><p className="mt-2 text-xs text-muted">{job.message}</p></>}</div>
            {!job && <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-muted"><Box size={52} className="mb-3 opacity-30" /><p className="text-sm">A validated preview will appear here.</p><p className="mt-1 max-w-md text-xs">Provider output is never marked game-ready until GLB structure, geometry, scale, axes, root, grounding, materials, textures and budgets pass.</p></div>}
            {job && result && <div className="flex flex-1 flex-col overflow-auto p-4">
              {job.variants.length > 1 && <div className="mb-3 flex gap-2">{job.variants.map((v, i) => <button key={i} className={`rounded border px-3 py-1 text-xs ${selectedVariant === i ? "border-gold text-gold" : "border-line"}`} onClick={() => setSelectedVariant(i)}>Variant {i + 1}</button>)}</div>}
              {result.report.gameReady ? <div className="mb-3 rounded border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200"><CheckCircle2 className="mr-2 inline" size={16} />Validated game-ready output</div> : <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"><XCircle className="mr-2 inline" size={16} />Quarantined: failed assets cannot publish or upload</div>}
              <div className="min-h-[360px] overflow-hidden rounded-lg border border-line"><Model3DViewer asset={{ name: "prompt3d-asset.glb", url: `local://${encodeURIComponent(result.glbPath)}`, localPath: result.glbPath, contentType: "model/gltf-binary", size: 0 }} /></div>
              <div className="mt-3 grid gap-3 md:grid-cols-2"><div className="rounded-lg border border-line bg-bg p-3"><h3 className="text-sm font-medium">Validation report</h3><div className="mt-2 max-h-52 space-y-1 overflow-auto">{result.report.checks.map((c) => <div key={c.id} className="flex items-start gap-2 text-[11px]">{c.status === "pass" ? <CheckCircle2 size={13} className="mt-0.5 text-emerald-400" /> : c.status === "warning" ? <AlertTriangle size={13} className="mt-0.5 text-amber-400" /> : <XCircle size={13} className="mt-0.5 text-red-400" />}<span><b>{c.id}</b> — {c.message}</span></div>)}</div></div><div className="rounded-lg border border-line bg-bg p-3 text-xs"><h3 className="text-sm font-medium">Provenance</h3><p className="mt-2 text-muted">Provider: {job.providerId}<br />AssetSpec: {job.spec.version}<br />Seed: {job.spec.seed}<br />Validation ID: <span className="font-mono">{result.report.deterministicId.slice(0,16)}…</span><br />License/source metadata: saved beside output</p></div></div>
              <div className="mt-3 flex flex-wrap gap-2"><button className="rounded border border-line px-3 py-2 text-xs" onClick={() => window.grudge.viewer.openLocal({ path: result.glbPath, contentType: "model/gltf-binary" })}>Open full preview</button><button disabled={!controlsEnabled} className="rounded border border-line px-3 py-2 text-xs disabled:opacity-35" onClick={() => controlsEnabled && window.grudge.prompt3d.reveal(result.glbPath)}>Reveal files</button><button disabled={!result.report.gameReady} className="rounded bg-gold px-3 py-2 text-xs font-semibold text-black disabled:opacity-35" onClick={async () => { const converted = await window.grudge.ingest.convert(result.glbPath); toast.success("Sent through the existing asset conversion pipeline", { description: converted?.path ?? result.glbPath }); }}>Import into asset pipeline</button></div>
            </div>}
            {job && !result && <div className="flex flex-1 items-center justify-center text-sm text-muted"><Loader2 className="mr-2 animate-spin" size={18} />Waiting for validated provider output…</div>}
          </section>
        </div>
      </div>
    </div>
  );
}
