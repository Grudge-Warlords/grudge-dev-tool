# Changelog

All notable changes to **grudge-dev-tool** are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.7] — 2026-08-11

### Added
- **Simple video viewer** — reliable HTML5 player: direct `src`, native-controls fallback, volume, Space/F/M keys, dimensions, STREAM badge, system-open on codec fail.
- **AI asset cards** — `asset:understand` IPC builds markdown cards (kind, mime, size, stream, open hints, GLB inspect, optional vision caption). Elite viewer **AI card** / **AI+** and Local Files **AI card** copy to clipboard for agents.

### Fixed
- Elite stream resolve now stamps `stream: true` so audio/video viewers skip full-file waveform/blob paths.

### Changed
- Product **1.0.7**; README media + AI understand notes.

## [1.0.6] — 2026-08-11

### Fixed
- **Audio elite viewer** — stream / large files no longer force full-file waveform decode (which broke or OOM’d long tracks and `grudge-media://` SFX). Playback always uses native `<audio>`; waveform is best-effort under 24 MB.
- **Media type drift** — `isStreamableMediaPath` and viewer extension lists live in `shared/mediaTypes` only; `openFileBridge` + `mediaProtocol` re-use them (no second regex / hardcoded ext set).

### Added
- **Local Files kind chips** — All · Audio · Video · 3D · Image · Design · Text for organizing game media packs; double-click still opens elite viewer (stream for audio/video).
- **Audio transport** — Play/Pause, seek, loop, playback rate (0.5–2×), duration chrome aligned with Video viewer.

### Changed
- Product description / version **1.0.6**.
- README media / double-click / SSOT notes.

## [1.0.5] — 2026-08-08

### Fixed
- **Elite / quick view wrong textures & colors** — `grudge-media` resolves missing maps via sibling `Textures/` / `textures/` / `Maps/` (Kenney-style) with case-insensitive basename match; do not strip in-flight maps; smart-fill uses **role-correct colorSpace** (albedo sRGB, normal/ORM linear).
- **Compressed GLB empty/wrong mesh** — loaders bind **Draco + Meshopt** on every GLTF load.
- **OBJ grey materials** — MTLLoader `setResourcePath` + media protocol for map_Kd next to the model.
- **Windows `npm run dev`** — split tsc watch / electron into concurrent processes (no bash `&`).

### Added
- **More open formats** — VRM (as glTF), HTML/CSS3D preview plane, broader scene JSON (`.gfscene`, `.scene.json`); Forge accept list updated.
- **Safer convert-to-GLB** — `convertToGlb(file, { diskPath })` loads with texture resolution then exports embedded maps for game packs.
- **Env / ONE TRUTH sample** — `.env.example` Multiverse SPA + room, info/ObjectStore, CDN, Forge, Blender toolchain notes; bootstrapEnv also reads Documents secrets + packaged resources `.env`.

### Changed
- Docs: `asset-loader-materials.md` checklist for Kenney textures, Draco, CSS3D preview vs game bake.
- Product description / version **1.0.5**.

## [1.0.4] — 2026-08-03

### Fixed
- **Meshopt GLB load** — Elite/Forge loaders call `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)` before parse. Fixes `THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files` and wrong/missing mesh, colors, textures on grudge-web-v1 optimized assets.
- **Assets search (all Grudge Studio Assets)** — search box on **Assets** queries the full fleet catalog (~6k live index + CDN prod/gltf packages), not only the current folder. ObjectStore `/search` 404 no longer yields empty results.

## [1.0.3] — 2026-08-03

### Fixed
- **Elite Viewer animation review** — selecting a clip now plays that clip exclusively via `setPrimaryAction` (same SSOT as Forge). Previously only toggled `paused` on unstarted actions, so the wrong/no animation showed. Removed multi-clip “Play All” stacking; row click = select & play, click again = pause/resume.
- **Elite Viewer textures / materials / mesh** — local open loads via `diskPath` + `grudge-media` so relative FBX/OBJ/glTF maps and TGA atlases resolve; sibling fill only fills **missing** maps (never overwrites good embeds); broken-map strip no longer removes valid/in-flight textures; OBJ loads sidecar MTL; mesh prep (normals, skinned bounds, author scale preserved — no forced scale=1).

### Changed
- **Docs (systems-api + ai-workers-d1-r2-stream)** — Proved ObjectStore paths (`/api/objectstore/v1/*`); documented 404 list/search; `api.grudge-studio.com` as **legacy live** not DEAD; obs demoted optional; Stream marked planned/partial.
- **uMMORPG → Forge** section + `npm run catalog:ummorpg` (ObjectStore extract + publish).
- **Doctor probes** — critical-only score; health/auth/characters/CDN/Forge/Multiverse/uMMORPG catalogs; optional legacy api + obs (not scored).

## [1.0.2] — 2026-08-01

