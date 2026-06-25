---
layout: default
title: Quickstart
nav_order: 4
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

1. Set **API base URL** to **`https://client.grudge-studio.com`** (ONE TRUTH Vercel rewrites). Legacy `api.grudge-studio.com` still works for direct VPS calls but the client host is preferred for objectstore + fleet probes.
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

## 10. Preview (admin-only)

Open **Preview** to load any HTTP/HTTPS URL or local `.html` file inside a sandboxed Electron `<webview>`. The URL bar accepts bare hostnames; use **Open `.html`…** to browse for a local build artifact (e.g. a Vite `dist/index.html`). The page ships with back / forward / reload / stop, devtools toggle, and an "open in default browser" escape hatch. Cookies and localStorage persist between visits in the `persist:grudge-preview` partition.

The guest WebContents runs with `nodeIntegration=false`, `contextIsolation=true`, `sandbox=true`, no preload, and `webSecurity=true` — enforced in the main process via `will-attach-webview`, so previewing untrusted HTML is safe.

## 11. Admin gating

A subset of pages (**Upload · Request URL · Forge 3D · Coder · Games · Preview · Settings**) are admin-only and hidden from the sidebar for non-admin sessions. Admin state is resolved at build time from the two `VITE_ADMIN_*` env vars listed in `.env.example`; the public NSIS installer ships with the allowlist baked in. When admin is active you'll see a gold `ADMIN` pill in the sidebar header, next to the username, and in the bottom status bar.

For dev / support, set `localStorage["grudge:admin-override"] = "true"` in DevTools to force admin on a single machine. Open-mode builds (no allowlist set at compile time) treat every signed-in user as admin and surface an `open-mode build` hint under the user card. Admin is purely a UX gate — the backend and Cloudflare Worker still enforce real permissions on every privileged call.

## Quitting

The window's red-X only hides it. Use the tray menu → **Quit** to fully exit.
