import React from "react";
import { EffectComposer, Bloom, SMAA, ToneMapping } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import { HalfFloatType } from "three";

/**
 * Production-tier post-processing pipeline. Notes:
 *
 * - `frameBufferType={HalfFloatType}` keeps the pipeline in HDR (16-bit) so
 *   bloom doesn't clip highlights. Required for ACES tone mapping to look
 *   right.
 * - All effects merge into a single `EffectPass` automatically when stacked
 *   inside one `<EffectComposer>`. Don't nest multiple composers.
 * - Order matters: HDR effects (Bloom) FIRST, then antialiasing (SMAA),
 *   then ToneMapping LAST so the LDR conversion happens after compositing.
 */
export default function EffectsPipeline() {
  return (
    <EffectComposer multisampling={0} frameBufferType={HalfFloatType}>
      <Bloom
        intensity={0.6}
        luminanceThreshold={0.85}
        luminanceSmoothing={0.2}
        mipmapBlur
        blendFunction={BlendFunction.ADD}
      />
      <SMAA />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
