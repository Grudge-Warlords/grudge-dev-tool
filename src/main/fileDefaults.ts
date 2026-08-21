/**
 * Per-user Windows file-type registration for Grudge Dev Tool elite viewer.
 *
 * Writes HKCU ProgIDs + Capabilities so:
 *  - "Open with → Grudge Dev Tool" works for all viewer extensions
 *  - Extension default ProgID points at us (user-level; no admin)
 *  - App appears under Windows Settings → Default apps
 *
 * Note: Windows 10/11 may still show a one-time "keep using / switch" toast for
 * some types; we also open ms-settings:defaultapps for residual picks.
 */

import { app, shell } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VIEWER_EXTS } from "./openFileBridge";
import log from "./logger";

const execFileAsync = promisify(execFile);

const APP_ID = "GrudgeDevTool";
const APP_NAME = "Grudge Dev Tool";
const CAP_PATH = `Software\\${APP_ID}\\Capabilities`;

function exePath(): string {
  // Packaged: process.execPath is the app. Dev: electron.exe — still works for testing.
  return process.execPath;
}

function iconPath(): string {
  const candidates = [
    join(process.resourcesPath ?? "", "icon.ico"),
    join(app.getAppPath(), "resources", "icon.ico"),
    join(__dirname, "..", "..", "resources", "icon.ico"),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return exePath();
}

function progIdForExt(extWithDot: string): string {
  const bare = extWithDot.replace(/^\./, "").toLowerCase();
  return `${APP_ID}.${bare}`;
}

function friendlyName(extWithDot: string): string {
  const bare = extWithDot.replace(/^\./, "").toUpperCase();
  return `${APP_NAME} ${bare}`;
}

async function regAdd(key: string, valueName: string | null, data: string, type: "REG_SZ" = "REG_SZ") {
  const args = ["add", key, "/f", "/t", type];
  if (valueName === null || valueName === "") {
    args.push("/ve", "/d", data);
  } else {
    args.push("/v", valueName, "/d", data);
  }
  try {
    await execFileAsync("reg", args, { windowsHide: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // reg writes stderr on success sometimes; rethrow only if real fail
    if (/ERROR/i.test(msg) || /Access is denied/i.test(msg)) throw e;
    log.warn("[fileDefaults] reg add warn", key, msg.slice(0, 120));
  }
}

async function regQuery(key: string, valueName?: string): Promise<string | null> {
  try {
    const args = ["query", key];
    if (valueName) args.push("/v", valueName);
    else args.push("/ve");
    const { stdout } = await execFileAsync("reg", args, { windowsHide: true });
    const m = stdout.match(/REG_SZ\s+(.+)\s*$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

export interface ExtStatus {
  ext: string;
  progId: string;
  isDefault: boolean;
  current: string | null;
}

export interface DefaultsStatus {
  platform: string;
  exe: string;
  registered: number;
  defaults: number;
  total: number;
  extensions: ExtStatus[];
  packaged: boolean;
}

/** Register app capabilities + set each extension's user ProgID to Grudge. */
export async function setAllAsDefault(): Promise<{
  ok: true;
  registered: number;
  total: number;
  exe: string;
} | { ok: false; error: string }> {
  if (process.platform !== "win32") {
    return { ok: false, error: "File default registration is Windows-only in this build." };
  }
  const exe = exePath();
  const icon = iconPath();
  const openCmd = `"${exe}" "%1"`;
  const iconVal = icon.toLowerCase().endsWith(".ico") ? `"${icon}",0` : `"${exe}",0`;

  const exts = [...VIEWER_EXTS];
  let registered = 0;

  try {
    // Application capabilities (shows under Default apps by app)
    await regAdd(`HKCU\\${CAP_PATH}`, "ApplicationName", APP_NAME);
    await regAdd(
      `HKCU\\${CAP_PATH}`,
      "ApplicationDescription",
      "Grudge Three Pipeline — 3D, images, audio, video, text, PDF",
    );
    await regAdd(
      `HKCU\\Software\\RegisteredApplications`,
      APP_NAME,
      CAP_PATH,
    );

    for (const ext of exts) {
      const bare = ext.replace(/^\./, "").toLowerCase();
      const progId = progIdForExt(ext);
      const label = friendlyName(ext);

      // ProgID
      await regAdd(`HKCU\\Software\\Classes\\${progId}`, null, label);
      await regAdd(`HKCU\\Software\\Classes\\${progId}\\DefaultIcon`, null, iconVal);
      await regAdd(`HKCU\\Software\\Classes\\${progId}\\shell\\open\\command`, null, openCmd);

      // Extension → our ProgID (user default when no locked UserChoice)
      await regAdd(`HKCU\\Software\\Classes\\${ext}`, null, progId);
      // OpenWithProgids so we always appear in Open with
      await regAdd(`HKCU\\Software\\Classes\\${ext}\\OpenWithProgids`, progId, "");

      // Capabilities file association map
      await regAdd(`HKCU\\${CAP_PATH}\\FileAssociations`, ext, progId);

      registered++;
      void bare;
    }

    // Notify shell of association change
    try {
      await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "[System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::StringToHGlobalUni('')) | Out-Null; " +
            "Add-Type -Namespace Win32 -Name Native -MemberDefinition '[DllImport(\"shell32.dll\")] public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);'; " +
            "[Win32.Native]::SHChangeNotify(0x8000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)",
        ],
        { windowsHide: true },
      );
    } catch {
      /* non-fatal */
    }

    log.info(`[fileDefaults] registered ${registered}/${exts.length} types → ${exe}`);
    return { ok: true, registered, total: exts.length, exe };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("[fileDefaults] setAllAsDefault failed", msg);
    return { ok: false, error: msg };
  }
}

export async function getDefaultsStatus(): Promise<DefaultsStatus> {
  const exts = [...VIEWER_EXTS];
  const extensions: ExtStatus[] = [];
  let defaults = 0;
  let registered = 0;

  for (const ext of exts) {
    const progId = progIdForExt(ext);
    const current = process.platform === "win32"
      ? await regQuery(`HKCU\\Software\\Classes\\${ext}`)
      : null;
    const cmd = process.platform === "win32"
      ? await regQuery(`HKCU\\Software\\Classes\\${progId}\\shell\\open\\command`)
      : null;
    const isDefault = current === progId;
    if (isDefault) defaults++;
    if (
      isDefault ||
      (cmd && (cmd.includes("Grudge") || cmd.includes(exePath()) || cmd.includes("electron")))
    ) {
      registered++;
    }
    extensions.push({ ext, progId, isDefault, current });
  }

  return {
    platform: process.platform,
    exe: exePath(),
    registered,
    defaults,
    total: exts.length,
    extensions,
    packaged: app.isPackaged,
  };
}

/** Open Windows Settings → Default apps (user can confirm residual types). */
export async function openSystemDefaultApps(): Promise<{ ok: true }> {
  try {
    await shell.openExternal("ms-settings:defaultapps");
  } catch {
    await shell.openExternal("ms-settings:default-apps");
  }
  return { ok: true };
}

export async function clearOurProgIds(): Promise<{ ok: true; cleared: number }> {
  if (process.platform !== "win32") return { ok: true, cleared: 0 };
  let cleared = 0;
  for (const ext of VIEWER_EXTS) {
    const progId = progIdForExt(ext);
    try {
      await execFileAsync("reg", ["delete", `HKCU\\Software\\Classes\\${progId}`, "/f"], {
        windowsHide: true,
      });
      cleared++;
    } catch {
      /* not present */
    }
  }
  return { ok: true, cleared };
}

/**
 * Packaged first launch: register HKCU file types so Explorer double-click
 * opens the Grudge Three Pipeline. One-shot (marker in userData) so Clear
 * is not immediately undone.
 */
export async function ensureFileDefaultsOnLaunch(): Promise<void> {
  if (process.platform !== "win32") return;
  if (!app.isPackaged) return;
  const marker = join(app.getPath("userData"), "file-defaults-auto.json");
  if (existsSync(marker)) return;
  try {
    const st = await getDefaultsStatus();
    if (st.defaults === 0) {
      const r = await setAllAsDefault();
      log.info(
        `[fileDefaults] auto-register on launch ok=${r.ok} registered=${r.ok ? r.registered : 0}`,
      );
    }
    writeFileSync(
      marker,
      JSON.stringify({ at: Date.now(), defaultsBefore: st.defaults }),
    );
  } catch (e: unknown) {
    log.warn(
      "[fileDefaults] auto-register skipped",
      e instanceof Error ? e.message : String(e),
    );
  }
}
