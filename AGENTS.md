# Grudge Dev Tool — Agent Instructions

**Product:** **Grudge Dev Tool** (`com.grudgestudio.devtool`) — Electron 41 tray hub (Elite viewer, Assets, Studio).  
**Repo:** `Grudge-Warlords/grudge-dev-tool` · Auto-updates via GitHub Releases.  
**Not Forge.** Live Forge is `forge.grudge-studio.com`. Live scene editor is ThreeFlow `threeflow.vercel.app`.

> **Note:** Electron 41 is a pre-release/internal build — standard compatibility docs may not apply.

---

## Quick Commands

```pwsh
npm run dev            # renderer (Vite :5173) + main (tsc --watch + electron)
npm run build          # build:renderer (Vite) + build:main (tsc)
npm run package        # build + electron-builder --win nsis → release/
npm run smoke:packaged # isolated offline smoke of packaged preload + renderer
npm run typecheck      # both tsconfig.main.json + tsconfig.renderer.json, no emit
npm run ci:local       # source-only validation; no live fleet probe
npm run maintenance:check # validate fail-closed maintenance policy + baseline
npm run maintenance:daily # manual observer; state stays outside the repo
npm run secret:import  # import .env file → Windows Credential Vault (keytar)
npm run secret:verify  # audit all expected keytar entries (never prints values)
npm run publish:manual # bump patch → package → git tag → gh release create
```

**Node ≥ 22, npm ≥ 10 required.** Store all secrets via `src/main/auth/secretStore.ts` — see **Secrets** in Key Conventions below for the full rule.

**Scripts:** `doctor` · `fleet:probe` · `maintenance:*` · `backup:postgres` · `audit:workers` · `secret:*` · `toolchain:*` · `publish:manual` · `upload-pack` · `catalog:ummorpg` · `test:magic`.

**Toolchain blobs stay off-disk** until `npm run toolchain:install` (Blender/ffmpeg write under `tools/` and stay gitignored). Do not commit `release/`, `dist/`, `dev.venv/`. Installed app: `C:\Program Files\Grudge Dev Tool`.

---

## Editors (do not invent a fourth)

| Surface | Role | Loader / convert |
|---------|------|------------------|
| **Elite Viewer** (this app, pop-out) | Default folder / Explorer double-click — media **and** 3D with production loaders | `gltfProdLoader` + `SceneEngine` + diskPath / TGA / sibling maps |
| **ThreePipe** (`threeflow.vercel.app/view`) | Explicit inspect / classify HUD — not local double-click (HTTPS cannot fetch `127.0.0.1`) | `?asset=` public CDN only |
| **ThreeFlow** (`threeflow.vercel.app/editor`) | Scene edit — **explicit** Edit in ThreeFlow | `?asset=` CDN or loopback `/v1/local-file` |
| **Forge live** (`forge.grudge-studio.com`) | R3F + Rapier + `.gfscene` deploy | CDN URL only |
| Local Forge3D / workbench | Pop-out mesh tools, script pad | same `loadModel` / `convertToGlb` |
| **Pipeline Review worker** | Convert-before-upload · SI · laterality · CDN HEAD | `src/main/fleet/pipelineReviewWorker.ts` — sibling of Scene Completion |
| **Native Play** (`/play`) | WASD TPS · LocomotionCore · combatSkillKit · gltfProdLoader | `PlayMode.tsx` + `playRuntime.ts` + `studioQuality.ts`. Rapier CCT playtest = Open/Casting, not this tab |
| **Skeleton Studio** (`/skeleton`) | Mixamo-25 **author** extract/T-pose/place → left-role / right-clip bind → **Toon Bip001 play** pack → `grudge-convert` → R2/D1 | `genericPreviewHost` Toon `{race}.glb` · `mixamo25.ts` · `retargetLibrary.ts`. Not a fourth editor. Play body is never Mixamo Y-Bot |

Production bake: main `convertFile` (FBX2glTF → Blender fallback) then `optimizeWebFile`. Browser `exportToGlb` is convenience only.

Handoff SSOT: `src/shared/editorHandoff.ts`. Local 3D double-click opens **Elite viewer** (`viewer.html` + `gltfProdLoader`). Extra 3D files reuse that window. Vue ThreeFlow `/editor` and ThreePipe `/view` are **explicit**. Do not iframe ThreeFlow. Chrome icons: `src/shared/infoIcons.ts` (PNG on `assets.grudge-studio.com`; catalog JSON on `info.grudge-studio.com`).

## Architecture

```
src/main/          ← Node.js + Electron main process (ipcMain.handle)
src/renderer/      ← React 18 + Vite SPA (no Node access)
src/preload/       ← contextBridge → window.electronAPI (only comms bridge)
src/shared/ipc.ts  ← canonical IPC channel names + all payload types
```

The renderer communicates **exclusively** via `window.electronAPI`. See **Key Conventions** → **Adding a new IPC channel**.

