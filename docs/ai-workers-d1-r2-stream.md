---
layout: default
title: AI Workers · D1 · R2 · Stream
nav_order: 4
---

# AI Workers, Cloudflare AI, D1, R2 & Stream — Production SSOT

**Audience:** Grudge Studio admins, Dev Tool agents, Coder AI workers, Forge/Pipeline deploy.  
**Code SSOT:** `src/shared/bestPractices.ts` · `src/main/fleet/aiWorkerManager.ts` · `src/shared/fleet.ts`  
**Skills:** `grudge-d1-r2`, `grudge-warlords-assets`, `grudge-asset-convert`, `grudge-coder`, `grudge-fleet`, Cloudflare `workers-best-practices` / Agents SDK.

Goal: **best possible agent outputs** and **production builds/assets** — no invented meshes, no dead `api.grudge-studio.com`, no D1-as-player-DB mistakes.

---

## 1. Product surfaces (DNS) to keep green

| Host | Role | Owner path |
|------|------|------------|
| `assets.grudge-studio.com` | R2 binary CDN | GrudgeBuilder `workers/cdn` |
| `objectstore.grudge-studio.com` | JSON catalogs + search | ObjectStore Worker |
| `ai.grudge-studio.com` | Legion chat / roles / gateway | `grudge-ai-hub` |
| `coder.grudge-studio.com` | Vibe IDE SPA | GrudachainCode Pages |
| `forge.grudge-studio.com` | 3D map/scene editor | Forge SPA |
| `grudge-pipeline.vercel.app` | Convert handoff → Forge | Pipeline app |
| `client.grudge-studio.com` | ONE TRUTH rewrites | Vercel grudge-builder |
| `id.grudge-studio.com` | SSO | Grudge ID Worker |
| `obs.grudge-studio.com` | AI + fleet telemetry | Observatory Worker |
| `api.grudge-studio.com` | **DEAD** | Do not route |

**Admin desktop:** Grudge Dev Tool — Browse R2/ObjectStore → click file → preview + always-on-top Asset Viewer → copy CDN / download / **send 3D to Forge**. Filter with `>query` for server-side search.

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
- Call dead `api.grudge-studio.com`  
- Store GLB bytes in D1  

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
Filter: >sword   = server-side ObjectStore search
Click file → AssetPreview + pop-out always-on-top Viewer
→ Copy CDN · Download · Send to Forge
```

---

## 5. Stream best practices (video / cinema)

| Use Stream | Keep on R2 only |
|------------|-----------------|
| Trailers, cinema plates, long combat capture | Short UI mp4 loops |
| Adaptive bitrate / HLS | Tiny SFX-adjacent clips |
| Live ops / broadcasts | 3D models (never) |

### Rules

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

## 7. AI Make & Deploy presets (Dev Tool)

| Preset | Expected quality output |
|--------|-------------------------|
| Deploy GLB pack to R2 | Converted GLB + CDN paths + registry rows |
| Publish hero | SI-verified grudge6, CDN, Railway model3d patch |
| Fleet doctor | ONE TRUTH score + failing host list |
| Forge scene → deploy | Optimized scene GLB under `scenes/` + deep links |
| Ensure agentic stack | Ollama + Legion hub health |
| **NEW** Stream cinema plate | R2 master + Stream uid + D1 meta |
| **NEW** D1 reindex pack | Manifest walk → batch upsert remote |

Prompts inject `agentBestPracticesPrompt()` from `bestPractices.ts`.

---

## 8. Workers config checklist

- [ ] `compatibility_date` recent  
- [ ] `nodejs_compat`  
- [ ] `wrangler types` for `Env`  
- [ ] `observability` enabled  
- [ ] Secrets via wrangler/keytar  
- [ ] Service bindings for Worker↔Worker  
- [ ] Queues/Workflows for async convert/AI  
- [ ] No module-level request state  
- [ ] Stream large responses; `ctx.waitUntil` for post-response work  

---

## 9. Related docs

- [object-storage.md](./object-storage.md) — pack layout + manifests  
- [asset-packs-canonical.md](./asset-packs-canonical.md) — pack taxonomy  
- [one-truth.md](./one-truth.md) — API base  
- [production-deployment.md](./production-deployment.md) — ship runbook  
- [api-reference.md](./api-reference.md) — fleet endpoints  
