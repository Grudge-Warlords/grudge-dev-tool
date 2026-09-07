import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  allowedHttpsUrl,
  approvalState,
  capCandidates,
  generateSpdx,
  mergeCandidateQueue,
  mutationGate,
  npmPackagePurl,
  policyDigest,
  sameCleanGitSnapshot,
  scoreCandidate,
  summarizeMarkdown,
  validatePolicy,
} from "./maintenance-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_POLICY = JSON.parse(readFileSync(join(ROOT, "config", "maintenance.policy.json"), "utf8"));

test("default policy is valid and fail-closed", () => {
  assert.deepEqual(validatePolicy(DEFAULT_POLICY), []);
  assert.equal(approvalState(DEFAULT_POLICY).valid, false);
  const gate = mutationGate(DEFAULT_POLICY, { available: true, head: "abc", branch: "main", dirty: false });
  assert.equal(gate.allowed, false);
  assert.match(gate.blockers.join("\n"), /discovery-only/);
  assert.match(gate.blockers.join("\n"), /write authority is disabled/);
});

test("unknown policy keys fail closed", () => {
  const policy = structuredClone(DEFAULT_POLICY);
  policy.authority.networkDiscoverry = true;
  assert.match(validatePolicy(policy).join("\n"), /networkDiscoverry is not recognized/);
});

test("authorized network and validation planes require bounded wall time and approved scripts", () => {
  const policy = structuredClone(DEFAULT_POLICY);
  policy.authority.networkDiscovery = true;
  policy.budgets.networkMiB = 1;
  policy.budgets.reservePercent = 20;
  policy.discovery.maxCandidates = 10;
  policy.discovery.requestTimeoutSeconds = 5;
  assert.match(validatePolicy(policy).join("\n"), /network discovery requires budgets.wallClockMinutes/);

  policy.validation.npmScripts = ["test:preload"];
  assert.match(validatePolicy(policy).join("\n"), /validation script is not allowed: test:preload/);
  policy.validation.npmScripts = ["build:preload"];
  policy.budgets.wallClockMinutes = 5;
  assert.equal(validatePolicy(policy).some((error) => error.includes("build:preload")), false);
});

test("approval binds to the exact policy digest and dirty trees remain blocked", () => {
  const policy = structuredClone(DEFAULT_POLICY);
  policy.mode = "bounded-staging";
  policy.authority.writeRepository = true;
  policy.authority.createIsolatedStaging = true;
  policy.authority.runLocalValidation = true;
  for (const key of Object.keys(policy.budgets)) policy.budgets[key] = 10;
  policy.budgets.reservePercent = 20;
  policy.scoring.minimumForStaging = 5;
  policy.validation.holdMinutes = 5;
  policy.approval = {
    approved: true,
    approvedBy: "owner",
    approvedAt: "2026-09-05T00:00:00.000Z",
    policyDigest: policyDigest(policy),
  };
  assert.equal(approvalState(policy).valid, true);
  assert.equal(mutationGate(policy, { available: true, head: "abc", branch: "main", dirty: false }).allowed, true);
  assert.equal(mutationGate(policy, { available: true, head: "abc", branch: "main", dirty: true }).allowed, false);
  assert.equal(mutationGate(policy, { available: false, head: null, branch: null, dirty: false }).allowed, false);
  policy.budgets.changedLines = 11;
  assert.equal(approvalState(policy).valid, false);
});

test("candidate score rewards evidence and penalizes risk", () => {
  const weights = DEFAULT_POLICY.scoring.weights;
  const safe = scoreCandidate({ value: 4, evidence: 5, reversibility: 5, testability: 5, risk: 1, resourceCost: 1 }, weights);
  const risky = scoreCandidate({ value: 4, evidence: 2, reversibility: 1, testability: 1, risk: 5, resourceCost: 5 }, weights);
  assert.ok(safe > risky);
});

test("network allowlist requires exact HTTPS hosts", () => {
  const hosts = DEFAULT_POLICY.discovery.allowedHosts;
  assert.equal(allowedHttpsUrl("https://registry.npmjs.org/react/latest", hosts), true);
  assert.equal(allowedHttpsUrl("http://registry.npmjs.org/react/latest", hosts), false);
  assert.equal(allowedHttpsUrl("https://registry.npmjs.org.example.test/react", hosts), false);
});

