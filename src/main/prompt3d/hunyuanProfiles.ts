import type { Prompt3DExecutionProfile, Prompt3DSelectedExecutionProfile } from "../../shared/prompt3d";

const GiB = 1024 ** 3;

export const HUNYUAN_EXECUTION_PROFILES: Prompt3DExecutionProfile[] = [
  {
    id: "hunyuan-shape-standard-v1",
    label: "GPU · full shape quality",
    device: "cuda",
    operations: ["geometry"],
    qualityTier: "standard",
    minimumTotalVramBytes: 10 * GiB,
    minimumFreeVramBytes: 10 * GiB,
    minimumSystemRamBytes: 32 * GiB,
    minimumFreeSystemRamBytes: 8 * GiB,
    tradeoff: "Runs the pinned distilled Hunyuan concept model for 30 steps and the shape model for 50 steps at 512 octree resolution.",
  },
  {
    id: "hunyuan-shape-light-v1",
    label: "GPU · lightweight shape",
    device: "cuda",
    operations: ["geometry"],
    qualityTier: "basic",
    minimumTotalVramBytes: 6 * GiB,
    minimumFreeVramBytes: 6 * GiB,
    minimumSystemRamBytes: 32 * GiB,
    minimumFreeSystemRamBytes: 16 * GiB,
    tradeoff: "Uses provider-native model CPU offload, 30 Hunyuan concept and shape steps, and 256 octree resolution. It is slower and may lose small details.",
  },
  {
    id: "hunyuan-shape-cpu-basic-v1",
    label: "CPU · basic Hunyuan shape",
    device: "cpu",
    operations: ["geometry"],
    qualityTier: "basic",
    minimumTotalVramBytes: 0,
    minimumFreeVramBytes: 0,
    minimumSystemRamBytes: 64 * GiB,
    minimumFreeSystemRamBytes: 32 * GiB,
    tradeoff: "Runs the pinned Hunyuan concept and shape models on CPU for 20 steps at 256 octree resolution. It is genuine but substantially slower.",
  },
  {
    id: "hunyuan-paint-official-512-v1",
    label: "GPU · official Hunyuan Paint",
    device: "cuda",
    operations: ["texture"],
    qualityTier: "standard",
    minimumTotalVramBytes: 21 * GiB,
    minimumFreeVramBytes: 21 * GiB,
    minimumSystemRamBytes: 32 * GiB,
    minimumFreeSystemRamBytes: 8 * GiB,
    tradeoff: "Runs six official Hunyuan Paint views at the upstream-supported 512 px generation resolution and retains a 1024 or 2048 px output map. Tencent recommends at least 21 GiB VRAM for this setting.",
  },
];

export interface HunyuanExecutionSettings {
  operation: "geometry" | "texture";
  conceptDevice?: "cuda-offload" | "cpu";
  conceptInferenceSteps?: number;
  shapeDevice?: "cuda" | "cuda-offload" | "cpu";
  shapeInferenceSteps?: number;
  shapeOctreeResolution?: number;
  textureViewCount?: 6;
  paintResolution?: 512 | 768;
  paintRenderSize?: 2048;
  paintTextureSize?: 4096;
}

const SETTINGS: Record<string, HunyuanExecutionSettings> = {
  "hunyuan-shape-standard-v1": {
    operation: "geometry", conceptDevice: "cuda-offload", shapeDevice: "cuda",
    conceptInferenceSteps: 30, shapeInferenceSteps: 50, shapeOctreeResolution: 512,
  },
  "hunyuan-shape-light-v1": {
    operation: "geometry", conceptDevice: "cuda-offload", shapeDevice: "cuda-offload",
    conceptInferenceSteps: 30, shapeInferenceSteps: 30, shapeOctreeResolution: 256,
  },
  "hunyuan-shape-cpu-basic-v1": {
    operation: "geometry", conceptDevice: "cpu", shapeDevice: "cpu",
    conceptInferenceSteps: 20, shapeInferenceSteps: 20, shapeOctreeResolution: 256,
  },
  "hunyuan-paint-official-512-v1": {
    operation: "texture", textureViewCount: 6, paintResolution: 512,
    paintRenderSize: 2048, paintTextureSize: 4096,
  },
};

export function hunyuanExecutionSettings(
  profile: Prompt3DSelectedExecutionProfile | Prompt3DExecutionProfile,
  operation: "geometry" | "texture",
): HunyuanExecutionSettings {
  const settings = SETTINGS[profile.id];
  if (!settings || settings.operation !== operation || !profile.operations?.includes(operation)) {
    throw new Error(`The selected Hunyuan execution profile cannot run ${operation}.`);
  }
  return { ...settings };
}
