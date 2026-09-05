"""Run one pinned HY-Motion 1.0 Lite inference and retain only skeletal motion data.

The official project can render/export its bundled wooden preview person.  This
worker deliberately does not call that path.  It serializes the model's native
22-joint local rotations, root trajectory, and rest rig so the application can
skin the user's exact approved Hunyuan mesh without importing preview geometry.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import signal
import sys
from datetime import datetime, timezone
from pathlib import Path


EXECUTION_PROFILES = {
    "hy-motion-cuda-standard-v1": {"device": "cuda", "validationSteps": None},
    "hy-motion-cpu-basic-v1": {"device": "cpu", "validationSteps": 12},
}


def emit(stage: str, progress: int, message: str, **extra) -> None:
    print(json.dumps({"stage": stage, "progress": progress, "message": message, **extra}), flush=True)


def task_path(value: str) -> Path:
    raw = value.strip()
    match = re.fullmatch(r"([A-Za-z]):[\\/](.*)", raw)
    if os.name != "nt" and match:
        raw = f"/mnt/{match.group(1).lower()}/{match.group(2).replace(chr(92), '/')}"
    return Path(raw).resolve()


def contained(root: Path, value: str) -> Path:
    path = task_path(value)
    if root != path and root not in path.parents:
        raise ValueError("motion path escapes the Prompt-to-3D root")
    return path


def finite_nested(value) -> bool:
    import numpy as np
    return bool(np.isfinite(value).all())


parser = argparse.ArgumentParser()
parser.add_argument("--provider", required=True)
parser.add_argument("--spec", required=True)
parser.add_argument("--root", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--provider-source", required=True)
parser.add_argument("--pid-file", required=True)
args = parser.parse_args()

if args.provider != "hy-motion-1":
    raise ValueError("HY-Motion worker accepts only the typed hy-motion-1 provider")

root = task_path(args.root)
spec_path = contained(root, args.spec)
output_path = contained(root, args.output)
provider_source = contained(root, args.provider_source)
pid_file = contained(root, args.pid_file)
provider_root = contained(root, str(provider_source.parent))

pid_file.write_text(str(os.getpid()), encoding="ascii")


def cleanup(*_args) -> None:
    pid_file.unlink(missing_ok=True)


def terminate(_signum, _frame) -> None:
    cleanup()
    raise SystemExit(143)


signal.signal(signal.SIGTERM, terminate)
signal.signal(signal.SIGINT, terminate)

try:
    spec_bytes = spec_path.read_bytes()
    if len(spec_bytes) < 2 or len(spec_bytes) > 128 * 1024:
        raise ValueError("HY-Motion task is empty or exceeds the 128 KiB limit")
    spec = json.loads(spec_bytes)
    if spec.get("version") != 1 or spec.get("providerId") != "hy-motion-1":
        raise ValueError("Typed HY-Motion task version/provider is invalid")
    prompt = spec.get("prompt")
    seed = spec.get("seed")
    duration = spec.get("duration")
    cfg_scale = spec.get("cfgScale")
    requested_profile = spec.get("executionProfile")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 2_000:
        raise ValueError("HY-Motion prompt must contain 1-2,000 characters")
    if not isinstance(seed, int) or isinstance(seed, bool) or seed < 0 or seed > 2_147_483_647:
        raise ValueError("HY-Motion seed is outside the supported range")
    if not isinstance(duration, (int, float)) or isinstance(duration, bool) or duration < 0.5 or duration > 5.0:
        raise ValueError("HY-Motion duration must be between 0.5 and 5 seconds")
    if not isinstance(cfg_scale, (int, float)) or cfg_scale < 1.0 or cfg_scale > 10.0:
        raise ValueError("HY-Motion CFG scale must be between 1 and 10")
    if spec.get("compatibility", {}).get("classification") != "humanoid":
        raise ValueError("HY-Motion requires a retained humanoid compatibility decision")
    if not isinstance(requested_profile, dict):
        raise ValueError("HY-Motion task is missing its measured execution profile")
    profile_id = requested_profile.get("id")
    expected_profile = EXECUTION_PROFILES.get(profile_id)
    if expected_profile is None or requested_profile.get("device") != expected_profile["device"]:
        raise ValueError("HY-Motion execution profile is unsupported or internally inconsistent")
    if requested_profile.get("validationSteps") != expected_profile["validationSteps"]:
        raise ValueError("HY-Motion execution profile changed its retained validation schedule")
    gpu_uuid = requested_profile.get("gpu", {}).get("uuid") if isinstance(requested_profile.get("gpu"), dict) else None
    if expected_profile["device"] == "cuda" and (not isinstance(gpu_uuid, str) or re.fullmatch(r"GPU-[A-Za-z0-9-]{8,64}", gpu_uuid) is None):
        raise ValueError("HY-Motion CUDA profile requires an explicitly measured GPU UUID")
    if expected_profile["device"] == "cpu" and gpu_uuid is not None:
        raise ValueError("HY-Motion CPU profile cannot retain a CUDA adapter")

    model_root = provider_root / "models" / "tencent--HY-Motion-1.0" / "HY-Motion-1.0-Lite"
    config_path = model_root / "config.yml"
    checkpoint_path = model_root / "latest.ckpt"
    qwen_path = provider_root / "models" / "Qwen--Qwen3-8B"
    clip_path = provider_root / "models" / "openai--clip-vit-large-patch14"
    required = (provider_source, config_path, checkpoint_path, qwen_path, clip_path)
    if not all(path.exists() for path in required):
        raise FileNotFoundError("One or more signed HY-Motion source/model paths are missing")

    # The official text encoder uses these fixed relative checkpoint names when
    # USE_HF_MODELS is unset.  Point its module constants at the signed local
    # snapshots without enabling any network lookup.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["USE_HF_MODELS"] = "0"
    if expected_profile["device"] == "cuda":
        # UUID selection remains stable when a display adapter is added and its
        # numeric CUDA index changes. This limits provider visibility; it does
        # not claim a system-wide GPU reservation.
        os.environ["CUDA_DEVICE_ORDER"] = "PCI_BUS_ID"
        os.environ["CUDA_VISIBLE_DEVICES"] = gpu_uuid
    else:
        os.environ["CUDA_VISIBLE_DEVICES"] = ""
    sys.path.insert(0, str(provider_source))
    os.chdir(provider_source)

    emit("animation", 8, f"Loading the signed HY-Motion 1.0 Lite checkpoint and prompt encoders with {profile_id}.")
    import torch
    if expected_profile["device"] == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("The selected HY-Motion CUDA adapter is not visible inside the isolated runtime")
    from hymotion.network.text_encoders import text_encoder as text_encoder_module
    text_encoder_module.QWEN_PATH = str(qwen_path)
    text_encoder_module.CLIP_PATH = str(clip_path)
    text_encoder_module.LLM_ENCODER_LAYOUT["qwen3"]["module_path"] = str(qwen_path)
    text_encoder_module.SENTENCE_EMB_LAYOUT["clipl"]["module_path"] = str(clip_path)
    from hymotion.utils.t2m_runtime import T2MRuntime
    from hymotion.utils.geometry import rot6d_to_rotation_matrix

    runtime = T2MRuntime(
        config_path=str(config_path),
        ckpt_name=str(checkpoint_path),
        device_ids=[0] if expected_profile["device"] == "cuda" else None,
        force_cpu=expected_profile["device"] == "cpu",
        disable_prompt_engineering=True,
    )
    emit("animation", 35, f"Encoding the complete prompt and generating a seeded skeletal motion sequence on {expected_profile['device'].upper()}.")
    # Call the official pipeline's model-generation method directly.  The
    # higher-level runtime helper always creates an NPZ/HTML wooden-person
    # preview as a side effect, which is intentionally outside this workflow.
    pipeline = runtime.pipelines[0]
    if expected_profile["validationSteps"] is not None:
        pipeline.validation_steps = expected_profile["validationSteps"]
    pipeline.eval()
    with torch.inference_mode():
        model_output = pipeline.generate(
            prompt.strip(), [seed], float(duration),
            cfg_scale=float(cfg_scale), use_special_game_feat=True,
        )
    rot6d = model_output.get("rot6d")
    transl = model_output.get("transl")
    if rot6d is None or transl is None or tuple(rot6d.shape[:1]) != (1,) or tuple(transl.shape[:1]) != (1,):
        raise RuntimeError("HY-Motion returned an invalid batch")
    rotations = rot6d_to_rotation_matrix(rot6d[0]).detach().float().cpu().numpy()
    translations = transl[0].detach().float().cpu().numpy()
    if rotations.ndim != 4 or rotations.shape[1:] != (22, 3, 3):
        raise RuntimeError(f"HY-Motion returned unexpected rotation shape {rotations.shape}")
    if translations.shape != (rotations.shape[0], 3) or rotations.shape[0] < 2:
        raise RuntimeError("HY-Motion returned an invalid root trajectory")
    body_model = pipeline.body_model
    rest_joints = body_model.j_template[:22].detach().float().cpu().numpy()
    parents = body_model.parents[:22].detach().cpu().numpy().astype(int)
    joint_names = [str(name) for name in list(body_model.joint_names)[:22]]
    if rest_joints.shape != (22, 3) or parents.shape != (22,) or len(joint_names) != 22:
        raise RuntimeError("HY-Motion runtime did not expose its expected 22-joint rest rig")
    if int(parents[0]) not in (-1, 0) or any(int(parents[index]) < 0 or int(parents[index]) >= index for index in range(1, 22)):
        raise RuntimeError("HY-Motion returned an invalid joint hierarchy")
    if not all(finite_nested(value) for value in (rotations, translations, rest_joints)):
        raise RuntimeError("HY-Motion returned non-finite skeletal data")

    output = {
        "version": 1,
        "providerId": "hy-motion-1",
        "providerModel": "hy-motion-1.0-lite",
        "sourceRevision": "4e426f5a1021cbcf7f375458c37b840ee7225229",
        "modelRevision": "620dd559f8d964aac2f82f1204fe6a35ad8ad14d",
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "prompt": prompt.strip(),
        "promptSha256": hashlib.sha256(prompt.strip().encode("utf-8")).hexdigest(),
        "seed": seed,
        "duration": float(duration),
        "fps": 30,
        "frames": int(rotations.shape[0]),
        "cfgScale": float(cfg_scale),
        "executionProfile": {
            "id": profile_id,
            "device": expected_profile["device"],
            "validationSteps": expected_profile["validationSteps"],
            "gpuUuid": gpu_uuid,
        },
        # The pinned MotionGeneration decoder grounds the bundled reference on
        # vertices[..., 1], establishing the native right-handed Y-up frame.
        "coordinateSystem": {"upAxis": "+Y", "forwardAxis": "+Z", "handedness": "right"},
        "jointNames": joint_names,
        "parents": parents.tolist(),
        "restJoints": rest_joints.tolist(),
        "localRotationMatrices": rotations.tolist(),
        "rootTranslations": translations.tolist(),
        "compatibility": spec["compatibility"],
        "upstreamPreviewGeometryRetained": False,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_suffix(output_path.suffix + ".tmp")
    temporary.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
    temporary.replace(output_path)
    emit("animation", 90, "HY-Motion skeletal rotations and root trajectory retained; no preview body was imported.")
finally:
    cleanup()