See [docs/production-config.md](docs/production-config.md) for full credential reference.  
See [docs/object-storage.md](docs/object-storage.md) for R2 bucket layout and manifest schema.  
See [docs/ai-workers-d1-r2-stream.md](docs/ai-workers-d1-r2-stream.md) for AI workers, Cloudflare AI, D1, R2, Stream production practices.  
See [docs/admin-architecture.md](docs/admin-architecture.md) for **admin shell** map (Forge = DNS, Preview play mode, Coder hybrid, same-source docs).  
See [docs/plugin-attach.md](docs/plugin-attach.md) for the loopback plugin host (`127.0.0.1:17380`) used by VS Code / standalone / viewer / agentic.  
Code SSOT: `src/shared/bestPractices.ts`, `src/shared/plugin/`, `src/shared/adminSurfaces.ts`, `src/shared/docsCatalog.ts`, `src/shared/fleet.ts`.

---

## External Systems & Integration Points

### Cloudflare (primary backend)

| Service | URL | Credential key |
|---|---|---|
| Object Store Worker | `cf-objectstore-worker-url` (keytar) | `cf-objectstore-api-key` |
| R2 direct (S3) | `cf-r2-endpoint` | `cf-r2-access-key-id` / `cf-r2-secret` |
| AI Gateway | `https://gateway.ai.cloudflare.com/v1/{accountId}/{gatewayId}/` | `cf-ai-workers-api` |
| Observatory telemetry | `https://obs.grudge-studio.com` | `cf-objectstore-api-key` (ingest key) |
| Asset CDN | `https://assets.grudge-studio.com` | public |

Workers AI models are env-overridable: `CF_AI_DEFAULT_MODEL` (default `@cf/meta/llama-3.1-8b-instruct`), `CF_AI_VISION_MODEL`.

### Puter Auth

- **Main process**: `@heyputer/puter.js` (CommonJS, asarUnpacked) — starts localhost redirect server, opens browser → `puter.com`, then validates token at `https://api.puter.com/auth/user` via Electron `net.fetch`. If the redirect does not complete within 120 seconds, shut down the localhost redirect server and emit IPC error `ERR_PUTER_AUTH_TIMEOUT` to the renderer. If token validation returns non-200, emit `ERR_PUTER_AUTH_INVALID` and clear any previously stored `puter-token` via `setSecret`.
- **Renderer**: CDN-loaded from `https://js.puter.com/v2/` via `src/renderer/lib/puter.ts`. `puter-claude` / `puter-gpt4o` model providers require browser context only.
- Keytar accounts: `puter-token`, `puter-user`, `grudge-id`.
- Grudge ID is generated by `src/shared/grudgeUUID.ts` — see that file and `docs/grudge-uuid.md` for the authoritative format. Do not re-implement the generation logic; always import from `src/shared/grudgeUUID.ts`.

### Grudge APIs (ONE TRUTH — 2026-07)

| Service | URL | Keytar / Env |
|---|---|---|
| Fleet client | `https://client.grudge-studio.com` | `default.apiBaseUrl` / `GRUDGE_API_BASE` |
| Grudge ID | `https://id.grudge-studio.com` | `GRUDGE_ID_BASE` |
| Game data SSOT | `https://grudge-api-production-0d46.up.railway.app` | `GRUDGE_GAME_DATA_URL` |
| ObjectStore | `https://objectstore.grudge-studio.com/api/v1` | public JSON / `cf-objectstore-*` |
| Assets CDN | `https://assets.grudge-studio.com` | public |
| Legion AI | `https://ai.grudge-studio.com` | `GRUDGE_LEGION_HUB` / `GRUDGE_AI_KEY` |
| Forge editor | `https://forge.grudge-studio.com` | browser |
| Pipeline | `https://grudge-pipeline.vercel.app` | browser |
| Coder IDE | `https://coder.grudge-studio.com` | browser / Dev Tool handoff |
| Multiverse SPA | `https://grudge-multiverse.vercel.app` | browser / Preview |
| Multiverse rooms | `https://grudge-multiverse-room-production.up.railway.app` | WS `/api/mv` only (own Railway) |
| **Legacy (live index)** | `https://api.grudge-studio.com` | asset-index GET only — **not** new player APIs; prefer ObjectStore + CDN |

### Databases · sharing · backups

- Pages SSOT: `docs/database-backups-sharing.md` → https://grudge-warlords.github.io/grudge-dev-tool/database-backups-sharing.html  
- Parallel dump: `npm run backup:postgres` (`scripts/backup-postgres.mjs`) — requires `DATABASE_URL` + `pg`; never commit `backups/`.  
- Player SSOT = Railway Postgres only; account bag shared; character XP scoped; D1/R2 are index/binaries.

### Production quality bar (assets + AI)

1. **Browse** R2/ObjectStore in Dev Tool → preview → send 3D to Forge (**CDN URL** only for production).  
2. **Catalogs** via proved paths: `objectstore…/api/v1/<name>.json` or `client…/api/objectstore/v1/<name>.json` — not `/api/objectstore/list` (404).  
3. **Bake** with `grudge-convert` before R2; magic-byte verify; seed D1/ObjectStore.  
4. **D1** = asset index only; **R2** = binaries; **Stream** = planned/partial (UI clips on R2).  
5. **AI:** Legion (`ai.grudge-studio.com`) ≠ Coder AI hub worker; Workers AI via binding/Gateway.  
6. **Never** Meshy/capsule ship visuals; never player state on D1.  
7. **uMMORPG extract:** `npm run catalog:ummorpg` → Forge `ummorpgCatalog.ts` + ObjectStore placeables/skills.  
8. **Doctor:** `npm run doctor` — critical probes only (obs + legacy api optional).

