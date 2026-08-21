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
const { probeMagic, parseFbxVersion, assertMeshBytes } = require(compiled);

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

const ascii61 = Buffer.from("; FBX 6.1.0 project file\nFBXHeaderExtension:  {\n\tFBXVersion: 6100\n}\n");
const v61 = parseFbxVersion(ascii61);
ok("ascii 6100 detected", v61.format === "ascii" && v61.version === 6100 && !v61.threeSupported, v61.detail);

const binHdr = Buffer.alloc(32);
Buffer.from("Kaydara FBX Binary  \u0000").copy(binHdr, 0);
binHdr[21] = 0x1a;
binHdr[22] = 0x00;
binHdr.writeUInt32LE(7500, 23);
const v75 = parseFbxVersion(binHdr);
ok("binary 7500 three-ok", v75.format === "binary" && v75.version === 7500 && v75.threeSupported, v75.detail);

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
