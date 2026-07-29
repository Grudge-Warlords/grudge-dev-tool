---
layout: default
title: Quickstart
nav_order: 4
---
# Grudge Dev Tool — Quickstart

## 1. Install

Download the latest **`Grudge Studio Forge-Setup-*.exe`** from [Releases](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest) (current line: **v0.9.4**) and run it. It installs under `%LOCALAPPDATA%\Programs\` by default and adds:

- A Start-menu shortcut **Grudge Studio Forge**
- An optional desktop shortcut
- An entry in the system tray

## 2. First launch

The window may start hidden — only the tray icon appears. Left-click the icon to open the window; right-click for the context menu.

On open, Forge **auto-ensures** the **GRUDACHAIN** Ollama container (Docker) or native `ollama serve` so local agentic AI is available.

## 3. Sign in as admin (grudachain)

1. Sign in with Puter as **`grudachain`** (or another allowlisted admin).
2. Admin sign-in runs a full **agentic** ensure: prefer Ollama, pull a default model if the container has none.
3. Status bar shows gold **ADMIN** + **OLLAMA · AGENTIC** when ready.

Canonical admins: `grudachain`, `molochdadev` (plus allowlisted emails baked into the build).

## 4. Settings

Open **Settings** in the sidebar:

1. Set **Fleet client URL** to **`https://client.grudge-studio.com`** (ONE TRUTH). Prefer the **ONE TRUTH** button over legacy hosts.
2. Confirm **Ollama / GRUDACHAIN** — Status online, Backend `docker-grudachain` or `native`. Use **Start GRUDACHAIN + Agentic** if offline.
3. Optional: paste a **BlenderKit API key** for the Asset Library and `enrich` stage.
4. Check the **Toolchain** table (`sharp`, `gltf-transform`, Blender, ffmpeg).

### GRUDACHAIN Ollama (local agentic AI)

| Item | Value |
|------|--------|
| Container | `GRUDACHAIN` |
| Image | `ollama/ollama:latest` |
| Host port | `11434` |
| Volume | `grudachain-ollama` |
| API | `http://localhost:11434` |

Requires **Docker Desktop** (preferred) or native Ollama at `%LOCALAPPDATA%\Programs\Ollama\ollama.exe`.

```powershell
docker ps --filter name=GRUDACHAIN
curl http://127.0.0.1:11434/api/version
```

## 5. Studio Hub & Agent AI

- **Studio Hub** — fleet health probes and launch pad.
- **Agent AI** — make/deploy presets (CDN packs, heroes, fleet doctor, seed NPCs). Uses Ollama when agentic is ready, with cloud fallbacks.

## 6. Browse

Open **Browser**. Type a prefix (e.g. `asset-packs/classic64/`) and click *List*. Click assets for the always-on-top **Asset Viewer**.

## 7. Search

Open **Search**. Free-text query + optional `category` and `pack` filter.

## 8. Upload

Open **Upload**. Drag files in. Set the target prefix, click *Start upload*. Each file passes through the ingestion pipeline before the PUT.

## 9. Forge 3D & Skeleton

- **Forge 3D** — scene editor, paint tools, convert → GLB → R2.
- **Skeleton Studio** — Mixamo-style bone placement, FBX extract, T-pose prep.

## 10. Request URL / UUID

- **Request URL** — signed GET + public CDN URL.
- **UUID** — generate or parse Grudge UUIDs locally (no network).

## 11. Preview (admin-only)

Open **Preview** to load any HTTP/HTTPS URL or local `.html` file inside a sandboxed Electron `<webview>`. Guest WebContents: `nodeIntegration=false`, `contextIsolation=true`, `sandbox=true`.

## 12. Admin gating

Admin-only surfaces (**Upload · Request URL · Forge 3D · Coder · Games · Preview · Settings · Agent AI**) are hidden for non-admin sessions. Gold **ADMIN** pill appears in the sidebar and status bar.

For dev support: `localStorage["grudge:admin-override"] = "1"` in DevTools (dev builds only). Backend still enforces real permissions.

## Quitting

The window's red-X only hides it. Use the tray menu → **Quit** to fully exit (native Ollama child stops; Docker **GRUDACHAIN** is left running as a shared service).
