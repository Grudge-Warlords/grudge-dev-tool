import { createHash } from "node:crypto";

export const STATE_SEQUENCE = Object.freeze([
  "baseline",
  "discover",
  "triage",
  "provenance",
  "validate",
  "score",
  "stage",
  "hold",
  "summarize",
]);

export const EVIDENCE_CLASSES = Object.freeze([
  "source",
  "build",
  "package",
  "runtime",
  "provider",
  "deployment",
  "device",
]);

export const ALWAYS_APPROVAL = Object.freeze([
  "major dependency upgrades",
  "schema or data migrations",
  "destructive data operations",
  "permission or network-exposure changes",
  "secret or credential changes",
  "model or provider changes and model downloads",
  "deployment or release",
  "termination of a process not started by this run",
  "ambiguous security changes",
]);

export const PREAUTHORIZED_REPAIR_CONSTRAINTS = Object.freeze([
  "isolated staging only",
  "small and reversible diff",
  "no dependency, API, schema, permission, provider, secret, network, or data change",
  "focused and full configured validation must pass",
  "rollback material and evidence ledger must exist",
]);

export const VALIDATION_SCRIPTS = Object.freeze([
  "typecheck",
  "build:preload",
  "maintenance:test",
  "test:magic",
]);

const BUDGET_KEYS = [
  "wallClockMinutes",
  "inputTokens",
  "outputTokens",
  "gpuMinutes",
  "gpuVramMiB",
  "diskReadMiB",
  "diskWriteMiB",
  "networkMiB",
  "changedFiles",
  "changedLines",
  "retries",
  "reservePercent",
];

const AUTHORITY_KEYS = [
  "networkDiscovery",
  "runLocalValidation",
  "writeRepository",
  "createIsolatedStaging",
  "installDependencies",
  "promoteChanges",
  "commitChanges",
  "pushChanges",
  "deployOrRelease",
  "changeSecretsOrPermissions",
  "downloadModels",
  "stopUnownedProcesses",
];

function rejectUnknownKeys(errors, object, path, allowed) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return;
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) errors.push(`${path}.${key} is not recognized`);
  }
}

