---
layout: default
title: Admin architecture
nav_order: 3
description: Grudge Dev Tool as the desktop admin shell — Forge, Preview, Coder, Assets, systems wired to production DNS.
permalink: /admin-architecture.html
---

# Admin architecture (Dev Tool SSOT)

**Product:** **Grudge Dev Tool** (`com.grudgestudio.devtool`) — desktop **admin** shell for the fleet.  
**Rule:** Tabs embed or call the **same production hosts** used on DNS. No parallel editors, no orphaned Vercel play URLs. **Forge** is one tab (live `forge.grudge-studio.com`), not the product name.

Code SSOT: `src/shared/adminSurfaces.ts` · `src/shared/fleet.ts` · `src/shared/docsCatalog.ts` · `src/shared/bestPractices.ts`.

---

## One shell, production sources

| Tab | Kind | Production source | Role |
|-----|------|-------------------|------|
| **Home** | system | ONE TRUTH probes | Command center + admin system chips |
| **Assets** | hybrid | `assets` + ObjectStore + `info.*` | R2 tree, `>query` Agent search, always-on-top Viewer, send GLB → Forge |
| **Forge** | **embed-prod** | **https://forge.grudge-studio.com** | Same SPA as DNS — R3F + **Rapier** + AI Worker + three.js editor parity |
| **Local tools** | local | `/forge-local` | Pop-out, glTF helpers, convert — **not** a second editor SSOT |
| **Preview** | hybrid | open · client · water · GRUDOX · Multiverse · warlords | Fleet **webview** playtests — `sceneId` / `glb` deep-links |
| **Play** | local-tool | Toon `{race}.glb` + SceneEngine | Native Three.js player — WASD, one mixer, video, scripts |
| **Coder** | hybrid | **https://coder.grudge-studio.com** + optional local PTY | Same Pages SPA; local for full FS/agent |
| **Skeleton** | local | convert + CDN | Mixamo-25 → T-pose → retarget → **grudge-convert** → R2 |
| **Store** | hybrid | ObjectStore + info.* | Catalog packs / prefabs |
| **BlenderKit** | local | daemon → convert | Ingest only — never production mesh SSOT |
| **UUID** | system | `shared/grudgeUUID.ts` | Generate/parse only — agents must not invent formats |
| **Legion Chat** | hybrid | **https://ai.grudge-studio.com** | Fleet Legion — **≠** Coder AI hub worker |
| **Agent AI** | local | Ollama + Legion + tools | Make & deploy; same CDN/convert contracts |
| **Plugin host** | local loopback | `127.0.0.1:17380` | VS Code + standalone + viewer + CLI attach — not a second product |
| **Docs** | docs | repo `docs/` → GitHub Pages | Same Markdown as this site |

---

## Forge = DNS (hard rule)

```
Dev Tool /forge  ──webview──►  https://forge.grudge-studio.com
                                      │
                                      ├── R3F viewport + Rapier physics
                                      ├── Command stack / hierarchy / loaders
                                      ├── ObjectStore + assets CDN meshes
                                      └── AI Worker tools (list practices, search assets, …)
```

- Repo of the SPA: `F:\GitHub\Grudge-Studio-Forge` (skill **`forge-editor`**).  
- Dev Tool does **not** fork a second production editor.  
- **Play test** button → **Preview** with open/client/water/GRUDOX/Multiverse.  
- **Native Three Play** (`/play`) walks a Toon kit on SceneEngine (WASD, one mixer). Not a second editor.  
- Production bake for fleet ships remains **`grudge-convert`** → R2 → D1/ObjectStore seed (skill **`grudge-asset-convert`**).

---

## Preview play-mode loop

1. Edit scene on Forge (`edit=1&from=grudge-dev-tool`).  
2. Note `sceneId` and optional CDN `glb`.  
3. **Play test** or open **Preview**.  
4. Load target:

| Preset | Host |
|--------|------|
| Open launcher | `https://open.grudge-studio.com` |
| Client play | `https://client.grudge-studio.com` |
| Water island | `https://water.grudge-studio.com` |
| GRUDOX | `https://grudox.grudge-studio.com` |
| Multiverse | `https://grudge-multiverse.vercel.app/#room1` |
| Warlords | `https://grudgewarlords.com` |

