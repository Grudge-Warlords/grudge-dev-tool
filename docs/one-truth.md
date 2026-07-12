---
layout: default
title: ONE TRUTH
nav_order: 3
---
# ONE TRUTH fleet wiring

Grudge Studio uses a **single** host map. Code SSOT:

| Layer | Path |
|-------|------|
| **URL registry (code)** | `Desktop/grudge-builder/shared/fleet/manifest.ts` |
| **Live JSON** | `https://client.grudge-studio.com/api/fleet/manifest` |
| **Desktop + CLI** | `grudge-dev-tool-build/src/shared/fleet.ts` + `cli/src/lib/fleet.ts` |
| **Master doc** | `Desktop/SOURCE_OF_TRUTH.md` |

`doctor` + Forge connectivity validate browser rewrites return **JSON**, not HTML SPA fallbacks.

## Canonical hosts

| Layer | Host | Browser proxy / notes |
|-------|------|------------------------|
| **Primary domain** | `grudge-studio.com` | Platform hub (not bare `grudge.studio` as primary product brand) |
| Auth | `id.grudge-studio.com` | `/api/auth/*` — only SSO gateway |
| Identity portal | `grudge-studio.com` | The-ENGINE catch-all `/api/*` (not characters) |
| Game state (Postgres) | `grudge-api-production-0d46.up.railway.app` | `/api/characters`, `/api/fleet/*`, … via Vercel rewrites |
| JSON catalog | `objectstore.grudge-studio.com` | `/api/objectstore/v1/*` |
| Binary CDN | `assets.grudge-studio.com` | `/api/assets/*` · bucket `grudge-assets` |
| **Dev / Studio API base** | **`client.grudge-studio.com`** | All of the above rewritten |
| Game client | `grudgewarlords.com` | grudge-builder Vercel |
| Character (GCS) | `character.grudge-studio.com` | HYDRA / grudge6 forge |
| Arena | `grudge-arena.grudge-studio.com` | grudge-arena |
| Coder (Studio module) | `coder.grudge-studio.com` | Embedded in Grudge Studio |
| Forge (Studio module) | `forge.grudge-studio.com` | Embedded in Grudge Studio |

**Always use `client.grudge-studio.com` as API base** in CLI and Grudge Studio Settings — not raw Railway URLs and not deprecated GitHub Pages objectstore.

## Deprecated (split-brain — do not use)

| Host / path | Why |
|-------------|-----|
| `api.grudge-studio.com` for **auth** | Dead/split tunnel; SSO 404s |
| `grudge-builder-production.up.railway.app` | Stale name; use `grudge-api-production-0d46` |
| `molochdagod.github.io/ObjectStore` | Pages split-brain |
| `grudge-objectstore.pages.dev` | Pages split-brain |
| Hardcoded game data in frontends | ObjectStore is JSON SSOT |

`grudge.studio` may exist as a domain alias (recent Vercel attach) — **product + docs use `grudge-studio.com`**. Prefer `id.grudge-studio.com` over `id.grudge.studio`.

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
