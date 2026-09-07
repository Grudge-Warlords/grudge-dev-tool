import { randomUUID } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CREATION_BUILD, type CreationAttempt, type CreationLibraryAsset, type CreationRequest, type CreationSaveResult } from "../../shared/creationFlow";
import { readCreationBase } from "./creationBase";
import { planCreation } from "./creationPlanner";
import { addOriginalMotion, adjustOriginalGeometry, applyOriginalTextures, createOriginalGeometry, creationIO, enhanceOriginalGeometry, originalGeometryHash, validateOriginal } from "./proceduralCreation";
import { readContainedFile, sha256 } from "./conceptReview";

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const running = new Set<string>();
const activeRoots = new Set<string>();
const directory = (root:string,id:string) => {if(!UUID.test(id))throw new Error("Invalid creation history ID.");return join(root,"creation-history",id);};

async function record(root:string,attempt:CreationAttempt) {
  const dir=directory(root,attempt.id);await mkdir(join(dir,"events"),{recursive:true});
  attempt.updatedAt=new Date().toISOString();
  const text=JSON.stringify(attempt,null,2)+"\n";
  // Every status is retained. The small snapshot is only a current-state index.
  await writeFile(join(dir,"events",`${Date.now()}-${randomUUID()}.json`),text,{flag:"wx"});
  await writeFile(join(dir,"attempt.json.tmp"),text);
  await rename(join(dir,"attempt.json.tmp"),join(dir,"attempt.json"));
}

export async function creationHistory(root:string):Promise<CreationAttempt[]> {
  const location=join(root,"creation-history");if(!existsSync(location))return [];
  const result:CreationAttempt[]=[];
  for(const entry of await readdir(location,{withFileTypes:true})){
    if(!entry.isDirectory()||entry.isSymbolicLink()||!UUID.test(entry.name))continue;
    try {const bytes=await readContainedFile(root,join(location,entry.name,"attempt.json"),2*1024**2);const a=JSON.parse(bytes.toString("utf8")) as CreationAttempt;
      if(a.id!==entry.name||a.version!==1)continue;
      if(a.state==="running"&&!running.has(a.id)){a.state="failed";a.message="Interrupted before completion. All attempt files retained; no automatic regeneration.";await record(root,a);}
      result.push(a);
    } catch { /* Corrupt files are preserved on disk, never removed or overwritten. */ }
  }
  return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}

async function readAttempt(root:string,id:string):Promise<CreationAttempt>{
  const bytes=await readContainedFile(root,join(directory(root,id),"attempt.json"),2*1024**2);return JSON.parse(bytes.toString("utf8"));
}

async function verifiedAttemptAsset(root:string,id:string):Promise<{attempt:CreationAttempt;bytes:Buffer}>{
  const attempt=await readAttempt(root,id);
  if(attempt.state!=="complete"||!attempt.assetPath||!attempt.sha256)throw new Error("This attempt has no completed replayable asset. Its failure/history files remain saved.");
  if(resolve(attempt.assetPath)!==resolve(directory(root,id),"asset.glb"))throw new Error("Invalid saved asset path.");
  const bytes=await readContainedFile(root,attempt.assetPath,256*1024**2);
  if(sha256(bytes)!==attempt.sha256)throw new Error("Saved asset bytes changed. Refusing to replace its recorded source identity.");
  const doc=await (await creationIO()).readBinary(bytes);validateOriginal(doc,attempt.geometryHash,false,attempt.method==="existing-asset");
  return {attempt,bytes};
}

export async function reopenCreation(root:string,id:string):Promise<CreationAttempt>{
  const {attempt}=await verifiedAttemptAsset(root,id);
  await appendFile(join(directory(root,id),"replay-log.jsonl"),JSON.stringify({at:new Date().toISOString(),operation:"local-reopen",sha256:attempt.sha256,validation:"passed; visual playback still required"})+"\n");
  return attempt;
}

