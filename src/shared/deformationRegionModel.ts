export type RegionVector=[number,number,number];
export const REGION_COLORS={red:"#ef4444",orange:"#f97316",yellow:"#eab308",green:"#22c55e",cyan:"#06b6d4",blue:"#3b82f6",purple:"#a855f7",pink:"#ec4899"} as const;
export type RegionColor=keyof typeof REGION_COLORS;
export interface RegionDefinition {
  id:string; name:string; color:RegionColor; kind:"effective"|"custom";
  center:RegionVector; extent:RegionVector;
  operation:"original"|"move"|"bend"|"swing"|"rotate"|"scale";
  axis:"x"|"y"|"z"; amount:number; strength:number;
}
export interface RegionBounds {min:RegionVector;max:RegionVector;}
export function validateRegionDefinitions(value:unknown, effectiveIds:string[]):RegionDefinition[]{
  if(!Array.isArray(value)||value.length>15)throw new Error("Use at most four custom moving areas.");
  const ids=new Set<string>();let custom=0;
  for(const r of value){
    if(!r||typeof r!=="object"||typeof r.id!=="string"||ids.has(r.id))throw new Error("Each area needs its own stable identity.");ids.add(r.id);
    if(r.kind==="effective"){if(!effectiveIds.includes(r.id))throw new Error("An effective area does not belong to this animation.");}
    else if(r.kind==="custom"){if(!/^custom-[a-f0-9-]{36}$/i.test(r.id)||++custom>4)throw new Error("Use at most four custom moving areas.");}
    else throw new Error("Unknown area type.");
    if(typeof r.name!=="string"||!r.name.trim()||r.name.length>48||/[<>\u0000-\u001f]/.test(r.name)||!(r.color in REGION_COLORS))throw new Error("Give the area a short name and an available colour.");
    for(const [field,lo,hi] of [["center",0,1],["extent",.02,2]] as const)if(!Array.isArray(r[field])||r[field].length!==3||r[field].some((n:unknown)=>typeof n!=="number"||!Number.isFinite(n)||n<lo||n>hi))throw new Error("Area placement must stay inside the model bounds; coverage must be 2%–200%.");
    if(!["original","move","bend","swing","rotate","scale"].includes(r.operation)||!["x","y","z"].includes(r.axis)||typeof r.amount!=="number"||!Number.isFinite(r.amount)||typeof r.strength!=="number"||!Number.isFinite(r.strength)||r.strength<.1||r.strength>2)throw new Error("Choose an available direction, motion and strength from 10%–200%.");
    if(r.kind==="custom"&&r.operation==="original")throw new Error("Choose a motion for the custom area.");
    const limit=["rotate","bend","swing"].includes(r.operation)?90:r.operation==="scale"?.75:.5;
    if(Math.abs(r.amount)>limit)throw new Error(`The selected motion amount must be within ${limit}.`);
  }
  if(effectiveIds.some(id=>!ids.has(id)))throw new Error("Retain every existing area; use strength or undo to adjust it.");
  return structuredClone(value);
}
export function customRegionWeight(p:RegionVector,b:RegionBounds,r:RegionDefinition):number{
  const d=p.map((n,i)=>(n-(b.min[i]+(b.max[i]-b.min[i])*r.center[i]))/Math.max((b.max[i]-b.min[i])*r.extent[i]*.5,1e-7));
  const radius=Math.hypot(...d);return radius>=1?0:(1-radius*radius)**2;
}
/** Model coordinates, independent of the camera. Returned delta is feathered by the actual influence. */
export function transformedRegionDelta(p:RegionVector,b:RegionBounds,r:RegionDefinition,weight:number,sign:number):RegionVector{
  const axis={x:0,y:1,z:2}[r.axis],center=b.min.map((n,i)=>n+(b.max[i]-n)*r.center[i]) as RegionVector;
  const delta:RegionVector=[0,0,0],gain=weight*r.strength;
  if(r.operation==="move")delta[axis]=(b.max[axis]-b.min[axis])*r.amount*sign*gain;
  else if(r.operation==="scale")delta[axis]=(p[axis]-center[axis])*r.amount*sign*gain;
  else if(r.operation==="bend"||r.operation==="swing"){
    // Bend toward the requested direction in a stable model plane. Rotation
    // keeps its separate meaning: turning about the requested axis.
    const reach=[0,1,2].filter(i=>i!==axis).sort((a,c)=>(b.max[c]-b.min[c])-(b.max[a]-b.min[a])||a-c)[0];
    const pivot=r.kind==="custom"?center[reach]-(b.max[reach]-b.min[reach])*r.extent[reach]*.5:b.min[reach];
    const along=p[reach]-pivot,across=p[axis]-center[axis];
    const angle=r.amount*Math.PI/180*sign;
    delta[axis]=(Math.cos(angle)*across+Math.sin(angle)*along-across)*gain;
    delta[reach]=(-Math.sin(angle)*across+Math.cos(angle)*along-along)*gain;
  }
  else {const a=(axis+1)%3,c=(axis+2)%3,angle=r.amount*Math.PI/180*sign,pa=p[a]-center[a],pc=p[c]-center[c];delta[a]=(Math.cos(angle)*pa-Math.sin(angle)*pc-pa)*gain;delta[c]=(Math.sin(angle)*pa+Math.cos(angle)*pc-pc)*gain;}
  return delta;
}
export function resolveRegionInstruction(text:string,regions:RegionDefinition[],selectedId:string|null):{region:RegionDefinition; message:string}{
  let input=text.trim().toLowerCase();if(!input||input.length>500)throw new Error("Describe one area adjustment in 1–500 characters.");
  const mentioned=regions.filter(r=>input.includes(r.name.toLowerCase())||new RegExp(`\\b(?:the )?${r.color}(?: area| region)\\b`).test(input));
  if(mentioned.length>1)throw new Error("That name or colour identifies more than one area. Use a unique name.");
  const chosen=mentioned[0]??regions.find(r=>r.id===selectedId);if(!chosen)throw new Error("Name an existing area, refer to its colour, or select one first.");
  const r=structuredClone(chosen);
  if(mentioned.length){input=input.replaceAll(r.name.toLowerCase(),"area").replace(new RegExp(`\\b(?:the )?${r.color}(?: area| region)\\b`,"g"),"area");}
  // Unknown names must never inherit the last selection.
  const strength=input.match(/^(?:make |set |give )?(?:the |this |selected )?(?:area |it )?(?:(weaker|less|reduce|gentler|stronger|more|increase|half|halve|double|reset|normal)(?: (?:the )?(?:strength|movement|stretch))?|(\d+(?:\.\d+)?)%)(?: (?:in|on|for|to) (?:the )?area)?[.!]?$/);
  if(strength){const word=strength[1];r.strength=strength[2]?Number(strength[2])/100:word==="reset"||word==="normal"?1:word==="half"||word==="halve"?r.strength*.5:word==="double"?r.strength*2:["weaker","less","reduce","gentler"].includes(word)?r.strength*.75:r.strength*1.25;if(r.strength<.1||r.strength>2)throw new Error("Use strength from 10% to 200%; the request was not clamped.");return {region:r,message:`${r.name}: ${Math.round(r.strength*100)}% strength`};}
  const transform=input.match(/^(move|bend|swing|rotate|scale) (?:the |this |selected )?(?:area|it) (sideways|horizontally|left|right|up|down|vertically|forward|backward|back|depth)(?: (?:by|through))? (-?\d+(?:\.\d+)?)\s*(%|percent|degrees?|deg)[.!]?$/);
  if(!transform)throw new Error('Use one clear adjustment, such as “make the red region weaker” or “bend tail tip sideways 20 degrees”. Name an existing area and specify a supported direction and amount.');
  const [,op,direction,amount,unit]=transform;r.operation=op as RegionDefinition["operation"];r.axis=["up","down","vertically"].includes(direction)?"y":["forward","backward","back","depth"].includes(direction)?"z":"x";
  const rotational=["bend","swing","rotate"].includes(op);if(rotational!==/^deg/.test(unit))throw new Error(rotational?"Use degrees for bends, swings and rotations.":"Use a percentage of model size for movement or scale.");
  r.amount=Number(amount)*(rotational?1:.01)*(["left","down","backward","back"].includes(direction)?-1:1);const limit=rotational?90:op==="scale"?.75:.5;if(Math.abs(r.amount)>limit||r.amount===0)throw new Error(rotational?"Use a nonzero angle up to 90 degrees.":"Use a nonzero movement up to 50%, or scale up to 75%.");
  return {region:r,message:`${r.name}: ${op} ${direction} ${amount}${unit==="%"?"%":" degrees"}`};
}
