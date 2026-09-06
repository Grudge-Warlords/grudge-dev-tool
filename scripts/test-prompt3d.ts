import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Document, NodeIO } from "@gltf-transform/core";
import { evaluatePrompt3DCompliance } from "../src/main/prompt3d/hardware";
import { localProvider } from "../src/main/prompt3d/providers";
import { applyPrompt3DPlanProposal } from "../src/main/prompt3d/planning";
import { postprocessPrompt3DGlb } from "../src/main/prompt3d/postprocess";
import { validatePrompt3DGlb } from "../src/main/prompt3d/validation";
import { PROMPT3D_SPEC_VERSION, type AssetSpecV1, type Prompt3DHardwareSnapshot } from "../src/shared/prompt3d";

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
    const hunyuan = localProvider("hunyuan3d-2"), trellis = localProvider("trellis");
    assert.deepEqual(hunyuan.enabledRoutes, ["concept-image-to-3d"]);
    assert.ok(hunyuan.modelSources.some((model) => model.id === "facebook/dinov2-giant"), "Hunyuan paint model closure must include DINOv2");
    assert.deepEqual(trellis.enabledRoutes, ["direct-text"]);
    assert.ok(trellis.modelSources.some((model) => model.id === "openai/clip-vit-large-patch14"), "TRELLIS text model closure must include CLIP");
    assert.ok(trellis.sourceDependencies.some((dependency) => dependency.id === "vox2seq" && dependency.revision.length === 40), "TRELLIS vox2seq must come from an immutable upstream revision");
    const installerSource = await readFile(join(__dirname, "..", "src", "main", "prompt3d", "installer.ts"), "utf8");
    assert.ok(!installerSource.includes("bash ./setup.sh"), "TRELLIS must not invoke the moving-head upstream setup script");
    assert.ok(!installerSource.includes('"checkout", "--detach", "--force"'), "repair must not force-overwrite an existing provider source checkout");
    assert.ok(installerSource.includes('"status", "--porcelain=v1", "--untracked-files=all"'), "repair must stop on local provider source changes");
    assert.ok(installerSource.includes("every model file SHA-256 verified"), "pre-run integrity must deep-verify model snapshot files");
    assert.ok(!installerSource.includes("env: { ...process.env"), "installer children must not inherit arbitrary application secrets");
    assert.ok(installerSource.includes("Installed provider source has local changes and cannot run"), "pre-run integrity must reject a dirty provider source checkout");
    assert.ok(installerSource.includes("refusing to replace the public key and invalidate existing manifests"), "partial signing key material must fail closed");
    const serviceSource = await readFile(join(__dirname, "..", "src", "main", "prompt3d", "service.ts"), "utf8");
    assert.ok(serviceSource.includes('join(this.root, ".integrity")'), "UI and CLI installers must share the generator-root integrity key seam");
    assert.ok(!serviceSource.includes("env: { ...process.env"), "sidecar launch must not inherit arbitrary application secrets");
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
    assert.ok(sidecarSource.includes('"/bin/kill", "-TERM", pid_text'), "WSL cancellation must signal only the task-owned Linux worker PID");
    assert.ok(!sidecarSource.includes("wsl.exe --terminate"), "job cancellation must never terminate the shared WSL distribution");
    assert.ok(sidecarSource.includes('worker_env.pop("GRUDGE_PROMPT3D_SIDECAR_TOKEN", None)'), "sidecar authorization secret must not reach provider workers");
    assert.ok(!providerWorkerSource.includes("use_safetensors=True"), "Hunyuan worker must load the pinned official checkpoint format actually present in its signed snapshot");
    assert.equal(evaluatePrompt3DCompliance(hunyuan, hardware, root, "display").state, "setup-required", "uninstalled capable hardware is setup-required");
    assert.equal(evaluatePrompt3DCompliance(trellis, hardware, root, "display").state, "setup-required", "recoverable WSL setup is not unsupported");
    const weak = structuredClone(hardware); weak.gpu!.totalVramBytes = 8 * GiB;
    assert.equal(evaluatePrompt3DCompliance(hunyuan, weak, root, "display").state, "unsupported", "physical minimum failure is unsupported");
    hardware.wsl.distributions.push("Ubuntu-24.04"); hardware.wsl.distributionVersions["Ubuntu-24.04"] = 2; hardware.wsl.usableLinuxDistribution = "Ubuntu-24.04";
    hardware.wsl.runtimeProbe = { distribution: "Ubuntu-24.04", nonRoot: true, homeWritable: true, osId: "ubuntu", osVersion: "24.04", python: "Python 3.12", cudaVisible: true, measuredAt: hardware.checkedAt };
    await mkdir(join(root, "hunyuan3d-2"), { recursive: true }); await writeFile(join(root, "hunyuan3d-2", "install-manifest.json"), "{}");
    assert.equal(evaluatePrompt3DCompliance(hunyuan, hardware, root, "pre-run").state, "busy", "installed textured run with low headroom is busy");
    const noCuda = structuredClone(hardware); noCuda.wsl.runtimeProbe!.cudaVisible = false;
    assert.equal(evaluatePrompt3DCompliance(hunyuan, noCuda, root, "pre-download").canInstall, false, "pre-download probe must block setup when WSL CUDA is not visible");

    const spec: AssetSpecV1 = {
      version: PROMPT3D_SPEC_VERSION, prompt: "test triangle", category: "prop", style: "low-poly", route: "concept-image-to-3d", targetFormat: "glb",
      dimensions: { width: 2, height: 2, depth: 2, unit: "m" }, budgets: { maxTriangles: 10, maxTextureResolution: 512, maxTextureBytes: 1024 },
      seed: 1, variants: 1, providerId: "hunyuan3d-2", generateTextures: false, generateCollision: false, generateLods: false,
      coordinateContract: { upAxis: "+Y", forwardAxis: "+Z", origin: "ground-center", stableRootName: "GrudgeAssetRoot" },
    };
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
    assert.equal(planned.spec.route, spec.route, "planner cannot change provider route");
    assert.equal(planned.spec.coordinateContract.forwardAxis, "+Z", "planner cannot change coordinate contract");
    assert.ok(planned.warnings.some((warning) => warning.includes("providerId")), "non-allowlisted fields must be visible");
    assert.ok(planned.warnings.some((warning) => warning.includes("command")), "executable-looking fields must be ignored");
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