const savedAssetsRoot=(root:string)=>join(root,"saved-assets");
const savedModelsRoot=(root:string)=>join(savedAssetsRoot(root),"models");
const savedCatalogRoot=(root:string)=>join(savedAssetsRoot(root),"catalog");
const safeName=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,48)||"asset";
const libraryName=(attempt:CreationAttempt)=>`${safeName(attempt.plan?.kind??"asset")}-${attempt.assetId.slice(0,8)}-${attempt.id.slice(0,8)}.glb`;

function validateLibraryRecord(root:string,record:CreationLibraryAsset,manifestId?:string){
  if(record.version!==1||!UUID.test(record.id)||record.id!==record.attemptId)throw new Error("Invalid saved asset record.");
  if(manifestId&&record.id!==manifestId)throw new Error("Saved asset record ID does not match its catalog file.");
  const models=resolve(savedModelsRoot(root));
  if(resolve(record.savedPath)!==resolve(models,record.name)||!resolve(record.savedPath).startsWith(models+"\\"))throw new Error("Saved asset record points outside the managed local library.");
}

async function verifyLibraryRecord(root:string,record:CreationLibraryAsset,manifestId?:string):Promise<CreationLibraryAsset>{
  validateLibraryRecord(root,record,manifestId);
  const bytes=await readContainedFile(root,record.savedPath,256*1024**2);
  if(bytes.byteLength!==record.byteSize||sha256(bytes)!==record.sha256)throw new Error("Saved library bytes no longer match their provenance record.");
  const doc=await (await creationIO()).readBinary(bytes);validateOriginal(doc,record.geometryHash,false,record.method==="existing-asset");
  return record;
}

export async function creationLibrary(root:string):Promise<CreationLibraryAsset[]>{
  const catalog=savedCatalogRoot(root);if(!existsSync(catalog))return [];
  const result:CreationLibraryAsset[]=[];
  for(const entry of await readdir(catalog,{withFileTypes:true})){
    if(!entry.isFile()||entry.isSymbolicLink()||!UUID.test(entry.name.replace(/\.json$/i,""))||!entry.name.endsWith(".json"))continue;
    try {const id=entry.name.slice(0,-5);const bytes=await readContainedFile(root,join(catalog,entry.name),2*1024**2);const record=JSON.parse(bytes.toString("utf8")) as CreationLibraryAsset;result.push(await verifyLibraryRecord(root,record,id));}
    catch { /* Preserve corrupt records and files; do not expose them as usable assets. */ }
  }
  return result.sort((a,b)=>b.savedAt.localeCompare(a.savedAt));
}

export async function saveCreationToLibrary(root:string,id:string):Promise<CreationSaveResult>{
  const {attempt,bytes}=await verifiedAttemptAsset(root,id);
  const models=savedModelsRoot(root),catalog=savedCatalogRoot(root);await mkdir(models,{recursive:true});await mkdir(catalog,{recursive:true});
  const name=libraryName(attempt),savedPath=join(models,name),manifestPath=join(catalog,`${id}.json`);
  if(existsSync(manifestPath)){
    const record=JSON.parse((await readContainedFile(root,manifestPath,2*1024**2)).toString("utf8")) as CreationLibraryAsset;
    await verifyLibraryRecord(root,record,id);
    if(record.sha256!==attempt.sha256||record.geometryHash!==attempt.geometryHash)throw new Error("This revision's saved-library record conflicts with its source identity. Existing files were preserved.");
    await appendFile(join(directory(root,id),"library-save-log.jsonl"),JSON.stringify({at:new Date().toISOString(),operation:"save-existing",savedPath,sha256:attempt.sha256})+"\n");
    return {asset:record,alreadySaved:true,localAssetsRoot:models};
  }
  if(existsSync(savedPath)){
    const existing=await readContainedFile(root,savedPath,256*1024**2);
    if(sha256(existing)!==attempt.sha256)throw new Error("A different file already uses this managed library name. Existing files were preserved.");
  }else await copyFile(attempt.assetPath!,savedPath,constants.COPYFILE_EXCL);
  const savedBytes=await readContainedFile(root,savedPath,256*1024**2);
  if(sha256(savedBytes)!==attempt.sha256)throw new Error("Local library copy verification failed. The creation-history source remains unchanged.");
  const savedAt=new Date().toISOString();
  const record:CreationLibraryAsset={version:1,id,attemptId:id,assetId:attempt.assetId,name,savedPath,savedAt,byteSize:savedBytes.byteLength,sha256:attempt.sha256!,geometryHash:attempt.geometryHash,kind:attempt.plan?.kind,prompt:attempt.request.prompt,category:attempt.request.category,style:attempt.request.style,build:attempt.build,method:attempt.method,sourceAssets:attempt.sourceAssets};
  await writeFile(manifestPath,JSON.stringify(record,null,2)+"\n",{flag:"wx"});
  await verifyLibraryRecord(root,record,id);
  await appendFile(join(directory(root,id),"library-save-log.jsonl"),JSON.stringify({at:savedAt,operation:"save-new",savedPath,sha256:attempt.sha256})+"\n");
  return {asset:record,alreadySaved:false,localAssetsRoot:models};
}

