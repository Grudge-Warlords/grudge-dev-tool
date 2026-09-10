import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const requestedExe = process.env.GRUDGE_PACKAGED_EXE || process.argv[2];
const exe = requestedExe
  ? path.resolve(requestedExe)
  : path.join(root, "release", "win-unpacked", "Grudge Dev Tool.exe");
assert.equal(process.platform, "win32", "packaged smoke currently targets the Windows bundle");
assert.ok(existsSync(exe), `packaged executable is missing: ${exe}`);

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForTarget(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // The debugging listener is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`packaged renderer did not expose a debugging target on 127.0.0.1:${port}`);
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const events = [];
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    events.push(message);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, send, events };
}

const port = await reservePort();
const tempBase = path.resolve(os.tmpdir());
const profile = await mkdtemp(path.join(tempBase, "grudge-dev-tool-smoke-"));
const promptRoot = path.join(profile, "prompt3d");
await mkdir(promptRoot, { recursive: true });
const fixtureJobId = "33333333-3333-4333-8333-333333333333";
const fixtureJobRoot = path.join(promptRoot, "jobs", fixtureJobId);
const fixtureVariantRoot = path.join(fixtureJobRoot, "variant-1");
await mkdir(fixtureVariantRoot, { recursive: true });
const fixtureConceptPath = path.join(fixtureVariantRoot, "concept.png");
const fixtureConcept = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z6i8AAAAASUVORK5CYII=", "base64");
await writeFile(fixtureConceptPath, fixtureConcept);
const fixtureSpec = {
  version: "1.0.0",
  prompt: "One complete brass handbell with a top loop, handle and open bell mouth",
  category: "prop",
  style: "stylized",
  route: "concept-image-to-3d",
  targetFormat: "glb",
  dimensions: { width: 1, height: 1, depth: 1, unit: "m" },
  budgets: { maxTriangles: 10000, maxTextureResolution: 2048, maxTextureBytes: 33554432 },
  seed: 91,
  variants: 1,
  providerId: "hunyuan3d-2",
  generateTextures: false,
  generateCollision: true,
  generateLods: false,
  coordinateContract: { upAxis: "+Y", forwardAxis: "+Z", origin: "ground-center", stableRootName: "GrudgeAssetRoot" },
};
const { CONCEPT_WORKFLOW_VERSION, conceptSpecCanonical, stableJson } = require(path.join(root, "dist", "shared", "conceptWorkflow.js"));
const { compilePrompt3DPrompt } = require(path.join(root, "dist", "shared", "prompt3dRules.js"));
const canonical = conceptSpecCanonical(fixtureSpec);
const conceptSha256 = createHash("sha256").update(fixtureConcept).digest("hex");
const fixtureBinding = {
  version: 1,
  workflowVersion: CONCEPT_WORKFLOW_VERSION,
  jobId: fixtureJobId,
  attemptId: `${fixtureJobId}:concept:1`,
  conceptSha256,
  prompt: fixtureSpec.prompt,
  seed: fixtureSpec.seed,
  providerId: fixtureSpec.providerId,
  specVersion: fixtureSpec.version,
  specCanonical: canonical,
  specFingerprint: createHash("sha256").update(canonical).digest("hex"),
  referenceSha256: null,
};
const fixturePromptPlan = compilePrompt3DPrompt(fixtureSpec);
const fixtureReview = {
  version: 1,
  method: "packaged-smoke-fixture",
  technicalStatus: "pass",
  semanticResemblanceChecked: false,
  visualReviewRequired: true,
};
const fixtureReviewBytes = `${JSON.stringify(fixtureReview, null, 2)}\n`;
const fixtureAttempt = {
  attemptNumber: 1,
  binding: fixtureBinding,
  conceptImagePath: fixtureConceptPath,
  promptPlan: fixturePromptPlan,
  technicalReview: {
    status: "pass",
    method: "packaged-smoke-fixture",
    message: "Background isolation, foreground bounds and edge clearance passed. Semantic resemblance, required parts and artistic quality were not checked.",
    reportPath: path.join(fixtureVariantRoot, "concept-review.json"),
    reportSha256: createHash("sha256").update(fixtureReviewBytes).digest("hex"),
    presentationContractSha256: createHash("sha256").update(stableJson(fixturePromptPlan.presentationContract)).digest("hex"),
    reportVersion: 1,
    semanticResemblanceChecked: false,
    visualReviewRequired: true,
    checkedAt: "2026-09-01T00:00:00.000Z",
  },
  createdAt: "2026-09-01T00:00:00.000Z",
};
await writeFile(path.join(fixtureVariantRoot, "concept-review.json"), fixtureReviewBytes);
await writeFile(path.join(fixtureJobRoot, "asset-spec.json"), `${JSON.stringify({ ...fixtureSpec, promptPlan: fixturePromptPlan, conceptOnly: true, approvedConcept: false, conceptAttempt: fixtureAttempt }, null, 2)}\n`);
await writeFile(path.join(fixtureJobRoot, "job-status.json"), `${JSON.stringify({
  id: fixtureJobId,
  state: "awaiting-concept-approval",
  stage: "awaiting-concept-approval",
  progress: 35,
  providerId: fixtureSpec.providerId,
  spec: fixtureSpec,
  message: "Concept retained · awaiting explicit visual approval. Geometry has not started and semantic resemblance is unverified.",
  outputDirectory: fixtureJobRoot,
  variants: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  conceptOnly: true,
  approvedConcept: false,
  conceptImagePath: fixtureConceptPath,
  conceptAttempt: fixtureAttempt,
  conceptAttempts: [fixtureAttempt],
  conceptDecisions: [],
  promptPlan: fixturePromptPlan,
  timings: [],
}, null, 2)}\n`);

