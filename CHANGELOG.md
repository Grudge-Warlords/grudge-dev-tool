# Changelog

## 2026-09-06 — local shapes, asset reuse and editable moving areas

- Add box, sphere, cylinder, cone, plane and torus to local procedural creation; retain earlier template prompts, local textures, bounded resizing and turntable animation without Hunyuan.
- Add normal Assets/Local Files working-copy handoffs; retain immutable source hashes, embedded/catalog identity, materials, skins and clips, and support Meshopt source decoding.
- Add actual influence previews and named/coloured custom moving areas, model-relative instructions, strength and coverage, undo/reset, exact retained clip binding and sibling saves. Preserve rejected originals and unrelated clips.
- Split Hunyuan starts into prompt only, one image and four individually labelled images; reject duplicate bytes and incomplete four-view sets.
- Keep positive small-subject, full-body and broad-margin conditioning in natural-creature concept prompts so ears, feet and tails are less likely to be cropped before review.
- Re-centre close but complete provider concepts inside a broad deterministic margin while retaining the untouched provider image; continue to reject subjects that actually touch an image boundary, and always require human semantic review.
- Remove the unvalidated 256/384 px Hunyuan Paint modes after real output produced incoherent UV atlases. The app now exposes only the upstream-supported 512 px six-view profile, requires Tencent's recommended 21 GiB free VRAM and reports busy below that threshold instead of spending time on a predictably unusable texture.
- Reject a full selected output volume before provider inference using stage-specific conservative space estimates, an explicit recovery message and no installed-provider bypass. Keep post-approval geometry progress above the retained 36% gate.
- Collapse optional local settings/history, retain authored materials and frame long or tall models to their true projected bounds so the saved-model viewport remains useful without cropping.
- Pass normal-app create/adjust/animate/save/reopen checks for local assets and real catalog reuse. Pass one-image Hunyuan kangaroo geometry review; retain both visibly defective Paint attempts as rejected, so no neural animation or full-chain acceptance is claimed.

## 2026-09-05 — guided input, recovery and configuration reliability

- Reduce active creation to one primary subject prompt with optional generation, finishing and batch controls collapsed; expose the missing custom-style description. Preserve all exact concept and staged visual-approval requirements behind a comprehensive explicit review action.
- Keep malformed numeric text visible, enforce shared bounds in renderer and main process, and reject known unsupported affirmative transformations before a partial motion result can be authored. Preserve negation across temporal `not yet` and end it at contrasting clauses.
- Refresh current-provider readiness without stale-response overwrites. Retain current managed-save failures with explicit retry and duplicate-save protection.
- Add eight-second probe aborts, unused-body cleanup and API/asset HTML fallback rejection; make doctor JSON/text exit status consistent and recognize the canonical project configuration.
- Retain updater status across reloads, guard trusted IPC senders, separate allowed update states and coalesce duplicate actions. Missing feeds stay unconfigured; install errors remain recoverable.
- Build and smoke an isolated Windows installer; normal-profile installation and genuine asset acceptance remain separate in PROJECT_STATUS.md.

## 2026-09-05 — capability-based Hunyuan generation

- Replace fixed-card Hunyuan gates with measured operation profiles: full GPU, offloaded lightweight GPU and high-RAM CPU shape generation, plus balanced and lightweight six-view Hunyuan Paint. Keep the same pinned local providers, retain every selected setting/device/GPU UUID in provenance, and never silently substitute a procedural, stock or cloud result.
- Preserve generic creature anatomy, counts and part-to-body relationships in short natural-language prompts while keeping the subject ahead of the standard plain-white/no-stand presentation contract. Make negative compilation resist accidental positive readings of “do not”/“no” clauses and avoid broad creature-class suppression.
- Add bounded offline concept-sweep diagnostics that produce Hunyuan images and a manifest for prompt investigation only; these outputs are explicitly ineligible as geometry or acceptance evidence.
- Prove a genuine concept and technically valid geometry run, then correctly withhold visual acceptance when the required rear tail was not visible. The workflow remains stopped before Paint, motion and final save/export/reopen.

## 2026-09-05 — packaged new-asset workflow repair

- Treat local installers without a published update-feed file as unconfigured, rather than repeatedly displaying a missing-file updater error. Discovery, download and install remain separate; no feed is invented or contacted.
- Start guided new roots from clean generation defaults and the planned category/style, without inheriting a previous creature's scale, anatomy, seed or reference bindings. Explicit current-asset revisions retain their category and scale.
- Recognize ordinary prop-motion requests including float, hover, bob, spin and rotate, plus swim/slither, in both new and retained-asset routing. Use the existing affirmative-intent gate so excluded motion is not scheduled.
- Add regression coverage for the live crystal request, stale-setting isolation and negated motion. Full package, provider and save/reopen evidence is recorded separately in PROJECT_STATUS.md.

## 2026-09-04 — unified quality-first Prompt-to-3D routing

- Make `/prompt3d` the single guided owner surface for new creation and exact-revision continuation. A typed allowlisted compiler routes to existing procedural, Hunyuan, TRELLIS, Paint/refinement, CPU animation, optional HY-Motion, Skeleton Studio, Forge, Scene Completion, validation and save capabilities without creating replacement editors or arbitrary execution hooks.
- Rank creation routes by capability/expected quality, verified readiness, provenance compliance and resource feasibility. Show a blocked quality leader and next eligible route before continuing, expose a compact explicit override, and retain the automatic recommendation, override, enabled stages and exact revision in creation/workflow provenance.
- Keep Grudge-local planning authoritative: deterministic routing makes no model contact; the explicit advanced schema planner uses the existing loopback `grudge-dev` preference, performs no start/pull/install, and has no external-provider or `localAgent.ts` fallback.
- Add only a minimal reversible UI scaffold. Final 4K layout, spacing and information hierarchy remain pending the user's live visual design review and are not claimed as accepted.

## 2026-09-04 — hardware-independent local animation

