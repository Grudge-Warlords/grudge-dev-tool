# Grudge Dev Tool — Agent Instructions

**Product:** **Grudge Dev Tool** (`com.grudgestudio.devtool`) — Electron 41 tray hub (Elite viewer, Assets, Studio).  
**Repo:** `Grudge-Warlords/grudge-dev-tool` · Auto-updates via GitHub Releases.  
**Not Forge.** Live Forge is `forge.grudge-studio.com`. Live scene editor is ThreeFlow `threeflow.vercel.app`.

> **Note:** Electron 41 is a pre-release/internal build — standard compatibility docs may not apply.

---

## Quick Commands

```pwsh
npm run dev            # renderer (Vite :5173) + main (tsc --watch + electron)
npm run build          # build:renderer (Vite) + build:main (tsc)
npm run package        # build + electron-builder --win nsis → release/
npm run typecheck      # both tsconfig.main.json + tsconfig.renderer.json, no emit
npm run secret:import  # import .env file → Windows Credential Vault (keytar)
npm run secret:verify  # audit all expected keytar entries (never prints values)
npm run publish:manual # bump patch → package → git tag → gh release create
```

**Node ≥ 22, npm ≥ 10 required.** Store all secrets via `src/main/auth/secretStore.ts` — see **Secrets** in Key Conventions below for the full rule.

**Scripts:** `doctor` · `fleet:probe` · `backup:postgres` · `audit:workers` · `secret:*` · `toolchain:*` · `publish:manual` · `upload-pack` · `catalog:ummorpg` · `test:magic`.

**Toolchain blobs stay off-disk** until `npm run toolchain:install` (Blender/ffmpeg write under `tools/` and stay gitignored). Do not commit `release/`, `dist/`, `dev.venv/`. Installed app: `C:\Program Files\Grudge Dev Tool`.

---

## Editors (do not invent a fourth)

| Surface | Role | Loader / convert |
|---------|------|------------------|
| **Elite Viewer** (this app, pop-out) | Media **and** 3D opener (SceneEngine: hierarchy, delete, save-as) | `gltfProdLoader` + `SceneEngine` |
| **ThreeFlow** (`threeflow.vercel.app`) | Scene edit — **explicit** from Elite / Admin View | `?asset=` CDN or loopback `/v1/local-file` |
| **Forge live** (`forge.grudge-studio.com`) | R3F + Rapier + `.gfscene` deploy | CDN URL only |
| Local Forge3D / workbench | Pop-out mesh tools, script pad | same `loadModel` / `convertToGlb` |

Production bake: main `convertFile` (FBX2glTF → Blender fallback) then `optimizeWebFile`. Browser `exportToGlb` is convenience only.

Handoff SSOT: `src/shared/editorHandoff.ts`. Local 3D double-click opens the **Grudge Three Pipeline** (one SceneEngine window; extra files append). ThreeFlow is **Edit in ThreeFlow** in that window. Do not iframe ThreeFlow.

## Architecture

```
src/main/          ← Node.js + Electron main process (ipcMain.handle)
src/renderer/      ← React 18 + Vite SPA (no Node access)
src/preload/       ← contextBridge → window.electronAPI (only comms bridge)
src/shared/ipc.ts  ← canonical IPC channel names + all payload types
```

The renderer communicates **exclusively** via `window.electronAPI`. See **Key Conventions** → **Adding a new IPC channel**.

See [docs/production-config.md](docs/production-config.md) for full credential reference.  
See [docs/object-storage.md](docs/object-storage.md) for R2 bucket layout and manifest schema.  
See [docs/ai-workers-d1-r2-stream.md](docs/ai-workers-d1-r2-stream.md) for AI workers, Cloudflare AI, D1, R2, Stream production practices.  
See [docs/admin-architecture.md](docs/admin-architecture.md) for **admin shell** map (Forge = DNS, Preview play mode, Coder hybrid, same-source docs).  
See [docs/plugin-attach.md](docs/plugin-attach.md) for the loopback plugin host (`127.0.0.1:17380`) used by VS Code / standalone / viewer / agentic.  
Code SSOT: `src/shared/bestPractices.ts`, `src/shared/plugin/`, `src/shared/adminSurfaces.ts`, `src/shared/docsCatalog.ts`, `src/shared/fleet.ts`.

---

## External Systems & Integration Points

### Cloudflare (primary backend)

