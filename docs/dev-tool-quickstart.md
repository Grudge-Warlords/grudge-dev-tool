---
layout: default
title: Quickstart
nav_order: 2
---
# Grudge Dev Tool — Quickstart
## 1. Install
Download `Grudge Dev Tool-Setup-x.y.z.exe` from the team release feed and run it. It installs to `%LOCALAPPDATA%\Programs\Grudge Dev Tool\` by default and adds:
- A Start-menu shortcut **Grudge Dev Tool**
- An optional desktop shortcut
- An entry in the system tray (bottom-right notification area)
## 2. First launch
The window stays hidden — only the tray icon appears. Left-click the icon to open the window; right-click for the context menu.
## 3. Settings
Open **Settings** in the sidebar. You must:
1. Set **API base URL** (default `https://grudgewarlords.com`).
2. Paste a **Grudge bearer token**. Mint one at `id.grudge-studio.com`. The token is stored in Windows Credential Vault via `keytar`; nothing on disk in plaintext.
3. Optional: paste a **BlenderKit API key** to enable the Asset Library page and the `enrich` ingestion stage.
4. Check the **Toolchain** table. Each tool shows green/red:
   - `sharp` — image probe + thumbnails. Required.
   - `gltf-transform` — model probe + rig inspection. Required for model uploads.
   - `Blender` — required for `.blend`/`.fbx`/`.obj` → `.glb` conversion.
   - `ffmpeg` — required for `.wav` → `.ogg`.
   - `BlenderKit` — pinned to `F:\blenderkit-v3.19.2.260411\blenderkit\` (override with `BLENDERKIT_PATH`).
## 4. Browse
Open **Browser**. Type a prefix (e.g. `asset-packs/classic64/`) and click *List*. Use *Load more* to paginate.
## 5. Search
Open **Search**. Free-text query + optional `category` and `pack` filter. Hits the per-pack `manifest.json` server-side.
## 6. Upload
Open **Upload**. Drag files in. Set the target prefix, click *Start upload*. Each file passes through the ingestion pipeline before the PUT.
## 7. Request URL
Open **Request URL**. Paste an object path; get a signed GET URL (10-min TTL) plus the public CDN URL.
## 8. UUID
Open **UUID** to generate or parse Grudge UUIDs locally (no network).
## 9. BlenderKit
Open **BlenderKit Library**. Search the catalog; results stream from the local daemon via `http://127.0.0.1:<port>/v1.8/...`. Requires the API key from step 3.
## Quitting
The window's red-X only hides it. Use the tray menu → **Quit** to fully exit.
