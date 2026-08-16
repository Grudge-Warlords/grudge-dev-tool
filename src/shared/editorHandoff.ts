/**
 * Editor handoff SSOT — Elite preview stays local; scene edit is ThreeFlow;
 * Forge remains the live R3F + Rapier deploy editor.
 *
 * Query contract (both hosts):
 *   ?asset=<https CDN url>  (primary)
 *   ?mesh=<same>            (Forge older key)
 *   ?from=grudge-dev-tool
 *   ?intent=asset
 */
import { FLEET_URLS } from "./fleet";
import { DEFAULT_PLUGIN_PORT } from "./plugin/contract";

export type EditorSurface = "threeflow" | "forge" | "elite";

export function isPublicCdnUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  return /^https?:\/\//i.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/i.test(url);
}

function withExtra(u: URL, extra?: Record<string, string>): void {
  if (!extra) return;
  for (const [k, v] of Object.entries(extra)) {
    if (v != null && v !== "") u.searchParams.set(k, v);
  }
}

/** ThreeFlow — best Warlords scene editor (Vue + r185 production loader). */
export function threeflowAssetUrl(cdnUrl: string, extra?: Record<string, string>): string {
  const u = new URL(FLEET_URLS.threeflow);
  u.searchParams.set("intent", "asset");
  u.searchParams.set("asset", cdnUrl);
  u.searchParams.set("from", "grudge-dev-tool");
  withExtra(u, extra);
  return u.toString();
}

/** Production Forge — R3F + Rapier + .gfscene deploy. */
export function forgeStudioAssetUrl(cdnUrl: string, extra?: Record<string, string>): string {
  const u = new URL(FLEET_URLS.forge);
  u.searchParams.set("edit", "1");
  u.searchParams.set("mode", "edit");
  u.searchParams.set("from", "grudge-dev-tool");
  u.searchParams.set("asset", cdnUrl);
  u.searchParams.set("mesh", cdnUrl);
  withExtra(u, extra);
  return u.toString();
}

/** Loopback mesh URL so live ThreeFlow can load a disk file (plugin host). */
export function localLoopbackAssetUrl(
  absPath: string,
  port = DEFAULT_PLUGIN_PORT,
): string {
  const p = absPath.replace(/\\/g, "/");
  return `http://127.0.0.1:${port}/v1/local-file?path=${encodeURIComponent(p)}`;
}

/** Default live editor for a production mesh is ThreeFlow. */
export function bestEditorUrl(
  cdnUrl: string,
  prefer: Exclude<EditorSurface, "elite"> = "threeflow",
): string {
  return prefer === "forge" ? forgeStudioAssetUrl(cdnUrl) : threeflowAssetUrl(cdnUrl);
}
