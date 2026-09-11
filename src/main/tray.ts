import { Tray, Menu, nativeImage, BrowserWindow, app } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { showLoader, hideLoader, toggleLoader } from "./loader";
import { focusAllViewers } from "./viewer";

let tray: Tray | null = null;

function trayIconPath(): string {
  const candidates = [
    join(process.resourcesPath ?? "", "tray.png"),
    join(__dirname, "..", "..", "resources", "tray.png"),
    join(__dirname, "..", "..", "..", "resources", "tray.png"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[candidates.length - 1];
}

/**
 * Notification-area (▲ overflow) icon.
 * Left-click → GrudgeLoader bottom-right popup (v1.x UX).
 * Double-click → main admin shell.
 * Right-click → full surface menu.
 */
export function createTray(getWindow: () => BrowserWindow | null): Tray {
  const img = nativeImage.createFromPath(trayIconPath());
  if (img.isEmpty()) {
    console.warn("[tray] icon not found — run `npm run build:icons`. Tray may be invisible.");
  }
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 }));
  tray.setToolTip("Grudge Dev Tool — click for Loader");

  const showWindow = (route?: string) => {
    const w = getWindow();
    if (!w || w.isDestroyed()) return;
    if (!w.isVisible()) w.show();
    if (w.isMinimized()) w.restore();
    w.focus();
    if (route) w.webContents.send("nav", route);
  };

  const menu = Menu.buildFromTemplate([
    { label: "Grudge Dev Tool", enabled: false },
    { type: "separator" },
    {
      label: "GrudgeLoader (bottom-right)",
      click: () => toggleLoader(),
    },
    { label: "Hide GrudgeLoader", click: () => hideLoader() },
    { label: "Bring asset viewers to front", click: () => focusAllViewers() },
    { label: "Open main window", click: () => showWindow() },
    { type: "separator" },
    { label: "Home", click: () => showWindow("/studio") },
    { label: "Local Files", click: () => showWindow("/local") },
    { label: "Assets (CDN / ObjectStore)", click: () => showWindow("/browser") },
    { label: "ThreeFlow", click: () => showWindow("/threeflow") },
    { label: "Skeleton / Anim", click: () => showWindow("/skeleton") },
    { label: "Forge (live)", click: () => showWindow("/forge") },
    { label: "Local Forge / Pipeline", click: () => showWindow("/forge-local") },
    { label: "Preview playtests", click: () => showWindow("/preview") },
    { label: "Play", click: () => showWindow("/play") },
    { label: "Games", click: () => showWindow("/games") },
    { type: "separator" },
    { label: "Agent AI / Dev Portal", click: () => showWindow("/ai") },
    { label: "Legion Chat", click: () => showWindow("/legion") },
    { label: "Prompt to 3D", click: () => showWindow("/prompt3d") },
    { label: "Coder", click: () => showWindow("/coder") },
    { label: "Upload", click: () => showWindow("/upload") },
    { label: "BlenderKit", click: () => showWindow("/blenderkit") },
    { label: "Store", click: () => showWindow("/library") },
    { label: "Account", click: () => showWindow("/accounts") },
    { type: "separator" },
    { label: "Docs", click: () => showWindow("/docs") },
    { label: "Settings / ONE TRUTH", click: () => showWindow("/settings") },
    { type: "separator" },
    { label: "Quit", click: () => { app.quit(); } },
  ]);
  tray.setContextMenu(menu);

  // Windows notification overflow (▲): left-click must open the Loader popup.
  tray.on("click", () => {
    toggleLoader();
  });
  tray.on("double-click", () => {
    showWindow();
  });
  tray.on("right-click", () => {
    tray?.popUpContextMenu(menu);
  });

  return tray;
}

export function disposeTray() {
  tray?.destroy();
  tray = null;
}
