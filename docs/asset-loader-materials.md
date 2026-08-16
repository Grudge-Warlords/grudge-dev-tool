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
| Black cube / crash | HTML error page served as `.glb` | Magic-byte gate (`glTF` header); refuse `<!DOCTYPE` + Content-Type text/html |
| `unknown magic [7b a 20 20]` | JSON starts with `{\n  ` but not glTF, or old probe missed late `"asset"` | Scan 64–256 KiB for glTF markers; reject JSON error stubs; open multi-file `scene.gltf` with diskPath |
| Random / wrong PNGs | Sibling fill overwrote embeds or bare folder maps | `onlyMissingMaps` + role-tag / high affinity score; never overwrite usable maps |
| Missing colors on `scene.gltf` | Blob load lost relative `.bin`/textures | Elite open via `grudge-media` + LoadingManager URL rewrite; optimize from original path (do not copy .gltf alone) |

## Pipeline (ingest)

```
size-verify → convert (FBX2glTF / Blender pack images)
  → magic-byte assertMeshFile
  → enrich / rig
  → suggest r2Key = prod/gltf/<category>/<name>.glb
  → D1/ObjectStore registry row
  → signed R2 PUT → os.registerAsset / writeManifest
```

## Multi-canvas previews (Model3DViewer)

Pattern: [three.js multi-canvas](https://threejs.org/examples/?q=web%20canvas#webgpu_multiple_canvas) /
`webgl_multiple_elements` — **one WebGLRenderer**, many display canvases.

| Surface | Implementation |
|---------|----------------|
| Inline panel / grid (`Model3DViewer`) | `lib/forge/multiCanvasHub.ts` — shared GL, blit to 2D canvas, IntersectionObserver skip off-screen |
| Pop-out Elite Viewer (`ViewerWindow`) | Dedicated `SceneEngine` (tools, gizmo, screenshot) |

Prevents N WebGL contexts (black frames, context loss, yellow sludge when many previews open).

## Runtime loaders (renderer)

- `loadModel(file, { diskPath })` — TGA handler, **Draco + Meshopt + KTX2** via `gltfProdLoader` (same factory as ThreeFlow r185 — bundled WASM, no gstatic/jsDelivr), magic bytes for GLB/glTF, `sanitizeMaterials`
  - **Local / Elite open:** when `diskPath` is set, model loads via `grudge-media://` so FBX/OBJ/glTF **relative textures** resolve next to the file (not lost on blob:).
  - LoadingManager URL modifier rewrites relative map paths → `grudge-media://local/?path=…`
  - **mediaProtocol fallback:** if path 404s, search `Textures/`, `textures/`, `Maps/`, parents (Kenney packs)
  - Sibling fill (`finishImportedAsset`) only **fills missing** maps — never overwrites good embedded atlases; bare random PNGs need high name affinity
  - **Formats:** glb/gltf/**bin** (resolves sibling scene.gltf), vrm, obj+mtl, fbx, stl, ply, dae, 3mf, **three-json** / ObjectLoader / **forge-scene** / gfscene, **html/css3d** (preview plane)
  - **Scene open SSOT:** `shared/sceneKinds.ts` + `forge.resolveSceneOpenPath` — `.bin` → sibling `.gltf`; JSON sniffs glTF / Three ObjectLoader / Forge entities
- `loadModelFromUrl(url)` — fetch + Content-Type gate + magic + sanitize (Model3DViewer, CDN); remote `.gltf` sets `resourceDir` to parent URL
- `optimizeWebFile` / Elite **Optimize for web** — magic gate first; multi-file `.gltf` optimizes from **original path** (embeds into `.web.glb`)
- `convertToGlb(file, { diskPath })` — convenience only: `loadModel` (production factory) → GLTFExporter **embedImages**. Production bake = main `convertFile` (FBX2glTF / Blender) + `optimizeWebFile`.
- Live editors: **ThreeFlow** `?asset=` (best scene) · **Forge** `?asset=`/`?mesh=` (R3F deploy). SSOT `shared/editorHandoff.ts`.
- `applySmartTextures({ onlyMissingMaps: true })` — sibling atlas fill; **role-correct colorSpace** (albedo sRGB, normal/ORM linear)
- `bindAtlasToRoot` — grudge6 single-atlas pattern
- **npm SSOT for mesh pipeline:** `three`, `meshoptimizer`, `@gltf-transform/core|extensions|functions`, `sharp` (textureCompress)

### Elite Viewer color / mesh checklist

| Symptom | Fix path |
|--------|----------|
| Wrong / random textures on GLB | `onlyMissingMaps` (never overwrite embeds with sibling PNGs) |
| Kenney pink/missing maps | mediaProtocol texture fallback + `Textures/` dir search |
| FBX yellow / no atlas | `diskPath` + `grudge-media` relative TGA/PNG + sanitize yellow |
| Black silhouette | ambient boost in Elite Viewer + metalness cap in sanitize |
| Scrambled sRGB / muddy normals | baseColor → sRGB; data maps → NoColorSpace |
| Draco/Meshopt empty mesh | GLTFLoader setDRACOLoader + setMeshoptDecoder |
| Tiny / giant mesh after open | keep author root scale (do not force `scale=1`) |
| OBJ grey / no maps | sidecar `.mtl` via MTLLoader + `setResourcePath` + sibling fill |
| Flat / black mesh | `prepareMeshes` normals + skinned `frustumCulled=false` |
| HTML open fails | css3d format → preview plane (not game bake) |

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
