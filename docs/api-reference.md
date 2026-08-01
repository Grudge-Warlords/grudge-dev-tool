---
layout: default
title: API Reference
nav_order: 6
description: ObjectStore, UUID, fleet health, and ONE TRUTH API routes for Dev Tool and CLI.
permalink: /api-reference.html
---

# API Reference

**Recommended API base:** [`https://client.grudge-studio.com`](https://client.grudge-studio.com)  
**Game-data SSOT (direct):** `https://grudge-api-production-0d46.up.railway.app`  
**ObjectStore JSON (direct):** `https://objectstore.grudge-studio.com/api/v1`  
**info catalogs:** `https://info.grudge-studio.com/api/v1`  
**CDN binaries:** `https://assets.grudge-studio.com`  

**Deprecated:** `https://api.grudge-studio.com` — do not use for new wiring.  
**Local:** `http://localhost:5000` (when GrudgeBuilder is running).

Non-public routes need `Authorization: Bearer <JWT>` or local `X-Admin-Password`.  
Validate with `grudge-dev doctor` (JSON only — no HTML SPA leaks).

Full host map: [Systems & APIs](systems-api.md) · [ONE TRUTH](one-truth.md).

---

## Health / fleet probes

| Check | URL | Notes |
|-------|-----|--------|
| Grudge ID | `https://id.grudge-studio.com/api/health` | Auth gateway |
| Railway | `https://grudge-api-production-0d46.up.railway.app/api/health` | Game data |
| Auth me | `{apiBase}/api/auth/me` | 401 unauthenticated is OK |
| ObjectStore items | `{apiBase}/api/objectstore/v1/master-items.json` | Via client rewrites |
| ObjectStore direct | `https://objectstore.grudge-studio.com/api/v1/master-items.json` | Direct catalog |
| CDN root | `https://assets.grudge-studio.com` | HEAD |
| Legion | `https://ai.grudge-studio.com/health` | Fleet AI |
| Forge | `https://forge.grudge-studio.com/` | Editor SPA |
| Coder | `https://coder.grudge-studio.com/api/health` | IDE gateway when backend up |
| Open | `https://open.grudge-studio.com/` | Launcher |
| Multiverse SPA | `https://grudge-multiverse.vercel.app/` | Bermuda MP play |
| Multiverse room | `https://grudge-multiverse-room-production.up.railway.app/api/health` | Rooms service; WS **`/api/mv`** |

`apiBase` = `https://client.grudge-studio.com` in production.

### Multiverse room health (example)

```bash
curl -s https://grudge-multiverse-room-production.up.railway.app/api/health
# {"status":"ok","service":"grudge-multiverse-room","ws":["/api/mv"],…}
```

Do **not** call Multiverse multiplayer on Carrier `/api/carrier` or gameopen Railway.

---

## ObjectStore — list / search / upload

Routes used by Dev Tool Assets, CLI `upload-pack`, and agents.  
Implementation often via fleet rewrites + ObjectStore Worker / R2.

### `GET /api/objectstore/list`

Paginated listing under a prefix.

**Query:** `prefix` (required), `cursor`, `limit` (default 100, max 1000).

```bash
curl -H "Authorization: Bearer $T" \
  "https://client.grudge-studio.com/api/objectstore/list?prefix=prod/gltf/&limit=50"
```

**Response (shape):**

```json
{
  "items": [
    {
      "name": "prod/gltf/misc/hero.glb",
      "size": 12345,
      "contentType": "model/gltf-binary",
      "updated": "2026-07-29T05:30:00Z",
      "md5Hash": "..."
    }
  ],
  "folders": ["prod/gltf/races/"],
  "nextCursor": "...",
  "prefix": "prod/gltf/",
  "count": 50
}
```

### `GET /api/objectstore/search`

Server-side search (Assets tab: type `>query`).

**Query:** `q`, `category`, `pack`, `limit` (default 200, max 1000).

```bash
curl -H "Authorization: Bearer $T" \
  "https://client.grudge-studio.com/api/objectstore/search?q=helmet&limit=50"
```

**Response:** `{ "count": N, "items": [ … ] }`

### `POST /api/objectstore/upload-url`

Mint a presigned PUT for R2 / storage.

**Body:**

```json
{
  "path": "prod/gltf/misc/hero.glb",
  "contentType": "model/gltf-binary",
  "size": 12345,
  "sha256": "...",
  "allowOverwrite": false
}
```

**Response:** `{ "uploadURL", "objectPath", "bucketPath", "ttlSeconds", "uploadId", "echo" }`

**Errors:** `400` missing path · `403` prefix / user mismatch · `409` exists (retry with `allowOverwrite: true`).

### `POST /api/objectstore/manifest` (admin)

Write pack `manifest.json`.

```json
{
  "packId": "classic64",
  "version": "0.6",
  "meta": { "license": "CC0", "author": "…" },
  "entries": []
}
```

### `GET /api/objectstore/asset/<objectPath>`

- Default: 302 to signed GET (short TTL).  
- `?format=json`: metadata + signed URL + public CDN URL.

```bash
curl -L -H "Authorization: Bearer $T" \
  "https://client.grudge-studio.com/api/objectstore/asset/prod/gltf/misc/hero.glb?format=json"
```

Public CDN equivalent: `https://assets.grudge-studio.com/prod/gltf/misc/hero.glb`

---

## Public catalog JSON (ObjectStore / info)

Prefer CDN keys for binaries; catalogs for game data:

```text
https://objectstore.grudge-studio.com/api/v1/master-items.json
https://objectstore.grudge-studio.com/api/v1/master-recipes.json
https://info.grudge-studio.com/api/v1/…   # live definitions when published
```

Dev Tool **Store** tab loads fleet categories from these catalogs.

---

## UUID endpoints

Mounted by GrudgeBuilder / game-data; also available from Dev Tool **UUID** tab (`src/shared/grudgeUUID.ts` SSOT).

| Method | Path | Body / notes |
|--------|------|----------------|
| GET | `/api/uuid/test` | Sanity sample |
| POST | `/api/uuid/generate` | `{ slot, tier, itemId }` → `{ uuid }` |
| GET | `/api/uuid/slots` | Slot-code map |
| POST | `/api/uuid/apply-to-items` | Admin batch |

Format: `SLOT-TIER-ITEMID-TIMESTAMP-COUNTER` — see [Grudge UUID](grudge-uuid.md).

---

## Auth (Grudge ID)

Canonical browser login:

```text
https://id.grudge-studio.com/login?redirect_uri=<origin>
```

Session / me:

```bash
curl -H "Authorization: Bearer $T" \
  "https://client.grudge-studio.com/api/auth/me"
```

---

## AI (Legion)

```bash
curl -X POST "https://ai.grudge-studio.com/v1/chat" \
  -H "Authorization: Bearer $GRUDGE_AI_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"…"}],"agent":"general"}'
```

Health: `GET https://ai.grudge-studio.com/health`  

**Not the same product as** Coder AI hub worker (`GrudachainCode/workers/ai-hub`).

---

## Dev Tool IPC (desktop only)

Renderer talks only via `window.grudge` / preload. Major groups:

| Group | Purpose |
|-------|---------|
| `os.list` / `os.search` / `os.registerAsset` | ObjectStore / R2 |
| `viewer.open` | Always-on-top Asset Viewer |
| `forge.*` | Local tools / open remote CDN into local tools |
| `coder.launch` / `status` | Local Coder PTY |
| `preview.*` | HTML open helpers |
| `legion.*` | Fleet Legion chat |
| `skeleton.*` | Extract / T-pose / libraries |
| `ingest.*` / upload | Convert + push packs |
| `connectivity.probe` | ONE TRUTH score |

Channel names: `src/shared/ipc.ts`.

---

## Production quality bar

1. **Bake** with `grudge-convert` (SI scale, Draco/Meshopt, WebP) before R2.  
2. **Magic-byte** verify GLBs.  
3. **Seed** D1 / ObjectStore after upload.  
4. **Send 3D to Forge** with **CDN URL** (`assets.grudge-studio.com/...`).  
5. **Playtest** via Preview → open / client / water / GRUDOX / Multiverse.  

See [Admin architecture](admin-architecture.md) · [Production deployment](production-deployment.md).
