---
layout: default
title: AI Workers · D1 · R2 · Stream
nav_order: 4
---

# AI Workers, Cloudflare AI, D1, R2 & Stream — Production SSOT

**Audience:** Grudge Studio admins, Dev Tool agents, Coder AI workers, Forge/Pipeline deploy.  
**Code SSOT:** `src/shared/bestPractices.ts` · `src/main/fleet/aiWorkerManager.ts` · `src/shared/fleet.ts`  
**Skills:** `grudge-d1-r2`, `grudge-warlords-assets`, `grudge-asset-convert`, `grudge-coder`, `grudge-fleet`, Cloudflare `workers-best-practices` / Agents SDK.

Goal: **best possible agent outputs** and **production builds/assets** — no invented meshes, no D1-as-player-DB, no new player APIs on legacy `api.grudge-studio.com`.

**Probes:** `npm run doctor` / `grudge-dev doctor` (critical hosts only; optional obs + legacy index not scored).

---

## 1. Product surfaces (DNS)

| Host | Role | Keep green? | Owner path |
|------|------|-------------|------------|
| `assets.grudge-studio.com` | R2 binary CDN | **Yes** | GrudgeBuilder `workers/cdn` |
| `objectstore.grudge-studio.com` | JSON catalogs | **Yes** | ObjectStore Worker |
| `ai.grudge-studio.com` | Legion chat / roles | **Yes** | `grudge-ai-hub` |
| `coder.grudge-studio.com` | Vibe IDE SPA | **Yes** | GrudachainCode Pages |
| `forge.grudge-studio.com` | R3F + Rapier scene editor | **Yes** | `Grudge-Studio-Forge` |
| `grudge-pipeline.vercel.app` | Convert handoff → Forge | **Yes** | Pipeline app |
| `client.grudge-studio.com` | ONE TRUTH rewrites | **Yes** | Vercel grudge-builder |
| `id.grudge-studio.com` | SSO | **Yes** | Grudge ID Worker |
| `obs.grudge-studio.com` | Observatory telemetry | **Optional** — DNS often missing | demote until CNAME |
| `api.grudge-studio.com` | **Legacy** asset index (still 200) | **Do not use for new work** | Prefer ObjectStore + CDN |

**Admin desktop:** Grudge Dev Tool — Browse R2/ObjectStore → preview → **Copy CDN** → **Send 3D to Forge**.  
Server search (`>query`) requires a **live** ObjectStore search endpoint — do not assume `client…/api/objectstore/search` (404 as of 2026-08).

---

## 2. Two AI surfaces (never merge names)

| Surface | Host / package | Use |
|---------|----------------|-----|
| **Fleet Legion** | `ai.grudge-studio.com` | Studio-wide chat, agent roles, image, embed |
| **Coder AI Hub** | `GrudachainCode/workers/ai-hub` | Event/job ingest, D1 `grudge-ai-hub`, queues |
| **Dev Tool AI Worker** | `aiWorkerManager.ts` | Routes Workers AI / Gateway / Legion / Ollama |
| **In-browser** | Puter `puter.ai.chat` | User-pays models in Coder |

### Cloudflare AI best practices

1. **Bindings over REST** inside Workers: `env.AI.run(model, input, { gateway: { id, skipCache, cacheTtl } })`.
2. **AI Gateway** for third-party models (Anthropic/OpenAI) — caching, logging, fallbacks.
3. **Cache** only deterministic work (caption, classify, enrich). **skipCache** for chat/tools.
4. **Model quality ladder:**
   - Workers AI (`@cf/meta/llama-*`) → search, tags, cheap vision caption
   - Claude Sonnet / GPT via Gateway or Legion → code, bake plans, architecture
   - Coder specialties: code / deploy / create / gamedev / organize (see `grudge-coder`)
   - Ollama local → offline admin agentic
5. **Agents SDK** for stateful jobs: Durable Object + SQLite, `@callable`, `queue`, `runWorkflow` — not long bake on the request path.
6. **Telemetry:** `obsPushAiEvent` + structured logs; never log secrets/JWT.
7. **Secrets:** keytar / `wrangler secret put` only.

### AI Worker tool contract (asset-safe)

Agents **must**:

- Resolve files via ObjectStore search / D1 registry / verified CDN keys  
- Magic-byte verify before declaring a mesh production-ready  
- Prefer `grudge-convert` bake → signed R2 PUT → D1 seed  
- Send 3D to Forge with **CDN URL**, not untracked local blobs for production  

Agents **must not**:

- Invent Meshy / capsule heroes as ship visuals  
- Write player bag/XP to D1  
- Use `api.grudge-studio.com` for **new** player APIs or as sole catalog SSOT (legacy index only)  
- Store GLB bytes in D1  

---

## 2b. uMMORPG / Warlords extract → Forge (disk, no Editor)

Unity is a **read-only quarry** (`C:\Users\nugye\Desktop\FRESH GRUDGE` only). Safe Mode is irrelevant to this path.

| Artifact | Where |
|----------|--------|
| Extract index | `https://objectstore.grudge-studio.com/api/v1/ummorpg-extract-index.json` |
| Skills (134+) | `…/ummorpg-skills-for-forge.json` |
| Placeables (118, ~111 spawnable) | `…/ummorpg-placeables-for-forge.json` |
| Entity prefabs | `…/warlords-entity-prefabs.json` |
| Forge TS | `Grudge-Studio-Forge/artifacts/game-forge/src/lib/ummorpgCatalog.ts` |
| Forge public JSON | `…/public/data/ummorpg-*.json` |
| C# reference + best practices | ObjectStore `assets/ummorpg-extract/` · `docs/UMMORPG_TO_WARLORDS_BEST_PRACTICES.md` |

```powershell
# From grudge-dev-tool (calls ObjectStore scripts)
npm run catalog:ummorpg
# or ObjectStore directly:
cd F:\GitHub\ObjectStore
node scripts/extract-ummorpg-for-warlords.mjs
node scripts/build-ummorpg-forge-catalog.mjs
node scripts/publish-static-json.mjs ummorpg-skills-for-forge ummorpg-placeables-for-forge ummorpg-extract-index
```

**DONE for placeable:** `modelUrl` HEAD 200 + spawnable in Forge.  
**DONE for skill port to Warlords:** key fires + anim + CD on play URL (separate client slice).

---

## 3. D1 best practices (asset INDEX)

| Database | Purpose |
|----------|---------|
| `grudge-assets-db` | `asset_registry` (+ versions) — fleet file index |
| `grudge-objectstore` | ObjectStore search index |
| `grudge-ai-hub` | AI job / event tracking |
| `grudge-assets` (D1 name) | Backend catalog (HERO-/EQIP-…) — **name collides with R2 bucket** |

### Rules

- **Stable string PKs** (UUID / human-prefixed); `r2_key` UNIQUE  
- **prepare + bind**; never string-concat user input into SQL  
- **`batch()`** for multi-upsert (transactional abort on failure)  
- Seed remote with **≤ 100 statements** per wrangler batch  
- Index filter columns: `category`, `updated_at`, `kind`, `race`, `slot`, `status`  
- JSON column for evolving meta; promote query fields to real columns  
- **Player state = Railway Postgres**, not D1  

---

## 4. R2 best practices (binaries)

| Bucket | Public host |
|--------|-------------|
| `grudge-assets` | `https://assets.grudge-studio.com` |
| `grudge-gamedata` | via asset-api / ObjectStore |
| `grudge-scenes` | planned scene JSON |

### Rules

1. **Custom domain only** for production (not `r2.dev` rate-limited dev URL).  
2. **CDN Worker** serves MIME, CORS, ETag, long cache for immutable keys.  
3. **Idempotent upload:** local hash vs ETag; skip unchanged.  
4. **Multipart** for large objects (~50–100 MB+); parts 5 MiB–5 GiB, ≤10k parts.  
5. **Metadata:** `Content-Type`, `Cache-Control`, `source-hash`, `grudge-uuid`, `category`.  
6. **Keys:** human-readable `models/…`, `textures/…`, `asset-packs/<id>/v<ver>/…`.  
7. **Admin-gate writes**; prefix ACL (`asset-packs/`, `user-uploads/<id>/`, …).  
8. Prefer **bindings** from Workers; S3 API from CLI/desktop bulk.  
9. Optional: **Local Uploads** (beta) for global admin upload latency.

