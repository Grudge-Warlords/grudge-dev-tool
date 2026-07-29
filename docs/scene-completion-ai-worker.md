# Scene Completion AI Worker

**Forge** ships a **Scene Completion** AI worker that plans (and the renderer executes) mesh weld/patch and skeleton prep for game assets.

| | |
|---|---|
| **Id** | `scene-completion` |
| **Hotkey** | `Ctrl+Shift+C` / `Alt+C` |
| **IPC** | `fleet:sceneCompletionPlan` · `fleet:sceneCompletionInfo` |
| **Plan version** | 1 |

## What it does

1. **Diagnose** mesh/rig health  
2. **Mesh repair** — fix-mesh, weld, seal/patch open backs, ground, smooth  
3. **Island prep** — ground → weld → seal as one pipeline  
4. **Skeleton** — inspect-rig, Mixamo-25 gap report, ensure AnimationMixer  
5. **Frame** camera on the completed asset  

AI only **plans** allowlisted ops. Geometry changes are **deterministic** in the renderer (`sceneCompletionExec.ts`).

## Modes

| Mode | Behavior |
|------|----------|
| `auto` | Heuristic + AI refine |
| `mesh-repair` | Heuristic mesh pipeline (no LLM) |
| `island` | Island prep pipeline (no LLM) |
| `character-rig` | Rig inspect + Mixamo-25 (no LLM) |
| `full` | Full heuristic + AI refine |

## AI worker best practices

1. **Structured JSON only** — low temperature (`0.2`), no markdown fences.  
2. **Allowlist ops** — reject unknown ops before execute (`normalizeSceneCompletionPlan`).  
3. **Heuristic fallback** — always runnable offline if Ollama/Legion/Workers AI are down.  
4. **Pipeline order** — diagnose → fix-mesh → weld → seal → ground; rig after topology.  
5. **Prefer Ollama** when GRUDACHAIN agentic is up; else Workers AI / Legion hub via `aiChat`.  
6. **Telemetry** — `aiChat({ track: true })` for observatory when available.  
7. **Undo-friendly** — executor pushes history entries per step where possible.  
8. **No silent R2 overwrite** — completion never auto-publishes; deploy stays a separate action.  
9. **Cap tokens** — planner max ~900 tokens; keep 3–12 steps.  
10. **Surface risks** — missing skeleton, open backs, AI failure are listed on the plan.

## Execute path

```
Forge UI / hotkey
  → collectSceneMeshStats(root)
  → window.grudge.fleet.sceneCompletionPlan(req)   // main worker
  → executeSceneCompletionPlan(plan, ctx)          // renderer
  → toast + workbench log
```

## Related code

- `src/shared/sceneCompletion.ts` — types, catalog, heuristic  
- `src/main/fleet/sceneCompletionWorker.ts` — AI planner  
- `src/renderer/lib/forge/sceneCompletionExec.ts` — executor  
- Forge tools: `weldVertices`, `sealOpenBacks`, `prepareIslandAsset`, `inspectSceneRig`, Mixamo-25  
