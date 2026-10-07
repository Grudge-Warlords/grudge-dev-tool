import * as THREE from "three";
import { validateCreationComponent, type CreationComponent } from "../../shared/creationFlow";
import { hasAffirmativePromptMatch } from "../../shared/promptedMotionIntent";

export const isHumanoidAssembly = (prompt: string) => hasAffirmativePromptMatch(prompt, /\b(humanoid|biped(?:al)?|anthropomorphic)\b/i);
const key = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");
const role = (name: string) => ({ body: "torso", chest: "torso", pelvis: "hips", nose: "snout", armleft: "leftarm", armright: "rightarm", legleft: "leftleg", legright: "rightleg", footleft: "leftfoot", footright: "rightfoot" }[key(name)] ?? key(name));

/** World bounds include orientation. Small joint contacts are allowed; buried parts are not. */
function bounds(part: CreationComponent) {
  const rotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...(part.rotation ?? [0, 0, 0]).map(THREE.MathUtils.degToRad) as [number, number, number]));
  const half = new THREE.Vector3(...part.size).multiplyScalar(.5);
  const box = new THREE.Box3(half.clone().negate(), half).applyMatrix4(rotation);
  return box.translate(new THREE.Vector3(...part.position));
}

/** These diagnostics travel with the rejected proposal into the next planning pass. */
export function assemblyLayoutIssues(parts: CreationComponent[], prompt: string): string[] {
  const issues: string[] = [];
  const describe = (p: CreationComponent) => `${p.name} at [${p.position.join(", ")}], size [${p.size.join(", ")}]`;
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    const a = parts[i], b = parts[j];
    if (JSON.stringify([a.shape, a.position, a.size, a.rotation ?? [0,0,0]]) === JSON.stringify([b.shape, b.position, b.size, b.rotation ?? [0,0,0]])) issues.push(`Identical geometry: ${describe(a)} overlaps ${describe(b)}. Separate their anatomical locations.`);
    else if (isHumanoidAssembly(prompt)) {
      const ba = bounds(a), bb = bounds(b), overlap = ba.clone().intersect(bb);
      if (!overlap.isEmpty()) {
        const s = overlap.getSize(new THREE.Vector3()), sa = ba.getSize(new THREE.Vector3()), sb = bb.getSize(new THREE.Vector3());
        if (s.x * s.y * s.z > .5 * Math.min(sa.x * sa.y * sa.z, sb.x * sb.y * sb.z)) issues.push(`Buried part: ${describe(a)} overlaps more than half the bounds of ${describe(b)}. Keep joint contacts small and each part visible.`);
      }
    }
  }
  if (!isHumanoidAssembly(prompt)) return issues.slice(0, 16);
  const find = (name: string) => parts.find(p => role(p.name) === name);
  for (const name of ["head", "torso", "hips", "leftarm", "rightarm", "leftleg", "rightleg", "leftfoot", "rightfoot"]) if (!find(name)) issues.push(`Missing ${name}: provide a separately named and positioned humanoid part.`);
  const head = find("head"), torso = find("torso"), hips = find("hips");
  const contacts = [["head",find("neck")?"neck":"torso"],["hips","torso"],["leftarm","torso"],["rightarm","torso"],["lefthand","leftarm"],["righthand","rightarm"],["leftleg","hips"],["rightleg","hips"],["leftfoot","leftleg"],["rightfoot","rightleg"],["tail","hips"],["snout","head"]];
  for (const [child, parent] of contacts) {
    const a = find(child), b = find(parent);
    if (!a || !b) continue;
    const ba = bounds(a), bb = bounds(b);
    const gap = Math.hypot(...(["x","y","z"] as const).map(axis=>Math.max(0,ba.min[axis]-bb.max[axis],bb.min[axis]-ba.max[axis])));
    if (gap > Math.max(.015,(torso?.size[1]??.6)*.1)) issues.push(`Disconnected ${a.name}: ${describe(a)} is ${gap.toFixed(3)} m from ${describe(b)}. Attach it at the corresponding joint.`);
  }
  if (head && torso && head.position[1] <= torso.position[1]) issues.push(`Inverted head: ${describe(head)} must be above ${describe(torso)} (+Y is up).`);
  if (hips && torso && hips.position[1] >= torso.position[1]) issues.push(`Inverted hips: ${describe(hips)} must be below ${describe(torso)}.`);
  for (const type of ["arm", "leg", "foot"]) {
    const left = find(`left${type}`), right = find(`right${type}`);
    if (left && right && torso && (left.position[0] >= torso.position[0] || right.position[0] <= torso.position[0])) issues.push(`Laterality: ${describe(left)} must be on -X and ${describe(right)} on +X relative to ${describe(torso)}.`);
    for (const p of [left, right]) if (p && torso && type !== "arm" && p.position[1] >= (hips ?? torso).position[1]) issues.push(`${describe(p)} must be below the hips, with feet at ground level.`);
    for (const p of [left, right]) if (p && torso && type === "arm" && Math.abs(p.position[1] - torso.position[1]) > torso.size[1]) issues.push(`${describe(p)} must attach beside the torso, not above the head or below the hips.`);
    for (const p of [left, right]) if (p && type === "foot" && Math.abs(bounds(p).min.y) > .04) issues.push(`${describe(p)} must touch the ground at Y=0.`);
  }
  const reptile = hasAffirmativePromptMatch(prompt, /\b(alligator|crocodile)\b/i);
  const needsSnout = reptile || hasAffirmativePromptMatch(prompt, /\b(snout|elongated nose|long nose)\b/i);
  const needsTail = (reptile || hasAffirmativePromptMatch(prompt, /\btail\b/i)) && !/\b(?:no|without)\s+(?:a\s+)?tail\b/i.test(prompt);
  const snout = find("snout"), tail = find("tail");
  if (needsSnout && !snout) issues.push("Missing Snout: the requested elongated nose must project forward from the head along +Z.");
  if (needsTail && !tail) issues.push("Missing Tail: the requested tail must extend backward from the hips along -Z.");
  if (snout && head && (snout.position[2] <= head.position[2] || bounds(snout).getSize(new THREE.Vector3()).z < head.size[2] * .8 || Math.abs(snout.position[1] - head.position[1]) > head.size[1])) issues.push(`${describe(snout)} must be elongated along +Z and connected at head height.`);
  if (tail && hips && (tail.position[2] >= hips.position[2] || bounds(tail).getSize(new THREE.Vector3()).z < hips.size[2] * 2 || Math.abs(tail.position[1] - hips.position[1]) > hips.size[1])) issues.push(`${describe(tail)} must extend along -Z from hip height, not vertically or from the head.`);
  return issues.slice(0, 20);
}

