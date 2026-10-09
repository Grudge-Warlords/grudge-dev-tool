---
layout: default
title: AI · Spawn · growth cadence
nav_order: 12
description: Best-practice schedule for free AI, Legion, Spawn worlds, and continuous game improvement from Grudge Dev Tool.
permalink: /ai-spawn-growth-cadence/
---

# AI · Free AI · Spawn · game growth cadence

**Machine SSOT:** [`config/growth-cadence.json`](../config/growth-cadence.json)  
**Live pointers:** `GET https://ai.grudge-studio.com/v1/ssot` → `growth`  
**Free-AI attach:** [FREE_AI_JOIN_SSOT](https://github.com/MolochDaGod/grudge-ai-hub/blob/main/docs/FREE_AI_JOIN_SSOT.md) (Legion hub)  
**Desktop maintenance (separate, fail-closed):** [Daily maintenance](daily-maintenance.md) · <https://grudge-warlords.github.io/grudge-dev-tool/daily-maintenance/>

This is the **operator + agent schedule** for continued growth. It extends Legion, Forge free-ai, Catsot, Telegram, Hermes/n8n, and Spawn — it does **not** invent a second AI brain or bag DB.

## One brain

| Role | Host |
|------|------|
| Brain | `ai.grudge-studio.com` (Legion) |
| Hands | `forge.grudge-studio.com/api/free-ai/*` |
| Companion | Catsot / Grok Builder worker |
| Ops CLI | Telegram `@grudagamebot` |
| Executor | Hermes (VPS) |
| Orchestration | n8n (VPS) — workflows only |
| Multiplayer worlds | Spawn (`spawn.co`) — git live |

Call order: **Groq tools → Legion → Forge free-ai → optional Railway `/api/ai/chat` → xAI/Puter last**.

## Commands (Dev Tool repo)

```pwsh
npm run growth:check      # free AI + Spawn + Legion smoke
npm run fleet:probe       # ONE TRUTH core hosts
npm run maintenance:check # desktop policy (owner-gated schedule)
```

Agent AI presets on `/ai` include **Growth check** and **Spawn world improve**.

## Cadence

### Daily — keep free AI and doors alive

1. `npm run growth:check` (or Agent AI → Growth check).
2. Skim Spawn / Telegram mentions for player friction.
3. Ship **one** smallest fix or smoke a live URL — no invented systems.

### Weekly — game + Spawn improvement

1. Re-run `growth:check` + `fleet:probe`.
2. For each editor Spawn world you own: read `AGENTS.md`, one Tome section by name, one player-facing push to `main`.
3. Priority worlds (see JSON): Nemesis S1 · Warlords · New Game.
4. Ask the linked human when an invite lands: *join a game?* *help build?*

### Monthly — harden best practices

1. `npm run maintenance:check` — budgets/authority still intentional.
2. After Legion deploy: `npm run smoke` in `grudge-ai-hub`.
3. Rotate/reconnect secrets that agents need (`GRUDGE_AI_KEY`, Spawn reconnect) — **never** paste `sak_`.
4. Drop one stale host/dep; refresh waterfall notes if providers change.

## Spawn rules (agents)

- Token at `~/.spawn/token` (or `SPAWN_TOKEN`) — never commit/log/print.
- Existing account → `spawn login --invite …` **without** `--username`.
- Editor: clone with token as password → `AGENTS.md` → docs `?section=` → push `main`.
- Chat: `spawn events --kind chat_mention` or notifications stream; answer with room/DM APIs.

## Anti-patterns

- Second public AI domain next to `ai.grudge-studio.com`
- Browser provider keys / direct `puter.ai.chat`
- Second bag/roster on Spawn or Workers
- Activating `maintenance.policy.json` schedule without owner digest approval
- Mixing unrelated WIP into a “growth check” deploy

## Related

- [vps-ionos-ai.md](vps-ionos-ai.md) — Hermes / n8n
- [ai-workers-d1-r2-stream.md](ai-workers-d1-r2-stream.md) — Workers / D1 / R2
- [admin-architecture.md](admin-architecture.md) — Dev Tool admin loop
