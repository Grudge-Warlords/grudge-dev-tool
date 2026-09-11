import { app, BrowserWindow, ipcMain, shell, nativeImage, session, crashReporter, dialog } from "electron";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import * as windowState from "./windowState";
import { createTray, disposeTray } from "./tray";
import { showLoader, hideLoader, toggleLoader, getLoaderWindow, disposeLoader } from "./loader";
import * as viewer from "./viewer";
import * as localFiles from "./localFiles";
import * as openFileBridge from "./openFileBridge";
import * as fileDefaults from "./fileDefaults";
import {
  registerMediaSchemePrivileged,
  registerMediaFileProtocol,
  mediaStreamUrl,
} from "./mediaProtocol";

// Privileged media scheme — BEFORE app.ready (required by Electron)
registerMediaSchemePrivileged();
// HTTPS ThreePipe (`threeflow.vercel.app/view`) fetches local meshes from 127.0.0.1:17380.
app.commandLine.appendSwitch(
  "disable-features",
  "BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessRespectPreflightResults",
);
import * as api from "./api";
import { uploader } from "./uploader";
import * as bk from "./blenderkit/daemon";
import { detectAll } from "./ingestion/toolchain";
import { ingestOne, convertFile, verifyFile } from "./ingestion";
import { inspectModel } from "./ingestion/modelInspect";
import { understandAsset } from "./assetUnderstand";
import { extractZip } from "./ingestion/archive";
import log, { initLogger, getLogFilePath } from "./logger";
import { startConnectivity, stopConnectivity, getConnectivity } from "./connectivity";
import { setupAutoUpdater, checkForUpdatesNow, downloadUpdateNow, quitAndInstall, getUpdaterStatus } from "./updater";
import { getCfStatus, readCf, writeCf, clearCf, resolvePublicCdnBase } from "./cf/credentials";
import { workerHealth } from "./cf/objectStoreWorker";
import { r2Health, resetR2Client, r2GetSignedUploadUrl, r2GetSignedDownloadUrl, r2List, r2PublicUrl, r2Head } from "./cf/r2Direct";
import * as forge from "./forge";
import * as coder from "./coder";
import * as devPortal from "./devPortal";
import * as economy from "./economy";
import * as toolPaths from "./toolPaths";
import { workersAiChat, workersAiCaption, aiGatewayHealth, aiGatewayProxy } from "./cf/aiGateway";
import * as ollama from "./ollama";
import * as legion from "./legion/orchestrator";
import * as whisper from "./legion/whisper";
import { FLEET_GAMES, STORE_CATEGORIES } from "../shared/fleetGames";
import { GAME_DEPLOYMENT_DEFINITIONS } from "../shared/gameDeployments";
import { mergeFleetGames } from "../shared/fleetMerge";
import { FLEET_ENDPOINTS } from "../shared/fleetConnections";
import * as workspaceStore from "./workspaceStore";
import * as puterAuth from "./auth/puterSession";
import { puterLoginAuto, puterLoginViaExternalBrowser, resolvePuterUserFromToken } from "./auth/puterLogin";
import {
  generateGrudgeUUID, parseGrudgeUUID, describeGrudgeUUID, isValidGrudgeUUID,
  SLOT_CODES, TIER_CODES,
} from "../shared/grudgeUUID";
import { isCanonicalAdmin } from "../shared/adminAllowlist";
import { loadEnvFiles } from "./bootstrapEnv";
import { seedDefaultSecrets } from "./bootstrapSecrets";
import { runFleetHealthCheck } from "./fleet/healthCheck";
import {
  aiChat,
  checkAllAiWorkers,
  getFleetOperationsStatus,
  listAvailableModels,
} from "./fleet/aiWorkerManager";
import {
  planSceneCompletion,
  sceneCompletionWorkerInfo,
} from "./fleet/sceneCompletionWorker";
import {
  planPipelineReview,
  pipelineReviewWorkerInfo,
  preparePipelineUpload,
  headCdnVerify,
} from "./fleet/pipelineReviewWorker";
import {
  runLocalAgent,
  runLocalOrchestrator,
  localAgentStatus,
  localAgentChat,
} from "./agent/localAgent";
import {
  startPluginHost,
  stopPluginHost,
  getPluginHostStatus,
  getPluginToken,
} from "./pluginHost";
import { Prompt3DService } from "./prompt3d/service";
import { discoverPrompt3DRoot } from "./prompt3d/discovery";
import { localControlsEnabled, saveLocalControlsEnabled, loadPrompt3DDraft, savePrompt3DDraft, loadPlannerHost, savePlannerHost } from "./prompt3d/controlsPreference";
import { PROMPT3D_CHANNELS, type LocalPrompt3DProviderId, type Prompt3DApproveConceptRequest, type Prompt3DInstallRequest, type Prompt3DPlanRequest, type Prompt3DRejectConceptRequest, type Prompt3DStartRequest } from "../shared/prompt3d";
import {
  PROMPT3D_WORKFLOW_CHANNELS,
  type Prompt3DAssetSource,
  type Prompt3DApproveVisualRequest,
  type Prompt3DWorkflowArtifactRequest,
  type Prompt3DBatchRequest,
  type Prompt3DFinishRequest,
  type Prompt3DRejectFinishVisualRequest,
} from "../shared/prompt3dWorkflow";
import { CREATION_CHANNELS, type CreationRequest } from "../shared/creationFlow";
import { UPDATER_CHANNELS } from "../shared/ipc";
import { creationHistory, creationLibrary, reopenCreation, saveCreationToLibrary, submitCreation } from "./prompt3d/creationService";
import { planAssetRefinement, saveAssetRefinement } from "./prompt3d/refinement";
import { startCpuPlanner, stopOwnedCpuPlanner } from "./prompt3d/plannerRuntime";
import { recordWorkflowExport, verifyWorkflowArtifact, workflowExportHistory } from "./prompt3d/artifactVerification";
import { inspectPrompt3DReferenceImage } from "./prompt3d/referenceImage";

const OFFLINE_LOCAL_TEST = process.env.GRUDGE_OFFLINE_LOCAL_TEST === "1";
if (OFFLINE_LOCAL_TEST) {
  app.setPath("userData", resolve(process.env.GRUDGE_TEST_PROFILE || join(process.cwd(), ".local-test-profile")));
}

// Load .env from package / home / AppData (does not override existing process env).
const envLoad = OFFLINE_LOCAL_TEST ? { keysLoaded: 0, files: [] as string[] } : loadEnvFiles();
initLogger();
try {
  const log = require("./logger").default as { info: (m: string) => void };
  log.info(
    `[bootstrapEnv] loaded ${envLoad.keysLoaded} key(s) from ${envLoad.files.length} file(s)`,
  );
} catch {
  /* logger optional at this point */
}
// Elite viewer owns OS double-click / Open with (not Forge).
openFileBridge.captureInitialArgv();

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

const prompt3d = new Prompt3DService({
  root: resolve(process.env.GRUDGE_PROMPT3D_ROOT || join(app.getPath("userData"), "prompt3d")),
  appRoot: app.isPackaged ? resolve(process.resourcesPath) : resolve(join(__dirname, "..", "..")),
  offlineLocalTest: OFFLINE_LOCAL_TEST,
  onWorkflowLibraryRoot: async (localAssetsRoot) => { await workspaceStore.saveWorkspace({ localAssetsRoot }); },
});

