import * as THREE from "three";
import type { Document, Node as GltfNode } from "@gltf-transform/core";

type V3 = [number,number,number];
export interface CharacterLandmarks { [name:string]: V3 }
interface FieldPart { name:string; center:V3; radius:V3; roundBox?:boolean; inverse?:THREE.Matrix4 }
const normalizedName=(name:string)=>name.toLowerCase().replace(/[^a-z]/g,"");
const detailPart=(name:string)=>/eye|pupil|teeth|tooth|claw|nostril/.test(normalizedName(name));

function meshBounds(node:GltfNode):THREE.Box3 {
  const box=new THREE.Box3(),matrix=new THREE.Matrix4().fromArray(node.getWorldMatrix()),point=new THREE.Vector3();
  for(const primitive of node.getMesh()!.listPrimitives()){
    const positions=primitive.getAttribute("POSITION")!.getArray()!;
    for(let i=0;i<positions.length;i+=3)box.expandByPoint(point.set(Number(positions[i]),Number(positions[i+1]),Number(positions[i+2])).applyMatrix4(matrix));
  }
  return box;
}

function signedDistance(part:FieldPart,x:number,y:number,z:number):number {
  let px=x-part.center[0],py=y-part.center[1],pz=z-part.center[2];
  if(part.inverse){const e=part.inverse.elements,ax=px,ay=py,az=pz;px=e[0]*ax+e[4]*ay+e[8]*az;py=e[1]*ax+e[5]*ay+e[9]*az;pz=e[2]*ax+e[6]*ay+e[10]*az;}
  const [rx,ry,rz]=part.radius;
  if(part.roundBox){const r=Math.min(rx,ry,rz)*.65,qx=Math.abs(px)-rx+r,qy=Math.abs(py)-ry+r,qz=Math.abs(pz)-rz+r;return Math.hypot(Math.max(qx,0),Math.max(qy,0),Math.max(qz,0))+Math.min(Math.max(qx,qy,qz),0)-r;}
  const k0=Math.hypot(px/rx,py/ry,pz/rz),k1=Math.hypot(px/(rx*rx),py/(ry*ry),pz/(rz*rz));
  return k1<1e-12?-Math.min(rx,ry,rz):k0*(k0-1)/k1;
}
const smoothUnion=(a:number,b:number,k:number)=>{const h=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-h*h*k*.25;};

/** Count welded geometric islands, independent of normal and UV seams. */
export function surfaceConnectivity(positions:ArrayLike<number>,indices?:ArrayLike<number>){
  const unique=new Map<string,number>(),ids:number[]=[],parents:number[]=[],weights:number[]=[],points:V3[]=[];
  for(let i=0;i<positions.length;i+=3){const key=[positions[i],positions[i+1],positions[i+2]].map(n=>Math.round(n*1e5)).join(",");let id=unique.get(key);if(id===undefined){id=parents.length;unique.set(key,id);parents.push(id);weights.push(1);points.push([positions[i],positions[i+1],positions[i+2]]);}ids.push(id);}
  const root=(id:number):number=>{while(parents[id]!==id){parents[id]=parents[parents[id]];id=parents[id];}return id;};
  const join=(a:number,b:number)=>{a=root(a);b=root(b);if(a===b)return;if(weights[a]<weights[b])[a,b]=[b,a];parents[b]=a;weights[a]+=weights[b];};
  const count=indices?.length??ids.length;
  for(let i=0;i<count;i+=3){const a=ids[indices?indices[i]:i],b=ids[indices?indices[i+1]:i+1],c=ids[indices?indices[i+2]:i+2];join(a,b);join(a,c);}
  const groups=parents.filter((_,i)=>root(i)===i).map(id=>weights[id]);
  const centers=new Map<number,V3>();points.forEach((p,i)=>{const r=root(i),sum=centers.get(r)??[0,0,0];for(let axis=0;axis<3;axis++)sum[axis]+=p[axis];centers.set(r,sum);});
  const islands=[...centers.entries()].map(([id,sum])=>({vertices:weights[id],center:sum.map(n=>Number((n/weights[id]).toFixed(3)))})).sort((a,b)=>b.vertices-a.vertices).slice(0,12);
  return {components:groups.length,largestFraction:Math.max(0,...groups)/parents.length,vertices:parents.length,islands};
}

