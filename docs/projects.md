# Grudge Studio — Project OS

Canonical **on-disk project layout**, save practices, agentic diagnose/auto-fix, and best-asset selection.

## Why

Agents, Forge, Coder, and humans need **one folder contract** so:

- Saves are predictable (`grudge.project.json` is SSOT)
- Binaries do not litter the project root
- CDN + Grudge UUIDs are preferred over inventing URLs
- Auto-fix can re-create missing folders/scenes without guesswork

## Layout

```
project-root/
  grudge.project.json     # SSOT manifest (schema v1)
  scenes/                 # scene JSON
  prefabs/
  scripts/                # gameplay TS/JS
  assets/
    models/
    textures/
    audio/
    vfx/
    ui/
  content/                # design docs, lore
  builds/
  .grudge/
    drafts/               # crash mirrors (do not ship)
    cache/
    diagnostics/          # last diagnose / autofix JSON
```

Default root: `%USERPROFILE%\Documents\GrudgeStudio\Projects`

## Save practices

1. **Always** keep `grudge.project.json` up to date when adding scenes/scripts/assets.
2. Prefer **CDN keys + Grudge UUID** in `preferredAssets` over copying large GLBs.
3. Canonical characters: `models/grudge6/races/*_Characters.glb` (not toon-shooter).
4. Drafts only under `.grudge/drafts/`.
5. After AI edits: **Diagnose → Auto-fix → re-Diagnose**.

## Studio UI

**Studio → Projects**

- Scaffold new project (starter Main scene + script + preferred Grudge6 assets)
- Diagnose / Auto-fix / open folder
- Search **best assets** (registry + race kits + R2)
- Copy agent prompt for Legion

## Agent tools (GRUDA / Legion)

| Tool | Purpose |
|------|---------|
| `project_scaffold` | Create organized project |
| `project_diagnose` | Lint layout + manifest |
| `project_autofix` | Create folders, seed assets, restore files, move loose binaries |
| `asset_best` | Best CDN/registry assets for a query |
| `asset_uuid` | Path-stable Grudge UUID |
| `race_kits` | All Grudge6 race CDN URLs |
| `r2_list` / `r2_url` | Object storage |

Tool protocol: model emits `<tool>{"tool":"…","args":{…}}</tool>` — main process runs it and continues the loop (up to 5 rounds).

## Forge

- `diagnose_scene` — scene lint
- `auto_fix_scene` — add sun/ground/player, rewrite placeholder models to Grudge6
- Autosave + `localStorage` draft mirror remain the in-browser save safety net

## IPC

```ts
window.grudge.projects.scaffold({ name, kind })
window.grudge.projects.diagnose(dir)
window.grudge.projects.autofix(dir)
window.grudge.projects.bestAssets(query)
window.grudge.projects.layout()
```

## Code map

| Path | Role |
|------|------|
| `src/shared/projectLayout.ts` | Layout constants + starter templates |
| `src/main/projects/index.ts` | Scaffold / diagnose / autofix / best assets |
| `src/main/ai/agentTools.ts` | Shared agent tool registry |
| `src/main/ai/grudachainAgent.ts` | Tool loop + RAG / HF / Ollama |
| `src/renderer/pages/Projects.tsx` | UI |
