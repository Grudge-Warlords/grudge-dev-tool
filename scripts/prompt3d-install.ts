import { resolve } from "node:path";
import { Prompt3DInstaller } from "../src/main/prompt3d/installer";
import type { LocalPrompt3DProviderId } from "../src/shared/prompt3d";

async function main() {
  const root = resolve(process.env.GRUDGE_PROMPT3D_ROOT || "E:\\GrudgePrompt3D");
  const appRoot = resolve(__dirname, "..");
  const installer = new Prompt3DInstaller({
    root,
    appRoot,
    integrityKeyDirectory: resolve(root, ".integrity"),
    onUpdate: (s) => process.stdout.write(`${JSON.stringify({ type: "status", ...s })}\n`),
    onLog: (provider, line) => process.stdout.write(`${JSON.stringify({ type: "log", provider, line })}\n`),
  });

  const args = process.argv.slice(2);
  const selected = (args.filter((v): v is LocalPrompt3DProviderId => v === "hunyuan3d-2" || v === "trellis"));
  const providers: LocalPrompt3DProviderId[] = selected.length ? selected : ["hunyuan3d-2", "trellis"];
  if (args.includes("--verify-deep")) {
    const results = await Promise.all(providers.map(async (provider) => ({ provider, ...(await installer.verify(provider, true)) })));
    process.stdout.write(`${JSON.stringify({ type: "verification", results })}\n`);
    process.exitCode = results.every((result) => result.ok) ? 0 : 2;
    return;
  }
  for (const provider of providers) installer.start(provider, args.includes("--repair") || installer.getStatus(provider).state === "repair-needed" ? "repair" : "install");
  const results = await Promise.all(providers.map((provider) => installer.wait(provider)));
  process.stdout.write(`${JSON.stringify({ type: "complete", results })}\n`);
  process.exitCode = results.every((r) => r.state === "installed") ? 0 : 2;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
