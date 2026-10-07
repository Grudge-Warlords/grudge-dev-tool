# Native dialogs and app controls — 2026-09-10

Implemented in the existing `E:\grudge\grudge-dev-tool` checkout on `Stray-Prompt-to-3D`. Existing work and branch were preserved. No commit, push, installation replacement or deployment was performed.

## Result

Grudge can continue through the original app's file/folder dialogs, multiple-file selection, folder creation, save destinations, overwrite confirmations, text prompts and confirmations. Browser file inputs (including hidden inputs) and browser/blob exports use the same observable dialog flow during a prompt. Manual text dialogs also work in standalone Elite viewer/loader/main windows without an active Grudge run.

Electron disables its built-in text prompt ([Electron 41.3 source](https://raw.githubusercontent.com/electron/electron/v41.3.0/lib/renderer/window-setup.ts)); the narrow guest bridge preserves the editor call while the owning app window presents the dialog.

The same controller supports native keyboard shortcuts, exact text entry into existing editors, canvas click/double-click/context menu/drag/wheel input, scroll panels, and selection of owned pop-out windows. Existing editors and their handlers perform the work. The prompt collapses to a small progress bar while acting so it does not cover the tool controls.

Hunyuan remains optional. None of these controls depends on Hunyuan readiness, installation or generation. Original account permissions and explicit intent for publishing, deletion and overwriting remain intact.

## Real Grudge workflow

The full four-prompt trial used directory build `native-controls-20260910-v6`, with `grudge-dev:latest` for every planned action. A retained Grudge-created blue cube was opened through the original Local Files controls to prepare the trial.

| Prompt | Observed result |
| --- | --- |
| Export the selected model as GLB to the supplied absolute path | Selected-model export, destination field and Save; a valid GLB was written. 3 actions. |
| Orbit the Scene canvas to the left | Original viewport received a right-button drag; actual camera position changed while its target stayed fixed. 1 action. |
| Save the scene using Ctrl+S to the supplied absolute path | Native shortcut reached the original scene serializer; browser export dialog saved real scene JSON containing one entity. 3 actions. |
| Click Load .forge-scene.json and open the saved path | Hidden file input opened, the path was selected, and the original editor reported Loaded scene with the cube visible again. 3 actions. |

Camera before: `Camera position: 2.2146, 1.9764, 2.9528; target: 0, 0.5, 0; zoom: 1`. Camera after: `Camera position: 3.4615, 1.9764, 1.2814; target: 0, 0.5, 0; zoom: 1`.

The final `v7` build also passed a fresh real-Grudge selected-model export (3 actions) after the standalone-dialog changes. A real Elite viewer displayed its own text dialog outside a Grudge run, accepted `Native viewer name`, and returned that exact value to the requesting caller. The dialog and reopened scene screenshots were inspected. No Hunyuan job was created.

Evidence: `.cache/native-actions-20260910/live-result.json`, `final-package-result.json`, `artifact-verification.json`, `reopened-scene.png`, `manual-viewer-dialog.png`, and `manual-viewer-completed.png`.

## Checks

- Type checking and full renderer/main/icon/preload build passed.
- Sandbox preload bridge checks passed, including the narrow guest text-dialog adapter.
- 15 real Electron native-control checks passed: editor text/selection, scrolling, trusted canvas input, file selection, hidden chooser activation, confirmation/text responses, browser exports, folder creation, overwrite/cancel, window ownership and stale-document rejection.
- 23 embedded transport checks passed, including real native keyboard/text input into an owned webview, existing ThreeFlow drag/field adapters, origin restrictions and stale-action checks.
- Existing app-action and viewport-navigation checks passed.
- Final packaged smoke passed.
- All 595 current `dist` files match the final ASAR byte for byte.

Transport fixtures cover the input mechanisms; they do not establish every connected service/account workflow. Real product acceptance above covers the named Forge and Elite viewer operations. Existing services, user app instances and GPU work were preserved; the isolated verification app instances were closed.

## Final package

`release/native-controls-20260910-v7/win-unpacked/Grudge Dev Tool.exe`

ASAR SHA-256: `ff2919fbe97a49db35b58fa5ef66899f5aa0a3694d60aa39ae63d68836ec88d5`.

Final exported GLB: `E:\grudge\grudge-dev-tool\.cache\native-actions-20260910\profile-zi9tgl\exported-cube.glb` — 7588 bytes; SHA-256 `17895f20ebba46f7c9f36d3be2a1ee9ede135ac34101d39f0c833ca44c312a80`.

Saved scene JSON: `E:\grudge\grudge-dev-tool\.cache\native-actions-20260910\profile-Hterd1\native-scene.forge-scene.json` — 21824 bytes; SHA-256 `cc748408c28197b6036af8b99e0b26ec30aa9ad77599ad69b8b4ddc162b785e0`. It retains the original scene format and asset references.
