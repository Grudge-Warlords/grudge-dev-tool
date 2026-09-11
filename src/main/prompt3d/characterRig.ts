import * as THREE from "three";
import type { Document, Node as GltfNode } from "@gltf-transform/core";
import { MIXAMO_25_CORE, MIXAMO_25_PARENT } from "../../shared/mixamo25";
import { createWeights } from "./deterministicRig";
import type { CharacterLandmarks } from "./characterSurface";

type V3=[number,number,number];
interface Joint {name:string;parent:string|null;world:V3}
const PROFILE="grudge-authored-character-rig-v1";
const mix=(a:V3,b:V3,t:number):V3=>a.map((n,i)=>n+(b[i]-n)*t) as V3;
function fittedJoints(document:Document,includeJaw:boolean):Joint[]{
  const root=document.getRoot(),marks={...root.getExtras().characterLandmarks as CharacterLandmarks};
  const point=(name:string):V3=>{
    if(marks[name])return marks[name];
    const node=root.listNodes().find(n=>n.getMesh()&&n.getName()===name);
    if(!node)throw new Error(`The character needs an identifiable ${name} before automatic skin binding.`);
    const matrix=node.getWorldMatrix();return [matrix[12],matrix[13],matrix[14]];
  };
  const hips=point("Hips"),torso=point("Torso"),head=point("Head"),unit=(head[1]-hips[1])/.97;
  const positions:Record<string,V3>={Hips:hips,Spine:mix(hips,torso,.5),Spine1:torso,Spine2:[torso[0],torso[1]+.19*unit,torso[2]],Neck:marks.Neck??mix(torso,head,.67),Head:head};
  for(const [side,sign] of [["Left",-1],["Right",1]] as const){
    const arm=point(`${side}Arm`),hand=point(`${side}Hand`),leg=point(`${side}Leg`),foot=point(`${side}Foot`);
    const shoulder=marks[`${side}Shoulder`]??[torso[0]+sign*.24*unit,torso[1]+.19*unit,torso[2]] as V3;
    positions[`${side}Shoulder`]=shoulder;positions[`${side}Arm`]=mix(shoulder,arm,.35);positions[`${side}ForeArm`]=mix(arm,hand,.32);positions[`${side}Hand`]=hand;
    positions[`${side}UpLeg`]=[leg[0],hips[1]-.065*unit,leg[2]];positions[`${side}Leg`]=[leg[0],leg[1]+.035*unit,leg[2]];
    positions[`${side}Foot`]=[foot[0],foot[1]+.09*unit,foot[2]-.05*unit];positions[`${side}ToeBase`]=[foot[0],foot[1],foot[2]+.1*unit];
  }
  const joints:Joint[]=MIXAMO_25_CORE.map(name=>({name,parent:MIXAMO_25_PARENT[name]??null,world:positions[name]}));
  const tail=marks.TailBase??(root.listNodes().some(n=>n.getMesh()&&n.getName()==="Tail")?[hips[0],hips[1],hips[2]-.15*unit] as V3:undefined);
  if(tail){const tip=marks.TailTip??[hips[0],hips[1]-.16*unit,hips[2]-1.37*unit] as V3;[0,.35,.7,1].forEach((t,i)=>joints.push({name:i===3?"TailTip":`Tail${i+1}`,parent:i===0?"Hips":`Tail${i}`,world:mix(tail,tip,t)}));}
  if(includeJaw){const jaw=point("Jaw");joints.push({name:"Jaw",parent:"Head",world:jaw});}
  return joints;
}

export function inspectCharacterRig(document:Document){
  const root=document.getRoot(),joints=new Set(root.listSkins().flatMap(s=>s.listJoints()));
  let vertices=0,weightedVertices=0;
  for(const node of root.listNodes().filter(n=>n.getMesh()))for(const p of node.getMesh()!.listPrimitives()){
    const count=p.getAttribute("POSITION")!.getCount(),weights=p.getAttribute("WEIGHTS_0")?.getArray(),indices=p.getAttribute("JOINTS_0")?.getArray(),skin=node.getSkin();vertices+=count;
    if(!skin||!weights||!indices)continue;
    for(let v=0;v<count;v++){let sum=0,valid=true;for(let k=0;k<4;k++){const w=Number(weights[v*4+k]),i=Number(indices[v*4+k]);valid&&=Number.isFinite(w)&&w>=0&&w<=1&&Number.isInteger(i)&&i>=0&&i<skin.listJoints().length;sum+=w;}if(valid&&Math.abs(sum-1)<1e-4)weightedVertices++;}
  }
  const finiteBindMatrices=root.listSkins().every(s=>{const a=s.getInverseBindMatrices()?.getArray();return a?.length===s.listJoints().length*16&&Array.from(a).every(Number.isFinite);});
  return {joints:joints.size,skins:root.listSkins().length,vertices,weightedVertices,finiteBindMatrices,complete:vertices>0&&vertices===weightedVertices&&joints.size>=22&&finiteBindMatrices};
}