export async function submitCreation(root:string,request:CreationRequest):Promise<CreationAttempt>{
  if(!request||typeof request.prompt!=="string"||!request.prompt.trim()||request.prompt.length>2000)throw new Error("Enter a prompt of 1–2000 characters.");
  const id=randomUUID(),now=new Date().toISOString();
  const sourceFiles=[__filename,join(__dirname,"proceduralCreation.js"),join(__dirname,"creationPlanner.js")];
  const sourceRevision=sha256(Buffer.concat(await Promise.all(sourceFiles.filter(existsSync).map(p=>readFile(p)))));
  const attempt:CreationAttempt={version:1,id,assetId:id,createdAt:now,updatedAt:now,request:structuredClone(request),state:"running",method:"original-procedural",build:CREATION_BUILD,sourceRevision,message:"Planning a local original creation operation."};
  running.add(id);await record(root,attempt);
  const lock=resolve(root);let ownsLock=false;
  try {
    if(activeRoots.has(lock))throw new Error("A creation is already running. This request is retained as a failed attempt; retry deliberately after it finishes.");
    activeRoots.add(lock);ownsLock=true;
    let parent:CreationAttempt|undefined;
    if(request.parentId)parent=await readAttempt(root,request.parentId);
    const base=request.baseSource?await readCreationBase(request.baseSource):undefined;
    if(base&&request.parentId)throw new Error("Choose either an existing base or a current revision, not both.");
    attempt.plan=base?{kind:"existing-asset",operation:"reuse",summary:"Retain an independent working copy of the selected Grudge asset.",constraints:["Preserve the original file, embedded identity, skin and clips"],planner:"Exact source copy; no model inference"}:await planCreation(request,parent);
    const creating=attempt.plan.operation==="create"||attempt.plan.operation==="reuse";
    if(!creating){parent=await reopenCreation(root,request.parentId!);attempt.parentId=parent.id;attempt.parentSha256=parent.sha256;attempt.previousGeometryHash=parent.geometryHash;attempt.assetId=parent.assetId;}
    if(base||(!creating&&parent?.method==="existing-asset")){attempt.method="existing-asset";attempt.sourceAssets=base?[base.record]:parent?.sourceAssets;}
    attempt.message=attempt.plan.summary;await record(root,attempt);
    const doc=base?await (await creationIO()).readBinary(base.bytes):creating?createOriginalGeometry(attempt.plan,request.style):await (await creationIO()).readBinary(await readContainedFile(root,parent!.assetPath!,256*1024**2));
    if(base){
      // Keep the decoded working copy lossless; the immutable source retains
      // its original compression and byte identity in sourceAssets.
      for(const extension of doc.getRoot().listExtensionsUsed())if(extension.extensionName==="EXT_meshopt_compression")extension.dispose();
      const scene=doc.getRoot().getDefaultScene()??doc.getRoot().listScenes()[0];
      if(!scene)throw new Error("The selected asset contains no scene.");
      const children=[...scene.listChildren()],wrapper=doc.createNode(`GrudgeWorkingCopy_${id.replaceAll("-","")}`).setExtras({localWorkingRoot:true});
      for(const child of children){scene.removeChild(child);wrapper.addChild(child);}scene.addChild(wrapper);doc.getRoot().setDefaultScene(scene);
    }
    if(attempt.plan.operation==="texture"){
      if(attempt.method==="existing-asset" && doc.getRoot().listMeshes().some((m:any)=>m.listPrimitives().some((p:any)=>!p.getAttribute("TEXCOORD_0")||!p.getMaterial())))throw new Error("This source needs UVs or materials. Use the existing Forge texture tools, which support planar UV preparation.");
      await applyOriginalTextures(doc,request.style,request.prompt);
    }
    else if(attempt.plan.operation==="enhance")enhanceOriginalGeometry(doc,attempt.plan);
    else if(attempt.plan.operation==="adjust")adjustOriginalGeometry(doc,attempt.plan);
    else if(!creating)addOriginalMotion(doc,attempt.plan);
    const expectsGeometryChange=attempt.plan.operation==="enhance"||attempt.plan.operation==="adjust";
    attempt.validation=validateOriginal(doc,creating?undefined:parent!.geometryHash,expectsGeometryChange,attempt.method==="existing-asset");
    attempt.geometryHash=originalGeometryHash(doc);
    const lineage={version:1,method:attempt.method,build:attempt.build,sourceRevision,assetId:attempt.assetId,attemptId:id,parentId:attempt.parentId,parentSha256:attempt.parentSha256,geometryHash:attempt.geometryHash,request:attempt.request,plan:attempt.plan,sourceAssets:attempt.sourceAssets??[],generationModelUsedForRevision:false,...(attempt.method==="original-procedural"?{trainingModelUsed:false}:{})};
    const asset=doc.getRoot().getAsset();asset.generator=`Grudge Dev Tool ${CREATION_BUILD}`;asset.extras={...(asset.extras??{}),grudgeProvenance:lineage};
    const rootNode=(doc.getRoot().getDefaultScene()??doc.getRoot().listScenes()[0]).listChildren()[0];rootNode.setExtras({...rootNode.getExtras(),grudgeProvenance:lineage});
    const bytes=await (await creationIO()).writeBinary(doc);
    const reload=await (await creationIO()).readBinary(bytes);validateOriginal(reload,attempt.geometryHash,false,attempt.method==="existing-asset");
    attempt.assetPath=join(directory(root,id),"asset.glb");attempt.sha256=sha256(bytes);
    await writeFile(attempt.assetPath,bytes,{flag:"wx"});
    await writeFile(join(directory(root,id),"provenance.json"),JSON.stringify({...lineage,outputSha256:attempt.sha256},null,2),{flag:"wx"});
    await writeFile(join(directory(root,id),"validation.json"),JSON.stringify(attempt.validation,null,2),{flag:"wx"});
    attempt.state="complete";attempt.message=`${attempt.plan.operation} saved locally. ${attempt.validation.triangles.toLocaleString()} triangles; ${attempt.validation.detailNodes} cosmetic detail nodes; ${attempt.validation.textures} embedded textures; ${attempt.validation.clips.length} clips. ${expectsGeometryChange?"Geometry changed as requested; compare with the previous revision. ":""}Inspect the actual viewport before accepting quality.`;
  }catch(error){attempt.state="failed";attempt.message=error instanceof Error?error.message:String(error);}
  finally{running.delete(id);if(ownsLock)activeRoots.delete(lock);await record(root,attempt);}
  return attempt;
}
