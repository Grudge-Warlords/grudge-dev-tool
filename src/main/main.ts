import { app, BrowserWindow, ipcMain, shell, nativeImage, session, crashReporter, dialog } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import * as windowState from "./windowState";
import { createTray, disposeTray } from "./tray";
import { showLoader, hideLoader, toggleLoader, getLoaderWindow, disposeLoader } from "./loader";
import * as api from "./api";
import { uploader } from "./uploader";
import * as bk from "./blenderkit/daemon";
import { detectAll } from "./ingestion/toolchain";
import { ingestOne } from "./ingestion";
import { inspectModel } from "./ingestion/modelInspect";
import { extractZip } from "./ingestion/archive";
import { initLogger, getLogFilePath } from "./logger";
import { startConnectivity, stopConnectivity, getConnectivity } from "./connectivity";
import { setupAutoUpdater, checkForUpdatesNow, quitAndInstall } from "./updater";
import { getCfStatus, readCf, writeCf, clearCf } from "./cf/credentials";
import { workerHealth } from "./cf/objectStoreWorker";
import { r2Health, resetR2Client, r2GetSignedUploadUrl, r2GetSignedDownloadUrl, r2List, r2PublicUrl, r2Head } from "./cf/r2Direct";
import * as forge from "./forge";
import * as coder from "./coder";
import { workersAiChat, workersAiCaption, aiGatewayHealth, aiGatewayProxy } from "./cf/aiGateway";
import * as ollama from "./ollama";
import * as legion from "./legion/orchestrator";
import * as whisper from "./legion/whisper";
import { FLEET_GAMES, STORE_CATEGORIES } from "../shared/fleetGames";
import { FLEET_ENDPOINTS } from "../shared/fleetConnections";
import * as workspaceStore from "./workspaceStore";
import * as puterAuth from "./auth/puterSession";
import { puterLoginViaBrowser } from "./auth/puterLogin";
import {
  generateGrudgeUUID, parseGrudgeUUID, describeGrudgeUUID, isValidGrudgeUUID,
  SLOT_CODES, TIER_CODES,
} from "../shared/grudgeUUID";

