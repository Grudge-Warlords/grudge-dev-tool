import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const nodeRequire = createRequire(import.meta.url);
const root = await mkdtemp(join(tmpdir(), "grudge-updater-guard-"));
const previousResourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");
Object.defineProperty(process, "resourcesPath", { value: root, configurable: true });
const app = Object.assign(new EventEmitter(), { isPackaged: true });
const updater = new EventEmitter();
let checks = 0, downloads = 0, installs = 0, dialogs = 0;
let finishCheck, finishDownload;
updater.checkForUpdates = () => { checks++; return new Promise((resolve) => { finishCheck = resolve; }); };
updater.downloadUpdate = () => { downloads++; return new Promise((resolve) => { finishDownload = resolve; }); };
updater.quitAndInstall = () => { installs++; };
try {
  const bundled = await build({
    entryPoints: [resolve("src/main/updater.ts")], bundle: true, write: false, platform: "node", format: "cjs",
    external: ["electron", "electron-updater"],
    plugins: [{ name: "quiet-logger", setup(plugin) {
      plugin.onResolve({ filter: /^\.\/logger$/ }, () => ({ path: "logger", namespace: "stub" }));
      plugin.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export default { info() {}, warn() {} };", loader: "js" }));
    } }],
  });
  const module = { exports: {} };
  const require = (id) => id === "electron" ? { app, dialog: { showMessageBox: async () => { dialogs++; return { response: 1 }; } } }
    : id === "electron-updater" ? { autoUpdater: updater } : nodeRequire(id);
  new Function("require", "module", "exports", bundled.outputFiles[0].text)(require, module, module.exports);
  const api = module.exports;
  assert.deepEqual(await api.checkForUpdatesNow(), { skipped: "unconfigured" });
  assert.deepEqual(await api.downloadUpdateNow(), { skipped: "unconfigured" });
  assert.equal(checks + downloads, 0);
  await writeFile(join(root, "app-update.yml"), "provider: generic\nurl: https://example.invalid/updates\n");
  api.setupAutoUpdater(() => null);
  api.setupAutoUpdater(() => null);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.throws(() => api.quitAndInstall(), /Download and verify/);
  await assert.rejects(api.downloadUpdateNow(), /available update/);
  const check1 = api.checkForUpdatesNow();
  const check2 = api.checkForUpdatesNow();
  assert.equal(check1, check2, "concurrent checks share one request");
  await Promise.resolve();
  assert.equal(checks, 1);
  updater.emit("update-available", { version: "1.1.1" });
  await assert.rejects(api.downloadUpdateNow(), /available update/);
  finishCheck({ updateInfo: { version: "1.1.1" } });
  await check1;
  const download1 = api.downloadUpdateNow();
  const download2 = api.downloadUpdateNow();
  assert.equal(download1, download2, "double click cannot duplicate a download");
  await Promise.resolve();
  assert.equal(downloads, 1);
  assert.deepEqual(await api.checkForUpdatesNow(), { skipped: "update-in-progress" });
  updater.emit("download-progress", { percent: 50, bytesPerSecond: 1000 });
  assert.throws(() => api.quitAndInstall(), /Download and verify/);
  updater.emit("update-downloaded", { version: "1.1.1" });
  updater.emit("update-downloaded", { version: "1.1.1" });
  finishDownload([]);
  await download1;
  assert.equal(dialogs, 1);
  assert.equal(api.getUpdaterStatus().phase, "ready", "a reloaded renderer can read retained status without a network check");
  assert.equal(installs, 0, "Later must not install");
  api.quitAndInstall();
  api.quitAndInstall();
  assert.equal(installs, 1);
  updater.emit("error", new Error("Installer could not start"));
  assert.equal(api.getUpdaterStatus().phase, "error");
  const recoveryCheck = api.checkForUpdatesNow();
  await Promise.resolve();
  assert.equal(checks, 2, "an event-reported install error must release the install latch");
  updater.emit("update-available", { version: "1.1.1" });
  finishCheck({ updateInfo: { version: "1.1.1" } });
  await recoveryCheck;
  console.log("Updater missing-feed, state, duplicate-action and explicit-install checks passed.");
} finally {
  app.emit("before-quit");
  if (previousResourcesPath) Object.defineProperty(process, "resourcesPath", previousResourcesPath);
  else delete process.resourcesPath;
  const target = resolve(root);
  assert.ok(target.startsWith(resolve(tmpdir()) + "/") || target.startsWith(resolve(tmpdir()) + "\\"));
  assert.ok(target.includes("grudge-updater-guard-"));
  await rm(target, { recursive: true, force: true });
}