- Make the guided CPU route the default manual animation choice. It requires no neural-motion install or GPU/headroom threshold, while optional HY-Motion continues to select its CUDA or official CPU execution profile from measured capability rather than a named card.
- Add deterministic Mixamo-25 skin preparation for safely classified humanoids, explicit Skeleton Studio correction when anatomy or pose is uncertain, compatible local animation-library retargeting, existing prompt-bound deformation for non-humanoids and truthful object-space motion for rigid props.
- Preserve exact approved Hunyuan geometry and Paint bindings through every CPU route, retain immutable route-specific provenance and show a prominent non-generative/non-HY-Motion label. Strict Hunyuan and serial-batch acceptance explicitly reject these local CPU routes.
- Route anatomy, stance and skeletal-action keywords through the shared negation-aware analyser. Negated anatomy or motion can no longer be treated as affirmative, and mixed humanoid/non-humanoid descriptions fail closed.

## 2026-09-04 — capability-based HY-Motion execution

- Replace the fixed-GPU runtime gate with ordered provider-native execution profiles. Prefer full HY-Motion CUDA inference when a measured adapter has 24 GiB total and 20 GiB currently free VRAM; otherwise offer the official CPU path when at least 32 GiB total and 24 GiB free system RAM is available.
- Enumerate all NVIDIA adapters and bind CUDA by retained GPU UUID, so a lower-capacity display card at index 0 cannot mask or receive work intended for another card.
- Add a visibly labelled basic CPU profile with a retained 12-step inference schedule. It still loads the pinned official HY-Motion Lite checkpoint and generates skeletal channels; it never falls through to procedural transforms, canned clips or a cloud service.
- Bind execution profile, device, validation schedule and optional GPU UUID into the motion request, returned motion artifact, provenance and GLB binder. Any mismatch fails before the result can reach visual approval.
- Show the automatically selected profile and its speed/fidelity tradeoff in Install Options and the animation stage, while retaining the same human/humanoid compatibility and visual acceptance gates.

## 2026-09-04 — genuine local HY-Motion skeletal animation

- Add the pinned official HY-Motion 1.0 Lite source/model/runtime as a separate local motion provider with signed installation records, deep pre-run verification and provider-bound execution.
- Retain the model's native 22-joint rotations, root trajectory and rest rig instead of its wooden preview body. Bind those joints to the exact approved Hunyuan mesh through the Studio's existing Mixamo-25 core, with a real skin, inverse-bind matrices, normalized four-weight influences and generated bone channels.
- Replace the instant procedural animation path in the installed-neural workflow. The animation screen now sends prompt, duration, clip mode and seed to HY-Motion; append/replacement, exact rejection, final save/export and reopen remain available.
- Add a local semantic compatibility and negation gate. Horizontal root travel is retained only when explicitly requested; ordinary locomotion remains in place, while non-humanoid or contradictory prompts fail visibly rather than becoming a rigid slide.
- Prove in focused tests that geometry and Hunyuan Paint fingerprints remain unchanged, stationary travel is stripped, explicit travel is retained, 22 generated rotation channels are playable, skin weights are normalized, clips append correctly and compatibility evidence cannot be swapped.

## 2026-09-04 — clause-bound local motion analysis

- Stop collapsing materially different animation prompts into the same canned gait. Paired-limb synchronization, alternating coordination, numeric lower-limb articulation, ground contact and rear/tail counterbalance are now separate typed requirements with separate motion operators.
- Run the installed loopback Ollama model as a semantic checkpoint during the explicit **Analyse prompt and create animation** action. It must acknowledge every compiler-extracted requirement; an omission or change fails before animation authoring, with no cloud fallback and no GPU use.
- Retain requirement-to-operator coverage and local-analysis evidence inside the clip plan and provenance, and show the exact coverage beside the animation preview before visual approval.
- Add synchronized reach/tuck, rear counter-phase deformation, gait rise and body lean. For the retained 0.8 × 1.8 × 1.6 m front-referenced subject, unspecified forward travel is now 2.0 m rather than 4.8 m, and its explicit front reference follows the coordinate contract instead of the prompt-only right-facing assumption.
- Render nine frames from the exact retained Hunyuan mesh for semantic inspection, and add regressions for the previously ignored prompt, conflicting coordination, unsafe articulation angles, semantic-plan omissions and measurable output channels.

## 2026-09-04 — prompt-bound creature animation

- Separate body-part directions from whole-subject placement. Wording such as “body bends down” and “legs move forward” now compiles to in-place body operators rather than a downward or forward root slide; an affirmative whole-subject “return to the original position” authors an out-and-back path that ends at its start.
- Add a generic crouch/bend morph, continuously weighted alternating limb motion, and the retained creature-facing direction for body-local movement. The compiler remains object-agnostic and does not add a model-specific rig, mesh, template, or asset implementation.
- Block creature/character prompts that contain only rigid translation or rotation, both visibly in the creation panel and synchronously in backend preflight. The panel now shows the inferred path and body actions before generation.
- Measure actual morph POSITION displacement and animated weights after GLB serialization. A named morph target no longer counts as implemented motion unless it produces an active, non-zero body mutation; the evidence is retained in finishing validation and provenance.

## 2026-09-04 — optional Stage 4 shape refinement

- Add **Use the existing generated model** to Stage 4 after the exact base Hunyuan geometry has passed technical checks and explicit multi-view visual approval. This advances directly to the texture prompt; shape refinement remains available instead of being mandatory for an individual asset.
- Retain the decision as a timestamped, hash-bound explicit-user-action record tied to the exact generation job, first variant, model SHA-256, geometry identity and visual-approval evidence. Texture approval, later animation, managed save, portable export and reopen all revalidate that record.
- Keep the strict six-item serial acceptance route unchanged: batch dispatch rejects the base-model shortcut and still requires a prompted, approved Hunyuan shape refinement for every item.

## 2026-09-04 — Hunyuan reference-image generation