const RENDERER_DEV_URL = process.env.GRUDGE_RENDERER_URL || "http://localhost:5173";
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
    // Start hidden; show on ready-to-show so first paint isn't a white flash.
    // Tray remains for minimize-to-tray; double-click tray also shows.
    show: false,
    backgroundColor: "#0a0e1a",
    icon: nativeImage.createFromPath(windowIconPath()),
    autoHideMenuBar: true,
    title: "Grudge Dev Tool",
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

  // Always surface the main window once the shell is ready (dev + packaged).
  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
    log.info("[window] ready-to-show → shown");
  });
  // Fallback if ready-to-show races (slow vite / cold start)
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
      log.info("[window] fallback show after timeout");
    }
  }, 4000);

  // ---------------- Security hardening ----------------
  // Refuse navigation to anything outside the app shell, OAuth domains, and
  // the renderer dev server. Anchor links to the studio, the docs site, etc.
  // open in the user's default browser via shell.openExternal.
  const ALLOWED_NAV_HOSTS = /(^|\.)(puter\.com|puter\.site|grudge-studio\.com|grudgewarlords\.com|grudge-warlords\.github\.io)$/i;
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const u = new URL(url);
      if (u.protocol === "file:" && url.endsWith("index.html")) return;       // app reload
      if (u.origin === new URL(RENDERER_DEV_URL).origin) return;                 // exact dev server
      if (OFFLINE_LOCAL_TEST) { event.preventDefault(); return; }
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
    if (!OFFLINE_LOCAL_TEST) mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(RENDERER_PROD_INDEX);
  }

  // Allow window.open() to *.puter.com / puter.site (Puter SDK OAuth popup).
  // External links go to the default browser; everything else is denied.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (OFFLINE_LOCAL_TEST) return { action: "deny" };
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
    // Double-click / Open with while running → elite viewer (not Forge)
    openFileBridge.onSecondInstance(argv, mainWindow);
  });

  app.whenReady().then(async () => {
    if (OFFLINE_LOCAL_TEST) {
      session.defaultSession.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, callback) => {
        try { const url = new URL(details.url); callback({ cancel: !["127.0.0.1", "localhost"].includes(url.hostname) }); }
        catch { callback({ cancel: true }); }
      });
    }
    // Stream local mp4/webm/audio into Elite Viewer without full-file blob load
    registerMediaFileProtocol();
    // Keep an explicitly selected generator root across app restarts. An
    // environment override remains authoritative for isolated/offline runs.
    if (!process.env.GRUDGE_PROMPT3D_ROOT) {
      const savedWorkspace = await workspaceStore.loadWorkspace();
      if (savedWorkspace.prompt3dRoot) {
        await prompt3d.restoreRoot(savedWorkspace.prompt3dRoot);
      } else {
        const discoveredRoot = await discoverPrompt3DRoot([
          "E:\\GrudgePrompt3D",
          join(app.getPath("userData"), "prompt3d"),
        ]);
        if (discoveredRoot) {
          await prompt3d.restoreRoot(discoveredRoot);
          await workspaceStore.saveWorkspace({ prompt3dRoot: discoveredRoot });
        }
      }
    }
    // Show UI first — never block window creation on Blender/ffmpeg probes.
    // Secrets seed runs in parallel so vault warm-up doesn't delay first paint.
    await createMainWindow();
    if (!OFFLINE_LOCAL_TEST) createTray(() => mainWindow);
    registerIpc();
    if (!OFFLINE_LOCAL_TEST) void seedDefaultSecrets()
      .then((seed) =>
        log.info(
          `[bootstrapSecrets] ready — seeded: ${seed?.seeded?.join?.(", ") || "none (vault already full or env empty)"}`,
        ),
      )
      .catch((err) => log.warn("seedDefaultSecrets failed", err));
    // Cold-start: Explorer double-click → Elite Three Pipeline (+ Local Files tab)
    const hadColdOpen = openFileBridge.getPendingPaths().length > 0;
    if (mainWindow) openFileBridge.flushPendingTo(mainWindow);
    // No pending file open → surface GrudgeLoader in the bottom-right so the
    // notification-area (▲) icon is discoverable (v1.1.0 tray UX).
    if (!OFFLINE_LOCAL_TEST && !hadColdOpen) {
      try {
        showLoader();
      } catch {
        /* ignore */
      }
    }
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
    if (!OFFLINE_LOCAL_TEST) startConnectivity(allWindows, 30_000);

    // Auto-update (no-op in dev).
    if (!OFFLINE_LOCAL_TEST) setupAutoUpdater(() => mainWindow);

    // Loopback plugin host — VS Code / standalone / CLI attach here.
    if (!OFFLINE_LOCAL_TEST) void startPluginHost({
      showMain: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.show();
        mainWindow.focus();
      },
    }).catch((err) => log.warn("[pluginHost] start failed", err));

    if (!OFFLINE_LOCAL_TEST) void fileDefaults.ensureFileDefaultsOnLaunch().catch((err) =>
      log.warn("[fileDefaults] launch ensure failed", err),
    );

    // Auto-plug GRUDACHAIN Ollama + agentic local AI on open.
    // If session is already grudachain/admin, run full agentic ensure (prefer ollama + model pull).
    if (!OFFLINE_LOCAL_TEST) void (async () => {
      try {
        const session = await puterAuth.getSession();
        const adminUser = session.puterUser;
        const agentic = session.signedIn && isCanonicalAdmin(adminUser);
        const status = await ollama.ensureRunning({
          reason: "app-open",
          agentic,
          username: adminUser?.username,
          email: adminUser?.email,
        });
        log.info(
          `[ollama] app-open ensure ok=${status.ok} backend=${status.backend} agenticReady=${status.agenticReady}`,
        );
        for (const w of allWindows()) {
          if (!w.isDestroyed()) w.webContents.send("ollama:status", status);
        }
      } catch (err) {
        log.warn("[ollama] app-open ensure failed", err);
      }
    })();
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
  viewer.disposeAllViewers();
  bk.shutdownSpawned();
  coder.shutdownCoder();
  stopPluginHost();
  ollama.shutdown();
  prompt3d.shutdown();
});

