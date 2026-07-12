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
  // Treaty social (friends, DMs, groups)
  treaty: {
    whoami: () => ipcRenderer.invoke("treaty:whoami"),
    social: () => ipcRenderer.invoke("treaty:social"),
    friendRequest: (query: string) => ipcRenderer.invoke("treaty:friendRequest", query),
    friendRespond: (id: string, accept: boolean) => ipcRenderer.invoke("treaty:friendRespond", id, accept),
    dmThreads: () => ipcRenderer.invoke("treaty:dmThreads"),
    openDm: (friendAccountId: string) => ipcRenderer.invoke("treaty:openDm", friendAccountId),
    dmMessages: (threadId: string) => ipcRenderer.invoke("treaty:dmMessages", threadId),
    sendDm: (threadId: string, content: string) => ipcRenderer.invoke("treaty:sendDm", threadId, content),
    groups: () => ipcRenderer.invoke("treaty:groups"),
    createGroup: (name: string, description?: string, members?: string[]) =>
      ipcRenderer.invoke("treaty:createGroup", name, description, members),
    inviteGroup: (groupId: string, query: string) => ipcRenderer.invoke("treaty:inviteGroup", groupId, query),
    leaveGroup: (groupId: string) => ipcRenderer.invoke("treaty:leaveGroup", groupId),
    groupMessages: (groupId: string) => ipcRenderer.invoke("treaty:groupMessages", groupId),
    sendGroup: (groupId: string, content: string) => ipcRenderer.invoke("treaty:sendGroup", groupId, content),
    unread: () => ipcRenderer.invoke("treaty:unread"),
  },
  // Global Grudge UUID asset registry
  registry: {
    stats: () => ipcRenderer.invoke("registry:stats"),
    load: () => ipcRenderer.invoke("registry:load"),
    getByPath: (path: string) => ipcRenderer.invoke("registry:getByPath", path),
    getByUuid: (uuid: string) => ipcRenderer.invoke("registry:getByUuid", uuid),
    ensurePath: (path: string, meta?: any) => ipcRenderer.invoke("registry:ensurePath", path, meta),
    lookupMany: (paths: string[]) => ipcRenderer.invoke("registry:lookupMany", paths),
    resolve: (uuidOrPath: string) => ipcRenderer.invoke("registry:resolve", uuidOrPath),
    uuidForPath: (path: string) => ipcRenderer.invoke("registry:uuidForPath", path),
    backfill: (opts?: { prefix?: string; limit?: number }) => ipcRenderer.invoke("registry:backfill", opts),
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
    pickDirectory: (opts?: { title?: string }) =>
      ipcRenderer.invoke("files:pickDirectory", opts) as Promise<string | null>,
    readBytes: (path: string) =>
      ipcRenderer.invoke("files:readBytes", path) as Promise<{ bytes: number[]; size: number; name: string }>,
  },
  model: {
    inspect: (path: string) => ipcRenderer.invoke("model:inspect", path),
  },
  archive: {
    unzip: (path: string, destDir?: string) => ipcRenderer.invoke("archive:unzip", path, destDir),
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
    /** Sync Puter login → Grudge session cookies + launch tokens for Forge/Coder webviews. */
    syncStudioSso: () => ipcRenderer.invoke("auth:syncStudioSso"),
    getStudioSso: () => ipcRenderer.invoke("auth:getStudioSso"),
    /** Puter token for injecting into module webviews (localStorage). */
    getPuterTokenForModules: () => ipcRenderer.invoke("auth:getPuterTokenForModules"),
    /** Full Puter + Grudge session payload for one-login module embeds. */
    getModuleAuthBundle: () => ipcRenderer.invoke("auth:getModuleAuthBundle"),
    clearStudioSso: () => ipcRenderer.invoke("auth:clearStudioSso"),
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
  // Forge3D editor / Windows 3D viewer
  forge: {
    /** Returns the path captured from argv before the renderer mounted (or null). */
    consumeInitialFile: () => ipcRenderer.invoke("forge:consumeInitialFile"),
    /** Read a file from disk and hand the bytes back to the renderer. */
    readFile: (path: string) => ipcRenderer.invoke("forge:readFile", path),
    /** Download a public CDN model and open it in Forge 3D. */
    openRemote: (url: string) => ipcRenderer.invoke("forge:openRemote", url) as Promise<{ path: string; name: string }>,
    openPath: (path: string) => ipcRenderer.invoke("forge:openPath", path) as Promise<{ path: string; name: string; resourceBaseUrl?: string }>,
    /** Pop out the 3D viewport to a separate window. */
    popOut: () => ipcRenderer.invoke("forge:popOut"),
    /** Listener for second-instance "Open with..." events. */
    onOpenFile: (cb: (info: { path: string; name: string; resourceBaseUrl?: string }) => void) => {
      const listener = (_e: any, info: { path: string; name: string; resourceBaseUrl?: string }) => cb(info);
      ipcRenderer.on("forge:openFile", listener);
      return () => ipcRenderer.removeListener("forge:openFile", listener);
    },
  },
  // AI Gateway
  ai: {
    chat: (opts: any) => ipcRenderer.invoke("ai:chat", opts),
    caption: (opts: any) => ipcRenderer.invoke("ai:caption", opts),
    proxy: (opts: any) => ipcRenderer.invoke("ai:proxy", opts),
    providerStatus: () => ipcRenderer.invoke("ai:providerStatus"),
    setProviderKey: (id: string, key: string) => ipcRenderer.invoke("ai:setProviderKey", id, key),
    clearProviderKey: (id: string) => ipcRenderer.invoke("ai:clearProviderKey", id),
    probeProviders: () => ipcRenderer.invoke("ai:probeProviders"),
    huggingfaceHealth: () => ipcRenderer.invoke("ai:huggingfaceHealth"),
    getHfModel: () => ipcRenderer.invoke("ai:getHfModel"),
    setHfModel: (model: string) => ipcRenderer.invoke("ai:setHfModel", model),
  },
  // GrudaChain — AnythingLLM local RAG + agentic dev copilot (Ctrl+/)
  grudachain: {
    health: () => ipcRenderer.invoke("grudachain:health"),
    workspaces: () => ipcRenderer.invoke("grudachain:workspaces"),
    chat: (opts: any) => ipcRenderer.invoke("grudachain:chat", opts),
    getConfig: () => ipcRenderer.invoke("grudachain:getConfig"),
    setConfig: (cfg: any) => ipcRenderer.invoke("grudachain:setConfig", cfg),
    clearApiKey: () => ipcRenderer.invoke("grudachain:clearApiKey"),
    onToggle: (cb: () => void) => {
      const listener = () => cb();
      ipcRenderer.on("grudachain:toggle", listener);
      return () => ipcRenderer.removeListener("grudachain:toggle", listener);
    },
  },
  // Project OS — organized folders, diagnose, auto-fix, best CDN assets
  projects: {
    root: () => ipcRenderer.invoke("projects:root") as Promise<string>,
    setRoot: (path: string | null) => ipcRenderer.invoke("projects:setRoot", path),
    pickRoot: () => ipcRenderer.invoke("projects:pickRoot") as Promise<string | null>,
    list: (root?: string) => ipcRenderer.invoke("projects:list", root),
    scaffold: (opts: {
      name: string;
      kind?: string;
      description?: string;
      parentDir?: string;
      withStarterScene?: boolean;
      withStarterScript?: boolean;
    }) => ipcRenderer.invoke("projects:scaffold", opts),
    diagnose: (dir: string) => ipcRenderer.invoke("projects:diagnose", dir),
    autofix: (dir: string) => ipcRenderer.invoke("projects:autofix", dir),
    open: (dir: string) => ipcRenderer.invoke("projects:open", dir),
    pickOpen: () => ipcRenderer.invoke("projects:pickOpen") as Promise<string | null>,
    read: (dir: string) => ipcRenderer.invoke("projects:read", dir),
    touch: (dir: string, patch?: any) => ipcRenderer.invoke("projects:touch", dir, patch),
    saveDraft: (dir: string, payload: any) => ipcRenderer.invoke("projects:saveDraft", dir, payload),
    layout: () => ipcRenderer.invoke("projects:layout") as Promise<string>,
    bestAssets: (query: string, limit?: number) =>
      ipcRenderer.invoke("projects:bestAssets", query, limit),
    verifyAssets: (dir: string) => ipcRenderer.invoke("projects:verifyAssets", dir),
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
  // Grudge Engine — The-ENGINE portal + character viewer
  engine: {
    launch: (opts?: { port?: number; engineRoot?: string }) => ipcRenderer.invoke("engine:launch", opts),
    stop: () => ipcRenderer.invoke("engine:stop"),
    status: () => ipcRenderer.invoke("engine:status"),
    open: (path?: string) => ipcRenderer.invoke("engine:open", path),
    getPrefs: () => ipcRenderer.invoke("engine:getPrefs") as Promise<{
      engineRoot: string;
      enginePort: number;
      engineUseLocal: boolean;
    }>,
    setPrefs: (patch: { engineRoot?: string; enginePort?: number; engineUseLocal?: boolean }) =>
      ipcRenderer.invoke("engine:setPrefs", patch),
    pickRoot: () => ipcRenderer.invoke("engine:pickRoot") as Promise<string | null>,
  },
  // Coder (local GrudachainCode IDE)
  coder: {
    launch: (opts?: any) => ipcRenderer.invoke("coder:launch", opts),
    stop: () => ipcRenderer.invoke("coder:stop"),
    status: () => ipcRenderer.invoke("coder:status"),
    open: () => ipcRenderer.invoke("coder:open"),
    getPrefs: () => ipcRenderer.invoke("coder:getPrefs") as Promise<{ coderRoot: string; coderProjectDir: string; coderPort: number }>,
    setPrefs: (patch: { coderRoot?: string; coderProjectDir?: string; coderPort?: number }) =>
      ipcRenderer.invoke("coder:setPrefs", patch),
    pickRoot: () => ipcRenderer.invoke("coder:pickRoot") as Promise<string | null>,
    pickProject: () => ipcRenderer.invoke("coder:pickProject") as Promise<string | null>,
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
