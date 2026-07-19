/**
 * Force mesh + armature into T-pose via Blender (best-effort).
 * Optional AI hint string is applied as a comment / future constraint log.
 */
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { detectBlender } from "./toolchain";
import { convertFile } from "./convert";
import { verifyFile } from "./sizeVerify";

export interface TPoseResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  outputPath: string | null;
  aiNotes?: string;
}

const TPOSE_SCRIPT = `
import bpy, sys, math
from mathutils import Euler

argv = sys.argv[sys.argv.index('--') + 1:]
in_path, out_path = argv[0], argv[1]
hint = argv[2] if len(argv) > 2 else ''

bpy.ops.wm.read_factory_settings(use_empty=True)
ext = in_path.lower().rsplit('.', 1)[-1]
if ext == 'fbx':
    bpy.ops.import_scene.fbx(filepath=in_path)
elif ext in ('glb', 'gltf'):
    bpy.ops.import_scene.gltf(filepath=in_path)
elif ext == 'obj':
    bpy.ops.wm.obj_import(filepath=in_path)
else:
    raise SystemExit('unsupported ' + ext)

# Clear pose, set rest as T-pose approximation for common humanoids
for obj in bpy.context.scene.objects:
    if obj.type != 'ARMATURE':
        continue
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='POSE')
    for pb in obj.pose.bones:
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = Euler((0, 0, 0))
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
        # Arms: common Mixamo rest already T-like; force slight T if A-pose
        n = pb.name.lower()
        if 'leftarm' in n.replace(':', '') or n.endswith('upperarm.l') or 'l_upperarm' in n:
            pb.rotation_euler = Euler((0, 0, math.radians(90)))
        if 'rightarm' in n.replace(':', '') or n.endswith('upperarm.r') or 'r_upperarm' in n:
            pb.rotation_euler = Euler((0, 0, math.radians(-90)))
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    # Apply as rest pose
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')

# Store AI hint in custom prop for audit
bpy.context.scene['grudge_tpose_hint'] = hint[:500] if hint else ''

bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format='GLB',
    export_apply=True,
    export_animations=True,
    export_skins=True,
    export_morph=True,
)
`.trim();

function runCmd(bin: string, args: string[]): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.on("error", (err) => resolve({ code: -1, stdout, stderr: err.message }));
  });
}

export async function prepareTPose(
  absPath: string,
  opts: { aiHint?: string; outDir?: string } = {},
): Promise<TPoseResult> {
  const result: TPoseResult = {
    ok: false,
    errors: [],
    warnings: [],
    outputPath: null,
    aiNotes: opts.aiHint,
  };

  const blender = await detectBlender();
  if (!blender.available || !blender.path) {
    result.errors.push(`Blender required for T-pose prep (${blender.reason ?? "not found"}). Set path in Accounts.`);
    return result;
  }

  const outDir = opts.outDir ?? join(tmpdir(), `grudge-tpose-${randomUUID()}`);
  await fs.mkdir(outDir, { recursive: true });
  const scriptPath = join(outDir, "tpose.py");
  await fs.writeFile(scriptPath, TPOSE_SCRIPT, "utf8");

  let input = absPath;
  const ext = extname(absPath).toLowerCase();
  // Blender glTF import is reliable; convert FBX first if needed via our pipeline as fallback path
  if (ext === ".fbx") {
    // Blender can import FBX natively — keep as-is
  }

  const outPath = join(outDir, `${basename(absPath, ext)}_tpose.glb`);
  const r = await runCmd(blender.path, [
    "-b", "-P", scriptPath, "--", input, outPath, opts.aiHint ?? "",
  ]);

  if (r.code !== 0) {
    result.errors.push(`Blender T-pose failed (exit ${r.code}): ${r.stderr.slice(0, 400)}`);
    // Fallback: convert only so user still has GLB
    try {
      const sizeRes = await verifyFile(absPath);
      const conv = await convertFile(absPath, sizeRes, { outDir });
      if (conv.converted) {
        result.outputPath = conv.outputPath;
        result.warnings.push("T-pose apply failed; returned converted GLB without forced T-pose.");
        result.ok = true;
      }
    } catch { /* ignore */ }
    return result;
  }

  try {
    await fs.stat(outPath);
    result.outputPath = outPath;
    result.ok = true;
  } catch {
    result.errors.push("T-pose output GLB missing after Blender run.");
  }
  return result;
}
