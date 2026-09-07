import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PROMPT3D_PROVIDERS } from "./providers";

const LOCAL_PROVIDERS = PROMPT3D_PROVIDERS.filter((provider) => provider.kind === "local");

/**
 * Identify an existing pinned Prompt-to-3D root without mutating it. A root
 * remains discoverable when a newly added provider is not installed yet, so
 * Install Options can add that provider beside the already retained systems.
 * Every manifest that is present must still match its exact provider revision.
 * Signature and model-file verification happen through Prompt3DInstaller before
 * an individual provider is reported as runnable.
 */
export async function isExistingPrompt3DRoot(candidate: string): Promise<boolean> {
  const root = resolve(candidate);
  try {
    await readFile(join(root, "prompt3d-ed25519-public.pem"), "utf8");
    await readFile(join(root, ".python", "cpython-3.10-windows-x86_64-none", "python.exe"));
    let installedProviders = 0;
    for (const provider of LOCAL_PROVIDERS) {
      let raw: string;
      try {
        raw = await readFile(join(root, provider.id, "install-manifest.json"), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const manifest = JSON.parse(raw) as { providerId?: string; sourceRevision?: string; installationRoot?: string };
      if (
        manifest.providerId !== provider.id
        || manifest.sourceRevision !== provider.sourceRevision
        || resolve(manifest.installationRoot ?? "") !== resolve(root, provider.id)
      ) return false;
      installedProviders += 1;
    }
    return installedProviders > 0;
  } catch {
    return false;
  }
}

export async function discoverPrompt3DRoot(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await isExistingPrompt3DRoot(candidate)) return resolve(candidate);
  }
  return null;
}
