import log from "electron-log/main";
import { app } from "electron";
import { join } from "node:path";

let initialized = false;

export function initLogger(): void {
  if (initialized) return;
  initialized = true;

  // electron-log defaults are sane; we just tighten the file location and
  // attach the global handlers.
  const logFile = join(app.getPath("userData"), "logs", "main.log");
  log.transports.file.resolvePathFn = () => logFile;
  log.transports.file.maxSize = 5 * 1024 * 1024;
  log.transports.file.level = app.isPackaged ? "info" : "debug";
  log.transports.console.level = "debug";

  // Replace console.* in the main process so existing console.log calls go
  // through the file transport.
  log.initialize({ preload: false });
  Object.assign(console, log.functions);

  process.on("uncaughtException", (err) => {
    log.error("uncaughtException:", err);
  });
  process.on("unhandledRejection", (reason) => {
    log.error("unhandledRejection:", reason);
  });

  log.info(`logger ready · file=${logFile} · packaged=${app.isPackaged} · v${app.getVersion()}`);
}

export function getLogFilePath(): string {
  return join(app.getPath("userData"), "logs", "main.log");
}

export default log;
