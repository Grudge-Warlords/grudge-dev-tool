import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rename, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256InstalledModelFile } from "../src/main/prompt3d/providerDigestCache";

const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

async function main() {
  const root = await mkdtemp(join(tmpdir(), "grudge-provider-digest-cache-"));
  try {
    const modelPath = join(root, "model.bin");
    await writeFile(modelPath, "alpha");
    const expected = digest("alpha");
    let reads = 0;
    const countedRead = async (path: string) => {
      reads += 1;
      return digest(await readFile(path));
    };

    let observed = await lstat(modelPath, { bigint: true });
    assert.equal(await sha256InstalledModelFile(modelPath, observed, expected, countedRead), expected);
    observed = await lstat(modelPath, { bigint: true });
    assert.equal(await sha256InstalledModelFile(modelPath, observed, expected, countedRead), expected);
    assert.equal(reads, 1, "an unchanged file identity, size and nanosecond timestamps must reuse its process-local digest");

    const wrongSignedDigest = digest("bravo");
    assert.equal(await sha256InstalledModelFile(modelPath, observed, wrongSignedDigest, countedRead), expected);
    assert.equal(reads, 2, "a cache entry must never satisfy a different signed expected digest");
    assert.equal(await sha256InstalledModelFile(modelPath, observed, expected, countedRead), expected);
    assert.equal(reads, 2, "checking another expected digest must not evict an unchanged valid entry");

    const priorMtimeMs = Number(observed.mtimeNs / 1_000_000n);
    await writeFile(modelPath, "omega");
    // Some Windows filesystems coalesce multiple same-size writes made inside
    // one timestamp tick. Make the metadata transition explicit so this test
    // deterministically exercises invalidation rather than timer resolution.
    await utimes(modelPath, new Date(priorMtimeMs + 2_000), new Date(priorMtimeMs + 2_000));
    observed = await lstat(modelPath, { bigint: true });
    assert.notEqual(await sha256InstalledModelFile(modelPath, observed, expected, countedRead), expected);
    assert.equal(reads, 3, "an in-place same-size write must invalidate the digest through high-resolution file metadata");

    await writeFile(modelPath, "alpha");
    observed = await lstat(modelPath, { bigint: true });
    assert.equal(await sha256InstalledModelFile(modelPath, observed, expected, countedRead), expected);
    assert.equal(reads, 4, "restoring valid bytes after a mutation must require a fresh hash before caching again");

    const replacementPath = join(root, "replacement.bin");
    const displacedPath = join(root, "displaced.bin");
    await writeFile(replacementPath, "alpha");
    await utimes(replacementPath, new Date(Number(observed.atimeNs / 1_000_000n)), new Date(Number(observed.mtimeNs / 1_000_000n)));
    await rename(modelPath, displacedPath);
    await rename(replacementPath, modelPath);
    observed = await lstat(modelPath, { bigint: true });
    assert.equal(await sha256InstalledModelFile(modelPath, observed, expected, countedRead), expected);
    assert.equal(reads, 5, "a path replacement must not reuse a prior file identity");

    const racingPath = join(root, "racing.bin");
    await writeFile(racingPath, "first");
    const racingExpected = digest("first");
    const racingObserved = await lstat(racingPath, { bigint: true });
    await assert.rejects(
      sha256InstalledModelFile(racingPath, racingObserved, racingExpected, async () => {
        await writeFile(racingPath, "changed-during-read");
        return racingExpected;
      }),
      /changed while its SHA-256 was being verified/,
      "a file mutation during hashing must fail closed and must never populate the cache",
    );

    const installerSource = await readFile(join(__dirname, "..", "src", "main", "prompt3d", "installer.ts"), "utf8");
    assert.ok(installerSource.includes('const info = await lstat(path, { bigint: true })'), "each provider verification must freshly lstat every declared model file");
    assert.ok(installerSource.includes("!info.isFile() || info.isSymbolicLink() || info.size !== BigInt(entry.bytes)"), "fresh file-type, symlink and signed-size checks must remain outside the digest cache");
    assert.ok(installerSource.includes("deep ? await sha256InstalledModelFile(path, info, entry.sha256) : entry.sha256"), "only deep model-file digest reads may use the process-local cache");
    assert.ok(installerSource.includes("runtimeLocks.pipFreezeSha256 !== await sha256(runtimeFreezePath)"), "runtime lock files must still be freshly hashed on every provider verification");
    assert.ok(installerSource.includes('commandOutput("wsl.exe"'), "deep verification must still re-measure the isolated WSL runtime and source checkout");

    console.log("Prompt-to-3D installed-provider digest cache tests passed.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