Never: `tactical-infinity.vercel.app`, `api.grudge-studio.com`, raw R2 public URLs in clients.  
Multiverse rooms: own Railway `…/api/mv` — **not** Carrier.

---

## Systems map (admin connections)

| Layer | Host | Use in Dev Tool |
|-------|------|-----------------|
| ONE TRUTH API | `client.grudge-studio.com` | Settings base · doctor · rewrites |
| Auth | `id.grudge-studio.com` | **Grudge ID** sign-in (product login) |
| Account cloud | `ai.grudge-studio.com/puter-space` | Puter FS + site deploy — never bag/roster |
| Game data | Railway `grudge-api-production-0d46` | Characters / bag / wallet SSOT |
| Portal / ENGINE | `grudge-studio.com` | Identity shell (not game-data) |
| Catalogs | `objectstore.grudge-studio.com/api/v1` + `info.grudge-studio.com/api/v1` | JSON definitions |
| Binaries | `assets.grudge-studio.com` | GLB / tex / audio CDN |
| Legion AI | `ai.grudge-studio.com` | Chat, roles, agent tools |
| Forge | `forge.grudge-studio.com` | Scene edit |
| Coder | `coder.grudge-studio.com` | Vibe IDE |
| Pipeline | `grudge-pipeline.vercel.app` | Ingest → bake handoff |
| Builder | Grok Builder URL in `FLEET_URLS.grokBuilder` | Agentic Three/Rapier builder |
| Open / GRUDOX / Water / Multiverse | open · grudox · water · multiverse | Live play + Preview |
| Multiverse rooms | `grudge-multiverse-room-production` | WS `/api/mv` (dedicated Railway) |

Full fleet inventory: skill **`grudge-fleet`**. Deploy how-to: **`grudge-stack`**. Live rooms: **`grudge-live-servers`**.

---

## glTF / convert (better path)

| Stage | Tool | Where |
|-------|------|--------|
| Interactive cleanup | Blender MCP | optional |
| Production bake | **grudge-convert** CLI | ObjectStore tools / Upload tab / agents |
| Optimize | Draco / Meshopt / WebP | convert pipeline |
| Verify | Magic bytes + SI scale (~1.8 m human) | ingest modules |
| Index | D1 / ObjectStore registry | after R2 PUT |
| View | Asset Viewer (always on top) | Assets tab click |
| Edit | Forge production SPA | Forge tab |

In-app Forge local tools may import FBX/OBJ for convenience; **shipping** always goes through convert + CDN.

---

## GitHub Pages (this docs site)

| Item | Value |
|------|--------|
| Workflow | `.github/workflows/pages.yml` |
| Source | `docs/` Jekyll (just-the-docs) |
| URL | https://grudge-warlords.github.io/grudge-dev-tool/ |
| In-app | Docs tab → `src/shared/docsCatalog.ts` lists the same files |

**Best practice:** edit Markdown in `docs/` only; never maintain a second HTML tree. Push to `main` → Pages rebuild. Keep version stamps aligned with `package.json` / Releases.

---

## Coder vs Legion (do not merge)

| Surface | Host | Role |
|---------|------|------|
| **Legion** | `ai.grudge-studio.com` | Fleet chat, agent roles, image |
| **Coder** | `coder.grudge-studio.com` | IDE SPA + optional local Express |
| **Coder AI hub worker** | GrudachainCode `workers/ai-hub` | Event/job ingest only |
| **Dev Tool Agent AI** | Ollama + Legion tools | Desktop make & deploy |

---

## Autonomous / agent contracts

Agents in Dev Tool must:

1. Resolve meshes via ObjectStore / D1 / CDN — never invent paths.  
2. Prefer `>query` server search for assets.  
3. Bake with grudge-convert before R2.  
4. Open 3D in Forge via **CDN URL**.  
5. Playtest via **Preview**, not random localhost games.  
6. Use `client.grudge-studio.com` as API base — never `api.grudge-studio.com`.

Prompt SSOT: `agentBestPracticesPrompt` in `src/shared/bestPractices.ts`.

---

## Related docs

- [Production deployment](production-deployment.md)  
- [ONE TRUTH](one-truth.md)  
- [AI · D1 · R2 · Stream](ai-workers-d1-r2-stream.md)  
- [Object storage](object-storage.md)  
- [Skeleton Studio](skeleton-studio.md)  
- [Dev Tool quickstart](dev-tool-quickstart.md)  