/** A bounded procedural layout repair, used only after a rejected humanoid plan.
 * It supplies body relationships the small local planner cannot reliably calculate.
 * Explicit component measurements/coordinates remain the planner's responsibility.
 */
export function humanoidLayoutRepair(prompt: string, raw: unknown[]): CreationComponent[] | undefined {
  if (!isHumanoidAssembly(prompt)) return;
  const overallHeight = prompt.match(/\b(\d+(?:\.\d+)?)\s*(m|cm|metres?|meters?)\s+(?:tall|high)\b/i);
  if (/\b\d+(?:\.\d+)?\s*(?:m|cm|metres?|meters?)\b|\b(?:position|coordinates)\s*\[/i.test(overallHeight ? prompt.replace(overallHeight[0], "") : prompt)) return;
  const scale = overallHeight ? Number(overallHeight[1]) * (/^cm$/i.test(overallHeight[2]) ? .01 : 1) / 2 : 1;
  if (scale < .1 || scale > 20) return;
  const supplied: CreationComponent[] = [];
  for (const p of raw) { try { supplied.push(validateCreationComponent(p)); } catch { /* invalid fields are replaced by the bounded layout */ } }
  const reptile = hasAffirmativePromptMatch(prompt, /\b(alligator|crocodile|reptil\w*|lizard)\b/i);
  const snout = reptile || hasAffirmativePromptMatch(prompt, /\b(snout|elongated nose|long nose)\b/i);
  const tail = (reptile || supplied.some(p => role(p.name) === "tail") || hasAffirmativePromptMatch(prompt, /\btail\b/i)) && !/\b(?:no|without)\s+(?:a\s+)?tail\b/i.test(prompt);
  const palette: Record<string, string> = { red: "#a93e35", blue: "#426fa3", green: "#4f713a", brown: "#79563b", purple: "#795a91", white: "#dedbcc", black: "#30352e" };
  const requestedColor = prompt.match(/\b(red|blue|green|brown|purple|white|black)\b/i)?.[1].toLowerCase();
  const skin = requestedColor ? palette[requestedColor] : reptile ? "#4f713a" : supplied.find(p => role(p.name) === "torso")?.color ?? "#998267";
  const parts: CreationComponent[] = [];
  const add = (name: string, shape: CreationComponent["shape"], position: [number,number,number], size: [number,number,number], color = skin, rotation?: [number,number,number]) => parts.push({name,shape,position:position.map(n=>Number((n*scale).toFixed(5))) as [number,number,number],size:size.map(n=>Number((n*scale).toFixed(5))) as [number,number,number],color,...(rotation?{rotation}:{})});
  add("Torso", "cylinder", [0,1.285,0], [.52,.63,.34]);
  add("Hips", "sphere", [0,.875,0], [.47,.22,.32]);
  add("Neck", "cylinder", [0,1.655,0], [.18,.13,.18]);
  add("Head", "sphere", [0,1.845,0], [reptile ? .38 : .3,.31,reptile ? .38 : .3]);
  for (const [side, sign] of [["Left",-1],["Right",1]] as const) {
    add(`${side}Arm`, "cylinder", [sign*.345,1.315,0], [.18,.58,.19]);
    add(`${side}Hand`, "sphere", [sign*.345,.99,0], [.19,.13,.22]);
    add(`${side}Leg`, "cylinder", [sign*.145,.4625,0], [.21,.615,.23]);
    add(`${side}Foot`, "box", [sign*.145,.08,.085], [.23,.16,.4]);
    add(`${side}Eye`, "sphere", [sign*.13,1.915,reptile ? .20 : .16], [.095,.085,.07], "#d8bb59");
    add(`${side}Pupil`, "sphere", [sign*.13,1.915,reptile ? .237 : .197], [.025,.056,.018], "#172015");
  }
  if (snout) {
    add("Snout", "box", [0,1.82,.405], [.32,.16,.48]);
    add("Jaw", "box", [0,1.69,.405], [.3,.05,.47], requestedColor ? skin : "#a7ad70");
    for (const [side, sign] of [["Left",-1],["Right",1]] as const) add(`${side}Teeth`, "cone", [sign*.14,1.738,.54], [.04,.034,.04], "#e7dfbd", [180,0,0]);
  }
  if (tail) add("Tail", "cone", [0,.875,-.76], [.28,1.22,.25], skin, [-90,0,0]);
  // Keep additional named anatomy rather than silently discarding the model's interpretation.
  const replaced = new Set(parts.map(p => role(p.name)));
  const collective = new Set(["arms","legs","feet","hands","eyes","teeth","nose","mouth","tailtip"]);
  for (const p of supplied) if (!replaced.has(role(p.name)) && !collective.has(role(p.name))) parts.push(p);
  return parts.map(validateCreationComponent);
}