export function sha256(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return createHash("sha256").update(input).digest("hex");
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function policyDigest(policy) {
  const copy = structuredClone(policy);
  delete copy.$schema;
  copy.approval = {
    approved: false,
    approvedBy: null,
    approvedAt: null,
    policyDigest: null,
  };
  return sha256(stableJson(copy));
}

export function validatePolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return ["policy must be an object"];
  rejectUnknownKeys(errors, policy, "policy", ["$schema", "schemaVersion", "mode", "schedule", "approval", "stateDirectory", "protectedPaths", "authority", "budgets", "discovery", "validation", "scoring"]);
  rejectUnknownKeys(errors, policy.schedule, "schedule", ["enabled", "rrule", "notificationPolicy"]);
  rejectUnknownKeys(errors, policy.approval, "approval", ["approved", "approvedBy", "approvedAt", "policyDigest"]);
  rejectUnknownKeys(errors, policy.authority, "authority", AUTHORITY_KEYS);
  rejectUnknownKeys(errors, policy.budgets, "budgets", BUDGET_KEYS);
  rejectUnknownKeys(errors, policy.discovery, "discovery", ["registryMetadata", "osvAudit", "maxCandidates", "requestTimeoutSeconds", "allowedHosts"]);
  rejectUnknownKeys(errors, policy.validation, "validation", ["npmScripts", "holdMinutes"]);
  rejectUnknownKeys(errors, policy.scoring, "scoring", ["minimumForStaging", "weights"]);
  rejectUnknownKeys(errors, policy.scoring?.weights, "scoring.weights", ["value", "evidence", "reversibility", "testability", "risk", "resourceCost"]);
  if (policy.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!new Set(["discovery-only", "bounded-staging"]).has(policy.mode)) {
    errors.push("mode must be discovery-only or bounded-staging");
  }
  if (!policy.schedule || typeof policy.schedule.enabled !== "boolean") errors.push("schedule.enabled must be boolean");
  if (policy.schedule?.rrule !== null && typeof policy.schedule?.rrule !== "string") errors.push("schedule.rrule must be null or a string");
  if (policy.schedule?.notificationPolicy !== null && typeof policy.schedule?.notificationPolicy !== "string") errors.push("schedule.notificationPolicy must be null or a string");
  if (!policy.approval || typeof policy.approval.approved !== "boolean") errors.push("approval.approved must be boolean");
  if (policy.approval?.approvedBy !== null && typeof policy.approval?.approvedBy !== "string") errors.push("approval.approvedBy must be null or a string");
  if (policy.approval?.approvedAt !== null && (typeof policy.approval?.approvedAt !== "string" || Number.isNaN(Date.parse(policy.approval.approvedAt)))) errors.push("approval.approvedAt must be null or an ISO date-time string");
  if (policy.approval?.policyDigest !== null && (typeof policy.approval?.policyDigest !== "string" || !/^[a-f0-9]{64}$/.test(policy.approval.policyDigest))) errors.push("approval.policyDigest must be null or a lowercase SHA-256 digest");
  if (policy.stateDirectory !== null && typeof policy.stateDirectory !== "string") errors.push("stateDirectory must be null or a string");
  if (!Array.isArray(policy.protectedPaths) || policy.protectedPaths.some((value) => typeof value !== "string")) errors.push("protectedPaths must be a string array");

  for (const key of AUTHORITY_KEYS) {
    if (typeof policy.authority?.[key] !== "boolean") errors.push(`authority.${key} must be boolean`);
  }
  for (const key of BUDGET_KEYS) {
    const value = policy.budgets?.[key];
    if (value !== null && !(typeof value === "number" && Number.isFinite(value) && value >= 0)) {
      errors.push(`budgets.${key} must be null or a non-negative number`);
    }
  }
  if (policy.budgets?.reservePercent !== null && policy.budgets?.reservePercent > 100) {
    errors.push("budgets.reservePercent must not exceed 100");
  }
  if (!Array.isArray(policy.discovery?.allowedHosts) || policy.discovery.allowedHosts.some((v) => typeof v !== "string")) {
    errors.push("discovery.allowedHosts must be a string array");
  }
  for (const key of ["registryMetadata", "osvAudit"]) {
    if (typeof policy.discovery?.[key] !== "boolean") errors.push(`discovery.${key} must be boolean`);
  }
  for (const key of ["maxCandidates", "requestTimeoutSeconds"]) {
    const value = policy.discovery?.[key];
    if (value !== null && !(typeof value === "number" && Number.isFinite(value) && value > 0)) {
      errors.push(`discovery.${key} must be null or a positive number`);
    }
  }
  if (!Array.isArray(policy.validation?.npmScripts) || policy.validation.npmScripts.some((v) => typeof v !== "string")) {
    errors.push("validation.npmScripts must be a string array");
  } else {
    for (const script of policy.validation.npmScripts) {
      if (!VALIDATION_SCRIPTS.includes(script)) errors.push(`validation script is not allowed: ${script}`);
    }
  }
  for (const key of ["value", "evidence", "reversibility", "testability", "risk", "resourceCost"]) {
    const value = policy.scoring?.weights?.[key];
    if (!(typeof value === "number" && Number.isFinite(value) && value >= 0)) {
      errors.push(`scoring.weights.${key} must be a non-negative number`);
    }
  }
  if (policy.authority?.networkDiscovery) {
    if (policy.budgets?.wallClockMinutes === null) errors.push("network discovery requires budgets.wallClockMinutes");
    if (policy.budgets?.networkMiB === null) errors.push("network discovery requires budgets.networkMiB");
    if (policy.budgets?.reservePercent === null) errors.push("network discovery requires budgets.reservePercent");
    if (policy.discovery?.maxCandidates === null) errors.push("network discovery requires discovery.maxCandidates");
    if (policy.discovery?.requestTimeoutSeconds === null) errors.push("network discovery requires discovery.requestTimeoutSeconds");
  }
  if (policy.authority?.runLocalValidation) {
    if (policy.budgets?.wallClockMinutes === null) errors.push("local validation requires budgets.wallClockMinutes");
    if (policy.budgets?.reservePercent === null) errors.push("local validation requires budgets.reservePercent");
  }
  const minimumForStaging = policy.scoring?.minimumForStaging;
  if (minimumForStaging !== null && !(typeof minimumForStaging === "number" && Number.isFinite(minimumForStaging))) {
    errors.push("scoring.minimumForStaging must be null or a number");
  }
  const holdMinutes = policy.validation?.holdMinutes;
  if (holdMinutes !== null && !(typeof holdMinutes === "number" && Number.isFinite(holdMinutes) && holdMinutes >= 0)) {
    errors.push("validation.holdMinutes must be null or a non-negative number");
  }
  return errors;
}

