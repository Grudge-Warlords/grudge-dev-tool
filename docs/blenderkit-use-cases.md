# BlenderKit — capabilities the dev tool uses **without** a cloud API key
The BlenderKit addon (GPL-2.0-or-later, pinned at `F:\blenderkit-v3.19.2.260411\blenderkit\`) ships a lot of standalone, offline-capable Python that the dev tool can drive headlessly via `blender --background --python`. Cloud features (search, download, ratings, comments, uploads to blenderkit.com) require auth and the **blenderkit-client** daemon — those stay disabled in the dev tool's default mode. Everything below works with **no cloud account, no daemon, no API key**.
## What we leverage
### 1. Asset import (`append_link.py`)
Pure Blender API wrappers around `bpy.data.libraries.load`. We use them on assets we already have on disk (Grudge-owned `.blend` files, the local cache under `~/blenderkit_data/models|materials|brushes|hdrs|nodegroups|...`, or anything the dev tool downloads from R2 itself). Functions exposed:
- `append_brush(file_name, brushname=None, link=False, fake_user=True)`
- `append_nodegroup(file_name, nodegroupname=None, ..., target_object=None, nodegroup_mode="MODIFIER" | "NODE" | "")` — auto-creates a target mesh if a Geometry Nodes group needs one
- (And the rest of the model/material append helpers in the same module)
**Grudge use:** the ingestion pipeline's `convert` stage can call these to merge a Grudge weapon mesh with a Grudge skeleton donor, then export GLB.
### 2. Scene QC / asset inspector (`asset_inspector.py`)
Walks materials, counts:
- shaders by type (`BSDF_*`)
- texture nodes
- total megapixels (UDIM-aware via `_image_tile_count`)
- min/max texture resolution
- procedural-vs-image-based determination
- node graph depth (`node_count`, recurses into groups)
- per-mesh UV map presence
**Grudge use:** the **size-verify** stage in `src/main/ingestion/sizeVerify.ts` already enforces image bounds; we extend it to call this inspector on `.blend` inputs for budget enforcement (e.g. "no Grudge weapon ships with > 64 MP of texture data").
### 3. Local cache layout (`paths.py`)
Pre-baked filesystem conventions we should mirror, **not fight**:
- Global cache root: `~/blenderkit_data/` (override via `XDG_DATA_HOME`)
- Per-asset-type subdirs (always plural):
  `models`, `materials`, `brushes`, `hdrs`, `scenes`, `textures`, `nodegroups`, `printables`, `addons`, `authors`
- Temp dir: `<tmp>/bktemp_<safe-username>/`
- Categories file: `<tmp>/bktemp_<safe-username>/categories.json` (snapshot — see #4)
- Windows path-length cap: 250 chars (`WINDOWS_PATH_LIMIT`) — relevant for our deep-pack uploads
**Grudge use:** when `grudge-dev-tool/scripts/upload-asset-pack.ts` mirrors a downloaded BlenderKit asset to R2, it reads from these standard dirs. The tool will not fight the addon's directory layout.
### 4. Category taxonomy (`categories.py` + `data/categories.json`)
A pre-shipped JSON tree of asset types → categories → subcategories with `slug`/`name`/`assetCount`. The addon also keeps a fallback static copy at `<addon>/data/categories.json`. Pure-data, no network needed.
**Grudge use:** import this JSON once at dev-tool startup as a controlled vocabulary for our own tagging UI. Lets the Browser/Search filter by both Grudge categories *and* BlenderKit-canonical categories.
### 5. Auto-thumbnail (`autothumb.py`, `autothumb_model_bg.py`, `autothumb_material_bg.py`)
The addon's offscreen render pipeline for thumbnails (rendered through Blender's compositor, not screenshotted). Runs entirely as a background `blender -b` invocation with their `_bg.py` script. No cloud round-trip.
**Grudge use:** replaces `convert.ts → makeThumbnail()` for `.blend`/`.fbx`/`.glb` assets — get a properly lit PBR thumbnail instead of a flat sharp resize. Already drafted in `src/main/blenderkit/scripts/bk_autothumb.py`.
### 6. Path-safety + resolution helpers (`resolutions.py`, `image_utils.py`)
Helpers for choosing texture resolution variants ("auto", "1k", "2k", "4k", "8k", "blend"), normalizing image colorspaces, and packing/unpacking embedded images.
**Grudge use:** ingestion `convert` stage uses the resolution helpers to pre-bake R2 thumbnails at multiple sizes (matches Cloudflare Image-Resizing conventions on the public CDN).
## What we **don't** do without a key
- **`search.py` / `client_lib.asset_search`** — needs daemon + login (anonymous browsing returns CC0-only excerpts and a captcha).
- **`download.py`** — `client_lib.asset_download` requires the daemon and an authenticated account, even for free assets.
- **`upload.py`** — uploading user-authored content to blenderkit.com.
- **`ratings.py`, `comments_utils.py`, `bkit_oauth.py`** — community/auth features.
The dev tool's BlenderKit module gracefully no-ops these when no API key is set. The `daemon.ts` module is being demoted from "required" to "optional, search-only".
## Headless invocation pattern (the integration shape)
Every Grudge-side use of BlenderKit follows the same shape:
```
blender --background --factory-startup \
  --python <our-script.py> -- <inputs...>
```
- `--factory-startup` defends against user prefs poisoning the run.
- We add `<addon-parent-dir>` to `sys.path` inside the script so `from blenderkit import ...` works.
- We never call `bpy.ops.preferences.addon_enable("blenderkit")` for offline-only use cases; we just import the helper modules directly. This matters because `addon_enable` triggers `__init__.py`'s daemon discovery, which we want to skip.
Drafted scripts in this repo already use that pattern:
- `src/main/blenderkit/scripts/bk_autothumb.py` — render thumbnail (no daemon)
- `src/main/blenderkit/scripts/bk_enrich.py` — *was* daemon-required; we'll add a `--offline` flag that uses the local cache only
## License posture (unchanged)
We invoke BlenderKit code in a separate `blender` process. No GPL code is linked into the dev tool's Electron binary. We do not redistribute the addon — users supply their own install via `BLENDERKIT_PATH` or the pinned default location.
## Roadmap (concrete follow-ups)
1. Add an offline mode to `src/main/blenderkit/daemon.ts` so `searchAssets()` either hits the local categories.json or returns "offline".
2. Wire `bk_autothumb.py` into the `convert` stage as a model-thumbnail provider.
3. Mirror the `~/blenderkit_data/` cache layout under `dev/blenderkit-cache/` in R2, so AI agents can fetch our cached BlenderKit assets without re-downloading from blenderkit.com.
4. Extract `data/categories.json` into `src/shared/blenderkit-categories.json` and use it in the Browser sidebar for tag-based filtering.
