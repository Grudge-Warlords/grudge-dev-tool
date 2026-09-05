import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { statfs } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import os from "node:os";
import type {
  AssetSpecV1,
  Prompt3DComplianceCheck,
  Prompt3DExecutionProfile,
  Prompt3DGpuSnapshot,
  Prompt3DHardwareSnapshot,
  Prompt3DProviderManifest,
} from "../../shared/prompt3d";

const exec = promisify(execFile);
const MiB = 1024 ** 2;
const GiB = 1024 ** 3;

export type Prompt3DOutputStage = "concept" | "geometry" | "texture";

export const PROMPT3D_OUTPUT_SPACE_ESTIMATE_BYTES: Record<Prompt3DOutputStage, number> = {
  // Concept preparation retains the supplied source, cutout, normalized image,
  // inspection and receipts. The allowance intentionally includes temporary
  // image-processing headroom rather than claiming an exact output size.
  concept: 512 * MiB,
  // Geometry may briefly retain the provider GLB, canonical GLB and validation
  // copy together. Each provider output is independently capped at 1 GiB.
  geometry: 3 * GiB,
  // Paint also retains a generated reference, six provider views, the raw
  // painted GLB and the geometry-preserving merged result.
  texture: 4 * GiB,
};

export function prompt3DGenerationOutputStage(
  usesConceptApproval: boolean,
  hasApprovedConcept: boolean,
): Extract<Prompt3DOutputStage, "concept" | "geometry"> {
  return usesConceptApproval && !hasApprovedConcept ? "concept" : "geometry";
}

export function assertPrompt3DOutputSpace(root: string, freeBytes: number, stage: Prompt3DOutputStage): number {
  const estimatedMinimumBytes = PROMPT3D_OUTPUT_SPACE_ESTIMATE_BYTES[stage];
  if (!Number.isFinite(freeBytes) || freeBytes < estimatedMinimumBytes) {
    const available = Number.isFinite(freeBytes) ? Math.max(0, freeBytes) : 0;
    const label = stage === "concept"
      ? "concept preparation"
      : stage === "geometry" ? "geometry generation and validation" : "texture generation and validation";
    throw new Error(
      `OUTPUT_STORAGE_FULL: The selected Prompt-to-3D output location ${root} has ${(available / GiB).toFixed(2)} GiB free. `
      + `This ${label} stage uses a conservative estimated minimum of ${(estimatedMinimumBytes / GiB).toFixed(2)} GiB; actual use varies by asset. `
      + "Choose an output location with more free space, then retry. No provider inference was started.",
    );
  }
  return estimatedMinimumBytes;
}

async function measureOutputFilesystem(root: string) {
  let candidate = resolve(root);
  for (;;) {
    try {
      return await statfs(candidate);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}

export async function requirePrompt3DOutputSpace(root: string, stage: Prompt3DOutputStage): Promise<{
  freeBytes: number;
  estimatedMinimumBytes: number;
}> {
  const fs = await measureOutputFilesystem(root);
  const freeBytes = fs.bavail * fs.bsize;
  return {
    freeBytes,
    estimatedMinimumBytes: assertPrompt3DOutputSpace(root, freeBytes, stage),
  };
}

async function command(file: string, args: string[], timeout = 8_000): Promise<string | null> {
  try {
    const { stdout } = await exec(file, args, { timeout, windowsHide: true, encoding: "utf8" });
    return stdout.trim();
  } catch {
    return null;
  }
}

function parseWslList(raw: string | null): string[] {
  if (!raw) return [];
  return raw.replace(/\0/g, "").split(/\r?\n/).map((s) => s.replace(/^\*\s*/, "").trim()).filter(Boolean);
}

function parseWslDistributionVersions(raw: string | null): Record<string, number> {
  const versions: Record<string, number> = {};
  if (!raw) return versions;
  for (const line of raw.replace(/\0/g, "").split(/\r?\n/)) {
    const match = line.replace(/^\s*\*?\s*/, "").trim().match(/^(.+?)\s+(?:Running|Stopped|Installing)\s+(\d+)$/i);
    if (match) versions[match[1].trim()] = Number(match[2]);
  }
  return versions;
}

function versionAtLeast(actual: string | undefined, required: string): boolean {
  if (!actual) return false;
  const a = actual.split(".").map(Number), b = required.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] || 0, right = b[index] || 0;
    if (left !== right) return left > right;
  }
  return true;
}

