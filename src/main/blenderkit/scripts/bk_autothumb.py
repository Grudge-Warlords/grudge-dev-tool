# bk_autothumb.py — Render a 512px PBR thumbnail for a GLB.
# Usage: blender -b --python bk_autothumb.py -- <input.glb> <output.png>
import bpy
import sys
import os
import math

argv = sys.argv[sys.argv.index("--") + 1:]
in_path, out_path = argv[0], argv[1]

# Reset scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# Import GLB
bpy.ops.import_scene.gltf(filepath=in_path)

# Frame all imported objects
bpy.ops.object.select_all(action="SELECT")
mesh_objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not mesh_objs:
    print(f"[bk_autothumb] no meshes in {in_path}", file=sys.stderr)
    sys.exit(2)

# Compute bounding sphere
xs, ys, zs = [], [], []
for o in mesh_objs:
    for v in o.bound_box:
        wv = o.matrix_world @ __import__("mathutils").Vector(v)
        xs.append(wv.x); ys.append(wv.y); zs.append(wv.z)
cx = (min(xs) + max(xs)) / 2.0
cy = (min(ys) + max(ys)) / 2.0
cz = (min(zs) + max(zs)) / 2.0
extent = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
dist = max(2.0, extent * 1.6)

# Camera
cam_data = bpy.data.cameras.new("ThumbCam")
cam_obj = bpy.data.objects.new("ThumbCam", cam_data)
bpy.context.collection.objects.link(cam_obj)
cam_obj.location = (cx + dist, cy - dist, cz + dist * 0.5)
direction = (cx - cam_obj.location[0], cy - cam_obj.location[1], cz - cam_obj.location[2])
import mathutils
rot_quat = mathutils.Vector(direction).to_track_quat("-Z", "Y")
cam_obj.rotation_euler = rot_quat.to_euler()
bpy.context.scene.camera = cam_obj

# Sun light
light_data = bpy.data.lights.new("Sun", type="SUN")
light_data.energy = 4.0
light_obj = bpy.data.objects.new("Sun", light_data)
bpy.context.collection.objects.link(light_obj)
light_obj.rotation_euler = (math.radians(50), math.radians(30), math.radians(20))

# World — neutral grey backdrop
world = bpy.context.scene.world or bpy.data.worlds.new("World")
bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
if bg:
    bg.inputs[0].default_value = (0.06, 0.07, 0.10, 1.0)
    bg.inputs[1].default_value = 1.0

# Render config
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT" if hasattr(bpy.context.scene, "eevee") and bpy.app.version >= (4, 2, 0) else "BLENDER_EEVEE"
scene.render.resolution_x = 512
scene.render.resolution_y = 512
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.film_transparent = False

scene.render.filepath = out_path
bpy.ops.render.render(write_still=True)
print(f"[bk_autothumb] wrote {out_path}")
