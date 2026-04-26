# Grudge Dev Tool

[![Release](https://img.shields.io/github/v/release/Grudge-Warlords/grudge-dev-tool?display_name=tag&sort=semver)](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest)
[![Pages](https://img.shields.io/github/actions/workflow/status/Grudge-Warlords/grudge-dev-tool/pages.yml?label=docs)](https://grudge-warlords.github.io/grudge-dev-tool/)
[![Build](https://img.shields.io/github/actions/workflow/status/Grudge-Warlords/grudge-dev-tool/release.yml?label=build)](https://github.com/Grudge-Warlords/grudge-dev-tool/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-internal-lightgrey.svg)](#license)
[![Electron](https://img.shields.io/badge/electron-30.x-47848f.svg)](https://www.electronjs.org/)

A Windows tray application for the Grudge Studio team. Browse object storage, search the asset catalog, mass-upload through a mandatory ingestion pipeline, generate Grudge UUIDs, and pull from BlenderKit — all from a single tray icon plus a small always-on-top **GrudgeLoader** overlay.

> **Status:** v0.1.x · pre-release · Windows x64 · unsigned NSIS installer

📚 **Docs:** <https://grudge-warlords.github.io/grudge-dev-tool/>
📦 **Latest release:** <https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest>

---

## Features

| Surface | What it does |
|---|---|
| **Tray icon** | Gold-helm emblem in the Windows notification area. Left-click → toggles GrudgeLoader. Double-click → opens main window. Right-click → full menu. |
| **Main window** | 8 pages — Browser · Search · Upload · Request URL · UUID · BlenderKit Library · Docs · Settings — with bottom status bar showing live API connectivity, log link, and update progress. |
| **GrudgeLoader** | Frameless 360 × 520 always-on-top mini-overlay. Pinned folders, prefix browse with thumbnails, drag-drop bulk upload, **per-asset copy buttons** (path / cdn URL / `curl` / `wget` / Node `assetUrl()` snippet). |
| **Ingestion pipeline** | Mandatory for every uploaded file: `size-verify → convert → enrich → rig → hash → UUID → upload → manifest`. Shared between the tray-app Upload page and the `upload-asset-pack` CLI. |
| **BlenderKit** | Local daemon HTTP integration for asset search/download; in-Blender Python scripts for autothumb + scene enrichment. Uses your existing on-disk install (`F:\blenderkit-v3.19.2.260411\` by default). License-clean — addon files are never bundled. |
| **Auth** | Settings stores Grudge bearer token + BlenderKit API key in Windows Credential Vault via `keytar`. Embedded Puter login flow planned (see [docs](https://grudge-studio.github.io/grudge-dev-tool/)). |
| **Auto-update** | `electron-updater` checks the GitHub release feed every 4h. Silent download → "Restart now / Later" prompt. |
| **Network listener** | Main process probes `${apiBase}/api/health` every 30s; results broadcast over IPC to all windows; status dot in main window + GrudgeLoader title bar. |
| **Logging** | `electron-log` writes to `%APPDATA%\Grudge Dev Tool\logs\main.log`. *Logs* link in the bottom status bar opens the folder. |

## Install

### From release (recommended)
Download the latest `.exe` from [Releases](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest) and run it.

### From source
```pwsh
git clone https://github.com/Grudge-Warlords/grudge-dev-tool.git
cd grudge-dev-tool
npm install
npm run build:icons          # one-time, generates resources/icon.ico + tray.png
npm run dev                  # hot-reload Vite + Electron
```

### First-run setup
1. Find the gold-helm icon in your Windows notification area (bottom-right). Left-click toggles the GrudgeLoader; double-click opens the main window.
2. Sidebar → **Settings**.
3. Paste your **Grudge bearer token** (mint at `id.grudge-studio.com`).
4. Optional: paste your **BlenderKit API key** to enable the Asset Library + ingestion `enrich` stage.
5. Confirm the **Toolchain** card shows green for `sharp`, `gltf-transform`, and (for model conversions) `Blender` + `BlenderKit`.

## Stack

- **Electron 30** + Node 20 main process (TypeScript, CommonJS, compiled with `tsc`)
- **Vite 5** + **React 18** + **TypeScript** renderer (two HTML entries: `index.html` for main window, `loader.html` for GrudgeLoader)
- **Tailwind CSS 3.4** layered on existing CSS variables; **lucide-react** icons; **sonner** toasts
- **TanStack Query 5** for the data layer (retries, cache, no refetch-on-focus)
- **keytar** for secrets (Windows Credential Vault); **electron-store** for window prefs
- **electron-log** + **electron-updater** for diagnostics & auto-update
- **electron-builder** + NSIS for the installer

## Project layout

```
grudge-dev-tool/
  src/
    main/                          # Electron main process (Node)
      main.ts                      # Entry: window/tray/loader/IPC
      tray.ts                      # System-tray icon + context menu
      loader.ts                    # GrudgeLoader (always-on-top mini-window)
      api.ts                       # GrudgeBuilder API client (token via keytar)
      uploader.ts                  # Concurrent upload queue
      connectivity.ts              # 30s health-probe + IPC broadcast
      logger.ts                    # electron-log setup
      updater.ts                   # electron-updater setup
      ingestion/                   # Mandatory pipeline
        sizeVerify.ts
        convert.ts                 # Blender headless · sharp · ffmpeg
        rig.ts                     # gltf-transform skeleton inspection
        enrich.ts                  # BlenderKit-driven scene enrichment
        toolchain.ts               # Auto-detects Blender / ffmpeg / sharp / BlenderKit
        index.ts                   # Pipeline orchestrator
      blenderkit/
        daemon.ts                  # Local HTTP daemon wrapper
        scripts/bk_autothumb.py
        scripts/bk_enrich.py
    preload/
      preload.ts                   # contextBridge surface for the renderer
    renderer/
      index.html                   # Main window
      loader.html                  # GrudgeLoader window
      App.tsx                      # Sidebar + route switch + StatusBar
      LoaderApp.tsx                # GrudgeLoader UI
      pages/                       # Browser · Search · Upload · Request · UUID · AssetLibrary · Docs · Settings
      components/StatusBar.tsx
      styles/{app,loader}.css
    shared/
      grudgeUUID.ts                # Local mirror of GrudgeBuilder's UUID system
      ipc.ts                       # IPC contract types
  scripts/
    build-icons.mjs                # Emits the full PNG/ICO icon set from the brand emblem
    upload-asset-pack.ts           # CLI runner of the ingestion pipeline + uploader
  docs/                            # Jekyll site (deployed to GitHub Pages)
  resources/                       # Icons + brand source
  electron-builder.yml             # NSIS config + GitHub publish target
  .github/workflows/
    pages.yml                      # Docs site deploy
    release.yml                    # Tag-triggered build + GitHub Release
```

## Scripts

```pwsh
npm run dev              # hot-reload dev (Vite + Electron)
npm run build:icons      # regenerate resources/icon.ico + sized PNGs
npm run build            # vite build + tsc main
npm run package          # build + electron-builder NSIS
npm run typecheck        # tsc --noEmit on both main and renderer projects
npm run upload-pack -- --root <dir> --pack-id <id> --version <ver> --dry-run
```

## Object-storage layout (canonical)

```
asset-packs/<pack-id>/v<version>/<category>/<file>          # source assets
asset-packs/<pack-id>/v<version>/_thumbs/<category>/<file>  # 256px JPEG thumbs
asset-packs/<pack-id>/v<version>/_originals/<category>/...  # only with --keep-source
asset-packs/<pack-id>/v<version>/_blends/<category>/...     # raw .blend
asset-packs/<pack-id>/manifest.json                         # full catalog (Grudge UUIDs)
asset-packs/<pack-id>/CHANGELOG.txt, README.txt
user-uploads/<grudgeId>/<arbitrary-path>                    # per-user
shared/<purpose>/<file>                                     # admin-write
dev/<scratch>                                               # admin-write
```

Public CDN: `https://assets.grudge-studio.com/asset-packs/<pack-id>/v<version>/<category>/<file>`

See [`docs/object-storage.md`](docs/object-storage.md) for ACL rules and the manifest schema.

## Releases

Two paths — pick whichever's available.

### Manual (recommended right now)

`npm run publish:manual` does **everything** in one shot: cleans, syncs with origin, bumps `package.json`, inserts a CHANGELOG entry, builds the installer, commits, tags, pushes, and uploads the release with `.exe` + `.exe.blockmap` + `latest.yml` to GitHub Releases via `gh`.

```pwsh
npm run publish:manual                   # patch bump (default)
npm run publish:manual:minor             # minor bump
npm run publish:manual:major             # major bump
npm run publish:manual:dry               # walk through it without touching anything
# Custom notes / explicit version:
node scripts/publish-manual.mjs --version 0.5.0 --notes "Big rework."
```

Auto-update (`electron-updater`) runs every 4h in production and prompts users to restart when a new release lands. See [`src/main/updater.ts`](src/main/updater.ts).

### CI (when GitHub Actions is enabled for the account)

Tag-driven. Pushing a `vX.Y.Z` tag fires `.github/workflows/release.yml` → Windows runner → `electron-builder` builds + publishes a draft GitHub Release with the same artifacts. Use this when ready; until then, `publish:manual` does the equivalent work locally.

```pwsh
npm version patch -m "release: v%s"
git push origin main --follow-tags
```

## Contributing

This is internal Grudge Studio software. PRs welcome from team members; commits should target `main` and follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `release:`).

Before opening a PR:
```pwsh
npm run typecheck
npm run package          # full build sanity check
```

## License

UNLICENSED — internal use within Grudge Studio.

External deps retain their own licenses; **BlenderKit** (GPL-2.0-or-later) is invoked out-of-process from a separate on-disk install and is never bundled with this app.

## Links

- 📚 Docs site — <https://grudge-warlords.github.io/grudge-dev-tool/>
- 📦 Releases — <https://github.com/Grudge-Warlords/grudge-dev-tool/releases>
- 🛠 Issue tracker — <https://github.com/Grudge-Warlords/grudge-dev-tool/issues>
- 🌐 Backend API — [api.grudge-studio.com](https://api.grudge-studio.com) · Studio — [grudge-studio.com](https://grudge-studio.com) · Game frontend — [grudgewarlords.com](https://grudgewarlords.com)
