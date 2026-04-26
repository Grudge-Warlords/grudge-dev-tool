import { app, BrowserWindow, ipcMain, shell, nativeImage, session, crashReporter, globalShortcut } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";
import * as windowState from "./windowState";
import { createTray, disposeTray } from "./tray";
import { showLoader, hideLoader, toggleLoader, getLoaderWindow, disposeLoader } from "./loader";
import * as api from "./api";
import { uploader } from "./uploader";
import * as bk from "./blenderkit/daemon";
import { detectAll } from "./ingestion/toolchain";
import { ingestOne } from "./ingestion";
import { initLogger, getLogFilePath } from "./logger";
import { startConnectivity, stopConnectivity, getConnectivity } from "./connectivity";
import { setupAutoUpdater, checkForUpdatesNow, quitAndInstall } from "./updater";
import { getCfStatus, readCf, writeCf, clearCf } from "./cf/credentials";
import { workerHealth } from "./cf/objectStoreWorker";
import { r2Health, resetR2Client } from "./cf/r2Direct";
import { workersAiChat, workersAiCaption, aiGatewayHealth, aiGatewayProxy } from "./cf/aiGateway";
import * as puterAuth from "./auth/puterSession";
import { puterLoginViaBrowser } from "./auth/puterLogin";
import {
  generateGrudgeUUID, parseGrudgeUUID, describeGrudgeUUID, isValidGrudgeUUID,
  SLOT_CODES, TIER_CODES,
} from "../shared/grudgeUUID";

initLogger();

// ---------------------------------------------------------------------------
// Crash reporter — local-only (no remote endpoint). Dumps go to
// %APPDATA%/Grudge Dev Tool/Crashpad/. Useful for postmortems on the user's
// machine without shipping any data anywhere.
// ---------------------------------------------------------------------------
crashReporter.start({
  productName: "Grudge Dev Tool",
  companyName: "Grudge Studio",
  submitURL: "",
  uploadToServer: false,
  ignoreSystemCrashHandler: false,
});

let mainWindow: BrowserWindow | null = null;

const RENDERER_DEV_URL = "http://localhost:5173";
const RENDERER_PROD_INDEX = join(__dirname, "..", "renderer", "index.html");

