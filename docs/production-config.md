---
title: Production Configuration
nav_order: 3
---

# Production Configuration

Complete guide to configuring the Grudge Dev Tool for production use.
All secrets are stored in the **Windows Credential Vault** via keytar —
never in files, environment variables, or the app's config directory.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Grudge Dev Tool                            │
│                                                                 │
│  Backend Mode: r2-direct (default)                              │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────┐  │
│  │ Object Store │  │   Game API    │  │     Puter Auth       │  │
│  │ Browser/     │  │ (health,      │  │ (sign-in, Grudge ID, │  │
│  │ Upload/      │  │  characters,  │  │  cloud save)         │  │
│  │ Search       │  │  missions)    │  │                      │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                      │              │
└─────────┼─────────────────┼──────────────────────┼──────────────┘
          │                 │                      │
          ▼                 ▼                      ▼
   R2 S3 API          api.grudge-studio.com    puter.com
   (direct)            (Railway)              (browser auth)
          │
          ▼
   grudge-assets bucket
          │
          ▼
   assets.grudge-studio.com (public CDN)
```

## Credential Reference

### Required for Object Storage (r2-direct mode)

| Env Var Name | Keytar Account | Description | Example |
|---|---|---|---|
| `OBJECT_STORAGE_ENDPOINT` | `cf-r2-endpoint` | Cloudflare R2 S3 endpoint | `https://<account-id>.r2.cloudflarestorage.com` |
| `OBJECT_STORAGE_BUCKET` | `cf-r2-bucket` | R2 bucket name | `grudge-assets` |
| `OBJECT_STORAGE_KEY` | `cf-r2-access-key-id` | R2 API token access key (32 chars) | — |
| `OBJECT_STORAGE_SECRET` | `cf-r2-secret` | R2 API token secret (64 chars) | — |
| `OBJECT_STORAGE_REGION` | `cf-r2-region` | Always `auto` for R2 | `auto` |

### Required for Public Asset URLs

| Env Var Name | Keytar Account | Description | Example |
|---|---|---|---|
| `OBJECT_STORAGE_PUBLIC_URL` | `cf-r2-public-url` | Custom domain CDN | `https://assets.grudge-studio.com` |
| `OBJECT_STORAGE_PUBLIC_R2_URL` | `cf-r2-public-r2-url` | R2.dev fallback | `https://pub-<hash>.r2.dev` |

### Required for Game API

| Env Var Name | Keytar Account | Description | Default |
|---|---|---|---|
| `GRUDGE_API_BASE` | `default.apiBaseUrl` | Fleet client URL (ONE TRUTH) | `https://client.grudge-studio.com` |
| `GRUDGE_ASSETS_API_BASE` | `default.assetsApiBaseUrl` | Legacy objectstore host override (optional) | *(falls through to fleet client)* |

### Optional — Cloudflare AI Gateway

| Env Var Name | Keytar Account | Description |
|---|---|---|
| `CF_AI_WORKERS_API` | `cf-ai-workers-api` | Workers AI bearer token |
| `CF_ACCOUNT_ID` | `cf-account-id` | Cloudflare account ID (32-char hex) |
| `CF_AI_GATEWAY_ID` | `cf-ai-gateway-id` | AI Gateway ID |

### Optional — ObjectStore Worker (legacy, not used in r2-direct mode)

| Env Var Name | Keytar Account | Description |
|---|---|---|
| `OBJECTSTORE_WORKER_URL` | `cf-objectstore-worker-url` | Worker URL |
| `OBJECTSTORE_API_KEY` | `cf-objectstore-api-key` | Worker bearer token |

## Setup Methods

### Method 1: Import from a secrets file (recommended)

Create a text file with `KEY=VALUE` pairs (same format as `.env`):

```
OBJECT_STORAGE_ENDPOINT=https://ee475864561b02d4588180b8b9acf694.r2.cloudflarestorage.com
OBJECT_STORAGE_BUCKET=grudge-assets
OBJECT_STORAGE_KEY=your-32-char-access-key
OBJECT_STORAGE_SECRET=your-64-char-secret
OBJECT_STORAGE_REGION=auto
OBJECT_STORAGE_PUBLIC_URL=https://assets.grudge-studio.com
CF_ACCOUNT_ID=ee475864561b02d4588180b8b9acf694
GRUDGE_API_BASE=https://api.grudge-studio.com
```

