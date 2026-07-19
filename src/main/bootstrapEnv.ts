import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function parseEnv(content: string): void {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (process.env[key]) continue;
    const value = rawValue.replace(/^["'](.+?)["']$/, "$1").trim();
    if (value) process.env[key] = value;
  }
}

function envCandidates(): string[] {
  const candidates: string[] = [join(process.cwd(), ".env")];
  const appData = process.env.APPDATA;
  if (appData) {
    candidates.push(join(appData, "grudge-dev-tool", "toolchain.env"));
  }
  return candidates;
}

/** Load toolchain-related env vars from .env files without overwriting existing env. */
export function loadEnvFiles(): void {
  for (const file of envCandidates()) {
    if (!existsSync(file)) continue;
    try {
      parseEnv(readFileSync(file, "utf8"));
    } catch { /* ignore */ }
  }
}