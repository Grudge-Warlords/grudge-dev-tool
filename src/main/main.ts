import { app, BrowserWindow, ipcMain, shell, nativeImage } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";
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
import {
  generateGrudgeUUID, parseGrudgeUUID, describeGrudgeUUID, isValidGrudgeUUID,
  SLOT_CODES, TIER_CODES,
} from "../shared/grudgeUUID";

initLogger();

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

function createMainWindow() {
  if (mainWindow) return;
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false, // start hidden — only the tray is visible
    backgroundColor: "#0a0e1a",
    icon: nativeImage.createFromPath(windowIconPath()),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (!app.isPackaged) {
    mainWindow.loadURL(RENDERER_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(RENDERER_PROD_INDEX);
  }

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

  app.whenReady().then(() => {
    createMainWindow();
    createTray(() => mainWindow);
    registerIpc();
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

  // UUID utilities (local, no network)
  ipcMain.handle("uuid:gen", (_e, args) =>
    ({ uuid: generateGrudgeUUID(args.slot, args.tier ?? null, args.itemId ?? 1) }));
  ipcMain.handle("uuid:parse", (_e, uuid: string) => parseGrudgeUUID(uuid));
  ipcMain.handle("uuid:describe", (_e, uuid: string) => describeGrudgeUUID(uuid));
  ipcMain.handle("uuid:valid", (_e, uuid: string) => isValidGrudgeUUID(uuid));
  ipcMain.handle("uuid:slots", () => SLOT_CODES);
  ipcMain.handle("uuid:tiers", () => TIER_CODES);
}