// ---------------------------------------------------------------------------
// IPC bridge — every channel name is mirrored in src/preload/preload.ts.
// ---------------------------------------------------------------------------
function registerIpc() {
  const prompt3dCapabilities = new Map<number, string>();
  let controlsQueue: Promise<unknown> = Promise.resolve();
  const serializeControls = <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = controlsQueue.then(operation);
    controlsQueue = result.catch(() => undefined);
    return result;
  };
  /** Soft gate: main shell only. Do not block on brittle file:// casing (broke tray/shell after 1.1.2). */
  const assertMainShellSender = (event: Electron.IpcMainInvokeEvent) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
      throw new Error("IPC sender is not the main application window.");
    }
    if (event.senderFrame && event.senderFrame !== event.sender.mainFrame) {
      throw new Error("IPC is restricted to the top-level application frame.");
    }
  };
  /** Prompt-to-3D mutations only — reads use assertMainShellSender. */
  const assertPrompt3DSender = (event: Electron.IpcMainInvokeEvent) => {
    assertMainShellSender(event);
  };
  const prompt3dCapabilityFor = (event: Electron.IpcMainInvokeEvent) => {
    assertPrompt3DSender(event);
    const token = prompt3dCapabilities.get(event.sender.id);
    if (!token) throw new Error("Prompt-to-3D controls are not enabled for this application window.");
    prompt3d.assertCapability(token);
    return token;
  };
  const enablePrompt3DForWindow = (event: Electron.IpcMainInvokeEvent) => {
    assertPrompt3DSender(event);
    if (prompt3dCapabilities.has(event.sender.id)) return;
    const token = prompt3d.grant();
    const senderId = event.sender.id;
    prompt3dCapabilities.set(senderId, token);
    event.sender.once("destroyed", () => {
      prompt3d.revoke(token);
      if (prompt3dCapabilities.get(senderId) === token) prompt3dCapabilities.delete(senderId);
    });
  };
  prompt3d.on("install-progress", (payload) => mainWindow?.webContents.send(PROMPT3D_CHANNELS.installProgress, payload));
  prompt3d.on("job-progress", (payload) => mainWindow?.webContents.send(PROMPT3D_CHANNELS.jobProgress, payload));
  prompt3d.on("finish-progress", (payload) => mainWindow?.webContents.send(PROMPT3D_WORKFLOW_CHANNELS.finishProgress, payload));
  prompt3d.on("batch-progress", (payload) => mainWindow?.webContents.send(PROMPT3D_WORKFLOW_CHANNELS.batchProgress, payload));
  ipcMain.handle(PROMPT3D_CHANNELS.runtime, (event) => serializeControls(async () => {
    assertMainShellSender(event);
    const enabled = await localControlsEnabled();
    if (enabled) enablePrompt3DForWindow(event);
    return { offlineLocalTest: OFFLINE_LOCAL_TEST, prompt3dRoot: prompt3d.getRoot(), localControlsEnabled: enabled, plannerHost: await loadPlannerHost() };
  }));
  ipcMain.handle(PROMPT3D_CHANNELS.overview, (event, spec) => { assertMainShellSender(event); return prompt3d.overview(spec); });
  ipcMain.handle(PROMPT3D_CHANNELS.history, (event) => { assertMainShellSender(event); return prompt3d.history(); });
  ipcMain.handle(PROMPT3D_CHANNELS.draft, async (event) => {
    assertMainShellSender(event);
    return await loadPrompt3DDraft() ?? (await prompt3d.history()).latestJob?.spec ?? null;
  });
  ipcMain.handle(PROMPT3D_CHANNELS.saveDraft, async (event, spec) => {
    assertMainShellSender(event);
    await savePrompt3DDraft(spec);
    return { saved: true };
  });
  ipcMain.handle(PROMPT3D_CHANNELS.grant, (event) => serializeControls(async () => {
    assertPrompt3DSender(event);
    await saveLocalControlsEnabled(true);
    enablePrompt3DForWindow(event);
    return { enabled: true as const };
  }));
  ipcMain.handle(PROMPT3D_CHANNELS.revoke, (event) => serializeControls(async () => {
    assertPrompt3DSender(event);
    await saveLocalControlsEnabled(false);
    prompt3d.revokeAll();
    prompt3dCapabilities.clear();
    return { enabled: false as const };
  }));
  ipcMain.handle(PROMPT3D_CHANNELS.plan, (event, request: Prompt3DPlanRequest) => prompt3d.plan(prompt3dCapabilityFor(event), request));
  ipcMain.handle(PROMPT3D_CHANNELS.refine, (event, request) => { prompt3d.assertCapability(prompt3dCapabilityFor(event)); return planAssetRefinement(request); });
  ipcMain.handle(PROMPT3D_CHANNELS.plannerHost, (event, host: string) => { prompt3d.assertCapability(prompt3dCapabilityFor(event)); return savePlannerHost(host); });
  ipcMain.handle(PROMPT3D_CHANNELS.startPlanner, (event) => { prompt3d.assertCapability(prompt3dCapabilityFor(event)); return startCpuPlanner(); });
  app.on("before-quit", stopOwnedCpuPlanner);
  ipcMain.handle(PROMPT3D_CHANNELS.saveRevision, (event, request) => { prompt3d.assertCapability(prompt3dCapabilityFor(event)); return saveAssetRefinement(prompt3d.getRoot(), request); });
  ipcMain.handle(PROMPT3D_CHANNELS.chooseRoot, async (event) => {
    const token = prompt3dCapabilityFor(event);
    const result = await dialog.showOpenDialog(mainWindow!, { title: "Choose local 3D generator storage", defaultPath: prompt3d.getRoot(), properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    const overview = await prompt3d.setRoot(token, result.filePaths[0]);
    await workspaceStore.saveWorkspace({ prompt3dRoot: prompt3d.getRoot() });
    return overview;
  });
  ipcMain.handle(PROMPT3D_CHANNELS.chooseReferenceImage, async (event) => {
    prompt3dCapabilityFor(event);
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Choose a local reference image",
      properties: ["openFile"],
      filters: [
        { name: "Reference images", extensions: ["png", "jpg", "jpeg", "webp"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return inspectPrompt3DReferenceImage(result.filePaths[0]);
  });
  ipcMain.handle(PROMPT3D_CHANNELS.chooseReferenceImages, async (event) => {
    prompt3dCapabilityFor(event);
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Choose one to four Hunyuan reference views",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Reference images", extensions: ["png", "jpg", "jpeg", "webp"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    if (result.filePaths.length > 4) throw new Error("Choose no more than four reference images.");
    return Promise.all(result.filePaths.map((path) => inspectPrompt3DReferenceImage(path)));
  });
  ipcMain.handle(PROMPT3D_CHANNELS.install, (event, request: Prompt3DInstallRequest) => prompt3d.install(prompt3dCapabilityFor(event), request));
  ipcMain.handle(PROMPT3D_CHANNELS.cancelInstall, (event, providerId: LocalPrompt3DProviderId) => prompt3d.cancelInstall(prompt3dCapabilityFor(event), providerId));
  ipcMain.handle(PROMPT3D_CHANNELS.start, (event, request: Prompt3DStartRequest) => prompt3d.start(prompt3dCapabilityFor(event), request));
  ipcMain.handle(PROMPT3D_CHANNELS.approveConcept, (event, request: Prompt3DApproveConceptRequest) => prompt3d.approveConcept(prompt3dCapabilityFor(event), request));
  ipcMain.handle(PROMPT3D_CHANNELS.rejectConcept, (event, request: Prompt3DRejectConceptRequest) => prompt3d.rejectConcept(prompt3dCapabilityFor(event), request));
  ipcMain.handle(PROMPT3D_CHANNELS.regenerateConcept, (event, id: string) => prompt3d.regenerateConcept(prompt3dCapabilityFor(event), id));
  ipcMain.handle(CREATION_CHANNELS.history, (event) => { assertPrompt3DSender(event); return creationHistory(prompt3d.getRoot()); });
  ipcMain.handle(PROMPT3D_CHANNELS.inspectDeformation, (event, id: string) => prompt3d.inspectDeformation(prompt3dCapabilityFor(event), id));
  ipcMain.handle(PROMPT3D_CHANNELS.previewDeformation, (event, edit: import("../shared/deformationRegions").DeformationEdit) => prompt3d.previewDeformation(prompt3dCapabilityFor(event), edit));
  ipcMain.handle(CREATION_CHANNELS.submit, (event, request: CreationRequest) => { prompt3d.assertCapability(prompt3dCapabilityFor(event)); return submitCreation(prompt3d.getRoot(), request); });
  ipcMain.handle(CREATION_CHANNELS.reopen, (event, id: string) => { assertPrompt3DSender(event); return reopenCreation(prompt3d.getRoot(), id); });
  ipcMain.handle(CREATION_CHANNELS.library, (event) => { assertPrompt3DSender(event); return creationLibrary(prompt3d.getRoot()); });
  ipcMain.handle(CREATION_CHANNELS.save, async (event, id: string) => {
    assertPrompt3DSender(event);
    const result=await saveCreationToLibrary(prompt3d.getRoot(),id);
    await workspaceStore.saveWorkspace({localAssetsRoot:result.localAssetsRoot});
    return result;
  });
  ipcMain.handle(PROMPT3D_CHANNELS.status, (event, id: string) => prompt3d.status(prompt3dCapabilityFor(event), id));
  ipcMain.handle(PROMPT3D_CHANNELS.cancel, (event, id: string) => prompt3d.cancel(prompt3dCapabilityFor(event), id));
  ipcMain.handle(PROMPT3D_CHANNELS.retry, (event, id: string) => prompt3d.retry(prompt3dCapabilityFor(event), id));
  ipcMain.handle(PROMPT3D_CHANNELS.reveal, (event, path: string) => { const safe = prompt3d.authorizeResultPath(prompt3dCapabilityFor(event), path); shell.showItemInFolder(safe); return { ok: true }; });
  ipcMain.handle(PROMPT3D_WORKFLOW_CHANNELS.finishStart, (event, request: Prompt3DFinishRequest) =>
    prompt3d.finishStart(prompt3dCapabilityFor(event), request));
  ipcMain.handle(PROMPT3D_WORKFLOW_CHANNELS.finishHistory, (event) => {
    prompt3dCapabilityFor(event);
    return prompt3d.finishHistory();
  });
  ipcMain.handle(PROMPT3D_WORKFLOW_CHANNELS.finishStatus, (event, id: string) =>
    prompt3d.finishStatus(prompt3dCapabilityFor(event), id));
  ipcMain.handle(PROMPT3D_WORKFLOW_CHANNELS.finishCancel, (event, id: string) =>
    prompt3d.finishCancel(prompt3dCapabilityFor(event), id));
  ipcMain.handle(PROMPT3D_WORKFLOW_CHANNELS.approveVisual, (event, request: Prompt3DApproveVisualRequest) =>
    prompt3d.workflowApproveVisual(prompt3dCapabilityFor(event), request));
  ipcMain.handle(PROMPT3D_WORKFLOW_CHANNELS.rejectFinishVisual, (event, request: Prompt3DRejectFinishVisualRequest) =>
    prompt3d.workflowRejectFinishVisual(prompt3dCapabilityFor(event), request));
  ipcMain.handle(PROMPT3D_WORKFLOW_CHANNELS.save, async (event, source: Prompt3DAssetSource) => {
    const result = await prompt3d.workflowSave(prompt3dCapabilityFor(event), source);
    await workspaceStore.saveWorkspace({ localAssetsRoot: result.localAssetsRoot });
    return result;
  });
  ipcMain.handle(PROMPT3D_WORKFLOW_CHANNELS.library, (event) =>
    prompt3d.workflowLibrary(prompt3dCapabilityFor(event)));
  ipcMain.handle(PROMPT3D_WORKFLOW_CHANNELS.export, async (event, source: Prompt3DAssetSource) => {
    const token = prompt3dCapabilityFor(event);
    const safeJobId = typeof source?.jobId === "string"
      ? source.jobId.replace(/[^a-z0-9_-]/gi, "").slice(0, 32)
      : "";
    const variant = source?.kind === "generation" && Number.isInteger(source.variantIndex)
      ? `-variant-${Number(source.variantIndex) + 1}`
      : "";
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Export finished Prompt-to-3D asset",
      defaultPath: join(app.getPath("documents"), `grudge-${safeJobId || "asset"}${variant}.glb`),
      filters: [{ name: "glTF Binary", extensions: ["glb"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (result.canceled || !result.filePath) return { canceled: true as const };
    const exported = await prompt3d.workflowExport(token, source, result.filePath);
    const finished = await prompt3d.finishStatus(token, source.jobId);
    return recordWorkflowExport(prompt3d.getRoot(), finished, exported);
  });
  ipcMain.handle(PROMPT3D_WORKFLOW_CHANNELS.exportHistory, (event) => {
    prompt3dCapabilityFor(event);
    return workflowExportHistory(prompt3d.getRoot());
  });
  ipcMain.handle(PROMPT3D_WORKFLOW_CHANNELS.verifyArtifact, async (event, request: Prompt3DWorkflowArtifactRequest) => {
    const token = prompt3dCapabilityFor(event);
    const managedAssets = request?.kind === "managed" ? await prompt3d.workflowLibrary(token) : [];
    return verifyWorkflowArtifact(prompt3d.getRoot(), request, managedAssets);
  });
  ipcMain.handle(PROMPT3D_WORKFLOW_CHANNELS.batchStart, (event, request: Prompt3DBatchRequest) =>
    prompt3d.batchStart(prompt3dCapabilityFor(event), request));
  ipcMain.handle(PROMPT3D_WORKFLOW_CHANNELS.batchStatus, (event, id?: string) =>
    prompt3d.batchStatus(prompt3dCapabilityFor(event), id));
  ipcMain.handle(PROMPT3D_WORKFLOW_CHANNELS.batchCancel, (event, id: string) =>
    prompt3d.batchCancel(prompt3dCapabilityFor(event), id));
  ipcMain.handle(PROMPT3D_WORKFLOW_CHANNELS.batchRetry, (event, id: string, itemId?: string) =>
    prompt3d.batchRetry(prompt3dCapabilityFor(event), id, itemId));
  ipcMain.handle(PROMPT3D_WORKFLOW_CHANNELS.batchExport, async (event, id: string) => {
    const token = prompt3dCapabilityFor(event);
    const batch = prompt3d.batchStatus(token, id);
    if (!batch || batch.state !== "complete") throw new Error("Finish the serial Prompt-to-3D batch before exporting its outputs.");
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Export all finished Prompt-to-3D batch assets",
      defaultPath: app.getPath("documents"),
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true as const };
    return prompt3d.batchExport(token, id, result.filePaths[0]);
  });
  // Settings
  ipcMain.handle("settings:get", async () => {
    const idBaseUrl = await api.getIdBaseUrl();
    const gameDataUrl = await api.getGameDataUrl();
    const apiBaseUrl = await api.getApiBaseUrl();
    const deprecatedAuth =
      /auth\.grudge-studio\.com/i.test(apiBaseUrl) ||
      /auth\.grudge-studio\.com/i.test(idBaseUrl) ||
      /api\.grudge-studio\.com/i.test(apiBaseUrl);
    return {
      apiBaseUrl,
      assetsApiBaseUrl: await api.getAssetsApiBaseUrl(),
      idBaseUrl,
      gameDataUrl,
      cdnBaseUrl: await resolvePublicCdnBase(),
      hasToken: Boolean(await api.getToken()),
      hasBlenderKitKey: Boolean(await bk.getApiKey()),
      backendMode: await api.getBackendMode(),
      fleetSsot: {
        client: "https://client.grudge-studio.com",
        id: "https://id.grudge-studio.com",
        gameData: "https://grudge-api-production-0d46.up.railway.app",
        objectStore: "https://objectstore.grudge-studio.com/api/v1",
        assets: "https://assets.grudge-studio.com",
        foundry: "https://character.grudge-studio.com",
      },
      deprecatedAuthHost: deprecatedAuth,
    };
  });
  ipcMain.handle("settings:setApiBase", (_e, url: string) => api.setApiBaseUrl(url));
  ipcMain.handle("settings:setAssetsApiBase", (_e, url: string) => api.setAssetsApiBaseUrl(url));
  ipcMain.handle("settings:clearAssetsApiBase", () => api.clearAssetsApiBaseUrl());
  ipcMain.handle("settings:setIdBase", (_e, url: string) => api.setIdBaseUrl(url));
  ipcMain.handle("settings:setGameDataUrl", (_e, url: string) => api.setGameDataUrl(url));
  ipcMain.handle("settings:applyOneTruth", () => api.applyOneTruthFleetPreset());
  ipcMain.handle("settings:setToken", (_e, token: string) => api.setToken(token));
  ipcMain.handle("settings:clearToken", () => api.clearToken());
  ipcMain.handle("settings:setBlenderKitKey", (_e, key: string) => bk.setApiKey(key));
  ipcMain.handle("settings:clearBlenderKitKey", () => bk.clearApiKey());
  ipcMain.handle("settings:toolchain", async () => detectAll());

  // Accounts — wallet, GBUX, toolchain paths (real /api/wallet/* + auth/wallet)
  ipcMain.handle("accounts:wallet", (_e, grudgeId: string) => economy.getPlayerWallet(grudgeId));
  ipcMain.handle("accounts:walletConfig", () => economy.getWalletConfig());
  ipcMain.handle("accounts:provisionWallet", (_e, args: { grudgeId: string; email?: string }) =>
    economy.provisionWallet(args.grudgeId, args.email));
  ipcMain.handle("accounts:linkedWallets", () => economy.getLinkedWallets());
  ipcMain.handle("accounts:linkChallenge", (_e, walletAddress: string) =>
    economy.createWalletLinkChallenge(walletAddress));
  ipcMain.handle(
    "accounts:linkConfirm",
    (
      _e,
      args: {
        walletAddress: string;
        message: string;
        signature: string;
        provider?: string;
        label?: string;
      },
    ) => economy.confirmWalletLink(args),
  );
  ipcMain.handle("accounts:loginWithWallet", async (_e, walletAddress: string) => {
    const r = await economy.loginWithSolanaWallet(walletAddress);
    if (!r.ok || !r.token) return r;
    // Persist fleet JWT as session token so subsequent API calls are authed
    const user = {
      uuid: r.userId ?? walletAddress,
      username: r.username ?? walletAddress.slice(0, 8),
      email: undefined as string | undefined,
    };
    const session = await puterAuth.setSession(r.token, user);
    // Prefer server grudgeId when present
    if (r.grudgeId) {
      try {
        const { setSecret } = await import("./auth/secretStore");
        await setSecret(
          "grudge-id",
          JSON.stringify({
            grudgeId: r.grudgeId,
            puterUuid: user.uuid,
            firstSeenAt: Date.now(),
            auth: "wallet",
          }),
        );
      } catch {
        /* best-effort */
      }
    }
    void ollama.onAdminSignedIn(user).then((status) => {
      if (!status) return;
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) w.webContents.send("ollama:status", status);
      });
    });
    return {
      ...r,
      grudgeId: r.grudgeId ?? session.grudgeId,
      sessionGrudgeId: session.grudgeId,
    };
  });
  ipcMain.handle("accounts:gbuxBalance", (_e, grudgeId: string) => economy.getGbuxBalance(grudgeId));
  ipcMain.handle("accounts:gbuxPurchase", (_e, args: { packId: string; grudgeId: string; walletAddress?: string }) =>
    economy.requestGbuxPurchase(args));
  ipcMain.handle("accounts:gbuxTransfer", (_e, args: { toAddress: string; amount: number; memo?: string }) =>
    economy.adminGbuxTransfer(args));
  ipcMain.handle("accounts:getAleWallet", () => economy.getAleAdminWallet());
  ipcMain.handle("accounts:setAleWallet", (_e, address: string) => economy.setAleAdminWallet(address));
  ipcMain.handle("accounts:getToolPaths", () => toolPaths.getAllToolPaths());
  ipcMain.handle("accounts:setToolPath", (_e, key: toolPaths.ToolPathKey, path: string | null) =>
    toolPaths.setToolPath(key, path));
  ipcMain.handle("accounts:listRewards", (_e, grudgeId: string) => economy.listRewards(grudgeId));
  ipcMain.handle("accounts:claimReward", (_e, args: { grudgeId: string; rewardId: string; walletAddress?: string }) =>
    economy.claimReward(args));
  ipcMain.handle("accounts:ledger", (_e, grudgeId: string, limit?: number) => economy.getLedger(grudgeId, limit));
  ipcMain.handle("accounts:swapQuote", (_e, args: { grudgeId: string; pairId: string; fromAmount: number }) =>
    economy.getSwapQuote(args));
  ipcMain.handle("accounts:swapExecute", (_e, args: { grudgeId: string; quoteId: string; walletAddress?: string }) =>
    economy.executeSwap(args));
  ipcMain.handle("accounts:grantReward", (_e, args: Parameters<typeof economy.grantReward>[0]) =>
    economy.grantReward(args));

  // Object storage
  ipcMain.handle("os:list", (_e, req) => api.listObjects(req));
  ipcMain.handle("os:search", (_e, req) => api.searchObjects(req));
  ipcMain.handle("os:assetMeta", (_e, req) => api.getAssetMeta(req));
  ipcMain.handle("os:openExternal", (_e, url: string) => shell.openExternal(url));
  /** Seed ObjectStore / D1 index after R2 upload (prod/gltf registry). */
  ipcMain.handle("os:writeManifest", (_e, payload) => api.writeManifest(payload));
  ipcMain.handle("os:registerAsset", async (_e, row: {
    grudge_uuid: string;
    r2_key: string;
    category: string;
    content_type?: string;
    size_bytes?: number;
    sha256?: string;
    pack_id?: string;
    name?: string;
    cdn_url?: string;
    metadata?: Record<string, unknown>;
  }) => {
    const packId = row.pack_id || `prod-gltf-${row.category || "misc"}`;
    return api.writeManifest({
      packId,
      version: new Date().toISOString().slice(0, 10),
      entries: [row],
      meta: {
        source: "grudge-dev-tool",
        layout: "prod/gltf",
        single: true,
        ...(row.metadata ?? {}),
      },
    });
  });

  // Upload
  ipcMain.handle("upload:enqueue", (_e, job) => {
    uploader.enqueue(job);
    return { ok: true, jobId: job.id };
  });
  ipcMain.handle("upload:cancel", (_e, jobId: string) => uploader.cancel(jobId));

  // Ingestion (single file run, used by the Upload page preview)
  ipcMain.handle("ingest:one", (_e, args) => ingestOne(args.path, args.opts));
  ipcMain.handle("ingest:convert", async (_e, args: { path: string }) => {
    const sizeRes = await verifyFile(args.path);
    return convertFile(args.path, sizeRes);
  });

  // Skeleton Studio — FBX textures/anims, T-pose, Mixamo-25 retarget library
  ipcMain.handle("skeleton:extract", async (_e, path: string) => {
    const { extractFbxAssets } = await import("./ingestion/fbxExtract");
    return extractFbxAssets(path);
  });
  ipcMain.handle("skeleton:tpose", async (_e, path: string, opts?: { aiHint?: string }) => {
    const { prepareTPose } = await import("./ingestion/tpose");
    return prepareTPose(path, opts);
  });
  ipcMain.handle("skeleton:buildLibrary", async (_e, args: {
    modelPath: string;
    mapping?: unknown;
    packName?: string;
    packId?: string;
    roleBinds?: Record<string, string>;
    playSkeleton?: "bip001";
  }) => {
    const { buildRetargetLibraryPack } = await import("./ingestion/retargetLibrary");
    return buildRetargetLibraryPack({
      modelPath: args.modelPath,
      mapping: args.mapping as any,
      packName: args.packName,
      packId: args.packId,
      roleBinds: args.roleBinds,
      playSkeleton: args.playSkeleton ?? "bip001",
    });
  });
  ipcMain.handle("skeleton:saveMapping", async (_e, args: { path: string; mapping: unknown }) => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(args.path, JSON.stringify(args.mapping, null, 2), "utf8");
    return { ok: true, path: args.path };
  });
  ipcMain.handle("skeleton:listLibraries", async () => {
    const { listLocalAnimLibraries } = await import("./ingestion/retargetLibrary");
    return listLocalAnimLibraries({ max: 48 });
  });
  ipcMain.handle("skeleton:installLibrary", async (_e, packDir: string) => {
    const { installAnimLibraryToUserDir } = await import("./ingestion/retargetLibrary");
    return installAnimLibraryToUserDir(packDir);
  });
  ipcMain.handle("skeleton:openLibraryDir", async (_e, dir?: string) => {
    const { shell } = await import("electron");
    const { ensureUserAnimLibraryDir } = await import("./ingestion/retargetLibrary");
    const target = dir || (await ensureUserAnimLibraryDir());
    await shell.openPath(target);
    return { ok: true, path: target };
  });
  ipcMain.handle("skeleton:autoMap", async (_e, jointNames: string[]) => {
    const { autoMapBonesFromNames } = await import("../shared/mixamo25");
    return autoMapBonesFromNames(jointNames ?? []);
  });


  // BlenderKit
  ipcMain.handle("bk:search", (_e, opts) => bk.searchAssets(opts));
  ipcMain.handle("bk:download", (_e, opts) => bk.downloadAsset(opts));
  ipcMain.handle("bk:report", () => bk.getReport());
  ipcMain.handle("bk:ensure", () => bk.ensureDaemon());

  // GrudgeLoader window control
  ipcMain.handle("loader:show", () => { showLoader(); });
  ipcMain.handle("loader:hide", () => { hideLoader(); });
  ipcMain.handle("loader:toggle", () => { toggleLoader(); });

  // Pop-out Asset Viewer (always-on-top, from Loader / Browser / AssetPreview)
  ipcMain.handle("viewer:open", (_e, asset) => {
    const parent = BrowserWindow.fromWebContents(_e.sender) ?? mainWindow;
    return viewer.openViewer(asset, parent && !parent.isDestroyed() ? parent : null);
  });
  ipcMain.handle("viewer:getAsset", (_e, token: string) => viewer.getViewerAsset(token));
  ipcMain.handle("viewer:sendToForge", (_e, args: { url: string; name?: string }) =>
    viewer.sendToForge(args, mainWindow && !mainWindow.isDestroyed() ? mainWindow : null));
  ipcMain.handle("viewer:convertModel", (_e, args: { url: string; name: string; targetFormat: "glb" | "gltf"; localPath?: string }) =>
    viewer.convertModel(args));
  ipcMain.handle(
    "viewer:convertImage",
    (
      _e,
      args: {
        url: string;
        name: string;
        format: "png" | "webp" | "jpeg" | "avif" | "gif";
        quality?: number;
        maxWidth?: number;
        maxHeight?: number;
      },
    ) => viewer.convertImage(args),
  );
  ipcMain.handle("viewer:inspectImage", (_e, args: { url: string; name: string }) =>
    viewer.inspectRemoteImage(args));
  ipcMain.handle("viewer:saveConvertedFile", (_e, args: { path: string; defaultName: string; kind?: "model" | "image" }) => {
    const parent = BrowserWindow.fromWebContents(_e.sender);
    return viewer.saveConvertedFile(args, parent && !parent.isDestroyed() ? parent : mainWindow);
  });
  ipcMain.handle("viewer:saveExportedBytes", (_e, args: { bytes: Uint8Array | ArrayBuffer; defaultName: string }) => {
    const parent = BrowserWindow.fromWebContents(_e.sender);
    return viewer.saveExportedBytes(args, parent && !parent.isDestroyed() ? parent : mainWindow);
  });
  ipcMain.handle("viewer:optimizeForWeb", (_e, args: { url: string; name: string; opts?: any }) =>
    viewer.optimizeForWeb(args));
  ipcMain.handle("viewer:reuploadOptimized", (_e, args: { localPath: string; objectKey: string; contentType?: string }) =>
    viewer.reuploadOptimized(args));
  ipcMain.handle("viewer:readOptimizedBytes", (_e, path: string) => viewer.readOptimizedBytes(path));
  ipcMain.handle("viewer:focusAll", () => { viewer.focusAllViewers(); return { ok: true }; });

  // Connectivity
  ipcMain.handle("connectivity:get", () => getConnectivity());

  // Updater
  // Updater is shell chrome — do not gate on Prompt-to-3D sender checks.
  ipcMain.handle(UPDATER_CHANNELS.getStatus, () => getUpdaterStatus());
  ipcMain.handle(UPDATER_CHANNELS.check, () => checkForUpdatesNow());
  ipcMain.handle(UPDATER_CHANNELS.download, () => downloadUpdateNow());
  ipcMain.handle(UPDATER_CHANNELS.install, () => { quitAndInstall(); });

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
  ipcMain.handle("app:openRoute", (_e, route: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
      if (route) mainWindow.webContents.send("nav", route);
    }
  });
  ipcMain.handle("files:pickForUpload", async () => {
    const lw = getLoaderWindow();
    const parent =
      mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
        ? mainWindow
        : lw && !lw.isDestroyed()
          ? lw
          : undefined;
    const r = await dialog.showOpenDialog(parent ?? (undefined as any), {
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Grudge assets",
          extensions: [
            "png", "jpg", "jpeg", "webp", "gif", "avif", "tga", "bmp", "tif", "tiff", "heic", "svg",
            "glb", "gltf", "fbx", "obj", "stl", "ply", "dae", "3mf", "blend",
            "mp3", "wav", "ogg", "flac", "m4a", "aac", "opus",
            "mp4", "webm", "mov", "m4v", "mkv", "avi", "ogv",
            "json", "zip", "pdf", "ttf", "otf", "woff", "woff2",
          ],
        },
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif", "tga", "bmp", "tif", "tiff", "heic", "svg"] },
        { name: "Video", extensions: ["mp4", "webm", "mov", "m4v", "mkv", "avi", "ogv"] },
        { name: "Audio", extensions: ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"] },
        { name: "3D models", extensions: ["glb", "gltf", "fbx", "obj", "stl", "ply", "dae", "3mf", "blend"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    return r.canceled ? [] : r.filePaths;
  });

  // Local Files tab — browse folders on disk; open into viewers (not Forge)
  ipcMain.handle("files:pickDirectory", async (e, defaultPath?: string) => {
    const sender = BrowserWindow.fromWebContents(e.sender);
    const loader = getLoaderWindow();
    const lifted: BrowserWindow[] = [];
    for (const w of [sender, mainWindow, loader]) {
      if (w && !w.isDestroyed() && w.isAlwaysOnTop()) {
        w.setAlwaysOnTop(false);
        lifted.push(w);
      }
    }
    try {
      const parent =
        sender && !sender.isDestroyed()
          ? sender
          : mainWindow && !mainWindow.isDestroyed()
            ? mainWindow
            : null;
      return await localFiles.pickDirectory(parent, defaultPath);
    } finally {
      for (const w of lifted) {
        if (!w.isDestroyed()) w.setAlwaysOnTop(true, "screen-saver");
      }
    }
  });
  ipcMain.handle("files:copyPath", (_e, filePath: string) => localFiles.copyPathToClipboard(filePath));
  ipcMain.handle("files:listDir", (_e, dirPath: string) => localFiles.listDirectory(dirPath));
  ipcMain.handle("files:read", (_e, filePath: string) => localFiles.readLocalFile(filePath));
  ipcMain.handle("files:reveal", (_e, filePath: string) => localFiles.revealInFolder(filePath));
  ipcMain.handle("files:openSystem", (_e, filePath: string) => localFiles.openWithSystem(filePath));
  /** Stream URL for video/audio (grudge-media://) — no full RAM load */
  ipcMain.handle("files:mediaUrl", (_e, filePath: string) => {
    if (!filePath || typeof filePath !== "string") throw new Error("path required");
    return mediaStreamUrl(filePath);
  });
  ipcMain.handle(
    "viewer:openThreeFlow",
    async (_e, args: { name: string; cdnUrl?: string; localPath?: string }) => {
      if (args?.localPath) {
        await startPluginHost({
          showMain: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.show();
              mainWindow.focus();
            }
          },
        }).catch((err) => log.warn("[viewer] plugin host", err));
      }
      return viewer.openThreeFlowEditor(args);
    },
  );
  ipcMain.handle(
    "viewer:openThreePipe",
    async (_e, args: { name: string; cdnUrl?: string; localPath?: string; mode?: "view" | "editor" }) => {
      if (args?.localPath) {
        await startPluginHost({
          showMain: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.show();
              mainWindow.focus();
            }
          },
        }).catch((err) => log.warn("[viewer] plugin host", err));
      }
      return viewer.openThreeFlowPipeline({ ...args, mode: args?.mode || "editor" });
    },
  );
  ipcMain.handle("viewer:openLocal", (_e, args: { path: string; contentType?: string; size?: number }) => {
    const parent = BrowserWindow.fromWebContents(_e.sender) ?? mainWindow;
    return viewer.openLocalPath(
      args.path,
      { contentType: args.contentType, size: args.size },
      parent && !parent.isDestroyed() ? parent : null,
    );
  });

  // Elite open system — any disk path the OS handed us
  ipcMain.handle("openFile:openPath", async (_e, filePath: string) => {
    return openFileBridge.openPathInEliteViewer(
      filePath,
      mainWindow && !mainWindow.isDestroyed() ? mainWindow : null,
    );
  });
  ipcMain.handle("openFile:openPaths", async (_e, paths: string[]) => {
    return openFileBridge.openPaths(
      Array.isArray(paths) ? paths : [],
      mainWindow && !mainWindow.isDestroyed() ? mainWindow : null,
    );
  });
  ipcMain.handle("openFile:supportedExts", () => [...openFileBridge.VIEWER_EXTS]);

  // One-click: register Grudge as default handler for all elite viewer types (HKCU)
  ipcMain.handle("fileDefaults:setAll", () => fileDefaults.setAllAsDefault());
  ipcMain.handle("fileDefaults:status", () => fileDefaults.getDefaultsStatus());
  ipcMain.handle("fileDefaults:openSystemSettings", () => fileDefaults.openSystemDefaultApps());
  ipcMain.handle("fileDefaults:clear", () => fileDefaults.clearOurProgIds());

  // Puter auth + Grudge identity
  ipcMain.handle("auth:getSession", () => OFFLINE_LOCAL_TEST ? { signedIn: true, grudgeId: "local-test", puterUser: { uuid: "local-test", username: "Local Prompt-to-3D", email: undefined }, hasToken: false } : puterAuth.getSession());
  ipcMain.handle("auth:setSession", (_e, token: string, user: any) => puterAuth.setSession(token, user));
  ipcMain.handle("auth:clearSession", () => puterAuth.clearSession());
  ipcMain.handle("auth:wipeIdentity", () => puterAuth.wipeIdentity());
  ipcMain.handle("auth:getPuterToken", () => puterAuth.getPuterToken());
  /** Single-login payload for webview embeds (Forge, Coder, Preview, Builder). */
  ipcMain.handle("auth:getHandoff", () => puterAuth.getHandoffPayload());
  async function finishPuterLogin(
    login: () => Promise<{ token: string; user: { uuid: string; username: string; email?: string } }>,
    label: string,
  ) {
    try {
      const { token, user } = await login();
      const r = await puterAuth.setSession(token, user);
      log.info(`[${label}] OK username=${user.username} grudgeId=${r.grudgeId}`);
      // Auto-plug GRUDACHAIN Ollama agentic stack for grudachain / molochdadev admins.
      void ollama.onAdminSignedIn(user).then((status) => {
        if (!status) return;
        BrowserWindow.getAllWindows().forEach((w) => {
          if (!w.isDestroyed()) w.webContents.send("ollama:status", status);
        });
      });
      return { grudgeId: r.grudgeId, user: { uuid: user.uuid, username: user.username, email: user.email } };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      log.error(`[${label}] FAILED:`, msg);
      throw new Error(`Sign-in failed: ${msg}`);
    }
  }

  // In-app OAuth first; falls back to system browser if the window closes or times out.
  ipcMain.handle("auth:puterLogin", () => finishPuterLogin(() => puterLoginAuto(), "auth:puterLogin"));
  ipcMain.handle("auth:puterLoginExternal", () =>
    finishPuterLogin(() => puterLoginViaExternalBrowser(), "auth:puterLoginExternal"),
  );
  ipcMain.handle("auth:setSessionFromToken", async (_e, token: string) => {
    const trimmed = String(token ?? "").trim();
    if (!trimmed) throw new Error("Token is required");
    const user = await resolvePuterUserFromToken(trimmed);
    const r = await puterAuth.setSession(trimmed, user);
    log.info(`[auth:setSessionFromToken] OK username=${user.username} grudgeId=${r.grudgeId}`);
    void ollama.onAdminSignedIn(user).then((status) => {
      if (!status) return;
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) w.webContents.send("ollama:status", status);
      });
    });
    return { grudgeId: r.grudgeId, user: { uuid: user.uuid, username: user.username, email: user.email } };
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
  ipcMain.handle("forge:listSiblingTextures", async (_e, modelPath: unknown) =>
    forge.listSiblingTextures(modelPath));
  ipcMain.handle("forge:listSiblingSceneFiles", async (_e, modelPath: unknown) =>
    forge.listSiblingSceneFiles(modelPath));
  ipcMain.handle("forge:resolveSceneOpenPath", async (_e, modelPath: unknown) =>
    forge.resolveSceneOpenPath(modelPath));
  ipcMain.handle("forge:readLocalImage", async (_e, imagePath: unknown) =>
    forge.readLocalImage(imagePath));
  ipcMain.handle("forge:writeTempFile", async (_e, args: { name: string; bytes: Uint8Array }) =>
    forge.writeTempModelFile(args.name, args.bytes));
  ipcMain.handle("forge:saveExport", async (_e, args: { name: string; bytes: Uint8Array }) =>
    forge.saveExportFile(args, mainWindow && !mainWindow.isDestroyed() ? mainWindow : null));
  ipcMain.handle("forge:openRemote", async (_e, url: string) => {
    if (!url || typeof url !== "string") throw new Error("forge:openRemote requires a URL");
    return forge.openRemoteModel(url, mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
  });

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

  // Dev portal (terminal, npm, vscode, pods, node)
  ipcMain.handle("dev:terminal", (_e, cmd: string, cwd?: string) => devPortal.runTerminalCommand(cmd, cwd));
  ipcMain.handle("dev:npmRun", (_e, script: string, cwd?: string) => devPortal.runNpmScript(script, cwd));
  ipcMain.handle("dev:openVsCode", (_e, dir?: string) => devPortal.openVsCode(dir));
  ipcMain.handle("dev:listPods", () => devPortal.listLocalPods());
  ipcMain.handle("dev:spawnNode", (_e, scriptPath: string, cwd?: string) => devPortal.spawnNodeScript(scriptPath, cwd));
  ipcMain.handle("dev:getWorkspaceDir", () => devPortal.getWorkspaceDir());
  ipcMain.handle("dev:setWorkspaceDir", (_e, dir: string) => { devPortal.setWorkspaceDir(dir); return { ok: true }; });

  // Coder (local GrudachainCode IDE)
  ipcMain.handle("coder:launch", (_e, opts) => coder.launch(opts));
  ipcMain.handle("coder:stop", () => coder.stop());
  ipcMain.handle("coder:status", () => coder.getStatus());
  ipcMain.handle("coder:open", () => { coder.openInBrowser(); });
  ipcMain.handle("coder:pickProjectDir", async () => {
    const r = await dialog.showOpenDialog(mainWindow ?? (undefined as any), {
      title: "Select Coder workspace folder",
      properties: ["openDirectory"],
    });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });

  // Model inspection (gltf-transform scene graph — parent/child tree, meshes, materials, skins, animations)
  ipcMain.handle("model:inspect", (_e, path: string) => inspectModel(path));

  // Asset understand — structured card for AI agents (kind, open hints, model inspect, optional vision)
  ipcMain.handle(
    "asset:understand",
    (
      _e,
      args: { path?: string; name?: string; url?: string; contentType?: string; size?: number; withAi?: boolean },
    ) => understandAsset(args ?? {}),
  );

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
      const liveArr = Array.isArray(live) ? live : [];
      return { static: FLEET_GAMES, live: liveArr, merged: mergeFleetGames(FLEET_GAMES, liveArr) };
    } catch {
      return { static: FLEET_GAMES, live: [], merged: FLEET_GAMES };
    }
  });
  ipcMain.handle("fleet:endpoints", () => FLEET_ENDPOINTS);
  ipcMain.handle("fleet:storeCategories", () => STORE_CATEGORIES);
  ipcMain.handle("fleet:gameDeployments", () => GAME_DEPLOYMENT_DEFINITIONS);
  ipcMain.handle("fleet:objectStore", (_e, path: string) => legion.fetchObjectStoreCatalog(path));
  // ONE TRUTH fleet health + AI worker ops (no parallel stacks)
  ipcMain.handle("fleet:health", () => runFleetHealthCheck());
  ipcMain.handle("fleet:ops", () => getFleetOperationsStatus());
  ipcMain.handle("fleet:aiWorkers", () => checkAllAiWorkers());
  ipcMain.handle("fleet:aiModels", () => listAvailableModels());
  ipcMain.handle("fleet:aiChat", (_e, req) => aiChat(req));
  // Scene Completion AI Worker — weld / patch / skeleton plans
  ipcMain.handle("fleet:sceneCompletionInfo", () => sceneCompletionWorkerInfo());
  ipcMain.handle("fleet:sceneCompletionPlan", (_e, req) => planSceneCompletion(req));
  // Pipeline Review AI Worker — convert-before-upload / SI / laterality / CDN HEAD
  ipcMain.handle("fleet:pipelineReviewInfo", () => pipelineReviewWorkerInfo());
  ipcMain.handle("fleet:pipelineReviewPlan", (_e, req) => planPipelineReview(req));
  ipcMain.handle("fleet:pipelinePrepareUpload", (_e, args: { localPath: string; name?: string }) =>
    preparePipelineUpload(args));
  ipcMain.handle("fleet:pipelineHeadCdn", (_e, url: string) => headCdnVerify(url));

  // In-app Agent AI (no browser) — Ollama → Workers AI → Legion
  ipcMain.handle("agent:status", () => localAgentStatus());
  ipcMain.handle("agent:run", (_e, opts: { task: string; projectId?: string; role?: string }) =>
    runLocalAgent(opts ?? { task: "" }),
  );
  ipcMain.handle("agent:orchestrate", (_e, opts: { task: string; projectId?: string }) =>
    runLocalOrchestrator(opts ?? { task: "" }),
  );
  ipcMain.handle(
    "agent:chat",
    (_e, opts: { messages: Array<{ role: "system" | "user" | "assistant"; content: string }> }) =>
      localAgentChat(opts?.messages ?? []),
  );

  ipcMain.handle("plugin:status", () => getPluginHostStatus());
  ipcMain.handle("plugin:token", () => ({
    token: getPluginToken(),
    status: getPluginHostStatus(),
  }));

  // Ollama / GRUDACHAIN local agentic AI
  ipcMain.handle("ollama:health", () => ollama.ollamaHealth());
  ipcMain.handle("ollama:models", async () => {
    try {
      return await ollama.ollamaModels();
    } catch {
      return [];
    }
  });
  ipcMain.handle("ollama:chat", (_e, opts) => ollama.ollamaChat(opts));
  ipcMain.handle("ollama:generate", (_e, opts) => ollama.ollamaGenerate(opts));
  ipcMain.handle("ollama:getHost", () => ollama.getOllamaHost());
  ipcMain.handle("ollama:setHost", (_e, host: string) => { ollama.setOllamaHost(host); });
  ipcMain.handle("ollama:getModel", () => ollama.getPreferredModel());
  ipcMain.handle("ollama:setModel", (_e, model: string) => { ollama.setPreferredModel(model); });
  ipcMain.handle("ollama:getAiPref", () => ollama.getAiPreference());
  ipcMain.handle("ollama:setAiPref", (_e, pref: any) => { ollama.setAiPreference(pref); });
  ipcMain.handle("ollama:status", () => ollama.getStatus());
  ipcMain.handle("ollama:ensure", (_e, opts?: { agentic?: boolean; reason?: string }) =>
    ollama.ensureRunning({ reason: opts?.reason ?? "ipc", agentic: opts?.agentic === true }),
  );
  ipcMain.handle("ollama:start", () => ollama.ensureRunning({ reason: "ipc-start", agentic: true }));
  ipcMain.handle("ollama:stop", () => {
    ollama.shutdown();
    return ollama.getStatus();
  });
  ipcMain.handle("ollama:download", () => {
    ollama.openDownloadPage();
    return { ok: true };
  });
  ipcMain.handle("ollama:pull", async (_e, model: string) => ollama.pullModel(model));

  // UUID utilities (local, no network)
  ipcMain.handle("uuid:gen", (_e, args) =>
    ({ uuid: generateGrudgeUUID(args.slot, args.tier ?? null, args.itemId ?? 1) }));
  ipcMain.handle("uuid:parse", (_e, uuid: string) => parseGrudgeUUID(uuid));
  ipcMain.handle("uuid:describe", (_e, uuid: string) => describeGrudgeUUID(uuid));
  ipcMain.handle("uuid:valid", (_e, uuid: string) => isValidGrudgeUUID(uuid));
  ipcMain.handle("uuid:slots", () => SLOT_CODES);
  ipcMain.handle("uuid:tiers", () => TIER_CODES);
}
