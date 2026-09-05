import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { NodeIO, type Accessor, type Animation, type Document, type Node as GltfNode } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MIXAMO_25_CORE, autoMapBonesFromNames, matchSkillSlot, type Mixamo25Bone } from "../../shared/mixamo25";
import { hasAffirmativePromptMatch } from "../../shared/promptedMotionIntent";
import { compilePromptedAnimation, type PromptedAnimationPlan } from "./promptedAnimation";
import { DETERMINISTIC_RIG_PROFILE, inspectDeterministicRig } from "./deterministicRig";

export interface DeterministicSkeletalAnimationResult {
  route: "deterministic-skeletal-motion" | "local-animation-library";
  outputPath: string;
  clipId: string;
  clipName: string;
  duration: number;
  channels: number;
  boneRotationChannels: number;
  rootTranslationChannels: number;
  pathDisplacementMeters: number;
  plan: PromptedAnimationPlan;
  operators: string[];
  library?: {
    packDir: string;
    manifestPath: string;
    manifestSha256: string;
    restGlbPath: string;
    restGlbSha256: string;
    sourceClipName: string;
  };
}

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

function io(): NodeIO {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function quaternionFromEuler(x: number, y: number, z: number): Quat {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

function multiplyQuaternion(left: ArrayLike<number>, right: ArrayLike<number>): Quat {
  const ax = Number(left[0]), ay = Number(left[1]), az = Number(left[2]), aw = Number(left[3]);
  const bx = Number(right[0]), by = Number(right[1]), bz = Number(right[2]), bw = Number(right[3]);
  const result: Quat = [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
  const length = Math.hypot(...result);
  if (!Number.isFinite(length) || length < 1e-8) throw new Error("Deterministic skeletal motion produced a degenerate quaternion.");
  return result.map((value) => value / length) as Quat;
}

function canonicalNodes(document: Document): Map<Mixamo25Bone, GltfNode> {
  const nodes = document.getRoot().listNodes();
  const mapped = autoMapBonesFromNames(nodes.map((node) => node.getName()).filter(Boolean)).reverseMap;
  const result = new Map<Mixamo25Bone, GltfNode>();
  for (const bone of MIXAMO_25_CORE) {
    const sourceName = mapped[bone];
    const node = sourceName ? nodes.find((candidate) => candidate.getName() === sourceName) : undefined;
    if (node) result.set(bone, node);
  }
  if (result.size !== MIXAMO_25_CORE.length) throw new Error("The prepared target does not contain the complete canonical Mixamo-25 core.");
  return result;
}

function motionEuler(bone: Mixamo25Bone, progress: number, plan: PromptedAnimationPlan, seed: number): Vec3 {
  const phase = progress * Math.PI * 2;
  const alternate = Math.sin(phase * (hasAffirmativePromptMatch(plan.instruction, /\b(?:run|sprint)\b/i) ? 2 : 1));
  const pulse = Math.sin(progress * Math.PI);
  const jitter = ((seed % 17) - 8) * 0.001;
  const gait = plan.intent.groundedGait;
  const wave = plan.skeletalActions.includes("wave");
  const flap = !plan.intent.flappingSuppressed && (plan.intent.flapping || (plan.intent.flying && !plan.intent.gliding));
  const crouch = plan.intent.crouching || hasAffirmativePromptMatch(plan.instruction, /\b(?:squat|squatting)\b/i);
  const attack = plan.skeletalActions.includes("attack");
  const dance = plan.skeletalActions.includes("dance");
  let x = 0, y = 0, z = 0;
  if (gait) {
    if (bone === "LeftUpLeg") x += alternate * 0.55;
    if (bone === "RightUpLeg") x -= alternate * 0.55;
    if (bone === "LeftLeg") x += Math.max(0, -alternate) * 0.65;
    if (bone === "RightLeg") x += Math.max(0, alternate) * 0.65;
    if (bone === "LeftArm") x -= alternate * 0.38;
    if (bone === "RightArm") x += alternate * 0.38;
    if (bone === "Spine" || bone === "Spine1") y += alternate * 0.035;
  }
  if (wave) {
    if (bone === "RightArm") z -= 0.9 * pulse;
    if (bone === "RightForeArm") z -= 0.55 + Math.sin(phase * 2) * 0.25;
    if (bone === "RightHand") y += Math.sin(phase * 3) * 0.35;
  }
  if (flap) {
    if (bone === "LeftArm" || bone === "LeftShoulder") z += Math.sin(phase) * 0.65;
    if (bone === "RightArm" || bone === "RightShoulder") z -= Math.sin(phase) * 0.65;
  }
  if (crouch) {
    if (bone === "LeftUpLeg" || bone === "RightUpLeg") x -= pulse * 0.48;
    if (bone === "LeftLeg" || bone === "RightLeg") x += pulse * 0.82;
    if (bone === "Spine" || bone === "Spine1") x += pulse * 0.18;
  }
  if (attack) {
    if (bone === "Spine1" || bone === "Spine2") y += Math.sin(phase) * 0.28;
    if (bone === "RightArm") x -= pulse * 0.9;
    if (bone === "RightForeArm") x -= pulse * 0.65;
    if (bone === "LeftArm") x += pulse * 0.2;
  }
  if (dance) {
    if (["Spine", "Spine1", "Spine2"].includes(bone)) y += Math.sin(phase) * 0.22;
    if (bone === "LeftArm") z += Math.sin(phase * 1.5) * 0.45;
    if (bone === "RightArm") z -= Math.cos(phase * 1.5) * 0.45;
    if (bone === "LeftUpLeg") x += Math.sin(phase) * 0.28;
    if (bone === "RightUpLeg") x += Math.cos(phase) * 0.28;
  }
  if (!gait && !wave && !flap && !crouch && !attack && !dance) {
    if (bone === "Spine" || bone === "Spine1") x += Math.sin(phase) * 0.025;
    if (bone === "LeftArm") z += Math.sin(phase) * 0.04;
    if (bone === "RightArm") z -= Math.sin(phase) * 0.04;
  }
  return [x + jitter * Math.sin(phase), y, z];
}

function rootOffset(plan: PromptedAnimationPlan, progress: number): Vec3 {
  const directionLength = Math.hypot(...plan.pathDirection) || 1;
  const direction: Vec3 = [plan.pathDirection[0] / directionLength, plan.pathDirection[1] / directionLength, plan.pathDirection[2] / directionLength];
  let amount = 0;
  if (plan.placement === "directional-travel") {
    if (plan.rootPath === "out-and-back" || plan.intent.returnToOrigin) amount = Math.sin(progress * Math.PI) * plan.travelMeters;
    else if (plan.rootPath === "orbit") amount = Math.sin(progress * Math.PI * 2) * plan.radiusMeters;
    else if (plan.rootPath === "figure-eight") amount = Math.sin(progress * Math.PI * 2) * plan.travelMeters * 0.5;
    else amount = progress * plan.travelMeters;
  }
  const lift = plan.rootPath === "vertical-hop" || plan.rootPath === "hop-arc" ? Math.sin(progress * Math.PI) * plan.hopHeightMeters : 0;
  return [direction[0] * amount, lift + direction[1] * amount, direction[2] * amount];
}

function maximumDisplacement(points: Vec3[]): number {
  const first = points[0];
  return Math.max(...points.map((point) => Math.hypot(point[0] - first[0], point[1] - first[1], point[2] - first[2])));
}

async function writeImmutable(document: Document, outputPath: string): Promise<void> {
  await stat(outputPath).then(() => { throw new Error("Animation output already exists; revisions are immutable."); }, () => undefined);
  await mkdir(dirname(outputPath), { recursive: true });
  const temporary = resolve(dirname(outputPath), `.${randomUUID()}.skeletal-animation.glb`);
  try {
    await writeFile(temporary, await io().writeBinary(document), { flag: "wx" });
    await rename(temporary, outputPath);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function animationPlan(instruction: string, seed: number, options: { mode?: "append" | "replace"; duration?: number }): PromptedAnimationPlan {
  const skeletalActions: Array<"wave" | "attack" | "dance"> = [];
  if (hasAffirmativePromptMatch(instruction, /\b(?:wave|greet|salute)\b/i)) skeletalActions.push("wave");
  if (hasAffirmativePromptMatch(instruction, /\b(?:attack|strike|slash|swing|punch|cast|shoot|aim)\b/i)) skeletalActions.push("attack");
  if (hasAffirmativePromptMatch(instruction, /\b(?:dance|twirl|groove)\b/i)) skeletalActions.push("dance");
  return compilePromptedAnimation(instruction, {
    mode: options.mode,
    skeletalActions,
    ...(options.duration !== undefined ? { durationSeconds: options.duration } : {}),
  }, seed);
}

export async function authorDeterministicSkeletalAnimation(options: {
  sourcePath: string;
  outputPath: string;
  instruction: string;
  seed: number;
  mode?: "append" | "replace";
  duration?: number;
}): Promise<DeterministicSkeletalAnimationResult> {
  if (!isAbsolute(options.sourcePath) || !isAbsolute(options.outputPath) || extname(options.sourcePath).toLowerCase() !== ".glb" || extname(options.outputPath).toLowerCase() !== ".glb") throw new Error("Skeletal animation paths must be absolute GLB paths.");
  const inspection = await inspectDeterministicRig(options.sourcePath);
  if (!inspection.compatible) throw new Error("Deterministic skeletal animation requires a validated canonical skin.");
  const document = await io().read(options.sourcePath);
  const root = document.getRoot();
  const nodes = canonicalNodes(document);
  const plan = animationPlan(options.instruction, options.seed, options);
  if (plan.mode === "replace") root.listAnimations().forEach((animation) => animation.dispose());
  const buffer = root.listBuffers()[0] ?? document.createBuffer("Deterministic skeletal animation buffer");
  const animation = document.createAnimation(plan.clipName).setExtras({
    grudgePromptAnimation: { version: 3, clipId: plan.clipId, provider: "grudge-motion-graph-1", route: "deterministic-skeletal-motion", rig: DETERMINISTIC_RIG_PROFILE, plan },
  });
  const times = Float32Array.from({ length: plan.keyframes }, (_, index) => index * plan.durationSeconds / (plan.keyframes - 1));
  const input = document.createAccessor("Deterministic skeletal frame times").setType("SCALAR").setArray(times).setBuffer(buffer);
  let boneRotationChannels = 0;
  for (const bone of MIXAMO_25_CORE) {
    const node = nodes.get(bone)!;
    const base = node.getRotation();
    const rotations = new Float32Array(plan.keyframes * 4);
    for (let frame = 0; frame < plan.keyframes; frame += 1) {
      const progress = frame / (plan.keyframes - 1);
      rotations.set(multiplyQuaternion(base, quaternionFromEuler(...motionEuler(bone, progress, plan, options.seed))), frame * 4);
    }
    const sampler = document.createAnimationSampler(`${bone} deterministic rotations`).setInput(input)
      .setOutput(document.createAccessor(`${bone} deterministic quaternions`).setType("VEC4").setArray(rotations).setBuffer(buffer)).setInterpolation("LINEAR");
    animation.addSampler(sampler).addChannel(document.createAnimationChannel(`${bone} deterministic rotation`).setSampler(sampler).setTargetNode(node).setTargetPath("rotation"));
    boneRotationChannels += 1;
  }
  const hips = nodes.get("Hips")!;
  const rest = hips.getTranslation();
  const rootPoints: Vec3[] = Array.from({ length: plan.keyframes }, (_, frame) => {
    const offset = rootOffset(plan, frame / (plan.keyframes - 1));
    return [rest[0] + offset[0], rest[1] + offset[1], rest[2] + offset[2]];
  });
  const rootSampler = document.createAnimationSampler("Deterministic Hips trajectory").setInput(input)
    .setOutput(document.createAccessor("Deterministic Hips translations").setType("VEC3").setArray(new Float32Array(rootPoints.flat())).setBuffer(buffer)).setInterpolation("LINEAR");
  animation.addSampler(rootSampler).addChannel(document.createAnimationChannel("Deterministic Hips trajectory").setSampler(rootSampler).setTargetNode(hips).setTargetPath("translation"));
  await writeImmutable(document, options.outputPath);
  return {
    route: "deterministic-skeletal-motion", outputPath: options.outputPath, clipId: plan.clipId, clipName: plan.clipName,
    duration: plan.durationSeconds, channels: animation.listChannels().length, boneRotationChannels, rootTranslationChannels: 1,
    pathDisplacementMeters: maximumDisplacement(rootPoints), plan,
    operators: ["deterministic-cpu-bone-rotation", "canonical-mixamo25-retarget-contract", ...plan.operators],
  };
}

function cloneTypedArray(values: ArrayLike<number>): any {
  const Constructor = (values as any).constructor as new (source: ArrayLike<number>) => any;
  return new Constructor(values);
}

function cloneAccessor(document: Document, buffer: any, source: Accessor, name: string, duration: number): Accessor {
  const values = source.getArray();
  if (!values) throw new Error(`Animation accessor '${source.getName()}' has no values.`);
  const copied = cloneTypedArray(values);
  if (source.getType() === "SCALAR" && source.getElementSize() === 1 && copied.length >= 2) {
    const first = Number(copied[0]), last = Number(copied[copied.length - 1]);
    const span = last - first;
    for (let index = 0; index < copied.length; index += 1) copied[index] = span > 0 ? (Number(copied[index]) - first) / span * duration : index / Math.max(1, copied.length - 1) * duration;
  }
  return document.createAccessor(name).setType(source.getType()).setArray(copied).setBuffer(buffer);
}

function chooseLibraryClip(animations: Animation[], instruction: string, requested?: string): Animation {
  if (requested) {
    const exact = animations.find((animation) => animation.getName() === requested);
    if (!exact) throw new Error(`The selected local library does not contain clip '${requested}'.`);
    return exact;
  }
  const requestedSlot = matchSkillSlot(instruction)?.id;
  const matched = requestedSlot ? animations.find((animation) => matchSkillSlot(animation.getName())?.id === requestedSlot) : undefined;
  const selected = matched ?? animations[0];
  if (!selected) throw new Error("The selected local animation library contains no clips.");
  return selected;
}

export async function applyLocalAnimationLibrary(options: {
  sourcePath: string;
  outputPath: string;
  instruction: string;
  seed: number;
  packDir: string;
  clipName?: string;
  mode?: "append" | "replace";
  duration?: number;
}): Promise<DeterministicSkeletalAnimationResult> {
  const manifestPath = join(options.packDir, "anim-library-manifest.json");
  const restGlbPath = join(options.packDir, "rest.glb");
  const [manifestBytes, restBytes] = await Promise.all([readFile(manifestPath), readFile(restGlbPath)]);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as { version?: number; skeleton?: string; restGlb?: string };
  if (manifest.version !== 2 || manifest.skeleton !== "mixamo-25" || manifest.restGlb !== "rest.glb") throw new Error("Local animation library manifest is not a compatible Mixamo-25 v2 pack.");
  const targetInspection = await inspectDeterministicRig(options.sourcePath);
  if (!targetInspection.compatible) throw new Error("Local animation library retargeting requires a validated canonical target skin.");
  const [target, source] = await Promise.all([io().read(options.sourcePath), io().readBinary(restBytes)]);
  const targetNodes = canonicalNodes(target);
  const sourceNodes = source.getRoot().listNodes();
  const sourceMap = autoMapBonesFromNames(sourceNodes.map((node) => node.getName()).filter(Boolean)).boneMap;
  const selected = chooseLibraryClip(source.getRoot().listAnimations(), options.instruction, options.clipName);
  const plan = animationPlan(options.instruction, options.seed, options);
  if (plan.mode === "replace") target.getRoot().listAnimations().forEach((animation) => animation.dispose());
  const buffer = target.getRoot().listBuffers()[0] ?? target.createBuffer("Local library animation buffer");
  const clipId = createHash("sha256").update(`${sha256(restBytes)}\0${selected.getName()}\0${plan.instructionSha256}\0${options.seed}`).digest("hex").slice(0, 24);
  const animation = target.createAnimation(`${selected.getName()} · local library`).setExtras({
    grudgePromptAnimation: { version: 3, clipId, provider: "grudge-motion-graph-1", route: "local-animation-library", rig: DETERMINISTIC_RIG_PROFILE, sourceClip: selected.getName(), plan },
  });
  const samplers = new Map<any, any>();
  const copiedRotationBones = new Set<Mixamo25Bone>();
  for (const channel of selected.listChannels()) {
    const sourceNode = channel.getTargetNode();
    const canonical = sourceNode ? sourceMap[sourceNode.getName()] : undefined;
    const targetNode = canonical ? targetNodes.get(canonical) : undefined;
    const sourceSampler = channel.getSampler();
    const input = sourceSampler?.getInput(), output = sourceSampler?.getOutput();
    const path = channel.getTargetPath();
    if (!canonical || !targetNode || !sourceSampler || !input || !output
      || (path !== "rotation" && path !== "translation" && path !== "scale")) continue;
    // Root translation is synthesized below so action words cannot accidentally
    // inherit world travel from a library clip.
    if (canonical === "Hips" && path === "translation") continue;
    let sampler = samplers.get(sourceSampler);
    if (!sampler) {
      sampler = target.createAnimationSampler(`${selected.getName()} copied sampler`)
        .setInput(cloneAccessor(target, buffer, input, `${selected.getName()} times`, plan.durationSeconds))
        .setOutput(cloneAccessor(target, buffer, output, `${selected.getName()} values`, plan.durationSeconds))
        .setInterpolation(sourceSampler.getInterpolation());
      animation.addSampler(sampler);
      samplers.set(sourceSampler, sampler);
    }
    animation.addChannel(target.createAnimationChannel(`${selected.getName()} ${canonical} ${path}`).setSampler(sampler).setTargetNode(targetNode).setTargetPath(path));
    if (path === "rotation") copiedRotationBones.add(canonical);
  }
  const times = target.createAccessor("Local library normalized times").setType("SCALAR").setArray(new Float32Array([0, plan.durationSeconds])).setBuffer(buffer);
  for (const bone of MIXAMO_25_CORE) if (!copiedRotationBones.has(bone)) {
    const node = targetNodes.get(bone)!;
    const base = node.getRotation();
    const output = target.createAccessor(`${bone} retained local rest rotation`).setType("VEC4").setArray(new Float32Array([...base, ...base])).setBuffer(buffer);
    const sampler = target.createAnimationSampler(`${bone} retained rest sampler`).setInput(times).setOutput(output).setInterpolation("LINEAR");
    animation.addSampler(sampler).addChannel(target.createAnimationChannel(`${bone} retained rest channel`).setSampler(sampler).setTargetNode(node).setTargetPath("rotation"));
  }
  const hips = targetNodes.get("Hips")!;
  const rest = hips.getTranslation();
  const rootTimes = target.createAccessor("Local library root-path times").setType("SCALAR")
    .setArray(Float32Array.from({ length: plan.keyframes }, (_, index) => index * plan.durationSeconds / (plan.keyframes - 1))).setBuffer(buffer);
  const rootPoints: Vec3[] = Array.from({ length: plan.keyframes }, (_, frame) => {
    const offset = rootOffset(plan, frame / (plan.keyframes - 1));
    return [rest[0] + offset[0], rest[1] + offset[1], rest[2] + offset[2]];
  });
  const rootSampler = target.createAnimationSampler("Local library safe root path").setInput(rootTimes)
    .setOutput(target.createAccessor("Local library safe root translations").setType("VEC3").setArray(new Float32Array(rootPoints.flat())).setBuffer(buffer)).setInterpolation("LINEAR");
  animation.addSampler(rootSampler).addChannel(target.createAnimationChannel("Local library safe root trajectory").setSampler(rootSampler).setTargetNode(hips).setTargetPath("translation"));
  if (!animation.listChannels().length) throw new Error("No compatible Mixamo-25 channels could be retargeted from the selected local library clip.");
  await writeImmutable(target, options.outputPath);
  return {
    route: "local-animation-library", outputPath: options.outputPath, clipId, clipName: animation.getName(), duration: plan.durationSeconds,
    channels: animation.listChannels().length, boneRotationChannels: MIXAMO_25_CORE.length, rootTranslationChannels: 1,
    pathDisplacementMeters: maximumDisplacement(rootPoints), plan,
    operators: ["local-animation-library-retarget", "canonical-mixamo25-name-map", "safe-root-path-contract"],
    library: {
      packDir: options.packDir,
      manifestPath,
      manifestSha256: sha256(manifestBytes),
      restGlbPath,
      restGlbSha256: sha256(restBytes),
      sourceClipName: selected.getName(),
    },
  };
}
