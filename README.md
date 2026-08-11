# Grudge Dev Tool

**Best-in-class Grudge Studio admin shell** — elite asset viewer/opener, ObjectStore/R2 browser, Forge embed, Preview playtests, Skeleton Studio, Agent AI, and **single-login SSO** across all tabs against ONE TRUTH (Railway · CDN · ObjectStore · fleet hosts).

| Surface | Role |
|---------|------|
| **Home** | Fleet health · admin systems · primary actions |
| **Local Files** | Disk browser · kind chips · double-click → elite viewer (3D / image / **audio** / **video** / PSD / BLEND) |
| **Assets** | R2 / ObjectStore · `>query` · pop-out viewer · send → Forge |
| **Skeleton** | Mixamo-25 → T-pose → retarget → convert → CDN |
| **Forge** | Production `forge.grudge-studio.com` embed (R3F + Rapier) + session handoff |
| **Preview** | Open · client · water · GRUDOX · **Multiverse** playtests |
| **Games** | Fleet catalog launcher |
| **Agent AI** | Make & deploy · Ollama / Legion / Workers AI |
| **Settings** | ONE TRUTH · single-login matrix · R2/CF · toolchain · defaults |

[![Release](https://img.shields.io/github/v/release/Grudge-Warlords/grudge-dev-tool?display_name=tag&sort=semver)](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest)
[![Pages](https://img.shields.io/github/actions/workflow/status/Grudge-Warlords/grudge-dev-tool/pages.yml?label=docs)](https://grudge-warlords.github.io/grudge-dev-tool/)
[![Build](https://img.shields.io/github/actions/workflow/status/Grudge-Warlords/grudge-dev-tool/release.yml?label=release)](https://github.com/Grudge-Warlords/grudge-dev-tool/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-internal-lightgrey.svg)](#license)
[![Electron](https://img.shields.io/badge/electron-41.x-47848f.svg)](https://www.electronjs.org/)
[![Node](https://img.shields.io/badge/node-22.x-339933.svg?logo=nodedotjs)](https://nodejs.org/)

| Package | Version | What it is |
|---------|---------|------------|
| **Desktop app** | **v1.0.7** | Windows tray · simple video · AI asset cards · stream audio/video · media SSOT · convert-to-GLB · auto-update |
| **`grudge-dev` CLI** | v0.5.0 | `setup` · `doctor` · `login` · `upload-pack` — [`cli/`](cli/) |

📚 **Docs:** <https://grudge-warlords.github.io/grudge-dev-tool/>  
· [Systems & APIs](docs/systems-api.md) · [ONE TRUTH](docs/one-truth.md) · [Databases · backups](docs/database-backups-sharing.md) · [AI · Workers](docs/ai-workers-d1-r2-stream.md) · [Admin architecture](docs/admin-architecture.md)

⬇ **Installer (latest):** [GitHub Releases](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest) · Windows x64 · NSIS · **electron-updater**

---

## What's new in 1.0.7

- **Simple video viewer** — double-click MP4/WebM/MOV → elite player (stream, native-controls fallback, Space/F/M, volume)  
- **AI asset cards** — **AI card** / **AI+** copies markdown for agents (kind, open hints, GLB inspect, image vision when signed in)  
- Builds on **1.0.6**: media SSOT, stream audio, Local Files kind chips  

Earlier: **1.0.5** textures/Draco; **1.0.x** SSO, PSD/BLEND, Multiverse, Meshopt.

---

## ONE TRUTH connection

All browser, CLI, and desktop traffic should go through the fleet client:

```text
https://client.grudge-studio.com
  ├── /api/auth/*          → id.grudge-studio.com
  ├── /api/characters|…    → Railway game-data
  ├── /api/objectstore/*   → ObjectStore / info catalogs
  └── assets CDN           → assets.grudge-studio.com
```

**Never** use `api.grudge-studio.com` or `auth.grudge-studio.com` for new work.

### Desktop first-run

1. Install the `.exe` from [Releases](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest) (or auto-update).  
2. **Sign in once** (Puter) — that session powers all tabs and embeds.  
3. **Settings → Apply ONE TRUTH** — writes `client.grudge-studio.com` + host matrix into keytar.  
4. Admin allowlist (`grudachain` / `molochdadev`) → GRUDACHAIN Ollama agentic stack.  
5. Optional: `npm run secret:import path\to\secrets.txt` for R2 / CF AI / Legion keys.  
6. **Settings → Set as default for all asset types** — Explorer opens elite viewer (not Forge).

### CLI

```powershell
cd cli && npm install && npm run build && npm install -g .
grudge-dev setup
grudge-dev doctor          # ONE TRUTH score via client.grudge-studio.com
```

---

## Media & elite open (game packs)

| Action | Result |
|--------|--------|
| **Local Files → double-click** file | Always-on-top **Elite Viewer** (not Forge) |
| Audio / video | Streamed via `grudge-media://` (no full-file RAM blob); simple VideoViewer chrome |
| Kind chips | Filter Audio · Video · 3D · Image while browsing packs |
| Explorer **Open with** / double-click | Same elite path after **Settings → Set as default for all asset types** |
| **AI card** | Clipboard markdown: kind, open hints, model stats / vision — for Legion/Ollama agents |
| ObjectStore / Assets tab | Preview CDN assets; send **3D** to Forge only when you choose |

SSOT: `src/shared/mediaTypes.ts` · open: `openFileBridge` · stream: `mediaProtocol` · AI: `assetUnderstand` (`asset:understand`).

Settings **Apply ONE TRUTH** remains the single host matrix (client.grudge-studio.com) — do not fork alternate API bases for new work.

---

## Install

### From release (recommended)

1. Download **Grudge Dev Tool Setup** from [latest release](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest).  
2. Run the NSIS installer.  
3. App auto-updates from GitHub Releases when a newer tag is published.

### From source (dev)

```powershell
git clone https://github.com/Grudge-Warlords/grudge-dev-tool.git
cd grudge-dev-tool
git pull origin main
npm install --legacy-peer-deps
npm run build:icons
npm run dev
```

Requires **Node 22+**.

### Local package (NSIS)

```powershell
npm run package:ci
# → release/Grudge Dev Tool-Setup-<version>.exe
# → release/latest.yml  (electron-updater)
```

---

## Features

| Surface | What it does |
|---------|----------------|
| **Tray** | Left-click loader · double-click main · right-click menu |
| **Elite viewer** | Always-on-top 3D / image / video / audio (stream) / PDF / **PSD** / **BLEND** |
| **Forge embed** | Live `forge.grudge-studio.com` + desktop session handoff |
| **Preview** | open · client · water · GRUDOX · Multiverse |
| **Agent AI** | Make & deploy · Ollama · Legion · CF Workers AI |
| **Upload** | Convert → verify → R2 → D1/ObjectStore seed |
| **Connectivity** | ONE TRUTH probes on Home / Settings |
| **Auto-update** | `electron-updater` checks GitHub Releases |

### GRUDACHAIN Ollama

| Trigger | Behavior |
|---------|----------|
| App open | Ensure Docker **`GRUDACHAIN`** or native Ollama on `:11434` |
| Admin sign-in | Agentic ensure + default model pull |
| Settings | Manual ensure / host / preference |

---

## Admin allowlist

Canonical admins (auto agentic Ollama on sign-in):

- Usernames: `grudachain`, `molochdadev`  
- Emails: `grudgedev@gmail.com`, `jonbemmons@gmail.com`

---

## License

UNLICENSED — Grudge Studio internal.
