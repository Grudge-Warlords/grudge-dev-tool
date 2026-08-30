import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { statfs } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import type {
  AssetSpecV1,
  Prompt3DComplianceCheck,
  Prompt3DHardwareSnapshot,
  Prompt3DProviderManifest,
} from "../../shared/prompt3d";

const exec = promisify(execFile);
const MiB = 1024 ** 2;

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
    command("nvidia-smi", ["--query-gpu=name,driver_version,memory.total,memory.free,memory.used,compute_cap", "--format=csv,noheader,nounits"]),
    command("nvcc", ["--version"]),
    command("conda", ["--version"]),
    process.platform === "win32" ? command("wsl.exe", ["--version"]) : Promise.resolve(null),
    process.platform === "win32" ? command("wsl.exe", ["--list", "--quiet"]) : Promise.resolve(null),
    process.platform === "win32" ? command("wsl.exe", ["--list", "--verbose"]) : Promise.resolve(null),
    process.platform === "win32" ? command("py", ["-3.10", "--version"]) : command("python3.10", ["--version"]),
    process.platform === "win32" ? command("py", ["-3.11", "--version"]) : command("python3.11", ["--version"]),
  ]);
  const fs = await statfs(root).catch(async () => {
    const parent = root.match(/^[A-Za-z]:[\\/]/) ? root.slice(0, 3) : os.tmpdir();
    return statfs(parent);
  });
  const distributions = parseWslList(wslListRaw);
  const distributionVersions = parseWslDistributionVersions(wslVerboseRaw);
  const requestedDistribution = process.env.GRUDGE_PROMPT3D_WSL_DISTRO?.trim();
  const usableLinuxDistribution = requestedDistribution
    ? distributions.find((d) => d.toLowerCase() === requestedDistribution.toLowerCase() && !/^docker-desktop(?:-data)?$/i.test(d)) ?? null
    : distributions.find((d) => !/^docker-desktop(?:-data)?$/i.test(d)) ?? null;
  let runtimeProbe: Prompt3DHardwareSnapshot["wsl"]["runtimeProbe"];
  if (probeLinuxRuntime && usableLinuxDistribution) {
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
      };
    }
  }
  let gpu: Prompt3DHardwareSnapshot["gpu"] = null;
  if (gpuRaw) {
    const [model, driver, total, free, used, compute] = gpuRaw.split(",").map((v) => v.trim());
    gpu = {
      vendor: "NVIDIA",
      model,
      driver,
      totalVramBytes: Number(total) * MiB,
      freeVramBytes: Number(free) * MiB,
      usedVramBytes: Number(used) * MiB,
      cudaComputeCapability: compute,
    };
  }
  const python: Prompt3DHardwareSnapshot["python"] = [];
  if (python310) python.push({ command: process.platform === "win32" ? "py -3.10" : "python3.10", version: python310 });
  if (python311) python.push({ command: process.platform === "win32" ? "py -3.11" : "python3.11", version: python311 });
  const cudaVersion = nvccRaw?.match(/release\s+([\d.]+)/i)?.[1];
  return {
    checkedAt: new Date().toISOString(),
    os: { platform: process.platform, release: os.release(), version: os.version(), windowsBuild: process.platform === "win32" ? os.release().split(".").pop() : undefined },
    gpu,
    systemRam: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
    disk: { path: root, totalBytes: fs.blocks * fs.bsize, freeBytes: fs.bavail * fs.bsize },
    python,
    cudaToolkit: { available: Boolean(nvccRaw), version: cudaVersion },
    conda: { available: Boolean(condaRaw), command: condaRaw ? "conda" : undefined, version: condaRaw ?? undefined },
    wsl: { available: Boolean(wslVersionRaw), version: wslVersionRaw?.split(/\r?\n/)[0], distributions, distributionVersions, requestedDistribution, usableLinuxDistribution, runtimeProbe },
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
