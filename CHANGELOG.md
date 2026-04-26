# Changelog

All notable changes to **grudge-dev-tool** are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Grudge-Warlords/grudge-dev-tool/compare/v0.1.1...HEAD
[0.1.1]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v0.1.1
[0.1.0]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v0.1.0