export function approvalState(policy) {
  const expectedDigest = policyDigest(policy);
  const valid = policy.approval?.approved === true
    && typeof policy.approval?.approvedBy === "string"
    && policy.approval.approvedBy.trim().length > 0
    && typeof policy.approval?.approvedAt === "string"
    && !Number.isNaN(Date.parse(policy.approval.approvedAt))
    && policy.approval?.policyDigest === expectedDigest;
  return {
    valid,
    expectedDigest,
    configuredDigest: policy.approval?.policyDigest ?? null,
    reason: valid ? null : "owner approval is absent, incomplete, expired by policy change, or bound to another digest",
  };
}

export function mutationGate(policy, baseline = {}) {
  const approval = approvalState(policy);
  const blockers = [];
  if (policy.mode !== "bounded-staging") blockers.push("mode is discovery-only");
  if (!approval.valid) blockers.push(approval.reason);
  if (!policy.authority?.writeRepository) blockers.push("repository write authority is disabled");
  if (!policy.authority?.createIsolatedStaging) blockers.push("isolated staging authority is disabled");
  if (!policy.authority?.runLocalValidation) blockers.push("local validation authority is disabled");
  if (!policy.validation?.npmScripts?.length) blockers.push("no validation scripts are configured");
  if (baseline.available !== true) blockers.push("git provenance is unavailable");
  if (!baseline.head) blockers.push("source revision is unavailable");
  if (!baseline.branch) blockers.push("source branch is unavailable");
  if (baseline.dirty) blockers.push("authoritative checkout is dirty; existing work must be preserved");
  for (const key of BUDGET_KEYS) {
    if (policy.budgets?.[key] === null) blockers.push(`budget ${key} is unconfigured`);
  }
  if (policy.scoring?.minimumForStaging === null) blockers.push("minimum staging score is unconfigured");
  if (policy.validation?.holdMinutes === null) blockers.push("hold duration is unconfigured");
  return { allowed: blockers.length === 0, blockers, approval };
}

export function budgetStatus(limit, used, reservePercent) {
  if (limit === null || limit === undefined) return { configured: false, allowed: false, remaining: null, usableLimit: null };
  const reserve = reservePercent === null || reservePercent === undefined ? 0 : reservePercent;
  const usableLimit = limit * (1 - reserve / 100);
  return {
    configured: true,
    allowed: used < usableLimit,
    remaining: Math.max(0, usableLimit - used),
    usableLimit,
  };
}

export function scoreCandidate(candidate, weights) {
  const dimensions = ["value", "evidence", "reversibility", "testability", "risk", "resourceCost"];
  for (const key of dimensions) {
    const value = candidate[key];
    if (!(typeof value === "number" && value >= 0 && value <= 5)) throw new Error(`${key} must be between 0 and 5`);
  }
  const positive = candidate.value * weights.value
    + candidate.evidence * weights.evidence
    + candidate.reversibility * weights.reversibility
    + candidate.testability * weights.testability;
  const negative = candidate.risk * weights.risk + candidate.resourceCost * weights.resourceCost;
  return Number((positive - negative).toFixed(2));
}

export function allowedHttpsUrl(rawUrl, allowedHosts) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") return false;
  return allowedHosts.includes(url.hostname);
}

export function sameCleanGitSnapshot(expected, current) {
  return expected.available === true
    && current.available === true
    && !expected.dirty
    && !current.dirty
    && !!expected.head
    && expected.head === current.head
    && !!expected.branch
    && expected.branch === current.branch;
}

export function capCandidates(candidates, maximum) {
  const limit = Math.max(0, Math.floor(maximum));
  return { items: candidates.slice(0, limit), overflow: candidates.slice(limit), omitted: Math.max(0, candidates.length - limit) };
}

export function mergeCandidateQueue(previous, discovered, observedAt) {
  const byId = new Map();
  for (const candidate of previous) byId.set(candidate.id, candidate);
  for (const candidate of discovered) {
    const earlier = byId.get(candidate.id);
    const { decision: _decision, ...portable } = candidate;
    byId.set(candidate.id, {
      ...earlier,
      ...portable,
      firstSeenAt: earlier?.firstSeenAt || observedAt,
      lastSeenAt: observedAt,
      status: "pending",
    });
  }
  return [...byId.values()].sort((left, right) => {
    const securityOrder = Number(right.kind === "security-advisory") - Number(left.kind === "security-advisory");
    if (securityOrder) return securityOrder;
    const scoreOrder = Number(right.score || 0) - Number(left.score || 0);
    return scoreOrder || String(left.firstSeenAt || "").localeCompare(String(right.firstSeenAt || "")) || left.id.localeCompare(right.id);
  });
}

