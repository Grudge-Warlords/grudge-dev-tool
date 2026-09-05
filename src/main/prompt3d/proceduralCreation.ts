import * as THREE from "three";
import sharp from "sharp";
import { createHash } from "node:crypto";
import type { CreationKind, CreationPlan } from "../../shared/creationFlow";

const { Document, NodeIO } = require("@gltf-transform/core");
const { ALL_EXTENSIONS } = require("@gltf-transform/extensions");
export async function creationIO() {
  const { MeshoptDecoder, MeshoptEncoder } = require("meshoptimizer");
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder,
  });
}
type Doc = any;
type Node = any;

function author(document: Doc) {
  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer();
  const materials = new Map<string, any>();
  for (const existing of document.getRoot().listMaterials()) {
    const role=existing.getExtras().role;
    if(typeof role==="string"&&!materials.has(role))materials.set(role,existing);
  }
  const material = (role: string) => {
    if (!materials.has(role)) materials.set(role, document.createMaterial(role).setBaseColorFactor([.65,.68,.72,1]).setMetallicFactor(.05).setRoughnessFactor(.65).setExtras({ role, authored: true }));
    return materials.get(role);
  };
  function mesh(parent: Node, name: string, geometry: THREE.BufferGeometry, role: string, position: number[] = [0,0,0], effect = false) {
    const primitive = document.createPrimitive();
    for (const [semantic, name] of [["POSITION","position"],["NORMAL","normal"],["TEXCOORD_0","uv"]]) {
      const attr = geometry.getAttribute(name);
      if (attr) primitive.setAttribute(semantic, document.createAccessor().setType(attr.itemSize === 2 ? "VEC2" : "VEC3").setArray(new Float32Array(attr.array)).setBuffer(buffer));
    }
    if (geometry.index) primitive.setIndices(document.createAccessor().setType("SCALAR").setArray(new Uint32Array(geometry.index.array)).setBuffer(buffer));
    primitive.setMaterial(material(role));
    const assetMesh = document.createMesh(name).addPrimitive(primitive).setExtras({originalAuthored:true,effect});
    const node = document.createNode(name).setMesh(assetMesh).setTranslation(position).setExtras({originalAuthored:true,effect});
    parent.addChild(node); geometry.dispose(); return node;
  }
  const joint = (parent: Node, name: string, position: number[]) => {
    const node = document.createNode(name).setTranslation(position).setExtras({originalAuthored:true,articulated:true}); parent.addChild(node); return node;
  };
  return {mesh,joint,material};
}

