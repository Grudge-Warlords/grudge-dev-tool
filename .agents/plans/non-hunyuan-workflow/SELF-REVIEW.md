# Self-review — recent workflow completion → main

**Outcome** Earlier independent reviews resolved 28 findings across maintenance, guided reliability and local/region work; the final focused pass found and fixed 4 additional defects and is clean.

**Reviewed** `c616ae4f3ca595a89cb2ee3b0aac22a92ff52398` (`main`, stamped from the reviewed working tree on `54feed59`; 158 files, +33,060 −952)

**By** Codex desktop, GPT-6 — self-review v0.7, 2026-09-06; earlier isolated reviewer model IDs were unavailable.

**Verification** Full production build, sandboxed preload, packaged operational smoke, both TypeScript projects, governed maintenance checks, Python syntax, real concept-preparation regression, and focused Prompt-to-3D, storage, reference, workflow, Paint merge, creation, deformation, animation, viewport and recovery checks passed.

The final pass used the author context because current orchestration did not permit a fresh reviewer. The earlier isolated reviews covered the staged maintenance, guided-reliability and local/region implementations; this pass concentrated on the final storage, framing, Paint and package changes.

<details>
<summary>Review details</summary>

**Intent** Complete the discussed local creation, guarded neural workflow, editable deformation, reliability and maintenance configuration while minimizing active input and preventing unsupported or unapproved actions.

**Project rules** `.agents/docs/self-review-rules.md` not present. `AGENTS.md`, the task requirements and evidence boundaries were applied.

**Diff** `ee9ada65d39aa9b15e818cbae24c22d0ae3d79ad`

## Final focused pass — working tree on `54feed59`, 4 findings

1. `src/main/prompt3d/service.ts:1231` — the second storage check reserved only concept space for direct geometry routes → **fixed** with one shared stage-selection function used by both admission checks.
2. `src/main/prompt3d/hunyuanProfiles.ts` and `tools/prompt3d/provider_worker.py` — the app exposed unvalidated 256/384 px Paint modes below upstream's supported 512/768 range; two real outputs produced incoherent atlases → **fixed** by one new immutable 512 px profile requiring the upstream-recommended 21 GiB free VRAM.
3. `scripts/smoke-packaged.mjs:291` — packaged smoke still expected the removed Generate/Select source buttons → **fixed** to require Prompt only, One image and Four views and exercise the Prompt-only transition.
4. `docs/prompt-to-3d.md:111` — the operator contract still described a reorderable one-to-four picker → **fixed** to document the guided one-front-or-exact-four labelled flow.

Earlier independent review records remain beside their task plans and are deliberately excluded from the commit, as required by the self-review skill.

</details>