Backend routing (`src/main/api.ts`): `resolveBackend()` chooses between `r2-direct`, `cf-worker`, or fleet client modes.  
Local autonomous AI: Ollama at `OLLAMA_HOST` (default `http://localhost:11434`) via `src/main/ollama.ts`. Preferred model **`grudge-dev`** (Modelfile on `llama3.2`); `ensureRunning` creates it if missing.

---

## Upgrade Surfaces

These are the tracked upgrade and connection-improvement opportunities. When working on an upgrade surface, update the corresponding row in this document's table AND add an entry to CHANGELOG.md. If a GitHub Issue tracks it, close that issue with a reference commit. If an upgrade is investigated and explicitly deferred, add a note in the table row with the reason and a target review date, e.g., "Deferred: upstream breaking change unresolved, revisit 2025-Q3".

### 0. Plugin host (current)

| Piece | Status |
|---|---|
| dest-tool `src/main/pluginHost.ts` | Loopback `:17380` — VS Code / standalone / CLI / viewer / agentic |
| Practices | `src/shared/plugin/practices.ts` — dest-tool + live ai/coder/forge |
| VS Code | `F:\\GitHub\\GrudachainCode\\packages\\vscode-extension` attaches dest-tool first |
| CLI | `grudge-dev plugin status\|practices\|chat\|viewer` |

### 0.5 Prompt-to-3D local providers (current)

2026-09-09 execution update: use `docs/prompt-e2e-20260909.md` and `PROJECT_STATUS.md` for the current campaign. `creationPrompt.ts` prefers installed Grudge and compiles bounded compound prompts into existing immutable creation actions; primitive component/world assemblies are blockouts. Nine representative real builds, native world scene round-trip and actual Hunyuan crate geometry are recorded. Paint is still free-VRAM blocked, additional providers are not ready, and arbitrary actions/full neural finishing are not accepted. Preserve exact visual/provider evidence boundaries.

