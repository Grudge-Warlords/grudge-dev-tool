#!/usr/bin/env node
// scripts/scaffold-r3f.mjs <target-dir>
// Copies templates/r3f-boilerplate to <target-dir>, skipping node_modules/dist.

import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = resolve(here, "..", "templates", "r3f-boilerplate");

const SKIP = new Set(["node_modules", "dist", ".vite", ".cache"]);

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const s = join(src, e.name);
    const d = join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(s, d);
    } else if (e.isFile()) {
      await fs.copyFile(s, d);
    }
  }
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: node scripts/scaffold-r3f.mjs <target-dir>");
    process.exit(2);
  }
  const dest = resolve(process.cwd(), target);
  try {
    const stat = await fs.stat(dest);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(dest);
      if (entries.length) {
        console.error(`[scaffold-r3f] target '${dest}' is non-empty. Aborting.`);
        process.exit(1);
      }
    }
  } catch { /* doesn't exist yet, fine */ }

  console.log(`[scaffold-r3f] copying ${TEMPLATE_DIR} \u2192 ${dest}`);
  await copyDir(TEMPLATE_DIR, dest);
  console.log(`[scaffold-r3f] done.`);
  console.log(`[scaffold-r3f] next:`);
  console.log(`  cd "${dest}"`);
  console.log(`  npm install`);
  console.log(`  npm run dev`);
}

main().catch((err) => {
  console.error("[scaffold-r3f] failed:", err.message);
  process.exit(1);
});
