---
layout: default
title: Databases · sharing · backups
nav_order: 5
description: Grudge Studio multi-store map, cross-game data sharing, and Postgres backup practices adapted from PlanetScale parallel backup design.
permalink: /database-backups-sharing.html
---

# Databases · sharing · backups (canonical)

**Mission:** make backups *boring*, sharing *explicit*, and player data *recoverable* — without hurting live API latency.

Code SSOT: `src/shared/fleet.ts` · `src/shared/bestPractices.ts` · script `scripts/backup-postgres.mjs`  
Fleet DB map (no secrets): GrudgeBuilder `shared/fleet/dbConnections.ts` · `shared/fleet/storage.ts`  
Industry wiring: skill **`grudge-production-wiring`** · asset index **`grudge-d1-r2`**

Design inspiration: [PlanetScale — Massively parallel Postgres backups](https://planetscale.com/blog/massively-parallel-postgres-backups) (filesystem/base backup + WAL catch-up, off-primary workers, object storage, prove-restore every cycle).

---

## 1. Multi-store map (what to protect)

Grudge is **not one database**. Backups and sharing rules differ by layer:

| Layer | Authority | What lives here | Backup class |
|-------|-----------|-----------------|--------------|
| **Player SSOT** | Railway Postgres (`grudge-api-production-0d46`) | users, characters, account bag, island, wallet, JWT auth | **P0 — must dump + prove restore** |
| **Definitions** | ObjectStore / info git JSON | recipes, items, weapons, biomes | **Git is the backup** (tags/releases) |
| **Binaries** | R2 `grudge-assets` → `assets.grudge-studio.com` | GLB, textures, audio, icons | **Versioned keys + multipart re-upload**; optional bucket versioning |
| **Asset INDEX** | Cloudflare D1 (`grudge-assets-db`, `grudge-objectstore`, …) | r2_key → uuid, search meta | **Export or re-seed from manifests** |
| **Realtime rooms** | Per-game Railway (Multiverse `/api/mv`, GRUDOX room, …) | ephemeral room state | **Usually non-durable**; do not treat as player SSOT |
| **Cache** | Puter KV / browser localStorage | mirrors only | **Never sole truth** |

```text
Apps (Open · client · Multiverse · crafting …)
   │
   ├─ PLAYER STATE  →  Railway Postgres   ← backups P0
   ├─ DEFINITIONS   →  ObjectStore / info  ← git history
   ├─ BINARIES      →  R2 CDN              ← keys + magic-byte
   └─ INDEX         →  D1                  ← re-seedable
```

**Law:** D1 is **never** player bag/XP SSOT. Room Railways are **not** character SSOT.

---

## 2. Sharing (cross-game data)

### 2.1 What is shared vs scoped

| Scope | Examples | How games share |
|-------|----------|-----------------|
| **Account** | bag, resources, GBUX, wallet | One Railway account row; all eras/games read same bag |
| **Character** | professions, equipment, progress, revision | Per-character UUID; never merge XP across heroes |
| **Era / game** | `gameEra` on character | Filter roster with `?era=`; one login, many games |
| **Definitions** | recipes, item defs | All games load ObjectStore JSON |
| **Meshes** | grudge6 kits, maps | All games load R2 CDN keys |

### 2.2 Sharing rules (agents + humans)

1. **API only** — games never open `DATABASE_URL` in the browser. Same-origin `/api/*` → Railway (or explicit CORS for Puter sites).
2. **One account, many characters** — Grudge ID JWT; characters are UUIDs owned by that account.
3. **Account bag ≠ character PATCH** — inventory/resources on `/api/account/*`; progress on `/api/characters/:id/progress` with revision.
4. **Optimistic concurrency** — progress writes send expected revision; 409 on stale write.
5. **Idempotent crafts/spends** — client-generated keys for retries.
6. **Definitions not in Postgres** for design data that designers edit as JSON — ObjectStore is the share surface; seed Postgres only if a game truly needs SQL joins on static content.
7. **Each multiplayer game owns its room Railway** when it needs WS (Multiverse `/api/mv` ≠ Carrier). Room state is not a substitute for account/character rows.
8. **CORS allowlist** when a new origin must call Railway: `*.grudge-studio.com`, product domains, `*.puter.site`, localhost.

### 2.3 What must never be “shared” incorrectly

| Bad | Good |
|-----|------|
| Two games with separate character tables as dual SSOT | One Railway roster + era filter |
| D1 as “shared bag” | Railway `/api/account` |
| Multiverse Firebase/Railway room as hero ownership | Railway characters |
| Hardcoding another game’s internal DB URL | Fleet REST + ObjectStore |

---

## 3. Backup principles (PlanetScale → Grudge)

PlanetScale’s parallel design targets petabyte **sharded** clusters. Grudge today is smaller and mostly **one primary Postgres** (player SSOT) plus edge stores. We still adopt their *rules of physics*:

| PlanetScale idea | Grudge practice |
|------------------|-----------------|
| **Make it boring** | Scheduled job + health probe + offsite artifact; no heroics |
| **Don’t thrash the primary** | Prefer `DATABASE_PUBLIC_URL` / off-peak; never long `pg_dump` from app request path |
| **Base + WAL / prove restore** | At our scale: full logical dump **and** quarterly restore drill into a throwaway DB |
| **Object storage destination** | R2 prefix `backups/postgres/<service>/<timestamp>/` (encrypted at rest) |
| **Parallelism** | Dump **tables in parallel** (logical); later, parallel by Railway *service* (api vs rooms) |
| **RPO-aware cadence** | Dump duration must stay **well under** schedule interval (e.g. nightly 15m dump → OK for daily RPO) |
| **Backups ≠ only DR** | Use dumps to seed staging, migrate eras, replace a broken service |
| **Freeze point T** | Every artifact ships `meta.json` with `backupTime`, `source`, `tables`, `rowCounts` |

### 3.1 P0 — Railway player Postgres

**Service:** `grudge-api` on Railway · public health:  
`https://grudge-api-production-0d46.up.railway.app/api/health`

**Priority tables** (names may evolve; always verify with `\dt` / schema):

| Priority | Tables (typical) | Why |
|----------|------------------|-----|
| Critical | `users`, `accounts`, `characters`, `account_inventory`, `account_resources` | Login + heroes + bag |
| High | `home_islands`, `player_ships`, `gbux_transactions`, `uuid_ledger` | Island / economy |
| Medium | sessions, combat logs, dungeon runs | Reconstructible or low RPO need |

**Methods (ordered preference):**

1. **Railway platform snapshots / backups** (if enabled on the Postgres plugin) — lowest ops friction; still keep offsite dumps.
2. **Logical dump** via `scripts/backup-postgres.mjs` (this repo) or Docker `pg_dump`:
   - Full custom/SQL format for full restore.
   - **Parallel table JSONL** for fast, selective recovery and audits.
3. **Physical + WAL** (`pg_basebackup` + continuous archive) — adopt when DB size or RPO demands it (PlanetScale’s gold path). Not required until growth forces it.

### 3.2 Parallel logical dump (what we implement now)

Inspired by “backup workers per shard,” we **parallelize by table** on one Postgres:

```text
backup job (off API process)
  ├─ workers: dump users, accounts, characters, … concurrently
  ├─ write  backups/<stamp>/tables/*.jsonl
  ├─ write  backups/<stamp>/meta.json   ← time T, counts, git sha
  └─ optional: upload → R2 backups/postgres/grudge-api/<stamp>/
```

Rules:

- Run **outside** the HTTP request path (CLI, CI cron, Dev Tool agent task).
- Prefer **read-only** transaction / `pg_dump --serializable-deferrable` when using `pg_dump`.
- Cap concurrency (default 4) so production IOPS stay healthy.
- **Never commit** dump files to git (`backups/` is gitignored).
- After dump: spot-check row counts vs live `SELECT count(*)`.

### 3.3 Prove restore (every cycle eventually)

PlanetScale rebuilds from the previous backup each run so restore is continuously proven. Grudge minimum bar:

| Cadence | Action |
|---------|--------|
| Every dump | Write `meta.json`; verify non-zero critical tables |
| Weekly | Restore dump into local Docker Postgres; run `SELECT count(*)` on critical tables |
| After schema migration | Immediate dump + restore smoke |
| Disaster drill (quarterly) | Full restore to a **new** Railway Postgres → point a staging API at it |

### 3.4 D1 / R2 / ObjectStore (supporting stores)

| Store | Backup / recovery |
|-------|-------------------|
| **D1** | `wrangler d1 export <name> --remote` **or** re-seed from `seed-d1` / ObjectStore manifests (preferred recovery for asset index) |
| **R2** | Immutable versioned keys; re-upload from ObjectStore `dist/` + convert pipeline; magic-byte verify |
| **ObjectStore JSON** | Git history + GitHub Releases; deploy is republish |
| **Room Railways** | Document as ephemeral; if a game stores durable progress only in room state, **that is a bug** — fix wiring to player Postgres |

### 3.5 Secrets & access

| Item | Rule |
|------|------|
| `DATABASE_URL` / `DATABASE_PUBLIC_URL` | Railway / keytar only — never `VITE_*`, never client bundles |
| Dump artifacts | Local `backups/` or private R2 prefix; admin-only |
| Restore credentials | Separate staging credentials; never point production API at a half-restored DB |

---

## 4. Ops runbook

### 4.1 Nightly (or twice-daily) player dump

```powershell
# From grudge-dev-tool — set DATABASE_URL from Railway (public proxy for local tools)
$env:DATABASE_URL = "<from Railway Postgres → Connect → public URL>"
npm run backup:postgres
# artifacts → backups/<iso-stamp>/
```

Optional flags:

```powershell
node scripts/backup-postgres.mjs --concurrency 4
node scripts/backup-postgres.mjs --tables users,accounts,characters
node scripts/backup-postgres.mjs --pg-dump   # Docker postgres:16 pg_dump if available
```

### 4.2 Upload to R2 (offsite)

```powershell
# After local dump — use existing R2 credentials (keytar / env)
# Target key pattern:
#   backups/postgres/grudge-api/2026-08-01T21-00-00Z/meta.json
#   backups/postgres/grudge-api/2026-08-01T21-00-00Z/tables/characters.jsonl
```

Prefer **Worker signed PUT** or S3 API with multipart for large dumps. Same admin gate as asset uploads.

### 4.3 D1 export (asset index)

```powershell
npx wrangler d1 export grudge-assets-db --remote --output=backups/d1-assets-$(Get-Date -Format yyyyMMdd).sql
npx wrangler d1 export grudge-objectstore --remote --output=backups/d1-objectstore-$(Get-Date -Format yyyyMMdd).sql
```

### 4.4 Recovery sketch (player data)

1. Provision empty Postgres (Railway or Docker).  
2. Apply schema migrations (`drizzle` / SQL migrations from GrudgeBuilder).  
3. Restore dump (`pg_restore` or JSONL loaders).  
4. Point **staging** `DATABASE_URL` only; smoke `/api/health` + one test account.  
5. Promote only after validation — never “restore over prod” without a pre-restore dump.

---

## 5. Growth path (when we need PlanetScale-scale)

Adopt physical backups when any of these hit:

- Dump window approaches schedule interval (RPO risk).
- Need point-in-time recovery finer than dump cadence.
- Multiple Postgres primaries (true sharding / multi-region).

Then:

1. Continuous WAL archive to R2 (`wal-g` or managed equivalent).  
2. Base backup off a **standby or ephemeral restore node**, not the busy primary.  
3. Steady-state cycle: restore last base → replay WAL from object storage → short catch-up from primary → freeze time **T** → encrypt → R2.  
4. Parallelize **per Postgres service** (player API, future shards) the same way PlanetScale parallelizes per shard.

Until then, **parallel logical dumps + proved restores** are the correct Grudge bar.

---

## 6. Agent checklist

When touching databases or multi-game state:

```text
[ ] Is this player state? → Railway only
[ ] Is this a definition? → ObjectStore / info, not inventing tables
[ ] Is this a mesh? → R2 + D1 index after convert
[ ] New game multiplayer? → own room Railway if needed; still characters on player API
[ ] Schema change? → migration + immediate backup:postgres
[ ] Sharing bag/XP? → account vs character scope correct
[ ] Never DATABASE_URL in frontend
[ ] Never commit backups/
```

---

## Related

- [Systems & APIs](systems-api.md)  
- [ONE TRUTH](one-truth.md)  
- [Production deployment](production-deployment.md)  
- [AI · D1 · R2 · Stream](ai-workers-d1-r2-stream.md)  
- [Object storage](object-storage.md)  
- PlanetScale: [Massively parallel Postgres backups](https://planetscale.com/blog/massively-parallel-postgres-backups) · [Postgres backups under the hood](https://planetscale.com/blog/postgres-backups-under-the-hood)
