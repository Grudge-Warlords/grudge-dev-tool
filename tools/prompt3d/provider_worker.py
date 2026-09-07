"""Typed Prompt-to-3D provider worker. Accepts one AssetSpec JSON file only."""
import argparse
import atexit
import gc
import hashlib
import importlib.util
import json
import os
import re
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


def emit(stage: str, progress: int, message: str, **extra) -> None:
    print(json.dumps({"stage": stage, "progress": progress, "message": message, **extra}), flush=True)


def begin_timing() -> tuple[float, str]:
    return time.perf_counter(), datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def completed_timing(stage: str, started: tuple[float, str], message: str) -> dict:
    completed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "stage": stage,
        "startedAt": started[1],
        "completedAt": completed_at,
        "elapsedMs": max(0, round((time.perf_counter() - started[0]) * 1000)),
        "message": message,
    }


def task_path(value: str) -> Path:
    """Resolve a retained host path inside the configured WSL provider runtime."""
    raw = value.strip()
    match = re.fullmatch(r"([A-Za-z]):[\\/](.*)", raw)
    if os.name != "nt" and match:
        raw = f"/mnt/{match.group(1).lower()}/{match.group(2).replace(chr(92), '/')}"
    return Path(raw).resolve()


def concept_canvas(prompt: str) -> dict:
    """Choose a generic canvas from explicit composition language only.

    HunyuanDiT otherwise receives a square canvas, which can overpower an
    explicitly wide or upright subject request.  The rules deliberately avoid
    object names and ambiguous adjectives such as ``wide`` so any custom asset
    can use the same prompt-only workflow without accidental aspect changes.
    """
    horizontal = re.search(
        r"\b(?:horizontal(?:ly)?|side[- ]view|side[- ]profile|landscape orientation|left[- ]to[- ]right|right[- ]to[- ]left)\b",
        prompt,
        re.IGNORECASE,
    ) is not None
    vertical = re.search(
        r"\b(?:vertical(?:ly)?|upright|portrait orientation|top[- ]to[- ]bottom|bottom[- ]to[- ]top)\b",
        prompt,
        re.IGNORECASE,
    ) is not None
    if horizontal and not vertical:
        return {"version": 1, "mode": "explicit-landscape", "width": 1280, "height": 768}
    if vertical and not horizontal:
        return {"version": 1, "mode": "explicit-portrait", "width": 768, "height": 1280}
    return {"version": 1, "mode": "square-default", "width": 1024, "height": 1024}


def verify_reference_image(spec: dict, root: Path) -> Path | None:
    """Verify the exact task-contained local image conditioning bytes."""
    expected = spec.get("referenceImage")
    retained = spec.get("referenceImageEvidence")
    if expected is None and retained is None:
        return None
    if not isinstance(expected, dict) or not isinstance(retained, dict):
        raise RuntimeError("Reference-image AssetSpec and retained evidence must either both be present or both be absent.")
    identity_keys = ("version", "sha256", "mediaType", "byteSize", "width", "height", "originalName")
    if any(expected.get(key) != retained.get(key) for key in identity_keys):
        raise RuntimeError("Retained reference-image evidence is stale for the exact AssetSpec.")
    if retained.get("version") != 1 or retained.get("use") != "hunyuan-shape-concept-conditioning":
        raise RuntimeError("Reference-image conditioning purpose is invalid.")
    path = task_path(str(retained.get("path", "")))
    if root.resolve() not in path.parents or not path.is_file():
        raise RuntimeError("Retained reference image must be a regular file inside the Prompt-to-3D root.")
    data = path.read_bytes()
    if len(data) != retained.get("byteSize") or hashlib.sha256(data).hexdigest() != retained.get("sha256"):
        raise RuntimeError("Retained reference-image bytes no longer match their SHA-256 identity.")
    from PIL import Image
    try:
        with Image.open(path) as source:
            source_format = (source.format or "").upper()
            width, height = source.size
            frames = getattr(source, "n_frames", 1)
            source.verify()
    except Exception as error:
        raise RuntimeError("Retained reference image could not be decoded safely.") from error
    media_type = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}.get(source_format)
    if media_type != retained.get("mediaType") or width != retained.get("width") or height != retained.get("height") or frames != 1:
        raise RuntimeError("Retained reference-image dimensions or media type changed.")
    return path


