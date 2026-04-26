---
layout: default
title: Home
nav_order: 1
description: Windows tray app for object-storage browse/search/upload, Grudge UUIDs, and BlenderKit-driven asset ingestion.
permalink: /
---
# Grudge Dev Tool
{: .fs-9 }
A Windows tray app for the Grudge Studio team — object-storage browse / search / upload, Grudge UUIDs, BlenderKit-driven ingestion, and a small always-on-top **GrudgeLoader** overlay for fast asset access.
{: .fs-5 .fw-300 }
[Download latest release](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View on GitHub](https://github.com/Grudge-Warlords/grudge-dev-tool){: .btn .fs-5 .mb-4 .mb-md-0 }
---
## What it does
- **Tray icon** with full context menu, plus **GrudgeLoader** — a small frameless always-on-top overlay snapped bottom-right.
- **Browser / Search / Upload** for the team object storage.
- **Per-asset copy buttons** in GrudgeLoader: `path`, CDN URL, `curl`, `wget`, Node `assetUrl()` snippet — pick a format from the dropdown, click the copy icon.
- **Mandatory ingestion pipeline** for every uploaded file: `size-verify → convert → enrich → rig → hash → UUID → upload → manifest`.
- **BlenderKit** integration for autonomous Blender actions: search the catalog from the local daemon, run autothumb / scene-enrich Python scripts in Blender headless.
- **Auto-update** via `electron-updater` against the GitHub release feed.
- **Network listener** + status bar — green/yellow/red dot showing live connectivity to the backend.
## Quickstart
1. Download `Grudge Dev Tool-Setup-x.y.z.exe` from [Releases](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest) and install it.
2. Find the **gold-helm tray icon** (Windows notification area, bottom-right). Left-click → GrudgeLoader. Double-click → main window.
3. Open **Settings** and paste your Grudge bearer token (and optionally your BlenderKit API key).
4. Confirm the **Toolchain** card is mostly green.
## Documentation
- [Quickstart](dev-tool-quickstart.md)
- [Object storage layout & ACL](object-storage.md)
- [Grudge UUID system](grudge-uuid.md)
- [API reference (`/api/objectstore/*`)](api-reference.md)
## Releases
The newest install is always at the [latest release](https://github.com/grudge-studio/grudge-dev-tool/releases/latest). Existing installations auto-update silently and prompt **Restart now / Later** when ready.
## Project status
Pre-release · v0.1.x · Windows x64 · NSIS unsigned. Code-signing (EV cert) and the embedded Puter login flow are next on the roadmap — see the [tracking issues](https://github.com/Grudge-Warlords/grudge-dev-tool/issues).

<!-- Pages deploy ping: 2026-04-26T04:02:43.0999482-05:00 -->