function windowIconPath(): string {
  const candidates = [
    join(process.resourcesPath ?? "", "icon-256.png"),
    join(__dirname, "..", "..", "resources", "icon-256.png"),
    join(__dirname, "..", "..", "..", "resources", "icon-256.png"),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return candidates[candidates.length - 1];
}

async function createMainWindow() {
  if (mainWindow) return;
  const state = await windowState.loadWindowState();
  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 720,
    minHeight: 540,
    show: false, // start hidden — only the tray is visible
    backgroundColor: "#0a0e1a",
    icon: nativeImage.createFromPath(windowIconPath()),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });
  if (state.maximized) mainWindow.maximize();
  windowState.track(mainWindow);

  // ---------------- Security hardening ----------------
  // Refuse navigation to anything outside the app shell, OAuth domains, and
  // the renderer dev server. Anchor links to the studio, the docs site, etc.
  // open in the user's default browser via shell.openExternal.
  const ALLOWED_NAV_HOSTS = /(^|\.)(puter\.com|puter\.site|grudge-studio\.com|grudgewarlords\.com|grudge-warlords\.github\.io)$/i;
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const u = new URL(url);
      if (u.protocol === "file:" && url.endsWith("index.html")) return;       // app reload
      if (u.protocol === "http:" && u.hostname === "localhost") return;        // dev server
      if (ALLOWED_NAV_HOSTS.test(u.hostname)) return;                          // OAuth
      event.preventDefault();
      shell.openExternal(url).catch(() => { /* ignore */ });
    } catch {
      event.preventDefault();
    }
  });
  // Deny every permission request by default — we don't need camera/mic/etc.
  // and the principle of least privilege is the right default for a dev tool.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  // Block remote-resource attacks via attached sub-frames the same way.
  mainWindow.webContents.on("did-attach-webview", (event) => event.preventDefault());

  if (!app.isPackaged) {
    mainWindow.loadURL(RENDERER_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(RENDERER_PROD_INDEX);
  }

  // Allow window.open() to *.puter.com / puter.site (Puter SDK OAuth popup).
  // External links go to the default browser; everything else is denied.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      const allowed = /(^|\.)puter\.(com|site)$/i.test(u.hostname);
      if (allowed) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            width: 520,
            height: 720,
            backgroundColor: "#0a0e1a",
            autoHideMenuBar: true,
            webPreferences: {
              contextIsolation: true,
              sandbox: true,
              nodeIntegration: false,
            },
          },
        };
      }
      shell.openExternal(url).catch(() => { /* ignore */ });
    } catch { /* not a URL; deny */ }
    return { action: "deny" };
  });

  // Closing the window only hides it — the app keeps running in the tray.
  mainWindow.on("close", (event) => {
    if (!(app as any).isQuiting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    await createMainWindow();
    createTray(() => mainWindow);
    registerIpc();
    // Window-scoped shortcuts (registered while the main window has focus).
    // We don't use globalShortcut here on purpose — those would steal Ctrl+R
    // from any other app system-wide.
    if (mainWindow) {
      mainWindow.webContents.on("before-input-event", (event, input) => {
        if (input.type !== "keyDown") return;
        const k = input.key.toLowerCase();
        const ctrlOrCmd = input.control || input.meta;
        if (ctrlOrCmd && k === "r")                       { mainWindow!.webContents.reload();           event.preventDefault(); }
        if (ctrlOrCmd && input.shift && k === "i")        { mainWindow!.webContents.toggleDevTools();   event.preventDefault(); }
        if (k === "f11")                                  {
          mainWindow!.setFullScreen(!mainWindow!.isFullScreen());
          event.preventDefault();
        }
        if (k === "escape" && mainWindow!.isFullScreen()) { mainWindow!.setFullScreen(false);          event.preventDefault(); }
      });
    }
    // Broadcast upload progress to BOTH windows (main + GrudgeLoader).
    const allWindows = (): BrowserWindow[] => {
      const out: BrowserWindow[] = [];
      if (mainWindow && !mainWindow.isDestroyed()) out.push(mainWindow);
      const lw = getLoaderWindow();
      if (lw && !lw.isDestroyed()) out.push(lw);
      return out;
    };
    const broadcast = (channel: string, payload: any) => {
      for (const w of allWindows()) w.webContents.send(channel, payload);
    };
    uploader.on("progress", (p) => broadcast("upload:progress", p));
    uploader.on("job:done", (p) => broadcast("upload:job-done", p));

    // Connectivity probe — every 30s, broadcast to all windows.
    startConnectivity(allWindows, 30_000);

    // Auto-update (no-op in dev).
    setupAutoUpdater(() => mainWindow);
  });
}

app.on("window-all-closed", () => {
  // Registering this listener (even empty) prevents the default "quit"
  // behavior, keeping the app alive in the tray on all platforms.
});

app.on("before-quit", () => {
  (app as any).isQuiting = true;
  stopConnectivity();
  disposeTray();
  disposeLoader();
  bk.shutdownSpawned();
});