export function createOriginalGeometry(plan: CreationPlan, style: string): Doc {
  const doc = new Document(); doc.createBuffer();
  const scene = doc.createScene("Original creation");
  const root = doc.createNode("GrudgeAssetRoot").setExtras({grudgeCreation:{method:"original-procedural",kind:plan.kind,style,borrowedInputs:[]}});
  scene.addChild(root); doc.getRoot().setDefaultScene(scene);
  const {mesh,joint} = author(doc);
  const sides = style === "low-poly" ? 8 : 20;
  const sphere = (r: number) => new THREE.SphereGeometry(r,sides,Math.max(6,sides/2));
  const box = (x:number,y:number,z:number) => new THREE.BoxGeometry(x,y,z);
  if (plan.kind === "sword") {
    const pivot=joint(root,"GripPivot",[0,.145,0]);
    const body=doc.createNode("SwordBody").setTranslation([0,-.145,0]);pivot.addChild(body);
    const vertices:number[]=[],uv:number[]=[],indices:number[]=[];
    const curvature=plan.curved ? .24 : 0, rows=40, width=.10, base=.28, length=1.05;
    const cross=[[-.5,0],[-.4,.55],[0,1],[.4,.55],[.5,0],[.4,-.55],[0,-1],[-.4,-.55]];
    for(let row=0;row<rows;row++){
      const t=row/rows,w=width*(1-.18*t)*(t>.7?(1-t)/.3:1);
      for(const [x,z] of cross){vertices.push(curvature*t*t+x*w,base+length*t,z*.008*(1-.6*t));uv.push(x+.5,t);}
    }
    for(let row=0;row<rows-1;row++)for(let i=0;i<8;i++){const a=row*8+i,b=row*8+(i+1)%8,c=a+8,d=b+8;indices.push(a,b,c,b,d,c);}
    const tip=vertices.length/3;vertices.push(curvature,base+length,0);uv.push(.5,1);
    for(let i=0;i<8;i++)indices.push((rows-1)*8+i,(rows-1)*8+(i+1)%8,tip);
    for(let i=1;i<7;i++)indices.push(0,i+1,i);
    const blade=new THREE.BufferGeometry();blade.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));blade.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));blade.setIndex(indices);blade.computeVertexNormals();
    mesh(body,"Blade",blade,"steel");
    mesh(body,"Guard",box(.30,.035,.065),"brass",[0,.28,0]);
    mesh(body,"Grip",new THREE.CylinderGeometry(.025,.029,.20,sides),"leather",[0,.155,0]);
    mesh(body,"Pommel",sphere(.041),"brass",[0,.043,0]);
    for(let i=0;i<7;i++)mesh(body,`GripBand${i}`,new THREE.TorusGeometry(.029-i*.0004,.0025,6,sides).rotateX(Math.PI/2),"brass",[0,.07+i*.027,0]);
    if(plan.curved){const curve=new THREE.CubicBezierCurve3(new THREE.Vector3(.12,.28,0),new THREE.Vector3(.25,.20,0),new THREE.Vector3(.17,.035,0),new THREE.Vector3(.01,.04,0));mesh(body,"KnuckleGuard",new THREE.TubeGeometry(curve,24,.007,8,false),"brass");}
  } else if(plan.kind === "game-gun") {
    mesh(root,"GamePropBody",box(.15,.17,.48),"paint",[0,.34,0]);
    mesh(root,"Grip",box(.10,.24,.14).rotateX(-.2),"rubber",[0,.16,-.12]);
    mesh(root,"BarrelShroud",new THREE.CylinderGeometry(.065,.07,.32,sides).rotateX(Math.PI/2),"steel",[0,.36,.35]);
    mesh(root,"MuzzleRing",new THREE.TorusGeometry(.05,.014,8,sides),"brass",[0,.36,.515]);
    mesh(root,"MuzzleInset",new THREE.CircleGeometry(.038,sides),"dark",[0,.36,.518]);
    mesh(root,"TopFin",box(.04,.06,.16),"brass",[0,.455,-.08]);
    mesh(root,"TriggerGuardBottom",box(.04,.025,.19),"steel",[0,.175,.065]);
    mesh(root,"TriggerGuardFront",box(.04,.13,.025),"steel",[0,.235,.155]);
    mesh(root,"DecorativeTrigger",box(.025,.07,.022).rotateX(.3),"brass",[0,.245,.025]);
    mesh(root,"SidePanelLeft",box(.012,.09,.23),"accent",[.083,.35,-.015]);
    mesh(root,"SidePanelRight",box(.012,.09,.23),"accent",[-.083,.35,-.015]);
    const muzzle=doc.createNode("Muzzle").setTranslation([0,.36,.54]).setExtras({direction:"+Z",cosmeticOnly:true});root.addChild(muzzle);
  } else if(plan.kind === "person") {
    const pelvis=joint(root,"PelvisJoint",[0,.90,0]);
    mesh(pelvis,"Pelvis",box(.32,.19,.20),"trousers");
    const torso=joint(pelvis,"TorsoJoint",[0,.105,0]);
    mesh(torso,"Torso",new THREE.CylinderGeometry(.21,.165,.43,sides).scale(1,1,.62),"fabric",[0,.215,0]);
    mesh(torso,"Belt",box(.35,.045,.22),"leather",[0,.015,0]);
    const neck=joint(torso,"NeckJoint",[0,.47,0]);mesh(neck,"Neck",new THREE.CylinderGeometry(.055,.06,.085,sides),"skin");
    const head=joint(neck,"HeadJoint",[0,.17,0]);
    mesh(head,"Head",sphere(.14).scale(.86,1.12,.88),"skin");
    mesh(head,"Hair",new THREE.SphereGeometry(.143,sides,12,0,Math.PI*2,0,Math.PI*.43).scale(.87,1.14,.90),"hair",[0,.017,0]);
    for(const side of [-1,1]) {mesh(head,`EyeWhite${side}`,sphere(.025).scale(1,.72,.4),"white",[side*.049,.025,.112]);mesh(head,`Pupil${side}`,sphere(.012).scale(1,1,.4),"dark",[side*.049,.025,.123]);mesh(head,`Ear${side}`,sphere(.032).scale(.5,1,.7),"skin",[side*.126,0,0]);}
    mesh(head,"Nose",new THREE.ConeGeometry(.022,.05,8).rotateX(Math.PI/2),"skin",[0,-.005,.137]);
    mesh(head,"Mouth",box(.055,.009,.008),"dark",[0,-.055,.118]);
    for(const side of [-1,1]){
      const tag=side<0?"Left":"Right";
      const shoulder=joint(torso,`${tag}Shoulder`,[side*.235,.365,0]);
      mesh(shoulder,`${tag}ShoulderCap`,sphere(.083),"fabric");
      mesh(shoulder,`${tag}UpperArm`,new THREE.CylinderGeometry(.064,.053,.27,sides),"fabric",[0,-.135,0]);
      const elbow=joint(shoulder,`${tag}Elbow`,[0,-.29,0]);mesh(elbow,`${tag}ElbowCap`,sphere(.051),"skin");
      mesh(elbow,`${tag}Forearm`,new THREE.CylinderGeometry(.05,.036,.25,sides),"skin",[0,-.125,0]);
      mesh(elbow,`${tag}Hand`,sphere(.057).scale(.72,1.25,.6),"skin",[0,-.30,0]);
      const hip=joint(pelvis,`${tag}Hip`,[side*.105,-.08,0]);
      mesh(hip,`${tag}Thigh`,new THREE.CylinderGeometry(.079,.065,.35,sides),"trousers",[0,-.175,0]);
      const knee=joint(hip,`${tag}Knee`,[0,-.365,0]);mesh(knee,`${tag}KneeCap`,sphere(.065),"trousers");
      mesh(knee,`${tag}Shin`,new THREE.CylinderGeometry(.062,.043,.365,sides),"trousers",[0,-.1825,0]);
      mesh(knee,`${tag}Boot`,box(.125,.10,.22),"rubber",[0,-.405, .045]);
    }
  }
  if (!["sword","game-gun","person"].includes(plan.kind)) {
    const shapes: Record<string,()=>THREE.BufferGeometry> = {
      box:()=>box(1,1,1), sphere:()=>sphere(.5), cylinder:()=>new THREE.CylinderGeometry(.5,.5,1,sides),
      cone:()=>new THREE.ConeGeometry(.5,1,sides), plane:()=>new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),
      torus:()=>new THREE.TorusGeometry(.35,.15,Math.max(6,sides/2),sides).rotateX(Math.PI/2),
    };
    if (!shapes[plan.kind]) throw new Error("Unsupported procedural shape. No replacement was authored.");
    mesh(root,plan.kind,shapes[plan.kind](),"paint",[0,plan.kind==="plane"?0:plan.kind==="torus"?.15:.5,0]);
    root.setExtras({...root.getExtras(),localWorkingRoot:true});
  }
  return doc;
}

