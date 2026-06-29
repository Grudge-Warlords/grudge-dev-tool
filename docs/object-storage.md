---
layout: default
title: Object Storage
nav_order: 3
---
# Object Storage — Layout, ACL, CDN
## Two systems, one source of truth
- **Binary assets** (images, sprites, audio, models) → R2 CDN at `https://assets.grudge-studio.com`.
- **JSON game data** (weapons, armor, classes, races) → GitHub Pages mirror at `https://molochdagod.github.io/ObjectStore` and the production worker at `https://objectstore.grudge-studio.com`.
The dev tool talks to the **private bucket** through GrudgeBuilder's `/api/objectstore/*` endpoints (presigned PUT/GET via Google Cloud Storage). The public R2 mirror is updated by a backend reconciliation job; do not write directly to it from the tool.
## Canonical bucket layout
```
asset-packs/<pack-id>/v<version>/<category>/<file>      # source assets
asset-packs/<pack-id>/v<version>/_thumbs/<category>/<file>.thumb.jpg
asset-packs/<pack-id>/v<version>/_originals/<category>/<file>   # only with --keep-source
asset-packs/<pack-id>/v<version>/_blends/<category>/<file>      # raw .blend files
asset-packs/<pack-id>/manifest.json
asset-packs/<pack-id>/CHANGELOG.txt
asset-packs/<pack-id>/README.txt

user-uploads/<grudgeId>/<arbitrary-path>
shared/<purpose>/<file>
dev/<scratch>
manifests/<misc>.json
```
## Prefix whitelist (server-side enforced)
- `asset-packs/`, `manifests/`, `shared/`, `dev/` — admin / master_admin only.
- `user-uploads/<grudgeId>/...` — only the matching user.
- Anything else — rejected.
## Manifest schema
Each pack writes a single `manifest.json` containing:
```json
{
  "packId": "classic64",
  "version": "0.6",
  "generatedAt": "2026-04-25T05:30:00Z",
  "meta": { "license": "CC0", "author": "Craig Snedeker" },
  "count": 862,
  "entries": [
    {
      "grudgeUUID": "texr-oo-0001-103025042026-000001",
      "path": "asset-packs/classic64/v0.6/Books/cover.png",
      "category": "Books",
      "family": "image",
      "sizeBytes": 12345,
      "sha256": "…",
      "contentType": "image/png",
      "rig": "none",
      "conversionKind": "sharp-webp",
      "warnings": []
    }
  ]
}
```
The Search page hits `/api/objectstore/search` which scans every `asset-packs/*/manifest.json` and filters server-side.
## CDN behavior
The R2 worker at `objectstore.grudge-studio.com` serves the same paths and prefers `.webp` companions when the browser's `Accept` header includes WebP.
## Atomicity
Manifest writes go to `manifest.json.tmp` first, then are copied to `manifest.json` and the temp deleted. Readers are guaranteed to see either the previous or the new manifest, never a partial.
