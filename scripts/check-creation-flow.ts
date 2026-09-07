import assert from "node:assert/strict";
import { mkdir, writeFile, copyFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { addOriginalMotion, adjustOriginalGeometry, applyOriginalTextures, createOriginalGeometry, creationIO, enhanceOriginalGeometry, originalGeometryHash, validateOriginal } from "../src/main/prompt3d/proceduralCreation";
import type { CreationPlan, CreationKind } from "../src/shared/creationFlow";
import { creationLibrary, reopenCreation, saveCreationToLibrary, submitCreation } from "../src/main/prompt3d/creationService";

async function main(){
  const base=process.argv[2];if(!base)throw new Error("Supply an explicit retained development-check directory.");
  const dir=resolve(base,`${Date.now()}-${randomUUID()}`);await mkdir(dir,{recursive:true});
  await copyFile(__filename,join(dir,"check-source.ts"));
  const results:any[]=[];
  try{for(const kind of ["sword","game-gun","person"] as CreationKind[]){
    const plan:CreationPlan={kind,operation:"create",curved:kind==="sword",summary:"DEVELOPMENT FIXTURE — not a UI acceptance asset",planner:"none",constraints:[]};
    let doc=createOriginalGeometry(plan,"stylized");const original=originalGeometryHash(doc);
    for(const operation of ["create","texture",kind==="sword"?"swipe":kind==="game-gun"?"projectile":"dance"] as CreationPlan["operation"][]){
      if(operation==="texture")await applyOriginalTextures(doc,"stylized","Texture it with appropriate textures.");
      else if(operation!=="create")addOriginalMotion(doc,{...plan,operation});
      const bytes=await (await creationIO()).writeBinary(doc);await writeFile(join(dir,`${kind}-${operation}.glb`),bytes,{flag:"wx"});
      doc=await (await creationIO()).readBinary(bytes);const validation=validateOriginal(doc,original);
      if(operation==="texture")assert.ok(validation.textures>=3);
      if(!["create","texture"].includes(operation)){
        assert.ok(validation.clips.length);const channels=doc.getRoot().listAnimations()[0].listChannels();
        assert.ok(channels.some((c:any)=>{const a=c.getSampler().getOutput().getArray();return Array.from(a).some((v,i)=>i>=4&&v!==a[i%4]);}));
        if(kind==="person")assert.ok(channels.length>=11,"dance must articulate independent joints");
        if(kind==="game-gun"){const t=channels.find((c:any)=>c.getTargetPath()==="translation");assert.equal(t.getTargetNode().getName(),"CosmeticProjectile");assert.ok(t.getSampler().getOutput().getArray()[2]>.5);}
      }
      results.push({kind,operation,geometryHash:original,...validation});
    }
    const beforeEnhance=originalGeometryHash(doc),clipCount=doc.getRoot().listAnimations().length,textureCount=doc.getRoot().listTextures().length;
    const detailPlan:CreationPlan={...plan,operation:"enhance",adjustments:{cosmeticDetail:true},changes:["development cosmetic detail fixture"]};
    enhanceOriginalGeometry(doc,detailPlan);let validation=validateOriginal(doc,beforeEnhance,true);
    assert.ok(validation.detailNodes>=5,"enhancement must add several visible detail nodes");assert.equal(validation.clips.length,clipCount);assert.equal(validation.textures,textureCount);
    let bytes=await (await creationIO()).writeBinary(doc);await writeFile(join(dir,`${kind}-enhance.glb`),bytes,{flag:"wx"});doc=await (await creationIO()).readBinary(bytes);
    results.push({kind,operation:"enhance",previousGeometryHash:beforeEnhance,geometryHash:originalGeometryHash(doc),...validation});
    const adjustment=kind==="sword"?{bladeLength:1.25,bladeWidth:1.3,curveDelta:.16,guardWidth:1.35}:kind==="game-gun"?{propLength:1.28,propBulk:1.24,muzzleSize:1.3}:{personHeight:1.16,personWidth:1.18,headSize:1.22};
    const measureName=kind==="sword"?"Blade":kind==="game-gun"?"GamePropBody":"Torso";
    const span=(axis:number)=>{const node=doc.getRoot().listNodes().find((n:any)=>n.getName()===measureName),array=node.getMesh().listPrimitives()[0].getAttribute("POSITION").getArray();let min=Infinity,max=-Infinity;for(let i=axis;i<array.length;i+=3){min=Math.min(min,array[i]);max=Math.max(max,array[i]);}return max-min;};
    const beforeSpan=span(kind==="game-gun"?2:kind==="person"?1:1),beforeAdjust=originalGeometryHash(doc);
    const adjustPlan:CreationPlan={...plan,operation:"adjust",adjustments:adjustment,changes:["development structural adjustment fixture"]};adjustOriginalGeometry(doc,adjustPlan);validation=validateOriginal(doc,beforeAdjust,true);
    assert.ok(span(kind==="game-gun"?2:1)>beforeSpan*1.1,"bounded adjustment must visibly change the intended dimension");assert.equal(validation.clips.length,clipCount);assert.equal(validation.textures,textureCount);
    bytes=await (await creationIO()).writeBinary(doc);await writeFile(join(dir,`${kind}-adjust.glb`),bytes,{flag:"wx"});doc=await (await creationIO()).readBinary(bytes);
    results.push({kind,operation:"adjust",previousGeometryHash:beforeAdjust,geometryHash:originalGeometryHash(doc),beforeSpan,afterSpan:span(kind==="game-gun"?2:1),...validation});
  }
    const serviceRoot=join(dir,"managed-library-fixture");
    const created=await submitCreation(serviceRoot,{prompt:"Create a curved sword for managed save verification.",category:"prop",style:"stylized",usePlanner:false});
    assert.equal(created.state,"complete",created.message);assert.ok(created.assetPath&&created.sha256);
    const firstSave=await saveCreationToLibrary(serviceRoot,created.id);assert.equal(firstSave.alreadySaved,false);
    const secondSave=await saveCreationToLibrary(serviceRoot,created.id);assert.equal(secondSave.alreadySaved,true);assert.equal(secondSave.asset.savedPath,firstSave.asset.savedPath);
    assert.deepEqual(await readFile(firstSave.asset.savedPath),await readFile(created.assetPath!));
    const library=await creationLibrary(serviceRoot);assert.equal(library.length,1);assert.equal(library[0].attemptId,created.id);
    const replayed=await reopenCreation(serviceRoot,created.id);assert.equal(replayed.sha256,firstSave.asset.sha256);
    results.push({operation:"managed-save",attemptId:created.id,savedPath:firstSave.asset.savedPath,sha256:firstSave.asset.sha256,idempotent:secondSave.alreadySaved,libraryCount:library.length,reopen:"passed"});
  }catch(error){results.push({failure:String(error)});throw error;}
  finally{await writeFile(join(dir,"results.json"),JSON.stringify({proof:"DEVELOPMENT ONLY — does not satisfy screen-controlled acceptance",results},null,2),{flag:"wx"});console.log(JSON.stringify({directory:dir,checks:results.length,failures:results.filter(r=>r.failure)}));}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