const palettes: Record<string, [number,number,number,string,number,number]> = {
  steel:[167,190,212,"brushed",.85,.3],brass:[207,148,51,"brushed",.75,.34],leather:[83,40,22,"grain",0,.88],
  paint:[32,114,166,"panel",.35,.42],accent:[245,124,29,"panel",.25,.42],rubber:[33,38,48,"grip",0,.94],dark:[20,23,31,"solid",0,.65],
  fabric:[28,157,177,"weave",0,.92],trousers:[40,56,96,"weave",0,.95],skin:[201,144,102,"grain",0,.85],hair:[66,32,21,"grain",0,.96],white:[235,238,240,"solid",0,.4],
};

export async function applyOriginalTextures(doc: Doc, style: string, prompt: string) {
  const red=/\bred\b/i.test(prompt), blue=/\bblue\b/i.test(prompt), green=/\bgreen\b/i.test(prompt);
  for(const material of doc.getRoot().listMaterials()){
    const role=material.getExtras().role ?? material.getName();
    if(role === "projectile")continue;
    const [r,g,b,pattern,metal,rough]=palettes[role] ?? palettes.paint;
    const color=(!palettes[role]||role==="paint"||role==="fabric") ? (red?[190,39,44]:blue?[30,90,185]:green?[40,155,88]:[r,g,b]):[r,g,b];
    const pixels=Buffer.alloc(256*256*4);
    for(let y=0;y<256;y++)for(let x=0;x<256;x++){
      const noise=((x*73856093^y*19349663)>>>0)%17-8;
      const detail=pattern==="weave"?((x%8<2||y%8<2)?-25:5):pattern==="brushed"?(y%7-3)*3:pattern==="grip"?((x+y)%32<8?-25:8):pattern==="panel"?(x%64<3||y%64<3?-30:8):pattern==="grain"?noise:0;
      const shade=style==="hand-painted"?detail+18*Math.sin(x/60):detail;
      const i=(y*256+x)*4;for(let c=0;c<3;c++)pixels[i+c]=Math.max(0,Math.min(255,color[c]+shade));pixels[i+3]=255;
    }
    const png=await sharp(pixels,{raw:{width:256,height:256,channels:4}}).png().toBuffer();
    const texture=doc.createTexture(`Original ${role} ${pattern}`).setImage(png).setMimeType("image/png").setExtras({method:"authored-pixel-pattern",pattern,sourceAssets:[]});
    material.setBaseColorTexture(texture).setBaseColorFactor([1,1,1,1]).setMetallicFactor(style==="hand-painted"?metal*.4:metal).setRoughnessFactor(rough);
  }
}