def verify_reference_images(spec: dict, root: Path) -> dict[str, Path]:
    """Verify every labelled view and return the exact official MV input map."""
    expected = spec.get("referenceImages")
    retained = spec.get("referenceImagesEvidence")
    if expected is None and retained is None:
        legacy = verify_reference_image(spec, root)
        return {"front": legacy} if legacy is not None else {}
    if not isinstance(expected, list) or not isinstance(retained, list) or len(expected) != len(retained):
        raise RuntimeError("Multiview AssetSpec and retained evidence must contain the same one-to-four views.")
    if len(expected) < 1 or len(expected) > 4:
        raise RuntimeError("Hunyuan multiview conditioning accepts one to four retained views.")
    identity_keys = ("version", "sha256", "mediaType", "byteSize", "width", "height", "originalName", "view")
    views: dict[str, Path] = {}
    hashes: set[str] = set()
    total_bytes = 0
    for expected_image, retained_image in zip(expected, retained):
        if not isinstance(expected_image, dict) or not isinstance(retained_image, dict):
            raise RuntimeError("Every Hunyuan multiview reference must contain typed retained evidence.")
        if any(expected_image.get(key) != retained_image.get(key) for key in identity_keys):
            raise RuntimeError("Retained multiview reference evidence is stale for the exact AssetSpec.")
        view = retained_image.get("view")
        if view not in ("front", "left", "back", "right") or view in views:
            raise RuntimeError("Hunyuan multiview references require unique front, left, back or right roles.")
        if retained_image.get("sha256") in hashes:
            raise RuntimeError("Every Hunyuan multiview role must use distinct image bytes.")
        if retained_image.get("version") != 1 or retained_image.get("use") != "hunyuan-shape-concept-conditioning":
            raise RuntimeError("Multiview reference conditioning purpose is invalid.")
        path = task_path(str(retained_image.get("path", "")))
        if root.resolve() not in path.parents or not path.is_file():
            raise RuntimeError("Retained multiview reference must be a regular file inside the Prompt-to-3D root.")
        data = path.read_bytes()
        total_bytes += len(data)
        if len(data) != retained_image.get("byteSize") or hashlib.sha256(data).hexdigest() != retained_image.get("sha256"):
            raise RuntimeError("Retained multiview reference bytes no longer match their SHA-256 identity.")
        from PIL import Image
        try:
            with Image.open(path) as source:
                source_format = (source.format or "").upper()
                width, height = source.size
                frames = getattr(source, "n_frames", 1)
                source.verify()
        except Exception as error:
            raise RuntimeError("Retained multiview reference could not be decoded safely.") from error
        media_type = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}.get(source_format)
        if media_type != retained_image.get("mediaType") or width != retained_image.get("width") or height != retained_image.get("height") or frames != 1:
            raise RuntimeError("Retained multiview reference dimensions or media type changed.")
        views[view] = path
        hashes.add(retained_image.get("sha256"))
    if "front" not in views or total_bytes > 80 * 1024 * 1024:
        raise RuntimeError("Hunyuan multiview conditioning requires a front view within the 80 MiB combined limit.")
    primary_expected = spec.get("referenceImage")
    primary_retained = spec.get("referenceImageEvidence")
    front_index = next(index for index, image in enumerate(expected) if image.get("view") == "front")
    if primary_expected != expected[front_index] or primary_retained != retained[front_index]:
        raise RuntimeError("Primary reference evidence must exactly match the retained front view.")
    return views


def verify_concept_approval(spec: dict, concept_path: Path) -> None:
    approval = spec.get("conceptApproval")
    if spec.get("approvedConcept") is not True or not isinstance(approval, dict):
        raise RuntimeError("Explicit hash-bound concept approval is required before geometry can start.")
    required = ("version", "workflowVersion", "jobId", "attemptId", "conceptSha256", "prompt", "seed", "providerId", "specVersion", "specCanonical", "specFingerprint", "referenceSha256", "approvedAt", "source", "inspectionSha256")
    if any(key not in approval for key in required):
        raise RuntimeError("Concept approval binding is incomplete.")
    if approval.get("source") != "explicit-user-action" or approval.get("providerId") != "hunyuan3d-2":
        raise RuntimeError("Concept approval source or provider is invalid.")
    if approval.get("prompt") != spec.get("prompt") or approval.get("seed") != spec.get("seed") or approval.get("specVersion") != spec.get("version"):
        raise RuntimeError("Concept approval is stale for the current prompt, seed or spec version.")
    expected_reference_sha = spec.get("referenceImage", {}).get("sha256") if isinstance(spec.get("referenceImage"), dict) else None
    if approval.get("referenceSha256") != expected_reference_sha:
        raise RuntimeError("Concept approval is stale for the retained reference-image conditioning bytes.")
    expected_reference_bindings = [
        {"view": image.get("view", "front"), "sha256": image.get("sha256")}
        for image in (spec.get("referenceImages") or ([spec["referenceImage"]] if isinstance(spec.get("referenceImage"), dict) else []))
    ]
    retained_reference_bindings = approval.get("referenceImageBindings")
    if retained_reference_bindings is None:
        retained_reference_bindings = [{"view": "front", "sha256": approval.get("referenceSha256")}] if approval.get("referenceSha256") else []
    if retained_reference_bindings != expected_reference_bindings:
        raise RuntimeError("Concept approval is stale for the ordered Hunyuan reference views.")
    attempt = spec.get("conceptAttempt")
    binding = attempt.get("binding") if isinstance(attempt, dict) else None
    approval_binding = {key: value for key, value in approval.items() if key not in ("approvedAt", "source", "inspectionSha256")}
    if not isinstance(binding, dict) or approval_binding != binding:
        raise RuntimeError("Concept approval does not match the exact retained attempt binding.")
    try:
        approved_at = datetime.fromisoformat(str(approval.get("approvedAt", "")).replace("Z", "+00:00"))
    except ValueError as error:
        raise RuntimeError("Concept approval time is invalid.") from error
    if approved_at.tzinfo is None:
        raise RuntimeError("Concept approval time must include a timezone.")
    if not str(approval.get("attemptId", "")).startswith(f'{approval.get("jobId")}:concept:'):
        raise RuntimeError("Concept approval attempt identity is invalid.")
    canonical = str(approval.get("specCanonical", ""))
    if hashlib.sha256(canonical.encode("utf-8")).hexdigest() != approval.get("specFingerprint"):
        raise RuntimeError("Concept approval spec fingerprint is invalid.")
    actual = hashlib.sha256(concept_path.read_bytes()).hexdigest()
    if actual != approval.get("conceptSha256"):
        raise RuntimeError("Concept approval does not match the retained image hash.")
    review = attempt.get("technicalReview") if isinstance(attempt, dict) else None
    plan = attempt.get("promptPlan") if isinstance(attempt, dict) else None
    presentation = plan.get("presentationContract") if isinstance(plan, dict) else None
    if not isinstance(review, dict) or not isinstance(presentation, dict):
        raise RuntimeError("Structured concept technical review is missing.")
    stable = lambda value: json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    presentation_sha = hashlib.sha256(stable(presentation).encode("utf-8")).hexdigest()
    review_path = task_path(str(review.get("reportPath", "")))
    if not review_path.is_file():
        raise RuntimeError("Concept technical review report is missing.")
    review_bytes = review_path.read_bytes()
    try:
        review_report = json.loads(review_bytes)
    except ValueError as error:
        raise RuntimeError("Concept technical review report is invalid.") from error
    if (
        review.get("status") != "pass"
        or review.get("reportVersion") != 1
        or review.get("semanticResemblanceChecked") is not False
        or review.get("visualReviewRequired") is not True
        or hashlib.sha256(review_bytes).hexdigest() != review.get("reportSha256")
        or review.get("presentationContractSha256") != presentation_sha
        or review_report.get("version") != 1
        or review_report.get("technicalStatus") != "pass"
        or review_report.get("semanticResemblanceChecked") is not False
        or review_report.get("visualReviewRequired") is not True
    ):
        raise RuntimeError("Concept technical review is stale or incomplete.")
    inspection = spec.get("conceptInspection")
    evidence = inspection.get("evidence") if isinstance(inspection, dict) else None
    inspection_path = task_path(str(inspection.get("path", ""))) if isinstance(inspection, dict) else None
    if not isinstance(evidence, dict) or inspection_path is None or not inspection_path.is_file():
        raise RuntimeError("Hash-bound concept inspection evidence is missing.")
    try:
        retained_evidence = json.loads(inspection_path.read_text(encoding="utf-8"))
    except ValueError as error:
        raise RuntimeError("Concept inspection evidence is invalid.") from error
    unsigned = {key: value for key, value in evidence.items() if key != "bindingSha256"}
    checks = evidence.get("checks")
    if (
        retained_evidence != evidence
        or hashlib.sha256(stable(evidence).encode("utf-8")).hexdigest() != inspection.get("sha256")
        or hashlib.sha256(stable(unsigned).encode("utf-8")).hexdigest() != evidence.get("bindingSha256")
        or approval.get("inspectionSha256") != inspection.get("sha256")
        or evidence.get("decision") != "approved"
        or evidence.get("source") != "explicit-user-action"
        or evidence.get("jobId") != approval.get("jobId")
        or evidence.get("attemptId") != approval.get("attemptId")
        or evidence.get("conceptSha256") != actual
        or evidence.get("technicalReviewSha256") != review.get("reportSha256")
        or evidence.get("presentationContractSha256") != presentation_sha
        or not isinstance(checks, dict)
        or any(checks.get(key) != "pass" for key in ("identityAndRequiredParts", "subjectPresentation", "framingBackgroundAndSupport"))
    ):
        raise RuntimeError("Concept approval does not retain an exact three-check inspection binding.")


