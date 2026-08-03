---
layout: default
title: Asset loader
nav_order: 13
---
# Asset loader · materials · prod/gltf · D1

Grudge Dev Tool (v0.9.6+) production import path.

## Why assets look yellow or black

| Symptom | Cause | Fix in this tool |
|--------|--------|------------------|
| Yellow / sludge kit | FBX default color, missing atlas | Convert packs textures; `sanitizeMaterials` replaces default yellow; re-bake with atlas |
| Pure black silhouette | `metalness=1` + no IBL, or missing map | Cap metalness, brighter ambient in viewers, strip 1×1 maps |
| Scrambled colors | Wrong `colorSpace` / `flipY` | Base color → sRGB; data maps → NoColorSpace; GLB/FBX flipY=false |
| Black cube / crash | HTML error page served as `.glb` | Magic-byte gate (`glTF` header); refuse `<!DOCTYPE` |

## Pipeline (ingest)

```
size-verify → convert (FBX2glTF / Blender pack images)
  → magic-byte assertMeshFile
  → enrich / rig
  → suggest r2Key = prod/gltf/<category>/<name>.glb
  → D1/ObjectStore registry row
  → signed R2 PUT → os.registerAsset / writeManifest
```

## Runtime loaders (renderer)

- `loadModel(file, { diskPath })` — TGA handler, magic bytes for GLB, `sanitizeMaterials`
  - **Local / Elite open:** when `diskPath` is set, model loads via `grudge-media://` so FBX/OBJ/glTF **relative textures** resolve next to the file (not lost on blob:).
  - LoadingManager URL modifier rewrites relative map paths → `grudge-media://local/?path=…`
  - Sibling fill (`finishImportedAsset`) only **fills missing** maps — never overwrites good embedded atlases
- `loadModelFromUrl(url)` — fetch + magic + sanitize (Model3DViewer, CDN)
- `applySmartTextures({ onlyMissingMaps: true })` — sibling atlas fill (`textureFinder.ts`); TGA via `TGALoader`
- `bindAtlasToRoot` — grudge6 single-atlas pattern

### Elite Viewer color / mesh checklist

| Symptom | Fix path |
|--------|----------|
| Wrong / random textures on GLB | `onlyMissingMaps` (never overwrite embeds with sibling PNGs) |
| FBX yellow / no atlas | `diskPath` + `grudge-media` relative TGA/PNG + sanitize yellow |
| Black silhouette | ambient boost in Elite Viewer + metalness cap in sanitize |
| Scrambled sRGB | baseColor → sRGB; data maps → NoColorSpace |
| Tiny / giant mesh after open | keep author root scale (do not force `scale=1`) |
| OBJ grey / no maps | sidecar `.mtl` via MTLLoader + sibling fill |
| Flat / black mesh | `prepareMeshes` normals + skinned `frustumCulled=false` |

## R2 layout (SSOT)

```
prod/gltf/characters/*.glb
prod/gltf/weapons/*.glb
prod/gltf/enemies/*.glb
prod/gltf/props|nature|buildings|vfx|scenes|misc/*.glb
```

CDN: `https://assets.grudge-studio.com/prod/gltf/...`

## D1 role

D1 / ObjectStore is the **asset index** only (keys, uuid, sha, category).  
Player bag/XP remains Railway Postgres — never write heroes into D1.

Seed after upload via:

- `window.grudge.os.registerAsset(row)`
- or `window.grudge.os.writeManifest({ packId, version, entries })`

## Production packages + prefabs (live CDN)

| Catalog | URL |
|---------|-----|
| Packages | https://assets.grudge-studio.com/manifests/grudge-prod-packages.json |
| Prefabs | https://assets.grudge-studio.com/manifests/grudge-prod-prefabs.json |
| Asset index | https://assets.grudge-studio.com/manifests/assets-gltf-index.json |

**Yellow-fixed races (atlas bake):**  
`prod/gltf/characters/{wk,brb,elf,dwf,orc,ud}_characters.glb` + `human.glb`

**Fantasy weapons:**  
`prod/gltf/weapons/{sword,bow,staff,dagger,axe,hammer,mace}.glb`

Code SSOT in Dev Tool: `src/shared/prodPackages.ts` (`GRUDGE6_PROD_GLTF`, `FANTASY_WEAPON_PROD_GLTF`, `fetchProdPackages`).

Rebuild from ObjectStore:

```bash
cd ObjectStore
npm run packages:prod:upload
npm run build:weapon-prefabs
node scripts/wire-prod-gltf-weapon-prefabs.mjs
```

## Related skills

- `grudge-asset-convert` — production bake CLI
- `grudge-d1-r2` — registry topology
- `grudge-character-correctness` — yellow atlas rules
- ObjectStore `scripts/build-prod-gltf-packages.mjs` — packages + yellow re-bake
- ObjectStore `scripts/assets-to-gltf-pipeline.mjs` — batch prod/gltf