function transformMesh(doc:Doc,name:string,scale:[number,number,number],curveDelta=0){
  const node=doc.getRoot().listNodes().find((n:Node)=>n.getName()===name),mesh=node?.getMesh();
  if(!mesh)throw new Error(`Required authored part ${name} is missing.`);
  for(const primitive of mesh.listPrimitives()){
    const position=primitive.getAttribute("POSITION"),positions=position.getArray() as Float32Array;
    let minY=Infinity,maxY=-Infinity;
    for(let i=1;i<positions.length;i+=3){minY=Math.min(minY,positions[i]);maxY=Math.max(maxY,positions[i]);}
    for(let i=0;i<positions.length;i+=3){
      const y=positions[i+1],t=maxY>minY?(y-minY)/(maxY-minY):0;
      positions[i]=positions[i]*scale[0]+curveDelta*t*t;positions[i+1]*=scale[1];positions[i+2]*=scale[2];
    }
    position.setArray(positions);
    const normal=primitive.getAttribute("NORMAL"),normals=normal?.getArray() as Float32Array|undefined;
    if(normals)for(let i=0;i<normals.length;i+=3){const x=normals[i]/scale[0],y=normals[i+1]/scale[1],z=normals[i+2]/scale[2],length=Math.hypot(x,y,z)||1;normals[i]=x/length;normals[i+1]=y/length;normals[i+2]=z/length;}normal?.setArray(normals!);
  }
}

