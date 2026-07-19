# GitHub Copilot / IDE agents — Grudge Dev Tool

## Product

Electron **Grudge Studio Forge** + `grudge-dev` CLI for ObjectStore, R2, Fleet health, AI workers, Ollama, BlenderKit, Forge 3D.

## ONE TRUTH (do not invent parallel systems)

| Concern | Host |
|---------|------|
| Auth | `https://id.grudge-studio.com` |
| Game data | `https://grudge-api-production-0d46.up.railway.app` |
| Fleet client | `https://client.grudge-studio.com` |
| ObjectStore | `https://objectstore.grudge-studio.com/api/v1` |
| CDN | `https://assets.grudge-studio.com` |
| AI hub | `https://ai.grudge-studio.com` |
| Forge | `https://forge.grudge-studio.com` |

**Forbidden:** new auth stacks, `api.grudge-studio.com` for new routes, D1 as character SSOT, inventing second inventory stores.

## Architecture

- `src/main` — Electron main, secrets (keytar), R2, AI, Ollama, Legion
- `src/renderer` — React + Vite only via `window.electronAPI`
- `src/shared` — fleet URLs, UUID, IPC types
- `cli/` — autonomous doctor / upload-pack
- `docs/` — GitHub Pages (Jekyll)

## Secrets

- Never commit `.env` with real values.
- Use `npm run secret:import` → Windows Credential Vault.
- See `docs/production-config.md` and `docs/production-deployment.md`.

## Commands

```
npm run typecheck
npm run fleet:probe
npm run doctor
npm run package
```

## UUID

Import only from `src/shared/grudgeUUID.ts` — do not reimplement.

## Three.js / assets

Production meshes via CDN + convert pipeline (`grudge-asset-convert` skill). No Meshy/capsule placeholders as shipped art.
