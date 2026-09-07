import assert from "node:assert/strict";
import { readFile,mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { sha256 } from "../src/main/prompt3d/conceptReview";
import { inspectRegionEditor,writeRegionEditorPreview } from "../src/main/prompt3d/deformationRegionEditor";
import { inspectWorkflowGlb } from "../src/main/prompt3d/workflow";
import { resolveRegionInstruction,transformedRegionDelta,type RegionDefinition } from "../src/shared/deformationRegionModel";
import { authorPromptedAnimation } from "../src/main/prompt3d/promptedAnimation";
import { activeRegionTargets,regionAnimation } from "../src/main/prompt3d/deformationRegions";
import { submitCreation } from "../src/main/prompt3d/creationService";

async function main(){
 const root=await mkdtemp(join(tmpdir(),"grudge-regions-"));
 let source=process.env.GRUDGE_REGION_TEST_ASSET;
 if(!source){
  const base=await submitCreation(root,{category:"prop",style:"stylized",usePlanner:false,prompt:"Create a box"});
  assert.equal(base.state,"complete",base.message);assert.ok(base.assetPath);
  source=join(root,"fixture-motion.glb");
  await authorPromptedAnimation({sourcePath:base.assetPath!,outputPath:source,instruction:"hop forward once",seed:23,overrides:{mode:"replace",clipName:"Fixture hop",deformations:["grounded-stride"],requireBodyDeformation:true}});
 }
 const before=sha256(await readFile(source)),inventory=await inspectRegionEditor(source,before);
 assert.ok(inventory.regions.length>0);const id=inventory.definitions[0].id;
 const weak=inventory.definitions.map(r=>({...r,strength:r.id===id?.5:1}));
 const strong=inventory.definitions.map(r=>({...r,strength:r.id===id?1.5:1}));
 const weakOut=await writeRegionEditorPreview(source,before,join(root,"weak.glb"),weak),strongOut=await writeRegionEditorPreview(source,before,join(root,"strong.glb"),strong);
 const ratio=strongOut.regions.find(r=>r.id===id)!.maximumDelta/weakOut.regions.find(r=>r.id===id)!.maximumDelta;assert.ok(Math.abs(ratio-3)<1e-5,`amplitude ratio ${ratio}`);
 const original=await inspectWorkflowGlb(source);
 for(const output of [weakOut,strongOut]){const actual=await inspectWorkflowGlb(output.path);assert.equal(actual.geometryHash,original.geometryHash);assert.equal(actual.textureFingerprint,original.textureFingerprint);assert.deepEqual(actual.animations,original.animations);}
 const custom:RegionDefinition={id:"custom-36b4f7ba-46c5-469f-a1a6-383ef8f1815c",name:"Tail tip",color:"red",kind:"custom",center:[...inventory.definitions[0].center],extent:[2,2,2],operation:"move",axis:"y",amount:.05,strength:1};
 const edited=resolveRegionInstruction("bend Tail tip sideways 20 degrees",[...weak,custom],null);assert.equal(edited.region.id,custom.id);assert.equal(edited.region.operation,"bend");
 assert.throws(()=>resolveRegionInstruction("bend missing tail sideways 20 degrees",weak,id));
 assert.throws(()=>resolveRegionInstruction("make the red region weaker",[custom,{...custom,id:"duplicate"}],id),/more than one/);
 const customOut=await writeRegionEditorPreview(source,before,join(root,"custom.glb"),[...weak,edited.region]);
 const reopened=await inspectRegionEditor(customOut.path,customOut.sha256);assert.equal(reopened.definitions.at(-1)?.name,"Tail tip");assert.equal(reopened.definitions.at(-1)?.color,"red");assert.ok(reopened.regions.some(r=>r.id===custom.id));
 const extra=await inspectWorkflowGlb(customOut.path);assert.equal(extra.geometryHash,original.geometryHash);assert.equal(extra.textureFingerprint,original.textureFingerprint);assert.equal(sha256(await readFile(source)),before);
 const bounds={min:[-1,-1,-1] as [number,number,number],max:[1,1,1] as [number,number,number]};
 for(const axis of ["x","y","z"] as const){const index={x:0,y:1,z:2}[axis],point:[number,number,number]=[.4,.4,.4];point[index]=0;const delta=transformedRegionDelta(point,bounds,{...custom,operation:"bend",axis,amount:20},1,1);assert.ok(delta[index]>0,`bend toward ${axis}`);}
 const bend={...custom,operation:"bend" as const,axis:"x" as const,amount:20};
 const left=transformedRegionDelta([.4,-.000001,0],bounds,bend,1,1),right=transformedRegionDelta([.4,.000001,0],bounds,bend,1,1);
 assert.ok(Math.hypot(...left.map((v,i)=>v-right[i]))<.00001,"bend must stay continuous across its centre");
 const appendedPath=join(root,"appended.glb");
 const appended=await authorPromptedAnimation({sourcePath:source,outputPath:appendedPath,instruction:"walk naturally in place",seed:24,overrides:{mode:"append",clipName:"Later walk",deformations:["grounded-stride"],requireBodyDeformation:true}});
 const appendedSha=sha256(await readFile(appendedPath)),later=await inspectRegionEditor(appendedPath,appendedSha,appended.plan);
 assert.equal(later.clipName,"Later walk");assert.ok(later.regions.every(r=>r.targetNames.every(n=>n.includes(appended.plan.clipId))));
 const revised=await writeRegionEditorPreview(appendedPath,appendedSha,join(root,"later-regions.glb"),[...later.definitions.map(r=>({...r,strength:.5})),edited.region],appended.plan);
 const beforeDoc=await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(await readFile(appendedPath)),afterDoc=await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(await readFile(revised.path));
 const activeBefore=regionAnimation(beforeDoc,appended.plan),activeAfter=regionAnimation(afterDoc,appended.plan);
 for(let m=0;m<beforeDoc.getRoot().listMeshes().length;m++){
   const a=beforeDoc.getRoot().listMeshes()[m],b=afterDoc.getRoot().listMeshes()[m],selected=activeRegionTargets(activeBefore,a);
   for(let p=0;p<a.listPrimitives().length;p++)for(let t=0;t<a.listPrimitives()[p].listTargets().length;t++)if(!selected.has(t))assert.deepEqual(b.listPrimitives()[p].listTargets()[t].getAttribute("POSITION")!.getArray(),a.listPrimitives()[p].listTargets()[t].getAttribute("POSITION")!.getArray(),"other clip deltas preserved");
   const oldCount=a.listPrimitives()[0].listTargets().length,added=[...activeRegionTargets(activeAfter,b)].filter(i=>i>=oldCount);assert.equal(added.length,2);
   for(const other of afterDoc.getRoot().listAnimations().filter(c=>c!==activeAfter))assert.ok([...activeRegionTargets(other,b)].every(i=>i<oldCount),"custom motion must not drive another clip");
 }
 console.log(JSON.stringify({passed:true,root,source,sourceUnchanged:true,strengthRatio:ratio,regions:inventory.regions.map(r=>r.label),customSaved:true}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