Then run:

```powershell
npm run secret:import -- "C:\path\to\secrets.txt"
# Or import and delete the source file:
npm run secret:import -- "C:\path\to\secrets.txt" --delete
```

### Method 2: Set individual secrets via environment variable

```powershell
$env:OBJECT_STORAGE_ENDPOINT = 'https://ee475864561b02d4588180b8b9acf694.r2.cloudflarestorage.com'
npm run secret:set OBJECT_STORAGE_ENDPOINT
$env:OBJECT_STORAGE_ENDPOINT = $null  # wipe from session
```

### Method 3: Settings page in the app

Open **Settings → Cloudflare R2 + AI Gateway** in the dev tool UI.
Paste values into the input fields — they're stored in keytar immediately.

## Backend Mode

The dev tool supports three object-storage backends. Set via **Settings → Backend** or keytar `backend-mode`:

| Mode | How it works | When to use |
|---|---|---|
| `r2-direct` | AWS SDK S3 calls to `<account-id>.r2.cloudflarestorage.com` | **Production default.** Most reliable. |
| `cloudflare-worker` | JSON fetch to `objectstore.grudge-studio.com/list` etc. | Only if Worker API routes are deployed. |
| `grudge` | JSON fetch to `api.grudge-studio.com/api/objectstore/*` | Only if backend proxies objectstore. |
| `auto` | Tries r2-direct → worker → grudge in order | Safe fallback. |

### ⚠ Common Pitfall: Wrong Endpoint

The `cf-r2-endpoint` value **must** be the Cloudflare R2 S3-compatible URL:

```
✅  https://<account-id>.r2.cloudflarestorage.com
❌  https://objectstore.grudge-studio.com     ← This is a Worker URL, not S3
❌  https://assets.grudge-studio.com           ← This is the public CDN
```

If the endpoint is a Worker URL, the AWS SDK sends XML S3 protocol to it and
gets back HTML, causing: `char '&' is not expected. Deserialization error`.

**Fix:** Set the correct endpoint:

```powershell
$env:OBJECT_STORAGE_ENDPOINT = 'https://<your-account-id>.r2.cloudflarestorage.com'
npm run secret:set OBJECT_STORAGE_ENDPOINT
```

Or construct it from the account ID:

```powershell
# If you know your CF_ACCOUNT_ID:
$env:OBJECT_STORAGE_ENDPOINT = "https://$($env:CF_ACCOUNT_ID).r2.cloudflarestorage.com"
npm run secret:set OBJECT_STORAGE_ENDPOINT
```

## Verification

### Quick CLI check

Run this from the project root to verify all credentials are stored:

```powershell
node -e "
const k = require('keytar');
const S = 'grudge-dev-tool';
(async () => {
  const checks = [
    ['cf-r2-endpoint',      'R2 Endpoint'],
    ['cf-r2-bucket',        'R2 Bucket'],
    ['cf-r2-access-key-id', 'R2 Access Key'],
    ['cf-r2-secret',        'R2 Secret'],
    ['cf-r2-region',        'R2 Region'],
    ['cf-r2-public-url',    'Public CDN'],
    ['default.apiBaseUrl',  'API Base URL'],
    ['backend-mode',        'Backend Mode'],
  ];
  for (const [acct, label] of checks) {
    const v = await k.getPassword(S, acct);
    const safe = ['R2 Endpoint','R2 Bucket','R2 Region','Public CDN','API Base URL','Backend Mode'].includes(label);
    console.log(v ? '✓' : '✗', label.padEnd(16), safe ? (v ?? '—') : (v ? v.length + ' chars' : '—'));
  }
})()
"
```

### Full connectivity test

