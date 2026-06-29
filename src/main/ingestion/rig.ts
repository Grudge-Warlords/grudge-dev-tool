import { extname } from "node:path";

export interface RigResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  rig: "none" | "unknown" | string; // skeleton name when matched
  jointCount: number;
  hasAnimations: boolean;
  matchedSkeleton?: string;
}

const CHARACTER_CATEGORIES = new Set([
  "characters", "weapons", "mounts", "companions", "npc", "boss",
]);

/**
 * Known Grudge skeleton fingerprints. Match by joint count + a few canonical
 * bone names. Extend as more rigs come on-line.
 */
const SKELETON_FINGERPRINTS: Array<{
  name: string;
  jointCounts: number[];
  requiredBones: string[];
}> = [
  { name: "mixamo-65", jointCounts: [65, 64, 66], requiredBones: ["mixamorig:Hips", "mixamorig:Spine", "mixamorig:Head"] },
  { name: "mixamo-49-3chain", jointCounts: [49, 48, 50], requiredBones: ["mixamorig:Hips", "mixamorig:LeftHandThumb1"] },
  { name: "mixamo-41-2chain", jointCounts: [41, 40, 42], requiredBones: ["mixamorig:Hips", "mixamorig:LeftHandIndex1"] },
  { name: "mixamo-25-nofingers", jointCounts: [25, 24, 26], requiredBones: ["mixamorig:Hips", "mixamorig:LeftHand"] },
  { name: "grudge-worge-bear", jointCounts: [38, 37, 39], requiredBones: ["worge:Spine", "worge:HeadBear"] },
  { name: "grudge-worge-raptor", jointCounts: [34, 33, 35], requiredBones: ["worge:Spine", "worge:Tail"] },
];

export interface RigOptions {
  category?: string;
  skip?: boolean;
}

export async function inspectRig(absPath: string, opts: RigOptions = {}): Promise<RigResult> {
  const result: RigResult = {
    ok: true,
    errors: [],
    warnings: [],
    rig: "none",
    jointCount: 0,
    hasAnimations: false,
  };

  if (opts.skip) {
    result.rig = "unknown";
    return result;
  }

  const ext = extname(absPath).toLowerCase();
  if (ext !== ".glb" && ext !== ".gltf") {
    // We only inspect rigs after convert produces a glTF asset.
    result.warnings.push(`Skipping rig probe for non-glTF input (${ext}).`);
    return result;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NodeIO } = require("@gltf-transform/core");
    const io = new NodeIO();
    const doc = await io.read(absPath);
    const root = doc.getRoot();
    const skins = root.listSkins();
    const anims = root.listAnimations();
    result.hasAnimations = anims.length > 0;

    if (skins.length === 0) {
      result.rig = "none";
    } else {
      const skin = skins[0];
      const joints = skin.listJoints();
      result.jointCount = joints.length;
      const boneNames = new Set(joints.map((j: any) => j.getName()));

      let matched: string | null = null;
      for (const fp of SKELETON_FINGERPRINTS) {
        const countOk = fp.jointCounts.includes(joints.length);
        const requiredOk = fp.requiredBones.every((b) => boneNames.has(b));
        if (countOk && requiredOk) {
          matched = fp.name;
          break;
        }
      }
      if (matched) {
        result.rig = matched;
        result.matchedSkeleton = matched;
      } else {
        result.rig = "unknown";
        result.warnings.push(
          `Skeleton with ${joints.length} joints did not match any known Grudge fingerprint. Tagged as 'unknown'.`,
        );
      }
    }
  } catch (err: any) {
    result.warnings.push(`Rig probe skipped (${err.message ?? "gltf-transform unavailable"}).`);
    result.rig = "unknown";
  }

  // Category-aware enforcement: characters/weapons/mounts/companions MUST have a rig.
  const cat = (opts.category || "").toLowerCase();
  if (CHARACTER_CATEGORIES.has(cat) && result.rig === "none") {
    result.errors.push(
      `Category '${cat}' requires a skeleton; converted asset has none.`,
    );
    result.ok = false;
  }

  return result;
}