initLogger();
forge.captureInitialArgv();

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
      // Required for the internal Preview page (renderer uses <webview>).
      // Locked down in did-attach-webview below.
      webviewTag: true,
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
  // Deny camera/mic by default; allow media only for Legion voice (Dist2 orb).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === "media") callback(true);
    else callback(false);
  });
  // Lock down every <webview> the renderer attaches: no preload, no node,
  // sandboxed, context-isolated. We don't prevent attach (the Preview page
  // needs it) but we force-strip anything risky the renderer could request.
  // `will-attach-webview` fires before the guest is created, so this is the
  // only event where mutating webPreferences actually does anything.
  mainWindow.webContents.on("will-attach-webview", (_event, webPreferences) => {
    delete webPreferences.preload;
    delete (webPreferences as { preloadURL?: string }).preloadURL;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    webPreferences.experimentalFeatures = false;
  });

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
  app.on("second-instance", (_event, argv) => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
    forge.captureSecondInstanceArgv(argv, mainWindow);
  });

  app.whenReady().then(async () => {
    await createMainWindow();
    createTray(() => mainWindow);
    registerIpc();
    // If we were launched with a file, push it to the renderer once loaded.
    if (mainWindow) forge.flushPendingTo(mainWindow);
    // Window-scoped shortcuts (registered while the main window has focus).
    // We don't use globalShortcut here on purpose — those would steal Ctrl+R
    // from any other app system-wide.
    if (mainWindow) {
      mainWindow.webContents.on("before-input-event", (event, input) => {
        if (input.type !== "keyDown") return;
        const k = input.key.toLowerCase();
        const ctrlOrCmd = input.control || input.meta;
        if (ctrlOrCmd && k === "r") { mainWindow!.webContents.reload(); event.preventDefault(); }
        if (ctrlOrCmd && input.shift && k === "i") { mainWindow!.webContents.toggleDevTools(); event.preventDefault(); }
        if (k === "f11") {
          mainWindow!.setFullScreen(!mainWindow!.isFullScreen());
          event.preventDefault();
        }
        if (k === "escape" && mainWindow!.isFullScreen()) { mainWindow!.setFullScreen(false); event.preventDefault(); }
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
  coder.shutdownCoder();
});

// ---------------------------------------------------------------------------
// IPC bridge — every channel name is mirrored in src/preload/preload.ts.
// ---------------------------------------------------------------------------
function registerIpc() {
  // Settings
  ipcMain.handle("settings:get", async () => ({
    apiBaseUrl: await api.getApiBaseUrl(),
    assetsApiBaseUrl: await api.getAssetsApiBaseUrl(),
    cdnBaseUrl: "https://assets.grudge-studio.com",
    hasToken: Boolean(await api.getToken()),
    hasBlenderKitKey: Boolean(await bk.getApiKey()),
  }));
  ipcMain.handle("settings:setApiBase", (_e, url: string) => api.setApiBaseUrl(url));
  ipcMain.handle("settings:setAssetsApiBase", (_e, url: string) => api.setAssetsApiBaseUrl(url));
  ipcMain.handle("settings:clearAssetsApiBase", () => api.clearAssetsApiBaseUrl());
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
  ipcMain.handle("loader:show", () => { showLoader(); });
  ipcMain.handle("loader:hide", () => { hideLoader(); });
  ipcMain.handle("loader:toggle", () => { toggleLoader(); });

  // Connectivity
  ipcMain.handle("connectivity:get", () => getConnectivity());

  // Updater
  ipcMain.handle("updater:check", () => checkForUpdatesNow());
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
  ipcMain.handle("auth:getSession", () => puterAuth.getSession());
  ipcMain.handle("auth:setSession", (_e, token: string, user: any) => puterAuth.setSession(token, user));
  ipcMain.handle("auth:clearSession", () => puterAuth.clearSession());
  ipcMain.handle("auth:wipeIdentity", () => puterAuth.wipeIdentity());
  ipcMain.handle("auth:getPuterToken", () => puterAuth.getPuterToken());
  // Browser-based Puter login (opens default browser via getAuthToken).
  // Returns { grudgeId, user } so the renderer can refresh its session.
  ipcMain.handle("auth:puterLogin", async () => {
    try {
      const { token, user } = await puterLoginViaBrowser();
      const r = await puterAuth.setSession(token, user);
      return { grudgeId: r.grudgeId, user: { uuid: user.uuid, username: user.username, email: user.email } };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error("[auth:puterLogin] FAILED:", msg);
      throw new Error(`Sign-in failed: ${msg}`);
    }
  });

  // Cloudflare backend
  ipcMain.handle("cf:status", () => getCfStatus());
  ipcMain.handle("cf:set", (_e, account: any, value: string) => writeCf(account, value));
  ipcMain.handle("cf:clear", (_e, account: any) => clearCf(account));
  ipcMain.handle("cf:workerHealth", () => workerHealth());
  ipcMain.handle("cf:r2Health", () => r2Health());
  ipcMain.handle("cf:resetR2Client", () => { resetR2Client(); });
  ipcMain.handle("cf:aiHealth", () => aiGatewayHealth());
  ipcMain.handle("cf:getBackendMode", () => api.getBackendMode());
  ipcMain.handle("cf:setBackendMode", (_e, mode: any) => api.setBackendMode(mode));

  // Direct R2 ops used by Forge3D (signed PUT/GET, list, head, public URL).
  ipcMain.handle("cf:r2SignedUpload", async (_e, args: { key: string; contentType?: string; ttlSeconds?: number }) => {
    try {
      const url = await r2GetSignedUploadUrl(args.key, args.contentType, args.ttlSeconds ?? 900);
      return { ok: true, url };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
  ipcMain.handle("cf:r2SignedDownload", async (_e, args: { key: string; ttlSeconds?: number }) => {
    try {
      const url = await r2GetSignedDownloadUrl(args.key, args.ttlSeconds ?? 600);
      return { ok: true, url };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
  ipcMain.handle("cf:r2List", (_e, req) => r2List(req));
  ipcMain.handle("cf:r2Head", (_e, key: string) => r2Head(key));
  ipcMain.handle("cf:r2PublicUrl", (_e, key: string) => r2PublicUrl(key));

  // Forge3D — "Open with..." + read file from disk for renderer.
  ipcMain.handle("forge:consumeInitialFile", () => forge.consumeInitialFile());
  ipcMain.handle("forge:readFile", async (_e, pathOrObj: unknown) => forge.readModelFile(pathOrObj));

  // Forge3D pop-out canvas — creates a detached borderless viewport window.
  let popOutWin: BrowserWindow | null = null;
  ipcMain.handle("forge:popOut", () => {
    if (popOutWin && !popOutWin.isDestroyed()) {
      popOutWin.focus();
      return { ok: true, alreadyOpen: true };
    }
    popOutWin = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 640,
      minHeight: 480,
      frame: false,
      transparent: false,
      backgroundColor: "#0a0e1a",
      alwaysOnTop: false,
      icon: nativeImage.createFromPath(windowIconPath()),
      title: "Forge 3D — Pop-out Canvas",
      webPreferences: {
        preload: join(__dirname, "..", "preload", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    // Load the same renderer but with a hash route hint
    if (!app.isPackaged) {
      popOutWin.loadURL(`${RENDERER_DEV_URL}#/forge-popout`);
    } else {
      popOutWin.loadFile(RENDERER_PROD_INDEX, { hash: "/forge-popout" });
    }
    popOutWin.on("closed", () => { popOutWin = null; });
    return { ok: true, alreadyOpen: false };
  });

  // AI Gateway
  ipcMain.handle("ai:chat", (_e, opts) => workersAiChat(opts));
  ipcMain.handle("ai:caption", (_e, opts) => workersAiCaption(opts));
  ipcMain.handle("ai:proxy", (_e, opts) => aiGatewayProxy(opts));

  // Coder (local GrudachainCode IDE)
  ipcMain.handle("coder:launch", (_e, opts) => coder.launch(opts));
  ipcMain.handle("coder:stop", () => coder.stop());
  ipcMain.handle("coder:status", () => coder.getStatus());
  ipcMain.handle("coder:open", () => { coder.openInBrowser(); });

  // Model inspection (gltf-transform scene graph — parent/child tree, meshes, materials, skins, animations)
  ipcMain.handle("model:inspect", (_e, path: string) => inspectModel(path));

  // Archive extraction (fflate unzip — for asset pack imports and Sketchfab downloads)
  ipcMain.handle("archive:unzip", (_e, path: string, destDir?: string) => extractZip(path, destDir));

  // Internal Preview tab — pick a local .html/.htm file and hand its file:// URL
  // back to the renderer, which loads it into a sandboxed <webview>.
  ipcMain.handle("preview:openHtmlDialog", async () => {
    if (!mainWindow) return { canceled: true, url: null, path: null };
    const r = await dialog.showOpenDialog(mainWindow, {
      title: "Open local HTML file",
      properties: ["openFile"],
      filters: [
        { name: "HTML", extensions: ["html", "htm", "xhtml"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (r.canceled || r.filePaths.length === 0) return { canceled: true, url: null, path: null };
    const p = r.filePaths[0];
    return { canceled: false, url: pathToFileURL(p).toString(), path: p };
  });
  // Convert an absolute path → file:// URL (used by drag-drop in the Preview page).
  ipcMain.handle("preview:fileUrl", (_e, absPath: string) => pathToFileURL(absPath).toString());

  // Workspace persistence (route, Legion chat, forge state)
  ipcMain.handle("workspace:get", () => workspaceStore.loadWorkspace());
  ipcMain.handle("workspace:patch", (_e, patch: Partial<workspaceStore.WorkspaceSnapshot>) =>
    workspaceStore.saveWorkspace(patch));
  ipcMain.handle("workspace:export", () => workspaceStore.exportWorkspaceJson());
  ipcMain.handle("workspace:import", (_e, raw: string) => workspaceStore.importWorkspaceJson(raw));
  ipcMain.handle("workspace:reset", () => workspaceStore.resetWorkspace());
  ipcMain.handle("workspace:clearCaches", () => workspaceStore.clearAppCaches());

  // Legion orchestrator (ai.grudge-studio.com + GRUDA Agent)
  ipcMain.handle("legion:health", () => legion.legionHealth());
  ipcMain.handle("legion:agents", () => legion.listAgents());
  ipcMain.handle("legion:chat", (_e, opts) => legion.legionChat(opts));
  ipcMain.handle("legion:models", () => legion.grudaAgentModels());
  ipcMain.handle("legion:getHubUrl", () => legion.getLegionHubUrl());
  ipcMain.handle("legion:setHubUrl", (_e, url: string) => legion.setLegionHubUrl(url));
  ipcMain.handle("legion:getAgentUrl", () => legion.getGrudaAgentUrl());
  ipcMain.handle("legion:setAgentUrl", (_e, url: string) => legion.setGrudaAgentUrl(url));
  ipcMain.handle("legion:getFleetKey", async () => Boolean(await legion.getFleetApiKey()));
  ipcMain.handle("legion:setFleetKey", (_e, key: string) => legion.setFleetApiKey(key));
  ipcMain.handle("legion:clearFleetKey", () => legion.clearFleetApiKey());
  ipcMain.handle("legion:transcribe", (_e, opts: { audioBase64: string; model?: string }) =>
    whisper.transcribeAudio(opts));
  ipcMain.handle("legion:whisperHealth", () => whisper.whisperHealth());

  // Fleet games + store catalog
  ipcMain.handle("fleet:games", async () => {
    try {
      const live = await legion.fetchGrudgedotGames();
      return { static: FLEET_GAMES, live, merged: FLEET_GAMES };
    } catch {
      return { static: FLEET_GAMES, live: [], merged: FLEET_GAMES };
    }
  });
  ipcMain.handle("fleet:endpoints", () => FLEET_ENDPOINTS);
  ipcMain.handle("fleet:storeCategories", () => STORE_CATEGORIES);
  ipcMain.handle("fleet:objectStore", (_e, path: string) => legion.fetchObjectStoreCatalog(path));

  // Ollama (local AI)
  ipcMain.handle("ollama:health", () => ollama.ollamaHealth());
  ipcMain.handle("ollama:models", () => ollama.ollamaModels());
  ipcMain.handle("ollama:chat", (_e, opts) => ollama.ollamaChat(opts));
  ipcMain.handle("ollama:generate", (_e, opts) => ollama.ollamaGenerate(opts));
  ipcMain.handle("ollama:getHost", () => ollama.getOllamaHost());
  ipcMain.handle("ollama:setHost", (_e, host: string) => { ollama.setOllamaHost(host); });
  ipcMain.handle("ollama:getModel", () => ollama.getPreferredModel());
  ipcMain.handle("ollama:setModel", (_e, model: string) => { ollama.setPreferredModel(model); });
  ipcMain.handle("ollama:getAiPref", () => ollama.getAiPreference());
  ipcMain.handle("ollama:setAiPref", (_e, pref: any) => { ollama.setAiPreference(pref); });

  // UUID utilities (local, no network)
  ipcMain.handle("uuid:gen", (_e, args) =>
    ({ uuid: generateGrudgeUUID(args.slot, args.tier ?? null, args.itemId ?? 1) }));
  ipcMain.handle("uuid:parse", (_e, uuid: string) => parseGrudgeUUID(uuid));
  ipcMain.handle("uuid:describe", (_e, uuid: string) => describeGrudgeUUID(uuid));
  ipcMain.handle("uuid:valid", (_e, uuid: string) => isValidGrudgeUUID(uuid));
  ipcMain.handle("uuid:slots", () => SLOT_CODES);
  ipcMain.handle("uuid:tiers", () => TIER_CODES);
}
