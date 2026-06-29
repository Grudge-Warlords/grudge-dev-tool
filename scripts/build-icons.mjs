// scripts/build-icons.mjs
// Emits all branded icon assets from resources/brand/grudge-emblem-source.png:
//   resources/icon-{16,24,32,48,64,128,256,512}.png
//   resources/icon.ico (multi-resolution Windows icon)
//   resources/tray.png (32px, used at runtime by Electron Tray)
//   src/renderer/public/favicon.ico (renderer favicon)
//
// Usage:  node scripts/build-icons.mjs
// Run automatically by `npm run build` and `npm run package` via the
// `prepackage` lifecycle hook.

import sharp from "sharp";
import pngToIco from "png-to-ico";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "resources", "brand", "grudge-emblem-source.png");
const RES = join(ROOT, "resources");
const RENDERER_PUBLIC = join(ROOT, "src", "renderer", "public");

const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function emitPng(size, outPath) {
  await sharp(SRC).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toFile(outPath);
  return outPath;
}

async function main() {
  // Sanity check
  try { await fs.access(SRC); } catch {
    console.error(`[build-icons] Source not found: ${SRC}`);
    process.exit(1);
  }

  await ensureDir(RES);
  await ensureDir(RENDERER_PUBLIC);

  // 1. Emit individual sized PNGs (tray + branding)
  const sized = [];
  for (const s of PNG_SIZES) {
    const out = join(RES, `icon-${s}.png`);
    sized.push(await emitPng(s, out));
    console.log(`[build-icons] wrote ${out}`);
  }

  // 2. Tray icon (Electron Tray on Windows likes a 32 or 16 PNG)
  const trayOut = join(RES, "tray.png");
  await emitPng(32, trayOut);
  console.log(`[build-icons] wrote ${trayOut}`);

  // 3. Multi-resolution Windows .ico (used by NSIS installer + window icon)
  const icoBuffers = [];
  for (const s of ICO_SIZES) {
    icoBuffers.push(
      await sharp(SRC).resize(s, s, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(),
    );
  }
  const icoBuf = await pngToIco(icoBuffers);
  const icoOut = join(RES, "icon.ico");
  await fs.writeFile(icoOut, icoBuf);
  console.log(`[build-icons] wrote ${icoOut} (${icoBuffers.length} sizes)`);

  // 4. Renderer favicon mirror
  await fs.writeFile(join(RENDERER_PUBLIC, "favicon.ico"), icoBuf);
  await fs.copyFile(join(RES, "icon-256.png"), join(RENDERER_PUBLIC, "logo-256.png"));
  await fs.copyFile(join(RES, "icon-512.png"), join(RENDERER_PUBLIC, "logo-512.png"));
  console.log(`[build-icons] mirrored favicon + logos to renderer/public`);

  console.log(`[build-icons] done.`);
}

main().catch((err) => {
  console.error("[build-icons] failed:", err);
  process.exit(1);
});