| Provider | Pinned source | Status / next review |
|---|---|---|
| Manual character/testing repairs | `creationPrompt.ts`, `characterSurface.ts`, `characterRig.ts`, `SkeletonStudio.tsx` | 2026-09-11: four reported prompts and seven Skeleton Studio follow-up edits pass through the packaged app's prompt windows. Connected body, complete skin weights, exact bone displacement, retained lineage and actual viewport deformation are verified separately. Final appearance replay uses v4; see `docs/character-refinement-20260911.md` for exact runtime evidence. Local stylized procedural authoring only; no external model editing or neural finishing. |
| Single-prompt workspace | `CreationFlowPage.tsx`, shared AppPrompt and original tools | 2026-09-10: one initial prompt, opt-in Hunyuan 3D/Paint extras, collapsed manual tools and one conditional result panel. Grudge opens existing controls, fills the neural subject and reports missing optional setup independently. Viewer/neural UI loads on demand. See `docs/simple-prompt-20260910.md` for the final package and replay evidence. |
| Local creation and editable regions | Existing creation / animation screens | 2026-09-09: compound creation/surface/detail/motion/save, literal transforms/colors/animation removal and immutable add/duplicate/rename/remove are implemented. Full edit/save preflight rejects name conflicts and missing later targets. Nine structural live cases pass, including two expected rejections; earlier thirteen expanded and nine original examples remain separately recorded. Copies retain original materials and animation, including translation-key offsets. See the campaign report for final native/package evidence and unsupported skin/provider/world behavior. |
| App-wide prompt controls | `AppPrompt.tsx`, `appActionPlanner.ts`, `appActionControls.ts`, `embeddedActionBridge.ts` | Local path, compound settings, model handoff, immutable component edits and missing-path scene preservation remain tested. 2026-09-09 embedded continuation adds five owned/origin-bound guests, isolated fixed control execution, one-use/stale-document checks, ARIA/plain editable text and bounded drag/drop. Native Grudge passes ThreeFlow search, placement, repeat placement, palette recovery and opening Properties to change Name/Position X, plus Builder's single +Box. Literal field identities remain bound while panels are closed; unrelated controls and premature completion reject. Placement uses changed public selection or tree growth, with a distinct selection before repeated same-type creation. v46 build/package smoke and 22 current transport cases pass; real-model fixtures remain separate from live acceptance. Click-once results report actual activation only. Live ThreeFlow lighting/hierarchy defects have a local upstream repair with passing build, browser restore and snapshot checks; the reviewable patch in docs/patches/threeflow-embedded-20260909.md is not deployed. Builder lab remains in More tools; existing admin rules remain. Universal connected/admin, native-dialog, arbitrary canvas and full coding/gameplay actions are not established. See `docs/prompt-e2e-20260909.md`. |
| Native dialogs and app input | Shared AppPrompt / original windows and editors | 2026-09-10: observed open/save/text/confirmation dialogs, folder creation, file inputs, browser exports, native keyboard/pointer input, code/scroll surfaces and owned pop-outs. Preserve ownership/origin/document/element checks and explicit intent for sensitive actions. `test:native-actions`, `test:embedded-actions`, `test:preload` and packaged checks cover the transports; exact runtime evidence is in `docs/native-app-controls-20260910.md`. Hunyuan is optional. |
| Guided new-root handoff | `prompt3DGuidedCreationSpec` | 2026-09-05: clean defaults and planned category/style for new roots; retain scale/category only for explicit current-asset revisions. Ordinary prop motion uses the shared affirmative-intent gate. Live crystal regression covered by `test:prompt3d-orchestrator`; installation/provider/save evidence belongs in `PROJECT_STATUS.md`. Active creation now has one primary prompt and collapsed optional settings; shared input bounds reject malformed values before work starts. |
| Unified Prompt-to-3D router | `src/shared/prompt3dOrchestrator.ts`, `AppPrompt.tsx` | 2026-09-10: the primary page prompt automatically invokes exact local grudge-dev analysis and the shared existing app controller. Default routes use existing utilities; Hunyuan/TRELLIS/HY-Motion require an explicit provider request or override. Pending neural history does not take over startup. The installed native loopback CPU planner can start on submission; no pull, model substitution or external LLM. Manual utilities remain usable when a model/provider is unavailable. Compound creation can continue into an existing editor after observed saving. See `docs/prompt-to-3d.md` and current `PROJECT_STATUS.md` for evidence and remaining native/embedded limitations. |
| Hunyuan3D 2.1 / Hunyuan3D-2mv | `82920d643c0dc2f7bfd7255f45f62d386edfe60c` | Normal-user WSL Windows path; pinned shape/paint, DINOv2 and HunyuanDiT concept-image route. One verified front image uses 2.1; two to four distinct, labelled front/left/back/right images use the separately pinned official 2mv checkpoint. The provider declares this typed capability and every unsupported count, role, duplicate byte set or model declaration fails closed. The UI persists the selected generator root and reconciles stale status with the signed manifest. Keep model revisions and restricted license visible in `src/main/prompt3d/providers.ts`; review upstream quarterly. |
| HY-Motion 1.0 Lite | `4e426f5a1021cbcf7f375458c37b840ee7225229` | Official local text-to-skeletal-motion provider for one human or clearly humanoid subject. Its native 22-joint rotations are mapped to the existing Mixamo-25 core and skinned onto the exact approved Hunyuan surface; the upstream wooden preview body is never imported. Select by measured capability, not GPU model: prefer the 24 GiB-total/20 GiB-free CUDA profile and bind its adapter by UUID; otherwise allow the official `force_cpu` basic profile when at least 32 GiB total/24 GiB free system RAM is measured, retaining its reduced 12-step schedule and visible speed/fidelity warning. Both profiles use the same signed source/model/runtime, exact prompt/seed/compatibility binding and separate visual approval. Never substitute procedural or cloud motion. Non-humanoid subjects fail closed; do not replace them with a rigid slide or claim HY-Motion supports them. |
| GPU-independent local animation | In-repository CPU routes | Default manual route with no provider install, named GPU or free-VRAM requirement. Reuse a compatible Mixamo-25 skin or fit one only to an affirmatively identified, safely posed humanoid; ambiguous anatomy or stance stops for Skeleton Studio marker correction, with returned placements bound to the exact painted-parent hash. Retarget an explicitly selected local Mixamo-25 library when requested. Non-humanoids use the existing prompt-bound morph/deformation author and rigid props use truthful object-space motion. Preserve the exact approved Hunyuan geometry and Paint bindings. Always label these routes deterministic/local-library and non-generative: they are not HY-Motion and cannot satisfy strict Hunyuan or serial-batch acceptance. Known unsupported transformations fail before authoring; contrasting clauses and temporal negation are regression-covered. 2026-09-06: shared animal-biped classification removes the kangaroo review dead end; local Skeleton Studio access and source-bound return preserve motion settings. Normal packaged CPU animation succeeds on the retained approved kangaroo; final visual approval remains with the owner. |
| Shape quality and concept review | Local integration | Put object-defining words before framing text, retain concept/cutout/raw mesh, reject clipped concepts, seed both stages, preserve proportions by default and constrain simplification error. Hunyuan must stop durably at `awaiting-concept-approval`; **Approve for 3D** requires explicit passes for identity/parts, subject presentation and framing/background/support, bound to the exact concept, technical report and effective presentation contract. Subject-only white/neutral/no-support/no-scenery is the default, but affirmatively requested stands, scenery, custom backgrounds or lighting remain explicit contract exceptions. A failed check must be classified as presentation, semantic anatomy/parts, prompt-negation misunderstanding or other before replacement; technical framing checks are never semantic or visual acceptance. Every new prompt edit or seed-only regeneration is one concept with seed +1 exactly, textures off, immutable report/inspection/correction ancestry and exact successor prompt/plan/spec bindings. Completed legacy assets may reopen, including hash-bound prompt edits retained by earlier builds; pending legacy concepts require fresh structured generation. Every geometry generation and Hunyuan Paint run performs fresh deep verification of all model-file hashes and the isolated runtime. Geometry, texture and animation each require separate persisted visual approval bound to exact output and provenance hashes; save/export requires a complete approved Hunyuan generation → changed Hunyuan Paint → prompted animation lineage. Any saved report/inspection/approval/provenance mismatch fails closed. One comprehensive explicit attestation may set all three concept checks together; individual checks and rejection remain available. |
| Original creation flow | Category / Style + optional local planner | Explicit original procedural method supports basic swords, cosmetic game gun props and original segmented characters. Follow-ups texture, add authored cosmetic detail, apply bounded named-part adjustments and animate the same asset; every change is an immutable revision that retains embedded surfaces, clips, asset lineage and prior geometry hashes. Supported adjustment fields are intentionally narrow: sword blade length/width/curvature and guard width; game-prop length/bulk and muzzle size; character height/breadth and head size. No mandatory concept-choice gate or redundant Object/Component panel. No borrowed preview body. Every attempt/status/revision is retained under `creation-history/`; never purge failed attempts. Trial `original-flow-2026-08-31.1` passed all three screen-controlled creation chains with nine revisions. Trial `original-flow-2026-09-01.2` then passed cosmetic enhancement and significant shape adjustment for all three final assets in one packaged session, followed by clean-process local replay with 15 retained revisions. Basic CPU procedural authoring only; optional Ollama and neural providers were not exercised in those runs. |
| Object/component prompt and origin rules | `src/shared/prompt3dRules.ts` | Category and Style are the shared user-facing choices; object/component knowledge stays internal to planning and shared compilation. Never override explicit category/style or append decorative/presentation prose to a geometry prompt. Persist one authoritative current prompt plus its compiled plan; do not reintroduce legacy `originalPrompt`. Match every retained/approved concept against its exact conditioning. Neural exports use a bounds-based `GrudgeAttachment`; do not claim this recognizes a real hilt/socket. Hunyuan creature geometry is enabled only through the exact concept-approval route and requires visual review; generic geometry-segmented morph motion is not a skeletal rig or anatomical recognition. The neural vehicle gate remains. Original segmented character support belongs to the explicitly selected procedural method. |
| Chat creation/texture/animation refinement | Existing local Forge workbench | CPU-only local Ollama proposes schema-constrained recipes. Explicit precision sword commands author named parametric parts; never substitute them for neural output or replace an existing mesh without an explicit creation request. Procedural texture and rigid-object clip previews are reversible. Accept saves a new GLB under `revisions/`; never overwrite originals or use silent cloud fallback. UV fallback is planar preview mapping; no skeletal animation claim. |
| Microsoft TRELLIS | `442aa1e1afb9014e80681d3bf604e8d728a86ee7` | Linux-tested normal-user WSL path. Direct text is enabled; image conditioning awaits typed reference intake. The UI persists the selected generator root and reconciles stale status with the signed manifest. Never invoke its moving-head/broken `setup.sh`; dependency pins are in `providers.ts`. Do not use `docker-desktop`; review quarterly. |

