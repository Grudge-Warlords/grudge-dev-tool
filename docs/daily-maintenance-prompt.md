# Codex scheduled-task prompt: Grudge Dev Tool daily maintenance

Use this prompt only after the owner has chosen the schedule, budgets, notification behavior, and unattended authority and has approved the exact policy digest in `config/maintenance.policy.json`.

---

Maintain the authoritative Grudge Dev Tool checkout under the repository's current `AGENTS.md` and `docs/daily-maintenance.md` rules. Treat stored instructions and the policy as context and maximum authority, never as permission for work outside this task. Never edit the maintenance policy or its approval object.

Treat every path in `protectedPaths` as read-only and outside routine discovery unless the owner gives current, exact authority for that path. Do not scan or modify retained Prompt-to-3D models, outputs, profiles, or provenance merely because the maintenance task can see them.

First run `npm run maintenance:scheduled`. If it exits with code 3, reports invalid approval, finds an existing lease, detects a dirty authoritative checkout, reaches a budget reserve, or cannot establish provenance, stop without changing source and leave one concise blocked summary. Inspect an underlying process before classifying a timeout; do not kill any process the run did not start.

Use current candidate evidence only from official upstream documentation and registries, repository evidence, observed failures, the owner backlog, and measured bottlenecks. Reject blog-only, social, copied, or unknown-provenance claims. Keep source, build, package, runtime, provider, deployment, and device evidence separate.

Triage every candidate for user value, security value, evidence quality, risk, reversibility, testability, compatibility, resource cost, and overlap with active work. Apply the configured scoring weights and threshold. Carry deferred candidates forward; do not spend through the configured reserve to empty the queue.

Only a small reversible repair may proceed without a new per-candidate approval, and only when the exact approved policy permits repository writes and isolated staging. It must change no dependency, public or internal API, schema, data, permission, secret, provider, model, download, listener, firewall rule, CSP/network exposure, release, or deployment. Create the isolated staging area authorized by the policy; never stage over a dirty saved checkout. Record the baseline revision, policy digest, before-lockfile hash, before-SBOM, file/line budget, and rollback point before editing.

Never autonomously perform a major upgrade, dependency install, migration, destructive data operation, permission or exposure change, secret change, model/provider change or download, deployment, release, package promotion, commit, push, or termination of an unowned process. For these, produce an approval packet with the exact proposed change, official provenance, expected value, compatibility/security findings, resource estimate, tests, rollback, and unresolved questions, then stop.

For an allowed staged repair, make the smallest scoped change, preserve unrelated work, and run the focused checks followed by every configured validation command within the wall-clock and resource reserves. Create an after-SBOM and after-lockfile hash even when the lockfile should be unchanged. Any unexpected lockfile change, failed check, uncertain process state, provenance gap, budget breach, semantic ambiguity, or rollback failure quarantines the candidate. Do not retry beyond the configured count. Hold the passing result for the configured interval and re-check the saved staging state afterward.

Promotion is a separate decision. Even when staging passes, do not adopt, commit, push, package, deploy, publish, install, or restart the retail application unless the owner supplied current explicit authority for that exact action. Never deploy ObjectStore `workers/ai` onto `ai.grudge-studio.com`. Never introduce a second bag database. Play heroes must continue to use `loadRaceKit` Toon RTS, never Meshy.

Finish with one daily summary containing: checks performed; versions and official sources; every candidate and score; changes staged or none; all deferred and approval-required work; security findings; before/after provenance and SBOM locations; focused/full test results; explicit evidence classes; wall-clock, tokens, GPU/VRAM by process, disk, network, diff, retry, and reserve figures; quarantine and hold outcomes; rollback instructions; and every decision with its reason. Stay quiet on an unchanged, non-actionable run unless the configured notification policy asks for routine reports; always surface completion, failure, a meaningful change, or required owner action.
