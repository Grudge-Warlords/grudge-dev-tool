import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CREATION_CATEGORIES, CREATION_PRIMITIVES, CREATION_STYLES, type CreationAdjustments, type CreationComponent, type CreationEdit, type CreationKind, type CreationOperation, type CreationPlan, type CreationRequest } from "../../shared/creationFlow";
import { localJsonPlan } from "./planner";
import { reopenCreation, saveCreationToLibrary, submitCreation } from "./creationService";
import { hasAffirmativePromptMatch } from "../../shared/promptedMotionIntent";
import { planCreation } from "./creationPlanner";
import { CREATION_EDIT_ACTIONS, creationEditContext, validateCreationEdit, applyCreationEdit } from "./creationEdits";
import { creationIO } from "./proceduralCreation";
import { bindLiteralCreationEdit, creationEditClauses } from "./creationLiteralEdits";

const kinds = ["sword","game-gun","person",...CREATION_PRIMITIVES,"assembly","existing-asset"] as const;
const operations = ["create","texture","enhance","adjust","swipe","projectile","dance","turntable","edit","save"] as const;
const numericAdjustments = ["bladeLength","bladeWidth","guardWidth","propLength","propBulk","muzzleSize","personHeight","personWidth","headSize","scaleX","scaleY","scaleZ"] as const;
const tupleSchema={type:"array",items:{type:"number"},minItems:3,maxItems:3};
const schema={type:"object",additionalProperties:false,required:["kind","summary","unsupported","steps","components"],properties:{
  kind:{type:"string",enum:kinds},summary:{type:"string",maxLength:500},unsupported:{type:"array",maxItems:4,items:{type:"string",maxLength:160}},
  steps: {
    type:"array", minItems:1, maxItems:12,
    items: {
      type:"object", additionalProperties:false, required:["operation","instruction"],
      properties: {
        operation:{type:"string",enum:operations}, instruction:{type:"string",maxLength:1000},
        adjustments:{type:"object",additionalProperties:false,properties:{...Object.fromEntries(numericAdjustments.map(k=>[k,{type:"number"}])),curveDelta:{type:"number"}}},
        edit:{type:"object",additionalProperties:false,required:["action","targets"],properties:{action:{type:"string",enum:CREATION_EDIT_ACTIONS},targets:{type:"array",minItems:1,maxItems:64,items:{type:"string"}},value:tupleSchema,color:{type:"string"}}},
      },
    },
  },
  components:{type:"array",maxItems:64,items:{type:"object",additionalProperties:false,required:["name","shape","position","size","color"],properties:{name:{type:"string"},shape:{type:"string",enum:CREATION_PRIMITIVES},position:tupleSchema,size:tupleSchema,color:{type:"string"}}}},
}};
type PromptStep={operation:CreationOperation|"save";instruction:string;adjustments?:CreationAdjustments;edit?:CreationEdit};
export interface CreationPromptPlan {kind:CreationKind;summary:string;steps:PromptStep[];components:CreationComponent[];model:string;planningAttempts?:Array<{model:string;error?:string}>}
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
const newCreationIntent=(prompt:string)=>hasAffirmativePromptMatch(prompt,/(?:^|[.;,]|\b(?:and|then)\b)\s*(?:please\s+)?(?:create|craft|build|assemble)\b|^\s*(?:a\s+)?(?:new|original)\s+(?:sword|gun|person|box|cube|sphere|world|model|asset)\b/i);

function primitivePartCount(prompt:string):number|undefined {
  const numbers:Record<string,number>={a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
  const matches=[...prompt.matchAll(/\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:red|blue|green|gr[ae]y|brown|yellow|ground|simple|small|large)\s+)*(?:cubes?|box(?:es)?|spheres?|cylinders?|cones?|planes?|torus|tori)\b/gi)];
  return matches.length>1?matches.reduce((sum,m)=>sum+(numbers[m[1].toLowerCase()]??Number(m[1])),0):undefined;
}