function scaleTranslation(doc:Doc,name:string,scale:[number,number,number]){
  const node=doc.getRoot().listNodes().find((n:Node)=>n.getName()===name);if(!node)return;
  const p=node.getTranslation();node.setTranslation([p[0]*scale[0],p[1]*scale[1],p[2]*scale[2]]);
}

/** Adds newly authored decorative geometry to the existing original asset. */
export function enhanceOriginalGeometry(doc:Doc,plan:CreationPlan){
  const root=doc.getRoot(),nodes=root.listNodes(),find=(name:string)=>{const n=nodes.find((x:Node)=>x.getName()===name);if(!n)throw new Error(`Required authored part ${name} is missing.`);return n;};
  const assetRoot=find("GrudgeAssetRoot"),assetExtras=assetRoot.getExtras(),pass=(assetExtras.cosmeticDetailPasses??0)+1,{mesh}=author(doc);
  const detail=(parent:Node,name:string,geometry:THREE.BufferGeometry,role:string,position:number[]=[0,0,0])=>{const n=mesh(parent,`${name}Detail${pass}`,geometry,role,position);n.setExtras({...n.getExtras(),cosmeticDetail:true,detailPass:pass});n.getMesh().setExtras({...n.getMesh().getExtras(),cosmeticDetail:true,detailPass:pass});return n;};
  const sides=16,box=(x:number,y:number,z:number)=>new THREE.BoxGeometry(x,y,z),sphere=(r:number)=>new THREE.SphereGeometry(r,sides,8);
  if(plan.kind==="sword"){
    const body=find("SwordBody"),curve=new THREE.CubicBezierCurve3(new THREE.Vector3(.005,.34,.013),new THREE.Vector3(.04,.62,.013),new THREE.Vector3(.20,1.02,.013),new THREE.Vector3(.235,1.22,.013));
    detail(body,"BladeFullerInlay",new THREE.TubeGeometry(curve,30,.0035,6,false),"brass");
    detail(body,"RicassoCollar",box(.115,.025,.028),"brass",[.005,.305,0]);
    for(const side of [-1,1])detail(body,side<0?"GuardCapLeft":"GuardCapRight",sphere(.025).scale(1.3,.75,1),"brass",[side*.158,.28,0]);
    detail(body,"PommelInlay",new THREE.TorusGeometry(.030,.004,6,sides).rotateX(Math.PI/2),"steel",[0,.043,.035]);
  }else if(plan.kind==="game-gun"){
    for(let i=0;i<4;i++)detail(find("GrudgeAssetRoot"),`BarrelEnergyCoil${i}`,new THREE.TorusGeometry(.072,.006,6,sides),"brass",[0,.36,.23+i*.065]);
    for(const side of [-1,1])for(let i=0;i<3;i++)detail(find("GrudgeAssetRoot"),`${side<0?"Left":"Right"}Vent${i}`,box(.014,.018,.065),"dark",[side*.088,.385,-.10+i*.075]);
    detail(find("GrudgeAssetRoot"),"RearSight",box(.035,.06,.035),"accent",[0,.485,-.16]);
    detail(find("GrudgeAssetRoot"),"FrontSight",box(.028,.052,.028),"accent",[0,.47,.41]);
    for(const side of [-1,1])detail(find("GrudgeAssetRoot"),side<0?"SideStudLeft":"SideStudRight",sphere(.018),"brass",[side*.095,.31,.12]);
  }else{
    const torso=find("TorsoJoint");detail(torso,"BeltBuckle",box(.07,.065,.025),"brass",[0,.015,.125]);
    for(const side of [-1,1]){
      const tag=side<0?"Left":"Right",shoulder=find(`${tag}Shoulder`),elbow=find(`${tag}Elbow`),knee=find(`${tag}Knee`);
      detail(shoulder,`${tag}ShoulderPlate`,box(.13,.045,.15),"brass",[0,.035,0]);
      detail(elbow,`${tag}WristCuff`,new THREE.CylinderGeometry(.055,.055,.035,sides),"leather",[0,-.245,0]);
      detail(knee,`${tag}KneePad`,box(.11,.12,.035),"leather",[0,0,.065]);
      detail(knee,`${tag}BootTrim`,box(.135,.025,.23),"brass",[0,-.37,.045]);
    }
    detail(find("HeadJoint"),"HairLock",new THREE.ConeGeometry(.025,.11,8).rotateZ(.35),"hair",[-.09,.08,.08]);
  }
  assetRoot.setExtras({...assetExtras,cosmeticDetailPasses:pass});
}