| Service | URL | Credential key |
|---|---|---|
| Object Store Worker | `cf-objectstore-worker-url` (keytar) | `cf-objectstore-api-key` |
| R2 direct (S3) | `cf-r2-endpoint` | `cf-r2-access-key-id` / `cf-r2-secret` |
| AI Gateway | `https://gateway.ai.cloudflare.com/v1/{accountId}/{gatewayId}/` | `cf-ai-workers-api` |
| Observatory telemetry | `https://obs.grudge-studio.com` | `cf-objectstore-api-key` (ingest key) |
| Asset CDN | `https://assets.grudge-studio.com` | public |

Workers AI models are env-overridable: `CF_AI_DEFAULT_MODEL` (default `@cf/meta/llama-3.1-8b-instruct`), `CF_AI_VISION_MODEL`.

### Puter Auth

- **Main process**: `@heyputer/puter.js` (CommonJS, asarUnpacked) — starts localhost redirect server, opens browser → `puter.com`, then validates token at `https://api.puter.com/auth/user` via Electron `net.fetch`. If the redirect does not complete within 120 seconds, shut down the localhost redirect server and emit IPC error `ERR_PUTER_AUTH_TIMEOUT` to the renderer. If token validation returns non-200, emit `ERR_PUTER_AUTH_INVALID` and clear any previously stored `puter-token` via `setSecret`.
- **Renderer**: CDN-loaded from `https://js.puter.com/v2/` via `src/renderer/lib/puter.ts`. `puter-claude` / `puter-gpt4o` model providers require browser context only.
- Keytar accounts: `puter-token`, `puter-user`, `grudge-id`.
- Grudge ID is generated by `src/shared/grudgeUUID.ts` — see that file and `docs/grudge-uuid.md` for the authoritative format. Do not re-implement the generation logic; always import from `src/shared/grudgeUUID.ts`.

### Grudge APIs (ONE TRUTH — 2026-07)

| Service | URL | Keytar / Env |
|---|---|---|
| Fleet client | `https://client.grudge-studio.com` | `default.apiBaseUrl` / `GRUDGE_API_BASE` |
| Grudge ID | `https://id.grudge-studio.com` | `GRUDGE_ID_BASE` |
| Game data SSOT | `https://grudge-api-production-0d46.up.railway.app` | `GRUDGE_GAME_DATA_URL` |
| ObjectStore | `https://objectstore.grudge-studio.com/api/v1` | public JSON / `cf-objectstore-*` |
| Assets CDN | `https://assets.grudge-studio.com` | public |
| Legion AI | `https://ai.grudge-studio.com` | `GRUDGE_LEGION_HUB` / `GRUDGE_AI_KEY` |
| Forge editor | `https://forge.grudge-studio.com` | browser |
| Pipeline | `https://grudge-pipeline.vercel.app` | browser |
| Coder IDE | `https://coder.grudge-studio.com` | browser / Dev Tool handoff |
| Multiverse SPA | `https://grudge-multiverse.vercel.app` | browser / Preview |
| Multiverse rooms | `https://grudge-multiverse-room-production.up.railway.app` | WS `/api/mv` only (own Railway) |
| **Legacy (live index)** | `https://api.grudge-studio.com` | asset-index GET only — **not** new player APIs; prefer ObjectStore + CDN |

### Databases · sharing · backups

- Pages SSOT: `docs/database-backups-sharing.md` → https://grudge-warlords.github.io/grudge-dev-tool/database-backups-sharing.html  
- Parallel dump: `npm run backup:postgres` (`scripts/backup-postgres.mjs`) — requires `DATABASE_URL` + `pg`; never commit `backups/`.  
- Player SSOT = Railway Postgres only; account bag shared; character XP scoped; D1/R2 are index/binaries.

### Production quality bar (assets + AI)

1. **Browse** R2/ObjectStore in Dev Tool → preview → send 3D to Forge (**CDN URL** only for production).  
2. **Catalogs** via proved paths: `objectstore…/api/v1/<name>.json` or `client…/api/objectstore/v1/<name>.json` — not `/api/objectstore/list` (404).  
3. **Bake** with `grudge-convert` before R2; magic-byte verify; seed D1/ObjectStore.  
4. **D1** = asset index only; **R2** = binaries; **Stream** = planned/partial (UI clips on R2).  
5. **AI:** Legion (`ai.grudge-studio.com`) ≠ Coder AI hub worker; Workers AI via binding/Gateway.  
6. **Never** Meshy/capsule ship visuals; never player state on D1.  
7. **uMMORPG extract:** `npm run catalog:ummorpg` → Forge `ummorpgCatalog.ts` + ObjectStore placeables/skills.  
8. **Doctor:** `npm run doctor` — critical probes only (obs + legacy api optional).