// ---------------------------------------------------------------------------
// IPC bridge — every channel name is mirrored in src/preload/preload.ts.
// ---------------------------------------------------------------------------
function registerIpc() {
  // Settings
  ipcMain.handle("settings:get", async () => ({
    apiBaseUrl: await api.getApiBaseUrl(),
    cdnBaseUrl: "https://assets.grudge-studio.com",
    hasToken: Boolean(await api.getToken()),
    hasBlenderKitKey: Boolean(await bk.getApiKey()),
  }));
  ipcMain.handle("settings:setApiBase", (_e, url: string) => api.setApiBaseUrl(url));
  ipcMain.handle("settings:setToken", (_e, token: string) => api.setToken(token));
  ipcMain.handle("settings:clearToken", () => api.clearToken());
  ipcMain.handle("settings:setBlenderKitKey", (_e, key: string) => bk.setApiKey(key));
  ipcMain.handle("settings:clearBlenderKitKey", () => bk.clearApiKey());
  ipcMain.handle("settings:toolchain", async () => detectAll());

  // Object storage
  ipcMain.handle("os:list", (_e, req) => api.listObjects(req));
  ipcMain.handle("os:search", (_e, req) => api.searchObjects(req));
  ipcMain.handle("os:assetMeta", (_e, req) => api.getAssetMeta(req));
  ipcMain.handle("os:openExternal", (_e, url: string) => shell.openExternal(url));

  // Upload
  ipcMain.handle("upload:enqueue", (_e, job) => {
    uploader.enqueue(job);
    return { ok: true, jobId: job.id };
  });
  ipcMain.handle("upload:cancel", (_e, jobId: string) => uploader.cancel(jobId));

  // Ingestion (single file run, used by the Upload page preview)
  ipcMain.handle("ingest:one", (_e, args) => ingestOne(args.path, args.opts));

  // BlenderKit
  ipcMain.handle("bk:search", (_e, opts) => bk.searchAssets(opts));
  ipcMain.handle("bk:download", (_e, opts) => bk.downloadAsset(opts));
  ipcMain.handle("bk:report", () => bk.getReport());
  ipcMain.handle("bk:ensure", () => bk.ensureDaemon());

  // GrudgeLoader window control
  ipcMain.handle("loader:show",   () => { showLoader(); });
  ipcMain.handle("loader:hide",   () => { hideLoader(); });
  ipcMain.handle("loader:toggle", () => { toggleLoader(); });

  // Connectivity
  ipcMain.handle("connectivity:get", () => getConnectivity());

  // Updater
  ipcMain.handle("updater:check",   () => checkForUpdatesNow());
  ipcMain.handle("updater:install", () => { quitAndInstall(); });

  // Auto-launch on Windows startup
  ipcMain.handle("settings:getAutoLaunch", () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle("settings:setAutoLaunch", (_e, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: !!enabled, openAsHidden: true });
    return app.getLoginItemSettings().openAtLogin;
  });

  // Diagnostics
  ipcMain.handle("diag:logFile", () => getLogFilePath());
  ipcMain.handle("diag:openLogFolder", () => shell.openPath(join(app.getPath("userData"), "logs")));

  // App lifecycle (so the renderer can offer a real Quit)
  ipcMain.handle("app:quit", () => { (app as any).isQuiting = true; app.quit(); });
  ipcMain.handle("app:hide", () => { mainWindow?.hide(); });

  // Puter auth + Grudge identity
  ipcMain.handle("auth:getSession",   () => puterAuth.getSession());
  ipcMain.handle("auth:setSession",   (_e, token: string, user: any) => puterAuth.setSession(token, user));
  ipcMain.handle("auth:clearSession", () => puterAuth.clearSession());
  ipcMain.handle("auth:wipeIdentity", () => puterAuth.wipeIdentity());
  ipcMain.handle("auth:getPuterToken", () => puterAuth.getPuterToken());
  // Browser-based Puter login (opens default browser via getAuthToken).
  // Returns { grudgeId, user } so the renderer can refresh its session.
  ipcMain.handle("auth:puterLogin", async () => {
    const { token, user } = await puterLoginViaBrowser();
    const r = await puterAuth.setSession(token, user);
    return { grudgeId: r.grudgeId, user };
  });

  // Cloudflare backend
  ipcMain.handle("cf:status",          () => getCfStatus());
  ipcMain.handle("cf:set",             (_e, account: any, value: string) => writeCf(account, value));
  ipcMain.handle("cf:clear",           (_e, account: any) => clearCf(account));
  ipcMain.handle("cf:workerHealth",    () => workerHealth());
  ipcMain.handle("cf:r2Health",        () => r2Health());
  ipcMain.handle("cf:resetR2Client",   () => { resetR2Client(); });
  ipcMain.handle("cf:aiHealth",        () => aiGatewayHealth());
  ipcMain.handle("cf:getBackendMode",  () => api.getBackendMode());
  ipcMain.handle("cf:setBackendMode",  (_e, mode: any) => api.setBackendMode(mode));

  // AI Gateway
  ipcMain.handle("ai:chat",     (_e, opts) => workersAiChat(opts));
  ipcMain.handle("ai:caption",  (_e, opts) => workersAiCaption(opts));
  ipcMain.handle("ai:proxy",    (_e, opts) => aiGatewayProxy(opts));

  // UUID utilities (local, no network)
  ipcMain.handle("uuid:gen", (_e, args) =>
    ({ uuid: generateGrudgeUUID(args.slot, args.tier ?? null, args.itemId ?? 1) }));
  ipcMain.handle("uuid:parse", (_e, uuid: string) => parseGrudgeUUID(uuid));
  ipcMain.handle("uuid:describe", (_e, uuid: string) => describeGrudgeUUID(uuid));
  ipcMain.handle("uuid:valid", (_e, uuid: string) => isValidGrudgeUUID(uuid));
  ipcMain.handle("uuid:slots", () => SLOT_CODES);
  ipcMain.handle("uuid:tiers", () => TIER_CODES);
}
