import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "src", "preload", "preload.ts");
const outfile = path.join(root, "dist", "preload", "preload.js");

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
  sourcesContent: false,
  logLevel: "info",
});

console.log(`[build-preload] wrote sandbox-safe bundle: ${outfile}`);
