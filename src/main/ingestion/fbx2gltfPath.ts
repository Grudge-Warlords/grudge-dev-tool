import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

const WIN_NAMES = ["FBX2glTF.exe", "FBX2glTF"];
const POSIX_NAMES = ["FBX2glTF", "FBX2glTF.exe"];

function namesForPlatform(): string[] {
  return process.platform === "win32" ? WIN_NAMES : POSIX_NAMES;
}

function firstExisting(paths: string[]): string | null {
  for (const p of paths) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

/** Candidate directories for the bundled Facebook FBX2glTF converter. */
export function fbx2gltfSearchDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.FBX2GLTF_PATH) {
    dirs.push(process.env.FBX2GLTF_PATH);
  }
  if (process.resourcesPath) {
    dirs.push(join(process.resourcesPath, "tools"));
    dirs.push(process.resourcesPath);
  }
  try {
    dirs.push(join(app.getAppPath(), "resources", "tools"));
    dirs.push(join(app.getAppPath(), "resources"));
  } catch {
    /* app not ready */
  }
  dirs.push(join(process.cwd(), "resources", "tools"));
  dirs.push("D:\\FBX2glTF.exe");
  return dirs;
}

export function resolveBundledFbx2gltf(): string | null {
  const names = namesForPlatform();
  for (const dir of fbx2gltfSearchDirs()) {
    if (dir.endsWith(".exe") || dir.endsWith("FBX2glTF")) {
      if (existsSync(dir)) return dir;
      continue;
    }
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}