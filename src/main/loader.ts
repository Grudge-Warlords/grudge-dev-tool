import { app, BrowserWindow, screen, nativeImage } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";

let loaderWindow: BrowserWindow | null = null;

const LOADER_WIDTH = 360;
const LOADER_HEIGHT = 520;
const LOADER_MARGIN = 16;

function loaderIconPath(): string {
  const candidates = [
    join(process.resourcesPath ?? "", "icon-256.png"),
    join(__dirname, "..", "..", "resources", "icon-256.png"),
    join(__dirname, "..", "..", "..", "resources", "icon-256.png"),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return candidates[candidates.length - 1];
}

function snapBottomRight(win: BrowserWindow) {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  const x = workArea.x + workArea.width - LOADER_WIDTH - LOADER_MARGIN;
  const y = workArea.y + workArea.height - LOADER_HEIGHT - LOADER_MARGIN;
  win.setBounds({ x, y, width: LOADER_WIDTH, height: LOADER_HEIGHT });
}

function loaderHtmlUrl(): string {
  // In dev, Vite serves both pages on 5173.
  // In prod, Vite emits dist/renderer/loader.html alongside index.html.
  if (!app.isPackaged) return "http://localhost:5173/loader.html";
  return `file://${join(__dirname, "..", "renderer", "loader.html")}`;
}

export function createLoaderWindow(): BrowserWindow {
  if (loaderWindow && !loaderWindow.isDestroyed()) return loaderWindow;

  loaderWindow = new BrowserWindow({
    width: LOADER_WIDTH,
    height: LOADER_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    icon: nativeImage.createFromPath(loaderIconPath()),
    webPreferences: {
      preload: join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  loaderWindow.setAlwaysOnTop(true, "screen-saver");
  loaderWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (!app.isPackaged) {
    loaderWindow.loadURL(loaderHtmlUrl());
  } else {
    loaderWindow.loadFile(join(__dirname, "..", "renderer", "loader.html"));
  }

  loaderWindow.on("closed", () => { loaderWindow = null; });
  return loaderWindow;
}

export function showLoader() {
  const win = createLoaderWindow();
  snapBottomRight(win);
  if (!win.isVisible()) win.show();
  win.focus();
}

export function hideLoader() {
  if (loaderWindow && !loaderWindow.isDestroyed() && loaderWindow.isVisible()) {
    loaderWindow.hide();
  }
}

export function toggleLoader() {
  if (!loaderWindow || loaderWindow.isDestroyed() || !loaderWindow.isVisible()) {
    showLoader();
  } else {
    hideLoader();
  }
}

export function getLoaderWindow(): BrowserWindow | null {
  return (loaderWindow && !loaderWindow.isDestroyed()) ? loaderWindow : null;
}

export function disposeLoader() {
  if (loaderWindow && !loaderWindow.isDestroyed()) {
    loaderWindow.destroy();
  }
  loaderWindow = null;
}
