---
layout: default
title: Pipeline Review AI
nav_order: 20
---
# Pipeline Review AI Worker

**Grudge Three Pipeline** ships a **Pipeline Review** AI worker that plans convert-before-upload, SI, laterality, optimize, R2+D1, and CDN HEAD. Same stack as Scene Completion (`aiChat` + allowlist + heuristic fallback). Not a new Cloudflare Agents SDK app.

| | |
|---|---|
| **Id** | `pipeline-review` |
| **UI** | Pipeline window → **Pipeline AI review** / **Review + send R2/D1** |
| **IPC** | `fleet:pipelineReviewPlan` · `fleet:pipelineReviewInfo` · `fleet:pipelinePrepareUpload` · `fleet:pipelineHeadCdn` |
| **Plan version** | 1 |

## Why it exists (1.1.0 gaps)

v1.1.0 opened 3D in one SceneEngine and added **Send to R2 + D1**, but three things were still manual:

1. **Convert + magic-byte + CDN HEAD** — FBX could go to R2 as DCC; no verify after PUT.
2. **File-defaults / play-kit doctor** — Explorer double-click needed a Settings click; doctor HEADed author FBX, not Toon `human.glb`.
3. **No AI worker on the pipeline** — Scene Completion covers Forge weld/patch; pipeline had no planner for convert → index → HEAD.

## What it does

1. **Diagnose** SI height, clips, maps, skeleton  
2. **Convert** FBX/OBJ/STL/glTF JSON → GLB (FBX2glTF / Blender) + magic-byte  
3. **Laterality** — L/R hand bones on this skeleton (one mixer)  
4. **Strip position tracks** — bones-only rematch; keep root/hips  
5. **SI 2 m** — reminds Shift+Ctrl+LMB when height is off  
6. **Optimize** `grudge-web-v1` when the file is fat  
7. **Upload R2 → seed D1 → HEAD CDN** (only in `convert-upload` / Review + send)  

AI only **plans** allowlisted ops. Convert/HEAD run in main. Clip ops run in the renderer.

## Modes

| Mode | Behavior |
|------|----------|
| `auto` | Heuristic + AI refine. Does **not** PUT R2 (Send to R2 + D1 still converts + HEAD). |
| `convert-upload` | Convert → (optimize) → PUT → D1 → HEAD |
| `character` | Heuristic: laterality + strip-position + mixer (no LLM) |
| `si-only` | Heuristic SI diagnose (no LLM) |

## AI worker best practices

1. Structured JSON only — temperature `0.2`.  
2. Allowlist ops — `normalizePipelineReviewPlan`.  
3. Heuristic fallback if Ollama/Legion/Workers AI are down.  
4. Convert before PUT. Magic-byte. HEAD after PUT. Reject HTML 200.  
5. D1 is the asset **index** — never bag/XP.  
6. Play mesh = Toon `{race}.glb`, not Meshy / capsule / raw FBX.  
7. One mixer. SI 1 unit = 1 m.  
8. Telemetry via `aiChat({ track: true })`.  

## Execute path

```
Pipeline window
  → collectPipelineReviewStats(root)
  → window.grudge.fleet.pipelineReviewPlan(req)
  → executePipelineReviewPlan(plan, ctx)
  → convert / upload / HEAD via fleet.pipelinePrepareUpload + pipelineHeadCdn
```

**Send to R2 + D1** (no AI) now also: convert → magic-byte → PUT → registerAsset → HEAD CDN.

Packaged first launch auto-registers HKCU file-defaults (one-shot). Doctor scores **CDN Toon human.glb**.

## Related code

- `src/shared/pipelineReview.ts` — types, catalog, heuristic  
- `src/main/fleet/pipelineReviewWorker.ts` — AI planner + prepare/HEAD  
- `src/renderer/lib/forge/pipelineReviewExec.ts` — executor  
- Sibling: [Scene Completion](scene-completion-ai-worker.md) (Forge weld/patch)  
