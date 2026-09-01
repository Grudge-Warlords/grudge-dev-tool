"""Typed Prompt-to-3D provider worker. Accepts one AssetSpec JSON file only."""
import argparse
import atexit
import gc
import hashlib
import json
import os
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


def verify_concept_approval(spec: dict, concept_path: Path) -> None:
    approval = spec.get("conceptApproval")
    if spec.get("approvedConcept") is not True or not isinstance(approval, dict):
        raise RuntimeError("Explicit hash-bound concept approval is required before geometry can start.")
    required = ("version", "workflowVersion", "jobId", "attemptId", "conceptSha256", "prompt", "seed", "providerId", "specVersion", "specCanonical", "specFingerprint", "referenceSha256", "approvedAt", "source")
    if any(key not in approval for key in required):
        raise RuntimeError("Concept approval binding is incomplete.")
    if approval.get("source") != "explicit-user-action" or approval.get("providerId") != "hunyuan3d-2":
        raise RuntimeError("Concept approval source or provider is invalid.")
    if approval.get("prompt") != spec.get("prompt") or approval.get("seed") != spec.get("seed") or approval.get("specVersion") != spec.get("version"):
        raise RuntimeError("Concept approval is stale for the current prompt, seed or spec version.")
    attempt = spec.get("conceptAttempt")
    binding = attempt.get("binding") if isinstance(attempt, dict) else None
    approval_binding = {key: value for key, value in approval.items() if key not in ("approvedAt", "source")}
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


