import assert from "node:assert/strict";
import {characterRefinementActions,isCharacterRefinementPrompt} from "../src/shared/characterRefinement";
import {isNewCreationPrompt,type CreationRequest} from "../src/shared/creationFlow";
import {bindRequestedActions,validateCreationPromptPlan} from "../src/main/prompt3d/creationPrompt";

// Routing and plan binding only. All model mutations in the acceptance campaign
// are executed through prompts in the packaged Dev Tool.
async function main(){
 const cases:[string,string][]=[
  ["Smooth and unify the body into a single continuous skin","unify"],
  ["Smooth the skin further","unify"],
  ["Add an appropriate skeleton and bind the skin","rig"],
  ["Create a skeleton for this character","rig"],
  ["Add a jaw bone to the skeleton","rig"],
  ["Move Tail2 bone 5 cm down","rig-edit"],
 ];
 for(const [prompt,operation] of cases){
  assert(isCharacterRefinementPrompt(prompt));assert(!isNewCreationPrompt(prompt));
  const request:CreationRequest={prompt,category:"character",style:"stylized",usePlanner:true};
  const bound=await bindRequestedActions({kind:"assembly",summary:"Plan",unsupported:[],components:[],steps:[{operation,instruction:prompt}]},request,"assembly",{parts:[],clips:[]});
  const plan=validateCreationPromptPlan(bound,"assembly");assert.deepEqual(plan.steps.map(s=>s.operation),[operation]);assert.equal(plan.steps[0].instruction,prompt);
 }
 assert(isNewCreationPrompt("Create a humanoid character and add a skeleton"));
 assert.deepEqual(characterRefinementActions("Do not smooth the skin"),{unify:false,rig:false,rigEdit:false});
 assert(!isCharacterRefinementPrompt("Orbit the viewport left"));
 console.log("Character prompt intent checks passed; no models created or changed.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
