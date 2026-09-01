import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preloadPath = path.join(root, "dist", "preload", "preload.js");
const source = fs.readFileSync(preloadPath, "utf8");

assert.doesNotMatch(source, /\brequire\s*\(\s*["']\.\.?[\\/]/, "sandboxed preload must not require sibling files at runtime");

const exposed = new Map();
const invocations = [];
const electron = {
  contextBridge: { exposeInMainWorld(name, value) { exposed.set(name, value); } },
  ipcRenderer: {
    invoke(channel, ...args) { invocations.push({ channel, args }); return Promise.resolve({ channel, args }); },
    on() {},
    removeListener() {},
  },
  webUtils: { getPathForFile() { return ""; } },
};

const module = { exports: {} };
vm.runInNewContext(source, {
  require(id) { assert.equal(id, "electron", `unexpected preload dependency: ${id}`); return electron; },
  module,
  exports: module.exports,
  console,
}, { filename: preloadPath });

const api = exposed.get("grudge");
assert.ok(api, "preload must expose window.grudge");
assert.equal(typeof api.auth?.getSession, "function", "auth bridge is missing");
assert.equal(typeof api.appRuntime, "function", "appRuntime bridge is missing");
assert.equal(typeof api.prompt3d?.overview, "function", "Prompt-to-3D bridge is missing");
assert.equal(typeof api.prompt3d?.approveConcept, "function", "Prompt-to-3D concept approval bridge is missing");
assert.equal(typeof api.prompt3d?.regenerateConcept, "function", "Prompt-to-3D concept regeneration bridge is missing");

await api.auth.getSession();
await api.appRuntime();
await api.prompt3d.approveConcept({ jobId: "fixture", binding: {} });
await api.prompt3d.regenerateConcept("fixture");
assert.deepEqual(
  invocations.map(({ channel }) => channel),
  ["auth:getSession", "app:runtime", "prompt3d:approve-concept", "prompt3d:regenerate-concept"],
  "preload bridge invoked unexpected IPC channels",
);

console.log("[test-preload-bundle] sandbox-safe approval bridge passed");
