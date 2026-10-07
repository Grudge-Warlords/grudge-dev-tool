import { app, type DownloadItem, type Session, type WebContents } from "electron";
import { mkdtempSync } from "node:fs";
import { copyFile, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { appDialogs } from "./appDialogs";

/** A browser/blob export uses the same save dialog as a native export. Chromium
 * requires setSavePath during will-download, so stage only this owned download
 * and deliver it after both download completion and destination selection. */
export class AppDownloads {
  private sessions = new Map<Session, (...args: any[]) => void>();
  private contents = new Set<number>();
  watch(contents: WebContents) {
    this.contents.add(contents.id);
    const session = contents.session; if (this.sessions.has(session)) return;
    const listener = (_event: Electron.Event, item: DownloadItem, source: WebContents) => {
      if (!appDialogs.isActive() || !source || !this.contents.has(source.id)) return;
      const directory = mkdtempSync(join(app.getPath("temp"), "grudge-prompt-export-"));
      const staged = join(directory, "download");
      item.setSavePath(staged);
      appDialogs.record(`Saving ${item.getFilename()}: awaiting destination and file completion.`, directory);
      let completed = false;
      const done = new Promise<string>(resolve => item.once("done", (_event, state) => { completed = true; resolve(state); }));
      void (async () => {
        try {
          const selection = await appDialogs.showSaveDialog({ title: "Save export", defaultPath: basename(item.getFilename()) });
          if (selection.canceled) { if (!completed) item.cancel(); appDialogs.record("Export canceled; no destination file was written.", directory); return; }
          if (await done !== "completed") throw new Error("The download did not complete.");
          await copyFile(staged, selection.filePath);
          appDialogs.record(`File saved: ${selection.filePath}`, directory);
        } catch (error) { appDialogs.record(`File save failed: ${error instanceof Error ? error.message : String(error)}`, directory); }
        finally { await rm(directory, { recursive: true, force: true }).catch(() => undefined); }
      })();
    };
    session.on("will-download", listener); this.sessions.set(session, listener);
  }
  end() { for (const [session, listener] of this.sessions) session.removeListener("will-download", listener); this.sessions.clear(); this.contents.clear(); }
}