- Make image sourcing the first new-asset decision. Stage 1 presents only **Generate image** and **Select image**; the former opens prompt-based HunyuanDiT concept configuration, while the latter opens the verified local multi-image picker before exposing prompt, dimensions, seed and generation settings.
- Show the chosen source method at Stage 2, allow it to be changed before generation, return new assets to the source decision, and require the current method and its exact reference state to agree before the Generate action can become available.
- Add one-to-four-image intake directly to the current creation stage, with visible front, left, back and right roles that can be corrected before generation. Preserve the existing prompt-only route and keep strict serial acceptance batches prompt-only.
- Route a single image through Hunyuan3D 2.1 and two to four labelled images through the separately pinned official `tencent/Hunyuan3D-2mv` checkpoint and multiview processor. Translate only the older official config's Python namespace in a retained job-local runtime config; never alter the signed safetensors weights.
- Decode, bound, copy and SHA-256 bind every selected source before provider preflight. Revalidate the ordered view set at concept approval, provider dispatch, save, export and reopen, and retain all view roles and hashes in provenance and root lineage.
- Add typed IPC/preload contracts, multi-selection UI, install inventory, tamper/role/ordering tests, and an offline real-model load plus labelled-conditioning smoke test. Visual correctness remains subject to the existing explicit concept and model approval gates.
- Declare the provider's one-to-four-view limits, required front view, supported roles and exact single/multiview model selection as typed manifest capability. Dispatch now rejects any undeclared provider, route, role, count, duplicate byte set or model choice instead of discarding an image or substituting another provider.
- Show a retained local thumbnail, role, dimensions and hash for every view, with per-image reorder and removal controls. The UI names the automatically selected official model and keeps Generate disabled for a set outside the declared capability.
- Prove the implemented route with a fresh offline four-view RTX 3090 pass at 50 shape steps and octree resolution 512, then inspect the 403,996-triangle result from six directions. Runtime/provider viability passed; the test mesh was deliberately denied semantic visual acceptance and no texture or animation acceptance was inferred.

## 2026-09-01 — Cosmetic detail and bounded structural refinement

- Add two truthful follow-up operations to the current procedural asset: **enhance** authors new cosmetic detail meshes, while **adjust** changes only supported named parts. Both create immutable child revisions, change the geometry hash and retain the existing embedded textures, animation clips, asset ID and source lineage.
- Add sword fuller/inlay, ricasso collar, guard caps and pommel inlays; game-prop vent ribs, energy coils, sight and side studs; and character shoulder plates, cuffs, belt buckle, knee trim and boot trim.
- Add bounded structural controls through ordinary prompts: sword blade length/width/curvature and guard width; game-prop length/bulk and muzzle size; character height/breadth and head size. Move the cosmetic projectile with the adjusted muzzle and preserve the sword swipe and articulated dance clips.
- Expose per-asset **Available refinements**, applied-change summaries, detail-node counts and previous/current geometry identity in the existing Prompt-to-3D page. Unsupported free-form sculpting remains unavailable instead of being silently approximated.
- Verify all six follow-ups through the normal packaged Grudge UI in one isolated session, then cleanly restart only that package and replay the three final adjusted assets from local storage without regeneration. All 15 original and refinement revisions remain available. Build `original-flow-2026-09-01.2`; optional Ollama, neural providers and commercial licensing remain outside this CPU procedural proof.

## 2026-08-31 — Coherent original creation, texturing and motion

- Use existing Category/Style plus optional local planning; remove the redundant Object/Component panel from the creation workflow and supersede the mandatory concept-choice design. Preserve original briefs and internal object rules without overriding explicit user choices.
- Add an explicitly selected CPU procedural method for basic curved swords, cosmetic game gun props and original segmented people. No borrowed model or reference render is used as creation input, and it never silently replaces a neural provider.
- Keep the current asset across short texture/animation follow-ups. Author embedded surface maps, grip-pivot sword swipes, a visible cosmetic muzzle projectile and independently articulated character joints.
- Save every submitted attempt and stage separately with prompt/settings, source method/build, immutable GLB, provenance, hashes, validation and event history. Expose local Open / replay without regeneration; failed attempts remain records rather than fake replayable assets.
- Remove automatic generic/library character preview loading and reject borrowed/comparison preview markers on affected refinement/export paths. Preserve existing model libraries on disk.
- Verify all three nine-stage prompt chains in one continuous packaged UI session and visibly reopen/replay all three final local GLBs. Trial package and original user app are separate. Retain 31 actual screenshots, exact prompts and an illustrated guide under the originating task's `outputs/grudge-flow-trial-01` directory. Optional Ollama/neural providers and Hunyuan commercial clearance are outside this procedural proof.
- Separately verify clean trial-process restart with the same isolated profile: nine stages/preferences restore and all three final local models replay with textures/motion. Retain eleven additional screenshots and unchanged-file evidence; the original user app remains untouched.

## 2026-08-31 — Object and component generation rules

- Add remembered object type/component choices and a visible compiled geometry prompt. Profiles cover swords, axes, striking weapons, polearms, staffs, bows, shields, grapples, props and environment/building fixtures; components have their own shape and orientation rules.
- Keep original prose as the surface brief. Exclude presentation and decorative clauses from geometry conditioning, put type/orientation/white background first, and prevent approving an outdated concept after shape rules change.
- Export a typed attachment marker at the chosen bounds point, with editable X/Y/Z percentages and an explicit vertical flip. Update collision placement and technical origin checks; semantic grip/socket correctness still requires visual inspection.
- Present concept-background/framing rejections as review messages instead of progress-bar tracebacks. No new model download, cloud fallback or automatic generation.

## 2026-08-31 — Sword shape quality and chat refinement