def hunyuan(spec: dict, root: Path, output: Path) -> bool:
    source = Path(os.environ.get("GRUDGE_PROMPT3D_PROVIDER_SOURCE", str(root / "hunyuan3d-2" / "source")))
    models = root / "hunyuan3d-2" / "models"
    sys.path.insert(0, str(source / "hy3dshape"))
    sys.path.insert(0, str(source / "hy3dpaint"))
    if spec["route"] != "concept-image-to-3d":
        raise RuntimeError("This Hunyuan MVP enables only the explicit prompt-to-concept-image-to-3D route.")
    warmup_started = begin_timing()
    emit("warmup", 10, "Provider/model warm-up: importing the isolated runtime and loading pinned HunyuanDiT weights.")
    import torch
    from PIL import Image
    concept_path = output.parent / "concept.png"
    concept_model = models / "Tencent-Hunyuan--HunyuanDiT-v1.1-Diffusers-Distilled"
    plan = spec.get("promptPlan")
    if not isinstance(plan, dict) or plan.get("version") != 1 or not plan.get("generationPrompt"):
        raise RuntimeError("Object-specific prompt rules are missing. Start a new job in the updated app.")
    prompt, negative = plan["generationPrompt"], plan["negativePrompt"]
    (output.parent / "concept-prompt.json").write_text(json.dumps({
        **plan,
        "prompt": spec["prompt"],
        "seed": spec["seed"],
        "providerId": spec["providerId"],
        "specVersion": spec["version"],
    }, indent=2), encoding="utf-8")
    approved = spec.get("approvedConcept") is True
    if approved:
        verify_concept_approval(spec, concept_path)
        image = Image.open(concept_path).convert("RGB")
        warmup_message = "Approved concept reused; the concept-image model was not loaded."
        emit("warmup", 14, warmup_message, timing=completed_timing("provider-model-warmup", warmup_started, warmup_message))
    else:
        from diffusers import HunyuanDiTPipeline
        pipe = HunyuanDiTPipeline.from_pretrained(str(concept_model), torch_dtype=torch.float16, local_files_only=True)
        pipe.enable_model_cpu_offload()
        warmup_message = "Pinned HunyuanDiT concept model is loaded."
        emit("warmup", 14, warmup_message, timing=completed_timing("provider-model-warmup", warmup_started, warmup_message))
        inference_started = begin_timing()
        emit("concept-image", 15, "Concept image inference: running 30 local diffusion steps.")
        image = pipe(prompt=prompt, negative_prompt=negative, height=1024, width=1024, num_inference_steps=30, generator=torch.Generator("cpu").manual_seed(spec["seed"])).images[0]
        image.save(concept_path)
        inference_message = "Concept image inference and save completed."
        emit("concept-image", 29, inference_message, timing=completed_timing("concept-image-inference", inference_started, inference_message))
        del pipe
    gc.collect()
    torch.cuda.empty_cache()
    from concept_preparation import prepare_concept, ConceptReviewRequired
    review_started = begin_timing()
    emit("concept-review", 30, "Concept review: checking background isolation, full-object framing and edge clearance.")
    try:
        image = prepare_concept(image, output.parent)
    except ConceptReviewRequired as error:
        review_message = str(error)
        emit("concept-review", 32, review_message, timing=completed_timing("concept-review", review_started, review_message), errorCode="CONCEPT_REVIEW_REQUIRED", reviewMessage=review_message)
        sys.exit(2)
    review_message = "Technical framing checks passed. Semantic resemblance, required parts and artistic quality remain unverified."
    emit("concept-review", 34, review_message, timing=completed_timing("concept-review", review_started, review_message))
    if not approved:
        emit("awaiting-concept-approval", 35, "Concept retained for explicit user review. No geometry model was loaded and no semantic approval was inferred.")
        return False
    if spec.get("conceptOnly"):
        raise RuntimeError("Approved geometry work cannot retain the concept-only flag.")
    verify_concept_approval(spec, concept_path)
    geometry_start = begin_timing()
    emit("geometry", 36, "Geometry start: explicit hash-bound user approval verified; loading pinned Hunyuan3D 2.1 shape weights.", timing=completed_timing("geometry-start", geometry_start, "Exact retained concept approval verified and geometry start authorised."), conceptImage=str(concept_path))
    geometry_warmup_started = begin_timing()
    from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline
    shape_model = models / "tencent--Hunyuan3D-2.1"
    shape = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(str(shape_model), subfolder="hunyuan3d-dit-v2-1")
    geometry_warmup_message = "Pinned Hunyuan3D shape model is loaded."
    emit("geometry", 42, geometry_warmup_message, timing=completed_timing("geometry-model-warmup", geometry_warmup_started, geometry_warmup_message))
    geometry_inference_started = begin_timing()
    emit("geometry", 43, "Geometry inference: running 50 local shape steps.")
    mesh = shape(image=image, num_inference_steps=50, octree_resolution=512,
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
        import huggingface_hub
        from textureGenPipeline import Hunyuan3DPaintPipeline, Hunyuan3DPaintConfig
        paint_model = models / "tencent--Hunyuan3D-2.1"
        dino_model = models / "facebook--dinov2-giant"
        if not (paint_model / "hunyuan3d-paintpbr-v2-1").is_dir() or not dino_model.is_dir():
            raise RuntimeError("Pinned Hunyuan paint or DINOv2 model snapshot is incomplete")
        config = Hunyuan3DPaintConfig(max_num_view=6, resolution=min(768, spec["budgets"]["maxTextureResolution"]))
        config.multiview_cfg_path = str(source / "hy3dpaint" / "cfgs" / "hunyuan-paint-pbr.yaml")
        config.dino_ckpt_path = str(dino_model)
        config.realesrgan_ckpt_path = str(source / "hy3dpaint" / "ckpt" / "RealESRGAN_x4plus.pth")
        original_snapshot_download = huggingface_hub.snapshot_download

        def local_snapshot_download(*, repo_id: str, **_kwargs) -> str:
            if repo_id != "tencent/Hunyuan3D-2.1":
                raise RuntimeError(f"Unallowlisted offline Hunyuan model request: {repo_id}")
            return str(paint_model)

        huggingface_hub.snapshot_download = local_snapshot_download
        previous_cwd = Path.cwd()
        os.chdir(source / "hy3dpaint")
        try:
            painter = Hunyuan3DPaintPipeline(config)
        finally:
            huggingface_hub.snapshot_download = original_snapshot_download
            os.chdir(previous_cwd)
        textured_obj = output.parent / "textured_mesh.obj"
        painter(str(intermediate), image_path=str(concept_path), output_mesh_path=str(textured_obj), save_glb=True)
        textured_glb = textured_obj.with_suffix(".glb")
        if not textured_glb.is_file():
            raise RuntimeError("Hunyuan3D-Paint did not produce its declared GLB output")
        textured_glb.replace(output)
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
    if is_hunyuan:
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