def verify_hunyuan_text_budget(concept_model: Path, prompt: str, negative: str) -> None:
    """Fail before model load instead of allowing diffusers to truncate either encoder."""
    from transformers import BertTokenizer, T5Tokenizer

    bert = BertTokenizer.from_pretrained(str(concept_model / "tokenizer"), local_files_only=True)
    t5 = T5Tokenizer.from_pretrained(str(concept_model / "tokenizer_2"), local_files_only=True)
    for label, value in (("prompt", prompt), ("negative prompt", negative)):
        bert_tokens = len(bert.encode(value, add_special_tokens=True))
        t5_tokens = len(t5.encode(value, add_special_tokens=True))
        if bert_tokens > 77:
            raise RuntimeError(f"HunyuanDiT {label} is {bert_tokens} BERT tokens; the retained compiler limit is 77.")
        if t5_tokens > 256:
            raise RuntimeError(f"HunyuanDiT {label} is {t5_tokens} mT5 tokens; the retained compiler limit is 256.")


HUNYUAN_EXECUTION_PROFILES = {
    "hunyuan-shape-standard-v1": {
        "operation": "geometry", "device": "cuda", "concept_device": "cuda-offload",
        "concept_steps": 30, "shape_device": "cuda", "shape_steps": 50, "octree_resolution": 512,
    },
    "hunyuan-shape-light-v1": {
        "operation": "geometry", "device": "cuda", "concept_device": "cuda-offload",
        "concept_steps": 30, "shape_device": "cuda-offload", "shape_steps": 30, "octree_resolution": 256,
    },
    "hunyuan-shape-cpu-basic-v1": {
        "operation": "geometry", "device": "cpu", "concept_device": "cpu",
        "concept_steps": 20, "shape_device": "cpu", "shape_steps": 20, "octree_resolution": 256,
    },
    "hunyuan-paint-official-512-v1": {
        "operation": "texture", "device": "cuda", "texture_views": 6,
        "paint_resolution": 512, "render_size": 2048, "texture_size": 4096,
    },
}


def hunyuan_execution_profile(spec: dict, operation: str) -> dict:
    """Resolve only an allowlisted main-process-selected Hunyuan profile."""
    retained = spec.get("executionProfile")
    if not isinstance(retained, dict) or not isinstance(retained.get("id"), str):
        raise RuntimeError(f"A retained Hunyuan {operation} execution profile is required")
    profile = HUNYUAN_EXECUTION_PROFILES.get(retained["id"])
    if not profile or profile["operation"] != operation or retained.get("device") != profile["device"]:
        raise RuntimeError(f"The retained Hunyuan execution profile cannot run {operation}")
    return profile


