# Grudge Studio

[![Release](https://img.shields.io/github/v/release/Grudge-Warlords/grudge-dev-tool?display_name=tag&sort=semver)](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest)
[![Pages](https://img.shields.io/github/actions/workflow/status/Grudge-Warlords/grudge-dev-tool/pages.yml?label=docs)](https://grudge-warlords.github.io/grudge-dev-tool/)
[![Build](https://img.shields.io/github/actions/workflow/status/Grudge-Warlords/grudge-dev-tool/release.yml?label=build)](https://github.com/Grudge-Warlords/grudge-dev-tool/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-internal-lightgrey.svg)](#license)
[![Electron](https://img.shields.io/badge/electron-41.x-47848f.svg)](https://www.electronjs.org/)
[![Three.js](https://img.shields.io/badge/three.js-r169-049ef4.svg)](https://threejs.org/)
[![Node](https://img.shields.io/badge/node-22.x-339933.svg?logo=nodedotjs)](https://nodejs.org/)

**Grudge Studio** — the canonical desktop shell for the **ONE TRUTH** fleet: information, assets, **Forge**, **Coder**, **Engine**, **Treaty**, and play modes in one Windows app.

| Package | Version | What it is |
|---------|---------|------------|
| **Grudge Studio** | v0.7.1 | Tray app: Home, Object Browser + UUID registry, 3D Studio, Forge, Coder, Engine, Treaty, Games |
| **`grudge-dev` CLI** | v0.5.x | Setup, `doctor`, `login`, `upload-pack`, `fleet`, `search` — [`cli/`](cli/) |

📚 **Docs:** <https://grudge-warlords.github.io/grudge-dev-tool/> · [Studio charter](docs/grudge-studio.md) · [CLI](docs/cli-quickstart.md) · [ONE TRUTH](docs/one-truth.md) · [Grudge UUID](docs/grudge-uuid.md)

⬇ **Installer:** [latest release](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest) · Windows x64 · NSIS · auto-updating · product name **Grudge Studio**

---

## ONE TRUTH connection (recommended)

All browser, CLI, and Forge traffic should go through the fleet client:

```
https://client.grudge-studio.com
  ├── /api/fleet/manifest
  ├── /api/auth/verify
  ├── /api/objectstore/v1/*.json
  ├── /api/objectstore/{list,search,upload-url,manifest,asset/*}
  ├── /api/treaty/*          (friends, DMs, groups)
  └── /api/assets/icons/...
```

Vercel rewrites proxy to Railway (game data), identity, objectstore, and the assets CDN. **Do not** point uploads at `api.grudge-studio.com` unless you are on a legacy split-host install.

**CLI**

```powershell
cd cli && npm install && npm run build && npm install -g .
grudge-dev setup
grudge-dev doctor          # expect 100% when fleet is wired
grudge-dev login --admin-password <pw>
```

**Grudge Studio**

1. Install the `.exe` (or auto-update from prior tray builds).
2. **Sign in with Puter** — Studio SSO seeds Forge, Coder, and Treaty (no second login).
3. **Settings → Grudge identity → ONE TRUTH** (sets `client.grudge-studio.com`).
4. Optional secrets: `npm run secret:import path\to\secrets.txt` · HF: `node scripts/store-hf-token.mjs hf_…`
5. **Browser → Index all** once to backfill stable asset UUIDs across R2.

---

## Surfaces (sidebar)

| Group | Tab | What it does |
|-------|-----|--------------|
| **Studio** | Home | ONE TRUTH meter, host map, launchers |
| **Assets** | Browser | R2 folder tree, `> query` search, **Grudge UUID** on each file, **View 3D** → 3D Studio |
| | Search | Server-side pack search |
| | Upload | Ingest pipeline (admin) |
| | Request URL | Public CDN + signed download for any object key |
| | Store | Storefront catalog |
| | **3D Studio** | Local Three.js viewer + **Convert → GLB**; opens models from Browser |
| **Create** | Forge | Full editor webview (`forge.grudge-studio.com`) **or** Quick 3D |
| | Coder | Production IDE embed + local GrudachainCode / HuggingFace |
| | Engine | Grudge6 race kits, live mesh equipment, VFX, R2 roots |
| **Run** | Games | Fleet launcher + play modes (TD / Drive / Arena) |
| | **Treaty** | Friends, DMs, groups (same `/api/treaty/*` as Warlords) |
| | Legion | Agentic RAG (`Ctrl+/`) |
| | Preview | Embedded preview webview |
| **System** | UUID · Docs · Settings | Mint/parse UUIDs, docs, secrets |

> BlenderKit tab removed — not used.

---

## Browser ↔ 3D Studio ↔ Create

```
Object Storage Browser
  ├── folder tree + file grid
  ├── stable Grudge UUID (registry)
  └── View 3D (eye) ──► Assets → 3D Studio (viewer)
                          ├── Convert → GLB
                          ├── Load CDN URL
                          └── Full Forge (optional)

Create → Forge   = production web editor (SSO)
Create → Engine  = Grudge6 race equip playground
```

**Grudge UUID (assets)** — path-stable id for every R2 key:

- Formula: `sha256("grudge-asset-v1:" + key)` → `SLOT-oo-ITEMID-STAMP-COUNTER`
- Registry SSOT: `manifests/grudge-asset-registry/v1/index.json` on R2
- IPC: `window.grudge.registry.{backfill,getByPath,getByUuid,resolve,uuidForPath}`
- Use in inventory / games as durable asset identity across deploys

See [docs/grudge-uuid.md](docs/grudge-uuid.md).

---

## Studio SSO (one login)

When you sign into Studio:

1. Puter session → `puter-sso` → Grudge player JWT  
2. Cookies on module partitions (Forge, Coder, Preview)  
3. Launch URLs with `?grudge_token=`  
4. Webview inject of Puter + `grudge.auth.session` + `grudge:sso-hydrate`  

Forge/Coder/Treaty should not ask you to sign in again while Studio is signed in.

---

## Install

### CLI (from source)

```powershell
git clone https://github.com/Grudge-Warlords/grudge-dev-tool.git
cd grudge-dev-tool/cli
npm install && npm run build
npm install -g .
grudge-dev --version
```

### Grudge Studio (from release)

Download the latest `.exe` from [Releases](https://github.com/Grudge-Warlords/grudge-dev-tool/releases/latest) and run it.

### Grudge Studio (from source)

```powershell
git clone https://github.com/Grudge-Warlords/grudge-dev-tool.git
cd grudge-dev-tool
npm install --legacy-peer-deps
npm run build:icons
npm run dev
```

Requires **Node 22+** (see `.nvmrc`).

### Secrets (optional)

```powershell
# Bulk import
npm run secret:import path\to\secrets.txt

# HuggingFace (Coder AI / HF router)
node scripts/store-hf-token.mjs hf_xxxxxxxx

# Verify
npm run secret:verify
```

Keys live in Windows Credential Vault (`keytar`), not in repo files.

---

## Stack

| Layer | Tech |
|-------|------|
| **Main** | Electron 41 · Node 22 · TypeScript (CommonJS via `tsc`) |
| **Renderer** | Vite · React 18 · Tailwind · TanStack Query 5 · Three.js r169 |
| **Physics (Quick 3D)** | Rapier 3D |
| **Secrets** | keytar + electron-store workspace |
| **Assets** | R2 S3 API · public CDN `assets.grudge-studio.com` |
| **AI** | HuggingFace router · AnythingLLM · multi-provider gateway |

---

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite + Electron watch |
| `npm run build` | Renderer + main production build |
| `npm run typecheck` | Main + renderer `tsc --noEmit` |
| `npm run package` | NSIS installer (`electron-builder`) |
| `npm run publish:manual` | Bump · package · tag · `gh release create` |
| `npm run upload-pack` | Asset pack ingest to R2 |
| `node scripts/store-hf-token.mjs` | Store HF token in keytar |

---

## Release

```powershell
# After commit + push of feature work:
npm run publish:manual -- --bump patch --notes "Short release notes"
# or
npm run publish:manual -- --version 0.7.1 --notes "…"
```

Artifacts: `Grudge Studio-Setup-<version>.exe` + blockmap + `latest.yml` for auto-update.

---

## License

UNLICENSED — internal use within Grudge Studio.
