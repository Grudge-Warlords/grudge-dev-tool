# Self-review — guided reliability, 2026-09-05

## Review boundary and provenance

Dev Tool base HEAD: `54feed59b860ceb0b7a3e77212f0efa7672ec304`, main, with extensive pre-existing dirty work. The reviewed artifact is the task-only delta from `D:\gruda-build\outputs\guided-reliability-20260905\baseline`, not the entire Git diff. Runtime code delta SHA-256 before final documentation updates: `f7a5b959717bfa1efa3cb4ac562eef976867e04e05cb7eb86c44c873f4834351`. Final per-file normalized hashes and review patch are retained beside the audit; these hashes normalize text line endings.

GrudgeBlox base HEAD: `e80652b14c328ecd4532633e57bcc39f5a099b17`, saved main initially clean. Its current Git delta and new reliability files are the review boundary. Dependency changes were checked separately against current audit metadata, primary release notes, actual adapter behavior and the production build.

Independent read-only fresh-eyes reviewers: `/root/review_guided_reliability` and `/root/review_final_reliability`, isolated Codex reviewer contexts. Exact underlying model identifiers were not exposed and are not invented. Reviewers did not mutate files, build, run providers, access production or delegate. Follow-up reviews assessed concrete corrections and reported no remaining scoped blockers. This is working-tree review, not commit/PR or deployment approval.

## Findings and dispositions

| Finding | Resolution / evidence |
| --- | --- |
| Update-ready state lost after renderer reload | Main retained status, typed snapshot IPC, synchronous subscriptions with event/snapshot race guard and replay; actual updater module regression passed. |
| Browser number inputs erase malformed text | Raw-text numeric component and optional text inputs; invalid seed stays visible and cannot submit, proven with package keyboard input. |
| Previous saved record obscures current verification failure | Current-result save error takes precedence and exposes explicit Retry; duplicate save latch retained. |
| Provider-switch installation events use stale readiness closure | Refresh reads `currentSpec.current`; newest-request and selected-provider guards remain. Follow-up source review confirmed. |
| Negation leaks across `but`, allowing partial unsupported motion | Contrasting-clause boundary and actual compiler failure regression. |
| Initial boundary correction mishandles temporal `not yet` | Removed `yet` boundary; actual compiler proves two temporal travel prompts stay stationary and negated unfolding remains negative. |
| Updater emits installation failure rather than throwing | Error event releases install latch; recovery check regression passed. |
| Game remount inherits stale ECS state and pending loads | Reset removes world entities/events, preserves only event queue, and rejects old mesh/socket results; pending-load/reused-ID regression passed. |
| Three.js instance disposer shadows prototype override | Separate `disposeSession()` invokes custom cleanup and then the instance disposer; final independent source confirmation passed. |

## Acceptance and checks

Requirements 1–6: implemented and validated through focused failure checks and source review. Requirement 7: dirty work and installed owner session preserved; a final isolated installer exists. Requirement 8: typechecking, build, preload, package integration and isolated packaged startup passed. Real Hunyuan generation and visual acceptance, CLI sign-in, maintenance approval and normal-profile installation are explicitly separate.

GrudgeBlox: 16 backend/input tests, six client lifecycle/resource/URL/initial-markup tests, actual textured GLTF/PNG/sanitizer compatibility smoke, lint/typechecking, production build and loopback network smoke passed. The final primary-agent review also moved stored-login reads after hydration; actual first-render markup is identical with and without browser storage. Production audit reports zero advisories at this snapshot. Browser visual acceptance and authenticated ownership are not inferred from these checks.

Full evidence and outstanding work: `D:\gruda-build\outputs\guided-reliability-20260905\AUDIT.md`. No commit, push, release publication or deployment was performed.

Final Dev Tool implementation/document delta: 24 files; LF patch SHA-256 0ACC8C9FFD80D5BF02E6B0579C727EE51FE99B7A41A3A01874AC292725C7453B. Final GrudgeBlox manifest: 27 changed files, including new tests/helpers; tracked Git patch SHA-256 58D3755E9E7E012732DA7DCA940F408BAA7FB56D0F427869D68BD2452DA2C771. Raw file hashes and package sizes are retained in the audit folder. Plan/review records are outside these implementation patch hashes.
