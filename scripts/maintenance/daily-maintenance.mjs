#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALWAYS_APPROVAL,
  EVIDENCE_CLASSES,
  STATE_SEQUENCE,
  VALIDATION_SCRIPTS,
  allowedHttpsUrl,
  approvalState,
  budgetStatus,
  capCandidates,
  generateSpdx,
  mergeCandidateQueue,
  mutationGate,
  policyDigest,
  sameCleanGitSnapshot,
  scoreCandidate,
  sha256,
  summarizeMarkdown,
  validatePolicy,
} from "./maintenance-lib.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const DEFAULT_POLICY = join(REPO_ROOT, "config", "maintenance.policy.json");
const ALLOWED_VALIDATION_SCRIPTS = new Set(VALIDATION_SCRIPTS);
let activeLeaseRelease = null;
let activeDeadlineMs = null;

function parseArgs(argv) {
  const result = { check: false, json: false, scheduled: false, policy: DEFAULT_POLICY, stateRoot: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") result.check = true;
    else if (arg === "--json") result.json = true;
    else if (arg === "--scheduled") result.scheduled = true;
    else if (arg === "--policy") result.policy = resolve(argv[++index]);
    else if (arg === "--state-root") result.stateRoot = resolve(argv[++index]);
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: daily-maintenance [--check] [--json] [--scheduled] [--policy FILE] [--state-root DIR]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function command(commandName, args, options = {}) {
  const requestedTimeout = options.timeoutMs ?? 15_000;
  const remainingBudget = activeDeadlineMs === null ? requestedTimeout : activeDeadlineMs - Date.now();
  if (remainingBudget <= 0) {
    return { ok: false, status: null, stdout: "", stderr: "", error: "wall-clock budget reserve reached", timedOut: true };
  }
  const isWindowsNpm = process.platform === "win32" && commandName === "npm";
  const executable = isWindowsNpm ? (process.env.ComSpec || "cmd.exe") : commandName;
  const commandArgs = isWindowsNpm
    ? ["/d", "/s", "/c", ["npm", ...args].map((value) => /^[A-Za-z0-9:._-]+$/.test(value) ? value : `"${value.replace(/"/g, '""')}"`).join(" ")]
    : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: Math.max(1, Math.min(requestedTimeout, remainingBudget)),
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
  });
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
    error: result.error?.message ?? null,
    timedOut: result.error?.code === "ETIMEDOUT",
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fileHash(path) {
  return existsSync(path) ? sha256(readFileSync(path)) : null;
}

function isInside(parent, candidate) {
  const child = relative(resolve(parent), resolve(candidate));
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function defaultStateRoot() {
  const appData = process.env.LOCALAPPDATA;
  return appData
    ? join(appData, "Grudge Dev Tool", "maintenance")
    : join(tmpdir(), "grudge-dev-tool-maintenance");
}

function gitBaseline() {
  const status = command("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  const head = command("git", ["rev-parse", "HEAD"]);
  const branch = command("git", ["branch", "--show-current"]);
  const upstream = command("git", ["rev-parse", "--abbrev-ref", "@{upstream}"]);
  const divergence = upstream.ok
    ? command("git", ["rev-list", "--left-right", "--count", `HEAD...${upstream.stdout}`])
    : { ok: false, stdout: "" };
  const numstat = command("git", ["diff", "--numstat", "HEAD"], { timeoutMs: 30_000 });
  const statusLines = status.stdout ? status.stdout.split(/\r?\n/).filter(Boolean) : [];
  let changedLines = 0;
  let unknownLines = statusLines.some((line) => line.startsWith("??"));
  if (numstat.ok && numstat.stdout) {
    for (const line of numstat.stdout.split(/\r?\n/)) {
      const [added, removed] = line.split("\t");
      if (added === "-" || removed === "-") unknownLines = true;
      else changedLines += Number(added || 0) + Number(removed || 0);
    }
  }
  const [aheadRaw, behindRaw] = divergence.ok ? divergence.stdout.split(/\s+/) : [];
  return {
    available: status.ok && head.ok,
    branch: branch.stdout || null,
    head: head.stdout || null,
    upstream: upstream.ok ? upstream.stdout : null,
    ahead: divergence.ok ? Number(aheadRaw) : null,
    behind: divergence.ok ? Number(behindRaw) : null,
    dirty: statusLines.length > 0,
    changedFiles: statusLines.length,
    changedLines: unknownLines ? null : changedLines,
    statusEntries: statusLines,
  };
}

function assertGitUnchanged(expected) {
  const current = gitBaseline();
  if (!sameCleanGitSnapshot(expected, current)) {
    const error = new Error("authoritative checkout changed after the baseline");
    error.code = "SOURCE_CHANGED";
    error.currentGit = current;
    throw error;
  }
  return current;
}

function gpuBaseline() {
  const inventory = command("nvidia-smi", [
    "--query-gpu=index,name,driver_version,memory.total,memory.free",
    "--format=csv,noheader,nounits",
  ]);
  const compute = command("nvidia-smi", [
    "--query-compute-apps=pid,process_name,used_memory",
    "--format=csv,noheader,nounits",
  ]);
  const split = (text) => text ? text.split(/\r?\n/).filter(Boolean).map((line) => line.split(",").map((v) => v.trim())) : [];
  return {
    available: inventory.ok,
    devices: split(inventory.stdout).map(([index, name, driverVersion, totalMiB, freeMiB]) => ({
      index: Number(index), name, driverVersion, totalMiB: Number(totalMiB), freeMiB: Number(freeMiB),
    })),
    processes: split(compute.stdout).map(([pid, processName, usedMemoryMiB]) => ({
      pid: Number(pid), processName, usedMemoryMiB: /^\d+(\.\d+)?$/.test(usedMemoryMiB) ? Number(usedMemoryMiB) : null, ownership: "unowned-observed-only",
    })),
    detail: inventory.ok ? null : inventory.error || inventory.stderr || "nvidia-smi unavailable",
  };
}

function dependencyBaseline(packageLock) {
  const entries = Object.entries(packageLock.packages || {}).filter(([lockPath]) => lockPath !== "");
  const missingIntegrity = [];
  const lifecycleScripts = [];
  for (const [lockPath, entry] of entries) {
    if (entry?.resolved && !entry.integrity && !entry.link) missingIntegrity.push(lockPath);
    if (entry?.hasInstallScript) lifecycleScripts.push(lockPath);
  }
  return {
    lockfileVersion: packageLock.lockfileVersion ?? null,
    packages: entries.length,
    resolvedWithIntegrity: entries.filter(([, entry]) => entry?.resolved && entry?.integrity).length,
    missingIntegrity,
    lifecycleScripts,
  };
}

function iconBaseline() {
  const required = [16, 24, 32, 48, 64, 128, 256, 512].map((size) => `resources/icon-${size}.png`);
  required.push("resources/icon.ico", "resources/brand/grudge-emblem-source.png");
  const missing = required.filter((file) => !existsSync(join(REPO_ROOT, file)));
  return { required, missing, complete: missing.length === 0 };
}

function diskSnapshot(path) {
  let probe = path;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const disk = statfsSync(probe, { bigint: true });
  return {
    probedPath: probe,
    blockSize: Number(disk.bsize),
    freeBytes: Number(disk.bavail * disk.bsize),
    totalBytes: Number(disk.blocks * disk.bsize),
  };
}

function collectBaseline(packageJson, packageLock, stateRoot) {
  const git = gitBaseline();
  return {
    repositoryRoot: REPO_ROOT,
    git,
    versions: {
      app: packageJson.version,
      node: process.version,
      npm: command("npm", ["--version"]).stdout || null,
      electron: packageJson.devDependencies?.electron ?? null,
      electronUpdater: packageJson.dependencies?.["electron-updater"] ?? null,
      typescript: packageJson.devDependencies?.typescript ?? null,
      vite: packageJson.devDependencies?.vite ?? null,
    },
    provenance: {
      packageJsonSha256: fileHash(join(REPO_ROOT, "package.json")),
      packageLockSha256: fileHash(join(REPO_ROOT, "package-lock.json")),
      agentsSha256: fileHash(join(REPO_ROOT, "AGENTS.md")),
    },
    dependencies: dependencyBaseline(packageLock),
    icons: iconBaseline(),
    gpu: gpuBaseline(),
    disk: { repository: diskSnapshot(REPO_ROOT), state: diskSnapshot(stateRoot) },
  };
}

function directDependencies(packageLock) {
  const root = packageLock.packages?.[""] || {};
  const names = [...new Set([...Object.keys(root.dependencies || {}), ...Object.keys(root.devDependencies || {})])].sort();
  return names.flatMap((name) => {
    const installed = packageLock.packages?.[`node_modules/${name}`]?.version;
    return installed ? [{ name, version: installed }] : [];
  });
}

function semverRisk(current, latest) {
  const parse = (value) => String(value).match(/^(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);
  const a = parse(current);
  const b = parse(latest);
  if (!a || !b) return { risk: 5, value: 1, change: "unclassified" };
  if (b[0] !== a[0]) return { risk: 5, value: 2, change: "major" };
  if (b[1] !== a[1]) return { risk: 3, value: 2, change: "minor" };
  if (b[2] !== a[2]) return { risk: 2, value: 2, change: "patch" };
  return { risk: 0, value: 0, change: "current" };
}

function createNetworkMeter(policy) {
  const limitBytes = policy.budgets.networkMiB * 1024 * 1024;
  const status = budgetStatus(limitBytes, 0, policy.budgets.reservePercent);
  return { bytes: 0, usableLimit: status.usableLimit };
}

async function fetchJsonMetered(rawUrl, options, policy, meter) {
  if (!allowedHttpsUrl(rawUrl, policy.discovery.allowedHosts)) throw new Error(`host is not allowed: ${rawUrl}`);
  const bodyBytes = options?.body ? Buffer.byteLength(options.body) : 0;
  const requestBytes = Buffer.byteLength(rawUrl) + bodyBytes;
  if (meter.bytes + requestBytes >= meter.usableLimit) throw new Error("network budget reserve reached before request");
  meter.bytes += requestBytes;
  const controller = new AbortController();
  const remainingWallMs = activeDeadlineMs === null ? Infinity : activeDeadlineMs - Date.now();
  if (remainingWallMs <= 0) throw new Error("wall-clock budget reserve reached before request");
  const timeout = setTimeout(() => controller.abort(), Math.min(policy.discovery.requestTimeoutSeconds * 1000, remainingWallMs));
  try {
    const response = await fetch(rawUrl, { ...options, signal: controller.signal, headers: { accept: "application/json", ...(options?.headers || {}) } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const chunks = [];
    const reader = response.body?.getReader();
    if (!reader) return null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      meter.bytes += value.byteLength;
      if (meter.bytes >= meter.usableLimit) {
        await reader.cancel("network budget reserve reached");
        throw new Error("network budget reserve reached while reading response");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"));
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverNetworkCandidates(policy, packageLock, ensureSourceStable) {
  const meter = createNetworkMeter(policy);
  const candidateLimit = Math.floor(policy.discovery.maxCandidates);
  const all = directDependencies(packageLock);
  const registryCandidates = [];
  const advisoryCandidates = [];
  const errors = [];
  let sourceChanged = false;
  let budgetExhausted = false;

  // Security evidence is requested before lower-priority update metadata so a
  // tight resource budget cannot be consumed by routine version checks first.
  if (policy.discovery.osvAudit && all.length) {
    const body = JSON.stringify({ queries: all.map((dependency) => ({ package: { ecosystem: "npm", name: dependency.name }, version: dependency.version })) });
    try {
      ensureSourceStable();
      const response = await fetchJsonMetered("https://api.osv.dev/v1/querybatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }, policy, meter);
      (response?.results || []).forEach((result, index) => {
        for (const vulnerability of result.vulns || []) {
          const dependency = all[index];
          const candidate = {
            id: `osv:${vulnerability.id}:${dependency.name}`,
            kind: "security-advisory",
            title: `${vulnerability.id} affects ${dependency.name} ${dependency.version}`,
            source: `https://osv.dev/vulnerability/${encodeURIComponent(vulnerability.id)}`,
            value: 5,
            risk: 3,
            evidence: 5,
            reversibility: 3,
            testability: 4,
            resourceCost: 2,
          };
          candidate.score = scoreCandidate(candidate, policy.scoring.weights);
          advisoryCandidates.push(candidate);
        }
      });
    } catch (error) {
      errors.push({ source: "osv", error: error.message });
      if (error.code === "SOURCE_CHANGED") sourceChanged = true;
      if (String(error.message).includes("budget reserve")) budgetExhausted = true;
    }
  }

  if (policy.discovery.registryMetadata && !sourceChanged && !budgetExhausted) {
    for (const dependency of all) {
      try {
        ensureSourceStable();
        const latest = await fetchJsonMetered(
          `https://registry.npmjs.org/${encodeURIComponent(dependency.name)}/latest`,
          {}, policy, meter,
        );
        if (latest?.version && latest.version !== dependency.version) {
          const dimensions = semverRisk(dependency.version, latest.version);
          const candidate = {
            id: `npm:${dependency.name}:${dependency.version}->${latest.version}`,
            kind: "dependency-update",
            title: `${dependency.name} ${dependency.version} → ${latest.version}`,
            source: `https://registry.npmjs.org/${encodeURIComponent(dependency.name)}/latest`,
            ...dimensions,
            evidence: 5,
            reversibility: 4,
            testability: 4,
            resourceCost: 2,
          };
          candidate.score = scoreCandidate(candidate, policy.scoring.weights);
          registryCandidates.push(candidate);
        }
      } catch (error) {
        errors.push({ source: `registry:${dependency.name}`, error: error.message });
        if (error.code === "SOURCE_CHANGED") sourceChanged = true;
        if (sourceChanged || String(error.message).includes("budget reserve")) break;
      }
    }
  }
  // Security advisories take precedence when the owner-supplied output cap is
  // smaller than the discovered set.
  const capped = capCandidates([...advisoryCandidates, ...registryCandidates], candidateLimit);
  return { candidates: capped.items, overflowCandidates: capped.overflow, omittedCandidates: capped.omitted, errors, networkBytes: meter.bytes, consideredDependencies: all.length, sourceChanged };
}

function runConfiguredValidation(policy, startedMs, ensureSourceStable) {
  const results = [];
  const wallBudgetMs = policy.budgets.wallClockMinutes * 60_000;
  const reserve = policy.budgets.reservePercent / 100;
  const usableMs = wallBudgetMs * (1 - reserve);
  for (const script of policy.validation.npmScripts) {
    try {
      ensureSourceStable();
    } catch (error) {
      results.push({ script, ok: false, skipped: true, detail: error.message, sourceChanged: true });
      break;
    }
    if (!ALLOWED_VALIDATION_SCRIPTS.has(script)) {
      results.push({ script, ok: false, skipped: true, detail: "script is not in the maintenance allowlist" });
      continue;
    }
    const remaining = usableMs - (Date.now() - startedMs);
    if (remaining <= 0) {
      results.push({ script, ok: false, skipped: true, detail: "wall-clock reserve reached" });
      break;
    }
    const result = command("npm", ["run", script], { timeoutMs: Math.max(1_000, remaining) });
    results.push({
      script,
      ok: result.ok,
      skipped: false,
      detail: result.ok ? "passed" : result.timedOut ? "timed out; underlying process state requires inspection" : result.stderr || result.error || `exit ${result.status}`,
    });
    if (!result.ok) break;
  }
  return results;
}

function acquireLease(stateRoot, runId) {
  mkdirSync(stateRoot, { recursive: true });
  const lockPath = join(stateRoot, "maintenance.lock");
  const token = randomUUID();
  let descriptor;
  try {
    descriptor = openSync(lockPath, "wx");
    writeFileSync(descriptor, JSON.stringify({ runId, token, pid: process.pid, createdAt: new Date().toISOString(), repositoryRoot: REPO_ROOT }, null, 2));
  } catch (error) {
    throw new Error(`maintenance lease unavailable at ${lockPath}: ${error.message}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return () => {
    try {
      const current = JSON.parse(readFileSync(lockPath, "utf8"));
      if (current.token === token) rmSync(lockPath);
    } catch {
      // A changed or unreadable lease is never removed automatically.
    }
  };
}

function atomicWrite(path, content) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
  return Buffer.byteLength(content);
}

function loadCandidateQueue(stateRoot, policy) {
  const path = join(stateRoot, "candidate-queue.json");
  if (!existsSync(path)) return { path, pending: [], error: null };
  try {
    const size = statSync(path).size;
    if (policy.budgets.diskReadMiB !== null) {
      const readBudget = budgetStatus(policy.budgets.diskReadMiB * 1024 * 1024, size, policy.budgets.reservePercent);
      if (!readBudget.allowed) throw new Error("candidate queue exceeds the disk-read budget reserve");
    }
    const parsed = readJson(path);
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.pending)) throw new Error("candidate queue schema is invalid");
    const pending = parsed.pending.filter((candidate) => candidate && typeof candidate.id === "string" && typeof candidate.title === "string");
    if (pending.length !== parsed.pending.length) throw new Error("candidate queue contains an invalid entry");
    return { path, pending, error: null };
  } catch (error) {
    return { path, pending: [], error: error.message };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const runId = `${startedAt.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const policy = readJson(args.policy);
  const policyErrors = validatePolicy(policy);
  if (policyErrors.length) throw new Error(`Invalid maintenance policy:\n- ${policyErrors.join("\n- ")}`);

  const stateRoot = resolve(args.stateRoot || policy.stateDirectory || defaultStateRoot());
  if (isInside(REPO_ROOT, stateRoot)) throw new Error("maintenance stateDirectory must be outside the repository");
  for (const protectedPath of policy.protectedPaths || []) {
    const absoluteProtectedPath = isAbsolute(protectedPath) ? resolve(protectedPath) : resolve(REPO_ROOT, protectedPath);
    if (isInside(absoluteProtectedPath, stateRoot)) throw new Error(`maintenance stateDirectory is inside protected path: ${absoluteProtectedPath}`);
  }
  const approval = approvalState(policy);
  const scheduleBlockers = [];
  if (args.scheduled && !policy.schedule.enabled) scheduleBlockers.push("schedule is disabled");
  if (args.scheduled && !policy.schedule.rrule) scheduleBlockers.push("schedule days and time are unconfigured");
  if (args.scheduled && !policy.schedule.notificationPolicy) scheduleBlockers.push("notification policy is unconfigured");
  if (args.scheduled && !approval.valid) scheduleBlockers.push("policy approval is invalid");
  for (const key of ["wallClockMinutes", "diskWriteMiB", "reservePercent"]) {
    if (args.scheduled && policy.budgets[key] === null) scheduleBlockers.push(`scheduled observer budget ${key} is unconfigured`);
  }
  const scheduleAuthorized = !args.scheduled || scheduleBlockers.length === 0;
  if (policy.budgets.wallClockMinutes !== null) {
    const reservePercent = policy.budgets.reservePercent ?? 0;
    activeDeadlineMs = startedMs + policy.budgets.wallClockMinutes * 60_000 * (1 - reservePercent / 100);
  }
  const writeState = !args.check && scheduleAuthorized;
  if (writeState) activeLeaseRelease = acquireLease(stateRoot, runId);
  const packageJson = readJson(join(REPO_ROOT, "package.json"));
  const packageLock = readJson(join(REPO_ROOT, "package-lock.json"));
  const loadedQueue = loadCandidateQueue(stateRoot, policy);
  const baseline = collectBaseline(packageJson, packageLock, stateRoot);
  const baselineReady = baseline.git.available
    && !!baseline.git.head
    && !!baseline.git.branch
    && !baseline.git.dirty;
  const ensureSourceStable = () => assertGitUnchanged(baseline.git);
  let sourceStable = baselineReady;
  let finalGit = baseline.git;

  const checks = [
    { id: "policy", ok: policyErrors.length === 0, detail: `valid runtime policy contract; digest ${policyDigest(policy)}` },
    { id: "schedule-authority", ok: scheduleAuthorized, skipped: !args.scheduled, detail: args.scheduled ? (scheduleAuthorized ? "enabled, budgeted, and bound to approved policy" : `blocked: ${scheduleBlockers.join("; ")}`) : "manual invocation" },
    { id: "git", ok: baseline.git.available, detail: baseline.git.available ? `${baseline.git.branch}@${baseline.git.head}` : "git baseline unavailable" },
    { id: "working-tree", ok: !baseline.git.dirty, detail: baseline.git.dirty ? `${baseline.git.changedFiles} existing entries; mutation gate closed` : "clean" },
    { id: "lockfile-integrity", ok: baseline.dependencies.missingIntegrity.length === 0, detail: baseline.dependencies.missingIntegrity.length ? `${baseline.dependencies.missingIntegrity.length} resolved entries lack integrity` : `${baseline.dependencies.resolvedWithIntegrity} resolved entries carry integrity` },
    { id: "icon-system", ok: baseline.icons.complete, detail: baseline.icons.complete ? `${baseline.icons.required.length} required platform icon assets present` : `missing: ${baseline.icons.missing.join(", ")}` },
    { id: "gpu-ownership", ok: true, detail: `${baseline.gpu.processes.length} GPU process entries observed; all classified unowned and untouchable` },
    { id: "candidate-queue", ok: !loadedQueue.error, detail: loadedQueue.error || `${loadedQueue.pending.length} pending candidate(s) loaded` },
  ];

  const decisions = [];
  const deferred = [...ALWAYS_APPROVAL.map((item) => `${item}: explicit approval always required`)];
  let network = { candidates: [], omittedCandidates: 0, errors: [], networkBytes: 0, consideredDependencies: 0, sourceChanged: false };
  let networkAttempted = false;
  let validation = [];

  if (args.scheduled && !scheduleAuthorized) {
    decisions.push({ action: "scheduled run blocked", reason: scheduleBlockers.join("; ") });
  } else if (loadedQueue.error) {
    decisions.push({ action: "observer stopped at candidate queue", reason: loadedQueue.error });
    checks.push({ id: "network-discovery", ok: false, skipped: true, detail: "queue must be repaired before discovery can continue" });
    checks.push({ id: "local-validation", ok: false, skipped: true, detail: "queue integrity failure closed the observer" });
    deferred.push(`candidate queue repair required: ${loadedQueue.error}`);
  } else if (!baselineReady) {
    decisions.push({ action: "observer stopped at baseline", reason: baseline.git.dirty ? "authoritative checkout is dirty" : "git branch/revision provenance is unavailable" });
    checks.push({ id: "network-discovery", ok: false, skipped: true, detail: "baseline stop: no network budget was spent" });
    checks.push({ id: "local-validation", ok: false, skipped: true, detail: "baseline stop: active or unprovable source was not exercised" });
    deferred.push("network discovery and local validation: authoritative checkout is dirty or source provenance is unavailable");
  } else {
    if (policy.authority.networkDiscovery && approval.valid) {
      networkAttempted = true;
      network = await discoverNetworkCandidates(policy, packageLock, ensureSourceStable);
      checks.push({ id: "network-discovery", ok: network.errors.length === 0, detail: `${network.consideredDependencies} dependencies considered; ${network.candidates.length} retained and ${network.omittedCandidates} omitted by cap; ${network.networkBytes} bytes metered; ${network.errors.length} error(s)` });
    } else {
      checks.push({ id: "network-discovery", ok: false, skipped: true, detail: "disabled or owner approval invalid" });
      deferred.push("current registry and OSV advisory lookup: network discovery is disabled or unapproved");
    }

    try {
      finalGit = ensureSourceStable();
    } catch (error) {
      sourceStable = false;
      finalGit = error.currentGit || gitBaseline();
      decisions.push({ action: "observer stopped after discovery", reason: error.message });
      deferred.push("local validation and staging: source changed after the recorded baseline");
    }

    if (!sourceStable || network.sourceChanged) {
      sourceStable = false;
      checks.push({ id: "local-validation", ok: false, skipped: true, detail: "source changed after baseline; no validation started" });
    } else if (policy.authority.runLocalValidation && approval.valid && policy.budgets.wallClockMinutes !== null && policy.budgets.reservePercent !== null) {
      validation = runConfiguredValidation(policy, startedMs, ensureSourceStable);
      for (const result of validation) checks.push({ id: `validation:${result.script}`, ok: result.ok, skipped: result.skipped, detail: result.detail });
    } else {
      checks.push({ id: "local-validation", ok: false, skipped: true, detail: "disabled, unapproved, or wall-clock budget unconfigured" });
      deferred.push("build and test evidence: local validation is disabled, unapproved, or lacks a wall-clock budget");
    }
  }

  if (baselineReady && scheduleAuthorized) {
    try {
      finalGit = ensureSourceStable();
    } catch (error) {
      sourceStable = false;
      finalGit = error.currentGit || gitBaseline();
      decisions.push({ action: "source seal invalidated", reason: error.message });
    }
  }
  if (validation.some((result) => result.sourceChanged)) sourceStable = false;
  baseline.gitFinal = finalGit;
  checks.push({
    id: "working-tree-final",
    ok: baselineReady && sourceStable,
    detail: baselineReady && sourceStable
      ? `unchanged at ${finalGit.head}`
      : "source was dirty, unavailable, or changed after the baseline; mutation gate closed",
  });
  const effectiveGit = { ...finalGit, dirty: finalGit.dirty || !sourceStable };
  const gate = mutationGate(policy, effectiveGit);
  if (args.scheduled && !scheduleAuthorized) {
    gate.allowed = false;
    gate.blockers.push("scheduled invocation is unauthorized");
  }

  const discoveredCandidates = [...network.candidates, ...(network.overflowCandidates || [])];
  const queuePending = mergeCandidateQueue(loadedQueue.pending, discoveredCandidates, startedAt);
  if (networkAttempted) {
    const capped = capCandidates(queuePending, policy.discovery.maxCandidates);
    network.candidates = capped.items;
    network.overflowCandidates = capped.overflow;
    network.omittedCandidates = capped.omitted;
  }
  const activeCandidateIds = new Set(network.candidates.map((candidate) => candidate.id));
  for (const candidate of queuePending.filter((item) => !activeCandidateIds.has(item.id))) {
    deferred.push(`queued candidate ${candidate.id}: ${candidate.title}`);
  }

  const candidates = network.candidates.map((candidate) => {
    const scoreEligible = policy.scoring.minimumForStaging !== null && candidate.score >= policy.scoring.minimumForStaging;
    const requiresExplicitApproval = candidate.kind === "dependency-update" || candidate.kind === "security-advisory";
    const eligible = gate.allowed && scoreEligible && !requiresExplicitApproval;
    return {
      ...candidate,
      requiresExplicitApproval,
      decision: eligible
        ? "eligible for isolated staging by the governed Codex task; observer made no source change"
        : requiresExplicitApproval
          ? "approval packet required: dependency and advisory remediation cannot be pre-authorized as a small repair"
          : "deferred: mutation gate closed or score below configured threshold",
    };
  });

  if (!gate.allowed) decisions.push({ action: "repository unchanged", reason: gate.blockers.join("; ") });
  else decisions.push({ action: "observer completed", reason: "eligible candidates may proceed only through the separate isolated-staging prompt plane" });
  if (network.errors.length) decisions.push({ action: "network scan bounded", reason: `${network.errors.length} lookup error(s); no retry was attempted` });

  const evidence = Object.fromEntries(EVIDENCE_CLASSES.map((kind) => [kind, { status: "not established", detail: "not collected by this run" }]));
  evidence.source = baselineReady && sourceStable
    ? { status: "established", detail: `clean ${baseline.git.branch} remained sealed at ${finalGit.head}; package and lockfile SHA-256 recorded` }
    : { status: "not established", detail: `unsealed or unavailable working source; observed HEAD ${baseline.git.head || "unknown"} is not a reproducible working-tree snapshot` };
  if (sourceStable && validation.length && validation.every((item) => item.ok)) evidence.build = { status: "established for configured checks", detail: validation.map((item) => item.script).join(", ") };
  evidence.device = { status: "resource snapshot only", detail: `${baseline.gpu.devices.length} GPU(s), ${baseline.gpu.processes.length} GPU process entries; no packaged-device acceptance claim` };

  const run = {
    schemaVersion: 1,
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    scheduled: args.scheduled,
    checkOnly: args.check,
    mode: policy.mode,
    stateSequence: STATE_SEQUENCE,
    policy: { path: args.policy, digest: policyDigest(policy), approval },
    mutationGate: gate,
    baseline,
    checks,
    validation,
    candidates,
    networkErrors: network.errors,
    candidateQueue: {
      path: loadedQueue.path,
      loaded: loadedQueue.pending.length,
      pending: queuePending,
      activeIds: candidates.map((candidate) => candidate.id),
      error: loadedQueue.error,
    },
    decisions,
    deferred,
    evidence,
    ledger: {
      wallClockMinutes: Number(((Date.now() - startedMs) / 60_000).toFixed(3)),
      networkBytes: network.networkBytes,
      stateBytesWritten: 0,
      changedFiles: baseline.git.changedFiles,
      changedLines: baseline.git.changedLines,
      inputTokens: null,
      outputTokens: null,
      gpuMinutes: null,
      diskReadBytes: null,
      retries: 0,
      budgets: policy.budgets,
    },
    rollback: "No repository mutation was performed by the observer, so no source rollback is required.",
  };

  if (writeState) {
    try {
      const runDir = join(stateRoot, "runs", runId);
      const sbom = generateSpdx({ packageJson, packageLock, createdAt: run.completedAt, documentSeed: `${run.runId}:${baseline.provenance.packageLockSha256}` });
      run.artifacts = {
        directory: runDir,
        sbom: join(runDir, "sbom.spdx.json"),
        summary: join(runDir, "summary.md"),
        record: join(runDir, "run.json"),
        candidateQueue: loadedQueue.error ? null : loadedQueue.path,
      };
      const sbomText = `${JSON.stringify(sbom, null, 2)}\n`;
      const queueText = loadedQueue.error ? null : `${JSON.stringify({
        schemaVersion: 1,
        updatedAt: run.completedAt,
        sourceRunId: run.runId,
        pending: queuePending,
      }, null, 2)}\n`;
      const latestText = `${JSON.stringify({ runId, completedAt: run.completedAt, summary: run.artifacts.summary, record: run.artifacts.record }, null, 2)}\n`;
      let summaryText = "";
      let recordText = "";
      // The ledger is embedded in two artifacts, so settle their byte count
      // before writing either one.
      for (let pass = 0; pass < 4; pass += 1) {
        summaryText = summarizeMarkdown(run);
        recordText = `${JSON.stringify(run, null, 2)}\n`;
        const total = Buffer.byteLength(sbomText) + Buffer.byteLength(summaryText) + Buffer.byteLength(recordText) + Buffer.byteLength(latestText) + (queueText ? Buffer.byteLength(queueText) : 0);
        if (total === run.ledger.stateBytesWritten) break;
        run.ledger.stateBytesWritten = total;
      }
      summaryText = summarizeMarkdown(run);
      recordText = `${JSON.stringify(run, null, 2)}\n`;
      if (policy.budgets.diskWriteMiB !== null) {
        const diskWrite = budgetStatus(policy.budgets.diskWriteMiB * 1024 * 1024, run.ledger.stateBytesWritten, policy.budgets.reservePercent);
        if (!diskWrite.allowed) throw new Error("disk-write budget reserve reached before maintenance artifacts could be written");
      }
      if (policy.budgets.wallClockMinutes !== null) {
        const wallClock = budgetStatus(policy.budgets.wallClockMinutes, (Date.now() - startedMs) / 60_000, policy.budgets.reservePercent);
        if (!wallClock.allowed) throw new Error("wall-clock budget reserve reached before maintenance artifacts could be written");
      }
      mkdirSync(runDir, { recursive: true });
      atomicWrite(run.artifacts.sbom, sbomText);
      atomicWrite(run.artifacts.summary, summaryText);
      atomicWrite(run.artifacts.record, recordText);
      atomicWrite(join(stateRoot, "latest.json"), latestText);
      if (queueText) atomicWrite(loadedQueue.path, queueText);
    } finally {
      activeLeaseRelease?.();
      activeLeaseRelease = null;
    }
  }

  const output = args.json ? JSON.stringify(run, null, 2) : summarizeMarkdown(run);
  process.stdout.write(`${output.trimEnd()}\n`);
  if (args.scheduled && !scheduleAuthorized) process.exitCode = 3;
  else if (!baseline.git.available || !baseline.icons.complete || baseline.dependencies.missingIntegrity.length) process.exitCode = 1;
}

main().catch((error) => {
  activeLeaseRelease?.();
  activeLeaseRelease = null;
  console.error(`[maintenance] ${error.stack || error.message || String(error)}`);
  process.exitCode = 1;
});
