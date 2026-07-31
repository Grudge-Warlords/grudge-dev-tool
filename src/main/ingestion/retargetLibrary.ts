/**
 * Export retarget mapping + skill-tagged animation library pack for Grudge Studio.
 *
 * Pack layout (v2):
 *   rest.glb
 *   skeleton-mapping.json     — placements + boneMap + reverseMap
 *   retarget-map.json         — SkeletonUtils { targetBone: sourceBone }
 *   slots/<skillSlotId>.json  — clip names assigned to that slot
 *   by-weapon/<pack>.json     — weapon pack → skillSlot → clip
 *   textures/*
 *   anim-library-manifest.json
 *   clips-index.json          — flat list of all animations + skill tags
 */
import { promises as fs } from "node:fs";
import { basename, join, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  ANIM_SKILL_SLOTS,
  ANIM_WEAPON_PACKS,
  MIXAMO_25_VERSION,
  type SkeletonMappingDoc,
  matchSkillSlot,
  autoMapBonesFromNames,
  buildSkuNamesMap,
  applyAutoMapToDoc,
  emptyMapping,
} from "../../shared/mixamo25";
import { extractFbxAssets } from "./fbxExtract";

export interface RetargetLibraryResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  packDir: string;
  manifestPath: string | null;
  clips: Array<{ name: string; skillSlotId: string | null; duration?: number; category?: string | null }>;
  autoMapped: number;
}

