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

**Never** route new work through `https://api.grudge-studio.com` (deprecated).

---

## ONE TRUTH API base

| Use | URL |
|-----|-----|
| **Browser / CLI / Dev Tool Settings** | `https://client.grudge-studio.com` |
| Auth (via rewrites) | `https://client.grudge-studio.com/api/auth/*` → Grudge ID |
| Game data (via rewrites) | `https://client.grudge-studio.com/api/characters|account|wallet|…` → Railway |
| ObjectStore proxy | `https://client.grudge-studio.com/api/objectstore/v1/*` |
| Direct game-data SSOT | `https://grudge-api-production-0d46.up.railway.app` |

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

See [Object storage](object-storage.md) · [AI · D1 · R2 · Stream](ai-workers-d1-r2-stream.md).

---

## Editors & tools

| Host | Role | Dev Tool tab |
|------|------|--------------|
| [forge.grudge-studio.com](https://forge.grudge-studio.com) | R3F + Rapier scene editor | **Forge** (same source) |
| [coder.grudge-studio.com](https://coder.grudge-studio.com) | Vibe IDE | **Coder** |
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
| `http://localhost:11434` | GRUDACHAIN Ollama (desktop agentic) |
| [obs.grudge-studio.com](https://obs.grudge-studio.com) | Observatory telemetry |

---

## ObjectStore list/search/upload (via ONE TRUTH)

Base: `https://client.grudge-studio.com` (preferred) or direct ObjectStore Worker.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/objectstore/list?prefix=` | List objects |
| GET | `/api/objectstore/search?q=` | Server search (`>query` in Assets) |
| POST | `/api/objectstore/upload-url` | Presigned PUT |
| POST | `/api/objectstore/manifest` | Pack manifest (admin) |
| GET | `/api/objectstore/asset/<path>` | Signed GET / metadata |

Full examples: [API reference](api-reference.md).

Public catalogs (no auth for public JSON):

```text
https://objectstore.grudge-studio.com/api/v1/master-items.json
https://info.grudge-studio.com/api/v1/…   # live defs when available
https://assets.grudge-studio.com/<key>    # binaries
```

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
