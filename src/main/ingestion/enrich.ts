import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import { join, basename, extname } from "node:path";
import { tmpdir } from "node:os";
import { detectBlender, detectBlenderKit } from "./toolchain";
import { getApiKey } from "../blenderkit/daemon";

export interface EnrichOptions {
  /** Free-text query passed to BlenderKit. */
  query?: string;
  /** BlenderKit asset type. */
  assetType?: "model" | "material" | "brush" | "hdr" | "scene";
  /** Skip enrich entirely. */
  skip?: boolean;
  /** Output dir for enriched GLB; defaults to a temp dir. */
  outDir?: string;
}

export interface EnrichResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  enriched: boolean;
  outputPath: string;
  query?: string;
  assetType?: string;
}

function pythonScriptPath(): string {
  // When packaged via electron-builder, scripts live under dist/main/blenderkit/scripts.
  // In dev (tsx + ts-node), they live under src/main/blenderkit/scripts.
  // We resolve from __dirname because both layouts mirror this file's parent.
  const here = __dirname; // .../main/ingestion
  const tryPaths = [
    join(here, "..", "blenderkit", "scripts", "bk_enrich.py"),
    join(here, "..", "..", "..", "src", "main", "blenderkit", "scripts", "bk_enrich.py"),
  ];
  for (const p of tryPaths) if (existsSync(p)) return p;
  return tryPaths[0];
}

function runCmd(bin: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.on("error", (err) => resolve({ code: -1, stdout, stderr: err.message }));
  });
}

export async function enrichAsset(
  workingGlb: string,
  opts: EnrichOptions = {},
): Promise<EnrichResult> {
  const ext = extname(workingGlb).toLowerCase();
  const result: EnrichResult = {
    ok: true,
    errors: [],
    warnings: [],
    enriched: false,
    outputPath: workingGlb,
    query: opts.query,
    assetType: opts.assetType,
  };

  if (opts.skip || !opts.query) return result;
  if (ext !== ".glb" && ext !== ".gltf") {
    result.warnings.push(`Enrich only operates on GLB/glTF inputs (got ${ext}).`);
    return result;
  }

  const blender = detectBlender();
  const bk = detectBlenderKit();
  if (!blender.available) {
    result.warnings.push(`Blender unavailable; skipping enrich (${blender.reason}).`);
    return result;
  }
  if (!bk.available) {
    result.warnings.push(`BlenderKit not detected; skipping enrich (${bk.reason}).`);
    return result;
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    result.warnings.push("BlenderKit API key not set; skipping enrich.");
    return result;
  }

  const outDir = opts.outDir ?? join(tmpdir(), "grudge-dev-tool-enrich");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `${basename(workingGlb, ext)}.enriched.glb`);

  const r = await runCmd(blender.path!, [
    "-b",
    "--python",
    pythonScriptPath(),
    "--",
    workingGlb,
    outPath,
    opts.query,
    opts.assetType || "model",
    apiKey,
    bk.path!,
  ]);

  if (r.code === 0 && existsSync(outPath)) {
    result.outputPath = outPath;
    result.enriched = true;
  } else {
    result.warnings.push(`Enrich script exited ${r.code}; using unenriched asset. stderr=${r.stderr.slice(0, 300)}`);
  }
  return result;
}
