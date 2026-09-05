"""Render fixed animation frames from a GLB for semantic motion inspection."""

import math
import os
import sys

import bpy
from mathutils import Vector


def arguments():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(values) != 2:
        raise SystemExit("usage: blender --background --python render-prompted-motion-diagnostic.py -- input.glb output-directory")
    return os.path.abspath(values[0]), os.path.abspath(values[1])


def look_at(obj, point):
    obj.rotation_euler = (Vector(point) - obj.location).to_track_quat("-Z", "Y").to_euler()


def evaluated_bounds(scene, frames):
    low = Vector((float("inf"),) * 3)
    high = Vector((float("-inf"),) * 3)
    for frame in frames:
        scene.frame_set(frame)
        graph = bpy.context.evaluated_depsgraph_get()
        for source in (obj for obj in scene.objects if obj.type == "MESH"):
            evaluated = source.evaluated_get(graph)
            mesh = evaluated.to_mesh()
            try:
                for vertex in mesh.vertices:
                    point = evaluated.matrix_world @ vertex.co
                    low.x = min(low.x, point.x); low.y = min(low.y, point.y); low.z = min(low.z, point.z)
                    high.x = max(high.x, point.x); high.y = max(high.y, point.y); high.z = max(high.z, point.z)
            finally:
                evaluated.to_mesh_clear()
    return low, high


input_path, output_directory = arguments()
os.makedirs(output_directory, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=input_path)
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 720
scene.render.resolution_y = 540
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.world = scene.world or bpy.data.worlds.new("Motion diagnostic world")
scene.world.color = (0.94, 0.94, 0.94)
scene.view_settings.look = "AgX - Medium High Contrast"

end_frame = max((int(round(action.frame_range[1])) for action in bpy.data.actions), default=120)
frames = sorted(set([1, max(2, end_frame // 8), max(2, end_frame // 4), max(2, end_frame * 3 // 8), max(2, end_frame // 2), max(2, end_frame * 5 // 8), max(2, end_frame * 3 // 4), max(2, end_frame * 7 // 8), end_frame]))
low, high = evaluated_bounds(scene, frames)
center = (low + high) / 2
span = high - low
radius = max(span.x, span.y, span.z, 0.1)

camera_data = bpy.data.cameras.new("Motion diagnostic camera")
camera = bpy.data.objects.new("Motion diagnostic camera", camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera.data.lens = 52
camera.location = center + Vector((radius * 0.18, -radius * 1.65, radius * 0.42))
look_at(camera, center)

key_data = bpy.data.lights.new("Key", "AREA")
key_data.energy = 1300
key_data.shape = "DISK"
key_data.size = radius * 1.2
key = bpy.data.objects.new("Key", key_data)
scene.collection.objects.link(key)
key.location = center + Vector((-radius, -radius, radius * 1.4))
look_at(key, center)

fill_data = bpy.data.lights.new("Fill", "AREA")
fill_data.energy = 750
fill_data.size = radius
fill = bpy.data.objects.new("Fill", fill_data)
scene.collection.objects.link(fill)
fill.location = center + Vector((radius, -radius * 0.25, radius * 0.7))
look_at(fill, center)

for index, frame in enumerate(frames):
    scene.frame_set(frame)
    scene.render.filepath = os.path.join(output_directory, f"motion-{index:02d}-frame-{frame:04d}.png")
    bpy.ops.render.render(write_still=True)

print(f"Rendered {len(frames)} frames to {output_directory}")
