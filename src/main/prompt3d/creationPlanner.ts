import { CREATION_CATEGORIES, CREATION_STYLES, CREATION_PRIMITIVES, type CreationAdjustments, type CreationAttempt, type CreationKind, type CreationPlan, type CreationRequest } from "../../shared/creationFlow";
import { localJsonPlan } from "./planner";

/** Internal object knowledge; Category and Style remain the user's choices. */
export async function planCreation(request: CreationRequest, parent?: CreationAttempt): Promise<CreationPlan> {
  if (!CREATION_CATEGORIES.includes(request.category) || !CREATION_STYLES.includes(request.style)) throw new Error("Select an available Category and Style.");
  const text = request.prompt.trim().toLowerCase();
  if (/\b(hunyuan|trellis|meshy|tripo)\b/.test(text)) throw new Error("This is the local procedural workflow. Select the requested generator explicitly; no procedural substitute was made.");
  const primitive = CREATION_PRIMITIVES.find(shape => new RegExp(`\\b${shape}\\b`).test(text)) ?? (/\bcube\b/.test(text) ? "box" : undefined);
  const namedKind: CreationKind | undefined = primitive ?? (/\b(sword|sabre|saber|scimitar|katana|rapier)\b/.test(text) ? "sword" : /\b(gun|blaster|pistol|rifle)\b/.test(text) ? "game-gun" : /\b(person|character|human|dancer)\b/.test(text) ? "person" : undefined);
  const structural = /\b(longer|shorter|wider|narrower|bulkier|slimmer|broader|taller|curvier|curved|straighter|enlarge|shrink|larger|smaller)\b/.test(text);
  const cosmetic = /\b(enhance|ornament|ornamental|embellish|detailed|details|cosmetic|decoration|decorative|accents?)\b/.test(text);
  const creationVerb = /\b(create|make|build|generate)\b/.test(text);
  const explicitNew = /\b(create|build|generate)\b/.test(text) || /\b(new|original)\b/.test(text);
  const create = Boolean(namedKind && creationVerb && (!parent || (explicitNew && !/^make\s+(?:it|the|this)\b/.test(text))));
  let kind = parent?.plan?.kind;
  let operation: CreationPlan["operation"];
  let adjustments: CreationAdjustments | undefined;
  let changes: string[] | undefined;
  if (create) {
    kind = namedKind;
    operation = "create";
    if (!kind) throw new Error("Original procedural creation supports a sword, a cosmetic game gun prop, or a segmented person. Choose an installed neural generator for other shapes; no substitute was made.");
    if ((kind === "person" && request.category !== "character") || (["sword","game-gun"].includes(kind) && request.category !== "prop")) throw new Error(`Use Category ${kind === "person" ? "Character" : "Prop"} for this object. Your selection was not changed.`);
  } else {
    if (!parent?.assetPath || !kind) throw new Error("Create an asset or reopen a saved creation first. 'It' refers to the current asset.");
    if (request.category !== parent.request.category || request.style !== parent.request.style) throw new Error("Restore the current asset's Category and Style before refining it, or start a new creation.");
    if (structural) {
      operation = "adjust"; adjustments = {}; changes = [];
      const set=(key:keyof CreationAdjustments,value:number,label:string)=>{adjustments![key]=value as never;changes!.push(label);};
      if(kind==="sword"){
        if(/\blonger\b/.test(text))set("bladeLength",1.25,"blade length +25%"); else if(/\bshorter\b/.test(text))set("bladeLength",.80,"blade length -20%");
        if(/\bwider\b/.test(text))set("bladeWidth",1.30,"blade width +30%"); else if(/\bnarrower\b/.test(text))set("bladeWidth",.76,"blade width -24%");
        if(/\b(more curved|curvier)\b/.test(text))set("curveDelta",.16,"blade curvature increased"); else if(/\bstraighter\b/.test(text))set("curveDelta",-.16,"blade curvature reduced");
        if(/\b(enlarge|larger|wider)\b.{0,18}\bguard\b|\bguard\b.{0,18}\b(enlarge|larger|wider)\b/.test(text))set("guardWidth",1.35,"guard width +35%");
        else if(/\b(smaller|narrower|shrink)\b.{0,18}\bguard\b|\bguard\b.{0,18}\b(smaller|narrower|shrink)\b/.test(text))set("guardWidth",.75,"guard width -25%");
      } else if(kind==="game-gun"){
        if(/\blonger\b/.test(text))set("propLength",1.28,"prop length +28%"); else if(/\bshorter\b/.test(text))set("propLength",.78,"prop length -22%");
        if(/\b(bulkier|broader|wider)\b/.test(text))set("propBulk",1.24,"body bulk +24%"); else if(/\b(slimmer|narrower)\b/.test(text))set("propBulk",.78,"body bulk -22%");
        if(/\b(enlarge|larger|wider)\b.{0,18}\bmuzzle\b|\bmuzzle\b.{0,18}\b(enlarge|larger|wider)\b/.test(text))set("muzzleSize",1.30,"muzzle size +30%");
        else if(/\b(smaller|narrower|shrink)\b.{0,18}\bmuzzle\b|\bmuzzle\b.{0,18}\b(smaller|narrower|shrink)\b/.test(text))set("muzzleSize",.76,"muzzle size -24%");
      } else if(kind==="person") {
        if(/\btaller\b/.test(text))set("personHeight",1.16,"character height +16%"); else if(/\bshorter\b/.test(text))set("personHeight",.86,"character height -14%");
        if(/\b(broader|wider)\b/.test(text))set("personWidth",1.18,"character breadth +18%"); else if(/\b(slimmer|narrower)\b/.test(text))set("personWidth",.82,"character breadth -18%");
        if(/\b(enlarge|larger)\b.{0,18}\bhead\b|\bhead\b.{0,18}\b(enlarge|larger)\b/.test(text))set("headSize",1.22,"head size +22%");
        else if(/\b(smaller|shrink)\b.{0,18}\bhead\b|\bhead\b.{0,18}\b(smaller|shrink)\b/.test(text))set("headSize",.82,"head size -18%");
      }
      if (!["sword","game-gun","person"].includes(kind)) {
        if (/\b(larger|enlarge|bigger)\b/.test(text)) { set("scaleX",1.25,"width +25%"); set("scaleY",1.25,"height +25%"); set("scaleZ",1.25,"depth +25%"); }
        else if (/\b(smaller|shrink)\b/.test(text)) { set("scaleX",.8,"width -20%"); set("scaleY",.8,"height -20%"); set("scaleZ",.8,"depth -20%"); }
        if (/\bwider\b/.test(text)) set("scaleX",1.25,"width +25%"); else if (/\bnarrower\b/.test(text)) set("scaleX",.8,"width -20%");
        if (/\btaller\b/.test(text)) set("scaleY",1.25,"height +25%"); else if (/\bshorter\b/.test(text)) set("scaleY",.8,"height -20%");
        if (/\blonger\b/.test(text)) set("scaleZ",1.25,"depth +25%");
        if (cosmetic) throw new Error("Named decorative parts are available for the original templates. Use Forge to add details to this model.");
      }
      if(cosmetic){adjustments.cosmeticDetail=true;changes.push("new authored cosmetic detail pass");}
      if(!changes.length)throw new Error("No supported structural adjustment was found. Try longer/shorter, wider/narrower or a kind-specific curve, guard, muzzle, height, breadth or head change.");
    }
    else if (cosmetic) {if(!["sword","game-gun","person"].includes(kind))throw new Error("Use the existing Forge tools to add decorative geometry to this model.");operation="enhance";adjustments={cosmeticDetail:true};changes=[kind==="sword"?"fuller, ricasso collar, guard caps and pommel inlays":kind==="game-gun"?"vent ribs, energy coils, sight and side studs":"shoulder plates, cuffs, belt buckle, knee and boot trim"];}
    else if (/\b(texture|material|surface|paint|colour|color)\b/.test(text)) operation = "texture";
    else if (/\b(dance|dancing)\b/.test(text)) operation = "dance";
    else if (/\b(projectile|shoot|shooting|fire|firing)\b/.test(text)) operation = "projectile";
    else if (/\b(swip\w*|swing\w*)\b|side[- ]to[- ]side/.test(text)) operation = "swipe";
    else if (/\b(turntable|spin|rotate)\b/.test(text)) operation = "turntable";
    else throw new Error("Supported follow-ups: cosmetic details, bounded shape adjustments, texture/material changes, sword swiping, cosmetic projectile motion, a character dance or a turntable. No unsupported operation was substituted.");
    if ((operation === "dance" && kind !== "person") || (operation === "projectile" && kind !== "game-gun") || (operation === "swipe" && kind !== "sword")) throw new Error(`The ${operation} operation does not match the current ${kind}. Create the intended asset first.`);
  }
  const constraints = kind === "sword" ? ["Original continuous blade; authored guard, grip and pommel", "Grip pivot; blade initially +Y; no borrowed mesh"]
    : kind === "game-gun" ? ["Cosmetic game prop only; no working mechanism or ballistics", "Named muzzle along +Z; decorative projectile starts at muzzle"]
    : kind!=="person" ? [kind==="existing-asset"?"Modify a retained working copy; preserve the source identity and original file":"CPU-authored basic shape with embedded geometry", "Bounded whole-model scale, procedural surfaces and rigid turntable; existing skins and clips retained"] : ["Original segmented person, feet on Y=0", "Hierarchical hips, torso, shoulders, elbows, knees and head", "Rigid segmented articulation, not skin deformation or a borrowed mannequin"];
  let planner = "Built-in typed rules (no model inference)";
  let summary = `${operation === "create" ? "Author new" : operation} ${kind}; ${request.style} surfaces. ${changes?.length?`Changes: ${changes.join(", ")}. `:""}${constraints.join(". ")}.`;
  if (request.usePlanner) {
    const result = await localJsonPlan("Review a local game-asset operation. Category, Style, kind, operation and bounded numeric adjustments are authoritative; do not change them. Return JSON {summary:string} explaining shape, support/grip origin, materials and motion. No code, paths, downloads or reference assets. A gun is cosmetic; a person is an original segmented articulated figure. Do not claim photorealism or neural geometry.", JSON.stringify({ prompt: request.prompt, category: request.category, style: request.style, kind, operation, constraints, adjustments, changes }), {type:"object",additionalProperties:false,required:["summary"],properties:{summary:{type:"string",maxLength:700}}});
    const proposal = result.proposal as {summary?: unknown};
    if (typeof proposal?.summary !== "string" || !proposal.summary.trim() || proposal.summary.length > 2000) throw new Error("Local planner did not return a bounded summary. No creation was started.");
    summary = proposal.summary.slice(0,700); planner = `${result.model} · local CPU planner`;
  }
  return { kind, operation, curved: create ? /\b(curved|sabre|saber|scimitar|katana)\b/.test(text) : parent?.plan?.curved, adjustments, changes, summary, constraints, planner };
}
