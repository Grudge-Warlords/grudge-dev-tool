/**
 * Stream local video/audio (and large files) into Elite Viewer without
 * loading the entire file into RAM as a blob.
 *
 * URL form: grudge-media://local/?path=<encodeURIComponent(absolutePath)>
 */

import { protocol } from "electron";
import { existsSync, statSync } from "node:fs";
import { normalize, resolve } from "node:path";
import log from "./logger";

export const MEDIA_SCHEME = "grudge-media";

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
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        log.warn("[mediaProtocol] not found", filePath);
        callback({ error: -6 });
        return;
      }
      callback({ path: filePath });
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