### Dev Tool browse UX

```
Browser → tree list prefixes
Filter: plain text = client filter
Filter: >sword   = server search when ObjectStore search is wired (do not rely on client…/api/objectstore/search — 404)
Click file → AssetPreview + pop-out always-on-top Viewer
→ Copy CDN · Download · Send to Forge (CDN URL only for production)
```

---

## 5. Stream best practices (video / cinema)

**Status (2026-08): PLANNED / partial** — short UI/combat clips stay on **R2** (`assets…` video/mp4). Full Cloudflare Stream cinema pipeline (uid + R2 master) is **not** fleet-wide yet. Do not block game deploys on Stream.

| Use Stream (when live) | Keep on R2 only |
|------------------------|-----------------|
| Trailers, long cinema plates | Short UI mp4 loops (current default) |
| Adaptive bitrate / HLS | Tiny SFX-adjacent clips |
| Live ops / broadcasts | 3D models (**never** Stream) |

### Rules (when enabling Stream)

1. **Master on R2** → Stream **copy from URL** (`/stream/copy`) when possible.  
2. Store **Stream `uid` + `r2_master_key` + grudge UUID** in D1/ObjectStore.  
3. Live: &lt;12 Mbps, GOP 2–8s, prefer CBR; LL-HLS: no B-frames, GOP 2–4s.  
4. Signed tokens for non-public cinema.  
5. CDN Worker must still serve correct `video/mp4` for R2-hosted shorts.

---

## 6. Production asset pipeline (quality bar)

```
raw FBX/OBJ/blend
  → grudge-convert (scale, WebP, collider, anim strip as needed)
  → magic-byte verify
  → R2 signed PUT (idempotent)
  → D1 / ObjectStore registry seed
  → HEAD assets.grudge-studio.com/<key>
  → game loader or Forge import (CDN URL)
```

**grudge6:** race FBX on CDN; equipment prefix meshes; SI ~1.8 m human.  
**Nature/obstacles:** multipack isolation (`meshName` / `nodeName`).  
**Pipeline Worker:** job status only — bake on CLI/desktop/agent.

---

## 7. AI Make & Deploy presets (executable)

| Preset | npm / CLI | Expected output |
|--------|-----------|-----------------|
| Fleet doctor | `npm run doctor` · `npm run doctor:json` | Critical probe score ≥ 85% |
| Fleet probe | `npm run fleet:probe` | Host matrix |
| Worker config audit | `npm run audit:workers` | wrangler.toml checklist |
| Postgres backup | `npm run backup:postgres` | `backups/<stamp>/` (gitignored) |
| uMMORPG → Forge catalog | `npm run catalog:ummorpg` | skills + placeables JSON + publish static-json |
| Deploy GLB pack | ObjectStore convert + `wrangler r2 object put` | CDN keys + optional D1 seed |
| Publish hero | grudge-convert + R2 + Railway model patch | SI-verified grudge6 |
| Stream cinema plate | **planned** | R2 master + Stream uid when Stream is enabled |

Prompts inject `agentBestPracticesPrompt()` from `bestPractices.ts`.

---

## 8. Workers config checklist (fleet audit)

**Hard rule for every CF Worker we ship:**

| # | Check | How |
|---|--------|-----|
| 1 | `compatibility_date` recent (≥ 2025-09, prefer current quarter) | wrangler.toml |
| 2 | `nodejs_compat` | `compatibility_flags = ["nodejs_compat"]` |
| 3 | `wrangler types` / Env contract | `npx wrangler types` or checked-in `worker-configuration.d.ts` |
| 4 | `observability` enabled | `[observability] enabled = true` (+ optional `head_sampling_rate`) |
| 5 | Secrets via wrangler/keytar | `wrangler secret put`; Dev Tool keytar — **never** `[vars]` |
| 6 | Service bindings Worker↔Worker | `[[services]]` when one Worker calls another (prefer over public HTTP) |
| 7 | Queues/Workflows for async | convert/AI jobs — not long work on the request path |
| 8 | No module-level **request** state | No global maps keyed by request; use KV/D1/DO per request |
| 9 | Stream + `ctx.waitUntil` | Stream large bodies; telemetry/side effects in `waitUntil` |