Both providers use the typed loopback job/installer service documented in [docs/prompt-to-3d.md](docs/prompt-to-3d.md). Do not add automatic cloud fallback, Ollama mesh weights, global Python installs, or unpinned model downloads.

**Local controls preference:** the single enable checkbox is remembered per local app profile in `prompt3d-preferences.json`. Keep the saved boolean separate from workspace imports and keep fresh window grants in main-process memory. Disabling must revoke current grants; restoring the choice must not install models or start generation.

**Guided new-root handoff (2026-09-05):** use `prompt3DGuidedCreationSpec` with clean defaults and the planned category/style for new assets; never carry a prior asset's anatomy, scale, seed or image bindings into a new root. Explicit current-asset revisions retain category/scale. Ordinary prop-motion words (float, hover, bob, spin, rotate) route through the shared affirmative-intent gate, including negation handling. Covered by `test:prompt3d-orchestrator`; packaged/provider acceptance remains separately recorded in `PROJECT_STATUS.md`.

**Prompt-to-3D autosave:** retain the brief and per-job snapshots by default and restore prior output without regenerating. Starting a new generation hides the previous live preview while preserving its files and history. Saved interrupted jobs require a deliberate retry. Never overwrite an older job's output directory with a new result.

**Prompt-to-3D finish gates:** an exact visually approved Hunyuan Paint revision is already retained locally. Texture and animation failures require an explicit classified, hash-sealed rejection before a corrected sibling can start; never treat a merely unapproved finish as rejected. Hide the rejected preview, start only from its exact approved parent, and force animation recovery to replace the rejected clip set rather than append it. HY-Motion animation requires a local semantic compatibility decision proving one human/humanoid subject. The normal manual workflow may retain one approved texture and save/export after its first approved prompted animation; it must also expose optional animation refinement or append without discarding that final-save route. Do not weaken the strict six-item batch: it requires two Hunyuan Paint prompts and two animation prompts per asset so both refinements remain evidenced, but it must report unsupported non-humanoid motion honestly rather than fabricate acceptance.

**Prompted skeletal motion:** the complete prompt goes to the official HY-Motion model; local Ollama is only a schema-constrained compatibility and negation gate. Locomotion words describe generated joint action, not automatic world-space displacement. Retain horizontal root translation only for an affirmative direction, named path or measured displacement; walking, running, dancing or hopping alone remain in place. Bind the returned 22-joint rest rig and rotations to the shared Mixamo-25 core, require a real skin, normalized weights, inverse-bind matrices and 22 bone-rotation channels, and prove geometry/texture identity is unchanged. Never call legacy topology-independent morph output HY-Motion or accept props, animals or ambiguous anatomy as a supported humanoid rig.