/** Fuse the retained anatomical parts into a sampled smooth surface, with small joint blends.
 * Eyes and teeth remain separate anatomical details. The source revision is never changed.
 */
export async function unifyCharacterSurface(document:Document):Promise<{landmarks:CharacterLandmarks;triangles:number;components:number}> {
  const root=document.getRoot(),scene=root.getDefaultScene()??root.listScenes()[0];
  if(!scene)throw new Error("The current character has no scene.");
  const meshNodes=root.listNodes().filter(n=>n.getMesh()&&!n.getExtras().effect);
  const existing=meshNodes.find(n=>n.getExtras().unifiedCharacterSurface);
  if(existing){
    // Gentle Taubin relaxation keeps the retained topology, UVs, joints and weights.
    // Alternating shrink/expand passes remove voxel bumps without shrinking the silhouette.
    let triangles=0;
    for(const primitive of existing.getMesh()!.listPrimitives()){
      const position=primitive.getAttribute("POSITION")!,array=new Float32Array(position.getArray()!),index=primitive.getIndices()!.getArray()!;
      const neighbors=Array.from({length:array.length/3},()=>new Set<number>());
      for(let i=0;i<index.length;i+=3)for(let j=0;j<3;j++){const a=Number(index[i+j]),b=Number(index[i+(j+1)%3]);neighbors[a].add(b);neighbors[b].add(a);}
      for(let pass=0;pass<8;pass++){const next=new Float32Array(array),factor=pass%2?-.53:.5;neighbors.forEach((edges,v)=>{if(!edges.size)return;for(let axis=0;axis<3;axis++){let sum=0;for(const other of edges)sum+=array[other*3+axis];next[v*3+axis]+=factor*(sum/edges.size-array[v*3+axis]);}});array.set(next);}
      position.setArray(array);
      const geometry=new THREE.BufferGeometry().setAttribute("position",new THREE.BufferAttribute(array,3)).setIndex(Array.from(index));geometry.computeVertexNormals();
      primitive.getAttribute("NORMAL")!.setArray(new Float32Array(geometry.getAttribute("normal").array));geometry.dispose();triangles+=index.length/3;
      if(surfaceConnectivity(array,index).components!==1)throw new Error("Surface smoothing broke the connected skin.");
    }
    return {landmarks:root.getExtras().characterLandmarks as CharacterLandmarks,triangles,components:1};
  }
  const partName=(node:GltfNode)=>String(node.getExtras().characterPartName??node.getName());
  const find=(name:string)=>meshNodes.find(n=>normalizedName(partName(n))===name);
  if(!find("head")||!(find("torso")||find("body"))||!find("leftleg")||!find("rightleg"))throw new Error("Surface unification needs a retained humanoid with named head, torso and separate legs.");
  const retainedRig=root.listSkins().length>0;
  if(retainedRig&&(root.getExtras().authoredCharacterRig as {profile?:string})?.profile!=="grudge-authored-character-rig-v1")throw new Error("The imported skin needs its existing surface tools. Its binding was not replaced.");
  const sourceBounds=new THREE.Box3();meshNodes.forEach(n=>sourceBounds.union(meshBounds(n)));
  const height=sourceBounds.getSize(new THREE.Vector3()).y,unit=height/2;
  if(height<.2||height>40)throw new Error("Character height is outside the bounded surface workflow.");
  const parts:FieldPart[]=[],landmarks:CharacterLandmarks={};
  const add=(name:string,center:V3,radius:V3,roundBox=false,rotation=0)=>{parts.push({name,center,radius,roundBox,...(rotation?{inverse:new THREE.Matrix4().makeRotationZ(-rotation)}:{})});landmarks[name]=center;};
  const bodyNodes=meshNodes.filter(n=>!detailPart(partName(n)));
  for(const node of bodyNodes){
    const box=meshBounds(node),center=box.getCenter(new THREE.Vector3()).toArray() as V3,radius=box.getSize(new THREE.Vector3()).multiplyScalar(.5).toArray() as V3,name=partName(node),key=normalizedName(name);
    if(key==="tail")continue;
    if(/^(?:left|right)(?:arm|hand)$/.test(key)){
      const sign=key.startsWith("left")?-1:1;
      if(!retainedRig){center[0]+=sign*.09*unit;if(key.endsWith("hand")){center[0]+=sign*.095*unit;center[1]-=.02*unit;}}
      add(name,center,radius,false,!retainedRig&&key.endsWith("arm")?sign*.40:0);continue;
    }
    if(key==="torso"||key==="body"){
      add("Torso",center,[radius[0]*.92,radius[1],radius[2]]);
      add("Chest",[center[0],center[1]+radius[1]*.53,center[2]],[radius[0]*1.08,radius[1]*.62,radius[2]*1.04]);continue;
    }
    if(key==="hips")radius[1]*=1.3;
    add(name,center,radius,/snout|jaw|foot/.test(key));
  }
  const join=(a:string,b:string,width:number)=>{
    const pa=landmarks[a],pb=landmarks[b];if(!pa||!pb)return;
    const distance=Math.hypot(...pa.map((n,i)=>n-pb[i]));
    const samples=Math.max(2,Math.ceil(distance/(width*.75)));
    for(let i=1;i<samples;i++)add(`${a}-${b}-${i}`,pa.map((n,axis)=>n+(pb[axis]-n)*i/samples) as V3,[width,width,width]);
  };
  join("Torso","Hips",.14*unit);join("Head","Neck",.09*unit);join("Neck","Chest",.10*unit);
  for(const side of ["Left","Right"]){
    const arm=landmarks[`${side}Arm`],hand=landmarks[`${side}Hand`],leg=landmarks[`${side}Leg`],foot=landmarks[`${side}Foot`];
    const sign=side==="Left"?-1:1,torso=landmarks.Torso;
    if(arm){add(`${side}Shoulder`,[torso[0]+sign*.25*unit,torso[1]+.22*unit,torso[2]],[.115*unit,.12*unit,.115*unit]);join(`${side}Shoulder`,`${side}Arm`,.082*unit);}
    join(`${side}Arm`,`${side}Hand`,.065*unit);
    if(leg){const hip=landmarks.Hips;add(`${side}Hip`,[leg[0],hip[1]-.075*unit,leg[2]],[.11*unit,.13*unit,.115*unit]);join(`${side}Hip`,`${side}Leg`,.10*unit);}
    if(leg&&foot)join(`${side}Leg`,`${side}Foot`,.075*unit);
    if(hand)for(let finger=0;finger<3;finger++)add(`${side}Finger${finger+1}`,[hand[0]+(finger-1)*.052*unit,hand[1]-.075*unit,hand[2]+.018*unit],[.032*unit,.075*unit,.038*unit]);
  }
  const tail=find("tail");
  if(tail){
    const box=meshBounds(tail),hip=landmarks.Hips,back=box.min.z,front=Math.min(hip[2],box.max.z),length=front-back;
    for(let i=0;i<=48;i++){const t=i/48,r=Math.max(.020*unit,.145*unit*(1-t)**.85);add(`TailSurface${i}`,[hip[0],hip[1]-.16*unit*t*t,front-length*t],[r,r,r*1.2]);}
    landmarks.TailBase=[hip[0],hip[1],front];landmarks.TailTip=[hip[0],hip[1]-.16*unit,back];
  }
  if(landmarks.Jaw&&landmarks.Head)join("Jaw","Head",.046*unit);
  const bounds=sourceBounds.clone().expandByScalar(.17*unit);
  for(const p of parts)bounds.expandByPoint(new THREE.Vector3(...p.center).addScalar(.2*unit)).expandByPoint(new THREE.Vector3(...p.center).addScalar(-.2*unit));
  const size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3()),resolution=112;
  const {MarchingCubes}=require("three/addons/objects/MarchingCubes.js");
  const marching=new MarchingCubes(resolution,new THREE.MeshStandardMaterial(),false,false,180_000);
  marching.isolation=0;
  for(let z=0;z<resolution;z++)for(let y=0;y<resolution;y++)for(let x=0;x<resolution;x++){
    const px=bounds.min.x+x/resolution*size.x,py=bounds.min.y+y/resolution*size.y,pz=bounds.min.z+z/resolution*size.z;
    let distance=Infinity;
    for(const p of parts)distance=smoothUnion(distance,signedDistance(p,px,py,pz),.045*unit);
    marching.field[x+y*resolution+z*resolution*resolution]=-distance;
  }
  marching.update();
  const count=marching.geometry.drawRange.count;
  if(!Number.isFinite(count)||count<300||count>=180_000*3)throw new Error("The unified surface exceeded its geometry bounds.");
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.BufferAttribute(new Float32Array(marching.geometry.getAttribute("position").array.slice(0,count*3)),3));
  geometry.scale(size.x/2,size.y/2,size.z/2).translate(center.x,center.y,center.z);
  // Weld before smoothing normals so voxel cells do not remain visible as seams.
  const {mergeVertices}=require("three/addons/utils/BufferGeometryUtils.js");
  const welded=mergeVertices(geometry,1e-5*unit);welded.computeVertexNormals();
  const pos=welded.getAttribute("position"),normal=welded.getAttribute("normal"),uv=new Float32Array(pos.count*2);
  for(let i=0;i<pos.count;i++){uv[i*2]=Math.atan2(pos.getX(i),pos.getZ(i)) /(2*Math.PI)+.5;uv[i*2+1]=pos.getY(i)/height;}
  const connectivity=surfaceConnectivity(pos.array,welded.index?.array);
  if(connectivity.components!==1)throw new Error(`Surface unification left ${connectivity.components} disconnected body islands: ${JSON.stringify(connectivity.islands)}. No disconnected replacement was saved.`);
  const buffer=root.listBuffers()[0]??document.createBuffer(),primitive=document.createPrimitive();
  for(const [semantic,array,type] of [["POSITION",new Float32Array(pos.array),"VEC3"],["NORMAL",new Float32Array(normal.array),"VEC3"],["TEXCOORD_0",uv,"VEC2"]] as const)primitive.setAttribute(semantic,document.createAccessor(semantic).setType(type).setArray(array).setBuffer(buffer));
  primitive.setIndices(document.createAccessor("Unified surface indices").setType("SCALAR").setArray(new Uint32Array(welded.index!.array)).setBuffer(buffer));
  const sourceMaterial=(find("torso")??find("body"))!.getMesh()!.listPrimitives()[0].getMaterial();
  const material=sourceMaterial?sourceMaterial.clone():document.createMaterial("Character surface").setBaseColorFactor([.14,.24,.08,1]);
  material.setName("Unified skin").setExtras({...material.getExtras(),role:"component-UnifiedBody",unifiedCharacterSurface:true}).setRoughnessFactor(.78);
  primitive.setMaterial(material);
  const parent=bodyNodes[0].getParentNode()??scene;
  const body=document.createNode("Body").setMesh(document.createMesh("Unified character skin").addPrimitive(primitive).setExtras({originalAuthored:true})).setExtras({originalAuthored:true,unifiedCharacterSurface:true,characterLandmarks:landmarks,surfaceConnectivity:connectivity,method:"anatomical-smooth-union-marching-cubes"});
  parent.addChild(body);
  // Keep whole-model motion. Retain character-idle intent for the new skin binding.
  const retainedIdle=root.listAnimations().some(a=>/character idle|skin idle/i.test(a.getName()));
  const replacedNodes=new Set(bodyNodes);
  for(const animation of [...root.listAnimations()]){
    for(const channel of [...animation.listChannels()])if(replacedNodes.has(channel.getTargetNode()!))channel.dispose();
    if(!animation.listChannels().length)animation.dispose();
  }
  for(const node of bodyNodes){const mesh=node.getMesh();node.dispose();if(mesh&&!root.listNodes().some(n=>n.getMesh()===mesh))mesh.dispose();}
  for(const mesh of root.listMeshes())if(!root.listNodes().some(n=>n.getMesh()===mesh))mesh.dispose();
  document.getRoot().setExtras({...root.getExtras(),characterLandmarks:landmarks,unifiedCharacterSurface:true,retainedCharacterIdle:retainedIdle});
  if(retainedRig)require("./characterRig").bindCharacterRig(document,"Rebind the retained skeleton after surface unification");
  marching.geometry.dispose();marching.material.dispose();geometry.dispose();welded.dispose();
  return {landmarks,triangles:count/3,components:connectivity.components};
}