- Prioritize defining shape in concept prompts, isolate white-background foreground, reject cropped concepts, and seed geometry explicitly at 512 reconstruction resolution.
- Preserve proportions by scaling uniformly to requested height; keep source geometry and avoid aggressive simplification that destroys thin details.
- Add concept preview/approval/reuse and distinguish technical checks from visual acceptance.
- Extend local Forge with CPU-planned chat recipes, procedural texture regions, turntable/swing/thrust previews, before/after, scrubbing and immutable autosaved GLB revisions. Original assets remain available.
- Add explicit precision longsword/sabre/leafblade/rapier authoring with named parts and adjustable blade profiles. It is labeled procedural and never substitutes itself for Hunyuan. Save a separate local planner endpoint; an explicit button can start installed native CPU Ollama without downloading models.

All notable changes to **grudge-dev-tool** are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Governed daily maintenance control plane with a digest-bound, fail-closed policy; external run ledger; per-process GPU observation; lockfile/integrity and icon checks; metered opt-in registry/OSV discovery; SPDX 2.3 SBOMs; explicit evidence classes; isolated-staging prompt; hold/rollback rules; and an inactive scheduled entry point. All budgets are unconfigured and all authority switches are off by default.
- Separate `ci:local` and `ci:live` validation surfaces. Machine-readable doctor runs can use `--no-write` and no longer need to persist a health score.
- **Prompt to 3D** (`/prompt3d`) — versioned `AssetSpec` planning, separately selectable official Hunyuan3D 2.1 and Microsoft TRELLIS local providers, live physical/setup/headroom gating, deliberate isolated installer/repair/remove workflow, loopback-only bounded jobs, preview, provenance, deterministic validation/quarantine, and handoff to the existing asset pipeline. Includes a source-side offline local-test mode with isolated profile/ports and no fleet/updater/Ollama/cloud contact.
- Prompt-to-3D installer reproducibility — pinned TRELLIS CUDA/source dependencies replace the upstream moving-head setup script, Hunyuan/TRELLIS offline model closure is explicit, WSL distribution selection is configurable without moving it, and signed manifests include isolated runtime-lock hashes.
- **Native Three Play** (`/play`) — SceneEngine + `gltfProdLoader`, Toon `{race}.glb`, WASD TPS (Orbit off), one mixer idle/walk/run, video plane, Forge scripts + AI script. Preview stays fleet webview. Not Rapier (live games own physics).
- **Pipeline Review AI Worker** (`pipeline-review`) on the existing Scene Completion / `aiChat` stack — diagnose, convert, laterality, strip-position, optimize, R2+D1, CDN HEAD. Pipeline window: **Pipeline AI review** / **Review + send R2/D1**.
- **Convert-before-upload** on **Send to R2 + D1**: FBX/OBJ/… → GLB, magic-byte, then PUT, then **HEAD** `assets.grudge-studio.com` (reject HTML 200).
- Packaged first launch **auto-registers HKCU file-defaults** (one-shot) so Explorer double-click hits the pipeline without a Settings click.
- Doctor / fleet health: scored **CDN Toon human.glb** HEAD. Author WK FBX probe is optional.

### Changed
- Desktop update checks no longer download or install automatically. The user explicitly chooses download and then restart/install. Manual publish dry-runs now stop before fetch/pull and every write, and release commits no longer add agent attribution.
- Worker configuration audits resolve the Dev Tool checkout from the running script, accept a configurable GitHub root, fail JSON mode consistently, and reject duplicate or ObjectStore claims on `ai.grudge-studio.com`.
- Prompted animation now separates body action from placement: walking, running, swimming, slithering and flying animate in place unless the prompt explicitly requests a direction, path or measured displacement. Directional distance and hop height scale from the generated asset dimensions, negated motion terms remain constraints, grounded gait receives visible alternating lower-body deformation, and validation rejects missing travel, unintended in-place translation or a vertical hop that does not land. Subject-relative forward/backward travel for the generic creature profile now follows its retained viewer-right presentation pose instead of sliding on the unrelated canonical +Z engine axis; explicit world-space directions are unchanged.
- Prompt-to-3D automatically saves the asset brief and each job's status and restores prior results (including older output folders). Starting a new generation clears the live preview while preserving earlier files and history. Interrupted jobs are retained for deliberate retry and never resume automatically.
- **Enable local controls** is now one remembered checkbox. Its enabled/disabled choice survives navigation and application restarts; capability secrets remain window-scoped in the main process, with explicit install/run actions unchanged.
- `viewer:convertModel` IPC forwards `localPath` (disk convert, not http-only).
- Prompt-to-3D now uses the same padded, scrolling shell alignment as other work pages, persists a chosen generator root across restarts, automatically adopts the complete pinned `E:\\GrudgePrompt3D` installation when no choice is saved, and reconciles stale status files against detected install manifests.
- Agent AI's local workbench action now opens the actual in-app Forge workbench through a registered hidden route. The primitive toolbar exposes Box, Sphere, and Plane, and the script pad includes a typed clip attachment API plus a balloon-with-string float-up example that can be built, previewed, animated, and exported entirely through the Grudge UI.