Backend routing (`src/main/api.ts`): `resolveBackend()` chooses between `r2-direct`, `cf-worker`, or fleet client modes.  
Local autonomous AI: Ollama at `OLLAMA_HOST` (default `http://localhost:11434`) via `src/main/ollama.ts`. Preferred model **`grudge-dev`** (Modelfile on `llama3.2`); `ensureRunning` creates it if missing.

---

## Upgrade Surfaces

These are the tracked upgrade and connection-improvement opportunities. When working on an upgrade surface, update the corresponding row in this document's table AND add an entry to CHANGELOG.md. If a GitHub Issue tracks it, close that issue with a reference commit. If an upgrade is investigated and explicitly deferred, add a note in the table row with the reason and a target review date, e.g., "Deferred: upstream breaking change unresolved, revisit 2025-Q3".

### 0. Plugin host (current)

| Piece | Status |
|---|---|
| dest-tool `src/main/pluginHost.ts` | Loopback `:17380` — VS Code / standalone / CLI / viewer / agentic |
| Practices | `src/shared/plugin/practices.ts` — dest-tool + live ai/coder/forge |
| VS Code | `F:\\GitHub\\GrudachainCode\\packages\\vscode-extension` attaches dest-tool first |
| CLI | `grudge-dev plugin status\|practices\|chat\|viewer` |

### 1. npm Dependencies — Pinned Versions to Bump

| Package | Current | Notes |
|---|---|---|
| `electron` | `^41.3.0` | Track latest stable; test keytar native rebuild after upgrade |
| `@aws-sdk/client-s3` | `^3.658.1` | S3 SDK; safe to bump minor — `requestChecksumCalculation` guard already in place |
| `@aws-sdk/s3-request-presigner` | `^3.658.1` | Match `client-s3` version exactly |
| `@gltf-transform/core/extensions/functions` | `^4.3.0` | Check breaking changes in major bumps |
| `@heyputer/puter.js` | `^2.2.15` | Before bumping, verify that `node_modules/@heyputer/puter.js/src/init.cjs` still exists in the new version and that the Electron main-process auth flow completes end-to-end. If the CJS path is removed, block the upgrade until an alternative init path is identified. |
| `@tanstack/react-query` | `^5.51.1` | Minor bumps safe |
| `electron-updater` | `^6.2.1` | Must match `electron-builder` major |
| `electron-builder` | `^26.8.1` | Pin together with `electron-updater` |
| `lucide-react` | `^0.408.0` | Icon API stable; safe to bump |
| `react` / `react-dom` | `^18.3.1` | Do NOT upgrade to React 19 without a dedicated migration task. React 19 removes legacy APIs used in the renderer — audit for `ReactDOM.render`, `unstable_*` APIs, and ref forwarding patterns before scheduling the upgrade. |
| `three` | `^0.185.1` | Fleet pin (same as ThreeFlow / Open). All renderer addons import `three/addons/*`. Production GLTF factory: `src/renderer/lib/forge/gltfProdLoader.ts`. |
| `sonner` | `^1.5.0` | Toast lib — safe minor bump |
| `typescript` | `^5.7.0` | 5.8+ adds `erasableSyntaxOnly`; no breaking changes |
| `vite` | `^8.0.10` | Confirmed installed version (verified in package.json); watch for patch updates |
| `tailwindcss` | `^3.4.6` | Tailwind v4 is a full rewrite — separate major task |

**After any Electron version bump:** rebuild native modules (`keytar`, `sharp`) with `electron-rebuild` or `@electron/rebuild`. Add a startup check in `src/main/main.ts` that calls `keytar.findCredentials` with a known service name and catches `Error: The module was compiled against a different Node.js version`. If caught, display a dialog instructing the user to run `npm run rebuild:native` and quit the app.

### 2. Workers AI Models — Available Upgrades

Routes defined in `src/main/fleet/aiWorkerManager.ts`. Current → recommended:

| Short name | Current model | Recommended upgrade |
|---|---|---|
| `llama-3.1-8b` | `@cf/meta/llama-3.1-8b-instruct` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (faster, larger) |
| `mistral-7b` | `@cf/mistral/mistral-7b-instruct-v0.2` | `@cf/mistral/mistral-7b-instruct-v0.3` (updated weights) |
| `gemma-7b` | `@cf/google/gemma-7b-it-lora` | `@cf/google/gemma-3-12b-it` (Gemma 3) |
| `qwen-1.5-14b` | `@cf/qwen/qwen1.5-14b-chat-awq` | `@cf/qwen/qwen2.5-72b-instruct` (Qwen 2.5) |
| Anthropic default | `claude-sonnet-4-20250514` | Track latest `claude-sonnet-4-*` date stamp |

