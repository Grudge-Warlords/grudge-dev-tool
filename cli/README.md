# grudge-dev-tool

Grudge Studio developer CLI (v0.5.0). Upgraded from the v0.4.0 Windows tray concept with a **fully autonomous CLI** that wires into ONE TRUTH fleet endpoints used by `grudge-builder`.

## Quick start

```powershell
npm install -g .
# or: npx grudge-dev-tool setup

grudge-dev setup
grudge-dev doctor
grudge-dev login --admin-password <your ADMIN_PASSWORD>
grudge-dev upload-pack --root "C:\packs\Classic64" --pack-id classic64 --version 0.6 --dry-run
```

Config lives at `%USERPROFILE%\.grudge-dev\config.json`. Credentials use **keytar** when available, else `auth.json`.

## Commands

| Command | Purpose |
|---------|---------|
| `setup` | Auto-detect `client.grudge-studio.com` or local dev API + grudge-builder repo |
| `doctor` | ONE TRUTH probes (manifest, auth, objectstore JSON, icons) |
| `login` | Save JWT or admin password for `/api/objectstore/*` |
| `fleet` | Canonical URLs + live `/api/fleet/manifest` |
| `upload-pack` | Asset pack ingestion → presigned uploads + manifest |
| `search` | Query `asset-packs/*/manifest.json` catalogs |
| `status` | Print saved config |

## Environment

| Variable | Purpose |
|----------|---------|
| `GRUDGE_API_BASE` | Override API (e.g. `https://client.grudge-studio.com`) |
| `GRUDGE_AUTH_TOKEN` | Bearer JWT (skips keytar) |
| `GRUDGE_ADMIN_PASSWORD` | Admin upload password |
| `GRUDGE_BUILDER_ROOT` | Preferred grudge-builder path for setup |

## grudge-builder integration

From grudge-builder:

```powershell
npm run upload-pack -- --root "C:\packs\MyPack" --pack-id my-pack --dry-run
```

Backend routes: `server/integrations/object_storage/devToolRoutes.ts` (`/api/objectstore/*`).

## Tray UI

The Windows system-tray browser app remains planned for v0.6. This release focuses on autonomous CLI setup and CI-friendly `doctor --json`.