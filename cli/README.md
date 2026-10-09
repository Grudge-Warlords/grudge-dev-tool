# grudge-dev (CLI)

Companion CLI for **[Grudge Dev Tool](https://github.com/Grudge-Warlords/grudge-dev-tool)** — the Windows desktop admin shell (**v1.1.7+**).

This package is **not** a replacement for the tray app. Install the desktop from [Releases](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest); use `grudge-dev` for setup, CI doctor, pack upload, and plugin-host checks against the same **ONE TRUTH** fleet (`https://client.grudge-studio.com`).

| Surface | Role |
|---------|------|
| **Desktop** | Home · Assets · Elite · Forge · Preview · Agent AI · growth cadence |
| **CLI (`grudge-dev`)** | `setup` · `doctor` · `login` · `upload-pack` · `fleet` · `plugin` |

Docs: [CLI quickstart](https://grudge-warlords.github.io/grudge-dev-tool/cli-quickstart.html) · [Growth cadence](https://grudge-warlords.github.io/grudge-dev-tool/ai-spawn-growth-cadence/) · [Systems & APIs](https://grudge-warlords.github.io/grudge-dev-tool/systems-api.html)

## Quick start

```powershell
# From repo
cd cli
npm install
npm run build
npm install -g .

grudge-dev setup
grudge-dev doctor
grudge-dev login --admin-password <your ADMIN_PASSWORD>
grudge-dev upload-pack --root "C:\packs\Classic64" --pack-id classic64 --version 0.6 --dry-run
```

Config: `%USERPROFILE%\.grudge-dev\config.json`. Credentials use **keytar** when available, else `auth.json`.

Desktop growth smoke (repo root, not this package): `npm run growth:check`.

## Commands

| Command | Purpose |
|---------|---------|
| `setup` | Auto-detect `client.grudge-studio.com` or local API + GrudgeBuilder checkout |
| `doctor` | ONE TRUTH probes (manifest, auth, objectstore JSON, icons). `--json` for CI |
| `login` | Save JWT or admin password for `/api/objectstore/*` |
| `fleet` | Canonical URLs + live `/api/fleet/manifest` |
| `upload-pack` | Asset pack ingestion → presigned uploads + manifest |
| `search` | Query `asset-packs/*/manifest.json` catalogs |
| `plugin` | Local plugin host (`127.0.0.1:17380`) status when desktop is running |
| `status` | Print saved config |

## Environment

| Variable | Purpose |
|----------|---------|
| `GRUDGE_API_BASE` | Override API (e.g. `https://client.grudge-studio.com`) |
| `GRUDGE_AUTH_TOKEN` | Bearer JWT (skips keytar) |
| `GRUDGE_ADMIN_PASSWORD` | Admin upload password |
| `GRUDGE_BUILDER_ROOT` | Preferred GrudgeBuilder path for `setup` |

## GrudgeBuilder integration

From a GrudgeBuilder checkout (when wired):

```powershell
npm run upload-pack -- --root "C:\packs\MyPack" --pack-id my-pack --dry-run
```

Backend routes live on the fleet API as `/api/objectstore/*` (client → Railway / ObjectStore). Prefer **Grudge ID** for product login; admin password is for upload automation.

## Desktop (current)

The Windows tray / Electron admin shell **ships today** (latest **v1.1.7**): Elite viewer, Forge embed, Agent AI, free-AI / Spawn growth cadence. This CLI stays the headless / CI companion — it does not replace the installer.
