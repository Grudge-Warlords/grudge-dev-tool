---
layout: default
title: Vercel fleet SSOT
nav_order: 8
description: Canonical production hosts, anti-placeholder rules, and Vercel hygiene for Grudge Studio.
permalink: /VERCEL_FLEET_SSOT.html
---

# Vercel fleet SSOT (no placeholders)

**Team:** `grudgenexus`  
**Probe:** `npm run fleet:probe` (or `node scripts/probe-vercel-fleet.mjs`)  
**Code URL map:** `src/shared/fleet.ts` + `src/shared/fleetGames.ts`  

## Golden rules (agents + humans)

1. **One production URL per product** — prefer `*.grudge-studio.com` over `*.vercel.app`.
2. **Never hardcode a Vercel URL before the project exists** — create project → deploy → *then* put the URL in fleet SSOT.
3. **No “set after deploy” comments in production maps** — either live URL or `status: "planned"` with empty play URL.
4. **SPA deploy must be prebuilt or CI-safe** — do not rely on machine paths like `D:\kenney-assets` in Vercel build.
5. **Custom domain is source of truth** — `*.vercel.app` is an alias only; catalogs must list the custom domain when DNS exists.
6. **Deprecated hosts stay labeled dead** — e.g. `api.grudge-studio.com` for *auth/game-data*, `tactical-infinity.vercel.app` for water (use `water.grudge-studio.com`).
7. **Junk projects** (`dist`, `david`, `public`, empty Production URL) are not fleet — do not link them from Dev Tool / Open / docs.

## Canonical production (P0 — always green)

| Product | Production URL | Vercel project |
|---------|----------------|----------------|
| Warlords / client | https://client.grudge-studio.com · https://grudgewarlords.com | `grudge-builder` |
| Forge | https://forge.grudge-studio.com | `grudge-studio-forge` |
| Grok Builder | https://grok-builder.vercel.app | `grok-builder` |
| Open launcher | https://open.grudge-studio.com | `gameopen` (+ CF/edge) |
| Multiverse SPA | https://grudge-multiverse.vercel.app | `grudge-multiverse` (+ own Railway rooms) |
| Character Foundry | https://character.grudge-studio.com | `grudge-character-viewer` / Pages |
| Water island | https://water.grudge-studio.com | `tactical-infinity` (name legacy) |
| Coder | https://coder.grudge-studio.com | CF Pages (not Vercel) |
| Pipeline | https://grudge-pipeline.vercel.app | `grudge-pipeline` |
| Arena | https://arena.grudge-studio.com | `grudge-arena` |
| Armada | https://armada.grudge-studio.com | `grim-armada-web` |
| Survival | https://grudges.grudge-studio.com | `survival` |
| DCQ | https://dcq.grudge-studio.com | `dungeon-crawler-quest` |
| UI editor | https://ui.grudge-studio.com | `grudge-ui-editor` |
| Studio editor | https://studio.grudge-studio.com | `grudge-studio-editor` |
| Info catalogs | https://info.grudge-studio.com | `objectstore-grudge` |
| Drive | https://drive.grudge-studio.com | `grudge-drive` |

## Known dead / do not use in new work

| Host | Why |
|------|-----|
| `grudgedot.vercel.app` | **404** — no production deploy |
| `dash.grudge.studio` | **404** — wrong TLD (not fleet) |
| `builder.grudge-studio.com` | **DNS missing** — use `grok-builder.vercel.app` until CNAME exists |
| `carrier.grudge-studio.com` | **404** |
| `obs.grudge-studio.com` | **unreachable** |
| `tactical-infinity.vercel.app` | Orphan alias — water is **water.grudge-studio.com** only |
| Empty Production URL projects (`david`, `open.grudge-studio.com` project row, `grudge-studio`, `studio`, `mockup-sandbox`, `mage-arena-grudge`) | Not shippable |

## Deploy practices (stop 404 thrash)

### New SPA

```bash
# 1) Create project once (team grudgenexus)
vercel link --scope grudgenexus --project <name> --yes

# 2) Prefer prebuilt for heavy Three/R3F apps (Forge pattern)
npm run build
# vercel.json: installCommand/buildCommand skip OR CI builds with swap
vercel deploy dist --prod --yes --scope grudgenexus

# 3) Only then write the URL into fleet.ts / fleetGames.ts / Open library
```

### Never

- Commit `https://something.vercel.app` when project is not created.
- Point fleet at preview deployment URLs (`*-git-*-grudgenexus.vercel.app`).
- Use machine-local paths in `buildCommand` / `prebuild` for Vercel.
- Keep dual “canonical” URLs for the same game without marking which is production.

### CF edge in front of Vercel (Forge lesson)

- Long-cache `assets/*` + same contenthash with different bytes = sticky broken JS.
- Prefer custom domain short revalidation for SPA shells; force new chunk names after breaking transform changes.
- Purge: `vercel cache purge --project <name> --scope grudgenexus --yes`

## Hygiene cadence

| When | Action |
|------|--------|
| Weekly | `npm run fleet:probe` — fail CI if P0 host ≠ 200 |
| New game | Add row to `fleetGames` + custom domain or explicit `status: planned` |
| Archive | Mark `status: planned` or remove from Play Modes; do not leave 404 URLs |

## Related

- [Systems & APIs](systems-api.md)  
- [ONE TRUTH](one-truth.md)  
- [Admin architecture](admin-architecture.md)  
