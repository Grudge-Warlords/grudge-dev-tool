# grudge-dev-tool — Production audit (v0.3.2 → v0.3.3)

Generated 2026-04-29 against commit on `main`. Audit notes from v0.3.2; **all 8 findings resolved in v0.3.3**.

The audit was scoped to:
1. Dependency tree (`package.json`)
2. Hardcoded URLs / IDs / model names
3. Placeholders / TODOs / `change_me` style strings
4. Production wiring against canonical `Grudge-Warlords/grudge-studio-backend`
5. Missing or partially-exposed configuration knobs

---

## TL;DR

- **No production-blocking misconfiguration found.** All canonical URLs match the upstream `grudge-studio-backend` README (game-api, asset-service, identity, R2 bucket, public CDN, region `auto`).
- **The dev tool talks HTTP only — no DB connection.** Backend on the server side is MySQL 8 + Redis 7 (the PG/Drizzle prototype is retired). The dev tool stays correctly out of that.
- **All 8 hygiene findings resolved in v0.3.3** (see Findings section below for line-by-line resolution status). Typecheck clean. Ready to redeploy.

---

## Canonical hosts — what should be where

| Service | Production URL | Wired in dev tool | Where |
|---|---|---|---|
| game-api | `https://api.grudge-studio.com` | ✅ | `src/main/api.ts:29` (`getApiBaseUrl`) |
| asset-service | `https://assets-api.grudge-studio.com` | ✅ | `src/main/api.ts:67` (`getAssetsApiBaseUrl`) |
| identity (Puter bridge / Discord OAuth) | `https://id.grudge-studio.com` | ⚠ not used directly — dev tool drives Puter SDK in main process via `@heyputer/puter.js` and derives Grudge ID locally | `src/main/auth/puterLogin.ts`, `src/main/auth/puterSession.ts` |
| R2 bucket | `grudge-assets` | ✅ stored in keytar `cf-r2-bucket` (canonical name documented in `.env.example`) | `src/main/cf/credentials.ts:13` |
| R2 region | `auto` | ✅ default in `r2Direct.ts:28` | `src/main/cf/r2Direct.ts:28` |
| R2 endpoint | `https://<accountId>.r2.cloudflarestorage.com` | ✅ keytar `cf-r2-endpoint` | `src/main/cf/credentials.ts:11` |
| Public CDN | `https://assets.grudge-studio.com` | ✅ default in `r2Direct.ts:131-145` | `src/main/cf/r2Direct.ts:131` |
| Docs site (live) | `https://grudge-warlords.github.io/grudge-dev-tool/` | ⚠ `Docs.tsx:27` references the non-existent `https://docs.grudge-studio.com/dev-tool` instead | `src/renderer/pages/Docs.tsx:27` |

---

## Findings

### F1 (medium) — Settings page does not expose the asset-service URL — **✅ RESOLVED in v0.3.3**
**File:** `src/renderer/pages/Settings.tsx:152`
The Settings page renders an input for `apiBase` (game-api) and saves it via `window.grudge.settings.setApiBase`. There is **no equivalent input for `assetsApiBaseUrl`**, even though `getAssetsApiBaseUrl()` / `setAssetsApiBaseUrl()` already exist in `src/main/api.ts:47-69` and `GRUDGE_ASSETS_API_BASE` is mapped in `scripts/import-secrets.mjs:43`. Users on a single-domain dev backend (where `/api/objectstore/*` is proxied through game-api) cannot point the dev tool at `apiBaseUrl` without editing keytar manually.

**Fix:** add a second input + Save button just below the existing apiBase row, wired to a new `window.grudge.settings.setAssetsApiBase` IPC. Also a `null`/blank-as-fallback semantic so single-domain installs can clear it.

**Resolution:** v0.3.3 ships `settings:setAssetsApiBase` IPC, `settings:get` now returns `assetsApiBaseUrl`, preload exposes `settings.setAssetsApiBase`, and the Grudge identity card in Settings has a second input row labelled "asset-service base URL (optional override)".

### F2 (medium) — Connectivity probe only hits game-api — **✅ RESOLVED in v0.3.3**
**File:** `src/main/connectivity.ts:82-83`
The 30-second connectivity tick probes `${apiBase}/api/health` only. It never probes `assets-api.grudge-studio.com/api/health`, even though every upload-url / manifest / asset-meta call now routes there. A green-dot status bar can mislead the user when game-api is up but asset-service is down.

**Fix:** add a parallel probe to the asset-service base URL when the resolved backend is `grudge`, surface both states in the bottom status bar (`game · ok · 42ms` + `assets · ok · 60ms`) or merge into a single combined health.

