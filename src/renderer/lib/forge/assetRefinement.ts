import * as THREE from "three";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { validateRefinementRecipe, type AssetRefinementRecipe } from "../../../shared/assetRefinement";
import { createPrecisionSword } from "./precisionSword";

export function makeRefinementTexture(pattern: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const pixels = ctx.createImageData(512, 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const noise = ((x * 73856093 ^ y * 19349663) >>> 0) % 37;
    const grain = pattern === "brushed-metal" ? (y * 17 % 29) : pattern === "leather" ? noise * 1.4 : pattern === "wood" ? 34 * (1 + Math.sin(x * .12 + Math.sin(y * .02) * 3)) : 0;
    const i = (y * 512 + x) * 4, value = Math.round(245 - grain);
    pixels.data[i] = pixels.data[i+1] = pixels.data[i+2] = value; pixels.data[i+3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.name = `Local procedural ${pattern}`;
  return texture;
}

export function buildAssetRefinement(source: THREE.Object3D, value: AssetRefinementRecipe, inheritedClips: THREE.AnimationClip[] = []) {
  const recipe = validateRefinementRecipe(value);
  source.traverse(n => { if(n.userData.genericPreviewHost || n.userData.comparisonOnly) throw new Error("A borrowed preview/comparison model cannot be a refinement input."); });
  const object = new THREE.Group(); object.name = `GrudgeRefinement_${object.uuid.replace(/-/g, "")}`;
  const liveMixers: Array<[THREE.Object3D, unknown]> = [];
  source.traverse(n => { if (n.userData.grudgeMixer) { liveMixers.push([n,n.userData.grudgeMixer]); delete n.userData.grudgeMixer; } });
  let copy: THREE.Object3D;
  try { copy = recipe.sword ? createPrecisionSword(recipe.sword) : cloneSkeleton(source); } finally { liveMixers.forEach(([n,m]) => { n.userData.grudgeMixer=m; }); }
  copy.visible = true;
  copy.traverse(n => {
    delete n.userData.grudgeMixer;
    const m = n as THREE.Mesh;
    if (m.isMesh && !recipe.sword) { m.geometry = m.geometry.clone(); m.material = Array.isArray(m.material) ? m.material.map(x => x.clone()) : m.material.clone(); }
  });
  object.add(copy); object.updateMatrixWorld(true);
  if (!recipe.sword && source.userData.grudgeProvenance) object.userData.grudgeProvenance = structuredClone(source.userData.grudgeProvenance);
  const box = new THREE.Box3().setFromObject(object), size = box.getSize(new THREE.Vector3());
  if(box.isEmpty())throw new Error("Create a precision sword or select an existing mesh first.");
  const ownedTextures: THREE.Texture[] = [];
  if (recipe.material) {
    const settings = recipe.material, texture = makeRefinementTexture(settings.pattern); ownedTextures.push(texture);
    const material = new THREE.MeshStandardMaterial({ color: settings.color, metalness: settings.metalness, roughness: settings.roughness, map: texture });
    material.name = `Refinement ${settings.pattern}`;
    object.traverse(n => {
      const mesh = n as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry, position = g.getAttribute("position"), index = g.index;
      if (!position) return;
      const p = new THREE.Vector3();
      if (!g.getAttribute("uv")) {
        const uv = new Float32Array(position.count * 2);
        for (let i = 0; i < position.count; i++) { p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld); uv[i*2] = (p.x-box.min.x)/Math.max(size.x,1e-6); uv[i*2+1] = (p.y-box.min.y)/Math.max(size.y,1e-6); }
        g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      }
      const materials = Array.isArray(mesh.material) ? [...mesh.material] : [mesh.material];
      const added = materials.length; materials.push(material); mesh.material = materials;
      const originalGroups = [...g.groups]; g.clearGroups();
      const count = index?.count ?? position.count;
      let runStart = 0, runMaterial = -1;
      for (let i = 0; i < count; i += 3) {
        let y = 0;
        for (let k=0;k<3;k++) { p.fromBufferAttribute(position,index ? index.getX(i+k):i+k).applyMatrix4(mesh.matrixWorld); y += p.y / 3; }
        const height = (y-box.min.y)/Math.max(size.y,1e-6);
        const target = height >= settings.region.min && height <= settings.region.max;
        const original = originalGroups.find(group => i >= group.start && i < group.start + group.count)?.materialIndex ?? 0;
        const next = target ? added : original;
        if (next !== runMaterial) { if (runMaterial >= 0) g.addGroup(runStart,i-runStart,runMaterial); runStart=i; runMaterial=next; }
      }
      if (runMaterial >= 0) g.addGroup(runStart,count-runStart,runMaterial);
    });
  }
  const clips = inheritedClips.map(c => c.clone());
  let motion: THREE.AnimationClip | null = null;
  if (recipe.motion) {
    const {kind,duration,amount} = recipe.motion;
    const pivotY = box.min.y + size.y * (recipe.motion.pivotHeight ?? .5);
    object.position.y = pivotY; copy.position.y -= pivotY;
    const times: number[] = [], values: number[] = [];
    for (let i=0;i<=32;i++) {
      const t=i/32; times.push(t*duration);
      if (kind === "thrust") values.push(0,pivotY,Math.sin(t*Math.PI*2)*amount);
      else {
        const angle = THREE.MathUtils.degToRad(kind === "turntable" ? t*amount : Math.sin(t*Math.PI*2)*amount/2);
        const q = new THREE.Quaternion().setFromAxisAngle(kind === "turntable" ? new THREE.Vector3(0,1,0) : new THREE.Vector3(0,0,1),angle);
        values.push(q.x,q.y,q.z,q.w);
      }
    }
    const track = recipe.motion.kind === "thrust" ? new THREE.VectorKeyframeTrack(`${object.name}.position`,times,values) : new THREE.QuaternionKeyframeTrack(`${object.name}.quaternion`,times,values);
    motion = new THREE.AnimationClip(`Chat ${kind}`,duration,[track]); clips.push(motion);
  }
  const dispose = () => {
    const materials = new Set<THREE.Material>();
    object.traverse(n => { const mesh=n as THREE.Mesh; if(mesh.isMesh){mesh.geometry.dispose(); (Array.isArray(mesh.material)?mesh.material:[mesh.material]).forEach(m=>materials.add(m));} });
    materials.forEach(m=>m.dispose()); ownedTextures.forEach(t=>t.dispose());
  };
  return { object, clips, motion, dispose };
}
