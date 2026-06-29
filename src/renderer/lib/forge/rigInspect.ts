import * as THREE from "three";
import { matchSkeletonFingerprint } from "../../../shared/grudgeRigs";
import {
  detectSkeletonType,
  detectBodyParts,
  findBoneByAlias,
  RIGHT_HAND_ALIASES,
  LEFT_HAND_ALIASES,
  HEAD_ALIASES,
  HIPS_ALIASES,
  BACK_SLOT_ALIASES,
  resolveAttachmentBone,
  type SkeletonType,
  type BodyPartBones,
} from "./boneAliases";

export interface RigInspectResult {
  boneNames: string[];
  boneCount: number;
  skeletonType: SkeletonType;
  fingerprint: string | null;
  fingerprintLabel: string | null;
  bodyParts: BodyPartBones;
  attachments: Record<string, string | null>;
  hasSkinnedMesh: boolean;
  morphTargetCount: number;
}

export function inspectSceneRig(root: THREE.Object3D): RigInspectResult {
  const boneNames: string[] = [];
  let hasSkinnedMesh = false;
  let morphTargetCount = 0;

  root.traverse((n) => {
    if ((n as THREE.Bone).isBone || n.type === "Bone") boneNames.push(n.name);
    const mesh = n as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) {
      hasSkinnedMesh = true;
      if (mesh.morphTargetDictionary) {
        morphTargetCount += Object.keys(mesh.morphTargetDictionary).length;
      }
    }
  });

  const fp = matchSkeletonFingerprint(boneNames);

  return {
    boneNames,
    boneCount: boneNames.length,
    skeletonType: detectSkeletonType(boneNames),
    fingerprint: fp?.name ?? null,
    fingerprintLabel: fp?.label ?? null,
    bodyParts: detectBodyParts(boneNames),
    attachments: {
      rightHand: findBoneByAlias(root, RIGHT_HAND_ALIASES)?.name ?? null,
      leftHand: findBoneByAlias(root, LEFT_HAND_ALIASES)?.name ?? null,
      head: findBoneByAlias(root, HEAD_ALIASES)?.name ?? null,
      hips: findBoneByAlias(root, HIPS_ALIASES)?.name ?? null,
      backSlot: findBoneByAlias(root, BACK_SLOT_ALIASES)?.name ?? resolveAttachmentBone(root, "backWeapon")?.name ?? null,
    },
    hasSkinnedMesh,
    morphTargetCount,
  };
}

export function listBoneNames(root: THREE.Object3D, max = 80): string[] {
  const names: string[] = [];
  root.traverse((n) => {
    if ((n as THREE.Bone).isBone || n.type === "Bone") names.push(n.name);
  });
  return names.slice(0, max);
}