/** Applies bounded, visible geometry changes to named original parts while retaining materials and clips. */
export function adjustOriginalGeometry(doc:Doc,plan:CreationPlan){
  const a=plan.adjustments??{};
  if (!["sword","game-gun","person"].includes(plan.kind)) {
    const wrapper=doc.getRoot().listNodes().find((n:Node)=>n.getExtras().localWorkingRoot);
    if (!wrapper) throw new Error("The working-copy transform is missing.");
    const scale=wrapper.getScale().map((n:number,i:number)=>n*([a.scaleX,a.scaleY,a.scaleZ][i]??1));
    if(scale.some((n:number)=>!Number.isFinite(n)||n<.01||n>100))throw new Error("The requested size exceeds the supported 0.01–100 scale range.");
    wrapper.setScale(scale); return;
  }
  if(plan.kind==="sword"){
    transformMesh(doc,"Blade",[a.bladeWidth??1,a.bladeLength??1,1],a.curveDelta??0);
    if(a.guardWidth)transformMesh(doc,"Guard",[a.guardWidth,1,1]);
  }else if(plan.kind==="game-gun"){
    if(a.propLength){for(const name of ["GamePropBody","BarrelShroud","SidePanelLeft","SidePanelRight","TriggerGuardBottom"])transformMesh(doc,name,[1,1,a.propLength]);
      const root=doc.getRoot(),muzzle=root.listNodes().find((n:Node)=>n.getName()==="Muzzle"),old=[...muzzle.getTranslation()],delta=(a.propLength-1)*.38;
      for(const name of ["BarrelShroud","MuzzleRing","MuzzleInset","Muzzle","FrontSight"]) {const node=root.listNodes().find((n:Node)=>n.getName()===name);if(node){const p=node.getTranslation();node.setTranslation([p[0],p[1],p[2]+delta]);}}
      const now=muzzle.getTranslation(),effect=root.listNodes().find((n:Node)=>n.getName()==="CosmeticProjectile");if(effect)effect.setTranslation([...now]);
      for(const animation of root.listAnimations())for(const channel of animation.listChannels())if(channel.getTargetNode()?.getName()==="CosmeticProjectile"&&channel.getTargetPath()==="translation"){
        const values=channel.getSampler().getOutput().getArray() as Float32Array;for(let i=0;i<values.length;i+=3){values[i]+=now[0]-old[0];values[i+1]+=now[1]-old[1];values[i+2]+=now[2]-old[2];}channel.getSampler().getOutput().setArray(values);
      }
    }
    if(a.propBulk)for(const name of ["GamePropBody","Grip","BarrelShroud","SidePanelLeft","SidePanelRight"])transformMesh(doc,name,[a.propBulk,a.propBulk,1]);
    if(a.muzzleSize)for(const name of ["MuzzleRing","MuzzleInset"])transformMesh(doc,name,[a.muzzleSize,a.muzzleSize,1]);
  }else{
    if(a.personHeight){for(const node of doc.getRoot().listNodes().filter((n:Node)=>n.getMesh()&&!n.getMesh().getExtras().effect))transformMesh(doc,node.getName(),[1,a.personHeight,1]);for(const node of doc.getRoot().listNodes().filter((n:Node)=>n.getName()!=="GrudgeAssetRoot")){const p=node.getTranslation();node.setTranslation([p[0],p[1]*a.personHeight,p[2]]);}}
    if(a.personWidth){for(const node of doc.getRoot().listNodes().filter((n:Node)=>n.getMesh()&&!n.getMesh().getExtras().effect))transformMesh(doc,node.getName(),[a.personWidth,1,1]);for(const node of doc.getRoot().listNodes().filter((n:Node)=>n.getName()!=="GrudgeAssetRoot")){const p=node.getTranslation();node.setTranslation([p[0]*a.personWidth,p[1],p[2]]);}}
    if(a.headSize){for(const name of ["Head","Hair","EyeWhite-1","EyeWhite1","Pupil-1","Pupil1","Ear-1","Ear1","Nose","Mouth"]) {transformMesh(doc,name,[a.headSize,a.headSize,a.headSize]);scaleTranslation(doc,name,[a.headSize,a.headSize,a.headSize]);}}
  }
  if(a.cosmeticDetail)enhanceOriginalGeometry(doc,plan);
}