/** The model may phrase actions, but explicit requested actions cannot disappear or be invented. */
export async function bindRequestedActions(proposal:unknown,request:CreationRequest,parentKind?:CreationKind,context?:ReturnType<typeof creationEditContext>):Promise<unknown>{
  if(!object(proposal)||!Array.isArray(proposal.steps)||!kinds.includes(proposal.kind as any))return proposal;
  const proposedSteps=proposal.steps;
  const prompt=request.prompt;
  const match=(pattern:RegExp)=>hasAffirmativePromptMatch(prompt,pattern);
  const assembly=(!parentKind&&proposal.kind==="assembly")||match(/\b(world|blockout|assemble|assembly|archway|bench)\b/i);
  const newAsset=!parentKind||newCreationIntent(prompt);
  const kind=!newAsset?parentKind!:assembly?"assembly":proposal.kind as CreationKind;
  const requested:PromptStep["operation"][]=[];
  if(newAsset)requested.push("create");
  const namedPart=Boolean(parentKind)&&(/\bonly\b/i.test(prompt)||Boolean(context?.parts.some(p=>p.mesh&&prompt.toLowerCase().includes(p.name.toLowerCase()))));
  const surfacePrompt=prompt.replace(/\b(?:keep|preserve|retain|maintain|leave)\b[^.;,]*?(?=\band\b|\bbut\b|[.;,]|$)/gi,"");
  const adding=Boolean(parentKind)&&match(/\b(add|insert|place)\b[^.;]{0,100}\b(box|cube|sphere|cylinder|cone|plane|torus|tree|trees|component|components)\b/i);
  const colorRequest=hasAffirmativePromptMatch(surfacePrompt,/\b(blue|red|green|yellow|purple|orange|white|black|gold|silver|brown|gr[ae]y|pink|cyan|magenta)\b|#[0-9a-f]{6}\b/i);
  if(!adding&&!namedPart&&(hasAffirmativePromptMatch(surfacePrompt,/\b(textur(?:e|ed|ing)|paint|material|colou?r)\b/i)||(!assembly&&colorRequest)))requested.push("texture");
  if(match(/\b(enhance|ornament|ornamental|embellish|details|decoration|decorative|accents)\b/i))requested.push("enhance");
  const preciseScale=match(/\b(twice|double|half|halve|triple|scale|resize)\b|\b\d+(?:\.\d+)?\s*(?:times\b|%)/i);
  if(!preciseScale&&!namedPart&&match(/\b(longer|shorter|wider|narrower|bulkier|slimmer|broader|taller|curvier|straighter|enlarge|shrink|larger|smaller)\b/i))requested.push("adjust");
  if(match(/\b(swip\w*|swing\w*)\b|side[- ]to[- ]side/i))requested.push("swipe");
  if(match(/\b(projectile|shoot|shooting|fire|firing)\b/i))requested.push("projectile");
  if(match(/\b(dance|dancing)\b/i))requested.push("dance");
  const staticRotation=match(/\b(?:rotate|turn|tilt)\b[^.;]{0,100}(?:\bdegrees?\b|°|\bquarter\b|\bhalf\s+(?:a\s+)?turn\b)/i);
  if(match(/\b(turntable|spin|spinning)\b/i)||(!staticRotation&&match(/\b(rotate|rotating)\b/i)))requested.push("turntable");
  if(match(/\b(save|export)\b/i))requested.push("save");
  if(match(/\b(walk|walking|run|running|jump|jumping|swim|swimming|fly|flying|physics|collision|script|code|gameplay|bevel|remesh|extrude|subdivide)\b/i))throw new Error("This creation prompt includes an action that is not connected to this runner yet. Use the existing animation or Forge tools; no partial build was started.");
  const editActions:CreationEdit["action"][]=[];
  if(match(/\b(move|translate|shift|reposition)\b/i))editActions.push("move");
  if(staticRotation)editActions.push("rotate");
  if(preciseScale||(namedPart&&match(/\b(wider|taller|smaller|larger|longer|shorter|narrower)\b/i)))editActions.push("scale");
  if(namedPart&&colorRequest&&(!adding||match(/\b(make|paint|colou?r)\b/i)))editActions.push("color");
  if(match(/\b(remove|clear|strip|delete)\b[^.;]{0,30}\b(animation|animations|motion|clips?)\b/i))editActions.push("clear-animation");
  if(match(/(?:^|[.;,]|\b(?:and|then)\b)\s*(?:please\s+)?(?:duplicate|copy|clone)\s+/i))editActions.push("duplicate");
  if(match(/\brename\b/i))editActions.push("rename");
  if(adding)editActions.push("add");
  if(match(/\b(remove|delete)\b/i)&&!match(/\b(remove|clear|strip|delete)\b[^.;]{0,30}\b(animation|animations|motion|clips?)\b/i))editActions.push("remove");
  const edits:PromptStep[]=[];
  for(const action of editActions){
    const candidates=proposal.steps.filter(row=>object(row)&&row.operation==="edit"&&object(row.edit)&&row.edit.action===action) as PromptStep[];
    if(!candidates.length&&action==="clear-animation")candidates.push({operation:"edit",instruction:"Remove the animation",edit:{action,targets:["$asset"]}});
    if(!candidates.length)throw new Error(`The local model did not resolve the requested ${action} edit. No partial build was started.`);
    const clauses=creationEditClauses(prompt,action);
    if(clauses.length>1&&candidates.length!==clauses.length)throw new Error(`The prompt requests ${clauses.length} ${action} edits, but the model resolved ${candidates.length}. No partial build was started.`);
    for(const [candidateIndex,candidate] of candidates.entries()){
      const clause=clauses[candidateIndex]??prompt;
      const edit=validateCreationEdit(bindLiteralCreationEdit(validateCreationEdit(candidate.edit),clause));
      if(context){
        const normalized=(name:string)=>name.toLowerCase().replace(/\s+/g," ").trim();
        const targetClause=action==="rename"?clause.split(/\s+to\s+/i)[0]:clause;
        const explicit=context.parts.filter(p=>new RegExp(`(?:^|[^a-z0-9])${normalized(p.name).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?:$|[^a-z0-9])`,"i").test(normalized(targetClause)));
        for(const part of context.parts.filter(p=>/\d/.test(p.name))){
          const pattern=part.name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/\d+/g,"\\d+");
          for(const mention of clause.matchAll(new RegExp(`\\b${pattern}\\b`,"gi")))if(!context.parts.some(p=>normalized(p.name)===normalized(mention[0])))throw new Error(`Part “${mention[0]}” does not exist. No partial build was started.`);
        }
        const futureTarget=(editActions.includes("duplicate")||editActions.includes("rename")||editActions.includes("add"))&&edit.targets.some(name=>!context.parts.some(p=>p.name===name)&&normalized(targetClause).includes(normalized(name)));
        if(explicit.length&&action!=="clear-animation"&&action!=="add"&&!futureTarget)edit.targets=explicit.filter(p=>!explicit.some(other=>other.name!==p.name&&normalized(other.name).includes(normalized(p.name)))).map(p=>p.name);
      }
      const pronoun=action==="move"?/\b(?:move|translate|shift|reposition)\s+it\b/i:action==="rotate"?/\b(?:rotate|turn|tilt)\s+it\b/i:action==="scale"?/\b(?:make|scale|resize|double|halve)\s+it\b/i:null;
      if(pronoun&&hasAffirmativePromptMatch(clause,pronoun))edit.targets=["$asset"];
      if(context&&!editActions.includes("rename")&&!editActions.includes("duplicate")&&!editActions.includes("add")&&edit.targets.some(name=>name!=="$asset"&&!context.parts.some(p=>p.name===name)))throw new Error("An edit names a missing or ambiguous part. Use the exact names shown for the current asset; no partial build was started.");
      if(namedPart&&action==="color"&&edit.targets.includes("$asset"))throw new Error("The prompt selects a part, but the plan would color everything. No changes were made.");
      edits.push({...candidate,edit});
    }
  }
  if(!requested.length&&!edits.length)throw new Error("No supported affirmative action was resolved. Describe a creation or edit using the examples for this asset.");
  const steps:PromptStep[]=[];
  for(const operation of requested){
    const proposed=proposal.steps.find(row=>object(row)&&row.operation===operation) as PromptStep|undefined;
    let adjustments=proposed?.adjustments;
    if(operation==="adjust"){
      const parent:any={assetPath:"retained",plan:{kind},request:{category:request.category,style:request.style}};
      const adjustmentText=prompt.split(/[,;]|\band\b|\bthen\b/i).filter(clause=>/\b(longer|shorter|wider|narrower|bulkier|slimmer|broader|taller|curvier|straighter|enlarge|shrink|larger|smaller)\b/i.test(clause)).join(" and ");
      const deterministic=await planCreation({...request,usePlanner:false,prompt:`Make it ${adjustmentText}`},parent);
      if(deterministic.operation==="adjust")adjustments=deterministic.adjustments;
    }
    const instruction=operation==="texture"?prompt:proposed?.instruction||prompt;
    steps.push({operation,instruction,...(adjustments?{adjustments}:{})});
  }
  // Keep the model's order for explicit edits. Creation precedes edits; library
  // save follows all changes. No unrequested model action survives binding.
  const middle=steps.filter(s=>s.operation!=="create"&&s.operation!=="save");
  const ordered=[...middle,...edits].sort((a,b)=>{
    const index=(s:PromptStep)=>proposedSteps.findIndex(row=>object(row)&&row.operation===s.operation&&(s.operation!=="edit"||(object(row.edit)&&row.edit.action===s.edit?.action)));
    const ai=index(a),bi=index(b);return (ai<0?999:ai)-(bi<0?999:bi);
  });
  const unsupported=Array.isArray(proposal.unsupported)?proposal.unsupported.filter(entry=>!(typeof entry==="string"&&[...kinds,...operations].includes(entry as any))):proposal.unsupported;
  return {...proposal,kind,unsupported,steps:[...steps.filter(s=>s.operation==="create"),...ordered,...steps.filter(s=>s.operation==="save")],components:parentKind&&!requested.includes("create")?[]:proposal.components};
}

