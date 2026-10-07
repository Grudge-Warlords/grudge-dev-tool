import { createHash } from "node:crypto";
import * as THREE from "three";
import type { CreationEdit } from "../../shared/creationFlow";
import { validateCreationComponent } from "../../shared/creationFlow";
import { appendCreationComponents } from "./proceduralCreation";

type Doc = any;
export const CREATION_EDIT_ACTIONS = ["move","rotate","scale","color","clear-animation","duplicate","rename","remove","add"] as const;

export function validateCreationEdit(value: unknown): CreationEdit {
  const edit=value as CreationEdit;
  if(!edit||!CREATION_EDIT_ACTIONS.includes(edit.action)||!Array.isArray(edit.targets)||!edit.targets.length||edit.targets.length>64||edit.targets.some(n=>typeof n!=="string"||!n.trim()||n.length>200)||new Set(edit.targets).size!==edit.targets.length)throw new Error("An edit needs an allowed action and unique target names.");
  if(edit.targets.includes("$asset")&&edit.targets.length!==1)throw new Error("Choose the whole asset or named parts, not both.");
  if(["move","rotate","scale"].includes(edit.action)){
    if(!Array.isArray(edit.value)||edit.value.length!==3||edit.value.some(n=>typeof n!=="number"||!Number.isFinite(n)||(edit.action==="scale"?n<.05||n>20:Math.abs(n)>(edit.action==="move"?500:360))))throw new Error("Invalid edit values: movement is bounded to 500 metres, rotation to 360 degrees, scale to 0.05–20.");
    if(edit.value.every(n=>n===(edit.action==="scale"?1:0)))throw new Error("The requested edit makes no change.");
  }else if(edit.value!==undefined)throw new Error("Unexpected transform values for this edit.");
  if(edit.action==="color"&&!/^#[0-9a-f]{6}$/i.test(edit.color??""))throw new Error("A part color must be #RRGGBB.");
  if(edit.action!=="color"&&edit.color!==undefined)throw new Error("Unexpected color for this edit.");
  if(edit.action==="clear-animation"&&edit.targets[0]!=="$asset")throw new Error("Remove animation currently applies to the entire asset.");
  if(edit.action==="rename"&&(edit.targets.length!==1||typeof edit.name!=="string"||!edit.name.trim()||edit.name.length>80||edit.name==="$asset"))throw new Error("Rename needs one target and a new unique name of 1–80 characters.");
  if(edit.action!=="rename"&&edit.name!==undefined)throw new Error("Unexpected name for this edit.");
  if(edit.action==="remove"&&edit.targets.includes("$asset"))throw new Error("Removing the entire asset is not a model edit. Earlier revisions remain in history.");
  if(edit.action==="add"&&(!Array.isArray(edit.parts)||!edit.parts.length||edit.parts.length>64||edit.targets[0]!=="$asset"))throw new Error("Add needs 1–64 new components in the current scene.");
  if(edit.action!=="add"&&edit.parts!==undefined)throw new Error("Unexpected components for this edit.");
  return {action:edit.action,targets:[...edit.targets],...(edit.value?{value:[...edit.value] as [number,number,number]}:{}),...(edit.color?{color:edit.color}:{}),...(edit.name?{name:edit.name.trim()}:{}),...(edit.parts?{parts:edit.parts.map(validateCreationComponent)}:{})};
}

function sceneNodes(doc:Doc):any[]{
  const scene=doc.getRoot().getDefaultScene()??doc.getRoot().listScenes()[0];
  if(!scene)throw new Error("This asset has no default scene.");
  const nodes:any[]=[];scene.traverse((node:any)=>nodes.push(node));return nodes;
}

export function creationEditContext(doc:Doc){
  const nodes=sceneNodes(doc),names=nodes.map(n=>n.getName());
  return {parts:nodes.filter(n=>n.getName()&&names.filter(name=>name===n.getName()).length===1).map(n=>({name:n.getName(),mesh:Boolean(n.getMesh()),position:n.getTranslation(),scale:n.getScale()})),clips:doc.getRoot().listAnimations().map((a:any)=>a.getName())};
}

/** Hash only authored scene state, excluding changing provenance and file encoding. */
export function creationSceneHash(doc:Doc):string {
  const root=doc.getRoot(),nodes=sceneNodes(doc);
  const state={nodes:nodes.map(n=>({name:n.getName(),parent:nodes.indexOf(n.getParentNode()),t:n.getTranslation(),r:n.getRotation(),s:n.getScale(),materials:n.getMesh()?.listPrimitives().map((p:any)=>{const m=p.getMaterial();return m?{color:m.getBaseColorFactor(),texture:m.getBaseColorTexture()?.getImage()?createHash("sha256").update(m.getBaseColorTexture().getImage()).digest("hex"):null}:null;})})),clips:root.listAnimations().map((a:any)=>({name:a.getName(),channels:a.listChannels().map((c:any)=>({target:nodes.indexOf(c.getTargetNode()),path:c.getTargetPath(),input:Array.from(c.getSampler().getInput().getArray()),output:Array.from(c.getSampler().getOutput().getArray())}))}))};
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

/** Edits use the existing document and immutable revision store; no geometry replacement. */
export function applyCreationEdit(doc:Doc,raw:CreationEdit):string[] {
  const edit=validateCreationEdit(raw),root=doc.getRoot(),before=creationSceneHash(doc),nodes=sceneNodes(doc);
  const whole=edit.targets[0]==="$asset";
  let targets:any[]=whole?nodes.filter(n=>!n.getParentNode()):edit.targets.map(name=>{
    const matches=nodes.filter(n=>n.getName()===name);
    if(matches.length!==1)throw new Error(`Part “${name}” is ${matches.length?"ambiguous":"missing"}. Use one of the exact part names shown for this asset.`);
    return matches[0];
  });
  // An ancestor and descendant would apply the same edit twice.
  for(const target of targets)for(let parent=target.getParentNode();parent;parent=parent.getParentNode())if(targets.includes(parent))throw new Error("Overlapping parent and child targets are not allowed in the same edit.");
  if(edit.action==="add"){
    appendCreationComponents(doc, root.getDefaultScene()??root.listScenes()[0], edit.parts!);
  }else if(edit.action==="rename"){
    if(targets.length!==1)throw new Error("Rename requires exactly one scene node.");
    if(nodes.some(n=>n.getName().toLowerCase()===edit.name!.toLowerCase()))throw new Error("That part name already exists. Choose a unique name.");
    targets[0].setName(edit.name!);
  }else if(edit.action==="duplicate"){
    const scene=root.getDefaultScene()??root.listScenes()[0],selected=new Set<any>();
    for(const target of targets)target.traverse((node:any)=>selected.add(node));
    if([...selected].some(node=>node.getSkin())||root.listSkins().some((skin:any)=>skin.listJoints().some((node:any)=>selected.has(node))))throw new Error("Duplicating skinned parts requires Skeleton Studio; no partial copy was created.");
    if(nodes.length+selected.size>512)throw new Error("This edit would exceed 512 scene nodes.");
    const names=new Set(nodes.map(n=>n.getName().toLowerCase())),copies=new Map<any,any>();
    const clone=(node:any):any=>{let i=1,name=`${node.getName()||"Part"} copy`;while(names.has(name.toLowerCase()))name=`${node.getName()||"Part"} copy ${++i}`;names.add(name.toLowerCase());const copy=doc.createNode();copies.set(node,copy);copy.copy(node,(property:any)=>property.propertyType==="Node"?clone(property):property).setName(name);return copy;};
    for(const target of targets){const copy=clone(target);copy.setTranslation(copy.getTranslation().map((n:number,i:number)=>n+(i===0?2:0)));(target.getParentNode()??scene).addChild(copy);}
    for(const animation of root.listAnimations())for(const channel of [...animation.listChannels()])if(copies.has(channel.getTargetNode())){
      const copiedChannel=channel.clone().setTargetNode(copies.get(channel.getTargetNode()));
      // Translation keys override a node's static position. Offset only copied
      // root values; cubic-spline tangents and original animation stay intact.
      if(channel.getTargetPath()==="translation"&&targets.includes(channel.getTargetNode())){
        const sampler=channel.getSampler(),output=sampler.getOutput(),values=output.getArray().slice();
        const cubic=sampler.getInterpolation()==="CUBICSPLINE";
        for(let i=cubic?3:0;i<values.length;i+=cubic?9:3)values[i]+=2;
        copiedChannel.setSampler(sampler.clone().setOutput(output.clone().setArray(values)));
      }
      animation.addChannel(copiedChannel);
    }
  }else if(edit.action==="remove"){
    const removed=new Set<any>();for(const target of targets)target.traverse((node:any)=>removed.add(node));
    if(!nodes.some(n=>n.getMesh()&&!removed.has(n)))throw new Error("Removing these parts would leave an empty asset.");
    if(root.listSkins().some((skin:any)=>skin.listJoints().some((node:any)=>removed.has(node))))throw new Error("A selected part is a skin joint. Remove or rebind the rig in Skeleton Studio first.");
    for(const animation of [...root.listAnimations()]){for(const channel of [...animation.listChannels()])if(removed.has(channel.getTargetNode()))channel.dispose();if(!animation.listChannels().length)animation.dispose();}
    for(const node of [...removed].reverse())node.dispose();
  }else if(edit.action==="clear-animation"){
    for(const animation of [...root.listAnimations()]){
      for(const channel of [...animation.listChannels()])channel.dispose();
      for(const sampler of [...animation.listSamplers()])sampler.dispose();
      animation.dispose();
    }
    // Authored motion-only effects must not become static stray geometry.
    for(const node of nodes.filter(n=>n.getExtras().effect))node.setScale([0,0,0]);
  }else if(edit.action==="color"){
    const selected=new Set<any>();for(const target of targets)target.traverse((n:any)=>{if(n.getMesh())selected.add(n);});
    if(!selected.size)throw new Error("The selected part has no surface to color.");
    const color=new THREE.Color(edit.color!);
    for(const node of selected){
      // Mesh/material sharing must not recolor an unselected object.
      const old=node.getMesh(),shared=root.listNodes().some((n:any)=>n!==node&&n.getMesh()===old);
      const mesh=shared?doc.createMesh(old.getName()).setExtras({...old.getExtras()}):old;
      for(const original of old.listPrimitives()){
        const primitive=shared?original.clone():original,material=(original.getMaterial()?.clone()??doc.createMaterial()).setBaseColorTexture(null).setBaseColorFactor([color.r,color.g,color.b,1]);
        primitive.setMaterial(material);if(shared)mesh.addPrimitive(primitive);
      }
      node.setMesh(mesh);
    }
  }else{
    const path=edit.action==="move"?"translation":edit.action==="rotate"?"rotation":"scale";
    if(whole){
      // Animation owns the inner root. Static placement stays on an outer node.
      let wrapper=targets.length===1&&targets[0].getExtras().promptPlacement?targets[0]:null;
      if(!wrapper){const scene=root.getDefaultScene()??root.listScenes()[0];wrapper=doc.createNode("GrudgePromptPlacement").setExtras({promptPlacement:true});for(const target of targets){scene.removeChild(target);wrapper.addChild(target);}scene.addChild(wrapper);}
      targets=[wrapper];
    }
    if(root.listAnimations().some((a:any)=>a.listChannels().some((c:any)=>targets.includes(c.getTargetNode())&&c.getTargetPath()===path)))throw new Error("Animation controls that part's transform. Remove the animation first or move the whole asset.");
    for(const target of targets){
      if(edit.action==="move")target.setTranslation(target.getTranslation().map((n:number,i:number)=>n+edit.value![i]));
      if(edit.action==="scale")target.setScale(target.getScale().map((n:number,i:number)=>n*edit.value![i]));
      if(edit.action==="rotate"){const delta=new THREE.Quaternion().setFromEuler(new THREE.Euler(...edit.value!.map(n=>n*Math.PI/180) as [number,number,number]));target.setRotation(new THREE.Quaternion().fromArray(target.getRotation()).multiply(delta).normalize().toArray());}
    }
  }
  if(creationSceneHash(doc)===before)throw new Error("The requested edit made no change. The existing revision remains available.");
  return [`${edit.action}: ${edit.targets.join(", ")}${edit.value?` [${edit.value.join(", ")}]`:edit.color?` ${edit.color}`:edit.name?` → ${edit.name}`:""}`];
}
