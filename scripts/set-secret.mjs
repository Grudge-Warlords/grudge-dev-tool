#!/usr/bin/env node
// scripts/set-secret.mjs <KEY_NAME>
// Reads the value from process.env[KEY_NAME] and stores it in Windows Credential
// Vault under service "grudge-dev-tool" with the corresponding account name.
// The script never echoes or logs the value.
//
// Usage (PowerShell):
//   $env:CF_AI_WORKERS_API = '<paste here>'
//   node scripts/set-secret.mjs CF_AI_WORKERS_API
//   $env:CF_AI_WORKERS_API = $null   # wipe from session
//
// Usage (bash):
//   read -s CF_AI_WORKERS_API && export CF_AI_WORKERS_API
//   node scripts/set-secret.mjs CF_AI_WORKERS_API
//   unset CF_AI_WORKERS_API

import { argv, env, exit } from "node:process";

const SERVICE = "grudge-dev-tool";

const KEY_TO_ACCOUNT = {
  CF_AI_WORKERS_API:    "cf-ai-workers-api",
  CF_R2_TOKEN:          "cf-r2-token",
  CF_R2_ACCESS_KEY_ID:  "cf-r2-access-key-id",
  CF_R2_SECRET:         "cf-r2-secret",
  CF_R2_BUCKET:         "cf-r2-bucket",
  CF_ACCOUNT_ID:        "cf-account-id",
  CF_AI_GATEWAY_ID:     "cf-ai-gateway-id",
  GRUDGE_API_BASE:        "default.apiBaseUrl",
  GRUDGE_ASSETS_API_BASE: "default.assetsApiBaseUrl",
  GRUDGE_TOKEN:           "default",
  BLENDERKIT_API_KEY:     "blenderkit-api-key",
};

async function main() {
  const key = argv[2];
  if (!key) {
    console.error("Usage: node scripts/set-secret.mjs <KEY_NAME>");
    console.error("Known keys: " + Object.keys(KEY_TO_ACCOUNT).join(", "));
    exit(2);
  }
  const account = KEY_TO_ACCOUNT[key];
  if (!account) {
    console.error(`Unknown key '${key}'. Add it to KEY_TO_ACCOUNT in scripts/set-secret.mjs to support it.`);
    exit(2);
  }
  const value = env[key];
  if (!value) {
    console.error(`Environment variable '${key}' is empty or unset. Set it first, then re-run.`);
    exit(2);
  }
  const len = value.length;
  const keytar = (await import("keytar")).default;
  await keytar.setPassword(SERVICE, account, value);
  console.log(`stored '${key}' (${len} chars) in Windows Credential Vault as service='${SERVICE}' account='${account}'`);
}

main().catch((err) => {
  console.error("[set-secret] failed:", err.message);
  exit(1);
});