**Resolution:** v0.3.3 extends `ConnectivityState` with an optional `assets` sub-object (`apiBaseUrl`, `reachable`, `latencyMs`, `status`, `error`). When the resolved backend is `grudge`, the tick fires `Promise.all([gameProbe, assetsProbe])`, marks overall `reachable` as the AND, and surfaces `assets-api: <error>` in the top-level error string when game-api is up but asset-service is down. The Settings Diagnostics card shows both rows.

### F3 (medium) — Hardcoded `assets.grudge-studio.com/<key>` URL construction in renderer — **✅ RESOLVED in v0.3.3**
**Files:**
- `src/renderer/LoaderApp.tsx:19-21, 188`
- `src/renderer/pages/Browser.tsx:136`
- `src/renderer/pages/Forge3D.tsx:643` (only an example placeholder string in the inspector — fine)
The renderer constructs CDN URLs by string-concat with the literal `https://assets.grudge-studio.com/` prefix. The canonical place for this is `cf:r2PublicUrl(key)` (already exposed via preload after v0.3.0). Two callers do not use it.

**Effect:** if the public CDN host ever changes (or a private deploy points at a different domain), three places have to be updated by hand.

**Fix:** replace the inline literal with an async call to `await window.grudge.cf.r2PublicUrl(name)`. Cache results in a `useMemo` keyed by the listing.

**Resolution:** v0.3.3 calls `cf.r2PublicUrl("")` once on mount in both `LoaderApp.tsx` and `Browser.tsx`, caches the resolved CDN base in a `useState`, and constructs URLs synchronously from there. `LoaderApp.CMD_FORMATS` was refactored into `buildCmdFormats(cdnBase)` driven by the same cached value. Falls back to the canonical `https://assets.grudge-studio.com` until the IPC resolves so the UI never shows a broken URL.

### F4 (medium) — `Docs.tsx` references a docs subdomain that isn't live — **✅ RESOLVED in v0.3.3**
**File:** `src/renderer/pages/Docs.tsx:27`
The Docs page advertises `https://docs.grudge-studio.com/dev-tool` as the online docs mirror. The actually-published docs site is `https://grudge-warlords.github.io/grudge-dev-tool/` (per README badge + `pages.yml`).

**Fix:** point the link at the GitHub Pages URL (or stand up a CNAME to it) and remove the placeholder subdomain.

**Resolution:** v0.3.3 swaps the placeholder mention for an actual `<a>` that calls `os.openExternal('https://grudge-warlords.github.io/grudge-dev-tool/')`.

### F5 (medium) — `node-fetch` is an unused runtime dependency — **✅ RESOLVED in v0.3.3**
**File:** `package.json:43` (`"node-fetch": "^3.3.2"`)
`grep -r "node-fetch"` across `src/` returns 0 hits. Node 20 (Electron 41 baseline) has global `fetch`. The `cf/aiGateway.ts`, `cf/objectStoreWorker.ts`, `cf/r2Direct.ts`, `connectivity.ts` (uses Electron `net`), `auth/puterLogin.ts` (uses SDK fetch), and `uploader.ts` all use the global. The dep adds 110 KB to `node_modules` and is shipped under asar with no consumer.

**Fix:** drop from `dependencies`. Keep an eye on the @aws-sdk transitive: it brings its own fetch handler.

**Resolution:** v0.3.3 removes `node-fetch` from `package.json` (`npm install --legacy-peer-deps` removed 6 transitive packages from the lock). All HTTP traffic uses Node 20's global `fetch` or Electron `net`. No source imports broke.

### F6 (low) — AI Gateway model IDs are not env-overridable — **✅ RESOLVED in v0.3.3**
**File:** `src/main/cf/aiGateway.ts:66, 81`
`workersAiChat()` defaults to `@cf/meta/llama-3.1-8b-instruct`, `workersAiCaption()` defaults to `@cf/llava-hf/llava-1.5-7b-hf`. Both are reasonable today, but Workers AI rotates models frequently; we should accept a single env override per usage so the dev tool tracks upstream without a code release.

**Fix:** read `process.env.CF_AI_DEFAULT_MODEL` and `process.env.CF_AI_VISION_MODEL` (and matching keytar entries) before falling back to the literals.

**Resolution:** v0.3.3 reads `process.env.CF_AI_DEFAULT_MODEL` (chat) and `process.env.CF_AI_VISION_MODEL` (caption) before falling back to the documented defaults. Per-call `opts.model` still wins over both.

### F7 (low) — BlenderKit `API_PREFIX` is hardcoded — **✅ RESOLVED in v0.3.3**
**File:** `src/main/blenderkit/daemon.ts:23-25`
The comment already calls this out: `1.8.x → "v1.8". Hardcoded for the bundled version we detected.` `readAddonVersion()` parses `blender_manifest.toml` already; the prefix should derive from that (`/v\d+\.\d+/`) and only fall back to `v1.8` when manifest read fails.

**Fix:** compute `API_PREFIX` lazily from `cachedAddonVersion`. Keep `v1.8` as the documented fallback.

