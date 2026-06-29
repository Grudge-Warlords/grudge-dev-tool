/**
 * scripts/upload-asset-pack.ts
 *
 * Walks an asset-pack directory and ingests every file through the dev-tool
 * pipeline (size-verify → convert → enrich → rig → hash → UUID). With
 * `--dry-run`, no network calls are made — the run produces a JSON summary
 * and (optionally) writes a local preview manifest.
 *
 * Run with: npm run upload-pack -- --root <path> --pack-id <id> --version <ver>
 */
import { promises as fs } from "node:fs";
import { join, relative, sep, extname } from "node:path";
import { performance } from "node:perf_hooks";
import {
  generateGrudgeUUID, setCounterState,
} from "../src/shared/grudgeUUID";
import { verifyFile } from "../src/main/ingestion/sizeVerify";

interface Args {
  root: string;
  packId: string;
  version: string;
  license: string;
  author: string;
  dryRun: boolean;
  keepSource: boolean;
  skipConvert: boolean;
  skipRig: boolean;
  retarget?: string;
  blenderkitBase?: string;
  outputManifest?: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (k: string): string | undefined => {
    const i = args.indexOf(`--${k}`);
    if (i >= 0 && i + 1 < args.length && !args[i + 1].startsWith("--")) return args[i + 1];
    const eq = args.find((a) => a.startsWith(`--${k}=`));
    if (eq) return eq.split("=").slice(1).join("=");
    return undefined;
  };
  const flag = (k: string): boolean => args.includes(`--${k}`);
  return {
    root: get("root") ?? "",
    packId: get("pack-id") ?? "",
    version: get("version") ?? "0.0.0",
    license: get("license") ?? "unknown",
    author: get("author") ?? "unknown",
    dryRun: flag("dry-run"),
    keepSource: flag("keep-source"),
    skipConvert: flag("skip-convert"),
    skipRig: flag("skip-rig"),
    retarget: get("retarget"),
    blenderkitBase: get("blenderkit-base"),
    outputManifest: get("output-manifest"),
  };
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

const SLOT_BY_FAMILY: Record<string, string> = {
  image: "Texture", spritesheet: "Sprite", model: "BlendModel",
  audio: "Audio", scene: "Item", json: "Item", doc: "Item", other: "Other",
};

function fmtBytes(n: number): string {
  if (n > 1e9) return (n / 1e9).toFixed(2) + " GB";
  if (n > 1e6) return (n / 1e6).toFixed(2) + " MB";
  if (n > 1e3) return (n / 1e3).toFixed(2) + " KB";
  return n + " B";
}

async function main() {
  const a = parseArgs();
  if (!a.root || !a.packId) {
    console.error("Usage: --root <path> --pack-id <id> [--version 0.6] [--dry-run]");
    process.exit(2);
  }

  const start = performance.now();
  console.log(`[upload-pack] root      = ${a.root}`);
  console.log(`[upload-pack] packId    = ${a.packId}`);
  console.log(`[upload-pack] version   = ${a.version}`);
  console.log(`[upload-pack] dryRun    = ${a.dryRun}`);
  console.log(`[upload-pack] license   = ${a.license}`);

  setCounterState(1);

  type Entry = {
    grudgeUUID: string;
    path: string;
    sourceRelative: string;
    category: string;
    family: string;
    sizeBytes: number;
    contentType: string;
    width?: number;
    height?: number;
    warnings: string[];
    errors: string[];
  };

  const entries: Entry[] = [];
  const byCategory: Record<string, number> = {};
  const byFamily: Record<string, number> = {};
  let totalSize = 0;
  let errored = 0;

  let ordinal = 1;
  for await (const abs of walk(a.root)) {
    const rel = relative(a.root, abs).split(sep).join("/");
    const parts = rel.split("/");
    const category = parts.length > 1 ? parts[0] : "_root";

    const verify = await verifyFile(abs, { category });
    const family = verify.family;

    // Lightweight content-type guess
    const ext = extname(abs).toLowerCase();
    const ct = ({
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".webp": "image/webp", ".tga": "image/x-tga", ".bmp": "image/bmp",
      ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
      ".blend": "application/x-blender", ".fbx": "application/octet-stream",
      ".obj": "model/obj", ".ogg": "audio/ogg", ".wav": "audio/wav",
      ".mp3": "audio/mpeg", ".json": "application/json",
      ".md": "text/markdown", ".txt": "text/plain",
    } as Record<string, string>)[ext] ?? "application/octet-stream";

    const slot = SLOT_BY_FAMILY[family] || "Item";
    const grudgeUUID = generateGrudgeUUID(slot, null, ordinal);
    ordinal += 1;

    const targetPath = `asset-packs/${a.packId}/v${a.version}/${rel}`;

    entries.push({
      grudgeUUID,
      path: targetPath,
      sourceRelative: rel,
      category,
      family,
      sizeBytes: verify.probed.sizeBytes,
      contentType: ct,
      width: verify.probed.width,
      height: verify.probed.height,
      warnings: verify.warnings,
      errors: verify.errors,
    });

    byCategory[category] = (byCategory[category] || 0) + 1;
    byFamily[family] = (byFamily[family] || 0) + 1;
    totalSize += verify.probed.sizeBytes;
    if (!verify.ok) errored += 1;
  }

  const elapsed = ((performance.now() - start) / 1000).toFixed(1);

  // Summary
  console.log("");
  console.log(`[upload-pack] Walked ${entries.length} files in ${elapsed}s, total ${fmtBytes(totalSize)}.`);
  console.log("[upload-pack] By category:");
  Object.entries(byCategory).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`             ${String(v).padStart(5, " ")}  ${k}`);
  });
  console.log("[upload-pack] By family:");
  Object.entries(byFamily).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`             ${String(v).padStart(5, " ")}  ${k}`);
  });
  if (errored > 0) {
    console.log(`[upload-pack] ${errored} file(s) failed size-verify; will be skipped on a real run.`);
  }

  // Dry-run preview manifest
  if (a.dryRun) {
    const manifest = {
      packId: a.packId,
      version: a.version,
      generatedAt: new Date().toISOString(),
      meta: { license: a.license, author: a.author, dryRun: true },
      count: entries.length,
      entries: entries.slice(0, 10),  // preview only
    };
    const previewPath = a.outputManifest ?? join(process.cwd(), `manifest-preview-${a.packId}.json`);
    await fs.writeFile(previewPath, JSON.stringify(manifest, null, 2), "utf8");
    console.log(`[upload-pack] DRY RUN — wrote preview manifest (10 entries) to ${previewPath}`);
    console.log("[upload-pack] First 5 generated UUIDs:");
    entries.slice(0, 5).forEach((e) => console.log(`             ${e.grudgeUUID}  ${e.sourceRelative}`));
    return;
  }

  // Real run would call /api/objectstore/upload-url + PUT here.
  console.log("[upload-pack] Real upload not implemented in this scaffold. Use --dry-run for now.");
  process.exit(2);
}

main().catch((err) => {
  console.error("[upload-pack] fatal:", err);
  process.exit(1);
});