### Added
- **Single-login SSO handoff** — one Puter/desktop session seeds fleet API bearer and injects `grudge_auth_token` + `grudgeId` into Forge / Coder / Preview / Grok Builder webviews. Settings documents tab→auth matrix; backend modes human-labeled.
- **Elite viewer DCC formats** — open/view **PSD/PSB** (auto composite → PNG via ag-psd), **BLEND** (auto → GLB via Blender toolchain), plus GPU textures (KTX/DDS/HDR), Aseprite, Tiled TMX, VRM/USDZ. DesignViewer fallback + System open. Local Files + Explorer double-click.
- **Workers config audit** — `scripts/audit-workers-config.mjs` + expanded checklist in `docs/ai-workers-d1-r2-stream.md` §8 (compatibility_date, nodejs_compat, observability, Env types, queues, waitUntil). Hardened fleet wrangler.toml for AI hub, CDN, id-gateway, wallet, ObjectStore, observatory, auth-legacy.
- **Databases · sharing · backups** — Pages doc + `scripts/backup-postgres.mjs` (parallel table dumps, meta time T, optional Docker `pg_dump`). Best practices for account/character scopes, R2 offsite dumps, D1/R2 recovery. Inspired by [PlanetScale massively parallel Postgres backups](https://planetscale.com/blog/massively-parallel-postgres-backups).

### Changed
- **Fleet SSOT + docs** — **Grudge Multiverse** live hosts: SPA `grudge-multiverse.vercel.app`, dedicated Railway `grudge-multiverse-room-production` with WS **`/api/mv`** (not Carrier / gameopen). Preview preset, Games catalog, admin hosts, systems-api / one-truth / production-deployment / admin-architecture / Vercel SSOT updated. Multiverse ≠ Metaverse.
- **README** — product cut for 1.0.x, install, single-login, release badges.

## [1.0.1] — 2026-08-01

### Added
- **MP4 / video double-click** — Explorer + Local Files + View Mode open **video player** for mp4, webm, mov, m4v, mkv, avi.
- **`grudge-media://` stream protocol** — large videos/audio stream from disk (no full-file RAM blob).
- **Elite VideoViewer** — play/pause, seek, mute, loop, fullscreen, duration chrome.

### Changed
- File picker filters include **Video** and **Audio** groups.
- Installer associations for m4v / mkv / avi.

## [1.0.0] — 2026-08-01

### Added
- **1.0 product cut** — elite open system + consolidated shell as the stable desktop admin app.

### Changed
- **Animations** — elite / embed 3D viewers play the **primary clip only** (no stacked multi-clip); root-motion strip retained; skeleton helper off by default.
- **Materials / mesh** — stronger sanitize on load (sRGB maps, yellow/black fix, vertex colors, skinned `frustumCulled=false`); local sibling textures via `diskPath` on elite open.
- **Nav 1.0** — primary: Home · Local Files · Assets · Skeleton · Forge · Preview · Games · Agent AI · Settings. More: Upload · View Mode · Grok Builder · Coder · Store · BlenderKit · Docs · Account.
- **Thin tabs hidden** — Search / Request URL / UUID / Legion no longer clutter the sidebar (still mountable; Search→Assets alias; UUID from Settings; Legion from Agent AI).
- **Less debug chrome** — removed DemoModeBanner from Assets / Search / Upload / Request when online path is fine.

### Fixed
- Multi-animation “broken dance” in pop-out / View Mode previews.
- Skeleton debug lines always-on in Model3DViewer.

## [0.9.9] — 2026-08-01

### Added
- **Elite local open system** — Explorer double-click / Open with → always-on-top Asset Viewer (3D, image, audio, video, text, PDF). Not Forge.
- **Local Files tab** — folder browser on disk; double-click opens elite viewer; Forge is explicit only.
- **Settings → Set as default for all asset types** — HKCU ProgIDs + Capabilities for all viewer extensions; opens Windows Default apps for residual confirmations.
- **info.grudge-studio.com chrome icons** — SSOT `src/shared/infoIcons.ts` for nav, Local Files kinds, Settings, Elite Viewer badges (never rewrite info→assets).
- **fileAssociations** expanded for images, audio, video, json, pdf, md, txt (installer).

### Changed
- **Nav consolidation** — primary rail: Home · Local Files · Assets · Skeleton · Forge · Preview · Games · Agent AI · Settings. Demoted Grok Builder / Search / Store / BlenderKit / Request / UUID / Legion / Coder / View Mode to More (still wired, not blank).
- **Route aliases** — `/local-assets`→`/local`, `/playcanvas`→`/games`, `/viewer`→`/view`.
- **Studio Hub** primary chips match real daily loop (Local Files first; drop dead View/Builder chips from primary).
- **Product name** — installer/shortcut **Grudge Dev Tool** (elite viewer app identity).
- OS open no longer auto-navigates to Forge (`openFileBridge` owns argv / second-instance).

### Fixed
- **Import colors** — stop forcing gold/yellow on drag-drop / open; preserve material + vertex colors; white base when albedo maps exist.
- **Local textures** — on import, scan same folder + pack roots (`textures/`, `maps/`, …) and auto-apply PBR maps via IPC `listSiblingTextures` / `readLocalImage`.
- **Selection pulse** — weaker gold emissive, auto-clears so assets don't stay yellow.

## [0.9.8] — 2026-07-31

### Added
- **Skeleton Studio wizard** — step tabs run real actions (extract / T-pose / place / export); drag-drop FBX/GLB; Blender/FBX2glTF readiness strip; Assets → Skeleton handoff.
- **Assets → Skeleton** — Bone button on 3D preview downloads CDN model and opens Skeleton Studio.
- **Vercel fleet SSOT** — `docs/VERCEL_FLEET_SSOT.md` + `npm run fleet:probe:vercel` (P0 host probe).
- **Grok Builder webview** — full-height Electron embed of `grok-builder.vercel.app` (same pattern as Forge).

### Changed
- **Home primary actions** — Assets → Skeleton → Forge → Preview → Grok Builder → Upload → Games → AI.
- **Nav** — Skeleton + Grok Builder on primary rail; full-height for builder/upload.
- Fleet play URLs prefer custom domains (arena / armada); grudgedot dead URL removed.

## [0.9.7] — 2026-07-31

### Added
- **Admin architecture SSOT** — `src/shared/adminSurfaces.ts`, `docsCatalog.ts`, `docs/admin-architecture.md`, `docs/systems-api.md`.
- **Preview play mode** — fleet client presets (open · client · water · GRUDOX) + Forge `sceneId`/`glb` handoff.
- **Coder hybrid** — production embed of `coder.grudge-studio.com` + local PTY server panel.
- **Docs catalog UI** — full `docs/` set matching GitHub Pages (same source).
- **GitHub Pages refresh** — all docs linked to current fleet APIs; front matter for Jekyll nav.
- **Material sanitize** (`materialSanitize.ts`) — fixes yellow/black/sludge imports: sRGB maps, metalness cap, default-yellow replace, broken 1×1 map strip, Phong→Standard.
- **Magic-byte mesh gate** (`magicBytes.ts`) — reject HTML error pages and non-`glTF` stubs on load and ingest.
- **prod/gltf R2 layout** (`prodGltf.ts`) — ingest suggests `prod/gltf/<category>/<name>.glb` + CDN URL + D1 registry row.
- **Production packages catalog** (`prodPackages.ts`) — live CDN packages/prefabs for grudge6 races, fantasy weapons, skeletons, armada.
- **ObjectStore registry seed** — `os.writeManifest` / `os.registerAsset` IPC after fleet deploy.
- **Blender convert** packs external images + neutralizes yellow/black materials before GLB export.
- **TGA LoadingManager** on FBX/GLTF loaders (Unity Toon RTS atlases no longer black).
- Docs: `docs/asset-loader-materials.md`, `docs/packages/`.

### Changed
- **Forge** tab: Play test → Preview; chrome states R3F+Rapier DNS parity; local tools secondary only.
- **Studio Hub**: admin systems chips (ENGINE, info.*, open, GRUDOX, Coder, Builder); Preview in primary actions.
- **Assets / Store / UUID / Legion / Skeleton** copy aligned with production CDN/convert/Legion contracts.
- **fleetConnections**: info.*, ENGINE portal, open, GRUDOX, carrier, builder, foundry, observatory.
- **bestPractices**: forge DNS parity, preview, skeleton/store/BlenderKit, docs same-source.
- GitHub Pages `index.md` / `production-deployment.md` / `_config.yml` refreshed to current admin model.
- Upload default prefix → `prod/gltf/misc/` with optional pre-ingest pass.
- Model3DViewer uses `loadModelFromUrl` + material fix badges.
- `deployToFleet` sanitizes materials, asserts magic bytes, prefers prod/gltf, seeds registry.
- Loaders merge: diskPath sibling textures + magic-byte gate + material sanitize + TGA.

## [0.9.6] — 2026-07-29

### Added
- **Free agentic cascade** — Ollama → **Puter User-Pays AI** (signed-in session) → env OpenAI/Anthropic/Gemini → Workers AI → Legion.
- **Env secret bake-in** — loads `.env` from package, home, Desktop, AppData; seeds keytar automatically (CF, R2, Legion, LLM keys). No Settings paste required.
- **Puter AI main-process client** — OpenAI-compatible `api.puter.com` using session token.

### Changed
- Login copy emphasizes free Puter AI + identity.
- Agent AI UI documents free cascade and auto secrets.

## [0.9.5] — 2026-07-29

### Fixed
- **Agent AI in-app** — no browser dependency; `agent:run` / `agent:orchestrate` / `agent:chat` via Ollama → Workers AI → Legion.
- **Ollama host** — normalize `0.0.0.0:11434` / missing scheme to `http://127.0.0.1:11434` (fixes `Failed to parse URL from 0.0.0.0:11434/api/tags`).
- **Legion chat** — hub/agent failure falls back to local agent stack.
- **GRUDA Hub optional** — projects/agent work offline with local identity + local AI.
- Agent AI UI: **Start local AI** button; removed "Open full GRUDA Agent" external browser link.

[1.0.5]:      https://github.com/Grudge-Warlords/grudge-dev-tool/releases/tag/v1.0.5

