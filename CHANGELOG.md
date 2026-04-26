# Changelog

All notable changes to **grudge-dev-tool** are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Comprehensive `README.md` with badges, project layout, and release flow.
- Jekyll docs site under `docs/` (`just-the-docs` theme), deployed to GitHub Pages via `.github/workflows/pages.yml`.
- `.github/workflows/release.yml` — tag-triggered Windows build that publishes the NSIS installer + `latest.yml` to GitHub Releases via electron-builder.

### Changed
- N/A

### Fixed
- N/A

## [0.1.0] — 2026-04-25

### Added
- Initial Electron tray application: gold-helm tray icon, main window with 8 pages, frameless always-on-top **GrudgeLoader** overlay.
- Mandatory ingestion pipeline: `size-verify → convert → enrich → rig → hash → UUID → upload → manifest`.
- BlenderKit integration (out-of-process daemon + in-Blender Python scripts).
- Connectivity probe + status bar; `electron-log` diagnostics; `electron-updater` auto-update.
- Tailwind CSS, lucide-react icons, sonner toasts, TanStack Query data layer.
- Full icon set generation (`scripts/build-icons.mjs`) from the brand emblem source.

[Unreleased]: https://github.com/Grudge-Warlords/grudge-dev-tool/compare/v0.1.0...HEAD
[0.1.0]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v0.1.0