/** Ground and connect named simple assemblies when the request leaves dimensions open. */
export function fitDefaultAssembly(plan:Omit<CreationPromptPlan,"model">,prompt:string){
  if(plan.kind!=="assembly"||plan.steps[0]?.operation!=="create"||/\b\d+(?:\.\d+)?\s*(?:m|cm|metres?|meters?)\b/i.test(prompt))return plan;
  const parts=plan.components.map(part=>({...part,position:[...part.position] as [number,number,number],size:[...part.size] as [number,number,number]}));
  if(/\btrees?\b/i.test(prompt)){
    const trunks=parts.filter(p=>p.shape==="cylinder"),crowns=parts.filter(p=>p.shape==="cone");
    if(!trunks.length||trunks.length!==crowns.length)throw new Error("A tree assembly must have one trunk and one crown per tree.");
    trunks.forEach((trunk,index)=>{
      const x=(index-(trunks.length-1)/2)*4;
      Object.assign(trunk,{name:`Tree ${index+1} trunk`,position:[x,.8,0],size:[.4,1.6,.4]});
      Object.assign(crowns[index],{name:`Tree ${index+1} crown`,position:[x,2.8,0],size:[2.4,3,2.4]});
    });
    for(const ground of parts.filter(p=>p.shape==="plane"))Object.assign(ground,{position:[0,0,0],size:[Math.max(12,trunks.length*4+4),.01,12]});
  }else if(/\bbench\b/i.test(prompt)){
    const legs=parts.filter(p=>/leg/i.test(p.name)),seat=parts.find(p=>/seat/i.test(p.name)),back=parts.find(p=>/back/i.test(p.name));
    if(legs.length!==4||!seat||!back)throw new Error("A basic bench needs four named legs, a seat and backrest.");
    legs.forEach((leg,index)=>Object.assign(leg,{position:[index%2?1:-1,.4,index<2?-.32:.32],size:[.15,.8,.15]}));
    Object.assign(seat,{position:[0,.86,0],size:[2.4,.12,.9]});Object.assign(back,{position:[0,1.2,-.39],size:[2.4,.8,.12]});
  }else if(/\barchway\b/i.test(prompt)){
    const pillars=parts.filter(p=>/pillar/i.test(p.name)),lintel=parts.find(p=>/lintel/i.test(p.name));
    if(pillars.length!==2||!lintel)throw new Error("The archway needs two named pillars and a lintel.");
    pillars.forEach((pillar,index)=>Object.assign(pillar,{position:[index===0?-1.5:1.5,1.5,0],size:[.6,3,.6]}));
    Object.assign(lintel,{position:[0,3.3,0],size:[3.6,.6,.6]});
  }else if(/\b(world|scene|ground)\b/i.test(prompt)&&!/\b(float|floating|above|stack|stacked|under|below|height|position|coordinates)\b/i.test(prompt)){
    for(const part of parts)part.position[1]=part.shape==="plane"?0:part.size[1]/2;
  }
  return {...plan,components:parts,summary:`Basic primitive assembly with grounded, connected parts. ${plan.summary}`.slice(0,1000)};
}

