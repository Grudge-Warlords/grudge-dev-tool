#!/usr/bin/env node
/**
 * Parallel logical Postgres backup for Grudge Studio player SSOT.
 *
 * Design notes (PlanetScale-inspired, fleet-scale):
 *  - Never run on the HTTP request path — CLI / cron only.
 *  - Parallelize by table (logical "workers") with capped concurrency.
 *  - Freeze metadata time T in meta.json for restore drills.
 *  - Prefer DATABASE_PUBLIC_URL for local tools; never log the connection string.
 *  - Output under backups/<stamp>/ (gitignored) — optional R2 upload is separate.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/backup-postgres.mjs
 *   npm run backup:postgres -- --concurrency 4
 *   npm run backup:postgres -- --tables users,accounts,characters
 *   npm run backup:postgres -- --pg-dump
 *   npm run backup:postgres -- --list-tables
 *
 * Requires: npm package `pg` (install if missing: npm i -D pg)
 * Optional: Docker for --pg-dump (postgres:16 image).
 */

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  writeFile,
  access,
  constants as fsConstants,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BACKUPS_ROOT = path.join(ROOT, "backups");

/** Critical + high tables for Warlords / fleet player SSOT (verify against live schema). */
const DEFAULT_TABLES = [
  "users",
  "accounts",
  "characters",
  "account_inventory",
  "account_resources",
  "home_islands",
  "player_ships",
  "gbux_transactions",
  "uuid_ledger",
  "character_professions",
  "character_nfts",
  "island_nfts",
  "linked_wallets",
  "wallet_purchases",
  "client_memberships",
];

function parseArgs(argv) {
  const out = {
    concurrency: 4,
    tables: null,
    pgDump: false,
    listTables: false,
    gzip: true,
    schema: "public",
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--pg-dump") out.pgDump = true;
    else if (a === "--list-tables") out.listTables = true;
    else if (a === "--no-gzip") out.gzip = false;
    else if (a === "--concurrency" || a === "-c") {
      out.concurrency = Math.max(1, Number(argv[++i]) || 4);
    } else if (a === "--tables" || a === "-t") {
      out.tables = String(argv[++i] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--schema") {
      out.schema = String(argv[++i] || "public");
    }
  }
  return out;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function connectionString() {
  return (
    process.env.DATABASE_PUBLIC_URL ||
    process.env.DATABASE_URL ||
    process.env.GRUDGE_DATABASE_URL ||
    ""
  ).trim();
}

function redactedTarget(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "(unparseable)";
  }
}

async function loadPg() {
  try {
    return await import("pg");
  } catch {
    console.error(
      "[backup-postgres] Missing dependency `pg`.\n" +
        "  Install:  npm i -D pg\n" +
        "  Or use:   --pg-dump  (requires Docker + postgres:16)",
    );
    process.exit(1);
  }
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

async function listPublicTables(client, schema) {
  const { rows } = await client.query(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname = $1
     ORDER BY tablename`,
    [schema],
  );
  return rows.map((r) => r.tablename);
}

async function dumpTableJsonl(client, schema, table, outPath, useGzip) {
  const ident = `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
  const countRes = await client.query(`SELECT count(*)::bigint AS n FROM ${ident}`);
  const rowCount = Number(countRes.rows[0]?.n ?? 0);

  const target = useGzip ? `${outPath}.gz` : outPath;
  const out = createWriteStream(target);
  const sink = useGzip ? createGzip() : null;
  if (sink) sink.pipe(out);

  const write = (chunk) =>
    new Promise((resolve, reject) => {
      const stream = sink || out;
      const ok = stream.write(chunk);
      if (ok) resolve();
      else stream.once("drain", resolve);
      stream.once("error", reject);
    });

  // Cursor-style batch read to bound memory
  const batchSize = 500;
  let offset = 0;
  let written = 0;
  while (offset < rowCount || (rowCount === 0 && offset === 0)) {
    const { rows } = await client.query(
      `SELECT row_to_json(t) AS j FROM ${ident} t ORDER BY 1 NULLS LAST LIMIT $1 OFFSET $2`,
      [batchSize, offset],
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      await write(JSON.stringify(r.j) + "\n");
      written++;
    }
    offset += rows.length;
    if (rows.length < batchSize) break;
  }

  await new Promise((resolve, reject) => {
    const stream = sink || out;
    stream.end(() => {
      if (sink) out.end(resolve);
      else resolve();
    });
    stream.on("error", reject);
    out.on("error", reject);
  });

  return { table, rowCount: written, path: path.basename(target) };
}

async function runPgDumpDocker(conn, outDir) {
  const dumpPath = path.join(outDir, "full.dump");
  // Pass connection via env inside container; do not print URL
  const args = [
    "run",
    "--rm",
    "-e",
    `DATABASE_URL=${conn}`,
    "-v",
    `${outDir}:/out`,
    "postgres:16",
    "bash",
    "-lc",
    "pg_dump \"$DATABASE_URL\" -Fc -f /out/full.dump --no-owner --no-acl",
  ];
  await new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`docker pg_dump exit ${code}`)),
    );
  });
  return dumpPath;
}

