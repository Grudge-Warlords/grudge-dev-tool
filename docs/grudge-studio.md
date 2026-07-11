---
layout: default
title: Grudge Studio
nav_order: 2
description: Product charter — one app for truth, assets, Forge, and Coder.
---
# Grudge Studio

**Grudge Studio** is the canonical desktop app for the Grudge fleet: information, assets, Forge, and Coder in one shell.

## What it is

| Role | What Studio provides |
|------|----------------------|
| **Canonical information** | ONE TRUTH probes, fleet manifest, host map, UUID, docs, `grudge-dev doctor` |
| **Canonical assets** | Objectstore browse/search, ingestion upload, BlenderKit, CDN URLs (`assets.grudge-studio.com`) |
| **Forge** | Full scene editor (`forge.grudge-studio.com`) embedded + Quick 3D for local models |
| **Coder** | Production IDE (`coder.grudge-studio.com`) embedded + optional local GrudachainCode |

## ONE TRUTH hosts

| Role | Host |
|------|------|
| Fleet client (API base) | `https://client.grudge-studio.com` |
| Auth | `https://id.grudge-studio.com` |
| Assets CDN | `https://assets.grudge-studio.com` |
| Coder module | `https://coder.grudge-studio.com` |
| Forge module | `https://forge.grudge-studio.com` |

Always point Settings / CLI at **client.grudge-studio.com**. Coder and Forge remain live web products; Studio embeds them as modules rather than competing with them.

## CLI

Headless SSOT remains `grudge-dev`:

```powershell
grudge-dev setup
grudge-dev doctor
grudge-dev login --admin-password <pw>
grudge-dev upload-pack --root "C:\packs\MyPack" --pack-id my-pack
```

## Product name vs repo

| Display | Installer | CLI | GitHub repo (for now) |
|---------|-----------|-----|------------------------|
| Grudge Studio | `Grudge Studio-Setup-x.y.z.exe` | `grudge-dev` | `grudge-dev-tool` |

`appId` stays `com.grudgestudio.forge` through v0.x so electron-updater continues for existing installs.

## Roadmap

1. **v0.7** — Shell rebrand, Home hub, Coder prod embed, Forge full/quick dual mode  
2. **v0.8+** — Shared session/deep links asset → Forge/Coder  
3. **1.0** — Optional native GameForge host, offline bundles, appId cutover if needed  

See [ONE TRUTH](one-truth.md) and [object storage](object-storage.md).