export function npmPackagePurl(name, version) {
  const parts = String(name).split("/");
  const encodedName = parts[0].startsWith("@") && parts.length === 2
    ? `${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function cleanSpdxId(value) {
  return String(value).replace(/[^A-Za-z0-9.-]/g, "-");
}

function integrityChecksum(integrity) {
  const match = typeof integrity === "string" ? integrity.match(/^sha512-([^\s]+)$/) : null;
  if (!match) return [];
  try {
    return [{ algorithm: "SHA512", checksumValue: Buffer.from(match[1], "base64").toString("hex").toUpperCase() }];
  } catch {
    return [];
  }
}

function safeDownloadLocation(resolved) {
  if (typeof resolved !== "string" || !resolved.startsWith("https://")) return "NOASSERTION";
  try {
    const url = new URL(resolved);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "NOASSERTION";
  }
}

function packageNameFromLockPath(lockPath) {
  const normalized = String(lockPath).replace(/\\/g, "/");
  const tail = normalized.split("node_modules/").at(-1);
  if (!tail || tail === normalized) return null;
  const parts = tail.split("/");
  return parts[0]?.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

export function generateSpdx({ packageJson, packageLock, createdAt, documentSeed }) {
  const rootId = "SPDXRef-RootPackage";
  const packages = [{
    SPDXID: rootId,
    name: packageJson.name,
    versionInfo: packageJson.version,
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared: packageJson.license === "UNLICENSED" ? "NONE" : packageJson.license || "NOASSERTION",
    copyrightText: "NOASSERTION",
  }];
  const idByLockPath = new Map();
  let index = 0;
  for (const [lockPath, entry] of Object.entries(packageLock.packages || {})) {
    const packageName = entry?.name || packageNameFromLockPath(lockPath);
    if (!lockPath || !packageName || !entry?.version) continue;
    index += 1;
    const id = `SPDXRef-Package-${cleanSpdxId(packageName)}-${cleanSpdxId(entry.version)}-${index}`;
    idByLockPath.set(lockPath, id);
    packages.push({
      SPDXID: id,
      name: packageName,
      versionInfo: entry.version,
      downloadLocation: safeDownloadLocation(entry.resolved),
      filesAnalyzed: false,
      checksums: integrityChecksum(entry.integrity),
      licenseConcluded: "NOASSERTION",
      licenseDeclared: typeof entry.license === "string" ? entry.license : "NOASSERTION",
      copyrightText: "NOASSERTION",
      externalRefs: [{
        referenceCategory: "PACKAGE-MANAGER",
        referenceType: "purl",
        referenceLocator: npmPackagePurl(packageName, entry.version),
      }],
    });
  }
  const rootLock = packageLock.packages?.[""] || {};
  const directNames = new Set([
    ...Object.keys(rootLock.dependencies || {}),
    ...Object.keys(rootLock.devDependencies || {}),
  ]);
  const relationships = [{ spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: rootId }];
  for (const name of directNames) {
    const dependencyId = idByLockPath.get(`node_modules/${name}`);
    if (dependencyId) relationships.push({ spdxElementId: rootId, relationshipType: "DEPENDS_ON", relatedSpdxElement: dependencyId });
  }
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `${packageJson.name}-${packageJson.version}-maintenance-sbom`,
    documentNamespace: `https://github.com/Grudge-Warlords/grudge-dev-tool/sbom/${sha256(documentSeed)}`,
    creationInfo: { created: createdAt, creators: ["Tool: Grudge-Dev-Tool-Maintenance-1"] },
    packages,
    relationships,
  };
}