def load_hunyuan_painter(spec: dict, root: Path, source: Path):
    """Load only the pinned official Hunyuan Paint pipeline for a typed task."""
    # Hunyuan3D 2.1 ships its own torchvision compatibility module for the
    # pinned BasicSR/Real-ESRGAN stack. Apply that official shim before
    # importing textureGenPipeline; otherwise torchvision 0.20 removes the
    # legacy functional_tensor module during the painter's first real load.
    from utils.torchvision_fix import apply_fix
    if apply_fix() is not True:
        raise RuntimeError("Official Hunyuan torchvision compatibility initialization failed")
    load_hunyuan_native_extension(root)
    import huggingface_hub
    from textureGenPipeline import Hunyuan3DPaintPipeline, Hunyuan3DPaintConfig

    models = root / "hunyuan3d-2" / "models"
    paint_model = models / "tencent--Hunyuan3D-2.1"
    dino_model = models / "facebook--dinov2-giant"
    if not (paint_model / "hunyuan3d-paintpbr-v2-1").is_dir() or not dino_model.is_dir():
        raise RuntimeError("Pinned Hunyuan paint or DINOv2 model snapshot is incomplete")
    execution = hunyuan_execution_profile(spec, "texture")
    view_count = int(spec.get("textureViewCount", 0))
    if view_count != execution["texture_views"]:
        raise RuntimeError("Texture view count does not match the retained Hunyuan Paint profile")
    resolution = int(spec.get("budgets", {}).get("maxTextureResolution", 2048))
    if resolution not in (1024, 2048):
        raise RuntimeError("Hunyuan Paint texture resolution must be 1024 or 2048")
    if spec.get("textureMemoryProfile") != spec["executionProfile"]["id"]:
        raise RuntimeError("Texture memory profile differs from the retained Hunyuan execution profile")
    config = Hunyuan3DPaintConfig(max_num_view=view_count, resolution=execution["paint_resolution"])
    # Official save_mesh(..., downsample=True) halves the baked map. Both
    # profiles remain within the public 1024/2048 output contract.
    config.texture_size = min(resolution * 2, execution["texture_size"])
    config.render_size = execution["render_size"]
    config.multiview_cfg_path = str(source / "hy3dpaint" / "cfgs" / "hunyuan-paint-pbr.yaml")
    config.dino_ckpt_path = str(dino_model)
    runtime_source = Path.home() / ".local" / "share" / "grudge-prompt3d" / f"hunyuan3d-2-{HUNYUAN_SOURCE_REVISION[:12]}" / "source"
    realesrgan_checkpoint = runtime_source / "hy3dpaint" / "ckpt" / "RealESRGAN_x4plus.pth"
    if not realesrgan_checkpoint.is_file() or sha256_file(realesrgan_checkpoint) != HUNYUAN_REALESRGAN_SHA256:
        raise RuntimeError("Pinned Real-ESRGAN helper weight is missing or failed SHA-256 verification")
    config.realesrgan_ckpt_path = str(realesrgan_checkpoint)
    original_snapshot_download = huggingface_hub.snapshot_download

    def local_snapshot_download(*, repo_id: str, **_kwargs) -> str:
        if repo_id != "tencent/Hunyuan3D-2.1":
            raise RuntimeError(f"Unallowlisted offline Hunyuan model request: {repo_id}")
        return str(paint_model)

    huggingface_hub.snapshot_download = local_snapshot_download
    previous_cwd = Path.cwd()
    os.chdir(source / "hy3dpaint")
    try:
        return Hunyuan3DPaintPipeline(config)
    finally:
        huggingface_hub.snapshot_download = original_snapshot_download
        os.chdir(previous_cwd)


def run_hunyuan_paint(painter, source_mesh: Path, reference_image: Path, output: Path, preserve_geometry: bool = False) -> None:
    textured_obj = output.parent / "textured_mesh.obj"
    painter(
        str(source_mesh), image_path=str(reference_image), output_mesh_path=str(textured_obj),
        use_remesh=not preserve_geometry, save_glb=True,
    )
    textured_glb = textured_obj.with_suffix(".glb")
    if not textured_glb.is_file():
        raise RuntimeError("Hunyuan3D-Paint did not produce its declared GLB output")
    textured_glb.replace(output)


HUNYUAN_SOURCE_REVISION = "82920d643c0dc2f7bfd7255f45f62d386edfe60c"
HUNYUAN_REMBG_SHA256 = "8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491"
HUNYUAN_REALESRGAN_SHA256 = "4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_hunyuan_native_extension(root: Path) -> None:
    """Load the checksum-bound official mesh inpaint build into the signed source package."""
    provider_root = root / "hunyuan3d-2"
    manifest = json.loads((provider_root / "install-manifest.json").read_text(encoding="utf-8"))
    inventory_path = provider_root / "runtime-native-artifacts.json"
    inventory_bytes = inventory_path.read_bytes()
    expected_inventory_sha = str(manifest.get("runtimeLocks", {}).get("nativeArtifactsSha256", ""))
    if hashlib.sha256(inventory_bytes).hexdigest() != expected_inventory_sha:
        raise RuntimeError("Native Hunyuan runtime inventory differs from the signed provider manifest")
    inventory = json.loads(inventory_bytes)
    artifacts = inventory.get("artifacts", [])
    if inventory.get("version") != 1 or len(artifacts) != 1:
        raise RuntimeError("Native Hunyuan runtime inventory is invalid")
    artifact = artifacts[0]
    relative = str(artifact.get("path", ""))
    if artifact.get("id") != "hunyuan-mesh-inpaint-processor" or not re.fullmatch(r"source/hy3dpaint/DifferentiableRenderer/mesh_inpaint_processor[A-Za-z0-9._-]*\.so", relative):
        raise RuntimeError("Native Hunyuan mesh inpaint inventory entry is invalid")
    runtime_base = Path.home() / ".local" / "share" / "grudge-prompt3d" / f"hunyuan3d-2-{HUNYUAN_SOURCE_REVISION[:12]}"
    extension = (runtime_base / relative).resolve()
    if runtime_base.resolve() not in extension.parents or not extension.is_file() or extension.stat().st_size != int(artifact.get("bytes", -1)) or sha256_file(extension) != artifact.get("sha256"):
        raise RuntimeError("Native Hunyuan mesh inpaint extension is missing or failed signed integrity verification")
    import DifferentiableRenderer
    module_name = "DifferentiableRenderer.mesh_inpaint_processor"
    module_spec = importlib.util.spec_from_file_location(module_name, extension)
    if module_spec is None or module_spec.loader is None:
        raise RuntimeError("Native Hunyuan mesh inpaint extension could not be loaded")
    module = importlib.util.module_from_spec(module_spec)
    sys.modules[module_name] = module
    try:
        module_spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(module_name, None)
        raise
    if not callable(getattr(module, "meshVerticeInpaint", None)):
        raise RuntimeError("Native Hunyuan mesh inpaint extension lacks its required entry point")
    setattr(DifferentiableRenderer, "mesh_inpaint_processor", module)


