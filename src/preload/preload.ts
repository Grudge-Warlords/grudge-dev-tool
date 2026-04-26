import { contextBridge, ipcRenderer } from "electron";

const api = {
  // Settings
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    setApiBase: (url: string) => ipcRenderer.invoke("settings:setApiBase", url),
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
    show:   () => ipcRenderer.invoke("loader:show"),
    hide:   () => ipcRenderer.invoke("loader:hide"),
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
  // Cloudflare R2 + Worker
  cf: {
    status:           () => ipcRenderer.invoke("cf:status"),
    set:              (account: string, value: string) => ipcRenderer.invoke("cf:set", account, value),
    clear:            (account: string) => ipcRenderer.invoke("cf:clear", account),
    workerHealth:     () => ipcRenderer.invoke("cf:workerHealth"),
    r2Health:         () => ipcRenderer.invoke("cf:r2Health"),
    resetR2Client:    () => ipcRenderer.invoke("cf:resetR2Client"),
    aiHealth:         () => ipcRenderer.invoke("cf:aiHealth"),
    getBackendMode:   () => ipcRenderer.invoke("cf:getBackendMode"),
    setBackendMode:   (mode: "auto" | "grudge" | "cloudflare" | "r2-direct" | "cloudflare-worker") => ipcRenderer.invoke("cf:setBackendMode", mode),
  },
  // AI Gateway
  ai: {
    chat:    (opts: any) => ipcRenderer.invoke("ai:chat", opts),
    caption: (opts: any) => ipcRenderer.invoke("ai:caption", opts),
    proxy:   (opts: any) => ipcRenderer.invoke("ai:proxy", opts),
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
