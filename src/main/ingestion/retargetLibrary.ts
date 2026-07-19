/**
 * Export retarget mapping + skill-tagged animation library pack for Grudge Studio.
 * Structure mirrors fleet anim packs: locomotion / combat / magic skill slots.
 */
import { promises as fs } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  ANIM_SKILL_SLOTS,
  type SkeletonMappingDoc,
  matchSkillSlot,
} from "../../shared/mixamo25";
import { extractFbxAssets } from "./fbxExtract";

export interface RetargetLibraryResult {
  ok: boolean;
  errors: string[];
  packDir: string;
  manifestPath: string | null;
  clips: Array<{ name: string; skillSlotId: string | null; path?: string }>;
}

export async function buildRetargetLibraryPack(opts: {
  modelPath: string;
  mapping?: SkeletonMappingDoc | null;
  outDir?: string;
  packName?: string;
}): Promise<RetargetLibraryResult> {
  const packDir = opts.outDir ?? join(tmpdir(), `grudge-anim-lib-${randomUUID()}`);
  const result: RetargetLibraryResult = {
    ok: false,
    errors: [],
    packDir,
    manifestPath: null,
    clips: [],
  };

  await fs.mkdir(packDir, { recursive: true });
  await fs.mkdir(join(packDir, "locomotion"), { recursive: true });
  await fs.mkdir(join(packDir, "combat_melee"), { recursive: true });
  await fs.mkdir(join(packDir, "combat_ranged"), { recursive: true });
  await fs.mkdir(join(packDir, "magic"), { recursive: true });
  await fs.mkdir(join(packDir, "utility"), { recursive: true });
  await fs.mkdir(join(packDir, "idle"), { recursive: true });

  const extract = await extractFbxAssets(opts.modelPath, { outDir: join(packDir, "_extract") });
  if (!extract.ok || !extract.glbPath) {
    result.errors.push(...extract.errors);
    return result;
  }

  // Copy GLB as character rest / tpose candidate
  const restGlb = join(packDir, "rest.glb");
  await fs.copyFile(extract.glbPath, restGlb);

  if (opts.mapping) {
    await fs.writeFile(
      join(packDir, "skeleton-mapping.json"),
      JSON.stringify(opts.mapping, null, 2),
      "utf8",
    );
  }

  const byCategory: Record<string, Array<{ name: string; skillSlotId: string | null }>> = {};
  for (const anim of extract.animations) {
    const slot = matchSkillSlot(anim.name);
    const cat = slot?.category ?? "utility";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push({ name: anim.name, skillSlotId: slot?.id ?? null });
    result.clips.push({ name: anim.name, skillSlotId: slot?.id ?? null });
  }

  for (const [cat, clips] of Object.entries(byCategory)) {
    const dir = join(packDir, cat);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      join(dir, "clips.json"),
      JSON.stringify({ category: cat, clips, note: "Clip binary data lives in rest.glb; retarget at load" }, null, 2),
      "utf8",
    );
  }

  const manifest = {
    version: 1,
    name: opts.packName || basename(opts.modelPath).replace(/\.[^.]+$/, "") + "-anim-lib",
    skeleton: "mixamo-25",
    restGlb: "rest.glb",
    mapping: opts.mapping ? "skeleton-mapping.json" : null,
    skillSlots: ANIM_SKILL_SLOTS.map((s) => s.id),
    animations: extract.animations,
    textures: extract.textures.map((t) => ({ name: t.name, role: t.role, relative: `textures/${basename(t.path)}` })),
    fingerprint: extract.skeleton.fingerprint,
    jointCount: extract.skeleton.jointCount,
    createdAt: new Date().toISOString(),
    grudgeStudio: {
      weaponPacks: ["sword", "sword_shield", "bow", "fire_staff", "greataxe", "gun"],
      retarget: "boneAliases.retargetClips + mixamo25 boneMap",
    },
  };

  // Copy textures into pack
  const texDir = join(packDir, "textures");
  await fs.mkdir(texDir, { recursive: true });
  for (const t of extract.textures) {
    try {
      await fs.copyFile(t.path, join(texDir, basename(t.path)));
    } catch { /* skip */ }
  }

  const manifestPath = join(packDir, "anim-library-manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  result.manifestPath = manifestPath;
  result.ok = true;
  return result;
}