export function summarizeMarkdown(run) {
  const yesNo = (value) => value ? "yes" : "no";
  const formatMiB = (bytes) => typeof bytes === "number" ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : "unavailable";
  const gpuLines = run.baseline.gpu.processes.length
    ? run.baseline.gpu.processes.map((process) => `- PID ${process.pid}: ${process.processName} — ${process.usedMemoryMiB === null ? "VRAM unavailable" : `${process.usedMemoryMiB} MiB`}; ${process.ownership}`)
    : ["- No GPU process was reported by the available device probe."];
  const budgetLines = Object.entries(run.ledger.budgets || {}).map(([key, value]) => `- ${key}: ${value ?? "unconfigured"}`);
  const lines = [
    `# Grudge Dev Tool maintenance summary — ${run.startedAt.slice(0, 10)}`,
    "",
    `- Run: \`${run.runId}\``,
    `- Mode: \`${run.mode}\``,
    `- Scheduled invocation: ${yesNo(run.scheduled)}`,
    `- Policy approval valid: ${yesNo(run.policy.approval.valid)}`,
    `- Policy digest: \`${run.policy.digest ?? "unknown"}\``,
    `- Repository mutation permitted: ${yesNo(run.mutationGate.allowed)}`,
    `- Repository dirty before run: ${yesNo(run.baseline.git.dirty)}`,
    `- Source revision: \`${run.baseline.git.head || "unknown"}\``,
    "",
    "## Decisions",
    "",
    ...run.decisions.map((decision) => `- **${decision.action}** — ${decision.reason}`),
    "",
    "## Checks",
    "",
    ...run.checks.map((check) => `- ${check.ok ? "PASS" : check.skipped ? "SKIP" : "FAIL"}: ${check.id} — ${check.detail}`),
    "",
    "## Version and provenance inventory",
    "",
    ...Object.entries(run.baseline.versions || {}).map(([name, version]) => `- ${name}: ${version ?? "unavailable"}`),
    `- package.json SHA-256: \`${run.baseline.provenance?.packageJsonSha256 ?? "unavailable"}\``,
    `- package-lock.json SHA-256: \`${run.baseline.provenance?.packageLockSha256 ?? "unavailable"}\``,
    `- AGENTS.md SHA-256: \`${run.baseline.provenance?.agentsSha256 ?? "unavailable"}\``,
    `- Lockfile packages: ${run.baseline.dependencies?.packages ?? "unavailable"}; lifecycle-script packages: ${run.baseline.dependencies?.lifecycleScripts?.length ?? "unavailable"}`,
    "",
    "## Candidates",
    "",
    ...(run.candidates.length
      ? run.candidates.map((candidate) => `- \`${candidate.id}\` score ${candidate.score}: ${candidate.title} — ${candidate.decision}`)
      : ["- None discovered within configured authority and budgets."]),
    "",
    "## Candidate queue",
    "",
    `- Loaded: ${run.candidateQueue?.loaded ?? 0}`,
    `- Pending after run: ${run.candidateQueue?.pending?.length ?? 0}`,
    `- Active this run: ${run.candidateQueue?.activeIds?.length ?? 0}`,
    `- Queue path: ${run.candidateQueue?.path ?? "unavailable"}`,
    ...(run.candidateQueue?.error ? [`- Queue error: ${run.candidateQueue.error}`] : []),
    "",
    "## Evidence classes",
    "",
    ...EVIDENCE_CLASSES.map((kind) => `- ${kind}: ${run.evidence[kind]?.status ?? "not established"} — ${run.evidence[kind]?.detail ?? "no evidence collected"}`),
    "",
    "## Resource ledger",
    "",
    `- Wall clock: ${run.ledger.wallClockMinutes} minutes`,
    `- Network: ${run.ledger.networkBytes} bytes`,
    `- State written: ${run.ledger.stateBytesWritten} bytes`,
    `- Changed files observed: ${run.ledger.changedFiles}`,
    `- Changed lines observed: ${run.ledger.changedLines ?? "unknown"}`,
    `- GPU processes observed: ${run.baseline.gpu.processes.length}`,
    `- Input/output tokens: ${run.ledger.inputTokens ?? "unavailable"}/${run.ledger.outputTokens ?? "unavailable"}`,
    `- Retries: ${run.ledger.retries}`,
    `- Repository-volume free space: ${formatMiB(run.baseline.disk?.repository?.freeBytes)}`,
    `- State-volume free space: ${formatMiB(run.baseline.disk?.state?.freeBytes)}`,
    "",
    "### Configured budgets",
    "",
    ...(budgetLines.length ? budgetLines : ["- No budgets were present."]),
    "",
    "### GPU process ownership snapshot",
    "",
    ...gpuLines,
    "",
    "## Deferred / approval required",
    "",
    ...run.deferred.map((item) => `- ${item}`),
    "",
    "## Rollback",
    "",
    `- ${run.rollback}`,
  ];
  return `${lines.join("\n")}\n`;
}