**Prompted-motion hardware profiles:** runtime selection is deterministic from freshly measured resources. Inspect every NVIDIA adapter, retain the chosen UUID and never assume display adapter/index 0. Prefer CUDA only when the full profile has both physical capacity and current headroom; otherwise use official HY-Motion CPU inference only when its RAM profile passes. Retain the chosen profile, device, validation-step schedule and GPU UUID (when applicable) in task input, generated motion data and provenance, and reject any mismatch during binding. A CPU result remains genuine HY-Motion but is slower and lower fidelity; it is not strict visual acceptance until separately inspected.

**Basic animation fallback:** keep the normal manual workflow operable without a neural-motion install by selecting an explicit CPU route from retained category, affirmative anatomy and measured mesh/rig evidence. Never treat negated wording as affirmative anatomy, stance or motion; mixed humanoid/non-humanoid descriptions and unsafe automatic bone placement fail closed for review. The result and its provenance must state the exact deterministic rig, morph, rigid-object or local-library route. It may be visually approved and saved for basic local use, but it must never be relabelled as generated motion or admitted to strict Hunyuan acceptance.

### 1. npm Dependencies — Pinned Versions to Bump

| Package | Current | Notes |
|---|---|---|
| `electron` | `^41.3.0` | Track latest stable; test keytar native rebuild after upgrade |
| `@aws-sdk/client-s3` | `^3.658.1` | S3 SDK; safe to bump minor — `requestChecksumCalculation` guard already in place |
| `@aws-sdk/s3-request-presigner` | `^3.658.1` | Match `client-s3` version exactly |
| `@gltf-transform/core/extensions/functions` | `^4.3.0` | Check breaking changes in major bumps |
| `@heyputer/puter.js` | `^2.2.15` | Before bumping, verify that `node_modules/@heyputer/puter.js/src/init.cjs` still exists in the new version and that the Electron main-process auth flow completes end-to-end. If the CJS path is removed, block the upgrade until an alternative init path is identified. |
| `@tanstack/react-query` | `^5.51.1` | Minor bumps safe |
| `electron-updater` | `^6.2.1` | Must match `electron-builder` major |
| `electron-builder` | `^26.8.1` | Pin together with `electron-updater` |
| `lucide-react` | `^0.408.0` | Icon API stable; safe to bump |
| `react` / `react-dom` | `^18.3.1` | Do NOT upgrade to React 19 without a dedicated migration task. React 19 removes legacy APIs used in the renderer — audit for `ReactDOM.render`, `unstable_*` APIs, and ref forwarding patterns before scheduling the upgrade. |
| `three` | `^0.185.1` | Fleet pin (same as ThreeFlow / Open). All renderer addons import `three/addons/*`. Production GLTF factory: `src/renderer/lib/forge/gltfProdLoader.ts`. |
| `sonner` | `^1.5.0` | Toast lib — safe minor bump |
| `typescript` | `^5.7.0` | 5.8+ adds `erasableSyntaxOnly`; no breaking changes |
| `vite` | `^8.0.10` | Confirmed installed version (verified in package.json); watch for patch updates |
| `tailwindcss` | `^3.4.6` | Tailwind v4 is a full rewrite — separate major task |

**After any Electron version bump:** rebuild native modules (`keytar`, `sharp`) with `electron-rebuild` or `@electron/rebuild`. Add a startup check in `src/main/main.ts` that calls `keytar.findCredentials` with a known service name and catches `Error: The module was compiled against a different Node.js version`. If caught, display a dialog instructing the user to run `npm run rebuild:native` and quit the app.

### 2. Workers AI Models — Available Upgrades

Routes defined in `src/main/fleet/aiWorkerManager.ts`. Current → recommended:

| Short name | Current model | Recommended upgrade |
|---|---|---|
| `llama-3.1-8b` | `@cf/meta/llama-3.1-8b-instruct` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (faster, larger) |
| `mistral-7b` | `@cf/mistral/mistral-7b-instruct-v0.2` | `@cf/mistral/mistral-7b-instruct-v0.3` (updated weights) |
| `gemma-7b` | `@cf/google/gemma-7b-it-lora` | `@cf/google/gemma-3-12b-it` (Gemma 3) |
| `qwen-1.5-14b` | `@cf/qwen/qwen1.5-14b-chat-awq` | `@cf/qwen/qwen2.5-72b-instruct` (Qwen 2.5) |
| Anthropic default | `claude-sonnet-4-20250514` | Track latest `claude-sonnet-4-*` date stamp |

All models are overridable at runtime via `CF_AI_DEFAULT_MODEL` / `CF_AI_VISION_MODEL` env vars — test new models without rebuilding.

### 3. Cloudflare Observatory Worker — Schema & Features

`deploy/observatory/` is a self-contained Cloudflare Worker with D1 + KV.