**Resolution:** v0.3.3 replaces the constant with an `apiPrefix()` helper that reads `cachedAddonVersion` (already populated from `blender_manifest.toml`), strips to `v<major>.<minor>`, and falls back to `v1.8` (named `FALLBACK_API_PREFIX`) when manifest read fails. All four call sites updated.

### F8 (low) — `LoaderApp.tsx` ships a demo pinned path that may not exist — **✅ RESOLVED in v0.3.3**
**File:** `src/renderer/LoaderApp.tsx:10-15`
`DEFAULT_PINNED` includes `asset-packs/classic64/v0.6/`. A fresh user that doesn't have that pack uploaded will see a broken pinned shortcut. Behaviour is benign (clicking it just shows "Empty.") and the user can unpin, but it's a confusing first impression for new operators.

**Fix:** either drop the version-specific pin and leave only the parent prefix, or load the user's last-N actually-listed top-level prefixes from R2 on first run.

**Resolution:** v0.3.3 drops the version-specific `asset-packs/classic64/v0.6/` pin. `DEFAULT_PINNED` is now just the three top-level prefixes (`asset-packs/`, `user-uploads/`, `shared/`) which exist for every tenant. Users can still pin custom paths via the existing UI.

---

## Dependency review (`package.json`)

### Runtime
| Package | Version | Status | Note |
|---|---|---|---|
| `@aws-sdk/client-s3` | ^3.658.1 | ✅ current | Required by R2 S3-compat path. WHEN_REQUIRED checksum is configured correctly for R2. |
| `@aws-sdk/s3-request-presigner` | ^3.658.1 | ✅ current | Used for `r2GetSignedUploadUrl` / `r2GetSignedDownloadUrl`. |
| `@heyputer/puter.js` | ^2.2.15 | ✅ current | `--legacy-peer-deps` required (peers React 19, we ship 18). Documented. |
| `@tanstack/react-query` | ^5.51.1 | ✅ current | Stable. |
| `electron-log` | ^5.1.7 | ✅ current | |
| `electron-store` | ^10.0.0 | ✅ current | Major version 10 (was 8). No breaking change for our usage. |
| `electron-updater` | ^6.2.1 | ✅ current | `latest.yml` shipped per release; auto-update tested on v0.3.x line. |
| `keytar` | ^7.9.0 | ✅ stable | Last maintained version. v0.3.1 fallback to `safeStorage` is the safety net for the 2.5 KB blob limit. |
| `lucide-react` | ^0.408.0 | ⚠ behind | Latest is in the 0.5xx range. Not blocking — our icon set works. |
| `node-fetch` | ^3.3.2 | ❌ **unused** — see F5 | |
| `react`, `react-dom` | ^18.3.1 | ✅ pinned to 18 | React 19 conflicts with @heyputer peers. |
| `sonner` | ^1.5.0 | ✅ current | |
| `three` | ^0.169.0 | ✅ matches | r169 is the version where TransformControls API moved to `getHelper()` — fixed in v0.3.2. |

### Dev
| Package | Version | Status | Note |
|---|---|---|---|
| `@types/node` | ^20.14.0 | ✅ matches Electron 41's Node 20 |
| `@types/react`, `@types/react-dom` | ^18.x | ✅ |
| `@types/three` | ^0.169.0 | ✅ matches runtime |
| `@vitejs/plugin-react` | ^4.3.1 | ⚠ Vite 8 emits deprecation warning (`esbuild` option deprecated, recommends `oxc`). Not blocking. Could downgrade Vite to 7.x for cleaner output, or upgrade plugin to `@vitejs/plugin-react-oxc` once it's stable. |
| `electron` | ^41.3.0 | ✅ |
| `electron-builder` | ^26.8.1 | ✅ NSIS + signing path is healthy. |
| `png-to-ico`, `sharp` | current | Used by `scripts/build-icons.mjs`. |
| `tailwindcss` | ^3.4.6 | ✅ Tailwind 3, not 4 (Forge backend uses 4 — separate codebase). |
| `tsx` | ^4.16.2 | ✅ |
| `typescript` | ^5.5.3 | ✅ |
| `vite` | ^8.0.10 | ✅ but emits deprecations (see plugin-react note). |
| `wait-on` | ^7.2.0 | ✅ used by `dev:main` script. |

---

## Hardcoded / placeholder strings — exhaustive list

Searched `src/` for `TODO`, `FIXME`, `XXX`, `HACK`, `PLACEHOLDER`, `placeholder`, `your_`, `change_me`, `TBD`, `your-`, `hardcoded`. Hits:

