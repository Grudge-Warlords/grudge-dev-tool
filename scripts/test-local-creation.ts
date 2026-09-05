import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { submitCreation, saveCreationToLibrary, reopenCreation } from "../src/main/prompt3d/creationService";
import { CREATION_PRIMITIVES } from "../src/shared/creationFlow";
import { sha256 } from "../src/main/prompt3d/conceptReview";
import { compilePrompt3DUnifiedPlan } from "../src/shared/prompt3dOrchestrator";
import { creationIO, originalGeometryHash } from "../src/main/prompt3d/proceduralCreation";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";

async function main(){
 const root=await mkdtemp(join(tmpdir(),"grudge-local-creation-"));
 const request={category:"prop" as const,style:"stylized" as const,usePlanner:false};
 for(const shape of CREATION_PRIMITIVES){const a=await submitCreation(root,{...request,prompt:`Create a ${shape}`});assert.equal(a.state,"complete",a.message);assert.equal(a.plan?.kind,shape);assert.ok(a.validation!.triangles>0);}
 const base=await submitCreation(root,{...request,prompt:"Create a curved sword"});assert.equal(base.state,"complete",base.message);
 const source=process.env.GRUDGE_REUSE_TEST_ASSET||base.assetPath!;
 const before=sha256(await readFile(source));
 const reused=await submitCreation(root,{...request,prompt:"Use selected model as base",baseSource:{kind:"local-file",path:source}});assert.equal(reused.state,"complete",reused.message);assert.equal(reused.method,"existing-asset");assert.equal(reused.sourceAssets?.[0].sha256,before);
 const wider=await submitCreation(root,{...request,parentId:reused.id,prompt:"Make it wider"});assert.equal(wider.state,"complete",wider.message);assert.notEqual(wider.geometryHash,reused.geometryHash);
 const spin=await submitCreation(root,{...request,parentId:wider.id,prompt:"Add a turntable"});assert.equal(spin.state,"complete",spin.message);assert.equal(spin.geometryHash,wider.geometryHash);assert.ok(spin.validation!.clips.includes("Turntable"));
 const saved=await saveCreationToLibrary(root,spin.id);const reopened=await reopenCreation(root,spin.id);assert.equal(sha256(await readFile(saved.asset.savedPath)),reopened.sha256);assert.equal(sha256(await readFile(source)),before);
 const io=await creationIO(),compressed=await io.readBinary(await readFile(source));
 compressed.createExtension(EXTMeshoptCompression).setRequired(true);
 const compressedPath=join(root,"meshopt-source.glb"),compressedBytes=await io.writeBinary(compressed);await writeFile(compressedPath,compressedBytes);
 const decodedHash=originalGeometryHash(await io.readBinary(compressedBytes));
 const compressedReuse=await submitCreation(root,{...request,prompt:"Use compressed catalog model",baseSource:{kind:"local-file",path:compressedPath}});
 assert.equal(compressedReuse.state,"complete",compressedReuse.message);
 const compressedReopened=await reopenCreation(root,compressedReuse.id);
 assert.equal(originalGeometryHash(await io.readBinary(await readFile(compressedReopened.assetPath!))),compressedReuse.geometryHash);
 assert.equal(sha256(await readFile(compressedPath)),sha256(compressedBytes));assert.ok(decodedHash);
 const blocked=await submitCreation(root,{...request,prompt:"Create a sphere using Hunyuan"});assert.equal(blocked.state,"failed");
 const context={mode:"new" as const,category:"prop" as const,localControlsEnabled:true,localAnimationLibraries:0,providers:[]};
 assert.equal(compilePrompt3DUnifiedPlan({prompt:"Create a sphere",context}).selectedRoute,"original-procedural");
 assert.equal(compilePrompt3DUnifiedPlan({prompt:"Create a sphere using Hunyuan",context}).selectedRoute,"hunyuan3d-2");
 const local=compilePrompt3DUnifiedPlan({prompt:"Paint it blue",context:{...context,mode:"revise-current",currentRevision:{id:reused.id,method:"existing-asset"}}});assert.equal(local.selectedRoute,"original-procedural");assert.ok(local.stages.every(s=>!s.route.startsWith("hunyuan")));
 console.log(JSON.stringify({passed:true,root,source,sourceUnchanged:true,shapes:CREATION_PRIMITIVES,saved:saved.asset.savedPath}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
