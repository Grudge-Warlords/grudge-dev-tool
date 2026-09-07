"""Focused tests for generic Hunyuan concept-canvas selection."""
import importlib.util
from pathlib import Path


root = Path(__file__).resolve().parents[1]
worker_path = root / "tools" / "prompt3d" / "provider_worker.py"
module_spec = importlib.util.spec_from_file_location("prompt3d_provider_worker", worker_path)
assert module_spec is not None and module_spec.loader is not None
worker = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(worker)

landscape = worker.concept_canvas("One creature in a horizontal side-view flying right")
portrait = worker.concept_canvas("One complete upright sword with the tip pointing up")
square = worker.concept_canvas("One wide-brimmed game-ready hat")
conflicted = worker.concept_canvas("An upright figure shown in a horizontal side profile")

assert landscape == {"version": 1, "mode": "explicit-landscape", "width": 1280, "height": 768}
assert portrait == {"version": 1, "mode": "explicit-portrait", "width": 768, "height": 1280}
assert square == {"version": 1, "mode": "square-default", "width": 1024, "height": 1024}
assert conflicted == square
for canvas in (landscape, portrait, square):
    assert canvas["width"] % 16 == 0 and canvas["height"] % 16 == 0
    assert canvas["width"] * canvas["height"] <= 1024 * 1024

print("Prompt-to-3D generic concept-canvas tests passed.")
