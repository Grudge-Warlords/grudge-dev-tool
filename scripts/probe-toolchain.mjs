/**
 * Probe toolchain without Electron (uses env + tools/ + PATH).
 * Usage: node scripts/probe-toolchain.mjs
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function findBinary(root, name, maxDepth = 5) {
  if (!existsSync(root)) return null;
  const target = name.toLowerCase();
  const walk = (dir, depth) => {
    if (depth < 0) return null;
    let entries = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return null;
    }
    for (const ent of entries) {
      const full = join(dir, ent);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) {
        if (ent.toLowerCase() === target) return full;
        continue;
      }
      if (/^(node_modules|\.git)$/i.test(ent)) continue;
      const hit = walk(full, depth - 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root, maxDepth);
}

function which(cmd) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
    encoding: "utf8",
  });
  if (r.status === 0 && r.stdout) {
    return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] ?? null;
  }
  return null;
}

function ver(bin, args) {
  try {
    const r = spawnSync(bin, args, { encoding: "utf8", timeout: 5000 });
    return (r.stdout || r.stderr || "").trim().split(/\r?\n/)[0] || "";
  } catch {
    return "";
  }
}

const blender =
  process.env.BLENDER_PATH ||
  findBinary(join(ROOT, "tools", "blender"), "blender.exe") ||
  which("blender");
const ffmpeg =
  process.env.FFMPEG_PATH ||
  which("ffmpeg") ||
  join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Links", "ffmpeg.exe") ||
  findBinary(join(ROOT, "tools", "ffmpeg"), "ffmpeg.exe");

const require = createRequire(join(ROOT, "package.json"));
let gltf = "MISS";
try {
  require.resolve("@gltf-transform/core");
  gltf = "OK " + require("@gltf-transform/core/package.json")?.version;
} catch {
  try {
    const entry = require.resolve("@gltf-transform/core");
    gltf = "OK installed @ " + entry;
  } catch (e) {
    gltf = "MISS " + e.message;
  }
}

const rows = [
  ["Blender", blender && existsSync(blender) ? "OK" : "MISS", blender, blender && existsSync(blender) ? ver(blender, ["--version"]) : ""],
  ["ffmpeg", ffmpeg && existsSync(ffmpeg) ? "OK" : "MISS", ffmpeg, ffmpeg && existsSync(ffmpeg) ? ver(ffmpeg, ["-version"]) : ""],
  ["gltf-transform", gltf.startsWith("OK") ? "OK" : "MISS", gltf, ""],
];

for (const [name, status, path, version] of rows) {
  console.log(`${status.padEnd(4)} ${name.padEnd(16)} ${(version || "").slice(0, 60)}`);
  if (path) console.log(`     ${path}`);
}

process.exit(rows.every((r) => r[1] === "OK") ? 0 : 1);
