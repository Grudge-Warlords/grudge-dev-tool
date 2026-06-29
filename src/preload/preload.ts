import { contextBridge, ipcRenderer, webUtils } from "electron";

const api = {
  // Settings
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    setApiBase: (url: string) => ipcRenderer.invoke("settings:setApiBase", url),
    setAssetsApiBase: (url: string) => ipcRenderer.invoke("settings:setAssetsApiBase", url),
    clearAssetsApiBase: () => ipcRenderer.invoke("settings:clearAssetsApiBase"),
    setToken: (token: string) => ipcRenderer.invoke("settings:setToken", token),
    clearToken: () => ipcRenderer.invoke("settings:clearToken"),
    setBlenderKitKey: (key: string) => ipcRenderer.invoke("settings:setBlenderKitKey", key),
    clearBlenderKitKey: () => ipcRenderer.invoke("settings:clearBlenderKitKey"),
    toolchain: () => ipcRenderer.invoke("settings:toolchain"),
  },
  // Object storage
  os: {
    list: (req: any) => ipcRenderer.invoke("os:list", req),
    search: (req: any) => ipcRenderer.invoke("os:search", req),
    assetMeta: (req: any) => ipcRenderer.invoke("os:assetMeta", req),
    openExternal: (url: string) => ipcRenderer.invoke("os:openExternal", url),
  },
  // Upload
  upload: {
    enqueue: (job: any) => ipcRenderer.invoke("upload:enqueue", job),
    cancel: (jobId: string) => ipcRenderer.invoke("upload:cancel", jobId),
    onProgress: (cb: (p: any) => void) => {
      const listener = (_e: any, p: any) => cb(p);
      ipcRenderer.on("upload:progress", listener);
      return () => ipcRenderer.removeListener("upload:progress", listener);
    },
    onJobDone: (cb: (p: any) => void) => {
      const listener = (_e: any, p: any) => cb(p);
      ipcRenderer.on("upload:job-done", listener);
      return () => ipcRenderer.removeListener("upload:job-done", listener);
    },
  },
  // Ingestion (single file)
  ingest: {
    one: (path: string, opts: any) => ipcRenderer.invoke("ingest:one", { path, opts }),
  },
  // BlenderKit
  bk: {
    search: (opts: any) => ipcRenderer.invoke("bk:search", opts),
    download: (opts: any) => ipcRenderer.invoke("bk:download", opts),
    report: () => ipcRenderer.invoke("bk:report"),
    ensure: () => ipcRenderer.invoke("bk:ensure"),
  },
  // UUID utilities
  uuid: {
    gen: (args: { slot: string; tier?: number | null; itemId?: number }) =>
      ipcRenderer.invoke("uuid:gen", args),
    parse: (uuid: string) => ipcRenderer.invoke("uuid:parse", uuid),
    describe: (uuid: string) => ipcRenderer.invoke("uuid:describe", uuid),
    valid: (uuid: string) => ipcRenderer.invoke("uuid:valid", uuid),
    slots: () => ipcRenderer.invoke("uuid:slots"),
    tiers: () => ipcRenderer.invoke("uuid:tiers"),
  },
  // GrudgeLoader window control
  loader: {
    show: () => ipcRenderer.invoke("loader:show"),
    hide: () => ipcRenderer.invoke("loader:hide"),
    toggle: () => ipcRenderer.invoke("loader:toggle"),
  },
  // Connectivity
  connectivity: {
    get: () => ipcRenderer.invoke("connectivity:get"),
    onChange: (cb: (s: any) => void) => {
      const listener = (_e: any, s: any) => cb(s);
      ipcRenderer.on("connectivity:changed", listener);
      return () => ipcRenderer.removeListener("connectivity:changed", listener);
    },
  },
  // Auto-update
  updater: {
    check: () => ipcRenderer.invoke("updater:check"),
    install: () => ipcRenderer.invoke("updater:install"),
    onStatus: (cb: (s: any) => void) => {
      const listener = (_e: any, s: any) => cb(s);
      ipcRenderer.on("updater:status", listener);
      return () => ipcRenderer.removeListener("updater:status", listener);
    },
  },
  // Auto-launch (Windows startup)
  autoLaunch: {
    get: () => ipcRenderer.invoke("settings:getAutoLaunch"),
    set: (enabled: boolean) => ipcRenderer.invoke("settings:setAutoLaunch", enabled),
  },
  // Diagnostics
  diag: {
    logFile: () => ipcRenderer.invoke("diag:logFile"),
    openLogFolder: () => ipcRenderer.invoke("diag:openLogFolder"),
  },
  // Local file paths (sandbox-safe drag-drop)
  files: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    pickForUpload: () => ipcRenderer.invoke("files:pickForUpload") as Promise<string[]>,
  },
  // App lifecycle
  app: {
    quit: () => ipcRenderer.invoke("app:quit"),
    hide: () => ipcRenderer.invoke("app:hide"),
    openRoute: (route: string) => ipcRenderer.invoke("app:openRoute", route),
  },
  // Auth (Puter ↔ Grudge ID)
  auth: {
    getSession: () => ipcRenderer.invoke("auth:getSession"),
    setSession: (token: string, user: any) => ipcRenderer.invoke("auth:setSession", token, user),
    clearSession: () => ipcRenderer.invoke("auth:clearSession"),
    wipeIdentity: () => ipcRenderer.invoke("auth:wipeIdentity"),
    getPuterToken: () => ipcRenderer.invoke("auth:getPuterToken"),
    /** In-app Puter OAuth; auto-falls back to system browser on failure. */
    puterLogin: () => ipcRenderer.invoke("auth:puterLogin"),
    /** Puter sign-in via default browser + localhost callback. */
    puterLoginExternal: () => ipcRenderer.invoke("auth:puterLoginExternal"),
    /** Paste a Puter token; uuid/username resolved via /whoami or JWT. */
    setSessionFromToken: (token: string) => ipcRenderer.invoke("auth:setSessionFromToken", token),
  },
  // Cloudflare R2 + Worker
  cf: {
    status: () => ipcRenderer.invoke("cf:status"),
    set: (account: string, value: string) => ipcRenderer.invoke("cf:set", account, value),
    clear: (account: string) => ipcRenderer.invoke("cf:clear", account),
    workerHealth: () => ipcRenderer.invoke("cf:workerHealth"),
    r2Health: () => ipcRenderer.invoke("cf:r2Health"),
    resetR2Client: () => ipcRenderer.invoke("cf:resetR2Client"),
    aiHealth: () => ipcRenderer.invoke("cf:aiHealth"),
    getBackendMode: () => ipcRenderer.invoke("cf:getBackendMode"),
    setBackendMode: (mode: "auto" | "grudge" | "cloudflare" | "r2-direct" | "cloudflare-worker") => ipcRenderer.invoke("cf:setBackendMode", mode),
    // Direct R2 ops used by Forge3D for converting + uploading models.
    r2SignedUpload: (args: { key: string; contentType?: string; ttlSeconds?: number }) => ipcRenderer.invoke("cf:r2SignedUpload", args),
    r2SignedDownload: (args: { key: string; ttlSeconds?: number }) => ipcRenderer.invoke("cf:r2SignedDownload", args),
    r2List: (req: any) => ipcRenderer.invoke("cf:r2List", req),
    r2Head: (key: string) => ipcRenderer.invoke("cf:r2Head", key),
    r2PublicUrl: (key: string) => ipcRenderer.invoke("cf:r2PublicUrl", key),
  },
  // GLB/GLTF deep inspection (gltf-transform scene graph)
  model: {
    inspect: (path: string) => ipcRenderer.invoke("model:inspect", path),
  },
  // Forge3D editor / Windows 3D viewer
  forge: {
    /** Returns the path captured from argv before the renderer mounted (or null). */
    consumeInitialFile: () => ipcRenderer.invoke("forge:consumeInitialFile"),
    /** Read a file from disk and hand the bytes back to the renderer. */
    readFile: (path: string) => ipcRenderer.invoke("forge:readFile", path),
    writeTempFile: (args: { name: string; bytes: Uint8Array }) =>
      ipcRenderer.invoke("forge:writeTempFile", args) as Promise<string>,
    /** Download a public CDN model and open it in Forge 3D. */
    openRemote: (url: string) => ipcRenderer.invoke("forge:openRemote", url) as Promise<{ path: string; name: string }>,
    /** Pop out the 3D viewport to a separate window. */
    popOut: () => ipcRenderer.invoke("forge:popOut"),
    /** Listener for second-instance "Open with..." events. */
    onOpenFile: (cb: (info: { path: string; name: string }) => void) => {
      const listener = (_e: any, info: { path: string; name: string }) => cb(info);
      ipcRenderer.on("forge:openFile", listener);
      return () => ipcRenderer.removeListener("forge:openFile", listener);
    },
  },
  // AI Gateway
  ai: {
    chat: (opts: any) => ipcRenderer.invoke("ai:chat", opts),
    caption: (opts: any) => ipcRenderer.invoke("ai:caption", opts),
    proxy: (opts: any) => ipcRenderer.invoke("ai:proxy", opts),
  },
  // Legion orchestrator (hub + GRUDA Agent + whisper)
  legion: {
    health: () => ipcRenderer.invoke("legion:health"),
    agents: () => ipcRenderer.invoke("legion:agents"),
    chat: (opts: any) => ipcRenderer.invoke("legion:chat", opts),
    models: () => ipcRenderer.invoke("legion:models"),
    getHubUrl: () => ipcRenderer.invoke("legion:getHubUrl"),
    setHubUrl: (url: string) => ipcRenderer.invoke("legion:setHubUrl", url),
    getAgentUrl: () => ipcRenderer.invoke("legion:getAgentUrl"),
    setAgentUrl: (url: string) => ipcRenderer.invoke("legion:setAgentUrl", url),
    getFleetKey: () => ipcRenderer.invoke("legion:getFleetKey"),
    setFleetKey: (key: string) => ipcRenderer.invoke("legion:setFleetKey", key),
    clearFleetKey: () => ipcRenderer.invoke("legion:clearFleetKey"),
    transcribe: (opts: { audioBase64: string; model?: string }) =>
      ipcRenderer.invoke("legion:transcribe", opts),
    whisperHealth: () => ipcRenderer.invoke("legion:whisperHealth"),
  },
  // Fleet games launcher + store
  fleet: {
    games: () => ipcRenderer.invoke("fleet:games"),
    endpoints: () => ipcRenderer.invoke("fleet:endpoints"),
    storeCategories: () => ipcRenderer.invoke("fleet:storeCategories"),
    objectStore: (path: string) => ipcRenderer.invoke("fleet:objectStore", path),
  },
  // Ollama (local AI)
  ollama: {
    health: () => ipcRenderer.invoke("ollama:health"),
    models: () => ipcRenderer.invoke("ollama:models"),
    chat: (opts: any) => ipcRenderer.invoke("ollama:chat", opts),
    generate: (opts: any) => ipcRenderer.invoke("ollama:generate", opts),
    getHost: () => ipcRenderer.invoke("ollama:getHost") as Promise<string>,
    setHost: (host: string) => ipcRenderer.invoke("ollama:setHost", host),
    getModel: () => ipcRenderer.invoke("ollama:getModel") as Promise<string>,
    setModel: (model: string) => ipcRenderer.invoke("ollama:setModel", model),
    getAiPref: () => ipcRenderer.invoke("ollama:getAiPref") as Promise<string>,
    setAiPref: (pref: string) => ipcRenderer.invoke("ollama:setAiPref", pref),
  },
  // Internal Preview tab — sandboxed <webview> for running .html files locally.
  preview: {
    /** Open a native file picker for .html/.htm and return its file:// URL. */
    openHtmlDialog: () => ipcRenderer.invoke("preview:openHtmlDialog") as Promise<{ canceled: boolean; url: string | null; path: string | null }>,
    /** Convert an absolute path to a file:// URL (used by drag-drop). */
    fileUrl: (absPath: string) => ipcRenderer.invoke("preview:fileUrl", absPath) as Promise<string>,
  },
  // Coder (local GrudachainCode IDE)
  coder: {
    launch: (opts?: any) => ipcRenderer.invoke("coder:launch", opts),
    stop: () => ipcRenderer.invoke("coder:stop"),
    status: () => ipcRenderer.invoke("coder:status"),
    open: () => ipcRenderer.invoke("coder:open"),
    pickProjectDir: () => ipcRenderer.invoke("coder:pickProjectDir"),
  },
  // Workspace memory (electron-store + localStorage mirror in renderer)
  workspace: {
    get: () => ipcRenderer.invoke("workspace:get"),
    patch: (patch: Record<string, unknown>) => ipcRenderer.invoke("workspace:patch", patch),
    export: () => ipcRenderer.invoke("workspace:export") as Promise<string>,
    import: (raw: string) => ipcRenderer.invoke("workspace:import", raw),
    reset: () => ipcRenderer.invoke("workspace:reset"),
    clearCaches: () => ipcRenderer.invoke("workspace:clearCaches") as Promise<string[]>,
  },
  // Tray-driven nav events
  onNav: (cb: (route: string) => void) => {
    const listener = (_e: any, route: string) => cb(route);
    ipcRenderer.on("nav", listener);
    return () => ipcRenderer.removeListener("nav", listener);
  },
};

contextBridge.exposeInMainWorld("grudge", api);
export type GrudgeApi = typeof api;
