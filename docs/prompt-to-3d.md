# Prompt to 3D

The `/prompt3d` workspace turns a versioned `AssetSpec` into a provider-generated GLB, then post-processes and validates it before it can enter the existing asset pipeline. The deliberate **Plan fields with local Ollama** action can propose only allowlisted JSON fields for the `AssetSpec`; it never starts Ollama, pulls a model, contacts a non-loopback host, changes the selected provider/route/coordinate contract, or executes model output. Ollama is not represented as a mesh generator and cannot emit shell commands, Blender scripts or Python for this workflow.

## Providers

| Provider | Route | Honest boundary |
|---|---|---|
| Hunyuan3D 2.1 | prompt → local HunyuanDiT concept image → Hunyuan shape → optional Hunyuan Paint | The upstream source is cross-platform; this build enables its reproducible normal-user WSL path on Windows because the upstream Python 3.10 requirements pin an unavailable `bpy==4.0` wheel. Geometry needs 10 GB free VRAM; the documented PBR texture path needs 21 GB free. The Tencent license has territory, distribution and use restrictions and must be reviewed in the installer. |
| Microsoft TRELLIS | direct text; upstream image conditioning is declared but not yet enabled in the UI | Official source is Linux-tested. Windows uses a normal WSL2 Ubuntu user distribution, never Docker's internal distribution. Direct text is generally less detailed than image conditioning. Reference-image intake remains disabled until its typed file contract is implemented. |
| Meshy / Tripo | optional cloud | Disabled by default. No fallback, credentials, upload or paid call occurs until the user selects that provider and confirms destination, data and estimated cost for the run. |

Pinned source and model revisions live in `src/main/prompt3d/providers.ts`. Local source, environments, weights, outputs and manifests live outside Git under the user-selected generator root.

## Readiness states

- **Ready**: physical GPU/RAM/disk, platform/software, signed install manifest and current run headroom pass.
- **Setup required**: the host can satisfy the backend but its isolated prerequisites or weights are absent/incomplete.
- **Busy**: setup is complete but current free VRAM is below the selected run mode.
- **Marginal**: an official documented reduced-memory mode applies, has a pinned measurable threshold, and the user accepts its visible tradeoff. No provider is marked marginal merely from a model-name guess.
- **Unsupported**: a physical or platform constraint cannot be satisfied on the host.
- **Cloud only**: both local backends are genuinely unsupported. Missing setup or temporary GPU use never causes Cloud only.

The main process measures GPU vendor/model, total/free/used VRAM, system RAM, destination disk, OS, WSL distributions, Python, Conda and CUDA toolkit before showing download readiness. A deliberate pre-download check and every pre-run check also probe the selected normal-user WSL distribution without reading its account name: Linux version, non-root identity, writable home, system Python and NVIDIA/CUDA visibility must pass. A model name alone never establishes compliance.

## Installer safety

The UI and `npm run prompt3d:install` use the same `Prompt3DInstaller`. It uses an immutable official revision for every source/model, verifies the official Git origin, refuses to overwrite a dirty source snapshot, uses a checksum-pinned `uv`, task-contained paths, bounded commands, resumable Hugging Face snapshots, task-owned WSL process groups for cancellation, recoverable removal and a local Ed25519-signed/hash manifest. The manifest binds every downloaded model file to a SHA-256 inventory and tree hash plus the source-dependency revisions and hashes of the isolated Conda explicit lock and `pip freeze`; the complete model tree is rehashed before generation. It does not mutate global PATH and never installs on startup. License acknowledgement is per provider and cannot be accepted automatically; removal has a separate confirmation and never requires accepting the provider licence.

TRELLIS does not invoke the upstream `setup.sh`: the pinned upstream script references a removed `vox2seq` directory and clones several CUDA dependencies from moving branch heads. The typed installer instead obtains exact revisions of `utils3d`, `nvdiffrast`, `mip-splatting`, and the last upstream TRELLIS revision containing `vox2seq`; it pins xFormers, spconv and Kaolin, selects the xFormers/native-spconv path, and omits flash-attn and the unused octree renderer. The GLB path still installs every compiled extension it imports.

