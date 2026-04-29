# Changelog

All notable changes to **grudge-dev-tool** are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Settings: asset-service base URL input** (REVIEW.md F1). New input row in the Grudge identity card lets you point the dev tool at any `assets-api.*` host. Backed by `settings:setAssetsApiBase` IPC + `settings:get` now returns `assetsApiBaseUrl`. Single-domain dev installs that proxy `/api/objectstore/*` through game-api can paste their game-api URL here.
- **Connectivity probes both services** (REVIEW.md F2). When the resolved backend is `grudge`, the 30-second tick now probes `api.grudge-studio.com/api/health` AND `assets-api.grudge-studio.com/api/health` in parallel. Overall `reachable` is the AND; the Settings Diagnostics card shows both rows separately. Status bar no longer lies green when game-api is up but asset-service is down.

### Changed
- **Renderer no longer hardcodes the public CDN host** (REVIEW.md F3). `LoaderApp.tsx` and `Browser.tsx` now resolve the CDN base once on mount via `cf.r2PublicUrl("")` and cache it; URL templates are rebuilt against the resolved value. A private deploy pointing at a different domain Just Works without a code change.
- **Docs link fixed** (REVIEW.md F4). The Docs page now links to the actual published Jekyll site (`https://grudge-warlords.github.io/grudge-dev-tool/`) instead of the placeholder `docs.grudge-studio.com/dev-tool` subdomain that was never deployed.
- **AI Gateway model defaults are env-overridable** (REVIEW.md F6). `workersAiChat` reads `CF_AI_DEFAULT_MODEL`, `workersAiCaption` reads `CF_AI_VISION_MODEL`, both before falling back to the documented Workers AI defaults. Per-call `opts.model` still wins.
- **BlenderKit `apiPrefix()` derives from the addon manifest** (REVIEW.md F7). The hardcoded `"v1.8"` constant is replaced with a function that reads `blender_manifest.toml` (already cached by `readAddonVersion`), strips to `v<major>.<minor>`, and falls back to `v1.8` only when manifest read fails. All four call sites updated.
- **LoaderApp default pinned shortcuts** (REVIEW.md F8). Dropped the version-specific `asset-packs/classic64/v0.6/` pin so first-run users without that pack don't see a broken shortcut. Defaults are now `asset-packs/`, `user-uploads/`, `shared/` — prefixes that exist for every tenant.

### Removed
- **`node-fetch` runtime dependency** (REVIEW.md F5). Node 20 (Electron 41 baseline) has global `fetch`; we never imported `node-fetch` from any source file. Removed from `package.json`; reinstall removed 6 transitive packages from the lock file.

## [0.3.2] — 2026-04-29

### Changed
- Fix Forge 3D render crash: 'this.traverse is not a function'. Three.js r169 refactored TransformControls to no longer extend Object3D; SceneEngine now adds transformControls.getHelper() to the scene as the documented r169+ API requires. Forge 3D viewport now mounts cleanly. Auto-update delivers within 4h.

### Fixed
- **Forge 3D render crash: `this.traverse is not a function`.** Three.js r169 (the version we ship) refactored `TransformControls` so the controller no longer extends `Object3D` — it now extends `Controls` (an `EventDispatcher`). `SceneEngine` was doing `scene.add(transformControls)`, which landed a non-`Object3D` in `scene.children`; the next `scene.traverse(…)` / `Box3.setFromObject(…)` (anything that recursively walked the graph) blew up because three's traversal calls `child.traverse(callback)` on each child. Fix: add `transformControls.getHelper()` (the actual visual gizmo `Object3D`) to the scene instead, keep a reference to the helper for `dispose()` removal, and detach + remove the helper before walking the scene for resource cleanup. The Forge 3D viewport now mounts cleanly on first paint.

## [0.3.1] — 2026-04-29

### Changed
- Fix sign-in failure: 'The stub received bad data.' Modern Puter JWT tokens exceed Win32 Credential Manager's 2.5 KB blob limit; auth now falls back to Electron safeStorage (DPAPI) for oversized secrets. Existing v0.3.0 installs auto-update within 4h.

### Fixed
- **Sign-in failure: "The stub received bad data."** Modern Puter tokens are signed JWTs that exceed the ~2.5 KB credential-blob size limit imposed by the Win32 Credential Manager (`RPC_X_BAD_STUB_DATA / 0x800706F7`), which `keytar.setPassword` would surface as exactly that error message. `auth:puterLogin` now goes through a new hybrid `secretStore` (`src/main/auth/secretStore.ts`) that tries keytar first and falls back to an Electron `safeStorage`-encrypted file under `%APPDATA%\Grudge Dev Tool\secrets\<account>.bin` (DPAPI-bound to the OS user) when keytar refuses the write. Reads check keytar first for back-compat with v0.3.0 installs that wrote small values, then the file. `puterSession.setSession` / `getSession` / `getPuterToken` / `clearSession` / `wipeIdentity` all use the hybrid store now, and a one-shot log line records whether the token landed in keytar or safeStorage so we can confirm the diagnosis on future support requests.

