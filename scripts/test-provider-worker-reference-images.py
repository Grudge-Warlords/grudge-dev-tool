"""Exercise the provider-side multiview byte, role and primary-view gate."""
import hashlib
import importlib.util
import tempfile
from pathlib import Path

from PIL import Image


root = Path(__file__).resolve().parents[1]
worker_path = root / "tools" / "prompt3d" / "provider_worker.py"
module_spec = importlib.util.spec_from_file_location("prompt3d_provider_worker_references", worker_path)
assert module_spec is not None and module_spec.loader is not None
worker = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(worker)


def identity(path: Path, view: str) -> dict:
    data = path.read_bytes()
    return {
        "version": 1,
        "sha256": hashlib.sha256(data).hexdigest(),
        "mediaType": "image/png",
        "byteSize": len(data),
        "width": 96,
        "height": 80,
        "originalName": path.name,
        "view": view,
    }


with tempfile.TemporaryDirectory(prefix="grudge-hunyuan-mv-") as directory:
    task_root = Path(directory).resolve()
    expected = []
    retained = []
    for index, view in enumerate(("front", "left", "right", "back")):
        path = task_root / f"reference-{view}-source.png"
        Image.new("RGB", (96, 80), (240 - index * 30, 220, 200)).save(path)
        public = identity(path, view)
        expected.append(public)
        retained.append({
            **public,
            "path": str(path),
            "copiedAt": "2026-09-04T00:00:00.000Z",
            "use": "hunyuan-shape-concept-conditioning",
        })
    spec = {
        "referenceImage": expected[0],
        "referenceImageEvidence": retained[0],
        "referenceImages": expected,
        "referenceImagesEvidence": retained,
    }
    verified = worker.verify_reference_images(spec, task_root)
    assert list(verified) == ["front", "left", "right", "back"]
    assert verified["front"] == Path(retained[0]["path"])

    duplicate = {**spec, "referenceImages": [expected[0], {**expected[1], "view": "front"}]}
    duplicate["referenceImagesEvidence"] = [retained[0], {**retained[1], "view": "front"}]
    try:
        worker.verify_reference_images(duplicate, task_root)
        raise AssertionError("duplicate multiview roles were accepted")
    except RuntimeError as error:
        assert "unique" in str(error)

    repeated_bytes = {**spec, "referenceImages": [expected[0], {**expected[0], "view": "left"}]}
    repeated_bytes["referenceImagesEvidence"] = [retained[0], {**retained[0], "view": "left"}]
    repeated_bytes["referenceImage"] = repeated_bytes["referenceImages"][0]
    repeated_bytes["referenceImageEvidence"] = repeated_bytes["referenceImagesEvidence"][0]
    try:
        worker.verify_reference_images(repeated_bytes, task_root)
        raise AssertionError("the same bytes were accepted as two material views")
    except RuntimeError as error:
        assert "distinct image bytes" in str(error)

    Path(retained[2]["path"]).write_bytes(b"tampered")
    try:
        worker.verify_reference_images(spec, task_root)
        raise AssertionError("tampered multiview bytes were accepted")
    except RuntimeError as error:
        assert "SHA-256" in str(error)

print("Prompt-to-3D provider multiview reference verification passed.")