/** Rebind only rigs authored by this workflow. Vertex positions, UVs and materials remain unchanged. */
export function bindCharacterRig(document:Document,instruction:string,editing=false){
  const root=document.getRoot(),existing=root.getExtras().authoredCharacterRig as {profile:string;joints:Joint[]}|undefined;
  if(root.listSkins().length&&existing?.profile!==PROFILE)throw new Error("This character has an imported skin. Use its existing Skeleton Studio rig controls; its binding was not replaced.");
  let joints:Joint[]=existing?structuredClone(existing.joints):fittedJoints(document,/\bjaw\b/i.test(instruction));
  if(/\b(?:add|insert)\b[^.;]*\bbone\b/i.test(instruction)&&!/\bjaw\b/i.test(instruction))throw new Error("The prompt author can add a jaw bone or fit the humanoid and tail skeleton. For another new bone, use Skeleton Studio's placement controls.");
  if(/\b(?:add|insert)\b.*\bjaw\b/i.test(instruction)&&!joints.some(j=>j.name==="Jaw"))joints.push(fittedJoints(document,true).find(j=>j.name==="Jaw")!);
  if(editing){
    const names=joints.map(j=>j.name).sort((a,b)=>b.length-a.length);
    const name=names.find(n=>new RegExp(`\\b${n}\\b`,"i").test(instruction));
    const amount=instruction.match(/\b(\d+(?:\.\d+)?)\s*(cm|centimetres?|centimeters?|m|metres?|meters?)\b/i);
    const direction=instruction.match(/\b(up|down|left|right|forward|forwards|back|backward|backwards)\b/i)?.[1].toLowerCase();
    if(!name||!amount||!direction)throw new Error("Specify an existing bone, a distance and direction, for example: Move Tail2 bone 5 cm down.");
    const distance=Number(amount[1])*(/^c/i.test(amount[2])?.01:1);if(distance<=0||distance>.3)throw new Error("A bone adjustment must be greater than zero and at most 30 cm per revision.");
    const axis=/left|right/.test(direction)?0:/up|down/.test(direction)?1:2,sign=/left|down|back/.test(direction)?-1:1;
    joints.find(j=>j.name===name)!.world[axis]+=distance*sign;
  }
  const names=new Set(joints.map(j=>j.name));
  for(const j of joints){if(j.parent&&!names.has(j.parent))throw new Error(`Missing parent for ${j.name}.`);if(j.world.some(n=>!Number.isFinite(n)||Math.abs(n)>500))throw new Error("Invalid rig placement.");const parent=joints.find(p=>p.name===j.parent);if(parent&&Math.hypot(...j.world.map((n,i)=>n-parent.world[i]))<.005)throw new Error(`Bone ${j.name} collapses onto its parent.`);}
  const oldBones=new Set(root.listSkins().flatMap(s=>s.listJoints()));
  const hadIdle=root.listAnimations().some(a=>/character idle|skin idle/i.test(a.getName()))||root.getExtras().retainedCharacterIdle===true;
  for(const a of [...root.listAnimations()])if(/character idle|skin idle/i.test(a.getName()))a.dispose();
  const retainedChannels=root.listAnimations().flatMap(a=>a.listChannels()).filter(c=>oldBones.has(c.getTargetNode()!)).map(channel=>({channel,name:channel.getTargetNode()!.getName(),rest:channel.getTargetNode()!.getTranslation()}));
  for(const node of root.listNodes())if(node.getSkin())node.setSkin(null);
  for(const skin of [...root.listSkins()])skin.dispose();
  for(const bone of oldBones)bone.dispose();
  const scene=root.getDefaultScene()??root.listScenes()[0],wrapper=root.listNodes().find(n=>n.getName()==="GrudgeAssetRoot"),parent=wrapper??scene;
  const parentMatrix=wrapper?new THREE.Matrix4().fromArray(wrapper.getWorldMatrix()):new THREE.Matrix4(),inverse=parentMatrix.clone().invert();
  const local=joints.map(j=>new THREE.Vector3(...j.world).applyMatrix4(inverse));
  const parents=joints.map(j=>joints.findIndex(p=>p.name===j.parent));
  for(const node of root.listNodes())if(node.getMesh()&&names.has(node.getName()))node.setExtras({...node.getExtras(),characterPartName:node.getName()}).setName(`${node.getName()}Surface`);
  const bones=joints.map((j,i)=>document.createNode(j.name).setTranslation((parents[i]<0?local[i]:local[i].clone().sub(local[parents[i]])).toArray()).setExtras({articulated:true,authoredCharacterBone:true}));
  bones.forEach((bone,i)=>{if(parents[i]<0)parent.addChild(bone);else bones[parents[i]].addChild(bone);});
  for(const retained of retainedChannels){
    const bone=bones.find(n=>n.getName()===retained.name);if(!bone)throw new Error(`The retained animation needs bone ${retained.name}.`);
    retained.channel.setTargetNode(bone);
    if(retained.channel.getTargetPath()==="translation"){
      const sampler=retained.channel.getSampler()!,output=sampler.getOutput()!,values=new Float32Array(output.getArray()!);
      const rest=bone.getTranslation();for(let i=0;i<values.length;i++)values[i]+=rest[i%3]-retained.rest[i%3];
      sampler.setOutput(output.clone().setArray(values));
    }
  }
  const buffer=root.listBuffers()[0]??document.createBuffer(),world=joints.map(j=>j.world),jawIndex=joints.findIndex(j=>j.name==="Jaw");
  const withoutJaw=joints.map((_,i)=>i).filter(i=>i!==jawIndex);
  for(const node of root.listNodes().filter(n=>n.getMesh())){
    const matrix=new THREE.Matrix4().fromArray(node.getWorldMatrix()),point=new THREE.Vector3();
    for(const p of node.getMesh()!.listPrimitives()){
      const positions=p.getAttribute("POSITION")!.getArray()!,count=positions.length/3,indices=new Uint16Array(count*4),weights=new Float32Array(count*4);
      for(let v=0;v<count;v++){
        point.set(Number(positions[v*3]),Number(positions[v*3+1]),Number(positions[v*3+2])).applyMatrix4(matrix);
        const allowJaw=jawIndex>=0&&point.y<joints[jawIndex].world[1]+.065&&point.z>joints[jawIndex].world[2]-.16;
        const influence=createWeights(point.toArray() as V3,world,parents,allowJaw?undefined:withoutJaw);
        for(let k=0;k<4;k++){indices[v*4+k]=influence.indices[k];weights[v*4+k]=influence.weights[k];}
      }
      p.setAttribute("JOINTS_0",document.createAccessor("Character joints").setType("VEC4").setArray(indices).setBuffer(buffer));
      p.setAttribute("WEIGHTS_0",document.createAccessor("Character weights").setType("VEC4").setArray(weights).setBuffer(buffer));
    }
    const inverseBinds=new Float32Array(bones.length*16);bones.forEach((bone,i)=>inverseBinds.set(new THREE.Matrix4().fromArray(bone.getWorldMatrix()).invert().multiply(matrix).elements,i*16));
    const skin=document.createSkin("Character skin binding").setSkeleton(bones[0]).setInverseBindMatrices(document.createAccessor("Character inverse bind matrices").setType("MAT4").setArray(inverseBinds).setBuffer(buffer));
    bones.forEach(b=>skin.addJoint(b));node.setSkin(skin);
  }
  root.setExtras({...root.getExtras(),authoredCharacterRig:{profile:PROFILE,joints,weightMethod:"nearest-bone-segment-four-weight-v1"}});
  const inspection=inspectCharacterRig(document);if(!inspection.complete)throw new Error("Character skin binding failed its normalized weight or inverse-bind checks.");
  if(hadIdle)authorCharacterSkinIdle(document);
  return inspection;
}

