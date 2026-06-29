---
layout: default
title: ONE TRUTH
nav_order: 3
---
# ONE TRUTH fleet wiring

Grudge Studio uses a single canonical host map. The dev tool (`doctor` + Forge connectivity) validates that browser rewrites return **JSON**, not HTML SPA fallbacks.

## Canonical hosts

| Layer | Host | Browser proxy |
|-------|------|-----------------|
| Auth | `id.grudge-studio.com` | `/api/auth/*` |
| Game state | `grudge-builder-production.up.railway.app` | `/api/characters`, `/api/fleet/*`, … |
| JSON catalog | `objectstore.grudge-studio.com` | `/api/objectstore/v1/*` |
| Binary CDN | `assets.grudge-studio.com` | `/api/assets/*` |
| **Dev client** | **`client.grudge-studio.com`** | All of the above |

**Always use `client.grudge-studio.com` as API base** in CLI and Forge Settings — not raw Railway URLs and not deprecated GitHub Pages objectstore.

## Deprecated (split-brain)

- `molochdagod.github.io/ObjectStore`
- `grudge-objectstore.pages.dev`

`grudge-dev doctor` fails if probes return `text/html` for JSON routes.

## Verify

```powershell
grudge-dev setup
grudge-dev doctor
```

In `grudge-builder` (in-app badge or `/systems`):

- Truth badge ≥ 85%
- No split-brain warnings on `master-items.json` or auth

## CI

```powershell
grudge-dev doctor --json
# exit 1 if score < 85%
```

Set `GRUDGE_API_BASE=https://client.grudge-studio.com` in GitHub Actions.