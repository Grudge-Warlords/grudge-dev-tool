/** Describes effective mathematical regions, not inferred animal anatomy. */
export const DEFORMATION_REGION_LABELS: Record<string, string> = {
  "axial-wave":"Lengthwise wave", "rear-wave":"Rear-weighted wave", "bilateral-flap":"Outer side lift",
  "squash-stretch":"Whole-body stretch", "grounded-stride":"Alternating lower reach",
  "synchronous-bound":"Paired lower reach", "rear-counterbalance":"Rear elevated sway",
  "body-crouch":"Upper weighted bend", "segmented-swing":"Far-end swing",
  "segmented-spin":"Far-end rotation", "trail-pulse":"Trail pulse",
};
export interface DeformationRegion { id:string; label:string; targetNames:string[]; strength:number; maximumDelta:number; }
export interface DeformationPreview { regions:DeformationRegion[]; definitions:import("./deformationRegionModel").RegionDefinition[]; selectedId:string|null; }
export interface DeformationEdit { jobId:string; sha256:string; regions:import("./deformationRegionModel").RegionDefinition[]; }
export function deformationOperator(name:string):string|undefined { return Object.keys(DEFORMATION_REGION_LABELS).find(id=>new RegExp(`(?:^|[ :])${id}(?:[ :]|$)`).test(name)); }
export function validateDeformationStrengths(value:unknown, allowed:string[]):Record<string,number> {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Choose a moving area and its strength.");
  const entries=Object.entries(value);
  if(!entries.length||entries.length>11)throw new Error("Select at least one available moving area.");
  for(const [key,n] of entries)if(!allowed.includes(key)||typeof n!=="number"||!Number.isFinite(n)||n<.1||n>2)throw new Error("Only the model's available areas and strengths from 10% to 200% are supported.");
  return Object.fromEntries(entries) as Record<string,number>;
}
export function describeRegionAdjustment(text:string,current:number):number {
  const words=text.trim().toLowerCase();
  let next:number;
  if(/^(?:reset|normal|original)(?: strength)?[.!]?$/.test(words))next=1;
  else if(/^(?:half|halve)(?: (?:the )?(?:strength|movement|stretch))?[.!]?$/.test(words))next=current*.5;
  else if(/^(?:double)(?: (?:the )?(?:strength|movement|stretch))?[.!]?$/.test(words))next=current*2;
  else if(/^(?:make (?:it|this area) )?(?:weaker|less|reduce|smaller|gentler)(?: (?:the )?(?:strength|movement|stretch))?[.!]?$/.test(words))next=current*.75;
  else if(/^(?:make (?:it|this area) )?(?:stronger|more|increase|larger)(?: (?:the )?(?:strength|movement|stretch))?[.!]?$/.test(words))next=current*1.25;
  else if(/^(?:set (?:it|strength) to )?\d+(?:\.\d+)?%$/.test(words))next=Number(words.match(/\d+(?:\.\d+)?/)![0])/100;
  else throw new Error('Adjust the selected highlighted area: “less movement”, “stronger”, “half”, “reset”, or a percentage. Anatomy names and multiple-area instructions need an explicit selection.');
  if(next<.1||next>2)throw new Error("Use 10% to 200%. The requested amount was not silently clamped.");
  return Math.round(next*10000)/10000;
}
