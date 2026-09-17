---
layout: default
title: IONOS VPS · n8n · Hermes (ALE / GRUDA)
nav_order: 12
---

# IONOS VPS — self-hosted GRUDA / ALE agents

**Not a second Legion. Not player SSOT. Not R2/D1.**  
Live probes (2026-09-17): n8n **200**, Hermes **200**, Legion `ai.grudge-studio.com/health` **200**.

| Surface | URL | Brand on this VPS |
|---------|-----|-------------------|
| n8n | https://n8n.0umigil.cserverhost.cloud | **GRUDA workflows** (package / env / deploy bus) |
| Hermes Agent | https://hermes-agent.0umigil.cserverhost.cloud | **ALE / GRUDA executor** (Nous UI, same roles as Dev Tool) |
| Plesk | `https://<vps-ipv4>:8443` | Host admin only — not a product |

Hardware: IONOS **VPS 2-4-120** (2 vCPU, **4 GB RAM**, 120 GB NVMe). n8n + Hermes already fill that box. Do **not** also run the old `deploy/vps/docker-compose.yml` MySQL/game-api stack here.

Credentials live in the owner desktop VPS note + Windows Credential Vault. **Never commit them.** Rotate anything that was pasted into a plaintext `vps.txt`.

---

## Placement (fill gaps — do not fork)

| Concern | Keep | VPS role | Gap this VPS fills |
|---------|------|----------|--------------------|
| Chat / models | Legion `ai.grudge-studio.com` + `gruda-ai-router` | Optional webhook *into* router | Durable cron / retry when Railway is quiet |
| Desktop agents | Dev Tool Ollama (`localhost:11434`) + Agent AI | Hermes as remote executor UI | 24/7 agent when the desktop is off |
| Player DB | Railway Postgres | None | — |
| Binaries | R2 `assets.grudge-studio.com` | n8n may **call** ObjectStore upload APIs | Nightly HEAD/CDN audit, not a second bucket |
| Definitions JSON | info.* / ObjectStore | None | — |
| Asset index | D1 | n8n can probe `/api` search | Health, not a second registry |
| SPA / editors | Vercel + CF Pages | None | — |
| Workers | CF Workers (`wrangler`) | n8n triggers `wrangler deploy` via SSH/CI | Scheduled redeploy, not a Worker host |
| Packages | `@grudge-studio/*` git + npmjs | n8n `npm pack` / publish job | Unattended publish after a live token |
| Secrets | keytar (Dev Tool) + Railway/CF secrets | n8n credential store for **server** jobs only | Shared env for agent workflows |
| Game physics / three | Hosts (0.185 / Rapier 0.19) | None | — |

IONOS extra IPv4s and game ports (2456–2458, 7777) are for **dedicated game servers** later — not for moving Railway or Cloudflare here.

---

## Agent brands (same system)

| Name | Runs where | Job |
|------|------------|-----|
| **GRUDA** | Dev Tool Agent AI + plugin `:17380` | Make / convert / local terminal |
| **ALE** | Hermes on VPS + Dev Tool `llm.ale` | Treasury / admin executor (`trustsSecrets` path) |
| **Legion** | `ai.grudge-studio.com` | Fleet chat + roles |
| **n8n** | VPS | Graphs: GitHub → doctor → deploy → HEAD CDN |

Do not stand up a third “VPS AI hub” Worker. Hermes prompts must reuse `FLEET_AGENT_ROLES` and ONE TRUTH hosts.

---

## What n8n should own (first workflows)

1. **Fleet health** — GET Legion `/health`, Open, CDN HEAD of a known GLB, Railway `/api/health`. Fail → Discord/Telegram.
2. **GitHub Actions** — on tag `v*.*.*` in `grudge-dev-tool` / `GrudgeStudioNPM`, wait for CI green.
3. **npm publish** — only after a **valid** Automation token (current `~/.npmrc` is 401).
4. **Wrangler / Vercel** — call existing CLIs with vault tokens; do not wrap a second deploy tool.
5. **R2 hygiene** — list + HEAD, never rewrite player rows.

## What Hermes / ALE should own

- Privileged ops the desktop executor already describes: wrangler, vercel, railway, `gh`, `grudge-dev doctor`.
- No Meshy heroes, no D1 player writes, no `api.grudge-studio.com` new APIs.
- After deploy: smoke the **live URL**.

## What stays on the Windows Dev Tool

- Ollama / GPU models (`grudge-dev`).
- keytar + Explorer Elite open.
- Plugin host `127.0.0.1:17380`.
- Local file convert (`grudge-convert`).

4 GB VPS cannot replace a desktop GPU Ollama. Self-hosted **build** here means **agents + n8n**, not 70B weights.

---

## Dev Tool

- Fleet URLs: `FLEET_URLS.vpsN8n`, `FLEET_URLS.vpsHermes`.
- Agent AI tab opens both in the system browser (same as CloudPilot).
- Preview / Settings health chips include the two ops endpoints.

## Security (do this before trusting the box)

1. Change root / Plesk / n8n gate / Hermes passwords; disable password SSH; keep only the deploy key.
2. Rotate the Cloudflare API token and R2 keys that sat in the desktop VPS note.
3. n8n: after first owner account, `/root/auth.sh off n8n` **only** if API clients need it — then put n8n behind auth or IP allow.
4. Do not bind MySQL/Redis to public IPs.

## Hardware ceiling

With 4 GB: n8n + Hermes + Plesk. If you add Ollama, use a **tiny** CPU model only, or a second larger box. Prefer desktop Ollama for GRUDA chat.
