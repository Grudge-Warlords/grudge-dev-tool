---
layout: default
title: Home
nav_order: 1
description: Grudge Studio — canonical truth, assets, Forge, and Coder in one Windows app + grudge-dev CLI.
permalink: /
---
# Grudge Studio

{: .fs-9 }
The **best** Grudge desktop app — **ONE TRUTH** fleet info, **asset** pipeline, **Forge**, and **Coder** in one shell.
{: .fs-5 .fw-300 }

[Product charter →](grudge-studio.md){: .btn .btn-primary .fs-5 .mb-2 .mr-2 }
[ONE TRUTH wiring →](one-truth.md){: .btn .fs-5 .mb-2 .mr-2 }
[CLI quickstart →](cli-quickstart.md){: .btn .fs-5 .mb-2 .mr-2 }

---

## Download — Grudge Studio (v0.7.0)

[⬇ Download latest installer](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest){: .btn .btn-primary .fs-5 .mb-2 .mr-2 }
[All releases](https://github.com/Grudge-Warlords/grudge-dev-tool/releases){: .btn .fs-5 .mb-2 .mr-2 }
[View source on GitHub](https://github.com/Grudge-Warlords/grudge-dev-tool){: .btn .fs-5 .mb-2 }
Windows x64 · NSIS · auto-updating · product name **Grudge Studio**.
{: .fs-3 .text-grey-dk-100 }

### Simple connection (ONE TRUTH)

1. Install Grudge Studio (or auto-update from prior Forge tray builds).
2. **Settings → ONE TRUTH** — fleet client `https://client.grudge-studio.com`.
3. Sign in or paste a bearer token from `id.grudge-studio.com`.
4. Status bar / Home show **ONE TRUTH** score (same probes as `grudge-dev doctor`).
5. Open **Forge** (full editor or Quick 3D) and **Coder** (production or local) from the sidebar.

Legacy installs named "Grudge Studio Forge" still update (same `appId`).

---

## CLI — Grudge Studio CLI (`grudge-dev`)

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

`doctor` probes fleet manifest, auth, objectstore JSON, icons, and Supabase health via **client.grudge-studio.com**.

---

## Modules in the app

| Module | Role |
|--------|------|
| **Home** | ONE TRUTH meter, host map, launchers |
| **Assets** | Browser · Search · Upload · Store · BlenderKit |
| **Forge** | Full `forge.grudge-studio.com` + Quick 3D |
| **Coder** | Production `coder.grudge-studio.com` + local GrudachainCode |
| **Engine / Games / Legion** | Characters, fleet, agentic RAG |
| **CLI** | Headless doctor + upload-pack |

## Documentation

- [Grudge Studio charter](grudge-studio.md)
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
| **Grudge Studio** | v0.7.0 | Home hub, Coder prod embed, Forge full/quick, rebrand |
| **CLI** | v0.5.x | `grudge-dev` in `cli/` |

Canonical API: **`https://client.grudge-studio.com`**.

<!-- Pages deploy: 2026-07-10 v0.7.0 Grudge Studio -->
