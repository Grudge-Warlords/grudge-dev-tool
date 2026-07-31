# Portable toolchain

Install Blender 4.x LTS, ffmpeg, and blender-mcp addon:

```bash
npm run toolchain:install
```

This writes:

- `.env.local` (repo) — `BLENDER_PATH`, `FFMPEG_PATH`
- `%APPDATA%/grudge-dev-tool/toolchain.env` — same for Electron bootstrap

## Blender MCP (AI control)

1. Open portable or system Blender.
2. **Edit → Preferences → Add-ons → Install from Disk** →  
   `tools/blender-mcp/blender-mcp-main/addon.py` (or zip the folder).
3. Enable **BlenderMCP**, open the **N** panel → **BlenderMCP** → **Start MCP Server** (port `9876`).
4. Keep Blender open so Grok / Claude / agent tools can call scene APIs.

Docs: `docs/blender-mcp.md`

## Probe

```bash
npm run toolchain:probe
```
