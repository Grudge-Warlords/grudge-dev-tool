#!/usr/bin/env node
// scripts/import-secrets.mjs
// Reads KEY=VALUE pairs from a path and stores each in Windows Credential Vault
// via keytar under service "grudge-dev-tool". Values are NEVER printed, only
// counted and named. The source file is left in place; pass --delete to wipe.
//
// Usage:
//   node scripts/import-secrets.mjs "C:\\Users\\me\\Desktop\\secrets.txt"
//   node scripts/import-secrets.mjs "C:\\Users\\me\\Desktop\\secrets.txt" --delete

import { promises as fs } from "node:fs";
import { argv, exit } from "node:process";

const SERVICE = "grudge-dev-tool";

// Map of allow-listed env-var-style keys -> keytar account names.
// Anything NOT in this map is silently ignored when importing.
const KEY_TO_ACCOUNT = {
  // Cloudflare AI Workers / Gateway
  CF_AI_WORKERS_API:           "cf-ai-workers-api",
  CF_ACCOUNT_ID:               "cf-account-id",
  CF_AI_GATEWAY_ID:            "cf-ai-gateway-id",
  // Cloudflare R2 — direct S3-compatible credentials
  OBJECT_STORAGE_ENDPOINT:      "cf-r2-endpoint",
  OBJECT_STORAGE_BUCKET:        "cf-r2-bucket",
  OBJECT_STORAGE_KEY:           "cf-r2-access-key-id",
  OBJECT_STORAGE_SECRET:        "cf-r2-secret",
  OBJECT_STORAGE_REGION:        "cf-r2-region",
  OBJECT_STORAGE_PUBLIC_URL:    "cf-r2-public-url",
  OBJECT_STORAGE_PUBLIC_R2_URL: "cf-r2-public-r2-url",
  R2_BUCKET_ASSETS:             "cf-r2-bucket-assets",
  R2_BUCKET_OBJECTSTORE:        "cf-r2-bucket-objectstore",
  // Cloudflare R2 — Worker-fronted API
  OBJECTSTORE_WORKER_URL:       "cf-objectstore-worker-url",
  OBJECTSTORE_API_KEY:          "cf-objectstore-api-key",
  // Legacy aliases (kept for compatibility with set-secret.mjs)
  CF_R2_ACCESS_KEY_ID:          "cf-r2-access-key-id",
  CF_R2_SECRET:                 "cf-r2-secret",
  CF_R2_BUCKET:                 "cf-r2-bucket",
  CF_R2_TOKEN:                  "cf-r2-token",
  // Grudge backend / BlenderKit
  GRUDGE_API_BASE:              "default.apiBaseUrl",
  GRUDGE_ASSETS_API_BASE:       "default.assetsApiBaseUrl",  // legacy split-host override (optional)
  GRUDGE_TOKEN:                 "default",
  BLENDERKIT_API_KEY:           "blenderkit-api-key",
  // Fleet ONE TRUTH URLs (id.grudge-studio.com only — never auth.grudge-studio.com)
  GRUDGE_ID_BASE:               "fleet.idBase",
  GRUDGE_AUTH_URL:              "fleet.idBase", // alias → same key as ID gateway
  GRUDGE_GAME_DATA_URL:         "fleet.gameDataUrl",
  GRUDGE_CLIENT_URL:            "default.apiBaseUrl",
  // Legion / fleet AI (dev tool orchestrator)
  GRUDGE_AI_KEY:                "legion.fleetApiKey",
  GRUDGE_LEGION_HUB:            "legion.hubUrl",
  GRUDGE_GRUDA_AGENT:           "legion.grudaAgentUrl",
  // LLM / free agentic
  OPENAI_API_KEY:               "llm.openai",
  ANTHROPIC_API_KEY:            "llm.anthropic",
  GEMINI_API_KEY:               "llm.gemini",
  GEMINI_CLI_API:               "llm.gemini",
  GROQ_API_KEY:                 "llm.groq",
  TOGETHER_API_TOKEN:           "llm.together",
  TOGETHER_API_KEY:             "llm.together",
  ELEVEN_LABS_API:              "llm.elevenlabs",
  ELEVENLABS_API_KEY:           "llm.elevenlabs",
  POLY_PIZZA_API:               "assets.polypizza",
  POLYPIZZA_API:                "assets.polypizza",
  HF_TOKEN:                     "llm.huggingface",
  PUTER_AUTH_TOKEN:             "puter-token",
  PUTER_TOKEN:                  "puter-token",
};