export interface AnimLibrarySummary {
  packDir: string;
  name: string;
  skeleton: string;
  clipCount: number;
  textureCount: number;
  jointCount: number;
  fingerprint: string | null;
  createdAt: string | null;
  manifestPath: string;
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
    warnings: [],
    packDir,
    manifestPath: null,
    clips: [],
    autoMapped: 0,
  };

  await fs.mkdir(packDir, { recursive: true });
  for (const sub of [
    "locomotion", "combat_melee", "combat_ranged", "magic",
    "utility", "idle", "hit", "death", "emote", "slots", "by-weapon", "textures", "_extract",
  ]) {
    await fs.mkdir(join(packDir, sub), { recursive: true });
  }

  const extract = await extractFbxAssets(opts.modelPath, { outDir: join(packDir, "_extract") });
  if (!extract.ok || !extract.glbPath) {
    result.errors.push(...extract.errors);
    return result;
  }
  result.warnings.push(...extract.warnings);

  const restGlb = join(packDir, "rest.glb");
  await fs.copyFile(extract.glbPath, restGlb);

  // ── Bone map: user mapping + auto-map from extract joints ───────────────
  let mapping: SkeletonMappingDoc =
    opts.mapping ?? emptyMapping(opts.modelPath);

  if (extract.skeleton.jointNames.length) {
    mapping = applyAutoMapToDoc(mapping, extract.skeleton.jointNames);
    result.autoMapped = mapping.autoMap?.matched ?? 0;
    if (result.autoMapped < 8) {
      result.warnings.push(
        `Only ${result.autoMapped}/22 Mixamo-25 bones auto-mapped — place remaining bones in Skeleton Studio.`,
      );
    }
  } else {
    result.warnings.push("No skin joints found — bone map may be incomplete.");
  }

  // Prefer reverseMap from mapping; rebuild if missing
  const reverseMap =
    mapping.reverseMap && Object.keys(mapping.reverseMap).length
      ? mapping.reverseMap
      : autoMapBonesFromNames(extract.skeleton.jointNames).reverseMap;

  const skuNames = buildSkuNamesMap(reverseMap, extract.skeleton.jointNames);

  await fs.writeFile(
    join(packDir, "skeleton-mapping.json"),
    JSON.stringify({ ...mapping, reverseMap, updatedAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
  await fs.writeFile(
    join(packDir, "retarget-map.json"),
    JSON.stringify(
      {
        version: MIXAMO_25_VERSION,
        skeleton: "mixamo-25",
        /** SkeletonUtils.retargetClip `names` option: targetBone → sourceBone */
        names: skuNames,
        reverseMap,
        boneMap: mapping.boneMap,
        note: "Use with three.js SkeletonUtils.retargetClip or boneAliases.retargetClips",
      },
      null,
      2,
    ),
    "utf8",
  );

  // ── Classify clips into skill slots + categories ────────────────────────
  const byCategory: Record<string, Array<{ name: string; skillSlotId: string | null; duration: number }>> = {};
  const bySlot: Record<string, string[]> = {};
  for (const slot of ANIM_SKILL_SLOTS) bySlot[slot.id] = [];

  for (const anim of extract.animations) {
    const slot = matchSkillSlot(anim.name);
    const cat = slot?.category ?? "utility";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push({
      name: anim.name,
      skillSlotId: slot?.id ?? null,
      duration: anim.duration,
    });
    result.clips.push({
      name: anim.name,
      skillSlotId: slot?.id ?? null,
      duration: anim.duration,
      category: cat,
    });
    if (slot) bySlot[slot.id].push(anim.name);
  }

  for (const [cat, clips] of Object.entries(byCategory)) {
    const dir = join(packDir, cat);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      join(dir, "clips.json"),
      JSON.stringify(
        {
          category: cat,
          clips,
          note: "Clip binary tracks live in rest.glb; retarget at load via retarget-map.json",
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  for (const [slotId, names] of Object.entries(bySlot)) {
    await fs.writeFile(
      join(packDir, "slots", `${slotId}.json`),
      JSON.stringify(
        {
          skillSlotId: slotId,
          clips: names,
          slot: ANIM_SKILL_SLOTS.find((s) => s.id === slotId) ?? null,
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  // Weapon pack matrix — each pack lists preferred clip per skill slot
  for (const pack of ANIM_WEAPON_PACKS) {
    const slots: Record<string, string | null> = {};
    for (const slot of ANIM_SKILL_SLOTS) {
      const applies =
        !slot.weaponPacks ||
        slot.weaponPacks.includes("*") ||
        slot.weaponPacks.includes(pack);
      if (!applies) {
        slots[slot.id] = null;
        continue;
      }
      slots[slot.id] = bySlot[slot.id]?.[0] ?? null;
    }
    await fs.writeFile(
      join(packDir, "by-weapon", `${pack}.json`),
      JSON.stringify({ weaponPack: pack, slots, skeleton: "mixamo-25" }, null, 2),
      "utf8",
    );
  }

  await fs.writeFile(
    join(packDir, "clips-index.json"),
    JSON.stringify({ clips: result.clips, skillSlots: ANIM_SKILL_SLOTS }, null, 2),
    "utf8",
  );

  // Textures
  const texDir = join(packDir, "textures");
  for (const t of extract.textures) {
    try {
      await fs.copyFile(t.path, join(texDir, basename(t.path)));
    } catch {
      /* skip missing */
    }
  }

  const manifest = {
    version: 2,
    name: opts.packName || basename(opts.modelPath).replace(/\.[^.]+$/, "") + "-anim-lib",
    skeleton: "mixamo-25",
    mixamo25Version: MIXAMO_25_VERSION,
    restGlb: "rest.glb",
    mapping: "skeleton-mapping.json",
    retargetMap: "retarget-map.json",
    clipsIndex: "clips-index.json",
    skillSlots: ANIM_SKILL_SLOTS.map((s) => s.id),
    weaponPacks: [...ANIM_WEAPON_PACKS],
    animations: extract.animations,
    textures: extract.textures.map((t) => ({
      name: t.name,
      role: t.role,
      relative: `textures/${basename(t.path)}`,
    })),
    fingerprint: extract.skeleton.fingerprint,
    jointCount: extract.skeleton.jointCount,
    autoMappedBones: result.autoMapped,
    createdAt: new Date().toISOString(),
    grudgeStudio: {
      weaponPacks: [...ANIM_WEAPON_PACKS],
      retarget: "retarget-map.json names + boneAliases.retargetClips (SkeletonUtils)",
      runtime: "Open / Forge / gameopen attachAnimationMixer + retargetClips",
    },
  };

  const manifestPath = join(packDir, "anim-library-manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  result.manifestPath = manifestPath;
  result.ok = true;
  return result;
}

/** Library search roots for local packs. */
function librarySearchRoots(): string[] {
  const roots = [
    join(tmpdir()),
    join(homedir(), "Documents", "grudge-anim-libraries"),
    join(homedir(), "Documents", "GrudgeStudio", "anim-libraries"),
    join(homedir(), ".grudge", "anim-libraries"),
  ];
  return roots;
}

/**
 * Find local anim-library packs (manifest present).
 * Scans tmp grudge-anim-lib-* and user Documents library folders.
 */
export async function listLocalAnimLibraries(opts?: {
  max?: number;
}): Promise<AnimLibrarySummary[]> {
  const max = opts?.max ?? 40;
  const found: AnimLibrarySummary[] = [];
  const seen = new Set<string>();

  const tryManifest = async (manifestPath: string) => {
    try {
      const raw = await fs.readFile(manifestPath, "utf8");
      const m = JSON.parse(raw) as {
        name?: string;
        skeleton?: string;
        animations?: unknown[];
        textures?: unknown[];
        jointCount?: number;
        fingerprint?: string | null;
        createdAt?: string;
      };
      const packDir = dirname(manifestPath);
      if (seen.has(packDir)) return;
      seen.add(packDir);
      found.push({
        packDir,
        name: m.name || basename(packDir),
        skeleton: m.skeleton || "unknown",
        clipCount: Array.isArray(m.animations) ? m.animations.length : 0,
        textureCount: Array.isArray(m.textures) ? m.textures.length : 0,
        jointCount: m.jointCount ?? 0,
        fingerprint: m.fingerprint ?? null,
        createdAt: m.createdAt ?? null,
        manifestPath,
      });
    } catch {
      /* skip */
    }
  };

  // Direct library folders
  for (const root of librarySearchRoots()) {
    if (found.length >= max) break;
    try {
      const st = await fs.stat(root);
      if (!st.isDirectory()) continue;
      // Root itself may be a pack
      await tryManifest(join(root, "anim-library-manifest.json"));
      const entries = await fs.readdir(root, { withFileTypes: true });
      for (const ent of entries) {
        if (found.length >= max) break;
        if (!ent.isDirectory()) continue;
        // tmp: grudge-anim-lib-*
        if (root === tmpdir() && !ent.name.startsWith("grudge-anim-lib-")) continue;
        await tryManifest(join(root, ent.name, "anim-library-manifest.json"));
      }
    } catch {
      /* missing root */
    }
  }

  found.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return found.slice(0, max);
}

/** Ensure user Documents library folder exists; return path. */
export async function ensureUserAnimLibraryDir(): Promise<string> {
  const dir = join(homedir(), "Documents", "grudge-anim-libraries");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** Copy a built pack into the user Documents library for durable access. */
export async function installAnimLibraryToUserDir(packDir: string): Promise<{
  ok: boolean;
  dest: string | null;
  error?: string;
}> {
  try {
    const userRoot = await ensureUserAnimLibraryDir();
    const name = basename(packDir).replace(/^grudge-anim-lib-/, "pack-");
    const dest = join(userRoot, name);
    await fs.cp(packDir, dest, { recursive: true });
    return { ok: true, dest };
  } catch (e: any) {
    return { ok: false, dest: null, error: e?.message ?? String(e) };
  }
}
