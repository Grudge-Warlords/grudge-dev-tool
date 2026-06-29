import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { extname, basename, join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { detectBlender, detectFfmpeg } from "./toolchain";
import type { SizeVerifyResult } from "./sizeVerify";

export interface ConvertResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** The path to feed downstream (may be the original or a converted file). */
  outputPath: string;
  /** A list of additional companion files (e.g., .webp next to a .png). */
  companions: { path: string; role: "webp-companion" | "thumb" | "raw"; sizeBytes: number }[];
  converted: boolean;
  conversionKind: "none" | "blender-glb" | "sharp-png" | "sharp-webp" | "ffmpeg-ogg";
}

function runCmd(bin: string, args: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, windowsHide: true });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.on("error", (err) => resolve({ code: -1, stdout, stderr: err.message }));
  });
}

const BLENDER_GLB_SCRIPT = `
import bpy, sys, os
argv = sys.argv[sys.argv.index('--') + 1:]
in_path, out_path = argv[0], argv[1]
ext = os.path.splitext(in_path)[1].lower()

bpy.ops.wm.read_factory_settings(use_empty=True)
if ext == '.blend':
    bpy.ops.wm.open_mainfile(filepath=in_path)
elif ext == '.fbx':
    bpy.ops.import_scene.fbx(filepath=in_path)
elif ext == '.obj':
    bpy.ops.wm.obj_import(filepath=in_path)
else:
    raise SystemExit('Unsupported input ext: ' + ext)

bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format='GLB',
    export_apply=True,
    export_animations=True,
    export_skins=True,
    export_morph=True,
)
`.trim();

let blenderScriptPath: string | null = null;
async function ensureBlenderScript(): Promise<string> {
  if (blenderScriptPath) return blenderScriptPath;
  const p = join(tmpdir(), `grudge-dev-tool-blender-${randomUUID()}.py`);
  await fs.writeFile(p, BLENDER_GLB_SCRIPT, "utf8");
  blenderScriptPath = p;
  return p;
}

export interface ConvertOptions {
  /** Output directory for converted files. Defaults to a temp dir. */
  outDir?: string;
  /** Skip the convert step entirely. */
  skip?: boolean;
}

export async function convertFile(
  absPath: string,
  verify: SizeVerifyResult,
  opts: ConvertOptions = {},
): Promise<ConvertResult> {
  const result: ConvertResult = {
    ok: true,
    errors: [],
    warnings: [],
    outputPath: absPath,
    companions: [],
    converted: false,
    conversionKind: "none",
  };

  if (opts.skip) return result;

  const ext = extname(absPath).toLowerCase();
  const outDir = opts.outDir ?? join(tmpdir(), "grudge-dev-tool-convert");
  await fs.mkdir(outDir, { recursive: true });

  // Models: BLEND / FBX / OBJ → GLB via Blender headless
  if ([".blend", ".fbx", ".obj"].includes(ext)) {
    const blender = detectBlender();
    if (!blender.available) {
      result.warnings.push(`Blender unavailable — uploading raw ${ext} (${blender.reason}).`);
      return result;
    }
    const outPath = join(outDir, `${basename(absPath, ext)}.glb`);
    const script = await ensureBlenderScript();
    const r = await runCmd(blender.path!, ["-b", "--python", script, "--", absPath, outPath]);
    if (r.code !== 0 || !(await fs.stat(outPath).catch(() => null))) {
      result.errors.push(`Blender conversion failed (exit ${r.code}). stderr=${r.stderr.slice(0, 400)}`);
      result.ok = false;
      return result;
    }
    result.outputPath = outPath;
    result.converted = true;
    result.conversionKind = "blender-glb";
    return result;
  }

  // Textures: TGA / BMP → PNG; PNG/JPG/JPEG → +WebP companion
  if ([".tga", ".bmp"].includes(ext)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sharp = require("sharp");
      const outPath = join(outDir, `${basename(absPath, ext)}.png`);
      await sharp(absPath).png().toFile(outPath);
      result.outputPath = outPath;
      result.converted = true;
      result.conversionKind = "sharp-png";
      return result;
    } catch (err: any) {
      result.errors.push(`PNG conversion failed: ${err.message}`);
      result.ok = false;
      return result;
    }
  }

  if ([".png", ".jpg", ".jpeg"].includes(ext)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sharp = require("sharp");
      const webpPath = join(outDir, `${basename(absPath, ext)}.webp`);
      await sharp(absPath).webp({ quality: 86, effort: 4 }).toFile(webpPath);
      const stat = await fs.stat(webpPath);
      result.companions.push({ path: webpPath, role: "webp-companion", sizeBytes: stat.size });
      result.conversionKind = "sharp-webp";
      // outputPath stays as the original — webp is a companion, not a replacement.
      return result;
    } catch (err: any) {
      result.warnings.push(`WebP companion skipped: ${err.message}`);
      return result;
    }
  }

  // Audio: WAV → OGG via ffmpeg (only if ffmpeg available)
  if (ext === ".wav" && verify.probed.sizeBytes > 1024 * 1024) {
    const ffmpeg = detectFfmpeg();
    if (!ffmpeg.available) {
      result.warnings.push(`ffmpeg unavailable — uploading raw .wav.`);
      return result;
    }
    const outPath = join(outDir, `${basename(absPath, ".wav")}.ogg`);
    const r = await runCmd(ffmpeg.path!, [
      "-y", "-i", absPath, "-c:a", "libvorbis", "-q:a", "5", outPath,
    ]);
    if (r.code !== 0) {
      result.warnings.push(`ffmpeg conversion failed (exit ${r.code}); falling back to raw.`);
      return result;
    }
    result.outputPath = outPath;
    result.converted = true;
    result.conversionKind = "ffmpeg-ogg";
    return result;
  }

  return result;
}

export async function makeThumbnail(absPath: string, outDir: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sharp = require("sharp");
    await fs.mkdir(outDir, { recursive: true });
    const out = join(outDir, `${basename(absPath, extname(absPath))}.thumb.jpg`);
    await sharp(absPath)
      .resize(256, 256, { fit: "inside" })
      .jpeg({ quality: 78 })
      .toFile(out);
    return out;
  } catch {
    return null;
  }
}
