/**
 * Run uMMORPG disk extract + Forge catalog + publish static-json.
 * Requires sibling ObjectStore at F:/GitHub/ObjectStore (or OBJECTSTORE_ROOT).
 *
 * Usage: npm run catalog:ummorpg
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OS =
  process.env.OBJECTSTORE_ROOT ||
  resolve(__dirname, "../../ObjectStore");

if (!existsSync(OS)) {
  console.error("ObjectStore not found at", OS);
  console.error("Set OBJECTSTORE_ROOT or clone next to grudge-dev-tool.");
  process.exit(1);
}

const steps = [
  ["node", ["scripts/extract-ummorpg-for-warlords.mjs"]],
  ["node", ["scripts/build-ummorpg-forge-catalog.mjs"]],
  [
    "node",
    [
      "scripts/publish-static-json.mjs",
      "ummorpg-skills-for-forge",
      "ummorpg-placeables-for-forge",
      "ummorpg-extract-index",
    ],
  ],
];

for (const [cmd, args] of steps) {
  console.log("\n>", cmd, args.join(" "));
  const r = spawnSync(cmd, args, {
    cwd: OS,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if (r.status !== 0) {
    console.error("Failed:", cmd, args.join(" "), "exit", r.status);
    process.exit(r.status || 1);
  }
}

console.log("\n✓ uMMORPG catalog extract + Forge sync + publish complete");
console.log("  ObjectStore:", OS);
console.log("  Live: https://objectstore.grudge-studio.com/api/v1/ummorpg-placeables-for-forge.json");
