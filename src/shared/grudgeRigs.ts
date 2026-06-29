/** Grudge skeleton fingerprints — shared by upload pipeline and Forge 3D. */

export interface SkeletonFingerprint {
  name: string;
  jointCounts: number[];
  requiredBones: string[];
  label: string;
}

export const GRUDGE_SKELETON_FINGERPRINTS: SkeletonFingerprint[] = [
  { name: "mixamo-65", label: "Mixamo 65-chain", jointCounts: [65, 64, 66], requiredBones: ["mixamorig:Hips", "mixamorig:Spine", "mixamorig:Head"] },
  { name: "mixamo-49-3chain", label: "Mixamo 49 (3-finger)", jointCounts: [49, 48, 50], requiredBones: ["mixamorig:Hips", "mixamorig:LeftHandThumb1"] },
  { name: "mixamo-41-2chain", label: "Mixamo 41 (2-finger)", jointCounts: [41, 40, 42], requiredBones: ["mixamorig:Hips", "mixamorig:LeftHandIndex1"] },
  { name: "mixamo-25-nofingers", label: "Mixamo 25 (no fingers)", jointCounts: [25, 24, 26], requiredBones: ["mixamorig:Hips", "mixamorig:LeftHand"] },
  { name: "grudge-worge-bear", label: "Grudge Worge Bear", jointCounts: [38, 37, 39], requiredBones: ["worge:Spine", "worge:HeadBear"] },
  { name: "grudge-worge-raptor", label: "Grudge Worge Raptor", jointCounts: [34, 33, 35], requiredBones: ["worge:Spine", "worge:Tail"] },
  { name: "bip001", label: "Bip001 / Grudge6", jointCounts: [], requiredBones: ["Bip001 Pelvis", "Bip001 Spine"] },
  { name: "cc4", label: "Character Creator 4", jointCounts: [], requiredBones: ["CC_Base_Hip", "CC_Base_Spine01"] },
];

export function matchSkeletonFingerprint(boneNames: string[]): SkeletonFingerprint | null {
  const set = new Set(boneNames);
  const count = boneNames.length;
  for (const fp of GRUDGE_SKELETON_FINGERPRINTS) {
    if (fp.jointCounts.length && !fp.jointCounts.includes(count)) continue;
    if (fp.requiredBones.every((b) => set.has(b) || set.has(b.replace(/:/g, "")))) return fp;
  }
  return null;
}