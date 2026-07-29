import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function parseEnv(content: string): number {
  let n = 0;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toUpperCase().startsWith("VITE_") ? m[1] : m[1];
    // Normalize common keys to uppercase for process.env
    const envKey = /^[A-Z0-9_]+$/.test(m[1]) ? m[1] : m[1];
    if (process.env[envKey]) continue;
    let value = m[2].trim();
    // strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) {
      process.env[envKey] = value;
      n++;
    }
  }
  return n;
}

function envCandidates(): string[] {
  const home = homedir();
  const appData = process.env.APPDATA;
  const localApp = process.env.LOCALAPPDATA;
  const candidates: string[] = [
    join(process.cwd(), ".env"),
    join(process.cwd(), ".env.local"),
    join(process.cwd(), "toolchain.env"),
    join(home, ".env"),
    join(home, ".grudge.env"),
    join(home, "grudge-secrets.txt"),
    join(home, "secrets.txt"),
    join(home, "Desktop", "grudge-secrets.txt"),
    join(home, "Desktop", "secrets.txt"),
    join(home, "Desktop", "grudge-backend", ".env"),
    join(home, "grudge-build", ".env"),
  ];
  if (appData) {
    candidates.push(
      join(appData, "grudge-dev-tool", "toolchain.env"),
      join(appData, "grudge-dev-tool", ".env"),
      join(appData, "Grudge Studio", ".env"),
    );
  }
  if (localApp) {
    candidates.push(join(localApp, "grudge-dev-tool", ".env"));
  }
  // Deduplicate
  return [...new Set(candidates)];
}

/** Load env from package + user home + AppData without overwriting existing process env. */
export function loadEnvFiles(): { files: string[]; keysLoaded: number } {
  const files: string[] = [];
  let keysLoaded = 0;
  for (const file of envCandidates()) {
    if (!existsSync(file)) continue;
    try {
      const n = parseEnv(readFileSync(file, "utf8"));
      files.push(file);
      keysLoaded += n;
    } catch {
      /* ignore unreadable */
    }
  }
  return { files, keysLoaded };
}