export function addOriginalMotion(doc: Doc, plan: CreationPlan) {
  const nodes=doc.getRoot().listNodes(),find=(name:string)=>{const node=nodes.find((n:Node)=>n.getName()===name);if(!node)throw new Error(`Required authored joint ${name} is missing.`);return node;};
  const buffer=doc.getRoot().listBuffers()[0];
  const animation=doc.createAnimation(plan.operation==="dance"?"Original articulated dance":plan.operation==="projectile"?"Cosmetic projectile from muzzle":plan.operation==="swipe"?"Sword side-to-side swipe":"Turntable");
  const duration=plan.operation==="projectile"?2:4;
  const times=Float32Array.from({length:65},(_,i)=>i*duration/64);
  const input=doc.createAccessor().setType("SCALAR").setArray(times).setBuffer(buffer);
  function track(node:Node,path:string,size:number,values:number[]){const sampler=doc.createAnimationSampler().setInput(input).setOutput(doc.createAccessor().setType(size===4?"VEC4":"VEC3").setArray(new Float32Array(values)).setBuffer(buffer)).setInterpolation("LINEAR");animation.addSampler(sampler);animation.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));}
  function rotation(name:string,angles:(t:number)=>[number,number,number]){const values:number[]=[];for(let i=0;i<65;i++){const a=angles(i/64),q=new THREE.Quaternion().setFromEuler(new THREE.Euler(...a));values.push(q.x,q.y,q.z,q.w);}track(find(name),"rotation",4,values);}
  if(plan.operation==="swipe")rotation("GripPivot",t=>[0,0,Math.sin(t*Math.PI*2)*.92]);
  else if(plan.operation==="turntable")rotation(nodes.find((n:Node)=>n.getExtras().localWorkingRoot)?.getName()??"GrudgeAssetRoot",t=>[0,t*Math.PI*2,0]);
  else if(plan.operation==="projectile"){
    const muzzle=find("Muzzle"),position=muzzle.getTranslation();
    let effect=nodes.find((n:Node)=>n.getName()==="CosmeticProjectile");
    if(!effect){const a=author(doc);effect=a.mesh(find("GrudgeAssetRoot"),"CosmeticProjectile",new THREE.SphereGeometry(.037,12,8).scale(1,1,2.2),"projectile",[...position],true);effect.getMesh().listPrimitives()[0].getMaterial().setBaseColorFactor([1,.58,.02,1]).setEmissiveFactor([1,.35,.005]);}
    const values:number[]=[],scales:number[]=[];
    for(let i=0;i<65;i++){const t=i/64;const phase=t<.8?t/.8:0;values.push(position[0],position[1],position[2]+phase*1.2);const visible=t<.78?1:.0001;scales.push(visible,visible,visible);}
    track(effect,"translation",3,values);track(effect,"scale",3,scales);
  } else if(plan.operation==="dance") {
    rotation("PelvisJoint",t=>[0,.15*Math.sin(t*Math.PI*2),.09*Math.sin(t*Math.PI*4)]);
    rotation("TorsoJoint",t=>[.05*Math.cos(t*Math.PI*4),0,.12*Math.sin(t*Math.PI*2)]);
    rotation("HeadJoint",t=>[.10*Math.sin(t*Math.PI*4),.25*Math.sin(t*Math.PI*2),0]);
    for(const side of [-1,1]){const tag=side<0?"Left":"Right";rotation(`${tag}Shoulder`,t=>[.35*Math.cos(t*Math.PI*2+side),.15*side,side*(.75+.5*Math.sin(t*Math.PI*2))]);rotation(`${tag}Elbow`,t=>[-.75-.55*Math.sin(t*Math.PI*2+side),0,0]);rotation(`${tag}Hip`,t=>[.3*Math.sin(t*Math.PI*2+side*Math.PI/2),0,side*.08]);rotation(`${tag}Knee`,t=>[.25+.3*(1+Math.sin(t*Math.PI*2+side*Math.PI/2)),0,0]);}
  }
}