### Fixed
- A visually approved first animation now advances the normal single-asset workflow directly to **Save, export and reopen** instead of trapping the user in animation configuration until a second animation is approved. The final panel exposes an explicit **Save final model to Local Files** action alongside automatic saving, plus an optional **Add or refine animation** route that can return to save without discarding the approved result. The separate strict six-item acceptance batch continues to require both animation prompts and approvals.
- Texture and animation review now exposes an explicit classified **Reject** action. Rejection is sealed to the exact retained job, asset hash, prompt, specification and finish fingerprint; it hides the failed preview and permits a corrected sibling only from the exact approved parent. Animation correction is locked to **Replace rejected clip(s)** so a bad clip cannot remain first or make regeneration appear unchanged. Merely unapproved output is no longer treated as rejected.
- Prompt-to-3D now gives an approved Hunyuan Paint result an explicit **Use approved texture and configure animation** action. The exact approved texture is already retained locally, the manual continuation survives a restart, and final manual save/export accepts that texture after one approved animation. The strict six-item acceptance batch still requires both an initial and refined texture plus both animation revisions.
- All Dev Tool 3D viewports now share left-drag X/Y pan, right-drag orbit, middle-drag camera dolly, and wheel zoom. Prompt-to-3D displays the current navigation context and last action, resets stale active state, and reapplies the same mapping when an asset or workflow stage hands off.
- Hunyuan shape-refinement lineage now permits multiple genuine prompt-edited concept successors instead of misclassifying every post-first edit as seed-only regeneration. New prompt edits advance the retained seed exactly once; existing fully hash-bound same-seed edits remain reopenable through a narrow compatibility path, while unchanged prompts, forged decision kinds and discontinuous provider/reference bindings still fail closed.
- Hunyuan concept review now records the effective subject-presentation contract, requires three explicit hash-bound visual checks before approval, and retains classified semantic/presentation/prompt-understanding rejections before a fresh-seed regeneration. Exact technical-report, inspection, correction-prompt, seed and successor-plan evidence is revalidated by history reload, provider geometry and final workflow lineage. Completed legacy assets still reopen, while pending legacy concepts require fresh structured generation.
- Hunyuan Prompt-to-3D now stops durably after one retained concept and requires the separate **Approve for 3D** action before loading geometry. Approval is bound to the exact job/attempt, concept SHA-256, current prompt/plan, seed, provider and canonical AssetSpec; regeneration advances the seed once with textures off and retains immutable ancestry. Root/variant specs, concept prompt, saved approval and final provenance agree on the current brief, and stale or tampered state fails closed.
- Prompt-to-3D now accepts and retains a job before preflight, reports elapsed time for hardware/WSL readiness, signed-provider verification, sidecar health, provider/model warm-up, concept inference/review, geometry, post-processing and validation, and avoids the redundant full model-byte rehash on every Generate click. Concept framing rejection is labelled as a concept-quality failure, preserves the image, and offers only a deliberate concept-only retry with a new seed before geometry can load.
- Local Files no longer retries a failed remote file-type icon indefinitely. File rows, the page header, and sidebar keep fixed-size local icons when the icon host is unavailable, avoiding broken-image flicker and repeated requests.
- Packaged sandbox preload now bundles shared Prompt-to-3D channels into one file, preserving the `window.grudge` auth and `appRuntime` bridges in production builds.

## [1.1.0] — 2026-08-20

### Added
- **Grudge Three Pipeline** — one reusable SceneEngine window for Explorer / Local Files 3D. Extra meshes **append** (parent/child, clips, textures). Delete node · save selected as GLB.
- **Send to R2 + D1** waits for PUT complete, then `os:registerAsset`. Key `models/pipeline/<file>`.
- **SI 2 m measure** — Shift+Ctrl+LMB drag a span that should be 2 metres; uniform scale on the selected mesh.

### Changed
- 3D opener is the pipeline, not a ThreeFlow hijack. **Edit in ThreeFlow** stays explicit (no iframe).
- Settings / AI card / file-defaults copy match pipeline-first open.
- Admin View tab: Open in ThreeFlow for 3D assets.

## [1.0.11] — 2026-08-19

### Changed
- **Local Files 3D → ThreeFlow** — click = inline preview; double-click / Pop-out / Explorer Open with on GLB/glTF/OBJ/STL = live ThreeFlow (`?asset=` + plugin loopback `/v1/local-file/<name>?path=`). Images / audio / video / text / PDF stay Elite.
- **Docs / README / Pages / Settings / About** — editor trio is Elite (media) · ThreeFlow (scene edit) · Forge (R3F deploy). Removed “3D double-click stays in Elite”.
- **AI card** — hints name ThreeFlow for 3D; vision (`withAi`) is images only. System open toasts OS default app.

### Added
- **Show in list** — Local Files 3D viewport button above tris/verts scrolls the left folder list to the mesh in view.
- Loopback CORS `Access-Control-Allow-Private-Network` so HTTPS ThreeFlow can fetch localhost meshes.

### Fixed
- Preview **Pop-out** on 3D no longer opened Elite chrome.
- ThreeFlow loader type from loopback filename (was `local-file` → no GLB loader).

## [1.0.10] — 2026-08-16

### Fixed
- **Elite black viewport** — official `ViewHelper.render()` was auto-clearing the whole canvas (only the corner cube survived). `SceneEngine` now matches ThreeFlow: `autoClear=false` + explicit `clear()`. 3D stays in local Elite (not a remote ThreeFlow pop-out). Host is absolute-fill. Studio ground + sand `#EFD1B5`.
- **Open folder** — folder picker uses the window that clicked it and drops always-on-top so the dialog is not hidden behind Loader/Elite.

### Added
- **Elite ThreeFlow chrome** — 32px header, left scene tree, center viewport, right inspector. Same `SceneEngine` (no fourth editor, no iframe). Open in ThreeFlow remains an explicit action.
- **Copy as path** on Local Files, Assets browser, and Elite header (disk path or R2 key).

## [1.0.9] — 2026-08-16

### Changed
- SSOT identity: product is **Grudge Dev Tool** (`com.grudgestudio.devtool`), not Forge. README + best practices name the editor trio (Elite / ThreeFlow / Forge live).

## [1.0.8] — 2026-08-16

### Changed
- r185 production loaders, blob purge, ThreeFlow/Forge handoff.

### Fixed
- **Elite / Forge compressed GLB loaders** — viewer CSP blocked gstatic Draco + jsDelivr Basis, and forced JS Draco. Viewer now uses the same **ThreeFlow production factory** (`gltfProdLoader.ts`): r185 bundled Draco WASM + `three/addons` Meshopt + lazy KTX2, plus `wasm-unsafe-eval` on viewer/index CSP.

