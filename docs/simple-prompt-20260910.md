# Single-prompt Grudge workspace — 2026-09-10

The opening page has one prompt and **Run with Grudge**. **Hunyuan extras** contains optional 3D-generation and Paint checkboxes; both start off and reset after that request. **Tools & saved work** holds the original manual controls, history and route planner. Grudge reveals the existing controls itself. A saved result opens one model panel, with details and the action record collapsed. The original sidebar and other app tools remain available.

The viewer and Hunyuan interface load only when needed. No empty preview or provider readiness request is mounted on normal startup. The page returns to the prompt after work; an imported base also opens the single result panel. Fresh profiles default to Prompt to 3D; explicit handoffs and retained routes continue to work.

## Final packaged replay

Every row below ran through the real prompt field and installed local **grudge-dev:latest** in directory build **simple-prompt-20260910-v4**. Existing app controls and serializers performed the work.

| Request | Verified result | Actions |
| --- | --- | --- |
| Create a blue cube, make it spin, and save it | Blue cube, saved turntable clip and original managed library entry | 5 |
| Open the current model in Forge | Original Forge editor loaded the saved model | 1 |
| Export the selected model as GLB to the specified path | Real GLB written to that path | 3 |
| Orbit the Scene canvas to the left | Original right-drag mapping changed camera position | 1 |
| Save the scene using Ctrl+S to the specified path | Original shortcut and native destination dialog wrote scene JSON | 3 |
| Load the saved scene | Original file input reopened a scene containing one entity | 3 |

The original existing-asset handoff and **Use this model as base** button also created a working copy, displayed its result, collapsed the tools and preserved the exported source file's hash.

Startup inspection confirmed exactly one visible prompt, no selected extras, closed tools and no empty result/neural panel. After creation, inspection confirmed exactly one visible prompt plus the result, with tools closed.

Camera before: Camera position: 2.2146, 1.9764, 2.9528; target: 0, 0.5, 0; zoom: 1. After orbit: Camera position: 3.4614, 1.9764, 1.2815; target: 0, 0.5, 0; zoom: 1.

## Optional extras and independence

In a separate isolated profile with no Hunyuan provider configured, selecting both extras and submitting **Create a red cube** reached the original Hunyuan controls, enabled the existing local controls, selected prompt input and filled the subject automatically. It stopped with the actual setup message: “This enhancement needs its local provider installed and verified.” It did not ask for a second prompt, start a substitute job or silently change generation method.

The same profile then successfully ran **Create a green sphere and save it** through the native creation tools (6 actions). Both extras reset and no Hunyuan job was created. This verifies selection, native handoff and provider independence; it does not claim Hunyuan geometry or Paint was generated in this trial.

## Repairs found during replay

- A decorative canvas could make a named scene request ambiguous. The controller now identifies the original scene from its name, camera state and input mapping. An unavailable requested canvas cannot redirect into unrelated asset browsing.
- The optional workflow could navigate back to its own page. Neural setup is now constrained to its existing controls and uses the original submitted subject.
- Model replies are checked against the permitted next action, target and fixed values before execution, in addition to the existing owner, document, element and sensitive-action checks.

## Verification and build

- Final type check and production renderer/main/icon/preload builds passed.
- App-action checks passed, including multiple/equally named canvas handling.
- 15 real Electron native-control checks and 23 embedded transport checks passed.
- Final packaged smoke passed, including the one-prompt startup and retained pending-concept behavior.
- All 599 current built files match the final packaged ASAR byte for byte.

Build: release/simple-prompt-20260910-v4/win-unpacked/Grudge Dev Tool.exe.

ASAR SHA-256: ffeb83b75c397715c7f8d043106f4bb988b8bdf8b4033a8185bfcf4e7ab9ab1b.

Export: E:\grudge\grudge-dev-tool\.cache\simple-prompt-20260910\final-core\profile-CbMfHS\exported-cube.glb (8140 bytes; SHA-256 335bda021efd0c5a492af4f37dfc867389b66d28e8cd3b55e66239c377d12171; animation entries: ["Turntable"]).

Scene: E:\grudge\grudge-dev-tool\.cache\simple-prompt-20260910\final-core\profile-CbMfHS\native-scene.forge-scene.json (SHA-256 3013a6eeed963f3bf7c66c569baff1007e26659a45e120744e61d16677897144). The scene retains its original format and asset references.

Evidence: .cache/simple-prompt-20260910/final-core/live-result.json, final-extras/extras-result.json, package-identity.json, artifacts.json, the packaged/native/embedded logs, and screenshots in the two final evidence directories. Opening screen, selected extras, cube preview, reopened scene and imported-base screenshots were inspected.

This is a separately built local executable; the installed app was not replaced. Existing app instances and workloads were preserved. No commit, push or deployment was performed. The named workflows establish bounded local runtime evidence, not every connected account, arbitrary geometry or external service operation.

Intermediate v1–v3 directory builds remain in release/. Automatic approval review rejected their cleanup with “blocked by policy”; the final usable build is v4.
