---
layout: default
title: Grok Builder
nav_order: 18
---
# Grok Builder (primary agentic editor)

**Repo:** `F:\GitHub\grok-builder`  
**Open card:** `gameopen` → `gameLibrary` id `grok-builder`  
**Dev Tool route:** `/builder` (nav: **Grok Builder**)

## What it is

Grok-powered **Three.js + Rapier** scene editor with:

- Fleet **asset search** (ObjectStore / D1 index → R2 CDN binaries)
- **Agent tools** (spawn mesh/primitive, physics, scene summary, clear)
- CF Worker proxy for **xAI Grok** (`XAI_API_KEY` never in the browser)
- Embed mode for this Dev Tool (`?embed=1&from=grudge-dev-tool`)

## vs Forge

| Surface | Use |
|---------|-----|
| **Grok Builder** (`/builder`) | Agentic build, fleet assets, Open deploy path |
| **Forge** (`/forge`) | Production map/scene editor @ forge.grudge-studio.com |
| **Forge tools** (`/forge-local`) | Local mesh paint / convert / R2 upload workbench |

## Local run

```bash
cd F:\GitHub\grok-builder
npm install
npm run dev
# http://localhost:5190
```

In Dev Tool → **Grok Builder** → set URL to `http://localhost:5190` if not already.

## Agent worker

```bash
cd F:\GitHub\grok-builder
npm run worker:dev
# secret:
npx wrangler secret put XAI_API_KEY --config worker/wrangler.toml
npm run worker:deploy
```

Without a key, the SPA uses a **local heuristic agent** (pirate lobby, search, boxes, physics).

## Deploy for Open

```bash
cd F:\GitHub\grok-builder
npm run build
npx vercel deploy --prod --yes
# Align FLEET_URLS.grokBuilder + gameLibrary url if host changes
# Redeploy open.grudge-studio.com for library card
```

## Kenney UX (cursors + sounds)

Source: `D:\kenney-assets\organized` → CDN `assets.grudge-studio.com/cursors|audio/kenney/…`

| Surface | Cursor | Sound |
|---------|--------|-------|
| Editor default | pointer-b | soft click |
| Deploy | tool-wrench | door open / bell |
| AI connect | message-dots / cogs | coins / soft / bell / metal |
| Locked / unlocked | lock / lock-unlocked | door close / open |
| Options | cursor-menu | book open/close |
| Game flow | gauntlet / target / doors | announcer + results VO |

In Grok Builder: **Kenney** tab + **Export UX Kit** for editable per-game JSON.

## Skills

`grudge-studio` → `grudge-3d-game-packages` → `grudge-live-servers` → `forge-editor` (parity DNA) → `build-with-ai` (xAI / SpaceXAI) · `kenney-pixel-ui` (related UI tiles).
