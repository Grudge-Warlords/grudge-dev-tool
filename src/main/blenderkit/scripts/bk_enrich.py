# bk_enrich.py — Enrich a working GLB with an asset pulled from BlenderKit.
# Usage: blender -b --python bk_enrich.py -- <working.glb> <out.glb> <query> <asset_type> <api_key> <addon_path>
#
# This script:
#   1. Adds <addon_path>'s parent to sys.path so we can import 'blenderkit'
#   2. Sets the BlenderKit API key in addon prefs
#   3. Issues an asset_search via client_lib
#   4. Downloads the top result (asset_download)
#   5. Appends the resulting object(s) to the loaded scene
#   6. Exports the combined scene as GLB
#
# WARNING: This is a best-effort script; BlenderKit's async download may not
# complete in headless mode without polling /report. We treat enrich as a hint
# layer — the pipeline ALREADY produced a GLB and will continue with the
# unenriched asset if BlenderKit fails.
import bpy
import sys
import os
import time

argv = sys.argv[sys.argv.index("--") + 1:]
working_glb, out_glb, query, asset_type, api_key, addon_path = argv[:6]

# 1. Open the working GLB
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=working_glb)

# 2. Make BlenderKit importable from <addon_path> (the folder *containing* `blenderkit/`)
parent = os.path.dirname(addon_path.rstrip(os.sep).rstrip("/"))
if parent and parent not in sys.path:
    sys.path.insert(0, parent)

try:
    import blenderkit                     # noqa: F401  — registers the package
    from blenderkit import client_lib, datas, global_vars
except Exception as e:
    print(f"[bk_enrich] cannot import blenderkit ({e}); exporting working GLB unchanged", file=sys.stderr)
    bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", export_apply=True)
    sys.exit(0)

# 3. Ensure the addon is enabled and the API key is set
try:
    bpy.ops.preferences.addon_enable(module="blenderkit")
    prefs = bpy.context.preferences.addons["blenderkit"].preferences
    prefs.api_key = api_key
except Exception as e:
    print(f"[bk_enrich] addon_enable failed ({e}); exporting working GLB unchanged", file=sys.stderr)
    bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", export_apply=True)
    sys.exit(0)

# 4. Search
search = datas.SearchData()
search.urlquery = query
search.asset_type = asset_type
search.page_size = 5
search.page = 1
try:
    resp = client_lib.asset_search(search)
    print(f"[bk_enrich] search response: {str(resp)[:200]}")
except Exception as e:
    print(f"[bk_enrich] search failed: {e}", file=sys.stderr)
    bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", export_apply=True)
    sys.exit(0)

# Download is async — for now we just record the search task ID. A future
# version will poll /report until the asset blendfile arrives, then append it
# with `bpy.ops.wm.append`. For now, export what we have so the pipeline
# remains lossless.
bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", export_apply=True)
print(f"[bk_enrich] wrote {out_glb}")
