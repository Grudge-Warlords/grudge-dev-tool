import { app, BrowserWindow, dialog } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { autoUpdater } from "electron-updater";
import log from "./logger";
import { UPDATER_CHANNELS, type UpdaterStatus } from "../shared/ipc";

let installed = false;
let phase: UpdaterStatus["phase"] = "none";
let checking: Promise<unknown> | null = null;
let downloading: Promise<unknown> | null = null;
let installing = false;
let lastStatus: UpdaterStatus = { phase: "none" };
let replayStatus = () => {};

function updateSkipReason(): "dev" | "unconfigured" | undefined {
  if (!app.isPackaged) return "dev";
  // Locally built installers intentionally have no published update feed.
  return existsSync(join(process.resourcesPath, "app-update.yml")) ? undefined : "unconfigured";
}

export function getUpdaterStatus(): UpdaterStatus {
  return { ...lastStatus };
}

export function setupAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
  if (installed) return;
  installed = true;
  const skipReason = updateSkipReason();
  if (skipReason) {
    log.info(`[updater] ${skipReason} build — auto-update disabled`);
    return;
  }

  autoUpdater.logger = log;
  // Discovery, download, and installation are separate consent boundaries.
  // Periodic checks announce an update but never transfer or apply one.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  const sendStatus = (status: UpdaterStatus) => {
    phase = status.phase;
    lastStatus = status;
    getMainWindow()?.webContents.send(UPDATER_CHANNELS.status, status);
  };
  replayStatus = () => sendStatus(lastStatus);
  // Reloading the renderer must not discard a downloaded update's restart action.
  getMainWindow()?.webContents.on("did-finish-load", replayStatus);

  autoUpdater.on("checking-for-update", () => log.info("[updater] checking"));
  autoUpdater.on("update-available", (info) => {
    log.info("[updater] update-available", info?.version);
    sendStatus({ phase: "available", version: info?.version });
  });
  autoUpdater.on("update-not-available", () => {
    sendStatus({ phase: "none" });
  });
  autoUpdater.on("download-progress", (p) => {
    sendStatus({
      phase: "downloading",
      percent: p.percent,
      bytesPerSecond: p.bytesPerSecond,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    if (phase === "ready" || installing) return;
    log.info("[updater] downloaded", info?.version);
    sendStatus({ phase: "ready", version: info?.version });
    dialog.showMessageBox({
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 1,
      cancelId: 1,
      message: `Grudge Dev Tool ${info?.version} ready to install`,
      detail: "Restart to apply the update.",
    }).then((res) => {
      if (res.response === 0) quitAndInstall();
    }).catch(() => { /* ignore */ });
  });
  autoUpdater.on("error", (err) => {
    installing = false;
    log.warn("[updater] error", err?.message);
    sendStatus({ phase: "error", error: err?.message });
  });

  // First check 10s after launch; subsequent checks every 4 hours.
  const firstCheck = setTimeout(() => void checkForUpdatesNow().catch(() => { /* event reports error */ }), 10_000);
  const periodicCheck = setInterval(() => void checkForUpdatesNow().catch(() => { /* event reports error */ }), 4 * 60 * 60 * 1000);
  firstCheck.unref();
  periodicCheck.unref();
  app.once("before-quit", () => { clearTimeout(firstCheck); clearInterval(periodicCheck); });
}

export function checkForUpdatesNow(): Promise<unknown> {
  const skipped = updateSkipReason();
  if (skipped) return Promise.resolve({ skipped });
  if (downloading || phase === "ready" || installing) {
    replayStatus();
    return Promise.resolve({ skipped: "update-in-progress" });
  }
  if (checking) return checking;
  checking = Promise.resolve().then(() => autoUpdater.checkForUpdates()).finally(() => { checking = null; });
  return checking;
}

export function downloadUpdateNow(): Promise<unknown> {
  const skipped = updateSkipReason();
  if (skipped) return Promise.resolve({ skipped });
  if (downloading) return downloading;
  if (checking || phase !== "available" || installing) return Promise.reject(new Error("Check for an available update before downloading."));
  downloading = Promise.resolve().then(() => autoUpdater.downloadUpdate()).finally(() => { downloading = null; });
  return downloading;
}

export function quitAndInstall(): void {
  if (updateSkipReason() || installing) return;
  if (phase !== "ready") throw new Error("Download and verify an update before restarting to install it.");
  installing = true;
  try { autoUpdater.quitAndInstall(); }
  catch (error) { installing = false; throw error; }
}
