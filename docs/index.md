---
layout: default
title: Home
nav_order: 1
description: Grudge Studio developer tooling — ONE TRUTH CLI + Windows Forge tray (production v0.6).
permalink: /
---
# Grudge Dev Tool

{: .fs-9 }
Grudge Studio developer tooling — **ONE TRUTH** fleet wiring, asset-pack uploads, AI workers, Ollama, and the Windows **Forge** tray app.
{: .fs-5 .fw-300 }

[Production deployment map →](production-deployment.md){: .btn .btn-primary .fs-5 .mb-2 .mr-2 }
[ONE TRUTH wiring →](one-truth.md){: .btn .fs-5 .mb-2 .mr-2 }
[Production config / secrets →](production-config.md){: .btn .fs-5 .mb-2 }

## CLI — v0.6 (recommended)

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

## Download — Grudge Studio Forge tray app

[⬇ Latest installer (GitHub Releases)](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest){: .btn .btn-primary .fs-5 .mb-2 .mr-2 }
[All releases](https://github.com/Grudge-Warlords/grudge-dev-tool/releases){: .btn .fs-5 .mb-2 .mr-2 }
[View source on GitHub](https://github.com/Grudge-Warlords/grudge-dev-tool){: .btn .fs-5 .mb-2 }
Windows x64 · NSIS installer · electron-updater · Three.js + glTF-Transform + Puter baked in.
{: .fs-3 .text-grey-dk-100 }

### Simple connection (ONE TRUTH)

One fleet client powers auth, game-data, and objectstore:

1. Install from **Releases** (or auto-update).
2. **Settings → Grudge identity → Fleet client URL** → **ONE TRUTH** (`https://client.grudge-studio.com`).
3. Sign in via Puter or paste a bearer token from `id.grudge-studio.com`.
4. Optional: import R2/AI secrets with `npm run secret:import`.
5. Optional autonomous AI: run [Ollama](https://ollama.com) locally; Settings → AI preference `auto` or `ollama`.
6. Fleet health / doctor score should be high (Ollama may show unknown when not installed).

**Do not** point Settings at `api.grudge-studio.com` (deprecated).
{: .fs-3 .text-grey-dk-100 }

---

## What it does

### CLI (v0.5.0)

- **`grudge-dev setup`** — auto-detect API base (`client.grudge-studio.com` → localhost) and `grudge-builder` repo; writes `~/.grudge-dev/config.json`.
- **`grudge-dev doctor`** — ONE TRUTH probes (JSON endpoints, no HTML leaks).
- **`grudge-dev login`** — store JWT or admin password (keytar or `~/.grudge-dev/auth.json`).
- **`grudge-dev upload-pack`** — walk pack → hash → UUID → presigned PUT → manifest.
- **`grudge-dev fleet` / `search`** — live manifest + catalog search.

### Forge tray app (v0.5.1)

- **ONE TRUTH connectivity** — fleet manifest, auth, objectstore JSON, icons, Supabase health (Settings diagnostics + status bar score).
- **Tray icon** + **GrudgeLoader** always-on-top overlay.
- **Browser / Search / Upload** for team object storage via single fleet client URL.
- **Forge 3D** editor, BlenderKit, ingestion pipeline, auto-update.

## Documentation

- [CLI quickstart](cli-quickstart.md)
- [ONE TRUTH fleet wiring](one-truth.md)
- [Tray app quickstart](dev-tool-quickstart.md)
- [Object storage layout & ACL](object-storage.md)
- [Grudge UUID system](grudge-uuid.md)
- [API reference (`/api/objectstore/*`)](api-reference.md)
- [Troubleshooting](troubleshooting.md)

## Project status

| Component | Version | Notes |
|-----------|---------|-------|
| **CLI** | v0.5.0 | Autonomous setup, `doctor`, `upload-pack` — `cli/` in this repo |
| **Forge tray** | v0.5.1 | Puter sign-in fix, GrudgeLoader, ONE TRUTH fleet client |

Canonical API for browser + CLI + Forge: **`https://client.grudge-studio.com`** (Vercel rewrites → Railway + objectstore + assets CDN).

<!-- Pages deploy: 2026-06-25 v0.5.0 Forge ONE TRUTH -->