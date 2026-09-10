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

await build({
  entryPoints: [path.join(root, "src/renderer/lib/embeddedActionGuest.ts")],
  outfile: path.join(root, "dist/embedded/appActionGuest.js"),
  bundle: true, platform: "browser", format: "iife", globalName: "GrudgeEmbeddedGuest",
  target: "chrome140", logLevel: "info",
});

await build({
  entryPoints: [path.join(root, "src/preload/guestDialogs.ts")],
  outfile: path.join(root, "dist/preload/guestDialogs.js"),
  bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], logLevel: "info",
});
