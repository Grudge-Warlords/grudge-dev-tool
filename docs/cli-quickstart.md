---
layout: default
title: CLI Quickstart
nav_order: 2
---
# CLI Quickstart (v0.5.0)

The `grudge-dev` CLI autonomously wires into the Grudge Studio **ONE TRUTH** fleet. It shares the same `/api/objectstore/*` contract as the Forge tray app.

## Install

```powershell
git clone https://github.com/Grudge-Warlords/grudge-dev-tool.git
cd grudge-dev-tool/cli
npm install
npm run build
npm install -g .
```

Or from a linked `grudge-builder` checkout:

```powershell
npm run grudge-dev:setup
npm run grudge-dev:doctor
```

## First run

```powershell
grudge-dev setup
```

This will:

1. Probe `https://client.grudge-studio.com` (then `http://localhost:5000` if local dev is up).
2. Locate `grudge-builder` on disk (`D:\repos\grudge-builder`, Desktop, etc.).
3. Write `%USERPROFILE%\.grudge-dev\config.json`.
4. Run ONE TRUTH probes and print a score.

## Auth

Uploads require admin credentials:

```powershell
grudge-dev login --admin-password <ADMIN_PASSWORD>
# or
grudge-dev login --token <JWT>
```

Env overrides (CI-friendly):

| Variable | Purpose |
|----------|---------|
| `GRUDGE_API_BASE` | Force API host |
| `GRUDGE_AUTH_TOKEN` | Bearer JWT |
| `GRUDGE_ADMIN_PASSWORD` | `X-Admin-Password` header |
| `GRUDGE_BUILDER_ROOT` | Preferred repo path for `setup` |

## Health check

```powershell
grudge-dev doctor
grudge-dev doctor --json   # CI gate — exits 1 if score < 85%
```

Expected on production client:

```
Score: 100%
  ✓ Fleet manifest
  ✓ Auth verify
  ✓ master-items.json
  ✓ master-recipes.json
  ✓ Pack weapon icon
  ✓ Supabase health
```

## Upload an asset pack

```powershell
# Dry run — walk + hash, no network
grudge-dev upload-pack `
  --root "C:\packs\Classic64" `
  --pack-id classic64 `
  --version 0.6 `
  --license CC0 `
  --author "Craig Snedeker" `
  --dry-run

# Real upload
grudge-dev upload-pack --root "C:\packs\Classic64" --pack-id classic64 --version 0.6
```

From `grudge-builder`:

```powershell
npm run upload-pack -- --root "C:\packs\Classic64" --pack-id classic64 --dry-run
```

## Other commands

```powershell
grudge-dev fleet          # canonical URLs + live /api/fleet/manifest
grudge-dev search --pack classic64 -q helmet
grudge-dev status         # print ~/.grudge-dev/config.json
```