let stdout = "";
let stderr = "";
const child = spawn(exe, [`--remote-debugging-port=${port}`, "--enable-logging=stderr"], {
  cwd: path.dirname(exe),
  windowsHide: true,
  shell: false,
  env: {
    ...process.env,
    GRUDGE_OFFLINE_LOCAL_TEST: "1",
    GRUDGE_TEST_PROFILE: profile,
    GRUDGE_PROMPT3D_ROOT: promptRoot,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (chunk) => { stdout += String(chunk); });
child.stderr.on("data", (chunk) => { stderr += String(chunk); });

try {
  const target = await waitForTarget(port);
  const cdp = await connect(target.webSocketDebuggerUrl);
  try {
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Page.enable");
    const granted = await cdp.send("Runtime.evaluate", {
      expression: "globalThis.grudge?.prompt3d?.grant?.()",
      awaitPromise: true,
      returnByValue: true,
    });
    if (granted.exceptionDetails) throw new Error(granted.exceptionDetails.text || "packaged local-controls grant failed");
    assert.equal(granted.result?.value?.enabled, true, "packaged local controls could not be enabled for the isolated smoke window");
    await cdp.send("Page.reload", { ignoreCache: true });

    // Even retained pending Hunyuan history must not take over the default page.
    let defaultPage;
    for (let i = 0; i < 100; i++) {
      const observed = await cdp.send("Runtime.evaluate", { expression: `({ prompt: Boolean(document.querySelector('[aria-label="Grudge Dev prompt"]')), neural: Boolean(document.querySelector('[data-app-action-context="Optional neural generation"]')), run: [...document.querySelectorAll('button')].some(b => b.textContent === 'Run with Grudge') })`, returnByValue: true });
      defaultPage = observed.result?.value;
      if (defaultPage?.prompt) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(defaultPage?.prompt, true, "default page must expose the automatic Grudge prompt");
    assert.equal(defaultPage?.run, true);
    assert.equal(defaultPage?.neural, false, "pending Hunyuan history must not gate the default workspace");
    await cdp.send("Runtime.evaluate", { expression: `[...document.querySelectorAll('button')].find(b => b.textContent === 'Optional Hunyuan enhancement').click()` });

    let value;
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const evaluated = await cdp.send("Runtime.evaluate", {
        expression: `(async () => {
          const api = globalThis.grudge;
          const bodyText = document.body?.innerText || "";
          if (!api?.auth?.getSession || !api?.appRuntime || !api?.prompt3d?.overview) {
            return { ready: false, bodyText, hasGrudge: Boolean(api) };
          }
           const runtime = await api.appRuntime();
           const session = await api.auth.getSession();
           const generationHistory = await api.prompt3d.history().catch((error) => ({ error: String(error) }));
           const finishHistory = await api.prompt3d.finishHistory().catch((error) => ({ error: String(error) }));
           return {
            ready: bodyText.includes("Prompt to 3D"),
            bodyText,
            hasGrudge: true,
            hasAuth: typeof api.auth.getSession === "function",
            hasAppRuntime: typeof api.appRuntime === "function",
            hasPrompt3D: typeof api.prompt3d.overview === "function",
            prompt3dKeys: Object.keys(api.prompt3d || {}).sort(),
            hasConceptApprovalBridge: typeof api.prompt3d.approveConcept === "function" && typeof api.prompt3d.regenerateConcept === "function",
            hasReferenceImageBridge: typeof api.prompt3d.chooseReferenceImage === "function" && typeof api.prompt3d.chooseReferenceImages === "function",
            hasFinishWorkflowBridge: typeof api.prompt3d.finishStart === "function" && typeof api.prompt3d.workflowSave === "function" && typeof api.prompt3d.workflowExport === "function" && typeof api.prompt3d.onFinishProgress === "function",
            hasBatchWorkflowBridge: typeof api.prompt3d.batchStart === "function" && typeof api.prompt3d.batchStatus === "function" && typeof api.prompt3d.batchExport === "function" && typeof api.prompt3d.onBatchProgress === "function",
            hasPendingApprovalState: bodyText.includes("Review and approve the Hunyuan concept") && bodyText.includes("I inspected this concept") && ["Identity and required parts", "Subject presentation", "Framing, background and support"].every(label => document.body.textContent.includes(label)),
            hasApprovalActions: bodyText.includes("Approve concept for geometry") && bodyText.includes("Reject and retain reason"),
            hasDefaultPresentationContract: bodyText.includes("plain-white background") && bodyText.includes("none support") && bodyText.includes("none scenery"),
            hasUnifiedWorkflowUI: Boolean(document.querySelector('[data-testid="prompt3d-route-planner"]')) && bodyText.toLowerCase().includes("current creation stage") && bodyText.includes("Only the current concept or current model revision appears here"),
            hasStageFocusedPanels: JSON.stringify(Array.from(document.querySelectorAll("[data-panel]")).map((node) => node.getAttribute("data-panel"))) === JSON.stringify(["install-options", "creation", "preview"]),
            hasExistingRouteChoices: ["Hunyuan 3D", "TRELLIS", "Original procedural CPU creator", "Deterministic CPU rig and animation"].every(label => document.body.textContent.includes(label)),
            offlineLocalTest: runtime?.offlineLocalTest === true,
            signedIn: session?.signedIn === true,
             title: document.title,
             localControlsEnabled: runtime?.localControlsEnabled === true,
             latestGeneration: generationHistory?.latestJob ? { id: generationHistory.latestJob.id, state: generationHistory.latestJob.state, error: generationHistory.latestJob.error } : null,
             generationHistoryError: generationHistory?.error,
             finishHistoryError: finishHistory?.error,
           };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.text || "renderer evaluation failed");
      value = evaluated.result?.value;
      if (value?.ready && value?.hasPendingApprovalState && value?.hasApprovalActions) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    assert.ok(value?.hasGrudge, "window.grudge was not exposed by the packaged preload");
    assert.ok(value.hasAuth, "packaged auth bridge is missing");
    assert.ok(value.hasAppRuntime, "packaged appRuntime bridge is missing");
    assert.ok(value.hasPrompt3D, "packaged Prompt-to-3D bridge is missing");
    assert.ok(value.hasConceptApprovalBridge, `packaged concept approval bridge is missing: ${JSON.stringify(value.prompt3dKeys)}`);
    assert.ok(value.hasReferenceImageBridge, `packaged reference-image picker bridge is missing: ${JSON.stringify(value.prompt3dKeys)}`);
    assert.ok(value.hasFinishWorkflowBridge, "packaged texture/animation/save/export bridge is missing");
    assert.ok(value.hasBatchWorkflowBridge, "packaged serial-batch bridge is missing");
    assert.ok(value.hasPendingApprovalState, `packaged pending-review state is missing: ${JSON.stringify({ localControlsEnabled: value.localControlsEnabled, latestGeneration: value.latestGeneration, generationHistoryError: value.generationHistoryError, finishHistoryError: value.finishHistoryError })} · ${value.bodyText?.slice(-1200)}`);
    assert.ok(value.hasApprovalActions, `packaged approval actions are missing: ${value.bodyText?.slice(-1200)}`);
    assert.ok(value.hasDefaultPresentationContract, `packaged default presentation contract is missing: ${value.bodyText?.slice(-1600)}`);
    assert.ok(value.hasUnifiedWorkflowUI, `packaged unified workflow controls are missing: ${value.bodyText?.slice(0, 1600)}`);
    assert.ok(value.hasStageFocusedPanels, `packaged page did not render only Install Options, creation and preview panels: ${value.bodyText?.slice(0, 2000)}`);
    assert.ok(value.hasExistingRouteChoices, "packaged Prompt-to-3D did not expose the allowlisted existing route choices");
    assert.ok(value.offlineLocalTest, "packaged IPC did not report isolated offline-local-test mode");
    assert.ok(value.signedIn, "offline packaged auth contract did not initialize");
    assert.ok(value.ready, `packaged renderer did not render Prompt to 3D: ${value.bodyText?.slice(0, 500)}`);
    assert.ok(!value.bodyText.includes("Something went wrong"), "renderer reached the top-level error boundary");
    assert.ok(!value.bodyText.includes("Cannot read properties of undefined"), "renderer repeated the missing preload bridge failure");

    const embeddedBridge = await cdp.send("Runtime.evaluate", { expression: `(async () => {
      const api = window.grudge.embeddedActions;
      if (!api?.observe || !api?.execute) return { exposed: false };
      let invalidGuest = '', invalidReceipt = '';
      try { await api.observe({ surface: 'forge', webContentsId: -1 }); } catch (e) { invalidGuest = String(e); }
      try { await api.execute({ token: 'not-an-observation', prompt: 'Change a setting', decision: {} }); } catch (e) { invalidReceipt = String(e); }
      return { exposed: true, invalidGuest, invalidReceipt };
    })()`, awaitPromise: true, returnByValue: true });
    assert.equal(embeddedBridge.result?.value?.exposed, true, "packaged embedded bridge is missing");
    assert.match(embeddedBridge.result.value.invalidGuest, /does not belong|Invalid embedded/, "packaged embedded bridge accepted an unrelated target");
    assert.match(embeddedBridge.result.value.invalidReceipt, /expired/, "packaged embedded bridge accepted an invented observation");

    const startedNewAsset = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const button = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes("Start new asset"));
        if (!button || button.disabled) return false;
        button.click();
        return true;
      })()`,
      returnByValue: true,
    });
    assert.equal(startedNewAsset.result?.value, true, "packaged workflow could not start a new asset");

    let sourceStage;
    const sourceDeadline = Date.now() + 5_000;
    while (Date.now() < sourceDeadline) {
      const evaluated = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const bodyText = document.body?.innerText || "";
          const buttons = Array.from(document.querySelectorAll("button")).map((candidate) => candidate.textContent?.trim());
          return {
            hasSourcePanel: Boolean(document.querySelector('[data-testid="prompt3d-initial-image-source"]')),
            hasPromptOnly: buttons.some((value) => value?.startsWith("Prompt only")),
            hasOneImage: buttons.some((value) => value?.startsWith("One image")),
            hasFourViews: buttons.some((value) => value?.startsWith("Four views")),
            isFirstStage: bodyText.includes("Choose a starting point") && bodyText.includes("Stage 1 of 9"),
            hidesPromptSettings: !bodyText.includes("Subject prompt") && !bodyText.includes("Triangle budget"),
          };
        })()`,
        returnByValue: true,
      });
      sourceStage = evaluated.result?.value;
      if (sourceStage?.hasSourcePanel && sourceStage?.hasPromptOnly && sourceStage?.hasOneImage && sourceStage?.hasFourViews) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(sourceStage?.hasSourcePanel && sourceStage?.hasPromptOnly && sourceStage?.hasOneImage && sourceStage?.hasFourViews, `packaged first image-source stage is incomplete: ${JSON.stringify(sourceStage)}`);
    assert.ok(sourceStage.isFirstStage && sourceStage.hidesPromptSettings, `packaged source choice is not isolated as Stage 1: ${JSON.stringify(sourceStage)}`);

    const choseGeneratedImage = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const button = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent?.startsWith("Prompt only"));
        if (!button || button.disabled) return false;
        button.click();
        return true;
      })()`,
      returnByValue: true,
    });
    assert.equal(choseGeneratedImage.result?.value, true, "packaged Prompt only action was not operational");

    let promptStage;
    const promptDeadline = Date.now() + 5_000;
    while (Date.now() < promptDeadline) {
      const evaluated = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const bodyText = document.body?.innerText || "";
          return {
            sourcePanelHidden: !document.querySelector('[data-testid="prompt3d-initial-image-source"]'),
            isPromptStage: bodyText.includes("Prompt, dimensions and generation settings") && bodyText.includes("Stage 2 of 9"),
            generatedSourceShown: bodyText.includes("Starting image: Generate with local HunyuanDiT"),
            hasPromptSettings: bodyText.includes("Subject prompt") && Boolean(document.querySelector('[data-testid="prompt3d-optional-settings"]')),
            optionalSettingsCollapsed: document.querySelector('[data-testid="prompt3d-optional-settings"]')?.open === false,
            primaryInputCount: Array.from(document.querySelector('[data-app-action-context="Optional neural generation"]').querySelectorAll("textarea,input,select")).filter((element) => element.getClientRects().length && !element.closest('details:not([open])') && !element.closest('[data-testid="prompt3d-initial-image-source"]')).filter((element) => element.tagName === "TEXTAREA").length,
          };
        })()`,
        returnByValue: true,
      });
      promptStage = evaluated.result?.value;
      if (promptStage?.sourcePanelHidden && promptStage?.isPromptStage && promptStage?.hasPromptSettings) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(promptStage?.sourcePanelHidden && promptStage?.isPromptStage && promptStage?.generatedSourceShown && promptStage?.hasPromptSettings, `Prompt only did not advance to prompt/settings: ${JSON.stringify(promptStage)}`);
    assert.equal(promptStage.optionalSettingsCollapsed, true, "optional generation settings should start collapsed");
    assert.equal(promptStage.primaryInputCount, 1, "creation should expose one primary prompt");

    // Exercise actual text entry: number inputs previously sanitized '-' into an accepted zero.
    await cdp.send("Runtime.evaluate", { expression: `(() => {
      document.querySelector('[data-testid="prompt3d-optional-settings"]').open = true;
      const label = Array.from(document.querySelectorAll('label')).find(element => element.textContent.trim() === 'Seed');
      const input = label?.querySelector('input');
      if (!input) throw new Error('Seed input missing');
      input.focus(); input.select();
    })()` });
    await cdp.send("Input.insertText", { text: "-" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const invalidSeed = await cdp.send("Runtime.evaluate", { expression: `(() => {
      const label = Array.from(document.querySelectorAll('label')).find(element => element.textContent.trim() === 'Seed');
      return { raw: label?.querySelector('input')?.value, error: document.body.innerText.includes('Seed must be a whole number'),
        blocked: Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Generate Hunyuan concept'))?.disabled };
    })()`, returnByValue: true });
    assert.deepEqual(invalidSeed.result?.value, { raw: "-", error: true, blocked: true });
    await cdp.send("Runtime.evaluate", { expression: `(() => {
      const input = Array.from(document.querySelectorAll('label')).find(element => element.textContent.trim() === 'Seed').querySelector('input');
      input.focus(); input.select();
    })()` });
    await cdp.send("Input.insertText", { text: "42" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const recoveredSeed = await cdp.send("Runtime.evaluate", { expression: `(() => {
      const input = Array.from(document.querySelectorAll('label')).find(element => element.textContent.trim() === 'Seed').querySelector('input');
      return { raw: input.value, error: document.body.innerText.includes('Seed must be a whole number') };
    })()`, returnByValue: true });
    assert.deepEqual(recoveredSeed.result?.value, { raw: "42", error: false });
    await cdp.send("Runtime.evaluate", { expression: `document.querySelector('[data-testid="prompt3d-optional-settings"]').open = false` });
    await cdp.send("Runtime.evaluate", { expression: `document.querySelector('[data-panel="creation"]').scrollIntoView({ block: 'start' })` });
    if (process.env.GRUDGE_SMOKE_SCREENSHOT) {
      const captured = await cdp.send("Page.captureScreenshot", { format: "png" });
      await writeFile(path.resolve(process.env.GRUDGE_SMOKE_SCREENSHOT), Buffer.from(captured.data, "base64"));
    }

    const exceptions = cdp.events.filter((event) => event.method === "Runtime.exceptionThrown");
    assert.equal(exceptions.length, 0, `renderer emitted uncaught exceptions: ${JSON.stringify(exceptions)}`);
    assert.ok(!existsSync(path.join(fixtureVariantRoot, "provider-output.glb")) && !existsSync(path.join(fixtureVariantRoot, "asset.glb")), "approval UI smoke must not start geometry");
    console.log(`[smoke-packaged] operational: ${value.title} · retained concept pending · new asset opens at input choice · Prompt only advances to prompt/settings · no geometry started`);
  } finally {
    cdp.socket.close();
  }
} catch (error) {
  if (stdout.trim()) console.error("[smoke-packaged stdout]", stdout.trim());
  if (stderr.trim()) console.error("[smoke-packaged stderr]", stderr.trim());
  throw error;
} finally {
  if (child.exitCode === null) {
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
  if (child.exitCode === null) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
  }
  const resolvedProfile = path.resolve(profile);
  assert.ok(resolvedProfile.startsWith(`${tempBase}${path.sep}`) && path.basename(resolvedProfile).startsWith("grudge-dev-tool-smoke-"));
  await rm(resolvedProfile, { recursive: true, force: true });
}
