/**
 * Seed Windows Credential Vault (keytar) + in-memory secret map from process.env.
 * App starts ready — user should not paste API keys into Settings.
 *
 * Sources (first wins for process.env via bootstrapEnv, then vault seed only if empty):
 *  - Shell / system environment
 *  - .env files loaded by bootstrapEnv (home, Desktop, package, AppData)
 */

import keytar from "keytar";
import * as bk from "./blenderkit/daemon";
import * as sketchfab from "./sketchfab/credentials";
import * as toolchainSettings from "./toolchainSettings";
import { CF_ACCOUNTS, type CfAccount, writeCf, readCf } from "./cf/credentials";
import { setSecret, getSecret } from "./auth/secretStore";
import * as legion from "./legion/orchestrator";
import log from "./logger";

const SERVICE = "grudge-dev-tool";

/** env var → keytar account (mirrors scripts/import-secrets.mjs + extras) */
const ENV_TO_KEYTAR: Array<{ env: string | string[]; account: string; cf?: CfAccount }> = [
  { env: "CF_AI_WORKERS_API", account: CF_ACCOUNTS.aiWorkersApi, cf: "aiWorkersApi" },
  { env: "CF_ACCOUNT_ID", account: CF_ACCOUNTS.accountId, cf: "accountId" },
  { env: "CF_AI_GATEWAY_ID", account: CF_ACCOUNTS.aiGatewayId, cf: "aiGatewayId" },
  { env: ["OBJECT_STORAGE_ENDPOINT", "CF_R2_ENDPOINT"], account: CF_ACCOUNTS.endpoint, cf: "endpoint" },
  { env: ["OBJECT_STORAGE_BUCKET", "CF_R2_BUCKET"], account: CF_ACCOUNTS.bucket, cf: "bucket" },
  { env: ["OBJECT_STORAGE_KEY", "CF_R2_ACCESS_KEY_ID"], account: CF_ACCOUNTS.accessKeyId, cf: "accessKeyId" },
  { env: ["OBJECT_STORAGE_SECRET", "CF_R2_SECRET"], account: CF_ACCOUNTS.secret, cf: "secret" },
  { env: "OBJECT_STORAGE_REGION", account: CF_ACCOUNTS.region, cf: "region" },
  { env: "OBJECT_STORAGE_PUBLIC_URL", account: CF_ACCOUNTS.publicUrl, cf: "publicUrl" },
  { env: "OBJECT_STORAGE_PUBLIC_R2_URL", account: CF_ACCOUNTS.publicR2Url, cf: "publicR2Url" },
  { env: "R2_BUCKET_ASSETS", account: CF_ACCOUNTS.bucketAssets, cf: "bucketAssets" },
  { env: "R2_BUCKET_OBJECTSTORE", account: CF_ACCOUNTS.bucketStore, cf: "bucketStore" },
  { env: ["OBJECTSTORE_WORKER_URL", "CF_OBJECTSTORE_WORKER_URL"], account: CF_ACCOUNTS.workerUrl, cf: "workerUrl" },
  { env: ["OBJECTSTORE_API_KEY", "CF_OBJECTSTORE_API_KEY"], account: CF_ACCOUNTS.workerApiKey, cf: "workerApiKey" },
  { env: "GRUDGE_API_BASE", account: "default.apiBaseUrl" },
  { env: "GRUDGE_ASSETS_API_BASE", account: "default.assetsApiBaseUrl" },
  { env: "GRUDGE_TOKEN", account: "default" },
  { env: "BLENDERKIT_API_KEY", account: "blenderkit-api-key" },
  { env: "SKETCHFAB_API_KEY", account: "sketchfab-api-key" },
  { env: "GRUDGE_AI_KEY", account: "legion.fleetApiKey" },
  { env: "GRUDGE_LEGION_HUB", account: "legion.hubUrl" },
  { env: "GRUDGE_GRUDA_AGENT", account: "legion.grudaAgentUrl" },
  // LLM keys for free/paid agentic fallbacks
  { env: "OPENAI_API_KEY", account: "llm.openai" },
  { env: "ANTHROPIC_API_KEY", account: "llm.anthropic" },
  { env: ["GEMINI_API_KEY", "GOOGLE_AI_API_KEY"], account: "llm.gemini" },
  { env: ["HF_TOKEN", "HUGGINGFACE_TOKEN", "HUGGING_FACE_HUB_TOKEN"], account: "llm.huggingface" },
  { env: ["PUTER_AUTH_TOKEN", "PUTER_TOKEN", "PUTER_API_TOKEN"], account: "puter-token" },
  { env: "ALE_AI", account: "llm.ale" },
];

