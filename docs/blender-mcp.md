---
layout: default
title: Blender MCP Integration
nav_order: 8
---
# Blender MCP Integration

**MCP** (Model Context Protocol) is an open standard that lets AI agents — Claude Desktop, GitHub Copilot, the dev tool's agentic overlay, or any MCP-compatible client — call tools exposed by a local server.  The `blender-mcp` add-on turns a running Blender instance into one of those tool servers, giving any connected AI direct, two-way control over Blender scenes via structured JSON calls rather than a subprocess-and-script shell-out.

This document covers how to set up the Blender MCP server, wire it to the clients used in this project, and which Grudge Studio workflows benefit most.

---

## How it works

```
AI client (Copilot / Claude / Ollama overlay)
        │  JSON-RPC over stdio / TCP
        ▼
  MCP host (claude-desktop, VS Code extension, dev-tool agent loop)
        │
        ▼
  blender-mcp add-on (WebSocket server inside Blender, default :9876)
        │  bpy calls
        ▼
  Blender scene
```

The add-on registers a local WebSocket server inside Blender.  The MCP host (e.g. Claude Desktop, the VS Code MCP extension, or the dev tool's `agent.ts` loop) connects and exposes tools like `execute_blender_code`, `get_scene_info`, `get_object_info`, `create_object`, `modify_object`, `set_material`, `render_image`, `get_polyhaven_asset`, and `import_fbx`.

No data leaves your machine unless you intentionally call an external API (e.g. Poly Haven download, Hyper3D generation).

---

## Prerequisites

| Requirement | Version | Notes |
| --- | --- | --- |
| Blender | 4.x recommended | Must remain open during use |
| Python | 3.11+ | Ships with Blender 4.x |
| Node | ≥ 22 | Already required by dev tool |
| blender-mcp add-on | latest | See install below |
| MCP client | any | Claude Desktop, VS Code, dev-tool agent |

---

## Install the Blender add-on

1. Download the latest `blender_mcp.zip` from the [blender-mcp releases page](https://github.com/ahujasid/blender-mcp/releases) (MIT licence — attribution kept).
2. In Blender: **Edit → Preferences → Add-ons → Install from disk** → select the zip.
3. Enable **Blender MCP** in the add-on list.
4. In the **3D Viewport sidebar (N)**, find the **BlenderMCP** tab.
5. Click **Start MCP Server**.  Default port is `9876`.  The status line shows `Server running on port 9876`.

The server stops when Blender closes or you click **Stop MCP Server**.  It survives save/load within the same session.

---

## Connect a client

### Claude Desktop

Add to `~/AppData/Roaming/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "blender": {
      "command": "uvx",
      "args": ["blender-mcp"]
    }
  }
}
```

Restart Claude Desktop.  A `blender` tool icon appears in the tools panel.

### VS Code / GitHub Copilot (MCP extension)

In `.vscode/mcp.json` (workspace) or the user MCP settings:

```json
{
  "servers": {
    "blender": {
      "type": "stdio",
      "command": "uvx",
      "args": ["blender-mcp"]
    }
  }
}
```

### Dev tool agentic overlay (`agent.ts`)

The `agent.ts` main-process module connects via WebSocket directly to `ws://127.0.0.1:9876` so no external MCP host is required.  The agent loop calls the same tool set as Claude Desktop.

IPC channel (add to `src/shared/ipc.ts`): `agent:blender:call` / `agent:blender:status`.

When Blender is not open or the server is not running, `agent.ts` falls back to the existing headless `blender --background` subprocess path documented in [BlenderKit use-cases](blenderkit-use-cases.md).

---

## Available tools (blender-mcp default set)

| Tool | What it does |
| --- | --- |
| `get_scene_info` | Returns names, types, locations of all scene objects |
| `get_object_info` | Detailed info (mesh stats, materials, transforms) for one object |
| `execute_blender_code` | Run arbitrary Python / `bpy` code — maximum flexibility |
| `create_object` | Add primitive mesh, camera, or light |
| `modify_object` | Move, rotate, scale, toggle visibility, rename |
| `set_material` | Assign or create a material with colour and roughness |
| `render_image` | Render the active camera to a temp PNG and return the path |
| `import_fbx` / `import_glb` | Import an FBX or GLB from a path |
| `export_glb` | Export scene (or selection) to GLB |
| `get_polyhaven_asset` | Download and import a Poly Haven asset by slug |
| `generate_hyper3d_model` | Text-to-3D via Hyper3D Rodin API (requires key) |

All tools accept and return plain JSON.  `execute_blender_code` is the escape hatch for anything not covered by the named tools.

---

## Grudge Studio workflow integration

### Asset creation and ingestion

The agent instructs Blender to import a source asset (FBX from R2), apply rig-verify and material-budget rules from `asset_inspector.py`, export a clean GLB, then hands the path back to the dev tool's ingestion pipeline (`ingest:one` IPC).  This closes the loop: AI prompt → Blender processing → R2 upload in a single agent turn without manual steps.

### Auto-thumbnail pipeline

Instead of the sharp-based fallback, the agent calls `render_image` after setting up a Blender studio lighting rig.  The resulting PNG is passed to the ingestion `size-verify → convert → upload` stages.  This replaces the `bk_autothumb.py` subprocess path and gives the AI agent dynamic control over camera angle and lighting.

### Character mesh and rig work

Agent calls `import_fbx` with the race model path from `assets.grudge-studio.com`, then uses `execute_blender_code` to run the Grudge rig-check script (`bk_enrich.py --offline`), toggle equipment child meshes, and export a per-config GLB.  The resulting export is a directly-playable character asset for Three.js / R3F scenes.

### Scene composition

The AI agent builds out a Three.js scene by composing geometry in Blender first, exporting GLB, then loading the result in Forge 3D for a live preview before uploading.  Prompt-to-scene takes one agent loop iteration.

### Texture and material QC

`execute_blender_code` calls `asset_inspector.py` helpers to count shader nodes, check UDIM tile counts, and flag assets that exceed the Grudge texture budget before they reach R2.

---

## Security notes

- The MCP server binds to `127.0.0.1` only — not accessible from the network.
- `execute_blender_code` runs arbitrary Python inside your Blender process.  Treat AI-generated `bpy` code the same as any other code execution.
- No credentials are passed through blender-mcp.  R2 keys and API tokens stay in keytar / the dev tool main process.
- The Poly Haven and Hyper3D tools make outbound HTTPS calls.  Review their terms before using them with Grudge-owned content.

---

## Troubleshooting

**Server does not start**
Confirm the add-on is enabled in Preferences.  Check the Blender system console (`Window → Toggle System Console`) for Python import errors.

**Client cannot connect**
Confirm Blender is open and the BlenderMCP tab shows `Server running`.  The port must be `9876` (or match whatever you set in the tab).  Firewall rules on `127.0.0.1` are unusual but check Windows Defender if nothing connects.

**`execute_blender_code` returns a Python traceback**
The tool runs the code in the Blender Python context — `bpy` import errors and `AttributeError` on removed API symbols are the most common causes.  Use `get_scene_info` first to confirm the server is alive, then narrow the failing code.

**Blender freezes during a long render**
Rendering blocks the Blender UI thread.  `render_image` is synchronous; the dev tool's agent loop will wait.  Use Blender's `Cycles` device settings to accelerate, or switch to `EEVEE` for draft thumbnails.

---

## Attribution

`blender-mcp` is MIT-licensed, authored by Siddharth Ahuja.  The Grudge Dev Tool uses it as an external tool — no GPL code is linked into the Electron binary.

---

## See also

- [BlenderKit use-cases](blenderkit-use-cases.md) — headless Blender without an MCP server
- [Troubleshooting](troubleshooting.md)
- [API reference](api-reference.md)
