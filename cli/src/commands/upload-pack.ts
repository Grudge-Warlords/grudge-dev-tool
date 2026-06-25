import { ingestPack } from "../lib/ingest.js";
import { ObjectStoreClient } from "../lib/api.js";
import { resolveApiBase } from "../lib/config.js";
import { loadAuth } from "../lib/auth.js";

export async function runUploadPack(opts: {
  root: string;
  packId: string;
  version?: string;
  license?: string;
  author?: string;
  dryRun?: boolean;
  apiBase?: string;
}): Promise<number> {
  if (!opts.root || !opts.packId) {
    console.error("--root and --pack-id are required");
    return 1;
  }

  const auth = await loadAuth();
  if (!opts.dryRun && !auth.token && !auth.adminPassword) {
    console.error("No auth — run: grudge-dev login --admin-password <pw>");
    return 1;
  }

  const version = opts.version || "0.0.0";
  const ingested = await ingestPack({
    root: opts.root,
    packId: opts.packId,
    version,
    license: opts.license || "unknown",
    author: opts.author || "unknown",
    dryRun: opts.dryRun,
  });

  console.log(`\nIngested ${ingested.length} files from ${opts.root}\n`);

  if (opts.dryRun) {
    for (const f of ingested.slice(0, 10)) {
      console.log(`  [dry] ${f.entry.path}  ${f.entry.sha256.slice(0, 12)}…`);
    }
    if (ingested.length > 10) console.log(`  … and ${ingested.length - 10} more`);
    return 0;
  }

  const client = new ObjectStoreClient(resolveApiBase(opts.apiBase));
  let uploaded = 0;

  for (const f of ingested) {
    process.stdout.write(`  ↑ ${f.relPath} … `);
    try {
      await client.uploadFile(
        f.entry.path,
        f.data,
        f.entry.contentType,
        f.entry.sha256,
      );
      if (f.thumb && f.entry.thumbPath) {
        await client.uploadFile(
          f.entry.thumbPath,
          f.thumb,
          "image/webp",
          "",
          true,
        );
      }
      uploaded++;
      console.log("ok");
    } catch (e: unknown) {
      console.log("FAIL");
      console.error(`    ${e instanceof Error ? e.message : e}`);
    }
  }

  const entries = ingested.map((f) => f.entry);
  const manifest = await client.writeManifest(opts.packId, version, entries, {
    license: opts.license || "unknown",
    author: opts.author || "unknown",
    sourceRoot: opts.root,
  });

  console.log(`\n✨ Uploaded ${uploaded}/${ingested.length} files`);
  console.log(`   Manifest: ${manifest.count} entries for pack ${opts.packId}\n`);
  return uploaded === ingested.length ? 0 : 1;
}