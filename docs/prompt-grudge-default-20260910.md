# Automatic Grudge prompt — 2026-09-10

The Prompt to 3D primary field now submits to the existing app action controller with local `grudge-dev` analysis. One controller owns the page prompt and Ask Grudge, retains its action record across navigation, and exposes Stop. Existing creation, editing, material, motion, save, file and editor controls remain available without Hunyuan. Direct creation controls and the deterministic route planner remain optional manual tools.

Ordinary prompts default to existing utilities. Hunyuan/TRELLIS/HY-Motion require an explicit request or provider selection; negations are respected. Pending neural history and saved neural preferences cannot take over default startup. The installed CPU planner can start on a submitted request if necessary; it neither downloads models nor substitutes for grudge-dev. The real checks below used the already available local model.

## Verified result

- Both TypeScript projects, production renderer/main build, icon generation and sandboxed preload checks pass.
- Focused app-action, compound prompt-build and route-planner suites pass. They cover provider opt-in/negation, offline local routes, immutable editing and preserving save evidence across navigation.
- Final packaged operational smoke passes, including the normal default page with a pending concept fixture and explicit opening of the retained optional Hunyuan review workflow. No provider inference is part of that fixture check.
- Real `grudge-dev:latest` executed “Create a blue cube, make it spin, save it, then open it in Forge.” It completed five app actions and the existing compound asset builder, then confirmed the loaded model in Forge.
- The same controller returned to Prompt to 3D and executed “Make it twice as wide and save it.” Both managed saves exist; no Hunyuan job directory was created and neural history remained empty.
- After restarting the isolated app, the exact edited history entry was opened and its Reopen control exercised. File inspection confirms dimensions changed from 1 × 1 × 1 to 2 × 1 × 1 metres while embedded textures and the complete Turntable animation data stayed identical. Both library hashes match their saved bytes. Renderer screenshots show the actual files.

The live checks exposed and repaired two action-runner problems: asynchronous setting confirmation checked too early, and a completed asynchronous save was not retained before navigation. An evidence-collector history-shape error was corrected separately; the successful prompts were retained rather than regenerated.

## Package and evidence

Package: `release/prompt-grudge-default-20260910-v4/win-unpacked/Grudge Dev Tool.exe`.

`app.asar` SHA-256: `b8bcc53f23d932d89ec9a3cddb376ca457aad98f2bf77f05ecc0671ade4f01c5`.

Ten relevant bundled main/shared/preload/renderer files match the current build. Evidence is in `.cache/prompt-grudge-20260910/`: `package-identity.json`, `live-result.json`, `asset-verification.json`, per-prompt receipts, `default-page.png`, `created-in-forge.png`, and `edited-saved-model.png`. The isolated output profile is `profile-4GOhUA`.

These are packaged renderer automation and real model/file checks. They do not establish universal native-dialog, arbitrary-canvas or connected/admin action coverage, unrestricted shell execution, production-quality arbitrary geometry, or new Hunyuan generation/painting. Existing access and exact neural review requirements still apply to optional neural work. No installer publication or replacement of the user's installed/running packages was performed.
