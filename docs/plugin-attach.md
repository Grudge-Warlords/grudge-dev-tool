---
layout: default
title: Plugin attach
nav_order: 12
description: VS Code, standalone, viewer, and agentic attach to Grudge Dev Tool.
permalink: /plugin-attach.html
---
# Plugin attach (VS Code · standalone · viewer · agentic)

**Local host:** Grudge Dev Tool  
**Loopback:** `http://127.0.0.1:17380`  
**VS Code:** `GrudachainCode/packages/vscode-extension`  
**Do not** invent a second desktop admin app.

Reviewed live systems (practices migrated into the dest-tool kernel):

| Host | What we kept |
|------|----------------|
| [ai.grudge-studio.com](https://ai.grudge-studio.com) | One public brain · `/v1/context` · `/v1/agents/{role}/chat` · Legion ≠ Coder AI hub |
| [coder.grudge-studio.com](https://coder.grudge-studio.com) | Specialties (code/deploy/create/gamedev) · Puter User-Pays · `?from=grudge-dev-tool` handoff · vscode-extension + three-plugin |
| [forge.grudge-studio.com](https://forge.grudge-studio.com) | Command stack · Rapier only · SI metres · sRGB · meshopt GLB · send 3D via CDN URL |

## Form factors

| Surface | How |
|---------|-----|
| **Dev Tool** | Starts the host on app ready. Agent AI tab shows origin + token. |
| **Standalone** | Open `http://127.0.0.1:17380/` while dest-tool is running. |
| **VS Code** | Install `packages/vscode-extension` VSIX. Commands attach dest-tool first, then Legion / Coder. |
| **Viewer** | `POST /v1/viewer/open` `{ localPath }` or `{ url }` → 3D/scene **ThreeFlow**; media **Elite**. |
| **Local file** | `GET /v1/local-file/<name>?path=` — loopback mesh for live ThreeFlow (CORS + private-network). |
| **Agentic** | `POST /v1/agent/run` `{ task }` — same cascade as in-app Agent AI. |
| **CLI** | `grudge-dev plugin status\|practices\|chat\|viewer` |

## Auth

Token required for agent / viewer / open (not `/health` or `/v1/practices`).

Written to:

- `%APPDATA%/Grudge Dev Tool/plugin-token`
- `%APPDATA%/grudge-dev-tool/plugin-token` (discover path for VS Code + CLI)

Override: `GRUDGE_PLUGIN_TOKEN` · `GRUDGE_PLUGIN_ORIGIN` · `GRUDGE_PLUGIN_PORT`.

## Routes

```text
GET  /health
GET  /v1/manifest
GET  /v1/practices?source=forge|coder|legion|devtools
GET  /v1/surfaces
GET  /                         standalone panel
POST /v1/agent/chat            { messages[] }
POST /v1/agent/run             { task, role? }
POST /v1/viewer/open           { localPath? | url? }
POST /v1/open                  { target: forge|coder|ai|devtools|standalone }
```

## Smoke

```powershell
# dest-tool must be running
curl http://127.0.0.1:17380/health
grudge-dev plugin status
grudge-dev plugin practices
```
