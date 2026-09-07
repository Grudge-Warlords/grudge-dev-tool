import { readFile, writeFile } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import * as THREE from "three";
import { sha256 } from "./conceptReview";
import { regionsIn, regionAnimation, activeRegionTargets, type RegionClip } from "./deformationRegions";
import { deformationOperator } from "../../shared/deformationRegions";
import { REGION_COLORS, customRegionWeight, transformedRegionDelta, validateRegionDefinitions, type RegionBounds, type RegionDefinition, type RegionVector } from "../../shared/deformationRegionModel";

const io=()=>new NodeIO().registerExtensions(ALL_EXTENSIONS);
async function load(path:string,expected:string){const bytes=await readFile(path);if(sha256(bytes)!==expected)throw new Error("This exact animation changed; reopen it before editing.");return io().readBinary(bytes);}
export async function inspectRegionEditor(path:string,expected:string,binding?:RegionClip){
  const doc=await load(path,expected),animation=regionAnimation(doc,binding),regions=regionsIn(doc,binding),retained=(animation.getExtras() as any).grudgePromptAnimation?.plan?.regions;
  const definitions:RegionDefinition[]=retained??regions.map((r,i)=>({id:r.id,name:r.label,color:Object.keys(REGION_COLORS)[i%8],kind:"effective",center:[.5,.5,.5],extent:[.5,.5,.5],operation:"original",axis:"x",amount:.1,strength:1}));
  return {sha256:expected,regions,definitions,clipName:animation.getName()};
}