export async function measurePrompt3DHardware(root: string, probeLinuxRuntime = false): Promise<Prompt3DHardwareSnapshot> {
  const [gpuRaw, nvccRaw, condaRaw, wslVersionRaw, wslListRaw, wslVerboseRaw, python310, python311] = await Promise.all([
    command("nvidia-smi", ["--query-gpu=index,uuid,name,driver_version,memory.total,memory.free,memory.used,compute_cap", "--format=csv,noheader,nounits"]),
    command("nvcc", ["--version"]),
    command("conda", ["--version"]),
    process.platform === "win32" ? command("wsl.exe", ["--version"]) : Promise.resolve(null),
    process.platform === "win32" ? command("wsl.exe", ["--list", "--quiet"]) : Promise.resolve(null),
    process.platform === "win32" ? command("wsl.exe", ["--list", "--verbose"]) : Promise.resolve(null),
    process.platform === "win32" ? command("py", ["-3.10", "--version"]) : command("python3.10", ["--version"]),
    process.platform === "win32" ? command("py", ["-3.11", "--version"]) : command("python3.11", ["--version"]),
  ]);
  const fs = await measureOutputFilesystem(root);
  const distributions = parseWslList(wslListRaw);
  const distributionVersions = parseWslDistributionVersions(wslVerboseRaw);
  const requestedDistribution = process.env.GRUDGE_PROMPT3D_WSL_DISTRO?.trim();
  const usableLinuxDistribution = requestedDistribution
    ? distributions.find((d) => d.toLowerCase() === requestedDistribution.toLowerCase() && !/^docker-desktop(?:-data)?$/i.test(d)) ?? null
    : distributions.find((d) => !/^docker-desktop(?:-data)?$/i.test(d)) ?? null;
  let runtimeProbe: Prompt3DHardwareSnapshot["wsl"]["runtimeProbe"];
  if (probeLinuxRuntime && usableLinuxDistribution) {
    const runtimeProbeStarted = Date.now();
    const script = [
      "set -u",
      "uid=$(id -u)",
      "writable=no; [ -n \"${HOME:-}\" ] && [ -w \"$HOME\" ] && writable=yes",
      "os_id=unknown; os_version=unknown; if [ -r /etc/os-release ]; then . /etc/os-release; os_id=${ID:-unknown}; os_version=${VERSION_ID:-unknown}; fi",
      "python_version=$(python3 --version 2>&1 || true)",
      "cuda=no; command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits >/dev/null 2>&1 && cuda=yes",
      "printf 'uid=%s\\nhome_writable=%s\\nos_id=%s\\nos_version=%s\\npython=%s\\ncuda_visible=%s\\n' \"$uid\" \"$writable\" \"$os_id\" \"$os_version\" \"$python_version\" \"$cuda\"",
    ].join("; ");
    const raw = await command("wsl.exe", ["-d", usableLinuxDistribution, "--exec", "sh", "-lc", script], 20_000);
    if (raw) {
      const values = new Map(raw.split(/\r?\n/).map((line) => { const split = line.indexOf("="); return split > 0 ? [line.slice(0, split), line.slice(split + 1)] : [line, ""]; }));
      runtimeProbe = {
        distribution: usableLinuxDistribution,
        nonRoot: values.get("uid") !== "0" && /^\d+$/.test(values.get("uid") ?? ""),
        homeWritable: values.get("home_writable") === "yes",
        osId: values.get("os_id") || undefined,
        osVersion: values.get("os_version") || undefined,
        python: values.get("python") || undefined,
        cudaVisible: values.get("cuda_visible") === "yes",
        measuredAt: new Date().toISOString(),
        elapsedMs: Date.now() - runtimeProbeStarted,
      };
    }
  }
  const gpus: Prompt3DGpuSnapshot[] = [];
  if (gpuRaw) {
    for (const line of gpuRaw.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
      const [index, uuid, model, driver, total, free, used, compute] = line.split(",").map((value) => value.trim());
      const numeric = [Number(index), Number(total), Number(free), Number(used)];
      if (!model || numeric.some((value) => !Number.isFinite(value))) continue;
      gpus.push({
        index: numeric[0],
        uuid,
        vendor: "NVIDIA",
        model,
        driver,
        totalVramBytes: numeric[1] * MiB,
        freeVramBytes: numeric[2] * MiB,
        usedVramBytes: numeric[3] * MiB,
        cudaComputeCapability: compute,
      });
    }
  }
  gpus.sort((left, right) => right.totalVramBytes - left.totalVramBytes || right.freeVramBytes - left.freeVramBytes || (left.index ?? 0) - (right.index ?? 0));
  const gpu: Prompt3DHardwareSnapshot["gpu"] = gpus[0] ?? null;
  const python: Prompt3DHardwareSnapshot["python"] = [];
  if (python310) python.push({ command: process.platform === "win32" ? "py -3.10" : "python3.10", version: python310 });
  if (python311) python.push({ command: process.platform === "win32" ? "py -3.11" : "python3.11", version: python311 });
  const cudaVersion = nvccRaw?.match(/release\s+([\d.]+)/i)?.[1];
  return {
    checkedAt: new Date().toISOString(),
    os: { platform: process.platform, release: os.release(), version: os.version(), windowsBuild: process.platform === "win32" ? os.release().split(".").pop() : undefined },
    gpu,
    gpus,
    systemRam: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
    disk: { path: root, totalBytes: fs.blocks * fs.bsize, freeBytes: fs.bavail * fs.bsize },
    python,
    cudaToolkit: { available: Boolean(nvccRaw), version: cudaVersion },
    conda: { available: Boolean(condaRaw), command: condaRaw ? "conda" : undefined, version: condaRaw ?? undefined },
    wsl: { available: Boolean(wslVersionRaw), version: wslVersionRaw?.split(/\r?\n/)[0], distributions, distributionVersions, requestedDistribution, usableLinuxDistribution, runtimeProbe },
  };
}