## [0.3.0] — 2026-04-28

### Changed
- Manual release.

### Added
- **Forge 3D editor + Windows 3D viewer.** New `Forge 3D` page mounted at `/forge` in the sidebar. Built on Three.js (no React-Three-Fiber dependency — keeps React 18 compatibility) with full-fat studio lighting (warm key + cool fill + IBL via `RoomEnvironment`), shadow-mapped directional key, OrbitControls, TransformControls (translate / rotate / scale), grid + axes helpers, ACES Filmic tone mapping, sRGB color space.
- **Multi-format model loaders:** GLB, glTF, OBJ, FBX, STL, PLY (mesh + point cloud), DAE (Collada), 3MF. Drag-drop a file anywhere on the window or click `Open`. Each file is parsed, framed, and added to the scene hierarchy with triangle / vertex / bone counts and (for GLB) full binary container inspection (magic, version, JSON & BIN chunk sizes, used extensions including Draco / Meshopt / KHR_texture_basisu, generator string).
- **Animation playback.** All animation clips that ride along with FBX / GLB / GLTF / DAE files are listed in the inspector with per-clip Play / Pause / Stop controls and clip duration; one `THREE.AnimationMixer` per object updates from the engine's `clock`.
- **GLB convert + export.** Any loaded model can be re-exported as GLB via three's `GLTFExporter` (`Export GLB` button on selected, `Scene GLB` button to flatten the entire scene into one file). Shows post-export size, triangle count, and serialization time.
- **Direct R2 upload from the viewer.** `Convert → GLB → Upload` in the Inspector mints a presigned PUT URL (`cf:r2SignedUpload`) using the existing R2 credentials in the Windows Credential Vault, PUTs the GLB straight to the bucket under a configurable prefix, then resolves the public CDN URL via `cf:r2PublicUrl` and copies it to the clipboard.
- **Windows file associations.** `electron-builder.yml` now registers `Grudge Dev Tool` as a Windows Open-With handler for `.glb` / `.gltf` / `.fbx` / `.obj` / `.stl` / `.ply` / `.dae` / `.3mf`. The user can right-click any model in Explorer → Open With → Grudge Dev Tool, or set us as the *default* 3D viewer for any of those extensions in the OS settings.
- **CLI / argv handling for cold-start file open.** `src/main/forge.ts` captures the model path from `process.argv` at boot (Explorer double-click) and from `app.on("second-instance")` (drag onto the running app icon). The renderer pulls the path through `forge:consumeInitialFile` on first mount, calls `forge:readFile` to get bytes via Node `fs.promises`, and the file is loaded into the Forge viewport — no temp files, no protocol handlers needed. The main process also auto-navigates to `/forge` when an open-file is delivered.
- **New IPC surface:** `cf.r2SignedUpload`, `cf.r2SignedDownload`, `cf.r2List`, `cf.r2Head`, `cf.r2PublicUrl` and the entire `forge.*` namespace (`consumeInitialFile`, `readFile`, `onOpenFile`).

### Changed
- **CSP** now allows `blob:` workers / scripts / connect (required by Three.js loaders that internally spin up workers, and by `URL.createObjectURL` for in-memory model bytes). Added `media-src 'self' data: blob:` and `worker-src 'self' blob:`.
- **Sidebar nav** grew an 8th entry: `Forge 3D` (hammer icon) sits between BlenderKit and Docs.
- **Production wiring aligned to canonical `Grudge-Warlords/grudge-studio-backend`.** That repo is now the single source of truth for Grudge Studio identity, game APIs, asset service, and Cloudflare/Puter integration; the previous PostgreSQL/Drizzle prototype is retired (server-side DB is **MySQL 8 + Redis 7**, never Postgres). The dev tool is a desktop client and does not embed any DB credentials — it talks HTTP only.
- **Asset-service base URL.** The canonical backend routes `upload-url`, `manifest`, `asset-meta`, listing, and search to a separate `assets-api.grudge-studio.com` (asset-service, port 3008) rather than the game-api at `api.grudge-studio.com`. Added `getAssetsApiBaseUrl()` / `setAssetsApiBaseUrl()` and a `GRUDGE_ASSETS_API_BASE` override (env var + keytar account `default.assetsApiBaseUrl`). All `/api/objectstore/*` calls now route through `authedFetchAssets` instead of `authedFetch`. Default = `https://assets-api.grudge-studio.com`.
- **Public CDN fallback.** `r2PublicUrl()` now always returns a URL (was nullable) — falls back to `process.env.OBJECT_STORAGE_PUBLIC_URL` then `https://assets.grudge-studio.com` (the canonical Cloudflare Worker fronting the `grudge-assets` R2 bucket). Forge3D's "Convert → GLB → Upload" toast now always shows a clickable Public URL after a fresh install, even before the user configures a CNAME.
- **`.env.example` documents the canonical R2 block** (`OBJECT_STORAGE_ENDPOINT`, `_BUCKET`, `_KEY`, `_SECRET`, `_REGION=auto`, `_PUBLIC_URL=https://assets.grudge-studio.com`, `_PUBLIC_R2_URL`) so the team can paste their backend `.env` block and run `npm run secret:import` to ingest into Windows Credential Vault.
- `scripts/import-secrets.mjs` and `scripts/set-secret.mjs` map `GRUDGE_ASSETS_API_BASE` → keytar `default.assetsApiBaseUrl`.