### Changed
- `three` **0.169 → 0.185.1** (fleet pin). All Elite/Forge addons import `three/addons/*`.
- Local Ollama preferred models are **`grudge-dev` + `llama3.2` only** (dropped leftover `qwen2.5-coder:7b`).
- Dropped needless `preset:*` / `scaffold:r3f` / `fleet:probe:vercel` aliases. Dropped unused `bs58` + `puppeteer`.
- Removed unused local Forge demos (`towerDefenseDemo`, `driveDemo`).
- Deleted on-disk blobs (~3 GB): portable `tools/blender` + `tools/ffmpeg` + zips, `release/` NSIS/unpacked, `dev.venv`, `classic64-dry-run.json`. Reinstall convert tools with `npm run toolchain:install` when needed. FBX2glTF stays in `resources/tools`.

### Added
- Viewer actions: **Open in Forge (live)** + **Open in ThreeFlow** via `editorHandoff.ts` (`?asset=`). Local “Add to Forge tools” stays secondary.
- Fleet registry + health probe for `https://threeflow.vercel.app`.
- Forge script pad: `api.loadUrl` / `api.exportSelected` / `api.openThreeFlow` / `api.openForge` plus ThreeFlow names (`scene`, `camera`, `renderer`, `object`).
- ThreeFlow consumes Dev Tool `?asset=` / `?mesh=` after scene init (same `loadModel` path).
- **Studio plugin host** on dest-tool (`127.0.0.1:17380`) — VS Code, standalone panel, CLI, elite viewer, and agentic share one kernel. Practices migrated from live **ai.*** / **coder.*** / **forge.*** (Legion one-brain, Coder specialties + handoff, Forge command stack / Rapier / SI). Token: `%APPDATA%/grudge-dev-tool/plugin-token`. Docs: `docs/plugin-attach.md`. CLI: `grudge-dev plugin`.
- **Elite 3D viewer — Blender-style viewport** on existing `SceneEngine` (not a second app):
  - Infinite SI fade grid (1 m cells), official Three.js `ViewHelper` cube, ortho views **1/3/7** + **5** persp toggle
  - Skeleton overlay default-on for skinned assets, optional bone names, SI bounds (`Box3Helper`)
  - Chrome-style orbit: LMB rotate, RMB / MMB / Shift+LMB pan, scroll zoom
  - `AssetStudioInspector` — Scene tree, Object (W/E/R, ground, fit 1.8 m bones only), Material, Rig fingerprint, apply local anim library `rest.glb`, Save GLB + `skeleton-mapping.json`
- Inline `Model3DViewer` shows SI height + bone count (still MultiCanvasHub).
- **Multi-asset elite viewer** — drop / Shift+A add more GLB/FBX into the same scene; click select; G/R/S (or W/E) gizmo on the active object; Shift+D duplicate; X delete; H hide; A frame all; World/Local space. Same `SceneEngine`, no second viewer.

### Changed
- `GridHelper` 20×20 replaced by infinite fade grid in `SceneEngine` (Forge 3D + Skeleton Studio inherit it).
- Skeleton Studio bone labels use shared `skeletonOverlay.ts`.

## [1.0.7] — 2026-08-11

### Added
- **Simple video viewer** — reliable HTML5 player: direct `src`, native-controls fallback, volume, Space/F/M keys, dimensions, STREAM badge, system-open on codec fail.
- **AI asset cards** — `asset:understand` IPC builds markdown cards (kind, mime, size, stream, open hints, GLB inspect, optional vision caption). Elite viewer **AI card** / **AI+** and Local Files **AI card** copy to clipboard for agents.

### Fixed
- Elite stream resolve now stamps `stream: true` so audio/video viewers skip full-file waveform/blob paths.

### Changed
- Product **1.0.7**; README media + AI understand notes.

## [1.0.6] — 2026-08-11

### Fixed
- **Audio elite viewer** — stream / large files no longer force full-file waveform decode (which broke or OOM’d long tracks and `grudge-media://` SFX). Playback always uses native `<audio>`; waveform is best-effort under 24 MB.
- **Media type drift** — `isStreamableMediaPath` and viewer extension lists live in `shared/mediaTypes` only; `openFileBridge` + `mediaProtocol` re-use them (no second regex / hardcoded ext set).

### Added
- **Local Files kind chips** — All · Audio · Video · 3D · Image · Design · Text for organizing game media packs; double-click still opens elite viewer (stream for audio/video).
- **Audio transport** — Play/Pause, seek, loop, playback rate (0.5–2×), duration chrome aligned with Video viewer.

### Changed
- Product description / version **1.0.6**.
- README media / double-click / SSOT notes.

## [1.0.5] — 2026-08-08

### Fixed
- **Elite / quick view wrong textures & colors** — `grudge-media` resolves missing maps via sibling `Textures/` / `textures/` / `Maps/` (Kenney-style) with case-insensitive basename match; do not strip in-flight maps; smart-fill uses **role-correct colorSpace** (albedo sRGB, normal/ORM linear).
- **Compressed GLB empty/wrong mesh** — loaders bind **Draco + Meshopt** on every GLTF load.
- **OBJ grey materials** — MTLLoader `setResourcePath` + media protocol for map_Kd next to the model.
- **Windows `npm run dev`** — split tsc watch / electron into concurrent processes (no bash `&`).

### Added
- **More open formats** — VRM (as glTF), HTML/CSS3D preview plane, broader scene JSON (`.gfscene`, `.scene.json`); Forge accept list updated.
- **Safer convert-to-GLB** — `convertToGlb(file, { diskPath })` loads with texture resolution then exports embedded maps for game packs.
- **Env / ONE TRUTH sample** — `.env.example` Multiverse SPA + room, info/ObjectStore, CDN, Forge, Blender toolchain notes; bootstrapEnv also reads Documents secrets + packaged resources `.env`.

### Changed
- Docs: `asset-loader-materials.md` checklist for Kenney textures, Draco, CSS3D preview vs game bake.
- Product description / version **1.0.5**.

## [1.0.4] — 2026-08-03

### Fixed
- **Meshopt GLB load** — Elite/Forge loaders call `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)` before parse. Fixes `THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files` and wrong/missing mesh, colors, textures on grudge-web-v1 optimized assets.
- **Assets search (all Grudge Studio Assets)** — search box on **Assets** queries the full fleet catalog (~6k live index + CDN prod/gltf packages), not only the current folder. ObjectStore `/search` 404 no longer yields empty results.

