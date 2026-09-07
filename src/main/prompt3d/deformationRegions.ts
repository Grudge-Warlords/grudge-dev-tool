import { DEFORMATION_REGION_LABELS, deformationOperator, type DeformationRegion } from "../../shared/deformationRegions";
import type { Animation } from "@gltf-transform/core";

export interface RegionClip { clipId?: unknown; clipName?: unknown; }

/** Bind edits to the retained revision's clip, never to list order. */
export function regionAnimation(doc:any, binding?:RegionClip):Animation {
  const root=doc.getRoot(), animations=root.listAnimations();
  const clipId=binding?.clipId??root.getAsset().extras?.grudgePromptAnimation?.latestClipId;
  const matches=clipId?animations.filter((a:any)=>a.getExtras().grudgePromptAnimation?.clipId===clipId)
    :binding?.clipName?animations.filter((a:any)=>a.getName()===binding.clipName):animations;
  if(matches.length!==1)throw new Error("The retained motion clip is missing or ambiguous. Reopen the exact animation revision.");
  return matches[0];
}
/** Only targets actually driven by this clip can be edited or highlighted. */
export function activeRegionTargets(animation:any,mesh:any):Set<number>{
  const indices=new Set<number>(),count=mesh.listPrimitives()[0]?.listTargets().length??0;
  if(!count)return indices;
  for(const channel of animation.listChannels()){
    if(channel.getTargetPath()!=="weights"||channel.getTargetNode()?.getMesh()!==mesh)continue;
    const sampler=channel.getSampler(),values=sampler?.getOutput()?.getArray(),frames=sampler?.getInput()?.getCount()??0;
    const cubic=sampler?.getInterpolation()==="CUBICSPLINE",stride=count*(cubic?3:1);
    if(!values||values.length!==frames*stride)throw new Error("The retained clip has inconsistent morph timing.");
    for(let f=0;f<frames;f++)for(let i=0;i<count;i++){
      if(Math.abs(Number(values[f*stride+(cubic?count:0)+i]))>1e-10
        ||(cubic&&(Math.abs(Number(values[f*stride+i]))>1e-10||Math.abs(Number(values[f*stride+2*count+i]))>1e-10)))indices.add(i);
    }
  }
  return indices;
}

export function regionsIn(doc:any,binding?:RegionClip):DeformationRegion[]{
  const found=new Map<string,DeformationRegion>(),animation=regionAnimation(doc,binding);
  const saved=(animation.getExtras() as any).grudgePromptAnimation?.plan?.regions??[];
  for(const mesh of doc.getRoot().listMeshes()){
    const names=mesh.getExtras().targetNames??[],active=activeRegionTargets(animation,mesh);
    names.forEach((name:string,index:number)=>{
      if(!active.has(index))return;
      const custom=saved.find((r:any)=>r.kind==="custom"&&name.startsWith(`Region:${r.id}:`));
      const id=custom?.id??deformationOperator(name);if(!id)return;
      let max=0;
      for(const p of mesh.listPrimitives()){const a=p.listTargets()[index]?.getAttribute("POSITION")?.getArray();if(a)for(let n=0;n<a.length;n+=3)max=Math.max(max,Math.hypot(a[n],a[n+1],a[n+2]));}
      if(max<=1e-10)return;
      const setting=saved.find((r:any)=>r.id===id);
      const row:DeformationRegion=found.get(id)??{id,label:setting?.name??DEFORMATION_REGION_LABELS[id],targetNames:[],strength:setting?.strength??1,maximumDelta:0};
      if(!row.targetNames.includes(name))row.targetNames.push(name);row.maximumDelta=Math.max(row.maximumDelta,max);found.set(id,row);
    });
  }
  return [...found.values()];
}