## [0.2.0] — 2026-04-26

### Changed
- Industry-standard hardening: error boundary at app root + per-page so render errors do not blank the window, window state persists across relaunches, security hardening in main (will-navigate allowlist + permission deny + webSecurity), local crash reporter, lazy-loaded routes for faster first paint, keyboard shortcuts (Ctrl+R reload, Ctrl+Shift+I devtools, F11 fullscreen). No regressions to login or upload paths from v0.1.9. Auto-update will deliver this within 4h.

## [0.1.9] — 2026-04-26

### Changed
- Login fix - browser-based Puter auth via @heyputer/puter.js Node integration. Sign-in now opens your default browser via getAuthToken (the official supported flow), captures the token through a localhost redirect, and persists the session in keytar. Bypasses every Electron renderer constraint that was blocking the prior popup-SDK approach. Manual token paste remains as backstop. Auto-update will deliver this within 4h.

## [0.1.8] — 2026-04-26

### Changed
- Login + logo fixes: Puter SDK now loads through CSP, logo image path fixed, main process now allows OAuth popups, manual token-paste fallback in case popup auth fails.

## [0.1.7] — 2026-04-26

### Changed
- Login gating + Upload backend selector. App now requires Puter sign-in before showing any features (Browser/Search/Upload/etc). Login flow uses the embedded Puter SDK popup which supports Google/GitHub/username; on success a Grudge ID is derived deterministically and stored in Windows Credential Vault. Sidebar shows the signed-in user; sign-out is one click. The Upload page now displays the actual destination of the next upload (Cloudflare Worker AI / R2 direct / GrudgeBuilder) with a backend selector dropdown so you can route on demand. Auto-update will deliver this within ~4h to existing installs.

### Added
- **`docs/troubleshooting.md`** — every error we've encountered with the exact resolution: tray-icon-missing, DOCTYPE warning, broken `/logo-256.png` under `file://`, CSP "syntax error" misnomer, `API unreachable` yellow dot, `ENOENT: dist/main/api.js`, missing `elevate.exe`, corrupted `package.json`, `command failed (null)` (Windows shell shim), TS strict-mode hits, the Actions-account-flag block, missing `latest.yml` for auto-update, and BlenderKit detection paths.
- **Direct download links** in `README.md` and `docs/index.md` pointing at the v0.1.3 installer so the GrudaChain code can be grabbed in one click without hunting through the releases tree.

### Changed
- `docs/index.md` front page now leads with a download section; `README.md` includes the direct `.exe` URL and a link to the troubleshooting page.

## [0.1.3] — 2026-04-26

### Fixed
- BlenderKit `addon_version` now read from `blender_manifest.toml` at runtime (was hardcoded `"3.19.2.260411"`).
- `publish-manual.mjs` runs npm/gh through a shell on Windows so the `.cmd` shims resolve (was `command failed (null)`).
- `package.json` repaired: orphan `publish:manual:*` entries restored to the `scripts` block, stray `"build": "^0.1.4"` dep removed.
- TypeScript strict-mode regressions: `app.on("window-all-closed")` listener signature, `WorkerListResponse` vs `ListItem` `md5Hash` shape mismatch.
- `electron-builder` cache cleanup recipe documented for `Cannot find file: elevate.exe` failures.