def hunyuan_background_isolation(image, root: Path):
    """Run the official pinned Hunyuan BackgroundRemover without downloads."""
    model = root / "hunyuan3d-2" / "models" / "rembg" / "u2net.onnx"
    if not model.is_file() or sha256_file(model) != HUNYUAN_REMBG_SHA256:
        raise RuntimeError("Pinned Hunyuan background-removal model is missing or failed SHA-256 verification; no geometry model was loaded.")
    os.environ["U2NET_HOME"] = str(model.parent)
    from hy3dshape.rembg import BackgroundRemover
    isolated = BackgroundRemover()(image).convert("RGBA")
    if isolated.size != image.size:
        raise RuntimeError("Hunyuan background-removal output dimensions changed; no geometry model was loaded.")
    return isolated.getchannel("A"), {
        "method": "hunyuan-upstream-rembg-u2net",
        "modelPath": "models/rembg/u2net.onnx",
        "modelSha256": HUNYUAN_REMBG_SHA256,
        "providerSourceRevision": HUNYUAN_SOURCE_REVISION,
    }


def load_hunyuan_multiview_shape(pipeline_class, shape_model: Path, variant_directory: Path, device="cuda", dtype=None):
    """Load the official 2mv checkpoint through the renamed official 2.1 package.

    Tencent's 2mv config predates the package rename from hy3dgen.shapegen to
    hy3dshape. Only those Python import targets are translated into a retained
    job-local config; the signed safetensors checkpoint is never changed.
    """
    source_config = shape_model / "hunyuan3d-dit-v2-mv" / "config.yaml"
    checkpoint = shape_model / "hunyuan3d-dit-v2-mv" / "model.fp16.safetensors"
    if not source_config.is_file() or not checkpoint.is_file():
        raise RuntimeError("Official Hunyuan3D-2mv config or safetensors checkpoint is missing.")
    original = source_config.read_text(encoding="utf-8")
    translated = original.replace("hy3dgen.shapegen", "hy3dshape")
    if translated == original or "hy3dgen.shapegen" in translated:
        raise RuntimeError("Official Hunyuan3D-2mv namespace compatibility mapping is incomplete.")
    runtime_config = variant_directory / "hunyuan3d-2mv-runtime-config.yaml"
    runtime_config.write_text(translated, encoding="utf-8")
    return pipeline_class.from_single_file(
        ckpt_path=str(checkpoint),
        config_path=str(runtime_config),
        use_safetensors=True,
        device=device,
        **({"dtype": dtype} if dtype is not None else {}),
    )


def hunyuan_texture_revision(spec: dict, root: Path, output: Path) -> None:
    """Prompt a new local reference image, then paint an existing Hunyuan mesh."""
    execution = hunyuan_execution_profile(spec, "texture")
    source = Path(os.environ.get("GRUDGE_PROMPT3D_PROVIDER_SOURCE", str(root / "hunyuan3d-2" / "source")))
    models = root / "hunyuan3d-2" / "models"
    sys.path.insert(0, str(source / "hy3dpaint"))
    source_mesh = task_path(str(spec.get("sourceAssetPath", "")))
    if root.resolve() not in source_mesh.parents or not source_mesh.is_file() or source_mesh.suffix.lower() != ".glb":
        raise RuntimeError("Texture source must be a retained GLB inside the Prompt-to-3D root")
    prompt = str(spec.get("textureReferencePrompt", "")).strip()
    if not prompt or len(prompt) > 4000:
        raise RuntimeError("A bounded texture reference prompt is required")

    concept_model = models / "Tencent-Hunyuan--HunyuanDiT-v1.1-Diffusers-Distilled"
    negative = "cropped, multiple objects, text, watermark, dark background, scenery, hands, display stand"
    verify_hunyuan_text_budget(concept_model, prompt, negative)
    import torch
    from diffusers import HunyuanDiTPipeline
    reference = output.parent / "texture-reference.png"
    reference_started = begin_timing()
    emit("reference-image", 12, f"Generating a new local HunyuanDiT material reference image with {spec['executionProfile']['label']}.")
    pipe = HunyuanDiTPipeline.from_pretrained(str(concept_model), torch_dtype=torch.float16, local_files_only=True)
    pipe.enable_model_cpu_offload()
    image = pipe(
        prompt=prompt,
        negative_prompt=negative,
        height=1024,
        width=1024,
        num_inference_steps=30,
        generator=torch.Generator("cpu").manual_seed(int(spec["seed"])),
    ).images[0]
    image.save(reference)
    emit("reference-image", 32, "Texture reference image generated and retained.", timing=completed_timing("texture-reference-inference", reference_started, "Local HunyuanDiT texture reference completed."))
    del pipe
    gc.collect()
    torch.cuda.empty_cache()

    paint_started = begin_timing()
    emit("texture", 36, f"Applying official Hunyuan3D-Paint with {execution['texture_views']} generated views at {execution['paint_resolution']} px.")
    painter = load_hunyuan_painter(spec, root, source)
    run_hunyuan_paint(painter, source_mesh, reference, output, preserve_geometry=True)
    emit("texture", 88, "Official Hunyuan3D-Paint texture revision completed.", timing=completed_timing("hunyuan-paint-inference", paint_started, "Official Hunyuan3D-Paint output completed."))


