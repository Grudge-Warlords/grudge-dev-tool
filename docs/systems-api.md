---
layout: default
title: Systems & APIs
nav_order: 4
description: Canonical hosts, APIs, and Dev Tool connections for the Grudge Studio fleet.
permalink: /systems-api.html
---

# Systems & APIs (canonical)

**Use this page as the link map** for the published docs site and Dev Tool admin shell.  
Code SSOT: `src/shared/fleet.ts` · `src/shared/adminSurfaces.ts` · `src/shared/fleetConnections.ts`.

**Do not** use `https://api.grudge-studio.com` for **new** player APIs or as catalog SSOT.  
It may still return asset-index JSON (**legacy live**, proved 200) — prefer **ObjectStore + assets CDN**.

---

## ONE TRUTH API base

| Use | URL |
|-----|-----|
| **Browser / CLI / Dev Tool Settings** | `https://client.grudge-studio.com` |
| Auth (via rewrites) | `https://client.grudge-studio.com/api/auth/me` (401 without JWT = route live) |
| Game data (via rewrites) | `https://client.grudge-studio.com/api/characters` · `/api/account/*` · `/api/wallet/*` → Railway |
| ObjectStore **JSON proxy** (proved) | `https://client.grudge-studio.com/api/objectstore/v1/<name>.json` |
| Direct game-data SSOT | `https://grudge-api-production-0d46.up.railway.app` |
| Health | `…/api/health` on client **and** Railway (same service) |

```powershell
grudge-dev setup
grudge-dev doctor
# GRUDGE_API_BASE=https://client.grudge-studio.com
```

---

## Identity & portal