export function authorCharacterSkinIdle(document:Document){
  const root=document.getRoot();if(!inspectCharacterRig(document).complete)throw new Error("The character needs a complete skin binding before skeletal idle.");
  for(const a of [...root.listAnimations()])if(/character idle|skin idle/i.test(a.getName()))a.dispose();
  const buffer=root.listBuffers()[0],animation=document.createAnimation("Character skin idle"),times=document.createAccessor("Idle time").setType("SCALAR").setArray(new Float32Array([0,1,2,3,4])).setBuffer(buffer);
  const bones=new Map(root.listSkins().flatMap(s=>s.listJoints()).map(n=>[n.getName(),n]));
  for(const [name,axis,amplitude] of [["Spine2","z",.018],["Head","y",.045],["LeftArm","z",.04],["RightArm","z",-.04],["Tail1","y",.12],["Tail2","y",.19],["Tail3","y",.23]] as const){
    const node=bones.get(name);if(!node)continue;
    const values=new Float32Array(20);[0,1,0,-1,0].forEach((s,i)=>values.set(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,axis==="y"?1:0,axis==="z"?1:0),s*amplitude).toArray(),i*4));
    const sampler=document.createAnimationSampler().setInput(times).setOutput(document.createAccessor(`${name} idle rotation`).setType("VEC4").setArray(values).setBuffer(buffer)).setInterpolation("LINEAR");
    animation.addSampler(sampler);
    animation.addChannel(document.createAnimationChannel().setTargetNode(node).setTargetPath("rotation").setSampler(sampler));
  }
  animation.setExtras({method:"authored-skinned-character-idle",loop:true});return animation;
}
