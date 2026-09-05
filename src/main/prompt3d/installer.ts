import { spawn, type ChildProcess } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync, sign, verify as verifySignature } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync } from "node:fs";
import { appendFile, lstat, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { unzipSync } from "fflate";
import type { LocalPrompt3DProviderId, Prompt3DInstallStatus } from "../../shared/prompt3d";
import { localProvider } from "./providers";
import { measurePrompt3DHardware, evaluatePrompt3DCompliance } from "./hardware";
import { sha256InstalledModelFile } from "./providerDigestCache";

const UV_VERSION = "0.12.7";
const UV_URL = `https://releases.astral.sh/github/uv/releases/download/${UV_VERSION}/uv-x86_64-pc-windows-msvc.zip`;
const UV_SHA256 = "bf1518af459a3915511a11fdc6e2f43ef9a2afa138b9d498eeb9642fe9d85218";
const PYTHON_VERSION = "3.10.16";
const MINIFORGE_VERSION = "26.5.3-0";
const MINIFORGE_URL = `https://github.com/conda-forge/miniforge/releases/download/${MINIFORGE_VERSION}/Miniforge3-${MINIFORGE_VERSION}-Linux-x86_64.sh`;
const MINIFORGE_SHA256 = "14db468222ad564658656f769506056209b6dc375f5e7dfd31eb5ebbf08fa529";
const REAL_ESRGAN_URL = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth";
const REAL_ESRGAN_SHA256 = "4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1";
const MAX_LOG_LINE = 2_000;
const SAFE_CHILD_ENV = new Set([
  "APPDATA", "COMSPEC", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "NUMBER_OF_PROCESSORS", "OS",
  "PATH", "PATHEXT", "PROCESSOR_ARCHITECTURE", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
  "PROGRAMW6432", "PUBLIC", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "WINDIR",
]);
const HUNYUAN_UNPINNED_REQUIREMENTS: Record<string, string> = {
  timm: "timm==1.0.29",
  pythreejs: "pythreejs==2.4.2",
  torchdiffeq: "torchdiffeq==0.2.5",
};
const TRELLIS_XFORMERS = "0.0.27.post2";
const TRELLIS_SPCONV = "2.3.6";
const TRELLIS_KAOLIN = "0.17.0";
const TRELLIS_KAOLIN_INDEX = "https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.4.0_cu121.html";

export interface Prompt3DInstallerOptions {
  root: string;
  appRoot: string;
  integrityKeyDirectory: string;
  onUpdate?: (status: Prompt3DInstallStatus) => void;
  onLog?: (provider: LocalPrompt3DProviderId, line: string) => void;
}

function contained(root: string, target: string): string {
  const absoluteRoot = resolve(root);
  const absolute = resolve(target);
  const rel = relative(absoluteRoot, absolute);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) return absolute;
  throw new Error(`Path escapes Prompt-to-3D root: ${target}`);
}

function toWslPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const match = normalized.match(/^([A-Za-z]):(\/.*)$/);
  if (!match) throw new Error(`Prompt-to-3D WSL paths must be on a mounted Windows drive: ${path}`);
  return `/mnt/${match[1].toLowerCase()}${match[2]}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function childEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (SAFE_CHILD_ENV.has(key.toUpperCase()) && value !== undefined) safe[key] = value;
  return { ...safe, ...extra };
}

async function sha256(path: string): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

interface SnapshotFileEntry { path: string; bytes: number; sha256: string }
interface SnapshotMetadata {
  repo: string;
  revision: string;
  fileCount: number;
  installedBytes: number;
  treeSha256: string;
  files: SnapshotFileEntry[];
}

async function snapshotPayloadPaths(root: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const pending = [root];
  const files: string[] = [];
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = join(current, entry.name);
      const relativePath = relative(root, child).split(sep).join("/");
      if (relativePath === ".grudge-snapshot.json" || relativePath === ".cache" || relativePath.startsWith(".cache/")) continue;
      if (entry.isSymbolicLink()) throw new Error(`Model snapshot contains a forbidden link: ${relativePath}`);
      if (entry.isDirectory()) pending.push(child);
      else if (entry.isFile()) files.push(relativePath);
    }
  }
  return files.sort();
}

async function gitOutput(path: string, args: string[], failure: string): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn("git", args, { cwd: path, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout?.on("data", (buffer) => output += String(buffer));
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolvePromise(output.trim()) : reject(new Error(failure)));
  });
}

async function commandOutput(file: string, args: string[], cwd: string, failure: string): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn(file, args, { cwd, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout?.on("data", (buffer) => {
      output += String(buffer);
      if (output.length > 8 * 1024 * 1024) { child.kill(); reject(new Error(`${failure} Output exceeded the bounded limit.`)); }
    });
    child.on("error", () => reject(new Error(failure)));
    child.on("exit", (code) => code === 0 ? resolvePromise(output.trim()) : reject(new Error(failure)));
  });
}

const gitRevision = (path: string) => gitOutput(path, ["rev-parse", "HEAD"], "Could not read installed source revision.");

function normalizeGitRemote(value: string): string {
  return value.trim().replace(/\.git\/?$/i, "").replace(/\/$/, "").toLowerCase();
}

async function directoryBytes(path: string, maxFiles = 200_000): Promise<number> {
  const { readdir } = await import("node:fs/promises");
  let files = 0;
  let bytes = 0;
  const pending = [path];
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
      const child = join(current, entry.name);
      if (entry.isDirectory()) pending.push(child);
      else if (entry.isFile()) {
        files += 1;
        if (files > maxFiles) throw new Error("Installed tree exceeds the 200,000-file safety limit");
        bytes += (await stat(child)).size;
      }
    }
  }
  return bytes;
}

export class Prompt3DInstaller {
  private readonly statuses = new Map<LocalPrompt3DProviderId, Prompt3DInstallStatus>();
  private readonly children = new Map<LocalPrompt3DProviderId, ChildProcess>();
  private readonly wslGroups = new Map<LocalPrompt3DProviderId, { distro: string; pidFile: string }>();
  private readonly downloads = new Map<LocalPrompt3DProviderId, AbortController>();
  private readonly cancelled = new Set<LocalPrompt3DProviderId>();
  private readonly runs = new Map<LocalPrompt3DProviderId, Promise<Prompt3DInstallStatus>>();
  private readonly suppressEnvironmentDiagnostics = new Set<LocalPrompt3DProviderId>();
  private commonRuntime: Promise<string> | null = null;

  constructor(private readonly options: Prompt3DInstallerOptions) {}

  getStatus(providerId: LocalPrompt3DProviderId): Prompt3DInstallStatus {
    const previous = this.statuses.get(providerId);
    if (previous) return previous;
    const provider = localProvider(providerId);
    const destination = contained(this.options.root, join(this.options.root, providerId));
    const statusPath = join(destination, "install-status.json");
    if (existsSync(statusPath)) {
      try {
        const persisted = JSON.parse(readFileSync(statusPath, "utf8")) as Prompt3DInstallStatus;
        const manifestExists = existsSync(join(destination, "install-manifest.json"));
        const persistedState = persisted.state === "installing"
          ? "repair-needed"
          : persisted.state === "installed" && !manifestExists
            ? "repair-needed"
            : manifestExists && ["not-installed", "cancelled", "failed"].includes(persisted.state)
              ? "installed"
              : persisted.state;
        return {
          ...persisted,
          providerId,
          state: persistedState,
          stage: persistedState === "installed" ? "detected" : persistedState === "repair-needed" ? "verification required" : persisted.stage,
          progress: persistedState === "installed" ? 100 : persisted.progress,
          destination,
          sourceRevision: provider.sourceRevision,
          modelRevisions: provider.modelSources.map((model) => model.revision),
          bytesTotal: provider.downloadBytes,
        };
      } catch { /* rebuild a safe status below */ }
    }
    return {
      providerId,
      state: existsSync(join(destination, "install-manifest.json")) ? "installed" : "not-installed",
      stage: "idle",
      progress: existsSync(join(destination, "install-manifest.json")) ? 100 : 0,
      destination,
      sourceRevision: provider.sourceRevision,
      modelRevisions: provider.modelSources.map((m) => m.revision),
      bytesCompleted: 0,
      bytesTotal: provider.downloadBytes,
      resumable: true,
      updatedAt: new Date().toISOString(),
    };
  }

  start(providerId: LocalPrompt3DProviderId, action: "install" | "repair" = "install"): Prompt3DInstallStatus {
    if (this.runs.has(providerId)) return this.getStatus(providerId);
    this.cancelled.delete(providerId);
    const run = this.install(providerId, action).finally(() => this.runs.delete(providerId));
    this.runs.set(providerId, run);
    void run.catch(() => undefined);
    return this.getStatus(providerId);
  }

  wait(providerId: LocalPrompt3DProviderId): Promise<Prompt3DInstallStatus> {
    return this.runs.get(providerId) ?? Promise.resolve(this.getStatus(providerId));
  }

  async verify(providerId: LocalPrompt3DProviderId, deep = false): Promise<{ ok: boolean; reason: string }> {
    const provider = localProvider(providerId);
    const providerRoot = contained(this.options.root, join(this.options.root, providerId));
    const manifestPath = join(providerRoot, "install-manifest.json");
    const publicPath = join(this.options.root, "prompt3d-ed25519-public.pem");
    try {
      const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
      const { sha256: declaredHash, signature, ...payload } = parsed;
      const canonical = JSON.stringify(payload);
      const hash = createHash("sha256").update(canonical).digest("hex");
      if (hash !== declaredHash) return { ok: false, reason: "Install manifest hash does not match its signed payload." };
      if (!verifySignature(null, Buffer.from(canonical), await readFile(publicPath, "utf8"), Buffer.from(signature, "base64"))) return { ok: false, reason: "Install manifest Ed25519 signature is invalid." };
      if (payload.providerId !== providerId || payload.sourceRevision !== provider.sourceRevision) return { ok: false, reason: "Installed source revision does not match the pinned provider contract." };
      const sourceRoot = join(providerRoot, "source");
      if (await gitRevision(sourceRoot) !== provider.sourceRevision) return { ok: false, reason: "Installed provider source checkout does not match its signed revision." };
      if (normalizeGitRemote(await gitOutput(sourceRoot, ["remote", "get-url", "origin"], "Could not verify installed provider source origin.")) !== normalizeGitRemote(provider.sourceUrl)) return { ok: false, reason: "Installed provider source origin is not the pinned official source." };
      if (await gitOutput(sourceRoot, ["status", "--porcelain=v1", "--untracked-files=all"], "Could not verify installed provider source worktree.")) return { ok: false, reason: "Installed provider source has local changes and cannot run until deliberately repaired." };
      const signedModels = new Map((payload.models ?? []).map((model: { id: string }) => [model.id, model]));
      for (const model of provider.modelSources) {
        const modelRoot = join(providerRoot, "models", model.id.replace(/[\\/]/g, "--"));
        const signedModel = signedModels.get(model.id) as (typeof model & { snapshotMetadataSha256?: string; treeSha256?: string; fileCount?: number; installedBytes?: number }) | undefined;
        if (!signedModel || signedModel.revision !== model.revision) return { ok: false, reason: `Pinned model ${model.id} is absent from the signed manifest.` };
        const metadataPath = join(modelRoot, ".grudge-snapshot.json");
        const metadataRaw = await readFile(metadataPath, "utf8");
        if (createHash("sha256").update(metadataRaw).digest("hex") !== signedModel.snapshotMetadataSha256) return { ok: false, reason: `Installed ${model.id} snapshot metadata is not the signed copy.` };
        const metadata = JSON.parse(metadataRaw) as SnapshotMetadata;
        if (metadata.repo !== model.id || metadata.revision !== model.revision || !Number.isSafeInteger(metadata.fileCount) || metadata.fileCount < 1 || metadata.fileCount !== metadata.files?.length || metadata.treeSha256 !== signedModel.treeSha256 || metadata.fileCount !== signedModel.fileCount || metadata.installedBytes !== signedModel.installedBytes) return { ok: false, reason: `Installed ${model.id} snapshot metadata does not match its pinned contract.` };
        if (metadata.installedBytes < model.estimatedDownloadBytes * 0.7) return { ok: false, reason: `Installed ${model.id} snapshot is materially smaller than its pinned estimate.` };
        const actualPaths = await snapshotPayloadPaths(modelRoot);
        const declaredPaths = metadata.files.map((entry) => entry.path).sort();
        if (actualPaths.length !== declaredPaths.length || actualPaths.some((path, index) => path !== declaredPaths[index])) return { ok: false, reason: `Installed ${model.id} snapshot file set differs from its signed inventory.` };
        let measuredBytes = 0n;
        const tree = createHash("sha256");
        for (const entry of metadata.files) {
          if (!entry || typeof entry.path !== "string" || !Number.isSafeInteger(entry.bytes) || !/^[a-f0-9]{64}$/.test(entry.sha256)) return { ok: false, reason: `Installed ${model.id} snapshot file inventory is invalid.` };
          const path = contained(modelRoot, join(modelRoot, entry.path));
          const info = await lstat(path, { bigint: true });
          if (!info.isFile() || info.isSymbolicLink() || info.size !== BigInt(entry.bytes)) return { ok: false, reason: `Installed ${model.id} file ${entry.path} differs from its signed size.` };
          measuredBytes += info.size;
          const digest = deep ? await sha256InstalledModelFile(path, info, entry.sha256) : entry.sha256;
          if (deep && digest !== entry.sha256) return { ok: false, reason: `Installed ${model.id} file ${entry.path} failed SHA-256 verification.` };
          tree.update(`${entry.path}\0${entry.bytes}\0${digest}\n`);
        }
        if (measuredBytes !== BigInt(metadata.installedBytes) || tree.digest("hex") !== metadata.treeSha256) return { ok: false, reason: `Installed ${model.id} snapshot tree hash is invalid.` };
      }
      const dependencyRevisions = new Set((payload.sourceDependencies ?? []).map((d: { revision: string }) => d.revision));
      if (provider.sourceDependencies.some((dependency) => !dependencyRevisions.has(dependency.revision))) return { ok: false, reason: "One or more pinned source dependency revisions are absent from the signed manifest." };
      for (const dependency of provider.sourceDependencies) {
        const dependencyRoot = join(providerRoot, "dependencies", dependency.id);
        if (await gitRevision(dependencyRoot) !== dependency.revision) return { ok: false, reason: `Installed ${dependency.id} checkout does not match its signed revision.` };
        if (normalizeGitRemote(await gitOutput(dependencyRoot, ["remote", "get-url", "origin"], `Could not verify ${dependency.id} origin.`)) !== normalizeGitRemote(dependency.sourceUrl)) return { ok: false, reason: `Installed ${dependency.id} origin is not the pinned official source.` };
        if (await gitOutput(dependencyRoot, ["status", "--porcelain=v1", "--untracked-files=all"], `Could not verify ${dependency.id} worktree.`)) return { ok: false, reason: `Installed ${dependency.id} source has local changes.` };
      }
      const runtimeLocks = payload.runtimeLocks ?? {};
      const runtimeFreezePath = join(providerRoot, "runtime-freeze.txt"), runtimeCondaPath = join(providerRoot, "runtime-conda-explicit.txt"), runtimeNativePath = join(providerRoot, "runtime-native-artifacts.json");
      if (runtimeLocks.pipFreezeSha256 !== await sha256(runtimeFreezePath) || runtimeLocks.condaExplicitSha256 !== await sha256(runtimeCondaPath) || runtimeLocks.nativeArtifactsSha256 !== await sha256(runtimeNativePath)) return { ok: false, reason: "Isolated runtime lock evidence does not match the signed manifest." };
      const nativeInventory = JSON.parse(await readFile(runtimeNativePath, "utf8")) as { version?: number; artifacts?: Array<{ id?: string; path?: string; bytes?: number; sha256?: string }> };
      const nativeArtifacts = nativeInventory.artifacts ?? [];
      const expectedNativeArtifacts = provider.nativeArtifacts ?? [];
      if (nativeInventory.version !== 1 || nativeArtifacts.length !== expectedNativeArtifacts.length || nativeArtifacts.length < 1) return { ok: false, reason: "Isolated native runtime inventory is invalid." };
      for (const expected of expectedNativeArtifacts) {
        const artifact = nativeArtifacts.find((entry) => entry.id === expected.id);
        if (!artifact || !(new RegExp(expected.pathPattern)).test(String(artifact.path ?? "")) || !Number.isSafeInteger(artifact.bytes) || Number(artifact.bytes) < 1 || !/^[a-f0-9]{64}$/.test(String(artifact.sha256 ?? ""))) {
          return { ok: false, reason: `Isolated native runtime artifact ${expected.id} is invalid.` };
        }
      }
      const nativeArtifact = nativeArtifacts[0];
      if (deep) {
        const hardware = await measurePrompt3DHardware(this.options.root);
        const distro = hardware.wsl.usableLinuxDistribution;
        if (!distro) return { ok: false, reason: "Configured normal-user WSL runtime is unavailable for deep package verification." };
        const rootName = `${providerId}-${provider.sourceRevision.slice(0, 12)}`;
        const script = `set -e; BASE="$HOME/.local/share/grudge-prompt3d/${rootName}"; NATIVE="$BASE/${nativeArtifact.path}"; test -f "$NATIVE"; test "$(stat -c %s "$NATIVE")" = "${nativeArtifact.bytes}"; echo '${nativeArtifact.sha256}  '$NATIVE | sha256sum -c - >/dev/null; source "$BASE/miniforge/etc/profile.d/conda.sh"; conda activate "$BASE/environment"; python -m pip freeze | LC_ALL=C sort; printf '\\n--CONDA-EXPLICIT--\\n'; conda list -p "$BASE/environment" --explicit; printf '\\n--SOURCE-REVISION--\\n'; git -C "$BASE/source" rev-parse HEAD; printf '\\n--SOURCE-DIRTY--\\n'; git -C "$BASE/source" status --porcelain=v1 --untracked-files=all; printf '\\n--SOURCE-ORIGIN--\\n'; git -C "$BASE/source" remote get-url origin`;
        const verificationScript = contained(providerRoot, join(providerRoot, ".deep-verify.sh"));
        await writeFile(verificationScript, `#!/usr/bin/env bash\n${script}\n`, "utf8");
        let current: string;
        try {
          current = await commandOutput("wsl.exe", ["-d", distro, "--exec", "bash", toWslPath(verificationScript)], providerRoot, "Could not re-measure the isolated provider package environment.");
        } finally {
          await rm(verificationScript, { force: true });
        }
        const condaMarker = "\n--CONDA-EXPLICIT--\n", revisionMarker = "\n--SOURCE-REVISION--\n", dirtyMarker = "\n--SOURCE-DIRTY--\n", originMarker = "\n--SOURCE-ORIGIN--\n";
        const condaSplit = current.indexOf(condaMarker), revisionSplit = current.indexOf(revisionMarker), dirtySplit = current.indexOf(dirtyMarker), originSplit = current.indexOf(originMarker);
        if (condaSplit < 0 || revisionSplit < condaSplit || dirtySplit < revisionSplit || originSplit < dirtySplit) return { ok: false, reason: "Isolated runtime package verification returned an invalid result." };
        const currentPip = current.slice(0, condaSplit).trim(), currentConda = current.slice(condaSplit + condaMarker.length, revisionSplit).trim();
        const runtimeRevision = current.slice(revisionSplit + revisionMarker.length, dirtySplit).trim();
        const runtimeDirty = current.slice(dirtySplit + dirtyMarker.length, originSplit).trim();
        const runtimeOrigin = current.slice(originSplit + originMarker.length).trim();
        const signedPip = (await readFile(runtimeFreezePath, "utf8")).trim(), signedConda = (await readFile(runtimeCondaPath, "utf8")).trim();
        if (currentPip !== signedPip || currentConda !== signedConda) return { ok: false, reason: "Installed runtime packages differ from the signed environment lock." };
        if (runtimeRevision !== provider.sourceRevision || runtimeDirty || normalizeGitRemote(runtimeOrigin) !== normalizeGitRemote(provider.sourceUrl)) return { ok: false, reason: "Runtime provider source differs from the signed official checkout." };
      }
      return { ok: true, reason: deep ? "Signed install manifest and every model file SHA-256 verified." : "Signed install manifest, source, model inventory and dependency revisions verified." };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  cancel(providerId: LocalPrompt3DProviderId): Prompt3DInstallStatus {
    this.cancelled.add(providerId);
    this.downloads.get(providerId)?.abort();
    void this.terminateActiveRun(providerId);
    return this.update(providerId, { state: "cancelled", stage: "cancelled", message: "Cancellation requested for the task-owned installer process group; downloaded checkpoints remain resumable." });
  }

  async remove(providerId: LocalPrompt3DProviderId): Promise<Prompt3DInstallStatus> {
    if (this.runs.has(providerId)) throw new Error("Cancel the active installation before removing it.");
    const hardware = await measurePrompt3DHardware(this.options.root);
    if (process.platform === "win32" && hardware.wsl.usableLinuxDistribution) {
      const rootName = `${providerId}-${localProvider(providerId).sourceRevision.slice(0, 12)}`;
      const cleanup = `set -e; BASE=\"$HOME/.local/share/grudge-prompt3d/${rootName}\"; TRASH=\"$HOME/.local/share/grudge-prompt3d/.removed/${rootName}-$(date +%s)\"; if [ -e \"$BASE\" ]; then mkdir -p \"$(dirname \"$TRASH\")\"; mv \"$BASE\" \"$TRASH\"; fi`;
      await this.run(providerId, "wsl.exe", ["-d", hardware.wsl.usableLinuxDistribution, "--", "bash", "-lc", cleanup], this.options.root);
    }
    const destination = contained(this.options.root, join(this.options.root, providerId));
    if (existsSync(destination)) {
      const trash = contained(this.options.root, join(this.options.root, ".removed", `${providerId}-${Date.now()}`));
      await mkdir(dirname(trash), { recursive: true });
      await rename(destination, trash);
    }
    const status = this.update(providerId, { state: "not-installed", stage: "removed", progress: 0, bytesCompleted: 0, message: "Moved to the recoverable .removed folder." });
    return status;
  }

  private update(providerId: LocalPrompt3DProviderId, patch: Partial<Prompt3DInstallStatus>): Prompt3DInstallStatus {
    const status = { ...this.getStatus(providerId), ...patch, updatedAt: new Date().toISOString() };
    this.statuses.set(providerId, status);
    const statusPath = contained(this.options.root, join(status.destination, "install-status.json"));
    void mkdir(dirname(statusPath), { recursive: true }).then(() => writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`)).catch(() => undefined);
    this.options.onUpdate?.(status);
    return status;
  }

  private log(provider: LocalPrompt3DProviderId, line: string) {
    const diagnostic = line.trim().toLowerCase();
    if (diagnostic === "environment variables:") {
      this.suppressEnvironmentDiagnostics.add(provider);
      line = "Conda environment diagnostic block redacted.";
    } else if (this.suppressEnvironmentDiagnostics.has(provider)) {
      if (!diagnostic.startsWith("an unexpected error has occurred")) return;
      this.suppressEnvironmentDiagnostics.delete(provider);
    }
    const safe = line
      .replace(/(token|authorization|api[_-]?key)\s*[=:]\s*\S+/gi, "$1=[redacted]")
      .replace(/(user session for )'[^']+'/gi, "$1'[redacted-user]'")
      .replace(/\/home\/[^/\s]+/gi, "/home/[redacted-user]")
      .replace(/\/mnt\/[a-z]\/Users\/[^/\s]+/gi, "/mnt/[drive]/Users/[redacted-user]")
      .replace(/C:\\Users\\[^\\\s]+/gi, "C:\\Users\\[redacted-user]")
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
      .replace(/[\u0008\r]/g, "")
      .slice(0, MAX_LOG_LINE);
    if (safe.trim()) {
      const trimmed = safe.trim();
      this.options.onLog?.(provider, trimmed);
      const logPath = contained(this.options.root, join(this.options.root, provider, "install.log"));
      void mkdir(dirname(logPath), { recursive: true }).then(() => appendFile(logPath, `${new Date().toISOString()} ${trimmed}\n`)).catch(() => undefined);
    }
  }

  private assertNotCancelled(provider: LocalPrompt3DProviderId) {
    if (this.cancelled.has(provider)) throw new Error("Installation cancelled by user.");
  }

  private async terminateActiveRun(provider: LocalPrompt3DProviderId): Promise<void> {
    const group = this.wslGroups.get(provider);
    if (group) {
      let pid = "";
      for (let attempt = 0; attempt < 20 && !pid; attempt += 1) {
        pid = await readFile(group.pidFile, "ascii").then((value) => value.trim()).catch(() => "");
        if (!pid) await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      }
      if (/^[1-9][0-9]{0,9}$/.test(pid)) {
        await new Promise<void>((resolvePromise) => {
          const killer = spawn("wsl.exe", ["-d", group.distro, "--exec", "/bin/kill", "-TERM", "--", `-${pid}`], {
            windowsHide: true, shell: false, stdio: "ignore",
          });
          const timer = setTimeout(() => { killer.kill(); resolvePromise(); }, 8_000);
          killer.on("error", () => { clearTimeout(timer); resolvePromise(); });
          killer.on("exit", () => { clearTimeout(timer); resolvePromise(); });
        });
      } else {
        this.log(provider, "Task-owned WSL installer process group was not available during cancellation; stopping its Windows launcher.");
      }
    }
    this.children.get(provider)?.kill();
  }

  private async run(provider: LocalPrompt3DProviderId, file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<void> {
    this.assertNotCancelled(provider);
    let effectiveArgs = args;
    let transientWslFiles: string[] = [];
    const isTypedWslShell = basename(file).toLowerCase() === "wsl.exe"
      && args[0] === "-d"
      && typeof args[1] === "string"
      && args[2] === "--"
      && args[3] === "bash"
      && args[4] === "-lc"
      && typeof args[5] === "string"
      && args.length === 6;
    if (isTypedWslShell) {
      const pidFile = contained(this.options.root, join(this.options.root, provider, ".installer-process-group"));
      const commandFile = contained(this.options.root, `${pidFile}.command.sh`);
      const wrapperFile = contained(this.options.root, `${pidFile}.wrapper.sh`);
      const wrapper = [
        "#!/usr/bin/env bash",
        "set -e",
        `rm -f ${shellQuote(toWslPath(pidFile))}`,
        `setsid bash ${shellQuote(toWslPath(commandFile))} & child=$!`,
        `printf '%s\\n' "$child" > ${shellQuote(toWslPath(pidFile))}`,
        "wait \"$child\"",
      ].join("\n");
      await writeFile(commandFile, `${args[5]}\n`, "utf8");
      await writeFile(wrapperFile, `${wrapper}\n`, "utf8");
      transientWslFiles = [pidFile, commandFile, wrapperFile];
      effectiveArgs = ["-d", args[1], "--exec", "bash", toWslPath(wrapperFile)];
      this.wslGroups.set(provider, { distro: args[1], pidFile });
    }
    const cleanupTransientWslFiles = () => {
      for (const path of transientWslFiles) void rm(path, { force: true }).catch(() => undefined);
    };
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(file, effectiveArgs, { cwd, env: childEnvironment(env), windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
      this.children.set(provider, child);
      child.stdout?.on("data", (buf) => String(buf).split(/\r?\n/).forEach((l) => this.log(provider, l)));
      child.stderr?.on("data", (buf) => String(buf).split(/\r?\n/).forEach((l) => this.log(provider, l)));
      child.on("error", (error) => { this.children.delete(provider); this.wslGroups.delete(provider); cleanupTransientWslFiles(); reject(error); });
      child.on("exit", (code, signal) => {
        this.children.delete(provider);
        this.wslGroups.delete(provider);
        cleanupTransientWslFiles();
        if (code === 0) resolvePromise();
        else reject(new Error(`${basename(file)} exited ${code ?? signal ?? "unknown"}`));
      });
    });
  }

  private async download(provider: LocalPrompt3DProviderId, url: string, destination: string, expectedHash?: string): Promise<void> {
    this.assertNotCancelled(provider);
    contained(this.options.root, destination);
    await mkdir(dirname(destination), { recursive: true });
    const partial = `${destination}.partial`;
    const existing = existsSync(partial) ? (await stat(partial)).size : 0;
    const controller = new AbortController();
    this.downloads.set(provider, controller);
    let response: Response;
    try {
      response = await fetch(url, { headers: existing > 0 ? { Range: `bytes=${existing}-` } : undefined, redirect: "follow", signal: controller.signal });
    } catch (error) {
      this.downloads.delete(provider);
      throw error;
    }
    if (!response.ok && response.status !== 206) { this.downloads.delete(provider); throw new Error(`Download failed with HTTP ${response.status}`); }
    const append = response.status === 206 && existing > 0;
    const stream = createWriteStream(partial, { flags: append ? "a" : "w" });
    const reader = response.body?.getReader();
    if (!reader) { this.downloads.delete(provider); stream.destroy(); throw new Error("Download returned no body"); }
    try {
      for (;;) {
        this.assertNotCancelled(provider);
        const { done, value } = await reader.read();
        if (done) break;
        if (!stream.write(Buffer.from(value))) await new Promise<void>((r) => stream.once("drain", () => r()));
      }
      await new Promise<void>((r, j) => stream.end((err?: Error | null) => err ? j(err) : r()));
    } finally {
      this.downloads.delete(provider);
      if (!stream.closed) stream.destroy();
    }
    if (expectedHash && await sha256(partial) !== expectedHash) {
      await rm(partial, { force: true });
      throw new Error(`Checksum mismatch for ${basename(destination)}`);
    }
    await rename(partial, destination);
  }

  private ensureCommonRuntime(provider: LocalPrompt3DProviderId): Promise<string> {
    if (this.commonRuntime) return this.commonRuntime;
    this.commonRuntime = (async () => {
      const tools = contained(this.options.root, join(this.options.root, ".tools"));
      const uvExe = join(tools, "uv.exe");
      await mkdir(tools, { recursive: true });
      if (!existsSync(uvExe)) {
        this.update(provider, { stage: "download-runtime", progress: 3, message: `Downloading pinned uv ${UV_VERSION} runtime (checksum verified).` });
        const zipPath = join(tools, `uv-${UV_VERSION}.zip`);
        if (!existsSync(zipPath)) await this.download(provider, UV_URL, zipPath, UV_SHA256);
        else if (await sha256(zipPath) !== UV_SHA256) { await rm(zipPath, { force: true }); await this.download(provider, UV_URL, zipPath, UV_SHA256); }
        const files = unzipSync(new Uint8Array(await readFile(zipPath)));
        const uv = files["uv.exe"];
        if (!uv) throw new Error("Verified uv archive did not contain uv.exe");
        await writeFile(uvExe, uv);
      }
      return uvExe;
    })().catch((error) => { this.commonRuntime = null; throw error; });
    return this.commonRuntime;
  }

  private async checkout(provider: LocalPrompt3DProviderId, sourceUrl: string, revision: string, destination: string): Promise<void> {
    if (!existsSync(join(destination, ".git"))) {
      await mkdir(destination, { recursive: true });
      await this.run(provider, "git", ["init", "--quiet"], destination);
      await this.run(provider, "git", ["remote", "add", "origin", sourceUrl], destination);
    }
    const remote = await gitOutput(destination, ["remote", "get-url", "origin"], "Could not verify installed source origin.");
    if (normalizeGitRemote(remote) !== normalizeGitRemote(sourceUrl)) throw new Error(`Existing source origin does not match the pinned official source for ${basename(destination)}.`);
    const dirty = await gitOutput(destination, ["status", "--porcelain=v1", "--untracked-files=all"], "Could not verify installed source worktree state.");
    if (dirty) throw new Error(`Existing source checkout ${basename(destination)} has local changes; repair stopped without overwriting them.`);
    await this.run(provider, "git", ["fetch", "--depth=1", "origin", revision], destination);
    await this.run(provider, "git", ["checkout", "--detach", "FETCH_HEAD"], destination);
    await this.run(provider, "git", ["submodule", "update", "--init", "--recursive", "--depth=1"], destination);
    const verified = await new Promise<string>((resolvePromise, reject) => {
      const child = spawn("git", ["rev-parse", "HEAD"], { cwd: destination, windowsHide: true, shell: false });
      let out = ""; child.stdout.on("data", (b) => out += b); child.on("exit", (c) => c === 0 ? resolvePromise(out.trim()) : reject(new Error("Could not verify source revision")));
    });
    if (verified !== revision) throw new Error(`Source revision mismatch: expected ${revision}, got ${verified}`);
  }

  private async ensureWindowsPython(provider: LocalPrompt3DProviderId, uvExe: string, providerRoot: string): Promise<string> {
    const envRoot = join(providerRoot, "environment");
    const pythonExe = join(envRoot, "Scripts", "python.exe");
    const pythonInstallRoot = contained(this.options.root, join(this.options.root, ".python"));
    if (!existsSync(pythonExe)) {
      this.update(provider, { stage: "python", progress: 8, message: `Installing isolated CPython ${PYTHON_VERSION}; global PATH is unchanged.` });
      await this.run(provider, uvExe, ["python", "install", PYTHON_VERSION], this.options.root, { UV_PYTHON_INSTALL_DIR: pythonInstallRoot });
      await this.run(provider, uvExe, ["venv", envRoot, "--python", PYTHON_VERSION, "--python-preference", "only-managed"], this.options.root, { UV_PYTHON_INSTALL_DIR: pythonInstallRoot });
    }
    return pythonExe;
  }

  private async downloadModels(providerId: LocalPrompt3DProviderId, uvExe: string, python: string, providerRoot: string): Promise<void> {
    const provider = localProvider(providerId);
    const helper = contained(this.options.appRoot, join(this.options.appRoot, "tools", "prompt3d", "hf_snapshot.py"));
    await this.run(providerId, uvExe, ["pip", "install", "--python", python, "huggingface_hub==0.36.0"], providerRoot);
    let index = 0, downloadedModelBytes = 0;
    for (const model of provider.modelSources) {
      this.assertNotCancelled(providerId);
      index += 1;
      const destination = contained(this.options.root, join(providerRoot, "models", model.id.replace(/[\\/]/g, "--")));
      this.update(providerId, {
        stage: "models", progress: 18 + index * 16,
        message: `Downloading ${model.id} at immutable revision ${model.revision.slice(0, 12)}… (${(model.estimatedDownloadBytes / 1024 ** 3).toFixed(2)} GB model estimate).`,
      });
      const args = [helper, "--repo", model.id, "--revision", model.revision, "--destination", destination];
      for (const pattern of model.allowPatterns ?? []) args.push("--allow-pattern", pattern);
      await this.run(providerId, python, args, providerRoot, {
        HF_HUB_DISABLE_TELEMETRY: "1", HF_HUB_DISABLE_IMPLICIT_TOKEN: "1", HF_HUB_DISABLE_XET: "0", HF_HOME: join(providerRoot, ".hf-cache"),
      });
      const completed = await directoryBytes(destination, 50_000);
      downloadedModelBytes += completed;
      this.update(providerId, { bytesCompleted: Math.min(provider.downloadBytes, downloadedModelBytes) });
    }
  }

  private async checkoutDependencies(providerId: LocalPrompt3DProviderId, providerRoot: string): Promise<void> {
    const provider = localProvider(providerId);
    let index = 0;
    for (const dependency of provider.sourceDependencies) {
      this.assertNotCancelled(providerId);
      if (!/^[a-z0-9-]+$/.test(dependency.id)) throw new Error(`Unsafe source dependency id: ${dependency.id}`);
      index += 1;
      const destination = contained(this.options.root, join(providerRoot, "dependencies", dependency.id));
      this.update(providerId, {
        stage: "source-dependencies", progress: Math.min(70, 60 + index * 2),
        message: `Fetching ${dependency.id} at immutable revision ${dependency.revision.slice(0, 12)}…`,
      });
      await this.checkout(providerId, dependency.sourceUrl, dependency.revision, destination);
      if (dependency.installSubpath) {
        const installPath = contained(destination, join(destination, dependency.installSubpath));
        if (!existsSync(installPath)) throw new Error(`${dependency.id} install subpath is absent at the pinned revision.`);
      }
    }
  }

  private async writeManifest(providerId: LocalPrompt3DProviderId, providerRoot: string): Promise<string> {
    const provider = localProvider(providerId);
    const integrity = contained(this.options.integrityKeyDirectory, this.options.integrityKeyDirectory);
    await mkdir(integrity, { recursive: true });
    const privatePath = join(integrity, "prompt3d-ed25519-private.pem");
    const publicPath = join(this.options.root, "prompt3d-ed25519-public.pem");
    const hasPrivate = existsSync(privatePath), hasPublic = existsSync(publicPath);
    if (!hasPrivate && !hasPublic) {
      const keys = generateKeyPairSync("ed25519", { publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
      await writeFile(privatePath, keys.privateKey, { mode: 0o600 });
      await writeFile(publicPath, keys.publicKey);
    } else if (!hasPrivate) {
      throw new Error("Prompt-to-3D signing private key is missing; refusing to replace the public key and invalidate existing manifests.");
    } else {
      const derivedPublic = createPublicKey(await readFile(privatePath, "utf8")).export({ type: "spki", format: "pem" }).toString();
      if (!hasPublic) await writeFile(publicPath, derivedPublic);
      else if ((await readFile(publicPath, "utf8")).trim() !== derivedPublic.trim()) throw new Error("Prompt-to-3D signing key pair is inconsistent; existing manifests were left untouched.");
    }
    const bytes = await directoryBytes(providerRoot);
    const runtimeFreeze = join(providerRoot, "runtime-freeze.txt");
    const runtimeConda = join(providerRoot, "runtime-conda-explicit.txt");
    const runtimeNative = join(providerRoot, "runtime-native-artifacts.json");
    if (!existsSync(runtimeFreeze) || !existsSync(runtimeConda) || !existsSync(runtimeNative)) throw new Error("The isolated runtime lock evidence is incomplete.");
    const models = await Promise.all(provider.modelSources.map(async (model) => {
      const metadataPath = join(providerRoot, "models", model.id.replace(/[\\/]/g, "--"), ".grudge-snapshot.json");
      const metadataRaw = await readFile(metadataPath, "utf8");
      const metadata = JSON.parse(metadataRaw) as SnapshotMetadata;
      if (metadata.repo !== model.id || metadata.revision !== model.revision || !metadata.treeSha256 || metadata.fileCount !== metadata.files?.length) throw new Error(`Snapshot checksum inventory is incomplete for ${model.id}.`);
      return { ...model, snapshotMetadataSha256: createHash("sha256").update(metadataRaw).digest("hex"), treeSha256: metadata.treeSha256, fileCount: metadata.fileCount, installedBytes: metadata.installedBytes };
    }));
    const payload = {
      version: 1, providerId, createdAt: new Date().toISOString(), sourceUrl: provider.sourceUrl,
      sourceRevision: provider.sourceRevision, models, sourceDependencies: provider.sourceDependencies,
      runtimeLocks: { pipFreezeSha256: await sha256(runtimeFreeze), condaExplicitSha256: await sha256(runtimeConda), nativeArtifactsSha256: await sha256(runtimeNative) }, installedBytes: bytes,
      installationRoot: providerRoot, license: { name: provider.licenseName, url: provider.licenseUrl },
    };
    const canonical = JSON.stringify(payload);
    const privateKey = await readFile(privatePath, "utf8");
    const signed = { ...payload, sha256: createHash("sha256").update(canonical).digest("hex"), signature: sign(null, Buffer.from(canonical), privateKey).toString("base64") };
    const path = join(providerRoot, "install-manifest.json");
    await writeFile(path, `${JSON.stringify(signed, null, 2)}\n`);
    return path;
  }

  private async install(providerId: LocalPrompt3DProviderId, action: "install" | "repair"): Promise<Prompt3DInstallStatus> {
    const provider = localProvider(providerId);
    const providerRoot = contained(this.options.root, join(this.options.root, providerId));
    await mkdir(providerRoot, { recursive: true });
    this.update(providerId, { state: "installing", stage: "preflight", progress: 1, message: `${action === "repair" ? "Repairing" : "Installing"} ${provider.name}.` });
    try {
      const hardware = await measurePrompt3DHardware(this.options.root, true);
      const compliance = evaluatePrompt3DCompliance(provider, hardware, this.options.root, "pre-download");
      if (!compliance.canInstall) throw new Error(compliance.reasons.join(" "));
      const uvExe = await this.ensureCommonRuntime(providerId);
      this.assertNotCancelled(providerId);
      const python = await this.ensureWindowsPython(providerId, uvExe, providerRoot);
      const source = join(providerRoot, "source");
      this.update(providerId, { stage: "source", progress: 14, message: `Fetching official source at ${provider.sourceRevision.slice(0, 12)}…` });
      await this.checkout(providerId, provider.sourceUrl, provider.sourceRevision, source);
      if (providerId === "hy-motion-1") {
        this.update(providerId, { stage: "source", progress: 16, message: "Fetching and verifying the official HY-Motion LFS rest-rig data." });
        await this.run(providerId, "git", ["lfs", "pull"], source);
        await this.run(providerId, "git", ["lfs", "fsck"], source);
      }
      await this.downloadModels(providerId, uvExe, python, providerRoot);
      await this.checkoutDependencies(providerId, providerRoot);
      this.assertNotCancelled(providerId);

      if (providerId === "hunyuan3d-2") {
        const usableDistro = hardware.wsl.usableLinuxDistribution;
        if (!usableDistro) throw new Error("Hunyuan3D 2.1 setup needs the configured normal WSL Ubuntu distribution because the official Python 3.10 dependency set currently references an unavailable bpy 4.0 wheel on Windows.");
        this.update(providerId, { stage: "dependencies", progress: 72, message: `Building official Hunyuan3D 2.1 inference dependencies in isolated WSL distribution ${usableDistro}.` });
        const officialRequirements = await readFile(join(source, "requirements.txt"), "utf8");
        const inferenceRequirements = officialRequirements.split(/\r?\n/).filter((line) => {
          const normalized = line.trim().toLowerCase();
          return !normalized.startsWith("--extra-index-url") && normalized !== "deepspeed" && !normalized.startsWith("bpy==");
        }).map((line) => HUNYUAN_UNPINNED_REQUIREMENTS[line.trim().toLowerCase()] ?? line).join("\n");
        const inferenceRequirementsPath = contained(this.options.root, join(providerRoot, "requirements.inference.txt"));
        await writeFile(inferenceRequirementsPath, `${inferenceRequirements}\n`);
        const linuxRootName = `hunyuan3d-2-${provider.sourceRevision.slice(0, 12)}`;
        const quotedSourceUrl = shellQuote(provider.sourceUrl);
        const quotedRevision = shellQuote(provider.sourceRevision);
        const quotedRequirements = shellQuote(toWslPath(inferenceRequirementsPath));
        const quotedProviderRoot = shellQuote(toWslPath(providerRoot));
        const bootstrap = [
          "set -eo pipefail",
          "test \"$UID\" -ne 0",
          "test -w \"$HOME\"",
          `BASE=\"$HOME/.local/share/grudge-prompt3d/${linuxRootName}\"`,
          "mkdir -p \"$BASE\"",
          "export CONDA_PKGS_DIRS=\"$BASE/package-cache\"; mkdir -p \"$CONDA_PKGS_DIRS\"",
          `if [ ! -x \"$BASE/miniforge/bin/conda\" ]; then curl -fL --retry 5 --continue-at - '${MINIFORGE_URL}' -o \"$BASE/miniforge-installer.sh\"; echo '${MINIFORGE_SHA256}  '$BASE/miniforge-installer.sh | sha256sum -c -; bash \"$BASE/miniforge-installer.sh\" -b -p \"$BASE/miniforge\"; fi`,
          "source \"$BASE/miniforge/etc/profile.d/conda.sh\"",
          "if [ ! -x \"$BASE/environment/bin/python\" ]; then conda create -y -p \"$BASE/environment\" python=3.11; fi",
          "conda install -y -p \"$BASE/environment\" cuda-toolkit=12.4 gxx_linux-64=11.4 xorg-libsm xorg-libxext xorg-libxrender -c nvidia/label/cuda-12.4.0 -c conda-forge",
          "rm -rf \"$BASE/source.next\"",
          `git clone --filter=blob:none --no-checkout ${quotedSourceUrl} \"$BASE/source.next\"`,
          `git -C \"$BASE/source.next\" fetch --depth=1 origin ${quotedRevision}`,
          `git -C \"$BASE/source.next\" checkout --detach ${quotedRevision}`,
          "git -C \"$BASE/source.next\" -c submodule.recurse=true submodule update --init --recursive --depth=1",
          `test \"$(git -C \"$BASE/source.next\" rev-parse HEAD)\" = ${quotedRevision}`,
          "test -z \"$(git -C \"$BASE/source.next\" status --porcelain=v1 --untracked-files=all)\"",
          "rm -rf \"$BASE/source\"; mv \"$BASE/source.next\" \"$BASE/source\"",
          "conda activate \"$BASE/environment\"",
          "export CUDA_HOME=\"$BASE/environment\"",
          "export PATH=\"$CUDA_HOME/bin:$PATH\"",
          "export LD_LIBRARY_PATH=\"$CUDA_HOME/lib:$CUDA_HOME/lib64:${LD_LIBRARY_PATH:-}\"",
          "CXX_BIN=\"$(find \"$CUDA_HOME/bin\" -maxdepth 1 \\( -type f -o -type l \\) -name '*-c++' -print -quit)\"; test -n \"$CXX_BIN\"; ln -sfn \"$CXX_BIN\" \"$CUDA_HOME/bin/c++\"; test -x \"$CUDA_HOME/bin/c++\"",
          "python -c 'import torch; assert torch.__version__.startswith(\"2.5.1\") and torch.cuda._is_compiled() and torch.version.cuda == \"12.4\"' || python -m pip install --force-reinstall --index-url https://download.pytorch.org/whl/cu124 torch==2.5.1 torchvision==0.20.1 torchaudio==2.5.1",
          "python -c 'import torch; assert torch.cuda._is_compiled() and torch.version.cuda == \"12.4\"'",
          "ln -sfn libcudart.so.12 \"$CUDA_HOME/lib/libcudart.so\"; test -e \"$CUDA_HOME/lib/libcudart.so\"",
          `python -m pip install --index-url https://pypi.org/simple -r ${quotedRequirements}`,
          "python -m pip install --index-url https://pypi.org/simple setuptools==80.9.0 sentencepiece==0.2.1",
          "python -m pip install --index-url https://pypi.org/simple bpy==4.2.0",
          "cd \"$BASE/source/hy3dpaint/custom_rasterizer\"",
          "python -m pip install --no-build-isolation -e .",
          "cd \"$BASE/source/hy3dpaint/DifferentiableRenderer\"",
          "bash ./compile_mesh_painter.sh",
          "PAINTER_EXTENSION=\"$(find \"$BASE/source/hy3dpaint/DifferentiableRenderer\" -maxdepth 1 -type f -name 'mesh_inpaint_processor*.so' -print -quit)\"; test -n \"$PAINTER_EXTENSION\"",
          `PAINTER_EXTENSION="$PAINTER_EXTENSION" BASE="$BASE" PROVIDER_ROOT=${quotedProviderRoot} python -c 'import hashlib,json,os,pathlib; p=pathlib.Path(os.environ["PAINTER_EXTENSION"]); b=pathlib.Path(os.environ["BASE"]); o=pathlib.Path(os.environ["PROVIDER_ROOT"])/"runtime-native-artifacts.json"; o.write_text(json.dumps({"version":1,"artifacts":[{"id":"hunyuan-mesh-inpaint-processor","path":p.relative_to(b).as_posix(),"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()}]},indent=2)+"\\n",encoding="utf-8")'`,
          "mkdir -p \"$BASE/source/hy3dpaint/ckpt\"",
          `curl -fL --retry 5 --continue-at - '${REAL_ESRGAN_URL}' -o \"$BASE/source/hy3dpaint/ckpt/RealESRGAN_x4plus.pth\"`,
          `echo '${REAL_ESRGAN_SHA256}  '$BASE/source/hy3dpaint/ckpt/RealESRGAN_x4plus.pth | sha256sum -c -`,
          "PYTHONPATH=\"$BASE/source/hy3dshape:$BASE/source/hy3dpaint:$BASE/source/hy3dpaint/DifferentiableRenderer\" python -c 'import os, torch; assert torch.cuda.is_available(); from utils.torchvision_fix import apply_fix; assert apply_fix() is True; import realesrgan, mesh_inpaint_processor; assert callable(mesh_inpaint_processor.meshVerticeInpaint); from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline; from textureGenPipeline import Hunyuan3DPaintPipeline; print(torch.__version__, flush=True); os._exit(0)'",
          `python -m pip freeze | LC_ALL=C sort > ${quotedProviderRoot}/runtime-freeze.txt`,
          `conda list -p \"$BASE/environment\" --explicit > ${quotedProviderRoot}/runtime-conda-explicit.txt`,
        ].join("; ");
        await this.run(providerId, "wsl.exe", ["-d", usableDistro, "--", "bash", "-lc", bootstrap], providerRoot);
      } else if (providerId === "hy-motion-1") {
        const usableDistro = hardware.wsl.usableLinuxDistribution;
        if (!usableDistro) throw new Error("HY-Motion 1.0 setup requires the configured normal-user WSL Ubuntu distribution.");
        this.update(providerId, { stage: "dependencies", progress: 72, message: `Building the official HY-Motion 1.0 Lite CUDA/CPU runtime in isolated WSL distribution ${usableDistro}.` });
        const officialRequirements = await readFile(join(source, "requirements.txt"), "utf8");
        const inferenceRequirements = officialRequirements.split(/\r?\n/).filter((line) => {
          const normalized = line.trim().toLowerCase();
          return normalized && !normalized.startsWith("--extra-index-url") && !normalized.startsWith("torch==")
            && !normalized.startsWith("torchvision==") && !normalized.startsWith("fbxsdkpy==");
        }).join("\n");
        const inferenceRequirementsPath = contained(this.options.root, join(providerRoot, "requirements.inference.txt"));
        await writeFile(inferenceRequirementsPath, `${inferenceRequirements}\n`);
        const linuxRootName = `hy-motion-1-${provider.sourceRevision.slice(0, 12)}`;
        const quotedSource = shellQuote(toWslPath(source));
        const quotedRevision = shellQuote(provider.sourceRevision);
        const quotedRequirements = shellQuote(toWslPath(inferenceRequirementsPath));
        const quotedProviderRoot = shellQuote(toWslPath(providerRoot));
        const bootstrap = [
          "set -eo pipefail",
          "test \"$UID\" -ne 0",
          "test -w \"$HOME\"",
          `BASE="$HOME/.local/share/grudge-prompt3d/${linuxRootName}"`,
          "mkdir -p \"$BASE\"",
          "export CONDA_PKGS_DIRS=\"$BASE/package-cache\"; mkdir -p \"$CONDA_PKGS_DIRS\"",
          `if [ ! -x "$BASE/miniforge/bin/conda" ]; then curl -fL --retry 5 --continue-at - '${MINIFORGE_URL}' -o "$BASE/miniforge-installer.sh"; echo '${MINIFORGE_SHA256}  '$BASE/miniforge-installer.sh | sha256sum -c -; bash "$BASE/miniforge-installer.sh" -b -p "$BASE/miniforge"; fi`,
          "source \"$BASE/miniforge/etc/profile.d/conda.sh\"",
          "if [ ! -x \"$BASE/environment/bin/python\" ]; then conda create -y -p \"$BASE/environment\" python=3.10; fi",
          "rm -rf \"$BASE/source.next\"; mkdir -p \"$BASE/source.next\"",
          `cp -a ${quotedSource}/. "$BASE/source.next/"`,
          `test "$(git -C "$BASE/source.next" rev-parse HEAD)" = ${quotedRevision}`,
          "test -z \"$(git -C \"$BASE/source.next\" status --porcelain=v1 --untracked-files=all)\"",
          "rm -rf \"$BASE/source\"; mv \"$BASE/source.next\" \"$BASE/source\"",
          "conda activate \"$BASE/environment\"",
          "python -c 'import torch; assert torch.__version__.startswith(\"2.5.1\") and torch.cuda._is_compiled() and torch.version.cuda == \"12.4\"' || python -m pip install --force-reinstall --index-url https://download.pytorch.org/whl/cu124 torch==2.5.1 torchvision==0.20.1",
          `python -m pip install --index-url https://pypi.org/simple -r ${quotedRequirements}`,
          "cd \"$BASE/source\"",
          "PYTHONDONTWRITEBYTECODE=1 python -c 'import torch; assert torch.version.cuda == \"12.4\"; from hymotion.utils.t2m_runtime import T2MRuntime; from hymotion.pipeline.body_model import WoodenMesh; m=WoodenMesh(); assert m.j_template.shape[0] >= 22; print(torch.__version__, \"cuda-visible=\" + str(torch.cuda.is_available()))'",
          "TORCH_NATIVE=\"$(find \"$BASE/environment/lib/python3.10/site-packages/torch\" -maxdepth 1 -type f -name '_C*.so' -print -quit)\"; test -n \"$TORCH_NATIVE\"",
          `TORCH_NATIVE="$TORCH_NATIVE" BASE="$BASE" PROVIDER_ROOT=${quotedProviderRoot} python -c 'import hashlib,json,os,pathlib; p=pathlib.Path(os.environ["TORCH_NATIVE"]); b=pathlib.Path(os.environ["BASE"]); o=pathlib.Path(os.environ["PROVIDER_ROOT"])/"runtime-native-artifacts.json"; o.write_text(json.dumps({"version":1,"artifacts":[{"id":"hy-motion-torch-runtime","path":p.relative_to(b).as_posix(),"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()}]},indent=2)+"\\n",encoding="utf-8")'`,
          `python -m pip freeze | LC_ALL=C sort > ${quotedProviderRoot}/runtime-freeze.txt`,
          `conda list -p "$BASE/environment" --explicit > ${quotedProviderRoot}/runtime-conda-explicit.txt`,
        ].join("; ");
        await this.run(providerId, "wsl.exe", ["-d", usableDistro, "--", "bash", "-lc", bootstrap], providerRoot);
      } else {
        const usableDistro = hardware.wsl.usableLinuxDistribution;
        if (!usableDistro) {
          this.update(providerId, { stage: "wsl-bootstrap", progress: 65, message: "Requesting the normal Ubuntu 24.04 WSL distribution without launching it. Elevation/restart may be required." });
          try { await this.run(providerId, "wsl.exe", ["--install", "-d", "Ubuntu-24.04", "--no-launch"], providerRoot); } catch (error) {
            throw new Error(`TRELLIS files are cached, but WSL Ubuntu provisioning needs an administrator/restart gate: ${error instanceof Error ? error.message : String(error)}`);
          }
          throw new Error("TRELLIS files are cached. Launch Ubuntu 24.04 once to create the normal user, then choose Repair to resume the isolated Linux environment build.");
        }
        this.update(providerId, { stage: "dependencies", progress: 72, message: `Building official TRELLIS dependencies in isolated WSL distribution ${usableDistro}.` });
        const linuxRootName = `trellis-${provider.sourceRevision.slice(0, 12)}`;
        const quotedSourceUrl = shellQuote(provider.sourceUrl);
        const quotedRevision = shellQuote(provider.sourceRevision);
        const quotedDependencies = shellQuote(toWslPath(join(providerRoot, "dependencies")));
        const quotedRequirements = shellQuote(toWslPath(contained(this.options.appRoot, join(this.options.appRoot, "tools", "prompt3d", "trellis-requirements.lock.txt"))));
        const quotedProviderRoot = shellQuote(toWslPath(providerRoot));
        const bootstrap = [
          "set -eo pipefail",
          "test \"$UID\" -ne 0",
          "test -w \"$HOME\"",
          `BASE=\"$HOME/.local/share/grudge-prompt3d/${linuxRootName}\"`,
          "mkdir -p \"$BASE\"",
          "export CONDA_PKGS_DIRS=\"$BASE/package-cache\"; mkdir -p \"$CONDA_PKGS_DIRS\"",
          `if [ ! -x \"$BASE/miniforge/bin/conda\" ]; then curl -fL --retry 5 --continue-at - '${MINIFORGE_URL}' -o \"$BASE/miniforge-installer.sh\"; echo '${MINIFORGE_SHA256}  '$BASE/miniforge-installer.sh | sha256sum -c -; bash \"$BASE/miniforge-installer.sh\" -b -p \"$BASE/miniforge\"; fi`,
          "source \"$BASE/miniforge/etc/profile.d/conda.sh\"",
          "if [ ! -x \"$BASE/environment/bin/python\" ]; then conda create -y -p \"$BASE/environment\" python=3.10; fi",
          "conda install -y -p \"$BASE/environment\" cuda-toolkit=12.1 gxx_linux-64=11.4 -c nvidia/label/cuda-12.1.0 -c conda-forge",
          "rm -rf \"$BASE/source.next\"",
          `git clone --filter=blob:none --no-checkout ${quotedSourceUrl} \"$BASE/source.next\"`,
          `git -C \"$BASE/source.next\" fetch --depth=1 origin ${quotedRevision}`,
          `git -C \"$BASE/source.next\" checkout --detach ${quotedRevision}`,
          "git -C \"$BASE/source.next\" -c submodule.recurse=true submodule update --init --recursive --depth=1",
          `test \"$(git -C \"$BASE/source.next\" rev-parse HEAD)\" = ${quotedRevision}`,
          "test -z \"$(git -C \"$BASE/source.next\" status --porcelain=v1 --untracked-files=all)\"",
          "rm -rf \"$BASE/source\"; mv \"$BASE/source.next\" \"$BASE/source\"",
          "rm -rf \"$BASE/dependencies.next\"; mkdir -p \"$BASE/dependencies.next\"",
          `cp -a ${quotedDependencies}/. \"$BASE/dependencies.next/\"`,
          "rm -rf \"$BASE/dependencies\"; mv \"$BASE/dependencies.next\" \"$BASE/dependencies\"",
          "conda activate \"$BASE/environment\"",
          "export CUDA_HOME=\"$BASE/environment\"",
          "export PATH=\"$CUDA_HOME/bin:$PATH\"",
          "export LD_LIBRARY_PATH=\"$CUDA_HOME/lib:$CUDA_HOME/lib64:${LD_LIBRARY_PATH:-}\"",
          "CXX_BIN=\"$(find \"$CUDA_HOME/bin\" -maxdepth 1 \\( -type f -o -type l \\) -name '*-c++' -print -quit)\"; test -n \"$CXX_BIN\"; ln -sfn \"$CXX_BIN\" \"$CUDA_HOME/bin/c++\"; test -x \"$CUDA_HOME/bin/c++\"",
          "python -c 'import torch; assert torch.__version__.startswith(\"2.4.0\") and torch.cuda._is_compiled() and torch.version.cuda == \"12.1\"' || python -m pip install --force-reinstall --index-url https://download.pytorch.org/whl/cu121 torch==2.4.0 torchvision==0.19.0",
          "python -c 'import torch; assert torch.cuda._is_compiled() and torch.version.cuda == \"12.1\"'",
          "ln -sfn libcudart.so.12 \"$CUDA_HOME/lib/libcudart.so\"; test -e \"$CUDA_HOME/lib/libcudart.so\"",
          `python -m pip install --index-url https://pypi.org/simple -r ${quotedRequirements}`,
          `python -m pip install xformers==${TRELLIS_XFORMERS} --index-url https://download.pytorch.org/whl/cu121`,
          `python -m pip install spconv-cu120==${TRELLIS_SPCONV}`,
          `python -m pip install kaolin==${TRELLIS_KAOLIN} -f ${TRELLIS_KAOLIN_INDEX}`,
          "python -m pip install --no-deps --no-build-isolation \"$BASE/dependencies/utils3d\"",
          "python -m pip install --index-url https://pypi.org/simple numpy==1.26.4",
          "python -m pip install --no-build-isolation \"$BASE/dependencies/nvdiffrast\"",
          "python -m pip install --no-build-isolation \"$BASE/dependencies/mip-splatting/submodules/diff-gaussian-rasterization\"",
          "python -m pip install --no-build-isolation \"$BASE/dependencies/vox2seq/extensions/vox2seq\"",
          "cd \"$BASE/source\"",
          "PYTHONDONTWRITEBYTECODE=1 ATTN_BACKEND=xformers SPARSE_ATTN_BACKEND=xformers SPCONV_ALGO=native python -c 'import torch; assert torch.cuda.is_available(); import trellis, xformers, spconv, kaolin, vox2seq, nvdiffrast.torch, diff_gaussian_rasterization, utils3d; print(torch.__version__)'",
          `python -m pip freeze | LC_ALL=C sort > ${quotedProviderRoot}/runtime-freeze.txt`,
          `conda list -p "$BASE/environment" --explicit > ${quotedProviderRoot}/runtime-conda-explicit.txt`,
        ].join("; ");
        await this.run(providerId, "wsl.exe", ["-d", usableDistro, "--", "bash", "-lc", bootstrap], providerRoot);
      }

      this.update(providerId, { stage: "verify", progress: 94, message: "Verifying installed tree and writing signed local manifest." });
      const manifestPath = await this.writeManifest(providerId, providerRoot);
      const bytes = await directoryBytes(providerRoot);
      return this.update(providerId, { state: "installed", stage: "complete", progress: 100, bytesCompleted: bytes, manifestPath, message: `${provider.name} installed and integrity manifest signed.` });
    } catch (error) {
      const current = this.getStatus(providerId);
      if (current.state === "cancelled") return current;
      return this.update(providerId, { state: "repair-needed", stage: "blocked", message: error instanceof Error ? error.message : String(error), resumable: true });
    }
  }
}
