#!/usr/bin/env node
/**
 * Prove-restore for Grudge player SSOT dumps.
 *
 * SSOT: docs/database-backups-sharing.md
 *       https://grudge-warlords.github.io/grudge-dev-tool/database-backups-sharing.html
 *
 * Never defaults to production DATABASE_URL.
 * Weekly drill: load last dump into Docker Postgres and compare row counts to meta.json.
 *
 *   npm run restore:postgres -- --docker
 *   npm run restore:postgres -- --dir backups/<stamp> --docker
 *   RESTORE_DATABASE_URL=postgres://… npm run restore:postgres -- --dir backups/<stamp>
 *   npm run restore:postgres -- --dir backups/<stamp> --pg-restore --docker
 */

import { spawn } from "node:child_process";
import { createReadStream, readdirSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BACKUPS_ROOT = path.join(ROOT, "backups");

const CRITICAL = ["users", "accounts", "characters"];

const DOCKER_NAME = "grudge-restore-pg";
const DOCKER_PORT = 55432;
const DOCKER_URL = `postgres://postgres:restore@127.0.0.1:${DOCKER_PORT}/postgres`;

function parseArgs(argv) {
  const out = {
    dir: null,
    docker: false,
    keep: false,
    pgRestore: false,
    iKnowStaging: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--docker") out.docker = true;
    else if (a === "--keep") out.keep = true;
    else if (a === "--pg-restore") out.pgRestore = true;
    else if (a === "--i-know-staging") out.iKnowStaging = true;
    else if (a === "--dir" || a === "-d") out.dir = String(argv[++i] || "");
  }
  return out;
}

function latestBackupDir() {
  if (!existsSync(BACKUPS_ROOT)) return null;
  const dirs = readdirSync(BACKUPS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  return dirs.length ? path.join(BACKUPS_ROOT, dirs[dirs.length - 1]) : null;
}

function looksLikeProd(url) {
  const s = String(url || "").toLowerCase();
  return (
    s.includes("railway.app") ||
    s.includes("rlwy.net") ||
    s.includes("grudge-api-production")
  );
}

function restoreUrl(opts) {
  if (opts.docker) return DOCKER_URL;
  return (
    process.env.RESTORE_DATABASE_URL ||
    process.env.STAGING_DATABASE_URL ||
    ""
  ).trim();
}

function spawnWait(cmd, args, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: extra.stdio || "inherit", ...extra });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`)),
    );
  });
}

async function dockerUp() {
  try {
    await spawnWait("docker", ["rm", "-f", DOCKER_NAME], { stdio: "ignore" });
  } catch {
    /* none */
  }
  await spawnWait("docker", [
    "run",
    "-d",
    "--name",
    DOCKER_NAME,
    "-e",
    "POSTGRES_PASSWORD=restore",
    "-p",
    `${DOCKER_PORT}:5432`,
    "postgres:16",
  ]);
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      await spawnWait(
        "docker",
        ["exec", DOCKER_NAME, "pg_isready", "-U", "postgres"],
        { stdio: "ignore" },
      );
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw new Error("Docker Postgres did not become ready");
}

async function dockerDown() {
  try {
    await spawnWait("docker", ["rm", "-f", DOCKER_NAME], { stdio: "ignore" });
  } catch {
    /* ignore */
  }
}

async function loadPg() {
  try {
    return await import("pg");
  } catch {
    console.error("[restore-postgres] Missing `pg`. Install: npm i -D pg");
    process.exit(1);
  }
}

function tableFiles(dir) {
  const tablesDir = path.join(dir, "tables");
  if (!existsSync(tablesDir)) return [];
  return readdirSync(tablesDir)
    .filter((f) => /\.jsonl(\.gz)?$/i.test(f))
    .map((f) => ({
      file: path.join(tablesDir, f),
      table: f.replace(/\.jsonl(\.gz)?$/i, ""),
      gzip: /\.gz$/i.test(f),
    }));
}

async function* readJsonl(file, gzip) {
  const raw = createReadStream(file);
  const stream = gzip ? raw.pipe(createGunzip()) : raw;
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const s = line.trim();
    if (!s) continue;
    yield JSON.parse(s);
  }
}

async function loadJsonlTable(client, table, file, gzip) {
  const ident = `"restore_${table.replace(/"/g, "")}"`;
  await client.query(`DROP TABLE IF EXISTS ${ident}`);
  await client.query(`CREATE TABLE ${ident} (row jsonb NOT NULL)`);
  let n = 0;
  const batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const vals = batch.map((_, i) => `($${i + 1}::jsonb)`).join(",");
    await client.query(`INSERT INTO ${ident} (row) VALUES ${vals}`, batch);
    batch.length = 0;
  };
  for await (const row of readJsonl(file, gzip)) {
    batch.push(JSON.stringify(row));
    if (batch.length >= 200) await flush();
    n++;
  }
  await flush();
  return n;
}

