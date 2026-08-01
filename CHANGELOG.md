# Changelog

All notable changes to **grudge-dev-tool** are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
