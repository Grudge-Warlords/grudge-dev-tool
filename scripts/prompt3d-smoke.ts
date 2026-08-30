import { resolve } from "node:path";
import { Prompt3DService } from "../src/main/prompt3d/service";
import { PROMPT3D_SPEC_VERSION, type AssetSpecV1, type Prompt3DJobStatus } from "../src/shared/prompt3d";

async function main() {
  const root = resolve(process.env.GRUDGE_PROMPT3D_ROOT || "E:\\GrudgePrompt3D");
  const service = new Prompt3DService({ root, appRoot: resolve(__dirname, ".."), offlineLocalTest: true });
  const token = service.grant();
  const spec: AssetSpecV1 = {
    version: PROMPT3D_SPEC_VERSION,
    prompt: "A simple low-poly wooden shipping crate with broad planks, reinforced corners, no lettering, isolated on a plain background",
    category: "prop",
    style: "low-poly",
    route: "concept-image-to-3d",
    targetFormat: "glb",
    dimensions: { width: 1, height: 1, depth: 1, unit: "m" },
    budgets: { maxTriangles: 250_000, maxTextureResolution: 1024, maxTextureBytes: 16 * 1024 ** 2 },
    seed: 20260830,
    variants: 1,
    providerId: "hunyuan3d-2",
    generateTextures: false,
    generateCollision: true,
    generateLods: false,
    coordinateContract: { upAxis: "+Y", forwardAxis: "+Z", origin: "ground-center", stableRootName: "GrudgeAssetRoot" },
  };
  let last = "";
  service.on("job-progress", (job: Prompt3DJobStatus) => {
    const marker = `${job.stage}:${job.progress}:${job.message}`;
    if (marker !== last) process.stdout.write(`${JSON.stringify({ type: "progress", id: job.id, state: job.state, stage: job.stage, progress: job.progress, message: job.message })}\n`);
    last = marker;
  });
  let current: Prompt3DJobStatus | null = null;
  const stop = async () => {
    if (current?.state === "running") await service.cancel(token, current.id).catch(() => undefined);
    service.shutdown();
  };
  process.once("SIGINT", () => { void stop().finally(() => process.exit(130)); });
  process.once("SIGTERM", () => { void stop().finally(() => process.exit(143)); });
  try {
    current = await service.start(token, { spec, consent: { providerId: spec.providerId, confirmed: true, externalData: [], estimatedCostUsd: 0 } });
    while (current.state === "running" || current.state === "queued") {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
      current = service.status(token, current.id);
    }
    process.stdout.write(`${JSON.stringify({ type: "result", id: current.id, state: current.state, stage: current.stage, variants: current.variants.map((variant) => ({ glbPath: variant.glbPath, gameReady: variant.report.gameReady, validationId: variant.report.deterministicId, provenancePath: variant.provenancePath })), error: current.error })}\n`);
    if (current.state !== "complete" || !current.variants.every((variant) => variant.report.gameReady)) process.exitCode = 2;
  } finally {
    service.shutdown();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