function firstEnv(keys: string | string[]): string | undefined {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const k of list) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  return undefined;
}

async function vaultEmpty(account: string): Promise<boolean> {
  try {
    const v = await keytar.getPassword(SERVICE, account);
    if (v) return false;
  } catch {
    /* try secretStore */
  }
  try {
    const v = await getSecret(account);
    if (v) return false;
  } catch {
    /* empty */
  }
  return true;
}

async function storeAccount(account: string, value: string): Promise<void> {
  // Prefer secretStore for large tokens; keytar for CF map compatibility
  try {
    await keytar.setPassword(SERVICE, account, value);
  } catch {
    await setSecret(account, value);
  }
}

/**
 * Seed API keys and toolchain paths from env when vault entries are empty.
 */
export async function seedDefaultSecrets(): Promise<{ seeded: string[]; skipped: string[] }> {
  const seeded: string[] = [];
  const skipped: string[] = [];

  for (const row of ENV_TO_KEYTAR) {
    const value = firstEnv(row.env);
    if (!value) {
      skipped.push(Array.isArray(row.env) ? row.env[0] : row.env);
      continue;
    }
    const empty = await vaultEmpty(row.account);
    if (!empty) {
      skipped.push(`${Array.isArray(row.env) ? row.env[0] : row.env}:already`);
      continue;
    }
    try {
      if (row.cf) {
        await writeCf(row.cf, value);
      } else if (row.account === "blenderkit-api-key") {
        await bk.setApiKey(value);
      } else if (row.account === "sketchfab-api-key") {
        await sketchfab.setApiKey(value);
      } else if (row.account === "legion.fleetApiKey") {
        await legion.setFleetApiKey(value);
      } else if (row.account === "legion.hubUrl") {
        await legion.setLegionHubUrl(value);
      } else if (row.account === "legion.grudaAgentUrl") {
        await legion.setGrudaAgentUrl(value);
      } else if (row.account === "puter-token") {
        // only set token if no session — Login still needed for full user profile
        await setSecret("puter-token", value);
      } else {
        await storeAccount(row.account, value);
      }
      seeded.push(Array.isArray(row.env) ? row.env[0] : row.env);
    } catch (e: unknown) {
      log.warn(
        `[bootstrapSecrets] failed ${Array.isArray(row.env) ? row.env[0] : row.env}: ${
          e instanceof Error ? e.message : e
        }`,
      );
    }
  }

  if (process.env.BLENDER_PATH && !(await toolchainSettings.getBlenderPath())) {
    await toolchainSettings.setBlenderPath(process.env.BLENDER_PATH);
    seeded.push("BLENDER_PATH");
  }
  if (process.env.BLENDERKIT_PATH && !(await toolchainSettings.getBlenderKitPath())) {
    await toolchainSettings.setBlenderKitPath(process.env.BLENDERKIT_PATH);
    seeded.push("BLENDERKIT_PATH");
  }

  // Keep process.env mirrors for modules that only read env (openai, etc.)
  for (const row of ENV_TO_KEYTAR) {
    const keys = Array.isArray(row.env) ? row.env : [row.env];
    if (keys.some((k) => process.env[k])) continue;
    if (row.cf) {
      const v = await readCf(row.cf);
      if (v) process.env[keys[0]] = v;
    }
  }

  log.info(
    `[bootstrapSecrets] seeded ${seeded.length} secret(s) from env: ${seeded.join(", ") || "(none)"}`,
  );
  return { seeded, skipped };
}

/** Read a seeded LLM key (env first, then vault). */
export async function readLlmKey(
  which: "openai" | "anthropic" | "gemini" | "huggingface" | "ale",
): Promise<string | null> {
  const envMap: Record<string, string[]> = {
    openai: ["OPENAI_API_KEY"],
    anthropic: ["ANTHROPIC_API_KEY"],
    gemini: ["GEMINI_API_KEY", "GOOGLE_AI_API_KEY"],
    huggingface: ["HF_TOKEN", "HUGGINGFACE_TOKEN", "HUGGING_FACE_HUB_TOKEN"],
    ale: ["ALE_AI"],
  };
  for (const k of envMap[which] ?? []) {
    if (process.env[k]?.trim()) return process.env[k]!.trim();
  }
  const account = `llm.${which}`;
  try {
    const v = await keytar.getPassword(SERVICE, account);
    if (v) return v;
  } catch {
    /* */
  }
  return getSecret(account);
}
