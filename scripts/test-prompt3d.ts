import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Document, NodeIO } from "@gltf-transform/core";
import { evaluatePrompt3DCompliance } from "../src/main/prompt3d/hardware";
import { hunyuanExecutionSettings } from "../src/main/prompt3d/hunyuanProfiles";
import { Prompt3DInstaller } from "../src/main/prompt3d/installer";
import { discoverPrompt3DRoot, isExistingPrompt3DRoot } from "../src/main/prompt3d/discovery";
import { localProvider } from "../src/main/prompt3d/providers";
import { applyPrompt3DPlanProposal } from "../src/main/prompt3d/planning";
import { postprocessPrompt3DGlb } from "../src/main/prompt3d/postprocess";
import { Prompt3DService } from "../src/main/prompt3d/service";
import { validatePrompt3DGlb } from "../src/main/prompt3d/validation";
import { sanitizeAssetSpec } from "../src/shared/conceptWorkflow";
import {
  normalizePrompt3DTextureResolution,
  PROMPT3D_SPEC_VERSION,
  prompt3dTextureResolutionsFor,
  type AssetSpecV1,
  type Prompt3DHardwareSnapshot,
} from "../src/shared/prompt3d";
import { compilePrompt3DPrompt } from "../src/shared/prompt3dRules";