All models are overridable at runtime via `CF_AI_DEFAULT_MODEL` / `CF_AI_VISION_MODEL` env vars — test new models without rebuilding.

### 3. Cloudflare Observatory Worker — Schema & Features

`deploy/observatory/` is a self-contained Cloudflare Worker with D1 + KV.

- **Compatibility date** is `2024-09-23` — update to `2025-01-01` or later in [deploy/observatory/wrangler.toml](deploy/observatory/wrangler.toml) to unlock newer CF runtime features.
- Tighten `ALLOWED_ORIGINS` to specific project domains (e.g., `https://forge.grudge-studio.com`) before the first production release. Add the specific domains to `deploy/observatory/wrangler.toml` and remove the `*.vercel.app` wildcard at that milestone.
- The hourly cron (`"0 * * * *"`) runs rollups — consider adding a D1 index on `(source, created_at)` for the `/query` endpoint as log volume grows.
- **Missing**: a `/metrics` endpoint for Prometheus scraping. The health-check fleet panel would benefit from aggregate time-series.

### 4. Fleet Health Check — Connection Improvements

Defined in `src/main/fleet/healthCheck.ts`:

- **`auth.grudgestudio.com`** — note the missing hyphen vs all other `grudge-studio.com` domains. Verify if this is intentional or a DNS alias; standardize one canonical form.
- **Solana RPC** (`https://api.mainnet-beta.solana.com`) — currently only a health-ping. When wallet / cNFT minting features land (see grudge-uuid slot system), wire up a `@solana/web3.js` client here.
- **`grudgeplatform.io`** — only probed as a URL ping; consider adding an `/api/health` endpoint on that domain for richer status.

### 5. Puter SDK — Main Process Integration

`@heyputer/puter.js` is loaded via `require('@heyputer/puter.js/src/init.cjs')` because the standard `init()` breaks in Electron's Node context (`vm.runInNewContext`). Watch the upstream SDK for:

- An official Electron-compatible init path (the CJS init path may be removed in a future major version).
- Puter KV / Puter FS APIs — currently unused in the main process; these could replace `electron-store` for cloud-synced app preferences.
- `puter.ai.chat()` — renderer-only today (`puter-claude`, `puter-gpt4o` models). Consider proxying through a new IPC channel so the main process can use Puter AI without requiring browser context.

### 6. Renderer Puter SDK — CDN vs npm

`src/renderer/lib/puter.ts` lazy-loads from `https://js.puter.com/v2/` (CDN). Risks:

- Version drift between the CDN build and `@heyputer/puter.js@2.x` in `node_modules`.
- CSP `script-src` must allow `https://js.puter.com` for the CDN load.

**To unify:** replace the CDN load with `import type {} from '@heyputer/puter.js'` and bundle the renderer SDK the same as main, or expose a preload helper that passes an already-authenticated token into the renderer.

### 7. Ingestion Pipeline — Toolchain Gaps

`src/main/ingestion/toolchain.ts` detects Blender, ffmpeg, sharp. Known gaps:

| Gap | Current state | Improvement |
|---|---|---|
| No `draco` encoder | glTF compression not applied | Add `draco3d` or invoke `gltf-transform optimize` with Draco |
| No `meshoptimizer` | Large meshes shipped as-is | Wire `@gltf-transform/functions` `meshopt()` pass |
| BlenderKit enrichment | Subprocess to Python script | Consider daemon REST endpoint once BK daemon is stable |
| FBX → GLB conversion | Blender subprocess (slow) | Evaluate `fbx2glb` npm package for non-rigged assets |
| Elite 3D viewport | Infinite SI grid + ViewHelper + inspector (2026-08) | Do not add `three-viewport-gizmo` / second viewer app — extend `SceneEngine` + `ViewerWindow` |

### 8. Grudge UUID System — Slot Expansion

`src/shared/grudgeUUID.ts` defines the slot / tier taxonomy. When adding new asset families or game features:

- Add new slots here first — the ingestion pipeline's `SLOT_BY_FAMILY` map in `src/main/ingestion/index.ts` reads from this.
- The Solana cNFT minting path (planned) will use these UUIDs as on-chain identifiers.
- The `scripts/upload-asset-pack.ts` CLI also derives UUIDs — keep in sync.

### 9. CSP & Security Hardening

`src/renderer/index.html` and `loader.html` contain the `Content-Security-Policy` meta tag. When adding new external services:

