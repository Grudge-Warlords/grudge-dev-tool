# Changelog

All notable changes to **grudge-dev-tool** are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