/** Reject values that would break production (Worker URL as R2 S3, deprecated auth host). */
function sanitizeValue(envKey, value) {
  let v = String(value ?? "").trim().replace(/\r/g, "");
  if (!v) return { skip: true, reason: "empty" };

  // Deprecated hosts → rewrite to SSOT
  if (/^https?:\/\/auth\.grudge-studio\.com/i.test(v)) {
    v = "https://id.grudge-studio.com";
    console.warn(`[import-secrets] ${envKey}: rewrote auth.grudge-studio.com → id.grudge-studio.com`);
  }
  if (
    (envKey === "GRUDGE_API_BASE" || envKey === "GRUDGE_CLIENT_URL") &&
    /^https?:\/\/api\.grudge-studio\.com/i.test(v)
  ) {
    v = "https://client.grudge-studio.com";
    console.warn(`[import-secrets] ${envKey}: rewrote api.grudge-studio.com → client.grudge-studio.com`);
  }

  // R2 endpoint must be S3-compatible — never ObjectStore Worker or CDN
  if (envKey === "OBJECT_STORAGE_ENDPOINT") {
    if (/objectstore\.grudge-studio\.com|assets\.grudge-studio\.com|auth\.grudge-studio\.com/i.test(v)) {
      return {
        skip: true,
        reason:
          "OBJECT_STORAGE_ENDPOINT must be https://<account>.r2.cloudflarestorage.com (not Worker/CDN). Vault left unchanged.",
      };
    }
  }

  // ObjectStore Worker URL is objectstore host; API base must not be github.io
  if (envKey === "OBJECTSTORE_WORKER_URL" && /github\.io/i.test(v)) {
    v = "https://objectstore.grudge-studio.com";
    console.warn(`[import-secrets] ${envKey}: rewrote github.io → objectstore.grudge-studio.com`);
  }

  return { skip: false, value: v };
}

function getFlag(name) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=").slice(1).join("=");
  return undefined;
}

async function main() {
  const file = argv[2];
  const wipe = argv.includes("--delete");
  const sectionFilter = getFlag("section");  // optional substring match against comment-section headers
  if (!file) {
    console.error("Usage: node scripts/import-secrets.mjs <path-to-secrets.txt> [--section <substring>] [--delete]");
    exit(2);
  }

  let content;
  try {
    content = await fs.readFile(file, "utf8");
  } catch (err) {
    console.error(`[import-secrets] cannot read ${file}: ${err.code ?? err.message}`);
    exit(1);
  }

  // When --section is provided, scope ingestion to lines between a comment
  // header containing that substring and the next decorative comment header
  // (a line of dashes, equals, or box-drawing characters).
  if (sectionFilter) {
    const lines = content.split(/\r?\n/);
    let inSection = false;
    let depth = 0;
    const kept = [];
    for (const line of lines) {
      const isHeader = /^\s*#.*[\u2500\u2501\u2550\u2580-\u259F\-=]{4,}/.test(line) || /^\s*#\s*[\-=]{4,}/.test(line);
      if (!inSection && line.toLowerCase().includes(sectionFilter.toLowerCase())) {
        inSection = true;
        depth = 0;
        continue;
      }
      if (inSection) {
        if (isHeader) { depth += 1; if (depth >= 1 && !line.toLowerCase().includes(sectionFilter.toLowerCase())) break; }
        kept.push(line);
      }
    }
    content = kept.join("\n");
    console.log(`[import-secrets] scoped to section matching '${sectionFilter}' (${kept.length} lines)`);
  }

  let keytar;
  try {
    keytar = (await import("keytar")).default;
  } catch (err) {
    console.error("[import-secrets] keytar not available — run `npm install` first.");
    exit(1);
  }

  const stored = [];
  const skipped = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) { skipped.push(rawLine.slice(0, 30) + "…"); continue; }
    const [, key, rawValue] = m;
    const stripped = rawValue.replace(/^["'](.+?)["']$/, "$1"); // strip surrounding quotes
    const account = KEY_TO_ACCOUNT[key];
    if (!account) {
      console.warn(`[import-secrets] unknown key '${key}' — not stored. Add to KEY_TO_ACCOUNT to support.`);
      continue;
    }
    const cleaned = sanitizeValue(key, stripped);
    if (cleaned.skip) {
      console.warn(`[import-secrets] skip '${key}': ${cleaned.reason}`);
      continue;
    }
    const value = cleaned.value;
    if (!value) {
      console.warn(`[import-secrets] empty value for '${key}', skipped.`);
      continue;
    }
    await keytar.setPassword(SERVICE, account, value);
    stored.push(key);
  }

  console.log(`[import-secrets] stored ${stored.length} key(s) in Windows Credential Vault:`);
  stored.forEach((k) => console.log(`  \u2713 ${k}  \u2192  service=${SERVICE} account=${KEY_TO_ACCOUNT[k]}`));
  if (skipped.length) console.log(`[import-secrets] ${skipped.length} line(s) skipped (no KEY=VALUE shape)`);

  if (wipe) {
    await fs.unlink(file).catch(() => {});
    console.log(`[import-secrets] deleted source file ${file}`);
  } else {
    console.log(`[import-secrets] source file kept. Pass --delete to remove it.`);
  }
}

main().catch((err) => {
  console.error("[import-secrets] failed:", err.message);
  exit(1);
});