## [1.0.3] — 2026-08-03

### Fixed
- **Elite Viewer animation review** — selecting a clip now plays that clip exclusively via `setPrimaryAction` (same SSOT as Forge). Previously only toggled `paused` on unstarted actions, so the wrong/no animation showed. Removed multi-clip “Play All” stacking; row click = select & play, click again = pause/resume.
- **Elite Viewer textures / materials / mesh** — local open loads via `diskPath` + `grudge-media` so relative FBX/OBJ/glTF maps and TGA atlases resolve; sibling fill only fills **missing** maps (never overwrites good embeds); broken-map strip no longer removes valid/in-flight textures; OBJ loads sidecar MTL; mesh prep (normals, skinned bounds, author scale preserved — no forced scale=1).

### Changed
- **Docs (systems-api + ai-workers-d1-r2-stream)** — Proved ObjectStore paths (`/api/objectstore/v1/*`); documented 404 list/search; `api.grudge-studio.com` as **legacy live** not DEAD; obs demoted optional; Stream marked planned/partial.
- **uMMORPG → Forge** section + `npm run catalog:ummorpg` (ObjectStore extract + publish).
- **Doctor probes** — critical-only score; health/auth/characters/CDN/Forge/Multiverse/uMMORPG catalogs; optional legacy api + obs (not scored).

## [1.0.2] — 2026-08-01

