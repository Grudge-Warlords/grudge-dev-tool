# Self-review: governed daily maintenance

## Outcome

Implemented and verified with all eleven findings from three independent fresh-eyes rounds addressed. A final same-context adversarial pass found and fixed one additional discovery-order defect. The fixes made after round three were not sent through a fourth independent round because the review procedure caps the cycle at three rounds; that residual review-scope limit is recorded rather than hidden.

No commit, push, package, install, app restart, deployment, release, model download, process termination, or schedule activation was performed.

## Reviewed state

- Repository: `E:\grudge\grudge-dev-tool`
- Branch: `main`
- HEAD used as the source reference: `54feed59b860ceb0b7a3e77212f0efa7672ec304`
- Fetched `origin/main`: `463a242a3a386d6d5dbd7dd64aab7e72e0337779`
- Review mode: shared dirty working tree, preserving pre-existing Prompt-to-3D work
- Isolation: fresh-eyes reviewer Boyle received the bounded implementation scope and findings were reviewed in three successive rounds
- Reviewed implementation files: 21
- Reviewed content-manifest SHA-256: `0ae2e564933eecbdbc4c3ca46c8bab016ec60ee2b495fff984c4d95bb5822233`
- Primary implementation/review model: Codex GPT-5; fresh-eyes reviewer inherited the same model family in an isolated context
- Project-specific self-review rules: `.agents/docs/self-review-rules.md` was not present

The content-manifest hash covers the current bytes of the files listed below. It is used instead of a merge-base diff hash because unrelated user changes and new files already share this working tree.

## Scope

- Policy and schema: `config/maintenance.policy.json`, `config/maintenance.policy.schema.json`
- Observer and tests: `scripts/maintenance/daily-maintenance.mjs`, `scripts/maintenance/maintenance-lib.mjs`, `scripts/maintenance/maintenance.test.mjs`
- Operator contract: `docs/daily-maintenance.md`, `docs/daily-maintenance-prompt.md`, `AGENTS.md`, `SECURITY.md`, `CHANGELOG.md`, `PROJECT_STATUS.md`
- Command integration: `package.json`, `cli/src/commands/doctor.ts`, `cli/src/cli.ts`, `scripts/audit-workers-config.mjs`, `scripts/publish-manual.mjs`
- Update consent path: `src/shared/ipc.ts`, `src/main/updater.ts`, `src/main/main.ts`, `src/preload/preload.ts`, `src/renderer/components/StatusBar.tsx`

## Fresh-eyes findings and resolutions

### Round 1

1. `ci:local` exercised a stale preload path. Fixed by rebuilding and sandbox-testing preload through `build:preload`.
2. Missing Git provenance did not close the mutation gate. Fixed by requiring available Git, revision, branch, and a clean source seal.
3. A dirty scheduled run could spend discovery/validation resources before stopping. Fixed by stopping at baseline before network or validation.
4. Dirty-source evidence was overstated. Fixed by reporting source evidence as unestablished for dirty, unavailable, or changed source.
5. The root SPDX package used invalid `UNLICENSED` text. Fixed by emitting SPDX `NONE`.

### Round 2

1. Source could change between baseline and network/validation actions. Fixed with a clean Git snapshot seal before each network request, before each configured validation, and at finalization.
2. Scoped npm package URLs lost their namespace separator. Fixed with namespace-aware Package URL encoding and a regression assertion.
3. The candidate limit did not strictly bound retained candidates. Fixed with strict cap/overflow accounting and security-first ordering.

### Round 3

1. Governed validation still named `test:preload`, which could exercise stale output. Fixed by allowing and configuring `build:preload`; validation scripts are now a strict allowlist.
2. Network authority could be enabled without a wall-clock ceiling. Fixed by making a configured wall-clock budget mandatory for network discovery.
3. Capped candidates were discarded instead of carried forward. Fixed with an external, deduplicated candidate queue that retains overflow, prioritizes security candidates, and closes the observer if queue integrity fails.

## Final same-context adversarial pass

The final pass checked authority-to-budget coupling, approval digest invalidation, dirty/unavailable/moved-source seals, network host and byte boundaries, validation allowlisting, queue integrity and overflow retention, external-state/lease placement, updater consent boundaries, dry-run publication behavior, read-only machine output, Worker route protection, SPDX credential stripping, and preservation of unowned GPU processes. It found that `maxCandidates` also limited the dependency inspection set and that routine registry lookups ran before security discovery. The controller now examines the complete direct-dependency set within the independent network/time reserves, requests the batched OSV evidence first, and applies `maxCandidates` only to active output while preserving overflow. No additional actionable defect was found after that correction.

## Verification

- Full production renderer/main/preload build passed before closeout.
- Consolidated `npm run ci:local` passed after the final review fixes.
- Both TypeScript projects passed.
- Fresh sandbox-safe preload build and preload bridge test passed.
- Eleven maintenance policy, approval, source-seal, network-bound, validation-allowlist, candidate-queue/cap, Package URL, SPDX, and summary tests passed.
- JavaScript syntax checks passed for the maintenance controller, library, and test suite.
- `git diff --check` passed; only existing line-ending conversion notices were emitted.
- An unapproved scheduled invocation exited with code 3 and created no state directory.
- Manual observer run `2026-09-05T02-00-11-545Z-e7838f0d` used zero network bytes, left no lease, allowed no mutation, wrote an intact empty candidate queue, and produced a 783-package SPDX 2.3 inventory with root license `NONE` and a correct scoped npm Package URL.

## Evidence boundary

This review establishes source integration and the stated automated checks. The manual observer correctly marks source evidence unestablished because the authoritative working tree contains pre-existing work. It does not establish a new package, packaged runtime, update-server response, provider behavior, deployment, retail-device adoption, or owner acceptance. The schedule and every non-observer authority remain unconfigured, disabled, and unapproved.
