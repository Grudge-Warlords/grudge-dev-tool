# Changelog

All notable changes to **grudge-dev-tool** are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.3] — 2026-04-26

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

[Unreleased]: https://github.com/Grudge-Warlords/grudge-dev-tool/compare/v0.1.2...HEAD
[0.1.2]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v0.1.2
[0.1.1]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v0.1.1
[0.1.0]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v0.1.0
[0.1.3]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v0.1.3
