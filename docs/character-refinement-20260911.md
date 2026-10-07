# Prompt-only character refinement — 2026-09-11

Al asked to replay the four reported alligator prompts, then refine the resulting blockout into a unified character using only prompts inside the Dev Tool. No externally edited model is used in this campaign. Earlier developer preview files are excluded from acceptance evidence.

The character author now exposes surface unification, repeated smoothing, skeleton fitting and skin binding, jaw-bone insertion, and bounded named-bone adjustment through the existing immutable creation runner. Skeleton Studio has observed refinement controls which the shared app prompt operates. A saved result must load in that viewport before the action reports completion; the next prompt uses that exact revision. The creation selection is kept current for later page changes.

Surface unification derives a blended continuous surface from the retained humanoid anatomy. It validates one connected body before saving. Eyes and teeth retain their natural separate meshes. Further smoothing retains topology and skin attributes. The rig fits the retained anatomical landmarks, adds tail joints when a tail exists, normalizes four skin weights per vertex, and validates inverse bind matrices. Bone shifts change the rest skeleton and rebind the skin without replacing surface geometry. Authored skeletal idle deforms the skin and tail. Imported skeletons are not replaced by this character author.

The implementation is local procedural authoring driven by `grudge-dev`. It is not neural model training, Hunyuan finishing, or universal anatomical generation. A connected mesh and valid rig are structural checks; screenshots and playback remain separate acceptance evidence.

## Campaign

The isolated packaged test enters text in the normal prompt windows and activates their normal run buttons. It reads saved revisions and captures the actual viewport. Model creation, edits, skin binding, animation and app navigation run through prompts. The read-only inspection checks file hashes, revision lineage, connected body topology, complete normalized weights and the requested bone displacement.

Runtime evidence is under `.cache/manual-patches-20260910/character-prompts-v2-packaged`. All four original prompts passed, including the exact compound Skeleton Studio handoff. Each used the existing `grudge-dev:latest` planner and the normal app prompt. The first unification attempt correctly failed because packaging had omitted Three's runtime utility under `examples/`. The earlier model was retained. `build-character-author.mjs` now bundles those dependencies into the installed main-process module.

The continued v3 replay used the same app-created character, revision `5120ac40-3685-4924-85c0-17485bdc9b90`. Every following edit passed and loaded its exact saved output in Skeleton Studio:

| Prompt | Verified result |
| --- | --- |
| Smooth and unify the body into a single continuous skin | One connected body, 42,276 body triangles; eyes and teeth stay separate |
| Add an appropriate skeleton and bind the skin | 26 joints, every vertex has normalized weights and finite inverse bind matrices |
| Add a jaw bone to the skeleton | 27 joints, surface geometry unchanged |
| Move Tail2 bone 5 cm down | Tail2 world Y decreased by exactly 0.05 m, surface geometry unchanged |
| Smooth the skin further | Connected body and complete skin retained; surface geometry changed |
| Texture it with appropriate alligator scales | Surface changed; stretched large scales were noticed visually and prompted another repair |
| Animate appropriately | Retained `Character skin idle` clip with actual bone channels |
| Play the Character skin idle clip | App-confirmed playback on the exact current character |

The v3 `result.json`, `inspection.json`, screenshots and `viewport-motion.json` are under `.cache/manual-patches-20260910/character-prompts-v3`. Passive reads of the renderer's loaded mesh sampled 161 body vertices over three frames: 116 moved more than 0.1 mm, maximum tail displacement was 0.2845 m, and sampled feet remained stationary. Rest-pose binding error was below 0.0000001 m. No scene or animation state was set by the inspection.

The final v4 package replaces the stretched pattern on a fused body with spatial cellular vertex colour, including a lighter front and preserved separate eye/pupil colours. It retains positions, UVs, indices, weights and clips. This is authored surface colour, not an inferred texture atlas. Unused materials and textures are removed. The continued v4 prompt replay tests a bone change after animation, blue repaint, restored reptile appearance and playback.

Package: `release/character-refinement-20260911-v4/win-unpacked/Grudge Dev Tool.exe`. ASAR SHA-256 `5d3fe5cdadf17a68c2b003af668d36e8ec9699bdea4b747d410bb377c23c9fc2`; all 607 `dist` files match. Source typecheck, full build/icons, sandboxed preload check and intent-only regressions pass.

The v4 replay passed. `Move Tail2 bone 5 cm up`, `Paint it blue`, and `Texture it with appropriate alligator scales` each saved and reloaded a new revision with unchanged body geometry, all 27 joints, normalized skin weights and the retained idle clip. The last surface has no stretched cylindrical body pattern; the visible result is a unified stylized reptile with a finer mottled scale treatment and lighter front. Playback and three prompt-driven camera views passed. A second passive viewport sample found 116/161 moving body samples, maximum displacement 0.2848 m and zero sampled foot displacement. Full receipts, hashes, inspection and images are in `.cache/manual-patches-20260910/character-prompts-v4`.

The test launcher exited after its assertions, so the final build was explicitly relaunched with file-backed logs for manual testing. PID 71320 started at `2026-09-11T01:34:45.3909459+08:00` and is responsive. The app's prompt reopened the exact current model in Skeleton Studio, zoomed the viewport, and played the idle clip. `ready-for-manual.png` and `manual-ready.json` record that final state. The global prompt remains open; refinement controls are collapsed.

Final revision: `08354147-93fe-420a-883c-565f2ac29446`, under the retained app test profile `.cache/manual-patches-20260910/character-prompts-v2-packaged/profile-AyEYvd/assets/creation-history`. The normal user profile and its earlier history are preserved. Current runtime identity and fresh monitoring checkpoints are in `.cache/manual-testing-20260910-232036/session.json`; prior files were backed up. The existing two-minute passive monitor is resumed for this exact process and profile. It does not submit prompts or edit models.

No model was externally edited or imported from a developer preview during these app runs. Source patches, build/package checks and read-only artifact inspection are separate from the app-controlled model operations. The current result is a unified local procedural character, not a photorealistic asset or proof that every conceivable prompt is supported.

The first development-mode launch did not reach the prompt screen; the campaign was restarted against the packaged app. No model was produced by that failed launcher.