| File:Line | What | Verdict |
|---|---|---|
| `src/renderer/pages/Search.tsx:26-28` | Placeholder text on inputs (`placeholder="…"`) | ✅ legitimate input UX |
| `src/renderer/pages/UUID.tsx:38, 47` | Placeholder text on inputs | ✅ legitimate |
| `src/renderer/pages/Settings.tsx:164` | `placeholder="bk_…"` on BlenderKit key input | ✅ legitimate |
| `src/renderer/pages/Browser.tsx:162` | `placeholder="filter… (or '> query' …)"` | ✅ legitimate |
| `src/renderer/pages/Login.tsx:127-129` | Placeholder text on manual-login inputs | ✅ legitimate |
| `src/renderer/LoaderApp.tsx:160, 169, 177, 214` | Placeholder text on inputs | ✅ legitimate |
| `src/renderer/pages/AssetLibrary.tsx:26` | Placeholder text | ✅ legitimate |
| `src/renderer/pages/Forge3D.tsx:643` | `placeholder="user-uploads/forge"` on R2 path input | ✅ legitimate |

**No `TODO` / `FIXME` / `change_me` / `your_xxx` placeholders found in the live code path.** The repo is clean.

The only "design comment" callout is in `daemon.ts:23-25` — flagged as F7.

---

## Backend alignment with `Grudge-Warlords/grudge-studio-backend`

| Backend fact | Dev-tool truth |
|---|---|
| DB = MySQL 8 + Redis 7 | ✅ Dev tool has zero DB code paths. Documented in `.env.example:13`. |
| Public ingress = Cloudflare Tunnel | ✅ Dev tool talks HTTPS to public hostnames; never assumes direct VPS IP. |
| R2 bucket name = `grudge-assets` | ✅ Documented in `.env.example:30`; user paste-imports it via `import-secrets.mjs`. |
| R2 region = `auto` | ✅ `r2Direct.ts:28` defaults to `auto`. |
| Public CDN = `https://assets.grudge-studio.com` | ✅ `r2Direct.ts:145` default fallback. |
| asset-service = `assets-api.grudge-studio.com` | ✅ `getAssetsApiBaseUrl()` default. **Issue F1**: not exposed in Settings UI. |
| identity = `id.grudge-studio.com` | ⚠ Dev tool uses Puter SDK directly + derives Grudge ID client-side; never hits `id.grudge-studio.com/auth/puter-bridge`. Future: switch to the bridge to mint server-issued JWTs that other services accept. |
| Cloudflare Turnstile on `/auth/wallet` | n/a — dev tool doesn't expose wallet endpoints. |

---

## Resolution status (v0.3.3)

All 8 findings shipped:

1. **F1** ✅ `assets-api` URL exposed in Settings + new IPC.
2. **F2** ✅ Connectivity probes both game-api and asset-service in parallel; status bar honours the AND.
3. **F3** ✅ `cdnBase` resolved once via `cf.r2PublicUrl("")` and threaded through Browser + LoaderApp.
4. **F4** ✅ Docs link points at the actual GitHub Pages site.
5. **F5** ✅ `node-fetch` dropped (6 packages removed from lock).
6. **F6** ✅ `CF_AI_DEFAULT_MODEL` / `CF_AI_VISION_MODEL` env overrides on Workers AI calls.
7. **F7** ✅ BlenderKit `apiPrefix()` derives from `blender_manifest.toml` version with `v1.8` fallback.
8. **F8** ✅ LoaderApp default pinned shortcuts simplified to top-level prefixes only.

Typecheck clean. v0.3.3 ready to redeploy.

---

## What is **not** an issue (sanity-check matrix)

- ✅ No PostgreSQL anywhere — backend is MySQL, dev tool is DB-less.
- ✅ No `localhost` / `127.0.0.1` smuggled into production code paths. The four `127.0.0.1` references are all in `blenderkit/daemon.ts` for the BlenderKit-Client local HTTP daemon — that's correct.
- ✅ No keytar service-name collision with other Grudge apps — service is uniquely `grudge-dev-tool`.
- ✅ No hardcoded API tokens / wallet seeds / private keys anywhere in the repo. Searched.
- ✅ R2 region defaults to `auto`, not `us-east-1`.
- ✅ R2 client uses `forcePathStyle:true` and `WHEN_REQUIRED` checksum — required for R2.
- ✅ `electron-builder.yml` `asarUnpack` correctly carves out `@heyputer/puter.js` and `open` so `vm.runInNewContext` + browser launchers work post-pack.
- ✅ CSP allows `js.puter.com`, `*.puter.com`, `wss://*.puter.com` for the SDK; allows `*.r2.cloudflarestorage.com` and `*.r2.dev` for direct uploads; allows `blob:` workers/scripts for Three.js loaders.
- ✅ File associations registered for `.glb / .gltf / .fbx / .obj / .stl / .ply / .dae / .3mf` so the app behaves as a Windows-default 3D viewer.
- ✅ Auto-update points at the right repo + tag scheme.