- **Compatibility date** is `2024-09-23` — update to `2025-01-01` or later in [deploy/observatory/wrangler.toml](deploy/observatory/wrangler.toml) to unlock newer CF runtime features.
- Tighten `ALLOWED_ORIGINS` to specific project domains (e.g., `https://forge.grudge-studio.com`) before the first production release. Add the specific domains to `deploy/observatory/wrangler.toml` and remove the `*.vercel.app` wildcard at that milestone.
- The hourly cron (`"0 * * * *"`) runs rollups — consider adding a D1 index on `(source, created_at)` for the `/query` endpoint as log volume grows.
- **Missing**: a `/metrics` endpoint for Prometheus scraping. The health-check fleet panel would benefit from aggregate time-series.

### 4. Fleet Health Check — Connection Improvements

Defined in `src/main/fleet/healthCheck.ts`:

- **`auth.grudgestudio.com`** — note the missing hyphen vs all other `grudge-studio.com` domains. Verify if this is intentional or a DNS alias; standardize one canonical form.
- **Solana RPC** (`https://api.mainnet-beta.solana.com`) — currently only a health-ping. When wallet / cNFT minting features land (see grudge-uuid slot system), wire up a `@solana/web3.js` client here.
- **`grudgeplatform.io`** — only probed as a URL ping; consider adding an `/api/health` endpoint on that domain for richer status.

### 5. Puter SDK — Main Process Integration

`@heyputer/puter.js` is loaded via `require('@heyputer/puter.js/src/init.cjs')` because the standard `init()` breaks in Electron's Node context (`vm.runInNewContext`). Watch the upstream SDK for:

- An official Electron-compatible init path (the CJS init path may be removed in a future major version).
- Puter KV / Puter FS APIs — currently unused in the main process; these could replace `electron-store` for cloud-synced app preferences.
- `puter.ai.chat()` — renderer-only today (`puter-claude`, `puter-gpt4o` models). Consider proxying through a new IPC channel so the main process can use Puter AI without requiring browser context.

### 6. Renderer Puter SDK — CDN vs npm

`src/renderer/lib/puter.ts` lazy-loads from `https://js.puter.com/v2/` (CDN). Risks:

- Version drift between the CDN build and `@heyputer/puter.js@2.x` in `node_modules`.
- CSP `script-src` must allow `https://js.puter.com` for the CDN load.

**To unify:** replace the CDN load with `import type {} from '@heyputer/puter.js'` and bundle the renderer SDK the same as main, or expose a preload helper that passes an already-authenticated token into the renderer.

### 7. Ingestion Pipeline — Toolchain Gaps

`src/main/ingestion/toolchain.ts` detects Blender, ffmpeg, sharp. Known gaps:

| Gap | Current state | Improvement |
|---|---|---|
| No `draco` encoder | glTF compression not applied | Add `draco3d` or invoke `gltf-transform optimize` with Draco |
| No `meshoptimizer` | Large meshes shipped as-is | Wire `@gltf-transform/functions` `meshopt()` pass |
| BlenderKit enrichment | Subprocess to Python script | Consider daemon REST endpoint once BK daemon is stable |
| FBX → GLB conversion | Blender subprocess (slow) | Evaluate `fbx2glb` npm package for non-rigged assets |
| Elite 3D viewport | Infinite SI grid + ViewHelper + inspector (2026-08) | Do not add `three-viewport-gizmo` / second viewer app — extend `SceneEngine` + `ViewerWindow` |
| Local Files / sidebar icons | Fixed-size remote icon with bundled type/navigation fallback | Use `InfoIcon`; never assign another remote URL from an image error handler. A missing fallback can create an unbounded reload/flicker loop. |

### 8. Grudge UUID System — Slot Expansion

`src/shared/grudgeUUID.ts` defines the slot / tier taxonomy. When adding new asset families or game features:

- Add new slots here first — the ingestion pipeline's `SLOT_BY_FAMILY` map in `src/main/ingestion/index.ts` reads from this.
- The Solana cNFT minting path (planned) will use these UUIDs as on-chain identifiers.
- The `scripts/upload-asset-pack.ts` CLI also derives UUIDs — keep in sync.

### 9. CSP & Security Hardening

`src/renderer/index.html` and `loader.html` contain the `Content-Security-Policy` meta tag. When adding new external services:

- Add fetch/XHR targets to `connect-src`, new script sources to `script-src`, and new image domains to `img-src`. Current `connect-src` includes `https://*.grudge-studio.com`, `https://js.puter.com`, `http://127.0.0.1:*` (BlenderKit daemon). After editing, verify the CSP header in DevTools Network tab and confirm no CSP violations appear in the console.
- `webview` guest pages are locked down in `main.ts` (`will-attach-webview` strips all prefs) — do not relax this.
- The admin gating in `src/renderer/lib/admin.ts` is **UX-only**; Cloudflare Worker ACLs are the real enforcement layer.

---

## Key Conventions

