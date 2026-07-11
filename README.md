# Grudge Studio

[![Release](https://img.shields.io/github/v/release/Grudge-Warlords/grudge-dev-tool?display_name=tag&sort=semver)](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest)
[![Pages](https://img.shields.io/github/actions/workflow/status/Grudge-Warlords/grudge-dev-tool/pages.yml?label=docs)](https://grudge-warlords.github.io/grudge-dev-tool/)
[![Build](https://img.shields.io/github/actions/workflow/status/Grudge-Warlords/grudge-dev-tool/release.yml?label=build)](https://github.com/Grudge-Warlords/grudge-dev-tool/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-internal-lightgrey.svg)](#license)
[![Electron](https://img.shields.io/badge/electron-41.x-47848f.svg)](https://www.electronjs.org/)
[![Three.js](https://img.shields.io/badge/three.js-r169-049ef4.svg)](https://threejs.org/)
[![Node](https://img.shields.io/badge/node-22.x-339933.svg?logo=nodedotjs)](https://nodejs.org/)

**Grudge Studio** — the canonical desktop app for the **ONE TRUTH** fleet: information, assets, **Forge**, and **Coder** in one shell. API base: `client.grudge-studio.com`.

| Package | Version | What it is |
|---------|---------|------------|
| **Grudge Studio** | v0.7.0 | Windows tray app: Home hub, assets, Forge (full + Quick 3D), Coder (prod + local), Engine, Legion |
| **`grudge-dev` CLI** | v0.5.x | Autonomous setup, `doctor`, `login`, `upload-pack`, `fleet`, `search` — [`cli/`](cli/) |

📚 **Docs:** <https://grudge-warlords.github.io/grudge-dev-tool/> · [Studio charter](docs/grudge-studio.md) · [CLI](docs/cli-quickstart.md) · [ONE TRUTH](docs/one-truth.md)

⬇ **Installer:** [latest release](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest) · Windows x64 · NSIS · auto-updating · product name **Grudge Studio**

---

## ONE TRUTH connection (recommended)

All browser, CLI, and Forge traffic should go through the fleet client:

```
https://client.grudge-studio.com
  ├── /api/fleet/manifest
  ├── /api/auth/verify
  ├── /api/objectstore/v1/*.json
  ├── /api/objectstore/{list,search,upload-url,manifest,asset/*}
  └── /api/assets/icons/...
```

Vercel rewrites proxy to Railway (game data), identity, objectstore, and the assets CDN. **Do not** point uploads at `api.grudge-studio.com` or `assets-api.grudge-studio.com` unless you are on a legacy split-host install.

**CLI**

```powershell
cd cli && npm install && npm run build && npm install -g .
grudge-dev setup
grudge-dev doctor          # expect 100% when fleet is wired
grudge-dev login --admin-password <pw>
```

**Grudge Studio**

1. Install the `.exe` (or auto-update from prior “Forge” tray builds).
2. **Settings → Grudge identity → ONE TRUTH** (sets `client.grudge-studio.com`, clears legacy overrides).
3. Sign in or paste a bearer token from `id.grudge-studio.com`.
4. **Home** and the status bar show **ONE TRUTH** score (same probes as `grudge-dev doctor`).
5. Open **Forge** (Full or Quick 3D) and **Coder** (Production or Local) from Create.

Legacy split-host override remains under **Settings → Legacy split-host override**.

---

## Grudge Studio — features

Canonical hub for the Grudge team: fleet truth, object storage, Forge, and Coder without leaving the app. Registers as a Windows 3D viewer for `.glb` / `.gltf` / `.fbx` / `.obj` / `.stl` / `.ply` / `.dae` / `.3mf`.

| Surface | What it does |
|---|---|
| **Tray icon** | Gold-helm emblem. Left-click → GrudgeLoader. Double-click → main window. Right-click → menu. |
| **Home** | ONE TRUTH meter, host map, launchers for Forge / Coder / Assets / Engine / Games. |
| **Assets** | Browser · Search · Upload · Store · BlenderKit · mandatory ingestion pipeline. |
| **Forge** | **Full** embeds `forge.grudge-studio.com/editor`; **Quick 3D** is the in-process Three.js viewer (file open / pop-out). |
| **Coder** | **Production** embeds `coder.grudge-studio.com`; **Local** spawns GrudachainCode + HF injection. |
| **Engine / Games / Legion** | Characters, VFX, fleet launcher, agentic RAG (`Ctrl+/`). |
| **Connectivity** | 30s ONE TRUTH probes; status bar `ONE TRUTH N%`. |
| **Auto-update** | `electron-updater` → GitHub releases every 4h. |

---

## Install

### CLI (from source)

```powershell
git clone https://github.com/Grudge-Warlords/grudge-dev-tool.git
cd grudge-dev-tool/cli
npm install && npm run build
npm install -g .
grudge-dev --version
```

### Grudge Studio (from release)

Download the latest `.exe` from [Releases](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest) and run it.

### Grudge Studio (from source)

```powershell
git clone https://github.com/Grudge-Warlords/grudge-dev-tool.git
cd grudge-dev-tool
npm install --legacy-peer-deps
npm run build:icons
npm run dev
```

Requires **Node 22+** (see `.nvmrc`).

### First-run (Forge)

1. Tray icon → sign in with Puter (or paste bearer token in Settings).
2. **Settings → ONE TRUTH** — fleet client URL.
3. Optional: **Cloudflare R2 + AI Gateway** card — `npm run secret:import path\to\secrets.txt` for direct R2/Worker creds (skips fleet HTTP when `auto` mode picks R2).
4. Optional: BlenderKit API key for Asset Library + enrichment.
5. Confirm **Toolchain** shows green for `sharp`, `gltf-transform`, and (for conversions) Blender.

---

## Stack

| Layer | Tech |
|-------|------|
| **Forge main** | Electron 41 · Node 22 · TypeScript (CommonJS via `tsc`) |
| **Forge renderer** | Vite 8 · React 18 · Tailwind 3.4 · TanStack Query 5 |
| **3D** | Three.js r169 · `@gltf-transform/*` · `fflate` |
| **Storage** | AWS SDK v3 S3 (R2) · fleet client HTTP (`/api/objectstore/*`) · optional Worker |
| **Secrets** | keytar (Credential Vault) · Electron `safeStorage` fallback |
| **CLI** | Commander · TypeScript ESM · optional keytar/sharp |

---

## Project layout

```
grudge-dev-tool/
  cli/                           # grudge-dev v0.5.0 — ONE TRUTH doctor, upload-pack
  src/
    main/
      api.ts                     # Fleet client + objectstore HTTP (ONE TRUTH default)
      connectivity.ts            # ONE TRUTH probe tick (same six checks as doctor)
      cf/                        # R2 direct, Worker, AI Gateway
      ingestion/                 # Upload pipeline
    renderer/                    # React UI (main + GrudgeLoader)
    shared/
      fleet.ts                   # Truth probe manifest (aligned with grudge-builder)
      ipc.ts                     # IPC contracts
  docs/                          # GitHub Pages (Jekyll)
  scripts/                       # Icons, secrets import, publish-manual
  electron-builder.yml           # NSIS + GitHub publish
```

---

## Scripts (Forge root)

```powershell
npm run dev              # Vite + Electron hot reload
npm run build            # Production build
npm run package          # NSIS installer
npm run typecheck        # tsc --noEmit (main + renderer)
npm run upload-pack -- --root <dir> --pack-id <id> --version <ver> --dry-run
npm run secret:import -- path\to\secrets.txt
npm run publish:manual   # Bump, build, tag, push release
```

---

## Object storage (canonical)

```
asset-packs/<pack-id>/v<version>/<category>/<file>
asset-packs/<pack-id>/manifest.json
user-uploads/<grudgeId>/...
```

- **Public CDN:** `https://assets.grudge-studio.com/<key>`
- **Fleet client routes:** `https://client.grudge-studio.com/api/objectstore/{list,search,upload-url,manifest,asset/<key>}`

See [`docs/object-storage.md`](docs/object-storage.md) and [`docs/api-reference.md`](docs/api-reference.md).

---

## Fleet hosts

| Role | Host |
|------|------|
| **Fleet client (ONE TRUTH)** | [client.grudge-studio.com](https://client.grudge-studio.com) |
| **Identity** | [id.grudge-studio.com](https://id.grudge-studio.com) |
| **Public CDN** | [assets.grudge-studio.com](https://assets.grudge-studio.com) |
| **JSON objectstore** | [objectstore.grudge-studio.com](https://objectstore.grudge-studio.com) |
| **Game frontend** | [grudgewarlords.com](https://grudgewarlords.com) |

Deprecated for dev-tool defaults: `api.grudge-studio.com`, `assets-api.grudge-studio.com`, `molochdagod.github.io/ObjectStore`.

---

## Releases

```powershell
npm run publish:manual           # patch bump + NSIS + GitHub release
npm run publish:manual:minor
node scripts/publish-manual.mjs --version 0.5.0 --notes "ONE TRUTH refresh."
```

Tag-driven CI: push `vX.Y.Z` → `.github/workflows/release.yml` builds and publishes.

---

## Contributing

Internal Grudge Studio software. Before a PR:

```powershell
npm run typecheck
npm run package
```

Conventional Commits: `feat:`, `fix:`, `chore:`, `release:`.

---

## License

UNLICENSED — internal use within Grudge Studio. BlenderKit (GPL) is invoked out-of-process and never bundled.

---

## Links

- 📚 Docs — <https://grudge-warlords.github.io/grudge-dev-tool/>
- 📦 Releases — <https://github.com/Grudge-Warlords/grudge-dev-tool/releases>
- 🔧 Troubleshooting — [`docs/troubleshooting.md`](docs/troubleshooting.md)
- ⚙ Production config — [`docs/production-config.md`](docs/production-config.md)
- 🛠 Issues — <https://github.com/Grudge-Warlords/grudge-dev-tool/issues>