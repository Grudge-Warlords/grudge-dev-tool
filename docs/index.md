---
layout: default
title: Home
nav_order: 1
description: Grudge Studio developer tooling — ONE TRUTH admin shell, Forge tray, CLI, and production fleet wiring.
permalink: /
---
# Grudge Dev Tool

{: .fs-9 }
Desktop **admin** shell for Grudge Studio — **Elite** Three.js studio, Assets, **Forge**, **Preview**, Coder, Skeleton, Legion, and player **Puter Space**.
{: .fs-5 .fw-300 }

[⬇ Download latest installer →](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest){: .btn .btn-primary .fs-5 .mb-2 .mr-2 }
[Systems & APIs →](systems-api.md){: .btn .fs-5 .mb-2 .mr-2 }
[Admin architecture →](admin-architecture.md){: .btn .fs-5 .mb-2 .mr-2 }
[Production deployment →](production-deployment.md){: .btn .fs-5 .mb-2 }

## Production tray (current package)

Windows x64 NSIS · **v1.0.11** · electron-updater · Local Files 3D → ThreeFlow · Elite media · Forge embed · Preview · Agent AI.

| Surface | Role |
|---------|------|
| **Home** | Fleet health + admin systems (client, info.*, ENGINE, open, GRUDOX, Forge, Coder, puter-space) |
| **Local Files** | Disk browser. Click = preview. Double-click 3D → **ThreeFlow**. Media → Elite. |
| **Elite** | Images / audio / video / text / PDF pop-out. Not the 3D editor. |
| **Assets** | R2/ObjectStore · `>query` · Elite pop-out for media · explicit Open in ThreeFlow / Forge |
| **ThreeFlow** | Warlords scene editor (`threeflow.vercel.app?asset=` or local loopback) |
| **Forge** | **Same source as https://forge.grudge-studio.com** — R3F + Rapier + AI Worker |
| **Preview** | Play-mode clients (open · client · water · GRUDOX · Multiverse) after Forge |
| **Coder** | Embed coder.grudge-studio.com + optional local PTY |
| **Skeleton** | Mixamo-25 → T-pose → retarget → grudge-convert → CDN |
| **Store / BlenderKit / UUID / Legion** | Catalogs, ingest, IDs, fleet AI chat |
| **Agent AI** | Make & deploy · convert · upload · Forge handoff |
| **Plugin host** | `127.0.0.1:17380` — VS Code / standalone / viewer / agentic attach |
| **Docs** | Same `docs/` Markdown as this GitHub Pages site |

[⬇ Latest installer](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest){: .btn .btn-primary .fs-5 .mb-2 .mr-2 }
[All releases](https://github.com/Grudge-Warlords/grudge-dev-tool/releases){: .btn .fs-5 .mb-2 .mr-2 }
[Source](https://github.com/Grudge-Warlords/grudge-dev-tool){: .btn .fs-5 .mb-2 }

### First connection (ONE TRUTH)

1. Install **Grudge Dev Tool Setup** from **Releases** (or auto-update). Product name is **Grudge Dev Tool**, not Forge.
2. **Settings → ONE TRUTH** → API base `https://client.grudge-studio.com` (rewrites → Railway + ObjectStore + id).
3. **Sign in with Grudge ID** (`https://id.grudge-studio.com`) — not Puter as product login. Admin allowlist (`grudachain` / `molochdadev`) starts GRUDACHAIN Ollama when configured.
4. Player account files → [Puter Space](https://ai.grudge-studio.com/puter-space) (User-Pays FS + `*.puter.site`). **Never** bag / roster / wallet.
5. **Local Files** → 3D opens **ThreeFlow**; media opens Elite. **Forge live** is explicit (CDN URL). Then **Preview** playtest.
6. Optional: `npm run secret:import` for R2 / AI / Legion keys.

**Do not** point Settings at `api.grudge-studio.com` (deprecated). Login is **id.*** only.
{: .fs-3 .text-grey-dk-100 }

---

## Admin loop (daily)

```text
Assets (CDN / ObjectStore)
    → Forge (forge.grudge-studio.com)
    → Preview (open / client / water / GRUDOX / Multiverse)
    → Agent AI / Upload (grudge-convert → R2 → D1 seed)
```

Details: [Admin architecture](admin-architecture.md) · [AI · D1 · R2 · Stream](ai-workers-d1-r2-stream.md).

---

## CLI

```text
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
[ONE TRUTH wiring →](one-truth.md){: .btn .fs-5 .mb-2 }

`doctor` probes fleet manifest, auth, objectstore, icons via **client.grudge-studio.com**. Expect a high score when the fleet is healthy.

---

## What it does

### Desktop admin (Dev Tool tray)

- **ONE TRUTH** connectivity + fleet probes on Home  
- **Assets** with Agent search and production Asset Viewer  
- **Forge** webview = live production editor (not a local fork)  
- **Preview** for loading deployed games/clients after scene work  
- **Coder / Skeleton / Store / BlenderKit / UUID / Legion** as Dev Tool modules  
- **Secrets** in Windows Credential Vault (keytar) — never commit `.env` production keys  

### CLI

- Doctor / setup against production hosts  
- Asset pack upload with convert pipeline hooks  
- Admin login for automated ops  

### Docs (this site)

- Built from the same `docs/` folder the app catalogs  
- Workflow: `.github/workflows/pages.yml` on `main`  
- Base URL: `https://grudge-warlords.github.io/grudge-dev-tool/`  

---

## Related production hosts

| Host | Role |
|------|------|
| [client.grudge-studio.com](https://client.grudge-studio.com) | ONE TRUTH API base |
| [id.grudge-studio.com](https://id.grudge-studio.com) | Grudge ID |
| [threeflow.vercel.app](https://threeflow.vercel.app) | Warlords scene editor (Elite `?asset=`) |
| [forge.grudge-studio.com](https://forge.grudge-studio.com) | Map/scene deploy editor |
| [coder.grudge-studio.com](https://coder.grudge-studio.com) | Vibe IDE |
| [ai.grudge-studio.com](https://ai.grudge-studio.com) | Legion AI (`/v1/context` 1.6.1+) |
| [ai.grudge-studio.com/puter-space](https://ai.grudge-studio.com/puter-space) | Player account cloud (FS + site deploy — not bag) |
| [open.grudge-studio.com](https://open.grudge-studio.com) | Open launcher |
| [grudox.grudge-studio.com](https://grudox.grudge-studio.com) | GRUDOX / Carrier |
| [grudge-multiverse.vercel.app](https://grudge-multiverse.vercel.app/#room1) | Multiverse Bermuda MP (SPA) |
| [Multiverse Railway](https://grudge-multiverse-room-production.up.railway.app/api/health) | Multiverse rooms `/api/mv` |
| [water.grudge-studio.com](https://water.grudge-studio.com) | Home island |
| [assets.grudge-studio.com](https://assets.grudge-studio.com) | CDN |
| [objectstore](https://objectstore.grudge-studio.com/api/v1) / [info](https://info.grudge-studio.com/api/v1) | Catalogs |
| [grudge-studio.com](https://grudge-studio.com) | Portal / ENGINE |

Full map: [Systems & APIs](systems-api.md) · [Databases · sharing · backups](database-backups-sharing.md) · [API reference](api-reference.md) · [Production deployment](production-deployment.md).
