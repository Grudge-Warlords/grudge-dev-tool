import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { FLEET_URLS } from "./fleet.js";

const FLEET_DEFAULT = FLEET_URLS.client;

export interface GrudgeDevConfig {
  version: number;
  apiBase: string;
  repos: {
    grudgeBuilder?: string;
    grudgeDevTool?: string;
  };
  lastSetup?: string;
  lastDoctorScore?: number;
}

const CONFIG_VERSION = 1;
const CONFIG_DIR = path.join(os.homedir(), ".grudge-dev");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

const REPO_CANDIDATES = [
  process.env.GRUDGE_BUILDER_ROOT,
  "D:\\repos\\grudge-builder",
  "D:\\GrudgeRepos\\RTS-Grudge",
  path.join(os.homedir(), "Desktop", "grudge-builder"),
  path.join(os.homedir(), "Documents", "grudge-builder"),
].filter(Boolean) as string[];

const API_CANDIDATES = [
  process.env.GRUDGE_API_BASE,
  process.env.GRUDGE_CLIENT_URL,
  "https://client.grudge-studio.com",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
].filter(Boolean) as string[];

export function configDir(): string {
  return CONFIG_DIR;
}

export function configPath(): string {
  return CONFIG_PATH;
}

export function loadConfig(): GrudgeDevConfig | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as GrudgeDevConfig;
  } catch {
    return null;
  }
}

export function saveConfig(cfg: GrudgeDevConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}

export function findGrudgeBuilderRepo(): string | undefined {
  for (const p of REPO_CANDIDATES) {
    const pkg = path.join(p, "package.json");
    if (fs.existsSync(pkg)) {
      try {
        const j = JSON.parse(fs.readFileSync(pkg, "utf8"));
        if (j.name === "rest-express" || fs.existsSync(path.join(p, "client", "src"))) {
          return path.resolve(p);
        }
      } catch {
        /* skip */
      }
    }
  }
  return undefined;
}

export async function detectApiBase(preferred?: string): Promise<string> {
  const candidates = preferred
    ? [preferred, ...API_CANDIDATES.filter((c) => c !== preferred)]
    : API_CANDIDATES;

  for (const base of candidates) {
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/api/fleet/manifest`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return base.replace(/\/$/, "");
    } catch {
      /* try next */
    }
  }
  return (preferred || FLEET_DEFAULT).replace(/\/$/, "");
}

export async function autonomousSetup(opts: {
  apiBase?: string;
  repo?: string;
}): Promise<GrudgeDevConfig> {
  const repo =
    opts.repo ||
    findGrudgeBuilderRepo() ||
    undefined;
  const apiBase = await detectApiBase(opts.apiBase);

  const cfg: GrudgeDevConfig = {
    version: CONFIG_VERSION,
    apiBase,
    repos: {
      grudgeBuilder: repo,
      grudgeDevTool: process.cwd(),
    },
    lastSetup: new Date().toISOString(),
  };
  saveConfig(cfg);
  return cfg;
}

export function resolveApiBase(override?: string): string {
  if (override) return override.replace(/\/$/, "");
  const env = process.env.GRUDGE_API_BASE || process.env.GRUDGE_CLIENT_URL;
  if (env) return env.replace(/\/$/, "");
  const cfg = loadConfig();
  if (cfg?.apiBase) return cfg.apiBase.replace(/\/$/, "");
  return FLEET_DEFAULT;
}