### Added
- `src/main/cf/{credentials, aiGateway, objectStoreWorker}.ts` — keytar-backed Cloudflare AI Gateway and R2 worker clients (no inline credentials).
- Backend-mode resolver in `api.ts`: `auto` picks Cloudflare when both Worker URL and key are present, otherwise routes to GrudgeBuilder.
- `scripts/{import-secrets, set-secret}.mjs` — import or set individual env-var-style secrets into Windows Credential Vault.
- `.env.example` documenting `GRUDGE_API_BASE`, `BLENDERKIT_PATH`, `BLENDERKIT_NO_PINNED`, `BLENDERKIT_API_KEY`, `GH_TOKEN`, and Windows code-signing vars.
- `templates/r3f-boilerplate/` scaffold (R3F starter for downstream projects).

### Changed
- Toolchain probes `BLENDERKIT_PATH` env, then `%APPDATA%\Blender Foundation\Blender\<4.2-4.5>\extensions\user_default\blenderkit` (and the legacy `scripts/addons/blenderkit` layout), then the dev fallback (suppressed entirely by `BLENDERKIT_NO_PINNED=1`).
- `publish-manual.mjs` derives `REPO` and `PRODUCT` from `electron-builder.yml` so renames are a single config change.
- `ListRequest` gains `delimiter`; `ListResponse` gains optional `folders[]`; `ListItem.md5Hash` is now optional. Worker and direct backends share one canonical IPC type.
- `.gitignore` tightened against `secret*.txt`, `*.pem`, `*.key`, `.secrets/`, and dry-run preview manifests.

## [0.1.2] — 2026-04-26

### Changed
- Production hardening v0.1.3. Removes hardcoded BlenderKit version (read from manifest at runtime), broadens addon path probing (Blender 4.2-4.5 user-extensions dirs), externalises REPO/PRODUCT in publish-manual, adds Cloudflare AI Gateway and R2 Worker clients (all keytar-backed), ships .env.example, tightens .gitignore, and fixes the win32 spawnSync shell issue. No hardcoded values or placeholders in production code paths.

## [0.1.2] — 2026-04-26

### Fixed
- **Broken logo / "white dot" in GrudgeLoader title bar and main sidebar** — image src was the absolute path `/logo-256.png`, which fails under the `file://` protocol used by packaged Electron renderers. Switched to the relative `./logo-256.png`. The gold-helm emblem now renders correctly next to the GrudgeLoader title.
- **"DOCTYPE not valid" warning** — swapped lowercase `<!doctype html>` for canonical uppercase `<!DOCTYPE html>` in both renderer entry HTML files. HTML5 spec allows both, but several validators/DevTools flag the lowercase form.
- Added an `onError` fallback on the loader title image: if `logo-256.png` is missing for any reason, it now falls back to `favicon.ico` instead of showing a broken-image placeholder.

## [0.1.1] — 2026-04-26

### Fixed
- **API base default** — was pointing at `https://grudgewarlords.com` (game frontend); now correctly defaults to `https://api.grudge-studio.com` (backend VPS).
- **Renderer CSP** — `connect-src` now whitelists `api.grudge-studio.com`, `*.grudge-studio.com`, and `js.puter.com`. Previously the locked-down policy refused connections to the real backend, which surfaced as a Content-Security-Policy violation in the deployed app.

### Changed
- README · docs · quickstart now correctly distinguish backend (`api.grudge-studio.com`) from game frontend (`grudgewarlords.com`).

## [0.1.0] — 2026-04-25

### Added
- Comprehensive `README.md` with badges, project layout, and release flow.
- Jekyll docs site under `docs/` (`just-the-docs` theme), deployed to GitHub Pages via `.github/workflows/pages.yml`.
- `.github/workflows/release.yml` — tag-triggered Windows build that publishes the NSIS installer + `latest.yml` to GitHub Releases via electron-builder.

### Added (continued from 0.1.0)
- Initial Electron tray application: gold-helm tray icon, main window with 8 pages, frameless always-on-top **GrudgeLoader** overlay.
- Mandatory ingestion pipeline: `size-verify → convert → enrich → rig → hash → UUID → upload → manifest`.
- BlenderKit integration (out-of-process daemon + in-Blender Python scripts).
- Connectivity probe + status bar; `electron-log` diagnostics; `electron-updater` auto-update.
- Tailwind CSS, lucide-react icons, sonner toasts, TanStack Query data layer.
- Full icon set generation (`scripts/build-icons.mjs`) from the brand emblem source.

[Unreleased]: https://github.com/Grudge-Warlords/grudge-dev-tool/compare/v0.1.3...HEAD
[0.1.3]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v0.1.3
[0.1.2]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v0.1.2
[0.1.1]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v0.1.1
[0.1.0]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v0.1.0
[0.1.3]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v0.1.3
[0.1.7]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v0.1.7
[0.1.8]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v0.1.8
[0.1.9]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v0.1.9
[0.2.0]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v0.2.0
[0.3.0]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v0.3.0
[0.3.1]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v0.3.1
[0.3.2]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v0.3.2