### Added
- **Single-login SSO handoff** — one Puter/desktop session seeds fleet API bearer and injects `grudge_auth_token` + `grudgeId` into Forge / Coder / Preview / Grok Builder webviews. Settings documents tab→auth matrix; backend modes human-labeled.
- **Elite viewer DCC formats** — open/view **PSD/PSB** (auto composite → PNG via ag-psd), **BLEND** (auto → GLB via Blender toolchain), plus GPU textures (KTX/DDS/HDR), Aseprite, Tiled TMX, VRM/USDZ. DesignViewer fallback + System open. Local Files + Explorer double-click.
- **Workers config audit** — `scripts/audit-workers-config.mjs` + expanded checklist in `docs/ai-workers-d1-r2-stream.md` §8 (compatibility_date, nodejs_compat, observability, Env types, queues, waitUntil). Hardened fleet wrangler.toml for AI hub, CDN, id-gateway, wallet, ObjectStore, observatory, auth-legacy.
- **Databases · sharing · backups** — Pages doc + `scripts/backup-postgres.mjs` (parallel table dumps, meta time T, optional Docker `pg_dump`). Best practices for account/character scopes, R2 offsite dumps, D1/R2 recovery. Inspired by [PlanetScale massively parallel Postgres backups](https://planetscale.com/blog/massively-parallel-postgres-backups).

### Changed
- **Fleet SSOT + docs** — **Grudge Multiverse** live hosts: SPA `grudge-multiverse.vercel.app`, dedicated Railway `grudge-multiverse-room-production` with WS **`/api/mv`** (not Carrier / gameopen). Preview preset, Games catalog, admin hosts, systems-api / one-truth / production-deployment / admin-architecture / Vercel SSOT updated. Multiverse ≠ Metaverse.
- **README** — product cut for 1.0.x, install, single-login, release badges.

## [1.0.1] — 2026-08-01

### Added
- **MP4 / video double-click** — Explorer + Local Files + View Mode open **video player** for mp4, webm, mov, m4v, mkv, avi.
- **`grudge-media://` stream protocol** — large videos/audio stream from disk (no full-file RAM blob).
- **Elite VideoViewer** — play/pause, seek, mute, loop, fullscreen, duration chrome.

### Changed
- File picker filters include **Video** and **Audio** groups.
- Installer associations for m4v / mkv / avi.

## [1.0.0] — 2026-08-01

### Added
- **1.0 product cut** — elite open system + consolidated shell as the stable desktop admin app.

### Changed
- **Animations** — elite / embed 3D viewers play the **primary clip only** (no stacked multi-clip); root-motion strip retained; skeleton helper off by default.
- **Materials / mesh** — stronger sanitize on load (sRGB maps, yellow/black fix, vertex colors, skinned `frustumCulled=false`); local sibling textures via `diskPath` on elite open.
- **Nav 1.0** — primary: Home · Local Files · Assets · Skeleton · Forge · Preview · Games · Agent AI · Settings. More: Upload · View Mode · Grok Builder · Coder · Store · BlenderKit · Docs · Account.
- **Thin tabs hidden** — Search / Request URL / UUID / Legion no longer clutter the sidebar (still mountable; Search→Assets alias; UUID from Settings; Legion from Agent AI).
- **Less debug chrome** — removed DemoModeBanner from Assets / Search / Upload / Request when online path is fine.

### Fixed
- Multi-animation “broken dance” in pop-out / View Mode previews.
- Skeleton debug lines always-on in Model3DViewer.

## [0.9.9] — 2026-08-01

### Added
- **Elite local open system** — Explorer double-click / Open with → always-on-top Asset Viewer (3D, image, audio, video, text, PDF). Not Forge.
- **Local Files tab** — folder browser on disk; double-click opens elite viewer; Forge is explicit only.
- **Settings → Set as default for all asset types** — HKCU ProgIDs + Capabilities for all viewer extensions; opens Windows Default apps for residual confirmations.
- **info.grudge-studio.com chrome icons** — SSOT `src/shared/infoIcons.ts` for nav, Local Files kinds, Settings, Elite Viewer badges (never rewrite info→assets).
- **fileAssociations** expanded for images, audio, video, json, pdf, md, txt (installer).

### Changed
- **Nav consolidation** — primary rail: Home · Local Files · Assets · Skeleton · Forge · Preview · Games · Agent AI · Settings. Demoted Grok Builder / Search / Store / BlenderKit / Request / UUID / Legion / Coder / View Mode to More (still wired, not blank).
- **Route aliases** — `/local-assets`→`/local`, `/playcanvas`→`/games`, `/viewer`→`/view`.
- **Studio Hub** primary chips match real daily loop (Local Files first; drop dead View/Builder chips from primary).
- **Product name** — installer/shortcut **Grudge Dev Tool** (elite viewer app identity).
- OS open no longer auto-navigates to Forge (`openFileBridge` owns argv / second-instance).

### Fixed
- **Import colors** — stop forcing gold/yellow on drag-drop / open; preserve material + vertex colors; white base when albedo maps exist.
- **Local textures** — on import, scan same folder + pack roots (`textures/`, `maps/`, …) and auto-apply PBR maps via IPC `listSiblingTextures` / `readLocalImage`.
- **Selection pulse** — weaker gold emissive, auto-clears so assets don't stay yellow.

## [0.9.8] — 2026-07-31

### Added
- **Skeleton Studio wizard** — step tabs run real actions (extract / T-pose / place / export); drag-drop FBX/GLB; Blender/FBX2glTF readiness strip; Assets → Skeleton handoff.
- **Assets → Skeleton** — Bone button on 3D preview downloads CDN model and opens Skeleton Studio.
- **Vercel fleet SSOT** — `docs/VERCEL_FLEET_SSOT.md` + `npm run fleet:probe:vercel` (P0 host probe).
- **Grok Builder webview** — full-height Electron embed of `grok-builder.vercel.app` (same pattern as Forge).

### Changed
- **Home primary actions** — Assets → Skeleton → Forge → Preview → Grok Builder → Upload → Games → AI.
- **Nav** — Skeleton + Grok Builder on primary rail; full-height for builder/upload.
- Fleet play URLs prefer custom domains (arena / armada); grudgedot dead URL removed.

## [0.9.7] — 2026-07-31

### Added
- **Admin architecture SSOT** — `src/shared/adminSurfaces.ts`, `docsCatalog.ts`, `docs/admin-architecture.md`, `docs/systems-api.md`.
- **Preview play mode** — fleet client presets (open · client · water · GRUDOX) + Forge `sceneId`/`glb` handoff.
- **Coder hybrid** — production embed of `coder.grudge-studio.com` + local PTY server panel.
- **Docs catalog UI** — full `docs/` set matching GitHub Pages (same source).
- **GitHub Pages refresh** — all docs linked to current fleet APIs; front matter for Jekyll nav.
- **Material sanitize** (`materialSanitize.ts`) — fixes yellow/black/sludge imports: sRGB maps, metalness cap, default-yellow replace, broken 1×1 map strip, Phong→Standard.
- **Magic-byte mesh gate** (`magicBytes.ts`) — reject HTML error pages and non-`glTF` stubs on load and ingest.
- **prod/gltf R2 layout** (`prodGltf.ts`) — ingest suggests `prod/gltf/<category>/<name>.glb` + CDN URL + D1 registry row.
- **Production packages catalog** (`prodPackages.ts`) — live CDN packages/prefabs for grudge6 races, fantasy weapons, skeletons, armada.
- **ObjectStore registry seed** — `os.writeManifest` / `os.registerAsset` IPC after fleet deploy.
- **Blender convert** packs external images + neutralizes yellow/black materials before GLB export.
- **TGA LoadingManager** on FBX/GLTF loaders (Unity Toon RTS atlases no longer black).
- Docs: `docs/asset-loader-materials.md`, `docs/packages/`.

### Changed
- **Forge** tab: Play test → Preview; chrome states R3F+Rapier DNS parity; local tools secondary only.
- **Studio Hub**: admin systems chips (ENGINE, info.*, open, GRUDOX, Coder, Builder); Preview in primary actions.
- **Assets / Store / UUID / Legion / Skeleton** copy aligned with production CDN/convert/Legion contracts.
- **fleetConnections**: info.*, ENGINE portal, open, GRUDOX, carrier, builder, foundry, observatory.
- **bestPractices**: forge DNS parity, preview, skeleton/store/BlenderKit, docs same-source.
- GitHub Pages `index.md` / `production-deployment.md` / `_config.yml` refreshed to current admin model.
- Upload default prefix → `prod/gltf/misc/` with optional pre-ingest pass.
- Model3DViewer uses `loadModelFromUrl` + material fix badges.
- `deployToFleet` sanitizes materials, asserts magic bytes, prefers prod/gltf, seeds registry.
- Loaders merge: diskPath sibling textures + magic-byte gate + material sanitize + TGA.

## [0.9.6] — 2026-07-29

### Added
- **Free agentic cascade** — Ollama → **Puter User-Pays AI** (signed-in session) → env OpenAI/Anthropic/Gemini → Workers AI → Legion.
- **Env secret bake-in** — loads `.env` from package, home, Desktop, AppData; seeds keytar automatically (CF, R2, Legion, LLM keys). No Settings paste required.
- **Puter AI main-process client** — OpenAI-compatible `api.puter.com` using session token.

### Changed
- Login copy emphasizes free Puter AI + identity.
- Agent AI UI documents free cascade and auto secrets.

## [0.9.5] — 2026-07-29

### Fixed
- **Agent AI in-app** — no browser dependency; `agent:run` / `agent:orchestrate` / `agent:chat` via Ollama → Workers AI → Legion.
- **Ollama host** — normalize `0.0.0.0:11434` / missing scheme to `http://127.0.0.1:11434` (fixes `Failed to parse URL from 0.0.0.0:11434/api/tags`).
- **Legion chat** — hub/agent failure falls back to local agent stack.
- **GRUDA Hub optional** — projects/agent work offline with local identity + local AI.
- Agent AI UI: **Start local AI** button; removed "Open full GRUDA Agent" external browser link.

[1.0.5]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v1.0.5
[1.0.8]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v1.0.8
[1.0.9]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v1.0.9
[1.0.10]:     https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v1.0.10
[1.0.11]:     https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v1.0.11
