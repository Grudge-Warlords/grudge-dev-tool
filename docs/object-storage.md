---
layout: default
title: Object Storage
nav_order: 3
---

# Object Storage — Layout, ACL, CDN

## Two systems, one source of truth

| Layer | Host | Role |
|-------|------|------|
| **Binary assets** (GLB/FBX, textures, audio, icons) | `https://assets.grudge-studio.com` | R2 bucket `grudge-assets` via CDN Worker |
| **JSON game data** (weapons, armor, classes, races, materials) | `https://objectstore.grudge-studio.com/api/v1` | ObjectStore Worker + D1 search index |
| **Optional defs mirror** | `https://info.grudge-studio.com/api/v1` | Live definition catalogs |
| **Asset registry index** | D1 `grudge-assets-db` / ObjectStore D1 | Metadata only — never binary bytes |

See also: [AI Workers · D1 · R2 · Stream](./ai-workers-d1-r2-stream.md) and `src/shared/bestPractices.ts`.

### How the Dev Tool talks to storage

1. **Preferred:** ObjectStore Worker (`cf-objectstore-worker-url` + API key) — list, search, signed upload URL, meta.  
2. **Fallback:** R2 S3-compatible direct (`cf-r2-endpoint` + access keys) via `src/main/cf/r2Direct.ts`.  
3. **Public URL:** `r2PublicUrl()` → keytar / env / `https://assets.grudge-studio.com`.  
4. **Do not** write production binaries to a second private GCS “truth” — R2 + CDN is production.

Admin desktop UX:

- **Browse** R2 / ObjectStore prefixes  
- Filter `>query` → **server-side search**  
- Click file → **preview** + always-on-top **Asset Viewer** pop-out  
- **Send 3D to Forge** with CDN URL  

---

## Canonical bucket layout

```
# Pack source (admin)
asset-packs/<pack-id>/v<version>/<category>/<file>
asset-packs/<pack-id>/v<version>/_thumbs/<category>/<file>.thumb.jpg
asset-packs/<pack-id>/v<version>/_originals/<category>/<file>   # only with --keep-source
asset-packs/<pack-id>/v<version>/_blends/<category>/<file>
asset-packs/<pack-id>/manifest.json
asset-packs/<pack-id>/CHANGELOG.txt
asset-packs/<pack-id>/README.txt

# Fleet production keys (games load these)
models/grudge6/races/*.fbx
models/nature/stylized/**
models/creatures/**
models/obstacles/**
models/skeletons/**
textures/**
icons/**
anims/baked/**

# Scenes / user
scenes/<id>.glb
scenes/<id>.meta.json
user-uploads/<grudgeId>/<arbitrary-path>
shared/<purpose>/<file>
dev/<scratch>
manifests/<misc>.json
```

---

## Prefix whitelist (server-side enforced)

- `asset-packs/`, `manifests/`, `shared/`, `dev/`, `models/`, `textures/`, `icons/`, `scenes/` — admin / master_admin only for writes.  
- `user-uploads/<grudgeId>/...` — only the matching user.  
- Anything else — rejected.

---

## Manifest schema

Each pack writes a single `manifest.json`:

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

Search: ObjectStore `/search` or Dev Tool `>query` scans manifests / D1 index server-side.

---

## CDN behavior

- Custom domain **only** for production (`assets.grudge-studio.com`).  
- CDN Worker: correct MIME (incl. `video/mp4`, `model/gltf-binary`), ETag, HEAD, CORS.  
- Prefer WebP companions when `Accept` includes WebP (ObjectStore edge where implemented).  
- Versioned / content-hashed keys: `Cache-Control: public, max-age=31536000, immutable`.  
- **Magic-byte verify** GLB/FBX — never treat HTML error pages as meshes.

---

## Upload quality bar

1. **Convert first** (`grudge-convert`) for production 3D.  
2. **Idempotent** put (hash / ETag skip).  
3. **Multipart** for large files.  
4. **Seed D1** / ObjectStore index after put.  
5. **HEAD** public URL before wiring loaders.  

---

## Atomicity

Manifest writes go to `manifest.json.tmp` first, then are copied to `manifest.json` and the temp deleted. Readers see either the previous or the new manifest, never a partial.

---

## Stream (video)

Long-form cinema / trailers: master on R2 → Cloudflare Stream copy-from-URL → store Stream `uid` next to `r2_key` in registry. See [ai-workers-d1-r2-stream.md](./ai-workers-d1-r2-stream.md).
