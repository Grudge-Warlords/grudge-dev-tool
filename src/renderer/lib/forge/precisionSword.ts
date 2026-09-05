import * as THREE from "three";
import type { AssetRefinementRecipe } from "../../../shared/assetRefinement";

/** Explicit parametric authoring, never substituted for neural provider output. */
export function createPrecisionSword(s: NonNullable<AssetRefinementRecipe["sword"]>): THREE.Group {
  const root=new THREE.Group();root.name=`Precision_${s.kind}`;
  root.userData.grudgeCreation={method:"parametric-sword",neuralGeneration:false,parameters:s};
  const steel=new THREE.MeshStandardMaterial({color:0xb7c4d6,metalness:.92,roughness:.26});steel.name="Blade steel";
  const brass=new THREE.MeshStandardMaterial({color:0xba8c36,metalness:.82,roughness:.3});brass.name="Guard and pommel brass";
  const leather=new THREE.MeshStandardMaterial({color:s.kind==="leafblade"?0x702420:0x2a1710,metalness:0,roughness:.86});leather.name="Grip leather";
  const base=s.gripLength+.045, bladeLength=s.length-base, segments=32;
  const vertices:number[]=[],uv:number[]=[],indices:number[]=[];
  // Eight-sided beveled cross-section with a central ridge on both faces.
  const cross=[[-.5,0],[-.43,.45],[0,1],[.43,.45],[.5,0],[.43,-.45],[0,-1],[-.43,-.45]];
  for(let row=0;row<segments;row++){
    const t=row/segments;
    const taper=s.kind==="leafblade" ? .45*(1-t)+.85*Math.sin(Math.PI*t) : s.kind==="rapier" ? 1-.96*t : (1-.25*t)*(t>.65?(1-t)/.35:1);
    const w=s.width*taper, x=s.curvature*t*t;
    for(const [cx,cz] of cross){vertices.push(x+cx*w,base+bladeLength*t,cz*Math.max(.0025,s.width*.065)*(1-.55*t));uv.push(cx+.5,t);}
  }
  for(let row=0;row<segments-1;row++)for(let c=0;c<8;c++){const a=row*8+c,b=row*8+(c+1)%8,d=(row+1)*8+c,e=(row+1)*8+(c+1)%8;indices.push(a,b,d,b,e,d);}
  const tip=vertices.length/3;vertices.push(s.curvature,base+bladeLength,0);uv.push(.5,1);
  for(let c=0;c<8;c++)indices.push((segments-1)*8+c,(segments-1)*8+(c+1)%8,tip);
  for(let c=1;c<7;c++)indices.push(0,c+1,c);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();
  const blade=new THREE.Mesh(geometry,steel);blade.name="Blade";root.add(blade);
  const guardShape=new THREE.Shape(), half=s.guardWidth/2;
  guardShape.moveTo(-half,-.016);guardShape.lineTo(-half,.01);guardShape.quadraticCurveTo(-half*.55,.045,0,.014);guardShape.quadraticCurveTo(half*.55,.045,half,.01);guardShape.lineTo(half,-.016);guardShape.quadraticCurveTo(half*.5,.009,0,-.013);guardShape.quadraticCurveTo(-half*.5,.009,-half,-.016);
  const guardGeometry=new THREE.ExtrudeGeometry(guardShape,{depth:.018,bevelEnabled:true,bevelThickness:.003,bevelSize:.003,bevelSegments:2,steps:1,curveSegments:12});
  const guard=new THREE.Mesh(guardGeometry,brass);guard.name="Crossguard";guard.position.set(0,base,-.009);root.add(guard);
  const grip=new THREE.Mesh(new THREE.CylinderGeometry(.017,.021,s.gripLength,16),leather);grip.name="Grip";grip.position.y=s.gripLength/2+.035;root.add(grip);
  for(let i=0;i<9;i++){const ring=new THREE.Mesh(new THREE.TorusGeometry(.0205-i*.00035,.0014,5,16),brass);ring.name=`Grip binding ${i+1}`;ring.rotation.x=Math.PI/2;ring.position.y=.05+i*(s.gripLength-.02)/8;root.add(ring);}
  const pommel=new THREE.Mesh(new THREE.SphereGeometry(.031,16,10),brass);pommel.name="Pommel";pommel.scale.set(1,1,.65);pommel.position.y=.031;root.add(pommel);
  if(s.kind==="sabre"){
    const curve=new THREE.CubicBezierCurve3(new THREE.Vector3(half*.8,base,0),new THREE.Vector3(half*1.5,base-.03,0),new THREE.Vector3(half*1.5,.025,0),new THREE.Vector3(0,.04,0));
    const bow=new THREE.Mesh(new THREE.TubeGeometry(curve,24,.0055,8,false),brass);bow.name="Knuckle bow";root.add(bow);
  }
  if(s.kind==="rapier"){
    const ring=new THREE.Mesh(new THREE.TorusGeometry(s.guardWidth*.35,.006,8,32),brass);ring.name="Swept ring guard";ring.position.y=base;root.add(ring);
  }
  root.traverse(n=>{const m=n as THREE.Mesh;if(m.isMesh){m.castShadow=true;m.receiveShadow=true;}});
  return root;
}