export function validateCreationPromptPlan(value:unknown, parentKind?:CreationKind):Omit<CreationPromptPlan,"model"> {
  if(!object(value)||!kinds.includes(value.kind as any)||typeof value.summary!=="string"||value.summary.length>1000||!Array.isArray(value.unsupported)||!Array.isArray(value.steps)||!Array.isArray(value.components))throw new Error("The local model returned an invalid build plan. No build was started.");
  if(value.unsupported.length)throw new Error(`This prompt includes unsupported work: ${value.unsupported.map(String).join("; ").slice(0,1200)}. No partial build was started.`);
  if(value.steps.length<1||value.steps.length>12||value.components.length>64)throw new Error("A prompt supports 1–12 actions and at most 64 assembly components.");
  const kind=value.kind as CreationKind;
  let hasAsset=Boolean(parentKind);
  const stepCount=value.steps.length;
  const steps:PromptStep[]=value.steps.map((raw,index)=>{
    if(!object(raw)||!operations.includes(raw.operation as any)||typeof raw.instruction!=="string"||!raw.instruction.trim()||raw.instruction.length>2000)throw new Error("The model proposed an unsupported action.");
    const operation=raw.operation as PromptStep["operation"];
    if(operation==="create"){if(index!==0||kind==="existing-asset")throw new Error("Only the first action may create a new model.");hasAsset=true;}
    else if(!hasAsset)throw new Error("Create or select a model before requesting edits.");
    if(index===0&&operation!=="create"&&parentKind!==kind)throw new Error("The model tried to change the selected asset kind.");
    if(operation==="save"&&index!==stepCount-1)throw new Error("Save must be the final action.");
    if((operation==="dance"&&kind!=="person")||(operation==="swipe"&&kind!=="sword")||(operation==="projectile"&&kind!=="game-gun"))throw new Error(`The existing ${operation} action is not supported for ${kind}.`);
    if(operation==="enhance"&&!["sword","game-gun","person"].includes(kind))throw new Error("Authored cosmetic details are supported only for sword, game prop and segmented person models. Use Forge for other edits.");
    let adjustments:CreationAdjustments|undefined;
    if(operation==="adjust"){
      if(!object(raw.adjustments)||!Object.keys(raw.adjustments).length)throw new Error("An adjustment needs explicit numeric changes.");
      adjustments={};
      const allowed=kind==="sword"?["bladeLength","bladeWidth","guardWidth","curveDelta"]:kind==="game-gun"?["propLength","propBulk","muzzleSize"]:kind==="person"?["personHeight","personWidth","headSize"]:["scaleX","scaleY","scaleZ"];
      for(const [key,n] of Object.entries(raw.adjustments)){
        if(!allowed.includes(key)||typeof n!=="number"||!Number.isFinite(n)||(key==="curveDelta"?Math.abs(n)>.3:n<.25||n>4))throw new Error(`Invalid bounded adjustment: ${key}.`);
        (adjustments as Record<string,number>)[key]=n;
      }
    }
    return {operation,instruction:raw.instruction.trim(),...(adjustments?{adjustments}:{}),...(operation==="edit"?{edit:validateCreationEdit(raw.edit)}:{})};
  });
  const components:CreationComponent[]=value.components.map(raw=>{
    if(!object(raw)||typeof raw.name!=="string"||!raw.name.trim()||raw.name.length>80||!CREATION_PRIMITIVES.includes(raw.shape as any)||typeof raw.color!=="string"||!/^#[0-9a-f]{6}$/i.test(raw.color))throw new Error("Invalid assembly component.");
    for(const field of ["position","size"] as const){const v=raw[field];if(!Array.isArray(v)||v.length!==3||v.some(n=>typeof n!=="number"||!Number.isFinite(n)||(field==="size"?n<.01||n>200:Math.abs(n)>500)))throw new Error(`Invalid component ${field}.`);}
    return {name:raw.name,shape:raw.shape,position:raw.position,size:raw.size,color:raw.color} as CreationComponent;
  });
  if(kind==="assembly"&&steps[0].operation==="create"&&!components.length)throw new Error("A world or component assembly needs actual parts.");
  if(kind!=="assembly"&&components.length)throw new Error("Only an assembly can contain component placements.");
  if(new Set(components.map(c=>c.name.toLowerCase())).size!==components.length)throw new Error("Assembly part names must be unique.");
  return {kind,summary:value.summary,steps,components};
}

export async function planCreationPrompt(request:CreationRequest,parentKind?:CreationKind,context?:ReturnType<typeof creationEditContext>):Promise<CreationPromptPlan>{
  if(!request||typeof request.prompt!=="string"||!request.prompt.trim()||request.prompt.length>2000||!CREATION_CATEGORIES.includes(request.category)||!CREATION_STYLES.includes(request.style))throw new Error("Enter a valid creation prompt, category and style.");
  if(/\b(hunyuan|trellis|meshy|tripo|hy[- ]motion)\b/i.test(request.prompt))throw new Error("Select the requested local neural provider in Generate from prompt or images. No procedural substitute was made.");
  const assemblyRequest=!parentKind&&/\b(world|scene|blockout|assembly|assemble|archway|bench|trees?|building)\b/i.test(request.prompt);
  const system=`Translate the USER request into supported local 3D actions, JSON only. Never add actions or objects that the user did not ask for. unsupported is [] for supported requests; otherwise list the actual unavailable request. Do not list general limitations.
Kinds: sword, game-gun (cosmetic only), person (segmented), box, sphere, cylinder, cone, plane, torus, assembly, existing-asset. Cube means box. ${parentKind?`Keep currentKind ${parentKind}. Edit the selected model; do not create it again unless explicitly asked.`:"Begin a new model with create."}
Only include requested steps. Preserve requested order. Save is last, only if asked. Do not animate when negated. components is [] unless creating an assembly. A create step builds all components at once.
Actions: create; texture (paint/texture the whole model); enhance (decorative sword/person/game-gun parts); adjust (template proportions); turntable (continuous spinning animation); swipe (sword swing); dance (person); projectile (cosmetic game-gun effect); edit (static edits); save.
Unspecified longer/taller/wider uses adjust multipliers 1.25; smaller/shorter .8. Sword bladeLength/bladeWidth/guardWidth, curvature curveDelta .16. Person personHeight/personWidth/headSize. Game-gun propLength/propBulk/muzzleSize. Other models scaleX/scaleY/scaleZ. Explicit numeric sizes/multipliers use edit scale. Only requested fields.
${assemblyRequest?`This request creates an assembly of primitives. Use ONE create action and put every requested part in components. No steps to add parts. No separate texture step for colors already specified in components. Each part has a unique name, shape, position [x,y,z], size [width,height,depth] in metres, color #RRGGBB. +Y up, shapes centered at position. Size entries must all be positive (minimum .01). Plane lies horizontally: default size [12,.01,12], position [0,0,0]. Default freestanding box/sphere size [1,1,1], position.y=.5. Space free-standing objects 2 metres apart on X. Put each requested shape on the ground unless floating is requested. Do not add unrequested supports or scenery. Describe the result as a basic primitive blockout.
${/\btrees?\b/i.test(request.prompt)?"Every tree has exactly two parts: a brown cylinder trunk and a green cone crown. Name them Tree 1 trunk, Tree 1 crown, Tree 2 trunk, etc. Each requested ground plane is one extra part.":""}
${/\barchway\b/i.test(request.prompt)?"The archway has exactly two named Pillars and one Lintel, three boxes.":""}
${/\bbench\b/i.test(request.prompt)?"The bench has four separate box legs named Leg 1, Leg 2, Leg 3, Leg 4, one Seat and one Backrest. Six brown boxes total. No extra ground.":""}`:""}
${parentKind||/\b(move|rotate|twice|half|scale|remove)\b/i.test(request.prompt)?`Edit step: {"operation":"edit","instruction":"requested clause","edit":{"action":"move","targets":["$asset"],"value":[2,0,0]}}. Allowed actions: move, rotate, scale, color, clear-animation, duplicate, rename, remove, add. Targets are exact names from currentAsset.parts or ["$asset"] for the entire model. Never replace a missing part with the whole asset. Static move is relative metres: +X right, +Y up, +Z forward. Static rotation is relative XYZ Euler degrees; 90 degrees around Y => [0,90,0], never turntable. Scale is XYZ multipliers: twice as wide [2,1,1], half as tall [1,.5,1]. Keep unrequested axes unchanged. Color of named parts uses edit color with color:"#ff0000" and no value. Remove animation uses edit clear-animation targets ["$asset"], with neither value nor color. Separate edits into steps in requested order. Duplicate copies exact named parts with their surface and motion, offset two metres right, names each copy "Part copy" (then "Part copy 2"). Use an additional move step for another offset. Add uses targets:["$asset"] and parts:[{name,shape,position,size,color}] with the same primitive component format, world-space positions. New part names must not exist already; preserve existing parts. Only added parts go in edit.parts, and the top-level components stays empty. Rename uses name:"New name" and exactly one target. Remove deletes named parts from this new revision; old revisions remain available. Do not remove the whole asset. Later steps may target newly renamed or duplicated parts. Movement over time, gameplay, and code use other app tools.`:""}`;
  const requestSchema:any=structuredClone(schema);
  if(parentKind&&!newCreationIntent(request.prompt))requestSchema.properties.kind.enum=[parentKind];
  // Constrain decoding per action: an edit without edit parameters must never
  // be a grammatically valid model output.
  const stepSchema=requestSchema.properties.steps.items;
  const editSchema=stepSchema.properties.edit;
  stepSchema.properties.edit={anyOf:CREATION_EDIT_ACTIONS.map(action=>({type:"object",additionalProperties:false,required:["action","targets",...(["move","rotate","scale"].includes(action)?["value"]:action==="color"?["color"]:action==="rename"?["name"]:action==="add"?["parts"]:[])],properties:{action:{type:"string",enum:[action]},targets:action==="add"||action==="clear-animation"?{type:"array",minItems:1,maxItems:1,items:{type:"string",enum:["$asset"]}}:action==="rename"?{...editSchema.properties.targets,minItems:1,maxItems:1}:editSchema.properties.targets,...(["move","rotate","scale"].includes(action)?{value:tupleSchema}:action==="color"?{color:{type:"string"}}:action==="rename"?{name:{type:"string",maxLength:80}}:action==="add"?{parts:{...schema.properties.components,minItems:1}}:{})}}))};
  requestSchema.properties.steps.items={anyOf:operations.map(operation=>({...stepSchema,required:["operation","instruction",...(operation==="edit"?["edit"]:operation==="adjust"?["adjustments"]:[])],properties:{operation:{type:"string",enum:[operation]},instruction:{type:"string",maxLength:1000},...(operation==="edit"?{edit:stepSchema.properties.edit}:operation==="adjust"?{adjustments:stepSchema.properties.adjustments}:{})}}))};
  if(parentKind&&hasAffirmativePromptMatch(request.prompt,/\b(rename|duplicate|clone|remove|delete|add|insert|place)\b/i)){
    const sequence=CREATION_EDIT_ACTIONS.flatMap(action=>creationEditClauses(request.prompt,action).filter(clause=>hasAffirmativePromptMatch(clause,action==="add"?/\b(add|insert|place)\b/i:action==="duplicate"?/^\s*(?:then\s+)?(?:duplicate|copy|clone)\b/i:action==="rename"?/\brename\b/i:action==="remove"?/\b(remove|delete)\b/i:action==="clear-animation"?/\b(remove|clear|strip|delete)\b[^.;]{0,30}\b(animation|animations|motion|clips?)\b/i:action==="color"?/\b(make|paint|colou?r)\b/i:action==="move"?/\b(move|shift|translate|reposition)\b/i:action==="rotate"?/\b(rotate|turn|tilt)\b/i:/\b(twice|double|half|halve|triple|scale|resize|wider|taller|longer|shorter|smaller|larger|narrower)\b/i)).filter(clause=>action!=="remove"||!/\b(animation|animations|motion|clips?)\b/i.test(clause)).map(clause=>({action,clause,index:request.prompt.indexOf(clause)}))).sort((a,b)=>a.index-b.index);
    if(sequence.length){
      const editStep=requestSchema.properties.steps.items.anyOf.find((step:any)=>step.properties.operation.enum[0]==="edit");
      const exact=sequence.map(({action})=>({...editStep,properties:{...editStep.properties,edit:editStep.properties.edit.anyOf.find((edit:any)=>edit.properties.action.enum[0]===action)}}));
      if(hasAffirmativePromptMatch(request.prompt,/\b(save|export)\b/i))exact.push(requestSchema.properties.steps.items.anyOf.find((step:any)=>step.properties.operation.enum[0]==="save"));
      Object.assign(requestSchema.properties.steps,{minItems:exact.length,maxItems:exact.length,items:exact});
    }
  }
  requestSchema.properties.components.items.properties.size={...tupleSchema,items:{type:"number",minimum:.01,maximum:200}};
  const treeCount=request.prompt.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:green|pine|simple)\s+)?trees?\b/i);
  const numbers:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
  const expectedParts=treeCount?2*(numbers[treeCount[1].toLowerCase()]??Number(treeCount[1]))+(/\b(ground|plane)\b/i.test(request.prompt)?1:0):/\barchway\b/i.test(request.prompt)?3:/\bbench\b/i.test(request.prompt)?6:primitivePartCount(request.prompt);
  if(!parentKind&&expectedParts&&expectedParts<=64){
    Object.assign(requestSchema.properties.components,{minItems:expectedParts,maxItems:expectedParts});
  }else requestSchema.properties.components.maxItems=16;
  // Existing single-object templates own their geometry. A model must not
  // invent assembly components for a sword, person, primitive or game prop.
  const direct=request.prompt.match(/\b(?:create|craft|build|make)\s+(?:(?:a|an|new|original|cosmetic|game|segmented|curved|simple|basic|low-poly|red|blue|green|brown|grey|gray)\s+)*(sword|sabre|saber|scimitar|katana|rapier|gun|blaster|pistol|rifle|person|character|human|dancer|cube|box|sphere|cylinder|cone|plane|torus)\b/i)?.[1].toLowerCase();
  if(!parentKind&&!assemblyRequest&&direct){
    const directKind=/sword|sabre|saber|scimitar|katana|rapier/.test(direct)?"sword":/gun|blaster|pistol|rifle/.test(direct)?"game-gun":/person|character|human|dancer/.test(direct)?"person":direct==="cube"?"box":direct;
    requestSchema.properties.kind.enum=[directKind];requestSchema.properties.components.maxItems=0;
  }
  if((parentKind&&!newCreationIntent(request.prompt))||requestSchema.properties.components.maxItems===0)requestSchema.properties.components={type:"array",enum:[[]]};
  const input={prompt:request.prompt,category:request.category,style:request.style,currentKind:parentKind??null,currentAsset:context??null,requiredSteps:Array.isArray(requestSchema.properties.steps.items)?requestSchema.properties.steps.items.map((step:any)=>({operation:step.properties.operation.enum[0],action:step.properties.edit?.properties.action.enum[0]})):undefined};
  let lastError:Error|undefined;
  const planningAttempts:Array<{model:string;error?:string}>=[];
  for(let attempt=0;attempt<2;attempt++){
    const {proposal,model}=await localJsonPlan(system,JSON.stringify({...input,...(lastError?{correction:`Previous plan was rejected: ${lastError.message}. Resolve this without changing the user's request.`}:{})}),requestSchema,expectedParts&&expectedParts>12?4096:3072,{grudgeDev:true,startIfNeeded:true});
    try{const plan=fitDefaultAssembly(validateCreationPromptPlan(await bindRequestedActions(proposal,request,parentKind,context),parentKind),request.prompt);planningAttempts.push({model});return {...plan,model,planningAttempts};}
    catch(error){planningAttempts.push({model,error:error instanceof Error?error.message:String(error)});lastError=new Error(error instanceof Error?error.message:String(error),{cause:{model,proposal,planningAttempt:attempt+1,planningAttempts}});}
  }
  throw lastError;

}

