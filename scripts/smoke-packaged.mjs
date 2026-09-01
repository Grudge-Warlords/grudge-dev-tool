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
const exe = process.env.GRUDGE_PACKAGED_EXE
  ? path.resolve(process.env.GRUDGE_PACKAGED_EXE)
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
const { CONCEPT_WORKFLOW_VERSION, conceptSpecCanonical } = require(path.join(root, "dist", "shared", "conceptWorkflow.js"));
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
    checkedAt: "2026-09-01T00:00:00.000Z",
  },
  createdAt: "2026-09-01T00:00:00.000Z",
};
await writeFile(path.join(fixtureVariantRoot, "concept-review.json"), `${JSON.stringify({ method: "packaged-smoke-fixture", technicalStatus: "pass", semanticResemblanceChecked: false }, null, 2)}\n`);
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
    await cdp.send("Page.reload", { ignoreCache: true });

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
          return {
            ready: bodyText.includes("Prompt to 3D"),
            bodyText,
            hasGrudge: true,
            hasAuth: typeof api.auth.getSession === "function",
            hasAppRuntime: typeof api.appRuntime === "function",
            hasPrompt3D: typeof api.prompt3d.overview === "function",
            hasConceptApprovalBridge: typeof api.prompt3d.approveConcept === "function" && typeof api.prompt3d.regenerateConcept === "function",
            hasPendingApprovalState: bodyText.includes("Awaiting explicit approval") && bodyText.includes("semantic resemblance") && bodyText.includes("Exact current prompt"),
            hasApprovalActions: bodyText.includes("Approve for 3D") && bodyText.includes("Regenerate concept with new seed") && bodyText.includes("Edit prompt"),
            offlineLocalTest: runtime?.offlineLocalTest === true,
            signedIn: session?.signedIn === true,
            title: document.title,
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
    assert.ok(value.hasConceptApprovalBridge, "packaged concept approval bridge is missing");
    assert.ok(value.hasPendingApprovalState, `packaged pending-review state is missing: ${value.bodyText?.slice(-1200)}`);
    assert.ok(value.hasApprovalActions, `packaged approval actions are missing: ${value.bodyText?.slice(-1200)}`);
    assert.ok(value.offlineLocalTest, "packaged IPC did not report isolated offline-local-test mode");
    assert.ok(value.signedIn, "offline packaged auth contract did not initialize");
    assert.ok(value.ready, `packaged renderer did not render Prompt to 3D: ${value.bodyText?.slice(0, 500)}`);
    assert.ok(!value.bodyText.includes("Something went wrong"), "renderer reached the top-level error boundary");
    assert.ok(!value.bodyText.includes("Cannot read properties of undefined"), "renderer repeated the missing preload bridge failure");

    const exceptions = cdp.events.filter((event) => event.method === "Runtime.exceptionThrown");
    assert.equal(exceptions.length, 0, `renderer emitted uncaught exceptions: ${JSON.stringify(exceptions)}`);
    assert.ok(!existsSync(path.join(fixtureVariantRoot, "provider-output.glb")) && !existsSync(path.join(fixtureVariantRoot, "asset.glb")), "approval UI smoke must not start geometry");
    console.log(`[smoke-packaged] operational: ${value.title} · retained concept pending · approval actions visible · no geometry started`);
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