Audit script (local):

```powershell
cd F:\GitHub\grudge-dev-tool
node scripts/audit-workers-config.mjs
```

### Live inventory (2026-08)

| Worker | Host / role | Live? | Config notes |
|--------|-------------|-------|--------------|
| **grudge-ai-hub** | `ai.grudge-studio.com` Legion UI + API | **Yes** health 200 | SSOT domain worker; AI binding + D1 + KV + queue consumer |
| **grudge-legion-ai** | `ai…/v1/*` path edge | **Yes** (same code) | High-priority path routes |
| **grudge-ai-gateway** | GrudgeBuilder `workers/ai` | Staging / jobs | **Must not** steal `ai.*` DNS from hub |
| **grudge-asset-cdn** | `assets.grudge-studio.com` | **Yes** | R2 only |
| **grudgeassets** | `objectstore.grudge-studio.com` | **Yes** | D1 + R2 + ConversionPipeline DO |
| **grudge-identity-api** | `id.grudge-studio.com` | **Yes** | Auth edge → Railway |
| **grudge-wallet-site** | `wallet.grudge-studio.com` | Deployed | Edge shell |
| **grudge-observatory** | `obs.grudge-studio.com` | **Optional / DNS often missing** | Do not fail fleet green on obs; use workers.dev harbor until CNAME |
| **grudge-auth** | `auth.grudge-studio.com` | Legacy | Prefer **id.***; Railway URL fixed to game-data SSOT |
| **legacy asset-api** | `api.grudge-studio.com` | **Live but deprecated for new work** | Asset index GET still 200; prefer ObjectStore + CDN |

### Two AI surfaces (do not merge)

| Surface | Worker / package | Use |
|---------|------------------|-----|
| **Legion** | `grudge-ai-hub` + `grudge-legion-ai` | Fleet chat, agents, vision, image |
| **Coder AI hub** | GrudachainCode `workers/ai-hub` | IDE job/event ingest (separate product) |
| **Dev Tool** | `aiWorkerManager` + Ollama | Desktop routing to Legion / Workers AI / local |

### Code patterns (required)

```js
// Telemetry after response (AI hub)
obs?.http({ method, path, status, latency_ms }); // uses ctx.waitUntil internally

// Good: per-request locals only
export default {
  async fetch(request, env, ctx) {
    const requestId = crypto.randomUUID();
    // …
    ctx.waitUntil(logSomewhere(env, requestId));
    return response;
  },
};

// Bad: module-level maps that grow with traffic
// const sessions = new Map();  // NEVER for request state
```

### Deploy (Legion production)

```powershell
cd F:\GitHub\grudge-ai-hub
npm run deploy          # legion-ai + domain hub
# or: npm run deploy:domain
npx wrangler types --config wrangler.domain.toml   # refresh Env types when possible
```

Secrets: `scripts/set-gemini-secret.ps1`, `wrangler secret put OBSERVATORY_KEY`.

### Growth

| Need | Next step |
|------|-----------|
| Fix obs DNS | CNAME `obs.grudge-studio.com` → Worker; fill D1/KV ids; point `OBSERVATORY_URL` — until then treat as optional |
| Service binding hub → observatory | `[[services]] binding = "OBS" service = "grudge-observatory"` |
| Async convert | ObjectStore `ConversionPipeline` DO + queue; bake still CLI (`grudge-convert`) |
| Stream cinema | Enable only when product needs HLS; keep masters on R2 |
| ObjectStore list/search proxy | Implement client rewrites or document direct Worker admin only |

---

## 9. Related docs

- [systems-api.md](./systems-api.md) — host map + proved ObjectStore paths  
- [database-backups-sharing.md](./database-backups-sharing.md) — Postgres / D1 / R2 recovery  
- [object-storage.md](./object-storage.md) — pack layout + manifests  
- [asset-packs-canonical.md](./asset-packs-canonical.md) — pack taxonomy  
- [one-truth.md](./one-truth.md) — API base  
- [production-deployment.md](./production-deployment.md) — ship runbook  
- [api-reference.md](./api-reference.md) — fleet endpoints  
- Forge: `docs/UMMORPG_EXTRACT_FOR_FORGE.md` in `Grudge-Studio-Forge`  
