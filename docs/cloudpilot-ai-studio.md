---
layout: default
title: CloudPilot AI Studio
nav_order: 14
---
# CloudPilot AI Studio — API & systems (fleet map)

**Version:** 2.0.0  
**Host in fleet:** [coder.grudge-studio.com](https://coder.grudge-studio.com) (CloudPilot shell `/cloudpilot`, GrudgeStudio `/grudge-studio`)  
**Repo:** `F:\GitHub\GrudachainCode` (GrudgeChain Vibe IDE)  
**Dev Tool surface:** **Coder** tab · tray → CloudPilot  

This is **not** a second product host. CloudPilot / GrudgeOS / Arena live on the **Coder** deploy. Dev Tool embeds and hands off with `?from=grudge-dev-tool&embed=1`.

> **Secrets:** Never paste Colyseus deploy keys, SSH keys, or CLI tokens into this repo or chat history that gets committed. Use Windows Credential Vault (`npm run secret:set`) or Coder env only.

---

## Overview

| Capability | Role |
|------------|------|
| **GrudgeOS** | Screen-in-screen IDE (dock, tabs, Puter FS) |
| **Monaco / VSCodeShell** | Editor + Ctrl+S with operations tracking |
| **AI Console** | Multi-model chat via Puter.js |
| **Operations Panel** | Real-time task progress (Zustand OperationsBus) |
| **Arena** | Multiplayer / FlipFlip game side |
| **Agents** | Autonomous solve jobs + extensions |

**Stack:** React · TypeScript · Tailwind · Zustand · Monaco · Wouter · Express · WebSocket · Sharp · glTF-Transform · Puter.js

---

## Architecture

```
Browser → React (GrudgeDock / Arena) → Puter.js → Express backend
```

| Shell | Path | Purpose |
|-------|------|---------|
| GrudgeStudio | `/`, `/grudge-studio` | Main IDE — editor, AI, terminal |
| CloudPilotShell | `/cloudpilot`, `/home` | Cloud management dashboard |
| ArenaShell | FlipFlip toggle | Multiplayer game environment |
| TreatyPage | `/treaty` | Terms |

**FlipFlip:** `client/src/components/flipflip/FlipFlipContext.tsx` — `cloudpilot` ↔ `arena` with WebGL card flip.

**State:** OperationsBus (`client/src/stores/operationsBus.ts`) — `addOperation` / `setProgress` / `appendLog` / `completeOperation` / `failOperation`.

---

## API endpoints (prefer `/api/v1`)

### Core

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/v1/info` | name, version, environment |
| GET | `/api/v1/health` | puterAI, cryptopanic, generativeArt, gbux, discord |
| POST | `/api/v1/ai/chat` | Guidance; prefer Puter AI from the frontend |

Legacy (still active): `/api/info`, `/api/health`, `/api/ai/chat`.

### Agent

| Method | Path |
|--------|------|
| POST | `/api/agent/solve` — `{ prompt, context?, model?, tools? }` → `{ jobId, status }` |
| GET | `/api/agent/solve/:id` |
| GET | `/api/agent/jobs` (max 50) |

### Extensions

`GET|POST /api/extensions` · `GET|PATCH|DELETE /api/extensions/:id`

Default extension ids: `deploy_site`, `ai_chat`, `file_manager`, `kv_store`, `code_generator`, `game_deployer`, `workflow_runner`, `image_processor`, `model_optimizer`, `memory_manager`.

### Convert / deploy

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/image/convert` | multipart · webp/png/jpeg/avif |
| POST | `/api/3d/convert` | GLTF/GLB · optional optimize |
| GET | `/api/deploy/templates` | |
| POST | `/api/deploy/site` | Puter hosting / static |
| POST | `/api/deploy/game` | game server template |
| GET | `/api/deploy/list` · `GET|PATCH|DELETE /api/deploy/:id` | |

### Other

| Method | Path |
|--------|------|
| GET | `/api/crypto/news` |
| POST | `/api/art/generate` |
| GET | `/api/gbux/balance` |
| GET | `/api/discord/auth-url` |
| POST | `/api/terminal/exec` |
| POST | `/api/accounts/gruda` · `GET|POST …/sync` |
| GET | `/api/v1/grudgeos/assets` |
| POST | `/api/v1/grudgeos/ai` — tasks: generate_game, generate_scene, generate_code, fix_code, add_feature, … |

### Arena WebSocket

`ws://host:5000/arena` — join / move / chat / action · server: state_sync, player_*, chat_broadcast, ai_response.

---

## Puter integration (User-Pays)

```js
await puter.ai.chat(prompt, { model: "claude-3-5-sonnet" });
await puter.fs.write(path, content);
await puter.kv.set(key, value);
await puter.hosting.create(subdomain, html); // → *.puter.site
```

Account cloud in fleet: [puter-space](https://ai.grudge-studio.com/puter-space). **Never** bag / roster / wallet.

---

## GRUDACHAIN folder layout (Puter FS)

```
/GRUDACHAIN/
  grudge-core/     config · state · active
  grudge-workers/  config · state · active
  grudge-ai/       models · memory · active
  grudge-users/    profiles · state
```

---

## Dev Tool wiring

| Action | Where |
|--------|-------|
| Open CloudPilot | Tray → **CloudPilot AI Studio** · or Coder tab → CloudPilot chip |
| Open GrudgeStudio IDE | Coder tab → GrudgeStudio chip · `FLEET_URLS.grudgeStudioIde` |
| Local full power | Coder tab → Local · spawn `F:\GitHub\GrudachainCode` PTY |
| Legion (fleet AI) | Agent AI / Legion — **not** the same as Coder Puter AI |

---

## Env (Coder / CloudPilot host — not Dev Tool git)

`ALE_AI` · `CRYPTOPANIC_API` · `GENERATIVE_ART_API` · `GBUX_TOKEN` · `DISCORD_CLIENT_SECRET` · `SESSION_SECRET`

Colyseus / SSH deploy material stays in the **host** secrets store — recycle if ever pasted into chat.
