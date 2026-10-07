import { app, dialog, BrowserWindow, type OpenDialogOptions, type SaveDialogOptions, type MessageBoxOptions, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { stat, readdir, mkdir } from "node:fs/promises";
import { resolve, isAbsolute, dirname } from "node:path";
import type { AppDialog, AppDialogAnswer, AppDialogListing } from "../../shared/appNative";

/** A prompt's file and confirmation requests stay in its own visible dialog panel.
 * Manual operations retain Electron's native dialogs. Ending a run cancels only
 * its unanswered dialogs; it never cancels another app job or GPU queue. */
class AppDialogs {
  private owner?: WebContents;
  private pending: Array<{ view: AppDialog; resolve: (answer: AppDialogAnswer) => void }> = [];
  private results = new Map<string, string>();
  isActive() { return Boolean(this.owner); }
  record(message: string, key = "latest") { this.results.set(key, message.slice(0, 600)); if (this.results.size > 12) this.results.delete(this.results.keys().next().value!); }
  status(owner: WebContents) { return this.owner === owner ? [...this.results.values()] : []; }
  begin(owner: WebContents) {
    if (this.owner && this.owner !== owner) throw new Error("Another app window is already running a prompt.");
    if (!this.owner) { this.owner = owner; this.results.clear(); owner.once("destroyed", () => { if (this.owner === owner) this.end(owner); }); }
  }
  end(owner: WebContents) {
    if (this.owner !== owner) return;
    this.owner = undefined;
    for (const p of this.pending.splice(0)) p.resolve({ id: p.view.id, response: p.view.cancelId });
  }
  observe(owner: WebContents) { return this.owner === owner ? this.pending[0]?.view ?? null : null; }
  private ask(view: Omit<AppDialog, "id">): Promise<AppDialogAnswer> {
    return new Promise(resolve => this.pending.push({ view: { ...view, id: randomUUID() }, resolve }));
  }
  private current(owner: WebContents, id: string) {
    const p = this.pending[0];
    if (owner !== this.owner || !p || p.view.id !== id) throw new Error("This dialog is no longer active.");
    return p;
  }
  async browse(owner: WebContents, id: string, value: string, offset = 0): Promise<AppDialogListing> {
    const { view } = this.current(owner, id);
    if (!["open", "save"].includes(view.kind) || !isAbsolute(value) || value.length > 2200 || !Number.isInteger(offset) || offset < 0) throw new Error("Choose an absolute folder path.");
    const candidate = resolve(value);
    const info = await stat(candidate).catch(() => null);
    let folder = info?.isDirectory() ? candidate : dirname(candidate);
    while (folder !== dirname(folder) && !(await stat(folder).catch(() => null))?.isDirectory()) folder = dirname(folder);
    const entries = (await readdir(folder, { withFileTypes: true })).filter(e => e.isDirectory() || !view.directory && this.matches(view, e.name)).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    this.current(owner, id);
    return { path: folder, parent: dirname(folder), entries: entries.slice(offset, offset + 80).map(e => ({ name: e.name, path: resolve(folder, e.name), directory: e.isDirectory() })), more: entries.length > offset + 80 };
  }
  private matches(view: AppDialog, path: string) { return !view.filters.length || view.filters.some(f => f.extensions.some(e => e === "*" || path.toLowerCase().endsWith(`.${e.toLowerCase()}`))); }
  async mkdir(owner: WebContents, id: string, parent: string, name: string) {
    const { view } = this.current(owner, id);
    if (!view.createDirectory || !isAbsolute(parent) || typeof name !== "string" || !name.trim() || name.length > 200 || /[\\/:*?"<>|]/.test(name) || [".", ".."].includes(name)) throw new Error("Enter a folder name inside the selected parent folder.");
    await mkdir(resolve(parent, name));
    return this.browse(owner, id, parent);
  }
  async answer(owner: WebContents, answer: AppDialogAnswer) {
    const p = this.current(owner, answer?.id), v = p.view;
    if (!Number.isInteger(answer.response) || answer.response < 0 || answer.response >= v.buttons.length || answer.text !== undefined && (typeof answer.text !== "string" || answer.text.length > 2200)) throw new Error("Invalid dialog answer.");
    if (answer.response !== v.cancelId && ["open", "save"].includes(v.kind)) {
      const paths = answer.paths;
      if (!Array.isArray(paths) || !paths.length || paths.length > (v.multiple ? 100 : 1)) throw new Error("Select the requested file or folder.");
      for (const path of paths) {
        if (typeof path !== "string" || path.length > 2200 || !isAbsolute(path) || path.includes("\0")) throw new Error("File selections require absolute paths.");
        const info = await stat(path).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
        if (v.kind === "open" && (!info || (v.directory ? !info.isDirectory() : !info.isFile()))) throw new Error(`The selected ${v.directory ? "folder" : "file"} does not exist.`);
        if (!v.directory && !this.matches(v, path)) throw new Error("The file does not match this dialog's allowed formats.");
        if (v.kind === "save") {
          if (info && !info.isFile()) throw new Error("The save destination is not a file.");
          if (!(await stat(dirname(path))).isDirectory()) throw new Error("The destination folder does not exist.");
          if (info && !answer.overwrite) throw new Error("The destination already exists. Select Replace existing file to confirm the overwrite.");
        }
      }
    }
    this.current(owner, answer.id);
    this.pending.shift(); p.resolve(answer);
  }
  async showOpenDialog(parentOrOptions: BrowserWindow | OpenDialogOptions | undefined, options?: OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
    const opts = (options ?? parentOrOptions) as OpenDialogOptions;
    if (!this.owner) return options && parentOrOptions ? dialog.showOpenDialog(parentOrOptions as BrowserWindow, opts) : dialog.showOpenDialog(opts);
    const a = await this.ask({ kind: "open", title: opts.title || "Open file", message: opts.message || "Choose a local path.", defaultPath: opts.defaultPath || app.getPath("documents"), buttons: [opts.buttonLabel || "Open", "Cancel"], cancelId: 1, directory: opts.properties?.includes("openDirectory") ?? false, multiple: opts.properties?.includes("multiSelections") ?? false, createDirectory: opts.properties?.includes("createDirectory") ?? false, filters: opts.filters ?? [] });
    return { canceled: a.response === 1, filePaths: a.response === 1 ? [] : a.paths!.map(p => resolve(p)) };
  }
  async showSaveDialog(parentOrOptions: BrowserWindow | SaveDialogOptions | undefined, options?: SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
    const opts = (options ?? parentOrOptions) as SaveDialogOptions;
    if (!this.owner) return options && parentOrOptions ? dialog.showSaveDialog(parentOrOptions as BrowserWindow, opts) : dialog.showSaveDialog(opts);
    const suggested = opts.defaultPath || "Untitled";
    const a = await this.ask({ kind: "save", title: opts.title || "Save file", message: opts.message || "Choose the destination file.", defaultPath: isAbsolute(suggested) ? suggested : resolve(app.getPath("documents"), suggested), buttons: [opts.buttonLabel || "Save", "Cancel"], cancelId: 1, directory: false, multiple: false, createDirectory: true, filters: opts.filters ?? [] });
    return { canceled: a.response === 1, filePath: a.response === 1 ? "" : resolve(a.paths![0]) };
  }
  async showMessageBox(options: MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
    if (!this.owner) return dialog.showMessageBox(options);
    const buttons = options.buttons?.length ? options.buttons : ["OK"];
    const cancelId = options.cancelId ?? Math.max(0, buttons.findIndex(b => /cancel|no|later/i.test(b)));
    const a = await this.ask({ kind: "message", title: options.title || "Confirmation", message: `${options.message}\n${options.detail ?? ""}`, defaultPath: "", buttons, cancelId, directory: false, multiple: false, filters: [], checkboxLabel: options.checkboxLabel, checkboxChecked: options.checkboxChecked });
    return { response: a.response, checkboxChecked: a.checkboxChecked ?? false };
  }
  async request(kind: "confirm" | "text", message: string, value = "", owner?: WebContents): Promise<string | boolean | null> {
    if (!["confirm", "text"].includes(kind) || typeof message !== "string" || message.length > 6000 || typeof value !== "string" || value.length > 2200) throw new Error("Invalid app dialog.");
    if (!this.owner && kind === "confirm") {
      const options = { message, buttons: ["Continue", "Cancel"], cancelId: 1, defaultId: 1 };
      const parent = owner && BrowserWindow.fromWebContents(owner);
      return (await (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options))).response === 0;
    }
    const manual = !this.owner;
    if (manual) { if (!owner) throw new Error("No app window can display this text dialog."); this.begin(owner); }
    const a = await this.ask({ kind: kind === "confirm" ? "message" : "text", title: kind === "confirm" ? "Confirmation" : "Enter text", message, defaultPath: value, buttons: ["Continue", "Cancel"], cancelId: 1, directory: false, multiple: false, filters: [] });
    if (manual && owner) this.end(owner);
    return kind === "confirm" ? a.response === 0 : a.response === 0 ? a.text ?? "" : null;
  }
}
export const appDialogs = new AppDialogs();
