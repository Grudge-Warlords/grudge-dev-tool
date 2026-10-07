# ThreeFlow embedded-editor repair

Prepared 9 September 2026 while exercising Grudge Dev Tool's embedded actions. This is a local, build-checked repair for the existing ThreeFlow editor. It has **not** been pushed or deployed to `threeflow.vercel.app`.

Apply [the patch](threeflow-embedded-20260909.patch) to `MolochDaGod/ThreeFlow`, base `cfe58bc9ab088b303c4412e3415116d523243c58` on `master`. Application against that exact base passed using a separate temporary Git index; the source index and branch were preserved. The examined source differs from the currently deployed bundle, so deployment still needs its own acceptance.

## Result and causes

Primitive creation and renaming now refresh the hierarchy and selected-object caption. The primitive handler previously highlighted before assigning the final name and never invalidated the tree. Light creation also refreshes the tree. Property transforms update matrices without disposing the object's material; camera property changes refresh projection.

Saved scenes retain their authored objects, particles and transforms. Save/export share one serializer, update pending matrices and omit marked editor helpers without cloning and disposing live resources. Legacy saved helpers are removed on load; measurement bindings and transform mouse listeners are correctly replaced. This prevents the duplicate `Line` entries observed after reload.

The default studio lighting is regenerated on restore. Three's generated render-target environment is deliberately omitted from its scene JSON; the old loader also disposed the newly parsed scene. The repair disposes only the old scene after parsing, restores the editor's owned environment target, preserves explicit `none` or loaded custom-texture modes, awaits ground restoration and refreshes selection. Basic scene/camera/target validation happens before replacement. This is not a claim that every possible import failure is transactional.

The upstream source was missing its referenced command registry and palette module. The patch supplies the registry and a searchable palette wired to the header's existing commands, with Close, Escape and Ctrl+K. It also resolves the source build's Vite JSX peer mismatch, stale vendor aliases and reported type errors. An explicit empty PostCSS configuration prevents this nested checkout from inheriting the Dev Tool's unrelated Tailwind setup.

## Verification

- `npm run build` passes: Vue typecheck and Vite production build. The existing large-chunk warning remains. The separate `build:pro` script references a missing doctor script and was not used.
- `node scripts/test-scene-snapshot.mjs` passes with Node 24.16.0 and installed Three 0.185: three serialization/reload cycles retain the mesh, authored particles and exact position; live resources are not disposed and helper objects do not accumulate.
- Normal browser UI on loopback `http://127.0.0.1:5183/editor`: drag Box, observe immediate tree entry, change Name to `Restore Check` and Position X to `3`, save, reload, and inspect the restored object. Textured ground and lit box remain visible. A later reload of the final helper repair retains Name and X=3.000 with a clean hierarchy.
- Palette opens, filters to Save scene, dispatches that existing command and closes. Reload remains usable. This is browser UI acceptance of the local editor, separate from Ask Grudge's production-site prompt tests.
- Evidence: `.cache/prompt-e2e-20260909/phase5-threeflow-local-restored.png`, matching `.txt`, `phase5-threeflow-build.log`, `phase5-threeflow-snapshot-check.log`, and `phase5-threeflow-patch-check.log` in the Dev Tool checkout.
- The earlier production failure remains retained as `phase5-live-threeflow-reload-v44.jpg`: name/position persisted there, but lighting did not. This patch does not change that deployment by itself.
- The Dev Tool's optional `scripts/test-threeflow-integration.mjs` passes three separate real `grudge-dev:latest` prompts against this actual local build in a private Electron/webview session: add Box, set Name and Position X, and click Save once. It then waits for a different document and checks the restored name/X via the fresh bridge. Result and screenshot: `phase5-threeflow-integration/results.json` and `restored.png`. The first test attempt's reload race is retained and corrected; only the second run establishes reload acceptance. This is local integration evidence, not production or a single combined workflow.

## Local reproduction context

Source copy: `E:\grudge\grudge-dev-tool\.cache\prompt-e2e-20260909\threeflow-source`. The upstream manifest references five omitted `vendor/@grudge-studio` packages. Local build preparation copied existing package sources and distributions from `E:\grudge\GrudgeStudioNPM\packages` for `animator`, `asset-resolver`, `assets`, `core` and `engine`; the missing asset-resolver distribution was built in the temporary vendor copy. No canonical package source was edited. Those vendor copies and the local preparation helper are not in this patch.

Dependencies were installed with lifecycle scripts disabled and without changing a lockfile. No credentials, account permissions, installed user app, public listener or deployment changed. Hunyuan and hardware restrictions were outside this continuation as requested.
