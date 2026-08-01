---
layout: default
title: ONE TRUTH
nav_order: 3
description: Single canonical host map for Grudge Studio — client API base, never api.grudge-studio.com.
permalink: /one-truth.html
---

# ONE TRUTH fleet wiring

Grudge Studio uses **one** canonical host map. Dev Tool (`doctor` + Home probes) and CLI validate that rewrites return **JSON**, not HTML SPA fallbacks.

Full link table: [Systems & APIs](systems-api.md).

## Canonical hosts

| Layer | Host | Browser / app path |
|-------|------|---------------------|
| **API base (always)** | **`client.grudge-studio.com`** | All rewrites below |
| Auth | `id.grudge-studio.com` | `/api/auth/*`, `/login?redirect_uri=` |
| Game state SSOT | Railway `grudge-api-production-0d46` | `/api/characters`, `/api/account`, `/api/wallet`, … |
| Portal / ENGINE | `grudge-studio.com` | Shell only — not bag/XP SSOT |
| JSON catalog | `objectstore.grudge-studio.com` | `/api/objectstore/v1/*` |
| Live defs | `info.grudge-studio.com` | `/api/v1/*` |
| Binary CDN | `assets.grudge-studio.com` | GLB / tex / audio |
| Legion AI | `ai.grudge-studio.com` | Chat / agents |
| Forge | `forge.grudge-studio.com` | Scene editor (Dev Tool **Forge** tab) |
| Coder | `coder.grudge-studio.com` | IDE (Dev Tool **Coder** tab) |
| Open | `open.grudge-studio.com` | Launcher (Preview) |
| GRUDOX | `grudox.grudge-studio.com` | Rooms / Carrier |
| Multiverse SPA | `grudge-multiverse.vercel.app` | Bermuda MP play (Preview) |
| Multiverse rooms | `grudge-multiverse-room-production.up.railway.app` | WS **`/api/mv`** only (own Railway) |
| Water | `water.grudge-studio.com` | Home island |
| Docs | [grudge-warlords.github.io/grudge-dev-tool](https://grudge-warlords.github.io/grudge-dev-tool/) | This site |

**Always use `https://client.grudge-studio.com` as API base** in CLI and Settings — not raw Railway in browser apps, not deprecated hosts.

**Multiverse ≠ Metaverse.** Multiverse multiplayer does **not** use Carrier (`/api/carrier`) or gameopen-production — it uses its dedicated Railway and `/api/mv`.

## Deprecated (split-brain)

- `api.grudge-studio.com` (old tunnel / portal HTML)
- `molochdagod.github.io/ObjectStore`
- `grudge-objectstore.pages.dev`
- `auth.grudgestudio.com` / `auth.grudge-studio.com` (use **`id.grudge-studio.com`**)
- `tactical-infinity.vercel.app` (orphaned — water is `water.grudge-studio.com`)
- Multiverse via Carrier / gameopen Railway (wrong service — use Multiverse room)

`grudge-dev doctor` fails if probes return `text/html` for JSON routes.

## Verify

```powershell
grudge-dev setup
grudge-dev doctor
```

In Dev Tool Home:

- ONE TRUTH badge ≥ 85%
- No split-brain warnings on `master-items.json` or auth

## CI

```powershell
grudge-dev doctor --json
# exit 1 if score < 85%
```

Set `GRUDGE_API_BASE=https://client.grudge-studio.com` in GitHub Actions.

## Related

- [Systems & APIs](systems-api.md)  
- [API reference](api-reference.md)  
- [Admin architecture](admin-architecture.md)  
- [Production deployment](production-deployment.md)  
