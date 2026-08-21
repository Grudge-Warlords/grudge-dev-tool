# Grudge Dev Tool

**Best-in-class Grudge Studio admin shell** — Elite Three.js studio (local preview), ObjectStore/R2 browser, Forge embed, Preview playtests, Skeleton Studio, Agent AI, and **single-login SSO (Grudge ID)** across all tabs against ONE TRUTH (Railway · CDN · ObjectStore · [puter-space](https://ai.grudge-studio.com/puter-space) · fleet hosts).

| Surface | Role |
|---------|------|
| **Home** | Fleet health · admin systems · primary actions |
| **Local Files** | Disk browser · kind chips · 3D double-click → **Grudge Three Pipeline** · media → Elite |
| **Assets** | R2 / ObjectStore · `>query` · pop-out Elite · explicit Open in ThreeFlow / Forge |
| **Skeleton** | Mixamo-25 → T-pose → retarget → convert → CDN |
| **Forge** | Production `forge.grudge-studio.com` embed (R3F + Rapier deploy) |
| **Preview** | Open · client · water · GRUDOX · **Multiverse** playtests (webview) |
| **Play** | Native Three.js — Toon kit, WASD, one mixer, video, scripts |
| **Games** | Fleet catalog launcher |
| **Agent AI** | Make & deploy · Ollama / Legion / Workers AI |
| **Settings** | ONE TRUTH · Grudge ID matrix · R2/CF · toolchain · defaults |

[![Release](https://img.shields.io/github/v/release/Grudge-Warlords/grudge-dev-tool?display_name=tag&sort=semver)](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest)
[![Pages](https://img.shields.io/github/actions/workflow/status/Grudge-Warlords/grudge-dev-tool/pages.yml?label=docs)](https://grudge-warlords.github.io/grudge-dev-tool/)
[![Build](https://img.shields.io/github/actions/workflow/status/Grudge-Warlords/grudge-dev-tool/release.yml?label=release)](https://github.com/Grudge-Warlords/grudge-dev-tool/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-internal-lightgrey.svg)](#license)
[![Electron](https://img.shields.io/badge/electron-41.x-47848f.svg)](https://www.electronjs.org/)
[![Node](https://img.shields.io/badge/node-22.x-339933.svg?logo=nodedotjs)](https://nodejs.org/)

| Package | Version | What it is |
|---------|---------|------------|
| **Desktop app** | **v1.1.0** | Windows tray · 3D double-click → Grudge Three Pipeline · Elite media · Forge live · auto-update |
| **`grudge-dev` CLI** | v0.5.0 | `setup` · `doctor` · `login` · `upload-pack` — [`cli/`](cli/) |

📚 **Docs:** <https://grudge-warlords.github.io/grudge-dev-tool/>  
· [Systems & APIs](docs/systems-api.md) · [ONE TRUTH](docs/one-truth.md) · [Databases · backups](docs/database-backups-sharing.md) (`npm run backup:postgres` · `npm run restore:postgres -- --docker`) · [AI · Workers](docs/ai-workers-d1-r2-stream.md) · [Pipeline Review](docs/pipeline-review-ai-worker.md) · [Admin architecture](docs/admin-architecture.md)  
· **Account cloud:** <https://ai.grudge-studio.com/puter-space> (never bag/roster)

⬇ **Installer (latest):** [GitHub Releases](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest) · Windows x64 · NSIS · **electron-updater**

---

## What's new in 1.1.0

1. **Grudge Three Pipeline** — Explorer / Local Files double-click opens **one** SceneEngine window. Extra GLB/FBX/OBJ **append** into the same scene with parent/child hierarchy, clips, and textures. Drop files or Shift+A to add more.  
2. **Send to R2 + D1** — pipeline Actions waits for R2 PUT, then seeds the ObjectStore/D1 index. CDN key `models/pipeline/<file>`.  
3. **SI 2 m measure** — select a mesh, **Shift+Ctrl+LMB drag** a span that should be 2 metres, release. Uniform scale. 1 unit = 1 m.  
ThreeFlow remains **Edit in ThreeFlow** (explicit). Media stays Elite. Never Forge by default.

Docs: <https://grudge-warlords.github.io/grudge-dev-tool/>

### After 1.1.0 (unreleased)

v1.1.0 still left three things manual. They now sit on the **existing** AI worker stack (not a new editor):

| Gap | What we automated |
|-----|-------------------|
| Convert + magic + CDN HEAD | **Send to R2 + D1** converts DCC → GLB, magic-bytes, PUTs, then HEADs `assets.grudge-studio.com` |
| File-defaults / play-kit doctor | Packaged first launch registers HKCU types. Doctor HEADs Toon `human.glb` |
| No pipeline AI worker | **Pipeline Review** — same pattern as Scene Completion. Button in the pipeline window |

Earlier: **1.0.11** ThreeFlow pop-out · **1.0.10** Elite viewport · **1.0.9** editor trio · **1.0.8** r185 loaders.

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

1. Install **Grudge Dev Tool Setup** from [Releases](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest) (or auto-update). Not `Grudge Studio Forge-Setup`.  
2. **Sign in once with Grudge ID** (`id.grudge-studio.com`) — that JWT powers tabs and embeds. Puter is **not** product login.  
3. **Settings → Apply ONE TRUTH** — writes `client.grudge-studio.com` + host matrix into keytar.  
4. Account files / `*.puter.site` → [puter-space](https://ai.grudge-studio.com/puter-space). Railway still owns bag / characters / wallet.  
5. Admin allowlist (`grudachain` / `molochdadev`) → GRUDACHAIN Ollama agentic stack.  
6. Optional: `npm run secret:import path\to\secrets.txt` for R2 / CF AI / Legion keys.  
7. **Settings → Set as default for all asset types** — Explorer: 3D → Grudge Three Pipeline; media → Elite. ThreeFlow is an explicit action. Never Forge by default.

### CLI

```powershell
cd cli && npm install && npm run build && npm install -g .
grudge-dev setup
grudge-dev doctor          # ONE TRUTH score via client.grudge-studio.com
grudge-dev plugin status   # dest-tool must be running (127.0.0.1:17380)
```

---

## Media & elite open (game packs)

| Action | Result |
|--------|--------|
| **Local Files → click** | Inline preview (verts/tris for 3D). **Show in list** jumps the left pane to that file |
| **Local Files → double-click / Pop-out** | **3D / scene → Grudge Three Pipeline** (multi-asset SceneEngine). Images / audio / video / text / PDF → Elite |
| Audio / video | Streamed via `grudge-media://` (no full-file RAM blob) |
| Kind chips | Filter Audio · Video · 3D · Image while browsing packs |
| Explorer **Open with** / double-click | Same split after **Settings → Set as default for all asset types** |
| **System open** | OS default app (Blender / Photoshop / Photos / …) |
| **AI card** | Clipboard markdown: kind, path, Pipeline/ThreeFlow hints, GLB inspect. Vision caption = images only |
| ObjectStore / Assets tab | Preview CDN assets; **Open in ThreeFlow** / **Forge live** are explicit |

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
| **Elite / Pipeline** | Media pop-out + **Grudge Three Pipeline** 3D opener (hierarchy, clips, textures, R2/D1, Edit in ThreeFlow) |
| **Forge embed** | Live `forge.grudge-studio.com` + desktop session handoff |
| **Preview** | open · client · water · GRUDOX · Multiverse (webview) |
| **Play** | Native Three · Toon human.glb · WASD · one mixer |
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