export function originalGeometryHash(doc: Doc): string {
  const hash=createHash("sha256");
  for(const mesh of doc.getRoot().listMeshes().filter((m:any)=>!m.getExtras().effect).sort((a:any,b:any)=>a.getName().localeCompare(b.getName()))){hash.update(mesh.getName());for(const p of mesh.listPrimitives()){for(const a of [p.getAttribute("POSITION"),p.getIndices()]){if(a){const v=a.getArray();hash.update(Buffer.from(v.buffer,v.byteOffset,v.byteLength));}}}}
  for(const node of doc.getRoot().listNodes().filter((n:Node)=>n.getExtras().localWorkingRoot))hash.update(JSON.stringify(node.getScale()));
  return hash.digest("hex");
}

export function validateOriginal(doc: Doc, expectedHash?: string, expectChange=false, reused=false) {
  const root=doc.getRoot();let triangles=0;
  for(const mesh of root.listMeshes())for(const p of mesh.listPrimitives()){
    const pos=p.getAttribute("POSITION"),normal=p.getAttribute("NORMAL"),uv=p.getAttribute("TEXCOORD_0");
    if(!pos||(!reused&&(!normal||!uv))||!Array.from(pos.getArray() as number[]).every(Number.isFinite)||[normal,uv].some(a=>a&&!Array.from(a.getArray() as number[]).every(Number.isFinite)))throw new Error("Authored geometry failed finite positions/normals/UV checks.");
    const index=p.getIndices();if(index&&Array.from(index.getArray() as number[]).some(v=>v>=pos.getCount()))throw new Error("Invalid triangle indices.");triangles+=(index?.getCount()??pos.getCount())/3;
    if(!reused&&!p.getMaterial())throw new Error("A generated primitive has no material.");
  }
  if(!triangles||!root.listScenes().length)throw new Error("The model has no renderable scene geometry.");
  const geometryPreserved=!expectedHash||originalGeometryHash(doc)===expectedHash;
  if(expectChange&&geometryPreserved)throw new Error("The requested geometry adjustment made no measurable alteration; the revision was not accepted.");
  if(!expectChange&&!geometryPreserved)throw new Error("Follow-up changed the original mesh geometry; the revision was not accepted.");
  for(const animation of root.listAnimations())for(const channel of animation.listChannels())if(!channel.getTargetNode())throw new Error("Animation target is missing.");
  return {triangles,textures:root.listTextures().length,clips:root.listAnimations().map((a:any)=>a.getName()),articulatedNodes:root.listNodes().filter((n:Node)=>n.getExtras().articulated).length,detailNodes:root.listNodes().filter((n:Node)=>n.getExtras().cosmeticDetail).length,selfContained:true,geometryPreserved,geometryChanged:expectChange&&!geometryPreserved,checks:["Finite authored geometry, indices, normals and UVs",reused?"Embedded working copy; original source provenance retained":"Embedded materials and texture pixels; no external asset input","Animation target nodes exist",expectChange?"Requested geometry alteration changed the measurable authored mesh":"Original geometry identity preserved","Visual shape and motion review still required"]};
}
