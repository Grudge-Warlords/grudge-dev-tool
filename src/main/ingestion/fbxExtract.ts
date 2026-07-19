/**
 * Extract textures + animation metadata from FBX (via convert) or GLB.
 * Writes companions next to output for fleet upload / Skeleton Studio.
 */
import { promises as fs } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { convertFile } from "./convert";
import { verifyFile } from "./sizeVerify";
import { matchSkillSlot, type AnimSkillCategory } from "../../shared/mixamo25";
import { matchSkeletonFingerprint } from "../../shared/grudgeRigs";

export interface ExtractedTexture {
  name: string;
  path: string;
  sizeBytes: number;
  mime: string;
  role: "baseColor" | "normal" | "metallicRoughness" | "emissive" | "occlusion" | "unknown";
}

export interface ExtractedAnimation {
  name: string;
  duration: number;
  channelCount: number;
  skillSlotId: string | null;
  skillCategory: AnimSkillCategory | null;
}

export interface FbxExtractResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  sourcePath: string;
  glbPath: string | null;
  outDir: string;
  textures: ExtractedTexture[];
  animations: ExtractedAnimation[];
  skeleton: {
    jointCount: number;
    jointNames: string[];
    fingerprint: string | null;
  };
}

function guessRole(name: string): ExtractedTexture["role"] {
  const n = name.toLowerCase();
  if (/normal|nrm|nor/.test(n)) return "normal";
  if (/metal|rough|orm|mrao/.test(n)) return "metallicRoughness";
  if (/emiss|glow/.test(n)) return "emissive";
  if (/ao|occl/.test(n)) return "occlusion";
  if (/albedo|base|color|diff|diffuse|tex/.test(n)) return "baseColor";
  return "unknown";
}

function mimeFromName(name: string): string {
  const e = extname(name).toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".webp") return "image/webp";
  if (e === ".ktx2") return "image/ktx2";
  return "application/octet-stream";
}

export async function extractFbxAssets(
  absPath: string,
  opts: { outDir?: string } = {},
): Promise<FbxExtractResult> {
  const result: FbxExtractResult = {
    ok: true,
    errors: [],
    warnings: [],
    sourcePath: absPath,
    glbPath: null,
    outDir: opts.outDir ?? join(tmpdir(), `grudge-extract-${randomUUID()}`),
    textures: [],
    animations: [],
    skeleton: { jointCount: 0, jointNames: [], fingerprint: null },
  };

  await fs.mkdir(result.outDir, { recursive: true });
  await fs.mkdir(join(result.outDir, "textures"), { recursive: true });
  await fs.mkdir(join(result.outDir, "anims"), { recursive: true });

  let glbPath = absPath;
  const ext = extname(absPath).toLowerCase();
  if (ext === ".fbx" || ext === ".obj" || ext === ".blend") {
    const sizeRes = await verifyFile(absPath);
    const conv = await convertFile(absPath, sizeRes, { outDir: result.outDir });
    if (!conv.ok || !conv.converted) {
      result.errors.push(...conv.errors);
      result.warnings.push(...conv.warnings);
      if (!conv.converted) {
        result.ok = false;
        result.errors.push("Could not convert FBX/OBJ to GLB for extract.");
        return result;
      }
    }
    result.warnings.push(...conv.warnings);
    glbPath = conv.outputPath;
  }

  if (extname(glbPath).toLowerCase() !== ".glb" && extname(glbPath).toLowerCase() !== ".gltf") {
    result.ok = false;
    result.errors.push("Extract requires GLB/GLTF after convert.");
    return result;
  }

  result.glbPath = glbPath;

  try {
    const { NodeIO } = require("@gltf-transform/core");
    const { ALL_EXTENSIONS } = require("@gltf-transform/extensions");
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(glbPath);
    const root = doc.getRoot();

    // Textures
    const textures = root.listTextures?.() ?? [];
    let ti = 0;
    for (const tex of textures) {
      const name = tex.getName?.() || `texture_${ti}`;
      const image = tex.getImage?.();
      const mime = tex.getMimeType?.() || "image/png";
      const extOut = mime.includes("jpeg") || mime.includes("jpg") ? ".jpg"
        : mime.includes("webp") ? ".webp"
        : ".png";
      const safe = name.replace(/[^\w.-]+/g, "_") || `tex_${ti}`;
      const outPath = join(result.outDir, "textures", `${safe}${extOut}`);
      if (image) {
        const buf = Buffer.from(image);
        await fs.writeFile(outPath, buf);
        result.textures.push({
          name: safe,
          path: outPath,
          sizeBytes: buf.length,
          mime: mimeFromName(outPath) || mime,
          role: guessRole(name),
        });
      }
      ti++;
    }

    // Animations
    for (const anim of root.listAnimations?.() ?? []) {
      const name = anim.getName?.() || "clip";
      const channels = anim.listChannels?.() ?? [];
      let duration = 0;
      for (const ch of channels) {
        const sampler = ch.getSampler?.();
        const input = sampler?.getInput?.();
        if (input) {
          const arr = input.getArray?.();
          if (arr && arr.length) duration = Math.max(duration, Number(arr[arr.length - 1]));
        }
      }
      const slot = matchSkillSlot(name);
      result.animations.push({
        name,
        duration,
        channelCount: channels.length,
        skillSlotId: slot?.id ?? null,
        skillCategory: slot?.category ?? null,
      });
    }

    // Skeleton
    const skins = root.listSkins?.() ?? [];
    if (skins.length) {
      const joints = skins[0].listJoints?.() ?? [];
      const names = joints.map((j: { getName: () => string }) => j.getName?.() || "");
      result.skeleton.jointCount = names.length;
      result.skeleton.jointNames = names;
      result.skeleton.fingerprint = matchSkeletonFingerprint(names)?.name ?? null;
    }

    // Manifest
    await fs.writeFile(
      join(result.outDir, "extract-manifest.json"),
      JSON.stringify({
        source: absPath,
        glb: glbPath,
        textures: result.textures.map((t) => ({ name: t.name, role: t.role, path: t.path })),
        animations: result.animations,
        skeleton: result.skeleton,
        createdAt: new Date().toISOString(),
      }, null, 2),
      "utf8",
    );
  } catch (err: any) {
    result.ok = false;
    result.errors.push(err?.message ?? String(err));
  }

  return result;
}
