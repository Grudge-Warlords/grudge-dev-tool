# Grudge Dev Tool

**Best-in-class Grudge Studio asset viewer, opener, and editor** — ObjectStore/R2 browser, always-on-top 3D Asset Viewer, Forge scene edit, Skeleton Studio, and **Agent AI Make & Deploy** against ONE TRUTH (Railway DB · CDN · ObjectStore · Warlords).

| Surface | Role |
|---------|------|
| **Studio Hub** | Fleet health probes + launch pad |
| **Assets (Browser)** | R2 tree · click → inline + pop-out viewer · send to Forge |
| **Forge 3D** | Scene editor · paint · deploy |
| **Agent AI** | Make & deploy presets · orchestrator · terminal · pods |
| **GRUDACHAIN Ollama** | Local agentic AI container — auto-starts on open & admin sign-in |
| **Upload** | Convert / optimize / push packs |

[![Release](https://img.shields.io/github/v/release/Grudge-Warlords/grudge-dev-tool?display_name=tag&sort=semver)](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest)
[![Pages](https://img.shields.io/github/actions/workflow/status/Grudge-Warlords/grudge-dev-tool/pages.yml?label=docs)](https://grudge-warlords.github.io/grudge-dev-tool/)
[![Build](https://img.shields.io/github/actions/workflow/status/Grudge-Warlords/grudge-dev-tool/release.yml?label=build)](https://github.com/Grudge-Warlords/grudge-dev-tool/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-internal-lightgrey.svg)](#license)
[![Electron](https://img.shields.io/badge/electron-41.x-47848f.svg)](https://www.electronjs.org/)
[![Three.js](https://img.shields.io/badge/three.js-r169-049ef4.svg)](https://threejs.org/)
[![Node](https://img.shields.io/badge/node-22.x-339933.svg?logo=nodedotjs)](https://nodejs.org/)

Grudge Studio developer tooling for the **ONE TRUTH** fleet — one URL (`client.grudge-studio.com`) for manifest, auth, objectstore JSON, uploads, and health probes.

| Package | Version | What it is |
|---------|---------|------------|
| **`grudge-dev` CLI** | v0.5.0 | Autonomous setup, `doctor`, `login`, `upload-pack`, `fleet`, `search` — lives in [`cli/`](cli/) |
| **Forge tray app** | **v0.9.1** | Windows tray + Studio Hub, Asset Viewer, Forge 3D, Agent AI, **GRUDACHAIN Ollama auto-start**, auto-update |

📚 **Docs:** <https://grudge-warlords.github.io/grudge-dev-tool/> · [CLI quickstart](docs/cli-quickstart.md) · [ONE TRUTH](docs/one-truth.md) · [Tray quickstart](docs/dev-tool-quickstart.md)

⬇ **Forge installer (latest):** [`Grudge Studio Forge-Setup-0.9.1.exe`](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/download/v0.9.1/Grudge.Studio.Forge-Setup-0.9.1.exe) · Windows x64 · NSIS · auto-updating

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

**Forge tray**

1. Install the `.exe` (or wait for auto-update).
2. **Settings → Grudge identity → ONE TRUTH** (sets `client.grudge-studio.com`, clears legacy overrides).
3. Sign in as **`grudachain`** (or another allowlisted admin) — GRUDACHAIN Ollama agentic stack starts automatically.
4. Status bar shows **ONE TRUTH N%** and **OLLAMA · AGENTIC** when the local container is ready.

Legacy split-host override remains under **Settings → Legacy split-host override** for installs that still route objectstore to a separate host.

---

## GRUDACHAIN Ollama (agentic local AI)

Forge auto-plugs the **Grudgechain Ollama** runtime so Agent AI / chat / make-deploy work offline-first for admins.

| Trigger | Behavior |
|---------|----------|
| **App open** | `ensureRunning` — start Docker container **`GRUDACHAIN`** (`ollama/ollama`) with host port **11434**, or native `ollama serve` fallback |
| **Sign-in as `grudachain` / `molochdadev` / admin emails** | Full **agentic** ensure: prefer Ollama, pull default model if empty, status bar → **OLLAMA · AGENTIC** |
| **Settings → Start GRUDACHAIN + Agentic** | Manual ensure (same path) |

Requirements (one of):

- **Docker Desktop** running (preferred) — creates/recreates `GRUDACHAIN` with `-p 11434:11434` and volume `grudachain-ollama`
- **Native Ollama** at `%LOCALAPPDATA%\Programs\Ollama\ollama.exe`

Env overrides: `OLLAMA_HOST`, `OLLAMA_PORT`, `GRUDACHAIN_OLLAMA_CONTAINER`, `OLLAMA_DEFAULT_MODEL`.

```powershell
# Inspect the agentic container
docker ps -a --filter name=GRUDACHAIN
# API smoke
curl http://localhost:11434/api/version
```

---

## Forge tray — features

Windows tray app for the Grudge Studio team: browse object storage, search the asset catalog, mass-upload through a mandatory ingestion pipeline, generate Grudge UUIDs, pull from BlenderKit, and **author / preview / convert / upload 3D models** with the built-in **Forge 3D** editor. Also registers as a Windows default 3D viewer for `.glb` / `.gltf` / `.fbx` / `.obj` / `.stl` / `.ply` / `.dae` / `.3mf`.

| Surface | What it does |
|---|---|
| **Tray icon** | Gold-helm emblem. Left-click → GrudgeLoader. Double-click → main window. Right-click → menu. |
| **Main window** | Studio Hub · Browser · Search · Upload · Forge 3D · Agent AI · Coder · Settings — status bar shows ONE TRUTH score, admin pill, Ollama agentic, logs, update progress. |
| **Forge 3D** | Three.js editor/viewer with PBR, IBL, TransformControls, animation clips, `Convert → GLB → Upload to R2`. |
| **Agent AI** | Make & deploy presets against ONE TRUTH (CDN packs, heroes, fleet doctor, seed NPCs). |
| **GrudgeLoader** | Always-on-top overlay: pinned folders, prefix browse, drag-drop bulk upload. |
| **Ingestion** | Mandatory pipeline: `size-verify → convert → enrich → rig → hash → UUID → upload → manifest`. |
| **Object storage backends** | **R2 direct** → **Cloudflare Worker** → **fleet client** (`grudge` mode, ONE TRUTH default). |
| **Connectivity** | Every 30s: six ONE TRUTH probes; status bar shows `ONE TRUTH N%`. |
| **Auto-update** | `electron-updater` checks GitHub releases every 4h. |

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

### Forge tray (from release)

Download the latest `.exe` from [Releases](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest) and run it.

### Forge tray (from source)

```powershell
git clone https://github.com/Grudge-Warlords/grudge-dev-tool.git
cd grudge-dev-tool
npm install --legacy-peer-deps
npm run build:icons
npm run dev
```

Requires **Node 22+** (see `.nvmrc`).

### First-run (Forge)

1. Tray icon → sign in with Puter as **`grudachain`** (admin) — Ollama GRUDACHAIN container starts automatically.
2. **Settings → ONE TRUTH** — fleet client URL.
3. **Settings → Ollama** — confirm **Backend = docker-grudachain** and **Agentic = ready**.
4. Optional: Cloudflare R2 + AI Gateway via `npm run secret:import path\to\secrets.txt`.
5. Confirm **Toolchain** shows green for `sharp`, `gltf-transform`, and (for conversions) Blender.

### Local package (production NSIS)

```powershell
npm run package:ci
# → release/Grudge Studio Forge-Setup-0.9.1.exe
# → release/win-unpacked/Grudge Studio Forge.exe
```

---

## Admin allowlist

Canonical admins (auto agentic Ollama on sign-in):

- Usernames: `grudachain`, `molochdadev`
- Emails: `grudgedev@gmail.com`, `jonbemmons@gmail.com`

---

## License

UNLICENSED — Grudge Studio internal.
