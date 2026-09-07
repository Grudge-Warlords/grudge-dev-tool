"""Render a GLB contact sheet with a dependency-light CPU triangle rasterizer.

This is inspection-only: it reads the retained mesh and never changes geometry,
materials, transforms, provenance, or the source GLB.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
import trimesh


def unit(value: np.ndarray) -> np.ndarray:
    length = float(np.linalg.norm(value))
    if length <= 1e-12:
        raise ValueError("Cannot normalize a zero-length view vector")
    return value / length


def render_view(
    vertices: np.ndarray,
    faces: np.ndarray,
    camera: tuple[float, float, float],
    label: str,
    size: int,
) -> Image.Image:
    camera_axis = unit(np.asarray(camera, dtype=np.float64))
    world_up = np.asarray((0.0, 1.0, 0.0), dtype=np.float64)
    if abs(float(np.dot(camera_axis, world_up))) > 0.96:
        world_up = np.asarray((0.0, 0.0, -1.0), dtype=np.float64)
    right = unit(np.cross(world_up, camera_axis))
    screen_up = unit(np.cross(camera_axis, right))

    centered = vertices - ((vertices.min(axis=0) + vertices.max(axis=0)) * 0.5)
    x = centered @ right
    y = centered @ screen_up
    depth = centered @ camera_axis
    span = max(float(np.ptp(x)), float(np.ptp(y)), 1e-9)
    margin = 34
    scale = (size - margin * 2) / span
    projected = np.column_stack((size * 0.5 + x * scale, size * 0.5 - y * scale))

    tri_vertices = vertices[faces]
    normals = np.cross(tri_vertices[:, 1] - tri_vertices[:, 0], tri_vertices[:, 2] - tri_vertices[:, 0])
    normal_lengths = np.linalg.norm(normals, axis=1)
    valid = normal_lengths > 1e-12
    normals[valid] /= normal_lengths[valid, None]
    light = unit(camera_axis + np.asarray((-0.35, 0.65, 0.25), dtype=np.float64))
    intensity = np.clip(np.abs(normals @ light), 0.0, 1.0)
    face_depth = depth[faces].mean(axis=1)

    image = Image.new("RGB", (size, size), (247, 247, 247))
    draw = ImageDraw.Draw(image)
    for face_index in np.argsort(face_depth):
        polygon = [tuple(projected[index]) for index in faces[face_index]]
        shade = int(78 + 150 * float(intensity[face_index]))
        draw.polygon(polygon, fill=(shade, shade, min(238, shade + 5)))

    font = ImageFont.load_default()
    draw.rectangle((0, 0, size, 24), fill=(255, 255, 255))
    draw.text((8, 7), label, fill=(18, 18, 18), font=font)
    return image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--size", type=int, default=512)
    args = parser.parse_args()
    if args.size < 256 or args.size > 2048:
        raise SystemExit("--size must be from 256 to 2048")

    scene = trimesh.load(args.input, force="scene", process=False)
    mesh = scene.dump(concatenate=True)
    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.vertices) == 0 or len(mesh.faces) == 0:
        raise SystemExit("GLB contains no triangle mesh")
    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    faces = np.asarray(mesh.faces, dtype=np.int64)
    bounds = vertices.max(axis=0) - vertices.min(axis=0)

    views = [
        ("Front (+Z)", (0.0, 0.0, 1.0)),
        ("Back (-Z)", (0.0, 0.0, -1.0)),
        ("Left (-X)", (-1.0, 0.0, 0.0)),
        ("Right (+X)", (1.0, 0.0, 0.0)),
        ("Top (+Y)", (0.0, 1.0, 0.0)),
        ("Isometric", (1.0, 0.72, 1.0)),
    ]
    tiles = [render_view(vertices, faces, camera, label, args.size) for label, camera in views]
    header = 42
    sheet = Image.new("RGB", (args.size * 3, args.size * 2 + header), (232, 232, 232))
    draw = ImageDraw.Draw(sheet)
    draw.text(
        (10, 13),
        f"{args.input.name} | {len(faces):,} triangles | bounds X/Y/Z: "
        f"{bounds[0]:.6f} / {bounds[1]:.6f} / {bounds[2]:.6f} m",
        fill=(12, 12, 12),
        font=ImageFont.load_default(),
    )
    for index, tile in enumerate(tiles):
        sheet.paste(tile, ((index % 3) * args.size, header + (index // 3) * args.size))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.output, format="PNG", optimize=True)
    print(f"Rendered {len(views)} views to {args.output}")


if __name__ == "__main__":
    main()