- **Secrets**: store secrets with `setSecret`/`getSecret` in `src/main/auth/secretStore.ts`. Internally, values ≤ 2000 chars use keytar (Windows Credential Vault); values > 2000 chars automatically fall back to safeStorage (DPAPI). Never write secrets to `electron-store`, `.env` files, or any file on disk. If `getSecret` returns null or throws, surface an IPC error to the renderer with code `ERR_SECRET_MISSING` and instruct the user to re-run `npm run secret:import`. Do not silently proceed with an undefined credential. The `secret:import` script uses `setSecret` from `src/main/auth/secretStore.ts`, which automatically routes values > 2000 chars to safeStorage (DPAPI). If `setSecret` throws during import (e.g., safeStorage unavailable in the current Electron context), the script must print the failing key name and exit with code 1. Do not silently skip failed entries.
- **Adding a new IPC channel:** (1) Define channel name and payload types in `src/shared/ipc.ts`. (2) Add `ipcMain.handle` in `src/main/main.ts`. (3) Add matching `contextBridge` entry in `src/preload/preload.ts`. (4) Do not duplicate type definitions inline anywhere else.
- **Sandboxed preload build:** Electron's sandbox cannot load arbitrary sibling CommonJS modules from a preload. Keep shared IPC values canonical, let `npm run build:preload` bundle them into the single `dist/preload/preload.js` artifact, and retain both `test:preload` and `smoke:packaged` when changing the bridge or packaging flow.
- **Backend routing**: `src/main/api.ts` `resolveBackend()` is the single decision point for which backend a request uses. New backend modes go here. If the resolved backend returns a network error or 5xx, do NOT automatically fall through to another mode — `resolveBackend()` is a configuration decision, not a retry chain. Surface an IPC error `ERR_BACKEND_UNAVAILABLE` with the mode name so the renderer can display a specific failure message. Fallback mode logic, if ever needed, must be an explicit configuration change, not silent.
- **Adding a new backend mode**: (1) add the mode string to the union type in `src/shared/ipc.ts`, (2) implement the case in `resolveBackend()` in `src/main/api.ts`, (3) add credentials to `docs/production-config.md`, (4) add a health-check probe in `src/main/fleet/healthCheck.ts`.
- **Public CDN URL**: resolved by `r2PublicUrl()` in `src/main/cf/r2Direct.ts`. The `r2PublicUrl()` fallback chain is: (1) keytar `cf-r2-public-url`, (2) env `CF_R2_PUBLIC_URL`, (3) `cf-r2-endpoint` with bucket prefix, (4) hardcoded `https://assets.grudge-studio.com`. If all four resolve to null or throw, `r2PublicUrl()` throws `ERR_R2_URL_UNRESOLVABLE` — callers must handle this and surface an error to the renderer rather than proceeding with an undefined URL. Don't hardcode `assets.grudge-studio.com` elsewhere.
- **Telemetry**: use `src/main/cf/observatory.ts` `pushEvent()` for any new AI or significant user-action events. Telemetry is fire-and-forget — `pushEvent()` must never throw or await in a user-blocking code path. If the Observatory Worker returns a non-2xx or the request times out, log the failure to the console at `warn` level and discard silently. Do not retry or queue. The Observatory Worker schema is in [deploy/observatory/schema.sql](deploy/observatory/schema.sql).
- **Icons**: regenerate via `npm run build:icons` — source is `resources/brand/grudge-emblem-source.png`.
- **Daily maintenance**: follow `docs/daily-maintenance.md` and the digest-bound policy in `config/maintenance.policy.json`. Defaults are discovery-only with every budget unconfigured and every authority switch off. Never edit the policy approval on behalf of the owner, keep state outside the checkout, treat a dirty tree as a mutation stop, and keep observer/staging/adoption evidence separate.
- **Updates**: background checks are discovery only. Download and restart/install each require an explicit user action. Local installers without `resources/app-update.yml` are explicitly unconfigured: do not invent a feed or show a repeated missing-file error.
- **Release**: `npm run publish:manual` (or `:minor`/`:major`) handles the manual pipeline. Workflow source files exist under `.github/workflows`, but source presence is not proof that a workflow is enabled or passing on GitHub; verify live status separately. `publish:manual --dry-run` must remain network- and write-free. If an actual publish fails after pushing a git tag, manually delete the tag with `git push origin :refs/tags/<tag>` before retrying. Do not push a duplicate tag or create the GitHub release manually unless the build artifact in `release/` has been verified.

---

## Docs Index

| Doc | Covers |
|---|---|
| [docs/production-config.md](docs/production-config.md) | Full credential table, all keytar account names |
| [docs/object-storage.md](docs/object-storage.md) | R2 bucket layout, manifest schema, CDN behavior |
| [docs/grudge-uuid.md](docs/grudge-uuid.md) | UUID format, slot taxonomy, tier system |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Known errors and exact fixes |
| [docs/dev-tool-quickstart.md](docs/dev-tool-quickstart.md) | First-run setup guide |
| [docs/api-reference.md](docs/api-reference.md) | IPC channel reference |
| [docs/prompt-to-3d.md](docs/prompt-to-3d.md) | Local provider capabilities, installer, readiness states, validation and offline-test mode |
| [docs/guided-workflow-reliability.md](docs/guided-workflow-reliability.md) | Minimal inputs, shared admission, save/update recovery, probe and doctor contract |
| [docs/daily-maintenance.md](docs/daily-maintenance.md) | Governed observer/staging/adoption maintenance, budgets, provenance, evidence and rollback |
| [docs/daily-maintenance-prompt.md](docs/daily-maintenance-prompt.md) | Exact Codex scheduled-task prompt; inactive until owner-approved scheduling |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [REVIEW.md](REVIEW.md) | Audit findings log |