async function main() {
  const root = await mkdtemp(join(tmpdir(), "grudge-prompt3d-test-"));
  try {
    const GiB = 1024 ** 3;
    const hardware: Prompt3DHardwareSnapshot = {
      checkedAt: "2026-08-30T00:00:00.000Z",
      os: { platform: "win32", release: "10.0.26200", version: "Windows 11" },
      gpu: { vendor: "NVIDIA", model: "RTX test", driver: "591.86", totalVramBytes: 24 * GiB, freeVramBytes: 11 * GiB, usedVramBytes: 13 * GiB },
      systemRam: { totalBytes: 96 * GiB, freeBytes: 48 * GiB },
      disk: { path: root, totalBytes: 1000 * GiB, freeBytes: 500 * GiB },
      python: [], cudaToolkit: { available: false }, conda: { available: false },
      wsl: { available: true, distributions: ["docker-desktop"], distributionVersions: { "docker-desktop": 2 }, usableLinuxDistribution: null },
    };
    const hunyuan = localProvider("hunyuan3d-2"), trellis = localProvider("trellis"), motion = localProvider("hy-motion-1");
    assert.deepEqual(hunyuan.enabledRoutes, ["concept-image-to-3d"]);
    assert.deepEqual(prompt3dTextureResolutionsFor(hunyuan.id), [1024, 2048], "Hunyuan Paint must advertise only output sizes its official pipeline can emit");
    assert.equal(normalizePrompt3DTextureResolution(hunyuan.id, 512), 1024, "legacy 512 Hunyuan budgets normalize to the official minimum");
    assert.equal(normalizePrompt3DTextureResolution(hunyuan.id, 1024), 1024, "valid 1024 Hunyuan budgets stay unchanged");
    assert.equal(normalizePrompt3DTextureResolution(hunyuan.id, 2048), 2048, "valid 2048 Hunyuan budgets stay unchanged");
    assert.equal(normalizePrompt3DTextureResolution(hunyuan.id, 4096), 2048, "Hunyuan budgets above the official emitted maximum normalize to 2048");
    assert.ok(hunyuan.modelSources.some((model) => model.id === "facebook/dinov2-giant"), "Hunyuan paint model closure must include DINOv2");
    assert.deepEqual(
      hunyuan.executionProfiles?.filter((profile) => profile.operations?.includes("geometry")).map((profile) => profile.id),
      ["hunyuan-shape-standard-v1", "hunyuan-shape-light-v1", "hunyuan-shape-cpu-basic-v1"],
      "Hunyuan shape must expose full GPU, lightweight GPU and genuine CPU profiles",
    );
    assert.equal(hunyuanExecutionSettings(hunyuan.executionProfiles![0], "geometry").conceptInferenceSteps, 30, "the distilled standard concept stage must retain its measured 30-step setting");
    assert.equal(hunyuanExecutionSettings(hunyuan.executionProfiles![0], "geometry").shapeInferenceSteps, 50, "standard geometry must retain the full 50-step Hunyuan shape setting");
    assert.deepEqual(
      hunyuan.executionProfiles?.filter((profile) => profile.operations?.includes("texture")).map((profile) => profile.id),
      ["hunyuan-paint-official-512-v1"],
      "Hunyuan Paint must expose only the upstream-supported quality profile",
    );
    const paintSettings = hunyuanExecutionSettings(hunyuan.executionProfiles!.find((profile) => profile.operations?.includes("texture"))!, "texture");
    assert.equal(paintSettings.paintResolution, 512, "Hunyuan Paint must use the upstream-supported 512 px minimum rather than an unvalidated reduced resolution");
    assert.equal(paintSettings.paintRenderSize, 2048, "Hunyuan Paint must retain the upstream render size");
    assert.deepEqual(trellis.enabledRoutes, ["direct-text"]);
    assert.ok(trellis.modelSources.some((model) => model.id === "openai/clip-vit-large-patch14"), "TRELLIS text model closure must include CLIP");
    assert.ok(trellis.sourceDependencies.some((dependency) => dependency.id === "vox2seq" && dependency.revision.length === 40), "TRELLIS vox2seq must come from an immutable upstream revision");
    assert.deepEqual(motion.executionProfiles?.map((profile) => profile.device), ["cuda", "cpu"], "HY-Motion must expose GPU and provider-native CPU profiles");
    const installerSource = await readFile(join(__dirname, "..", "src", "main", "prompt3d", "installer.ts"), "utf8");
    assert.ok(!installerSource.includes("bash ./setup.sh"), "TRELLIS must not invoke the moving-head upstream setup script");
    assert.ok(!installerSource.includes('"checkout", "--detach", "--force"'), "repair must not force-overwrite an existing provider source checkout");
    assert.ok(installerSource.includes('"status", "--porcelain=v1", "--untracked-files=all"'), "repair must stop on local provider source changes");
    assert.ok(installerSource.includes("every model file SHA-256 verified"), "repair-time integrity must retain full model-byte verification");
    assert.ok(!installerSource.includes("env: { ...process.env"), "installer children must not inherit arbitrary application secrets");
    assert.ok(installerSource.includes("Installed provider source has local changes and cannot run"), "pre-run integrity must reject a dirty provider source checkout");
    assert.ok(installerSource.includes("refusing to replace the public key and invalidate existing manifests"), "partial signing key material must fail closed");
    const serviceSource = await readFile(join(__dirname, "..", "src", "main", "prompt3d", "service.ts"), "utf8");
    assert.ok(serviceSource.includes('join(this.root, ".integrity")'), "UI and CLI installers must share the generator-root integrity key seam");
    assert.ok(!serviceSource.includes("env: { ...process.env"), "sidecar launch must not inherit arbitrary application secrets");
    assert.ok(serviceSource.includes("this.installer.verify(provider.id as LocalPrompt3DProviderId, true)"), "each accepted generation must freshly deep-verify every provider/model/runtime byte before execution");
    assert.ok(serviceSource.includes("captureProviderVerification") && serviceSource.includes("providerVerification: job.providerVerification"), "deep provider verification evidence must be retained in Hunyuan provenance");
    assert.ok(serviceSource.includes('stage: "job-acceptance"') && serviceSource.includes('"hardware-readiness"') && serviceSource.includes('"sidecar-health"'), "accepted jobs must publish retained preflight timing before provider work");
    assert.ok(serviceSource.includes("retainedApprovalFloor = job.conceptApproval ? 36 : 0"), "geometry progress must not move backwards below its retained concept approval");
    assert.ok(serviceSource.includes('state: "awaiting-concept-approval"') && serviceSource.includes("async approveConcept") && serviceSource.includes("async regenerateConcept"), "Hunyuan concepts must stop durably before an explicit approval or one deliberate retained retry");
    assert.ok(serviceSource.includes("assertGeometryApproval") && serviceSource.includes('join(variantDirectory, "concept-approval.json")'), "geometry must use a durable exact approval record");
    assert.ok(serviceSource.includes("isPrompt3DTextureResolutionSupported") && serviceSource.includes("Hunyuan Paint texture resolution must be 1024 or 2048."), "the service boundary must reject unsupported Hunyuan texture budgets");
    const preloadSource = await readFile(join(__dirname, "..", "src", "preload", "preload.ts"), "utf8");
    const sharedSource = await readFile(join(__dirname, "..", "src", "shared", "prompt3d.ts"), "utf8");
    assert.ok(!preloadSource.includes("capabilityToken") && !sharedSource.includes("capabilityToken"), "capability secrets must never enter renderer-facing contracts");
    const snapshotSource = await readFile(join(__dirname, "..", "tools", "prompt3d", "hf_snapshot.py"), "utf8");
    assert.ok(snapshotSource.includes('"treeSha256": tree.hexdigest()') && snapshotSource.includes('"sha256": digest.hexdigest()'), "downloaded model snapshots must record per-file and tree SHA-256 evidence");
    assert.ok(snapshotSource.includes("token=False"), "public model download must not send an implicit Hugging Face account token");
    assert.ok(installerSource.includes("ATTN_BACKEND=xformers") && installerSource.includes("SPCONV_ALGO=native"), "TRELLIS runtime backends must be explicit");
    assert.ok(installerSource.includes('"/bin/kill", "-TERM", "--", `-${pid}`'), "WSL installer cancellation must target the task-owned Linux process group");
    assert.ok(installerSource.includes("setsid bash") && installerSource.includes(".installer-process-group") && installerSource.includes("${pidFile}.command.sh"), "long WSL installer commands must run in a task-owned process group through a task-owned script");
    const sidecarSource = await readFile(join(__dirname, "..", "tools", "prompt3d", "sidecar.py"), "utf8");
    const providerWorkerSource = await readFile(join(__dirname, "..", "tools", "prompt3d", "provider_worker.py"), "utf8");
    const motionWorkerSource = await readFile(join(__dirname, "..", "tools", "prompt3d", "hy_motion_worker.py"), "utf8");
    assert.ok(motionWorkerSource.includes("force_cpu=expected_profile[\"device\"] == \"cpu\"") && motionWorkerSource.includes('os.environ["CUDA_VISIBLE_DEVICES"] = gpu_uuid'), "HY-Motion must use its official CPU mode or one UUID-selected CUDA adapter without a fake motion substitute");
    assert.ok(motionWorkerSource.includes('pipeline.validation_steps = expected_profile["validationSteps"]'), "the basic CPU profile must use its retained reduced validation schedule");
    assert.ok(sidecarSource.includes('"/bin/kill", "-TERM", pid_text'), "WSL cancellation must signal only the task-owned Linux worker PID");
    assert.ok(!sidecarSource.includes("wsl.exe --terminate"), "job cancellation must never terminate the shared WSL distribution");
    assert.ok(sidecarSource.includes('provider_source = wsl_path(ROOT / provider / "source")'), "provider workers must launch the signed provider source from the selected Windows generator root");
    assert.ok(!sidecarSource.includes('"--provider-source", f\'"{linux_base}/source"\''), "provider workers must not launch a copied provider source outside the selected generator root");
    assert.ok(sidecarSource.includes('worker_env.pop("GRUDGE_PROMPT3D_SIDECAR_TOKEN", None)'), "sidecar authorization secret must not reach provider workers");
    assert.ok(
      providerWorkerSource.includes("Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(")
        && providerWorkerSource.includes("subfolder=shape_subfolder")
        && providerWorkerSource.includes('checkpoint = shape_model / "hunyuan3d-dit-v2-mv" / "model.fp16.safetensors"')
        && providerWorkerSource.includes("pipeline_class.from_single_file(")
        && providerWorkerSource.includes("use_safetensors=True"),
      "Hunyuan workers must load each pinned official single-view or multiview checkpoint in the format present in its signed snapshot",
    );
    assert.ok(providerWorkerSource.includes("if resolution not in (1024, 2048)"), "Hunyuan Paint worker must reject the impossible 512 texture budget");
    const compatibilityIndex = providerWorkerSource.indexOf("from utils.torchvision_fix import apply_fix");
    const painterImportIndex = providerWorkerSource.indexOf("from textureGenPipeline import Hunyuan3DPaintPipeline");
    assert.ok(compatibilityIndex >= 0 && painterImportIndex > compatibilityIndex && providerWorkerSource.includes("if apply_fix() is not True:"), "the worker must apply Hunyuan's official torchvision shim before importing the real painter");
    assert.ok(providerWorkerSource.includes("realesrgan_checkpoint.is_file()") && providerWorkerSource.includes("sha256_file(realesrgan_checkpoint) != HUNYUAN_REALESRGAN_SHA256"), "the painter must load only the checksum-pinned Real-ESRGAN helper from the isolated provider runtime");
    assert.ok(installerSource.includes("from utils.torchvision_fix import apply_fix; assert apply_fix() is True; import realesrgan"), "provider repair must exercise Hunyuan's official torchvision shim before signing the environment");
    assert.ok(installerSource.includes("setuptools==80.9.0"), "Hunyuan Paint must retain pkg_resources for its pinned PyTorch Lightning dependency");
    assert.ok(installerSource.includes("runtime-native-artifacts.json") && installerSource.includes("hunyuan-mesh-inpaint-processor"), "the official native UV inpaint build must be inventoried and signed");
    assert.ok(providerWorkerSource.includes("load_hunyuan_native_extension(root)") && providerWorkerSource.includes("nativeArtifactsSha256"), "the worker must checksum and load the signed Hunyuan UV inpaint extension before the painter");
    assert.ok(providerWorkerSource.includes(String.raw`mesh_inpaint_processor[A-Za-z0-9._-]*\.so`), "the native extension validator must accept the real CPython shared-object filename");
    assert.ok(!providerWorkerSource.includes('"hunyuan-paint-basic-v1"') && providerWorkerSource.includes('"paint_resolution": 512') && providerWorkerSource.includes('"render_size": 2048') && providerWorkerSource.includes('config.texture_size = min(resolution * 2, execution["texture_size"])'), "Hunyuan Paint must fail closed below its upstream-supported 512 px, 21 GiB profile while retaining bounded output maps");
    assert.ok(providerWorkerSource.includes('shape.enable_model_cpu_offload()') && providerWorkerSource.includes('execution["concept_steps"]') && providerWorkerSource.includes('execution["shape_steps"]') && providerWorkerSource.includes('execution["octree_resolution"]'), "Hunyuan profiles must use provider-native CPU offload and retained concept/shape quality settings");
    assert.ok(providerWorkerSource.includes('concept_dtype = torch.float32 if execution["concept_device"] == "cpu"') && providerWorkerSource.includes('initial_shape_device = "cpu"'), "CPU-only Hunyuan fallback must run the pinned concept and shape models rather than substitute geometry");
    assert.ok(sidecarSource.includes('jobs[job_id].setdefault("timings", [])'), "sidecar must retain provider timing events");
    assert.ok(providerWorkerSource.includes('completed_timing("concept-image-inference"') && providerWorkerSource.includes('completed_timing("concept-review"') && providerWorkerSource.includes('completed_timing("geometry-inference"'), "provider must report warm-up, inference and concept-review elapsed time");
    assert.ok(providerWorkerSource.includes("if not approved:") && providerWorkerSource.includes("verify_concept_approval(spec, concept_path)"), "provider must stop after concept review and independently reject stale approval");
    assert.equal(evaluatePrompt3DCompliance(hunyuan, hardware, root, "display").state, "setup-required", "uninstalled capable hardware is setup-required");
    assert.equal(evaluatePrompt3DCompliance(trellis, hardware, root, "display").state, "setup-required", "recoverable WSL setup is not unsupported");
    const weak = structuredClone(hardware); weak.gpu!.totalVramBytes = 8 * GiB;
    const weakHunyuan = evaluatePrompt3DCompliance(hunyuan, weak, root, "display", { ...({} as AssetSpecV1), generateTextures: false });
    assert.equal(weakHunyuan.executionProfile?.id, "hunyuan-shape-light-v1", "a smaller CUDA adapter must select the lightweight Hunyuan shape profile by capability");
    assert.equal(weakHunyuan.state, "setup-required", "uninstalled lightweight-capable hardware needs setup rather than being rejected as unsupported");
    const dualGpu = structuredClone(hardware);
    dualGpu.gpus = [
      { index: 0, uuid: "GPU-1660ti00-0000-0000-0000-000000000000", vendor: "NVIDIA", model: "GTX 1660 Ti", driver: "591.86", totalVramBytes: 6 * GiB, freeVramBytes: 5 * GiB, usedVramBytes: 1 * GiB },
      { index: 1, uuid: "GPU-30900000-0000-0000-0000-000000000000", vendor: "NVIDIA", model: "RTX 3090", driver: "591.86", totalVramBytes: 24 * GiB, freeVramBytes: 22 * GiB, usedVramBytes: 2 * GiB },
    ];
    dualGpu.gpu = dualGpu.gpus[1];
    const dualProfile = evaluatePrompt3DCompliance(motion, dualGpu, root, "display").executionProfile;
    assert.equal(dualProfile?.id, "hy-motion-cuda-standard-v1");
    assert.equal(dualProfile?.gpu?.uuid, dualGpu.gpus[1].uuid, "multi-GPU selection must choose the capable adapter by retained UUID rather than display-card index");
    const cpuFallback = evaluatePrompt3DCompliance(motion, hardware, root, "display");
    assert.equal(cpuFallback.executionProfile?.id, "hy-motion-cpu-basic-v1", "insufficient GPU headroom must select the genuine provider-native CPU fallback");
    assert.equal(cpuFallback.canInstall, true, "CPU-capable hardware may install HY-Motion without satisfying the CUDA profile");
    hardware.wsl.distributions.push("Ubuntu-24.04"); hardware.wsl.distributionVersions["Ubuntu-24.04"] = 2; hardware.wsl.usableLinuxDistribution = "Ubuntu-24.04";
    hardware.wsl.runtimeProbe = { distribution: "Ubuntu-24.04", nonRoot: true, homeWritable: true, osId: "ubuntu", osVersion: "24.04", python: "Python 3.12", cudaVisible: true, measuredAt: hardware.checkedAt, elapsedMs: 100 };
    await mkdir(join(root, "hunyuan3d-2"), { recursive: true }); await writeFile(join(root, "hunyuan3d-2", "install-manifest.json"), "{}");
    assert.equal(evaluatePrompt3DCompliance(hunyuan, hardware, root, "pre-run", { ...({} as AssetSpecV1), generateTextures: true }).state, "busy", "installed textured run below the lightest paint profile is busy");
    await mkdir(join(root, "hy-motion-1"), { recursive: true }); await writeFile(join(root, "hy-motion-1", "install-manifest.json"), "{}\n");
    const installedCpuFallback = evaluatePrompt3DCompliance(motion, hardware, root, "pre-run");
    assert.equal(installedCpuFallback.state, "marginal");
    assert.equal(installedCpuFallback.canRun, true, "installed CPU profile must remain runnable when the official GPU minimum is unavailable");
    const statusRoot = join(root, "trellis");
    await mkdir(statusRoot, { recursive: true });
    await writeFile(join(statusRoot, "install-status.json"), `${JSON.stringify({ providerId: "trellis", state: "not-installed", stage: "idle", progress: 0, destination: statusRoot, sourceRevision: trellis.sourceRevision, modelRevisions: [], bytesCompleted: 0, bytesTotal: trellis.downloadBytes, resumable: true, updatedAt: hardware.checkedAt })}\n`);
    await writeFile(join(statusRoot, "install-manifest.json"), "{}\n");
    const statusInstaller = new Prompt3DInstaller({ root, appRoot: join(__dirname, ".."), integrityKeyDirectory: join(root, ".integrity") });
    assert.equal(statusInstaller.getStatus("trellis").state, "installed", "an existing provider manifest must override a stale not-installed status");
    await rm(join(statusRoot, "install-manifest.json"));
    await writeFile(join(statusRoot, "install-status.json"), `${JSON.stringify({ providerId: "trellis", state: "installed", stage: "complete", progress: 100, destination: statusRoot, sourceRevision: trellis.sourceRevision, modelRevisions: [], bytesCompleted: 0, bytesTotal: trellis.downloadBytes, resumable: true, updatedAt: hardware.checkedAt })}\n`);
    assert.equal(statusInstaller.getStatus("trellis").state, "repair-needed", "a missing provider manifest must not remain reported as installed");
    const discoveryRoot = join(root, "existing-root");
    await mkdir(join(discoveryRoot, ".integrity"), { recursive: true });
    await mkdir(join(discoveryRoot, ".python", "cpython-3.10-windows-x86_64-none"), { recursive: true });
    await writeFile(join(discoveryRoot, "prompt3d-ed25519-public.pem"), "test-public-key");
    await writeFile(join(discoveryRoot, ".python", "cpython-3.10-windows-x86_64-none", "python.exe"), "test-runtime");
    for (const provider of [hunyuan, trellis]) {
      await mkdir(join(discoveryRoot, provider.id), { recursive: true });
      await writeFile(join(discoveryRoot, provider.id, "install-manifest.json"), `${JSON.stringify({ providerId: provider.id, sourceRevision: provider.sourceRevision, installationRoot: join(discoveryRoot, provider.id) })}\n`);
    }
    assert.equal(await isExistingPrompt3DRoot(discoveryRoot), true, "a complete pinned provider root must be discoverable");
    assert.equal(await discoverPrompt3DRoot([join(root, "missing"), discoveryRoot]), discoveryRoot, "discovery must select the first complete existing provider root");
    await writeFile(join(discoveryRoot, "trellis", "install-manifest.json"), `${JSON.stringify({ providerId: "trellis", sourceRevision: "wrong", installationRoot: join(discoveryRoot, "trellis") })}\n`);
    assert.equal(await isExistingPrompt3DRoot(discoveryRoot), false, "discovery must reject a provider root with a stale revision");
    const noCuda = structuredClone(hardware); noCuda.wsl.runtimeProbe!.cudaVisible = false;
    const noCudaHunyuan = evaluatePrompt3DCompliance(hunyuan, noCuda, root, "pre-download", { ...({} as AssetSpecV1), generateTextures: false });
    assert.equal(noCudaHunyuan.canInstall, true, "a CPU-capable Hunyuan setup must not enforce CUDA visibility");
    assert.equal(noCudaHunyuan.executionProfile?.id, "hunyuan-shape-cpu-basic-v1", "missing CUDA visibility must select the genuine CPU Hunyuan profile when RAM is sufficient");
    const noCudaMotion = evaluatePrompt3DCompliance(motion, noCuda, root, "pre-download");
    assert.equal(noCudaMotion.canRun, true, "provider-native CPU motion must not require CUDA visibility");
    assert.equal(noCudaMotion.executionProfile?.device, "cpu");
    const cpuOnly = structuredClone(noCuda);
    cpuOnly.gpu = null; cpuOnly.gpus = [];
    assert.equal(evaluatePrompt3DCompliance(motion, cpuOnly, root, "pre-run").canRun, true, "CPU-only machines with sufficient RAM must retain basic genuine motion generation");
    const tooSmall = structuredClone(cpuOnly);
    tooSmall.systemRam = { totalBytes: 16 * GiB, freeBytes: 12 * GiB };
    assert.equal(evaluatePrompt3DCompliance(motion, tooSmall, root, "pre-run").state, "unsupported", "hardware below every declared execution profile must fail honestly");

    const spec: AssetSpecV1 = {
      version: PROMPT3D_SPEC_VERSION, prompt: "test triangle", category: "prop", style: "low-poly", route: "concept-image-to-3d", targetFormat: "glb",
      dimensions: { width: 2, height: 2, depth: 2, unit: "m" }, budgets: { maxTriangles: 10, maxTextureResolution: 1024, maxTextureBytes: 1024 },
      seed: 1, variants: 1, providerId: "hunyuan3d-2", generateTextures: false, generateCollision: false, generateLods: false,
      coordinateContract: { upAxis: "+Y", forwardAxis: "+Z", origin: "ground-center", stableRootName: "GrudgeAssetRoot" },
    };
    assert.equal(sanitizeAssetSpec({ ...spec, budgets: { ...spec.budgets, maxTextureResolution: 512 } }).budgets.maxTextureResolution, 1024, "the shared service sanitizer must upgrade legacy Hunyuan 512 budgets");
    for (const malformed of [null, 1536, "2048"] as const) {
      const malformedSpec = { ...spec, budgets: { ...spec.budgets, maxTextureResolution: malformed } } as unknown as AssetSpecV1;
      assert.equal(sanitizeAssetSpec(malformedSpec).budgets.maxTextureResolution, malformed, "malformed runtime resolution values must remain invalid for service rejection");
    }
    const boundaryService = new Prompt3DService({ root: join(root, "resolution-boundary"), appRoot: join(__dirname, ".."), offlineLocalTest: true });
    const boundaryToken = boundaryService.grant();
    await assert.rejects(
      boundaryService.plan(boundaryToken, { currentSpec: { ...spec, budgets: { ...spec.budgets, maxTriangles: 100, maxTextureResolution: 512 } } }),
      /Hunyuan Paint texture resolution must be 1024 or 2048/,
      "raw service requests must reject a Hunyuan 512 budget before planner work",
    );
    (boundaryService as any).preflightAndDispatch = async () => undefined;
    const manualRulesSpec: AssetSpecV1 = {
      ...spec,
      prompt: "One complete oval shield with a continuous rim and central mounting area",
      budgets: { ...spec.budgets, maxTriangles: 100 },
      objectRules: { type: "shield", component: "whole", shapeNotes: "Keep the upper rim wider", anchor: { x: 0.4, y: 0.6, z: 0.5 }, flipVertical: true },
    };
    const manualRulesJob = await boundaryService.start(boundaryToken, {
      spec: manualRulesSpec,
      consent: { providerId: "hunyuan3d-2", confirmed: true },
    });
    assert.deepEqual(manualRulesJob.spec.objectRules, manualRulesSpec.objectRules, "ordinary generation must preserve compatible manual controls re-entered after a prompt edit");
    await boundaryService.cancel(boundaryToken, manualRulesJob.id);
    await assert.rejects(
      boundaryService.start(boundaryToken, {
        spec: { ...manualRulesSpec, prompt: "One complete oval clockwork dial, explicitly not a shield" },
        consent: { providerId: "hunyuan3d-2", confirmed: true },
      }),
      /explicitly excludes.*shield/i,
      "the service must reject programmatic stale rules that contradict the prompt before provider dispatch",
    );
    boundaryService.shutdown();
    const planned = applyPrompt3DPlanProposal(spec, {
      generationPrompt: "a compact low-poly test prop",
      category: "prop",
      style: "low-poly",
      dimensions: { width: 1, height: 2, depth: 1, unit: "m" },
      budgets: { maxTriangles: 5_000, maxTextureResolution: 512, maxTextureBytes: 4 * 1024 ** 2 },
      generateTextures: true,
      providerId: "meshy",
      command: "do not execute",
      summary: "Typed local planning proposal",
    });
    assert.equal(planned.spec.providerId, spec.providerId, "planner cannot change provider");
    assert.equal(planned.spec.budgets.maxTextureResolution, 1024, "planner budgets below Hunyuan Paint's minimum normalize before reaching generation");
    assert.ok(planned.warnings.some((warning) => warning.includes("Adjusted texture resolution to 1024")), "planner normalization must remain visible");
    assert.equal(planned.spec.route, spec.route, "planner cannot change provider route");
    assert.equal(planned.spec.coordinateContract.forwardAxis, "+Z", "planner cannot change coordinate contract");
    assert.ok(planned.warnings.some((warning) => warning.includes("providerId")), "non-allowlisted fields must be visible");
    assert.ok(planned.warnings.some((warning) => warning.includes("command")), "executable-looking fields must be ignored");
    const propNegative = compilePrompt3DPrompt(spec).negativePrompt;
    assert.match(propNegative, /multiple objects, duplicate, hands, person/i, "prop prompts must retain subject-exclusion negatives");
    const characterNegative = compilePrompt3DPrompt({
      ...spec,
      prompt: "One complete humanoid warrior with two hands and a readable full-body silhouette",
      category: "character",
    }).negativePrompt;
    assert.doesNotMatch(characterNegative, /\bhands\b|\bperson\b/i, "character prompts must not negate their own humanoid anatomy");
    assert.match(characterNegative, /multiple subjects.*duplicate subject/i, "character prompts must still prevent multiple or duplicated subjects without negating the character class");
    assert.equal(evaluatePrompt3DCompliance(hunyuan, hardware, root, "pre-run", spec).state, "ready", "geometry path with documented headroom is ready");
    const document = new Document();
    const buffer = document.createBuffer();
    const positions = document.createAccessor().setType("VEC3").setArray(new Float32Array([-1, 0, -1, 1, 0, -1, 1, 2, 1, -1, 2, 1])).setBuffer(buffer);
    const normals = document.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])).setBuffer(buffer);
    const uv = document.createAccessor().setType("VEC2").setArray(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])).setBuffer(buffer);
    const indices = document.createAccessor().setType("SCALAR").setArray(new Uint16Array([0, 1, 2, 0, 2, 3])).setBuffer(buffer);
    const primitive = document.createPrimitive().setIndices(indices).setAttribute("POSITION", positions).setAttribute("NORMAL", normals).setAttribute("TEXCOORD_0", uv);
    const mesh = document.createMesh("test").addPrimitive(primitive);
    const assetRoot = document.createNode("ProviderRoot").setMesh(mesh).setTranslation([7, 3, -4]).setScale([2, 0.5, 3]);
    document.createScene().addChild(assetRoot);
    const raw = join(root, "provider.glb"), glb = join(root, "valid.glb"); await new NodeIO().write(raw, document);
    const postprocessSpec = { ...spec, generateCollision: true, generateLods: true };
    await postprocessPrompt3DGlb(raw, glb, postprocessSpec);
    const processed = await new NodeIO().read(glb);
    const processedNodes = processed.getRoot().listNodes().map((node) => ({ name: node.getName(), extras: node.getExtras(), mesh: Boolean(node.getMesh()) }));
    assert.ok(processedNodes.some((node) => /^LOD1/i.test(node.name) && node.mesh), `LOD node missing: ${JSON.stringify(processedNodes)}`);
    const renderedNodeNames: string[] = [];
    processed.getRoot().listScenes().forEach((scene) => scene.traverse((node) => renderedNodeNames.push(node.getName())));
    assert.ok(!renderedNodeNames.some((name) => /^LOD1/i.test(name)), "generated LODs must not render on top of the base mesh");
    const report = await validatePrompt3DGlb(glb, postprocessSpec, join(root, "quarantine"));
    assert.equal(report.gameReady, true, report.checks.filter((c) => c.status === "fail").map((c) => c.message).join("; "));
    process.stdout.write(`Prompt-to-3D contract checks passed (${report.deterministicId.slice(0, 12)}).\n`);
  } finally { await rm(root, { recursive: true, force: true }); }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
