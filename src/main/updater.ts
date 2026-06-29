import { app, BrowserWindow, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import log from "./logger";

let installed = false;

export function setupAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
  if (installed) return;
  installed = true;
  if (!app.isPackaged) {
    log.info("[updater] dev build — auto-update disabled");
    return;
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => log.info("[updater] checking"));
  autoUpdater.on("update-available", (info) => {
    log.info("[updater] update-available", info?.version);
    getMainWindow()?.webContents.send("updater:status", { phase: "available", version: info?.version });
  });
  autoUpdater.on("update-not-available", () => {
    getMainWindow()?.webContents.send("updater:status", { phase: "none" });
  });
  autoUpdater.on("download-progress", (p) => {
    getMainWindow()?.webContents.send("updater:status", {
      phase: "downloading",
      percent: p.percent,
      bytesPerSecond: p.bytesPerSecond,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    log.info("[updater] downloaded", info?.version);
    getMainWindow()?.webContents.send("updater:status", { phase: "ready", version: info?.version });
    dialog.showMessageBox({
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      message: `Grudge Dev Tool ${info?.version} ready to install`,
      detail: "Restart to apply the update.",
    }).then((res) => {
      if (res.response === 0) autoUpdater.quitAndInstall();
    }).catch(() => { /* ignore */ });
  });
  autoUpdater.on("error", (err) => {
    log.warn("[updater] error", err?.message);
    getMainWindow()?.webContents.send("updater:status", { phase: "error", error: err?.message });
  });

  // First check 10s after launch; subsequent checks every 4 hours.
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => { /* ignore */ }), 10_000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => { /* ignore */ }), 4 * 60 * 60 * 1000);
}

export function checkForUpdatesNow(): Promise<unknown> {
  if (!app.isPackaged) return Promise.resolve({ skipped: "dev" });
  return autoUpdater.checkForUpdates();
}

export function quitAndInstall(): void {
  if (app.isPackaged) autoUpdater.quitAndInstall();
}
