import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { CREATION_BUILD, CREATION_CATEGORIES, CREATION_STYLES, type CreationBaseSource, type CreationAttempt, type CreationLibraryAsset } from "../../shared/creationFlow";
import { PROMPT3D_SPEC_VERSION, type AssetCategory, type AssetSpecV1, type AssetStyle, type Prompt3DAppRuntime, type Prompt3DHistory, type Prompt3DOrchestrationRecord, type Prompt3DOverview } from "../../shared/prompt3d";
import { compilePrompt3DUnifiedPlan, PROMPT3D_UNIFIED_ROUTE_LABELS, prompt3DOrchestrationRecord, type Prompt3DUnifiedOverride, type Prompt3DUnifiedPlan, type Prompt3DUnifiedRoute } from "../../shared/prompt3dOrchestrator";
import type { Prompt3DFinishJobStatus } from "../../shared/prompt3dWorkflow";
import Model3DViewer from "../components/viewers/Model3DViewer";
import { CREATION_BASE_HANDOFF } from "../lib/creationHandoff";
import { writeMirror } from "../lib/workspace";
import NeuralPrompt3D, { type Prompt3DGuidedIntent } from "./NeuralPrompt3D";

const DRAFT="grudge:original-creation-session:v1";
const field="w-full rounded border border-line bg-bg px-3 py-2 text-sm text-fg";
const label=(s:string)=>s.charAt(0).toUpperCase()+s.slice(1).replaceAll("-"," ");
function savedDraft(){try{return JSON.parse(localStorage.getItem(DRAFT)||"{}");}catch{return {};}}
function overviewSpec(prompt:string,category:AssetCategory,style:AssetStyle):AssetSpecV1{return {version:PROMPT3D_SPEC_VERSION,prompt:prompt.trim()||"Plan a local game-ready asset",category,style,route:"concept-image-to-3d",targetFormat:"glb",dimensions:{width:1,height:1,depth:1,unit:"m"},budgets:{maxTriangles:50_000,maxTextureResolution:2048,maxTextureBytes:32*1024*1024},seed:42,variants:1,providerId:"hunyuan3d-2",generateTextures:false,generateCollision:false,generateLods:false,coordinateContract:{upAxis:"+Y",forwardAxis:"+Z",origin:"ground-center",stableRootName:"GrudgeAssetRoot"}};}
interface RetainedRoutingRevision{ id:string; sha256?:string; path?:string; updatedAt:string; method:"hunyuan-workflow"|"original-procedural"|"existing-asset"; }
export default function CreationFlowPage(){
  const [initial]=useState(savedDraft);
  const [fromBase]=useState(()=>Boolean(sessionStorage.getItem(CREATION_BASE_HANDOFF)));
  const [method,setMethod]=useState<"procedural"|"neural">(()=>localStorage.getItem("grudge:creation-method")==="procedural"?"procedural":"neural");
  const [prompt,setPrompt]=useState<string>(initial.prompt??"");
  const [category,setCategory]=useState<AssetCategory>(CREATION_CATEGORIES.includes(initial.category)?initial.category:"prop");
  const [style,setStyle]=useState<AssetStyle>(CREATION_STYLES.includes(initial.style)?initial.style:"stylized");
  const [planner,setPlanner]=useState(initial.usePlanner===true);
  const [controls,setControls]=useState(false),[busy,setBusy]=useState(false);
  const [history,setHistory]=useState<CreationAttempt[]>([]),[current,setCurrent]=useState<CreationAttempt|null>(null);
  const [library,setLibrary]=useState<CreationLibraryAsset[]>([]),[saving,setSaving]=useState(false);
  const [last,setLast]=useState<CreationAttempt|null>(null),[replay,setReplay]=useState(0);
  const [historyError,setHistoryError]=useState("");
  const [unifiedPrompt,setUnifiedPrompt]=useState<string>(initial.prompt??"");
  const [unifiedContext,setUnifiedContext]=useState<"new"|"revise-current">("new");
  const [routeOverride,setRouteOverride]=useState<Prompt3DUnifiedOverride>("automatic");
  const [unifiedPlan,setUnifiedPlan]=useState<Prompt3DUnifiedPlan|null>(null);
  const [enabledStages,setEnabledStages]=useState<Record<string,boolean>>({});
  const [providerOverview,setProviderOverview]=useState<Prompt3DOverview|null>(null);
  const [neuralLatest,setNeuralLatest]=useState<RetainedRoutingRevision|null>(null);
  const [localAnimationLibraryCount,setLocalAnimationLibraryCount]=useState(0);
  const [workspaceOpen,setWorkspaceOpen]=useState(false);
  const [baseSource,setBaseSource]=useState<CreationBaseSource|null>(null);
  useEffect(()=>{const pending=sessionStorage.getItem(CREATION_BASE_HANDOFF);if(pending){try{setBaseSource(JSON.parse(pending));setMethod("procedural");setWorkspaceOpen(true);setCurrent(null);setPrompt("");}catch{toast.error("The selected asset could not be restored.");}sessionStorage.removeItem(CREATION_BASE_HANDOFF);}},[]);
  const [guidedIntent,setGuidedIntent]=useState<Prompt3DGuidedIntent>();
  const [activeOrchestration,setActiveOrchestration]=useState<Prompt3DOrchestrationRecord>();
  useEffect(()=>{void window.grudge.appRuntime().then((r:Prompt3DAppRuntime)=>{const enabled=r.localControlsEnabled===true;setControls(enabled);void refreshRouting(enabled);});void refresh(true);void refreshLibrary();},[]);
  useEffect(()=>{localStorage.setItem("grudge:creation-method",method);},[method]);
  useEffect(()=>{localStorage.setItem(DRAFT,JSON.stringify({prompt,category,style,usePlanner:planner,currentId:current?.id}));},[prompt,category,style,planner,current]);
  async function refresh(restore=false){
    try{const rows:CreationAttempt[]=await window.grudge.creation.history();setHistory(rows);setHistoryError("");
      if(restore&&!fromBase){const row=rows.find(a=>a.id===initial.currentId&&a.state==="complete")??rows.find(a=>a.state==="complete");if(row){setCurrent(row);setCategory(row.request.category);setStyle(row.request.style);}}
    }catch(e){setHistoryError(String(e));}
  }
  async function refreshLibrary(){try{setLibrary(await window.grudge.creation.library());}catch{/* The exact save action reports any catalog error. */}}
  async function refreshRouting(enabled=controls){
    try{
      const [overview,generationHistory,finishHistory,animationLibraries]=await Promise.all([
        window.grudge.prompt3d.overview(overviewSpec(unifiedPrompt,category,style)).catch(()=>null),
        window.grudge.prompt3d.history().catch(()=>({jobs:[],latestJob:null,previousResult:null})),
        enabled?window.grudge.prompt3d.finishHistory().catch(()=>({jobs:[],latest:null})):Promise.resolve({jobs:[],latest:null}),
        window.grudge?.skeleton?.listLibraries?.().catch(() => []) ?? Promise.resolve([]),
      ]);
      setProviderOverview(overview);
      const finish=finishHistory.jobs.find((candidate:Prompt3DFinishJobStatus)=>candidate.state==="complete"&&Boolean(candidate.assetPath));
      const generation=(generationHistory as Prompt3DHistory).previousResult;
      const generatedVariant=generation?.variants[0];
      setNeuralLatest(finish?{id:finish.id,sha256:finish.sha256,path:finish.assetPath,updatedAt:finish.updatedAt,method:"hunyuan-workflow"}:generation&&generatedVariant?{id:generation.id,sha256:generatedVariant.sha256,path:generatedVariant.glbPath,updatedAt:generation.updatedAt,method:"hunyuan-workflow"}:null);
      if((generationHistory as Prompt3DHistory).latestJob&&localStorage.getItem("grudge:creation-method")!=="procedural"&&!sessionStorage.getItem(CREATION_BASE_HANDOFF)){setWorkspaceOpen(true);}
      setLocalAnimationLibraryCount(Array.isArray(animationLibraries)?animationLibraries.length:0);
    }catch{/* The detailed workflow reports provider/history errors in context. */}
  }
  async function enable(value:boolean){try{const r=await(value?window.grudge.prompt3d.grant():window.grudge.prompt3d.revoke());setControls(r.enabled);}catch(e){toast.error(String(e));}}
  async function run(){
    if(busy||!controls||Boolean(baseSource)||!prompt.trim())return;
    setBusy(true);
    try{const result=await window.grudge.creation.submit({prompt,category,style,usePlanner:planner,parentId:current?.id,...(activeOrchestration?{orchestration:activeOrchestration}:{})});setLast(result);
      if(result.state==="complete"){setCurrent(result);setReplay(x=>x+1);setPrompt("");toast.success("New revision saved locally");}
      else toast.error("Attempt retained; no replacement asset",{description:result.message});
      await refresh();
    }catch(e){toast.error("Prompt did not complete",{description:String(e)});}
    finally{setBusy(false);}
  }
  async function reopen(row:CreationAttempt){
    setBusy(true);try{const restored=await window.grudge.creation.reopen(row.id);setCurrent(restored);setCategory(restored.request.category);setStyle(restored.request.style);setReplay(x=>x+1);setLast(restored);toast.success("Reopened saved GLB · no regeneration");}
    catch(e){toast.error("Could not reopen saved asset",{description:String(e)});}finally{setBusy(false);}
  }
  async function importBase(){
    if(!baseSource||busy||!controls)return;setBusy(true);
    try{const result:CreationAttempt=await window.grudge.creation.submit({prompt:"Use selected existing asset as a working copy",category,style,usePlanner:false,baseSource});setLast(result);if(result.state==="complete"){setCurrent(result);setBaseSource(null);setPrompt("");setReplay(x=>x+1);toast.success("Working copy ready; original preserved");}else toast.error(result.message);await refresh();}catch(e){toast.error("Could not use this source",{description:String(e)});}finally{setBusy(false);}
  }
  async function saveCurrent(){
    if(!current||saving)return;setSaving(true);
    try{const result=await window.grudge.creation.save(current.id);writeMirror({localAssetsRoot:result.localAssetsRoot});await refreshLibrary();
      toast.success(result.alreadySaved?"Already saved in Local Files & Assets":"Saved to Local Files & Assets",{description:result.asset.name});}
    catch(e){toast.error("Could not save this exact revision",{description:String(e)});}finally{setSaving(false);}
  }
  const retainedCandidates=[
    ...(current?[{id:current.id,sha256:current.sha256,path:current.assetPath,createdAt:current.updatedAt,method:current.method}]:[]),
    ...(neuralLatest?[{id:neuralLatest.id,sha256:neuralLatest.sha256,path:neuralLatest.path,createdAt:neuralLatest.updatedAt,method:"hunyuan-workflow" as const}]:[]),
  ].sort((left,right)=>right.createdAt.localeCompare(left.createdAt));
  const retainedRevision=retainedCandidates.find(row=>method==="procedural"?row.method!=="hunyuan-workflow":row.method==="hunyuan-workflow");
  function compileGuided(nextOverride:Prompt3DUnifiedOverride=routeOverride){
    try{
      const providers=(['hunyuan3d-2','trellis','hy-motion-1'] as const).map(id=>{
        const row=providerOverview?.providers.find(candidate=>candidate.manifest.id===id);
        return {id,ready:Boolean(row?.compliance.canRun&&row.install?.state==="installed"),reason:row?row.compliance.reasons.join(" ")||row.compliance.state:"Readiness has not been checked yet."};
      });
      const next=compilePrompt3DUnifiedPlan({prompt:unifiedPrompt,override:nextOverride,context:{mode:unifiedContext,category,currentRevision:unifiedContext==="revise-current"&&retainedRevision?{id:retainedRevision.id,sha256:retainedRevision.sha256,path:retainedRevision.path,method:retainedRevision.method}:undefined,localControlsEnabled:controls,localAnimationLibraries:localAnimationLibraryCount,providers}});
      setUnifiedPlan(next);setEnabledStages(Object.fromEntries(next.stages.map(stage=>[stage.id,true])));
    }catch(error){setUnifiedPlan(null);toast.error("The guided request is incomplete",{description:String(error)});}
  }
  async function applyGuided(){
    if(!unifiedPlan)return;
    const first=unifiedPlan.stages[0];
    if(!enabledStages[first.id]||first.readiness==="blocked"){toast.error("The selected route is blocked",{description:first.readinessReason});return;}
    const record=prompt3DOrchestrationRecord(unifiedPlan,unifiedPlan.stages.filter(stage=>enabledStages[stage.id]).map(stage=>stage.id));
    setActiveOrchestration(record);
    const route=unifiedPlan.selectedRoute;
    if(route==="skeleton-studio"){
      if(!retainedRevision?.path)return;
      sessionStorage.setItem("grudge.skeleton.pendingPath",retainedRevision.path);
      await window.grudge.app.openRoute("/skeleton");return;
    }
    if(route==="forge-local"||route==="scene-completion"){
      if(!retainedRevision?.path)return;
      sessionStorage.setItem("grudge.forge.pendingLocalPath",retainedRevision.path);
      sessionStorage.setItem("grudge.prompt3d.contextualHandoff",JSON.stringify({version:1,route,prompt:unifiedPlan.prompt,revision:unifiedPlan.exactRevision,orchestration:record}));
      await window.grudge.app.openRoute("/forge-local");return;
    }
    const useProcedural=route==="original-procedural"||(unifiedContext==="revise-current"&&retainedRevision?.method!=="hunyuan-workflow"&&!["hunyuan3d-2","trellis"].includes(route));
    setMethod(useProcedural?"procedural":"neural");
    setPrompt(unifiedPlan.prompt);setCategory(unifiedPlan.context.category);
    if(useProcedural){if(unifiedContext==="new")setCurrent(null);setWorkspaceOpen(true);return;}
    setGuidedIntent({
      nonce:Date.now(),
      prompt:unifiedPlan.prompt,
      mode:unifiedPlan.context.mode,
      category:unifiedPlan.context.category,
      style,
      route,
      stageRoutes:unifiedPlan.stages.filter(stage=>enabledStages[stage.id]).map(stage=>stage.route),
      orchestration:record,
    });
    setWorkspaceOpen(true);
  }
  const saved=library.find(row=>row.attemptId===current?.id);
  return <div className="space-y-4 pb-6 text-fg">
    {!workspaceOpen&&<div className="flex flex-wrap gap-2"><button className="rounded bg-gold px-4 py-2 font-semibold text-black" onClick={()=>{setMethod("procedural");setWorkspaceOpen(true);}}>Basic shapes &amp; local editing</button><button className="rounded border border-line px-4 py-2" onClick={()=>void window.grudge.app.openRoute("/browser")}>Use an existing asset</button><button className="rounded border border-line px-4 py-2" onClick={()=>{setMethod("neural");setWorkspaceOpen(true);}}>Generate from prompt or images</button></div>}
    <details className="rounded-xl border border-line bg-bg-2 p-3" data-testid="prompt3d-route-planner"><summary className="cursor-pointer text-sm font-semibold">Advanced route planner</summary><section className="p-1 pt-3">
      <div><h1 className="text-xl font-semibold">Prompt to 3D</h1><p className="mt-1 text-xs text-muted">Describe the outcome once. The typed local router recommends the strongest eligible existing path and retains every exact revision.</p></div>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
        <label className="text-xs">What should happen?<textarea aria-label="Unified Prompt-to-3D request" className={field+" mt-1 min-h-24 resize-y"} value={unifiedPrompt} maxLength={2000} onChange={event=>{setUnifiedPrompt(event.target.value);setUnifiedPlan(null);}} placeholder="Create a hand-painted humanoid, texture it, then make it walk in place."/></label>
        <div className="grid gap-2">
          <label className="text-xs">Asset context<select className={field+" mt-1"} value={unifiedContext} onChange={event=>{const value=event.target.value as typeof unifiedContext;setUnifiedContext(value);setUnifiedPlan(null);}}><option value="new">Create new asset</option><option value="revise-current" disabled={!retainedRevision}>Revise current exact asset</option></select></label>
          <label className="text-xs">Route override<select aria-label="Route override" className={field+" mt-1"} value={routeOverride} onChange={event=>{const value=event.target.value as Prompt3DUnifiedOverride;setRouteOverride(value);if(unifiedPlan)compileGuided(value);}}><option value="automatic">Automatic · quality first</option>{(Object.keys(PROMPT3D_UNIFIED_ROUTE_LABELS) as Prompt3DUnifiedRoute[]).map(route=><option key={route} value={route}>{PROMPT3D_UNIFIED_ROUTE_LABELS[route]}</option>)}</select></label>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2"><button className="rounded bg-gold px-4 py-2 text-sm font-semibold text-black disabled:opacity-40" disabled={!unifiedPrompt.trim()} onClick={()=>compileGuided()}>Plan guided route</button><button className="rounded border border-line px-3 py-2 text-xs" onClick={()=>void refreshRouting()}>Refresh readiness</button><span className="text-[11px] text-muted">Grudge-local typed planning · preferred model grudge-dev only when explicitly invoked in advanced fields · no external contact or fallback</span></div>
      {unifiedPlan&&<div className="mt-3 rounded border border-gold/30 bg-gold/5 p-3 text-xs">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><b>{PROMPT3D_UNIFIED_ROUTE_LABELS[unifiedPlan.selectedRoute]}</b><p className="mt-1 text-muted">{unifiedPlan.summary}</p><p className="mt-1 text-[11px] text-muted">Context: {unifiedPlan.exactRevision}</p></div><span className={`rounded border px-2 py-1 text-[10px] ${unifiedPlan.stages[0].readiness==="ready"?"border-emerald-500/40 text-emerald-200":unifiedPlan.stages[0].readiness==="blocked"?"border-red-500/40 text-red-200":"border-amber-500/40 text-amber-200"}`}>{unifiedPlan.stages[0].readiness.replace("-"," ")}</span></div>
        {unifiedPlan.strongestCapabilityBlockedReason&&<p className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-amber-100">Higher-capability route {PROMPT3D_UNIFIED_ROUTE_LABELS[unifiedPlan.strongestCapability]} is blocked: {unifiedPlan.strongestCapabilityBlockedReason}{unifiedPlan.nextBestEligible?` Next eligible: ${PROMPT3D_UNIFIED_ROUTE_LABELS[unifiedPlan.nextBestEligible]}.`:""}</p>}
        {unifiedPlan.stages[0].readiness==="blocked"&&<p className="mt-2 text-red-200">{unifiedPlan.stages[0].readinessReason}</p>}
        <details className="mt-3 rounded border border-line bg-bg p-3"><summary className="cursor-pointer text-gold">Stages, methods and retained evidence</summary><div className="mt-2 grid gap-2">{unifiedPlan.stages.map(stage=><label key={stage.id} className="flex items-start gap-2 rounded border border-line/70 p-2"><input type="checkbox" checked={Boolean(enabledStages[stage.id])} onChange={event=>setEnabledStages(current=>({...current,[stage.id]:event.target.checked}))}/><span><b>{stage.label}</b> · {stage.method}<span className="mt-1 block text-[11px] text-muted">{stage.resource} · {stage.revisionEffect.replaceAll("-"," ")} · {stage.approval} · {stage.readinessReason}</span></span></label>)}</div><p className="mt-2 text-[11px] text-muted">The temporary layout is intentionally minimal. Final 4K spacing, hierarchy and screen schema remain pending Al's live visual review.</p></details>
        <button className="mt-3 rounded bg-gold px-4 py-2 font-semibold text-black disabled:opacity-40" disabled={!enabledStages[unifiedPlan.stages[0].id]||unifiedPlan.stages[0].readiness==="blocked"} onClick={()=>void applyGuided()}>Continue with this explicit route</button>
      </div>}
    </section></details>
    {workspaceOpen&&<section className="rounded-xl border border-line bg-bg-2/40 p-2"><div className="mb-2 flex items-center justify-between px-2"><b className="text-sm">Creation workspace</b><button className="rounded border border-line px-3 py-1 text-xs" onClick={()=>setWorkspaceOpen(false)}>Choose another start</button></div>{method==="neural"?<NeuralPrompt3D guidedIntent={guidedIntent}/>:<>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-gold/30 bg-gold/5 p-3 text-xs">
        <p><b>{current?.method==="existing-asset"?"Existing asset · independent working copy":"Local procedural creation"}</b> · Basic shapes and the earlier sword, cosmetic game prop and segmented person templates. Hunyuan is optional.</p>
        <label><input aria-label="Enable local creation controls" type="checkbox" checked={controls} disabled={busy} onChange={e=>void enable(e.target.checked)}/> Enable local controls · remembered</label>
      </div>
      {baseSource&&<div className="my-3 rounded border border-sky-500/40 p-3 text-sm"><b>Selected existing model</b><p className="break-all text-xs text-muted">{baseSource.kind==="local-file"?baseSource.path:baseSource.key}</p><p className="my-2 text-xs">A separate working copy retains the source identity, materials, skin and clips.</p><button disabled={!controls||busy} className="rounded bg-gold px-3 py-2 text-black disabled:opacity-40" onClick={()=>void importBase()}>Use this model as base</button></div>}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(340px,0.8fr)_minmax(500px,1.5fr)]">
        <section className="space-y-3 rounded-xl border border-line bg-bg-2 p-4">
          <label className="block text-xs">Prompt<textarea aria-label="Creation prompt" className={field+" mt-1 min-h-28"} value={prompt} maxLength={2000} disabled={busy} onChange={e=>{setPrompt(e.target.value);setActiveOrchestration(undefined);}} placeholder={current?"Make it wider.":"Create a box."}/></label>
          <details className="rounded border border-line p-2"><summary className="cursor-pointer text-xs">Optional style and planning settings</summary><div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs">Category<select aria-label="Category" className={field+" mt-1"} value={category} disabled={busy} onChange={e=>setCategory(e.target.value as AssetCategory)}>{CREATION_CATEGORIES.map(c=><option key={c} value={c}>{label(c)}</option>)}</select></label>
            <label className="text-xs">Style<select aria-label="Style" className={field+" mt-1"} value={style} disabled={busy} onChange={e=>setStyle(e.target.value as AssetStyle)}>{CREATION_STYLES.map(c=><option key={c} value={c}>{label(c)}</option>)}</select></label>
          </div>
          <label className="block text-xs"><input aria-label="Optional local planner" type="checkbox" checked={planner} disabled={busy} onChange={e=>setPlanner(e.target.checked)}/> Optional local planner · installed Ollama, CPU only</label>
          </div></details>
          <div className="flex gap-2"><button className="flex-1 rounded bg-gold px-4 py-2 font-semibold text-black disabled:opacity-40" disabled={busy||!controls||Boolean(baseSource)||!prompt.trim()} onClick={()=>void run()}>{busy?"Working locally…":"Run prompt"}</button><button className="rounded border border-line px-3 py-2 text-xs disabled:opacity-40" disabled={busy} onClick={()=>{setCurrent(null);setBaseSource(null);setLast(null);setPrompt("");}}>New asset</button></div>
          <div className="rounded border border-line bg-bg p-3 text-xs">
            <b>Current asset: {current?label(current.plan?.kind??"asset"):"none"}</b>
            <p className="mt-1 text-muted">{current?`“It” refers to asset ${current.assetId.slice(0,8)}. Follow-up prompts create a new revision of this model.`:"A creation prompt makes a new original asset. Follow-ups require a current asset."}</p>
            <details className="mt-2 rounded border border-line/70 p-2 text-muted"><summary className="cursor-pointer text-fg">Examples for this model</summary><div className="mt-2 space-y-1">
              <p>Create: “Create a box”, sphere, cylinder, cone, plane or torus.</p>
              <p>Resize: “Make it wider”, “taller”, “smaller” or “longer”.</p>
              <p>Surface: “Paint it blue” (UVs and materials required).</p>
              <p>Motion: “Add a turntable”.</p>
              {current&&["sword","game-gun","person"].includes(current.plan?.kind??"")&&<><p>Detail: “Add detailed cosmetic additions to it”.</p><p>{current.plan?.kind==="sword"?"Shape: “Make its blade longer and more curved”. Motion: “Animate it swiping side to side”.":current.plan?.kind==="person"?"Shape: “Make the character taller with a larger head”. Motion: “Animate it doing a simple dance”.":"Shape: “Make it bulkier with a larger muzzle”. Motion: “Animate a visible projectile shooting from it”."}</p></>}
            </div></details>
          </div>
          {last&&<div role="status" className={"rounded border p-3 text-xs "+(last.state==="complete"?"border-emerald-500/40":"border-red-500/40")}><b>{last.state==="complete"?"Saved revision":"Attempt failed — retained"}</b><p className="mt-1">{last.message}</p>{last.plan&&<p className="mt-1 text-muted">{last.plan.planner}</p>}</div>}
          <p className="text-[11px] text-muted">Autosave on · all attempts retained · {CREATION_BUILD}</p>
        </section>
        <section className="rounded-xl border border-line bg-bg-2 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm"><b>Actual saved model · local GLB</b>{current&&<div className="flex flex-wrap gap-2"><button className="rounded border border-line px-3 py-1 text-xs" disabled={busy||saving} onClick={()=>{sessionStorage.setItem("grudge.forge.pendingLocalPath",current.assetPath!);void window.grudge.app.openRoute("/forge-local");}}>Edit in Forge</button><button className="rounded border border-line px-3 py-1 text-xs" disabled={busy||saving} onClick={()=>{sessionStorage.setItem("grudge.skeleton.pendingPath",current.assetPath!);void window.grudge.app.openRoute("/skeleton");}}>Skeleton Studio</button><button className="rounded bg-gold px-3 py-1 text-xs font-semibold text-black disabled:opacity-40" disabled={busy||saving} onClick={()=>void saveCurrent()}>{saving?"Saving…":saved?"Saved in Local Files & Assets":"Save to Local Files & Assets"}</button><button className="rounded border border-line px-3 py-1 text-xs disabled:opacity-40" disabled={busy||saving} onClick={()=>void reopen(current)}>Reopen from local storage</button></div>}</div>
          <div style={{height:"min(58vh,700px)",minHeight:420}} className="overflow-hidden rounded border border-line" aria-label="Created asset viewport">
            {current?.assetPath?<Model3DViewer preserveAuthoredMaterials key={`${current.id}:${replay}`} asset={{name:`${current.plan?.kind??"asset"}.glb`,url:`local://${encodeURIComponent(current.assetPath)}`,localPath:current.assetPath,contentType:"model/gltf-binary",size:0}}/>:<div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted">No replacement model is loaded. Create an asset or reopen one of your saved revisions.</div>}
          </div>
          {current&&<div className="mt-3 space-y-1 text-xs"><p><b>{current.request.prompt}</b></p><p>{current.validation?.triangles.toLocaleString()} triangles · {current.validation?.detailNodes??0} detail nodes · {current.validation?.textures} embedded textures · {current.validation?.clips.length} clips · {current.validation?.articulatedNodes} articulated nodes</p>{current.plan?.changes?.length?<p className="text-gold">Applied: {current.plan.changes.join(" · ")}</p>:null}<p className="text-muted">Geometry identity {current.geometryHash?.slice(0,16)} · {current.validation?.geometryChanged?"altered by this request":current.validation?.geometryPreserved?"preserved":"review required"}{current.previousGeometryHash?` · previous ${current.previousGeometryHash.slice(0,16)}`:""}</p><p className="text-muted">Drag to orbit, scroll to zoom. Clips play automatically; Pause/Play is inside the viewport.</p>{saved?<div className="flex flex-wrap items-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/5 p-2"><span className="text-emerald-300">Saved as {saved.name}</span><button className="rounded border border-line px-2 py-1" onClick={()=>{writeMirror({localAssetsRoot:saved.savedPath.replace(/[\\/][^\\/]+$/,"")});void window.grudge.app.openRoute("/local");}}>Open Local Files</button><button className="rounded border border-line px-2 py-1" onClick={()=>void window.grudge.app.openRoute("/browser")}>Open Assets</button></div>:<p className="text-muted">Use the save button to add this exact revision to the managed Local Files and Assets library.</p>}<p className="break-all text-[10px] text-muted">{current.assetPath}</p></div>}
        </section>
      </div>
      <details className="rounded-xl border border-line bg-bg-2 p-4"><summary className="cursor-pointer text-sm">History and saved revisions ({history.length})</summary>
        <div className="mt-3 mb-2 flex items-center justify-between"><h2 className="font-semibold">All attempts & saved revisions ({history.length})</h2><button className="rounded border border-line px-3 py-1 text-xs" onClick={()=>void refresh()}>Refresh history</button></div>
        <p className="mb-3 text-xs text-muted">Each prompt, settings, outcome, mesh, embedded texture, clip and source record is retained. Failed attempts stay listed; only completed assets can be replayed. Reopening makes that revision the current “it”.</p>
        {historyError&&<p className="text-red-300">{historyError}</p>}
        <div className="max-h-80 space-y-2 overflow-auto">{history.map(row=><article key={row.id} className="flex items-start justify-between gap-3 rounded border border-line p-3 text-xs">
          <div><b>{row.request.prompt}</b><p className="mt-1 text-muted">{new Date(row.createdAt).toLocaleString()} · {label(row.request.category)} · {label(row.request.style)} · planner {row.request.usePlanner?"on":"off"} · {row.state}</p><p className="mt-1">{row.message}</p>{row.plan?.changes?.length?<p className="mt-1 text-gold">{row.plan.changes.join(" · ")}</p>:null}<p className="mt-1 text-[10px] text-muted">Attempt {row.id.slice(0,8)} · asset {row.assetId.slice(0,8)}{row.parentId?` · previous ${row.parentId.slice(0,8)}`:" · new creation"}</p></div>
          <button className="shrink-0 rounded border border-gold/40 px-3 py-2 text-gold disabled:opacity-35" disabled={busy||row.state!=="complete"||!row.assetPath} onClick={()=>void reopen(row)}>{row.assetPath?"Open / replay":"No replayable asset"}</button>
        </article>)}</div>
      </details>
    </>}</section>}
  </div>;
}
