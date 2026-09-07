"""Offline smoke test for the separately pinned official Hunyuan3D-2mv weights."""
import gc
import importlib.util
import sys
from pathlib import Path

from PIL import Image


provider_root = Path("/mnt/e/GrudgePrompt3D/hunyuan3d-2")
source = Path.home() / ".local/share/grudge-prompt3d/hunyuan3d-2-82920d643c0d/source"
sys.path.insert(0, str(source / "hy3dshape"))

from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline

worker_path = Path("/mnt/e/grudge/grudge-dev-tool/tools/prompt3d/provider_worker.py")
module_spec = importlib.util.spec_from_file_location("prompt3d_provider_worker_mv_load", worker_path)
assert module_spec is not None and module_spec.loader is not None
worker = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(worker)


model_root = provider_root / "models/tencent--Hunyuan3D-2mv"
runtime_directory = Path("/tmp/grudge-hunyuan-mv-load")
runtime_directory.mkdir(parents=True, exist_ok=True)
pipeline = worker.load_hunyuan_multiview_shape(Hunyuan3DDiTFlowMatchingPipeline, model_root, runtime_directory)
assert type(pipeline).__name__ == "Hunyuan3DDiTFlowMatchingPipeline"
assert type(pipeline.image_processor).__name__ == "MVImageProcessorV2"
prepared = pipeline.prepare_image({
    "left": Image.new("RGBA", (512, 512), (32, 96, 192, 255)),
    "front": Image.new("RGBA", (512, 512), (192, 96, 32, 255)),
})
assert tuple(prepared["image"].shape) == (1, 2, 3, 512, 512)
assert tuple(prepared["mask"].shape) == (1, 2, 1, 512, 512)
assert tuple(prepared["view_idxs"][0]) == (0, 1)
print("Official Hunyuan3D-2mv safetensors and labelled front/left conditioning loaded offline.")
del pipeline
gc.collect()
