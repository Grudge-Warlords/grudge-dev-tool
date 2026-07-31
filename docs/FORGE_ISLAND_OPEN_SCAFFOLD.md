---
layout: default
title: Forge islands
nav_order: 17
---
# Forge + Island open scaffold (Grudge Dev Tool)

## Goals

1. **Open islands** (home generator, home play, lobby, faction, event, boss) from Grudge Dev Tool  
2. **Primary editor** = production **Forge** at https://forge.grudge-studio.com  
3. **Secondary** = local Forge 3D tools (`/forge-local`) for CDN mesh inspect  
4. **Import improvements** from `F:\GitHub\Grudge-Studio-Forge\Grudge-Studio-Forge`

## Architecture

```
Dev Tool Islands tab
        │
        ├─ Forge studio  → forge.grudge-studio.com?island=&mesh=&playUrl=
        ├─ Local mesh    → forge.openRemote(primaryMesh) → /forge-local
        └─ Play          → client/water playUrl
```

## Catalog SSOT

`src/shared/islandDeployments.ts`

| Kind | Examples |
|------|----------|
| `home_generator` | Home island seed/spec + example_home_island.glb |
| `home_play` | water.grudge-studio.com |
| `lobby` | pirate-islands scene.glb, Shipwreck Cove |
| `faction` | 6 race capitals on lobby border |
| `event` | Lyoko ethereal, spiral mountain |
| `boss` | Hoth boss room, Iceland cinematic |
| `open_world` | Haven Shore sector |

Aligned with GrudgeBuilder:

- `homeIslandSpec.ts` / `homeIslandSeed.ts`
- `lobbyIslands.ts` / `factionLobbyIslands.ts`
- `floatingIslandBossAssets.ts`

## Open APIs

| Module | Role |
|--------|------|
| `src/renderer/lib/forge/openIsland.ts` | openIslandInForgeStudio / Forge3D / Play |
| `src/renderer/lib/forge/openGame.ts` | re-exports island helpers |
| `src/renderer/lib/forge/fileKind.ts` | Forge fileKind port (glb/zip/gfscene) |
| `src/renderer/lib/forge/forgeStudioImports.ts` | Import scaffold checklist |

## UI

- **Forge tools** (`/forge-local`) Workbench → **Islands** tab  
- Empty selection still lists first islands for one-click open  
- Deploy path button sets R2 prefix for generator bake outputs  

## Forge Studio review (what we import from)

Upstream root: `Grudge-Studio-Forge/Grudge-Studio-Forge`

| Upstream | Dev Tool status |
|----------|-----------------|
| `fileKind.ts` | **ported** |
| Island catalog + open | **ported** |
| `.gfscene.json` full entity import | **scaffold** (extend sceneSerializer) |
| `zipImport.ts` | **planned** |
| `loadTemplate` streaming | **remote_only** (use production Forge) |
| `proceduralTerrain` / home seed | **scaffold** |
| `commands.ts` CommandStack | **scaffold** (history.ts align) |
| Rapier layers local | **planned** (physics stays on Forge live) |

## Deploy prefixes (generator outputs)

| Island | R2 prefix |
|--------|-----------|
| Home generator | `models/environment/water/` |
| Pirate lobby | `models/lobby/pirate-islands/` |
| Faction race | `models/islands/faction/{race}/` |
| Event Lyoko | `models/biomes/ethereal/` |
| Event spiral | `models/biomes/event/` |
| Boss Hoth | `models/biomes/frozen/` |

## Agent checklist

```
[ ] Islands tab lists home + lobby + 6 faction + event + boss
[ ] Forge studio opens external forge.grudge-studio.com with mesh query
[ ] Local mesh loads GLB in /forge-local
[ ] Play opens client/water URL
[ ] Deploy path sets r2Path for upload
[ ] No tactical-infinity.vercel.app for water home
[ ] Pirate mesh key = models/lobby/pirate-islands/scene.glb
```

## Next ports (priority)

1. Parse `.gfscene.json` entities into local SceneEngine  
2. ZIP pack extract → multi-mesh load  
3. Home island seed → heightfield preview panel  
4. AI Workspace buttons for `openIslandInForgeStudio`  
