"""Run a bounded, offline HunyuanDiT prompt/seed sweep for visual diagnostics.

This does not create acceptance evidence or geometry. It helps diagnose prompt
understanding without repeatedly loading the same pinned concept checkpoint.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--prompt", action="append", required=True)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--steps", type=int, default=30)
    args = parser.parse_args()

    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    model = Path(args.model).resolve()
    output = Path(args.output).resolve()
    if not model.is_dir():
        raise RuntimeError("The pinned local HunyuanDiT model directory is unavailable.")
    if not 1 <= len(args.prompt) <= 8 or not 1 <= args.steps <= 50:
        raise RuntimeError("The diagnostic sweep is bounded to 1-8 prompts and 1-50 steps.")
    output.mkdir(parents=True, exist_ok=True)

    import torch
    from diffusers import HunyuanDiTPipeline

    pipe = HunyuanDiTPipeline.from_pretrained(str(model), torch_dtype=torch.float16, local_files_only=True)
    pipe.enable_model_cpu_offload()
    negative = (
        "cropped, cut off, close-up, out of frame, multiple subjects, duplicate subject, "
        "detached requested parts, separate accessory, text, watermark, scenery, display stand"
    )
    records = []
    for index, prompt in enumerate(args.prompt):
        seed = args.seed + index
        print(f"GENERATING {index + 1}/{len(args.prompt)} seed={seed}", flush=True)
        image = pipe(
            prompt=prompt,
            negative_prompt=negative,
            height=1024,
            width=1024,
            num_inference_steps=args.steps,
            guidance_scale=5.0,
            generator=torch.Generator("cpu").manual_seed(seed),
        ).images[0]
        path = output / f"concept-{index + 1:02d}-seed-{seed}.png"
        image.save(path)
        records.append({
            "index": index + 1,
            "seed": seed,
            "steps": args.steps,
            "guidanceScale": 5.0,
            "prompt": prompt,
            "promptSha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
            "path": str(path),
        })
        print(f"SAVED {path}", flush=True)
    (output / "diagnostic-manifest.json").write_text(
        json.dumps({"provider": "Tencent-Hunyuan/HunyuanDiT-v1.1-Diffusers-Distilled", "records": records}, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
