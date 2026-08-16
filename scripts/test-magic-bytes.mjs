/**
 * Quick smoke for shared magicBytes — run: node scripts/test-magic-bytes.mjs
 * (uses compiled dist if present, else fails closed with instructions)
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const compiled = join(root, "dist", "shared", "magicBytes.js");
if (!existsSync(compiled)) {
  console.error("Run npm run build:main first");
  process.exit(1);
}
const require = createRequire(import.meta.url);
const { probeMagic, assertMeshBytes } = require(compiled);

function ok(name, cond, detail) {
  if (!cond) {
    console.error("FAIL", name, detail);
    process.exitCode = 1;
  } else {
    console.log("OK  ", name, detail || "");
  }
}

// scene.gltf style: {\n  "asset"...
const pretty = Buffer.from(
  '{\n  "asset": { "version": "2.0" },\n  "scenes": [{ "nodes": [0] }],\n  "nodes": [{}],\n  "meshes": []\n}\n',
);
const pPretty = probeMagic(pretty);
ok("pretty gltf", pPretty.okForMesh && pPretty.kind === "gltf-json", pPretty.detail);

// late asset after extensionsUsed
const late = Buffer.from(
  JSON.stringify({
    extensionsUsed: Array.from({ length: 40 }, (_, i) => `EXT_${i}`),
    asset: { version: "2.0" },
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [] }],
  }),
);
const pLate = probeMagic(late);
ok("late asset gltf", pLate.okForMesh, pLate.detail);

// classic magic [7b a 20 20] with non-gltf JSON
const junk = Buffer.from("{\n  \"foo\": 1\n}");
const pJunk = probeMagic(junk);
ok("junk json rejected", !pJunk.okForMesh, pJunk.detail);

const html = Buffer.from("<!DOCTYPE html><html><body>404</body></html>");
ok("html rejected", !probeMagic(html).okForMesh, probeMagic(html).detail);

const err = Buffer.from('{ "error": "Not Found", "statusCode": 404 }');
ok("error json rejected", !probeMagic(err).okForMesh, probeMagic(err).detail);

const empty = Buffer.from("{}");
ok("empty stub rejected", !probeMagic(empty).okForMesh, probeMagic(empty).detail);

const glb = Buffer.alloc(24, 0);
glb[0] = 0x67; glb[1] = 0x6c; glb[2] = 0x54; glb[3] = 0x46;
ok("glb accepted", probeMagic(glb).okForMesh, probeMagic(glb).detail);

try {
  assertMeshBytes(html, "x.glb");
  ok("assert throws on html", false);
} catch (e) {
  ok("assert throws on html", /not a valid mesh/.test(e.message), e.message.slice(0, 60));
}

try {
  assertMeshBytes(pretty, "scene.gltf");
  ok("assert accepts scene.gltf", true);
} catch (e) {
  ok("assert accepts scene.gltf", false, e.message);
}

if (process.exitCode) {
  console.error("\nSome magicBytes checks failed");
  process.exit(1);
}
console.log("\nAll magicBytes checks passed");
