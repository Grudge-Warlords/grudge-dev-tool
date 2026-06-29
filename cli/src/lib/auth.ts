import fs from "node:fs";
import path from "node:path";
import { configDir } from "./config.js";

const SERVICE = "grudge-dev-tool";
const ACCOUNT = "grudge-studio";
const AUTH_FILE = () => path.join(configDir(), "auth.json");

export interface StoredAuth {
  token?: string;
  adminPassword?: string;
  grudgeId?: string;
  savedAt?: string;
}

export async function loadAuth(): Promise<StoredAuth> {
  const fromEnv: StoredAuth = {};
  if (process.env.GRUDGE_AUTH_TOKEN) fromEnv.token = process.env.GRUDGE_AUTH_TOKEN;
  if (process.env.GRUDGE_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD) {
    fromEnv.adminPassword =
      process.env.GRUDGE_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
  }
  if (fromEnv.token || fromEnv.adminPassword) return fromEnv;

  try {
    const keytar = await import("keytar");
    const token = await keytar.getPassword(SERVICE, `${ACCOUNT}:token`);
    const adminPw = await keytar.getPassword(SERVICE, `${ACCOUNT}:admin`);
    if (token || adminPw) {
      return { token: token ?? undefined, adminPassword: adminPw ?? undefined };
    }
  } catch {
    /* keytar optional */
  }

  try {
    if (fs.existsSync(AUTH_FILE())) {
      return JSON.parse(fs.readFileSync(AUTH_FILE(), "utf8")) as StoredAuth;
    }
  } catch {
    /* ignore */
  }
  return {};
}

export async function saveAuth(auth: StoredAuth): Promise<void> {
  fs.mkdirSync(configDir(), { recursive: true });
  const payload = { ...auth, savedAt: new Date().toISOString() };

  let keytarOk = false;
  try {
    const keytar = await import("keytar");
    if (auth.token) await keytar.setPassword(SERVICE, `${ACCOUNT}:token`, auth.token);
    if (auth.adminPassword) {
      await keytar.setPassword(SERVICE, `${ACCOUNT}:admin`, auth.adminPassword);
    }
    keytarOk = true;
  } catch {
    /* fallback file */
  }

  if (!keytarOk || process.env.GRUDGE_DEV_AUTH_FILE === "1") {
    fs.writeFileSync(AUTH_FILE(), JSON.stringify(payload, null, 2), "utf8");
  }
}

export async function authHeaders(): Promise<Record<string, string>> {
  const auth = await loadAuth();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (auth.adminPassword) headers["X-Admin-Password"] = auth.adminPassword;
  return headers;
}