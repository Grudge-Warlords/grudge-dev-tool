# Manual-testing repairs — 2026-09-10

Al's live testing exposed collapsed primitive character layouts, unrelated generic blue textures, an unsupported generic animation request, and previous failures appearing in subsequent command feedback.

New creation requests now discard the previously selected model's kind and named-part context. Humanoid requests use the existing primitive assembly route with spatial anatomy instructions and bounded component rotations. Validation rejects identical overlapping primitives, assemblies entirely at one point, and missing or inverted basic humanoid layouts. This is original procedural geometry, with its quality still subject to visual review.

Component texture passes preserve their base colours instead of using the generic blue panel fallback. Reptile subjects can receive authored scale patterns, with separate eye/tooth surfaces. These are procedural pixel patterns, not neural paint. A generic appropriate-animation request on a supported character maps to a modest in-place segmented idle; explicit named motion and negation remain authoritative. New requests clear the previous outcome/error, and new-asset feedback distinguishes the retained previous model.

Validation passed: both TypeScript projects, production renderer/main/icon/preload builds, sandboxed preload checks, prompt-build regressions and existing app-action checks. The new regressions exercise collapsed geometry rejection, new-subject isolation from a selected sword, orientation retention, actual texture content differences, repeat-pass colour retention and nonempty idle channels with unchanged geometry.

Package: `release/manual-patches-20260910-v1/win-unpacked/Grudge Dev Tool.exe`, version 1.1.1. ASAR SHA-256: `fb80afef2feb1e7700f4459a31254718a0a26331b4450475440a457c7c3304a9`.

Real-model packaged replay was interrupted before completing: Al stopped the first run, then explicitly requested manual control during the second. The isolated runner was stopped and the new package launched with the normal user profile. No completed alligator creation or visual/motion acceptance is claimed for this patch. Al's manual testing and passive monitoring continue. Existing source branch, installed app and saved models were preserved; no commit, push or deployment.

Evidence: `.cache/manual-patches-20260910/` and `.cache/manual-testing-20260910-232036/`. The original failure evidence and session identity remain retained separately from the patched runtime.
