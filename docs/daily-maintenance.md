# Governed daily maintenance

This system separates observation, isolated staging, and adoption. The default policy is intentionally useful but non-authoritative: a manual run records the repository baseline, dependency-lock integrity, platform-icon coverage, version inventory, disk headroom, GPU processes by PID, an SPDX SBOM, explicit evidence classes, and a resource/decision ledger. It does not contact a network, run a build, modify source, install anything, stop a process, promote a package, publish, or create a schedule.

## Commands

```pwsh
npm run maintenance:check
npm run maintenance:test
npm run maintenance:daily
npm run maintenance:scheduled
```

- `maintenance:check` validates the policy and inspects the current source baseline without creating maintenance state.
- `maintenance:daily` is a manual observer run. Its output is stored outside the repository under `%LOCALAPPDATA%\Grudge Dev Tool\maintenance` unless `--state-root` or `stateDirectory` selects another external directory.
- `maintenance:scheduled` is the unattended entry point. It exits with code 3 unless scheduling is enabled and owner approval matches the exact current policy digest.
- The run lease is fail-closed. A crashed run leaves its lock in place for manual inspection; the controller never guesses that a lock is stale or kills another process.

Each completed observer run writes `run.json`, `summary.md`, and `sbom.spdx.json` in an immutable run directory plus a small `latest.json` pointer. A deduplicated `candidate-queue.json` beside the run directories retains pending candidates that do not fit the current run cap; security candidates take priority, and overflow is carried forward instead of discarded. Maintenance state must never live inside the source checkout. An invalid queue closes discovery and validation without overwriting the queue, so it can be inspected and repaired deliberately.

## State machine

`baseline → discover → triage → provenance → validate → score → isolated stage → hold → summarize`

The observer implements baseline, bounded discovery, provenance, scoring, and reporting. The separate Codex prompt in `docs/daily-maintenance-prompt.md` is the only plane that may stage a candidate, and only when all policy gates allow it. Adoption is a later, distinct decision; staging evidence is never package, runtime, provider, deployment, or device proof.

## Configure and approve

All numeric budgets ship as `null`. That is an unconfigured stop, not an unlimited budget. Before allowing network discovery, validation, or staging, the owner must choose the values in `config/maintenance.policy.json`, including the reserve percentage, wall-clock window, disk/network/diff/retry limits, candidate cap, request timeout, score threshold, and hold duration.

1. Set the desired schedule description, authority switches, budgets, discovery sources, validation scripts, score threshold, and hold duration. Leave the `approval` object unapproved.
2. Run `npm run maintenance:check` and copy the displayed policy digest.
3. Set `approval.approved` to `true`, identify the approving owner, record an ISO timestamp, and paste that exact digest into `approval.policyDigest`.
4. Run `npm run maintenance:check` again. It must report that approval is valid.
5. Test `npm run maintenance:daily` manually and inspect its JSON, Markdown summary, and SPDX SBOM.
6. Only after the owner chooses days, time, notification behavior, and unattended authority, create the Codex scheduled task through the Codex app using the saved prompt. Do not hand-author a scheduler entry. Repository configuration alone does not create or activate a task.

Any later policy edit invalidates the approval until the owner reviews and binds a new digest. The daily task must never edit its own policy or approval record.

## Authority matrix

The only repair class that can be pre-authorized is a small, reversible change in isolated staging that changes no dependency, API, schema, data, permission, secret, provider, model, or network exposure; stays inside configured file/line/time/disk/retry budgets; passes focused and full configured checks; has rollback material; and survives the configured hold.

Explicit approval is always required for:

- major dependency upgrades;
- schema or data migration and destructive data work;
- permission, CSP, firewall, listener, or other network-exposure changes;
- secrets and credentials;
- model/provider changes and model downloads;
- deployment, release, package promotion, commit, or push;
- stopping a process the run did not start;
- ambiguous security changes.

An authority boolean cannot waive this always-approval list. It only records a maximum boundary after separate current approval exists.

## Discovery and quarantine

Local discovery uses repository evidence only. Optional current dependency metadata comes directly from `registry.npmjs.org`; vulnerability matches come directly from the OSV API. Both require owner-approved network authority and configured byte/time budgets. The controller requests the batched security evidence before routine update metadata, examines the complete direct-dependency set within those reserves, caps only active candidate output, meters request and response payload bytes, uses an exact HTTPS host allowlist, performs no retry, and stops before the reserve. It never uses `npm audit` because that command does not expose sufficiently precise network accounting for this policy.

A dependency candidate is not installed by discovery. Before an approved candidate can be adopted, retain:

- official source URL and version/change notes;
- lockfile integrity plus before/after lockfiles and SPDX SBOMs;
- license and compatibility review;
- focused checks, full configured checks, build/package/runtime evidence as applicable;
- diff and resource ledger;
- rollback point and hold result.

Security findings use the same quarantine path. Unknown provenance, missing integrity, a failed check, a timeout whose process state was not inspected, exhausted reserve, ambiguous ownership, or a dirty authoritative checkout closes the gate.

## Evidence and budgets

Every report keeps `source`, `build`, `package`, `runtime`, `provider`, `deployment`, and `device` separate. A source check cannot prove a package; package startup cannot prove a provider; a provider response cannot prove deployment or device acceptance. A timeout is recorded as unknown until the underlying process is inspected.

The ledger records or explicitly marks unavailable:

- wall-clock time and token use;
- GPU time, per-process VRAM, and ownership;
- disk reads/writes, free space, and state growth;
- network bytes;
- files and lines already changed;
- retry count and configured reserve.

Unmetered or unavailable values are never silently treated as zero for an authorized mutation. Deferred candidates persist in the external candidate queue and carry forward through later summaries; the task does not spend through a reserve merely to empty the queue.

## Update and release boundaries

The desktop updater may check for a release in the background. It does not download until the user clicks the available-update control, and it does not install until the user explicitly restarts. `publish:manual --dry-run` performs no fetch, pull, write, build, tag, push, or release. Actual publication remains manual and approval-only.

Codex scheduled tasks require the machine and app to remain available, execute unattended under their configured environment, and should be tested manually before scheduling. See the current official [Codex automations guide](https://learn.chatgpt.com/docs/automations) and [Codex worktree guide](https://learn.chatgpt.com/docs/environments/git-worktrees).
