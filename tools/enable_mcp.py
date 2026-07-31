import addon_utils, bpy
mod = "blender_mcp"
try:
    addon_utils.enable(mod, default_set=True, persistent=True)
    print("ENABLE_OK", mod)
except Exception as e:
    print("ENABLE_FAIL", e)
print("ADDONS", [a.module for a in bpy.context.preferences.addons if "mcp" in a.module.lower() or "blend" in a.module.lower()][:20])
