import * as bk from "./blenderkit/daemon";
import * as sketchfab from "./sketchfab/credentials";
import * as toolchainSettings from "./toolchainSettings";

/**
 * Seed API keys and toolchain paths from env when store/vault entries are empty.
 * Lets a local .env preconfigure BlenderKit + Sketchfab on first launch.
 */
export async function seedDefaultSecrets(): Promise<void> {
  if (process.env.BLENDERKIT_API_KEY && !(await bk.getApiKey())) {
    await bk.setApiKey(process.env.BLENDERKIT_API_KEY);
  }
  if (process.env.SKETCHFAB_API_KEY && !(await sketchfab.getApiKey())) {
    await sketchfab.setApiKey(process.env.SKETCHFAB_API_KEY);
  }
  if (process.env.BLENDER_PATH && !(await toolchainSettings.getBlenderPath())) {
    await toolchainSettings.setBlenderPath(process.env.BLENDER_PATH);
  }
  if (process.env.BLENDERKIT_PATH && !(await toolchainSettings.getBlenderKitPath())) {
    await toolchainSettings.setBlenderKitPath(process.env.BLENDERKIT_PATH);
  }
}