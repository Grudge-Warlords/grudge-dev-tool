import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { extname, basename, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { detectBlender, detectFbx2gltf, detectFfmpeg } from "./toolchain";
import type { SizeVerifyResult } from "./sizeVerify";
import {
  convertImageFile,
  isConvertibleImagePath,
  makeImageThumbnail,
  makeWebpCompanion,
  IMAGE_INPUT_EXTS,
} from "./imageConvert";
import { parseFbxVersion } from "../../shared/magicBytes";

export interface ConvertResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** The path to feed downstream (may be the original or a converted file). */
  outputPath: string;
  /** A list of additional companion files (e.g., .webp next to a .png). */
  companions: { path: string; role: "webp-companion" | "thumb" | "raw" | "converted"; sizeBytes: number }[];
  converted: boolean;
  conversionKind:
    | "none"
    | "fbx2gltf-glb"
    | "blender-glb"
    | "sharp-png"
    | "sharp-webp"
    | "sharp-image"
    | "ffmpeg-ogg"
    | "ffmpeg-webm";
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

/** Blender headless → production GLB with embedded textures (anti yellow/black). */
const BLENDER_GLB_SCRIPT = `
import bpy, sys, os
argv = sys.argv[sys.argv.index('--') + 1:]
in_path, out_path = argv[0], argv[1]
ext = os.path.splitext(in_path)[1].lower()
src_dir = os.path.dirname(os.path.abspath(in_path))

bpy.ops.wm.read_factory_settings(use_empty=True)
if ext == '.blend':
    bpy.ops.wm.open_mainfile(filepath=in_path)
elif ext == '.fbx':
    # Prefer embedding materials; search textures next to FBX
    try:
        bpy.ops.import_scene.fbx(
            filepath=in_path,
            use_image_search=True,
            automatic_bone_orientation=True,
        )
    except TypeError:
        bpy.ops.import_scene.fbx(filepath=in_path)
elif ext == '.obj':
    try:
        bpy.ops.wm.obj_import(filepath=in_path)
    except Exception:
        bpy.ops.import_scene.obj(filepath=in_path)
elif ext in ('.dae',):
    bpy.ops.wm.collada_import(filepath=in_path)
elif ext in ('.stl',):
    try:
        bpy.ops.wm.stl_import(filepath=in_path)
    except Exception:
        bpy.ops.import_mesh.stl(filepath=in_path)
elif ext in ('.ply',):
    try:
        bpy.ops.wm.ply_import(filepath=in_path)
    except Exception:
        bpy.ops.import_mesh.ply(filepath=in_path)
elif ext in ('.gltf', '.glb'):
    bpy.ops.import_scene.gltf(filepath=in_path)
else:
    raise SystemExit('Unsupported input ext: ' + ext)

# Pack external images so GLB is self-contained (missing atlas → yellow/black in viewers)
for img in bpy.data.images:
    if img.filepath and not img.packed_file:
        # Resolve relative // paths against source dir
        try:
            if img.filepath.startswith('//'):
                abs_p = os.path.normpath(os.path.join(src_dir, img.filepath[2:].replace('/', os.sep)))
                if os.path.isfile(abs_p):
                    img.filepath = abs_p
            img.pack()
        except Exception:
            pass

# Neutralize pure-default yellow materials that have no texture
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    nt = mat.node_tree
    if not nt:
        continue
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        continue
    base = bsdf.inputs.get('Base Color')
    if not base:
        continue
    linked = bool(base.links)
    if not linked:
        col = base.default_value
        # Yellow sludge heuristic (high R/G, low B)
        if col[0] > 0.85 and col[1] > 0.55 and col[2] < 0.35:
            base.default_value = (0.78, 0.78, 0.78, 1.0)
        # Pure black body with no map
        if col[0] < 0.02 and col[1] < 0.02 and col[2] < 0.02:
            base.default_value = (0.78, 0.78, 0.78, 1.0)
    # Cap metalness to avoid black silhouettes without IBL
    metal = bsdf.inputs.get('Metallic')
    if metal is not None and not metal.links and float(metal.default_value) > 0.35:
        metal.default_value = 0.1

export_kwargs = dict(
    filepath=out_path,
    export_format='GLB',
    export_apply=True,
    export_animations=True,
    export_skins=True,
    export_morph=True,
    export_texcoords=True,
    export_normals=True,
    export_materials='EXPORT',
    export_image_format='AUTO',
)
# Blender version compatibility for texture packing flags
try:
    bpy.ops.export_scene.gltf(**export_kwargs, export_keep_originals=False)
except TypeError:
    try:
        bpy.ops.export_scene.gltf(**export_kwargs)
    except TypeError:
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
  /** Prefer web-ready stills: TGA/TIFF/BMP/HEIC → PNG + WebP companion. */
  webImages?: boolean;
}

const MODEL_EXTS = new Set([".blend", ".fbx", ".obj", ".dae", ".stl", ".ply", ".gltf", ".glb"]);
const RASTER_TO_PNG = new Set([".tga", ".bmp", ".tif", ".tiff", ".heic", ".heif", ".jp2"]);
const WEBP_SOURCE = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);

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
  const webImages = opts.webImages !== false;

  // FBX → GLB. FBX 6.1 / FileVersion 6100 is not THREE.FBXLoader (ASCII ≥7000)
  // and FBX2glTF usually rejects it — Blender first for legacy.
  if (ext === ".fbx") {
    let fbxVer: number | null = null;
    try {
      const head = await fs.readFile(absPath);
      const probe = parseFbxVersion(head);
      fbxVer = probe.version;
      if (!probe.threeSupported) {
        result.warnings.push(probe.detail);
      }
    } catch {
      /* still try convert */
    }
    const skipFbx2gltf = fbxVer != null && fbxVer < 7000;
    const fbx2gltf = skipFbx2gltf ? { available: false, path: null as string | null, reason: `FBX ${fbxVer} needs Blender` } : await detectFbx2gltf();
    const outBase = join(outDir, basename(absPath, ext));
    const outPath = `${outBase}.glb`;
    if (fbx2gltf.available && fbx2gltf.path) {
      const r = await runCmd(fbx2gltf.path, [
        "-i", absPath,
        "-o", outBase,
        "-b",
        "--pbr-metallic-roughness",
        "--anim-framerate", "bake30",
      ]);
      if (r.code === 0 && (await fs.stat(outPath).catch(() => null))) {
        result.outputPath = outPath;
        result.converted = true;
        result.conversionKind = "fbx2gltf-glb";
        return result;
      }
      result.warnings.push(
        `FBX2glTF failed (exit ${r.code}) — trying Blender fallback. stderr=${r.stderr.slice(0, 240)}`,
      );
    } else {
      result.warnings.push(`FBX2glTF unavailable (${fbx2gltf.reason}) — trying Blender fallback.`);
    }
  }

  // Models: BLEND / FBX / OBJ / DAE / STL / PLY → GLB via Blender headless
  // Skip pure re-export when already glb/gltf unless Blender path was requested.
  if (MODEL_EXTS.has(ext) && ![".glb", ".gltf"].includes(ext)) {
    const blender = await detectBlender();
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

  // Raster → production PNG (TGA / BMP / TIFF / HEIC / …)
  if (webImages && RASTER_TO_PNG.has(ext) && isConvertibleImagePath(absPath)) {
    const r = await convertImageFile(absPath, { format: "png", keepAlpha: true }, outDir);
    if (!r.ok || !r.path) {
      result.errors.push(`PNG conversion failed: ${r.error}`);
      result.ok = false;
      return result;
    }
    result.outputPath = r.path;
    result.converted = true;
    result.conversionKind = "sharp-png";

    // Also emit WebP companion for CDN
    const webp = await makeWebpCompanion(r.path, outDir);
    if (webp.ok && webp.path && webp.afterBytes != null) {
      result.companions.push({
        path: webp.path,
        role: "webp-companion",
        sizeBytes: webp.afterBytes,
      });
    }
    return result;
  }

  // PNG / JPG / WebP / GIF / AVIF → WebP companion (keep original as primary)
  if (webImages && WEBP_SOURCE.has(ext) && isConvertibleImagePath(absPath)) {
    try {
      const webp = await makeWebpCompanion(absPath, outDir);
      if (webp.ok && webp.path && webp.afterBytes != null) {
        result.companions.push({
          path: webp.path,
          role: "webp-companion",
          sizeBytes: webp.afterBytes,
        });
        result.conversionKind = "sharp-webp";
      } else if (webp.error) {
        result.warnings.push(`WebP companion skipped: ${webp.error}`);
      }
      return result;
    } catch (err: any) {
      result.warnings.push(`WebP companion skipped: ${err.message}`);
      return result;
    }
  }

  // Generic image path through sharp when listed
  if (webImages && IMAGE_INPUT_EXTS.has(ext) && ![".svg"].includes(ext)) {
    const r = await convertImageFile(absPath, { format: "webp", quality: 86 }, outDir);
    if (r.ok && r.path && r.afterBytes != null) {
      result.companions.push({ path: r.path, role: "webp-companion", sizeBytes: r.afterBytes });
      result.conversionKind = "sharp-image";
    }
    return result;
  }

  // Audio: WAV → OGG via ffmpeg
  if (ext === ".wav" && verify.probed.sizeBytes > 1024 * 1024) {
    const ffmpeg = await detectFfmpeg();
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

  // Video: large MOV/AVI → WebM companion hint (optional, non-blocking)
  if ([".mov", ".avi", ".mkv"].includes(ext) && verify.probed.sizeBytes > 5 * 1024 * 1024) {
    const ffmpeg = await detectFfmpeg();
    if (ffmpeg.available && ffmpeg.path) {
      const outPath = join(outDir, `${basename(absPath, ext)}.webm`);
      const r = await runCmd(ffmpeg.path, [
        "-y", "-i", absPath,
        "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32",
        "-c:a", "libopus", "-b:a", "96k",
        "-deadline", "good", "-cpu-used", "4",
        outPath,
      ]);
      if (r.code === 0 && (await fs.stat(outPath).catch(() => null))) {
        const st = await fs.stat(outPath);
        result.companions.push({ path: outPath, role: "converted", sizeBytes: st.size });
        result.conversionKind = "ffmpeg-webm";
        result.warnings.push("WebM companion generated; original remains primary upload.");
      }
    }
  }

  return result;
}

export async function makeThumbnail(absPath: string, outDir: string): Promise<string | null> {
  if (isConvertibleImagePath(absPath)) {
    return makeImageThumbnail(absPath, outDir, 256);
  }
  // Non-image: try sharp still (pdf first page not supported without extra)
  try {
    return makeImageThumbnail(absPath, outDir, 256);
  } catch {
    return null;
  }
}

export { convertImageFile, inspectImage, isConvertibleImagePath } from "./imageConvert";
export type { ImageConvertOptions, ImageConvertResult, ImageMeta, ImageOutFormat } from "./imageConvert";
