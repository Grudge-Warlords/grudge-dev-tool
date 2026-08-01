---
layout: default
title: Production deployment
nav_order: 2
description: ONE TRUTH production deploy map for Grudge Dev Tool, Forge, AI workers, Pages, and fleet hosts.
---

# Production deployment (canonical)

**Mission:** successful production on all Grudge Studio hosts — no parallel redesigns.  
**Admin shell:** Dev Tool embeds production Forge/Coder and previews live clients — see [Admin architecture](admin-architecture.md).

## ONE TRUTH hosts

| Layer | Host | Role |
|-------|------|------|
| Auth gateway | `https://id.grudge-studio.com` | Grudge ID JWT, Discord SSO |
| Game data SSOT | `https://grudge-api-production-0d46.up.railway.app` | Railway Postgres |
| Fleet client | `https://client.grudge-studio.com` | Vercel rewrites → auth + Railway + objectstore |
| Portal / ENGINE | `https://grudge-studio.com` | The-ENGINE shell (not game-data SSOT) |
| ObjectStore | `https://objectstore.grudge-studio.com/api/v1` | JSON catalogs |
| info.* catalogs | `https://info.grudge-studio.com/api/v1` | Live definitions (often fuller) |
| Assets CDN | `https://assets.grudge-studio.com` | R2 binaries |
| Legion AI | `https://ai.grudge-studio.com` | Fleet AI hub (≠ Coder AI worker) |
| Forge editor | `https://forge.grudge-studio.com` | **Same SPA as Dev Tool Forge tab** (R3F + Rapier) |
| Coder IDE | `https://coder.grudge-studio.com` | Vibe IDE (Dev Tool Coder tab) |
| Pipeline | `https://grudge-pipeline.vercel.app` | Ingest → bake handoff |
| Open launcher | `https://open.grudge-studio.com` | Canonical library / Preview target |
| GRUDOX | `https://grudox.grudge-studio.com` | Rooms + Carrier edge |
| Multiverse SPA | `https://grudge-multiverse.vercel.app` | Bermuda island MP (grudge6) |
| Multiverse rooms | `https://grudge-multiverse-room-production.up.railway.app` | Dedicated Railway — WS `/api/mv` |
| Water island | `https://water.grudge-studio.com` | Home island production |
| Dev Tool docs | [`grudge-warlords.github.io/grudge-dev-tool`](https://grudge-warlords.github.io/grudge-dev-tool/) | This site (GitHub Pages = `docs/`) |
| Local Ollama | `http://localhost:11434` | **GRUDACHAIN** Docker / native agentic AI |

**Never use** `api.grudge-studio.com` for new wiring (deprecated split-brain).

**Docs site pages (all from `docs/`):** [Home](./) · [Systems & APIs](systems-api.md) · [Admin architecture](admin-architecture.md) · [ONE TRUTH](one-truth.md) · [Databases · sharing · backups](database-backups-sharing.md) · [API reference](api-reference.md) · [Object storage](object-storage.md) · [AI · D1 · R2 · Stream](ai-workers-d1-r2-stream.md) · [Quickstart](dev-tool-quickstart.md) · [CLI](cli-quickstart.md).

### Database backups (ops)

```powershell
# Player SSOT — parallel logical dump (requires DATABASE_URL + npm i -D pg)
$env:DATABASE_URL = "<Railway Postgres public URL>"
npm run backup:postgres
# → backups/<stamp>/meta.json + tables/*.jsonl.gz   (gitignored)

# Optional full custom dump via Docker
npm run backup:postgres -- --pg-dump
```

Full map (sharing scopes, RPO, D1/R2 recovery, PlanetScale-inspired growth path):  
[Databases · sharing · backups](database-backups-sharing.md).

## Secrets (Windows Credential Vault + CI)

| Secret group | Storage | Used by |
|--------------|---------|---------|
| R2 S3 (`OBJECT_STORAGE_*`) | keytar / `npm run secret:import` | Upload, browse, packs |
| CF AI (`CF_AI_*`, `CF_ACCOUNT_ID`) | keytar | Workers AI / AI Gateway |
| Legion (`GRUDGE_AI_KEY`, `GRUDGE_LEGION_HUB`) | keytar / env | ai.grudge-studio.com |
| Puter (`puter-token`) | keytar after browser login | User-pays cloud |
| Grudge ID JWT | keytar / localStorage keys | Account + characters |
| Ollama (`OLLAMA_HOST`, `GRUDACHAIN_OLLAMA_*`) | env / electron-store | Local agentic AI (container `GRUDACHAIN`) |

```powershell
# Import production block (never commit .env with real secrets)
npm run secret:import -- "$env:USERPROFILE\secrets\grudge-production.env"
npm run secret:verify
```

See [production-config.md](production-config.md).

## GitHub best practices (this repo)

| Practice | Implementation |
|----------|----------------|
| Pages | `.github/workflows/pages.yml` — Jekyll from `docs/` on `main` |
| Releases | `.github/workflows/release.yml` — tag `v*.*.*` → electron-builder → GH Release |
| PR CI | `.github/workflows/build.yml` — typecheck + Windows package artifact |
| Fleet CI | `.github/workflows/fleet-probe.yml` — probe live ONE TRUTH hosts |
| CODEOWNERS | `CODEOWNERS` |
| Secrets | Never in repo; keytar + GitHub Actions secrets only |
| Installer | `electron-builder.yml` → `release/*Setup*.exe` + `latest.yml` auto-update |

### Pages base path

`docs/_config.yml`:

```yaml
url: "https://grudge-warlords.github.io"
baseurl: "/grudge-dev-tool"
```

Repo Settings → Pages → **GitHub Actions** (not branch deploy).

## Desktop Forge release (package **v1.0.1** — check Releases for latest tag)

```powershell
npm ci --legacy-peer-deps
npm run typecheck
npm run package:ci      # NSIS installer → release/
# or tagged release (CI + local artifact):
git tag v1.0.1 && git push origin v1.0.1
# prefer: npm run publish:manual after package
```

Installer embeds: Electron main/renderer, Three.js, glTF-Transform, Puter, keytar, FBX2glTF tool resource.  
**Forge tab** loads live `forge.grudge-studio.com` (not a bundled second editor).

**Latest:** [GitHub Releases](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest)

### glTF / convert (production bar)

| Step | Practice |
|------|----------|
| Bake | `grudge-convert` (Draco/Meshopt, WebP, SI scale ~1.8 m human) |
| Verify | Magic-byte GLB; no HTML-as-mesh |
| Store | R2 under CDN keys; seed D1/ObjectStore |
| View | Dev Tool Asset Viewer + Forge CDN URL |
| Edit | forge.grudge-studio.com (R3F + Rapier) |
| Playtest | Preview → open / client / water / GRUDOX / Multiverse |

Skills: **`grudge-asset-convert`** · **`forge-editor`** · **`grudge-d1-r2`**.

### Multiverse deploy (live game with own Railway)

| Layer | Host | Command / note |
|-------|------|----------------|
| SPA | `grudge-multiverse.vercel.app` | `cd F:\GitHub\grudge-multiverse && npm run deploy` |
| Rooms | `grudge-multiverse-room-production` | `cd server && railway up` — WS **`/api/mv`** |
| Map | R2 `models/maps/bermuda.glb` | Never ship 50MB+ GLB on Vercel |
| Env | `VITE_MV_GAME_SERVER_URL` | Multiverse Railway only |
| Open card | gameopen `gameLibrary.ts` | id `grudge-multiverse` |

**Rule:** each multiplayer game gets its **own Railway** when it needs rooms — do not piggyback Carrier / gameopen-production for Multiverse.

## CLI (`cli/`)

```powershell
cd cli && npm install && npm run build && npm install -g .
grudge-dev setup
grudge-dev doctor
```

## AI workers & GRUDACHAIN Ollama

| Path | Module |
|------|--------|
| Unified dispatch | `src/main/fleet/aiWorkerManager.ts` |
| CF Workers AI + Gateway | `src/main/cf/aiGateway.ts` |
| **GRUDACHAIN Ollama lifecycle** | `src/main/ollama.ts` — ensure on app open + admin sign-in |
| Legion hub | `GRUDGE_LEGION_HUB` → `ai.grudge-studio.com` |
| Puter AI | renderer `puter.ai.chat` (browser context) |

### Auto-start behavior (Forge v0.9.1+)

1. **App open** → `ollama.ensureRunning({ reason: "app-open" })`  
   - Docker container **`GRUDACHAIN`** with `-p 11434:11434` + volume `grudachain-ollama`  
   - Recreates container if host ports were never published  
   - Falls back to native `ollama serve`
2. **Admin sign-in** (`grudachain` / `molochdadev`) → agentic ensure (prefer Ollama, pull default model if empty)
3. Status bar: **OLLAMA · AGENTIC** when models are available

Preference: Settings → AI → `auto` | `ollama` | `cloudflare`.  
`auto` uses Ollama when `localhost:11434` is healthy.

## UUID / Three.js / Forge

| Concern | Module |
|---------|--------|
| Grudge UUID | `src/shared/grudgeUUID.ts` + `docs/grudge-uuid.md` |
| Three.js viewer | `src/renderer/viewer.tsx` |
| Forge bridge | `src/main/forge.ts` → `forge.grudge-studio.com` |
| Asset bake before CDN | `grudge-asset-convert` skill / ObjectStore convert CLI |

## Multi-era assets (production organization)

| Era | Tone | CDN / catalog |
|-----|------|----------------|
| **warlords** | Fantasy / medieval | grudge6, home island, 9 sectors — `era-asset-taxonomy.json` |
| **nexus** | Modern / post-modern | `models/nexus/` |
| **armada** | Future / space RTS | `grudge-armada/` |
| **voxel** | Style family | `voxelAssets.json` |
| **2D systems** | Icons, sprites, UI, fonts, VFX | `asset-media-types.json` |

Store tab categories in `src/shared/fleetGames.ts` → `STORE_CATEGORIES` map ObjectStore paths.  
Upload: convert → recognize era → correct R2 prefix → manifest with `era` field → D1.  
Docs: ObjectStore `docs/ERA-ASSET-TAXONOMY.md` + [asset-packs-canonical](asset-packs-canonical.md).

## Account / cloud best practices

1. One human → one Grudge ID (`id.grudge-studio.com`).
2. JWT in fleet keys: `grudge_auth_token`, `grudge_session_token`, `sso_token`.
3. Characters + account bag on **Railway** (`/api/characters`, `/api/account`).
4. Puter KV/FS = cache / user-pays only — never sole SSOT.
5. Admin UX gate is not security — Worker/API enforce privileges.

## Verify production

```powershell
npm run fleet:probe
# or
grudge-dev doctor
```

Expect core hosts live; Ollama may show `unknown` when not installed (optional).

## Related surfaces

| Surface | URL |
|---------|-----|
| Dev tool docs | https://grudge-warlords.github.io/grudge-dev-tool/ |
| Releases | https://github.com/Grudge-Warlords/grudge-dev-tool/releases |
| Forge | https://forge.grudge-studio.com |
| Warlord Genesis | https://warlord-genesis.vercel.app |
| AI hub | https://ai.grudge-studio.com |
