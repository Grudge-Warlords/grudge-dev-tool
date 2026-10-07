import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preloadPath = path.join(root, "dist", "preload", "preload.js");
const source = fs.readFileSync(preloadPath, "utf8");

assert.doesNotMatch(
  source,
  /\brequire\s*\(\s*["']\.\.?[\\/]/,
  "sandboxed preload must not require sibling files at runtime",
);

const exposed = new Map();
const invocations = [];
const subscriptions = [];
const removals = [];
const electron = {
  contextBridge: {
    executeInMainWorld({ func }) {
      const page = Object.fromEntries(exposed);
      vm.runInNewContext(`(${func.toString()})()`, page);
      assert.equal(typeof page.prompt, "function", "Embedded text prompt adapter is missing");
    },
    exposeInMainWorld(name, value) {
      exposed.set(name, value);
    },
  },
  ipcRenderer: {
    invoke(channel, ...args) {
      invocations.push({ channel, args });
      return Promise.resolve({ channel, args });
    },
    on(channel, listener) {
      subscriptions.push({ channel, listener });
    },
    removeListener(channel, listener) {
      removals.push({ channel, listener });
    },
  },
  webUtils: {
    getPathForFile() {
      return "";
    },
  },
};

const module = { exports: {} };
vm.runInNewContext(source, {
  require(id) {
    assert.equal(id, "electron", `unexpected preload dependency: ${id}`);
    return electron;
  },
  module,
  exports: module.exports,
  console,
}, { filename: preloadPath });

const api = exposed.get("grudge");
for (const key of ["begin", "end", "dialog", "browse", "answer", "request"]) assert.equal(typeof api.appNative[key], "function");
assert.equal(typeof api.embeddedActions.windows, "function");
assert.equal(typeof exposed.get("grudgeTextDialog"), "function");
assert.ok(api, "preload must expose window.grudge");
assert.equal(typeof api.auth?.getSession, "function", "auth bridge is missing");
assert.equal(typeof api.appRuntime, "function", "appRuntime bridge is missing");
assert.equal(typeof api.prompt3d?.overview, "function", "Prompt-to-3D bridge is missing");
assert.equal(typeof api.prompt3d?.chooseReferenceImage, "function", "Prompt-to-3D local reference-image picker bridge is missing");
assert.equal(typeof api.prompt3d?.chooseReferenceImages, "function", "Prompt-to-3D multiview reference picker bridge is missing");
assert.equal(typeof api.prompt3d?.approveConcept, "function", "Prompt-to-3D concept approval bridge is missing");
assert.equal(typeof api.prompt3d?.rejectConcept, "function", "Prompt-to-3D classified concept rejection bridge is missing");
assert.equal(typeof api.prompt3d?.regenerateConcept, "function", "Prompt-to-3D concept regeneration bridge is missing");
assert.equal(typeof api.prompt3d?.finishStart, "function", "Prompt-to-3D finish-start bridge is missing");
assert.equal(typeof api.prompt3d?.finishHistory, "function", "Prompt-to-3D finish-history bridge is missing");
assert.equal(typeof api.prompt3d?.finishStatus, "function", "Prompt-to-3D finish-status bridge is missing");
assert.equal(typeof api.prompt3d?.finishCancel, "function", "Prompt-to-3D finish-cancel bridge is missing");
assert.equal(typeof api.prompt3d?.workflowApproveVisual, "function", "Prompt-to-3D visual-approval bridge is missing");
assert.equal(typeof api.prompt3d?.workflowRejectFinishVisual, "function", "Prompt-to-3D visual-rejection bridge is missing");
assert.equal(typeof api.prompt3d?.workflowSave, "function", "Prompt-to-3D workflow-save bridge is missing");
assert.equal(typeof api.prompt3d?.workflowLibrary, "function", "Prompt-to-3D workflow-library bridge is missing");
assert.equal(typeof api.prompt3d?.workflowExport, "function", "Prompt-to-3D workflow-export bridge is missing");
assert.equal(typeof api.prompt3d?.workflowExportHistory, "function", "Prompt-to-3D workflow-export-history bridge is missing");
assert.equal(typeof api.prompt3d?.workflowVerifyArtifact, "function", "Prompt-to-3D workflow-artifact verification bridge is missing");
assert.equal(typeof api.prompt3d?.onFinishProgress, "function", "Prompt-to-3D finish-progress bridge is missing");
assert.equal(typeof api.prompt3d?.batchStart, "function", "Prompt-to-3D batch-start bridge is missing");
assert.equal(typeof api.prompt3d?.batchStatus, "function", "Prompt-to-3D batch-status bridge is missing");
assert.equal(typeof api.prompt3d?.batchCancel, "function", "Prompt-to-3D batch-cancel bridge is missing");
assert.equal(typeof api.prompt3d?.batchRetry, "function", "Prompt-to-3D batch-retry bridge is missing");
assert.equal(typeof api.prompt3d?.batchExport, "function", "Prompt-to-3D batch-export bridge is missing");
assert.equal(typeof api.prompt3d?.onBatchProgress, "function", "Prompt-to-3D batch-progress bridge is missing");
assert.equal(typeof api.creation?.submit, "function", "Original creation bridge is missing");
assert.equal(typeof api.appActions?.plan, "function", "App-wide local action planner bridge is missing");
assert.equal(typeof api.embeddedActions?.observe, "function", "Embedded observation bridge is missing");
assert.equal(typeof api.embeddedActions?.execute, "function", "Embedded execution bridge is missing");
assert.equal(typeof api.creation?.history, "function", "Retained creation history bridge is missing");
assert.equal(typeof api.creation?.reopen, "function", "Local replay bridge is missing");
assert.equal(typeof api.forge?.saveExport, "function", "Forge native-save bridge is missing");

await api.auth.getSession();
await api.appRuntime();
await api.prompt3d.chooseReferenceImage();
await api.prompt3d.chooseReferenceImages();
const finishSource = { kind: "finish", jobId: "finish-job" };
const visualInspection = {
  version: 1,
  assetPath: "E:\\GrudgePrompt3D\\workflow-history\\finish-job\\asset.glb",
  assetSha256: "a".repeat(64),
  stage: "animation",
  viewpoints: ["front", "right", "back", "left"].map((preset) => ({ preset, inspectedAt: "2026-09-03T00:00:00.000Z" })),
  attestations: {
    geometryIdentityAndCompleteness: { accepted: true, at: "2026-09-03T00:00:00.000Z" },
    animationMotionMatchesPrompt: { accepted: true, at: "2026-09-03T00:00:00.000Z" },
  },
  clips: [{ index: 0, name: "Motion", duration: 1, playedSeconds: 1, completedAt: "2026-09-03T00:00:01.000Z" }],
  updatedAt: "2026-09-03T00:00:01.000Z",
  completedAt: "2026-09-03T00:00:01.000Z",
};
const rejectedConceptRequest = {
  jobId: "concept-job",
  binding: { jobId: "concept-job" },
  inspection: {
    checks: {
      identityAndRequiredParts: "fail",
      subjectPresentation: "pass",
      framingBackgroundAndSupport: "pass",
    },
    classification: "semantic-anatomy-parts",
    note: "Required part is missing.",
  },
};
const rejectedFinishRequest = {
  source: finishSource,
  classification: "motion-mismatch",
  note: "The retained movement does not match the requested grounded forward walk.",
};
await api.prompt3d.rejectConcept(rejectedConceptRequest);
await api.prompt3d.finishStart({ source: finishSource, operation: "animation", instruction: "hop forward" });
await api.prompt3d.finishHistory();
await api.prompt3d.finishStatus("finish-job");
await api.prompt3d.finishCancel("finish-job");
await api.prompt3d.workflowApproveVisual({ source: finishSource, inspection: visualInspection });
await api.prompt3d.workflowRejectFinishVisual(rejectedFinishRequest);
await api.prompt3d.workflowSave(finishSource);
await api.prompt3d.workflowLibrary();
await api.prompt3d.workflowExport(finishSource);
await api.prompt3d.workflowExportHistory();
await api.prompt3d.workflowVerifyArtifact({ kind: "portable", id: "export-record" });
await api.prompt3d.batchStart({ name: "fixture batch", items: [] });
await api.prompt3d.batchStatus();
await api.prompt3d.batchCancel("batch-job");
await api.prompt3d.batchRetry("batch-job", "item-a");
await api.prompt3d.batchExport("batch-job");
await api.forge.saveExport({ name: "asset.glb", bytes: new Uint8Array([1, 2, 3]) });
assert.deepEqual(
  invocations.map(({ channel }) => channel),
  [
    "auth:getSession",
    "app:runtime",
    "prompt3d:choose-reference-image",
    "prompt3d:choose-reference-images",
    "prompt3d:reject-concept",
    "prompt3d:finish-start",
    "prompt3d:finish-history",
    "prompt3d:finish-status",
    "prompt3d:finish-cancel",
    "prompt3d:approve-visual",
    "prompt3d:reject-finish-visual",
    "prompt3d:workflow-save",
    "prompt3d:workflow-library",
    "prompt3d:workflow-export",
    "prompt3d:workflow-export-history",
    "prompt3d:workflow-verify-artifact",
    "prompt3d:batch-start",
    "prompt3d:batch-status",
    "prompt3d:batch-cancel",
    "prompt3d:batch-retry",
    "prompt3d:batch-export",
    "forge:saveExport",
  ],
  "preload bridge invoked unexpected IPC channels",
);
assert.deepEqual(
  invocations.find(({ channel }) => channel === "prompt3d:reject-concept")?.args,
  [rejectedConceptRequest],
  "classified concept rejection must retain its exact hash-bound request across the preload bridge",
);
assert.deepEqual(
  invocations.find(({ channel }) => channel === "prompt3d:batch-status")?.args,
  [undefined],
  "batch status must support a typed latest-manifest request without inventing an ID",
);
assert.deepEqual(
  invocations.find(({ channel }) => channel === "prompt3d:batch-retry")?.args,
  ["batch-job", "item-a"],
  "batch retry must retain the explicit current-item binding",
);
assert.deepEqual(
  invocations.find(({ channel }) => channel === "prompt3d:approve-visual")?.args,
  [{ source: finishSource, inspection: visualInspection }],
  "visual approval must send the retained asset source plus completed same-panel inspection evidence for authoritative main-process binding",
);
assert.deepEqual(
  invocations.find(({ channel }) => channel === "prompt3d:reject-finish-visual")?.args,
  [rejectedFinishRequest],
  "visual rejection must send the exact retained revision, classification and note across the preload bridge",
);
assert.deepEqual(
  invocations.find(({ channel }) => channel === "prompt3d:workflow-verify-artifact")?.args,
  [{ kind: "portable", id: "export-record" }],
  "artifact verification must retain the exact copy kind and durable record ID",
);

const unsubscribeFinish = api.prompt3d.onFinishProgress(() => {});
assert.equal(subscriptions.at(-1)?.channel, "prompt3d:finish-progress", "finish-progress subscription used the wrong IPC channel");
unsubscribeFinish();
assert.equal(removals.at(-1)?.channel, "prompt3d:finish-progress", "finish-progress unsubscribe used the wrong IPC channel");
assert.equal(removals.at(-1)?.listener, subscriptions.at(-1)?.listener, "finish-progress unsubscribe removed a different listener");

const unsubscribeBatch = api.prompt3d.onBatchProgress(() => {});
assert.equal(subscriptions.at(-1)?.channel, "prompt3d:batch-progress", "batch-progress subscription used the wrong IPC channel");
unsubscribeBatch();
assert.equal(removals.at(-1)?.channel, "prompt3d:batch-progress", "batch-progress unsubscribe used the wrong IPC channel");
assert.equal(removals.at(-1)?.listener, subscriptions.at(-1)?.listener, "batch-progress unsubscribe removed a different listener");

console.log("[test-preload-bundle] sandbox-safe preload bridge passed");
