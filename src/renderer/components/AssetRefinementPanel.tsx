import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { toast } from "sonner";
import type { AssetRefinementRecipe } from "../../shared/assetRefinement";
import type { Prompt3DAppRuntime } from "../../shared/prompt3d";
import type { SceneEngine } from "../lib/forge/sceneEngine";
import { buildAssetRefinement } from "../lib/forge/assetRefinement";
import { exportToGlb } from "../lib/forge/converters";

export default function AssetRefinementPanel({ object, name, animations, engine, onSaved, creating = false }: { object: THREE.Object3D; name: string; animations: THREE.AnimationClip[]; engine: SceneEngine; onSaved: (path: string) => Promise<void>; creating?: boolean }) {
  const [instruction,setInstruction] = useState(creating ? "Create a precision sabre with a strongly curved blade, brass guard and leather grip" : "Give it brushed silver metal and a slow turntable preview");
  const [recipe,setRecipe] = useState<AssetRefinementRecipe | null>(null);
  const [busy,setBusy] = useState(false), [showBefore,setShowBefore] = useState(false), [paused,setPaused] = useState(false);
  const [time,setTime] = useState(0), [message,setMessage] = useState("");
  const [plannerHost,setPlannerHost] = useState("http://127.0.0.1:11434");
  useEffect(()=>{void window.grudge?.appRuntime?.().then((r: Prompt3DAppRuntime)=>{if(r?.plannerHost)setPlannerHost(r.plannerHost);}).catch(()=>{});},[]);
  const preview = useRef<ReturnType<typeof buildAssetRefinement> | null>(null);
  const mixer = useRef<THREE.AnimationMixer | null>(null);
  const committed = useRef(false);
  const framed = useRef(false);
  const originalVisible = useRef(object.visible);
  useEffect(() => {
    if (!recipe) return;
    const p = buildAssetRefinement(object,recipe,animations); preview.current=p;
    engine.scene.add(p.object); object.visible=false; setShowBefore(false); setTime(0); setPaused(false);
    if(creating&&!framed.current){engine.frame(p.object);framed.current=true;}
    mixer.current=engine.buildMixer(p.object,p.clips);
    if(p.motion) mixer.current?.clipAction(p.motion).play();
    return () => { if(mixer.current)engine.removeMixer(mixer.current); mixer.current=null; engine.scene.remove(p.object); p.dispose(); preview.current=null; if(!committed.current)object.visible=originalVisible.current; };
  },[recipe,object,engine]);
  const ask = async () => {
    setBusy(true);
    try { const result=await window.grudge.prompt3d.refine({instruction,assetName:name,previous:recipe??undefined}); setRecipe(result.recipe); setMessage(`${result.model} · local CPU planner. ${result.recipe.summary}`); }
    catch(e){toast.error("Refinement was not applied",{description:String(e)});} finally{setBusy(false);}
  };
  const accept = async () => {
    const p=preview.current; if(!p||!recipe)return;
    setBusy(true);
    try {
      setMessage("Exporting the preview, textures and animation…");
      const t=mixer.current?.time??0; mixer.current?.setTime(0);
      let exported;
      try { exported=await exportToGlb(p.object,p.clips,"refinement"); } finally {mixer.current?.setTime(t);}
      setMessage("Autosaving a new revision; the original is retained…");
      const saved=await window.grudge.prompt3d.saveRevision({bytes:new Uint8Array(exported.bytes),recipe});
      committed.current=true;
      try {await onSaved(saved.path);} catch(e){committed.current=false;throw e;}
      toast.success("Revision saved; previous asset retained",{description:saved.path});
    } catch(e){setMessage(`Could not save revision: ${String(e)}`);toast.error("Could not save revision",{description:String(e)});} finally{setBusy(false);}
  };
  return <section className="space-y-2 border-b border-line p-3 text-xs" aria-label="Chat texture and animation refinement">
    <h3 className="font-semibold text-gold">Chat · create, texture & animate</h3>
    <p className="text-muted">Describe a change → inspect the preview → refine → accept a new saved revision. Originals remain untouched.</p>
    <p className="text-muted">For precise blade types, ask “create a precision longsword / sabre / leafblade / rapier”. This authors named mesh parts procedurally; it does not run or replace Hunyuan.</p>
    <textarea aria-label="Refinement instruction" className="w-full rounded border border-line bg-bg p-2" rows={3} maxLength={2000} value={instruction} onChange={e=>setInstruction(e.target.value)} />
    <button className="btn" disabled={busy||!instruction.trim()} onClick={()=>void ask()}>{busy?"Working…":"Preview chat instruction"}</button>
    <p className="text-muted">Local Ollama only, CPU planning. Procedural surface textures and rigid-object motion; no cloud fallback or skeletal animation claim.</p>
    <details><summary>Local chat connection</summary><label>Ollama endpoint<input className="w-full rounded border border-line bg-bg p-1" aria-label="Local chat endpoint" value={plannerHost} onChange={e=>setPlannerHost(e.target.value)}/></label><button className="btn ghost" onClick={()=>void window.grudge.prompt3d.setPlannerHost(plannerHost).then(()=>toast.success("Local chat connection saved")).catch((e: unknown)=>toast.error(String(e)))}>Save connection</button><button className="btn ghost" onClick={()=>void window.grudge.prompt3d.startPlanner().then((host: string)=>{setPlannerHost(host);toast.success("Installed local planner connected");}).catch((e: unknown)=>toast.error(String(e)))}>Start installed CPU planner</button></details>
    {message&&<p role="status">{message}</p>}
    {recipe&&<>
      {recipe.sword&&<div className="space-y-2 rounded border border-gold/30 p-2"><b>Precision {recipe.sword.kind} · procedural geometry</b><p>{recipe.sword.length}m long · {recipe.sword.width}m blade width</p><label>Blade curvature<input aria-label="Blade curvature" type="range" min="-.5" max=".5" step=".01" value={recipe.sword.curvature} onChange={e=>setRecipe({...recipe,sword:{...recipe.sword!,curvature:Number(e.target.value)}})}/></label><label>Blade width<input aria-label="Blade width" type="range" min=".02" max=".3" step=".005" value={recipe.sword.width} onChange={e=>setRecipe({...recipe,sword:{...recipe.sword!,width:Number(e.target.value)}})}/></label></div>}
      {recipe.material&&<div className="space-y-2">
        <label className="flex justify-between">Surface color<input aria-label="Surface color" type="color" value={recipe.material.color} onChange={e=>setRecipe({...recipe,material:{...recipe.material!,color:e.target.value}})} /></label>
        <label>Pattern<select aria-label="Texture pattern" className="ml-2 bg-bg" value={recipe.material.pattern} onChange={e=>setRecipe({...recipe,material:{...recipe.material!,pattern:e.target.value as any}})}>{["solid","brushed-metal","leather","wood"].map(p=><option key={p}>{p}</option>)}</select></label>
        <p className="text-muted">Height region: {Math.round(recipe.material.region.min*100)}–{Math.round(recipe.material.region.max*100)}%. Inspect boundaries; automatic part recognition is not available. Missing UVs use planar preview mapping.</p>
        <label>Region start<input aria-label="Region start" type="range" min="0" max={recipe.material.region.max-.01} step=".01" value={recipe.material.region.min} onChange={e=>setRecipe({...recipe,material:{...recipe.material!,region:{...recipe.material!.region,min:Number(e.target.value)}}})}/></label>
        <label>Region end<input aria-label="Region end" type="range" min={recipe.material.region.min+.01} max="1" step=".01" value={recipe.material.region.max} onChange={e=>setRecipe({...recipe,material:{...recipe.material!,region:{...recipe.material!.region,max:Number(e.target.value)}}})}/></label>
      </div>}
      {recipe.motion&&<div className="space-y-2">
        <p>{recipe.motion.kind} · {recipe.motion.duration}s · {recipe.motion.amount}{recipe.motion.kind==="thrust"?"m":"°"}</p>
        <label>Motion pivot height · align to grip<input aria-label="Motion pivot height" type="range" min="0" max="1" step=".01" value={recipe.motion.pivotHeight??.5} onChange={e=>setRecipe({...recipe,motion:{...recipe.motion!,pivotHeight:Number(e.target.value)}})}/></label>
        <label>Duration<input aria-label="Animation duration" type="range" min=".5" max="20" step=".5" value={recipe.motion.duration} onChange={e=>setRecipe({...recipe,motion:{...recipe.motion!,duration:Number(e.target.value)}})}/></label>
        <button className="btn ghost" onClick={()=>{if(mixer.current)mixer.current.timeScale=paused?1:0;setPaused(!paused);}}>{paused?"Play":"Pause"}</button>
        <label>Scrub<input aria-label="Animation time" type="range" min="0" max={recipe.motion.duration} step=".01" value={time} onChange={e=>{const t=Number(e.target.value);setTime(t);setPaused(true);if(mixer.current){mixer.current.timeScale=1;mixer.current.setTime(t);mixer.current.timeScale=0;}}}/></label>
      </div>}
      <div className="flex flex-wrap gap-2">
        <button className="btn ghost" onClick={()=>{const before=!showBefore;setShowBefore(before);object.visible=before;if(preview.current)preview.current.object.visible=!before;}}>{showBefore?"Show preview":"Show original"}</button>
        <button className="btn ghost" disabled={busy} onClick={()=>{setRecipe(null);setMessage("Preview discarded. Original retained.");}}>Discard preview</button>
        <button className="btn" disabled={busy} onClick={()=>void accept()}>Accept & autosave revision</button>
      </div>
    </>}
  </section>;
}
