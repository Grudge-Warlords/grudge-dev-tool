#!/usr/bin/env node
/**
 * Install portable Blender 4.x + ffmpeg into tools/ and write toolchain.env paths.
 * Used when Accounts → Toolchain shows Blender/ffmpeg missing.
 *
 * Usage: node scripts/install-toolchain.mjs
 *        npm run toolchain:install
 */
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TOOLS = join(ROOT, "tools");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const BLENDER_MIRRORS = [
  "https://mirror.clarkson.edu/blender/release/Blender4.2/blender-4.2.9-windows-x64.zip",
  "https://ftp.nluug.nl/pub/graphics/blender/release/Blender4.2/blender-4.2.9-windows-x64.zip",
  "https://ftp.halifax.rwth-aachen.de/blender/release/Blender4.2/blender-4.2.9-windows-x64.zip",
  "https://mirrors.ocf.berkeley.edu/blender/release/Blender4.2/blender-4.2.9-windows-x64.zip",
];

const FFMPEG_URLS = [
  "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.zip",
];

const MCP_URL = "https://github.com/ahujasid/blender-mcp/archive/refs/heads/main.zip";

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

async function download(url, dest) {
  console.log(`↓ ${url}`);
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(res.body, createWriteStream(dest));
  const n = statSync(dest).size;
  console.log(`  saved ${dest} (${(n / 1e6).toFixed(1)} MB)`);
}

function expandZip(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true });
  // Prefer PowerShell Expand-Archive on Windows (no extra deps)
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: "inherit" },
    );
    return;
  }
  // Fallback: try unzip
  execFileSync("unzip", ["-o", zipPath, "-d", destDir], { stdio: "inherit" });
}

async function ensureBlender() {
  const existing = findBinary(join(TOOLS, "blender"), "blender.exe");
  if (existing) {
    console.log(`✓ Blender already at ${existing}`);
    return existing;
  }
  const zip = join(TOOLS, "blender-4.2.9-windows-x64.zip");
  if (!existsSync(zip) || statSync(zip).size < 1e8) {
    let ok = false;
    for (const url of BLENDER_MIRRORS) {
      try {
        await download(url, zip);
        ok = true;
        break;
      } catch (e) {
        console.warn(`  mirror failed: ${e.message}`);
      }
    }
    if (!ok) throw new Error("All Blender mirrors failed");
  }
  const dest = join(TOOLS, "blender");
  console.log("Extracting Blender…");
  expandZip(zip, dest);
  const exe = findBinary(dest, "blender.exe");
  if (!exe) throw new Error("blender.exe not found after extract");
  console.log(`✓ Blender ${exe}`);
  return exe;
}

async function ensureFfmpeg() {
  const portable = findBinary(join(TOOLS, "ffmpeg"), "ffmpeg.exe");
  if (portable) {
    console.log(`✓ ffmpeg portable at ${portable}`);
    return portable;
  }
  // winget / PATH
  try {
    const which = execFileSync(process.platform === "win32" ? "where" : "which", ["ffmpeg"], {
      encoding: "utf8",
    })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)[0];
    if (which && existsSync(which)) {
      console.log(`✓ ffmpeg on PATH: ${which}`);
      return which;
    }
  } catch {
    /* not on path */
  }
  const links = join(
    process.env.LOCALAPPDATA || "",
    "Microsoft",
    "WinGet",
    "Links",
    "ffmpeg.exe",
  );
  if (existsSync(links)) {
    console.log(`✓ ffmpeg winget links: ${links}`);
    return links;
  }

  const zip = join(TOOLS, "ffmpeg-release-essentials.zip");
  if (!existsSync(zip) || statSync(zip).size < 1e6) {
    let ok = false;
    for (const url of FFMPEG_URLS) {
      try {
        await download(url, zip);
        ok = true;
        break;
      } catch (e) {
        console.warn(`  ffmpeg download failed: ${e.message}`);
      }
    }
    if (!ok) throw new Error("ffmpeg download failed");
  }
  const dest = join(TOOLS, "ffmpeg");
  console.log("Extracting ffmpeg…");
  expandZip(zip, dest);
  const exe = findBinary(dest, "ffmpeg.exe");
  if (!exe) throw new Error("ffmpeg.exe not found after extract");
  console.log(`✓ ffmpeg ${exe}`);
  return exe;
}

async function ensureBlenderMcp() {
  const addon = join(TOOLS, "blender-mcp", "blender-mcp-main", "addon.py");
  if (existsSync(addon)) {
    console.log(`✓ blender-mcp addon at ${addon}`);
    return dirname(addon);
  }
  const zip = join(TOOLS, "blender-mcp", "blender-mcp.zip");
  mkdirSync(dirname(zip), { recursive: true });
  try {
    await download(MCP_URL, zip);
    expandZip(zip, join(TOOLS, "blender-mcp"));
  } catch (e) {
    console.warn(`blender-mcp download skipped: ${e.message}`);
    return null;
  }
  if (existsSync(addon)) {
    console.log(`✓ blender-mcp → ${dirname(addon)}`);
    return dirname(addon);
  }
  return null;
}

function writeEnv(blender, ffmpeg) {
  const body = [
    `# Auto-generated by scripts/install-toolchain.mjs`,
    `BLENDER_PATH=${blender}`,
    `FFMPEG_PATH=${ffmpeg}`,
    "",
  ].join("\n");

  writeFileSync(join(ROOT, ".env.local"), body, "utf8");
  console.log(`✓ wrote ${join(ROOT, ".env.local")}`);

  const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  const dir = join(appData, "grudge-dev-tool");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "toolchain.env"), body, "utf8");
  console.log(`✓ wrote ${join(dir, "toolchain.env")}`);
}

async function main() {
  mkdirSync(TOOLS, { recursive: true });
  console.log("Grudge toolchain install →", TOOLS);
  const [blender, ffmpeg, mcp] = await Promise.all([
    ensureBlender(),
    ensureFfmpeg(),
    ensureBlenderMcp(),
  ]);
  writeEnv(blender, ffmpeg);

  console.log("\n=== Toolchain ready ===");
  console.log("Blender:", blender);
  console.log("ffmpeg: ", ffmpeg);
  if (mcp) {
    console.log("MCP addon:", mcp);
    console.log(
      "\nBlender MCP setup:\n  1. Open Blender\n  2. Edit → Preferences → Add-ons → Install from disk →",
      join(mcp, "addon.py"),
      "\n  3. Enable BlenderMCP → Start MCP Server (port 9876)\n  4. Keep Blender open for AI agent / Grok MCP tools",
    );
  }
  console.log("\nRestart grudge-dev-tool Electron so Accounts → Toolchain re-probes.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