const activeBuilds=new Set<string>();
/** One UI request executes validated actions through the existing immutable revision store. */
export async function submitCreationPrompt(root:string,request:CreationRequest){
  if(!request.usePlanner||request.baseSource)return submitCreation(root,request);
  const key=resolve(root);if(activeBuilds.has(key))throw new Error("A prompt build is already running. Wait for it to finish.");
  activeBuilds.add(key);
  const id=randomUUID(),folder=join(root,"prompt-builds",id),receipt:any={id,prompt:request.prompt,startedAt:new Date().toISOString(),state:"planning",revisions:[]};
  const record=()=>writeFile(join(folder,"build.json"),JSON.stringify(receipt,null,2));
  try{
    await mkdir(folder,{recursive:true});await record();
    let current=request.parentId?await reopenCreation(root,request.parentId):undefined;
    const context=current?.assetPath?creationEditContext(await(await creationIO()).readBinary(await readFile(current.assetPath))):undefined;
    const plan=await planCreationPrompt(request,current?.plan?.kind,context);receipt.plan=plan;
    // Resolve sequential names and topology against a disposable copy BEFORE
    // committing any step. A missing later target cannot produce a partial edit.
    if(current?.assetPath&&plan.steps.every(step=>step.operation==="edit"||step.operation==="save")){
      const preflight=await(await creationIO()).readBinary(await readFile(current.assetPath));
      for(const step of plan.steps)if(step.operation==="edit")applyCreationEdit(preflight,step.edit!);
    }
    receipt.state="running";await record();
    for(const [index,step] of plan.steps.entries()){
      if(step.operation==="save"){if(!current)throw new Error("No model is available to save.");receipt.saved=await saveCreationToLibrary(root,current.id);continue;}
      const compiled:CreationPlan={kind:plan.kind,operation:step.operation,edit:step.edit,curved:/\b(curved|sabre|saber|scimitar)\b/i.test(request.prompt),adjustments:step.adjustments,summary:plan.summary,changes:step.adjustments?Object.entries(step.adjustments).map(([k,v])=>`${k}: ${v}`):undefined,constraints:["Existing CPU authoring; local model planned the actions","Each output is a separate immutable revision; inspect actual quality"],planner:`${plan.model} · local CPU action planner`,components:plan.components,promptBuild:{id,prompt:request.prompt,model:plan.model,step:index+1,totalSteps:plan.steps.length}};
      current=await submitCreation(root,{...request,prompt:step.instruction,usePlanner:false,parentId:step.operation==="create"?undefined:current?.id},compiled);
      receipt.revisions.push({id:current.id,state:current.state,operation:step.operation,sha256:current.sha256,path:current.assetPath,message:current.message});await record();
      if(current.state!=="complete")throw new Error(`Build stopped at ${step.operation}: ${current.message}`);
    }
    if(!current)throw new Error("The prompt produced no model.");
    receipt.state="complete";receipt.finishedAt=new Date().toISOString();await record();return current;
  }catch(error){receipt.state="failed";receipt.error=error instanceof Error?error.message:String(error);if(error instanceof Error&&error.cause)receipt.rejectedPlan=error.cause;await record();throw error;}
  finally{activeBuilds.delete(key);}
}