```powershell
node -e "
const k = require('keytar');
const { S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3');
(async () => {
  const S = 'grudge-dev-tool';
  // API health
  const api = await k.getPassword(S, 'default.apiBaseUrl');
  try {
    const r = await fetch(api + '/api/health', { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    console.log('API:', j.status === 'ok' ? '✓ OK' : '✗ FAIL', '-', api);
  } catch(e) { console.log('API: ✗', e.message); }
  // R2 bucket
  const ep = await k.getPassword(S, 'cf-r2-endpoint');
  const ak = await k.getPassword(S, 'cf-r2-access-key-id');
  const sk = await k.getPassword(S, 'cf-r2-secret');
  const bk = await k.getPassword(S, 'cf-r2-bucket');
  try {
    const s3 = new S3Client({ region:'auto', endpoint:ep, credentials:{accessKeyId:ak,secretAccessKey:sk}, forcePathStyle:true, requestChecksumCalculation:'WHEN_REQUIRED', responseChecksumValidation:'WHEN_REQUIRED' });
    await s3.send(new HeadBucketCommand({ Bucket: bk }));
    console.log('R2:  ✓ OK -', bk, 'at', ep.slice(0,40) + '...');
  } catch(e) { console.log('R2:  ✗', e.message?.slice(0,60)); }
  // CDN
  const cdn = await k.getPassword(S, 'cf-r2-public-url');
  try {
    const r = await fetch(cdn, { method:'HEAD', signal: AbortSignal.timeout(5000) });
    console.log('CDN:', r.status < 500 ? '✓ OK' : '✗ FAIL', '-', cdn);
  } catch(e) { console.log('CDN: ✗', e.message); }
})()
"
```

### In-app verification

1. Open **Settings → Diagnostics** — the status dot should be green (online).
2. Open **Settings → Cloudflare R2** — all credential rows should show "stored".
3. Click **Test R2** — should show "OK · Xms · grudge-assets".
4. Open **Browser** — folders should load from the bucket root.

## Troubleshooting

### `char '&' is not expected. Deserialization error`

**Cause:** `cf-r2-endpoint` is set to a Worker URL or CDN URL instead of the R2 S3 endpoint.
**Fix:** Set it to `https://<account-id>.r2.cloudflarestorage.com`. See the pitfall section above.

### `API unreachable` (yellow dot in status bar)

**Cause:** `apiBaseUrl` points at the wrong host.
**Fix:** Verify it's set to `https://api.grudge-studio.com`, not `https://grudgewarlords.com` (the game frontend).

### Browser shows "Empty" for all folders

**Cause:** Backend mode mismatch — `cloudflare-worker` or `grudge` mode selected but those services don't have working objectstore routes.
**Fix:** Set backend mode to `r2-direct`:

```powershell
node -e "require('keytar').setPassword('grudge-dev-tool','backend-mode','r2-direct').then(()=>console.log('done'))"
```

### `OBJECT_STORAGE_KEY not set in keytar`

**Cause:** R2 credentials weren't imported.
**Fix:** Run `npm run secret:import -- path/to/secrets.txt` with the production credentials file.

### Sign-in fails with timeout

**Cause:** Puter auth opens a browser tab; if it doesn't redirect back within 5 minutes, the promise rejects.
**Fix:** Complete the Puter sign-in in the browser within the window. If the browser didn't open, check your default browser setting.

## Current Production Values

These are the canonical production values for Grudge Studio (non-secret fields only):

```
GRUDGE_API_BASE=https://api.grudge-studio.com
GRUDGE_ASSETS_API_BASE=https://assets-api.grudge-studio.com
OBJECT_STORAGE_ENDPOINT=https://ee475864561b02d4588180b8b9acf694.r2.cloudflarestorage.com
OBJECT_STORAGE_BUCKET=grudge-assets
OBJECT_STORAGE_REGION=auto
OBJECT_STORAGE_PUBLIC_URL=https://assets.grudge-studio.com
CF_ACCOUNT_ID=ee475864561b02d4588180b8b9acf694
```

The R2 access key, secret, Worker API key, and AI tokens must be obtained
from the Cloudflare dashboard or the team's secrets vault.
