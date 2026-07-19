---
layout: default
title: Production deployment
nav_order: 2
description: ONE TRUTH production deploy map for Grudge Dev Tool, Forge, AI workers, Pages, and fleet hosts.
---

# Production deployment (canonical)

**Mission:** successful production on all Grudge Studio hosts — no parallel redesigns.

## ONE TRUTH hosts

| Layer | Host | Role |
|-------|------|------|
| Auth gateway | `https://id.grudge-studio.com` | Grudge ID JWT, Discord SSO |
| Game data SSOT | `https://grudge-api-production-0d46.up.railway.app` | Railway Postgres |
| Fleet client | `https://client.grudge-studio.com` | Vercel rewrites → auth + Railway + objectstore |
| ObjectStore | `https://objectstore.grudge-studio.com/api/v1` | JSON catalogs |
| Assets CDN | `https://assets.grudge-studio.com` | R2 binaries |
| Legion AI | `https://ai.grudge-studio.com` | AI hub / workers |
| Forge editor | `https://forge.grudge-studio.com` | 3D editor surface |
| Dev Tool docs | `https://grudge-warlords.github.io/grudge-dev-tool/` | This site (GitHub Pages) |
| Local Ollama | `http://localhost:11434` | Autonomous desktop AI (optional) |

**Never use** `api.grudge-studio.com` for new wiring (deprecated split-brain).

## Secrets (Windows Credential Vault + CI)

| Secret group | Storage | Used by |
|--------------|---------|---------|
| R2 S3 (`OBJECT_STORAGE_*`) | keytar / `npm run secret:import` | Upload, browse, packs |
| CF AI (`CF_AI_*`, `CF_ACCOUNT_ID`) | keytar | Workers AI / AI Gateway |
| Legion (`GRUDGE_AI_KEY`, `GRUDGE_LEGION_HUB`) | keytar / env | ai.grudge-studio.com |
| Puter (`puter-token`) | keytar after browser login | User-pays cloud |
| Grudge ID JWT | keytar / localStorage keys | Account + characters |
| Ollama (`OLLAMA_HOST`) | env / electron-store | Local vibe coding |

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

## Desktop Forge release

```powershell
npm ci --legacy-peer-deps
npm run typecheck
npm run ci              # typecheck + fleet probe
npm run package         # NSIS installer → release/
# or tagged release (CI):
git tag v0.6.1 && git push origin v0.6.1
```

Installer embeds: Electron main/renderer, Three.js, glTF-Transform, Puter, keytar, FBX2glTF tool resource.

## CLI (`cli/`)

```powershell
cd cli && npm install && npm run build && npm install -g .
grudge-dev setup
grudge-dev doctor
```

## AI workers & Ollama

| Path | Module |
|------|--------|
| Unified dispatch | `src/main/fleet/aiWorkerManager.ts` |
| CF Workers AI + Gateway | `src/main/cf/aiGateway.ts` |
| Local Ollama | `src/main/ollama.ts` |
| Legion hub | `GRUDGE_LEGION_HUB` → `ai.grudge-studio.com` |
| Puter AI | renderer `puter.ai.chat` (browser context) |

Preference: Settings → AI → `auto` | `ollama` | `cloudflare`.  
`auto` uses Ollama when `localhost:11434` is healthy.

## UUID / Three.js / Forge

| Concern | Module |
|---------|--------|
| Grudge UUID | `src/shared/grudgeUUID.ts` + `docs/grudge-uuid.md` |
| Three.js viewer | `src/renderer/viewer.tsx` |
| Forge bridge | `src/main/forge.ts` → `forge.grudge-studio.com` |
| Asset bake before CDN | `grudge-asset-convert` skill / ObjectStore convert CLI |

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