On Windows, setup may pause after `wsl --install -d Ubuntu-24.04 --no-launch`. Launch Ubuntu once and create its normal user, then choose **Repair / resume**. Do not substitute `docker-desktop` or a root-only bootstrap. Both provider environments stay separate under the normal Linux user's local data directory; no global PATH is changed.

`GRUDGE_PROMPT3D_ROOT` selects the Windows-side source/model/job root. The UI and CLI share its root-contained `.integrity` signing key so one entry point cannot invalidate the other provider’s manifest; partial or mismatched key material fails closed. `GRUDGE_PROMPT3D_WSL_DISTRO` optionally selects one exact normal-user WSL distribution after a storage migration; if omitted, the first non-Docker distribution is used. WSL virtual-disk placement is deliberately outside this installer, so changing either value never moves or re-registers a distribution.

## Job boundary

New privileged IPC calls require the exact main-window sender, the exact app origin and a window-scoped capability grant issued only after **Enable local controls**. The random grant secret stays in the main process; neither the renderer nor a webview can read it. Jobs use one bounded loopback sidecar on `127.0.0.1`, concurrency 1, a 90-minute timeout and task-owned directories. Provider workers receive typed fields only. Cancellation signals the exact task-owned Linux worker PID and never terminates the shared WSL distribution. No renderer-supplied command or code is executed.

Generate records the job before preflight and surfaces elapsed time for acceptance, GPU/headroom and WSL readiness, signed provider verification, sidecar health, provider/model warm-up, concept inference/review, geometry start/inference, post-processing and validation. The healthy loopback sidecar is reused; provider model workers still exit after a job so GPU memory is released. Install/repair performs full model-byte hashing, while each run performs the bounded signed manifest, exact file inventory/size, pinned source revision and environment-lock checks. A concept crop/edge rejection retains the concept, does not load geometry, and offers only a deliberate new-seed concept retry.

Outputs are scaled and grounded to the declared metre contract, use a stable `GrudgeAssetRoot`, declare +Y up and +Z forward, and receive provenance. Validation checks GLB structure, finite geometry, requested dimensions, root/ground/axes, normals, UV/material/texture references, triangle/texture budgets and requested collision/LOD gates. A failed check moves the GLB to quarantine. It is never uploaded or published.

Character and vehicle generation is disabled until their owning workflows define rig, topology and facing gates. Prompt to 3D does not invent or duplicate those unresolved contracts.

## Future roadmap: hybrid guided generation

This is planned work, not a validated current capability. A future typed workflow may accept a CPU-procedural blockout, a user-supplied model, or user-owned, permissively licensed, or otherwise authorized reference images; render canonical turntable views plus masks, depth and part IDs where available; let the user conversationally approve or adjust that reference set; and use only the approved views to constrain the local Hunyuan image-to-3D route with optional local enhancement. It must compare the result against every approved view, retain provenance/licensing and immutable revisions, and allow refinement without silent cloud fallback. The same allowlisted typed command contract should be exposed through text first, with optional local speech-to-speech later.

Arbitrary Google scraping is explicitly out of scope. Web search may discover candidate references, but the tool may ingest only user-owned, permissively licensed, or otherwise authorized inputs.

## Offline local test

Set `GRUDGE_OFFLINE_LOCAL_TEST=1`, `GRUDGE_TEST_PROFILE`, `GRUDGE_PROMPT3D_ROOT` and `GRUDGE_RENDERER_URL` before launching the source build. This mode isolates the Electron profile and ports, opens `/prompt3d`, blocks non-loopback requests, and skips fleet probes, updater work, default-handler mutation, plugin host startup, Docker/Ollama management and remote account contact.
