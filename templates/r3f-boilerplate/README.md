# Grudge R3F Boilerplate
A production-grade Three.js + React Three Fiber starter, opinionated for the Grudge Studio engine and asset pipeline.
## Stack
- **Vite + React + TypeScript** — strict mode, ES2022 target.
- **@react-three/fiber 8** — declarative Three.js.
- **@react-three/drei** — Environment, OrbitControls, ContactShadows, Stats, AdaptiveDpr/Events, useGLTF.
- **@react-three/postprocessing** + **postprocessing** — EffectComposer with HDR (HalfFloat) buffer, Bloom + SMAA + ACES ToneMapping.
- **zustand** — scene state, selector-based subscriptions, no provider tree.
- **leva** — dev-only control panel (auto-hidden in production).
- **@tanstack/react-query** — async data layer for asset metadata fetched from R2 / GrudgeBuilder.
## Renderer baseline (`src/engine/Engine.tsx`)
- `dpr={[1, 2]}` — clamped DPR; protects against 4K monitor blow-ups.
- `outputColorSpace = SRGB` and `toneMapping = ACESFilmic` — modern Three defaults made explicit.
- `frameloop="demand"` — render-on-change for editors. Use `invalidate()` after mutations.
- `<AdaptiveDpr/>` + `<AdaptiveEvents/>` — drop quality under load instead of stuttering.
- Soft PCF shadows, key directional + ambient. Single shadow caster keeps perf predictable.
## Postprocessing pipeline (`src/engine/EffectsPipeline.tsx`)
HalfFloat HDR pipeline. Effects merge into a single EffectPass automatically. Order: Bloom \u2192 SMAA \u2192 ACES ToneMapping (LDR conversion last).
## Layout
```
src/
  engine/        # Canvas wrapper, post-processing
  scenes/        # Scene compositions (one tree per `<Engine>`)
  components/    # Reusable scene parts (cameras, lights, UI overlays)
  hooks/         # zustand stores + custom hooks (useDevControls, etc.)
  main.tsx
  App.tsx
public/
  models/        # drop GLBs here for `useGLTF("/models/...")`
  hdri/          # optional HDRIs for custom Environment
```
## Dev / build
```bash
pnpm install
pnpm dev      # http://localhost:5174
pnpm build
pnpm preview
```
## Scaffolding into a new project
From the parent `grudge-dev-tool` repo:
```bash
npm run scaffold:r3f -- "C:\path\to\new-project"
```
That copies this template (excluding `node_modules`/`dist`) into the target dir.
## Patterns to follow
1. **Suspense at the top.** All loaders (`useGLTF`, `useTexture`, `useEnvironment`) suspend; the boilerplate wraps the scene in `<Suspense>` already.
2. **Scene state in zustand.** Don't bridge through props through 5 components.
3. **Use `useFrame` sparingly.** Prefer state-driven mutations + `invalidate()`.
4. **Don't nest `<EffectComposer>`.** One per Canvas.
5. **GLB conventions** match `gltf-asset-pipeline` skill: Draco/Meshopt, sRGB albedo, linear data textures, max 8K, max 250k tris.
6. **Branding tokens** match the dev tool: gold `#ffc62a`, royal `#0a0e1a`, deep gold `#b78a13`.