- Add fetch/XHR targets to `connect-src`, new script sources to `script-src`, and new image domains to `img-src`. Current `connect-src` includes `https://*.grudge-studio.com`, `https://js.puter.com`, `http://127.0.0.1:*` (BlenderKit daemon). After editing, verify the CSP header in DevTools Network tab and confirm no CSP violations appear in the console.
- `webview` guest pages are locked down in `main.ts` (`will-attach-webview` strips all prefs) — do not relax this.
- The admin gating in `src/renderer/lib/admin.ts` is **UX-only**; Cloudflare Worker ACLs are the real enforcement layer.

---

## Key Conventions

- **Secrets**: store secrets with `setSecret`/`getSecret` in `src/main/auth/secretStore.ts`. Internally, values ≤ 2000 chars use keytar (Windows Credential Vault); values > 2000 chars automatically fall back to safeStorage (DPAPI). Never write secrets to `electron-store`, `.env` files, or any file on disk. If `getSecret` returns null or throws, surface an IPC error to the renderer with code `ERR_SECRET_MISSING` and instruct the user to re-run `npm run secret:import`. Do not silently proceed with an undefined credential. The `secret:import` script uses `setSecret` from `src/main/auth/secretStore.ts`, which automatically routes values > 2000 chars to safeStorage (DPAPI). If `setSecret` throws during import (e.g., safeStorage unavailable in the current Electron context), the script must print the failing key name and exit with code 1. Do not silently skip failed entries.
- **Adding a new IPC channel:** (1) Define channel name and payload types in `src/shared/ipc.ts`. (2) Add `ipcMain.handle` in `src/main/main.ts`. (3) Add matching `contextBridge` entry in `src/preload/preload.ts`. (4) Do not duplicate type definitions inline anywhere else.
- **Backend routing**: `src/main/api.ts` `resolveBackend()` is the single decision point for which backend a request uses. New backend modes go here. If the resolved backend returns a network error or 5xx, do NOT automatically fall through to another mode — `resolveBackend()` is a configuration decision, not a retry chain. Surface an IPC error `ERR_BACKEND_UNAVAILABLE` with the mode name so the renderer can display a specific failure message. Fallback mode logic, if ever needed, must be an explicit configuration change, not silent.
- **Adding a new backend mode**: (1) add the mode string to the union type in `src/shared/ipc.ts`, (2) implement the case in `resolveBackend()` in `src/main/api.ts`, (3) add credentials to `docs/production-config.md`, (4) add a health-check probe in `src/main/fleet/healthCheck.ts`.
- **Public CDN URL**: resolved by `r2PublicUrl()` in `src/main/cf/r2Direct.ts`. The `r2PublicUrl()` fallback chain is: (1) keytar `cf-r2-public-url`, (2) env `CF_R2_PUBLIC_URL`, (3) `cf-r2-endpoint` with bucket prefix, (4) hardcoded `https://assets.grudge-studio.com`. If all four resolve to null or throw, `r2PublicUrl()` throws `ERR_R2_URL_UNRESOLVABLE` — callers must handle this and surface an error to the renderer rather than proceeding with an undefined URL. Don't hardcode `assets.grudge-studio.com` elsewhere.
- **Telemetry**: use `src/main/cf/observatory.ts` `pushEvent()` for any new AI or significant user-action events. Telemetry is fire-and-forget — `pushEvent()` must never throw or await in a user-blocking code path. If the Observatory Worker returns a non-2xx or the request times out, log the failure to the console at `warn` level and discard silently. Do not retry or queue. The Observatory Worker schema is in [deploy/observatory/schema.sql](deploy/observatory/schema.sql).
- **Icons**: regenerate via `npm run build:icons` — source is `resources/brand/grudge-emblem-source.png`.
- **Release**: `npm run publish:manual` (or `:minor`/`:major`) handles the full pipeline. GitHub Actions is not yet wired — use the manual script. If `publish:manual` fails after pushing a git tag, manually delete the tag with `git push origin :refs/tags/<tag>` before retrying. Do not push a duplicate tag or create the GitHub release manually unless the build artifact in `release/` has been verified.

---

## Docs Index

| Doc | Covers |
|---|---|
| [docs/production-config.md](docs/production-config.md) | Full credential table, all keytar account names |
| [docs/object-storage.md](docs/object-storage.md) | R2 bucket layout, manifest schema, CDN behavior |
| [docs/grudge-uuid.md](docs/grudge-uuid.md) | UUID format, slot taxonomy, tier system |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Known errors and exact fixes |
| [docs/dev-tool-quickstart.md](docs/dev-tool-quickstart.md) | First-run setup guide |
| [docs/api-reference.md](docs/api-reference.md) | IPC channel reference |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [REVIEW.md](REVIEW.md) | Audit findings log |