function profiledCompliance(
  manifest: Prompt3DProviderManifest,
  profiles: Prompt3DExecutionProfile[],
  hardware: Prompt3DHardwareSnapshot,
  root: string,
  phase: Prompt3DComplianceCheck["phase"],
  spec?: AssetSpecV1,
): Prompt3DComplianceCheck {
  const operation: "geometry" | "texture" | "motion" = manifest.role === "motion"
    ? "motion"
    : spec?.generateTextures === true ? "texture" : "geometry";
  const eligibleProfiles = profiles.filter((profile) => !profile.operations?.length || profile.operations.includes(operation));
  if (eligibleProfiles.length === 0) throw new Error(`${manifest.name} has no declared ${operation} execution profile.`);
  const installed = existsSync(join(root, manifest.id, "install-manifest.json"));
  const measuredGpus = hardware.gpus?.length ? hardware.gpus : hardware.gpu ? [hardware.gpu] : [];
  const runtimeCanExecute = (profile: Prompt3DExecutionProfile) => phase === "display"
    || profile.device === "cpu"
    || hardware.wsl.runtimeProbe?.cudaVisible === true;
  const gpuFor = (profile: Prompt3DExecutionProfile, requireHeadroom: boolean) => measuredGpus
    .filter((candidate) => versionAtLeast(candidate.driver, manifest.minimumWindowsNvidiaDriver)
      && candidate.totalVramBytes >= profile.minimumTotalVramBytes
      && (!requireHeadroom || candidate.freeVramBytes >= profile.minimumFreeVramBytes))
    .sort((left, right) => right.totalVramBytes - left.totalVramBytes || right.freeVramBytes - left.freeVramBytes)[0];
  const readyProfile = eligibleProfiles.find((profile) => hardware.systemRam.totalBytes >= profile.minimumSystemRamBytes
    && hardware.systemRam.freeBytes >= profile.minimumFreeSystemRamBytes
    && runtimeCanExecute(profile)
    && (profile.device === "cpu" || Boolean(gpuFor(profile, true))));
  const staticProfile = readyProfile ?? eligibleProfiles.find((profile) => hardware.systemRam.totalBytes >= profile.minimumSystemRamBytes
    && runtimeCanExecute(profile)
    && (profile.device === "cpu" || Boolean(gpuFor(profile, false))));
  const profileForRequirements = readyProfile ?? staticProfile ?? eligibleProfiles[0];
  const selectedGpu = readyProfile?.device === "cuda" ? gpuFor(readyProfile, true) : undefined;
  const executionProfile = readyProfile ? {
    ...readyProfile,
    ...(selectedGpu ? { gpu: {
      index: selectedGpu.index,
      uuid: selectedGpu.uuid,
      model: selectedGpu.model,
      totalVramBytes: selectedGpu.totalVramBytes,
      freeVramBytes: selectedGpu.freeVramBytes,
    } } : {}),
  } : undefined;
  const physicalHardwarePass = Boolean(staticProfile);
  const systemRamPass = eligibleProfiles.some((profile) => hardware.systemRam.totalBytes >= profile.minimumSystemRamBytes);
  const diskPass = hardware.disk.freeBytes >= manifest.requiredFreeDiskBytes || installed;
  const recoverablePlatform = hardware.os.platform === "win32";
  const selectedWslVersion = hardware.wsl.usableLinuxDistribution ? hardware.wsl.distributionVersions[hardware.wsl.usableLinuxDistribution] : undefined;
  const needsRuntimeProbe = phase !== "display";
  const runtimeProbe = hardware.wsl.runtimeProbe;
  const runtimeNeedsCuda = (readyProfile ?? staticProfile)?.device === "cuda";
  const runtimeProbePass = !needsRuntimeProbe || Boolean(runtimeProbe?.nonRoot
    && runtimeProbe.homeWritable
    && (!runtimeNeedsCuda || runtimeProbe.cudaVisible));
  const platformPass = recoverablePlatform && hardware.wsl.available && Boolean(hardware.wsl.usableLinuxDistribution)
    && selectedWslVersion === 2 && runtimeProbePass;
  const headroomPass = Boolean(readyProfile);
  const reasons: string[] = [];

  if (measuredGpus.length) {
    reasons.push(`Measured ${measuredGpus.length} NVIDIA adapter${measuredGpus.length === 1 ? "" : "s"}: ${measuredGpus.map((candidate) => `${candidate.model} ${(candidate.totalVramBytes / 1024 ** 3).toFixed(1)} GB total/${(candidate.freeVramBytes / 1024 ** 3).toFixed(1)} GB free`).join("; ")}.`);
  } else {
    reasons.push("No NVIDIA CUDA adapter was measured; provider-native CPU execution remains available when the CPU profile has sufficient RAM.");
  }
  reasons.push(`System RAM: ${(hardware.systemRam.totalBytes / 1024 ** 3).toFixed(1)} GB total, ${(hardware.systemRam.freeBytes / 1024 ** 3).toFixed(1)} GB free.`);
  if (executionProfile) {
    const target = executionProfile.device === "cuda" && executionProfile.gpu
      ? ` on ${executionProfile.gpu.model}${executionProfile.gpu.uuid ? ` (${executionProfile.gpu.uuid})` : ""}`
      : "";
    reasons.push(`Selected ${executionProfile.label}${target}. ${executionProfile.tradeoff}`);
  } else {
    reasons.push("No execution profile currently has enough free GPU or system memory. Installation may still proceed when total hardware capacity supports a profile.");
  }
  if (!physicalHardwarePass) reasons.push("No declared provider execution profile fits the measured total GPU and system-memory capacity.");
  if (!systemRamPass) reasons.push(`At least ${(Math.min(...eligibleProfiles.map((profile) => profile.minimumSystemRamBytes)) / 1024 ** 3).toFixed(0)} GB system RAM is required by the lightest declared ${operation} profile.`);
  if (!diskPass) reasons.push(`Destination has ${(hardware.disk.freeBytes / 1024 ** 3).toFixed(1)} GB free; setup requires ${(manifest.requiredFreeDiskBytes / 1024 ** 3).toFixed(0)} GB.`);
  if (hardware.os.platform === "win32" && !hardware.wsl.usableLinuxDistribution) {
    reasons.push(hardware.wsl.requestedDistribution
      ? `Configured WSL distribution ${hardware.wsl.requestedDistribution} is unavailable for ${manifest.name}; docker-desktop is not accepted as a provider runtime.`
      : `A normal WSL2 Linux distribution is not configured for ${manifest.name}; docker-desktop is not accepted as a provider runtime.`);
  }
  if (hardware.wsl.usableLinuxDistribution && selectedWslVersion !== 2) reasons.push(`Configured distribution ${hardware.wsl.usableLinuxDistribution} must use WSL 2; measured ${selectedWslVersion ? `WSL ${selectedWslVersion}` : "an unknown WSL version"}.`);
  if (needsRuntimeProbe && hardware.wsl.usableLinuxDistribution) {
    if (!runtimeProbe) reasons.push(`The configured ${hardware.wsl.usableLinuxDistribution} runtime could not be probed non-interactively.`);
    else {
      reasons.push(`WSL runtime: ${runtimeProbe.osId ?? "Linux"} ${runtimeProbe.osVersion ?? "unknown"}; ${runtimeProbe.python ?? "system Python not found"}; CUDA ${runtimeProbe.cudaVisible ? "visible" : "not visible"}.`);
      if (!runtimeProbe.nonRoot) reasons.push("The configured WSL distribution must finish one-time normal-user setup; root is not accepted.");
      if (!runtimeProbe.homeWritable) reasons.push("The configured normal WSL user home is not writable.");
      if (runtimeNeedsCuda && !runtimeProbe.cudaVisible) reasons.push("The selected GPU profile requires CUDA inside WSL; the CPU profile can be used when its RAM headroom is available.");
    }
  }
  if (!installed) reasons.push("Pinned source, isolated environment and model weights are not yet verified by a signed install manifest.");

  let state: Prompt3DComplianceCheck["state"];
  if (!physicalHardwarePass || !systemRamPass || !recoverablePlatform) state = "unsupported";
  else if (!installed || !platformPass) state = "setup-required";
  else if (!headroomPass) state = "busy";
  else state = readyProfile?.device === "cpu" || readyProfile?.qualityTier === "basic" ? "marginal" : "ready";
  const staticRuntimeNeedsCuda = staticProfile?.device === "cuda";
  const installRuntimeProbePass = !needsRuntimeProbe || Boolean(runtimeProbe?.nonRoot
    && runtimeProbe.homeWritable
    && (!staticRuntimeNeedsCuda || runtimeProbe.cudaVisible));
  return {
    providerId: manifest.id,
    state,
    measuredAt: hardware.checkedAt,
    phase,
    installed,
    modelInstalled: installed,
    physicalHardwarePass,
    platformPass,
    softwarePass: installed,
    diskPass,
    headroomPass,
    canInstall: physicalHardwarePass && systemRamPass && recoverablePlatform && diskPass
      && (!hardware.wsl.usableLinuxDistribution || (selectedWslVersion === 2 && installRuntimeProbePass)),
    canRun: installed && platformPass && headroomPass,
    reasons,
    required: {
      physicalVramBytes: profileForRequirements.minimumTotalVramBytes,
      runVramBytes: profileForRequirements.minimumFreeVramBytes,
      freeDiskBytes: manifest.requiredFreeDiskBytes,
      systemRamBytes: profileForRequirements.minimumSystemRamBytes,
    },
    measured: {
      physicalVramBytes: selectedGpu?.totalVramBytes ?? hardware.gpu?.totalVramBytes ?? 0,
      freeVramBytes: selectedGpu?.freeVramBytes ?? hardware.gpu?.freeVramBytes ?? 0,
      freeDiskBytes: hardware.disk.freeBytes,
      systemRamBytes: hardware.systemRam.totalBytes,
    },
    executionProfile,
  };
}

