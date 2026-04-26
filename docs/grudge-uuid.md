---
layout: default
title: Grudge UUID
nav_order: 4
---
# Grudge UUID — Local Reference
Format: `SLOT-TIER-ITEMID-TIMESTAMP-COUNTER`
- **SLOT** (4 chars) — slot/type code (see table)
- **TIER** (2 chars) — `t0`–`t8` or `oo` (no tier)
- **ITEMID** (4 digits) — `0001`–`9999`
- **TIMESTAMP** (12 digits) — `HHMMMMDDYYYY` in Texas time (CST/CDT)
- **COUNTER** (6 alphanum) — base-36 (`000001`–`zzzzzz`)
Authoritative spec lives in `GrudgeBuilder/docs/UUID_SYSTEM.md`. The dev tool's local copy in `src/shared/grudgeUUID.ts` is kept in sync — any change in one MUST be mirrored to the other.
## Asset-pack codes (added by this tool)
| Code   | Meaning                                  |
|--------|------------------------------------------|
| `texr` | Texture (generic)                        |
| `mati` | Texture material image (PBR-style)       |
| `mdlb` | Blend / 3D model                         |
| `sprt` | Sprite (sheet or single)                 |
| `audi` | Audio                                    |
| `mesh` | Mesh                                     |
These tag asset-pack contents like Classic 64 textures (`texr`/`mati`) and blend files (`mdlb`).
## Tier mapping
- Texture / model assets from public packs use `tier=null` → `oo`.
- Crafted in-game items use `0`–`8`.
## Counter persistence
The dev-tool process keeps an in-memory counter that resets to 1 on launch. The CLI uploader uses a per-run sequence based on the file ordinal, so each run produces deterministic UUIDs given the same file order.
## Examples
| Asset                          | Grudge UUID                                |
|--------------------------------|--------------------------------------------|
| Classic 64 `Books/cover.png`   | `texr-oo-0001-103025042026-000001`         |
| `Food/apple.blend` → `.glb`    | `mdlb-oo-0034-103025042026-000022`         |
| Worge raptor mesh              | `mesh-oo-0001-103025042026-000045`         |