function printHelp() {
  console.log(`Grudge Studio — prove-restore player dump

Never uses production DATABASE_URL. Staging or --docker only.

  npm run restore:postgres -- --docker
  npm run restore:postgres -- --dir backups/<stamp> --docker
  RESTORE_DATABASE_URL=postgres://… npm run restore:postgres -- --dir backups/<stamp>

Flags:
  --dir <path>         Dump folder (default: latest backups/*)
  --docker             Ephemeral postgres:16 on localhost:${DOCKER_PORT}
  --keep               Leave docker container running
  --pg-restore         Restore full.dump via Docker pg_restore (needs --docker)
  --i-know-staging     Allow RESTORE_DATABASE_URL that looks like Railway
  --help
`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const dir = opts.dir
    ? path.resolve(opts.dir)
    : latestBackupDir();
  if (!dir || !existsSync(dir)) {
    console.error(
      "[restore-postgres] No dump dir. Run npm run backup:postgres first, or pass --dir.",
    );
    process.exit(1);
  }

  const metaPath = path.join(dir, "meta.json");
  const meta = existsSync(metaPath)
    ? JSON.parse(await readFile(metaPath, "utf8"))
    : null;

  const url = restoreUrl(opts);
  if (!url) {
    console.error(
      "[restore-postgres] Set RESTORE_DATABASE_URL or pass --docker. Refusing production DATABASE_URL.",
    );
    process.exit(1);
  }
  if (looksLikeProd(url) && !opts.iKnowStaging) {
    console.error(
      "[restore-postgres] URL looks like production Railway. Use --docker or --i-know-staging on a dedicated staging DB.",
    );
    process.exit(1);
  }

  console.log(`[restore-postgres] dump ${path.relative(ROOT, dir)}`);
  if (meta?.backupTime) console.log(`[restore-postgres] time T ${meta.backupTime}`);

  let startedDocker = false;
  if (opts.docker) {
    console.log(`[restore-postgres] docker ${DOCKER_NAME} :${DOCKER_PORT}`);
    await dockerUp();
    startedDocker = true;
  }

  const fail = [];
  try {
    if (opts.pgRestore) {
      const dump = path.join(dir, "full.dump");
      if (!existsSync(dump)) {
        throw new Error("full.dump missing — run backup with --pg-dump");
      }
      await spawnWait("docker", [
        "run",
        "--rm",
        "--network",
        "host",
        "-e",
        `DATABASE_URL=${url}`,
        "-v",
        `${dir}:/in`,
        "postgres:16",
        "bash",
        "-lc",
        'pg_restore -d "$DATABASE_URL" --no-owner --no-acl /in/full.dump',
      ]);
      console.log("[restore-postgres] pg_restore finished");
    }

    const { default: pg } = await loadPg();
    const client = new pg.Client({
      connectionString: url,
      ssl: url.includes("127.0.0.1") || url.includes("localhost")
        ? undefined
        : { rejectUnauthorized: false },
      application_name: "grudge-restore-postgres",
    });
    await client.connect();
    try {
      const files = tableFiles(dir);
      if (!files.length && !opts.pgRestore) {
        fail.push("no tables/*.jsonl in dump");
      }
      const counts = {};
      for (const f of files) {
        const n = await loadJsonlTable(client, f.table, f.file, f.gzip);
        counts[f.table] = n;
        const expected = meta?.tables?.find?.((t) => t.table === f.table)?.rowCount;
        const mark =
          expected != null && expected !== n ? ` ≠ meta ${expected}` : "";
        console.log(
          `  ✓ ${f.table.padEnd(28)} ${String(n).padStart(8)} rows${mark}`,
        );
        if (expected != null && expected !== n) {
          fail.push(`${f.table} count ${n} != meta ${expected}`);
        }
      }
      for (const t of CRITICAL) {
        const n = counts[t];
        if (n == null) {
          console.warn(`[restore-postgres] critical table ${t} not in dump`);
          continue;
        }
        if (n === 0) fail.push(`critical ${t} restored 0 rows`);
      }
    } finally {
      await client.end().catch(() => {});
    }
  } finally {
    if (startedDocker && !opts.keep) await dockerDown();
    else if (startedDocker && opts.keep) {
      console.log(`[restore-postgres] kept ${DOCKER_NAME} · ${DOCKER_URL}`);
    }
  }

  if (fail.length) {
    console.error("[restore-postgres] FAIL\n  " + fail.join("\n  "));
    process.exit(1);
  }
  console.log("[restore-postgres] prove-restore OK");
}

main().catch((e) => {
  console.error("[restore-postgres] fatal:", e.message || e);
  process.exit(1);
});