test("candidate cap is strict and scoped npm purls preserve the namespace separator", () => {
  const capped = capCandidates([{ kind: "security" }, { kind: "security" }, { kind: "update" }], 1);
  assert.deepEqual(capped, { items: [{ kind: "security" }], overflow: [{ kind: "security" }, { kind: "update" }], omitted: 2 });
  assert.equal(npmPackagePurl("@alloc/quick-lru", "5.2.0"), "pkg:npm/%40alloc/quick-lru@5.2.0");
});

test("candidate queue retains capped overflow for the next run", () => {
  const observedAt = "2026-09-05T00:00:00.000Z";
  const pending = mergeCandidateQueue(
    [{ id: "older", title: "Older update", kind: "dependency-update", score: 1, firstSeenAt: "2026-09-04T00:00:00.000Z", lastSeenAt: "2026-09-04T00:00:00.000Z", status: "pending" }],
    [{ id: "security", title: "Security advisory", kind: "security-advisory", score: 4 }],
    observedAt,
  );
  const capped = capCandidates(pending, 1);
  assert.equal(capped.items[0].id, "security");
  assert.equal(capped.overflow[0].id, "older");
  assert.equal(pending.length, 2);
  assert.equal(pending.find((candidate) => candidate.id === "older").firstSeenAt, "2026-09-04T00:00:00.000Z");
});

test("source seal rejects dirty, moved, or unavailable Git state", () => {
  const clean = { available: true, dirty: false, head: "abc", branch: "main" };
  assert.equal(sameCleanGitSnapshot(clean, clean), true);
  assert.equal(sameCleanGitSnapshot(clean, { ...clean, dirty: true }), false);
  assert.equal(sameCleanGitSnapshot(clean, { ...clean, head: "def" }), false);
  assert.equal(sameCleanGitSnapshot(clean, { ...clean, available: false }), false);
});

test("SPDX output records direct dependency provenance without URL credentials", () => {
  const packageJson = { name: "fixture", version: "1.0.0", license: "UNLICENSED" };
  const packageLock = {
    packages: {
      "": { dependencies: { react: "1.0.0" } },
      "node_modules/react": {
        version: "1.0.0",
        resolved: "https://user:secret@registry.npmjs.org/react/-/react-1.0.0.tgz?token=secret",
        integrity: `sha512-${Buffer.from("fixture").toString("base64")}`,
        license: "MIT"
      }
    }
  };
  const sbom = generateSpdx({ packageJson, packageLock, createdAt: "2026-09-05T00:00:00.000Z", documentSeed: "fixture" });
  assert.equal(sbom.spdxVersion, "SPDX-2.3");
  assert.equal(sbom.packages.length, 2);
  assert.equal(sbom.packages[0].licenseDeclared, "NONE");
  assert.equal(sbom.packages[1].downloadLocation, "https://registry.npmjs.org/react/-/react-1.0.0.tgz");
  assert.equal(sbom.relationships.some((item) => item.relationshipType === "DEPENDS_ON"), true);
  assert.doesNotMatch(JSON.stringify(sbom), /secret/);
});

test("summary keeps evidence classes and unknown resource fields explicit", () => {
  const evidence = Object.fromEntries(["source", "build", "package", "runtime", "provider", "deployment", "device"].map((key) => [key, { status: "not established", detail: "none" }]));
  const summary = summarizeMarkdown({
    runId: "fixture",
    startedAt: "2026-09-05T00:00:00.000Z",
    mode: "discovery-only",
    scheduled: false,
    policy: { approval: { valid: false } },
    mutationGate: { allowed: false },
    baseline: { git: { dirty: false, head: "abc" }, gpu: { processes: [] } },
    decisions: [{ action: "unchanged", reason: "closed" }],
    checks: [],
    candidates: [],
    evidence,
    ledger: { wallClockMinutes: 0, networkBytes: 0, stateBytesWritten: 0, changedFiles: 0, changedLines: null, inputTokens: null, outputTokens: null, retries: 0 },
    deferred: ["approval"],
    rollback: "none required",
  });
  assert.match(summary, /package: not established/);
  assert.match(summary, /Changed lines observed: unknown/);
});
