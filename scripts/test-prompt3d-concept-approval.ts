import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Prompt3DService } from "../src/main/prompt3d/service";
import { readPrompt3DJobs } from "../src/main/prompt3d/history";
import {
  approvalProvenanceFields,
  assertGeometryApproval,
  createConceptApproval,
  createConceptBinding,
  inheritConceptHistory,
  nextConceptRetrySpec,
  sha256Hex,
} from "../src/main/prompt3d/conceptApproval";
import { sanitizeAssetSpec } from "../src/shared/conceptWorkflow";
import { PROMPT3D_SPEC_VERSION, type AssetSpecV1, type Prompt3DConceptAttempt, type Prompt3DJobStatus } from "../src/shared/prompt3d";
import { compilePrompt3DPrompt, withObjectRules } from "../src/shared/prompt3dRules";

async function main() {
const conceptHash = "a".repeat(64);
const spec = withObjectRules({
  version: PROMPT3D_SPEC_VERSION,
  prompt: "One complete brass handbell with a top loop, handle and open bell mouth",
  category: "prop",
  style: "stylized",
  route: "concept-image-to-3d",
  targetFormat: "glb",
  dimensions: { width: 1, height: 1, depth: 1, unit: "m" },
  budgets: { maxTriangles: 10_000, maxTextureResolution: 2048, maxTextureBytes: 32 * 1024 ** 2 },
  seed: 7,
  variants: 1,
  providerId: "hunyuan3d-2",
  generateTextures: false,
  generateCollision: true,
  generateLods: false,
  coordinateContract: { upAxis: "+Y", forwardAxis: "+Z", origin: "ground-center", stableRootName: "GrudgeAssetRoot" },
} satisfies AssetSpecV1);
const jobId = "11111111-1111-4111-8111-111111111111";
const binding = createConceptBinding(jobId, 1, spec, conceptHash);
const attempt: Prompt3DConceptAttempt = {
  attemptNumber: 1,
  binding,
  conceptImagePath: "E:\\Prompt3D\\jobs\\job\\variant-1\\concept.png",
  promptPlan: compilePrompt3DPrompt(spec),
  technicalReview: {
    status: "pass",
    method: "border-connected-white",
    message: "Framing passed; semantics were not checked.",
    reportPath: "E:\\Prompt3D\\jobs\\job\\variant-1\\concept-review.json",
    checkedAt: "2026-09-01T00:00:00.000Z",
  },
  createdAt: "2026-09-01T00:00:00.000Z",
};

assert.throws(
  () => assertGeometryApproval(jobId, spec, attempt, undefined, conceptHash),
  /Explicit concept approval is required/,
  "a crop/framing pass must not authorize geometry",
);

const approval = createConceptApproval(binding, "2026-09-01T00:01:00.000Z");
assert.doesNotThrow(
  () => assertGeometryApproval(jobId, spec, attempt, approval, conceptHash),
  "an exact explicit approval must authorize its retained concept",
);

for (const [label, changed, actualHash] of [
  ["prompt", { ...spec, prompt: `${spec.prompt} with engraving` }, conceptHash],
  ["seed", { ...spec, seed: spec.seed + 1 }, conceptHash],
  ["provider", { ...spec, providerId: "trellis", route: "direct-text" }, conceptHash],
  ["spec", { ...spec, dimensions: { ...spec.dimensions, height: 2 } }, conceptHash],
  ["hash", spec, "b".repeat(64)],
] as const) {
  assert.throws(
    () => assertGeometryApproval(jobId, changed as AssetSpecV1, attempt, approval, actualHash),
    /approval|stale|hash|provider/i,
    `${label} changes must invalidate approval`,
  );
}

const previous: Prompt3DJobStatus = {
  id: jobId,
  state: "awaiting-concept-approval",
  stage: "awaiting-concept-approval",
  progress: 35,
  providerId: spec.providerId,
  spec,
  message: "awaiting",
  outputDirectory: "E:\\Prompt3D\\jobs\\job",
  variants: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  conceptAttempt: attempt,
  conceptAttempts: [attempt],
  approvedConcept: false,
};
const retried = nextConceptRetrySpec(spec);
assert.equal(retried.seed, spec.seed + 1, "concept regeneration increments the seed exactly once");
assert.equal(retried.variants, 1, "concept regeneration remains one retained attempt");
assert.equal(retried.generateTextures, false, "concept regeneration cannot spend texture work");
const inherited = inheritConceptHistory(previous, "22222222-2222-4222-8222-222222222222", "regenerated", "2026-09-01T00:02:00.000Z");
assert.deepEqual(inherited.attempts, [attempt], "regeneration preserves the immutable prior concept attempt");
assert.equal(inherited.decisions.at(-1)?.kind, "regenerated");
assert.equal(inherited.decisions.at(-1)?.nextJobId, "22222222-2222-4222-8222-222222222222");

const legacy = { ...spec, originalPrompt: "a multi pointed 3d star shaped asteroid", approvedConcept: true } as AssetSpecV1;
const sanitized = sanitizeAssetSpec(legacy);
assert.ok(!("originalPrompt" in sanitized), "stale originalPrompt must never reappear in a current AssetSpec");
assert.ok(!("approvedConcept" in sanitized), "renderer/provider workflow fields must not enter a current AssetSpec");
assert.equal(sanitized.prompt, spec.prompt);

const provenance = approvalProvenanceFields(jobId, spec, attempt, approval, conceptHash);
assert.equal(provenance.approvedConcept, true);
assert.deepEqual(provenance.conceptApproval, approval, "final provenance uses the exact retained approval");
assert.throws(
  () => approvalProvenanceFields(jobId, spec, attempt, { ...approval, approvedAt: "invalid" }, conceptHash),
  /approval/i,
  "approvedConcept and provenance cannot disagree",
);

const serviceRoot = await mkdtemp(join(tmpdir(), "grudge-concept-approval-service-"));
try {
  const serviceJobId = "44444444-4444-4444-8444-444444444444";
  const outputDirectory = join(serviceRoot, "jobs", serviceJobId);
  const variantDirectory = join(outputDirectory, "variant-1");
  await mkdir(variantDirectory, { recursive: true });
  const conceptImagePath = join(variantDirectory, "concept.png");
  const conceptBytes = Buffer.from("retained-concept-fixture");
  await writeFile(conceptImagePath, conceptBytes);
  await writeFile(join(variantDirectory, "concept-review.json"), `${JSON.stringify({ method: "fixture", technicalStatus: "pass", semanticResemblanceChecked: false })}\n`);
  const serviceBinding = createConceptBinding(serviceJobId, 1, spec, sha256Hex(conceptBytes));
  const serviceAttempt: Prompt3DConceptAttempt = { ...attempt, binding: serviceBinding, conceptImagePath, technicalReview: { ...attempt.technicalReview, reportPath: join(variantDirectory, "concept-review.json") } };
  const pendingJob: Prompt3DJobStatus = {
    ...previous,
    id: serviceJobId,
    outputDirectory,
    conceptImagePath,
    conceptAttempt: serviceAttempt,
    conceptAttempts: [serviceAttempt],
  };
  const service = new Prompt3DService({ root: serviceRoot, appRoot: join(__dirname, ".."), offlineLocalTest: true });
  (service as unknown as { jobs: Map<string, Prompt3DJobStatus> }).jobs.set(serviceJobId, pendingJob);
  (service as unknown as { preflightAndDispatch: (job: Prompt3DJobStatus) => Promise<void> }).preflightAndDispatch = async () => undefined;
  const token = service.grant();
  const approved = await service.approveConcept(token, { jobId: serviceJobId, binding: serviceBinding });
  assert.equal(approved.state, "running", "durable approval must transition to a separately preflighted geometry resume");
  assert.equal(approved.approvedConcept, true);
  assert.equal(approved.conceptApproval?.source, "explicit-user-action");
  for (const path of [join(outputDirectory, "asset-spec.json"), join(variantDirectory, "asset-spec.json")]) {
    const recorded = JSON.parse(await readFile(path, "utf8"));
    assert.equal(recorded.prompt, spec.prompt, "root and variant specs must retain the exact current prompt");
    assert.equal(recorded.approvedConcept, true, "root and variant specs must agree with geometry authorization");
    assert.deepEqual(recorded.conceptApproval, approved.conceptApproval);
    assert.ok(!Object.hasOwn(recorded, "originalPrompt"), "stale originalPrompt must not be serialized");
  }
  const retainedApproval = JSON.parse(await readFile(join(variantDirectory, "concept-approval.json"), "utf8"));
  assert.deepEqual(retainedApproval, approved.conceptApproval, "approval must be durably retained before geometry preflight");
  const restored = await readPrompt3DJobs(serviceRoot);
  assert.equal(restored[0]?.error?.code, "INTERRUPTED", "an authentic approved resume reloads as interrupted, not as an approval mismatch");
  await writeFile(conceptImagePath, Buffer.from("tampered-concept-fixture"));
  const tampered = await readPrompt3DJobs(serviceRoot);
  assert.equal(tampered[0]?.error?.code, "CONCEPT_APPROVAL_MISMATCH", "changed retained concept bytes must fail closed on reload");
  assert.equal(tampered[0]?.error?.retryable, false, "a mismatched saved approval cannot be retried as geometry");
  service.shutdown();
} finally {
  await rm(serviceRoot, { recursive: true, force: true });
}

const workerSource = await readFile(join(__dirname, "..", "tools", "prompt3d", "provider_worker.py"), "utf8");
assert.ok(workerSource.includes("verify_concept_approval(spec, concept_path)"), "provider worker must independently verify the retained approval");
assert.ok(workerSource.includes('"prompt": spec["prompt"]'), "concept-prompt.json must retain the exact current user prompt, not replace it with the generated conditioning prompt");
assert.ok(workerSource.includes("approval_binding != binding"), "provider worker must independently match approval to the retained attempt binding");
assert.ok(workerSource.includes("Semantic resemblance, required parts and artistic quality remain unverified"), "technical review must not claim semantic resemblance");
assert.ok(workerSource.includes("if not approved:"), "Hunyuan must stop before geometry without explicit approval");

  process.stdout.write("Prompt-to-3D concept approval and provenance state-machine checks passed.\n");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
