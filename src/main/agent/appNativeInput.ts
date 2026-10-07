import { AppDownloads } from "./appDownloads";
import { BrowserWindow, type WebContents } from "electron";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { parseKeys, parsePointer } from "../../shared/appNative";
import type { AppActionDecision } from "../../shared/appActions";
import { appDialogs } from "./appDialogs";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** Chromium input goes only to the observed app-owned WebContents. No OS-wide
 * keyboard, clipboard, shell, generated JavaScript or foreign-window access. */
export class AppNativeInput {
  private attached = new Map<number, { contents: WebContents; listener: (...args: any[]) => void }>();
  private active = false;
  private downloads = new AppDownloads();
  begin() { this.active = true; }
  async watch(contents: WebContents) {
    if (!this.active || this.attached.has(contents.id)) return;
    if (contents.debugger.isAttached()) throw new Error("Close this tool's DevTools debugger before using prompt file dialogs.");
    contents.debugger.attach("1.3");
    this.downloads.watch(contents);
    const listener = (_: unknown, method: string, params: any) => {
      void (async () => {
        if (method === "Page.fileChooserOpened") {
          const selected = await appDialogs.showOpenDialog({ title: "Choose files", properties: params.mode === "selectMultiple" ? ["openFile", "multiSelections"] : ["openFile"] });
          if (!selected.canceled) {
            await contents.debugger.sendCommand("DOM.setFileInputFiles", { backendNodeId: params.backendNodeId, files: selected.filePaths });
            appDialogs.record(`File input selected: ${selected.filePaths.join(", ")}`, `selection-${contents.id}`);
          }
        }
        if (method === "Page.javascriptDialogOpening") {
          const answer = await appDialogs.request(params.type === "prompt" ? "text" : "confirm", String(params.message), String(params.defaultPrompt ?? ""));
          await contents.debugger.sendCommand("Page.handleJavaScriptDialog", { accept: answer !== false && answer !== null, ...(typeof answer === "string" ? { promptText: answer } : {}) });
        }
      })().catch(() => { if (!contents.isDestroyed()) void contents.debugger.sendCommand("Page.handleJavaScriptDialog", { accept: false }).catch(() => undefined); });
    };
    this.attached.set(contents.id, { contents, listener });
    contents.debugger.on("message", listener);
    try { await contents.debugger.sendCommand("Page.enable"); await contents.debugger.sendCommand("Page.setInterceptFileChooserDialog", { enabled: true }); }
    catch (error) { this.unwatch(contents.id); throw error; }
  }
  private unwatch(id: number) {
    const entry = this.attached.get(id); if (!entry) return;
    this.attached.delete(id);
    if (!entry.contents.isDestroyed()) { entry.contents.debugger.removeListener("message", entry.listener); if (entry.contents.debugger.isAttached()) entry.contents.debugger.detach(); }
  }
  async end() {
    this.active = false; this.downloads.end();
    await Promise.all([...this.attached.values()].map(async ({ contents }) => {
      if (!contents.isDestroyed() && contents.debugger.isAttached()) {
        await contents.debugger.sendCommand("Page.handleJavaScriptDialog", { accept: false }).catch(() => undefined);
        await contents.debugger.sendCommand("Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => undefined);
      }
      this.unwatch(contents.id);
    }));
  }
  async execute(contents: WebContents, decision: AppActionDecision, prepared: string): Promise<string> {
    const target = JSON.parse(prepared);
    if (!target.native || !/^[a-f0-9-]{36}$/.test(target.marker)) throw new Error("Native input did not bind to the observed control.");
    if (contents.getURL() !== target.url) throw new Error("APP_CONTROLS_CHANGED: The input document navigated.");
    const valid = await contents.executeJavaScriptInIsolatedWorld(998, [{ code: `(()=>{const el=document.querySelector('[data-grudge-native-target="${target.marker}"]');if(!el)return false;const r=el.getBoundingClientRect(),p=${JSON.stringify(target.rect)};return ['x','y','width','height'].every(k=>Math.abs(r[k]-p[k])<1)})()` }]);
    if (!valid) throw new Error("APP_CONTROLS_CHANGED: The input control moved or was replaced.");
    const parent = BrowserWindow.fromWebContents(contents.hostWebContents ?? contents);
    const needsFocus = Boolean(parent && (!parent.isVisible() || !parent.isFocused()));
    parent?.show(); parent?.focus(); contents.focus();
    if (needsFocus) {
      // A newly shown window can have a DOM before Chromium has published its
      // first hit-test surface. Wait for paint before delivering wheel/pointer
      // input; otherwise Chromium may discard that first event.
      await delay(200);
      await Promise.race([contents.executeJavaScriptInIsolatedWorld(998, [{ code: "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))" }]), delay(1000)]);
    }
    if (contents.isDestroyed() || contents.getURL() !== target.url) throw new Error("APP_CONTROLS_CHANGED: The input document changed while its window gained focus.");
    const key = (value: string) => {
      const input = parseKeys(value);
      contents.sendInputEvent({ type: "keyDown", ...input });
      contents.sendInputEvent({ type: "keyUp", ...input });
    };
    if (decision.action === "keys") key(decision.value);
    else if (decision.action === "type") await contents.insertText(decision.value);
    else if (decision.action === "pointer") {
      const p = parsePointer(decision.value), r = target.rect;
      const point = (x: number, y: number) => ({ x: Math.round(r.x + Math.min(.999, x) * r.width), y: Math.round(r.y + Math.min(.999, y) * r.height) });
      const start = point(p.x, p.y), finish = point(p.toX ?? p.x, p.toY ?? p.y), button = p.button ?? "left", modifiers = p.modifiers ?? [];
      contents.sendInputEvent({ type: "mouseMove", ...start, modifiers });
      await delay(40);
      if (contents.isDestroyed() || contents.getURL() !== target.url) throw new Error("APP_CONTROLS_CHANGED: The pointer document changed.");
      if (p.gesture === "wheel") contents.sendInputEvent({ type: "mouseWheel", ...start, deltaX: p.deltaX ?? 0, deltaY: p.deltaY ?? -120, canScroll: true, modifiers });
      else if (p.gesture !== "move") {
        for (let click = 1; click <= (p.gesture === "double-click" ? 2 : 1); click++) {
          contents.sendInputEvent({ type: "mouseDown", ...start, button, clickCount: click, modifiers });
          try {
            if (p.gesture === "drag") for (let i = 1; i <= 12; i++) {
              contents.sendInputEvent({ type: "mouseMove", x: Math.round(start.x + (finish.x - start.x) * i / 12), y: Math.round(start.y + (finish.y - start.y) * i / 12), modifiers: [...modifiers, `${button}buttondown` as const] });
              await delay(16);
            }
          } finally { if (!contents.isDestroyed()) contents.sendInputEvent({ type: "mouseUp", ...finish, button, clickCount: click, modifiers }); }
        }
      }
    } else if (decision.action === "files") {
      if (!target.file) throw new Error("This is not the observed file input.");
      const files: string[] = JSON.parse(decision.value);
      if (!target.multiple && files.length > 1) throw new Error("This file input accepts one file.");
      for (const file of files) {
        if (!isAbsolute(file) || !(await stat(file)).isFile()) throw new Error("Select an existing absolute file path.");
        const extensions = String(target.accept).split(",").map(v => v.trim()).filter(v => v.startsWith("."));
        if (extensions.length && !String(target.accept).includes("/") && !extensions.some(e => file.toLowerCase().endsWith(e.toLowerCase()))) throw new Error("The selected file format is not accepted.");
      }
      await this.watch(contents);
      const { root } = await contents.debugger.sendCommand("DOM.getDocument");
      const { nodeId } = await contents.debugger.sendCommand("DOM.querySelector", { nodeId: root.nodeId, selector: `[data-grudge-native-target="${target.marker}"]` });
      if (!nodeId) throw new Error("APP_CONTROLS_CHANGED: The file input was replaced.");
      await contents.debugger.sendCommand("DOM.setFileInputFiles", { nodeId, files });
    } else throw new Error("Unknown native input action.");
    return `Applied ${decision.action} to ${target.label}: ${decision.value.slice(0, 160)}; verify the resulting app state${target.state ? ` [Before input: ${String(target.state).slice(0, 300)}]` : ""}`;
  }
}
