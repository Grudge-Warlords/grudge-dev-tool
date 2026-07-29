---
layout: default
title: Home
nav_order: 1
description: Grudge Studio developer tooling — ONE TRUTH CLI + Windows Forge tray (production v0.9.4).
permalink: /
---
# Grudge Dev Tool

{: .fs-9 }
Grudge Studio developer tooling — **ONE TRUTH** fleet wiring, asset-pack uploads, **GRUDACHAIN Ollama** agentic AI, and the Windows **Forge** tray app.
{: .fs-5 .fw-300 }

[⬇ Download latest Forge →](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest){: .btn .btn-primary .fs-5 .mb-2 .mr-2 }
[Production deployment map →](production-deployment.md){: .btn .fs-5 .mb-2 .mr-2 }
[ONE TRUTH wiring →](one-truth.md){: .btn .fs-5 .mb-2 }

## Production — Forge tray **v0.9.4**

Windows x64 NSIS · electron-updater · Studio Hub · Asset Viewer · Forge AI (texture / edit / scene completion) · Agent AI · **GRUDACHAIN Ollama auto-start**.

| Surface | Role |
|---------|------|
| **Studio Hub** | Fleet health + games + systems command center |
| **Assets (Browser)** | R2 tree · pop-out viewer · send to Forge |
| **Forge 3D** | Scene editor · weld/patch · AI Texture/Edit · Scene Completion · deploy |
| **Agent AI** | Make & deploy presets · orchestrator |
| **GRUDACHAIN Ollama** | Docker `ollama/ollama` on **:11434** — starts on open + `grudachain` admin sign-in |
| **Upload** | Convert / optimize / push packs |

[⬇ Latest installer (GitHub Releases)](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest){: .btn .btn-primary .fs-5 .mb-2 .mr-2 }
[All releases](https://github.com/Grudge-Warlords/grudge-dev-tool/releases){: .btn .fs-5 .mb-2 .mr-2 }
[View source on GitHub](https://github.com/Grudge-Warlords/grudge-dev-tool){: .btn .fs-5 .mb-2 }

**Tag:** [`v0.9.4`](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v0.9.4) · [Scene Completion AI worker](scene-completion-ai-worker.md)
{: .fs-3 .text-grey-dk-100 }

### First connection (ONE TRUTH + agentic)

1. Install from **Releases** (or wait for auto-update).
2. **Settings → Grudge identity → ONE TRUTH** → `https://client.grudge-studio.com`.
3. Sign in as **`grudachain`** (admin) — GRUDACHAIN Ollama agentic stack starts automatically.
4. Status bar: **ONE TRUTH N%** + **OLLAMA · AGENTIC** when the local container is ready.
5. Optional: import R2/AI secrets with `npm run secret:import`.

**Requirements for agentic AI:** Docker Desktop (preferred) or native [Ollama](https://ollama.com). Container name: **`GRUDACHAIN`**, host port **11434**.
{: .fs-3 .text-grey-dk-100 }

**Do not** point Settings at `api.grudge-studio.com` (deprecated).
{: .fs-3 .text-grey-dk-100 }

---

## CLI — v0.5.0

Autonomous setup for `client.grudge-studio.com` — no tray app required for uploads or health checks.

```powershell
git clone https://github.com/Grudge-Warlords/grudge-dev-tool.git
cd grudge-dev-tool/cli
npm install && npm run build
npm install -g .

grudge-dev setup
grudge-dev doctor
grudge-dev login --admin-password <pw>
grudge-dev upload-pack --root "C:\packs\MyPack" --pack-id my-pack --dry-run
```

[CLI quickstart →](cli-quickstart.md){: .btn .btn-primary .fs-5 .mb-2 .mr-2 }
[ONE TRUTH wiring →](one-truth.md){: .btn .fs-5 .mb-2 .mr-2 }

`doctor` probes fleet manifest, auth verify, objectstore JSON, icons, and Supabase health via Vercel rewrites on **client.grudge-studio.com**. Expect **100%** when the fleet is wired correctly.
{: .fs-3 .text-grey-dk-100 }

---

## What it does

### CLI (v0.5.0)

- **`grudge-dev setup`** — auto-detect API base (`client.grudge-studio.com` → localhost) and `grudge-builder` repo; writes `~/.grudge-dev/config.json`.
- **`grudge-dev doctor`** — ONE TRUTH probes (JSON endpoints, no HTML leaks).
- **`grudge-dev login`** — store JWT or admin password (keytar or `~/.grudge-dev/auth.json`).
- **`grudge-dev upload-pack`** — walk pack → hash → UUID → presigned PUT → manifest.
- **`grudge-dev fleet` / `search`** — live manifest + catalog search.

### Forge tray app (v0.9.1)

- **ONE TRUTH connectivity** — fleet manifest, auth, objectstore JSON, icons (status bar score).
- **GRUDACHAIN Ollama** — auto-start Docker container or native serve; agentic mode on admin sign-in.
- **Studio Hub** + **Agent AI** make/deploy presets.
- **Tray icon** + **GrudgeLoader** always-on-top overlay + Asset Viewer pop-out.
- **Browser / Search / Upload** via single fleet client URL.
- **Forge 3D** editor, Skeleton Studio, BlenderKit, ingestion pipeline, auto-update.

## Documentation

- [Tray app quickstart](dev-tool-quickstart.md)
- [Production deployment](production-deployment.md)
- [CLI quickstart](cli-quickstart.md)
- [ONE TRUTH fleet wiring](one-truth.md)
- [Object storage layout & ACL](object-storage.md)
- [Grudge UUID system](grudge-uuid.md)
- [API reference (`/api/objectstore/*`)](api-reference.md)
- [Troubleshooting](troubleshooting.md)

## Project status

| Component | Version | Notes |
|-----------|---------|-------|
| **CLI** | v0.5.0 | Autonomous setup, `doctor`, `upload-pack` — `cli/` in this repo |
| **Forge tray** | **v0.9.1** | Studio Hub, Agent AI, GRUDACHAIN Ollama auto-start, Asset Viewer |

Canonical API for browser + CLI + Forge: **`https://client.grudge-studio.com`** (Vercel rewrites → Railway + objectstore + assets CDN).

<!-- Pages deploy: 2026-07-25 v0.9.1 GRUDACHAIN Ollama + Studio Hub -->
