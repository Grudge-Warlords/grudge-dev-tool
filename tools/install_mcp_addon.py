import bpy, os, shutil, sys
src = r"F:\GitHub\grudge-dev-tool\tools\blender-mcp\blender-mcp-main"
# Prefer user scripts addons path
user = bpy.utils.user_resource("SCRIPTS", path="addons", create=True)
dst = os.path.join(user, "blender_mcp")
print("USER_ADDONS", user)
if os.path.isdir(dst):
    shutil.rmtree(dst, ignore_errors=True)
os.makedirs(dst, exist_ok=True)
# Copy addon modules — blender-mcp uses addon.py at root; also copy as package
for name in os.listdir(src):
    if name in (".git", "tests", "__pycache__"):
        continue
    s = os.path.join(src, name)
    d = os.path.join(dst, name)
    if os.path.isdir(s):
        shutil.copytree(s, d, dirs_exist_ok=True)
    else:
        shutil.copy2(s, d)
# Ensure __init__.py for package if addon.py is entry — many builds use addon.py only
# Enable if possible
try:
    bpy.ops.preferences.addon_enable(module="blender_mcp")
    print("ENABLED blender_mcp")
except Exception as e:
    print("ENABLE_NOTE", e)
# Also try loading addon.py style
print("DST", dst)
print("FILES", os.listdir(dst)[:20])
