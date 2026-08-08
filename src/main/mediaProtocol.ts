/**
 * Stream local video/audio (and large files) into Elite Viewer without
 * loading the entire file into RAM as a blob.
 *
 * URL form: grudge-media://local/?path=<encodeURIComponent(absolutePath)>
 */

import { protocol } from "electron";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, normalize, resolve } from "node:path";
import log from "./logger";

export const MEDIA_SCHEME = "grudge-media";

const TEXTURE_SUBDIRS = [
  "Textures",
  "textures",
  "Maps",
  "maps",
  "materials",
  "Materials",
  "mat",
  "tex",
  "sourceimages",
  "SourceImages",
];

/**
 * When a relative texture path 404s (wrong case / Kenney Textures/ folder),
 * search sibling texture dirs by basename so Elite Viewer colors stay correct.
 */
export function resolveExistingMediaPath(filePath: string): string | null {
  const abs = resolve(normalize(filePath));
  try {
    if (existsSync(abs) && statSync(abs).isFile()) return abs;
  } catch {
    /* continue */
  }

  const base = basename(abs);
  const startDir = dirname(abs);
  const baseLower = base.toLowerCase();

  const tryDir = (dir: string): string | null => {
    try {
      if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
      // exact
      const exact = join(dir, base);
      if (existsSync(exact) && statSync(exact).isFile()) return exact;
      // case-insensitive match (Windows packs / mixed case GLB refs)
      for (const ent of readdirSync(dir)) {
        if (ent.toLowerCase() === baseLower) {
          const p = join(dir, ent);
          if (statSync(p).isFile()) return p;
        }
      }
    } catch {
      /* skip */
    }
    return null;
  };

  // Same folder, then texture subfolders, then walk up 4 levels
  let cur = startDir;
  for (let up = 0; up < 5; up++) {
    const hit = tryDir(cur);
    if (hit) return hit;
    for (const sub of TEXTURE_SUBDIRS) {
      const hitSub = tryDir(join(cur, sub));
      if (hitSub) return hitSub;
    }
    // Also: if path was .../Textures/foo but folder is textures/
    const parent = dirname(cur);
    if (!parent || parent === cur) break;
    cur = parent;
  }

  // If path contained Textures/foo, also try replacing case
  const norm = abs.replace(/\\/g, "/");
  const m = norm.match(/^(.*)\/(textures|maps|materials|mat|tex)\/([^/]+)$/i);
  if (m) {
    const root = m[1];
    for (const sub of TEXTURE_SUBDIRS) {
      const hit = tryDir(join(root.replace(/\//g, "\\"), sub));
      if (hit) return hit;
    }
  }

  return null;
}

/** Must run before app.ready. */
export function registerMediaSchemePrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
        corsEnabled: true,
      },
    },
  ]);
}

/** After app.ready — map grudge-media → absolute file path. */
export function registerMediaFileProtocol(): void {
  const ok = protocol.registerFileProtocol(MEDIA_SCHEME, (request, callback) => {
    try {
      const u = new URL(request.url);
      let filePath = u.searchParams.get("path") || "";
      if (!filePath) {
        // Fallback: grudge-media:///C:/path or host+pathname
        filePath = decodeURIComponent(u.pathname || "");
        if (filePath.startsWith("/") && /^[A-Za-z]:/.test(filePath.slice(1))) {
          filePath = filePath.slice(1);
        }
      } else {
        filePath = decodeURIComponent(filePath);
      }
      filePath = resolve(normalize(filePath));
      const resolved = resolveExistingMediaPath(filePath);
      if (!resolved) {
        log.warn("[mediaProtocol] not found", filePath);
        callback({ error: -6 });
        return;
      }
      if (resolved !== filePath) {
        log.info("[mediaProtocol] texture fallback", filePath, "→", resolved);
      }
      callback({ path: resolved });
    } catch (e) {
      log.warn("[mediaProtocol] bad request", request.url, e);
      callback({ error: -2 });
    }
  });
  if (!ok) log.error("[mediaProtocol] registerFileProtocol failed");
  else log.info("[mediaProtocol] grudge-media:// streaming ready");
}

/** Build stream URL for <video>/<audio> src in renderer. */
export function mediaStreamUrl(absolutePath: string): string {
  const p = resolve(normalize(absolutePath));
  return `${MEDIA_SCHEME}://local/?path=${encodeURIComponent(p)}`;
}

export function isStreamableMediaPath(name: string): boolean {
  return /\.(mp4|webm|mov|m4v|ogv|mkv|avi|mp3|wav|ogg|flac|m4a|aac|opus)$/i.test(name);
}
