---
layout: default
title: Production config
nav_order: 5
description: Secrets, keytar accounts, ONE TRUTH env, and credential verification for Grudge Dev Tool.
permalink: /production-config.html
---

# Production configuration

Secrets live in the **Windows Credential Vault** via keytar — not in committed files.  
Host map: [Systems & APIs](systems-api.md) · [ONE TRUTH](one-truth.md).

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Grudge Dev Tool                            │
│  Backend: r2-direct (default) | cf-worker | fleet client        │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────┐  │
│  │ Object Store │  │   Game API    │  │     Puter Auth       │  │
│  │ Browser/     │  │ (health,      │  │ (sign-in, Grudge ID) │  │
│  │ Upload/Search│  │  characters)  │  │                      │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
└─────────┼─────────────────┼──────────────────────┼──────────────┘
          ▼                 ▼                      ▼
   R2 S3 API     client.grudge-studio.com    puter.com
          │              (ONE TRUTH)
          ▼
   assets.grudge-studio.com
```

## Credential reference

### Object storage (r2-direct)

| Env | Keytar | Description |
|-----|--------|-------------|
| `OBJECT_STORAGE_ENDPOINT` | `cf-r2-endpoint` | R2 S3 endpoint |
| `OBJECT_STORAGE_BUCKET` | `cf-r2-bucket` | e.g. `grudge-assets` |
| `OBJECT_STORAGE_KEY` | `cf-r2-access-key-id` | Access key |
| `OBJECT_STORAGE_SECRET` | `cf-r2-secret` | Secret |
| `OBJECT_STORAGE_REGION` | `cf-r2-region` | `auto` |
| `OBJECT_STORAGE_PUBLIC_URL` | `cf-r2-public-url` | `https://assets.grudge-studio.com` |

### Fleet / API

| Env | Keytar | Default |
|-----|--------|---------|
| `GRUDGE_API_BASE` / `GRUDGE_CLIENT_URL` | `default.apiBaseUrl` | `https://client.grudge-studio.com` |
| `GRUDGE_GAME_DATA_URL` | `fleet.gameDataUrl` | Railway `grudge-api-production-0d46…` |
| `GRUDGE_ID_BASE` | `fleet.idBase` | `https://id.grudge-studio.com` |
| `GRUDGE_LEGION_HUB` | — | `https://ai.grudge-studio.com` |
| `GRUDGE_AI_KEY` | — | Legion / hub key |
| `OLLAMA_HOST` | electron-store | `http://localhost:11434` |

### Cloudflare AI (optional)

| Env | Purpose |
|-----|---------|
| `CF_ACCOUNT_ID` | Account |
| `CF_AI_*` / `cf-ai-workers-api` | Workers AI / Gateway |
| ObjectStore Worker URL + API key | `cf-objectstore-*` |

## Never store / never use

| Host | Why |
|------|-----|
| `https://api.grudge-studio.com` | Deprecated |
| `https://auth.grudge-studio.com` | Use **id** only |
| `OBJECT_STORAGE_ENDPOINT=https://objectstore.grudge-studio.com` | That is the Worker, not R2 S3 |
| `molochdagod.github.io/ObjectStore` | Not production |

## Import & verify

```powershell
npm run secret:import -- "$env:USERPROFILE\secrets\grudge-production.env"
npm run secret:verify
npm run verify:stack   # secrets + session + doctor + fleet probe
```

## Related

- [Production deployment](production-deployment.md)  
- [Object storage](object-storage.md)  
- [AI · D1 · R2 · Stream](ai-workers-d1-r2-stream.md)  