| Host | Role |
|------|------|
| [id.grudge-studio.com](https://id.grudge-studio.com) | Grudge ID SSO (`/login?redirect_uri=`) |
| [grudge-studio.com](https://grudge-studio.com) | Portal / The-ENGINE shell (not player-state SSOT) |
| [character.grudge-studio.com](https://character.grudge-studio.com) | Character Foundry (create + 4-slot only) |

---

## Data layer

| Host | Role |
|------|------|
| [assets.grudge-studio.com](https://assets.grudge-studio.com) | R2 binary CDN (GLB, textures, audio) |
| [objectstore.grudge-studio.com/api/v1](https://objectstore.grudge-studio.com/api/v1) | JSON catalogs + search index |
| [info.grudge-studio.com/api/v1](https://info.grudge-studio.com/api/v1) | Live definition catalogs |
| D1 `grudge-assets-db` / ObjectStore D1 | **Index only** — never player bag/XP |
| Railway Postgres | Characters, bag, island, wallet SSOT |

**Backups & sharing:** [Databases · sharing · backups](database-backups-sharing.md) — parallel Postgres dumps, account vs character scopes, D1/R2 recovery.

See [Object storage](object-storage.md) · [AI · D1 · R2 · Stream](ai-workers-d1-r2-stream.md).

---

## Editors & tools

| Host | Role | Dev Tool tab |
|------|------|--------------|
| [forge.grudge-studio.com](https://forge.grudge-studio.com) | R3F + Rapier scene editor | **Forge** (same source) |
| [coder.grudge-studio.com](https://coder.grudge-studio.com) | Vibe IDE | **Coder** |
| `http://127.0.0.1:17380` | Plugin host (VS Code / standalone / viewer / agentic) | **Agent AI** (while dest-tool running) |
| [grudge-pipeline.vercel.app](https://grudge-pipeline.vercel.app) | Convert handoff | Pipeline |
| Grok Builder (see `FLEET_URLS.grokBuilder`) | Agentic Three/Rapier builder | **Grok Builder** |

---

## Games & live play (Preview targets)

| Host | Role |
|------|------|
| [open.grudge-studio.com](https://open.grudge-studio.com) | Open launcher (canonical library) |
| [client.grudge-studio.com](https://client.grudge-studio.com) | Live play funnel |
| [water.grudge-studio.com](https://water.grudge-studio.com) | Home island production |
| [grudox.grudge-studio.com](https://grudox.grudge-studio.com) | GRUDOX hub + Carrier |
| [grudge-multiverse.vercel.app](https://grudge-multiverse.vercel.app/#room1) | **Multiverse** Bermuda island SPA (grudge6 RTS Toon) |
| [grudge-multiverse-room-production](https://grudge-multiverse-room-production.up.railway.app/api/health) | Multiverse **dedicated** Railway rooms — WS **`/api/mv` only** |
| [grudgewarlords.com](https://grudgewarlords.com) | Warlords shell |
| [carrier.grudge-studio.com](https://carrier.grudge-studio.com) | Carrier edge WS (GRUDOX — **not** Multiverse) |
| [metaverse.grudge-studio.com](https://metaverse.grudge-studio.com) | Metaverse avatars hub (**not** Multiverse) |

**Never** use orphaned `tactical-infinity.vercel.app` for water.  
**Never** route Multiverse multiplayer through Carrier or gameopen-production — each multiplayer game has its own Railway when it needs rooms.

### Multiverse topology (live)

```text
Browser → grudge-multiverse.vercel.app  (SPA / Three r185)
       → assets.grudge-studio.com/models/maps/bermuda.glb  (map)
       → assets.grudge-studio.com/models/grudge6/…          (kits)
       → wss://grudge-multiverse-room-production…/api/mv?room=room1
```

Open library card: `gameopen` → `gameLibrary.ts` id `grudge-multiverse`.

---

## AI

| Host | Role |
|------|------|
| [ai.grudge-studio.com](https://ai.grudge-studio.com) | **Legion** fleet chat / roles |
| Coder AI hub worker | Event/job ingest only (≠ Legion) |
| Dev Tool plugin host | `127.0.0.1:17380` — local attach; see [Plugin attach](plugin-attach.md) |
| `http://localhost:11434` | GRUDACHAIN Ollama (desktop agentic) |
| [obs.grudge-studio.com](https://obs.grudge-studio.com) | Observatory telemetry |

---

## ObjectStore & CDN (proved paths — 2026-08)

### JSON catalogs (public GET)

| Method | URL | Notes |
|--------|-----|--------|
| GET | `https://objectstore.grudge-studio.com/api/v1/catalog` | Worker service catalog |
| GET | `https://objectstore.grudge-studio.com/api/v1/<name>.json` | e.g. `master-items`, `weapons` |
| GET | `https://client.grudge-studio.com/api/objectstore/v1/<name>.json` | **ONE TRUTH proxy** (proved) |
| GET | `https://info.grudge-studio.com/api/v1/<name>.json` | Live defs when available |
| GET | `https://assets.grudge-studio.com/<key>` | Binaries (GLB/FBX/png) |

### Extract catalogs (uMMORPG → Forge / Warlords)

| Catalog | URL |
|---------|-----|
| Extract index | `…/api/v1/ummorpg-extract-index.json` |
| Skills for Forge | `…/api/v1/ummorpg-skills-for-forge.json` |
| Placeables for Forge | `…/api/v1/ummorpg-placeables-for-forge.json` |
| Warlords entities | `…/api/v1/warlords-entity-prefabs.json` |

Regen (no Unity Editor):

```powershell
cd F:\GitHub\ObjectStore
npm run catalog:ummorpg   # if wired — or:
node scripts/extract-ummorpg-for-warlords.mjs
node scripts/build-ummorpg-forge-catalog.mjs
node scripts/publish-static-json.mjs ummorpg-skills-for-forge ummorpg-placeables-for-forge ummorpg-extract-index
```

Forge source: `F:\GitHub\Grudge-Studio-Forge\artifacts\game-forge\src\lib\ummorpgCatalog.ts`  
Public data: `…/public/data/ummorpg-*.json`

### Paths that are **not** live (do not document as working)

| Path | Live result (2026-08 probe) |
|------|------------------------------|
| `client…/api/objectstore/list?prefix=` | **404** |
| `client…/api/objectstore/search?q=` | **404** |
| `client…/api/auth/session` | **404** (use `/api/auth/me`) |

Admin upload/list: use ObjectStore Worker admin routes or Dev Tool R2/S3 — not the broken proxy list/search rows.

Full examples: [API reference](api-reference.md).

---

## Admin loop (Dev Tool)

```text
Assets (CDN / ObjectStore / info.*)
  → Forge (forge.grudge-studio.com)
  → Preview (open / client / water / GRUDOX / Multiverse)
  → Upload / Agent AI (grudge-convert → R2 → D1 seed)
```

Details: [Admin architecture](admin-architecture.md) · [Production deployment](production-deployment.md).

---

## Related

- [ONE TRUTH](one-truth.md)  
- [Production config / secrets](production-config.md)  
- [CLI quickstart](cli-quickstart.md)  
- [Docs site home](./)  
