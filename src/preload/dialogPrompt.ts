import { contextBridge, ipcRenderer } from "electron";
import { APP_NATIVE_CHANNELS } from "../shared/appNative";
/** Electron disables window.prompt. Preserve synchronous editor call sites in
 * a guest/pop-out while its owner window presents the asynchronous dialog.
 * This exposes only a text request, never arbitrary IPC or Node access. */
export function installDialogPrompt() {
  contextBridge.exposeInMainWorld("grudgeTextDialog", (message: string, value = "") => ipcRenderer.sendSync(APP_NATIVE_CHANNELS.syncText, String(message), String(value)));
  contextBridge.executeInMainWorld({ func: () => {
    const page = globalThis as unknown as { prompt: (message?: string, value?: string) => string | null; grudgeTextDialog: (message: string, value: string) => string | null };
    page.prompt = (message = "", value = "") => page.grudgeTextDialog(String(message), String(value));
  } });
}