def hunyuan(spec: dict, root: Path, output: Path) -> bool:
    execution = hunyuan_execution_profile(spec, "geometry")
    source = Path(os.environ.get("GRUDGE_PROMPT3D_PROVIDER_SOURCE", str(root / "hunyuan3d-2" / "source")))
    models = root / "hunyuan3d-2" / "models"
    sys.path.insert(0, str(source / "hy3dshape"))
    sys.path.insert(0, str(source / "hy3dpaint"))
    if spec["route"] != "concept-image-to-3d":
        raise RuntimeError("This Hunyuan MVP enables only the explicit prompt-to-concept-image-to-3D route.")
    warmup_started = begin_timing()
    emit("warmup", 10, "Provider/model warm-up: importing the isolated runtime and loading pinned HunyuanDiT weights.")
    import torch
    from PIL import Image, ImageOps
    concept_path = output.parent / "concept.png"
    reference_paths = verify_reference_images(spec, root)
    reference_path = reference_paths.get("front")
    concept_model = models / "Tencent-Hunyuan--HunyuanDiT-v1.1-Diffusers-Distilled"
    plan = spec.get("promptPlan")
    if not isinstance(plan, dict) or plan.get("version") != 1 or not plan.get("generationPrompt"):
        raise RuntimeError("Object-specific prompt rules are missing. Start a new job in the updated app.")
    prompt, negative = plan["generationPrompt"], plan.get("negativePrompt")
    if not isinstance(prompt, str) or not isinstance(negative, str) or not negative:
        raise RuntimeError("Object-specific positive and negative prompts are required.")
    canvas = concept_canvas(prompt) if reference_path is None else {
        "version": 1, "mode": "reference-normalized-square", "width": 1024, "height": 1024,
    }
    (output.parent / "concept-prompt.json").write_text(json.dumps({
        **plan,
        "prompt": spec["prompt"],
        "seed": spec["seed"],
        "providerId": spec["providerId"],
        "specVersion": spec["version"],
        "referenceSha256": spec.get("referenceImage", {}).get("sha256") if isinstance(spec.get("referenceImage"), dict) else None,
        "referenceImageBindings": [
            {"view": view, "sha256": next(image["sha256"] for image in spec.get("referenceImages", []) if image.get("view") == view)}
            for view in ("front", "left", "back", "right") if any(image.get("view") == view for image in spec.get("referenceImages", []))
        ] if spec.get("referenceImages") else ([{"view": "front", "sha256": spec["referenceImage"]["sha256"]}] if isinstance(spec.get("referenceImage"), dict) else []),
        "canvas": canvas,
    }, indent=2), encoding="utf-8")
    approved = spec.get("approvedConcept") is True
    if approved:
        verify_concept_approval(spec, concept_path)
        image = Image.open(concept_path).convert("RGB")
        warmup_message = "Approved concept reused; the concept-image model was not loaded."
        emit("warmup", 14, warmup_message, timing=completed_timing("provider-model-warmup", warmup_started, warmup_message))
    elif reference_path is not None:
        warmup_message = "Verified task-contained reference is ready; HunyuanDiT text-to-image weights were not loaded."
        emit("warmup", 14, warmup_message, timing=completed_timing("provider-model-warmup", warmup_started, warmup_message))
        inference_started = begin_timing()
        emit("concept-image", 15, "Preparing the verified local reference as Hunyuan image conditioning; the text-to-image model is not loaded.")
        with Image.open(reference_path) as source_image:
            source_image = ImageOps.exif_transpose(source_image)
            rgba = source_image.convert("RGBA")
            white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
            white.alpha_composite(rgba)
            normalized = white.convert("RGB")
        normalized.thumbnail((960, 960), Image.Resampling.LANCZOS)
        image = Image.new("RGB", (1024, 1024), (255, 255, 255))
        image.paste(normalized, ((1024 - normalized.width) // 2, (1024 - normalized.height) // 2))
        image.save(output.parent / "concept-source.png")
        image.save(concept_path)
        inference_message = "Local reference normalization and Hunyuan conditioning concept retention completed."
        emit("concept-image", 29, inference_message, timing=completed_timing("reference-conditioning-preparation", inference_started, inference_message))
    else:
        verify_hunyuan_text_budget(concept_model, prompt, negative)
        from diffusers import HunyuanDiTPipeline
        concept_dtype = torch.float32 if execution["concept_device"] == "cpu" else torch.float16
        pipe = HunyuanDiTPipeline.from_pretrained(str(concept_model), torch_dtype=concept_dtype, local_files_only=True)
        if execution["concept_device"] == "cpu":
            pipe.to("cpu")
        else:
            pipe.enable_model_cpu_offload()
        warmup_message = f"Pinned HunyuanDiT concept model is loaded with {spec['executionProfile']['label']}."
        emit("warmup", 14, warmup_message, timing=completed_timing("provider-model-warmup", warmup_started, warmup_message))
        inference_started = begin_timing()
        concept_steps = execution["concept_steps"]
        emit("concept-image", 15, f"Concept image inference: running {concept_steps} local diffusion steps.")
        image = pipe(
            prompt=prompt,
            negative_prompt=negative,
            height=canvas["height"],
            width=canvas["width"],
            num_inference_steps=concept_steps,
            generator=torch.Generator("cpu").manual_seed(spec["seed"]),
        ).images[0]
        image.save(output.parent / "concept-source.png")
        image.save(concept_path)
        inference_message = "Concept image inference and save completed."
        emit("concept-image", 29, inference_message, timing=completed_timing("concept-image-inference", inference_started, inference_message))
        del pipe
    gc.collect()
    torch.cuda.empty_cache()
    if not approved:
        from concept_preparation import prepare_concept, ConceptReviewRequired
        review_started = begin_timing()
        emit("concept-review", 30, "Concept review: running pinned official Hunyuan subject isolation, full-object framing and edge clearance.")
        try:
            contract = plan.get("presentationContract") if isinstance(plan.get("presentationContract"), dict) else {}
            background = contract.get("background") if isinstance(contract.get("background"), dict) else {}
            scenery = contract.get("scenery") if isinstance(contract.get("scenery"), dict) else {}
            requested_backdrop = background.get("mode") == "requested" or scenery.get("mode") == "requested"
            isolation_mask = isolation_evidence = None
            if not requested_backdrop:
                isolation_mask, isolation_evidence = hunyuan_background_isolation(image, root)
            image = prepare_concept(image, output.parent, contract, isolation_mask, isolation_evidence)
        except ConceptReviewRequired as error:
            review_message = str(error)
            emit("concept-review", 32, review_message, timing=completed_timing("concept-review", review_started, review_message), errorCode="CONCEPT_REVIEW_REQUIRED", reviewMessage=review_message)
            sys.exit(2)
        # Bind approval and Hunyuan shape conditioning to the deterministic
        # central-half canvas while retaining the untouched provider render.
        white = Image.new("RGBA", image.size, (255, 255, 255, 255))
        white.alpha_composite(image.convert("RGBA"))
        image = white.convert("RGB")
        image.save(concept_path)
        review_message = "Technical framing checks passed. Semantic resemblance, required parts and artistic quality remain unverified."
        emit("concept-review", 34, review_message, timing=completed_timing("concept-review", review_started, review_message))
        emit("awaiting-concept-approval", 35, "Concept retained for explicit user review. No geometry model was loaded and no semantic approval was inferred.")
        return False
    if spec.get("conceptOnly"):
        raise RuntimeError("Approved geometry work cannot retain the concept-only flag.")
    verify_concept_approval(spec, concept_path)
    geometry_start = begin_timing()
    emit("geometry", 36, "Geometry start: explicit hash-bound user approval verified; loading pinned Hunyuan3D 2.1 shape weights.", timing=completed_timing("geometry-start", geometry_start, "Exact retained concept approval verified and geometry start authorised."), conceptImage=str(concept_path))
    geometry_warmup_started = begin_timing()
    from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline
    multiview = len(reference_paths) > 1
    shape_model = models / ("tencent--Hunyuan3D-2mv" if multiview else "tencent--Hunyuan3D-2.1")
    shape_subfolder = "hunyuan3d-dit-v2-mv" if multiview else "hunyuan3d-dit-v2-1"
    if multiview and not (shape_model / shape_subfolder / "model.fp16.safetensors").is_file():
        raise RuntimeError("Official Hunyuan3D-2mv weights are not installed. Repair Hunyuan Install Options before multiview generation.")
    shape_dtype = torch.float32 if execution["shape_device"] == "cpu" else torch.float16
    initial_shape_device = "cpu" if execution["shape_device"] in ("cpu", "cuda-offload") else "cuda"
    shape = load_hunyuan_multiview_shape(Hunyuan3DDiTFlowMatchingPipeline, shape_model, output.parent, initial_shape_device, shape_dtype) if multiview else Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
        str(shape_model), subfolder=shape_subfolder, device=initial_shape_device, dtype=shape_dtype,
    )
    if execution["shape_device"] == "cuda-offload":
        shape.enable_model_cpu_offload()
    geometry_warmup_message = ("Pinned official Hunyuan3D-2mv multiview shape model" if multiview else "Pinned Hunyuan3D shape model") + f" is loaded with {spec['executionProfile']['label']}."
    emit("geometry", 42, geometry_warmup_message, timing=completed_timing("geometry-model-warmup", geometry_warmup_started, geometry_warmup_message))
    geometry_inference_started = begin_timing()
    emit("geometry", 43, f"Geometry inference: running {execution['shape_steps']} local shape steps at {execution['octree_resolution']} octree resolution.")
    shape_input = image
    if multiview:
        shape_input = {}
        for view, source_path in reference_paths.items():
            source_image = image.copy() if view == "front" else ImageOps.exif_transpose(Image.open(source_path)).convert("RGB")
            isolation_mask, _isolation_evidence = hunyuan_background_isolation(source_image, root)
            conditioned = source_image.convert("RGBA")
            conditioned.putalpha(isolation_mask)
            conditioned.save(output.parent / f"shape-conditioning-{view}.png")
            shape_input[view] = conditioned
        emit("geometry", 43, f"Geometry inference: running {execution['shape_steps']} local multiview shape steps from {len(shape_input)} verified views.")
    mesh = shape(image=shape_input, num_inference_steps=execution["shape_steps"], octree_resolution=execution["octree_resolution"],
                 generator=torch.Generator("cpu").manual_seed(spec["seed"]))[0]
    intermediate = output.parent / "geometry.glb"
    mesh.export(str(intermediate))
    geometry_inference_message = "Geometry inference and GLB export completed."
    emit("geometry", 62, geometry_inference_message, timing=completed_timing("geometry-inference", geometry_inference_started, geometry_inference_message))
    del shape
    gc.collect()
    torch.cuda.empty_cache()
    if spec.get("generateTextures"):
        emit("texture", 65, "Applying official Hunyuan3D-Paint textures.")
        painter = load_hunyuan_painter(spec, root, source)
        run_hunyuan_paint(painter, intermediate, concept_path, output)
    else:
        intermediate.replace(output)
    return True


def trellis(spec: dict, root: Path, output: Path) -> None:
    source = Path(os.environ.get("GRUDGE_PROMPT3D_PROVIDER_SOURCE", str(root / "trellis" / "source")))
    models = root / "trellis" / "models"
    sys.path.insert(0, str(source))
    os.environ.update({"ATTN_BACKEND": "xformers", "SPARSE_ATTN_BACKEND": "xformers", "SPCONV_ALGO": "native"})
    import torch
    if spec["route"] == "direct-text":
        emit("geometry", 30, "Running official TRELLIS text-xlarge (direct text, lower-detail route).")
        from trellis.pipelines import TrellisTextTo3DPipeline
        model = models / "microsoft--TRELLIS-text-xlarge"
        shared_model = models / "microsoft--TRELLIS-image-large"
        clip_model = models / "openai--clip-vit-large-patch14"
        if not model.is_dir() or not shared_model.is_dir() or not clip_model.is_dir():
            raise RuntimeError("Pinned TRELLIS text, shared decoder or CLIP snapshot is incomplete")
        config = json.loads((model / "pipeline.json").read_text(encoding="utf-8"))
        for key, value in config["args"]["models"].items():
            if value.startswith("ckpts/"):
                config["args"]["models"][key] = str(model / value)
            elif "/ckpts/" in value:
                config["args"]["models"][key] = str(shared_model / "ckpts" / value.split("/ckpts/", 1)[1])
            else:
                raise RuntimeError(f"Unexpected TRELLIS model reference in pinned pipeline: {value}")
        config["args"]["text_cond_model"] = str(clip_model)
        runtime_model = output.parent / "trellis-runtime-model"
        runtime_model.mkdir(exist_ok=True)
        (runtime_model / "pipeline.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
        pipeline = TrellisTextTo3DPipeline.from_pretrained(str(runtime_model))
        pipeline.cuda()
        plan = spec.get("promptPlan")
        if not isinstance(plan, dict) or plan.get("version") != 1 or not plan.get("generationPrompt"):
            raise RuntimeError("Object-specific prompt rules are missing. Start a new job in the updated app.")
        result = pipeline.run(plan["generationPrompt"], seed=spec["seed"], formats=["mesh", "gaussian"])
    else:
        raise RuntimeError("TRELLIS image conditioning is a declared backend capability but is disabled until typed reference-image intake is implemented.")
    emit("postprocess", 75, "Converting TRELLIS structured output to GLB.")
    from trellis.utils import postprocessing_utils
    glb = postprocessing_utils.to_glb(
        result["gaussian"][0], result["mesh"][0], simplify=0.95,
        texture_size=min(2048, spec["budgets"]["maxTextureResolution"]),
    )
    glb.export(str(output))
    torch.cuda.empty_cache()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", choices=["hunyuan3d-2", "trellis"], required=True)
    parser.add_argument("--spec", required=True)
    parser.add_argument("--root", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--provider-source")
    parser.add_argument("--pid-file", required=True)
    args = parser.parse_args()
    spec = json.loads(Path(args.spec).read_text(encoding="utf-8"))
    if args.provider == "hunyuan3d-2":
        retained_profile = spec.get("executionProfile")
        if not isinstance(retained_profile, dict) or retained_profile.get("device") not in ("cuda", "cpu"):
            raise RuntimeError("Hunyuan execution profile is missing or invalid")
        if retained_profile["device"] == "cpu":
            os.environ["CUDA_VISIBLE_DEVICES"] = ""
        else:
            retained_gpu = retained_profile.get("gpu")
            selected_adapter = retained_gpu.get("uuid") if isinstance(retained_gpu, dict) else None
            if not selected_adapter and isinstance(retained_gpu, dict) and isinstance(retained_gpu.get("index"), int):
                selected_adapter = str(retained_gpu["index"])
            if not isinstance(selected_adapter, str) or not re.fullmatch(r"(?:GPU-[A-Za-z0-9-]{8,64}|\d{1,3})", selected_adapter):
                raise RuntimeError("CUDA Hunyuan execution requires one retained measured adapter")
            os.environ["CUDA_VISIBLE_DEVICES"] = selected_adapter
    root, output, pid_file = Path(args.root).resolve(), Path(args.output).resolve(), Path(args.pid_file).resolve()
    if root not in output.parents:
        raise RuntimeError("Output path escapes task-owned root")
    if root not in pid_file.parents or pid_file.parent != output.parent:
        raise RuntimeError("Provider PID file escapes its task-owned variant directory")
    output.parent.mkdir(parents=True, exist_ok=True)
    pid_file.write_text(f"{os.getpid()}\n", encoding="ascii")
    atexit.register(lambda: pid_file.unlink(missing_ok=True))
    signal.signal(signal.SIGTERM, lambda _signal, _frame: sys.exit(143))
    os.environ.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1"})
    if args.provider_source:
        os.environ["GRUDGE_PROMPT3D_PROVIDER_SOURCE"] = args.provider_source
    is_hunyuan = args.provider == "hunyuan3d-2"
    if is_hunyuan and spec.get("workflowOperation") == "texture":
        hunyuan_texture_revision(spec, root, output)
        produced_geometry = True
    elif is_hunyuan:
        produced_geometry = hunyuan(spec, root, output)
    else:
        trellis(spec, root, output)
        produced_geometry = True
    if produced_geometry:
        emit("postprocess", 88, "Provider output complete.", output=str(output))
    else:
        emit("awaiting-concept-approval", 35, "Concept retained. Waiting for a separate explicit approval action; geometry was not loaded.")
    if is_hunyuan:
        # Hunyuan's Blender/Open3D native modules segfault during interpreter
        # teardown when imported together. The work and output are complete at
        # this point, so remove the marker and bypass only that unsafe teardown.
        pid_file.unlink(missing_ok=True)
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(0)


if __name__ == "__main__":
    main()
