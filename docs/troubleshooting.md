---
layout: default
title: Troubleshooting
nav_order: 6
---
# Troubleshooting & Error Resolutions
A running list of every error we've seen and the exact fix. Cross-referenced from `CHANGELOG.md`.
{: .fs-5 .fw-300 }
## Table of contents
{: .no_toc .text-delta }
1. TOC
{:toc}
---
## App / installer
### "Tray icon doesn't appear"
**Symptom.** Installer succeeds, no error, but no gold-helm icon in the Windows notification area (bottom-right).
**Cause.** `resources/` directory not packaged into the `.exe` — `tray.png` and `icon-256.png` missing at `process.resourcesPath`.
**Fix.** `electron-builder.yml` now ships them via `extraResources:`. Resolved in v0.1.x baseline. If you still see this:
1. Right-click the notification-area arrow (`^`) → enable showing all tray icons.
2. Reinstall from <https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest> if your installed version is < 0.1.0.
### Window doesn't open after install
By design. The window starts hidden. Left-click the tray icon to toggle the **GrudgeLoader** mini-overlay; double-click to open the main window. Right-click for the full menu.
### "DOCTYPE not valid" warning in DevTools
**Cause.** Lowercase `<!doctype html>` in renderer HTML; some validators flag this even though HTML5 spec allows it.
**Fix.** Resolved in **v0.1.2** by switching to canonical uppercase `<!DOCTYPE html>` in both `index.html` and `loader.html`.
### Broken/missing logo (white square next to "GrudgeLoader")
**Cause.** Renderer JSX used absolute `src="/logo-256.png"`. Under packaged Electron's `file://` protocol, this resolves to `file:///logo-256.png` (filesystem root) and 404s. Browsers render the broken-image placeholder.
**Fix.** Resolved in **v0.1.2** — paths switched to `./logo-256.png` (relative). The loader title bar also has an `onError` fallback that swaps to `./favicon.ico` if the primary logo is missing.
### Mysterious "syntax error" / red text in DevTools console
**Cause.** It's almost never a JavaScript SyntaxError. It's a **Content-Security-Policy violation** message that reads similarly. Check for `Refused to connect to '<url>' because it violates the following Content Security Policy directive`.
**Fix.** Resolved in **v0.1.1** — `connect-src` whitelist now includes `https://api.grudge-studio.com`, `https://*.grudge-studio.com`, `https://js.puter.com`, and `http://127.0.0.1:*` (BlenderKit daemon). If you've added a new backend host, edit the CSP in `src/renderer/index.html` and `loader.html`.
### "API unreachable" yellow dot in the status bar
**Cause.** The connectivity probe hits `${apiBase}/api/health` every 30s. If `apiBase` is `https://grudgewarlords.com` (the **frontend**, not the backend), `/api/health` 404s.
**Fix.** Default API base is now `https://api.grudge-studio.com`. If you've already set a custom value in Settings, clear it (it overrides the default; stored in Windows Credential Vault under service `grudge-dev-tool` account `default.apiBaseUrl`).
### "DEFAULT (white) icon" instead of branded helm
Missing `resources/icon.ico`. Run `npm run build:icons` in dev, or reinstall the official release `.exe`.
---
## Build / packaging
### `npm run package` fails with `ENOENT: dist/main/api.js`
**Cause.** `tsc` for the main process didn't emit (race with another build invocation, or you ran electron-builder before `npm run build`).
**Fix.** Run them in order: `npm run build:icons && npm run build && electron-builder --win nsis`. The `npm run package` script handles this for you.
### Build fails with `Cannot find file: elevate.exe` warnings
**Cause.** Stale electron-builder cache; the bundled `elevate.exe` (used by NSIS for elevated installs) wasn't pulled.
**Fix.**
```pwsh
Remove-Item -Recurse -Force release
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign" -ErrorAction SilentlyContinue
npm run package
```
### `package.json` reports "Unexpected non-whitespace character after JSON"
**Cause.** Concurrent edits or a script bug corrupted the JSON. Common pattern: orphan `},` followed by additional script entries outside the `scripts` block.
**Fix.** Validate with `Get-Content package.json -Raw | ConvertFrom-Json`. The repaired structure must close `scripts`, `dependencies`, and `devDependencies` exactly once each.
### `publish:manual` fails with `command failed (null)` on Windows
**Cause.** `spawnSync` with `shell: false` cannot resolve the `.cmd` shims for `npm` and `gh`.
**Fix.** Resolved in **v0.1.3** — `shell: process.platform === "win32"` forced for non-git commands.
### `Type 'X' is not assignable to type 'Y'` (TypeScript) during build:main
Standard TS strict-mode error. Common variants we've hit:
- `res.json()` returns `unknown` → narrow the body shape before reading `.error` (see `src/main/api.ts` `jsonOrThrow`).
- `app.on("window-all-closed", (e) => …)` — Electron typings say no event arg; use `() => {}`.
- `WorkerListResponse.md5Hash: string | null | undefined` vs `ListItem.md5Hash: string | null` — make the canonical type field optional (`md5Hash?: string | null`).
---
## GitHub deployment / Actions
### "Actions has been disabled for this user" on every workflow_dispatch
**Cause.** GitHub anti-abuse flag on the personal account. Independent of org policy, repo policy, billing budget, or admin role.
**Fix that doesn't work.** Toggling org Actions permissions, granting org admin, refreshing token scopes, setting Actions spending budget — all leave the gate in place.
**Fix that does work.** Submit a support ticket at <https://support.github.com/contact> with subject **"GitHub Actions disabled for my account — please re-enable"** and the API response. Typical turnaround 24–48 h.
**Workaround until then.** Use `npm run publish:manual` — does the entire release pipeline (build, commit, tag, push, `gh release create`) locally. See [API Reference](api-reference.md) and the [Quickstart](dev-tool-quickstart.md).
### Pages site shows 404 at `https://grudge-warlords.github.io/grudge-dev-tool/`
**Cause.** Same Actions block as above — `pages.yml` can't run, so no Pages deployment exists.
**Fix.** Wait for the Actions support ticket to resolve. Until then, read docs directly in the repo at `docs/` or browse the rendered Markdown on the GitHub web UI.
### Auto-update doesn't pick up a new release
**Diagnostic checklist.**
1. Open `%APPDATA%\Grudge Dev Tool\logs\main.log` and search for `[updater]`.
2. Confirm the new release has all three artifacts: `Grudge.Dev.Tool-Setup-X.Y.Z.exe`, `.exe.blockmap`, **`latest.yml`**. Missing `latest.yml` blocks auto-update entirely.
3. The release must be **published** (not draft, not pre-release). `gh release view vX.Y.Z --json isDraft` should show `false`.
4. Tag must match `v` + `package.json` version exactly. `v0.1.3` ↔ `0.1.3`.
5. Every 4 h, the running app re-checks. To force, sign out and back in, or restart the app.
---
## BlenderKit
### "BlenderKit not detected" in Settings → Toolchain
**Cause.** Addon not at the probed paths.
**Probe order.**
1. `BLENDERKIT_PATH` env var (production override)
2. `%APPDATA%\Blender Foundation\Blender\<ver>\extensions\user_default\blenderkit` for `<ver>` in 4.5, 4.4, 4.3, 4.2
3. `%APPDATA%\Blender Foundation\Blender\<ver>\scripts\addons\blenderkit` (legacy 3.x layout)
4. Hardcoded dev fallback `F:\blenderkit-v3.19.2.260411\blenderkit\` (set `BLENDERKIT_NO_PINNED=1` to suppress)
**Fix.** Either point `BLENDERKIT_PATH` at your install, or install BlenderKit normally via Blender's Extensions panel and we'll find it automatically.
### BlenderKit search returns nothing / 401
Set your BlenderKit API key in **Settings → BlenderKit → API key**. Stored in Windows Credential Vault.
### Blender headless conversion of `.blend` → `.glb` hangs
Blender 4.x with the new gltf exporter occasionally stalls on Eevee Next preview rendering. Set the file's render engine to Cycles before saving, or run with `--factory-startup`.
---
## Where to get help
1. **Docs site** — <https://grudge-warlords.github.io/grudge-dev-tool/> (live once Actions deploys it).
2. **Logs** — `%APPDATA%\Grudge Dev Tool\logs\main.log`. The bottom-bar **"logs"** link in the app opens that folder.
3. **Issue tracker** — <https://github.com/Grudge-Warlords/grudge-dev-tool/issues>.
4. **CHANGELOG** — <https://github.com/Grudge-Warlords/grudge-dev-tool/blob/main/CHANGELOG.md>.