export async function writeRegionEditorPreview(path:string,expected:string,output:string,value:unknown,binding?:RegionClip){
  const doc=await load(path,expected),root=doc.getRoot(),baseRegions=regionsIn(doc,binding);
  const definitions=validateRegionDefinitions(value,baseRegions.map(r=>r.id)),custom=definitions.filter(r=>r.kind==="custom");
  const modelBox=new THREE.Box3(),v=new THREE.Vector3();
  const nodes=root.listNodes().filter(n=>n.getMesh());
  for(const node of nodes){const matrix=new THREE.Matrix4().fromArray(node.getWorldMatrix());for(const p of node.getMesh()!.listPrimitives()){const a=p.getAttribute("POSITION")!;for(let i=0;i<a.getCount();i++)modelBox.expandByPoint(v.fromArray(a.getArray()!,i*3).applyMatrix4(matrix));}}
  if(modelBox.isEmpty())throw new Error("This animation contains no editable mesh.");
  const bounds:RegionBounds={min:modelBox.min.toArray() as RegionVector,max:modelBox.max.toArray() as RegionVector};
  const buffer=root.listBuffers()[0]??doc.createBuffer();
  const activeAnimation=regionAnimation(doc,binding);
  const phaseInput=activeAnimation.listSamplers().find(s=>s.getInput())?.getInput();if(!phaseInput)throw new Error("This animation has no timing samples.");
  const times=phaseInput.getArray()!,duration=Number(times[times.length-1])-Number(times[0]);if(!(duration>0))throw new Error("This animation has no positive duration.");
  const cycles=Number((activeAnimation.getExtras() as any).grudgePromptAnimation?.plan?.cycles??1);
  for(const mesh of root.listMeshes()){
    const meshNodes=nodes.filter(n=>n.getMesh()===mesh),node=meshNodes[0];if(!node)continue;
    if(meshNodes.some(n=>JSON.stringify(n.getWorldMatrix())!==JSON.stringify(node.getWorldMatrix())))throw new Error("This mesh is instanced at different transforms. Make separate objects in Forge before placing regions.");
    const matrix=new THREE.Matrix4().fromArray(node.getWorldMatrix()),inverse=matrix.clone().invert();
    const names=((mesh.getExtras() as any).targetNames??[]) as string[],oldCount=mesh.listPrimitives()[0].listTargets().length;
    if(mesh.listPrimitives().some(p=>p.listTargets().length!==oldCount)||oldCount+custom.length*2>32)throw new Error("This mesh exceeds the editable morph-target limit or has inconsistent targets.");
    const active=activeRegionTargets(activeAnimation,mesh);
    for(const other of root.listAnimations().filter(a=>a!==activeAnimation)){
      const shared=activeRegionTargets(other,mesh);
      if([...active].some(index=>shared.has(index)))throw new Error("This motion shares influence targets with another clip. Separate those tracks in Forge before editing regions.");
    }
    const envelope=new Map<string,number>();
    for(const p of mesh.listPrimitives())names.forEach((name,index)=>{if(!active.has(index))return;const id=deformationOperator(name),a=p.listTargets()[index]?.getAttribute("POSITION")?.getArray();if(!id||!a)return;let max=envelope.get(id)??0;for(let i=0;i<a.length;i+=3)max=Math.max(max,Math.hypot(Number(a[i]),Number(a[i+1]),Number(a[i+2])));envelope.set(id,max);});
    for(const primitive of mesh.listPrimitives()){
      const positions=primitive.getAttribute("POSITION")!.getArray()!,local=new THREE.Vector3();
      const transform=(r:RegionDefinition,source:ArrayLike<number>|undefined,sign:number)=>{
        const result=new Float32Array(positions.length);
        for(let i=0;i<positions.length;i+=3){
          const p=v.fromArray(positions,i).applyMatrix4(matrix).toArray() as RegionVector;
          const weight=r.kind==="custom"?customRegionWeight(p,bounds,r):source?Math.min(1,Math.hypot(Number(source[i]),Number(source[i+1]),Number(source[i+2]))/Math.max(envelope.get(r.id)??0,1e-9)):0;
          const delta=transformedRegionDelta(p,bounds,r,weight,sign);
          local.set(p[0]+delta[0],p[1]+delta[1],p[2]+delta[2]).applyMatrix4(inverse);
          result[i]=local.x-Number(positions[i]);result[i+1]=local.y-Number(positions[i+1]);result[i+2]=local.z-Number(positions[i+2]);
        }
        return result;
      };
      names.forEach((name,index)=>{
        if(!active.has(index))return;
        const id=deformationOperator(name),r=definitions.find(d=>d.id===id);if(!r)return;
        const target=primitive.listTargets()[index],a=target?.getAttribute("POSITION");if(!a)return;
        const original=a.getArray()!;
        const deltas=r.operation==="original"?Float32Array.from(original,n=>Number(n)*r.strength):transform(r,original,/negative|cosine/.test(name)?-1:1);
        target.setAttribute("POSITION",a.clone().setArray(deltas));
        if(r.operation!=="original"){target.setAttribute("NORMAL",null);target.setAttribute("TANGENT",null);}
      });
      for(const r of custom)for(const sign of [1,-1]){const name=`Region:${r.id}:${sign>0?"positive":"negative"}`;primitive.addTarget(doc.createPrimitiveTarget(name).setAttribute("POSITION",doc.createAccessor(name).setType("VEC3").setArray(transform(r,undefined,sign)).setBuffer(buffer)));}
    }
    const customNames=custom.flatMap(r=>[`Region:${r.id}:positive`,`Region:${r.id}:negative`]);
    mesh.setExtras({...mesh.getExtras(),targetNames:[...names,...customNames]});
    if(!custom.length)continue;
    const added=custom.length*2,newCount=oldCount+added;
    mesh.setWeights([...Array.from({length:oldCount},(_,i)=>mesh.getWeights()[i]??0),...Array(added).fill(0)]);
    for(const n of meshNodes)if(n.getWeights().length)n.setWeights([...n.getWeights(),...Array(added).fill(0)]);
    for(const animation of root.listAnimations()){
      const targeted=new Set<any>();
      for(const channel of animation.listChannels()){
        if(channel.getTargetPath()!=="weights"||channel.getTargetNode()?.getMesh()!==mesh)continue;
        targeted.add(channel.getTargetNode());const sampler=channel.getSampler()!,input=sampler.getInput()!,output=sampler.getOutput()!;
        if(sampler.getInterpolation()==="CUBICSPLINE")throw new Error("Custom areas require linear or step morph timing; use Forge to convert cubic morph tracks first.");
        const old=output.getArray()!;if(old.length!==input.getCount()*oldCount)throw new Error("The existing morph timing is inconsistent.");
        const next=new Float32Array(input.getCount()*newCount);
        for(let f=0;f<input.getCount();f++){for(let i=0;i<oldCount;i++)next[f*newCount+i]=Number(old[f*oldCount+i]);if(animation===activeAnimation){const wave=Math.sin((Number(input.getArray()![f])-Number(times[0]))/duration*Math.PI*2*cycles);for(let i=0;i<added;i++)next[f*newCount+oldCount+i]=Math.max(0,wave*(i%2?-1:1));}}
        const replacement=doc.createAnimationSampler().setInput(input).setOutput(output.clone().setArray(next)).setInterpolation(sampler.getInterpolation());animation.addSampler(replacement);channel.setSampler(replacement);
      }
      if(animation===activeAnimation)for(const n of meshNodes)if(!targeted.has(n)){
        const next=new Float32Array(phaseInput.getCount()*newCount);
        for(let f=0;f<phaseInput.getCount();f++){const wave=Math.sin((Number(times[f])-Number(times[0]))/duration*Math.PI*2*cycles);for(let i=0;i<added;i++)next[f*newCount+oldCount+i]=Math.max(0,wave*(i%2?-1:1));}
        const sampler=doc.createAnimationSampler().setInput(phaseInput).setOutput(doc.createAccessor().setType("SCALAR").setArray(next).setBuffer(buffer)).setInterpolation("LINEAR");animation.addSampler(sampler);animation.addChannel(doc.createAnimationChannel().setTargetNode(n).setTargetPath("weights").setSampler(sampler));
      }
    }
  }
  root.getAsset().extras={...(root.getAsset().extras as object??{}),grudgeDeformationRegions:definitions,grudgeDeformationStrengths:Object.fromEntries(definitions.map(r=>[r.id,r.strength]))};
  const e=activeAnimation.getExtras() as any;activeAnimation.setExtras({...e,grudgePromptAnimation:{...e.grudgePromptAnimation,plan:{...e.grudgePromptAnimation?.plan,regions:definitions}}});
  const bytes=await io().writeBinary(doc),reloaded=await io().readBinary(bytes),regions=regionsIn(reloaded,binding);
  for(const r of custom)if(!regions.some(candidate=>candidate.id===r.id))throw new Error(`“${r.name}” covers no vertices or produces no motion. Move or enlarge its highlighted coverage.`);
  await writeFile(output,bytes,{flag:"wx"});
  return {sha256:sha256(bytes),regions,definitions,path:output,clipName:activeAnimation.getName(),maximumDeformationRatio:Math.max(0,...regions.map(r=>r.maximumDelta))/Math.max(modelBox.getSize(new THREE.Vector3()).length(),1e-9)};
}
