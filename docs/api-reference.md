---
layout: default
title: API Reference
nav_order: 5
---
# API Reference — `/api/objectstore/*`
All routes live in `grudge-builder/server/integrations/object_storage/devToolRoutes.ts`.

**Recommended base URL:** `https://client.grudge-studio.com` (Vercel rewrites → Railway GCS bucket). Direct VPS: `https://api.grudge-studio.com` or local `http://localhost:5000`.

Use `grudge-dev doctor` to confirm JSON responses (no HTML SPA leaks). Non-public routes require `Bearer` token or `X-Admin-Password` (local dev).
## `GET /api/objectstore/list`
Paginated listing of objects under a relative prefix.
**Query params**
- `prefix` — required. Relative path under `PRIVATE_OBJECT_DIR`.
- `cursor` — optional GCS pageToken from the previous response.
- `limit` — optional, default 100, max 1000.
**Example**
```
curl -H "Authorization: Bearer $T" \
  "https://client.grudge-studio.com/api/objectstore/list?prefix=asset-packs/classic64/&limit=50"
```
**Response**
```json
{ "items": [{ "name": "asset-packs/classic64/v0.6/Books/cover.png", "size": 12345, "contentType": "image/png", "updated": "2026-04-25T05:30:00Z", "md5Hash": "..." }],
  "nextCursor": "...", "prefix": "asset-packs/classic64/", "count": 50 }
```
## `GET /api/objectstore/search`
Server-side filter against per-pack `manifest.json` catalogs.
**Query params** — `q`, `category`, `pack`, `limit` (default 200, max 1000).
**Example**
```
curl -H "Authorization: Bearer $T" \
  "https://client.grudge-studio.com/api/objectstore/search?q=helmet&pack=classic64"
```
**Response** — `{ count, items: [<entry>, ...] }`
## `POST /api/objectstore/upload-url`
Mint a presigned PUT URL after validating the target prefix.
**Body**
```json
{ "path": "asset-packs/classic64/v0.6/Books/cover.png",
  "contentType": "image/png", "size": 12345, "sha256": "...", "allowOverwrite": false }
```
**Response**
```json
{ "uploadURL": "https://storage.googleapis.com/...",
  "objectPath": "/objects/asset-packs/classic64/v0.6/Books/cover.png",
  "bucketPath": "<bucket-prefix>/asset-packs/.../cover.png",
  "ttlSeconds": 900, "uploadId": "<uuid>", "echo": { ... } }
```
**Errors**
- `400` — missing path
- `403` — prefix not whitelisted (e.g. `asset-packs/` without admin) OR `user-uploads/<grudgeId>/` mismatch
- `409` — object already exists; resend with `allowOverwrite: true`
## `POST /api/objectstore/manifest` (admin)
Atomically write `asset-packs/<packId>/manifest.json`.
**Body**
```json
{ "packId": "classic64", "version": "0.6",
  "meta": { "license": "CC0", "author": "Craig Snedeker" },
  "entries": [...] }
```
## `GET /api/objectstore/asset/<objectPath>`
- Default — 302 redirects to a signed GET URL (10-min TTL).
- `?format=json` — returns metadata + signed URL + public CDN URL as JSON.
**Example**
```
curl -L -H "Authorization: Bearer $T" \
  "https://api.grudge-studio.com/api/objectstore/asset/asset-packs/classic64/v0.6/Books/cover.png?format=json"
```
## UUID endpoints (existing, mounted by GrudgeBuilder)
- `GET  /api/uuid/test`           — sanity sample
- `POST /api/uuid/generate`       — `{ slot, tier, itemId }` → `{ uuid }`
- `GET  /api/uuid/slots`          — slot-code map
- `POST /api/uuid/apply-to-items` — admin batch operation