function printHelp() {
  console.log(`Grudge Studio — parallel Postgres backup

Env:
  DATABASE_PUBLIC_URL | DATABASE_URL | GRUDGE_DATABASE_URL

Flags:
  --concurrency N   Parallel table workers (default 4)
  --tables a,b,c    Subset of tables (default critical set, skip missing)
  --schema public   Schema name
  --list-tables     List public tables and exit
  --pg-dump         Full custom-format dump via Docker postgres:16
  --no-gzip         Write plain .jsonl (default .jsonl.gz)
  --help

Output:
  backups/<iso-stamp>/meta.json
  backups/<iso-stamp>/tables/<table>.jsonl.gz
`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const conn = connectionString();
  if (!conn) {
    console.error(
      "[backup-postgres] Set DATABASE_URL or DATABASE_PUBLIC_URL (Railway Postgres public proxy).",
    );
    process.exit(1);
  }

  const backupTime = new Date().toISOString();
  const dir = path.join(BACKUPS_ROOT, stamp());
  await mkdir(path.join(dir, "tables"), { recursive: true });

  console.log(`[backup-postgres] target ${redactedTarget(conn)}`);
  console.log(`[backup-postgres] out    ${path.relative(ROOT, dir)}`);
  console.log(`[backup-postgres] time T ${backupTime}`);

  if (opts.pgDump) {
    try {
      await runPgDumpDocker(conn, dir);
      const meta = {
        backupTime,
        mode: "pg_dump-docker",
        source: redactedTarget(conn),
        service: "grudge-api",
        artifact: "full.dump",
        notes:
          "PlanetScale-style physical path uses base+WAL; this is a full logical custom dump for restore drills.",
      };
      await writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
      console.log("[backup-postgres] pg_dump OK → full.dump + meta.json");
      return;
    } catch (e) {
      console.error("[backup-postgres] --pg-dump failed:", e.message || e);
      process.exit(1);
    }
  }

  const { default: pg } = await loadPg();
  const { Client } = pg;
  const client = new Client({
    connectionString: conn,
    ssl: conn.includes("localhost") ? undefined : { rejectUnauthorized: false },
    application_name: "grudge-backup-postgres",
  });

  try {
    await client.connect();
    // Prefer read-only session when role allows
    try {
      await client.query("SET default_transaction_read_only = on");
    } catch {
      /* role may not allow */
    }

    const liveTables = await listPublicTables(client, opts.schema);
    if (opts.listTables) {
      console.log(liveTables.join("\n"));
      return;
    }

    const wanted = opts.tables?.length ? opts.tables : DEFAULT_TABLES;
    const tables = wanted.filter((t) => liveTables.includes(t));
    const missing = wanted.filter((t) => !liveTables.includes(t));
    if (missing.length) {
      console.warn(
        `[backup-postgres] skip missing tables: ${missing.join(", ")}`,
      );
    }
    if (!tables.length) {
      console.error(
        "[backup-postgres] no matching tables. Use --list-tables or --tables …",
      );
      process.exit(1);
    }

    console.log(
      `[backup-postgres] dumping ${tables.length} tables · concurrency ${opts.concurrency}`,
    );

    // One client cannot safely multi-query in parallel; use a pool.
    const pool = new pg.Pool({
      connectionString: conn,
      ssl: conn.includes("localhost") ? undefined : { rejectUnauthorized: false },
      max: opts.concurrency,
      application_name: "grudge-backup-postgres",
    });

    const tableResults = await mapPool(tables, opts.concurrency, async (table) => {
      const c = await pool.connect();
      try {
        try {
          await c.query("SET default_transaction_read_only = on");
        } catch {
          /* ignore */
        }
        const outPath = path.join(dir, "tables", `${table}.jsonl`);
        const result = await dumpTableJsonl(
          c,
          opts.schema,
          table,
          outPath,
          opts.gzip,
        );
        console.log(
          `  ✓ ${table.padEnd(28)} ${String(result.rowCount).padStart(8)} rows → ${result.path}`,
        );
        return result;
      } finally {
        c.release();
      }
    });

    await pool.end();

    const meta = {
      backupTime,
      mode: "parallel-jsonl",
      source: redactedTarget(conn),
      service: "grudge-api",
      schema: opts.schema,
      concurrency: opts.concurrency,
      gzip: opts.gzip,
      tables: tableResults,
      missing,
      r2Hint: `backups/postgres/grudge-api/${path.basename(dir)}/`,
      restoreDrill:
        "npm run restore:postgres -- --docker   # prove counts vs this meta.json",
      inspiration:
        "https://planetscale.com/blog/massively-parallel-postgres-backups",
    };
    await writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));

    const totalRows = tableResults.reduce((s, t) => s + (t.rowCount || 0), 0);
    console.log(
      `[backup-postgres] done · ${tableResults.length} tables · ${totalRows} rows · meta.json written`,
    );
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error("[backup-postgres] fatal:", e.message || e);
  process.exit(1);
});
