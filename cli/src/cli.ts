#!/usr/bin/env node
import { Command } from "commander";
import { runSetup } from "./commands/setup.js";
import { runDoctor } from "./commands/doctor.js";
import { runLogin } from "./commands/login.js";
import { runFleet } from "./commands/fleet.js";
import { runUploadPack } from "./commands/upload-pack.js";
import { runSearch } from "./commands/search.js";
import { loadConfig } from "./lib/config.js";

const VERSION = "0.5.0";

const program = new Command();
program
  .name("grudge-dev")
  .description("Grudge Studio developer CLI — setup, health probes, asset packs")
  .version(VERSION);

program
  .command("setup")
  .description("Autonomous first-run: detect API + grudge-builder repo, write ~/.grudge-dev/config.json")
  .option("--api-base <url>", "Force API base (default: auto-detect client.grudge-studio.com → localhost)")
  .option("--repo <path>", "Path to grudge-builder checkout")
  .option("--json", "Machine-readable output")
  .action(async (opts) => {
    process.exit(await runSetup(opts));
  });

program
  .command("doctor")
  .description("ONE TRUTH health check — config, auth, fleet probes")
  .option("--api-base <url>", "Override API base")
  .option("--json", "Machine-readable output")
  .action(async (opts) => {
    process.exit(await runDoctor(opts));
  });

program
  .command("login")
  .description("Store admin JWT or X-Admin-Password (keytar or ~/.grudge-dev/auth.json)")
  .option("--token <jwt>", "Bearer token")
  .option("--admin-password <pw>", "Admin password for local/Railway uploads")
  .option("--grudge-id <id>", "Optional Grudge ID label")
  .action(async (opts) => {
    process.exit(await runLogin(opts));
  });

program
  .command("fleet")
  .description("Print canonical fleet URLs + live /api/fleet/manifest")
  .option("--json", "Machine-readable output")
  .action(async (opts) => {
    process.exit(await runFleet(opts));
  });

program
  .command("upload-pack")
  .description("Ingest a local asset pack → object storage (see grudge-builder docs/ASSET_PACKS.md)")
  .requiredOption("--root <dir>", "Pack root on disk")
  .requiredOption("--pack-id <id>", "Lower-kebab pack id")
  .option("--version <ver>", "Pack version", "0.0.0")
  .option("--license <lic>", "License string", "unknown")
  .option("--author <name>", "Author", "unknown")
  .option("--dry-run", "Walk + hash only, no uploads")
  .option("--api-base <url>", "Override API base")
  .action(async (opts) => {
    process.exit(await runUploadPack(opts));
  });

program
  .command("search")
  .description("Search asset-pack manifests via /api/objectstore/search")
  .option("-q, --q <query>", "Search query")
  .option("--pack <id>", "Filter by pack id")
  .option("--category <cat>", "Filter by category")
  .option("--api-base <url>", "Override API base")
  .option("--json", "Machine-readable output")
  .action(async (opts) => {
    process.exit(await runSearch(opts));
  });

program
  .command("status")
  .description("Quick summary of saved config")
  .action(() => {
    const cfg = loadConfig();
    if (!cfg) {
      console.log("Not configured — run: grudge-dev setup");
      process.exit(1);
    }
    console.log(JSON.stringify(cfg, null, 2));
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});