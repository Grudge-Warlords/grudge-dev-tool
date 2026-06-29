import { extname } from "node:path";
import { matchSkeletonFingerprint } from "../../shared/grudgeRigs";

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
      const boneNames = joints.map((j: { getName: () => string }) => j.getName());

      const fp = matchSkeletonFingerprint(boneNames);
      const matched = fp?.name ?? null;
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
