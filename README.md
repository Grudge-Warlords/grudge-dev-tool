# Grudge Dev Tool

[![Release](https://img.shields.io/github/v/release/Grudge-Warlords/grudge-dev-tool?display_name=tag&sort=semver)](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest)
[![Pages](https://img.shields.io/github/actions/workflow/status/Grudge-Warlords/grudge-dev-tool/pages.yml?label=docs)](https://grudge-warlords.github.io/grudge-dev-tool/)
[![Build](https://img.shields.io/github/actions/workflow/status/Grudge-Warlords/grudge-dev-tool/release.yml?label=build)](https://github.com/Grudge-Warlords/grudge-dev-tool/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-internal-lightgrey.svg)](#license)
[![Electron](https://img.shields.io/badge/electron-41.x-47848f.svg)](https://www.electronjs.org/)
[![Three.js](https://img.shields.io/badge/three.js-r169-049ef4.svg)](https://threejs.org/)
[![Node](https://img.shields.io/badge/node-20.x-339933.svg?logo=nodedotjs)](https://nodejs.org/)

A Windows tray application for the Grudge Studio team. Browse object storage, search the asset catalog, mass-upload through a mandatory ingestion pipeline, generate Grudge UUIDs, pull from BlenderKit, and **author / preview / convert / upload 3D models** with the built-in **Forge 3D** editor — all from a single tray icon plus a small always-on-top **GrudgeLoader** overlay. Also doubles as a Windows default 3D viewer for `.glb` / `.gltf` / `.fbx` / `.obj` / `.stl` / `.ply` / `.dae` / `.3mf`.

> **Status:** v0.3.2 · Windows x64 · Authenticode-signed NSIS installer · auto-updating

📚 **Docs:** <https://grudge-warlords.github.io/grudge-dev-tool/>
📦 **Latest release:** <https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest>
⬇ **Direct download (v0.3.2):** [`Grudge Dev Tool-Setup-0.3.2.exe`](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/download/v0.3.2/Grudge.Dev.Tool-Setup-0.3.2.exe) · ~107 MB · Windows x64 · NSIS
📝 **Audit notes:** [`REVIEW.md`](REVIEW.md) — production-wiring + dependency review against the canonical `Grudge-Warlords/grudge-studio-backend`.
🔧 **Trouble?** [`docs/troubleshooting.md`](docs/troubleshooting.md) covers every error we've resolved (DOCTYPE, broken logo, CSP "syntax" errors, Actions disabled, BlenderKit not detected, auto-update stuck, sign-in stub-data, Forge3D `traverse` crash, and more).

---

## Features

| Surface | What it does |
|---|---|
| **Tray icon** | Gold-helm emblem in the Windows notification area. Left-click → toggles GrudgeLoader. Double-click → opens main window. Right-click → full menu. |
| **Main window** | 9 pages — Browser · Search · Upload · Request URL · UUID · BlenderKit Library · **Forge 3D** · Docs · Settings — with bottom status bar showing live API connectivity, log link, and update progress. |
| **Forge 3D** | Built-in Three.js (r169) editor + viewer for `.glb`, `.gltf`, `.fbx`, `.obj`, `.stl`, `.ply`, `.dae`, `.3mf`. Drag-drop a file, the GLB binary container is decoded (magic, version, chunk sizes, extensions, generator), the model loads with full PBR / IBL / shadow-mapped key + cool fill, TransformControls gizmo (W/E/R) via the `getHelper()` API, animation clips with Play/Pause/Stop, scene-tree hierarchy, screenshot, and one-click `Convert → GLB → Upload to R2` that mints a presigned PUT and copies the public CDN URL to the clipboard. Registered with Windows as a default opener for those extensions, so right-click → Open With → Grudge Dev Tool just works. |
| **GrudgeLoader** | Frameless 360 × 520 always-on-top mini-overlay. Pinned folders, prefix browse with thumbnails, drag-drop bulk upload, **per-asset copy buttons** (path / cdn URL / `curl` / `wget` / Node `assetUrl()` snippet). |
| **Ingestion pipeline** | Mandatory for every uploaded file: `size-verify → convert → enrich → rig → hash → UUID → upload → manifest`. Shared between the tray-app Upload page and the `upload-asset-pack` CLI. |
| **BlenderKit** | Local daemon HTTP integration for asset search/download; in-Blender Python scripts for autothumb + scene enrichment. Uses your existing on-disk install (`F:\blenderkit-v3.19.2.260411\` by default). License-clean — addon files are never bundled. |
| **Auth** | Browser-based Puter sign-in via `@heyputer/puter.js` Node integration (main-process `getAuthToken()` flow). Token + user + Grudge ID stored in a hybrid secret store: keytar first (Windows Credential Vault), with automatic fallback to an Electron `safeStorage`-encrypted file (DPAPI) when the value exceeds the 2.5 KB credential-blob cap. Manual-paste fallback always available. |
| **Object storage** | Three resolved backends: **R2 direct** (S3-compatible, presigned PUT/GET), **Cloudflare Worker** (`/list`, `/upload-url`, `/manifest`, `/asset`, `/search`), and **GrudgeBuilder asset-service** (`assets-api.grudge-studio.com`). Auto-resolution picks R2 direct when full creds are present, otherwise Worker, otherwise asset-service. Backend mode override in Settings + Upload page. |
| **Auto-update** | `electron-updater` checks the GitHub release feed every 4h. Silent download → "Restart now / Later" prompt. Authenticode-signed `.exe` and `latest.yml` shipped per release. |
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
2. Click **Sign in / Create Grudge account** on the login screen — this opens your default browser to `puter.com`, captures the auth token via a localhost redirect, mints a deterministic Grudge ID from your Puter UUID, and persists everything via the hybrid secret store.
3. Sidebar → **Settings** → **Cloudflare R2 + AI Gateway** card. Use `npm run secret:import <path-to-secrets.txt>` (or paste each individually) to ingest your R2 + Worker + AI Gateway credentials. Canonical names: `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_BUCKET=grudge-assets`, `OBJECT_STORAGE_KEY`, `OBJECT_STORAGE_SECRET`, `OBJECT_STORAGE_REGION=auto`, `OBJECT_STORAGE_PUBLIC_URL=https://assets.grudge-studio.com`.
4. Optional: paste your **BlenderKit API key** to enable the Asset Library + ingestion `enrich` stage.
5. Confirm the **Toolchain** card shows green for `sharp`, `gltf-transform`, and (for model conversions) `Blender` + `BlenderKit`.
6. Click `Test R2`, `Test Worker`, or `Test AI` in the Cloudflare card to confirm each backend is reachable.

## Stack

- **Electron 41** + Node 20 main process (TypeScript, CommonJS, compiled with `tsc`)
- **Vite 8** + **React 18** + **TypeScript** renderer (two HTML entries: `index.html` for main window, `loader.html` for GrudgeLoader)
- **Three.js r169** + standard loaders (GLTF / OBJ / FBX / STL / PLY / Collada / 3MF) + GLTFExporter + RoomEnvironment IBL — wired into the **Forge 3D** page; no React-Three-Fiber dependency (keeps React 18 compatibility).
- **Tailwind CSS 3.4** layered on existing CSS variables; **lucide-react** icons; **sonner** toasts
- **TanStack Query 5** for the data layer (retries, cache, no refetch-on-focus)
- **AWS SDK v3 (`@aws-sdk/client-s3`)** for the R2 S3-compatible client (`forcePathStyle:true`, `WHEN_REQUIRED` checksum — required by R2)
- **`@heyputer/puter.js`** Node integration for browser-based Puter sign-in (asar-unpacked because it uses `vm.runInNewContext` on its bundled CJS at runtime)
- **keytar + Electron `safeStorage`** hybrid secret store (Windows Credential Vault → DPAPI-encrypted file fallback for values > 2.5 KB)
- **electron-store** for window state; **electron-log** + **electron-updater** for diagnostics & auto-update
- **electron-builder** + NSIS for the installer (Authenticode-signed; `fileAssociations` for `.glb` / `.gltf` / `.fbx` / `.obj` / `.stl` / `.ply` / `.dae` / `.3mf`)

## Project layout

```
grudge-dev-tool/
  src/
    main/                          # Electron main process (Node)
      main.ts                      # Entry: window/tray/loader/IPC + argv-file capture
      forge.ts                     # Forge3D file-open bridge (cold-start argv + second-instance)
      tray.ts                      # System-tray icon + context menu
      loader.ts                    # GrudgeLoader (always-on-top mini-window)
      api.ts                       # game-api + asset-service HTTP clients (split base URLs)
      uploader.ts                  # Concurrent upload queue
      connectivity.ts              # 30s health-probe + IPC broadcast
      logger.ts                    # electron-log setup
      updater.ts                   # electron-updater setup
      auth/
        puterLogin.ts              # Browser-based Puter getAuthToken flow
        puterSession.ts            # Grudge ID derivation + session lifecycle
        secretStore.ts             # keytar → safeStorage hybrid storage
      cf/
        credentials.ts             # keytar accounts for R2 / Worker / AI Gateway
        r2Direct.ts                # S3-compatible R2 client (signed PUT/GET, list, head)
        objectStoreWorker.ts       # Cloudflare Worker client
        aiGateway.ts               # Workers AI / AI Gateway proxy
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
      preload.ts                   # contextBridge surface for the renderer (settings, os, upload, ingest, bk, uuid, loader, connectivity, updater, autoLaunch, diag, app, auth, cf, ai, forge)
    renderer/
      index.html                   # Main window
      loader.html                  # GrudgeLoader window
      App.tsx                      # Sidebar + route switch + StatusBar (9 routes)
      LoaderApp.tsx                # GrudgeLoader UI
      pages/                       # Browser · Search · Upload · Request · UUID · AssetLibrary · Forge3D · Docs · Settings
      lib/forge/                   # Three.js scene engine, multi-format loaders, GLB inspector, GLTFExporter wrapper
      components/{StatusBar,ErrorBoundary,DemoModeBanner}.tsx
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
user-uploads/forge/<filename>.glb                           # default Forge3D upload prefix
shared/<purpose>/<file>                                     # admin-write
dev/<scratch>                                               # admin-write
```

- **R2 bucket:** `grudge-assets` · **Region:** `auto` · **Endpoint:** `https://<account-id>.r2.cloudflarestorage.com`
- **Public CDN:** `https://assets.grudge-studio.com/<key>` (Cloudflare Worker fronting the bucket)
- **Asset-service HTTP routes:** `https://assets-api.grudge-studio.com/api/objectstore/{list, search, upload-url, manifest, asset/<key>}`

See [`docs/object-storage.md`](docs/object-storage.md) for ACL rules and the manifest schema, and [`REVIEW.md`](REVIEW.md) for current production-wiring audit notes (canonical hosts vs. dev-tool defaults, dependency review, hygiene findings).

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
- ⬇ **Direct .exe (v0.3.2)** — <https://github.com/Grudge-Warlords/grudge-dev-tool/releases/download/v0.3.2/Grudge.Dev.Tool-Setup-0.3.2.exe>
- 📦 Releases — <https://github.com/Grudge-Warlords/grudge-dev-tool/releases>
- 📝 Audit notes — [`REVIEW.md`](REVIEW.md)
- 🔧 Troubleshooting — [`docs/troubleshooting.md`](docs/troubleshooting.md)
- 🛠 Issue tracker — <https://github.com/Grudge-Warlords/grudge-dev-tool/issues>
- 🌐 Game-api — [api.grudge-studio.com](https://api.grudge-studio.com) · Asset-service — [assets-api.grudge-studio.com](https://assets-api.grudge-studio.com) · Identity — [id.grudge-studio.com](https://id.grudge-studio.com) · Public CDN — [assets.grudge-studio.com](https://assets.grudge-studio.com) · Studio — [grudge-studio.com](https://grudge-studio.com) · Game frontend — [grudgewarlords.com](https://grudgewarlords.com)
- 🔗 Canonical backend — [Grudge-Warlords/grudge-studio-backend](https://github.com/Grudge-Warlords/grudge-studio-backend) (MySQL 8 + Redis 7 + Cloudflare Tunnel)