export function evaluatePrompt3DCompliance(
  manifest: Prompt3DProviderManifest,
  hardware: Prompt3DHardwareSnapshot,
  root: string,
  phase: Prompt3DComplianceCheck["phase"],
  spec?: AssetSpecV1,
): Prompt3DComplianceCheck {
  const installedManifest = join(root, manifest.id, "install-manifest.json");
  const installed = existsSync(installedManifest);
  if (manifest.kind === "cloud") {
    return {
      providerId: manifest.id, state: "cloud-only", measuredAt: hardware.checkedAt, phase,
      installed: false, modelInstalled: false, physicalHardwarePass: true, platformPass: true, softwarePass: true,
      diskPass: hardware.disk.freeBytes >= manifest.requiredFreeDiskBytes, headroomPass: true,
      canInstall: false, canRun: false, reasons: ["Cloud provider is disabled until credentials are explicitly configured and a per-run data/cost confirmation is accepted."],
      required: { physicalVramBytes: 0, runVramBytes: 0, freeDiskBytes: manifest.requiredFreeDiskBytes, systemRamBytes: 0 },
      measured: { physicalVramBytes: hardware.gpu?.totalVramBytes ?? 0, freeVramBytes: hardware.gpu?.freeVramBytes ?? 0, freeDiskBytes: hardware.disk.freeBytes, systemRamBytes: hardware.systemRam.totalBytes },
    };
  }
  if (manifest.executionProfiles?.length) return profiledCompliance(manifest, manifest.executionProfiles, hardware, root, phase, spec);
  const gpu = hardware.gpu;
  const physicalHardwarePass = Boolean(gpu && gpu.vendor === "NVIDIA" && gpu.totalVramBytes >= manifest.physicalVramBytes);
  const driverPass = versionAtLeast(gpu?.driver, manifest.minimumWindowsNvidiaDriver);
  const diskPass = hardware.disk.freeBytes >= manifest.requiredFreeDiskBytes || installed;
  const systemRamPass = hardware.systemRam.totalBytes >= manifest.systemRamBytes;
  const recoverablePlatform = hardware.os.platform === "win32";
  const needsRuntimeProbe = phase !== "display";
  const runtimeProbe = hardware.wsl.runtimeProbe;
  const selectedWslVersion = hardware.wsl.usableLinuxDistribution ? hardware.wsl.distributionVersions[hardware.wsl.usableLinuxDistribution] : undefined;
  const runtimeProbePass = !needsRuntimeProbe || Boolean(runtimeProbe?.nonRoot && runtimeProbe.homeWritable && runtimeProbe.cudaVisible);
  const platformPass = recoverablePlatform && driverPass && hardware.wsl.available && Boolean(hardware.wsl.usableLinuxDistribution) && selectedWslVersion === 2 && runtimeProbePass;
  const softwarePass = installed;
  const wantsTexture = spec?.generateTextures ?? true;
  const requiredRunVram = wantsTexture ? manifest.runVramBytes.textured : manifest.runVramBytes.geometry;
  const headroomPass = Boolean(gpu && gpu.freeVramBytes >= requiredRunVram);
  const reasons: string[] = [];
  if (!gpu) reasons.push("No NVIDIA GPU was measured by nvidia-smi.");
  else {
    reasons.push(`Measured ${gpu.model}: ${(gpu.totalVramBytes / 1024 ** 3).toFixed(1)} GB total VRAM, ${(gpu.freeVramBytes / 1024 ** 3).toFixed(1)} GB currently free.`);
    if (!physicalHardwarePass) reasons.push(`Physical minimum is ${(manifest.physicalVramBytes / 1024 ** 3).toFixed(0)} GB NVIDIA VRAM.`);
    if (!driverPass) reasons.push(`CUDA runtime requires NVIDIA Windows driver ${manifest.minimumWindowsNvidiaDriver} or newer; measured ${gpu.driver ?? "unknown"}.`);
  }
  if (!systemRamPass) reasons.push(`System RAM is below the pinned ${(manifest.systemRamBytes / 1024 ** 3).toFixed(0)} GB requirement.`);
  if (!diskPass) reasons.push(`Destination has ${(hardware.disk.freeBytes / 1024 ** 3).toFixed(1)} GB free; setup requires ${(manifest.requiredFreeDiskBytes / 1024 ** 3).toFixed(0)} GB.`);
  if (hardware.os.platform === "win32" && !hardware.wsl.usableLinuxDistribution) {
    reasons.push(hardware.wsl.requestedDistribution
      ? `Configured WSL distribution ${hardware.wsl.requestedDistribution} is unavailable for ${manifest.name}; docker-desktop is not accepted as a provider runtime.`
      : `A normal WSL2 Linux distribution is not configured for ${manifest.name}; docker-desktop is not accepted as a provider runtime.`);
  }
  if (hardware.wsl.usableLinuxDistribution && selectedWslVersion !== 2) reasons.push(`Configured distribution ${hardware.wsl.usableLinuxDistribution} must use WSL 2; measured ${selectedWslVersion ? `WSL ${selectedWslVersion}` : "an unknown WSL version"}.`);
  if (needsRuntimeProbe && hardware.wsl.usableLinuxDistribution) {
    if (!runtimeProbe) reasons.push(`The configured ${hardware.wsl.usableLinuxDistribution} runtime could not be probed non-interactively.`);
    else {
      reasons.push(`WSL runtime: ${runtimeProbe.osId ?? "Linux"} ${runtimeProbe.osVersion ?? "unknown"}; ${runtimeProbe.python ?? "system Python not found"}; CUDA ${runtimeProbe.cudaVisible ? "visible" : "not visible"}.`);
      if (!runtimeProbe.nonRoot) reasons.push("The configured WSL distribution must finish one-time normal-user setup; root is not accepted.");
      if (!runtimeProbe.homeWritable) reasons.push("The configured normal WSL user home is not writable.");
      if (!runtimeProbe.cudaVisible) reasons.push("CUDA is not visible inside the configured WSL distribution; setup cannot download/run a backend until this is corrected.");
    }
  }
  if (!installed) reasons.push("Pinned source, isolated environment and model weights are not yet verified by a signed install manifest.");
  if (installed && !headroomPass) reasons.push(`Generation needs ${(requiredRunVram / 1024 ** 3).toFixed(0)} GB free VRAM for this request; current headroom is temporary, not a physical-hardware failure.`);

  let state: Prompt3DComplianceCheck["state"];
  if (!physicalHardwarePass || !systemRamPass || !recoverablePlatform) state = "unsupported";
  else if (!installed || !platformPass) state = "setup-required";
  else if (!headroomPass) state = "busy";
  else state = "ready";

  let reducedMemoryMode: Prompt3DComplianceCheck["reducedMemoryMode"];
  if (manifest.safeReducedMemoryMode && !wantsTexture && installed && gpu && !headroomPass && gpu.freeVramBytes >= (manifest.runVramBytes.reducedGeometry ?? Infinity)) {
    state = "marginal";
    reducedMemoryMode = { allowed: true, ...manifest.safeReducedMemoryMode };
  }
  return {
    providerId: manifest.id, state, measuredAt: hardware.checkedAt, phase, installed, modelInstalled: installed,
    physicalHardwarePass, platformPass, softwarePass, diskPass, headroomPass,
    canInstall: physicalHardwarePass && driverPass && systemRamPass && recoverablePlatform && diskPass && (!hardware.wsl.usableLinuxDistribution || (selectedWslVersion === 2 && runtimeProbePass)),
    canRun: state === "ready" || state === "marginal", reasons,
    required: { physicalVramBytes: manifest.physicalVramBytes, runVramBytes: requiredRunVram, freeDiskBytes: manifest.requiredFreeDiskBytes, systemRamBytes: manifest.systemRamBytes },
    measured: { physicalVramBytes: gpu?.totalVramBytes ?? 0, freeVramBytes: gpu?.freeVramBytes ?? 0, freeDiskBytes: hardware.disk.freeBytes, systemRamBytes: hardware.systemRam.totalBytes },
    reducedMemoryMode,
  };
}
