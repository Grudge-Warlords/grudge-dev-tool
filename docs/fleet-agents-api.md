---
layout: default
title: Fleet agents & sub-agents
nav_order: 15
---
# Fleet agents & sub-agents (pages · apps · sites · Dev Tool)

**SSOT code:** `src/shared/fleetAgents.ts`  
**Hub:** [ai.grudge-studio.com](https://ai.grudge-studio.com)  
**Desktop:** `window.grudge.legion.chat` · `window.grudge.fleetAgent.bestSubagent`

Do **not** invent a second agent stack per game. All surfaces use Legion hub first.

## Endpoints

| Method | Path | Use |
|--------|------|-----|
| GET | `/health` | Hub up |
| GET | `/api/agents` | Registered agents |
| GET | `/api/models` | Model list |
| POST | `/api/chat` | Chat / tool loop |

Auth: Grudge ID bearer when signed in. Puter User-Pays is for **account cloud** AI only (`puter-space`), not Railway bag/roster.

## Request body

```json
{
  "messages": [{ "role": "user", "content": "…" }],
  "role": "dev",
  "model": "gruda-dev",
  "surface": "page",
  "subagent": "deploy",
  "injectFleetTruth": true
}
```

### Surfaces

`dev-tool` · `page` · `app` · `site` · `worker` · `coder` · `forge` · `ui-studio`

### Sub-agents (best default)

| Kind | When |
|------|------|
| `general` | Default |
| `explore` | Find / where / search |
| `plan` | Design / architect |
| `review` | Audit / QA / bug |
| `deploy` | Vercel / Railway / Wrangler / CDN |
| `assets` | GLB / R2 / icons / textures |
| `character` | Toon / skeleton / anim |

Helper: `bestSubAgentFor(surface, intent)` in `fleetAgents.ts`.

## Browser SPA snippet

```ts
import { fleetAgentChat, bestSubAgentFor } from "./fleetAgents";

const subagent = bestSubAgentFor("page", userText);
const { response, source } = await fleetAgentChat(
  {
    messages: [{ role: "user", content: userText }],
    role: "dev",
    surface: "page",
    subagent,
  },
  { token: grudgeJwt },
);
```

## Dev Tool

Settings → **Fleet connections** stores `VERCEL_TOKEN` / `RAILWAY_TOKEN` / `CF_API_TOKEN` and can redeploy curated targets. Agent AI tab uses Legion + local Ollama fallbacks (same hub contract).

## Fallback order (desktop)

1. Legion hub `/api/chat`  
2. GRUDA agent URL `/api/chat`  
3. Local agent (Ollama → Workers AI → Puter User-Pays)
