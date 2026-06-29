import { Tray, Menu, nativeImage, BrowserWindow, app } from "electron";
import { join } from "node:path";
import { showLoader, hideLoader, toggleLoader, getLoaderWindow } from "./loader";

let tray: Tray | null = null;

function trayIconPath(): string {
  // Resolved relative to the running main process (dist/main during prod).
  const candidates = [
    join(process.resourcesPath ?? "", "tray.png"),
    join(__dirname, "..", "..", "resources", "tray.png"),
    join(__dirname, "..", "..", "..", "resources", "tray.png"),
  ];
  for (const p of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      if (require("node:fs").existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  return candidates[candidates.length - 1];
}

export function createTray(getWindow: () => BrowserWindow | null): Tray {
  const img = nativeImage.createFromPath(trayIconPath());
  if (img.isEmpty()) {
    console.warn("[tray] icon not found, falling back to default. Run `npm run build:icons` first.");
  }
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip("Grudge Dev Tool");

  const showWindow = (route?: string) => {
    const w = getWindow();
    if (!w) return;
    if (!w.isVisible()) w.show();
    w.focus();
    if (route) {
      w.webContents.send("nav", route);
    }
  };

  const menu = Menu.buildFromTemplate([
    { label: "Grudge Dev Tool", enabled: false },
    { type: "separator" },
    { label: "GrudgeLoader (always-on-top)", click: () => toggleLoader() },
    { label: "Hide GrudgeLoader",            click: () => hideLoader() },
    { type: "separator" },
    { label: "Show Browser",       click: () => showWindow("/browser") },
    { label: "Search\u2026",        click: () => showWindow("/search") },
    { label: "Quick Upload\u2026",  click: () => showWindow("/upload") },
    { label: "Generate UUID\u2026", click: () => showWindow("/uuid") },
    { label: "BlenderKit Library",  click: () => showWindow("/library") },
    { type: "separator" },
    { label: "Open Docs",      click: () => showWindow("/docs") },
    { label: "Settings",       click: () => showWindow("/settings") },
    { type: "separator" },
    { label: "Quit",           click: () => { app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  // Left-click toggles the small GrudgeLoader; double-click opens the main window.
  tray.on("click", () => toggleLoader());
  tray.on("double-click", () => showWindow());
  return tray;
}

export function disposeTray() {
  tray?.destroy();
  tray = null;
}
